// The EQ (a part's strip, five bands, and the master, six) against the browser's
// own filters. Two sets of reference numbers, both BiquadFilterNode.
// getFrequencyResponse recorded in Chrome:
//   - the first three bands, below in REFS: lowshelf 120 Hz, peaking (Q 0.9) and
//     highshelf 8 kHz at the stated gains, 48 kHz (a few lines of page: create the
//     node, set type, frequency, gain, Q, call getFrequencyResponse, 20*log10);
//   - everything the five- and six-band EQ added, in eqref.h: the high-pass and
//     low-pass at 12 and 24 dB per octave and three resonances each, the peak's
//     width, the shelves' corners, the master's second peak, all at once. That
//     table is generated: `node tests/eq/record-refs.js` opens tests/eq/eqref.html
//     (the cases, and the nodes built out of them by hand, not from index.html)
//     in headless Chrome and writes eqref.h and tests/eq/refs.json, which the
//     page's drawing (eqResponseDb) is held to in tests/eq/curve.test.js.
// Checks:
//   1. the coefficients (eqDesign, passDesign) give that response, to 0.05 dB;
//   2. the bus and a part's strip, set to it, do to a quiet tone what the filters
//      should, to 0.5 dB, and an EQ left at its defaults changes nothing at all
//      (bit for bit, against the three-band engine this one replaced: GOLDEN);
//   3. a filter going on, off or between slopes makes no click, and a filter that
//      has gone off is gone: the output is the untouched engine's, to the bit;
//   4. `eqtest --grid` prints what the engine measures on a grid of settings, for
//      tests/eq/agree.test.js to hold against the page's eqResponseDb;
//   5. what it costs (the timing lines), and that a ringing filter does not end in
//      denormal numbers.
#include "master.h"
#include "mixfx.h"
#include "dspkit.h"
#include "eqgolden.h"
#include "eqpass.h"
#include "eqref.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
using namespace modsynth;
using namespace modsynth::dsp;

static const double SR = 48000, PI_ = 3.14159265358979323846;
static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.4g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}
static const double F[10] = {40, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000};
struct Ref { const char* name; double lo, mid, midHz, hi; double db[10]; };
static const Ref REFS[] = {
  {"low shelf +9",           9, 0, 1000, 0, {8.87, 4.5, 0.524, 0.035, 0.002, 0, 0, 0, 0, 0}},
  {"peak +6 at 1 kHz",       0, 6, 1000, 0, {0.013, 0.116, 0.513, 2.152, 6, 2.137, 0.492, 0.104, 0.034, 0.011}},
  {"peak -8 at 3 kHz",       0, -8, 3000, 0, {-0.002, -0.018, -0.077, -0.309, -1.252, -4.987, -6.069, -1.37, -0.452, -0.15}},
  {"high shelf +10",         0, 0, 1000, 10, {0, 0, 0, 0, 0.002, 0.033, 0.531, 5, 8.842, 9.851}},
  {"all three (-6, +4 at 500, -5)", -6, 4, 500, -5, {-5.888, -2.695, 1.103, 3.979, 1.421, 0.314, -0.155, -2.484, -4.475, -4.934}},
};

// |H(e^jw)| in dB of a biquad.
static double magDb(const BqC& c, double f, double sr = SR) {
  const double w = 2 * PI_ * f / sr;
  const double cr = std::cos(w), ci = -std::sin(w), c2r = std::cos(2 * w), c2i = -std::sin(2 * w);
  const double nr = c.b0 + c.b1 * cr + c.b2 * c2r, ni = c.b1 * ci + c.b2 * c2i;
  const double dr = 1 + c.a1 * cr + c.a2 * c2r, di = c.a1 * ci + c.a2 * c2i;
  return 10 * std::log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// Gain of the master bus on a tone, in dB, between two settings of the EQ.
static double busGain(double hz, double lo, double mid, double midHz, double hi) {
  auto run = [&](bool eqOn) {
    MasterBus m(SR);
    if (eqOn) { m.set(MB_EQ_LO, lo); m.set(MB_EQ_MID, mid); m.set(MB_EQ_MID_HZ, midHz); m.set(MB_EQ_HI, hi); }
    const int N = (int)(SR * 1.5);
    std::vector<float> L(N), R(N), z(N, 0.f);
    const double a = std::pow(10.0, -45.0 / 20);
    for (int i = 0; i < N; i++) L[i] = R[i] = (float)(a * std::sin(2 * PI_ * hz * i / SR));
    for (int off = 0; off < N; off += 128) {
      const int n = std::min(128, N - off);
      m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, n);
    }
    double s = 0; int k = 0;
    for (int i = N / 2; i < N; i++) { s += (double)L[i] * L[i]; k++; }
    return 10 * std::log10(s / k + 1e-30);
  };
  return run(true) - run(false);
}

