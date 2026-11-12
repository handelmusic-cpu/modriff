// What the engine does with a bass note: the voice for it from the bank (the variant for whether it slides and whether it glides),
// patched for its note, level, accent, length and the note it glides from, and the cut of the note before it (docs/native-scheduling.md,
// slice 2). The bass is monophonic: a note that starts inside the tail of the last one fades it over 15 ms, which the page's voice
// code does to the previous note's gain (the edits the bank recorded once, voicebank.h `cutOps`).
//
// Control-side (the sequencer thread): patching allocates and begin() parses a program.
#pragma once
#include <cstdint>
#include <functional>
#include <vector>

#include "basscore.h"
#include "voicebank.h"
#include "synthseq.h"

namespace modsynth {

struct BassPlayer {
  double sr = 48000;
  SynthLane synth;
  DrumBank *bank = nullptr;     // shared with the drum player: one bank, the bass is part 2
  int kit = 0;                  // the bank's code for the bass voice that is on
  std::function<int(const double *, size_t, double, uint64_t)> begin;
  std::function<bool(int, const double *, size_t)> edit;
  uint64_t hits = 0, misses = 0, refused = 0, lateStarts = 0, cuts = 0;
  int lastMissLane = -1;

  void reset() { synth.reset(); synthPrevId_ = 0; hits = misses = refused = lateStarts = cuts = 0; prev_.valid = false; }

  static const BankEntry *pick(const DrumBank &bank, int kit, int midi, int lane) {
    // Reusing the neighbouring note can select another recording or root rate.
    const int base = bank.find(2, kit, 256 + midi * 8) ? 256 + midi * 8 : 0;
    return bank.find(2, kit, base + lane);
  }

  void play(const BassEvent &e, double now) {
    if (bank) if (const BankEntry *p = bank->find(2, kit, -1); p && p->processor) {
      if (synthPrevId_ && e.frameExact < synthPrevEnd_) { if (synth.release(synthPrevNote_, synthPrevId_, e.frameExact + 0.015 * sr)) cuts++; }
      synthPrevId_ = synth.play(e.midi, e.frameExact, e.durFrames / sr, now);
      synthPrevNote_ = e.midi; synthPrevEnd_ = e.frameExact + e.durFrames + (e.slide ? 0.15 : 0.06) * sr;
      if (synthPrevId_) hits++; else refused++;
      return;
    }
    if (!begin || !bank) return;
    const int lane = (e.slide ? 2 : 0) + (e.from >= 0 ? 1 : 0);
    const BankEntry *en = pick(*bank, kit, e.midi, lane);
    if (!en) { misses++; lastMissLane = lane; return; }
    // The cut goes first: the new voice is not the one it is aimed at.
    if (prev_.valid && e.frameExact < prev_.endExact && edit && !prev_.cutOps.empty()) {
      std::vector<double> ops = prev_.cutOps;
      const double t = ((double)e.frame - prev_.startFrame - DrumBank::kTimeBiasFrames) / sr;
      for (size_t k = 4; k < ops.size(); k += 6) ops[k] += t;
      if (edit(prev_.handle, ops.data(), ops.size())) cuts++;
    }
    PatchedVoice v;
    bank->patch(*en, e.vel, e.accent, (double)e.midi, e.frame, sr, (uint64_t)now, v, e.durFrames / sr, (double)e.from);
    const int h = begin(v.prog.data(), v.prog.size(), v.timeBase, v.startFrame);
    if (h < 0) { refused++; return; }
    hits++;
    if ((double)v.startFrame + DrumBank::kLeadFrames > (double)e.frame + 128) lateStarts++;
    // _blPrevEnd: the note's own stop (its length and a tail, longer when it slides on).
    prev_ = {true, h, (double)v.startFrame, e.frameExact + e.durFrames + (e.slide ? 0.15 : 0.06) * sr, en->cutOps};
  }

 private:
  double synthPrevId_ = 0, synthPrevNote_ = 0, synthPrevEnd_ = 0;
  struct Prev { bool valid = false; int handle = -1; double startFrame = 0, endExact = 0; std::vector<double> cutOps; };
  Prev prev_;
};

}  // namespace modsynth
