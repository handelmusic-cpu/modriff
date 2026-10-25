// See mixfx.h. Read fxBuildChain / fxApplyChannel in index.html beside this:
// the stages below are that graph's, in its order, fed its finished numbers.
#include "mixfx.h"
#include "dspkit.h"
#include "modfxproc.h"

#include <cmath>
#include <cstring>

namespace modsynth {
namespace {

using namespace dsp;

constexpr int CHUNK = 32;          // control rate: smoothed values are re-derived this often
constexpr double FX_REV_SEC = 3.4; // the web chain's room impulse, and its return gain
constexpr double FX_REV_RET = 2.2;
constexpr double ISO_LO_HZ = 220, ISO_HI_HZ = 2600;
constexpr double FMT_Q = 9;

// The drive curve fxApplyChannel builds, x*(k+1)/(1+k|x|) with k = 90*amount,
// as a lookup the oversampler can use.
void driveCurve(Curve& c, double amount) {
  const double k = amount * 90;
  for (int i = 0; i < CURVE_N; i++) {
    const double x = (double)i / (CURVE_N - 1) * 2 - 1;
    c.t[i] = (float)(x * (k + 1) / (1 + k * std::fabs(x)));
  }
}

// Eight bar-long gate patterns, one bit per sixteenth: GATE_PATTERNS in
// index.html, copied. tests/modsynth/gatepat.test.js reads both and fails if
// either moves.
constexpr int GATE_PAT_COUNT = 8;
const unsigned char GATE_PATTERNS[GATE_PAT_COUNT][16] = {
  {1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0},
  {0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0},
  {1,0,1,1, 0,0,1,0, 1,0,1,1, 0,0,1,0},
  {1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0},
  {1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0},
  {1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1},
  {1,1,1,1, 1,1,0,0, 1,1,0,0, 1,0,1,0},
  {1,1,0,1, 1,0,1,1, 0,1,1,0, 1,1,0,1}
};

// The pattern's shape inside one sixteenth: the web bakes it into a buffer with
// a 3 ms ramp (at least 4 samples) on each edge of an open step, so a run of
// open steps still dips between them and a rhythm is not made of clicks.
// `f` is how far through the step we are, 0..1. The edge is a fraction of the
// step, as the buffer's 3 ms is a fraction of its 125 ms step, so it stretches
// with the tempo the way the web's does when the loop is played faster or slower.
inline double gateShape(double sr, int pat, double ph) {
  const double stepN = std::round(0.125 * sr);
  const double edge = std::max(4.0, std::round(sr * 0.003)) / stepN;
  const double s = ph * 16.0;
  int step = (int)s; if (step > 15) step = 15;
  if (!GATE_PATTERNS[pat][step]) return 0.0;
  const double f = s - step;
  if (f < edge) return f / edge;
  if (f > 1.0 - edge) return (1.0 - f) / edge;
  return 1.0;
}

// The send reverb is dsp::Fdn, fitted to the web chain's 3.4 s room impulse: size
// 0.5727 on the rack's scale, which is the 0.6 + size delay-length factor.
constexpr double FX_REV_SCALE = 0.6 + 0.5727;

}  // namespace

struct MixFx::Impl {
  double sr;
  double p[MFX_COUNT];
  Smooth sm[MFX_COUNT];
  double pv[MFX_COUNT], cv[MFX_COUNT];      // value at the start / end of this chunk

  BqS lpS1[2], lpS2[2], hpS1[2], hpS2[2];
  BqC lpC1, lpC2, hpC1, hpC2;
  Os2 os[2]; Curve curve; double curveAmt = -1; int curveSince = 1 << 20;
  float dr[2][16] = {}; int dw = 0;           // the clean/dry side, delayed to match the oversampler
  BqS isoS[4][2]; BqC isoC[4];
  BqS fmtS[2][2]; BqC fmtC[2];
  double tremPh = 0, ringPh = 0, gatePh = 0;   // gatePh: where in the bar the pattern is, 0..1
  Dl dly[2]; double dlyT = 0.25; int dlyTail = 0;
  Fdn fdn; int rvTail = 0;
  int drvTail = 0;
  float x[2][CHUNK], clean[2][CHUNK], tmp[2][CHUNK];
  // The strip's EQ. State is per band and channel; the coefficients are redone
  // only when a gain or the peak's frequency moved.
  BqC eqC[3]; BqS1 eqS[3][2]; double eqLast[4] = {1e9, 1e9, 1e9, 1e9};
  ModFxProc wk; float wkOut[2][128];