// Gain of one part's strip EQ (MixFx's last four parameters) on a tone, in dB, with
// the mõdFX chain in or out: the EQ is the strip's and runs either way.
static double partGain(double hz, double lo, double mid, double midHz, double hi, bool chainIn, bool setEq = true) {
  auto run = [&](bool eqOn) {
    MixFx m(SR);
    m.set(MFX_TAU, 0.002); m.set(MFX_ACTIVE, chainIn ? 1 : 0);
    if (eqOn) { m.set(MFX_EQ_LO, lo); m.set(MFX_EQ_MID, mid); m.set(MFX_EQ_MID_HZ, midHz); m.set(MFX_EQ_HI, hi); }
    const int N = (int)(SR * 1.0);
    std::vector<float> L(N), R(N);
    for (int i = 0; i < N; i++) L[i] = R[i] = (float)(0.2 * std::sin(2 * PI_ * hz * i / SR));
    for (int off = 0; off < N; off += 128) m.process(L.data() + off, R.data() + off, std::min(128, N - off));
    double s = 0; int k = 0;
    for (int i = N / 2; i < N; i++) { s += (double)L[i] * L[i]; k++; }
    return 10 * std::log10(s / k + 1e-30);
  };
  return run(setEq) - run(false);
}


// ── The five- and six-band EQ ────────────────────────────────────────────────
// A model is the page's EQ object as numbers, in eqref.h's order.
enum { M_LO, M_MID, M_MIDHZ, M_HI, M_LOHZ, M_HIHZ, M_MIDQ, M_HPFON, M_HPFHZ, M_HPFQ, M_HPFSLOPE,
       M_LPFON, M_LPFHZ, M_LPFQ, M_LPFSLOPE, M_MID2, M_MID2HZ, M_MID2Q, M_N };

// The response of a model, built from the coefficients the engine uses.
static double modelDb(const double* m, double f, double sr) {
  double d = 0;
  if (m[M_HPFON]) { d += magDb(passDesign(true, m[M_HPFHZ], m[M_HPFQ], sr), f, sr); if (m[M_HPFSLOPE] >= 18) d += magDb(passDesign(true, m[M_HPFHZ], EQP_Q2, sr), f, sr); }
  if (m[M_LO])   d += magDb(eqDesign(EQ_LOW, m[M_LOHZ], m[M_LO], 0, sr), f, sr);
  if (m[M_MID])  d += magDb(eqDesign(EQ_PEAK, m[M_MIDHZ], m[M_MID], m[M_MIDQ], sr), f, sr);
  if (m[M_MID2]) d += magDb(eqDesign(EQ_PEAK, m[M_MID2HZ], m[M_MID2], m[M_MID2Q], sr), f, sr);
  if (m[M_HI])   d += magDb(eqDesign(EQ_HIGH, m[M_HIHZ], m[M_HI], 0, sr), f, sr);
  if (m[M_LPFON]) { d += magDb(passDesign(false, m[M_LPFHZ], m[M_LPFQ], sr), f, sr); if (m[M_LPFSLOPE] >= 18) d += magDb(passDesign(false, m[M_LPFHZ], EQP_Q2, sr), f, sr); }
  return d;
}
static void setStrip(MixFx& m, const double* v) {
  m.set(MFX_EQ_LO, v[M_LO]); m.set(MFX_EQ_MID, v[M_MID]); m.set(MFX_EQ_MID_HZ, v[M_MIDHZ]); m.set(MFX_EQ_HI, v[M_HI]);
  m.set(MFX_EQ_LO_HZ, v[M_LOHZ]); m.set(MFX_EQ_HI_HZ, v[M_HIHZ]); m.set(MFX_EQ_MID_Q, v[M_MIDQ]);
  m.set(MFX_EQ_HPF_ON, v[M_HPFON]); m.set(MFX_EQ_HPF_HZ, v[M_HPFHZ]); m.set(MFX_EQ_HPF_Q, v[M_HPFQ]); m.set(MFX_EQ_HPF_SLOPE, v[M_HPFSLOPE]);
  m.set(MFX_EQ_LPF_ON, v[M_LPFON]); m.set(MFX_EQ_LPF_HZ, v[M_LPFHZ]); m.set(MFX_EQ_LPF_Q, v[M_LPFQ]); m.set(MFX_EQ_LPF_SLOPE, v[M_LPFSLOPE]);
}
static void setMaster(MasterBus& m, const double* v) {
  m.set(MB_EQ_LO, v[M_LO]); m.set(MB_EQ_MID, v[M_MID]); m.set(MB_EQ_MID_HZ, v[M_MIDHZ]); m.set(MB_EQ_HI, v[M_HI]);
  m.set(MB_EQ_LO_HZ, v[M_LOHZ]); m.set(MB_EQ_HI_HZ, v[M_HIHZ]); m.set(MB_EQ_MID_Q, v[M_MIDQ]);
  m.set(MB_EQ_HPF_ON, v[M_HPFON]); m.set(MB_EQ_HPF_HZ, v[M_HPFHZ]); m.set(MB_EQ_HPF_Q, v[M_HPFQ]); m.set(MB_EQ_HPF_SLOPE, v[M_HPFSLOPE]);
  m.set(MB_EQ_LPF_ON, v[M_LPFON]); m.set(MB_EQ_LPF_HZ, v[M_LPFHZ]); m.set(MB_EQ_LPF_Q, v[M_LPFQ]); m.set(MB_EQ_LPF_SLOPE, v[M_LPFSLOPE]);
  m.set(MB_EQ_MID2, v[M_MID2]); m.set(MB_EQ_MID2_HZ, v[M_MID2HZ]); m.set(MB_EQ_MID2_Q, v[M_MID2Q]);
}

