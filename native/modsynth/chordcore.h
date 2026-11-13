// The native chord comp (docs/native-scheduling.md, slice 2): the chord rhythm's scheduler, a port of index.html scheduleChordRhythm, as plain
// C++ with no iOS and no audio so a Mac test can hold it to the page. A rhythm is a loop of sixteenths with hits at positions p (a ratchet or a
// triplet sits between sixteenths), each with a strength; every pass of the clock fires the hits whose sixteenth it is, at the step's time plus
// the hit's offset plus the swing. What each hit sounds is the chord player's (chordplay.h): the chord is the one the page voiced, handed over
// with the rhythm.
//
// A gated hit (a hit with a length in steps, and so every ratchet's re-strikes) is held and let go of at the end of its length: the chord player plays
// the held program (bank part 4) and sends each voice the release edits the bank holds.
//
// A live score carries raw intervals and voicing settings. The engine keeps
// voice-leading/Vary history and the tap timestamp, including the 60 ms flam
// guard. Explicit voiced scores remain useful for measured audio comparisons.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "chordplay.h"
#include "tempomap.h"
#include "voicing.h"

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
  bool liveVoice = false;
  int root = 60, slash = INT_MIN;
  std::vector<int> intervals;
  VoicingConfig vc;
  double tapMs = 0;
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
    if (k < n && d[k] == -8) {
      if (k + 2 > n || !std::isfinite(d[k+1])) return false;
      s.chord.rootNote = (int)d[k+1]; k += 2;
    }
    if(k<n && d[k]==-9) {
      if(k+9>n) return false;
      k++;s.liveVoice=true;s.root=(int)d[k++];s.slash=(int)d[k++];s.vc.style=(int)d[k++];s.vc.vary=d[k++]!=0;s.vc.autoInv=d[k++]!=0;s.vc.keyRoot=(int)d[k++];s.tapMs=d[k++];
      auto list=[&](std::vector<int>&v){if(k>=n || d[k]<1 || d[k]>24 || d[k]!=std::floor(d[k]))return false;size_t c=(size_t)d[k++];if(k+c>n)return false;v.clear();while(c--)v.push_back((int)d[k++]);return true;};
      if(!list(s.intervals) || !list(s.vc.modeSteps)) return false;
    }
    *this = std::move(s);
    if (used) *used = k;
    return true;
  }
};

class ChordSequencer {
 public:
  explicit ChordSequencer(double sampleRate = 48000.0) : sr_(sampleRate) {}
  void setScore(const ChordScore &s) { if(s.vc.autoInv!=score_.vc.autoInv)lead_.reset();if(s.root!=score_.root || s.intervals!=score_.intervals || s.tapMs!=score_.tapMs)lead_.fresh(); score_ = s; if (step_ >= score_.steps) step_ = 0; }
  void setTapFrame(double f) { tapFrame_=f; }
  const ChordScore &score() const { return score_; }
  void setTempo(double bpm) { bpm_ = bpm; }
  // clockStepSec(): the chord rhythm does not take the drums' rate multiplier.
  double stepFrames() const { return (60.0 / bpm_ / 4.0) * sr_; }
  // The tempo map shared with the other sequencers (tempomap.h); null: the constant tempo.
  void setTempoMap(const TempoMap *m) { tmap_ = m; }
  double stepAt(double frame) const { return tmap_ ? tmap_->span(frame, 0.25) : stepFrames(); }
  void start(double firstFrame, int step = 0) { next_ = firstFrame; step_ = step; running_ = true; lead_.reset(); }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  int step() const { return step_; }
  double nextFrame() const { return next_; }

  // scheduleChordRhythm: every step due before `horizon`, in order; each hit is handed to emit(ChordEvent).
  template <class Emit>
  int run(double horizon, Emit &&emit) {
    int fired = 0;
    while (running_ && next_ < horizon) {
      const double sd = stepAt(next_);
      const int k = step_ % score_.steps;
      if (score_.play) {
        const double amt = score_.swing >= 0 ? score_.swing : score_.feelSwing;
        const double sw = swingOffset(k, sd, amt);
        for (const ChordHit &h : score_.hits) {
          if ((int)std::floor(h.p + 1e-9) != k) continue;
          ChordEvent e = score_.chord;
          e.onsetExact = next_ + (h.p - k) * sd + sw;
          if(e.onsetExact>tapFrame_-.01*sr_ && e.onsetExact<tapFrame_+.06*sr_) continue;
          if(score_.liveVoice) {
            const auto rel=score_.vc.autoInv?lead_.smartVoiceLead(score_.root,score_.intervals,score_.slash):score_.intervals;
            const auto ivs=lead_.chordVoicing(score_.root,rel,score_.vc.style,score_.vc);
            const auto v=engineChord(score_.root,ivs,score_.slash);
            e.notes=v.notes;if(v.bass>=0)e.notes.insert(e.notes.begin(),v.bass);
            e.rootNote=v.root;e.subNote=v.bass>=0?v.bass:v.root;
          }
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

  const TempoMap *tmap_ = nullptr;
  ChordScore score_;
  double sr_;
  double bpm_ = 120;
  double next_ = 0;
  int step_ = 0;
  bool running_ = false;
  double tapFrame_ = -1e30;
  VoiceLead lead_;
};

}  // namespace modsynth
