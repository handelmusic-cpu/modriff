// The native sequencer core (docs/native-scheduling.md, slice 1): the part of the page's drum scheduler that
// decides WHEN, as plain C++ with no iOS and no audio in it, so a Mac test can hold it to the page.
//
// What it is a port of (index.html): sqSd (the step length), _sqSwingOffset, sqFireStep / _sqFireLayer
// (both layers, humanize, probability, tuplet cover), sqPlayCell (flam, ratchet, tuplet) and the step / bar
// bookkeeping of window._sqScheduler. What it is not: the voices. It turns a score into DrumEvents (the same
// fields the page's modEngine.send({kind:'hit'}) carries, with the time in engine frames); who plays each
// event is the host's voice bank.
//
// Time is counted in frames, as doubles, and is never read from a wall clock. `frameExact` is the
// event's moment before rounding; `frame` is the frame the host starts it on (round to nearest). The page
// works in seconds, so the arithmetic below is its arithmetic written in frames: a test compares the two
// (tests/seq/drumgrid.test.js) at 1e-5 of a frame.
//
// Randomness (probability, humanize) comes from a native generator, which is not the page's Math.random
// (the owner accepted that, docs/native-scheduling.md). Everything else is deterministic and is the same
// numbers the page makes.
//
// Real-time use: nothing here allocates once a score is set. run() takes its sink as a template argument so
// the host can write straight into its own ring.
#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace modsynth {

// A grid cell, field for field the page's {v, vel, p, r, rs, orn, pr}. v is 0 (off), 1 (hit) or 2 (accent).
// vel is a percent, 0 meaning "not set" (which the page reads as 100). p is the step's own pitch in
// semitones, r the ratchet count, rs how many steps a tuplet spreads over, orn 1 (flam) or 2 (drag),
// pr the probability in percent (0, or 100 and over, mean always).
struct DrumCell {
  double v = 0, vel = 0, p = 0, r = 1, rs = 1, orn = 0, pr = 0;
};

struct DrumLane {
  double gain = 0.8;       // sqGv: the lane's fader
  double pitch = 0;        // sqGp: the lane's tune, semitones
  bool play = true;        // the kit has a voice on this lane (track.play)
  int chokeGroup = 0;      // _trackChoke: 0 none, 1 the hats
  bool chokes = false;     // a closed or pedal hat shuts the group, an open one only rings
  std::vector<DrumCell> cells;   // the lane's row; a step past its end is empty
};

struct DrumLayer {
  bool on = false;         // the layer's own switch (the Kit or the Aux Perc layer)
  int part = 0;            // 0 the kit's channel ('drum'), 1 the Aux layer ('auxperc')
  int kit = 0;             // index into the score's kit table: which machine's lanes these are
  std::vector<DrumLane> lanes;
};

// Settings > Humanize, as _humanT / _humanV read it. `partOff` is the page's humanOff list, per layer.
struct Humanize {
  double amt = 0, timeMul = 1, velMul = 1, driftMul = 0.5;
  double maxMs = 14, maxVel = 0.28, maxDriftMs = 18;
  bool partOff[2] = {false, false};
};

struct DrumScore {
  int steps = 16;          // sqSteps: the pattern's length
  double swing = 0;        // sqSwing, percent
  bool swing8 = true;      // swing the eighths (the default) or the sixteenths
  int beatSteps = 4;       // meterBeatSteps()
  int barSteps = 16;       // meterStepsPerBar()
  bool drumsEnabled = true;   // the Drums switch: the Kit layer is silent without it, the Aux layer is not
  bool tupCover = true;    // a tuplet's span is its own (sqTupCover)
  Humanize hum;
  DrumLayer layers[2];

  // The flat doubles the page sends (and the test writes): see seqcore.cpp for the layout. Returns false
  // if the array is short or not a score of this version.
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr);
};

struct DrumEvent {
  double frameExact;       // when, in engine frames, unrounded
  int64_t frame;           // llround(frameExact)
  int part;                // 0 drum, 1 auxperc
  int kit;                 // the score's kit table index
  int lane;
  double vel;              // the hit message's `vel`
  bool accent;
  double pitch;            // semitones: the lane's tune plus the step's
  double dyn;              // how hard this stroke is within its step (a layered kit picks its recording by it)
  int chokeGroup;          // 0 none; else the group this hit belongs to
  bool chokes;             // ...and whether it shuts the group's ringing voices before it starts
  int step, bar;           // where in the pattern it was scheduled from (the step that fired it)
};

// A bar line the clock passed: the frame the new bar starts on (the page's _barAnnouncedT), and the bar's number.
struct BarMark { double frameExact; int64_t frame; int bar; };

