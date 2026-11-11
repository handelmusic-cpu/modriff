// The native melody generator's scheduler (docs/native-scheduling.md, slice 3, part three): the page's window._mlScheduler as plain C++ with no iOS and no audio, so a Mac test can
// hold it to the page. It is the bass's grid branch (basscore.h) with the melody's differences:
//  - a step can hold a chord (the cell's own note and `more`): every note sounds at once, none slides, each turned down by the square root of how many there are;
//  - a single note slides from the note before it when that ended no earlier than a step ago (portamento in mono; melGlideFor's time for the leap, never longer than 0.8 of the note);
//  - Follow re-roots a note by the chord's ROOT (the bass uses its slash bass) into the melody's register, G3 to C6 widened to C3 to C7 around the note as written (_followRange);
//  - a locked phrase (PHRASE_LOCKS.mel) replaces the bar for its chord, and is moved by the capo, folded into G3..C6, and not re-rooted.
// It reads the same chord timeline as the bass (the song hands both the same windows), kept as a copy of its own so the two lock tables stay apart.
//
// Not in it, said plainly: the generator itself (the page supplies its pending lines),
// Pure tuning's cents, a mõdSynth voice (the Processor plays it), and the voice itself (melplay.h).
//
// Time is counted in frames, as doubles (see seqcore.h).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "basscore.h"
#include "melcell.h"
#include "seqcore.h"
#include "tempomap.h"

namespace modsynth {

struct MelScore {
  int steps = 16;
  double swing = 0;            // the drums' swing, percent
  bool swing8 = true;
  bool follow = true;          // mlFollow
  int gridRootPc = 0;          // the chord the line was written over
  std::vector<int> gridIntvs;  // ...and its tones as intervals from that root
  std::vector<int> scalePcs;   // _songScalePcs(): the key
  double vol = 0.7;            // mlVol
  Humanize hum;                // hum.partOff[0] is "the melody generator is left tight"
  bool glide = true;           // melGlideOn && melMono !== false: a single note slides from the one before
  double glideTime = 0.12;     // melGlideTime, seconds: what an octave costs
  bool poly = true;            // mlPolyAllowed(): a chord on a step sounds (explicit Mono plays the first note only)
  std::vector<MelCell> cells;  // the grid, `steps` of them

  // [1, steps, swing, swing8, follow, gridRootPc, nIntvs, intvs..., nScale, scale..., vol, hum.amt, timeMul, velMul, driftMul, maxMs, maxVel, maxDriftMs, melOff,
  //  glide, glideTime, poly, nCells, per cell: v, note, oct, len, accent, fix, vel, pr, nMore, (note, oct) x nMore]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr) {
    size_t k = 0;
    auto need = [&](size_t m) { return k + m <= n; };
    if (!need(7) || d[0] != 1) return false;
    k = 1;
    MelScore s;
    s.steps = (int)d[k++]; s.swing = d[k++]; s.swing8 = d[k++] != 0; s.follow = d[k++] != 0; s.gridRootPc = (int)d[k++];
    if (s.steps < 1 || s.steps > 256) return false;
    double c = d[k++];
    if (!(c >= 0 && c <= 12) || !need((size_t)c + 1)) return false;
    for (size_t i = 0; i < (size_t)c; i++) s.gridIntvs.push_back((int)d[k++]);
    c = d[k++];
    if (!(c >= 0 && c <= 12) || !need((size_t)c + 12)) return false;
    for (size_t i = 0; i < (size_t)c; i++) s.scalePcs.push_back((int)d[k++]);
    s.vol = d[k++];
    s.hum.amt = d[k++]; s.hum.timeMul = d[k++]; s.hum.velMul = d[k++]; s.hum.driftMul = d[k++];
    s.hum.maxMs = d[k++]; s.hum.maxVel = d[k++]; s.hum.maxDriftMs = d[k++];
    s.hum.partOff[0] = d[k++] != 0;
    s.glide = d[k++] != 0; s.glideTime = d[k++]; s.poly = d[k++] != 0;
    const double nc = d[k++];
    if (!(nc >= 0 && nc <= 256)) return false;
    for (size_t i = 0; i < (size_t)nc; i++) { MelCell m; if (!readMelCell(d, n, k, m)) return false; s.cells.push_back(std::move(m)); }
    *this = std::move(s);
    if (used) *used = k;
    return true;
  }
};

// A generated line waits for its chord boundary without resetting the step or slide history.
struct MelPending {
  bool have = false, hasAt = false;
  double at = 0;
  int steps = 16;
  std::vector<MelCell> cells;

