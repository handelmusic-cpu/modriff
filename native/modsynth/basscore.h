// The native bass line (docs/native-scheduling.md, slice 2, part one): the chord timeline and the part of the page's
// window._blScheduler that follows it, as plain C++ with no iOS and no audio, so a Mac test can hold it to the page.
//
// What it is a port of (index.html): window._blOnChord (a chord window), _blWindowAt / _blWindowFor (which chord covers a
// moment), window._followRemapPc / _followRange / _followNearIn (re-rooting a written line onto the chord that is sounding),
// _blScalePcs' result (sent, not recomputed), and the grid branch of window._blScheduler: swing, Follow, a pinned step, the
// step's length and its cap, probability, humanize, and the slide memory blPlayNote keeps (`from`).
//
// What it is not, said plainly (the score refuses what it cannot yet do, and names it):
//  - the walking line (Jazz style with Follow on), which is a different scheduler with its own randomness;
//  - phrase locks (a line frozen per chord), and a line written ahead for the next chord (_blPregen / _blApplyPending), which
//    the page swaps in at the wrap: here a new score replaces the old one when it arrives;
//  - Pure tuning's cents (`tune`);
//  - the voice: who plays each BassEvent is the host's voice bank (not built yet).
//
// Time is counted in frames, as doubles, and never read from a wall clock (see seqcore.h). The page works in seconds; the
// arithmetic below is its arithmetic written in frames.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "seqcore.h"

namespace modsynth {

// A chord the song has committed to the clock (_blOnChord): when it starts and ends, and what it is.
struct ChordWindow {
  double t = 0, end = 0;      // engine frames
  bool rest = false;
  int rootPc = 0;
  int bassPc = -1;            // the slash bass, or -1
  int nextPc = -1;            // the next chord's bass or root, or -1
  std::vector<int> pcs;       // the chord's tones, root first
};

// The page's _blChordWin: time-ordered windows, and the two lookups the bass and the melody share.
class ChordTimeline {
 public:
  explicit ChordTimeline(double sampleRate = 48000.0) : sr_(sampleRate) {}
  void setSampleRate(double sr) { sr_ = sr; }
  void clear() { w_.clear(); }
  bool empty() const { return w_.empty(); }
  size_t size() const { return w_.size(); }
  const std::vector<ChordWindow> &windows() const { return w_; }

  void push(const ChordWindow &w) { w_.push_back(w); if (w_.size() > 64) w_.erase(w_.begin(), w_.begin() + (long)(w_.size() - 64)); }
  // _blOnChord drops windows already behind the clock, but keeps one so a step scheduled a hair before the next chord still
  // finds its chord.
  void prune(double nowFrame) { while (w_.size() > 2 && w_[1].end < nowFrame) w_.erase(w_.begin()); }

  // _blWindowAt: windows overlap when a chord is cut short, and the chord sounding at t is the one that started last. The
  // page's 2 ms of slack is 0.002 * sampleRate frames.
  const ChordWindow *windowAt(double t) const {
    const ChordWindow *best = nullptr;
    const double slack = 0.002 * sr_;
    for (const ChordWindow &w : w_) if (t >= w.t - slack && t < w.end - slack && (!best || w.t > best->t)) best = &w;
    return best;
  }
  // _blWindowFor: past the last committed chord, carry it forward (a rest is not carried).
  const ChordWindow *windowFor(double t) const {
    if (const ChordWindow *w = windowAt(t)) return w;
    const ChordWindow *last = nullptr;
    for (const ChordWindow &c : w_) if (c.t <= t && (!last || c.t > last->t)) last = &c;
    return (last && !last->rest) ? last : nullptr;
  }

  // The windows as the page sends them, in doubles: [n, per window: t, end, rest, rootPc, bassPc, nextPc, nPcs, pcs...].
  // Replaces the timeline.
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr);

 private:
  double sr_;
  std::vector<ChordWindow> w_;
};

// A bass grid cell: the page's {v, note, oct, len, slide, accent, fix, vel, pr}. v is 0 or 1.
struct BassCell {
  double v = 0, note = 0, oct = 3, len = 1, vel = 0, pr = 0;
  bool slide = false, accent = false, fix = false;
};