class Rng {
 public:
  explicit Rng(uint64_t seed = 0x9E3779B97F4A7C15ull) { seed_(seed); }
  void seed(uint64_t s) { seed_(s); }
  // [0, 1), 53 bits: the same range as Math.random().
  double next() { return (double)(next64() >> 11) * (1.0 / 9007199254740992.0); }
  uint64_t next64() {   // xoshiro256**
    const uint64_t r = rotl(s_[1] * 5, 7) * 9;
    const uint64_t t = s_[1] << 17;
    s_[2] ^= s_[0]; s_[3] ^= s_[1]; s_[1] ^= s_[2]; s_[0] ^= s_[3]; s_[2] ^= t; s_[3] = rotl(s_[3], 45);
    return r;
  }
 private:
  static uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
  void seed_(uint64_t z) {   // splitmix64 fills the state
    for (int i = 0; i < 4; i++) {
      z += 0x9E3779B97F4A7C15ull;
      uint64_t x = z;
      x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
      x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
      s_[i] = x ^ (x >> 31);
    }
  }
  uint64_t s_[4];
};

// The frame-counted clock and the drum grid on it.
class DrumSequencer {
 public:
  explicit DrumSequencer(double sampleRate = 48000.0) : sr_(sampleRate) {}

  void setScore(const DrumScore &s) { score_ = s; if (step_ >= score_.steps) step_ = 0; }
  const DrumScore &score() const { return score_; }
  void seed(uint64_t s) { rng_.seed(s); }

  // Tempo, quarter-note BPM (the page's #bpm). Takes effect from the next step, as the page's does: a
  // step that has been fired keeps the length it was given.
  void setTempo(double bpm) { bpm_ = bpm; }
  // The drum rate multiplier (sqRateMul): 2 is twice as fast.
  void setRate(double mul) { rate_ = mul; }
  double tempo() const { return bpm_; }

  // sqSd() in frames: a sixteenth, at the tempo and rate.
  double stepFrames() const { return (60.0 / bpm_ / 4.0 * rate_) * sr_; }

  // Begin at pattern step 0, bar 0, with step 0 landing on `firstFrame`.
  void start(double firstFrame) { next_ = firstFrame; step_ = 0; bar_ = 0; running_ = true; }
  void stop() { running_ = false; }
  bool running() const { return running_; }

  // Where the clock is: the step the next call to run will fire, when it is due, and the bar it is in.
  int step() const { return step_; }
  int bar() const { return bar_; }
  double nextFrame() const { return next_; }

  // window._sqScheduler's loop: fire every step due before `horizon` (a frame), in order, and for each
  // one hand every event to emit(const DrumEvent&), then bar lines to bar(const BarMark&) as they pass.
  // Returns the number of steps fired.
  // `stepped(step, bar, frameExact)`, if given, hears of every step as it is fired, whether or not anything
  // sounds in it (the host's playhead mirror and its late-step count hang on it).
  template <class Emit, class Bar, class Stepped>
  int run(double horizon, Emit &&emit, Bar &&bar, Stepped &&stepped) {
    int fired = 0;
    while (running_ && next_ < horizon) {
      const double sd = stepFrames();
      stepped(step_, bar_, next_);
      fireStep(step_, next_, sd, emit);
      fired++;
      next_ += sd;
      step_++;
      if (step_ >= score_.steps) step_ = 0;   // the page also flushes its pattern queue here
      // A bar is the meter's, announced at its line: the pattern's wrap, or every barSteps inside a pattern that
      // is a whole number of bars (a 64-step pattern in 4/4 announces four times).
      const int mBar = score_.barSteps;
      const bool atBar = step_ == 0 || (mBar > 0 && score_.steps % mBar == 0 && step_ % mBar == 0);
      if (atBar) {
        bar_++;
        BarMark b{next_, (int64_t)std::llround(next_), bar_};
        bar(b);
      }
    }
    return fired;
  }

  template <class Emit, class Bar>
  int run(double horizon, Emit &&emit, Bar &&bar) {
    return run(horizon, emit, bar, [](int, int, double) {});
  }

 private:
  // _sqSwingOffset, in frames.
  double swingOffset(int s, double sd) const {
    const int unit = score_.swing8 ? 4 : 2;                      // sixteenth steps per swung pair
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (score_.swing / 100.0) * sd * ((double)unit / 4.0);
  }

  // _sqIsTup / _sqIsCovered: is step s inside the span of an earlier tuplet in this lane? A tuplet that is
  // itself covered does not count, so the first of a chain wins.
  static bool isTup(const DrumCell &c) { return c.v > 0 && c.r > 1 && c.rs > 1; }
  static const DrumCell *cellAt(const DrumLane &l, int s) { return (s >= 0 && s < (int)l.cells.size()) ? &l.cells[(size_t)s] : nullptr; }
  bool isCovered(const DrumLane &l, int s) const {
    if (!score_.tupCover) return false;
    for (int k = 1; k < 8 && s - k >= 0; k++) {
      const DrumCell *c = cellAt(l, s - k);
      if (c && isTup(*c) && c->rs > k && !isCovered(l, s - k)) return true;
    }
    return false;
  }

