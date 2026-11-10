// The native arpeggiator (docs/native-scheduling.md, slice 3): the page's scheduleArp, nextArpNote, scheduleArpNote and scheduleArpBlock as plain C++ with no iOS and no audio, so a
// Mac test can hold it to the page. It turns the arp's chord (the tones it is on) and its settings into ArpEvents: a note (the pattern's next tone, struck on the grid with the gate
// pattern's accent, the Feel's swing, the humanize, the velocity shape and the left-right pan), or for the Block pattern the whole chord struck at once. Who plays each event is
// the host's voice bank; this decides WHEN and WHICH.
//
// The grid. The arp runs on its own division of the beat (or on milliseconds in Free timing), anchored to the clock's epoch -- the drums' downbeat -- so a triplet arp is on the
// triplet lattice from the beat. Time is the tempo map's (tempomap.h): a step is a number of beats, so a tempo that moves moves the arp with the drums. The grid itself stays
// straight; swing and humanize only displace the note, so neither can accumulate into a drift. Rate motion (Accelerate, Decelerate, Swell) climbs a ladder of the dial's own rate
// doubled again and again, a rung lasting a whole number of beats from the epoch; the last note of a rung is shortened to land on its end.
//
// Randomness (Random, Weighted, Walk, humanize) comes from a native generator, which is not the page's Math.random (the owner accepted that); a test can hand it the page's own
// draws as a tape, in order, and then the lists are the same note for note.
//
// Control-side (the sequencer thread).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "seqcore.h"
#include "tempomap.h"

namespace modsynth {

enum ArpPattern { kArpUp = 0, kArpDown, kArpRand, kArpWeighted, kArpPedal, kArpWalk, kArpBlock, kArpBounce };
enum ArpVelShape { kArpFlat = 0, kArpCresc, kArpDecrsc, kArpHill, kArpValley };

struct ArpScore {
  int pattern = kArpUp;
  double div = 4;                // steps per beat (ARP_RATES[...].div); ignored in Free timing
  bool freeTiming = false; double freeSec = 0.15;
  double gate = 0.5;             // the Gate control: how much of a step the note lasts
  double maxDur = 2;             // the Decay control caps a note's length, seconds
  double swing = 0; bool swing8 = true;     // the Feel
  int velShape = kArpFlat;
  std::vector<int> gates;        // the gate pattern: 1 plays, 0 rests, one per step in turn
  std::vector<int> accents;      // ...and the steps of it that are accented
  std::vector<double> motion;    // the rungs' multipliers of the rate, in order; fewer than 2: no motion
  double motionHold = 2;         // beats a rung lasts
  Humanize hum;                  // the arp is humanized as the part "arp": partOff[0]
  int octaves = 1;               // the Octaves control (arpOcts): the chord's tones are repeated one and two octaves up (setArpChord)

  // [1, pattern, div, free, freeSec, gate, maxDur, swing, swing8, velShape, nGates, gates..., nAccents, accents..., nMotion, motion..., motionHold,
  //  hum.amt, timeMul, velMul, driftMul, maxMs, maxVel, maxDriftMs, arpOff, octaves]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr) {
    size_t k = 0;
    if (n < 12 || d[0] != 1) return false;
    ArpScore s;
    s.pattern = (int)d[1]; s.div = d[2]; s.freeTiming = d[3] != 0; s.freeSec = d[4]; s.gate = d[5]; s.maxDur = d[6]; s.swing = d[7]; s.swing8 = d[8] != 0; s.velShape = (int)d[9];
    k = 10;
    if (s.pattern < 0 || s.pattern > kArpBounce || s.velShape < 0 || s.velShape > kArpValley || !(s.div > 0)) return false;
    auto list = [&](std::vector<int> *vi, std::vector<double> *vd, size_t maxN) {
      if (k >= n) return false;
      const double c = d[k++];
      if (!(c >= 0 && c <= (double)maxN) || k + (size_t)c > n) return false;
      for (size_t i = 0; i < (size_t)c; i++) { if (vi) vi->push_back((int)d[k]); else vd->push_back(d[k]); k++; }
      return true;
    };
    if (!list(&s.gates, nullptr, 64) || !list(&s.accents, nullptr, 64) || !list(nullptr, &s.motion, 16)) return false;
    if (s.gates.empty() || k + 10 > n) return false;
    s.motionHold = d[k++];
    s.hum.amt = d[k]; s.hum.timeMul = d[k + 1]; s.hum.velMul = d[k + 2]; s.hum.driftMul = d[k + 3]; s.hum.maxMs = d[k + 4]; s.hum.maxVel = d[k + 5]; s.hum.maxDriftMs = d[k + 6];
    s.hum.partOff[0] = d[k + 7] != 0;
    s.octaves = std::max(1, std::min(3, (int)d[k + 8]));
    k += 9;
    *this = std::move(s);
    if (used) *used = k;
    return true;
  }
};

