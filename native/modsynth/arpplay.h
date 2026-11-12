// What the engine does with an arp event: the voice for it from the bank, patched for its tone, velocity, dynamic level and length, begun in the pool
// (docs/native-scheduling.md, slice 3). The arp is polyphonic -- its steps overlap and nothing cuts the note before -- so unlike the bass this keeps no
// history. A note is one voice; the Block pattern strikes every tone of the chord, 12 ms apart low to high as given, which is how the page's _webArpBlock
// lays them out, so each tone is the bank's one block voice patched for its place in the strum.
//
// Control-side (the sequencer thread): patching allocates and begin() parses a program.
#pragma once
#include <cmath>
#include <cstdint>
#include <functional>

#include "arpcore.h"
#include "voicebank.h"
#include "synthseq.h"

namespace modsynth {

struct ArpPlayer {
  static constexpr int kPart = 5;          // the arp's bank part code (0 drum, 1 aux, 2 bass, 3 chord, 4 chord held)
  static constexpr int kBlockLane = 16;    // the tone of a block, one entry per regime of length from here; the note's are the regimes from 0 (at most kRegimes)
  static constexpr int kRegimes = 8;
  static constexpr double kStrumSec = 0.012;
  double sr = 48000;
  SynthLane synth;
  DrumBank *bank = nullptr;     // shared with the drum player: one bank
  int kit = 0;                  // the bank's code for the arp voice that is on
  std::function<int(const double *, size_t, double, uint64_t)> begin;
  uint64_t notes = 0, blocks = 0, voices = 0, misses = 0, refused = 0, lateStarts = 0;
  int lastMissLane = -1;

  void reset() { synth.reset(); notes = blocks = voices = misses = refused = lateStarts = 0; }

  // The entry for a step: the regime of length that holds `durSec` (the entries are ordered by regime, shortest first, each valid up to its durMax).
  static const BankEntry *pick(const DrumBank &bank, int kit, bool block, double durSec, int midi = -1) {
    // Recorded instruments and harmonic-count changes need the graph for this
    // exact note before the envelope's length regime can be selected.
    const int base = midi >= 0 && bank.find(kPart, kit, 256 + midi * 32) ? 256 + midi * 32 : 0;
    for (int r = 0; r < kRegimes; r++) {
      const BankEntry *e = bank.find(kPart, kit, base + (block ? kBlockLane : 0) + r);
      if (!e) return nullptr;
      if (durSec < e->durMax) return e;
    }
    return nullptr;
  }

  void play(const ArpEvent &e, double now) {
    if (bank) if (const BankEntry *p = bank->find(kPart, kit, -1); p && p->processor) {
      const bool block = e.midi < 0;
      if (block) blocks++; else notes++;
      const size_t count = block ? e.notes.size() : 1;
      for (size_t i = 0; i < count; i++) {
        const double at = block ? e.frameExact + i * kStrumSec * sr : e.frameExact;
        const double dur = block ? e.durSec * 0.85 : e.durSec;
        if (synth.play(block ? e.notes[i] : e.midi, at, dur, now)) voices++; else refused++;
      }
      return;
    }
    if (!begin || !bank) return;
    const bool block = e.midi < 0;
    if (block) blocks++; else notes++;
    const size_t n = block ? e.notes.size() : 1;
    for (size_t i = 0; i < n; i++) {
      const int tone = block ? e.notes[i] : e.midi;
      const BankEntry *en = pick(*bank, kit, block, e.durSec, tone);
      if (!en) { misses++; lastMissLane = block ? kBlockLane : 0; continue; }
      const int64_t frame = block ? (int64_t)std::llround(e.frameExact + (double)i * kStrumSec * sr) : e.frame;
      PatchedVoice v;
      bank->patch(*en, block ? 1.0 : e.vel, false, (double)tone, frame, sr, (uint64_t)now, v, e.durSec, -1, block ? 1.0 : e.level, block ? 0.0 : e.pan);
      const int h = begin(v.prog.data(), v.prog.size(), v.timeBase, v.startFrame);
      if (h < 0) { refused++; continue; }
      voices++;
      if ((double)v.startFrame + DrumBank::kLeadFrames > (double)frame + 128) lateStarts++;
    }
  }
};

}  // namespace modsynth
