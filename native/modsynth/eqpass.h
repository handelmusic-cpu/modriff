// The EQ's two pass filters (a high-pass at the bottom of the chain, a low-pass
// at the top), shared by a part's strip (mixfx.cpp) and the master bus
// (master.cpp). What the page calls HPF and LPF in an EQ: on or off, a corner
// frequency, a resonance (Q, linear) and a slope of 12 or 24 dB per octave.
//
//  - 12 dB is one biquad, 24 dB is two in a row. The second stage's Q is fixed
//    at 1/sqrt 2: the resonance control belongs to the first stage, so turning it
//    up makes one peak, not two stacked on each other.
//  - A filter that is off is not run at all (the cost of an idle strip stays
//    nothing) and its state is cleared. Going on or off is not a switch: the
//    corner glides to or from its inert end (5 Hz for a high-pass, just under
//    Nyquist for a low-pass), where the filter does nothing, and only there is it
//    started or dropped. The slope works the same way: a 24 dB filter going to
//    12 dB glides its second stage out.
//  - A stage that starts is primed with the last two samples it was passed while
//    off (the signal's own history, since an off stage is a wire), so its first
//    samples neither dip nor step.
//  - Direct form I, in double, like the shelves beside it: the coefficients move
//    while it runs.
//  - After silence a resonant stage rings down towards zero for a long time and
//    would end in denormal numbers, which are slow on some CPUs; a stage whose
//    state is below 1e-20 (-400 dB) is set to zero at the end of each block.
//
// What the page draws for these (eqPassDb in index.html) and what Web Audio's
// highpass and lowpass nodes do (Q passed as 20*log10) are the same curve:
// native/modsynth/eqtest.cpp and tests/eq/curve.test.js hold both to the browser.
#pragma once
#include "dspkit.h"

namespace modsynth {
namespace dsp {

constexpr double EQP_HP_INERT_HZ = 5.0;                    // a high-pass here is nothing in the audio band
constexpr double EQP_LP_INERT = 0.49;                      // a low-pass at this fraction of the rate is nothing in the audio band
constexpr double EQP_Q2 = 0.70710678118654752440;          // the second stage's Q
constexpr double EQP_TAU = 0.02;                           // the corner's glide: 20 ms, as the shelves' gains

// Web Audio's highpass / lowpass with the audio-eq-cookbook coefficients and a
// linear Q (the node takes dB; the page passes 20*log10(q)).
inline BqC passDesign(bool high, double f, double q, double sr) {
  f = clampd(f, 1.0, sr * EQP_LP_INERT);
  const double w0 = 2 * PI * f / sr, c = std::cos(w0), s = std::sin(w0);
  const double al = s / (2 * std::max(q, 1e-4));
  const double b0 = high ? (1 + c) / 2 : (1 - c) / 2, b1 = high ? -(1 + c) : (1 - c);
  const double a0 = 1 + al;
  BqC o;
  o.b0 = b0 / a0; o.b1 = b1 / a0; o.b2 = b0 / a0;
  o.a1 = -2 * c / a0; o.a2 = (1 - al) / a0;
  return o;
}

inline void eqFlush(BqS1& s) {
  if (std::fabs(s.x1) < 1e-20 && std::fabs(s.x2) < 1e-20 && std::fabs(s.y1) < 1e-20 && std::fabs(s.y2) < 1e-20) s = BqS1();
}

struct PassStage {
  static constexpr int SUB = 8;                              // a moving corner is re-designed every 8 frames
  bool high = false, run = false, prime = false;
  double sr = 48000, f = 0, q = 0, fl = -1, ql = -1, k = 0;
  BqC c;
  BqS1 s[2];
  double hist[2][2] = {{0, 0}, {0, 0}};      // the last two samples seen while off, per channel, newest first

  void init(bool isHigh, double sampleRate) { high = isHigh; sr = sampleRate; k = 1.0 - std::exp(-(double)SUB / (sr * EQP_TAU)); reset(); }
  void reset() { run = false; prime = false; fl = ql = -1; s[0] = BqS1(); s[1] = BqS1(); }
  double inert() const { return high ? EQP_HP_INERT_HZ : sr * EQP_LP_INERT; }

  // A stage that is off passes the signal untouched, so the last two samples it
  // saw are the history a stage starting now should have had: it starts as if it
  // had been in the signal all along (a low-pass at its inert corner is a unity
  // gain with almost no delay), and its first samples neither dip nor step.
  static void note(const float* x, int n, double h[2]) {
    if (n >= 2) { h[0] = x[n - 1]; h[1] = x[n - 2]; } else if (n == 1) { h[1] = h[0]; h[0] = x[0]; }
  }

  // The next n frames, in place: whether this stage should be in the signal and
  // the corner and Q it is heading for. The corner glides in steps of 8 frames: a
  // biquad's coefficients stepping under it leave a small ripple at the filter's
  // own frequency, which for a low-pass near Nyquist is the highest note there is,
  // and 8-frame steps keep it far below the music.
  void process(float* L, float* R, int n, bool want, double hz, double qT) {
    if (n <= 0) return;
    if (!run) {
      if (!want) { note(L, n, hist[0]); note(R, n, hist[1]); return; }
      run = true; prime = true; f = inert(); q = qT; fl = ql = -1;
      s[0] = BqS1(); s[1] = BqS1();
    }
    if (prime) {
      for (int ch = 0; ch < 2; ch++) { s[ch].x1 = s[ch].y1 = hist[ch][0]; s[ch].x2 = s[ch].y2 = hist[ch][1]; }
      prime = false;
    }
    const double tf = want ? hz : inert();
    for (int off = 0; off < n;) {
      const bool moving = std::fabs(tf - f) > 1e-7 * tf || std::fabs(qT - q) > 1e-7 * qT;
      const int m = moving ? std::min(SUB, n - off) : n - off;
      if (moving) {
        f += (tf - f) * k; q += (qT - q) * k;
        if (!want && std::fabs(f - inert()) < (high ? 1.0 : sr * 0.005)) {     // arrived at the inert end: out
          reset(); note(L + off, n - off, hist[0]); note(R + off, n - off, hist[1]); return;
        }
      }
      if (std::fabs(f - fl) > 1e-9 * f || std::fabs(q - ql) > 1e-9 * q) { c = passDesign(high, f, q, sr); fl = f; ql = q; }
      float* l = L + off; float* r = R + off;
      for (int i = 0; i < m; i++) { l[i] = (float)bqRun1(c, s[0], l[i]); r[i] = (float)bqRun1(c, s[1], r[i]); }
      off += m;
    }
    eqFlush(s[0]); eqFlush(s[1]);
  }
};

struct PassFilter {
  PassStage a, b;
  void init(bool high, double sr) { a.init(high, sr); b.init(high, sr); }
  // `slope`: 24 for two stages, anything else one. In place, n frames.
  void process(float* L, float* R, int n, bool on, double slope, double hz, double q) {
    a.process(L, R, n, on, hz, q);
    b.process(L, R, n, on && slope >= 18, hz, EQP_Q2);
  }
  bool live() const { return a.run || b.run; }
};

}  // namespace dsp
}  // namespace modsynth