  explicit Impl(double sampleRate) : sr(sampleRate), fdn(sampleRate, FX_REV_SEC, FX_REV_SCALE), wk(sampleRate) {
    static const double def[MFX_COUNT] = {
      /*mix*/1, /*tau*/0.02, /*active*/0, /*lp*/18000, 0.7, /*hp*/20, 0.7,
      /*drv*/0, 0, 1, /*iso*/0, 1, 1, 1, 1, /*fmt*/0, 1, 700, 1800, /*gate*/1,
      /*trem*/1, 0, 4, /*pan*/0, /*ring*/18, 0, 1, /*dly*/0, 0.25, 0.35, /*rev*/0, /*dry*/1,
      /*worklet*/0, 0, 1, 0, 0, 0, 0.5, 0, 1, 0, 0,
      /*gate pattern*/0, 0, 0.5, /*eq*/0, 0, 1000, 0 };
    for (int i = 0; i < MFX_COUNT; i++) { p[i] = def[i]; sm[i].init(sr, 0.02); sm[i].snap(def[i]); pv[i] = cv[i] = def[i]; }
    sm[MFX_ACTIVE].init(sr, 0.005); sm[MFX_MIX].init(sr, 0.015);
    dly[0].init((int)(sr * 4.0)); dly[1].init((int)(sr * 4.0));
    driveCurve(curve, 0);
    isoC[0] = bqDesign(LP, ISO_LO_HZ, 0.7, sr, true);  isoC[1] = bqDesign(HP, ISO_LO_HZ, 0.7, sr, true);
    isoC[2] = bqDesign(LP, ISO_HI_HZ, 0.7, sr, true);  isoC[3] = bqDesign(HP, ISO_HI_HZ, 0.7, sr, true);
    lpC1 = lpC2 = bqDesign(LP, 18000, 0.7, sr, true);
    hpC1 = hpC2 = bqDesign(HP, 20, 0.7, sr, true);
  }

  // Step the smoothers one chunk and remember where each started, so gains can
  // ramp across the chunk instead of stepping at its edge.
  void controls() {
    const double tau = std::max(0.002, p[MFX_TAU]);
    const double k = 1.0 - std::exp(-1.0 / (sr * tau));
    for (int i = 0; i < MFX_COUNT; i++) {
      if (i != MFX_ACTIVE && i != MFX_MIX) sm[i].k = k;
      sm[i].t = p[i];
      pv[i] = sm[i].v;
      // CHUNK one-pole steps in one go.
      sm[i].v += (sm[i].t - sm[i].v) * (1.0 - std::pow(1.0 - sm[i].k, CHUNK));
      cv[i] = sm[i].v;
    }
    lpC1 = bqDesign(LP, cv[MFX_LP_HZ], cv[MFX_LP_Q], sr, true);
    lpC2 = bqDesign(LP, cv[MFX_LP_HZ], 0.7, sr, true);
    hpC1 = bqDesign(HP, cv[MFX_HP_HZ], cv[MFX_HP_Q], sr, true);
    hpC2 = bqDesign(HP, cv[MFX_HP_HZ], 0.7, sr, true);
    fmtC[0] = bqDesign(BP, cv[MFX_FMT1_HZ], FMT_Q, sr, false);
    fmtC[1] = bqDesign(BP, cv[MFX_FMT2_HZ], FMT_Q, sr, false);
    // Rebuilding the curve is 2048 divisions; skip it unless the amount moved.
    curveSince += CHUNK;
    if (std::fabs(cv[MFX_DRV_AMT] - curveAmt) > 0.004 && curveSince > 512) {
      driveCurve(curve, cv[MFX_DRV_AMT]); curveAmt = cv[MFX_DRV_AMT]; curveSince = 0;
    }
  }
  inline float ramp(int idx, int i, int n) const {
    return (float)(pv[idx] + (cv[idx] - pv[idx]) * ((i + 1) / (double)n));
  }
  static inline bool near(double a, double b) { return std::fabs(a - b) < 1e-4; }

