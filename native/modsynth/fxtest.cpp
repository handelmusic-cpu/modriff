// Measures the effects rack: does each stage do what its knob says, are the
// levels where fx.js's are, does anything blow up. Not a null test — Web
// Audio's biquads, compressor and convolver are not reproducible here.
#include "fxrack.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <vector>
using namespace modsynth;
static const double SR = 48000;
static int fails = 0;
#define CHECK(c, ...) do { if (!(c)) { fails++; printf("  FAIL: "); printf(__VA_ARGS__); printf("\n"); } else { printf("  ok:   "); printf(__VA_ARGS__); printf("\n"); } } while (0)
static int H(const char* id) { for (int i = 0; i < HOST_FX_COUNT; i++) if (!strcmp(HOST_FX[i].id, id)) return i; printf("no param %s\n", id); exit(2); }
static void reset(FxRack& r) { for (int i = 0; i < HOST_FX_COUNT; i++) r.set(i, HOST_FX[i].def); }
static double rms(const std::vector<float>& v, size_t a, size_t b) { double s = 0; for (size_t i = a; i < b; i++) s += (double)v[i] * v[i]; return std::sqrt(s / (double)(b - a)); }
static uint32_t rs = 12345;
static float noise() { rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5; return (float)((double)rs / 2147483648.0 - 1.0); }
// run the rack over a signal; processes in 128-frame blocks like the host
static void run(FxRack& r, std::vector<float>& L, std::vector<float>& R) {
  for (size_t o = 0; o < L.size(); o += 128) { size_t n = std::min<size_t>(128, L.size() - o); r.process(&L[o], &R[o], (int)n); }
}
static bool finite(const std::vector<float>& v, double lim) { for (float x : v) if (!std::isfinite(x) || std::fabs(x) > lim) return false; return true; }

