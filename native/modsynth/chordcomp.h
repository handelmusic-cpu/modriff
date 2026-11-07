// The chord comp's voice (docs/native-scheduling.md, slice 2): a chord played from a bank of one-note chords. The page's chord voice
// (index.html _webChordOn) is a sub oscillator under the root and one independent block per note, and the notes share only formulas of
// the note count n: a level factor, a pan, a strum offset. So the engine begins n + 1 voices from the one-note programs the page
// recorded (voicebank.h, part 3, one entry per pitch), each patched into its place:
//   - note i: the program for its pitch with the sub silenced; its tone's level slots times the factor
//     (i == 0 ? 1 : i == n-1 ? .62 : .78) * (n > 4 ? sqrt(4/n) : 1); its tone's time slots moved by the strum offset i * spread/(n-1)
//     less the strum lead (0.4 of the spread, so the weight of the chord lands on the beat); its panner at (i/(n-1)*2-1) * Width;
//   - the sub: the program for the ROOT's pitch with the tone silenced (a chord's root need not be one of its notes), at the chord's own
//     onset and at the chord's own level (the sub has no factor and no strum).
// A half is silenced by setting its sources' stop times to their start times: they never run.
//
// Control-side (the sequencer thread): patching allocates.
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>

#include "voicebank.h"

namespace modsynth {

struct ChordSettings {
  bool strum = false;      // Strum on
  double spread = 0;       // seconds across the chord, when it is on
  double width = 0;        // the mõdFX Width (the panner's reach); 0 leaves the notes in the middle
  bool sub = true;         // Sub on
};

struct ComposedVoice {
  PatchedVoice v;
  bool sub = false;
  int note = -1;           // the pitch, or -1 for the sub
  std::vector<double> cutOps;   // what the next chord does to this voice (the bank's, for the pitch it was made from)
  // A held chord's voice (hold in compose): where it begins in frames (the strum moves it), and what letting go of it does -- the bank's edits for
  // the pitch, less those aimed at the half this voice silenced, and the earliest moment they may act, seconds after it begins.
  double exact = 0, relMin = 0;
  std::vector<double> releaseOps;
};

class ChordComposer {
 public:
  // `notes` ascending, the slash bass first if there is one; `root` the MIDI note the root sounds at (the sub sits an octave under it,
  // or under the slash bass); `onsetExact` the chord's moment in frames. Returns false (and leaves `out` partial) if the bank lacks a pitch.
  // `hold`: the chord a gated hit plays (bank part 4: no decay, let go of by a release) in place of the decaying one (part 3); `durSec` is then unused.
  static bool compose(const DrumBank &bank, int kit, const std::vector<int> &notes, int rootNote, double vel, double durSec,
                      double onsetExact, const ChordSettings &cs, double sampleRate, uint64_t notBefore, std::vector<ComposedVoice> &out,
                      bool hold = false) {
    out.clear();
    const int part = hold ? 4 : 3;
    const int n = (int)notes.size();
    if (n < 1) return false;
    std::vector<double> offs((size_t)n, 0.0);
    if (cs.strum && cs.spread >= 0.005) for (int i = 0; i < n; i++) offs[(size_t)i] = i * (cs.spread / (n > 1 ? n - 1 : 1));
    const double lead = n > 1 ? offs[(size_t)n - 1] * 0.4 : 0;
    if (cs.sub) {
      // the sub is under the slash bass when there is one, else the root; the bank's entry for that pitch carries the sub of its own note
      const BankEntry *e = bank.find(part, kit, rootNote);
      if (!e) return false;
      ComposedVoice c; c.sub = true;
      bank.patch(*e, vel, false, (double)rootNote, (int64_t)std::floor(onsetExact), sampleRate, notBefore, c.v, durSec);
      addResidual(c.v, e->time, onsetExact - std::floor(onsetExact), sampleRate);
      for (const auto &s : e->toneStops) c.v.prog[(size_t)s.stop] = c.v.prog[(size_t)s.start];
      c.cutOps = cutWithout(e->cutOps, e->toneStops);
      c.exact = onsetExact; c.relMin = e->relMin; c.releaseOps = cutWithout(e->releaseOps, e->toneStops);
      out.push_back(std::move(c));
    }
    for (int i = 0; i < n; i++) {
      const BankEntry *e = bank.find(part, kit, notes[(size_t)i]);
      if (!e) return false;
      const double exact = onsetExact + (-lead + offs[(size_t)i]) * sampleRate;
      const int64_t base = (int64_t)std::floor(exact);
      ComposedVoice c; c.note = notes[(size_t)i];
      bank.patch(*e, vel, false, (double)notes[(size_t)i], base, sampleRate, notBefore, c.v, durSec);
      // the strum moves the tone's times, by the part of the offset the whole frame we began on does not carry
      const double extra = (exact - (double)base) / sampleRate;
      for (int idx : e->toneTime) c.v.prog[(size_t)idx] += extra;
      const double vl = (i == 0 ? 1.0 : i == n - 1 ? 0.62 : 0.78) * (n > 4 ? std::sqrt(4.0 / n) : 1.0);
      for (int idx : e->toneLevel) c.v.prog[(size_t)idx] *= vl;
      if (e->panSlot >= 0) {
        const double pan = n > 1 ? ((double)i / (n - 1)) * 2 - 1 : 0;
        c.v.prog[(size_t)e->panSlot] = std::max(-1.0, std::min(1.0, pan * cs.width));
      }
      for (const auto &s : e->subStops) c.v.prog[(size_t)s.stop] = c.v.prog[(size_t)s.start];
      c.cutOps = cutWithout(e->cutOps, e->subStops);
      c.exact = exact; c.relMin = e->relMin; c.releaseOps = cutWithout(e->releaseOps, e->subStops);
      out.push_back(std::move(c));
    }
    return true;
  }

 private:
  // The stop that ends the chord before is a stop time too: sent to a source this voice silenced (its stop set to its start), it would move
  // that stop later and the half that was meant to be silent would sound. So the voice's cut leaves the silenced sources alone.
  static std::vector<double> cutWithout(const std::vector<double> &ops, const std::vector<BankEntry::Src> &silenced) {
    std::vector<double> out;
    for (size_t k = 0; k + 5 < ops.size(); k += 6) {
      bool skip = false;
      for (const auto &s : silenced) if ((int)ops[k] == s.node && (int)ops[k + 1] == -1) skip = true;
      if (!skip) out.insert(out.end(), ops.begin() + (long)k, ops.begin() + (long)k + 6);
    }
    return out;
  }
  // The chord's onset need not be a whole frame: the part patch() cannot carry goes into the time slots, as it does for the tone.
  static void addResidual(PatchedVoice &v, const std::vector<int> &time, double frac, double sr) {
    if (frac == 0) return;
    for (int i : time) v.prog[(size_t)i] += frac / sr;
  }
};

}  // namespace modsynth