// What one step of the arp asks the host: a note (midi >= 0) or the whole chord at once (notes, midi == -1).
struct ArpEvent {
  double frameExact = 0;
  int64_t frame = 0;
  int midi = -1;                 // the tone, or -1 for a block
  std::vector<int> notes;        // a block's tones, low to high as given
  double durSec = 0;             // the gate
  double vel = 1, level = 1, pan = 0;     // how hard the step is struck (its accent, humanised); where it sits in the pattern's dynamic shape; left or right
  int gateIdx = 0;               // where in the gate pattern it was
};

// setArpChord: the chord the arp plays, from the root (MIDI, the live key change already added), a slash chord's bass (MIDI, or -1) and the chord's intervals: the bass note's
// interval leads the list, and the tones are repeated an octave and two octaves up with the Octaves control at 2 and 3.
inline std::vector<int> arpChordNotes(int rootM, int bassM, const std::vector<int> &ivs, int octaves) {
  std::vector<int> iv;
  if (bassM >= 0) iv.push_back(bassM - rootM);
  iv.insert(iv.end(), ivs.begin(), ivs.end());
  std::vector<int> out;
  for (int i : iv) out.push_back(rootM + i);
  if (octaves >= 2) for (int i : iv) out.push_back(rootM + i + 12);
  if (octaves >= 3) for (int i : iv) out.push_back(rootM + i + 24);
  return out;
}

class ArpSequencer {
 public:
  explicit ArpSequencer(double sampleRate = 48000.0) : sr_(sampleRate), own_(sampleRate) {}
  void setScore(const ArpScore &s) { score_ = s; }
  const ArpScore &score() const { return score_; }
  void setTempoMap(const TempoMap *m) { tmap_ = m; }
  void seed(uint64_t s) { rng_.seed(s); }
  // The page's Math.random draws, in order, in place of the generator (a test).
  void setRandomTape(std::vector<double> t) { rng_.setTape(std::move(t)); }

  // The chord the arp is on (setArpChord): its tones with the octaves already added. The pattern starts again from the first.
  void setNotes(std::vector<int> notes) { notes_ = std::move(notes); idx_ = 0; dir_ = 1; gateIdx_ = 0; }
  const std::vector<int> &notes() const { return notes_; }
  // A rest in the song (_playChartSlot2): the pattern starts again from the first tone and the first gate step; the chord is the same (the page's rest stops the chord part, not the arp).
  void restart() { idx_ = 0; dir_ = 1; gateIdx_ = 0; }

  // Begin with a step landing on `firstFrame`; `epoch` is the clock's beat 1 (the drums' downbeat), which the swing and the rate motion count from.
  void start(double firstFrame, double epoch) { next_ = firstFrame; epoch_ = epoch; running_ = true; idx_ = 0; dir_ = 1; gateIdx_ = 0; }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  double nextFrame() const { return next_; }

