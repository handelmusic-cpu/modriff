// The native chord comp (docs/native-scheduling.md, slice 2): the chord rhythm's scheduler, a port of index.html scheduleChordRhythm, as plain
// C++ with no iOS and no audio so a Mac test can hold it to the page. A rhythm is a loop of sixteenths with hits at positions p (a ratchet or a
// triplet sits between sixteenths), each with a strength; every pass of the clock fires the hits whose sixteenth it is, at the step's time plus
// the hit's offset plus the swing. What each hit sounds is the chord player's (chordplay.h): the chord is the one the page voiced, handed over
// with the rhythm.
//
// A gated hit (a hit with a length in steps, and so every ratchet's re-strikes) is held and let go of at the end of its length: the chord player plays
// the held program (bank part 4) and sends each voice the release edits the bank holds.
//
// Not in it, said plainly (the page's score refuses what it cannot do and says so): the song's own comping (slice 4); the tap that started the rhythm (the page
// skips a re-strike within 60 ms of the finger, which the engine, started by a command, has not got); the voicing, which the page does
// (smartVoiceLead and Vary) and the engine plays as given.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "chordplay.h"

namespace modsynth {

struct ChordHit { double p = 0, v = 1, len = 0; };

struct ChordScore {
  int steps = 16;                // the rhythm's loop, in sixteenths
  double swing = -1;             // the rhythm's own swing percent, or -1 for the app's Feel
  double feelSwing = 0;          // the app's swing, percent
  bool swing8 = true;
  bool play = true;              // Chords are on
  std::vector<ChordHit> hits;
  ChordEvent chord;              // the chord, the level scale folded into `vel`, the length, the settings; onsetExact is filled per hit
  double velBase = 1;            // velScale(0): a hit's level is this times its strength

  // [1, steps, swing, feelSwing, swing8, play, velBase, durSec, strum, spread, width, sub, subNote, nNotes, notes..., nHits, (p, v, len) x n]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr) {
    size_t k = 0;
    if (n < 14 || d[0] != 1) return false;
    ChordScore s;
    s.steps = (int)d[1]; s.swing = d[2]; s.feelSwing = d[3]; s.swing8 = d[4] != 0; s.play = d[5] != 0; s.velBase = d[6];
    s.chord.durSec = d[7]; s.chord.settings.strum = d[8] != 0; s.chord.settings.spread = d[9]; s.chord.settings.width = d[10];
    s.chord.settings.sub = d[11] != 0; s.chord.subNote = (int)d[12];
    k = 13;
    const double nn = d[k++];
    if (s.steps < 1 || s.steps > 256 || !(nn >= 1 && nn <= 12) || k + (size_t)nn + 1 > n) return false;
    for (size_t i = 0; i < (size_t)nn; i++) s.chord.notes.push_back((int)d[k++]);
    const double nh = d[k++];
    if (!(nh >= 0 && nh <= 512) || k + (size_t)nh * 3 > n) return false;
    for (size_t i = 0; i < (size_t)nh; i++) { s.hits.push_back({d[k], d[k + 1], d[k + 2]}); k += 3; }
    *this = std::move(s);
    if (used) *used = k;
    return true;
  }
};

class ChordSequencer {
 public:
  explicit ChordSequencer(double sampleRate = 48000.0) : sr_(sampleRate) {}
  void setScore(const ChordScore &s) { score_ = s; if (step_ >= score_.steps) step_ = 0; }
  const ChordScore &score() const { return score_; }
  void setTempo(double bpm) { bpm_ = bpm; }
  // clockStepSec(): the chord rhythm does not take the drums' rate multiplier.
  double stepFrames() const { return (60.0 / bpm_ / 4.0) * sr_; }
  void start(double firstFrame, int step = 0) { next_ = firstFrame; step_ = step; running_ = true; }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  int step() const { return step_; }
  double nextFrame() const { return next_; }

  // scheduleChordRhythm: every step due before `horizon`, in order; each hit is handed to emit(ChordEvent).
  template <class Emit>
  int run(double horizon, Emit &&emit) {
    int fired = 0;
    while (running_ && next_ < horizon) {
      const double sd = stepFrames();
      const int k = step_ % score_.steps;
      if (score_.play) {
        const double amt = score_.swing >= 0 ? score_.swing : score_.feelSwing;
        const double sw = swingOffset(k, sd, amt);
        for (const ChordHit &h : score_.hits) {
          if ((int)std::floor(h.p + 1e-9) != k) continue;
          ChordEvent e = score_.chord;
          e.onsetExact = next_ + (h.p - k) * sd + sw;
          e.vel = std::max(0.0, std::min(1.0, score_.velBase * h.v));
          // A gated hit (len in steps) is held and let go of at the end of its gate (rhyStrike: lenSec = len * stepSec).
          if (h.len > 0) { e.hold = true; e.holdSec = h.len * sd / sr_; }
          emit(e);
        }
      }
      fired++;
      next_ += sd;
      step_++;
    }
    return fired;
  }

 private:
  // _sqSwingOffset(step, stepSec, amt), in frames.
  double swingOffset(int s, double sd, double amt) const {
    const int unit = score_.swing8 ? 4 : 2;
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (amt / 100.0) * sd * ((double)unit / 4.0);
  }

  ChordScore score_;
  double sr_;
  double bpm_ = 120;
  double next_ = 0;
  int step_ = 0;
  bool running_ = false;
};

}  // namespace modsynth
