// The native bass line (docs/native-scheduling.md, slice 2, part one): the chord timeline and the part of the page's
// window._blScheduler that follows it, as plain C++ with no iOS and no audio, so a Mac test can hold it to the page.
//
// What it is a port of (index.html): window._blOnChord (a chord window), _blWindowAt / _blWindowFor (which chord covers a
// moment), window._followRemapPc / _followRange / _followNearIn (re-rooting a written line onto the chord that is sounding),
// _blScalePcs' result (sent, not recomputed), and both branches of window._blScheduler: the grid (swing, Follow, a pinned step, the
// step's length and its cap, probability, humanize, and the slide memory blPlayNote keeps, `from`) and the walking line (Jazz style with
// Follow on: a quarter note a beat on the chart's own clock, snapped to the drums' bar line, whose notes are _blWalkNote's picks).
//
// A phrase lock (a line the player froze for one chord: window._blLockFor) replaces the bar for that chord's windows, in both branches.
//
// What it is not, said plainly (the score refuses what it cannot yet do, and names it):
//  - the page's generator and its timers: a line written ahead for the next chord (_blPregen) or while the pattern plays (blGenerate) is
//    written by the page, and handed over as a pending line (setPending) with the moment it takes over; the swap is the engine's;
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

// A bass grid cell: the page's {v, note, oct, len, slide, accent, fix, vel, pr}. v is 0 or 1.
struct BassCell {
  double v = 0, note = 0, oct = 3, len = 1, vel = 0, pr = 0;
  bool slide = false, accent = false, fix = false;
};

// A line the player froze for one chord (the page's PHRASE_LOCKS.bass[key]): `steps` cells, written over the chord whose root is rootPc.
struct PhraseLock {
  int steps = 16;
  int rootPc = 0;
  std::vector<BassCell> cells;
};

// A chord the song has committed to the clock (_blOnChord): when it starts and ends, and what it is.
struct ChordWindow {
  double t = 0, end = 0;      // engine frames
  bool rest = false;
  int rootPc = 0;
  int bassPc = -1;            // the slash bass, or -1
  int nextPc = -1;            // the next chord's bass or root, or -1
  std::vector<int> pcs;       // the chord's tones, root first
  int lock = -1;              // the index of its phrase lock in the timeline's table, or -1 (the page's _blLockFor, decided when it sent the chart)
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
  const PhraseLock *lockFor(const ChordWindow &w) const { return (w.lock >= 0 && (size_t)w.lock < locks_.size()) ? &locks_[(size_t)w.lock] : nullptr; }

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

  // The windows as the page sends them, in doubles: [n, per window: t, end, rest, rootPc, bassPc, nextPc, nPcs, pcs..., lock,
  //  nLocks, per lock: steps, rootPc, per cell: v, note, oct, len, slide, accent, fix, vel, pr]. Replaces the timeline.
  // `offset` is added to every window's start and end: the page sends them as frames from the line's start, and the engine puts the
  // start where its clock has it.
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr, double offset = 0);

 private:
  double sr_;
  std::vector<ChordWindow> w_;
  std::vector<PhraseLock> locks_;
};

struct BassScore {
  int steps = 16;
  double swing = 0;            // the drums' swing, percent: the bass rides it
  bool swing8 = true;
  bool follow = true;          // blFollow
  bool jazz = false;           // blGenStyle === 'jazz': with Follow on and a chart, the walking line replaces the grid
  bool twoFeel = false;        // blWalkFeel === 'two': half notes on beats 1 and 3
  int gridRootPc = 0;          // the chord the line was written over
  std::vector<int> gridIntvs;  // ...and its tones as intervals from that root
  std::vector<int> scalePcs;   // _blScalePcs(): the key
  double stepVel = 0.7;        // BL_STEP_VEL
  Humanize hum;                // the feel settings; hum.partOff[0] is "the bass is left tight"
  std::vector<BassCell> cells; // the grid, `steps` of them

  // [1, steps, swing, swing8, follow, gridRootPc, nIntvs, intvs..., nScale, scale..., stepVel,
  //  hum.amt, timeMul, velMul, driftMul, maxMs, maxVel, maxDriftMs, bassOff, jazz, twoFeel, nCells, per cell: v, note, oct, len, slide, accent, fix, vel, pr]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr);
};