  bool chainLive() const { return cv[MFX_ACTIVE] > 1e-4 || p[MFX_ACTIVE] > 0.5; }
  ModFxParams wkParams() const {
    ModFxParams q;
    q.stutter = p[MFX_STUTTER]; q.reverse = p[MFX_REVERSE]; q.warp = p[MFX_WARP]; q.crush = p[MFX_CRUSH];
    q.srate = p[MFX_SRATE]; q.grain = p[MFX_GRAIN]; q.grainlen = p[MFX_GRAINLEN];
    q.fltmode = p[MFX_FLTMODE]; q.fltcut = p[MFX_FLTCUT]; q.fltres = p[MFX_FLTRES]; q.fltdrv = p[MFX_FLTDRV];
    return q;
  }

  // The part's EQ, on the finished part (after the Mix, or the clean part when the
  // chain is out). Bands at 0 dB are not run, and their state is cleared so they
  // come back from silence.
  void eqStage(float* L, float* R, int n) {
    const double g[3] = {cv[MFX_EQ_LO], cv[MFX_EQ_MID], cv[MFX_EQ_HI]};
    const double hz = cv[MFX_EQ_MID_HZ];
    if (std::fabs(g[0]) < 0.005 && std::fabs(g[1]) < 0.005 && std::fabs(g[2]) < 0.005) {
      for (int b = 0; b < 3; b++) { eqS[b][0] = BqS1(); eqS[b][1] = BqS1(); }
      eqLast[0] = eqLast[1] = eqLast[2] = eqLast[3] = 1e9;
      return;
    }
    if (std::fabs(g[0] - eqLast[0]) > 1e-4 || std::fabs(g[1] - eqLast[1]) > 1e-4 ||
        std::fabs(g[2] - eqLast[2]) > 1e-4 || std::fabs(hz - eqLast[3]) > 1e-3) {
      eqC[0] = eqDesign(EQ_LOW, 120.0, g[0], 0, sr);
      eqC[1] = eqDesign(EQ_PEAK, hz, g[1], 0.9, sr);
      eqC[2] = eqDesign(EQ_HIGH, 8000.0, g[2], 0, sr);
      eqLast[0] = g[0]; eqLast[1] = g[1]; eqLast[2] = g[2]; eqLast[3] = hz;
    }
    for (int b = 0; b < 3; b++) {
      if (std::fabs(g[b]) < 0.005) { eqS[b][0] = BqS1(); eqS[b][1] = BqS1(); continue; }
      for (int i = 0; i < n; i++) { L[i] = (float)bqRun1(eqC[b], eqS[b][0], L[i]); R[i] = (float)bqRun1(eqC[b], eqS[b][1], R[i]); }
    }
  }

