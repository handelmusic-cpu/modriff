#include "graphpool.h"

#include <algorithm>
#include <cstring>

namespace modsynth {

namespace {
enum State : int { FREE = 0, LOADING, READY, PLAYING };
}

struct GraphPool::Slot {
  Graph g;
  std::atomic<int> state{FREE};
  std::atomic<uint32_t> gen{1};
  uint64_t startFrame = 0;
  double timeBase = 0;
  // Edits: single producer (control), single consumer (render).
  double edits[kEditCap * 6];
  std::atomic<uint32_t> wr{0}, rd{0};
};

GraphPool::GraphPool() : slots_(new Slot[kMaxVoices]) {}
GraphPool::~GraphPool() = default;

int GraphPool::begin(const double *prog, size_t len, double timeBase, uint64_t startFrame) {
  for (int i = 0; i < kMaxVoices; i++) {
    Slot &s = slots_[i];
    int expect = FREE;
    if (!s.state.compare_exchange_strong(expect, LOADING, std::memory_order_acquire)) continue;
    if (!s.g.load(prog, len, timeBase)) {
      s.state.store(FREE, std::memory_order_release);
      dropped_.fetch_add(1, std::memory_order_relaxed);
      return -1;
    }
    s.startFrame = startFrame;
    s.timeBase = timeBase;
    s.rd.store(0, std::memory_order_relaxed);
    s.wr.store(0, std::memory_order_relaxed);
    const uint32_t gen = s.gen.fetch_add(1, std::memory_order_relaxed) + 1;
    s.state.store(READY, std::memory_order_release);
    return (int)((gen << 8) | (uint32_t)i);
  }
  dropped_.fetch_add(1, std::memory_order_relaxed);
  return -1;
}

bool GraphPool::edit(int handle, const double *inc, size_t len) {
  if (handle < 0 || len % 6) return false;
  Slot &s = slots_[handle & 0xff];
  if ((uint32_t)handle >> 8 != s.gen.load(std::memory_order_relaxed)) return false;
  const int st = s.state.load(std::memory_order_acquire);
  if (st != READY && st != PLAYING) return false;
  const size_t n = len / 6;
  const uint32_t w = s.wr.load(std::memory_order_relaxed), r = s.rd.load(std::memory_order_acquire);
  if (w - r + n > (uint32_t)kEditCap) { lateEdits_.fetch_add(1, std::memory_order_relaxed); return false; }
  for (size_t k = 0; k < n; k++) {
    double *dst = &s.edits[((w + k) % kEditCap) * 6];
    std::memcpy(dst, inc + k * 6, 6 * sizeof(double));
    // Re-based on the way in, so the render side needs no base of its own.
    dst[4] -= s.timeBase;
  }
  s.wr.store(w + (uint32_t)n, std::memory_order_release);
  return true;
}

void GraphPool::render(uint64_t frame0, int frames, float *const *busL, float *const *busR) {
  for (int i = 0; i < kMaxVoices; i++) {
    Slot &s = slots_[i];
    int st = s.state.load(std::memory_order_acquire);
    if (st == READY) {
      if (s.startFrame >= frame0 + (uint64_t)frames) continue;   // not yet
      s.state.store(PLAYING, std::memory_order_relaxed);
      st = PLAYING;
    }
    if (st != PLAYING) continue;

    // Edits queued before this block take effect at its start.
    uint32_t r = s.rd.load(std::memory_order_relaxed);
    const uint32_t w = s.wr.load(std::memory_order_acquire);
    while (r != w) {
      s.g.apply(&s.edits[(r % kEditCap) * 6], 6, 0.0);
      r++;
    }
    s.rd.store(r, std::memory_order_release);

    int off = s.startFrame > frame0 ? (int)(s.startFrame - frame0) : 0;
    int left = frames - off;
    const int ne = s.g.extCount();
    while (left > 0) {
      const int n = std::min(left, (int)Graph::kQuantum);
      s.g.render(n);
      for (int e = 0; e < ne; e++) {
        const int code = s.g.extId(e);
        if (code < 0 || code >= kMaxParts || !busL[code]) continue;
        const float *l = s.g.extBuf(e, 0), *rr = s.g.extBuf(e, 1);
        float *bl = busL[code] + off, *br = busR[code] + off;
        for (int k = 0; k < n; k++) { bl[k] += l[k]; br[k] += rr[k]; }
      }
      off += n; left -= n;
    }
    if (s.g.finished()) {
      s.state.store(FREE, std::memory_order_release);
    }
  }
}

int GraphPool::active() const {
  int n = 0;
  for (int i = 0; i < kMaxVoices; i++) {
    const int st = slots_[i].state.load(std::memory_order_acquire);
    if (st == READY || st == PLAYING) n++;
  }
  return n;
}

}  // namespace modsynth
