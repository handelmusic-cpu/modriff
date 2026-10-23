// The mixer strip, measured: the level it settles at, that a move is smooth
// rather than a step, that mute is exactly silent, and that the meter reads
// the loudest block since it was last asked.
#include "strip.h"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace modsynth;

static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.6g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}

int main() {
  const double sr = 48000;
  const int N = 128;
  std::vector<float> L(N), R(N);
  auto sine = [&](double amp) { for (int i = 0; i < N; i++) L[i] = R[i] = (float)(amp * std::sin(0.05 * i)); };
  auto peak = [&]() { float m = 0; for (float x : L) m = std::fmax(m, std::fabs(x)); return m; };

  // −6 dB, settled: 1.0 in, 0.5012 out.
  {
    Strip s(sr);
    s.setLevel(std::pow(10.0, -6.0 / 20));
    for (int b = 0; b < 40; b++) { sine(1.0); s.process(L.data(), R.data(), N); }
    const double db = 20 * std::log10(peak());
    check(std::fabs(db + 6.0) < 0.05, "fader at -6 dB measures -6 dB at the strip", db);
  }

  // A step of the target is a ramp: no single-sample jump bigger than the
  // smoother allows (a one-pole moves at most a*|step| per sample).
  {
    Strip s(sr);
    s.setLevel(0.0);
    double worst = 0, prev = 1.0;
    for (int b = 0; b < 20; b++) {
      for (int i = 0; i < N; i++) L[i] = R[i] = 1.0f;
      s.process(L.data(), R.data(), N);
      for (int i = 0; i < N; i++) { worst = std::fmax(worst, std::fabs(prev - L[i])); prev = L[i]; }
    }
    const double a = 1.0 - std::exp(-1.0 / (0.008 * sr));
    check(worst <= a * 1.01, "a fader step is a ramp, not a click", worst);
  }

  // Mute ends in exact silence, not a tail that never arrives.
  {
    Strip s(sr);
    s.setLevel(0.0);
    for (int b = 0; b < 80; b++) { sine(1.0); s.process(L.data(), R.data(), N); }
    check(peak() == 0.0f, "mute is exactly silent after the ramp", peak());
  }

  // Coming back up from mute settles at the target.
  {
    Strip s(sr);
    s.setLevel(0.0);
    for (int b = 0; b < 80; b++) { sine(1.0); s.process(L.data(), R.data(), N); }
    s.setLevel(0.75);
    for (int b = 0; b < 80; b++) { sine(1.0); s.process(L.data(), R.data(), N); }
    check(std::fabs(s.level() - 0.75) < 1e-6, "unmute settles at the level", s.level());
  }

  // The meter keeps the loudest block between reads, then resets.
  {
    Strip s(sr);
    s.setLevel(1.0);
    sine(0.8); s.process(L.data(), R.data(), N);      // loud
    sine(0.01); s.process(L.data(), R.data(), N);     // quiet, later
    const float r1 = s.takeRms();
    const float r2 = s.takeRms();
    const double want = 0.8 / std::sqrt(2.0);          // RMS of a sine
    check(std::fabs(r1 - want) < 0.02, "meter reads the loudest block since the last read", r1);
    check(r2 == 0.0f, "reading the meter resets it", r2);
  }

  // Unity is the identity (a strip nobody has touched changes nothing).
  {
    Strip s(sr);
    std::vector<float> ref(N);
    sine(0.7); for (int i = 0; i < N; i++) ref[i] = L[i];
    s.process(L.data(), R.data(), N);
    bool same = true; for (int i = 0; i < N; i++) if (L[i] != ref[i]) same = false;
    check(same, "an untouched strip passes the signal bit for bit", same);
  }

  printf("%s\n", fails ? "FAIL" : "all passed");
  return fails ? 1 : 0;
}