// Power of a tone through the strip or the bus, over a whole number of cycles at
// the end of 1.25 s (long enough for the filters to have settled). `model` null is
// the engine untouched.
static double tonePower(bool master, const double* model, double hz, double sr) {
  const int N = (int)(sr * 1.25);
  std::vector<float> L((size_t)N), R((size_t)N), z((size_t)N, 0.f);
  const double a = master ? std::pow(10.0, -45.0 / 20) : 0.2;
  for (int i = 0; i < N; i++) L[(size_t)i] = R[(size_t)i] = (float)(a * std::sin(2 * PI_ * hz * i / sr));
  if (master) {
    MasterBus m(sr); if (model) setMaster(m, model);
    for (int off = 0; off < N; off += 128) { const int n = std::min(128, N - off); m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, n); }
  } else {
    MixFx m(sr); m.set(MFX_TAU, 0.002); if (model) setStrip(m, model);
    for (int off = 0; off < N; off += 128) m.process(L.data() + off, R.data() + off, std::min(128, N - off));
  }
  const int W = std::min(N / 2, (int)std::lround(std::floor(0.75 * hz) * sr / hz));
  double acc = 0;
  for (int i = N - W; i < N; i++) acc += (double)L[(size_t)i] * L[(size_t)i];
  return acc / W;
}
// dB the strip or the bus does to a tone for a model; the untouched engine's power is cached.
static double engineDb(bool master, const double* model, double hz, double sr) {
  static std::vector<std::pair<std::vector<double>, double>> cache;
  const std::vector<double> key = {master ? 1.0 : 0.0, hz, sr};
  double base = -1;
  for (auto& c : cache) if (c.first == key) { base = c.second; break; }
  if (base < 0) { base = tonePower(master, nullptr, hz, sr); cache.push_back({key, base}); }
  return 10 * std::log10((tonePower(master, model, hz, sr) + 1e-30) / (base + 1e-30));
}

// The largest sample-to-sample step of the signal after a 1-2-1 smoothing. A click is a
// step, and survives it; the small ripple a low-pass near its inert corner leaves at
// its own frequency (a few hundredths of a percent of full scale at Nyquist, 24 kHz at
// 48 kHz) does not, and cannot be heard.
static double clickScore(const std::vector<float>& y, int from, int to) {
  double m = 0, prev = 0;
  for (int i = from + 1; i < to - 1; i++) {
    const double v = (y[(size_t)i - 1] + 2.0 * y[(size_t)i] + y[(size_t)i + 1]) / 4;
    if (i > from + 1) m = std::max(m, std::fabs(v - prev));
    prev = v;
  }
  return m;
}

