// What the engine does with a drum event: the bank's voice for it, patched and begun in the pool, after the hit's choke has
// shut what its group is still sounding (docs/native-scheduling.md, slice 1). It is the host thread's play() as a class of its
// own, so the host and the whole-score test (native/modsynth/scoretest.cpp) run the same code.
//
// Control-side (the sequencer thread): patching allocates and begin() parses a program; never the render callback.
#pragma once
#include <cstdint>
#include <functional>

#include "seqcore.h"
#include "voicebank.h"

namespace modsynth {

struct DrumPlayer {
  static constexpr int kGroups = 4;
  double sr = 48000;
  DrumBank bank;
  ChokeGroup groups[kGroups];
  // How to start a voice in the pool and how to change one already begun (the host: GraphPool::begin / edit under its lock).
  std::function<int(const double *, size_t, double, uint64_t)> begin;
  std::function<bool(int, const double *, size_t)> edit;
  uint64_t hits = 0, misses = 0, silent = 0, refused = 0, lateStarts = 0, cuts = 0, cutEdits = 0;
  int lastMissPart = -1, lastMissKit = -1, lastMissLane = -1;

  void resetCounters() {
    hits = misses = silent = refused = lateStarts = cuts = cutEdits = 0;
    for (auto &g : groups) g.clear();
  }

  // `now` is the render clock (engine frames): a voice can no longer be begun before it.
  void play(const DrumEvent &e, double now) {
    if (!begin) return;
    if (!(e.vel > 0)) { silent++; return; }        // the page plays nothing at a velocity of nothing either
    // A closed or pedal hat shuts what the group is still sounding, and does it first: this hit's own voice must not
    // be in the group yet, or it would choke its own tail (the page cuts before it registers, too). It cuts even when
    // the bank has no voice for it, as the page's choke does not depend on how the closing hat itself sounds.
    const int g = e.chokeGroup > 0 && e.chokeGroup <= kGroups ? e.chokeGroup - 1 : -1;
    if (g >= 0 && e.chokes && edit) {
      const int sent = groups[g].cut(e.frame, sr, edit);
      if (sent) { cuts++; cutEdits += (uint64_t)sent; }
    }
    const BankEntry *en = bank.find(e.part, e.kit, e.lane);
    if (!en) { misses++; lastMissPart = e.part; lastMissKit = e.kit; lastMissLane = e.lane; return; }
    PatchedVoice v;
    bank.patch(*en, e.vel, e.accent, e.pitch, e.frame, sr, (uint64_t)now, v);
    const int h = begin(v.prog.data(), v.prog.size(), v.timeBase, v.startFrame);
    if (h < 0) { refused++; return; }
    hits++;
    if (g >= 0 && !en->chokes.empty()) groups[g].add(h, v.startFrame, e.frame, *en, sr);
    if ((double)v.startFrame + DrumBank::kLeadFrames > (double)e.frame + 128) lateStarts++;   // began later than its lead allowed
  }
};

}  // namespace modsynth
