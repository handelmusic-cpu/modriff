// What the engine does with a chord: its voices composed from the bank (chordcomp.h), begun in the pool, and the chord before it stopped.
// The page's _webChordStop holds every gain of the sounding chord at the new chord's moment, fades it over 22 ms and stops its sources;
// the bank holds those edits per pitch (voicebank.h `cutOps`, recorded once), so each of the previous chord's voices is sent its own.
//
// Control-side (the sequencer thread): composing allocates and begin() parses a program.
#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <vector>

#include "chordcomp.h"

namespace modsynth {

struct ChordEvent {
  std::vector<int> notes;      // ascending; a slash chord's bass first
  int subNote = 60;            // the note the sub sits an octave under: the slash bass, else the root
  double vel = 0.8;
  double durSec = 1;
  double onsetExact = 0;       // engine frames
  ChordSettings settings;
  // A gated hit: the chord is held (no decay of its own) and let go of holdSec after its onset, on the Release knob (the page's rhyStrike:
  // playChord sustained, then _releaseChordAt). durSec is then unused.
  bool hold = false;
  double holdSec = 0;
};

struct ChordPlayer {
  double sr = 48000;
  DrumBank *bank = nullptr;
  int kit = 0;                 // the bank's code for the chord voice that is on
  std::function<int(const double *, size_t, double, uint64_t)> begin;
  std::function<bool(int, const double *, size_t)> edit;
  uint64_t chords = 0, voices = 0, misses = 0, refused = 0, stops = 0, lateStarts = 0, releases = 0;

  void reset() { chords = voices = misses = refused = stops = lateStarts = releases = 0; prev_.clear(); }

  void play(const ChordEvent &e, double now) {
    if (!begin || !bank) return;
    std::vector<ComposedVoice> vs;
    if (!ChordComposer::compose(*bank, kit, e.notes, e.subNote, e.vel, e.durSec, e.onsetExact, e.settings, sr, (uint64_t)now, vs, e.hold)) { misses++; return; }
    // The chord before is stopped first: the new chord's voices are not the ones it is aimed at.
    if (edit) for (const Held &h : prev_) {
      if (h.cutOps.empty()) continue;
      std::vector<double> ops = h.cutOps;
      const double t = (e.onsetExact - h.startFrame - DrumBank::kTimeBiasFrames) / sr;
      for (size_t k = 4; k < ops.size(); k += 6) ops[k] += t;
      if (edit(h.handle, ops.data(), ops.size())) stops++;
    }
    prev_.clear();
    for (const ComposedVoice &c : vs) {
      const int hnd = begin(c.v.prog.data(), c.v.prog.size(), c.v.timeBase, c.v.startFrame);
      if (hnd < 0) { refused++; continue; }
      voices++;
      // Letting go: the page's release acts on every voice of the chord at the end of the gate, but never sooner than the attack (and 20 ms)
      // after that voice began -- the strum puts the voices at different moments, so each has its own.
      if (e.hold && edit && !c.releaseOps.empty()) {
        const double rel = std::max(e.onsetExact + e.holdSec * sr, c.exact + c.relMin * sr);
        std::vector<double> ops = c.releaseOps;
        const double t = (rel - (double)c.v.startFrame - DrumBank::kTimeBiasFrames) / sr;
        for (size_t k = 4; k < ops.size(); k += 6) ops[k] += t;
        if (edit(hnd, ops.data(), ops.size())) releases++;
      }
      prev_.push_back({hnd, (double)c.v.startFrame, c.cutOps});
    }
    chords++;
  }

 private:
  struct Held { int handle; double startFrame; std::vector<double> cutOps; };
  std::vector<Held> prev_;
};

}  // namespace modsynth
