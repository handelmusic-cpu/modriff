// The mõdFX chain, measured stage by stage: each knob does what it says, the
// clean and chain halves of the Mix line up, nothing blows up at random
// settings, and what it costs. Not a null test (see mixfx.h).
#include "mixfx.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace modsynth;

static const double SR = 48000;
static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.4g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}

// Chain with the stated parameters, a sine of `hz` run through it, and the
// amplitude of that same frequency in the second half of the output (Goertzel).
struct P { int i; double v; };
static MixFx* make(std::initializer_list<P> ps) {
  MixFx* m = new MixFx(SR);
  m->set(MFX_TAU, 0.002); m->set(MFX_ACTIVE, 1);
  for (auto& p : ps) m->set(p.i, p.v);
  return m;
}
static double amp(const std::vector<float>& x, double hz) {
  const size_t a = x.size() / 2;
  double re = 0, im = 0;
  for (size_t i = a; i < x.size(); i++) {
    const double w = 2 * M_PI * hz * (double)i / SR;
    re += x[i] * std::cos(w); im += x[i] * std::sin(w);
  }
  return 2 * std::sqrt(re * re + im * im) / (double)(x.size() - a);
}
static std::vector<float> run(MixFx* m, double hz, double a, int seconds = 1, bool stereoSame = true) {
  const int N = (int)(SR * seconds);
  std::vector<float> L(N), R(N);
  for (int i = 0; i < N; i++) { L[i] = (float)(a * std::sin(2 * M_PI * hz * i / SR)); R[i] = stereoSame ? L[i] : 0; }
  for (int off = 0; off < N; off += 128) m->process(L.data() + off, R.data() + off, std::min(128, N - off));
  return L;
}
static double db(double x) { return 20 * std::log10(std::max(x, 1e-12)); }

