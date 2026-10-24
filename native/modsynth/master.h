// The master bus, in C++: what `buildMasterBus` in index.html builds out of Web
// Audio nodes, for the parts the native engine plays.
//
//   direct ── drive ─────────────────────────────────────┐
//   room ──── drive ─┬────────────────────────────────┐  ↓
//                    └→ send → reverb network ────────┴→ glue compressor
//                                                         → limiter → volume
//
// Two inputs because the web has two ways in. Everything but the chord part
// enters `_masterDest`: through the drive, then dry and through the bus room.
// The chord part has its own pair of drive and room (4.3.0), because its room is
// a pair of reverbs that can drop the old chord's tail at a change; it meets the
// others at the glue compressor. Natively the chord's room is the effects rack's
// own reverb, so its path here is drive and straight to the glue. The host says
// which parts are which.
//
// The page keeps every decision. `_webMasterApply` works out the finished
// numbers (volume, the compressor's and limiter's threshold and ratio, the room
// send) from the four master settings and the on/off switch; the native bus is
// handed those, as mõdFX is handed its nodes' values. Bypass is neutral
// settings, not a rewire, here as there.
//
// The sound is not bit-identical to Web Audio's: `DynamicsCompressorNode` is
// implementation-defined, and the bus reverb is a network where the browser
// convolves a noise tail. What is held is behaviour, measured against the
// browser's own compressor and chain: tests/modsynth/master.test.js, against a
// recording made by tests/modsynth/master-ref.html. The compressor is a port of
// the algorithm WebKit's and Blink's share (a soft-knee curve with automatic
// make-up gain, an averaged detector, adaptive release, 6 ms look-ahead), which
// is why it can be compared at all.
//
// Audio thread rules: process() allocates nothing and takes no lock.
#pragma once
#include <memory>

namespace modsynth {

// The bus room: the web's _makeRoomIR(c, 2.4) as a network. Exposed so the test
// builds the same one the bus does.
//  - SCALE is the delay-length factor that goes with that length on the rack's
//    size scale.
//  - RT60 is fitted, not derived. Pinning the time the impulse takes to reach
//    -60 dB (2.2 s) leaves the network 12 dB under the convolver by a second
//    into the tail, because a convolver with this impulse falls slowly at first
//    and then collapses where the impulse ends, while a network falls at one
//    rate throughout. 3.4 s follows the recorded convolver within about 1 dB for
//    the first 1.6 s after the input stops, which is all of the tail that sits
//    less than 27 dB under it; past that it rings on where the convolver stops.
//  - TRIM_DB brings the network's level on steady noise to the convolver's.
constexpr double MASTER_ROOM_SECONDS = 2.4;
constexpr double MASTER_ROOM_SCALE = 0.6 + (MASTER_ROOM_SECONDS - 0.25) / 5.5;
constexpr double MASTER_ROOM_RT60 = 3.4;
constexpr double MASTER_ROOM_TRIM_DB = 1.0;

// The glue compressor and the limiter are the same machine with different
// settings (the web builds two DynamicsCompressorNodes).
class Dynamics {
 public:
  explicit Dynamics(double sampleRate);
  ~Dynamics();
  // dB, dB, ratio:1, seconds, seconds. Cheap to call every block; the static
  // curve is only re-derived when threshold, knee or ratio change.
  void set(double thresholdDb, double kneeDb, double ratio, double attack, double release);
  // In place, stereo-linked. Delays the audio by the look-ahead (6 ms).
  void process(float* L, float* R, int n);
  // The gain the last block applied, dB (<= 0), for metering.
  double reductionDb() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

// The parameters, in the order the page posts them (`{t:'master', i, v}`).
enum MasterParam {
  MB_VOL = 0,      // master volume (linear), after the limiter
  MB_CMP_TH,       // glue compressor threshold, dB
  MB_CMP_RATIO,    // glue compressor ratio
  MB_LIM_TH,       // limiter threshold, dB
  MB_LIM_RATIO,    // limiter ratio
  MB_REV_SEND,     // the bus room's send, linear
  MB_DRV_AMT,      // drive amount, 0..1 (the app's fx.drive)
  MB_DRV_OUT,      // gain after the drive curve: makeup × span, worked out by the page
  MB_COUNT
};

class MasterBus {
 public:
  explicit MasterBus(double sampleRate);
  ~MasterBus();
  void set(int i, double v);
  double get(int i) const;
  // `direct` is mixed in place and is the output. `roomL/R` is the sum of the
  // parts that go through the bus room; it is read, not written. Any n.
  void process(float* L, float* R, const float* roomL, const float* roomR, int n);
  // Loudest block RMS (both channels) since the last call, then reset.
  float takeRms();

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace modsynth
