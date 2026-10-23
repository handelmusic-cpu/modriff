// mõdFX's buffer effects, in C++: a line-for-line port of ModFxProc, the
// AudioWorklet inside index.html (FX_WORKLET_SRC). Stutter, reverse, time warp,
// sample-rate and bit reduction, the grain shifter, and the Moog and MS-20
// ladder filters. Unlike the rest of the chain this one is plain arithmetic in
// the page — no Web Audio node does the work — so it can be held to the
// JavaScript sample for sample: tests/modsynth/modfxproc.test.js runs the real
// worklet source and this against the same input and parameters.
//
// The worklet is k-rate: its parameters are read once per block and a mode
// change is decided there. The caller feeds it in blocks of up to 128 like the
// browser does. A host block that is not a multiple of 128 moves a decision by
// a few milliseconds and changes nothing else.
#pragma once
#include <cstdint>
#include <vector>

namespace modsynth {

struct ModFxParams {
  double stutter = 0, reverse = 0, warp = 1, crush = 0, srate = 0;
  double grain = 0, grainlen = 0.5;
  double fltmode = 0, fltcut = 1, fltres = 0, fltdrv = 0;
};

class ModFxProc {
 public:
  explicit ModFxProc(double sampleRate);
  // Two channels in, two out; `in` and `out` may be the same arrays.
  void process(const float* inL, const float* inR, float* outL, float* outR, int n, const ModFxParams& p);
  // The input is gone (the chain is out of circuit): silence, and no history.
  void silence() { valid = 0; }

 private:
  enum Mode { THRU, STUTTER, REVERSE, GRAIN, WARP };
  double ladder(int c, double x);
  double sr;
  int N;
  std::vector<float> buf[2];
  int w = 0;
  double rd = 0;
  int sliceStart = 0, sliceLen = 0;
  int64_t holdC = 0;
  double holdV[2] = {0, 0};
  int64_t gCycle = 0, gPos = 0, gStart = 0;
  Mode mode = THRU;
  int64_t pos = 0;
  double xf = 0;
  double valid = 0;
  double fs[2][4] = {{0, 0, 0, 0}, {0, 0, 0, 0}};
  double fz[2] = {0, 0};
  double fg = 0, fk = 0, fdrv = 1;
  int fmode = 0;
};

}  // namespace modsynth
