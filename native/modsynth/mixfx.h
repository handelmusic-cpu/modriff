// mõdFX's channel chain, in C++: what `fxBuildChain` in index.html builds out
// of Web Audio nodes for each part, for a part the native engine plays.
//
// The page keeps all of the decisions. `fxApplyChannel` already works out, from
// the sends, the pad and the release, what every node in the chain should be
// at; the native chain is that same node graph fed those finished numbers
// (frequencies, gains, times), so there is one place that decides what "Drive
// 40% on the pad, Reverb latched" means and it stays JavaScript. This file is
// only the signal path:
//
//   2x low-pass, 2x high-pass → drive (parallel blend, 2x oversampled)
//   → isolator → talk filter → gate → tremolo → pan → ring mod
//   → ( dry | delay | reverb ) → wet/dry Mix against the clean part
//
// The worklet effects in front of it all (stutter, reverse, warp, bit and rate
// crush, grain, the ladder filter) are modfxproc.cpp, a port held bit for bit to
// the page's worklet source. The strip's EQ (last four parameters) is after the whole
// chain and the Mix, and runs whether or not the chain is in. The rhythmic gate's eight patterns are in the gate
// stage (GATE_PATTERNS, held to index.html's by tests/modsynth/gatepat.test.js).
// Not here yet: the sample-source axes. See docs/v5-architecture.md, step N4.
//
// The sound is not bit-identical to Web Audio's: the reverb is a feedback
// delay network where the browser convolves a noise tail, and the oversampler
// is a short FIR. tests mixfxtest.cpp measures behaviour and level instead.
//
// Audio thread rules: process() allocates nothing and takes no lock.
#pragma once
#include <memory>

namespace modsynth {

// The parameters, in the order the page posts them (`{t:'mfx', i, v}`).
// Keep in step with MFX_PARAMS in index.html — tests/modsynth/mixfx-order.test.js
// compares the two.
enum MixFxParam {
  MFX_MIX = 0,     // the part's mõdFX Mix: 1 = all chain, 0 = the clean part
  MFX_TAU,         // smoothing time constant, seconds (the release glide when the pad lets go)
  MFX_ACTIVE,      // 1 while the chain is in circuit, 0 when it has nothing to do
  MFX_LP_HZ, MFX_LP_Q,
  MFX_HP_HZ, MFX_HP_Q,
  MFX_DRV_AMT,     // the curve's amount (0..1)
  MFX_DRV_WET, MFX_DRV_DRY,
  MFX_ISO_WET, MFX_ISO_DRY, MFX_ISO_LO, MFX_ISO_MID, MFX_ISO_HI,
  MFX_FMT_WET, MFX_FMT_DRY, MFX_FMT1_HZ, MFX_FMT2_HZ,
  MFX_GATE,
  MFX_TREM_BASE, MFX_TREM_DEPTH, MFX_TREM_HZ,
  MFX_PAN,
  MFX_RING_HZ, MFX_RING_WET, MFX_RING_DRY,
  MFX_DLY_SEND, MFX_DLY_TIME, MFX_DLY_FB,
  MFX_REV_SEND,
  MFX_DRY,         // the chain's own dry level (ducks as delay or reverb come up)
  // The buffer effects (ModFxProc): set, not smoothed, as the page sets the worklet's own parameters.
  MFX_STUTTER, MFX_REVERSE, MFX_WARP, MFX_CRUSH, MFX_SRATE, MFX_GRAIN, MFX_GRAINLEN,
  MFX_FLTMODE, MFX_FLTCUT, MFX_FLTRES, MFX_FLTDRV,
  // The rhythmic gate's pattern. The gate's gain is the gate value above (already
  // scaled by the page to leave room) plus the depth times the pattern's 0..1
  // shape, as the web adds a looping buffer to gate.gain. The pattern is read
  // as an integer 0..7; the rate is bars per second (1 / the bar's length).
  // (No parameter names in these comments: the order test reads this enum.)
  MFX_GATE_PAT, MFX_GATE_PAT_AMT, MFX_GATE_PAT_HZ,
  // The part's own EQ, the mixer strip's: a low shelf at 120 Hz, a peak at the given
  // frequency, a high shelf at 8 kHz, gains in dB. Always in circuit (it is the
  // strip's, not mõdFX's: the Mix and the chain's on/off do not touch it) and not
  // run at all while it is flat.
  MFX_EQ_LO, MFX_EQ_MID, MFX_EQ_MID_HZ, MFX_EQ_HI,
  MFX_COUNT
};

class MixFx {
 public:
  explicit MixFx(double sampleRate);
  ~MixFx();
  void set(int i, double v);
  double get(int i) const;
  // In place. Any n.
  void process(float* L, float* R, int n);

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace modsynth