int main() {
  printf("host params: %d\n", HOST_FX_COUNT);
  const size_t N = (size_t)(SR * 4);

  printf("all off: master volume and nothing else\n");
  { FxRack r(SR); reset(r); std::vector<float> L(N), R(N); for (size_t i = 0; i < N; i++) L[i] = R[i] = 0.1f * noise();
    std::vector<float> L0 = L; run(r, L, R);
    double g = rms(L, 48000, N) / rms(L0, 48000, N);
    CHECK(std::fabs(g - 0.8) < 0.01, "gain with everything off = %.4f (master.vol default 0.8)", g); }

  printf("reverb: on at mix 0.5\n");
  { FxRack r(SR); reset(r); r.set(H("fx.reverb.on"), 1); r.set(H("fx.reverb.mix"), 0.5);
    std::vector<float> L(N), R(N); for (size_t i = 0; i < N; i++) L[i] = R[i] = 0.1f * noise();
    run(r, L, R);
    double out = rms(L, 96000, N), dry = 0.1 * 0.8 / std::sqrt(3.0);
    printf("       out rms %.4f, dry alone %.4f, wet ≈ %.4f\n", out, dry, std::sqrt(std::max(0.0, out * out - dry * dry)));
    // What Web Audio's normalised convolver gives on white noise: about
    // 0.00125 * (44100/sr) * sqrt(IR samples), times the stage's own 1.4 * mix.
    const double irSec = 0.25 + 0.55 * 5.5, A = 0.00125 * 44100.0 / SR * std::sqrt(irSec * SR);
    const double want = 1.4 * 0.5 * A * 0.1 * 0.8 / std::sqrt(3.0), got = std::sqrt(std::max(0.0, out * out - dry * dry));
    printf("       wet %.4f against the convolver's %.4f (%.1f dB)\n", got, want, 20 * std::log10(got / want));
    CHECK(std::fabs(20 * std::log10(got / want)) < 3.0, "reverb wet level within 3 dB of the convolver it replaces");
    // tail: impulse, then measure time for energy to fall 60 dB (Schroeder backward integration)
    FxRack q(SR); reset(q); q.set(H("fx.reverb.on"), 1); q.set(H("fx.reverb.mix"), 1);
    std::vector<float> a(N, 0.f), b(N, 0.f); a[0] = b[0] = 1;
    run(q, a, b);
    std::vector<double> e(N); double acc = 0; for (long i = (long)N - 1; i >= 0; i--) { acc += (double)a[(size_t)i] * a[(size_t)i]; e[(size_t)i] = acc; }
    size_t t60 = 0; for (size_t i = 0; i < N; i++) if (10 * std::log10(e[i] / e[0]) < -30) { t60 = i; break; }
    printf("       -30 dB at %.2f s → RT60 ≈ %.2f s (size .55, decay 2.4 asks for ~2.6)\n", t60 / SR, 2 * t60 / SR);
    CHECK(2.0 * t60 / SR > 1.2 && 2.0 * t60 / SR < 4.5, "RT60 within reach of the convolver's"); }

  printf("Space macro: reverb switched OFF, a macro turning its mix up\n");
  { FxRack r(SR); reset(r); std::vector<float> L(N), R(N);
    double m[5] = {0, 0, 0.7, 0, 0}; r.setMods(m);
    for (size_t i = 0; i < N; i++) L[i] = R[i] = (i < 4800 ? 0.3f * noise() : 0.f);
    run(r, L, R);
    double tail = rms(L, 24000, 48000);
    CHECK(tail > 1e-3, "tail with Space up = %.5f (silence if the macro did nothing)", tail);
    FxRack z(SR); reset(z); std::vector<float> l2(N), r2(N); rs = 12345;
    for (size_t i = 0; i < N; i++) l2[i] = r2[i] = (i < 4800 ? 0.3f * noise() : 0.f);
    run(z, l2, r2);
    CHECK(rms(l2, 24000, 48000) < 1e-6, "same signal, macro at rest: tail = %.2g", rms(l2, 24000, 48000)); }

  printf("delay: synced 1/4 at 120 bpm should echo at 0.5 s\n");
  { FxRack r(SR); reset(r); r.setTempo(120); r.set(H("fx.delay.on"), 1); r.set(H("fx.delay.sync"), 1);
    // enum index of '1_4'
    int di = 8; r.set(H("fx.delay.div"), di); r.set(H("fx.delay.mix"), 1); r.set(H("fx.delay.fb"), 0.5);
    std::vector<float> L(N, 0.f), R(N, 0.f); L[1000] = R[1000] = 1; run(r, L, R);
    size_t pk = 0; float mx = 0; for (size_t i = 5000; i < 40000; i++) if (std::fabs(L[i]) > mx) { mx = std::fabs(L[i]); pk = i; }
    printf("       first echo at %.3f s, level %.3f\n", (pk - 1000) / SR, mx);
    CHECK(std::fabs((pk - 1000) / SR - 0.5) < 0.01, "echo time"); }

  printf("drive: a sine gets harmonics, amount 0 does not\n");
  for (int type = 0; type < 6; type++) {
    FxRack r(SR); reset(r); r.set(H("fx.drive.on"), 1); r.set(H("fx.drive.type"), type); r.set(H("fx.drive.amount"), 0.8);
    std::vector<float> L(N), R(N); for (size_t i = 0; i < N; i++) L[i] = R[i] = 0.5f * (float)std::sin(2 * M_PI * 440 * i / SR);
    run(r, L, R);
    // energy outside the fundamental: remove best-fit sine
    double sc = 0, ss = 0, cc = 0; size_t a = 24000;
    for (size_t i = a; i < N; i++) { double s = std::sin(2 * M_PI * 440 * i / SR), c = std::cos(2 * M_PI * 440 * i / SR); sc += L[i] * s; ss += L[i] * c; cc++; }
    sc *= 2 / cc; ss *= 2 / cc; double res = 0, tot = 0;
    for (size_t i = a; i < N; i++) { double s = std::sin(2 * M_PI * 440 * i / SR), c = std::cos(2 * M_PI * 440 * i / SR); double e = L[i] - sc * s - ss * c; res += e * e; tot += (double)L[i] * L[i]; }
    double thd = std::sqrt(res / tot);
    CHECK(thd > 0.02 && finite(L, 4), "drive type %d: harmonic content %.1f%% of the signal", type, thd * 100);
  }

  printf("compressor: loud input comes down, quiet is left alone\n");
  { FxRack r(SR); reset(r); r.set(H("fx.comp.on"), 1);
    auto lvl = [&](float amp) { FxRack q(SR); reset(q); q.set(H("fx.comp.on"), 1); std::vector<float> L(N), R(N);
      for (size_t i = 0; i < N; i++) L[i] = R[i] = amp * (float)std::sin(2 * M_PI * 220 * i / SR); run(q, L, R); return rms(L, 96000, N) / (amp / std::sqrt(2.0)); };
    double q = lvl(0.01), l = lvl(0.8);
    printf("       gain at -40 dBFS: %.2f dB, at -2 dBFS: %.2f dB\n", 20 * std::log10(q), 20 * std::log10(l));
    CHECK(20 * std::log10(l) < 20 * std::log10(q) - 3, "loud is brought down relative to quiet"); }

  printf("ott / grit / chorus / phaser / width: alive, finite, different from dry\n");
  const char* stages[][3] = {{"fx.ott.on", "fx.ott.depth", "ott"}, {"fx.grit.on", "fx.grit.mix", "grit"},
                              {"fx.chorus.on", "fx.chorus.mix", "chorus"}, {"fx.phaser.on", "fx.phaser.mix", "phaser"}};
  for (auto& st : stages) {
    FxRack r(SR); reset(r); r.set(H(st[0]), 1); r.set(H(st[1]), 0.8);
    std::vector<float> L(N), R(N), L0; for (size_t i = 0; i < N; i++) { L[i] = 0.3f * (float)std::sin(2 * M_PI * 330 * i / SR) + 0.05f * noise(); R[i] = L[i] * 0.8f; }
    L0 = L; run(r, L, R);
    double d = 0; for (size_t i = 48000; i < N; i++) d += std::fabs(L[i] - 0.8 * L0[i]);
    CHECK(finite(L, 4) && d / (N - 48000) > 1e-3, "%s: changes the signal by %.4f mean abs, finite", st[2], d / (N - 48000));
  }
  { FxRack r(SR); reset(r); r.set(H("fx.width"), 0); std::vector<float> L(N), R(N); for (size_t i = 0; i < N; i++) { L[i] = 0.3f * noise(); R[i] = 0.3f * noise(); }
    run(r, L, R); double dd = 0; for (size_t i = 24000; i < N; i++) dd += std::fabs(L[i] - R[i]);
    CHECK(dd < 1e-3, "width 0 is mono (L-R = %.2g)", dd); }

  printf("fuzz: every parameter random, many times, nothing may blow up\n");
  { bool ok = true; double worst = 0;
    for (int trial = 0; trial < 60 && ok; trial++) {
      FxRack r(SR); for (int i = 0; i < HOST_FX_COUNT; i++) {
        double lo = HOST_FX[i].min, hi = HOST_FX[i].max, u = (double)(rand() % 10001) / 10000.0;
        double v = HOST_FX[i].kind == 2 ? (rand() & 1) : HOST_FX[i].kind == 1 ? std::floor(lo + u * (hi - lo + 0.999)) : lo + u * (hi - lo);
        r.set(i, v); }
      double m[5]; for (double& x : m) x = (double)(rand() % 1001) / 1000.0 - 0.2; r.setMods(m);
      std::vector<float> L(48000), R(48000); for (size_t i = 0; i < L.size(); i++) { L[i] = 0.5f * noise(); R[i] = 0.5f * noise(); }
      run(r, L, R); for (float x : L) { if (!std::isfinite(x)) ok = false; worst = std::max(worst, (double)std::fabs(x)); }
    }
    CHECK(ok, "60 random racks, finite throughout (loudest sample %.2f)", worst); }

  printf("cost: everything on, one part\n");
  { FxRack r(SR); reset(r);
    for (const char* k : {"fx.drive.on", "fx.chorus.on", "fx.phaser.on", "fx.delay.on", "fx.reverb.on", "fx.comp.on", "fx.ott.on", "fx.grit.on"}) r.set(H(k), 1);
    r.set(H("fx.drive.amount"), 0.5);
    std::vector<float> L(48000 * 4), R(48000 * 4); for (size_t i = 0; i < L.size(); i++) { L[i] = 0.3f * noise(); R[i] = 0.3f * noise(); }
    auto t0 = std::chrono::steady_clock::now(); run(r, L, R);
    double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    printf("       4 s of audio in %.3f s → load %.3f of one core (this Mac; a phone is slower)\n", sec, sec / 4);
    CHECK(sec / 4 < 0.25, "load per part with every effect on"); }
  { FxRack r(SR); reset(r); std::vector<float> L(48000 * 4), R(48000 * 4);
    auto t0 = std::chrono::steady_clock::now(); run(r, L, R);
    double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    printf("       …and with everything off: load %.4f\n", sec / 4); }

  printf("\n%s\n", fails ? "FAILED" : "all passed");
  return fails ? 1 : 0;
}