  bool fromDoubles(const double *d, size_t n, double offset = 0) {
    MelPending p;
    if (!n) return false;
    if (d[0] != 1) { *this = p; return true; }
    if (n < 4 || !std::isfinite(d[2]) || !(d[3] >= 1 && d[3] <= 256)) return false;
    p.have = true; p.hasAt = d[1] != 0; p.at = d[2] + offset; p.steps = (int)d[3];
    size_t k = 4;
    for (int i = 0; i < p.steps; i++) {
      MelCell c;
      if (!readMelCell(d, n, k, c)) return false;
      p.cells.push_back(std::move(c));
    }
    *this = std::move(p);
    return true;
  }
};

// One note the melody generator plays: the fields of the page's modSend({kind:'note', part:'melgen', ...}), with the time in frames.
struct MelEvent {
  double frameExact = 0;
  int64_t frame = 0;
  int midi = 0;
  double durFrames = 0;
  double vel = 0;
  bool accent = false;
  int glideFrom = -1;          // the note it slides from, or -1
  double glideFrames = 0;      // ...and how long the slide takes
  int step = 0;
};

class MelSequencer {
 public:
  static constexpr int kLo = 55, kHi = 84;             // ML_GEN_LO / ML_GEN_HI: where a followed or locked line is folded
  static constexpr int kRollLo = 48, kRollHi = 96;     // ML_PR_LO / ML_PR_HI: what the roll lets you place
  static constexpr int kMaxVoices = 8;                 // ML_MAX_VOICES

  explicit MelSequencer(double sampleRate = 48000.0) : sr_(sampleRate), timeline_(sampleRate) {}

  void setScore(const MelScore &s) { score_ = s; if (step_ >= score_.steps) step_ = 0; }
  void setPending(const MelPending &p) { pending_ = p; }
  const MelScore &score() const { return score_; }
  ChordTimeline &timeline() { return timeline_; }
  const ChordTimeline &timeline() const { return timeline_; }
  void seed(uint64_t s) { rng_.seed(s); }
  // The page's Math.random draws, in order, in place of the generator (a test): the probability and the humanize draw from it.
  void setRandomTape(std::vector<double> t) { rng_.setTape(std::move(t)); }
  void setTempo(double bpm) { bpm_ = bpm; }
  void setRate(double mul) { rate_ = mul; }    // mlRateMul
  double stepFrames() const { return (60.0 / bpm_ / 4.0 * rate_) * sr_; }
  void setTempoMap(const TempoMap *m) { tmap_ = m; }
  double stepAt(double frame) const { return tmap_ ? tmap_->span(frame, 0.25 * rate_) : stepFrames(); }

  void start(double firstFrame, int step = 0) { pending_ = MelPending(); next_ = firstFrame; step_ = step; running_ = true; prevHave_ = false; }
  void stop() { running_ = false; }
  bool running() const { return running_; }
  int step() const { return step_; }
  double nextFrame() const { return next_; }

  // window._mlScheduler: fire everything due before `horizon`, in order. `following` is read once per call, as the page reads it.
  template <class Emit>
  int run(double horizon, Emit &&emit, double now = 0) {
    const bool following = score_.follow && !timeline_.empty();
    int fired = 0;
    while (running_ && next_ < horizon) {
      if (pending_.have && pending_.hasAt && next_ >= pending_.at - 0.002 * sr_) applyPending();
      const double sd = stepAt(next_);
      fireStep(step_, next_, sd, following, emit);
      fired++;
      next_ += sd;
      step_++;
      if (step_ >= score_.steps) {
        step_ = 0;
        if (pending_.have && (!pending_.hasAt || next_ >= pending_.at - 0.002 * sr_ || pending_.at <= now)) applyPending();
      }
    }
    return fired;
  }