// A line waiting to take over (the page's _blPendingGrid and _blPendingAt): the cells, and either the moment it takes over (a chord's start,
// _blPregen) or none, in which case it waits for the top of the loop.
struct BassPending {
  bool have = false;
  bool hasAt = false;
  double at = 0;               // engine frames
  int steps = 16;
  std::vector<BassCell> cells;

  // [1, hasAt, at, steps, per cell: v, note, oct, len, slide, accent, fix, vel, pr]; a first double that is not 1 clears (have = false).
  // `offset` is added to `at`: the page sends frames from the line's start.
  bool fromDoubles(const double *d, size_t n, double offset = 0) {
    BassPending p;
    if (n < 1) return false;
    if (d[0] != 1) { *this = p; return true; }
    if (n < 4) return false;
    p.have = true; p.hasAt = d[1] != 0; p.at = d[2] + offset; p.steps = (int)d[3];
    if (p.steps < 1 || p.steps > 256 || n < 4 + (size_t)p.steps * 9) return false;
    size_t k = 4;
    for (int i = 0; i < p.steps; i++) {
      BassCell b;
      b.v = d[k]; b.note = d[k + 1]; b.oct = d[k + 2]; b.len = d[k + 3]; b.slide = d[k + 4] != 0; b.accent = d[k + 5] != 0; b.fix = d[k + 6] != 0;
      b.vel = d[k + 7]; b.pr = d[k + 8]; k += 9;
      p.cells.push_back(b);
    }
    *this = std::move(p);
    return true;
  }
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
  // A line written ahead: it takes over when the scheduler reaches its moment (the first step at or after it, within the page's 2 ms), or at the
  // top of the loop when it has none. A later one replaces it, as the page's does.
  void setPending(const BassPending &p) { pend_ = p; }
  const BassPending &pending() const { return pend_; }
  const BassScore &score() const { return score_; }
  ChordTimeline &timeline() { return timeline_; }
  const ChordTimeline &timeline() const { return timeline_; }
  void seed(uint64_t s) { rng_.seed(s); }
  void setTempo(double bpm) { bpm_ = bpm; }
  void setRate(double mul) { rate_ = mul; }    // blRateMul
  double stepFrames() const { return (60.0 / bpm_ / 4.0 * rate_) * sr_; }

  // Begin with `step` landing on `firstFrame` (the page joins a running band at its bar line: seqEntryTime).
  void start(double firstFrame, int step = 0) { pend_ = BassPending(); next_ = firstFrame; step_ = step; running_ = true; prevSlide_ = false; prevMidi_ = -1; walkPrev_ = 0; walkNextT_ = 0; walkLastT_ = 0; walkHave_ = false; }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  int step() const { return step_; }
  double nextFrame() const { return next_; }

  // The walking line's random picks (_blWalkNote's Math.random) come from this tape when one is set, in order, instead of the
  // generator: for a test that wants the page's own draws, so the lists can be compared note for note.
  void setRandomTape(std::vector<double> t) { tape_ = std::move(t); tapePos_ = 0; }

  // window._blScheduler: fire everything due before `horizon`, in order. `now` is the render clock (the walking line skips a beat whose
  // moment has passed while it waited for its chord) and `drumBar` the drums' next bar line, or a negative number when they are not
  // playing (window._sqNextBar). `following` is read once per call, as the page reads it (a timeline that is empty when the pass begins
  // is not followed for the whole pass).
  template <class Emit>
  int run(double now, double horizon, double drumBar, Emit &&emit) {
    const bool following = score_.follow && !timeline_.empty();
    if (following && score_.jazz) return runWalk(now, horizon, drumBar, emit);
    return runGrid(now, horizon, following, emit);
  }
  template <class Emit>
  int run(double horizon, Emit &&emit) { return run(-1e18, horizon, -1.0, emit); }

 private:
  template <class Emit>
  int runGrid(double now, double horizon, bool following, Emit &emit) {
    int fired = 0;
    const double sd = stepFrames();
    while (running_ && next_ < horizon) {
      // A line written ahead for a chord takes over as the first step of that chord is reached, not at the next top of the loop.
      if (pend_.have && pend_.hasAt && next_ >= pend_.at - 0.002 * sr_) applyPending();
      fireStep(step_, next_, sd, following, emit);
      fired++;
      next_ += sd;
      step_++;
      if (step_ >= score_.steps) wrap(now);
    }
    return fired;
  }

