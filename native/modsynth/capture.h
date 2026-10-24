// A one-way pipe for audio from the render thread to whoever records it: the
// native engine's side of Bounce and stems (v5 step N5).
//
// The recorder is in the page. It taps Web Audio nodes, and a part the native
// engine plays is in none of them, so the host copies what it makes into rings
// (the master, and optionally each part's own bus) and the page drains them a
// few times a second and mixes them into the WAV on the same timeline.
//
// Single writer (the render thread) and single reader (whoever holds the host's
// control lock). The writer never blocks, allocates or waits for the reader.
// When the reader falls behind by more than the ring holds, the oldest audio is
// the loss, counted and reported with the position the next audio starts at, so
// a gap stays a gap in the file instead of closing up and pulling everything
// after it early. That is the same rule the page's own taps follow
// (`RecTap` stamps every block with its frame).
//
// Positions are absolute host frames (`write`'s `absFrame`, the host's running
// count), not indices into the ring, so the page can put a block on its
// timeline from one anchor and the frame number alone.
#pragma once
#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace modsynth {

class CaptureRing {
 public:
  // `capacityFrames` is rounded up to a power of two. Allocates; build it off
  // the audio thread.
  explicit CaptureRing(size_t capacityFrames)
      : cap_(roundUp(capacityFrames)), mask_(cap_ - 1), l_(cap_, 0.0f), r_(cap_, 0.0f) {}

  // ── control thread ──────────────────────────────────────────────────────
  // Begin a take: whatever was in the ring is forgotten, and the next block
  // the render thread writes is the take's first. Idempotent while armed.
  void arm() {
    readPos_ = 0;
    state_.store(ARMED, std::memory_order_release);
  }
  // End the take. The render thread stops writing at its next block; what is in
  // the ring can still be read.
  void stop() {
    int s = ARMED;
    // Armed and never written (the engine was not rendering): nothing to drain.
    if (state_.compare_exchange_strong(s, IDLE, std::memory_order_acq_rel)) return;
    s = ACTIVE;
    state_.compare_exchange_strong(s, STOPPED, std::memory_order_acq_rel);
  }
  // Copies up to `max` frames the writer has produced since the last read.
  // `frame0` is the absolute host frame of the first one returned; `lost` is how
  // many frames were overwritten before they could be read (their positions are
  // skipped, so frame0 jumps by that much). Returns the number copied.
  size_t read(float* L, float* R, size_t max, uint64_t& frame0, uint64_t& lost) {
    lost = 0; frame0 = 0;
    const int s = state_.load(std::memory_order_acquire);
    if (s == IDLE || s == ARMED) return 0;            // nothing written yet
    const uint64_t start = startAbs_;                 // published with state_
    max = std::min(max, cap_ / 2);                    // see the tear check below
    for (;;) {
      const uint64_t w = written_.load(std::memory_order_acquire);
      if (w == readPos_) return 0;
      if (w - readPos_ > cap_) {                      // overrun: skip to the oldest still held
        const uint64_t drop = w - cap_ - readPos_;
        lost += drop; readPos_ += drop;
      }
      const size_t n = (size_t)std::min<uint64_t>(w - readPos_, max);
      copyOut(readPos_, L, R, n);
      // The writer may have lapped part of what was just copied. Frames from
      // readPos_ up to (w2 - cap_) are no longer trustworthy; drop them and, if
      // anything is left, hand that back.
      //
      // The count to check against is the writer's *claim*, made before it
      // starts copying, not what it has published after: a block it is in the
      // middle of writing has already overwritten the slots of the oldest
      // frames it will push out. (A seqlock: claim, fence, write; read, fence,
      // look at the claim.)
      std::atomic_thread_fence(std::memory_order_acquire);
      const uint64_t w2 = claimed_.load(std::memory_order_relaxed);
      const uint64_t bad = w2 > readPos_ + cap_ ? w2 - cap_ - readPos_ : 0;
      if (bad >= n) { lost += n; readPos_ += n; continue; }
      if (bad) {
        lost += bad; readPos_ += bad;
        std::memmove(L, L + bad, (n - bad) * sizeof(float));
        std::memmove(R, R + bad, (n - bad) * sizeof(float));
      }
      const size_t got = n - (size_t)bad;
      frame0 = start + readPos_;
      readPos_ += got;
      return got;
    }
  }
  bool active() const {
    const int s = state_.load(std::memory_order_acquire);
    return s == ARMED || s == ACTIVE;
  }
  size_t capacity() const { return cap_; }

