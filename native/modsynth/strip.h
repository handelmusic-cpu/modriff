// One mixer strip, for the native engine: a smoothed level and a meter.
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
// Header-only and free of Apple headers, so tests/ can build it on a Mac or
// Linux and the app target needs no new file in the project.
#pragma once
#include <atomic>
#include <cmath>

namespace modsynth {

class Strip {
 public:
  explicit Strip(double sampleRate)
      : a_(1.0 - std::exp(-1.0 / (0.008 * sampleRate))) {}

  // Control thread or audio thread; the host only calls it from the audio
  // thread, where messages are applied.
  void setLevel(double g) { target_ = g < 0 ? 0 : g; }
  double level() const { return now_; }

  // In place. Any n. Allocates nothing.
  void process(float* L, float* R, int n) {
    double g = now_;
    const double t = target_, a = a_;
    double sq = 0;
    for (int i = 0; i < n; i++) {
      g += (t - g) * a;
      // Settle exactly once it is inaudibly close, so a muted strip is
      // exactly silent and not an exponential tail that never arrives.
      if (std::fabs(t - g) < 1e-7) g = t;
      const float l = (float)(L[i] * g), r = (float)(R[i] * g);
      L[i] = l; R[i] = r;
      sq += (double)l * l + (double)r * r;
    }
    now_ = g;
    if (n > 0) {
      // Mean over both channels, the way the web meter reads one analyser
      // of the summed signal's energy. Keep the loudest block since the page
      // last asked: it polls slower than blocks arrive, and a meter that
      // reads only the latest block misses everything between.
      const float rms = (float)std::sqrt(sq / (2.0 * n));
      float was = rms_.load(std::memory_order_relaxed);
      while (rms > was && !rms_.compare_exchange_weak(was, rms, std::memory_order_relaxed)) {}
    }
  }

  // The loudest block RMS since the last call, then reset. Any thread.
  float takeRms() { return rms_.exchange(0.0f, std::memory_order_relaxed); }

 private:
  double a_;
  double target_ = 1.0, now_ = 1.0;
  std::atomic<float> rms_{0.0f};
};

}  // namespace modsynth