  // ── the walking line ─────────────────────────────────────────────────────────────────────────────────────────────
  // _blNear: the octave of a pitch class nearest a reference note, inside the walk's range.
  static int nearM(int pc, int ref) {
    pc = mod12(pc);
    int best = -1, bd = 1 << 30;
    for (int m = kLo - (kLo % 12) - 12; m <= kHi + 12; m++) {
      if (m < kLo || m > kHi) continue;
      if (mod12(m) != pc) continue;
      const int d = std::abs(m - ref);
      if (d < bd) { bd = d; best = m; }
    }
    return best < 0 ? kLo + pc : best;
  }
  double draw() { if (tapePos_ < tape_.size()) return tape_[tapePos_++]; return rng_.next(); }
  bool inScale(int pc) const { for (int s : score_.scalePcs) if (s == pc) return true; return false; }
  static bool inPcs(const ChordWindow &w, int pc) { for (int p : w.pcs) if (p == pc) return true; return false; }

  // _blWalkNote: one quarter note of the line. Beat 1 is the chord's own root; the beat before a change approaches the next root from a
  // half step or a fifth; the beats between move by step through chord and scale tones, aimed at what comes next.
  int walkNote(const ChordWindow &w, int beatIdx, int beatsLeft) {
    const int prev = walkPrev_ ? walkPrev_ : nearM(w.rootPc, 40);
    if (beatIdx == 0) {
      const int basePc = w.bassPc >= 0 ? w.bassPc : w.rootPc;
      const int m = nearM(basePc, prev);
      walkPrev_ = m;
      return m;
    }
    const int target = w.nextPc >= 0 ? w.nextPc : w.rootPc;
    if (beatsLeft <= 1) {
      const int tgtM = nearM(target, prev);
      const int opts[4] = {tgtM - 1, tgtM + 1, tgtM - 7, tgtM + 5};
      std::vector<int> cands;
      for (int m : opts) if (m >= kLo && m <= kHi && std::abs(m - prev) <= 7) cands.push_back(m);
      if (cands.empty()) for (int m : opts) if (m >= kLo && m <= kHi) cands.push_back(m);
      const int pickA = !cands.empty() ? cands[(size_t)(int)(draw() * (double)cands.size())] : nearM((target + 11) % 12, prev);
      walkPrev_ = pickA;
      return pickA;
    }
    const int dir = nearM(target, prev) >= prev ? 1 : -1;
    std::vector<int> pool;
    for (int d = 1; d <= 4; d++) {
      const int up = prev + d * dir;
      if (up < kLo || up > kHi) continue;
      const int pc = mod12(up);
      int weight = inPcs(w, pc) ? 4 : (inScale(pc) ? 2 : 0);
      if (d > 2) weight = std::max(0, weight - 1);
      for (int k = 0; k < weight; k++) pool.push_back(up);
    }
    if (pool.empty()) {
      for (int pc : w.pcs) { const int mm = nearM(pc, prev); if (mm != prev) pool.push_back(mm); }
    }
    const int out = !pool.empty() ? pool[(size_t)(int)(draw() * (double)pool.size())] : prev;
    walkPrev_ = out;
    return out;
  }

