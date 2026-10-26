// mõdSynth's effects rack, in C++.
//
// What modsynth/fx.js builds out of Web Audio nodes, for the native engine,
// which has no Web Audio: drive → chorus → phaser → delay → reverb →
// compressor → OTT → grit → stereo width → master. The order, the parameter
// ranges, the curves and the "an effect a macro is turning up counts as on"
// rule are fx.js's. The sound is not bit-identical and is not meant to be:
// Web Audio's biquads, compressor and convolver are the browser's own, so the
// null test that holds the voices to the JS sample for sample cannot hold
// this. What is held is behaviour — each stage does what its knob says — and
// the levels, which tests/modsynth/fxrack.test.js measures.
//
// Differences from fx.js, each on purpose:
//   - The reverb is a feedback delay network, not a convolution with a
//     generated noise tail. A 5-second convolver per part is a billion
//     multiplies a second on a phone; the network is a few hundred thousand.
//     It is fitted to the same length, damping, pre-delay and width, and
//     level-matched to the convolver's normalised output on white noise.
//   - The EQ is absent in both: fx.js builds the three bands and never sets
//     them, so they are flat. Nothing to port.
//   - No limiter. Inside mõdRïff the rack's own limiter is taken out (the
//     master bus has one after every part); fx.js does the same when it is
//     given a destination, and the native engine always is.
//   - Drive and Grit are oversampled 2x, where fx.js asks for 4x and 2x.
//
// Audio thread rules: process() allocates nothing and takes no lock. Every
// buffer is sized in the constructor, which runs on the caller's thread.
#pragma once
#include <cstdint>
#include <memory>
#include <vector>
#include "params_gen.h"

namespace modsynth {

class FxRack {
 public:
  explicit FxRack(double sampleRate);
  ~FxRack();

  // A host parameter by its index in HOST_FX (the page uses the same order).
  // Enums arrive as their index, booleans as 0 or 1.
  void set(int i, double v);
  // The matrix output for the five FX destinations, normalised as the worklet
  // reports it: drive amount, delay mix, reverb mix, chorus mix, phaser rate.
  void setMods(const double* m5);
  void setTempo(double bpm);
  // In place. Any n; the rack works in short chunks internally.
  void process(float* L, float* R, int n);

  // A reverb send, for the graph path's rooms: the page's voices carry their send
  // level in the graph, so what comes back is the tail alone at unit gain, the way
  // a ConvolverNode's output is. setSendReverb fits it to an impulse of noise
  // falling as (1-t)^exponent over `seconds`; processSend replaces L and R (the
  // send's sum) with the tail. Use an instance for this and nothing else.
  void setSendReverb(double seconds, double exponent);
  void processSend(float* L, float* R, int n);

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace modsynth