  // _stepProb: a probability strictly between 0 and 100 is a coin; anything else always plays.
  bool stepProb(const DrumCell &c) { const double p = c.pr; return !(p > 0 && p < 100) || rng_.next() * 100 < p; }

  // _humanT / _humanV. The drift is the page's two slow sines, read at the step's own time (the page reads its
  // audio clock when it schedules, a look-ahead earlier: the periods are 9.7 s and 23.1 s).
  double humanDrift(double atFrame) const {
    const double t = atFrame / sr_;
    const double w = std::sin(t * 2 * M_PI / 9.7 + 1.3) * 0.6 + std::sin(t * 2 * M_PI / 23.1 + 4.1) * 0.4;
    return w * (score_.hum.maxDriftMs / 1000.0) * score_.hum.amt * score_.hum.driftMul;
  }
  bool humanOn(int layer) const { return !score_.hum.partOff[layer]; }
  double humanT(bool downbeat, int layer, double atFrame) {
    if (score_.hum.amt <= 0 || !humanOn(layer)) return 0;
    const double span = (score_.hum.maxMs / 1000.0) * score_.hum.amt * score_.hum.timeMul * (downbeat ? 0.5 : 1);
    return (rng_.next() * 2 - 1) * span + humanDrift(atFrame);
  }
  double humanV(bool accent, int layer) {
    if (score_.hum.amt <= 0 || !humanOn(layer)) return 1.0;
    const double span = score_.hum.maxVel * score_.hum.amt * score_.hum.velMul * (accent ? 0.6 : 1);
    const double v = 1.0 - rng_.next() * span;
    return v > 0.35 ? v : 0.35;
  }

  template <class Emit>
  void fireStep(int s, double t, double sd, Emit &emit) {
    const double at = t + swingOffset(s, sd);
    for (int li = 0; li < 2; li++) {
      const DrumLayer &L = score_.layers[li];
      if (!L.on) continue;
      fireLayer(L, li, s, at, sd, emit);
    }
  }

  template <class Emit>
  void fireLayer(const DrumLayer &L, int li, int s, double at, double sd, Emit &emit) {
    // One timing offset for the whole step: the kit pushes or drags as one hand would. Exactly nothing at Amount 0.
    at += humanT(s % (score_.beatSteps > 0 ? score_.beatSteps : 1) == 0, li, at) * sr_;
    for (size_t ti = 0; ti < L.lanes.size(); ti++) {
      const DrumLane &lane = L.lanes[ti];
      const DrumCell *cell = cellAt(lane, s);
      if (!(cell && cell->v > 0 && !isCovered(lane, s) && stepProb(*cell))) continue;
      const double vol = lane.gain * humanV(cell->v == 2, li);
      playCell(L, li, (int)ti, lane, *cell, at, sd, vol, lane.pitch, s, emit);
    }
  }

  // sqPlayCell: a step's own pitch rides on the lane's; a flam or a drag sounds before the beat; a ratchet or
  // a tuplet spreads r hits over rs steps.
  template <class Emit>
  void playCell(const DrumLayer &L, int li, int ti, const DrumLane &lane, const DrumCell &cell, double t,
                double sd, double vol, double ps, int s, Emit &emit) {
    // The Drums switch is the Kit's: the Aux layer plays without it.
    const bool gated = li == 0 && !score_.drumsEnabled;
    if (cell.p != 0) ps = ps + cell.p;
    const bool ac = cell.v == 2;
    const double vel = (cell.vel != 0 ? cell.vel : 100.0) / 100.0, v = vol * vel;
    const double r = cell.r > 1 ? cell.r : 1;
    const double sub = sd * (cell.rs > 1 ? cell.rs : 1) / r;
    const int orn = (int)cell.orn;
    auto hit = [&](double tt, double vv, bool aa) {
      if (gated || !lane.play) return;
      DrumEvent e;
      e.frameExact = tt; e.frame = (int64_t)std::llround(tt);
      e.part = L.part; e.kit = L.kit; e.lane = ti;
      e.vel = vv; e.accent = aa; e.pitch = ps;
      e.dyn = vol > 0 ? vv / vol : 1;
      e.chokeGroup = lane.chokeGroup; e.chokes = lane.chokes;
      e.step = s; e.bar = bar_;
      emit(e);
    };
    const double sr = sr_;
    if (orn == 1) { hit(t - .030 * sr, v * .45, false); }
    else if (orn == 2) { hit(t - .060 * sr, v * .35, false); hit(t - .040 * sr, v * .50, false); hit(t - .020 * sr, v * .65, false); }
    for (int i = 0; i < (int)r; i++) hit(t + i * sub, i == 0 ? v : v * .75, ac && i == 0);
  }

  DrumScore score_;
  Rng rng_;
  double sr_;
  double bpm_ = 120, rate_ = 1;
  double next_ = 0;
  int step_ = 0, bar_ = 0;
  bool running_ = false;
};

}  // namespace modsynth