  // The walking branch of window._blScheduler. A walking line is quarter notes by definition, so the grid's rhythm does not apply; it
  // runs on the chord windows' own clock and re-anchors to each new chord's downbeat, snapped UP onto the drums' bar line while they
  // run (never back: a rewind would re-fire committed notes).
  template <class Emit>
  int runWalk(double now, double horizon, double drumBar, Emit &emit) {
    const double sd = stepFrames();
    const double beat = sd * 4;
    auto snap = [&](double t, double anchor, bool haveAnchor) {
      const bool useBar = drumBar >= 0;
      if (!useBar && !haveAnchor) return t;
      const double a = useBar ? drumBar : anchor;
      double out = a + std::ceil((t - a) / beat - 0.02) * beat;
      // A chord tapped just after a beat pulls the walk back to the tap, and the snap would land it on that same beat again.
      while (walkLastT_ != 0 && out < walkLastT_ + beat * 0.5) out += beat;
      return out;
    };
    const std::vector<ChordWindow> &ws = timeline_.windows();
    if (walkNextT_ != 0 && walkNextT_ < now - beat) walkNextT_ = 0;
    if (walkNextT_ == 0) {
      const ChordWindow *w0 = ws.empty() ? nullptr : &ws[0];
      walkNextT_ = (w0 && w0->t > now) ? w0->t : now;
      const ChordWindow *wNow = timeline_.windowAt(walkNextT_);
      const bool have = wNow || w0;
      walkNextT_ = snap(walkNextT_, wNow ? wNow->t : (w0 ? w0->t : 0), have);
    }
    int guard = 0;
    while (walkNextT_ < horizon && guard++ < 256) {
      const ChordWindow *wq = timeline_.windowAt(walkNextT_);
      if (!wq) break;                               // past the last chord the song has committed: pick it up on a later pass
      if (!(walkHave_ && walkWin_.t == wq->t && walkWin_.end == wq->end && walkWin_.rootPc == wq->rootPc && walkWin_.bassPc == wq->bassPc)) {
        walkWin_ = *wq; walkHave_ = true;
        if (wq->t >= walkNextT_ - beat * 0.5) walkNextT_ = wq->t;
        const double snapped = snap(walkNextT_, wq->t, true);
        if (std::fabs(snapped - walkNextT_) > 0.001 * sr_) { walkNextT_ = snapped; continue; }
      }
      if (walkNextT_ >= horizon) break;
      if (walkNextT_ < now) { walkNextT_ += beat; continue; }       // a beat that passed while it waited for its chord is skipped, never played late
      const double into0 = std::max(0.0, walkNextT_ - wq->t);
      const int beat0 = (int)std::llround(into0 / beat);
      // A chord with a locked phrase gets that phrase even under a walk: the beat is filled with the four sixteenths of the locked bar that
      // fall inside it, the walk's own note is not played, and the two-feel skip does not apply (the phrase carries its own rhythm).
      if (const PhraseLock *wl = wq->rest ? nullptr : timeline_.lockFor(*wq)) {
        const int wsh = mod12(wq->rootPc - wl->rootPc);
        for (int k4 = 0; k4 < 4; k4++) {
          const double lt = walkNextT_ + k4 * sd;
          if (lt < now || lt >= wq->end - 0.002 * sr_) continue;
          const long lidx = (long)std::floor((lt - wq->t) / sd + 0.5);
          if (lidx < 0 || wl->steps <= 0) continue;
          const size_t ci = (size_t)(lidx % wl->steps);
          if (ci >= wl->cells.size()) continue;
          const BassCell &lc = wl->cells[ci];
          if (lc.v != 1) continue;
          int note = (int)lc.note, oct = (int)lc.oct;
          if (wsh) foldNote(note, oct, wsh);
          if (!Feel::stepProb(rng_, lc.pr)) continue;       // a step short of its chance is a rest; the page leaves the slide memory alone here
          const double at = lt + Feel::humanT(rng_, score_.hum, sr_, !score_.hum.partOff[0], lidx % 4 == 0, lt) * sr_;
          const double vol = score_.stepVel * Feel::humanV(rng_, score_.hum, !score_.hum.partOff[0], lc.accent) * (lc.vel > 0 && lc.vel < 100 ? lc.vel / 100.0 : 1.0);
          BassEvent e;
          e.midi = note + (oct + 1) * 12;
          e.frameExact = at; e.frame = (int64_t)std::llround(at);
          e.durFrames = sd * std::max(1.0, lc.len != 0 ? lc.len : 1.0) * 0.92; e.vel = vol; e.accent = lc.accent; e.slide = lc.slide;
          e.from = (prevSlide_ && prevMidi_ >= 0 && prevMidi_ != e.midi) ? prevMidi_ : -1;
          e.step = step_;
          emit(e);
          prevMidi_ = e.midi; prevSlide_ = lc.slide;
        }
        walkLastT_ = walkNextT_;
        walkNextT_ += beat;
        continue;
      }
      if (score_.twoFeel && (beat0 % 2) != 0) { walkNextT_ += beat; continue; }
      if (!wq->rest) {
        const double into = std::max(0.0, walkNextT_ - wq->t);
        const int beatIdx = (int)std::llround(into / beat);
        const int beatsLeft = std::max(1, (int)std::llround((wq->end - walkNextT_) / beat));
        const int midi = walkNote(*wq, beatIdx, beatsLeft);
        const bool downbeat = beatIdx == 0;
        BassEvent e;
        const double at = walkNextT_ + Feel::humanT(rng_, score_.hum, sr_, !score_.hum.partOff[0], downbeat, walkNextT_) * sr_;
        e.midi = midi; e.frameExact = at; e.frame = (int64_t)std::llround(at);
        e.durFrames = score_.twoFeel ? beat * 1.88 : beat * 0.92;
        e.vel = score_.stepVel * Feel::humanV(rng_, score_.hum, !score_.hum.partOff[0], downbeat);
        e.accent = downbeat; e.slide = false; e.from = -1; e.step = step_;
        walkLastT_ = walkNextT_;
        emit(e);
        prevMidi_ = midi; prevSlide_ = false;
      }
      walkNextT_ += beat;
    }
    // Keep the step clock running so the playhead still sweeps the grid.
    int fired = 0;
    while (running_ && next_ < horizon) { next_ += sd; step_++; fired++; if (step_ >= score_.steps) wrap(now); }
    return fired;
  }