// Seconds for one second of stereo audio, best of five.
template <class F> static double bestSeconds(F run) {
  double best = 1e9;
  for (int k = 0; k < 5; k++) {
    const auto t0 = std::chrono::steady_clock::now(); run();
    best = std::min(best, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
  }
  return best;
}

// A small deterministic generator for the grid's settings.
struct Lcg { uint32_t x = 20250601; double u() { x = x * 1664525u + 1013904223u; return (x >> 8) / 16777216.0; } };
static double rnd(Lcg& g, double a, double b) { return a + (b - a) * g.u(); }
static double rndLog(Lcg& g, double a, double b) { return a * std::pow(b / a, g.u()); }
// The page's limits (EQ_LIM in index.html), for settings the page could make.
static void randomModel(Lcg& g, double* m, bool master) {
  m[M_LO] = std::round(rnd(g, -12, 12) * 2) / 2;  m[M_MID] = std::round(rnd(g, -12, 12) * 2) / 2;  m[M_HI] = std::round(rnd(g, -12, 12) * 2) / 2;
  m[M_MIDHZ] = rndLog(g, 200, 5000); m[M_LOHZ] = rndLog(g, 40, 400); m[M_HIHZ] = rndLog(g, 2000, 16000); m[M_MIDQ] = rndLog(g, 0.3, 8);
  m[M_HPFON] = g.u() < 0.7; m[M_HPFHZ] = rndLog(g, 20, 2000); m[M_HPFQ] = rndLog(g, 0.5, 10); m[M_HPFSLOPE] = g.u() < 0.5 ? 12 : 24;
  m[M_LPFON] = g.u() < 0.7; m[M_LPFHZ] = rndLog(g, 1000, 20000); m[M_LPFQ] = rndLog(g, 0.5, 10); m[M_LPFSLOPE] = g.u() < 0.5 ? 12 : 24;
  m[M_MID2] = master ? std::round(rnd(g, -12, 12) * 2) / 2 : 0; m[M_MID2HZ] = rndLog(g, 200, 5000); m[M_MID2Q] = rndLog(g, 0.3, 8);
}

// The grid `eqtest --grid` prints: for each setting, what the strip (or the bus)
// measures at the reference frequencies. tests/eq/agree.test.js reads it.
static int printGrid() {
  Lcg g;
  struct One { bool master; double sr; double m[M_N]; };
  std::vector<One> all;
  for (int i = 0; i < EQREF_N; i++) {
    One o; o.sr = EQREF[i].sr; for (int k = 0; k < M_N; k++) o.m[k] = EQREF[i].m[k];
    o.master = EQREF[i].m[M_MID2] != 0; all.push_back(o);
    if (!o.master) { o.master = true; all.push_back(o); }
  }
  for (int i = 0; i < 24; i++) { One o; o.master = i % 2; o.sr = i % 5 == 4 ? 44100 : 48000; randomModel(g, o.m, o.master); all.push_back(o); }
  for (const One& o : all) {
    printf("%s %g", o.master ? "master" : "strip", o.sr);
    for (int k = 0; k < M_N; k++) printf(" %.9g", o.m[k]);
    printf(" |");
    for (int i = 0; i < EQREF_NF; i++) printf(" %.4f", engineDb(o.master, o.m, EQREF_F[i], o.sr));
    printf("\n");
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--grid") return printGrid();
  for (const Ref& r : REFS) {
    const BqC lo = eqDesign(EQ_LOW, 120, r.lo, 0, SR), mid = eqDesign(EQ_PEAK, r.midHz, r.mid, 0.9, SR), hi = eqDesign(EQ_HIGH, 8000, r.hi, 0, SR);
    double worst = 0;
    for (int i = 0; i < 10; i++) {
      const double got = magDb(lo, F[i]) + magDb(mid, F[i]) + magDb(hi, F[i]);
      worst = std::max(worst, std::fabs(got - r.db[i]));
    }
    char b[120]; snprintf(b, sizeof b, "coefficients match the browser: %s", r.name);
    check(worst < 0.05, b, worst);
  }
  // Through the bus, on the combined case and the single shelves.
  for (int k : {4, 0, 3}) {
    const Ref& r = REFS[k];
    double worst = 0;
    for (int i : {1, 3, 4, 7, 8}) {
      const double got = busGain(F[i], r.lo, r.mid, r.midHz, r.hi);
      worst = std::max(worst, std::fabs(got - r.db[i]));
    }
    char b[120]; snprintf(b, sizeof b, "through the bus within 0.5 dB: %s", r.name);
    check(worst < 0.5, b, worst);
  }
  // The same three bands on a part's strip, with the chain out and in.
  for (bool chainIn : {false, true}) {
    for (int k : {4, 0, 3}) {
      const Ref& r = REFS[k];
      double worst = 0;
      for (int i : {1, 3, 4, 7, 8}) {
        const double got = partGain(F[i], r.lo, r.mid, r.midHz, r.hi, chainIn);
        worst = std::max(worst, std::fabs(got - r.db[i]));
      }
      char b[140]; snprintf(b, sizeof b, "a part's EQ, chain %s, within 0.5 dB: %s", chainIn ? "in" : "out", r.name);
      check(worst < 0.5, b, worst);
    }
  }
  {
    // Flat: bit-identical to no EQ settings at all, chain out and in.
    for (bool chainIn : {false, true}) {
      MixFx a(SR), b(SR);
      a.set(MFX_ACTIVE, chainIn); b.set(MFX_ACTIVE, chainIn);
      b.set(MFX_EQ_LO, 0); b.set(MFX_EQ_MID, 0); b.set(MFX_EQ_HI, 0); b.set(MFX_EQ_MID_HZ, 3000);
      const int N = 4096; std::vector<float> L1(N), R1(N), L2, R2;
      for (int i = 0; i < N; i++) L1[i] = R1[i] = (float)(0.3 * std::sin(0.05 * i));
      L2 = L1; R2 = R1;
      for (int off = 0; off < N; off += 128) { a.process(L1.data() + off, R1.data() + off, 128); b.process(L2.data() + off, R2.data() + off, 128); }
      int diff = 0; for (int i = 0; i < N; i++) if (L1[i] != L2[i] || R1[i] != R2[i]) diff++;
      check(diff == 0, chainIn ? "a flat part EQ is bit-identical to none (chain in)" : "a flat part EQ is bit-identical to none (chain out)", diff);
    }
  }
  // Unused: a bus with the EQ params at zero is the bus without them, to the bit.
  {
    MasterBus a(SR), b(SR);
    b.set(MB_EQ_LO, 0); b.set(MB_EQ_MID, 0); b.set(MB_EQ_HI, 0); b.set(MB_EQ_MID_HZ, 2500);
    const int N = 4096; std::vector<float> L1(N), R1(N), L2, R2, z(N, 0.f);
    for (int i = 0; i < N; i++) L1[i] = R1[i] = (float)(0.3 * std::sin(0.05 * i));
    L2 = L1; R2 = R1;
    for (int off = 0; off < N; off += 128) {
      a.process(L1.data() + off, R1.data() + off, z.data() + off, z.data() + off, 128);
      b.process(L2.data() + off, R2.data() + off, z.data() + off, z.data() + off, 128);
    }
    int diff = 0; for (int i = 0; i < N; i++) if (L1[i] != L2[i] || R1[i] != R2[i]) diff++;
    check(diff == 0, "EQ at zero is bit-identical to no EQ", diff);
  }
  // A knob swept hard while audio runs: stays finite and bounded, and back at zero it is silent-neutral.
  {
    MasterBus m(SR); srand(7);
    const int N = (int)(SR * 6); std::vector<float> L(N), R(N), z(N, 0.f);
    for (int i = 0; i < N; i++) L[i] = R[i] = (float)(0.4 * std::sin(2 * PI_ * 220 * i / SR) + 0.2 * std::sin(2 * PI_ * 3300 * i / SR));
    bool ok = true; float peak = 0;
    for (int off = 0; off < N; off += 128) {
      if ((off / 128) % 20 == 0) {
        m.set(MB_EQ_LO, (rand() % 25) - 12); m.set(MB_EQ_MID, (rand() % 25) - 12);
        m.set(MB_EQ_MID_HZ, 100 + rand() % 6000); m.set(MB_EQ_HI, (rand() % 25) - 12);
      }
      m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, 128);
      for (int i = 0; i < 128; i++) { const float v = std::fabs(L[off + i]); if (!std::isfinite(v)) ok = false; peak = std::max(peak, v); }
    }
    check(ok && peak < 1.5f, "random sweeps for six seconds stay finite and bounded", peak);
  }

  // ── The reference table in eqref.h ──
  // 1. the coefficients, 2. the engine.
  {
    double worstAll = 0;
    for (int i = 0; i < EQREF_N; i++) {
      double worst = 0;
      for (int j = 0; j < EQREF_NF; j++) worst = std::max(worst, std::fabs(modelDb(EQREF[i].m, EQREF_F[j], EQREF[i].sr) - EQREF[i].db[j]));
      worstAll = std::max(worstAll, worst);
      char b[160]; snprintf(b, sizeof b, "coefficients match the browser: %s", EQREF[i].name);
      check(worst < 0.05, b, worst);
    }
    printf("      (worst of %d cases: %.4f dB)\n", EQREF_N, worstAll);
  }
  {
    static const int PICK[] = {0, 2, 4, 6, 8, 11, 13, 15};      // eight of the sixteen frequencies, each case
    for (int i = 0; i < EQREF_N; i++) {
      const EqRefCase& r = EQREF[i];
      for (int master = 0; master < 2; master++) {
        if (!master && r.m[M_MID2]) continue;                    // a strip has no second peak
        double worst = 0;
        for (int j : PICK) {
          const double got = engineDb(master, r.m, EQREF_F[j], r.sr);
          // The filters put the tone far below the noise floor of a quiet test (-100 dB and under).
          if (r.db[j] < -60) continue;
          worst = std::max(worst, std::fabs(got - r.db[j]));
        }
        char b[180]; snprintf(b, sizeof b, "%s on a tone, within 0.5 dB: %s", master ? "the bus" : "a part's strip", r.name);
        check(worst < 0.5, b, worst);
      }
    }
  }

  // ── Today's sound, to the bit ──
  // Recorded from the engine before the EQ grew (see eqgolden.h).
  {
    const unsigned long long G_OUT = 0x2fc70c55c543bfceull, G_IN = 0x03e6e9d9742b7779ull, G_MASTER = 0x4f6bae5c076ea6d3ull;
    check(eqgolden::strip(false) == G_OUT, "the three-band strip EQ is bit-identical to the engine before the five-band one (chain out)", 0);
    check(eqgolden::strip(true) == G_IN, "the three-band strip EQ is bit-identical to the engine before the five-band one (chain in)", 0);
    check(eqgolden::master() == G_MASTER, "the three-band master EQ is bit-identical to the engine before the six-band one", 0);
  }
  // Every new parameter at its default, set explicitly, is the same as never set.
  {
    const double d[M_N] = {0, 0, 1000, 0, 120, 8000, 0.9, 0, 80, EQP_Q2, 12, 0, 12000, EQP_Q2, 12, 0, 3000, 0.9};
    for (int master = 0; master < 2; master++) {
      const int N = 8192; std::vector<float> a, b, ar, br, z((size_t)N, 0.f);
      eqgolden::input(a, ar, N); b = a; br = ar;
      MixFx s1(SR), s2(SR); MasterBus m1(SR), m2(SR);
      if (master) setMaster(m2, d); else setStrip(s2, d);
      for (int off = 0; off < N; off += 128) {
        if (master) { m1.process(a.data() + off, ar.data() + off, z.data() + off, z.data() + off, 128); m2.process(b.data() + off, br.data() + off, z.data() + off, z.data() + off, 128); }
        else { s1.process(a.data() + off, ar.data() + off, 128); s2.process(b.data() + off, br.data() + off, 128); }
      }
      int diff = 0; for (int i = 0; i < N; i++) if (a[(size_t)i] != b[(size_t)i] || ar[(size_t)i] != br[(size_t)i]) diff++;
      check(diff == 0, master ? "the bus with every new parameter at its default is the untouched bus, to the bit" : "a strip with every new parameter at its default is the untouched strip, to the bit", diff);
    }
  }

  // ── Filters going on and off ──
  // A 300 Hz tone with a high-pass, a 2 kHz tone with a low-pass, both well inside the
  // pass band when they land: the filter coming in must not add a step the tone does
  // not have (the tone's own largest step is the yardstick, with a little to spare).
  for (int hp = 1; hp >= 0; hp--) for (int slope : {12, 24}) {
    const double tone = hp ? 300 : 2000, corner = hp ? 60 : 12000;
    const int N = (int)SR * 3;
    std::vector<float> L((size_t)N), R((size_t)N);
    for (int i = 0; i < N; i++) L[(size_t)i] = R[(size_t)i] = (float)(0.5 * std::sin(2 * PI_ * tone * i / SR));
    std::vector<float> ref = L;
    MixFx m(SR); m.set(MFX_TAU, 0.002);
    const int tOn = (int)SR * 1, tOff = (int)(SR * 2);
    for (int off = 0; off < N; off += 128) {
      if (off <= tOn && off + 128 > tOn) { m.set(hp ? MFX_EQ_HPF_ON : MFX_EQ_LPF_ON, 1); m.set(hp ? MFX_EQ_HPF_HZ : MFX_EQ_LPF_HZ, corner); m.set(hp ? MFX_EQ_HPF_SLOPE : MFX_EQ_LPF_SLOPE, slope); }
      if (off <= tOff && off + 128 > tOff) m.set(hp ? MFX_EQ_HPF_ON : MFX_EQ_LPF_ON, 0);
      m.process(L.data() + off, R.data() + off, 128);
    }
    const double base = clickScore(ref, 0, N), onS = clickScore(L, tOn, tOn + (int)(SR * 0.5)), offS = clickScore(L, tOff, tOff + (int)(SR * 0.5));
    char b[160];
    snprintf(b, sizeof b, "%s %d dB switching on: largest step %.3f of the tone's own", hp ? "high-pass" : "low-pass", slope, onS / base);
    check(onS < base * 1.15, b, onS / base);
    snprintf(b, sizeof b, "%s %d dB switching off: largest step %.3f of the tone's own", hp ? "high-pass" : "low-pass", slope, offS / base);
    check(offS < base * 1.15, b, offS / base);
  }
  // Changing slope while it runs, and corner and resonance moved while it runs.
  {
    const int N = (int)SR * 3;
    std::vector<float> L((size_t)N), R((size_t)N);
    for (int i = 0; i < N; i++) L[(size_t)i] = R[(size_t)i] = (float)(0.5 * std::sin(2 * PI_ * 2000 * i / SR));
    std::vector<float> ref = L;
    MixFx m(SR); m.set(MFX_TAU, 0.002); m.set(MFX_EQ_HPF_ON, 1); m.set(MFX_EQ_HPF_HZ, 80); m.set(MFX_EQ_HPF_SLOPE, 12);
    for (int off = 0; off < N; off += 128) {
      if (off / 128 == 600) m.set(MFX_EQ_HPF_SLOPE, 24);
      if (off / 128 == 900) { m.set(MFX_EQ_HPF_HZ, 250); m.set(MFX_EQ_HPF_Q, 1.5); }
      if (off / 128 == 1100) m.set(MFX_EQ_HPF_SLOPE, 12);
      m.process(L.data() + off, R.data() + off, 128);
    }
    const double base = clickScore(ref, 0, N), sc = clickScore(L, (int)SR / 2, N);
    char b[160]; snprintf(b, sizeof b, "slope and corner changed while running: largest step %.3f of the tone's own", sc / base);
    check(sc < base * 1.15, b, sc / base);
  }
  // A filter that has gone off is gone: afterwards the strip and the bus are the untouched ones, to the bit.
  for (int master = 0; master < 2; master++) {
    const int N = (int)SR * 4; std::vector<float> a, ar, b, br, z((size_t)N, 0.f);
    eqgolden::input(a, ar, N); b = a; br = ar;
    MixFx s1(SR), s2(SR); MasterBus m1(SR), m2(SR);
    for (int off = 0; off < N; off += 128) {
      const int blk = off / 128;
      if (blk == 20) { const double on[M_N] = {0, 0, 1000, 0, 120, 8000, 0.9, 1, 120, 3, 24, 1, 6000, 5, 24, 0, 3000, 0.9};
        if (master) setMaster(m2, on); else setStrip(s2, on); }
      if (blk == 300) { const double off_[M_N] = {0, 0, 1000, 0, 120, 8000, 0.9, 0, 120, 3, 24, 0, 6000, 5, 24, 0, 3000, 0.9};
        if (master) setMaster(m2, off_); else setStrip(s2, off_); }
      if (master) { m1.process(a.data() + off, ar.data() + off, z.data() + off, z.data() + off, 128); m2.process(b.data() + off, br.data() + off, z.data() + off, z.data() + off, 128); }
      else { s1.process(a.data() + off, ar.data() + off, 128); s2.process(b.data() + off, br.data() + off, 128); }
    }
    int diff = 0; for (int i = (int)SR * 2; i < N; i++) if (a[(size_t)i] != b[(size_t)i] || ar[(size_t)i] != br[(size_t)i]) diff++;
    check(diff == 0, master ? "the bus, after its filters were on and went off, is the untouched bus again, to the bit" : "a strip, after its filters were on and went off, is the untouched strip again, to the bit", diff);
  }
  // Settings at their limits, swept hard with the filters on and off: stays finite and bounded.
  for (int master = 0; master < 2; master++) {
    Lcg g; MixFx s(SR); MasterBus m(SR);
    const int N = (int)SR * 6; std::vector<float> L, R, z((size_t)N, 0.f); eqgolden::input(L, R, N);
    bool ok = true; float peak = 0; double mm[M_N];
    for (int off = 0; off < N; off += 128) {
      if ((off / 128) % 7 == 0) { randomModel(g, mm, master); if (master) setMaster(m, mm); else setStrip(s, mm); }
      if (master) m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, 128); else s.process(L.data() + off, R.data() + off, 128);
      for (int i = 0; i < 128; i++) { const float v = std::fabs(L[(size_t)(off + i)]); if (!std::isfinite(v)) ok = false; peak = std::max(peak, v); }
    }
    check(ok && peak < 8.0f, master ? "random sweeps of all six bands on the bus stay finite and bounded" : "random sweeps of all five bands on a strip stay finite and bounded", peak);
  }

  // ── Cost ──
  // One second of stereo audio at 48 kHz through the worst case: high-pass and low-pass
  // both 24 dB (four biquads), three bands moved off flat; the master adds its second
  // peak (nine biquads). The same second through the same engine with the EQ flat is
  // taken off, so what is left is the EQ's.
  {
    const int N = 48000; std::vector<float> L0, R0, z((size_t)N, 0.f); eqgolden::input(L0, R0, N);
    const double worst[M_N] = {4, -3, 800, 5, 150, 7000, 1.2, 1, 90, 2, 24, 1, 9000, 2, 24, 3, 2500, 1.5};
    auto stripRun = [&](const double* mdl) { return bestSeconds([&] { MixFx m(SR); if (mdl) setStrip(m, mdl);
      std::vector<float> L = L0, R = R0; for (int off = 0; off + 128 <= N; off += 128) m.process(L.data() + off, R.data() + off, 128); }); };
    auto busRun = [&](const double* mdl) { return bestSeconds([&] { MasterBus m(SR); if (mdl) setMaster(m, mdl);
      std::vector<float> L = L0, R = R0; for (int off = 0; off + 128 <= N; off += 128) m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, 128); }); };
    const double flat[M_N] = {0, 0, 1000, 0, 120, 8000, 0.9, 0, 80, EQP_Q2, 12, 0, 12000, EQP_Q2, 12, 0, 3000, 0.9};
    const double s0 = stripRun(flat), s1 = stripRun(worst), b0 = busRun(flat), b1 = busRun(worst);
    const double sd = std::max(0.0, s1 - s0), bd = std::max(0.0, b1 - b0);
    printf("      cost, one second of stereo at 48 kHz, worst case, on this machine (best of 5):\n");
    printf("        a strip   : EQ flat %.2f ms, EQ worst case %.2f ms: the EQ is %.3f ms = %.3f%% of one core (7 biquads a channel)\n", s0 * 1e3, s1 * 1e3, sd * 1e3, sd * 100);
    printf("        the bus   : EQ flat %.2f ms, EQ worst case %.2f ms: the EQ is %.3f ms = %.3f%% of one core (9 biquads a channel)\n", b0 * 1e3, b1 * 1e3, bd * 1e3, bd * 100);
    printf("        nine strips and the bus all the way on: %.2f%% of one core\n", (9 * sd + bd) * 100);
    check(9 * sd + bd < 0.02, "nine strips and the bus, every EQ at its worst, cost under 2% of one core", (9 * sd + bd) * 100);
  }
  // A ringing filter, then silence. Resonant filters, 24 dB, Q 10: the state decays and,
  // left alone, ends in denormal numbers (measured: a 100 Hz Q 10 low-pass pair's state
  // is denormal by the 50th second of silence). Apple Silicon runs them at full speed,
  // so the timing line shows no penalty either way here; an Intel Mac (Mac Catalyst)
  // does not, which is why the stage flushes its state (eqpass.h). The first and the
  // last second of silence must cost the same, no denormal may come out, and the tail
  // ends at exact zero.
  {
    const int N = 48000; std::vector<float> L((size_t)N), R((size_t)N);
    MixFx m(SR); m.set(MFX_EQ_LPF_ON, 1); m.set(MFX_EQ_LPF_HZ, 1000); m.set(MFX_EQ_LPF_Q, 10); m.set(MFX_EQ_LPF_SLOPE, 24);
    m.set(MFX_EQ_HPF_ON, 1); m.set(MFX_EQ_HPF_HZ, 20); m.set(MFX_EQ_HPF_Q, 10); m.set(MFX_EQ_HPF_SLOPE, 24);
    m.set(MFX_EQ_LO, 6); m.set(MFX_EQ_LO_HZ, 40); m.set(MFX_EQ_MID, 12); m.set(MFX_EQ_MID_HZ, 200); m.set(MFX_EQ_MID_Q, 8);
    srand(3); for (int i = 0; i < N; i++) L[(size_t)i] = R[(size_t)i] = (float)((rand() / (double)RAND_MAX - 0.5));
    for (int off = 0; off + 128 <= N; off += 128) m.process(L.data() + off, R.data() + off, 128);
    double first = 0, last = 0; long denorm = 0, nonzeroAtEnd = 0;
    for (int sec = 0; sec < 90; sec++) {
      std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
      const auto t0 = std::chrono::steady_clock::now();
      for (int off = 0; off + 128 <= N; off += 128) m.process(L.data() + off, R.data() + off, 128);
      const double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      if (sec == 0) first = dt; if (sec == 89) last = dt;
      for (int i = 0; i < N; i++) { const float v = std::fabs(L[(size_t)i]); if (v != 0 && v < 1.17549435e-38f) denorm++; if (sec == 89 && v != 0) nonzeroAtEnd++; }
    }
    printf("      ring-down: first second of silence %.2f ms, the 90th %.2f ms\n", first * 1e3, last * 1e3);
    check(denorm == 0, "no denormal number comes out of a ringing filter's tail (90 s of silence)", (double)denorm);
    check(nonzeroAtEnd == 0, "the tail has reached exact zero by the 90th second of silence", (double)nonzeroAtEnd);
    check(last < first * 1.5 + 1e-4, "the 90th second of silence costs no more than the first", last / std::max(first, 1e-9));
  }
  printf("%s\n", fails ? "FAIL" : "all passed");
  return fails ? 1 : 0;
}
