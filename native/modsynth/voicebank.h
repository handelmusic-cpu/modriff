// The voice bank for the native sequencer (docs/native-scheduling.md, slices 0 and 1): programs the page recorded once,
// each with the map of which numbers in it follow velocity, accent, pitch and the start time, so the engine can
// make a voice for any hit without the page. The spike (6.9.4) proved this exact for every single-note voice it tried;
// this is that, as the engine's code.
//
// A voice is replayed like this (the spike's findings, section "What the spike found"):
//  - it is begun on the 128-frame grid of the engine's blocks, a lead (2304 frames, 48 ms) before the note's onset,
//    because a voice begun off the grid has a different attack and a voice's output can start before its onset;
//  - the onset inside the program is where the reference had it plus the few frames (0..127) the grid cannot reach,
//    which is done by adding that to every slot that is a time (slope 1 against the start time);
//  - velocity, accent and pitch are patched slots: value = reference + b * (x - x0), where x is the velocity, 0 or 1
//    for accent, and 2^(semitones/12) (or the semitones, for the few slots that follow the note number) for pitch.
//    A slot that two parameters move is the product of their ratios where the page's own voice multiplies, which
//    the page found from one joint recording and marks in `mul`.
//
// Control-side code: patching allocates (it makes a new program), so it runs on the sequencer thread, never in the
// render callback.
#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <vector>

namespace modsynth {

struct BankSlot { int i; double b; int basis; };

// What a choke does to one of a lane's voices (the page's _chokeRegister: a gain, its source, and the moment the voice
// would have finished anyway). `ops` are the page recorder's own edit records, six doubles each [node, param, op, v, t, tc],
// recorded once for a choke at the voice's onset: their times are seconds after the choke, and are put back onto the
// moment a hit chokes by ChokeGroup::cut.
struct BankChoke {
  double until = 0;          // seconds after the onset the voice ends by itself; a choke after that finds nothing to cut
  std::vector<double> ops;
};   // basis 0: linear in the quantity, 1: linear in the semitones (pitch only)

struct BankEntry {
  int part = 0, kit = 0, lane = 0;
  double generation = 0;     // the page's counter: which settings this voice was recorded under
  double refAt = 0;          // the context time the note's onset had in the recorded program (seconds)
  double lead = 0.048;       // seconds from the program's start to the onset it was recorded with
  double refVel = 0.9;
  std::vector<double> prog;
  std::vector<BankSlot> vel, accent, pitch;
  std::vector<int> time;     // the slots that are times (they move 1:1 with the onset)
  std::vector<char> mul;     // per program slot: 1 where several parameters multiply
  std::vector<BankChoke> chokes;   // empty for a lane that is in no choke group (everything but the hats)

  // The flat layout (all doubles), written by the page (window._nsBank):
  //   [0] 1 version  [1] part  [2] kit  [3] lane  [4] generation  [5] refAt  [6] lead  [7] refVel  [8] n
  //   [9 .. 9+n) the program, then three lists (vel, accent, pitch) each `count, (index, b, basis) x count`,
  //   then `count, index x count` for the time slots, then `count, index x count` for the slots that multiply,
  //   then (optional, an entry without it has no chokes) `count, (until, nOps, ops x 6 x nOps) x count`.
  bool fromDoubles(const double *d, size_t n);
};

struct PatchedVoice {
  std::vector<double> prog;
  double timeBase = 0;       // for GraphPool::begin: program times are re-based by this
  uint64_t startFrame = 0;   // where to begin it (on the 128-frame grid)
};

// The voices in a choke group that are still sounding, so a closed or pedal hat can shut the open hat (the page's
// _chokeReg / _chokeGroup, index.html). A choking hit calls cut() BEFORE it adds its own voice, or it would choke its own
// tail. The cut is an edit to the pool's voice: hold the gain where the envelope has got to, fall to nothing over a
// few milliseconds, stop the source a little after, exactly the three calls the page makes on its own nodes.
//
// Control-side (the sequencer thread): the edits are copied and queued, never applied here.
class ChokeGroup {
 public:
  // `handle` the pool's, `startFrame` where the voice was begun (its clock zero), `onsetFrame` the note's frame.
  void add(int handle, uint64_t startFrame, int64_t onsetFrame, const BankEntry &e, double sampleRate) {
    // Voices that ended long ago cannot be choked by anything still to come (hits arrive in order, give or take a
    // few milliseconds of humanize), so they only take room.
    const double stale = (double)onsetFrame - 0.25 * sampleRate;
    for (size_t i = 0; i < v_.size();) { if (v_[i].untilFrame < stale) v_.erase(v_.begin() + (long)i); else i++; }
    for (const BankChoke &c : e.chokes) {
      if (v_.size() >= kMaxVoices) v_.erase(v_.begin());
      v_.push_back({handle, (double)startFrame, (double)onsetFrame + c.until * sampleRate, c.ops});
    }
  }
  // Cuts every voice that would still be sounding at `frame`. edit(handle, ops, nDoubles) -> bool queues them.
  // The group is empty afterwards, as the page's is.
  template <class Edit>
  int cut(int64_t frame, double sampleRate, Edit &&edit) {
    int sent = 0;
    std::vector<double> ops;
    for (const Voice &v : v_) {
      if (v.untilFrame <= (double)frame) continue;          // done by then
      // A millionth of a frame early, as the voices are (DrumBank::patch): the interpreter applies an event at the first whole
      // frame at or after its time, with no allowance for rounding, so a time meant for a whole frame must not come out above it.
      const double t = ((double)frame - v.startFrame - 1e-6) / sampleRate;
      ops = v.ops;
      for (size_t k = 4; k < ops.size(); k += 6) ops[k] += t;
      if (edit(v.handle, ops.data(), ops.size())) sent++;
    }
    v_.clear();
    return sent;
  }
  void clear() { v_.clear(); }
  size_t size() const { return v_.size(); }

