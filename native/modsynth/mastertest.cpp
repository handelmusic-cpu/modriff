// Runs the master-bus cases of tests/modsynth/master-ref.html through the C++
// bus and prints what the browser's page prints: a level every 10 ms (RMS over
// both channels in dB, and the window's peak), as JSON, for
// tests/modsynth/master.test.js to compare with the recording.
//
// The stimulus is master-ref.html's, sample for sample (a three-note chord
// stepped through eight levels, then silence). If you change one, change both
// and record the browser's answer again.
#include "master.h"
#include "dspkit.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace modsynth;

namespace {
constexpr double SR = 48000, WIN = 0.01, PI = 3.14159265358979323846;
constexpr int BLOCK = 128;                                   // the browser's render quantum
const double STEPS_DB[8] = {-30, -20, -12, -6, -3, 0, 3, -12};
constexpr double STEP_S = 0.6, TAIL_S = 1.2;

struct Case {
  const char* stage; double compAmt; double vol; bool on; double drive;
};
// Keep in step with CASES in master-ref.html.
const Case CASES[] = {
  {"comp", 0.35, 0.72, true, 0}, {"comp", 0, 0.72, true, 0}, {"comp", 1, 0.72, true, 0},
  {"lim", 0.35, 0.72, true, 0},
  {"chain", 0.35, 0.72, true, 0}, {"chain", 1, 1, true, 0},
  {"chain", 0.35, 0.72, false, 0},
  {"chain", 0.35, 0.72, true, 0.5},
};

void stimulus(std::vector<float>& L, std::vector<float>& R) {
  const int n = (int)std::lround((8 * STEP_S + TAIL_S) * SR);
  L.assign(n, 0.f); R.assign(n, 0.f);
  for (int i = 0; i < n; i++) {
    const int step = (int)std::floor(i / (STEP_S * SR));
    if (step >= 8) break;
    const double a = std::pow(10.0, STEPS_DB[step] / 20) / 3, t = i / SR;
    L[i] = (float)(a * (std::sin(2*PI*220*t) + std::sin(2*PI*330*t) + std::sin(2*PI*440*t)));
    R[i] = (float)(a * (std::sin(2*PI*221*t) + std::sin(2*PI*331*t) + std::sin(2*PI*441*t)));
  }
}

// _curveRmsGain with the page's _driveCurve table, so the make-up gain is the
// page's own number.
double driveOut(double amount) {
  const double span = 4, k = amount * amount * 45;
  const int n = 8192;
  std::vector<float> c(n);
  for (int i = 0; i < n; i++) {
    const double x = ((i * 2.0) / (n - 1) - 1) * span;
    c[i] = (float)((k < 0.01 ? x : (1 + k) * x / (1 + k * std::fabs(x))) / span);
  }
  double a = 0, b = 0;
  for (int i = 0; i < 1024; i++) {
    const double x = 0.2 * std::sin(2 * PI * i / 1024);
    long idx = std::lround((x / span + 1) / 2 * (n - 1));
    idx = idx < 0 ? 0 : (idx > n - 1 ? n - 1 : idx);
    const double y = c[idx] * span; a += x * x; b += y * y;
  }
  const double g = a > 0 ? std::sqrt(b / a) : 1;
  return (g > 0.001 ? 1 / g : 1) * span;
}

void run(const Case& c, const std::vector<float>& iL, const std::vector<float>& iR,
         std::vector<float>& oL, std::vector<float>& oR) {
  const int n = (int)iL.size();
  oL = iL; oR = iR;
  std::vector<float> zero(BLOCK, 0.f);
  const double th = c.on ? -6 - c.compAmt * 20 : 0, ratio = c.on ? 1.5 + c.compAmt * 5 : 1;
  const double lth = c.on ? -3 : 0, lratio = c.on ? 20 : 1;
  if (std::string(c.stage) == "chain") {
    MasterBus m(SR);
    m.set(MB_VOL, c.vol); m.set(MB_CMP_TH, th); m.set(MB_CMP_RATIO, ratio);
    m.set(MB_LIM_TH, lth); m.set(MB_LIM_RATIO, lratio); m.set(MB_REV_SEND, 0);
    m.set(MB_DRV_AMT, c.drive); m.set(MB_DRV_OUT, driveOut(c.drive));
    for (int s = 0; s < n; s += BLOCK) {
      const int k = std::min(BLOCK, n - s);
      m.process(&oL[s], &oR[s], zero.data(), zero.data(), k);
    }
  } else {
    Dynamics d(SR);
    if (std::string(c.stage) == "comp") d.set(th, 22, ratio, 0.012, 0.22);
    else d.set(lth, 1, lratio, 0.001, 0.1);
    for (int s = 0; s < n; s += BLOCK) d.process(&oL[s], &oR[s], std::min(BLOCK, n - s));
    for (int i = 0; i < n; i++) { oL[i] *= (float)c.vol; oR[i] *= (float)c.vol; }
  }
}

// master-ref.html's refRoom(): seeded noise for 2 s, then silence, through the
// bus room alone; 100 ms RMS windows over both channels.
std::vector<float> noise(int n, uint32_t x) {
  std::vector<float> a((size_t)n);
  for (int i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    a[(size_t)i] = (float)(((x / 4294967296.0) * 2 - 1) * 0.3);
  }
  return a;
}
void room(std::vector<double>& out) {
  const int n = (int)(5 * SR), w = (int)(SR / 10);
  const std::vector<float> nl = noise((int)(2 * SR), 12345), nr = noise((int)(2 * SR), 67890);
  dsp::Fdn f(SR, MASTER_ROOM_SECONDS, MASTER_ROOM_SCALE, MASTER_ROOM_RT60);
  const double trim = dsp::dbToLin(MASTER_ROOM_TRIM_DB);
  std::vector<float> oL((size_t)n), oR((size_t)n);
  for (int i = 0; i < n; i++) {
    double l, r;
    f.tick(i < (int)nl.size() ? nl[(size_t)i] : 0.0, i < (int)nr.size() ? nr[(size_t)i] : 0.0, l, r);
    oL[(size_t)i] = (float)(l * trim); oR[(size_t)i] = (float)(r * trim);
  }
  for (int s = 0; s + w <= n; s += w) {
    double q = 0;
    for (int i = s; i < s + w; i++) q += (double)oL[(size_t)i] * oL[(size_t)i] + (double)oR[(size_t)i] * oR[(size_t)i];
    out.push_back(std::round(20 * std::log10(std::sqrt(q / (2.0 * w)) + 1e-12) * 10) / 10);
  }
}
}  // namespace