int main() {
  // 1. Out of circuit it is the clean part, delayed, and nothing else.
  {
    MixFx m(SR);                                  // MFX_ACTIVE defaults to 0
    std::vector<float> L(256, 0.f), R(256, 0.f); L[10] = R[10] = 1.f;
    m.process(L.data(), R.data(), 256);
    int at = -1; for (int i = 0; i < 256; i++) if (L[i] > 0.99f) at = i;
    check(at > 10 && at < 20 && std::fabs(L[at] - 1.f) < 1e-6, "idle: the clean part, delayed a few samples", at - 10);
  }
  // 2. Neutral chain: flat, and the Mix halves line up (no comb at Mix 0.5).
  for (double mix : {1.0, 0.5}) {
    for (double hz : {200.0, 1000.0, 5000.0}) {
      MixFx* m = make({{MFX_MIX, mix}});
      const double g = db(amp(run(m, hz, 0.3, 2), hz) / 0.3);
      char b[120]; snprintf(b, sizeof b, "neutral chain at mix %.1f is flat at %.0f Hz", mix, hz);
      check(std::fabs(g) < 0.6, b, g); delete m;
    }
  }
  // 3. Low-pass and high-pass: two biquads each, so 24 dB/octave.
  {
    MixFx* m = make({{MFX_LP_HZ, 1000}});
    const double pass = db(amp(run(m, 200, 0.3, 2), 200) / 0.3);
    delete m; m = make({{MFX_LP_HZ, 1000}});
    const double stop = db(amp(run(m, 4000, 0.3, 2), 4000) / 0.3);
    check(std::fabs(pass) < 0.7 && stop < -35, "low-pass at 1 kHz: 200 Hz passes, 4 kHz is 35 dB down", stop); delete m;
    m = make({{MFX_HP_HZ, 1000}});
    const double stop2 = db(amp(run(m, 100, 0.3, 2), 100) / 0.3);
    check(stop2 < -35, "high-pass at 1 kHz: 100 Hz is 35 dB down", stop2); delete m;
  }
  // 4. Resonance: Q in dB at the corner raises it.
  {
    MixFx* m = make({{MFX_LP_HZ, 1000}, {MFX_LP_Q, 12}});
    const double peak = db(amp(run(m, 1000, 0.1, 2), 1000) / 0.1);
    check(peak > 6, "low-pass resonance lifts the corner", peak); delete m;
  }
  // 5. Drive: more harmonics, and the level the page's gains hold it to. The
  // page sets wet = amount / mk and dry = 1 - amount, mk being the curve's RMS
  // gain on a 0.2-amplitude sine (_curveRmsGain), so the same sum is made here.
  {
    const double amt = 0.6, k = amt * 90;
    double inS = 0, outS = 0;
    for (int i = 0; i < 1024; i++) { const double x = 0.2 * std::sin(2 * M_PI * i / 1024), y = x * (k + 1) / (1 + k * std::fabs(x)); inS += x * x; outS += y * y; }
    const double mk = std::sqrt(outS / inS);
    MixFx* m = make({{MFX_DRV_AMT, amt}, {MFX_DRV_WET, amt / mk}, {MFX_DRV_DRY, 1 - amt}});
    auto y = run(m, 500, 0.2, 2);
    const double f = amp(y, 500), h3 = amp(y, 1500), h5 = amp(y, 2500);
    check(h3 / f > 0.03 && h5 / f > 0.005, "drive adds odd harmonics", h3 / f);
    delete m; m = make({});
    auto yc = run(m, 500, 0.2, 2);
    double e = 0, ec = 0;
    for (size_t i = y.size() / 2; i < y.size(); i++) { e += (double)y[i] * y[i]; ec += (double)yc[i] * yc[i]; }
    check(std::fabs(10 * std::log10(e / ec)) < 3, "driven level is within 3 dB of clean", 10 * std::log10(e / ec)); delete m;
    m = make({{MFX_DRV_AMT, 0}, {MFX_DRV_WET, 0}, {MFX_DRV_DRY, 1}});
    const double g = db(amp(run(m, 800, 0.3, 2), 800) / 0.3);
    check(std::fabs(g) < 0.6, "drive at zero changes nothing", g); delete m;
  }
  // 6. Isolator: only the chosen band survives.
  {
    MixFx* m = make({{MFX_ISO_WET, 1}, {MFX_ISO_DRY, 0}, {MFX_ISO_LO, 1}, {MFX_ISO_MID, 0}, {MFX_ISO_HI, 0}});
    const double lo = db(amp(run(m, 80, 0.3, 2), 80) / 0.3);
    delete m; m = make({{MFX_ISO_WET, 1}, {MFX_ISO_DRY, 0}, {MFX_ISO_LO, 1}, {MFX_ISO_MID, 0}, {MFX_ISO_HI, 0}});
    const double hi = db(amp(run(m, 8000, 0.3, 2), 8000) / 0.3);
    check(lo > -3 && hi < -25, "isolator, low only: 80 Hz stays, 8 kHz goes", hi); delete m;
  }
  // 7. Talk filter: a formant resonates, the rest is thinned.
  {
    MixFx* m = make({{MFX_FMT_WET, 1}, {MFX_FMT_DRY, 0}});
    const double at = amp(run(m, 700, 0.1, 2), 700), off = (delete m, amp(run(m = make({{MFX_FMT_WET, 1}, {MFX_FMT_DRY, 0}}), 4000, 0.1, 2), 4000));
    check(at > off * 10, "talk filter: 700 Hz formant over 4 kHz", at / std::max(off, 1e-9)); delete m;
  }
  // 8. Gate shuts, tremolo moves the level, ring mod makes sidebands.
  {
    MixFx* m = make({{MFX_GATE, 0}});
    const double g = amp(run(m, 600, 0.3, 2), 600);
    check(g < 1e-4, "gate at zero is silent", g); delete m;
    m = make({{MFX_TREM_BASE, 0.5}, {MFX_TREM_DEPTH, 0.5}, {MFX_TREM_HZ, 5}});
    auto y = run(m, 600, 0.3, 2);
    float mn = 9, mx = -9; for (size_t i = y.size() / 2; i < y.size(); i++) { mn = std::min(mn, std::fabs(y[i])); }
    // envelope: compare block peaks
    double lo = 9, hi = 0;
    for (size_t b = y.size() / 2; b + 480 < y.size(); b += 480) { double pk = 0; for (int i = 0; i < 480; i++) pk = std::max(pk, (double)std::fabs(y[b + i])); lo = std::min(lo, pk); hi = std::max(hi, pk); }
    (void)mn; (void)mx;
    check(hi / std::max(lo, 1e-9) > 3, "tremolo swings the level", hi / std::max(lo, 1e-9)); delete m;
    m = make({{MFX_RING_HZ, 200}, {MFX_RING_WET, 1}, {MFX_RING_DRY, 0}});
    auto r = run(m, 1000, 0.3, 2);
    const double s1 = amp(r, 800), s2 = amp(r, 1200), c = amp(r, 1000);
    check(s1 > 0.05 && s2 > 0.05 && c < 0.01, "ring mod: sidebands at 800 and 1200, none at 1000", c); delete m;
  }
  // 9. Pan: a stereo input panned hard left leaves the right empty (the spec's panner).
  {
    MixFx* m = make({{MFX_PAN, -1}});
    const int N = 48000; std::vector<float> L(N), R(N);
    for (int i = 0; i < N; i++) L[i] = R[i] = (float)(0.2 * std::sin(0.05 * i));
    for (int off = 0; off < N; off += 128) m->process(L.data() + off, R.data() + off, 128);
    double el = 0, er = 0; for (int i = N / 2; i < N; i++) { el += L[i] * L[i]; er += R[i] * R[i]; }
    check(er < el * 1e-4 && el > 0, "pan hard left: the right channel is empty", er / el); delete m;
  }
  // 10. Delay: an impulse comes back at the delay time.
  {
    MixFx* m = make({{MFX_DLY_SEND, 1}, {MFX_DLY_TIME, 0.1}, {MFX_DLY_FB, 0}});
    const int N = 24000; std::vector<float> L(N, 0.f), R(N, 0.f); L[1000] = R[1000] = 1.f;
    for (int off = 0; off < N; off += 128) m->process(L.data() + off, R.data() + off, std::min(128, N - off));
    int best = 0; for (int i = 1500; i < N; i++) if (std::fabs(L[i]) > std::fabs(L[best])) best = i;
    if (std::fabs(L[best]) < 0.2) best = 0;
    for (int i = 1500; i < N; i++) if (std::fabs(L[i]) > std::fabs(L[best])) best = i;
    const double ms = (best - 1006) / SR * 1000;     // 1000 + the 6-sample latency
    check(std::fabs(ms - 100) < 0.5 && L[best] > 0.5, "delay: the echo lands at the delay time", ms); delete m;
    m = make({{MFX_DLY_SEND, 1}, {MFX_DLY_TIME, 0.05}, {MFX_DLY_FB, 0.8}});
    std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); L[1000] = R[1000] = 1.f;
    for (int off = 0; off < N; off += 128) m->process(L.data() + off, R.data() + off, std::min(128, N - off));
    int echoes = 0; for (int i = 1500; i < N; i++) if (std::fabs(L[i]) > 0.1 * 0.8 && std::fabs(L[i]) > std::fabs(L[i - 1]) && std::fabs(L[i]) >= std::fabs(L[i + 1])) echoes++;
    check(echoes >= 3, "delay feedback repeats", echoes); delete m;
  }
  // 11. Reverb: a tail, and it dies in about the room's time.
  {
    MixFx* m = make({{MFX_REV_SEND, 1.25}, {MFX_DRY, 0.12}});
    const int N = (int)(SR * 6); std::vector<float> L(N, 0.f), R(N, 0.f);
    for (int i = 0; i < 4800; i++) L[i] = R[i] = (float)(0.3 * std::sin(0.07 * i));
    for (int off = 0; off < N; off += 128) m->process(L.data() + off, R.data() + off, std::min(128, N - off));
    auto rms = [&](double a, double b) { double e = 0; int c = 0; for (int i = (int)(a * SR); i < (int)(b * SR); i++) { e += L[i] * L[i]; c++; } return std::sqrt(e / c); };
    const double early = rms(0.15, 0.4), late = rms(3.8, 4.8);
    check(early > 1e-3 && db(late / early) < -40, "reverb: a tail that is gone by 4 s", db(late / early)); delete m;
  }
  // 12. Mix 0 is the clean part; the chain comes in and out without a step.
  {
    MixFx* m = make({{MFX_MIX, 0}, {MFX_LP_HZ, 300}, {MFX_GATE, 0}});
    const double g = db(amp(run(m, 4000, 0.3, 2), 4000) / 0.3);
    check(std::fabs(g) < 0.2, "mix at zero: the part is untouched by the chain", g); delete m;
    m = new MixFx(SR);                             // idle → active mid-stream: no click bigger than the signal
    m->set(MFX_TAU, 0.02);
    const int N = 48000; std::vector<float> L(N), R(N);
    for (int i = 0; i < N; i++) L[i] = R[i] = (float)(0.3 * std::sin(2 * M_PI * 300 * i / SR));
    for (int off = 0; off < N; off += 128) {
      if (off == 24064) { m->set(MFX_ACTIVE, 1); }
      m->process(L.data() + off, R.data() + off, 128);
    }
    double worst = 0; for (int i = 1; i < N; i++) worst = std::max(worst, (double)std::fabs(L[i] - L[i - 1]));
    check(worst < 0.3 * 2 * M_PI * 300 / SR * 1.5, "going in circuit: no step in the signal", worst); delete m;
  }
  // 13. Fuzz: random settings stay finite and bounded.
  {
    srand(7); int bad = 0; double peak = 0;
    for (int trial = 0; trial < 60; trial++) {
      MixFx m(SR); m.set(MFX_ACTIVE, 1);
      const struct { int i; double lo, hi; } r[] = {
        {MFX_MIX, 0, 1}, {MFX_TAU, 0.002, 0.6}, {MFX_LP_HZ, 60, 18000}, {MFX_LP_Q, 0.7, 28.7}, {MFX_HP_HZ, 20, 8000}, {MFX_HP_Q, 0.7, 20.7},
        {MFX_DRV_AMT, 0, 1}, {MFX_DRV_WET, 0, 2}, {MFX_DRV_DRY, 0, 1}, {MFX_ISO_WET, 0, 1}, {MFX_ISO_DRY, 0, 1}, {MFX_ISO_LO, 0, 1}, {MFX_ISO_MID, 0, 1}, {MFX_ISO_HI, 0, 1},
        {MFX_FMT_WET, 0, 1}, {MFX_FMT_DRY, 0, 1}, {MFX_FMT1_HZ, 300, 800}, {MFX_FMT2_HZ, 800, 2000}, {MFX_GATE, 0, 1},
        {MFX_TREM_BASE, 0, 1}, {MFX_TREM_DEPTH, 0, 1}, {MFX_TREM_HZ, 0.1, 30}, {MFX_PAN, -1, 1}, {MFX_RING_HZ, 18, 830}, {MFX_RING_WET, 0, 1}, {MFX_RING_DRY, 0, 1},
        {MFX_DLY_SEND, 0, 1.15}, {MFX_DLY_TIME, 0.01, 3.9}, {MFX_DLY_FB, 0, 0.95}, {MFX_REV_SEND, 0, 1.25}, {MFX_DRY, 0.12, 1}};
      for (auto& q : r) m.set(q.i, q.lo + (q.hi - q.lo) * (rand() / (double)RAND_MAX));
      std::vector<float> L(48000), R(48000);
      for (int i = 0; i < 48000; i++) L[i] = R[i] = (float)(0.5 * std::sin(0.03 * i * (1 + 0.0002 * i)) + 0.2 * ((rand() / (double)RAND_MAX) - .5));
      for (int off = 0; off < 48000; off += 97) {                       // an odd block size on purpose
        if (off % 9700 == 0) for (auto& q : r) m.set(q.i, q.lo + (q.hi - q.lo) * (rand() / (double)RAND_MAX));
        m.process(L.data() + off, R.data() + off, std::min(97, 48000 - off));
      }
      for (int i = 0; i < 48000; i++) { if (!std::isfinite(L[i]) || !std::isfinite(R[i])) bad++; peak = std::max(peak, (double)std::fabs(L[i])); }
    }
    check(bad == 0 && peak < 60, "60 random settings, knobs moved mid-run: finite and bounded", peak);
  }
  // 14. Cost, everything on, per second of audio.
  {
    MixFx m(SR); m.set(MFX_ACTIVE, 1);
    m.set(MFX_DRV_AMT, 0.5); m.set(MFX_DRV_WET, 0.4); m.set(MFX_DRV_DRY, 0.5); m.set(MFX_ISO_WET, 1); m.set(MFX_ISO_DRY, 0); m.set(MFX_ISO_LO, 1); m.set(MFX_ISO_MID, 1); m.set(MFX_ISO_HI, 1);
    m.set(MFX_FMT_WET, 1); m.set(MFX_FMT_DRY, 0); m.set(MFX_RING_WET, 1); m.set(MFX_RING_DRY, 0); m.set(MFX_DLY_SEND, 0.8); m.set(MFX_DLY_FB, 0.5); m.set(MFX_REV_SEND, 1); m.set(MFX_PAN, 0.3);
    std::vector<float> L(128), R(128);
    for (int i = 0; i < 128; i++) L[i] = R[i] = (float)(0.3 * std::sin(0.1 * i));
    const auto t0 = std::chrono::steady_clock::now();
    for (int b = 0; b < 375 * 4; b++) m.process(L.data(), R.data(), 128);       // 4 s of audio
    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() / 4.0;
    printf("info cost: everything on, one part: %.2f%% of a core per second of audio (this Mac)\n", secs * 100);
    check(secs < 0.1, "everything on costs under 10% of a core", secs * 100);
  }
  printf("%s\n", fails ? "FAIL" : "all passed");
  return fails ? 1 : 0;
}