  // scheduleArp: every step due before `horizon`, in order, each handed to emit(ArpEvent). Returns how many steps the clock took.
  template <class Emit>
  int run(double horizon, Emit &&emit) {
    int fired = 0;
    if (!running_ || notes_.empty()) return 0;
    const TempoMap &tm = tmap_ ? *tmap_ : own_;
    const double beat0 = tm.beatAt(epoch_);
    while (next_ < horizon) {
      // Per note, not per call: with rate motion the step changes mid-horizon.
      double mul = 1, motEnd = 0; bool mot = motionAt(tm, beat0, next_, mul, motEnd);
      const double rate0 = score_.freeTiming ? 0 : score_.div;
      double stepFrames = score_.freeTiming ? score_.freeSec * sr_ / (mot ? mul : 1) : tm.span(next_, 1.0 / (score_.div * (mot ? mul : 1)));
      const double stepSec = stepFrames / sr_;
      const double noteDur = std::min(score_.maxDur, stepSec * score_.gate);
      const double sw = swingOffset(tm, beat0, next_, rate0 * (mot ? mul : 1));         // frames
      const double dur = sw > 0 ? std::min(noteDur, (stepSec - sw / sr_) * 0.95) : noteDur;
      if (score_.pattern == kArpBlock) {
        ArpEvent e; e.frameExact = next_ + sw; e.frame = (int64_t)std::llround(e.frameExact); e.notes = notes_; e.durSec = dur;
        emit(e);
        gateIdx_++;
      } else {
        int midi; double bounceV = 1.0;
        if (nextNote(midi, bounceV)) noteEvent(midi, next_ + sw, dur, bounceV, emit);
      }
      // The grid stays straight: only the note was displaced. A rung of rate motion ends on its beat.
      double nxt = next_ + stepFrames;
      if (mot && nxt > motEnd + 1e-6) nxt = motEnd;
      next_ = nxt;
      fired++;
    }
    return fired;
  }

 private:
  double draw() { return rng_.next(); }

  // arpMotionAt: which rung a moment is on and where it ends (frames).
  bool motionAt(const TempoMap &tm, double beat0, double t, double &mul, double &end) const {
    if (score_.freeTiming || score_.motion.size() < 2) return false;
    const double hold = score_.motionHold;     // beats
    const long seg = (long)std::floor((tm.beatAt(t) - beat0) / hold + 1e-6);
    const long n = (long)score_.motion.size();
    mul = score_.motion[(size_t)(((seg % n) + n) % n)];
    end = tm.frameAt(beat0 + (double)(seg + 1) * hold);
    return true;
  }

  // _arpSwingOffset, in frames: the Feel's swing on the step if it falls on the sixteenth grid and the rate is an eighth or a sixteenth.
  double swingOffset(const TempoMap &tm, double beat0, double t, double div) const {
    const double amt = score_.swing;
    if (!(amt > 0) || !(div == 2 || div == 4)) return 0;
    const double raw = (tm.beatAt(t) - beat0) * 4.0;
    const double i16 = std::round(raw);
    if (std::fabs(raw - i16) > 0.02) return 0;
    const int unit = score_.swing8 ? 4 : 2;
    const int s = (int)i16;
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (amt / 100.0) * tm.span(t, 0.25) * ((double)unit / 4.0);
  }

