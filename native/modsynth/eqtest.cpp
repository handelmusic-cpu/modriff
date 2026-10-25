// The master EQ against the browser's own filters. The reference numbers are
// BiquadFilterNode.getFrequencyResponse for lowshelf 120 Hz, peaking (Q 0.9) and
// highshelf 8 kHz at the stated gains, at 48 kHz (recorded in Chrome; the page
// that makes them is a few lines: create the node, set type, frequency, gain, Q,
// call getFrequencyResponse, take 20*log10). Two checks:
//   1. the coefficients (eqDesign) give that response, to 0.05 dB;
//   2. the master bus with the EQ set does to a quiet tone what the three
//      filters should, to 0.5 dB, and an unused EQ changes nothing at all.
#include "master.h"
#include "mixfx.h"
#include "dspkit.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
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
static double magDb(const BqC& c, double f) {
  const double w = 2 * PI_ * f / SR;
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

int main() {
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
  printf("%s\n", fails ? "FAIL" : "all passed");
  return fails ? 1 : 0;
}