  // ── render thread ───────────────────────────────────────────────────────
  // `absFrame` is the host's frame count at the start of this block.
  void write(const float* L, const float* R, int n, uint64_t absFrame) {
    int s = state_.load(std::memory_order_acquire);
    if (s == ARMED) {
      // First block of the take. written_ is reset here, by the thread that
      // owns it; the reader sees the new state only after this release.
      written_.store(0, std::memory_order_relaxed);
      claimed_.store(0, std::memory_order_relaxed);
      startAbs_ = absFrame;
      state_.store(ACTIVE, std::memory_order_release);
      s = ACTIVE;
    }
    if (s != ACTIVE || n <= 0) return;
    uint64_t w = written_.load(std::memory_order_relaxed);
    claimed_.store(w + (uint64_t)n, std::memory_order_relaxed);
    std::atomic_thread_fence(std::memory_order_release);   // the claim is visible before any slot changes
    size_t at = (size_t)(w & mask_);
    size_t first = std::min((size_t)n, cap_ - at);
    std::memcpy(&l_[at], L, first * sizeof(float));
    std::memcpy(&r_[at], R, first * sizeof(float));
    if ((size_t)n > first) {
      std::memcpy(&l_[0], L + first, ((size_t)n - first) * sizeof(float));
      std::memcpy(&r_[0], R + first, ((size_t)n - first) * sizeof(float));
    }
    written_.store(w + (uint64_t)n, std::memory_order_release);
  }

 private:
  enum { IDLE = 0, ARMED = 1, ACTIVE = 2, STOPPED = 3 };
  static size_t roundUp(size_t n) { size_t c = 1024; while (c < n) c <<= 1; return c; }
  void copyOut(uint64_t from, float* L, float* R, size_t n) const {
    size_t at = (size_t)(from & mask_);
    size_t first = std::min(n, cap_ - at);
    std::memcpy(L, &l_[at], first * sizeof(float));
    std::memcpy(R, &r_[at], first * sizeof(float));
    if (n > first) {
      std::memcpy(L + first, &l_[0], (n - first) * sizeof(float));
      std::memcpy(R + first, &r_[0], (n - first) * sizeof(float));
    }
  }

  const size_t cap_, mask_;
  std::vector<float> l_, r_;
  std::atomic<uint64_t> written_{0};   // frames fully written: what the reader may take
  std::atomic<uint64_t> claimed_{0};   // frames the writer has begun: where it may be overwriting
  std::atomic<int> state_{IDLE};
  uint64_t startAbs_ = 0;   // written by the render thread before ACTIVE is published
  uint64_t readPos_ = 0;    // control thread only
};

// Where the render callbacks sit on the wall clock, as one number. Each block
// gives `off` = (its wall time - its first frame / rate) in ms; this tracks the
// median of those, by sign steps: coarse for the first 128 blocks, fine after.
// The median and not the minimum. The earliest-looking block is an outlier (the
// engine fills its buffers in bursts), and a minimum put every native note 31 ms
// early in a real bounce, while a live note is placed using the clock of the
// block that drains it, which is a typical block. Render thread; no allocation.
class PhaseTracker {
 public:
  void reset() { n_ = 0; est_ = 0; }
  double update(double off) {
    if (n_ == 0) est_ = off;
    else est_ += (off > est_ ? 1.0 : -1.0) * (n_ < 128 ? 0.5 : 0.05);
    n_++;
    return est_;
  }
  uint32_t count() const { return n_; }
 private:
  uint32_t n_ = 0;
  double est_ = 0;
};

}  // namespace modsynth
