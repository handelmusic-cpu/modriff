// A pool of recorded graphs playing at once: the voices of one or more parts.
//
// The host owns one of these. The control thread (the one that receives the
// page's messages) calls begin() with a program and edit() with later changes;
// the render thread calls render() once a block, which starts what is due,
// applies queued edits, plays every voice into its part's bus, and retires the
// ones that have finished. Nothing on the render side allocates, locks or waits.
//
// Handing a voice across is a slot state machine, not a queue of pointers, so
// the render thread never frees memory: a slot is FREE, then LOADING (the
// control thread is parsing into its Graph), READY (published), PLAYING (the
// render thread owns it) and back to FREE when it has finished. Only the
// thread that owns a state may touch the slot.
//
// What this does not do: the clock. A voice starts at an engine frame the
// caller computed (the host already converts the page's timestamp to engine
// frames for every other message); one that is late starts at once.
#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>

#include "graph.h"

namespace modsynth {

class GraphPool {
 public:
  static constexpr int kMaxVoices = 64;
  static constexpr int kMaxParts = 8;       // codes 0..7 are part buses
  static constexpr int kEditCap = 256;      // pending edit records per voice
  GraphPool();
  ~GraphPool();

  // The audio the voices play, by id. The control thread puts a clip here
  // before the first graph that names it (the page sends it once).
  BufferStore &buffers() { return store_; }

  // Control thread. Parses `prog` into a free slot and schedules it to start at
  // engine frame `startFrame`. Returns a handle; -1 if the program is refused
  // or every slot is busy (the note is dropped, and counted); -2 if it names a
  // buffer id the store does not have (unknownBuffer() says which, so the page
  // can send that clip again and retry).
  int begin(const double *prog, size_t len, double timeBase, uint64_t startFrame);

  // Control thread (the same one as begin). Queues the recorder's increments
  // for a voice already begun; their times are in the recorder's domain and
  // are re-based with the voice's own timeBase. False if the handle is stale
  // (the voice finished) or the voice's queue is full.
  bool edit(int handle, const double *inc, size_t len);

  // Render thread. Adds `frames` of every playing voice into busL[part] /
  // busR[part], starting at the block's engine frame `frame0`. A bus pointer
  // may be null (that part's voices are skipped). `touched[part]`, if given, is
  // set for every part a voice wrote into this block, so the host knows which
  // parts have something to run through their strip and mõdFX.
  void render(uint64_t frame0, int frames, float *const *busL, float *const *busR, bool *touched = nullptr);

  int unknownBuffer() const { return unknownBuf_.load(std::memory_order_relaxed); }
  int active() const;                       // voices playing or waiting to start
  uint64_t dropped() const { return dropped_.load(std::memory_order_relaxed); }
  uint64_t lateEdits() const { return lateEdits_.load(std::memory_order_relaxed); }

 private:
  struct Slot;
  std::unique_ptr<Slot[]> slots_;
  BufferStore store_;
  std::atomic<int> unknownBuf_{-1};
  std::atomic<uint64_t> dropped_{0}, lateEdits_{0};
};

}  // namespace modsynth