 private:
  void applyPending() {
    score_.cells = std::move(pending_.cells);
    score_.steps = pending_.steps;
    pending_ = MelPending();
  }
  static int mod12(int x) { return ((x % 12) + 12) % 12; }
  // window.phraseFold(note, oct, shift, ML_GEN_LO, ML_GEN_HI): move by `shift` semitones and back into the register by one octave at most.
  static void foldNote(int &note, int &oct, int shift) {
    int abs = note + (oct + 1) * 12 + shift;
    if (abs > kHi) abs -= 12;
    if (abs < kLo) abs += 12;
    note = mod12(abs); oct = (int)std::floor(abs / 12.0) - 1;
  }
  double swingOffset(int s, double sd) const {
    const int unit = score_.swing8 ? 4 : 2;
    if ((((s % unit) + unit) % unit) != unit / 2) return 0;
    return (score_.swing / 100.0) * sd * ((double)unit / 4.0);
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
  // melGlideFor: how long a slide of `semis` takes, seconds -- what an octave costs, scaled by the leap and floored well above nothing.
  double glideFor(int semis) const {
    const double n = std::min(24, std::abs(semis));
    return score_.glideTime * (0.35 + 0.65 * n / 12.0);
  }

  template <class Emit>
  void fireStep(int s, double t, double sd, bool following, Emit &emit) {
    const double sw = swingOffset(s, sd);
    const ChordWindow *wf = following ? timeline_.windowFor(t + sw) : nullptr;
    const MelLock *lock = (wf && !wf->rest) ? timeline_.melLockFor(*wf) : nullptr;
    const MelCell *cell = nullptr;
    int lockShift = 0;
    if (lock) {
      const long li = (long)std::floor((t - wf->t) / sd + 0.5);       // Math.round
      if (li >= 0 && lock->steps > 0 && (size_t)(li % lock->steps) < lock->cells.size()) cell = &lock->cells[(size_t)(li % lock->steps)];
      lockShift = mod12(wf->rootPc - lock->rootPc);
    } else {
      cell = (size_t)(s % score_.steps) < score_.cells.size() ? &score_.cells[(size_t)(s % score_.steps)] : nullptr;
    }
    if (!cell || cell->v != 1) return;
    const double len = std::max(1.0, cell->len != 0 ? cell->len : 1.0);
    const double maxDur = sw > 0 ? (sd - sw) * 0.95 : sd * len * 0.92;
    const double dur = std::min(sd * len * 0.92, maxDur);
    // Where a written pitch sounds on this step (false: nowhere, over a rest). The main note and every note of a chord go through the same door.
    auto mapOne = [&](int pn, int po, int &outN, int &outO) {
      outN = pn; outO = po;
      if (lock) {
        if (lockShift) foldNote(outN, outO, lockShift);
      } else if (following && wf) {
        if (wf->rest) return false;
        if (cell->fix) return true;                           // pinned
        const int written = pn + (po + 1) * 12;
        const int ref = written + mod12(wf->rootPc - score_.gridRootPc);
        const int outPc = remapPc(pn, *wf);
        const int lo = std::max(kRollLo, std::min(kLo, written - 6)), hi = std::min(kRollHi, std::max(kHi, written + 6));
        const int abs = nearIn(outPc, ref, lo, hi);
        outN = mod12(abs); outO = (int)std::floor(abs / 12.0) - 1;
      }
      return true;
    };
    int mn, mo;
    if (!mapOne((int)cell->note, (int)cell->oct, mn, mo)) return;
    if (!Feel::stepProb(rng_, cell->pr)) return;
    const double at = t + sw + Feel::humanT(rng_, score_.hum, sr_, !score_.hum.partOff[0], s % 4 == 0, t + sw) * sr_;
    const double vel = score_.vol * Feel::humanV(rng_, score_.hum, !score_.hum.partOff[0], cell->accent) * (cell->vel > 0 && cell->vel < 100 ? cell->vel / 100.0 : 1.0);
    const bool chord = score_.poly && !cell->more.empty();
    const int nVoices = chord ? std::min<int>(kMaxVoices, 1 + (int)cell->more.size()) : 1;
    const int toM = mn + (mo + 1) * 12;
    int fromM = -1;
    if (nVoices == 1 && prevHave_ && !prevPoly_ && score_.glide && (t - prevEnd_) <= sd * 1.01) fromM = prevMidi_;
    const double vScale = 1.0 / std::sqrt((double)nVoices);
    MelEvent e;
    e.frameExact = at; e.frame = (int64_t)std::llround(at);
    e.midi = toM; e.durFrames = dur; e.vel = vel * vScale; e.accent = cell->accent; e.step = s;
    if (fromM >= 0 && fromM != toM) { e.glideFrom = fromM; e.glideFrames = std::min(glideFor(toM - fromM) * sr_, dur * 0.8); }
    emit(e);
    for (int xi = 0; xi < nVoices - 1; xi++) {
      int n2, o2;
      if (!mapOne(cell->more[(size_t)xi].first, cell->more[(size_t)xi].second, n2, o2)) continue;
      MelEvent x;
      x.frameExact = at; x.frame = e.frame; x.midi = n2 + (o2 + 1) * 12; x.durFrames = dur; x.vel = vel * vScale; x.accent = cell->accent; x.step = s;
      emit(x);
    }
    prevHave_ = true; prevMidi_ = toM; prevEnd_ = t + sd * len; prevPoly_ = nVoices > 1;
  }

  const TempoMap *tmap_ = nullptr;
  MelScore score_;
  MelPending pending_;
  ChordTimeline timeline_;
  Rng rng_;
  double sr_;
  double bpm_ = 120, rate_ = 1;
  double next_ = 0;
  int step_ = 0;
  bool running_ = false;
  // _mlPrev: the note before this one, for the slide
  bool prevHave_ = false, prevPoly_ = false;
  int prevMidi_ = -1;
  double prevEnd_ = 0;
};

}  // namespace modsynth
