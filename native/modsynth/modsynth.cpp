// mõdSynth DSP core, in C++ — see modsynth.h. Section by section this follows
// modsynth/dsp.js; the comments here say where the port had to be careful,
// and dsp.js still says why the DSP is the way it is.
#include "modsynth.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <functional>
#include <map>
#include <string>

namespace modsynth {
using namespace js;
using js::abs; using js::floor; using js::ceil; using js::sqrt; using js::pow; using js::exp;
using js::sin; using js::cos; using js::tan; using js::log2; using js::round; using js::max; using js::min; using js::fmod;

static const double DIV_BEATS_DSP[] = {
  32, 16, 8, 4, 3, 2, 4.0 / 3, 1.5, 1, 2.0 / 3, 0.75, 0.5,
  1.0 / 3, 0.375, 0.25, 1.0 / 6, 0.125, 1.0 / 12, 0.0625,
};
static const int N_DIVS = 19;
static double divBeats(int i) { return (i >= 0 && i < N_DIVS && DIV_BEATS_DSP[i]) ? DIV_BEATS_DSP[i] : 1; }

static inline double clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

static double softClip(double x) {
  if (x > 3) return 1; if (x < -3) return -1;
  const double x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
static double preDrive(double x, int type) {
  if (type == 1) return x > 0 ? softClip(x) : softClip(x * 0.55) * 0.8;
  if (type == 2) {
    double y = x * 0.5;
    y = y - 4 * floor((y + 1) / 4);
    return y < 1 ? y : 2 - y;
  }
  if (type == 3) { const double r = x < 0 ? -x : x; return softClip(x * 0.5 + (r - 0.5) * 0.8); }
  return softClip(x);
}
static std::map<int, std::vector<f32>> PD_TABLES;
static const std::vector<f32>& preDriveTable(int type) {
  auto it = PD_TABLES.find(type);
  if (it != PD_TABLES.end()) return it->second;
  std::vector<f32> t(PD_N + 1);
  for (int i = 0; i <= PD_N; i++) t[i] = preDrive(((double)i / PD_N) * 2 * PD_R - PD_R, type);
  return PD_TABLES[type] = t;
}
static inline double sat(double x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const double x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
static inline double satAsym(double x) { return x >= 0 ? sat(x * 1.15) : sat(x * 0.72) * 0.86; }
static inline double curveMap(double t, double k) { if (k == 0) return t; return t * (1 + k) / (1 + k * t); }
static double chaosWalk(double w, double rnd, double rate, double dt) {
  w += rnd * sqrt(rate * dt) * 1.6 - w * min(1, rate * dt * 0.6);
  return w > 1 ? 1 : w < -1 ? -1 : w;
}

// ── FFT, in place, as dsp.js does it (the twiddles by recurrence, not table) ──
static void fft(double* re, double* im, int n, bool inverse) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
  }
  for (int len = 2; len <= n; len <<= 1) {
    const double ang = (inverse ? 2 : -2) * PI / len;
    const double wr = cos(ang), wi = sin(ang);
    const int half = len >> 1;
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int j = 0; j < half; j++) {
        const int a = i + j, b = a + half;
        const double vr = re[b] * cr - im[b] * ci;
        const double vi = re[b] * ci + im[b] * cr;
        const double ur = re[a], ui = im[a];
        re[a] = ur + vr; im[a] = ui + vi;
        re[b] = ur - vr; im[b] = ui - vi;
        const double ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// ── Wavetable frames ─────────────────────────────────────────────────────
struct Frame {
  std::function<double(double)> fn;               // time domain, or empty
  std::function<double(int)> spectrum;
  std::function<double(int)> phase;               // optional
  int maxH = 0;
};
static Frame timeFrame(std::function<double(double)> f) { Frame fr; fr.fn = f; return fr; }
static Frame additive(std::function<double(int)> amp, int n, std::function<double(int)> phase = nullptr) {
  Frame fr; fr.spectrum = amp; fr.phase = phase; fr.maxH = n; return fr;
}
static double formantAmp(int k, double f0, const std::vector<std::array<double, 3>>& peaks) {
  double a = 0;
  for (size_t p = 0; p < peaks.size(); p++) {
    const double fc = peaks[p][0], bw = peaks[p][1], g = peaks[p][2];
    const double d = (k * f0 - fc) / bw;
    a += g / (1 + d * d);
  }
  return a / k;
}
// `[a, b, c][k] || 0`
static double at(std::initializer_list<double> L, int k) {
  if (k < 0 || k >= (int)L.size()) return 0;
  double v = *(L.begin() + k); return v ? v : 0;
}
static double sin1(double t) { return sin(TWO_PI * t); }

static std::vector<std::vector<Frame>> wtDefs() {
  std::vector<std::vector<Frame>> D;
  // classic
  D.push_back({ timeFrame(sin1),
    additive([](int k) { return (k % 2 ? (k % 4 == 1 ? 1.0 : -1.0) / ((double)k * k) : 0.0); }, 255),
    additive([](int k) { return 1.0 / k; }, 512),
    additive([](int k) { return (k % 2 ? 1.0 / k : 0.0); }, 512) });
  // pulse
  { std::vector<Frame> F; for (double d : {0.5, 0.35, 0.2, 0.08})
      F.push_back(additive([d](int k) { return 2 * sin(PI * k * d) / (PI * k); }, 512));
    D.push_back(F); }
  // supersaw
  { std::vector<Frame> F; for (double c : {0.0, 0.004, 0.012, 0.035})
      F.push_back(additive([c](int k) { return exp(-k * c) / k; }, 512));
    D.push_back(F); }
  // harmonic
  D.push_back({
    additive([](int k) { return at({0, 1, 0.7, 0, 0.45, 0, 0, 0, 0.3}, k); }, 16),
    additive([](int k) { return at({0, 1, 0, 0.8, 0, 0.6, 0, 0.4, 0, 0.25}, k); }, 16),
    additive([](int k) { return at({0, 1, 0.85, 0.6, 0.5, 0.35, 0.3, 0.2, 0.35}, k); }, 16),
    additive([](int k) { return (k <= 32 && (k & (k - 1)) == 0 ? 1 / sqrt(k) : 0.0); }, 32) });
  // formant
  { std::vector<std::vector<std::array<double, 3>>> P = {
      {{730, 220, 1}, {1090, 260, 0.5}, {2440, 400, 0.25}},
      {{530, 190, 1}, {1840, 300, 0.45}, {2480, 420, 0.2}},
      {{270, 160, 1}, {2290, 330, 0.5}, {3010, 480, 0.22}},
      {{300, 150, 1}, {870, 220, 0.35}, {2240, 400, 0.1}} };
    std::vector<Frame> F; for (auto& pk : P) F.push_back(additive([pk](int k) { return formantAmp(k, 110, pk); }, 220));
    D.push_back(F); }
  // bell
  D.push_back({
    additive([](int k) { return at({0, 1, 0, 0.6, 0, 0.45, 0, 0, 0, 0.3, 0, 0, 0, 0.22}, k); }, 32),
    additive([](int k) { return at({0, 1, 0, 0.7, 0, 0, 0.5, 0, 0, 0, 0, 0.4, 0, 0, 0, 0.3}, k); }, 32),
    additive([](int k) { return (k == 1 ? 1 : k == 3 ? 0.5 : k == 7 ? 0.42 : k == 11 ? 0.36 : k == 17 ? 0.3 : k == 23 ? 0.2 : 0); }, 40),
    additive([](int k) { return (k == 1 ? 1 : k % 5 == 0 ? 0.5 / sqrt(k) : 0.0); }, 60) });
  // digital
  { std::vector<Frame> F; double ratios[] = {1, 2, 3, 5};
    for (int n = 0; n < 4; n++) { const double ratio = ratios[n], idx = 1.2 + n * 1.4;
      F.push_back(timeFrame([ratio, idx](double t) { return sin(TWO_PI * t + idx * sin(TWO_PI * ratio * t)); })); }
    D.push_back(F); }
  // vocal
  { std::vector<std::vector<std::array<double, 3>>> P = {
      {{600, 180, 1}, {1040, 240, 0.6}, {2250, 380, 0.3}, {2450, 400, 0.2}},
      {{400, 160, 1}, {1700, 280, 0.55}, {2300, 380, 0.3}, {3200, 500, 0.15}},
      {{250, 140, 1}, {2100, 320, 0.6}, {3100, 480, 0.35}, {3800, 520, 0.2}},
      {{350, 150, 1}, {700, 200, 0.5}, {2600, 420, 0.4}, {3600, 520, 0.3}} };
    std::vector<Frame> F; for (auto& pk : P) F.push_back(additive([pk](int k) { return formantAmp(k, 98, pk); }, 240));
    D.push_back(F); }
  // reed
  D.push_back({
    additive([](int k) { return (k % 2 ? 1 / ((double)k * k * 0.06 + k) : 0.0); }, 200),
    additive([](int k) { return (k % 2 ? exp(-k * 0.05) / k : 0.12 * exp(-k * 0.14) / k); }, 200),
    additive([](int k) { return exp(-pow((k - 4) / 7.0, 2)) / sqrt(k); }, 200),
    additive([](int k) { return exp(-pow((k - 9) / 11.0, 2)) / sqrt(k); }, 240) });
  // string
  D.push_back({
    additive([](int k) { return sin(PI * k * 0.13) / k; }, 400),
    additive([](int k) { return sin(PI * k * 0.24) / k; }, 400),
    additive([](int k) { return (sin(PI * k * 0.09) / k) * exp(-k * 0.006); }, 400),
    additive([](int k) { return (1.0 / k) * (1 + 0.35 * sin(k * 0.9)); }, 400) });
  // glass
  D.push_back({
    additive([](int k) { return exp(-pow((k - 6) / 9.0, 2)) / sqrt(k) + (k == 1 ? 0.6 : 0); }, 300),
    additive([](int k) { return exp(-pow((k - 14) / 12.0, 2)) / sqrt(k) + (k == 1 ? 0.4 : 0); }, 300),
    additive([](int k) { return (k % 3 == 1 ? exp(-k * 0.03) / sqrt(k) : 0.0); }, 300),
    additive([](int k) { return (k % 7 == 1 ? 0.9 / sqrt(k) : 0.0); }, 340) });
  // growl
  { std::vector<Frame> F; for (double off : {0.02, 0.12, 0.28, 0.45})
      F.push_back(additive([off](int k) { return 1.2 * abs(sin(PI * k * off)) / k; }, 400,
        [off](int k) { return PI * k * off - PI / 2 + (sin(PI * k * off) < 0 ? PI : 0); }));
    D.push_back(F); }
  // fold
  { std::vector<Frame> F; for (double g : {1.0, 2.2, 3.8, 6.0})
      F.push_back(timeFrame([g](double t) {
        double x = sin(TWO_PI * t) * g;
        for (int i = 0; i < 4; i++) { if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x; else break; }
        return x; }));
    D.push_back(F); }
  // noise
  { std::vector<Frame> F; for (int seed : {11, 977, 4441, 20011}) {
      Rng rng(seed);
      auto amps = std::make_shared<std::vector<double>>(257, 0.0), phs = std::make_shared<std::vector<double>>(257, 0.0);
      for (int k = 1; k <= 256; k++) { (*amps)[k] = abs(rng()) / pow(k, 0.6); (*phs)[k] = rng() * PI; }
      F.push_back(additive([amps](int k) { double v = k < 257 ? (*amps)[k] : 0; return v ? v : 0; }, 256,
                           [phs](int k) { double v = k < 257 ? (*phs)[k] : 0; return v ? v : 0; }));
    } D.push_back(F); }
  // vintage
  D.push_back({
    timeFrame([](double t) { const double s = 2 * t - 1; return s * (1 - 0.14 * s * s) + 0.05 * sin(TWO_PI * 2 * t); }),
    timeFrame([](double t) { const double s = 2 * fmod(t + 0.03, 1) - 1; return sat(s * 1.3) * 0.92 + 0.04 * sin(TWO_PI * 3 * t); }),
    timeFrame([](double t) { return (t < 0.48 ? 1 : -1) * (1 - 0.1 * sin(TWO_PI * t)) * 0.8; }),
    timeFrame([](double t) { const double s = 2 * t - 1; return 0.55 * s + 0.45 * js::sign(s) * pow(abs(s), 0.7); }) });
  // sync — note dsp.js's WT_ORDER puts 'sync' after 'vintage'
  { std::vector<Frame> F; for (double r : {1.6, 2.6, 4.1, 6.3})
      F.push_back(timeFrame([r](double t) { const double p = fmod(t * r, 1); return (2 * p - 1) * (1 - t * 0.25); }));
    D.push_back(F); }
  // czsaw
  { std::vector<Frame> F; for (double d : {0.5, 0.28, 0.13, 0.04})
      F.push_back(timeFrame([d](double t) { const double p = t < d ? t * 0.5 / d : 0.5 + (t - d) * 0.5 / (1 - d); return -cos(TWO_PI * p); }));
    D.push_back(F); }
  // czres
  { std::vector<Frame> F; for (double r : {1.5, 3.0, 5.5, 9.0})
      F.push_back(timeFrame([r](double t) { return (1 - t) * cos(TWO_PI * r * t) * 1.2; }));
    D.push_back(F); }
  // czpulse
  { std::vector<Frame> F; for (double d : {0.5, 0.3, 0.16, 0.06})
      F.push_back(timeFrame([d](double t) {
        const double h = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        const double q = h < d ? h * 0.5 / d : 0.5 + (h - d) * 0.5 / (1 - d);
        return (t < 0.5 ? 1 : -1) * sin(PI * q); }));
    D.push_back(F); }
  // metal
  auto idxOf = [](std::initializer_list<int> L, int k) { for (int x : L) if (x == k) return true; return false; };
  D.push_back({
    additive([](int k) { return at({1, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.5, 0, 0.45, 0, 0, 0, 0.3}, k - 1); }, 32, [](int k) { return k * 1.7; }),
    additive([idxOf](int k) { return (k == 1 ? 0.8 : idxOf({7, 11, 13, 17, 19, 23}, k) ? 0.55 : 0); }, 32, [](int k) { return k * 2.3; }),
    additive([idxOf](int k) { return (k == 1 ? 0.5 : idxOf({9, 14, 21, 26, 31, 37, 43}, k) ? 0.5 : 0); }, 48, [](int k) { return k * 0.9; }),
    additive([](int k) { return (k == 1 ? 0.35 : (k % 7 == 3 || k % 11 == 5) ? 0.5 / sqrt(k / 8.0) : 0); }, 80, [](int k) { return k * 3.1; }) });
  // chip
  D.push_back({
    timeFrame([](double t) { return round((t < 0.5 ? 4 * t - 1 : 3 - 4 * t) * 7.5) / 7.5; }),
    timeFrame([](double t) { return (t < 0.125 ? 1 : -0.143); }),
    timeFrame([](double t) { return (t < 0.25 ? 1 : -0.333); }),
    timeFrame([](double t) { return round((2 * t - 1) * 3.5) / 3.5; }) });
  // hollow
  { std::vector<Frame> F; for (double c : {3.0, 6.0, 11.0, 18.0})
      F.push_back(additive([c](int k) { return (k % 2 ? (1.0 / k) * (1 + 1.6 * exp(-pow((k - c) / (c * 0.45 + 1), 2))) : 0.0); }, 160));
    D.push_back(F); }
  return D;
}

// dsp.js WT_ORDER, and the position of each in the table built above.
[[maybe_unused]] static const char* WT_ORDER[] = {
  "classic", "pulse", "supersaw", "harmonic", "formant", "bell",
  "digital", "vocal", "reed", "string", "glass", "growl",
  "fold", "noise", "vintage", "sync",
  "czsaw", "czres", "czpulse", "metal", "chip", "hollow",
};
static const int N_WAVES = 22;

static std::vector<std::vector<std::vector<Table>>>* WT_BANK = nullptr;
static std::vector<std::vector<std::vector<Table>>>* buildWavetables() {
  if (WT_BANK) return WT_BANK;
  auto defs = wtDefs();
  std::vector<double> aRe(TABLE_SIZE), aIm(TABLE_SIZE), sRe(TABLE_SIZE), sIm(TABLE_SIZE), wRe(TABLE_SIZE), wIm(TABLE_SIZE);
  auto* bank = new std::vector<std::vector<std::vector<Table>>>();
  for (int s = 0; s < N_WAVES; s++) {
    auto& frames = defs[s];
    std::vector<std::vector<Table>> set;
    for (int fr = 0; fr < FRAMES; fr++) {
      const Frame& gen = frames[std::min(fr, (int)frames.size() - 1)];
      std::fill(sRe.begin(), sRe.end(), 0.0); std::fill(sIm.begin(), sIm.end(), 0.0);
      int topH;
      if (gen.fn) {
        for (int n = 0; n < TABLE_SIZE; n++) { aRe[n] = gen.fn((double)n / TABLE_SIZE); aIm[n] = 0; }
        fft(aRe.data(), aIm.data(), TABLE_SIZE, false);
        for (int k = 1; k < TABLE_SIZE; k++) { sRe[k] = aRe[k] / TABLE_SIZE; sIm[k] = aIm[k] / TABLE_SIZE; }
        topH = (TABLE_SIZE >> 1) - 1;
      } else {
        topH = std::min(gen.maxH, (TABLE_SIZE >> 1) - 1);
        for (int k = 1; k <= topH; k++) {
          const double A = gen.spectrum(k);
          if (!A || A != A) continue;   // JS: !A, which NaN satisfies too
          const double ph = gen.phase ? gen.phase(k) : 0;
          const double cr = (A / 2) * sin(ph);
          const double ci = -(A / 2) * cos(ph);
          sRe[k] = cr; sIm[k] = ci;
          sRe[TABLE_SIZE - k] = cr; sIm[TABLE_SIZE - k] = -ci;
        }
      }
      std::vector<Table> mips;
      for (int lvl = 0; lvl < NUM_MIPS; lvl++) {
        const int len = std::max(64, TABLE_SIZE >> lvl);
        const int maxH = std::max(1, std::min(std::min((TABLE_SIZE >> 1) >> lvl, topH), (len >> 1) - 1));
        double* re = wRe.data(); double* im = wIm.data();
        std::fill(re, re + len, 0.0); std::fill(im, im + len, 0.0);
        for (int k = 1; k <= maxH; k++) {
          re[k] = sRe[k]; im[k] = sIm[k];
          re[len - k] = sRe[TABLE_SIZE - k]; im[len - k] = sIm[TABLE_SIZE - k];
        }
        fft(re, im, len, true);
        Table T; T.d.assign(len + 1, 0.f);
        double peak = 1e-9;
        for (int n = 0; n < len; n++) {
          const double v = re[n];
          T.d[n] = (float)v;
          const double a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
        const double norm = 1 / peak;
        for (int n = 0; n < len; n++) T.d[n] = (float)((double)T.d[n] * norm);
        T.d[len] = T.d[0];
        mips.push_back(std::move(T));
      }
      set.push_back(std::move(mips));
    }
    bank->push_back(std::move(set));
  }
  WT_BANK = bank;
  return bank;
}

// ── Filters ──────────────────────────────────────────────────────────────
enum { F_BYPASS = 0, F_LADDER4 = 1, F_LADDER2 = 2, F_SVFLP = 3, F_SVFHP = 4,
       F_SVFBP = 5, F_SVFNOTCH = 6, F_SVFPEAK = 7, F_DIODE = 8, F_COMB = 9, F_FORMANT = 10 };
static const double VOWELS[5][3] = { {730, 1090, 2440}, {530, 1840, 2480}, {270, 2290, 3010}, {570, 840, 2410}, {300, 870, 2240} };

void FilterSlot::reset() {
  for (auto& x : s) x = 0; for (auto& x : ic) x = 0; for (auto& x : fv) x = 0;
  for (auto& x : comb) x = 0;
  cLast[0] = cLast[1] = 0;
}

void FilterSlot::set(int m, double cut, double r, double drv, double sr) {
  model = m;
  if (m == F_BYPASS) return;
  cut = clamp(cut, 12, sr * 0.47);
  const double gg = tan(PI * cut / sr);
  g = gg;
  G = gg / (1 + gg);
  res = r;
  drive = 1 + drv * 9;
  outTrim = 1 / (1 + drv * 2.2);
  if (m == F_LADDER4) k = r * 4.2;
  else if (m == F_LADDER2 || m == F_DIODE) k = r * 3.4;
  else k = 2 - 1.94 * r;
  if (m == F_COMB) {
    if (comb.empty()) comb.assign(16384, f32());
    combN = clamp(sr / cut, 2, 8100);
  }
  if (m == F_FORMANT) {
    const double pos = clamp(log2(cut / 120) / 5, 0, 0.9999) * (5 - 1);
    const int i0 = toi32(pos); const double fr = pos - i0;
    const double* v0 = VOWELS[i0]; const double* v1 = VOWELS[std::min(i0 + 1, 4)];
    for (int n = 0; n < 3; n++) {
      const double f = v0[n] + (v1[n] - v0[n]) * fr;
      fg[n] = tan(PI * clamp(f, 40, sr * 0.45) / sr);
    }
    fk = 2 - 1.8 * r;
  }
}

void FilterSlot::processBlock(f32* buf, int n, int ch) {
  const int m = model;
  if (m == F_BYPASS) return;
  const double G_ = G, iG = 1 - G_, drv = drive, trim = outTrim;

  if (m == F_LADDER4 || m == F_LADDER2 || m == F_DIODE) {
    const bool four = m == F_LADDER4, diode = m == F_DIODE;
    const double kk = k;
    const double gp = four ? G_ * G_ * G_ * G_ : G_ * G_;
    const double c1 = G_ * G_ * G_, c2 = G_ * G_;
    const double denom = 1 / (1 + kk * gp);
    const int b = ch << 2;
    double s1 = s[b], s2 = s[b + 1], s3 = s[b + 2], s4 = s[b + 3];
    for (int i = 0; i < n; i++) {
      const double S1 = iG * s1, S2 = iG * s2, S3 = iG * s3, S4 = iG * s4;
      const double sig = four ? c1 * S1 + c2 * S2 + G_ * S3 + S4 : G_ * S1 + S2;
      double u = ((double)buf[i] * drv - kk * sig) * denom;
      u = diode ? satAsym(u) : sat(u);
      const double y1 = G_ * u + S1; s1 = 2 * y1 - s1;
      const double y2 = G_ * y1 + S2; s2 = 2 * y2 - s2;
      if (!four) { buf[i] = y2 * trim; continue; }
      const double y3 = G_ * y2 + S3; s3 = 2 * y3 - s3;
      const double y4 = G_ * y3 + S4; s4 = 2 * y4 - s4;
      buf[i] = y4 * trim;
    }
    s[b] = s1; s[b + 1] = s2; s[b + 2] = s3; s[b + 3] = s4;
    return;
  }

  if (m == F_COMB) {
    f32* cb = comb.data(); const int base = ch * 8192, N = 8192;
    const double d = combN, fb = 0.2 + res * 0.78;
    int w = cw[ch]; double last = cLast[ch];
    for (int i = 0; i < n; i++) {
      double rp = w - d;
      if (rp < 0) rp += N;
      const int i0 = toi32(rp); const double frac = rp - i0;
      const double a = cb[base + i0], bnd = cb[base + ((i0 + 1) & 8191)];
      double dl = a + (bnd - a) * frac;
      dl = dl * 0.5 + last * 0.5;
      last = dl;
      const double inp = sat((double)buf[i] * drv);
      cb[base + w] = inp + dl * fb;
      w = (w + 1) & 8191;
      buf[i] = (inp * 0.4 + dl) * trim;
    }
    cw[ch] = w; cLast[ch] = last;
    return;
  }

  if (m == F_FORMANT) {
    const int base = ch * 6; const double kk = fk;
    const double g0 = fg[0], g1 = fg[1], g2 = fg[2];
    const double A0 = 1 / (1 + g0 * (g0 + kk)), A1 = 1 / (1 + g1 * (g1 + kk)), A2 = 1 / (1 + g2 * (g2 + kk));
    double a0 = fv[base], b0 = fv[base + 1];
    double a1 = fv[base + 2], b1 = fv[base + 3];
    double a2 = fv[base + 4], b2 = fv[base + 5];
    for (int i = 0; i < n; i++) {
      const double xs = sat((double)buf[i] * drv);
      double v3 = xs - b0;
      double v1 = A0 * a0 + g0 * A0 * v3;
      double v2 = b0 + g0 * A0 * a0 + g0 * g0 * A0 * v3;
      a0 = 2 * v1 - a0; b0 = 2 * v2 - b0;
      double acc = v1;
      v3 = xs - b1;
      v1 = A1 * a1 + g1 * A1 * v3;
      v2 = b1 + g1 * A1 * a1 + g1 * g1 * A1 * v3;
      a1 = 2 * v1 - a1; b1 = 2 * v2 - b1;
      acc += v1 * 0.55;
      v3 = xs - b2;
      v1 = A2 * a2 + g2 * A2 * v3;
      v2 = b2 + g2 * A2 * a2 + g2 * g2 * A2 * v3;
      a2 = 2 * v1 - a2; b2 = 2 * v2 - b2;
      acc += v1 * 0.3;
      buf[i] = acc * 1.4 * trim;
    }
    fv[base] = a0; fv[base + 1] = b0;
    fv[base + 2] = a1; fv[base + 3] = b1;
    fv[base + 4] = a2; fv[base + 5] = b2;
    return;
  }

  const double gg = g, kk = k; const int b = ch << 1;
  const double A1c = 1 / (1 + gg * (gg + kk)), A2c = gg * A1c, A3c = gg * A2c;
  const double bpGain = 1 + res * 2;
  const bool doDrive = drv > 1.02;
  double ic1 = ic[b], ic2 = ic[b + 1];
  for (int i = 0; i < n; i++) {
    const double xs = doDrive ? sat((double)buf[i] * drv) : (double)buf[i];
    const double v3 = xs - ic2;
    const double v1 = A1c * ic1 + A2c * v3;
    const double v2 = ic2 + A2c * ic1 + A3c * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    double out;
    if (m == F_SVFLP) out = v2;
    else if (m == F_SVFHP) out = xs - kk * v1 - v2;
    else if (m == F_SVFBP) out = v1 * bpGain;
    else if (m == F_SVFNOTCH) out = xs - kk * v1;
    else out = v2 - (xs - kk * v1 - v2);
    buf[i] = out * trim;
  }
  ic[b] = ic1; ic[b + 1] = ic2;
}

// ── Envelope ─────────────────────────────────────────────────────────────
enum { E_IDLE = 0, E_ATK = 1, E_HOLD = 2, E_DEC = 3, E_SUS = 4, E_REL = 5 };
void Env::gate(bool on) {
  if (on) { stage = E_ATK; pos = 0; from = v; }
  else if (stage != E_IDLE && stage != E_REL) { stage = E_REL; pos = 0; rel = v; }
}
double Env::run(double a, double h, double d, double s, double r, double curve, double dt) {
  switch (stage) {
    case E_ATK:
      pos += a > 1e-5 ? dt / a : 1;
      if (pos >= 1) { pos = 0; v = 1; stage = h > 1e-5 ? E_HOLD : E_DEC; }
      else v = from + (1 - from) * curveMap(pos, -curve * 0.85);
      break;
    case E_HOLD:
      pos += dt / h;
      v = 1;
      if (pos >= 1) { pos = 0; stage = E_DEC; }
      break;
    case E_DEC:
      pos += d > 1e-5 ? dt / d : 1;
      if (pos >= 1) { v = s; stage = E_SUS; }
      else v = 1 - (1 - s) * curveMap(pos, 3 + curve * 2.5);
      break;
    case E_SUS:
      v = s;
      break;
    case E_REL:
      pos += r > 1e-5 ? dt / r : 1;
      if (pos >= 1) { v = 0; stage = E_IDLE; }
      else v = rel * (1 - curveMap(pos, 3 + curve * 2.5));
      break;
    default:
      v = 0;
  }
  return v;
}

// ── Modulation ordering ──────────────────────────────────────────────────
enum { D_PITCH = 1, D_O1FINE = 2, D_O2FINE = 3, D_O1SHAPE = 4, D_O2SHAPE = 5,
       D_O1PW = 6, D_O2PW = 7, D_O1LVL = 8, D_O2LVL = 9, D_O1DET = 10, D_O2DET = 11,
       D_FM = 12, D_RING = 13, D_SUB = 14, D_NOISE = 15,
       D_F1CUT = 16, D_F1RES = 17, D_F1DRV = 18, D_F2CUT = 19, D_F2RES = 20, D_FBLEND = 21,
       D_AMP = 22, D_PAN = 23, D_L1RATE = 24, D_L1DEP = 27, D_E2D = 30, D_E1R = 31,
       D_O3FINE = 32, D_O3SHAPE = 33, D_O3LVL = 34, D_FM3 = 35, D_FIRST_FX = 36 };
static const int S_CHAOS = 31;
// lfo1, lfo2, lfo3, mot1, mot2, bend, keytrack, rand, rand2, unison, alt, chaos
static const bool SRC_BIPOLAR[N_SRC] = {
  0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1 };

// ── LFO ──────────────────────────────────────────────────────────────────
Lfo::Lfo(double seed) : rng(seed) { hold = rng(); next = rng(); }
void Lfo::retrig(double phase) { ph = fmod(phase, 1); age = 0; done = false; hold = rng(); next = rng(); }
double Lfo::step(int shape, double inc, double pw, double smooth, double dt) {
  age += dt;
  ph += inc;
  if (ph >= 1) {
    ph -= floor(ph);
    hold = next;
    next = rng();
    if (once) done = true;
  } else if (ph < 0) {
    ph -= floor(ph);
  }
  return eval(shape, pw, smooth, dt);
}
double Lfo::eval(int shape, double pw, double smooth, double dt) {
  const double p = ph;
  double v;
  switch (shape) {
    case 0: v = sin(TWO_PI * p); break;
    case 1: v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
    case 2: v = 1 - 2 * p; break;
    case 3: v = 2 * p - 1; break;
    case 4: v = p < pw ? 1 : -1; break;
    case 5: v = p < pw * 0.5 ? 1 : -1; break;
    case 6: v = hold; break;
    case 7: { const double t = p; v = hold + (next - hold) * (t * t * (3 - 2 * t)); break; }
    case 8: v = 2 * exp(-p * 4) - 1; break;
    default: {
      const double e = clamp(pw, 0.02, 0.48);
      v = p < e ? p / e : p < 0.5 ? 1 : p < 0.5 + e ? 1 - 2 * (p - 0.5) / e : -1;
      break;
    }
  }
  if (smooth > 0.001) {
    const double c = 1 - exp(-dt / (0.0005 + smooth * 0.25));
    sm += (v - sm) * c;
    v = sm;
  } else sm = v;
  val = done ? 0 : v;
  return val;
}

// ── Voice ────────────────────────────────────────────────────────────────
Voice::Voice(int id_) : id(id_),
  rng(0x9e37 + (double)id_ * 2654435761.0),
  rng3(0x7f4a7c15 + (double)id_ * 1103515245.0) {
  lfo[0] = Lfo((double)id_ * 7919 + 13);
  lfo[1] = Lfo((double)id_ * 104729 + 7);
  lfo[2] = Lfo((double)id_ * 15485863 + 3);
}
void Voice::reset() {
  f1.reset(); f2.reset();
  dcX = dcY = nzLp = 0;
  for (auto& x : pink) x = 0; blueLast = 0;
  panL = panR = 0;
  for (auto& e : env) e.kill();
  for (auto& x : md) x = 0;
  lastAmp = 0;
}
void Voice::noteOn(double note_, double vel_, NoteId noteId_, const Snap& S, double time, bool hasGlide, double glideFrom) {
  note = note_; vel = vel_; noteId = noteId_;
  choke = 1; choking = false;
  held = true; pedal = false; active = true;
  startTime = time; age = 0;
  randA = rng(); randB = rng();
  alt = -alt;
  targetPitch = note_;
  if (hasGlide && S.glide > 0.0005) glidePitch = glideFrom;
  else glidePitch = note_;
  for (int o = 0; o < N_OSC; o++) {
    const bool free = S.oFree[o];
    const double base = S.oPhase[o];
    Rng& rnd = o < 2 ? rng : rng3;
    for (int u = 0; u < MAX_UNI; u++) {
      ph[o][u] = free ? fmod(rnd() * 0.5 + 0.5, 1) : fmod(base + u * 0.11, 1);
      driftT[o][u] = (rnd() * 0.5 + 0.5);
    }
  }
  subPh = 0;
  for (int o = 0; o < N_OSC; o++) for (int u = 0; u < MAX_UNI; u++) { fbA[o][u] = 0; fbB[o][u] = 0; }
  chW = rng3() * 0.6; chS = chW;
  if (S.pluck > 0.0001) ksExc = 1;
  for (int n = 0; n < 3; n++) env[n].gate(true);
  for (int n = 0; n < 3; n++) {
    const int mode = S.lfoMode[n];
    lfo[n].once = mode == 3;
    if (mode == 0 || mode == 3) lfo[n].retrig(S.lfoPhase[n]);
  }
  if (lastAmp < 0.0015) { f1.reset(); f2.reset(); dcX = dcY = 0; }
}
void Voice::noteOff() {
  held = false; pedal = false;
  for (int n = 0; n < 3; n++) env[n].gate(false);
}
bool Voice::finished() const {
  return (env[0].stage == E_IDLE && lastAmp < 1e-4) || (choking && choke <= 0);
}

// ── Processor ────────────────────────────────────────────────────────────
Processor::Processor(double sampleRate, const float* paramValues)
  : sr(sampleRate), gRng(0x51ed27) {
  for (int i = 0; i < PARAM_COUNT; i++) pv[i] = paramValues ? paramValues[i] : PARAM_INFO[i].def;
  bank = buildWavetables();
  for (int v = 0; v < MAX_VOICES; v++) voices.emplace_back(new Voice(v));
  gLfo[0] = Lfo(20011); gLfo[1] = Lfo(30013); gLfo[2] = Lfo(40009);
  for (auto& x : macros) x = 0;
  for (auto& l : motion) for (auto& x : l) x = 0;
}

int Processor::ix(const char* id) const {
  for (int i = 0; i < PARAM_COUNT; i++) if (!strcmp(PARAM_INFO[i].id, id)) return PARAM_INFO[i].index;
  return -1;
}

void Processor::setParam(int i, double v) { if (i >= 0 && i < PARAM_COUNT) { pv[i] = v; dirty = true; } }

void Processor::noteOnMsg(double note, double vel, NoteId id, bool hasAt, double at_) {
  if (hasAt && at_ > now()) queue(at_, 1, note, vel, id);
  else noteOn(note, vel, id);
}
void Processor::noteOffMsg(double note, NoteId id, bool hasAt, double at_) {
  if (!id.isNullish()) unqueueOff(id);
  if (hasAt && at_ > now()) queue(at_, 0, note, 0, id);
  else if (!id.isNullish()) noteOffId(id, note);
  else noteOff(note);
}
void Processor::chokeMsg(double note, NoteId id, bool hasAt, double at_) {
  if (!id.isNullish()) unqueueOff(id);
  if (hasAt && at_ > now()) queue(at_, 2, note, 0, id);
  else chokeId(id);
}
void Processor::setCap(double uni, double poly) {
  int u = toi32(uni), p = toi32(poly);
  capUni = std::max(1, std::min(MAX_UNI, u ? u : MAX_UNI));
  capPoly = std::max(1, std::min(MAX_VOICES, p ? p : MAX_VOICES));
  dirty = true;
}
void Processor::setMatrix(const std::vector<MatrixRow>& rows) {
  matrix = rows;
  chaosUsed = false;
  for (auto& r : matrix) if (r.s == S_CHAOS || r.v == S_CHAOS) chaosUsed = true;
}
void Processor::setMotion(int lane, const float* steps, int n) {
  if (lane < 0 || lane > 1) return;
  for (int i = 0; i < std::min(n, MOTION_MAX); i++) motion[lane][i] = steps[i];
}
void Processor::setTempo(double b, bool hasBeat, double bt) { bpm = b > 0 ? b : 120; if (hasBeat) beat = bt; }

void Processor::queue(double at_, int type, double note, double vel, NoteId id) {
  Ev ev{at_, type, note, vel, id.isNullish() ? NoteId::nul() : id};
  size_t i = evq.size();
  while (i > 0 && evq[i - 1].at > at_) i--;
  evq.insert(evq.begin() + i, ev);
  if (evq.size() > 512) evq.erase(evq.begin());
}
void Processor::drainQueue(double frameEnd) {
  while (!evq.empty() && evq[0].at <= frameEnd) {
    Ev ev = evq.front(); evq.erase(evq.begin());
    if (ev.type == 1) noteOn(ev.note, ev.vel, ev.id.isNullish() ? NoteId::num(-1) : ev.id);
    else if (ev.type == 2) chokeId(ev.id);
    else if (!ev.id.isNullish()) noteOffId(ev.id, ev.note);
    else noteOff(ev.note);
  }
}
void Processor::unqueueOff(const NoteId& id) {
  for (int i = (int)evq.size() - 1; i >= 0; i--) if (evq[i].type == 0 && evq[i].id.same(id)) evq.erase(evq.begin() + i);
}
void Processor::noteOffId(const NoteId& id, double note) {
  const Snap& Sx = hasS ? S : snapshot();
  if (Sx.mode >= 1) {
    bool cur = false;
    for (auto& v : voices) if (v->active && v->held && v->noteId.same(id)) { cur = true; break; }
    if (cur) noteOff(note);
    else heldNotes.erase(std::remove_if(heldNotes.begin(), heldNotes.end(), [&](const Held& h) { return h.note == note; }), heldNotes.end());
    return;
  }
  bool still = false;
  for (auto& v : voices) {
    if (!v->active || !v->held) continue;
    if (v->noteId.same(id)) {
      if (sustain) { v->held = false; v->pedal = true; }
      else v->noteOff();
    } else if (v->note == note) still = true;
  }
  if (!still) heldNotes.erase(std::remove_if(heldNotes.begin(), heldNotes.end(), [&](const Held& h) { return h.note == note; }), heldNotes.end());
}
void Processor::chokeId(const NoteId& id) {
  for (auto& v : voices) {
    if (!v->active || !v->noteId.same(id)) continue;
    v->held = false; v->pedal = false; v->choking = true;
  }
  heldNotes.erase(std::remove_if(heldNotes.begin(), heldNotes.end(), [&](const Held& h) { return h.id.same(id); }), heldNotes.end());
}
void Processor::setCC(int n, double v) {
  if (n == 11) expr = v;
  else if (n == 2) breath = v;
  else if (n == 4) foot = v;
}
void Processor::setSustain(bool on) {
  sustain = on;
  if (!on) for (auto& v : voices) if (v->active && v->pedal) v->noteOff();
}

const Snap& Processor::snapshot() {
  auto P = [&](const std::string& id) -> double { int i = ix(id.c_str()); if (i < 0) return NAN; return pv[i]; };
  auto g = [&](const std::string& id) -> double { double v = P(id); return (v != v || v == 0) ? 0 : v; };   // `|| 0`
  S.poly = std::max(1, std::min(capPoly ? capPoly : MAX_VOICES, (int)toi32(P("voice.poly"))));
  S.mode = toi32(g("voice.mode"));
  S.glide = g("voice.glide");
  S.glideAuto = g("voice.glideAuto") > 0.5;
  S.bendUp = g("voice.bendUp");
  S.bendDown = g("voice.bendDown");
  S.transpose = g("voice.transpose");
  S.tune = g("voice.tune") / 100;
  S.drift = g("voice.drift");
  S.velAmt = g("voice.velAmt");
  S.velCurve = g("voice.velCurve");
  S.vspread = g("voice.spread");
  for (int o = 0; o < N_OSC; o++) {
    const std::string q = "osc" + std::to_string(o + 1) + ".";
    S.oOn[o] = g(q + "on") > 0.5;
    S.oWave[o] = toi32(g(q + "wave"));
    S.oShape[o] = g(q + "shape");
    S.oPw[o] = g(q + "pw");
    S.oTune[o] = g(q + "oct") * 12 + g(q + "semi") + g(q + "fine") / 100;
    S.oLevel[o] = g(q + "level");
    S.oPan[o] = g(q + "pan");
    S.oUni[o] = (int)clamp(toi32(P(q + "uni")), 1, std::min(MAX_UNI, capUni ? capUni : MAX_UNI));
    S.oDet[o] = g(q + "detune");
    S.oWidth[o] = g(q + "width");
    S.oBlend[o] = g(q + "blend");
    S.oKt[o] = g(q + "keytrack");
    S.oFree[o] = g(q + "free") > 0.5;
    S.oPhase[o] = g(q + "phase");
  }
  S.sync = g("osc2.sync") > 0.5;
  S.fmRatio = g("osc2.ratio") > 0.5;
  S.oFb[0] = g("osc1.fb"); S.oFb[1] = g("osc2.fb");
  S.fm3a = g("mix.fm3a"); S.fm3b = g("mix.fm3b");
  S.chaosRate = g("chaos.rate");
  S.pluck = g("mix.pluck");
  S.pluckDecay = g("pluck.decay");
  S.pluckTone = g("pluck.tone");
  S.pluckOct = g("pluck.oct");
  S.fm = g("mix.fm");
  S.ring = g("mix.ring");
  S.sub = g("mix.sub");
  S.subWave = toi32(g("mix.subWave"));
  S.subOct = g("mix.subOct");
  S.noise = g("mix.noise");
  S.noiseType = toi32(g("mix.noiseType"));
  S.noiseFlt = g("mix.noiseFlt");
  for (int n = 0; n < 2; n++) {
    const std::string q = "flt" + std::to_string(n + 1) + ".";
    S.fModel[n] = toi32(g(q + "model"));
    S.fCut[n] = g(q + "cutoff");
    S.fRes[n] = g(q + "res");
    S.fDrv[n] = g(q + "drive");
    S.fKt[n] = g(q + "keytrack");
    S.fEnv[n] = g(q + "env");
    S.fVel[n] = g(q + "vel");
  }
  S.route = toi32(g("flt.route"));
  S.blend = g("flt.blend");
  S.spread = g("flt.spread");
  S.drive = g("mix.drive");
  S.driveType = toi32(g("mix.driveType"));
  for (int n = 0; n < 3; n++) {
    const std::string q = "env" + std::to_string(n + 1) + ".";
    auto& E = S.env[n];
    E.a = g(q + "a"); E.h = g(q + "h"); E.d = g(q + "d");
    E.s = g(q + "s"); E.r = g(q + "r"); E.curve = g(q + "curve"); E.vel = g(q + "vel");
  }
  S.env3loop = g("env3.loop") > 0.5;
  for (int n = 0; n < 3; n++) {
    const std::string q = "lfo" + std::to_string(n + 1) + ".";
    S.lfoShape[n] = toi32(g(q + "shape"));
    S.lfoRate[n] = g(q + "rate");
    S.lfoSync[n] = g(q + "sync") > 0.5 ? 1 : 0;
    S.lfoDiv[n] = divBeats(toi32(g(q + "div")));
    S.lfoDepth[n] = g(q + "depth");
    S.lfoPhase[n] = g(q + "phase");
    S.lfoDelay[n] = g(q + "delay");
    S.lfoFade[n] = g(q + "fade");
    S.lfoSm[n] = g(q + "smooth");
    S.lfoMode[n] = toi32(g(q + "mode"));
    S.lfoPw[n] = g(q + "pw");
  }
  for (int n = 0; n < 2; n++) {
    const std::string q = "mot" + std::to_string(n + 1) + ".";
    auto& M = S.mot[n];
    M.on = g(q + "on") > 0.5;
    M.steps = (int)clamp(toi32(P(q + "steps")), 1, MOTION_MAX);
    M.div = divBeats(toi32(g(q + "div")));
    M.rate = g(q + "rate");
    M.sync = g(q + "sync") > 0.5;
    M.slew = g(q + "slew");
    M.mode = toi32(g(q + "mode"));
    M.depth = g(q + "depth");
  }
  for (int m = 1; m <= 8; m++) macros[m] = g("macro." + std::to_string(m));
  S.crushOn = g("fx.crush.on") > 0.5;
  S.crushBits = clamp(g("fx.crush.bits"), 1, 16);
  S.crushRate = clamp(g("fx.crush.rate"), 0.02, 1);
  S.crushMix = g("fx.crush.mix");
  hasS = true;
  dirty = false;
  return S;
}

Voice* Processor::freeVoice(int poly) {
  const int n = std::min(poly, MAX_VOICES);
  Voice* oldest = nullptr; double best = INFINITY; Voice* released = nullptr; double rBest = INFINITY;
  for (int i = 0; i < n; i++) {
    Voice* v = voices[i].get();
    if (!v->active) return v;
    if (!v->held && !v->pedal && v->lastAmp < rBest) { rBest = v->lastAmp; released = v; }
    if (v->startTime < best) { best = v->startTime; oldest = v; }
  }
  return released ? released : oldest ? oldest : voices[0].get();
}

void Processor::noteOn(double note, double vel, NoteId id) {
  const Snap& Sx = (dirty || !hasS) ? snapshot() : S;
  heldNotes.erase(std::remove_if(heldNotes.begin(), heldNotes.end(), [&](const Held& h) { return h.note == note; }), heldNotes.end());
  heldNotes.push_back({note, vel, id});
  const bool mono = Sx.mode >= 1;
  bool anySounding = false;
  for (auto& v : voices) if (v->active && (v->held || v->pedal)) { anySounding = true; break; }
  if (!anySounding) for (int n = 0; n < 3; n++) if (Sx.lfoMode[n] == 1) gLfo[n].retrig(Sx.lfoPhase[n]);
  if (mono) {
    const int stack = Sx.mode == 3 ? std::min(Sx.poly, MAX_VOICES) : 1;
    const bool legato = Sx.mode == 2 && anySounding;
    const bool hasFrom = hasLastNote; const double from = lastNote;
    for (int s = 0; s < stack; s++) {
      Voice& v = *voices[s];
      v.uniIdx = stack > 1 ? ((double)s / std::max(1, stack - 1)) * 2 - 1 : 0;
      if (legato && v.active) {
        v.note = note; v.vel = vel; v.noteId = id; v.targetPitch = note; v.held = true;
        if (Sx.glide <= 0.0005) v.glidePitch = note;
      } else {
        const bool useFrom = !(Sx.glideAuto && !anySounding) && hasFrom;
        v.noteOn(note, vel, id, Sx, frame, useFrom, from);
      }
    }
    for (int s = stack; s < MAX_VOICES; s++) if (voices[s]->active) voices[s]->noteOff();
  } else {
    Voice* v = nullptr;
    for (int i = 0; i < std::min(Sx.poly, MAX_VOICES); i++) {
      Voice* c = voices[i].get();
      if (c->active && c->held && c->note == note) { v = c; break; }
    }
    if (!v) v = freeVoice(Sx.poly);
    v->uniIdx = 0;
    const bool useFrom = !Sx.glideAuto && hasLastNote;
    v->noteOn(note, vel, id, Sx, frame, useFrom, lastNote);
  }
  lastNote = note; hasLastNote = true;
}

void Processor::noteOff(double note) {
  heldNotes.erase(std::remove_if(heldNotes.begin(), heldNotes.end(), [&](const Held& h) { return h.note == note; }), heldNotes.end());
  const Snap& Sx = hasS ? S : snapshot();
  const bool mono = Sx.mode >= 1;
  if (mono && !heldNotes.empty()) {
    const Held prev = heldNotes.back();
    const int stack = Sx.mode == 3 ? std::min(Sx.poly, MAX_VOICES) : 1;
    for (int s = 0; s < stack; s++) {
      Voice& v = *voices[s];
      if (!v.active) continue;
      const NoteId pid = prev.id.isNullish() ? NoteId::num(-1) : prev.id;
      if (Sx.mode == 2) { v.note = prev.note; v.targetPitch = prev.note; v.held = true; v.noteId = pid; }
      else v.noteOn(prev.note, prev.vel, pid, Sx, frame, true, v.note);
    }
    lastNote = prev.note; hasLastNote = true;
    return;
  }
  for (auto& v : voices) {
    if (!v->active || v->note != note || !v->held) continue;
    if (sustain) { v->held = false; v->pedal = true; }
    else v->noteOff();
  }
}

void Processor::allNotesOff() {
  heldNotes.clear();
  for (auto& v : voices) if (v->active && (v->held || v->pedal)) v->noteOff();
}
void Processor::panic() {
  heldNotes.clear();
  sustain = false;
  evq.clear();
  for (auto& v : voices) v->kill();
}

double Processor::rand01() {
  if (random) return random(randomCtx);
  randState ^= randState << 13; randState ^= randState >> 17; randState ^= randState << 5;
  return randState / 4294967296.0;
}

void Processor::runGlobal(const Snap& S, double dt) {
  for (int n = 0; n < 2; n++) {
    const auto& M = S.mot[n];
    if (!M.on) { motVal[n] = 0; continue; }
    if (M.sync) {
      const double abs_ = floor(beat / M.div);
      if (M.mode == 0) motPos[n] = fmod(fmod(abs_, M.steps) + M.steps, M.steps);
      else if (M.mode == 1) {
        const int span = std::max(1, M.steps * 2 - 2);
        const double q = fmod(fmod(abs_, span) + span, span);
        motPos[n] = q < M.steps ? q : span - q;
      } else if (M.mode == 2) {
        if (!hasMotLastStep || abs_ != motLastStep) { motLastStep = abs_; hasMotLastStep = true; motPos[n] = toi32(rand01() * M.steps); }
      } else motPos[n] = min(abs_, M.steps - 1);
    } else {
      motPhase[n] += M.rate * dt;
      while (motPhase[n] >= 1) {
        motPhase[n] -= 1;
        const int last = M.steps - 1;
        if (M.mode == 0) motPos[n] = fmod(motPos[n] + 1, M.steps);
        else if (M.mode == 1) {
          motPos[n] += motDir[n];
          if (motPos[n] >= last) { motPos[n] = last; motDir[n] = -1; }
          else if (motPos[n] <= 0) { motPos[n] = 0; motDir[n] = 1; }
        } else if (M.mode == 2) motPos[n] = toi32(rand01() * M.steps);
        else motPos[n] = min(motPos[n] + 1, last);
      }
    }
    // motion[n][clamp(motPos, 0, 15)]: a fractional index reads undefined in
    // JS, which becomes NaN; motPos is always whole here.
    const double target = (double)motion[n][(int)clamp(motPos[n], 0, MOTION_MAX - 1)] * M.depth;
    if (M.slew > 0.001) {
      const double c = 1 - exp(-dt / (0.0008 + M.slew * 0.4));
      motVal[n] += (target - motVal[n]) * c;
    } else motVal[n] = target;
  }
  for (int n = 0; n < 3; n++) {
    const int mode = S.lfoMode[n];
    if (mode != 1 && mode != 2) continue;
    Lfo& L = gLfo[n];
    if (S.lfoSync[n]) {
      L.setPhase(beat / S.lfoDiv[n] + S.lfoPhase[n]);
      L.age += dt;
      L.eval(S.lfoShape[n], S.lfoPw[n], S.lfoSm[n], dt);
    } else {
      L.step(S.lfoShape[n], S.lfoRate[n] * dt, S.lfoPw[n], S.lfoSm[n], dt);
    }
  }
  f32* gs = gsrc;
  for (int i = 0; i < N_SRC; i++) gs[i] = 0;
  for (int n = 0; n < 3; n++) gs[4 + n] = gLfo[n].val * S.lfoDepth[n];
  gs[7] = motVal[0]; gs[8] = motVal[1];
  gs[12] = mw; gs[13] = bend; gs[14] = at;
  gs[15] = expr; gs[16] = breath; gs[17] = foot;
  for (int m = 0; m < 8; m++) gs[18 + m] = macros[m + 1];
  if (chaosUsed) {
    gChW = chaosWalk(gChW, gRng(), S.chaosRate, dt);
    gChS += (gChW - gChS) * min(1, S.chaosRate * dt * 8);
    gs[S_CHAOS] = gChS;
  }
  for (int d = D_FIRST_FX; d < N_DST; d++) gmod[d] = 0;
  for (const auto& row : matrix) {
    const int d = toi32(row.d);
    if (d < D_FIRST_FX) continue;
    const int s = toi32(row.s);
    if (s <= 0 || !row.a) continue;
    double val = gs[s];
    if (row.u && SRC_BIPOLAR[s]) val = val * 0.5 + 0.5;
    if (row.v > 0) val *= gs[toi32(row.v)];
    gmod[d] += val * row.a;
  }
}

int Processor::activeVoices() const { int c = 0; for (auto& v : voices) if (v->active) c++; return c; }

void Processor::process(float* L, float* R, int n) {
  for (int i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
  const Snap& Sx = (dirty || !hasS) ? snapshot() : S;
  int activeCount = 0;
  for (auto& v : voices) {
    if (v->active && v->finished()) v->kill();
    if (v->active) activeCount++;
  }
  if (activeCount == 0 && (evq.empty() || evq[0].at > now() + n) && !Sx.crushOn) {
    beat += (bpm / 60) * (n / sr);
    frame += n;
    return;
  }
  const double frameBase = now();
  for (int off = 0; off < n; off += CTRL) {
    const int blk = std::min(CTRL, n - off);
    const double dt = blk / sr;
    if (!evq.empty()) drainQueue(frameBase + off + blk);
    // A note-on drained above can take a fresh snapshot (dirty), which is the
    // same object in JS; Sx is a reference to S, so it sees it too.
    runGlobal(Sx, dt);
    for (auto& v : voices) if (v->active) renderVoice(*v, Sx, L, R, off, blk, dt);
    beat += (bpm / 60) * dt;
  }
  if (Sx.crushOn) {
    const double mix = clamp(Sx.crushMix + gmod[N_DST - 1], 0, 1);
    const double levels = pow(2, Sx.crushBits) - 1;
    const double step = 2 / levels;
    const double inv = 1 / step;
    double hL = chL, hR = chR, acc = cAcc;
    const double rate = Sx.crushRate;
    for (int s = 0; s < n; s++) {
      acc += rate;
      if (acc >= 1) {
        acc -= floor(acc);
        hL = round(L[s] * inv) * step;
        hR = round(R[s] * inv) * step;
      }
      L[s] = (float)((double)L[s] + (hL - L[s]) * mix);
      if (R != L) R[s] = (float)((double)R[s] + (hR - R[s]) * mix);
    }
    chL = hL; chR = hR; cAcc = acc;
  }
  frame += n;
}

void Processor::renderVoice(Voice& v, const Snap& S, float* L, float* R, int off, int blk, double dt) {
  f32* src = v.src;
  f32* md = v.md;
  const auto* e = S.env;

  const double velCurved = S.velCurve == 0 ? v.vel
    : S.velCurve > 0 ? pow(v.vel, 1 + S.velCurve * 2)
    : pow(v.vel, 1 / (1 - S.velCurve * 2));

  const double e2dMod = (double)md[D_E2D] ? pow(2, md[D_E2D] * 4) : 1;
  const double e1rMod = (double)md[D_E1R] ? pow(2, md[D_E1R] * 4) : 1;

  const double env1 = v.env[0].run(e[0].a, e[0].h, e[0].d, e[0].s, e[0].r * e1rMod, e[0].curve, dt);
  const double env2 = v.env[1].run(e[1].a, e[1].h, e[1].d * e2dMod, e[1].s, e[1].r, e[1].curve, dt);
  const double env3 = v.env[2].run(e[2].a, e[2].h, e[2].d, e[2].s, e[2].r, e[2].curve, dt);
  if (S.env3loop && (v.env[2].stage == E_SUS || v.env[2].stage == E_IDLE) && v.active) v.env[2].gate(true);

  v.age += dt;

  for (int i = 0; i < 3; i++) {
    const int mode = S.lfoMode[i];
    const bool shared = mode == 1 || mode == 2;
    Lfo& lf = shared ? gLfo[i] : v.lfo[i];
    const double depth = clamp(S.lfoDepth[i] + md[D_L1DEP + i], 0, 1);
    double raw;
    if (shared) {
      raw = lf.val;
    } else {
      const double rateMod = (double)md[D_L1RATE + i] ? pow(2, md[D_L1RATE + i] * 4) : 1;
      if (S.lfoSync[i]) {
        lf.age += dt;
        lf.setPhase(lf.ph + (bpm / 60) * dt / S.lfoDiv[i] * rateMod);
        raw = lf.eval(S.lfoShape[i], S.lfoPw[i], S.lfoSm[i], dt);
      } else {
        raw = lf.step(S.lfoShape[i], S.lfoRate[i] * rateMod * dt, S.lfoPw[i], S.lfoSm[i], dt);
      }
    }
    const double age = mode == 2 ? 1e9 : lf.age;
    double gate = 1;
    if (S.lfoDelay[i] > 0 && age < S.lfoDelay[i]) gate = 0;
    else if (S.lfoFade[i] > 0) gate = clamp((age - S.lfoDelay[i]) / S.lfoFade[i], 0, 1);
    src[4 + i] = raw * depth * gate;
  }

  src[1] = env1; src[2] = env2; src[3] = env3;
  src[7] = motVal[0]; src[8] = motVal[1];
  src[9] = velCurved;
  src[10] = (v.note - 60) / 36;
  src[11] = v.note / 127;
  src[12] = mw; src[13] = bend; src[14] = at;
  src[15] = expr; src[16] = breath; src[17] = foot;
  for (int m = 0; m < 8; m++) src[18 + m] = macros[m + 1];
  src[26] = v.randA; src[27] = v.randB;
  src[28] = v.uniIdx;
  src[29] = v.held ? 1 : 0;
  src[30] = v.alt;
  if (chaosUsed) {
    v.chW = chaosWalk(v.chW, v.rng3(), S.chaosRate, dt);
    v.chS += (v.chW - v.chS) * min(1, S.chaosRate * dt * 8);
    src[S_CHAOS] = v.chS;
  }

  for (int i = 0; i < N_DST; i++) md[i] = 0;
  for (const auto& row : matrix) {
    const int s = toi32(row.s), d = toi32(row.d);
    if (s <= 0 || d <= 0 || !row.a) continue;
    double val = src[s];
    if (row.u && SRC_BIPOLAR[s]) val = val * 0.5 + 0.5;
    if (row.v > 0) val *= src[toi32(row.v)];
    md[d] += val * row.a;
  }

  if (S.glide > 0.0005 && v.glidePitch != v.targetPitch) {
    const double c = 1 - exp(-dt / (S.glide * 0.35 + 1e-9));
    v.glidePitch += (v.targetPitch - v.glidePitch) * c;
    if (abs(v.glidePitch - v.targetPitch) < 0.0005) v.glidePitch = v.targetPitch;
  } else v.glidePitch = v.targetPitch;

  const double bendSemi = bend >= 0 ? bend * S.bendUp : bend * S.bendDown;
  const double basePitch = v.glidePitch + S.transpose + S.tune + bendSemi + md[D_PITCH] * 24
    + (S.mode == 3 ? v.uniIdx * S.vspread * 0.5 : 0);

  auto& bk = *bank;
  double (*inc)[MAX_UNI] = tInc; f32 (*ugL)[MAX_UNI] = tGL; f32 (*ugR)[MAX_UNI] = tGR; double* mipOf = tMip;

  const double lvl0 = clamp(S.oLevel[0] + md[D_O1LVL], 0, 2) * (S.oOn[0] ? 1 : 0);
  const double lvl1 = clamp(S.oLevel[1] + md[D_O2LVL], 0, 2) * (S.oOn[1] ? 1 : 0);
  const double lvl2 = clamp(S.oLevel[2] + md[D_O3LVL], 0, 2) * (S.oOn[2] ? 1 : 0);
  const double shape0 = clamp(S.oShape[0] + md[D_O1SHAPE], 0, 1);
  const double shape1 = clamp(S.oShape[1] + md[D_O2SHAPE], 0, 1);
  const double shape2 = clamp(S.oShape[2] + md[D_O3SHAPE], 0, 1);
  const double pw0 = clamp(S.oPw[0] + md[D_O1PW], 0.02, 0.98);
  const double pw1 = clamp(S.oPw[1] + md[D_O2PW], 0.02, 0.98);
  const double pw2 = S.oPw[2];
  const int uni0 = S.oUni[0], uni1 = S.oUni[1], uni2 = S.oUni[2];

  const double fmAmt = clamp(S.fm + md[D_FM], 0, 1);
  const double fmDepth = fmAmt * fmAmt * 2.5;
  const double ringAmt = clamp(S.ring + md[D_RING], 0, 1);
  const double subAmt = clamp(S.sub + md[D_SUB], 0, 1);
  const double noiseAmt = clamp(S.noise + md[D_NOISE], 0, 1);

  const double fm3a = clamp(S.fm3a + md[D_FM3], 0, 1), fm3b = clamp(S.fm3b + md[D_FM3], 0, 1);
  const double fm3aDepth = S.fm3a > 0 || (double)md[D_FM3] > 0 ? fm3a * fm3a * 2.5 : 0;
  const double fm3bDepth = S.fm3b > 0 || (double)md[D_FM3] > 0 ? fm3b * fm3b * 2.5 : 0;

  const bool needO2 = S.oOn[1] || fmDepth > 0.0001 || ringAmt > 0.0001;
  const bool needO1 = S.oOn[0] || ringAmt > 0.0001;
  const bool needO3 = S.oOn[2] || (fm3aDepth > 0.0001 && needO1) || (fm3bDepth > 0.0001 && needO2);
  need[0] = needO1; need[1] = needO2; need[2] = needO3;
  const int DFINE[3] = {D_O1FINE, D_O2FINE, D_O3FINE};

  for (int o = 0; o < N_OSC; o++) {
    if (!need[o]) continue;
    const double kt = S.oKt[o];
    const double tuneOff = S.oTune[o] + md[DFINE[o]] * 12;
    double f;
    if (o == 1 && S.fmRatio) {
      const double r = max(0.25, round(pow(2, S.oTune[1] / 12) * 4) / 4);
      f = 440 * pow(2, (basePitch - 69) / 12) * r;
    } else {
      const double tracked = 60 + (basePitch - 60) * kt;
      f = 440 * pow(2, (tracked + tuneOff - 69) / 12);
    }
    f = clamp(f, 0.02, sr * 0.49);
    const int n = S.oUni[o];
    const double det = clamp(S.oDet[o] + (o == 0 ? (double)md[D_O1DET] : o == 1 ? (double)md[D_O2DET] : 0) * 100, 0, 200);
    const double width = S.oWidth[o];
    const double blendU = S.oBlend[o];
    const double opan = S.oPan[o];
    const double comp = 1 / sqrt(n * 0.55 + 0.45);
    const double lo = n == 1 ? 1 : pow(2, -det / 1200);
    const double stepMul = n == 1 ? 1 : pow(2, (2 * det / 1200) / (n - 1));
    double fu = f * lo;
    const int centre = (n - 1) >> 1;
    for (int u = 0; u < n; u++) {
      double fd = fu;
      if (S.drift > 0.0001) {
        v.driftT[o][u] -= dt * (0.35 + u * 0.07);
        if ((double)v.driftT[o][u] <= 0) { v.driftT[o][u] += 1; v.drift[o][u] = o < 2 ? v.rng() : v.rng3(); }
        fd *= 1 + v.drift[o][u] * S.drift * 0.004;
      }
      inc[o][u] = fd / sr;
      const double lvlU = n == 1 ? 1 : (u == centre && (n & 1) ? 1 : blendU);
      const double spr = n == 1 ? 0 : ((double)u / (n - 1)) * 2 - 1;
      const double pan = clamp(opan + spr * width, -1, 1);
      ugL[o][u] = sqrt((1 - pan) * 0.5) * lvlU * comp;
      ugR[o][u] = sqrt((1 + pan) * 0.5) * lvlU * comp;
      fu *= stepMul;
    }
    const double top = f * pow(2, det / 1200) * (1 + S.drift * 0.005);
    mipOf[o] = clamp(ceil(log2(max(1e-9, TABLE_SIZE * top / sr))), 0, NUM_MIPS - 1);
  }

  for (int o = 0; o < N_OSC; o++) {
    if (!need[o]) continue;
    const double m = (o == 0 ? shape0 : o == 1 ? shape1 : shape2) * (FRAMES - 1);
    int fa = toi32(m);
    if (fa >= FRAMES - 1) fa = FRAMES - 1;
    const int fb = fa + 1 < FRAMES ? fa + 1 : fa;
    double mx = m - fa;
    if (mx < 0.0008) mx = 0; else if (mx > 0.9992) { fa = fb; mx = 0; }
    isPulse[o] = S.oWave[o] == 1;
    const auto& set = isPulse[o] ? bk[0] : bk[S.oWave[o]];
    const int frA = isPulse[o] ? 2 : fa;
    const int mip = (int)mipOf[o];
    tabA[o] = &set[frA][mip];
    tabB[o] = isPulse[o] ? tabA[o] : &set[fb][mip];
    mixF[o] = isPulse[o] ? 0 : mx;
  }

  const double kt1 = S.fKt[0] * (v.note - 60) / 12;
  const double cut1 = clamp(
    S.fCut[0] * pow(2, md[D_F1CUT] * 8 + S.fEnv[0] * env2 * 7 + kt1 + S.fVel[0] * velCurved * 4),
    12, sr * 0.47);
  const bool spreadOn = S.spread > 0.001 && S.route != 2;
  const double spr = spreadOn ? pow(2, S.spread * 1.5) : 1;
  const double res1 = clamp(S.fRes[0] + md[D_F1RES], 0, 0.995), drv1 = clamp(S.fDrv[0] + md[D_F1DRV], 0, 1);
  v.f1.set(S.fModel[0], clamp(cut1 / spr, 12, sr * 0.47), res1, drv1, sr);
  if (spreadOn) v.f1R.set(S.fModel[0], clamp(cut1 * spr, 12, sr * 0.47), res1, drv1, sr);

  const bool usesF2 = S.fModel[1] != F_BYPASS;
  if (usesF2) {
    const double kt2 = S.fKt[1] * (v.note - 60) / 12;
    const double cut2 = clamp(
      S.fCut[1] * pow(2, md[D_F2CUT] * 8 + S.fEnv[1] * env2 * 7 + kt2 + S.fVel[1] * velCurved * 4),
      12, sr * 0.47);
    v.f2.set(S.fModel[1], cut2, clamp(S.fRes[1] + md[D_F2RES], 0, 0.995), S.fDrv[1], sr);
  }
  const double fblend = clamp(S.blend + md[D_FBLEND], 0, 1);
  const int route = usesF2 ? S.route : 0;

  const double velGain = 1 - S.velAmt + S.velAmt * velCurved;
  double amp = env1 * velGain * (1 + md[D_AMP]) * OUT_TRIM;
  if (amp < 0) amp = 0;
  if (S.mode == 3) amp *= 1 / sqrt(max(1, std::min(S.poly, MAX_VOICES)));
  if (v.choking) { v.choke = max(0, v.choke - dt / CHOKE_SEC); amp *= v.choke; }
  const double panPos = clamp(
    md[D_PAN] + (S.vspread && S.mode != 3 ? (fmod(v.note, 12) / 11 - 0.5) * 2 * S.vspread : 0),
    -1, 1);
  const double tgtL = sqrt((1 - panPos) * 0.5) * amp;
  const double tgtR = sqrt((1 + panPos) * 0.5) * amp;
  const double dL = (tgtL - v.panL) / blk, dR = (tgtR - v.panR) / blk;
  double curL = v.panL, curR = v.panR;

  const double subInc = 440 * pow(2, (basePitch + S.subOct * 12 - 69) / 12) / sr;

  const bool ksOn = S.pluck > 0.0001;
  double ksLen = 0, ksG = 0, ksMix = 0; f32* ksBuf = nullptr; int ksN = 0;
  if (ksOn) {
    if (v.ks.empty()) v.ks.assign((size_t)(ceil(sr / 20) + 4), f32());
    ksBuf = v.ks.data(); ksN = (int)v.ks.size();
    const double fks = clamp(440 * pow(2, (basePitch + S.pluckOct * 12 - 69) / 12), 20, sr * 0.45);
    ksLen = clamp(sr / fks, 2, ksN - 3);
    const double t60 = 0.08 * pow(160, S.pluckDecay);
    ksG = pow(10, -3 / (t60 * fks));
    ksMix = 0.5 + (1 - S.pluckTone) * 0.5;
    if (v.ksExc) {
      const double a = 0.15 + S.pluckTone * 0.85;
      double lp = 0;
      const int Lk = (int)ceil(ksLen) + 2;
      for (int k = 0; k < ksN; k++) ksBuf[k] = 0;
      for (int k = 0; k < Lk; k++) { lp += (v.rng() - lp) * a; ksBuf[k] = lp; }
      v.ksW = Lk % ksN; v.ksLp = 0; v.ksExc = 0;
    }
  }
  const double noiseCut = 0.015 + S.noiseFlt * 0.985;
  const bool noiseOpen = S.noiseFlt > 0.985;

  const bool stereoField =
    (uni0 > 1 && S.oWidth[0] > 0.001) || (uni1 > 1 && S.oWidth[1] > 0.001) ||
    S.oPan[0] < -0.001 || S.oPan[0] > 0.001 || S.oPan[1] < -0.001 || S.oPan[1] > 0.001 ||
    (lvl2 > 0 && ((uni2 > 1 && S.oWidth[2] > 0.001) || S.oPan[2] < -0.001 || S.oPan[2] > 0.001));
  const bool stereo = stereoField || route == 2 || spreadOn;
  const bool pdOn = S.drive > 0.001;
  const double pdG = 1 + S.drive * S.drive * 24, pdT = 1 / (1 + S.drive * 2.5);
  const f32* pdTab = pdOn ? preDriveTable(S.driveType).data() : nullptr;
  const double pdS = (double)PD_N / (2 * PD_R) * pdG, pdO = PD_N / 2;

  for (int o = 0; o < N_OSC; o++) {
    for (int i = 0; i < blk; i++) { bM[o][i] = 0; bRaw[o][i] = 0; }
    if (stereo) for (int i = 0; i < blk; i++) bR[o][i] = 0;
  }

  int syncCount = 0;
  if (S.sync && needO1 && needO2) {
    double p = v.ph[0][0];
    const double d = inc[0][0];
    for (int i = 0; i < blk; i++) {
      p += d;
      if (p >= 1) { p -= 1; syncAt[syncCount++] = i; }
    }
  }

  for (int o = 2; o >= 0; o--) {
    if (!need[o]) continue;
    const int n = S.oUni[o];
    double* phArr = v.ph[o]; double* incArr = inc[o]; f32* glArr = ugL[o]; f32* grArr = ugR[o];
    const float* tA = tabA[o]->d.data(); const float* tB = tabB[o]->d.data(); const double fmix = mixF[o];
    const int len = tabA[o]->len();
    const bool pulse = isPulse[o]; const double pw = o == 0 ? pw0 : o == 1 ? pw1 : pw2;
    const double lvl = o == 0 ? lvl0 : o == 1 ? lvl1 : lvl2;
    f32* mAcc = bM[o]; f32* rAcc = bRaw[o]; f32* rgtAcc = bR[o];
    const f32* pmBuf = bRaw[1];
    const double pmAmt = o == 0 && needO2 ? fmDepth / (uni1 ? uni1 : 1) : 0;
    const f32* pm3Buf = bRaw[2];
    const double pm3Amt = !needO3 ? 0 : o == 0 ? fm3aDepth / (uni2 ? uni2 : 1) : o == 1 ? fm3bDepth / (uni2 ? uni2 : 1) : 0;
    const bool doSync = o == 1 && syncCount > 0;
    const double fbAmt = S.oFb[o] * S.oFb[o] * 0.9;
    f32* fbA = v.fbA[o]; f32* fbB = v.fbB[o];

    for (int u = 0; u < n; u++) {
      double ph = phArr[u];
      const double dph = incArr[u];
      const double gl = glArr[u] * lvl, gr = grArr[u] * lvl;
      int sIdx = 0;
      double za = fbA[u], zb = fbB[u];
      for (int i = 0; i < blk; i++) {
        ph += dph;
        if (ph >= 1) ph -= 1;
        if (doSync && sIdx < syncCount && i == syncAt[sIdx]) { ph = 0; sIdx++; }
        double s;
        if (pulse) {
          double a = ph * len;
          const int i0 = toi32(a); const double fA = a - i0;
          const double s1 = (double)tA[i0] + ((double)tA[i0 + 1] - tA[i0]) * fA;
          double p2 = ph + pw;
          if (p2 >= 1) p2 -= 1;
          a = p2 * len;
          const int i1 = toi32(a); const double fB = a - i1;
          s = (s1 - ((double)tA[i1] + ((double)tA[i1 + 1] - tA[i1]) * fB)) * 0.62;
        } else {
          double rp = ph;
          if (pmAmt != 0 || fbAmt != 0 || pm3Amt != 0) {
            if (pmAmt != 0) rp += pmAmt * pmBuf[i];
            if (pm3Amt != 0) rp += pm3Amt * pm3Buf[i];
            if (fbAmt != 0) rp += fbAmt * (za + zb) * 0.5;
            rp -= toi32(rp);
            if (rp < 0) rp += 1;
          }
          const double a = rp * len;
          const int i0 = toi32(a); const double f = a - i0;
          const double vA = (double)tA[i0] + ((double)tA[i0 + 1] - tA[i0]) * f;
          s = fmix == 0 ? vA : vA + ((double)tB[i0] + ((double)tB[i0 + 1] - tB[i0]) * f - vA) * fmix;
          if (fbAmt != 0) { zb = za; za = s; }
        }
        rAcc[i] += s;
        mAcc[i] += s * gl;
        if (stereo) rgtAcc[i] += s * gr;
      }
      phArr[u] = ph;
      fbA[u] = za; fbB[u] = zb;
    }
  }

  const f32* m0 = bM[0]; const f32* m1 = bM[1]; const f32* r0 = bR[0]; const f32* r1 = bR[1];
  const bool hear3 = needO3 && lvl2 > 0; const f32* m2 = bM[2]; const f32* r2 = bR[2];
  const f32* raw0 = bRaw[0]; const f32* raw1 = bRaw[1];
  const double ringScale = ringAmt * 1.6 / ((uni0 ? uni0 : 1) * (uni1 ? uni1 : 1));

  for (int i = 0; i < blk; i++) {
    double sL = (double)m0[i] + m1[i];
    double sR = stereo ? (double)r0[i] + r1[i] : 0;
    if (hear3) { sL += m2[i]; if (stereo) sR += r2[i]; }
    if (ringAmt > 0.0001) {
      const double rm = (double)raw0[i] * raw1[i] * ringScale;
      sL += rm; if (stereo) sR += rm;
    }
    if (subAmt > 0.0001) {
      v.subPh += subInc;
      if (v.subPh >= 1) v.subPh -= 1;
      const double p = v.subPh;
      double sv;
      if (S.subWave == 0) sv = sin(TWO_PI * p);
      else if (S.subWave == 1) sv = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      else if (S.subWave == 2) sv = p < 0.5 ? 1 : -1;
      else sv = 2 * p - 1;
      const double sg = sv * subAmt;
      sL += sg; if (stereo) sR += sg;
    }
    if (ksOn) {
      double rp = v.ksW - ksLen;
      if (rp < 0) rp += ksN;
      const int k0 = toi32(rp); const double fr = rp - k0;
      const int k1 = k0 + 1 >= ksN ? 0 : k0 + 1;
      const double y = (double)ksBuf[k0] + ((double)ksBuf[k1] - ksBuf[k0]) * fr;
      const double avg = y * (1 - ksMix * 0.5) + v.ksLp * ksMix * 0.5;
      v.ksLp = y;
      ksBuf[v.ksW] = avg * ksG;
      v.ksW = v.ksW + 1 >= ksN ? 0 : v.ksW + 1;
      const double kg = y * S.pluck * 1.4;
      sL += kg; if (stereo) sR += kg;
    }
    if (noiseAmt > 0.0001) {
      double nz = v.rng();
      if (S.noiseType == 1) {
        f32* p = v.pink;
        p[0] = 0.99886 * p[0] + nz * 0.0555179;
        p[1] = 0.99332 * p[1] + nz * 0.0750759;
        p[2] = 0.96900 * p[2] + nz * 0.1538520;
        p[3] = 0.86650 * p[3] + nz * 0.3104856;
        p[4] = 0.55000 * p[4] + nz * 0.5329522;
        p[5] = -0.7616 * p[5] - nz * 0.0168980;
        const double o = ((double)p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + nz * 0.5362) * 0.18;
        p[6] = nz * 0.115926;
        nz = o;
      } else if (S.noiseType == 2) {
        const double d = nz - v.blueLast; v.blueLast = nz; nz = d * 0.7;
      } else if (S.noiseType == 3) {
        nz = nz > 0.985 || nz < -0.985 ? nz * 6 : 0;
      }
      v.nzLp += (nz - v.nzLp) * noiseCut;
      const double ng = (noiseOpen ? nz : v.nzLp) * noiseAmt * 0.6;
      sL += ng; if (stereo) sR += ng;
    }
    if (pdOn) {
      double a = sL * pdS + pdO;
      a = a < 0 ? 0 : a > PD_N - 1 ? PD_N - 1 : a;
      int k = toi32(a);
      sL = ((double)pdTab[k] + ((double)pdTab[k + 1] - pdTab[k]) * (a - k)) * pdT;
      if (stereo) {
        a = sR * pdS + pdO;
        a = a < 0 ? 0 : a > PD_N - 1 ? PD_N - 1 : a;
        k = toi32(a);
        sR = ((double)pdTab[k] + ((double)pdTab[k + 1] - pdTab[k]) * (a - k)) * pdT;
      }
    }
    const double mid = stereo ? (sL + sR) * 0.5 : sL;
    const double hp = mid - v.dcX + 0.9985 * v.dcY;
    v.dcX = mid; v.dcY = hp;
    const double corr = hp - mid;
    mixL[i] = sL + corr;
    if (stereo) mixR[i] = sR + corr;
  }

  FilterSlot& f1 = v.f1; FilterSlot& f2 = v.f2;
  if (route == 1) {
    for (int i = 0; i < blk; i++) mixT[i] = mixL[i];
    f1.processBlock(mixL, blk, 0);
    f2.processBlock(mixT, blk, 0);
    for (int i = 0; i < blk; i++) mixL[i] = (double)mixL[i] * (1 - fblend) + (double)mixT[i] * fblend;
    if (stereo) {
      for (int i = 0; i < blk; i++) mixT[i] = mixR[i];
      (spreadOn ? v.f1R : f1).processBlock(mixR, blk, 1);
      f2.processBlock(mixT, blk, 1);
      for (int i = 0; i < blk; i++) mixR[i] = (double)mixR[i] * (1 - fblend) + (double)mixT[i] * fblend;
    }
  } else if (route == 2) {
    f1.processBlock(mixL, blk, 0);
    f2.processBlock(mixR, blk, 1);
  } else {
    f1.processBlock(mixL, blk, 0);
    if (usesF2) f2.processBlock(mixL, blk, 0);
    if (stereo) {
      (spreadOn ? v.f1R : f1).processBlock(mixR, blk, 1);
      if (usesF2) f2.processBlock(mixR, blk, 1);
    }
  }

  if (stereo) {
    for (int i = 0; i < blk; i++) {
      curL += dL; curR += dR;
      L[off + i] = (float)((double)L[off + i] + (double)mixL[i] * curL);
      R[off + i] = (float)((double)R[off + i] + (double)mixR[i] * curR);
    }
  } else {
    for (int i = 0; i < blk; i++) {
      curL += dL; curR += dR;
      const double s = mixL[i];
      L[off + i] = (float)((double)L[off + i] + s * curL);
      R[off + i] = (float)((double)R[off + i] + s * curR);
    }
  }
  v.panL = tgtL; v.panR = tgtR;
  v.lastAmp = amp;
}

}  // namespace modsynth