 private:
  static constexpr size_t kMaxVoices = 64;
  struct Voice { int handle; double startFrame, untilFrame; std::vector<double> ops; };
  std::vector<Voice> v_;
};

class DrumBank {
 public:
  static constexpr int kQuantum = 128;
  static constexpr double kTimeBiasFrames = 1e-6;
  static constexpr int kLeadFrames = 2304;   // 18 quanta: what the spike validated; times the rate it is exactly 0.048 s at 48 kHz

  bool put(const double *d, size_t n) {
    auto e = std::make_unique<BankEntry>();
    if (!e->fromDoubles(d, n)) return false;
    const uint64_t k = key(e->part, e->kit, e->lane);
    entries_[k] = std::move(e);
    return true;
  }
  void clear() { entries_.clear(); }
  size_t size() const { return entries_.size(); }
  const BankEntry *find(int part, int kit, int lane) const {
    auto it = entries_.find(key(part, kit, lane));
    return it == entries_.end() ? nullptr : it->second.get();
  }

  // The voice for a hit: its program patched for this velocity, accent and pitch, and where and when to begin it.
  // `onsetFrame` is the frame the note should sound on; `notBefore` the earliest frame a voice can still be begun at
  // (a hit that is already late starts there).
  bool patch(const BankEntry &e, double vel, bool accent, double pitchSemis, int64_t onsetFrame, double sampleRate,
             uint64_t notBefore, PatchedVoice &out) const {
    const size_t n = e.prog.size();
    out.prog = e.prog;
    std::vector<unsigned char> cnt(n, 0);
    for (const auto *l : {&e.vel, &e.accent, &e.pitch}) for (const BankSlot &s : *l) if (s.i >= 0 && (size_t)s.i < n) cnt[(size_t)s.i]++;
    // Each parameter has one or two bases (a slot is linear in either): the value now and the reference's, per basis.
    auto apply = [&](const std::vector<BankSlot> &l, double xA, double x0A, double xB, double x0B) {
      for (const BankSlot &s : l) {
        if (s.i < 0 || (size_t)s.i >= n) continue;
        const double x0 = s.basis ? x0B : x0A, x = s.basis ? xB : xA;
        const double p = e.prog[(size_t)s.i];
        if (cnt[(size_t)s.i] > 1 && e.mul[(size_t)s.i]) {
          if (p != 0) out.prog[(size_t)s.i] *= ((p - s.b * x0) + s.b * x) / p;
        } else {
          out.prog[(size_t)s.i] += s.b * (x - x0);
        }
      }
    };
    apply(e.vel, vel, e.refVel, vel, e.refVel);
    apply(e.accent, accent ? 1.0 : 0.0, 0.0, accent ? 1.0 : 0.0, 0.0);
    apply(e.pitch, std::pow(2.0, pitchSemis / 12.0), 1.0, pitchSemis, 0.0);
    // Begin on the grid, a lead before the onset; the few frames the grid cannot reach go into the time slots.
    int64_t start = onsetFrame - kLeadFrames;
    start -= ((start % kQuantum) + kQuantum) % kQuantum;
    if (start < (int64_t)notBefore) {
      // Late: begin as soon as a quantum allows and move the onset the rest of the way inside the program.
      start = (int64_t)notBefore;
      start += (kQuantum - (int64_t)(notBefore % kQuantum)) % kQuantum;
    }
    // Seconds of onset past (start + lead); a hit already late is played now, not before the voice began.
    double off = (double)(onsetFrame - start - kLeadFrames) / sampleRate;
    if (off < -e.lead) off = -e.lead;
    // The reference was recorded at context time refAt, so its times are refAt-based; the voice is begun with its own
    // clock at zero, so the time slots are shifted to start there (the onset lands `lead` in, plus the few frames).
    //
    // And every time is moved a millionth of a frame early. The interpreter starts a source at the first whole frame at or
    // after its start time with no allowance for rounding (it matches the browser, graph.cpp), so a time that is meant to
    // be a whole frame and comes out a hair above one (1.1 s is 52800.00000000001 frames) starts a frame late, and which
    // way it falls depends on the digits of the sum. A kick's sweep, which the interpreter does not give the sub-frame
    // start, then differs from the same note a frame earlier by an audible-to-a-null 40 dB. Early by far less than any
    // time in a voice is exact to, a whole-frame time is never rounded up.
    const double shift = off - (e.refAt - e.lead) - kTimeBiasFrames / sampleRate;
    for (int i : e.time) if (i >= 0 && (size_t)i < n) out.prog[(size_t)i] += shift;
    out.timeBase = 0;
    out.startFrame = (uint64_t)start;
    return true;
  }

 private:
  static uint64_t key(int part, int kit, int lane) { return ((uint64_t)(part & 0xff) << 40) | ((uint64_t)(kit & 0xffffff) << 16) | (uint64_t)(lane & 0xffff); }
  std::map<uint64_t, std::unique_ptr<BankEntry>> entries_;
};

}  // namespace modsynth