#include <chrono>
#include <string>
// `mastertest stress`: random settings moved every few blocks over loud noise in
// both groups, block sizes that are not the browser's. Prints the loudest
// output sample, a count of anything not finite, and the cost per second of
// audio (this Mac; a phone is slower).
static int stress() {
  const int blocks[] = {128, 480, 512, 1024, 37};
  uint32_t rs = 2463534242u;
  auto rnd = [&]() { rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5; return rs / 4294967296.0; };
  MasterBus m(SR);
  const int total = (int)(20 * SR);
  std::vector<float> L(4096), R(4096), rL(4096), rR(4096);
  double maxAbs = 0; long bad = 0; int done = 0, bi = 0;
  const auto t0 = std::chrono::steady_clock::now();
  while (done < total) {
    const int n = blocks[bi++ % 5];
    if (rnd() < 0.25) {
      const bool on = rnd() < 0.8;
      const double ca = rnd();
      m.set(MB_VOL, rnd() * 1.2); m.set(MB_CMP_TH, on ? -6 - ca * 20 : 0); m.set(MB_CMP_RATIO, on ? 1.5 + ca * 5 : 1);
      m.set(MB_LIM_TH, on ? -3 : 0); m.set(MB_LIM_RATIO, on ? 20 : 1); m.set(MB_REV_SEND, on ? rnd() * 0.5 : 0);
      const double d = rnd() < 0.5 ? 0 : rnd(); m.set(MB_DRV_AMT, d); m.set(MB_DRV_OUT, driveOut(d));
    }
    for (int i = 0; i < n; i++) {
      L[i] = (float)((rnd() * 2 - 1) * 2.0); R[i] = (float)((rnd() * 2 - 1) * 2.0);   // up to +6 dBFS
      rL[i] = (float)((rnd() * 2 - 1) * 1.0); rR[i] = (float)((rnd() * 2 - 1) * 1.0);
    }
    m.process(L.data(), R.data(), rL.data(), rR.data(), n);
    for (int i = 0; i < n; i++) {
      if (!std::isfinite(L[i]) || !std::isfinite(R[i])) bad++;
      else maxAbs = std::max(maxAbs, std::max(std::fabs((double)L[i]), std::fabs((double)R[i])));
    }
    done += n;
  }
  const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::printf("{\"maxAbs\":%.3f,\"nonFinite\":%ld,\"load\":%.4f}\n", maxAbs, bad, sec / 20.0);
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "stress") return stress();
  std::vector<float> iL, iR; stimulus(iL, iR);
  const int w = (int)std::lround(WIN * SR);
  std::printf("[");
  for (size_t ci = 0; ci < sizeof(CASES) / sizeof(CASES[0]); ci++) {
    std::vector<float> oL, oR; run(CASES[ci], iL, iR, oL, oR);
    std::printf("%s{\"rmsDb\":[", ci ? "," : "");
    std::vector<double> pk;
    bool first = true;
    for (int s = 0; s + w <= (int)oL.size(); s += w) {
      double q = 0, p = 0;
      for (int i = s; i < s + w; i++) {
        q += (double)oL[i] * oL[i] + (double)oR[i] * oR[i];
        p = std::max(p, std::max(std::fabs((double)oL[i]), std::fabs((double)oR[i])));
      }
      std::printf("%s%.1f", first ? "" : ",", std::round(20 * std::log10(std::sqrt(q / (2.0 * w)) + 1e-12) * 10) / 10);
      first = false; pk.push_back(std::round(p * 1e4) / 1e4);
    }
    std::printf("],\"peak\":[");
    for (size_t i = 0; i < pk.size(); i++) std::printf("%s%.4f", i ? "," : "", pk[i]);
    std::printf("]}");
  }
  std::vector<double> rm; room(rm);
  std::printf(",{\"rmsDb100\":[");
  for (size_t i = 0; i < rm.size(); i++) std::printf("%s%.1f", i ? "," : "", rm[i]);
  std::printf("]}]\n");
  return 0;
}
