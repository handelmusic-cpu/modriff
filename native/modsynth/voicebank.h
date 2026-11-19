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
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <vector>

namespace modsynth {

struct BankSlot { int i; double b; int basis; };

// A slot that follows one quantity (the note's length, a chord's velocity) as a continuous piecewise line: value = a + b * x + the sum of
// c * max(0, x - k) over its kinks. The bass voice's envelope times are these (the page's `Math.min(0.09, dur * 0.35)` is a line with one
// kink where it reaches its cap), and so are the chord's.
struct DurSlot {
  int i; double a, b; std::vector<std::pair<double, double>> hinges;
  double at(double x) const { double v = a + b * x; for (const auto &h : hinges) if (x > h.first) v += h.second * (x - h.first); return v; }
};

// What a choke does to one of a lane's voices (the page's _chokeRegister: a gain, its source, and the moment the voice
// would have finished anyway). `ops` are the page recorder's own edit records, six doubles each [node, param, op, v, t, tc],
// recorded once for a choke at the voice's onset: their times are seconds after the choke, and are put back onto the
// moment a hit chokes by ChokeGroup::cut.
struct BankChoke {
  double until = 0;          // seconds after the onset the voice ends by itself; a choke after that finds nothing to cut
  std::vector<double> ops;
};   // basis 0: linear in the quantity, 1: linear in the semitones, 2: linear in 1 / the quantity (pitch only; a sample stops after duration / rate)

struct BankEntry {
  struct TuneSlot { int i, mode; }; // 0 additive cents, 1 multiplicative frequency
  struct GlideNode { int node, param, base; };
  std::vector<TuneSlot> tuning;
  std::vector<GlideNode> glide;
  double synthAttack = 0;    // chord patch note lifetime includes its Attack
  bool processor = false;     // v2 descriptor: the part's live Processor, never a graph
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
  // Slots the voice never lets fall below a constant (a gain or ramp target is max(0.0002, ...)): the page found them from
  // soft hits, where the linear fit goes under the floor. The patched value is held at it.
  std::vector<std::pair<int, double>> floors;
  // The bass voice (part 2) is a lane of its own kind: a pitch that is the note (refPitch, MIDI), a length (the slots above,
  // `dur`), and a variant that glides from the previous note (its own entry, lane 1, with `from` slots). Zero for the drums.
  double refPitch = 0, refDur = -1, refFrom = 0;
  std::vector<DurSlot> dur;
  std::vector<BankSlot> from;      // linear in 2^(from/12) (basis 0) or in the note number (basis 1)
  struct Held { int i; double lo, hi; };
  // The chord voice for one note (chordcomp.h): which slots are the tone's level (proportional to the velocity) and its times, where its
  // panner is, and the (stop, start) slots of the sources of each half -- setting a stop to its start silences that half.
  bool isChord = false;
  std::vector<int> toneLevel, toneTime;
  std::vector<DurSlot> velCurve;   // slots that follow the velocity as a line held to a floor or a cap (a filter that opens up to its ceiling): replace the value

  int panSlot = -1;
  struct Src { int stop, start, node; };   // a source's stop and start slots and its node: setting the stop to the start silences it
  std::vector<Src> subStops, toneStops;
  std::vector<double> cutOps;      // what a note that starts inside this one's tail does to it: six doubles an edit, times seconds after that note's start
  // A held chord (part 4: the voice as a gated hit plays it, with no decay of its own) is let go of by the page's release: hold the gains, fall on
  // the Release knob, stop the sources. Six doubles an edit, times seconds after the moment of release; that moment is never earlier than
  // `relMin` seconds after the voice began (the attack and 20 ms).
  double relMin = 0;
  std::vector<double> releaseOps;
  std::vector<Held> held;          // pitch slots held to [lo, hi] (a playback rate that follows the note inside the roll, not past its ends)
  // The arp voice (part 5): a quantity of its own besides the velocity -- the pattern's dynamic level, which only scales the gain (the page's `level`
  // beside `vel`, which also opens the filter). Linear like the velocity; refLevel is the level the recording was made at.
  // The envelope's events come in an order that depends on the note's length against the attack, so the arp voice has an entry per regime of length;
  // an entry is valid for notes shorter than `durMax` seconds (the player takes the first that holds).
  double refLevel = 1, durMax = 1e9, refPan = 0;
  std::vector<BankSlot> level, pan;      // the dynamic level and the left-right pan the step is struck with
  // The melody generator voice (part 6): how long the slide into the note takes, seconds (its `from` slots are the bass's).
  double refGtime = 0;
  std::vector<BankSlot> gtime;

