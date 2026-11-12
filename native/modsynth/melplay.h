// What the engine does with a melody generator note: the voice for it from the bank, patched for its note, level, accent and length (and, for a note that slides in, the note it
// slides from and how long the slide takes), begun in the pool (docs/native-scheduling.md, slice 3, part three). The voices overlap and nothing cuts the note before, so there is
// no history; a chord on a step is several events at the same frame, each its own voice.
//
// The page applies the slide to the voice's oscillators as a detune ramp from (from - note) hundred cents, and not at all for a leap of more than 24 semitones
// (_melGlideApply), so a slide of more than that is played as a plain note, as the page plays it.
//
// Control-side (the sequencer thread): patching allocates and begin() parses a program.
#pragma once
#include <cmath>
#include <cstdint>
#include <functional>

#include "melcore.h"
#include "voicebank.h"
#include "synthseq.h"

namespace modsynth {

struct MelPlayer {
  static constexpr int kPart = 6;          // the melody generator's bank part code (0 drum, 1 aux, 2 bass, 3 chord, 4 chord held, 5 arp)
  static constexpr int kGlideLane = 16;    // the notes that slide in; the plain notes' regimes of length are lanes 0 to 7
  static constexpr int kRegimes = 8;
  double sr = 48000;
  SynthLane synth;
  DrumBank *bank = nullptr;     // shared with the drum player: one bank
  int kit = 0;                  // the bank's code for the melody voice that is on
  std::function<int(const double *, size_t, double, uint64_t)> begin;
  uint64_t notes = 0, slides = 0, voices = 0, misses = 0, refused = 0, lateStarts = 0;
  int lastMissLane = -1;

  void reset() { synth.reset(); notes = slides = voices = misses = refused = lateStarts = 0; }

  // The entry for a note: the regime of length that holds `durSec` (ordered by regime, shortest first, each valid up to its durMax).
  static const BankEntry *pick(const DrumBank &bank, int kit, bool slide, double durSec, int midi = -1) {
    // Piano harmonics and sampled instruments change graphs at note boundaries.
    // A pitch-specific bank must never reuse a neighbouring note's graph.
    const int base = midi >= 0 && bank.find(kPart, kit, 256 + midi * 32) ? 256 + midi * 32 : 0;
    for (int r = 0; r < kRegimes; r++) {
      const BankEntry *e = bank.find(kPart, kit, base + (slide ? kGlideLane : 0) + r);
      if (!e) return nullptr;
      if (durSec < e->durMax) return e;
    }
    return nullptr;
  }

  void play(const MelEvent &e, double now) {
    if (bank) if (const BankEntry *p = bank->find(kPart, kit, -1); p && p->processor) {
      notes++;
      if (synth.play(e.midi, e.frameExact, e.durFrames / sr, now)) voices++; else refused++;
      // The page's stand-in detune never reaches a Processor. Its internal
      // portamento still follows the patch; no external glide is invented here.
      return;
    }
    if (!begin || !bank) return;
    bool slide = e.glideFrom >= 0 && std::abs(e.glideFrom - e.midi) <= 24;
    notes++;
    const double durSec = e.durFrames / sr;
    const BankEntry *en = pick(*bank, kit, slide, durSec, e.midi);
    // A bank with no sliding voice plays the plain one rather than nothing (the slide is a nicety; a missing note is a hole).
    if (!en && slide) en = pick(*bank, kit, false, durSec, e.midi);
    if (!en) { misses++; lastMissLane = slide ? kGlideLane : 0; return; }
    if (slide && en->from.empty()) slide = false;
    if (slide) slides++;
    PatchedVoice v;
    bank->patch(*en, e.vel, e.accent, (double)e.midi, e.frame, sr, (uint64_t)now, v, durSec, slide ? (double)e.glideFrom : -1, 1.0, 0.0, slide ? e.glideFrames / sr : 0.0);
    const int h = begin(v.prog.data(), v.prog.size(), v.timeBase, v.startFrame);
    if (h < 0) { refused++; return; }
    voices++;
    if ((double)v.startFrame + DrumBank::kLeadFrames > (double)e.frame + 128) lateStarts++;
  }
};

}  // namespace modsynth