  // `src` is the chain's input (the part after the buffer effects); `L`/`R`
  // are the part itself, which the clean half of the Mix is made from.
  void run(float* L, float* R, const float* src0, const float* src1, int n) {
    float* io[2] = {L, R};
    const float* src[2] = {src0, src1};
    // The clean part, delayed as far as the oversampler delays the chain, so
    // the two halves of the Mix line up (fxBuildChain's bypDly).
    for (int i = 0; i < n; i++) {
      for (int c = 0; c < 2; c++) {
        dr[c][dw & 15] = io[c][i];
        clean[c][i] = dr[c][(dw - OS_C / 2) & 15];
        x[c][i] = src[c][i];
      }
      dw++;
    }
    const bool live = cv[MFX_ACTIVE] > 1e-4 || p[MFX_ACTIVE] > 0.5;
    if (!live) { for (int c = 0; c < 2; c++) std::memcpy(io[c], clean[c], sizeof(float) * (size_t)n); return; }

    // Filters: a pair of low-passes, then a pair of high-passes.
    for (int c = 0; c < 2; c++)
      for (int i = 0; i < n; i++) {
        double v = x[c][i];
        v = bqRun(lpC1, lpS1[c], v); v = bqRun(lpC2, lpS2[c], v);
        v = bqRun(hpC1, hpS1[c], v); v = bqRun(hpC2, hpS2[c], v);
        x[c][i] = (float)v;
      }

    // Drive, a parallel blend. The oversampler hands back the shaped signal and
    // the input delayed by exactly its own latency, so the blend never combs;
    // it runs whenever the chain is in, so that holds when the amount moves.
    for (int c = 0; c < 2; c++)
      for (int i = 0; i < n; i++) {
        float dry; const float wet = os[c].run(curve, x[c][i], &dry);
        x[c][i] = wet * ramp(MFX_DRV_WET, i, n) + dry * ramp(MFX_DRV_DRY, i, n);
      }

    // Isolator: three bands summed, in place of the signal while it is up.
    if (cv[MFX_ISO_WET] > 1e-4 || !near(cv[MFX_ISO_DRY], 1)) {
      for (int i = 0; i < n; i++) {
        const float w = ramp(MFX_ISO_WET, i, n), d = ramp(MFX_ISO_DRY, i, n);
        const float gl = ramp(MFX_ISO_LO, i, n), gm = ramp(MFX_ISO_MID, i, n), gh = ramp(MFX_ISO_HI, i, n);
        for (int c = 0; c < 2; c++) {
          const double in = x[c][i];
          const double lo = bqRun(isoC[0], isoS[0][c], in);
          const double mid = bqRun(isoC[2], isoS[2][c], bqRun(isoC[1], isoS[1][c], in));
          const double hi = bqRun(isoC[3], isoS[3][c], in);
          x[c][i] = (float)(w * (lo * gl + mid * gm + hi * gh) + d * in);
        }
      }
    }
    // Talk filter: two formants, blended in.
    if (cv[MFX_FMT_WET] > 1e-4 || !near(cv[MFX_FMT_DRY], 1)) {
      for (int i = 0; i < n; i++) {
        const float w = ramp(MFX_FMT_WET, i, n), d = ramp(MFX_FMT_DRY, i, n);
        for (int c = 0; c < 2; c++) {
          const double in = x[c][i];
          const double f = bqRun(fmtC[0], fmtS[0][c], in) + 0.8 * bqRun(fmtC[1], fmtS[1][c], in);
          x[c][i] = (float)(w * f + d * in);
        }
      }
    }
    // Gate gain, tremolo (a sine on the gain, around its base), pan.
    {
      const double tw = 2 * PI * cv[MFX_TREM_HZ] / sr;
      const double pan = cv[MFX_PAN];
      const bool panOn = std::fabs(pan) > 1e-4;
      double gl = 0, gr = 1;                     // StereoPanner on a stereo input (the spec's)
      double pl = 0, pr = 0;
      if (panOn) {
        if (pan <= 0) { const double a = pan + 1; gl = std::cos(a * PI / 2); gr = std::sin(a * PI / 2); }
        else { pl = std::cos(pan * PI / 2); pr = std::sin(pan * PI / 2); }
      }
      // The pattern runs free whether or not it is audible, as the web's buffer
      // does: it keeps its place in the bar, and bringing it in later picks it
      // up wherever it is. The pattern number is read as set, not smoothed (a
      // glide between pattern 2 and pattern 6 would pass through the ones
      // between); the depth is smoothed, so it comes in without a click.
      const int pat = std::max(0, std::min(GATE_PAT_COUNT - 1, (int)std::floor(p[MFX_GATE_PAT] + 0.5)));
      const bool patOn = cv[MFX_GATE_PAT_AMT] > 1e-4 || pv[MFX_GATE_PAT_AMT] > 1e-4;
      for (int i = 0; i < n; i++) {
        float g = ramp(MFX_GATE, i, n);
        const double hz = pv[MFX_GATE_PAT_HZ] + (cv[MFX_GATE_PAT_HZ] - pv[MFX_GATE_PAT_HZ]) * ((i + 1) / (double)n);
        if (patOn) g += ramp(MFX_GATE_PAT_AMT, i, n) * (float)gateShape(sr, pat, gatePh);
        gatePh += hz / sr; if (gatePh >= 1.0) gatePh -= std::floor(gatePh);
        const float t = ramp(MFX_TREM_BASE, i, n) + ramp(MFX_TREM_DEPTH, i, n) * (float)std::sin(tremPh);
        tremPh += tw; if (tremPh > 2 * PI) tremPh -= 2 * PI;
        float a = x[0][i] * g * t, b = x[1][i] * g * t;
        if (panOn) {
          if (pan <= 0) { const float na = a + b * (float)gl, nb = b * (float)gr; a = na; b = nb; }
          else { const float na = a * (float)pl, nb = b + a * (float)pr; a = na; b = nb; }
        }
        x[0][i] = a; x[1][i] = b;
      }
    }
    // Ring mod: the wet side is the signal times a sine.
    if (cv[MFX_RING_WET] > 1e-4 || !near(cv[MFX_RING_DRY], 1)) {
      const double rw = 2 * PI * cv[MFX_RING_HZ] / sr;
      for (int i = 0; i < n; i++) {
        const float w = ramp(MFX_RING_WET, i, n), d = ramp(MFX_RING_DRY, i, n);
        const float o = (float)std::sin(ringPh); ringPh += rw; if (ringPh > 2 * PI) ringPh -= 2 * PI;
        x[0][i] = x[0][i] * (w * o + d); x[1][i] = x[1][i] * (w * o + d);
      }
    }
    // Sends. A branch runs while it has a send, and for its tail after.
    const bool dlyOn = cv[MFX_DLY_SEND] > 1e-5;
    if (dlyOn) dlyTail = (int)(14 * sr); else if (dlyTail > 0) dlyTail -= n;
    const bool rvOn = cv[MFX_REV_SEND] > 1e-5;
    if (rvOn) rvTail = (int)((FX_REV_SEC + 0.5) * sr); else if (rvTail > 0) rvTail -= n;
    const double slew = 1.0 - std::exp(-1.0 / (sr * std::max(0.002, p[MFX_TAU])));
    for (int i = 0; i < n; i++) {
      const float dg = ramp(MFX_DRY, i, n);
      double oL = x[0][i] * dg, oR = x[1][i] * dg;
      if (dlyOn || dlyTail > 0) {
        dlyT += (std::min(3.9, std::max(0.001, p[MFX_DLY_TIME])) - dlyT) * slew;
        const double fb = ramp(MFX_DLY_FB, i, n), sd = ramp(MFX_DLY_SEND, i, n);
        const double yl = dly[0].read(dlyT * sr), yr = dly[1].read(dlyT * sr);
        dly[0].write((float)(x[0][i] * sd + yl * fb)); dly[1].write((float)(x[1][i] * sd + yr * fb));
        oL += yl; oR += yr;
      }
      if (rvOn || rvTail > 0) {
        const double sd = ramp(MFX_REV_SEND, i, n);
        double rl, rr; fdn.tick(x[0][i] * sd, x[1][i] * sd, rl, rr);
        oL += rl * FX_REV_RET; oR += rr * FX_REV_RET;
      }
      x[0][i] = (float)oL; x[1][i] = (float)oR;
    }
    // The Mix: the chain against the clean part. Out of circuit (act = 0) it is
    // all clean; the page crossfades the two in 5 ms as the chain comes and goes.
    for (int i = 0; i < n; i++) {
      const float a = ramp(MFX_ACTIVE, i, n) * ramp(MFX_MIX, i, n);
      io[0][i] = x[0][i] * a + clean[0][i] * (1 - a);
      io[1][i] = x[1][i] * a + clean[1][i] * (1 - a);
    }
  }
};

MixFx::MixFx(double sr) : d(new Impl(sr)) {}
MixFx::~MixFx() = default;
void MixFx::set(int i, double v) { if (i >= 0 && i < MFX_COUNT && std::isfinite(v)) d->p[i] = v; }
double MixFx::get(int i) const { return (i >= 0 && i < MFX_COUNT) ? d->p[i] : 0; }

void MixFx::process(float* L, float* R, int n) {
  Impl& s = *d;
  // The buffer effects work in the browser's 128-frame blocks (their k-rate
  // parameters and mode changes are decided per block); the rest of the chain
  // works in control-rate chunks inside each.
  for (int off = 0; off < n; off += 128) {
    const int k = std::min(128, n - off);
    float* l = L + off; float* r = R + off;
    if (s.chainLive()) s.wk.process(l, r, s.wkOut[0], s.wkOut[1], k, s.wkParams());
    else {
      s.wk.silence();                      // out of circuit: no input, no history
      std::memcpy(s.wkOut[0], l, sizeof(float) * (size_t)k);
      std::memcpy(s.wkOut[1], r, sizeof(float) * (size_t)k);
    }
    for (int c0 = 0; c0 < k; c0 += CHUNK) {
      const int kk = std::min(CHUNK, k - c0);
      s.controls();
      s.run(l + c0, r + c0, s.wkOut[0] + c0, s.wkOut[1] + c0, kk);
      s.eqStage(l + c0, r + c0, kk);
    }
  }
}

}  // namespace modsynth