  // The flat layout (all doubles), written by the page (window._nsBank):
  //   Version 2 is [2, part (2 bass, 3 chord, 5 arp, 6 melody), kit, -1, generation], with attack appended for chord.
  //   It refers to the live Processor; patch controls keep their existing path.
  //   [0] 1 version  [1] part  [2] kit  [3] lane  [4] generation  [5] refAt  [6] lead  [7] refVel  [8] n
  //   [9 .. 9+n) the program, then three lists (vel, accent, pitch) each `count, (index, b, basis) x count`,
  //   then `count, index x count` for the time slots, then `count, index x count` for the slots that multiply,
  //   then (optional, an entry without it has no chokes) `count, (until, nOps, ops x 6 x nOps) x count`,
  //   then (optional, only after the chokes) `count, (index, floor) x count`,
  //   then (optional, the bass: only after the floors) `refPitch, refDur, refFrom, count, (index, a, b, nKinks, (k, c) x nKinks) x count, count, (index, b, basis) x count, count, (index, lo, hi) x count, nDoubles, cutOps,
  //   then (optional, the chord voice: only after the cut) `nLevel, index x n, nTime, index x n, panSlot, nSub, (stop, start, node) x n, nTone, (stop, start, node) x n, nVelCurve, (index, a, b, lo, hi) x n`,
  //   then (optional, the held chord, part 4: only after the velocity curves) `relMin, nDoubles, releaseOps`,
  //   then (optional, the arp, part 5: only after the release) `refLevel, count, (index, b, basis) x count, durMax, refPan, count, (index, b, basis) x count, refGtime, count, (index, b, basis) x count`.
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

  // A recorded kit's lane is not one voice but one per take of each velocity layer (the page's sqLayerTrack picks the layer by how hard the
  // stroke is and alternates the takes). Each is its own entry under the lane number moved up by 64 * (1 + layer * 8 + take); the layers and
  // takes that exist are whichever of those keys are held, so the page's layout is not sent twice. A lane that is one voice is under its own number.
  static constexpr int kVariantStep = 64, kMaxLayers = 8, kMaxTakes = 8;
  static int variantLane(int lane, int layer, int take) { return lane + kVariantStep * (1 + layer * kMaxTakes + take); }
  // The take for a hit of `dyn` (how hard the stroke is within its step) on its `turn`th play of the lane, or null for a lane with no
  // variants. The same arithmetic as the page's: _drumLayerFor, then turn % takes (index.html, sqLayerTrack).
  const BankEntry *findVariant(int part, int kit, int lane, double dyn, bool accent, uint64_t turn) const {
    if (lane < 0 || lane >= kVariantStep) return nullptr;
    int layers = 0;
    while (layers < kMaxLayers && find(part, kit, variantLane(lane, layers, 0))) layers++;
    if (!layers) return nullptr;
    const double d = dyn * (accent ? 1.25 : 1.0), f = std::floor((d - 0.2) / 1.1 * layers);
    const int want = f != f ? 0 : f < 0 ? 0 : f > layers - 1 ? layers - 1 : (int)f;
    int takes = 0;
    while (takes < kMaxTakes && find(part, kit, variantLane(lane, want, takes))) takes++;
    return find(part, kit, variantLane(lane, want, (int)(turn % (uint64_t)(takes ? takes : 1))));
  }

