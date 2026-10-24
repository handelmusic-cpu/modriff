// The mixer strip, measured: the level it settles at, that a move is smooth
// rather than a step, that mute is exactly silent, that the meter reads the
// loudest block since it was last asked, and the pan: centre is unity, hard
// left and right put the signal in one channel, a move ramps, and the
// compensation is the web's law.
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

  // ---- pan -------------------------------------------------------------
  // The web's law, written out independently of strip.h: a StereoPannerNode on
  // a stereo input (Web Audio spec) times 1/sqrt(1+sin(|pan|*pi/2)).
  const double kPi = 3.14159265358979323846;
  auto webComp = [&](double p) { return 1.0 / std::sqrt(1.0 + std::sin(std::fabs(p) * kPi / 2)); };
  auto webPan = [&](double p, double l, double r, double* ol, double* orr) {
    const double x = (p <= 0 ? p + 1.0 : p) * kPi / 2, gl = std::cos(x), gr = std::sin(x);
    if (p <= 0) { *ol = l + r * gl; *orr = r * gr; }
    else        { *ol = l * gl;     *orr = r + l * gr; }
    *ol *= webComp(p); *orr *= webComp(p);
  };
  // Settle a strip at a pan on a constant block and return its last sample.
  auto settle = [&](Strip& s, double p, double l, double r, double* ol, double* orr) {
    s.setPan(p);
    for (int b = 0; b < 80; b++) {
      for (int i = 0; i < N; i++) { L[i] = (float)l; R[i] = (float)r; }
      s.applyPan(L.data(), R.data(), N);
    }
    *ol = L[N - 1]; *orr = R[N - 1];
  };

  // Centre is unity, exactly: an untouched pan changes no bit, and a pan that
  // has come back to centre does too.
  {
    Strip s(sr);
    std::vector<float> ref(N);
    sine(0.7); for (int i = 0; i < N; i++) ref[i] = L[i];
    s.applyPan(L.data(), R.data(), N);
    bool same = true; for (int i = 0; i < N; i++) if (L[i] != ref[i] || R[i] != ref[i]) same = false;
    check(same, "centre pan passes the signal bit for bit", same);

    double ol, orr; settle(s, 0.6, 0.3, 0.3, &ol, &orr);
    s.setPan(0.0);
    for (int b = 0; b < 80; b++) { sine(0.7); s.applyPan(L.data(), R.data(), N); }
    same = true; for (int i = 0; i < N; i++) if (L[i] != ref[i] || R[i] != ref[i]) same = false;
    check(same && s.pan() == 0.0, "a pan moved away and back is unity again, bit for bit", s.pan());
  }

  // Hard left and hard right put the signal in one channel. Dual mono 1.0
  // folds to 2.0 on the live side and the compensation takes it to sqrt(2).
  {
    Strip s(sr); double ol, orr;
    settle(s, -1.0, 1.0, 1.0, &ol, &orr);
    check(std::fabs(ol - std::sqrt(2.0)) < 1e-6 && orr == 0.0, "hard left: all in the left channel at sqrt(2)", ol);
    check(orr == 0.0, "hard left: right channel is silent", orr);
    Strip t(sr);
    settle(t, 1.0, 1.0, 1.0, &ol, &orr);
    check(std::fabs(orr - std::sqrt(2.0)) < 1e-6, "hard right: all in the right channel at sqrt(2)", orr);
    check(std::fabs(ol) < 1e-6, "hard right: left channel is silent", ol);
    // A left-only source panned hard right is carried across to the right
    // alone, at the compensated unity (1/sqrt(2)).
    Strip u(sr); settle(u, 1.0, 1.0, 0.0, &ol, &orr);
    check(std::fabs(orr - std::sqrt(0.5)) < 1e-6 && std::fabs(ol) < 1e-6, "hard right carries a left-only signal across", orr);
  }

  // The compensation matches the web's law at a spread of positions, for dual
  // mono and for a stereo pair, and for dual mono the power is the centre's.
  {
    double worst = 0, worstPow = 0;
    const double pans[] = {-1, -0.75, -0.5, -0.25, -0.1, 0.1, 0.25, 0.5, 0.75, 1};
    for (double p : pans) {
      Strip s(sr); double ol, orr, wl, wr;
      settle(s, p, 1.0, 1.0, &ol, &orr);
      webPan(p, 1.0, 1.0, &wl, &wr);
      worst = std::fmax(worst, std::fmax(std::fabs(ol - wl), std::fabs(orr - wr)));
      worstPow = std::fmax(worstPow, std::fabs(ol * ol + orr * orr - 2.0));
      Strip t(sr); settle(t, p, 0.8, -0.3, &ol, &orr);
      webPan(p, 0.8, -0.3, &wl, &wr);
      worst = std::fmax(worst, std::fmax(std::fabs(ol - wl), std::fabs(orr - wr)));
    }
    check(worst < 1e-6, "pan and compensation match the web law at ten positions", worst);
    check(worstPow < 1e-5, "dual mono keeps the centre's power at every position", worstPow);
    check(std::fabs(webComp(0.0) - 1.0) == 0.0 && std::fabs(webComp(-1.0) - 1.0 / std::sqrt(2.0)) < 1e-12,
          "compensation is 1 at centre and 1/sqrt(2) at the sides", webComp(-1.0));
  }

  // A pan move is a ramp. Centre to hard right on dual mono: the right channel
  // goes 1 -> sqrt(2), the left 1 -> 0; no sample may jump by more than the
  // one-pole's step times the law's steepest slope, and it must arrive.
  {
    Strip s(sr);
    s.setPan(1.0);
    double worst = 0, pl = 1.0, pr = 1.0;
    for (int b = 0; b < 80; b++) {
      for (int i = 0; i < N; i++) L[i] = R[i] = 1.0f;
      s.applyPan(L.data(), R.data(), N);
      for (int i = 0; i < N; i++) {
        worst = std::fmax(worst, std::fmax(std::fabs(pl - L[i]), std::fabs(pr - R[i])));
        pl = L[i]; pr = R[i];
      }
    }
    const double a = 1.0 - std::exp(-1.0 / (0.008 * sr));
    check(worst <= 2.0 * a, "a pan step is a ramp, not a click", worst);
    check(worst > 0.0 && std::fabs(s.pan() - 1.0) < 1e-6, "the ramp arrives at the target", s.pan());
  }

  // Level and pan are separate stages and compose: -6 dB then hard left is
  // -6 dB on the compensated side.
  {
    Strip s(sr);
    s.setLevel(0.5); s.setPan(-1.0);
    for (int b = 0; b < 80; b++) {
      for (int i = 0; i < N; i++) L[i] = R[i] = 1.0f;
      s.gain(L.data(), R.data(), N); s.applyPan(L.data(), R.data(), N);
    }
    check(std::fabs(L[N - 1] - 0.5 * std::sqrt(2.0)) < 1e-5 && R[N - 1] == 0.0, "level and pan compose", L[N - 1]);
  }

  // Garbage pans are centre or the nearest edge, never NaN into the audio.
  {
    Strip s(sr);
    s.setPan(NAN);
    double ol, orr; settle(s, NAN, 1.0, 1.0, &ol, &orr);
    check(ol == 1.0 && orr == 1.0, "a NaN pan is centre", ol);
    Strip t(sr); settle(t, 5.0, 1.0, 1.0, &ol, &orr);
    check(std::fabs(t.pan() - 1.0) < 1e-9, "a pan past the edge clamps to 1", t.pan());
  }

  printf("%s\n", fails ? "FAIL" : "all passed");
  return fails ? 1 : 0;
}
