// DSP primitives shared by the effects rack (fxrack.cpp) and the mõdFX chain
// (mixfx.cpp): a smoother, Web Audio's biquad definitions, a lookup curve, a
// 2x oversampler and a fractional delay line. Moved out of fxrack.cpp as they
// were; nothing in them changed, and fxtest still measures the rack the same.
#pragma once
#include <algorithm>
#include <cmath>
#include <vector>

namespace modsynth {
namespace dsp {

constexpr double PI = 3.14159265358979323846;
inline double clampd(double x, double a, double b) { return x < a ? a : (x > b ? b : x); }
inline double dbToLin(double db) { return std::pow(10.0, db / 20.0); }

// fx.js ramp(): setTargetAtTime(v, now, 0.02 * 0.4) — an 8 ms one-pole.
struct Smooth {
  double v = 0, t = 0, k = 0.01;
  void init(double sr, double tau = 0.008) { k = 1.0 - std::exp(-1.0 / (sr * tau)); }
  void snap(double x) { v = t = x; }
  inline double next() { v += (t - v) * k; return v; }
};

// ── Biquads, with Web Audio's definitions ───────────────────────────────────
// Lowpass and highpass take Q in dB (Web Audio's quirk, and fx.js leaves the
// default of 1 dB nearly everywhere); allpass and the shelves take it linear.
enum BqType { LP, HP, AP, BP };
struct BqC { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0; };
struct BqS { double z1 = 0, z2 = 0; };

inline BqC bqDesign(BqType t, double f, double q, double sr, bool qInDb) {
  f = clampd(f, 10.0, sr * 0.49);
  const double w0 = 2 * PI * f / sr, c = std::cos(w0), s = std::sin(w0);
  const double Q = qInDb ? dbToLin(q) : std::max(q, 1e-4);
  const double al = s / (2 * Q);
  double b0, b1, b2;
  switch (t) {
    case LP: b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; break;
    case HP: b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; break;
    case BP: b0 = al; b1 = 0; b2 = -al; break;     // Q is linear for a bandpass, as in Web Audio
    default: b0 = 1 - al; b1 = -2 * c; b2 = 1 + al; break;
  }
  const double a0 = 1 + al;
  BqC o;
  o.b0 = b0 / a0; o.b1 = b1 / a0; o.b2 = b2 / a0;
  o.a1 = -2 * c / a0; o.a2 = (1 - al) / a0;
  return o;
}
inline double bqRun(const BqC& c, BqS& s, double x) {
  const double y = c.b0 * x + s.z1;
  s.z1 = c.b1 * x - c.a1 * y + s.z2;
  s.z2 = c.b2 * x - c.a2 * y;
  return y;
}

// Direct form I, for the phaser: its coefficients move every few samples, and
// the transposed form above carries state that stops meaning anything when
// they do — with feedback around the chain that grew without bound.
struct BqS1 { double x1 = 0, x2 = 0, y1 = 0, y2 = 0; };
inline double bqRun1(const BqC& c, BqS1& s, double x) {
  const double y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
  s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
  return y;
}

constexpr int CURVE_N = 2048;
struct Curve {
  float t[CURVE_N];
  inline float apply(float x) const {
    const float p = (x + 1.0f) * 0.5f * (CURVE_N - 1);
    if (p <= 0) return t[0];
    if (p >= CURVE_N - 1) return t[CURVE_N - 1];
    const int i = (int)p; const float fr = p - (float)i;
    return t[i] + (t[i + 1] - t[i]) * fr;
  }
};

// ── 2x oversampling around a waveshaper ─────────────────────────────────────
// A shaper makes harmonics above Nyquist that fold back down as inharmonic
// grit; run at twice the rate and filtered on the way down, they are mostly
// gone. Halfband FIR, 25 taps, so the path has a fixed latency of 12 samples
// at the base rate; the dry path is delayed by the same, or a Mix below 1
// combs.
constexpr int OS_LEN = 25, OS_C = 12;
struct Os2 {
  static const float* taps() {
    static float h[OS_LEN]; static bool init = false;
    if (!init) {
      double sum = 0, d[OS_LEN];
      for (int i = 0; i < OS_LEN; i++) {
        const double x = (i - OS_C) / 2.0;
        const double sinc = x == 0 ? 1.0 : std::sin(PI * x) / (PI * x);
        const double w = 0.42 - 0.5 * std::cos(2 * PI * i / (OS_LEN - 1)) + 0.08 * std::cos(4 * PI * i / (OS_LEN - 1));
        d[i] = 0.5 * sinc * w; sum += d[i];
      }
      for (int i = 0; i < OS_LEN; i++) h[i] = (float)(d[i] / sum);
      init = true;
    }
    return h;
  }
  float xh[OS_LEN / 2 + 1] = {};      // base-rate history
  float sh[OS_LEN] = {};              // shaped, high-rate history
  float dry[16] = {}; int dw = 0;
  // One base-rate sample in; shaped out, and the matching delayed dry.
  inline float run(const Curve& c, float x, float* dryOut) {
    const float* h = taps();
    for (int k = OS_LEN / 2; k > 0; k--) xh[k] = xh[k - 1];
    xh[0] = x;
    float u0 = 0, u1 = 0;
    for (int k = 0; k <= OS_LEN / 2; k++) u0 += h[2 * k] * xh[k];
    for (int k = 0; k < OS_LEN / 2; k++) u1 += h[2 * k + 1] * xh[k];
    u0 *= 2; u1 *= 2;
    const float y0 = c.apply(u0), y1 = c.apply(u1);
    float out = 0;
    for (int pass = 0; pass < 2; pass++) {
      for (int k = OS_LEN - 1; k > 0; k--) sh[k] = sh[k - 1];
      sh[0] = pass ? y1 : y0;
      if (pass == 1) for (int k = 0; k < OS_LEN; k++) out += h[k] * sh[k];
    }
    dry[dw & 15] = x;
    *dryOut = dry[(dw - OS_C / 2) & 15];
    dw++;
    return out;
  }
};

// ── Delay line with a fractional read ───────────────────────────────────────
struct Dl {
  std::vector<float> b; int mask = 0, w = 0;
  void init(int minLen) { int n = 1; while (n < minLen + 4) n <<= 1; b.assign((size_t)n, 0.f); mask = n - 1; w = 0; }
  inline void write(float x) { b[(size_t)(w & mask)] = x; w++; }
  inline float read(double d) const {
    const double p = (double)w - 1 - d;
    const long i = (long)std::floor(p); const float fr = (float)(p - (double)i);
    return b[(size_t)(i & mask)] * (1 - fr) + b[(size_t)((i + 1) & mask)] * fr;
  }
  void clear() { std::fill(b.begin(), b.end(), 0.f); }
};

}  // namespace dsp
}  // namespace modsynth