  // The voice for a hit: its program patched for this velocity, accent and pitch, and where and when to begin it.
  // `onsetFrame` is the frame the note should sound on; `notBefore` the earliest frame a voice can still be begun at
  // (a hit that is already late starts there).
  // `durSec` and `fromMidi` are the bass's length and the note it glides from; the drums leave them out.
  // `level` is the arp's dynamic level, `pan` where it is struck in the field (part 5 only) and `gtime` the melody's slide time (part 6 only); the others have no slots for them.
  bool patch(const BankEntry &e, double vel, bool accent, double pitchSemis, int64_t onsetFrame, double sampleRate,
             uint64_t notBefore, PatchedVoice &out, double durSec = -1, double fromMidi = -1, double level = 1, double pan = 0, double gtime = 0, double tune = 0) const {
    const size_t n = e.prog.size();
    out.prog = e.prog;
    std::vector<unsigned char> cnt(n, 0);
    for (const auto *l : {&e.vel, &e.accent, &e.pitch, &e.from, &e.level, &e.pan, &e.gtime}) for (const BankSlot &s : *l) if (s.i >= 0 && (size_t)s.i < n) cnt[(size_t)s.i]++;
    // Each parameter has one or two bases (a slot is linear in either): the value now and the reference's, per basis.
    // basis 2 is the reciprocal of basis 0 (the pitch's 1/ratio): a recorded sample stops after duration / playbackRate.
    auto apply = [&](const std::vector<BankSlot> &l, double xA, double x0A, double xB, double x0B, double xC = 0, double x0C = 0) {
      for (const BankSlot &s : l) {
        if (s.i < 0 || (size_t)s.i >= n) continue;
        const double x0 = s.basis == 2 ? x0C : s.basis ? x0B : x0A, x = s.basis == 2 ? xC : s.basis ? xB : xA;
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
    pitchSemis -= e.refPitch;
    apply(e.pitch, std::pow(2.0, pitchSemis / 12.0), 1.0, pitchSemis, 0.0, std::pow(2.0, -pitchSemis / 12.0), 1.0);
    if (!e.level.empty()) apply(e.level, level, e.refLevel, level, e.refLevel);
    if (!e.pan.empty()) apply(e.pan, pan, e.refPan, pan, e.refPan);
    if (!e.gtime.empty()) apply(e.gtime, gtime, e.refGtime, gtime, e.refGtime);
    if (!e.from.empty() && fromMidi >= 0) apply(e.from, std::pow(2.0, fromMidi / 12.0), std::pow(2.0, e.refFrom / 12.0), fromMidi, e.refFrom);
    for (const DurSlot &c : e.velCurve) if (c.i >= 0 && (size_t)c.i < n) out.prog[(size_t)c.i] = c.at(vel);
    // Tune before pitch clamps: the bass pluck's noise rate follows frequency
    // and is then held to its limits, exactly as its page voice constructs it.
    for (const auto &t : e.tuning) {
      if (t.mode == 0) out.prog[(size_t)t.i] += tune;
      else out.prog[(size_t)t.i] *= std::pow(2.0,tune / 1200.0);
    }
    for (const auto &h : e.held) out.prog[(size_t)h.i] = std::min(std::max(out.prog[(size_t)h.i], h.lo), h.hi);
    if (!e.dur.empty() && durSec >= 0) for (const DurSlot &d : e.dur) if (d.i >= 0 && (size_t)d.i < n) out.prog[(size_t)d.i] = d.at(durSec);
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
    for (const auto &f : e.floors) if (out.prog[(size_t)f.first] < f.second) out.prog[(size_t)f.first] = f.second;
    out.timeBase = 0;
    out.startFrame = (uint64_t)start;
    return true;
  }

 private:
  static uint64_t key(int part, int kit, int lane) { return ((uint64_t)(part & 0xff) << 40) | ((uint64_t)(kit & 0xffffff) << 16) | (uint64_t)(lane & 0xffff); }
  std::map<uint64_t, std::unique_ptr<BankEntry>> entries_;
};

}  // namespace modsynth