struct BassScore {
  int steps = 16;
  double swing = 0;            // the drums' swing, percent: the bass rides it
  bool swing8 = true;
  bool follow = true;          // blFollow
  int gridRootPc = 0;          // the chord the line was written over
  std::vector<int> gridIntvs;  // ...and its tones as intervals from that root
  std::vector<int> scalePcs;   // _blScalePcs(): the key
  double stepVel = 0.7;        // BL_STEP_VEL
  Humanize hum;                // the feel settings; hum.partOff[0] is "the bass is left tight"
  std::vector<BassCell> cells; // the grid, `steps` of them

  // [1, steps, swing, swing8, follow, gridRootPc, nIntvs, intvs..., nScale, scale..., stepVel,
  //  hum.amt, timeMul, velMul, driftMul, maxMs, maxVel, maxDriftMs, bassOff, nCells, per cell: v, note, oct, len, slide, accent, fix, vel, pr]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr);
};

// One note the bass plays: the fields of the page's modSend({kind:'note', part:'bass', ...}), with the time in frames.
struct BassEvent {
  double frameExact = 0;
  int64_t frame = 0;
  int midi = 0;
  double durFrames = 0;
  double vel = 0;
  bool accent = false, slide = false;
  int from = -1;               // the note this one glides from, or -1
  int step = 0;
};

class BassSequencer {
 public:
  static constexpr int kLo = 33, kHi = 52;     // BL_LO / BL_HI: where a followed line is folded
  static constexpr int kRollLo = 28, kRollHi = 76;   // BL_PR_LO / BL_PR_HI: what the roll lets you place

  explicit BassSequencer(double sampleRate = 48000.0) : sr_(sampleRate), timeline_(sampleRate) {}

  void setScore(const BassScore &s) { score_ = s; if (step_ >= score_.steps) step_ = 0; }
  const BassScore &score() const { return score_; }
  ChordTimeline &timeline() { return timeline_; }
  const ChordTimeline &timeline() const { return timeline_; }
  void seed(uint64_t s) { rng_.seed(s); }
  void setTempo(double bpm) { bpm_ = bpm; }
  void setRate(double mul) { rate_ = mul; }    // blRateMul
  double stepFrames() const { return (60.0 / bpm_ / 4.0 * rate_) * sr_; }

  // Begin with `step` landing on `firstFrame` (the page joins a running band at its bar line: seqEntryTime).
  void start(double firstFrame, int step = 0) { next_ = firstFrame; step_ = step; running_ = true; prevSlide_ = false; prevMidi_ = -1; }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  int step() const { return step_; }
  double nextFrame() const { return next_; }

  // window._blScheduler's grid branch: fire every step due before `horizon`, in order. `following` is read once per call,
  // as the page reads it (a timeline that is empty when the pass begins is not followed for the whole pass).
  template <class Emit>
  int run(double horizon, Emit &&emit) {
    int fired = 0;
    const double sd = stepFrames();
    const bool following = score_.follow && !timeline_.empty();
    while (running_ && next_ < horizon) {
      fireStep(step_, next_, sd, following, emit);
      fired++;
      next_ += sd;
      step_++;
      if (step_ >= score_.steps) wrap();
    }
    return fired;
  }

 private:
  void wrap() { step_ = 0; prevSlide_ = false; prevMidi_ = -1; }

  // _sqSwingOffset, in frames.
  double swingOffset(int s, double sd) const {
    const int unit = score_.swing8 ? 4 : 2;
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (score_.swing / 100.0) * sd * ((double)unit / 4.0);
  }

  static int mod12(int x) { return ((x % 12) + 12) % 12; }