  // The top of the loop: the slide ends, and a waiting line lands -- unless it is held for a chord's start that has not come and is still ahead of
  // the clock (_blApplyPending: a target already behind the clock is stale and lands at once).
  void wrap(double now) {
    step_ = 0; prevSlide_ = false; prevMidi_ = -1;
    if (!pend_.have) return;
    if (pend_.hasAt && next_ < pend_.at - 0.002 * sr_ && pend_.at > now) return;
    applyPending();
  }
  // _blApplyPending: the waiting cells become the line.
  void applyPending() {
    score_.cells = pend_.cells; score_.steps = pend_.steps;
    if (step_ >= score_.steps) step_ = 0;
    pend_ = BassPending();
  }

  // _sqSwingOffset, in frames.
  double swingOffset(int s, double sd) const {
    const int unit = score_.swing8 ? 4 : 2;
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (score_.swing / 100.0) * sd * ((double)unit / 4.0);
  }

  static int mod12(int x) { return ((x % 12) + 12) % 12; }
  // window.phraseFold(note, oct, shift, BL_LO, BL_HI): move by `shift` semitones and back into the bass's register by one octave at most.
  static void foldNote(int &note, int &oct, int shift) {
    int abs = note + (oct + 1) * 12 + shift;
    if (abs > kHi) abs -= 12;
    if (abs < kLo) abs += 12;
    note = mod12(abs); oct = (int)std::floor(abs / 12.0) - 1;
  }

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
    // A locked phrase replaces the bar for this chord only, indexed from the chord's own downbeat (not the bar's): the figure starts where
    // the chord does however the clocks line up, and a chord longer than the phrase repeats it.
    const PhraseLock *lock = (wf && !wf->rest) ? timeline_.lockFor(*wf) : nullptr;
    const BassCell *cell = nullptr;
    int lockShift = 0;
    if (lock) {
      const long li = (long)std::floor((t - wf->t) / sd + 0.5);       // Math.round
      if (li >= 0 && lock->steps > 0 && (size_t)(li % lock->steps) < lock->cells.size()) cell = &lock->cells[(size_t)(li % lock->steps)];
      lockShift = mod12(wf->rootPc - lock->rootPc);
    } else {
      cell = (size_t)(s % score_.steps) < score_.cells.size() ? &score_.cells[(size_t)(s % score_.steps)] : nullptr;
    }
    if (cell && cell->v == 1) {
      const double len = std::max(1.0, cell->len != 0 ? cell->len : 1.0);
      const double maxDur = sw > 0 ? (sd - sw) * 0.95 : sd * len * 0.92;
      const double dur = std::min(sd * len * 0.92, maxDur);
      int note = (int)cell->note, oct = (int)cell->oct;
      if (lock) {
        // Stored at the chord's authored pitch, so the only move left is the capo.
        if (lockShift) foldNote(note, oct, lockShift);
      } else if (following && wf) {
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
  BassPending pend_;
  ChordTimeline timeline_;
  Rng rng_;
  double sr_;
  double bpm_ = 120, rate_ = 1;
  double next_ = 0;
  int step_ = 0;
  bool running_ = false;
  bool prevSlide_ = false;
  int prevMidi_ = -1;
  // the walking line's state: _blWalkPrev, _blWalkNextT, _blWalkWin, _blWalkLastT
  int walkPrev_ = 0;
  double walkNextT_ = 0, walkLastT_ = 0;
  ChordWindow walkWin_;
  bool walkHave_ = false;
  std::vector<double> tape_;
  size_t tapePos_ = 0;
};

}  // namespace modsynth
