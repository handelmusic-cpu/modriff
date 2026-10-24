// One mixer strip, for the native engine: a smoothed level, a smoothed pan and
// a meter.
//
// What the web does with a gain node after the part's voices (`MSX.trim`,
// set to _msxCal(part) * mix.<part> by msxVoice) and an AnalyserNode beside
// it. In the app the native part never reaches that node, so the fader did
// nothing and the part sat at unity — about 8 dB hotter than the same patch
// on the web, which is the level the calibration exists to correct.
//
// The page keeps owning the number (fader, mute and solo folded into one by
// _cmx, times the patch's calibration); this multiplies by it. The multiply
// is smoothed with an 8 ms one-pole, the rack's own time constant, so a fader
// drag or a mute does not step the signal into a click. It is a gain, so a
// fader move also rides a note that is already sounding, which the web does
// not do (it sets the gain at the next note).
//
// Pan is the web's, which is a StereoPannerNode after the part's mõdFX chain
// (fxBuildChain, behind a gain forced to two channels) and a constant-power
// compensation gain, 1/sqrt(1+sin(|pan|*pi/2)). The panner's law on a stereo
// input is the Web Audio one: left of centre the right channel is folded into
// the left and attenuated, right of centre the mirror image. It runs after the
// meter, because the web's meter taps upstream of the pan. Centre is exactly
// unity: nothing is touched, so an unpanned strip is bit for bit the signal.
//
// Header-only and free of Apple headers, so tests/ can build it on a Mac or
// Linux and the app target needs no new file in the project.
#pragma once
#include <atomic>
#include <cmath>

namespace modsynth {

static constexpr double kPi = 3.14159265358979323846;

class Strip {
 public:
  explicit Strip(double sampleRate)
      : a_(1.0 - std::exp(-1.0 / (0.008 * sampleRate))) {}

  // Control thread or audio thread; the host only calls it from the audio
  // thread, where messages are applied.
  void setLevel(double g) { target_ = g < 0 ? 0 : g; }
  double level() const { return now_; }

  // -1 (left) to 1 (right). Anything else, and NaN, is clamped or centred.
  void setPan(double p) {
    panTarget_ = !std::isfinite(p) ? 0.0 : (p < -1 ? -1.0 : (p > 1 ? 1.0 : p));
  }
  double pan() const { return panNow_; }

  // In place. Any n. Allocates nothing. The level, without the meter: the
  // host puts mõdFX between the two, because the web's meter reads the chain's
  // output.
  void gain(float* L, float* R, int n) {
    double g = now_;
    const double t = target_, a = a_;
    for (int i = 0; i < n; i++) {
      g += (t - g) * a;
      // Settle exactly once it is inaudibly close, so a muted strip is
      // exactly silent and not an exponential tail that never arrives.
      if (std::fabs(t - g) < 1e-7) g = t;
      L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g);
    }
    now_ = g;
  }
  // The pan, in place, after the meter. Smoothed with the same 8 ms one-pole as
  // the level, so a knob drag is a ramp and not a step between channels.
  void applyPan(float* L, float* R, int n) {
    double p = panNow_;
    const double t = panTarget_, a = a_;
    if (p == 0.0 && t == 0.0) return;     // centre: unity, untouched
    for (int i = 0; i < n; i++) {
      p += (t - p) * a;
      if (std::fabs(t - p) < 1e-7) p = t;
      if (p == 0.0) continue;
      if (p != lawPan_) law(p);
      const double l = L[i], r = R[i];
      if (p < 0) { L[i] = (float)((l + r * gl_) * comp_); R[i] = (float)(r * gr_ * comp_); }
      else       { L[i] = (float)(l * gl_ * comp_);       R[i] = (float)((r + l * gr_) * comp_); }
    }
    panNow_ = p;
  }
  // Mean power over both channels, the way the web meter reads one analyser
  // of the summed signal's energy. Keep the loudest block since the page
  // last asked: it polls slower than blocks arrive, and a meter that reads
  // only the latest block misses everything between.
  void measure(const float* L, const float* R, int n) {
    if (n <= 0) return;
    double sq = 0;
    for (int i = 0; i < n; i++) sq += (double)L[i] * L[i] + (double)R[i] * R[i];
    const float rms = (float)std::sqrt(sq / (2.0 * n));
    float was = rms_.load(std::memory_order_relaxed);
    while (rms > was && !rms_.compare_exchange_weak(was, rms, std::memory_order_relaxed)) {}
  }
  void process(float* L, float* R, int n) { gain(L, R, n); measure(L, R, n); }

  // The loudest block RMS since the last call, then reset. Any thread.
  float takeRms() { return rms_.exchange(0.0f, std::memory_order_relaxed); }

 private:
  // The panner's two gains and the compensation for one pan position, kept
  // until the position moves: sin and cos once per sample only while a drag is
  // in flight.
  void law(double p) {
    const double x = (p <= 0 ? p + 1.0 : p) * (M_PI / 2);
    gl_ = std::cos(x); gr_ = std::sin(x);
    comp_ = 1.0 / std::sqrt(1.0 + std::sin(std::fabs(p) * M_PI / 2));
    lawPan_ = p;
  }

  double a_;
  double target_ = 1.0, now_ = 1.0;
  double panTarget_ = 0.0, panNow_ = 0.0;
  double lawPan_ = 0.0, gl_ = 0.0, gr_ = 1.0, comp_ = 1.0;
  std::atomic<float> rms_{0.0f};
};

}  // namespace modsynth