  // window._followRemapPc.
  int remapPc(int pc, const ChordWindow &w) const {
    pc = mod12(pc);
    const int iv = mod12(pc - score_.gridRootPc);
    int si = -1;
    for (size_t i = 0; i < score_.gridIntvs.size(); i++) if (score_.gridIntvs[i] == iv) { si = (int)i; break; }
    if (si >= 0 && !w.pcs.empty()) {
      if (si == 0 && w.bassPc >= 0) return w.bassPc;
      return w.pcs[(size_t)std::min<int>(si, (int)w.pcs.size() - 1)];
    }
    const int moved = (w.rootPc + iv) % 12;
    if (score_.scalePcs.empty()) return moved;
    for (int s : score_.scalePcs) if (s == moved) return moved;
    int best = score_.scalePcs[0], bd = 12;
    for (int s : score_.scalePcs) {
      const int d = std::min((moved - s + 12) % 12, (s - moved + 12) % 12);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  // window._followNearIn: the nearest octave of `pc` to `ref` inside [lo, hi]; ties go to the lower note, as the page's strict < does.
  static int nearIn(int pc, int ref, int lo, int hi) {
    pc = mod12(pc);
    int best = -1, bd = 1 << 30;
    for (int m = lo; m <= hi; m++) {
      if (mod12(m) != pc) continue;
      const int d = std::abs(m - ref);
      if (d < bd) { bd = d; best = m; }
    }
    return best < 0 ? lo : best;
  }

  template <class Emit>
  void fireStep(int s, double t, double sd, bool following, Emit &emit) {
    const double sw = swingOffset(s, sd);
    const ChordWindow *wf = following ? timeline_.windowFor(t + sw) : nullptr;
    const BassCell *cell = (size_t)(s % score_.steps) < score_.cells.size() ? &score_.cells[(size_t)(s % score_.steps)] : nullptr;
    if (cell && cell->v == 1) {
      const double len = std::max(1.0, cell->len != 0 ? cell->len : 1.0);
      const double maxDur = sw > 0 ? (sd - sw) * 0.95 : sd * len * 0.92;
      const double dur = std::min(sd * len * 0.92, maxDur);
      int note = (int)cell->note, oct = (int)cell->oct;
      if (following && wf) {
        if (wf->rest) return;                     // a rest in the chart: nothing sounds, and a slide is not ended by it
        if (!cell->fix) {
          const int basePc = wf->bassPc >= 0 ? wf->bassPc : wf->rootPc;
          const int ref = note + (oct + 1) * 12 + mod12(basePc - score_.gridRootPc);
          const int outPc = remapPc(note, *wf);
          const int written = note + (oct + 1) * 12;
          const int lo = std::max(kRollLo, std::min(kLo, written - 6)), hi = std::min(kRollHi, std::max(kHi, written + 6));
          const int abs = nearIn(outPc, ref, lo, hi);
          note = mod12(abs); oct = (int)std::floor(abs / 12.0) - 1;
        }
      }
      if (Feel::stepProb(rng_, cell->pr)) {
        const double at = t + sw + Feel::humanT(rng_, score_.hum, sr_, !score_.hum.partOff[0], s % 4 == 0, t + sw) * sr_;
        const double vol = score_.stepVel * Feel::humanV(rng_, score_.hum, !score_.hum.partOff[0], cell->accent) * (cell->vel > 0 && cell->vel < 100 ? cell->vel / 100.0 : 1.0);
        BassEvent e;
        e.midi = note + (oct + 1) * 12;
        e.frameExact = at; e.frame = (int64_t)std::llround(at);
        e.durFrames = dur; e.vel = vol; e.accent = cell->accent; e.slide = cell->slide;
        e.from = (prevSlide_ && prevMidi_ >= 0 && prevMidi_ != e.midi) ? prevMidi_ : -1;
        e.step = s;
        emit(e);
        prevMidi_ = e.midi; prevSlide_ = cell->slide;
      } else prevSlide_ = false;                  // a step that comes up short of its chance is a rest, and a rest ends a slide
    } else prevSlide_ = false;
  }

  BassScore score_;
  ChordTimeline timeline_;
  Rng rng_;
  double sr_;
  double bpm_ = 120, rate_ = 1;
  double next_ = 0;
  int step_ = 0;
  bool running_ = false;
  bool prevSlide_ = false;
  int prevMidi_ = -1;
};

}  // namespace modsynth