  // nextArpNote: the pattern's next tone (false: none). bounceV is the Bounce pattern's own level for it.
  bool nextNote(int &out, double &bounceV) {
    const int len = (int)notes_.size();
    if (!len) return false;
    switch (score_.pattern) {
      case kArpWeighted: {
        double total = 0; for (int i = 0; i < len; i++) total += (i == 0 || i == 2) ? 3 : 1;
        double r = draw() * total;
        for (int i = 0; i < len; i++) { r -= (i == 0 || i == 2) ? 3 : 1; if (r <= 0) { out = notes_[(size_t)i]; return true; } }
        out = notes_[0]; return true;
      }
      case kArpRand: out = notes_[(size_t)std::floor(draw() * len)]; return true;
      case kArpUp: out = notes_[(size_t)(idx_ % len)]; idx_++; return true;
      case kArpDown: out = notes_[(size_t)(((len - 1 - idx_ % len) % len + len) % len)]; idx_++; return true;
      case kArpPedal: {
        // Root on every other step, interleaved with rising chord tones
        if (len <= 1) { idx_++; out = notes_[0]; return true; }
        const int step = idx_ % (2 * (len - 1));
        idx_++;
        if (step % 2 == 0) out = notes_[0]; else out = notes_[(size_t)(1 + (step / 2) % (len - 1))];
        return true;
      }
      case kArpWalk: {
        // Organic random walk: drifts one or two with bias toward small steps
        out = notes_[(size_t)std::max(0, std::min(len - 1, idx_))];
        const double a = draw();
        int delta;
        if (a < 0.7) delta = draw() < 0.5 ? 1 : -1; else delta = draw() < 0.5 ? 2 : -2;
        idx_ = std::max(0, std::min(len - 1, idx_ + delta));
        return true;
      }
      default: {
        // bounce (and the page's "ud")
        out = notes_[(size_t)std::max(0, std::min(len - 1, idx_))];
        const int len2 = len;
        bounceV = (idx_ == 0 || idx_ == len2 - 1) ? 1.0 : 0.55 + 0.35 * (1 - std::fabs((idx_ / (double)(len2 - 1 ? len2 - 1 : 1)) - 0.5) * 2);
        idx_ += dir_;
        if (idx_ >= len) { idx_ = len - 2; dir_ = -1; }
        else if (idx_ < 0) { idx_ = 1; dir_ = 1; }
        return true;
      }
    }
  }

  // scheduleArpNote: the gate pattern, the humanize, the velocity shape, the pan.
  template <class Emit>
  void noteEvent(int midi, double at, double dur, double bounceV, Emit &emit) {
    const int g = (int)score_.gates.size();
    const int stepInPat = gateIdx_ % g;
    bool isAccent = false; for (int a : score_.accents) if (a == stepInPat) isAccent = true;
    const double velMult = isAccent ? 1.0 : 0.7;
    const bool on = !score_.hum.partOff[0];
    const double offT = Feel::humanT(rng_, score_.hum, sr_, on, stepInPat == 0, at);
    const double humanVel = Feel::humanV(rng_, score_.hum, on, isAccent);
    const int shapeLen = std::max<int>(1, (int)notes_.size());
    const double shapeP = shapeLen > 1 ? (double)(gateIdx_ % shapeLen) / (shapeLen - 1) : 0.5;
    double shape = 1.0;
    switch (score_.velShape) {
      case kArpCresc: shape = 0.55 + shapeP * 0.45; break;
      case kArpDecrsc: shape = 1.0 - shapeP * 0.45; break;
      case kArpHill: shape = 0.55 + std::sin(shapeP * M_PI) * 0.45; break;
      case kArpValley: shape = 1.0 - std::sin(shapeP * M_PI) * 0.45; break;
      default: break;
    }
    const int thisIdx = gateIdx_;
    gateIdx_++;
    if (!score_.gates[(size_t)stepInPat]) return;     // gate closed
    ArpEvent e;
    e.frameExact = at + offT * sr_; e.frame = (int64_t)std::llround(e.frameExact);
    e.midi = midi; e.durSec = dur; e.vel = velMult * humanVel;
    e.level = ((score_.pattern == kArpBounce) ? bounceV : 1.0) * shape;
    e.pan = (gateIdx_ % 2 ? 1 : -1) * 0.75;
    e.gateIdx = thisIdx;
    emit(e);
  }

  ArpScore score_;
  double sr_;
  TempoMap own_;
  const TempoMap *tmap_ = nullptr;
  Rng rng_;
  std::vector<int> notes_;
  int idx_ = 0, dir_ = 1, gateIdx_ = 0;
  double next_ = 0, epoch_ = 0;
  bool running_ = false;
};

}  // namespace modsynth
