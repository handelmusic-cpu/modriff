// JavaScript's numeric rules, for a port that has to come out bit for bit
// the same as modsynth/dsp.js.
//
// · Maths: V8's own fdlibm (fdlibm.cc, from V8 12.4, the version Node 22
//   runs). The C library's sin, exp and pow differ from it in the last bit
//   for about one argument in ten, and in a feedback path a last bit is not
//   the last bit for long.
// · f32: one element of a Float32Array. Every write rounds to single
//   precision and every read is a double, exactly as in JS, so an
//   expression mixing array elements is computed in double, never in float.
// · toi32: `x | 0`. jsround: Math.round, which rounds halves up, not away
//   from zero.
#pragma once
#include <cmath>
#include <cstdint>

namespace v8 { namespace base { namespace ieee754 {
double sin(double); double cos(double); double tan(double); double exp(double);
double log(double); double log2(double); double pow(double, double);
}}}

namespace js {
inline double sin(double x) { return v8::base::ieee754::sin(x); }
inline double cos(double x) { return v8::base::ieee754::cos(x); }
inline double tan(double x) { return v8::base::ieee754::tan(x); }
inline double exp(double x) { return v8::base::ieee754::exp(x); }
inline double log2(double x) { return v8::base::ieee754::log2(x); }
inline double pow(double x, double y) { return v8::base::ieee754::pow(x, y); }
inline double sqrt(double x) { return std::sqrt(x); }
inline double floor(double x) { return std::floor(x); }
inline double ceil(double x) { return std::ceil(x); }
inline double abs(double x) { return std::fabs(x); }
inline double fmod(double a, double b) { return std::fmod(a, b); }   // JS %
inline double round(double x) {
  // Math.round: the nearest integer, halves toward +∞ (−2.5 → −2).
  if (!std::isfinite(x)) return x;
  double r = std::floor(x);
  return (x - r >= 0.5) ? r + 1 : r;
}
inline double sign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }
inline int32_t toi32(double x) {
  if (!std::isfinite(x)) return 0;
  double t = std::trunc(x);
  double m = std::fmod(t, 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return (int32_t)(uint32_t)m;
}
inline double max(double a, double b) { return a > b ? a : b; }
inline double min(double a, double b) { return a < b ? a : b; }
constexpr double PI = 3.141592653589793;

struct f32 {
  float v;
  f32() : v(0) {}
  f32(double d) : v((float)d) {}
  operator double() const { return v; }
  f32& operator=(double d) { v = (float)d; return *this; }
  f32& operator+=(double d) { v = (float)((double)v + d); return *this; }
  f32& operator-=(double d) { v = (float)((double)v - d); return *this; }
  f32& operator*=(double d) { v = (float)((double)v * d); return *this; }
};

// makeRng: 32-bit xorshift in −1…1.
struct Rng {
  uint32_t s;
  explicit Rng(double seed = 0) { int32_t x = toi32(seed); s = (uint32_t)(x ? x : 0x2545f491); }
  double operator()() {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (double)(int32_t)s / 2147483648.0;
  }
};
}  // namespace js
