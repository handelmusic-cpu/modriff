#include "graphpool.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace modsynth {

namespace {
// Longest delay a voice is caught up over: past this it starts from its beginning
// rather than spend a burst of CPU on a note nobody would still be waiting for.
constexpr uint64_t kMaxCatchUp = 48000;
enum State : int { FREE = 0, LOADING, READY, PLAYING };
}

struct GraphPool::Slot {
  Graph g;
  std::atomic<int> state{FREE};
  std::atomic<uint32_t> gen{1};
  uint64_t startFrame = 0;
  double timeBase = 0;
  // Render thread only. `level` is the peak this voice put out in its last block
  // (what a steal picks the quiet one by); `fade` counts the frames left of a
  // fade-out, 0 when the voice is not being stolen.
  float level = 0;
  int fade = 0;
  // Edits: single producer (control), single consumer (render).
  double edits[kEditCap * 6];
  std::atomic<uint32_t> wr{0}, rd{0};
};

GraphPool::GraphPool() : slots_(new Slot[kSlots]) {}
GraphPool::~GraphPool() = default;

int GraphPool::begin(const double *prog, size_t len, double timeBase, uint64_t startFrame) {
  for (int i = 0; i < kSlots; i++) {
    Slot &s = slots_[i];
    int expect = FREE;
    if (!s.state.compare_exchange_strong(expect, LOADING, std::memory_order_acquire)) continue;
    if (!s.g.load(prog, len, timeBase, &store_)) {
      const int unknown = s.g.unknownBuffer();
      s.state.store(FREE, std::memory_order_release);
      if (unknown >= 0) { unknownBuf_.store(unknown, std::memory_order_relaxed); return -2; }
      dropped_.fetch_add(1, std::memory_order_relaxed);
      droppedRefused_.fetch_add(1, std::memory_order_relaxed);
      return -1;
    }
    s.startFrame = startFrame;
    s.timeBase = timeBase;
    s.rd.store(0, std::memory_order_relaxed);
    s.wr.store(0, std::memory_order_relaxed);
    s.level = 1.f; s.fade = 0;
    const uint32_t gen = s.gen.fetch_add(1, std::memory_order_relaxed) + 1;
    s.state.store(READY, std::memory_order_release);
    return (int)((gen << 8) | (uint32_t)i);
  }
  dropped_.fetch_add(1, std::memory_order_relaxed);
  droppedBusy_.fetch_add(1, std::memory_order_relaxed);
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

void GraphPool::render(uint64_t frame0, int frames, float *const *busL, float *const *busR, bool *touched) {
  // Making room, before anything starts. Count what is sounding and what is
  // due this block; if that is more than kMaxVoices, fade out the surplus. A
  // voice already fading is on its way out and does not count as sounding.
  // Chosen here, on the render thread, because only this thread may touch a
  // playing slot: begin() on the control side just parks the new note in a spare
  // slot and this decides who makes way for it.
  int sounding = 0, due = 0;
  for (int i = 0; i < kSlots; i++) {
    Slot &s = slots_[i];
    const int st = s.state.load(std::memory_order_acquire);
    if (st == PLAYING) { if (!s.fade) sounding++; }
    else if (st == READY && s.startFrame < frame0 + (uint64_t)frames) due++;
  }
  int room = kMaxVoices - sounding;          // starts this block can have without a steal
  for (int need = due - room; need > 0; need--) {
    // A voice in its release first, then the quietest, then the oldest. One that
    // began within the last 50 ms is only taken when nothing older is left: its
    // attack has not built yet, so its level says nothing.
    int best = -1;
    bool bRel = false, bYoung = true; float bLevel = 0; uint64_t bStart = 0;
    for (int i = 0; i < kSlots; i++) {
      Slot &s = slots_[i];
      if (s.state.load(std::memory_order_acquire) != PLAYING || s.fade) continue;
      const bool rel = s.g.released();
      const bool young = frame0 < s.startFrame + 2400;
      bool better = best < 0;
      if (!better) {
        if (young != bYoung) better = bYoung;
        else if (rel != bRel) better = rel;
        else if (s.level != bLevel) better = s.level < bLevel;
        else better = s.startFrame < bStart;
      }
      if (better) { best = i; bRel = rel; bYoung = young; bLevel = s.level; bStart = s.startFrame; }
    }
    if (best < 0) break;
    slots_[best].fade = kFadeFrames;
    stolen_.fetch_add(1, std::memory_order_relaxed);
    room++;
  }

  int playing = 0;
  for (int i = 0; i < kSlots; i++) {
    Slot &s = slots_[i];
    int st = s.state.load(std::memory_order_acquire);
    bool first = false;
    if (st == READY) {
      if (s.startFrame >= frame0 + (uint64_t)frames) continue;   // not yet
      if (room <= 0) continue;           // nobody could be faded (all are young and fading): wait a block
      room--;
      s.state.store(PLAYING, std::memory_order_relaxed);
      st = PLAYING;
      first = true;
    }
    if (st != PLAYING) continue;
    playing++;

    // Edits queued before this block take effect at its start.
    uint32_t r = s.rd.load(std::memory_order_relaxed);
    const uint32_t w = s.wr.load(std::memory_order_acquire);
    while (r != w) {
      s.g.apply(&s.edits[(r % kEditCap) * 6], 6, 0.0);
      r++;
    }
    s.rd.store(r, std::memory_order_release);

    // A voice that arrives after its origin (the bridge takes a few ms) is
    // caught up: its clock is run forward, unheard, to where it should be, so
    // what sounds from here is what would be sounding had it come on time. A
    // note the page scheduled ahead is never late; this only eats the delay.
    if (first && s.startFrame < frame0) {
      uint64_t late = std::min<uint64_t>(frame0 - s.startFrame, kMaxCatchUp);
      while (late > 0) {
        const int n = (int)std::min<uint64_t>(late, (uint64_t)Graph::kQuantum);
        s.g.render(n);
        late -= (uint64_t)n;
      }
      s.startFrame = frame0;
    }
    int off = s.startFrame > frame0 ? (int)(s.startFrame - frame0) : 0;
    int left = frames - off;
    const int ne = s.g.extCount();
    float pk = 0;
    const bool wasFading = s.fade > 0;
    while (left > 0) {
      const int n = std::min(left, (int)Graph::kQuantum);
      s.g.render(n);
      // A steal ramps the voice to nothing instead of cutting it: linear over
      // kFadeFrames, so the step between samples is never more than the voice's
      // own plus amplitude/kFadeFrames. Computed once per quantum for all its buses.
      float fg[Graph::kQuantum];
      const bool fading = s.fade > 0;
      if (fading) for (int k = 0; k < n; k++) fg[k] = s.fade > k ? (float)(s.fade - k) / (float)kFadeFrames : 0.f;
      for (int e = 0; e < ne; e++) {
        const int code = s.g.extId(e);
        if (code < 0 || code >= kBuses || !busL[code]) continue;
        const float *l = s.g.extBuf(e, 0), *rr = s.g.extBuf(e, 1);
        if (touched) touched[code] = true;
        float *bl = busL[code] + off, *br = busR[code] + off;
        if (fading) for (int k = 0; k < n; k++) { bl[k] += l[k] * fg[k]; br[k] += rr[k] * fg[k]; }
        else for (int k = 0; k < n; k++) { bl[k] += l[k]; br[k] += rr[k]; }
        for (int k = 0; k < n; k++) pk = std::max(pk, std::max(std::fabs(l[k]), std::fabs(rr[k])));
      }
      if (fading) s.fade = std::max(0, s.fade - n);
      off += n; left -= n;
      if (fading && s.fade == 0) break;
    }
    s.level = pk;
    if (wasFading && s.fade == 0) {
      s.state.store(FREE, std::memory_order_release);
    } else if (s.g.finished()) {
      s.state.store(FREE, std::memory_order_release);
    }
  }
  if (playing > peak_.load(std::memory_order_relaxed)) peak_.store(playing, std::memory_order_relaxed);
}

int GraphPool::active() const {
  int n = 0;
  for (int i = 0; i < kSlots; i++) {
    const int st = slots_[i].state.load(std::memory_order_acquire);
    if (st == READY || st == PLAYING) n++;
  }
  return n;
}

}  // namespace modsynth
