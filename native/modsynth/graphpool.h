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
// A full pool does not refuse a note. kMaxVoices is how many voices may be
// *sounding*; the pool has kSpare more slots than that so a new note always has
// somewhere to load. When a voice is due to start and kMaxVoices are already
// playing, the render thread picks one -- a voice already in its release first,
// then the quietest, then the oldest -- and fades it out over kFadeFrames while
// the new one starts. The control thread never touches a voice that is playing;
// the render thread chooses and acts, so nothing here locks or allocates.
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
  static constexpr int kMaxVoices = 96;     // voices sounding at once; past this the quietest is faded out
  static constexpr int kSpare = 16;         // extra slots: notes loading or waiting, and voices fading out
  static constexpr int kSlots = kMaxVoices + kSpare;
  static constexpr int kFadeFrames = 480;   // a stolen voice is ramped to nothing over 10 ms (48 kHz)
  static constexpr int kMaxParts = 8;       // codes 0..7 are part buses
  static constexpr int kMasterBus = 8;      // code 8: straight into the master (the click)
  static constexpr int kChordRoom = 9;      // code 9: what the chord voices send to the chord's own reverb
  static constexpr int kRoom = 10;          // code 10: what the other voices send to the shared reverb
  static constexpr int kBuses = 11;
  static constexpr int kEditCap = 256;      // pending edit records per voice
  GraphPool();
  ~GraphPool();

  // The audio the voices play, by id. The control thread puts a clip here
  // before the first graph that names it (the page sends it once).
  BufferStore &buffers() { return store_; }

  // Control thread. Parses `prog` into a free slot and schedules it to start at
  // engine frame `startFrame`. Returns a handle; -1 if the program is refused
  // or all kSlots are in use (the note is dropped, and counted -- with voices
  // stolen at kMaxVoices this means a burst of more than kSpare notes between
  // two blocks, not a full pool); -2 if it names a
  // buffer id the store does not have (unknownBuffer() says which, so the page
  // can send that clip again and retry).
  int begin(const double *prog, size_t len, double timeBase, uint64_t startFrame);

  // Control thread (the same one as begin). Queues the recorder's increments
  // for a voice already begun; their times are in the recorder's domain and
  // are re-based with the voice's own timeBase. False if the handle is stale
  // (the voice finished) or the voice's queue is full.
  bool edit(int handle, const double *inc, size_t len);

  // Control thread. The page's hardKillAll(at): every voice begun so far (not the ones begun after this call) that plays into one of the part buses in `mask` (bit
  // n = bus n) is faded to nothing over `fadeFrames` from engine frame `atFrame`, and one that has not started by then never does. How an ending's landing silences
  // what the band had committed while its own hit, begun just after, is left alone. False if the request queue is full.
  bool killParts(uint32_t mask, uint64_t atFrame, int fadeFrames = 1056);

  // Render thread. Adds `frames` of every playing voice into busL[code] /
  // busR[code], starting at the block's engine frame `frame0`. A bus pointer
  // may be null (that bus's voices are skipped). `touched[code]`, if given, is
  // set for every part a voice wrote into this block, so the host knows which
  // parts have something to run through their strip and mõdFX.
  void render(uint64_t frame0, int frames, float *const *busL, float *const *busR, bool *touched = nullptr);

  int unknownBuffer() const { return unknownBuf_.load(std::memory_order_relaxed); }
  int active() const;                       // voices playing or waiting to start
  uint64_t dropped() const { return dropped_.load(std::memory_order_relaxed); }
  uint64_t lateEdits() const { return lateEdits_.load(std::memory_order_relaxed); }
  // Why notes were dropped (dropped() is both): every slot was in use, or the
  // program was refused (it did not parse or was too big). And the most voices
  // that were playing at once, for telling a pool that is too small from voices
  // that never end.
  uint64_t droppedBusy() const { return droppedBusy_.load(std::memory_order_relaxed); }
  uint64_t droppedRefused() const { return droppedRefused_.load(std::memory_order_relaxed); }
  int peakActive() const { return peak_.load(std::memory_order_relaxed); }
  // Voices faded out to make room for a note that was due while kMaxVoices were
  // already sounding. Zero is a pool that was never full.
  uint64_t stolen() const { return stolen_.load(std::memory_order_relaxed); }

 private:
  struct Slot;
  std::unique_ptr<Slot[]> slots_;
  BufferStore store_;
  std::atomic<int> unknownBuf_{-1};
  struct Kill { uint32_t mask; uint64_t at; int fade; uint64_t limit; };
  static constexpr uint32_t kKillCap = 8;
  Kill kills_[kKillCap];
  std::atomic<uint32_t> killWr_{0}, killRd_{0};
  std::atomic<uint64_t> beginSeq_{0};
  std::atomic<uint64_t> dropped_{0}, lateEdits_{0}, droppedBusy_{0}, droppedRefused_{0}, stolen_{0};
  std::atomic<int> peak_{0};
};

}  // namespace modsynth
