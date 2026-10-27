#include <time.h>
#import "ModEngineHost.h"

#import <os/lock.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <cmath>
#include <map>
#include <memory>
#include <vector>

#include "modsynth.h"
#include "fxrack.h"
#include "strip.h"
#include "mixfx.h"
#include "master.h"
#include "capture.h"
#include "graphpool.h"

namespace {

constexpr int kMaxParts = 8;
// The one part that reaches the master bus by its own way in (the chord part,
// whose room is the effects rack's own reverb). Every other part goes through
// the bus room, as everything but the chord does on the web. See master.h.
constexpr int kDirectPart = 0;
// Capture streams: the master, then each part's own bus.
constexpr int kCapStreams = 1 + kMaxParts;
// 2^19 frames is 10.9 s at 48 kHz: the page drains a few times a second, and
// this is the slack for the stretches it does not (a backgrounded web view runs
// its timers about once a second). Two floats a frame, so 4 MB a stream, and
// only for the streams a take asks for.
constexpr size_t kCapFrames = 1u << 19;
constexpr uint32_t kCapReadFrames = 1u << 17;
// A patch's mod matrix. dsp.js takes however many rows it is given; a fixed
// cap is what lets a matrix travel through the queue as a POD. 32 is well
// clear of the largest factory patch, and setMatrix is told the real count.
constexpr int kMaxMatrixRows = 32;
// Headroom between the caller's thread and the audio thread. 256 was not
// enough: a patch change is a pAll, a matrix, two motion lanes and a burst of
// parameter writes, and several in a row overran it. The queue drops what
// will not fit, and the message most likely to be dropped in a burst is the
// note-off at the end of it — which is a note that hangs.
//
// 1024 slots is four batches of the 128 the page sends at once, and costs
// about 1.4 MB of the message union. Memory is the cheap side of that trade.
constexpr int kQueueSlots = 1024;

enum class MsgType : uint8_t {
  Param, ParamAll, NoteOn, NoteOff, Choke, Panic, AllOff,
  Mw, Bend, Aftertouch, CC, Sustain, Macro, Cap, Matrix, Motion, Tempo, Fx, Strip, Mfx, Master
};

// One message, fixed size, trivially copyable. The union is sized by the
// matrix (32 × 5 doubles); a note-on wastes most of it, which costs ~346 KB
// for the whole queue and buys a single ordered channel. Two queues — one
// small, one bulk — would be tighter and would lose the ordering between a
// patch change and the note that must be played with it.
struct Msg {
  MsgType type;
  uint8_t part;
  uint8_t idKind;      // modsynth::NoteId::Kind
  bool hasAt;
  bool hasAtRel;       // `at` given as frames from now, not an absolute frame
  double atRel;
  double ts;           // the page's wall clock (ms) when it made the message; 0 = none
  bool hasBeat;
  bool flag;           // sustain on/off
  int32_t i;           // param index | cc number | macro index | motion lane | row/step count
  double v;            // value | bpm | cc value
  double note, vel, at, id, beat;
  double uni, poly;    // cap
  union {
    float params[modsynth::PARAM_COUNT];
    double matrix[kMaxMatrixRows][5];
    float motion[modsynth::MOTION_MAX];
  } payload;
};

// A single-producer / single-consumer ring. The consumer (the render thread)
// never blocks and never allocates; the producer is serialised by a lock the
// consumer does not touch, so several caller threads are safe while the audio
// thread stays lock-free.
class Queue {
 public:
  bool push(const Msg& m) {
    const uint32_t w = write_.load(std::memory_order_relaxed);
    const uint32_t next = (w + 1) % kQueueSlots;
    if (next == read_.load(std::memory_order_acquire)) return false;   // full
    buf_[w] = m;
    write_.store(next, std::memory_order_release);
    return true;
  }
  bool pop(Msg& out) {
    const uint32_t r = read_.load(std::memory_order_relaxed);
    if (r == write_.load(std::memory_order_acquire)) return false;     // empty
    out = buf_[r];
    read_.store((r + 1) % kQueueSlots, std::memory_order_release);
    return true;
  }
 private:
  Msg buf_[kQueueSlots];
  std::atomic<uint32_t> write_{0};
  std::atomic<uint32_t> read_{0};
};

modsynth::NoteId noteIdFrom(uint8_t kind, double n) {
  switch (kind) {
    case modsynth::NoteId::NUM: return modsynth::NoteId::num(n);
    case modsynth::NoteId::NUL: return modsynth::NoteId::nul();
    default: return modsynth::NoteId();
  }
}

// `id` in a worklet message is a number, or null, or absent — and JS tells
// those three apart (null !== undefined). NSDictionary does the same with a
// missing key and NSNull, so the distinction survives the bridge.
uint8_t idKindOf(id value) {
  if (value == nil) return modsynth::NoteId::UND;
  if (value == [NSNull null]) return modsynth::NoteId::NUL;
  return modsynth::NoteId::NUM;
}

double num(id value, double fallback = 0) {
  return [value isKindOfClass:[NSNumber class]] ? [(NSNumber *)value doubleValue] : fallback;
}

}  // namespace

@implementation ModEngineHost {
  std::unique_ptr<modsynth::Processor> _parts[kMaxParts];
  // One effects rack per part, built with its processor (before it is
  // published) and read on the render thread only through _live.
  std::unique_ptr<modsynth::FxRack> _racks[kMaxParts];
  // And one mixer strip: the level the page folds fader, mute, solo and the
  // patch calibration into, and the meter beside it. Built with the part.
  std::unique_ptr<modsynth::Strip> _strips[kMaxParts];
  // And the part's mõdFX chain, after the strip: the web's fxBuildChain.
  std::unique_ptr<modsynth::MixFx> _mixfx[kMaxParts];
  // The master bus: one for the whole engine, built with it. Everything the
  // parts make ends up here before it leaves.
  std::unique_ptr<modsynth::MasterBus> _master;
  std::vector<float> _roomL, _roomR;     // the sum of the parts that go through the bus room
  // Capture rings (capture.h), built on first use and kept: the render thread
  // reads the pointers, and a ring it might still be writing is never freed.
  std::unique_ptr<modsynth::CaptureRing> _capRings[kCapStreams];
  std::atomic<modsynth::CaptureRing *> _cap[kCapStreams];
  os_unfair_lock _capLock;
  // Where engine frame 0 sits on the wall clock (CLOCK_REALTIME, ms): the
  // running median of (a block's wall time - its frame / rate) since the last
  // take began (capture.h, PhaseTracker, for why a median and not a minimum).
  // Reset by the next take.
  std::atomic<double> _clkOrigin;
  std::atomic<bool> _clkReset;
  modsynth::PhaseTracker _clk;    // the estimate behind it; render thread only
  // How far from that origin the blocks that actually placed notes were, on
  // average (ms), over the take. A message waits for the next callback and is
  // placed from that block's wall time (applyMessage), so the blocks that place
  // notes are the first after a gap, not a sample of all blocks: a median or a
  // minimum over every block misses by the difference, and a real bounce had the
  // native chord 31 ms and then 46 ms early. The page shifts the native audio
  // later by this much. Render thread writes; any thread reads _drainMean.
  double _curOff, _drainSum;
  uint32_t _drainN;
  std::atomic<double> _drainMean;
  // What a take's notes looked like on arrival, for the capture report
  // (render thread writes, a racy read is fine for a diagnostic): note-ons that
  // came with a usable stamp and how long they had waited and been scheduled
  // ahead on average, ones whose stamp was unusable, ones with no schedule at
  // all, and the smallest and largest callback.
  double _dDelaySum, _dRelSum;
  uint32_t _dStamped, _dBadStamp, _dPlain, _cbMin, _cbMax;
  // Read by the render thread, written by whoever calls ensurePart. The
  // unique_ptr above owns it; this is the audio thread's view of whether it
  // exists yet, published with release so the object is fully built first.
  std::atomic<modsynth::Processor *> _live[kMaxParts];
  std::vector<modsynth::MatrixRow> _matrixScratch[kMaxParts];
  std::vector<float> _scratchL, _scratchR;
  Queue _queue;
  os_unfair_lock _pushLock;
  std::atomic<uint64_t> _frames;
  std::atomic<uint32_t> _dropped;
  std::atomic<uint32_t> _notesOn;
  std::atomic<float> _peak;
  // Frames each processor has rendered, including the warm-up's. Processor
  // keeps its own frame counter privately and `at` is measured against it, so
  // the host has to know the same number to turn "in 20 ms" into a frame.
  uint64_t _partFrames[kMaxParts];
  int _maxFrames;

  // ── The graph path (graphpool.h): voices the page recorded as Web Audio
  // graphs, played by the interpreter with no Processor behind them. ──
  // begin/edit and the table below belong to whoever holds _graphLock (the
  // control thread: the one that receives the page's calls); render() belongs
  // to the render thread, which never takes the lock.
  modsynth::GraphPool _graphs;
  os_unfair_lock _graphLock;
  std::map<int, int> _gidHandle;          // the page's voice id -> the pool's handle
  // A part played as graphs: it has a strip and mõdFX (and a capture ring) but
  // no Processor and no rack. Published with release once they are built.
  std::atomic<bool> _graphLive[kMaxParts];
  std::atomic<bool> _graphOn;             // any graph part exists: the render thread has buses to zero
  // Frames of mõdFX tail still to run on a graph part after its last voice
  // sounded (a Processor part runs always; this one only when it has something).
  int64_t _graphTail[kMaxParts];
  // The two reverbs the graph voices send to (buses 9 and 10), fitted to the
  // page's convolver (FxRack::setSendReverb), and how long each has still to ring.
  std::unique_ptr<modsynth::FxRack> _roomRack[2];
  int64_t _roomTail[2];
  // The block-start offset of the wall clock from the engine's frames (ms), as
  // _curOff, for the control thread to turn a voice's stamp into a frame the way
  // applyMessage does for a note. NaN until a block has run.
  std::atomic<double> _curOffPub;
  std::vector<float> _gbus;               // kBuses pairs of scratch buffers, _maxFrames each
}

- (instancetype)initWithSampleRate:(double)sampleRate maxFrames:(int)maxFrames {
  if ((self = [super init])) {
    _sampleRate = sampleRate;
    _maxFrames = maxFrames > 0 ? maxFrames : 4096;
    _pushLock = OS_UNFAIR_LOCK_INIT;
    _frames.store(0);
    _dropped.store(0);
    _notesOn.store(0);
    _peak.store(0.0f);
    for (int p = 0; p < kMaxParts; p++) {
      _live[p].store(nullptr, std::memory_order_relaxed);
      _partFrames[p] = 0;
      _matrixScratch[p].reserve(kMaxMatrixRows);
    }
    _scratchL.assign((size_t)_maxFrames, 0.0f);
    _scratchR.assign((size_t)_maxFrames, 0.0f);
    _roomL.assign((size_t)_maxFrames, 0.0f);
    _roomR.assign((size_t)_maxFrames, 0.0f);
    _master = std::make_unique<modsynth::MasterBus>(sampleRate);
    _graphLock = OS_UNFAIR_LOCK_INIT;
    _graphOn.store(false);
    _curOffPub.store(std::nan(""));
    for (int p = 0; p < kMaxParts; p++) { _graphLive[p].store(false, std::memory_order_relaxed); _graphTail[p] = 0; }
    // Bus 9 is the chord's own room, bus 10 the shared one: both are the page's
    // buildReverb impulse, noise falling as (1-t)^2.5 over chord.reverbSize (1.8 s).
    for (int k = 0; k < 2; k++) { _roomRack[k] = std::make_unique<modsynth::FxRack>(sampleRate); _roomRack[k]->setSendReverb(1.8, 2.5); _roomTail[k] = 0; }
    _gbus.assign((size_t)modsynth::GraphPool::kBuses * 2 * (size_t)_maxFrames, 0.0f);
    _capLock = OS_UNFAIR_LOCK_INIT;
    _clkOrigin.store(1e300); _clkReset.store(false);
    _curOff = 0; _drainSum = 0; _drainN = 0; _drainMean.store(0);
    _dDelaySum = _dRelSum = 0; _dStamped = _dBadStamp = _dPlain = 0; _cbMin = 0xffffffffu; _cbMax = 0;
    for (int i = 0; i < kCapStreams; i++) _cap[i].store(nullptr, std::memory_order_relaxed);
  }
  return self;
}

// The objects for a part, not yet visible to the render thread.
- (void)buildPart:(int)part {
  _parts[part] = std::make_unique<modsynth::Processor>(_sampleRate);
  _racks[part] = std::make_unique<modsynth::FxRack>(_sampleRate);
  // A part that was a graph part first already has these, and the render thread
  // may be reading them: keep them.
  if (!_strips[part]) _strips[part] = std::make_unique<modsynth::Strip>(_sampleRate);
  if (!_mixfx[part]) _mixfx[part] = std::make_unique<modsynth::MixFx>(_sampleRate);
}

// Release: everything the constructor (and the warm-up) wrote is visible before
// the render thread can see a non-null pointer.
- (void)publishPart:(int)part {
  _live[part].store(_parts[part].get(), std::memory_order_release);
}

- (BOOL)ensurePart:(int)part {
  if (part < 0 || part >= kMaxParts) return NO;
  if (_live[part].load(std::memory_order_acquire)) return YES;
  [self buildPart:part];
  [self publishPart:part];
  return YES;
}

// Builds the part, plays its containers up to size, and only then publishes it.
//
// This used to be ensurePart followed by a warm-up of the published processor.
// The audio engine is already running by then, so the render thread picked up
// the warm-up's sixteen notes along with everything else and played them: a
// burst of noise on the speaker at every launch (peak 0.5-0.65 for about 60 ms,
// measured by warmtest), on top of two threads driving one processor and one
// pair of scratch buffers. Warmed before it is published, nothing else can see
// the notes, and the buffers are its own.
- (BOOL)warmUpPart:(int)part {
  if (part < 0 || part >= kMaxParts) return NO;
  if (_live[part].load(std::memory_order_acquire)) return YES;   // the render thread owns it now
  [self buildPart:part];
  modsynth::Processor *p = _parts[part].get();
  std::vector<float> sl((size_t)_maxFrames, 0.0f), sr((size_t)_maxFrames, 0.0f);

  // Three containers inside the engine grow on demand, and the first growth
  // would be a malloc on the render thread. Each is pushed to its steady-state
  // size here and then emptied: std::vector keeps its capacity when it
  // shrinks, so the room stays.
  std::vector<modsynth::MatrixRow> full(kMaxMatrixRows);
  p->setMatrix(full);                       // grows Processor::matrix
  p->setMatrix(std::vector<modsynth::MatrixRow>());

  // heldNotes and the event queue: play a chord's worth of notes, schedule
  // their offs ahead so the queue fills, then render past them and panic.
  for (int i = 0; i < 16; i++) {
    p->noteOnMsg(48 + i, 0.8, modsynth::NoteId::num(90000 + i), false, 0);
    p->noteOffMsg(48 + i, modsynth::NoteId::num(90000 + i), true, 4096);
  }
  const int blk = _maxFrames < 512 ? _maxFrames : 512;
  for (int n = 0; n < 16; n++) { p->process(sl.data(), sr.data(), blk);
                                 _partFrames[part] += (uint64_t)blk; }
  p->panic();
  // panic() silences the voices; the capacity those vectors took stays.
  [self publishPart:part];
  return YES;
}

// ── The graph path, control side ─────────────────────────────────────────

// A part that has no Processor: its strip and mõdFX (what a Processor part gets
// in buildPart), no engine and no rack, and the capture ring every part has, so
// the mixer's meter and fader, mõdFX, Bounce and the stems work on it as they
// do on any other part. Allocates, so off the audio thread; published last.
- (BOOL)ensureGraphPart:(int)part {
  // 8, 9 and 10 are buses, not parts (the click and the legacy Rhythm are "part" 8
  // to the page): no strip to build, but the render thread has to have them.
  if (part >= kMaxParts && part < modsynth::GraphPool::kBuses) {
    [self warmGraphPool];
    _graphOn.store(true, std::memory_order_release);
    return YES;
  }
  if (part < 0 || part >= kMaxParts) return NO;
  if (_graphLive[part].load(std::memory_order_acquire)) return YES;
  if (!_strips[part]) _strips[part] = std::make_unique<modsynth::Strip>(_sampleRate);
  if (!_mixfx[part]) _mixfx[part] = std::make_unique<modsynth::MixFx>(_sampleRate);
  [self warmGraphPool];
  _graphOn.store(true, std::memory_order_release);
  _graphLive[part].store(true, std::memory_order_release);
  return YES;
}

// The pool's first voices would pay for first-touch memory and cold code on the
// render thread. A throwaway pool plays a short tone for a few blocks here, on
// the caller's thread, so the code paths and the allocator are warm; it is
// discarded, so it is never heard and nothing the render thread owns is touched.
- (void)warmGraphPool {
  static std::atomic<bool> done{false};
  if (done.exchange(true)) return;
  modsynth::GraphPool pool;
  // ext(bus 0) <- gain <- sine, in graph.h's program layout (as graphpooltest builds one).
  std::vector<double> p = {0x6d6f6467, _sampleRate, 3, 0};
  p.push_back(8); p.push_back(0);
  p.push_back(2); p.push_back(0); p.push_back(0); p.push_back(-1e9);
  p.push_back(440); p.push_back(0); p.push_back(0); p.push_back(0);
  p.push_back(1); p.push_back(0.1); p.push_back(0);
  p.push_back(2);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(0); p.push_back(-1);
  if (pool.begin(p.data(), p.size(), 0.0, 0) < 0) return;
  const int n = _maxFrames < 512 ? _maxFrames : 512;
  std::vector<float> l((size_t)modsynth::GraphPool::kBuses * (size_t)n), r(l.size());
  float *bl[modsynth::GraphPool::kBuses], *br[modsynth::GraphPool::kBuses];
  for (int b = 0; b < modsynth::GraphPool::kBuses; b++) { bl[b] = l.data() + (size_t)b * n; br[b] = r.data() + (size_t)b * n; }
  for (int k = 0; k < 8; k++) pool.render((uint64_t)k * (uint64_t)n, n, bl, br);
}

// A decoded clip, once; the graph that names it comes after.
- (BOOL)putGraphBuffer:(int)bufId sampleRate:(double)sr channels:(NSArray<NSData *> *)channels {
  if (![channels isKindOfClass:[NSArray class]] || channels.count < 1) return NO;
  const size_t len = channels[0].length / sizeof(float);
  if (len == 0) return NO;
  std::vector<float> c0(len), c1;
  std::memcpy(c0.data(), channels[0].bytes, len * sizeof(float));
  if (channels.count > 1 && channels[1].length / sizeof(float) >= len) {
    c1.resize(len);
    std::memcpy(c1.data(), channels[1].bytes, len * sizeof(float));
  }
  os_unfair_lock_lock(&_graphLock);
  _graphs.buffers().put(bufId, sr, c1.empty() ? 1 : 2, (int)len, c0.data(), c1.empty() ? nullptr : c1.data());
  os_unfair_lock_unlock(&_graphLock);
  return YES;
}

// Starts a voice. `ts` is the page's wall clock (ms) at the moment it opened the
// voice, and the program's times count from there. The engine frame for that
// moment is worked out the way applyMessage places a note: the wall clock minus
// the offset the last block saw (a few ms in the past by now; the pool catches
// a late voice up). Answers {handle} (>= 0), or handle -2 with the clip the pool
// lacks (the page sends it again), or -1 for a program refused or no free slot.
- (NSDictionary *)beginGraph:(int)gid program:(NSData *)program timestampMs:(double)ts {
  const size_t n = program.length / sizeof(double);
  if (n == 0) return @{@"handle": @(-1), @"unknownBuffer": @(-1)};
  std::vector<double> prog(n);
  std::memcpy(prog.data(), program.bytes, n * sizeof(double));
  uint64_t start = _frames.load(std::memory_order_relaxed);
  const double off = _curOffPub.load(std::memory_order_relaxed);
  if (ts > 0 && !std::isnan(off)) {
    const double f = (ts - off) * _sampleRate / 1000.0;
    // A stamp far from now is a bad clock, not a note: play it at once.
    if (f > (double)start - 5.0 * _sampleRate && f < (double)start + 5.0 * _sampleRate) start = f > 0 ? (uint64_t)f : 0;
  }
  os_unfair_lock_lock(&_graphLock);
  const int h = _graphs.begin(prog.data(), n, 0.0, start);
  const int unknown = h == -2 ? _graphs.unknownBuffer() : -1;
  if (h >= 0) {
    _gidHandle[gid] = h;
    // gids only ever grow; a voice's edits come within seconds of its start.
    while (_gidHandle.size() > 4096) _gidHandle.erase(_gidHandle.begin());
  }
  os_unfair_lock_unlock(&_graphLock);
  return @{@"handle": @(h), @"unknownBuffer": @(unknown)};
}

// Later changes to a voice that has begun (release, choke, glide, a stop). NO if
// the voice has already finished: the handle is dropped and the edit is moot.
- (BOOL)editGraph:(int)gid increments:(NSData *)increments {
  const size_t n = increments.length / sizeof(double);
  if (n == 0) return YES;
  std::vector<double> inc(n);
  std::memcpy(inc.data(), increments.bytes, n * sizeof(double));
  os_unfair_lock_lock(&_graphLock);
  bool ok = false;
  auto it = _gidHandle.find(gid);
  if (it != _gidHandle.end()) {
    ok = _graphs.edit(it->second, inc.data(), n);
    if (!ok) _gidHandle.erase(it);
  }
  os_unfair_lock_unlock(&_graphLock);
  return ok;
}

- (NSDictionary *)graphStats {
  return @{@"voices": @(_graphs.active()), @"dropped": @((double)_graphs.dropped()),
           @"lateEdits": @((double)_graphs.lateEdits())};
}

- (BOOL)post:(NSDictionary *)message {
  if (![message isKindOfClass:[NSDictionary class]]) return NO;
  NSString *t = message[@"t"];
  if (![t isKindOfClass:[NSString class]]) return NO;

  Msg m;
  std::memset(&m, 0, sizeof(m));
  const int part = (int)num(message[@"part"], 0);
  if (part < 0 || part >= kMaxParts) return NO;
  m.part = (uint8_t)part;

  id atVal = message[@"at"];
  m.hasAt = (atVal != nil && atVal != [NSNull null]);
  m.at = num(atVal, 0);
  id atRelVal = message[@"atRel"];
  m.hasAtRel = (atRelVal != nil && atRelVal != [NSNull null]);
  m.atRel = num(atRelVal, 0);
  m.ts = num(message[@"ts"], 0);
  m.idKind = idKindOf(message[@"id"]);
  m.id = num(message[@"id"], 0);
  m.note = num(message[@"note"], 0);
  m.vel = num(message[@"vel"], 0);
  m.v = num(message[@"v"], 0);
  m.i = (int32_t)num(message[@"i"], 0);

  if ([t isEqualToString:@"p"])            m.type = MsgType::Param;
  else if ([t isEqualToString:@"on"])      m.type = MsgType::NoteOn;
  else if ([t isEqualToString:@"off"])     m.type = MsgType::NoteOff;
  else if ([t isEqualToString:@"choke"])   m.type = MsgType::Choke;
  else if ([t isEqualToString:@"panic"])   m.type = MsgType::Panic;
  else if ([t isEqualToString:@"allOff"])  m.type = MsgType::AllOff;
  else if ([t isEqualToString:@"mw"])      m.type = MsgType::Mw;
  else if ([t isEqualToString:@"bend"])    m.type = MsgType::Bend;
  else if ([t isEqualToString:@"at"])      m.type = MsgType::Aftertouch;
  else if ([t isEqualToString:@"sustain"]) { m.type = MsgType::Sustain; m.flag = num(message[@"v"], 0) != 0; }
  else if ([t isEqualToString:@"macro"])   m.type = MsgType::Macro;
  else if ([t isEqualToString:@"cc"])      { m.type = MsgType::CC; m.i = (int32_t)num(message[@"n"], 0); }
  else if ([t isEqualToString:@"cap"])     { m.type = MsgType::Cap; m.uni = num(message[@"uni"], 0); m.poly = num(message[@"poly"], 0); }
  else if ([t isEqualToString:@"fx"])      m.type = MsgType::Fx;      // {i: HOST_FX index, v}
  else if ([t isEqualToString:@"strip"])   m.type = MsgType::Strip;   // {i: 0 level, 1 pan, v}
  else if ([t isEqualToString:@"mfx"])     m.type = MsgType::Mfx;     // {i: MixFxParam, v}
  else if ([t isEqualToString:@"master"])  m.type = MsgType::Master;  // {i: MasterParam, v}
  else if ([t isEqualToString:@"tempo"])   {
    m.type = MsgType::Tempo;
    m.v = num(message[@"bpm"], 120);
    id beat = message[@"beat"];
    m.hasBeat = (beat != nil && beat != [NSNull null]);
    m.beat = num(beat, 0);
  }
  else if ([t isEqualToString:@"pAll"]) {
    m.type = MsgType::ParamAll;
    NSArray *v = message[@"v"];
    if (![v isKindOfClass:[NSArray class]]) return NO;
    const int n = (int)MIN((NSUInteger)modsynth::PARAM_COUNT, v.count);
    for (int k = 0; k < n; k++) m.payload.params[k] = (float)num(v[k], 0);
    m.i = n;
  }
  else if ([t isEqualToString:@"matrix"]) {
    m.type = MsgType::Matrix;
    NSArray *rows = message[@"rows"];
    const int n = [rows isKindOfClass:[NSArray class]]
                ? (int)MIN((NSUInteger)kMaxMatrixRows, rows.count) : 0;
    for (int r = 0; r < n; r++) {
      NSDictionary *row = rows[r];
      if (![row isKindOfClass:[NSDictionary class]]) continue;
      m.payload.matrix[r][0] = num(row[@"s"], 0);
      m.payload.matrix[r][1] = num(row[@"d"], 0);
      m.payload.matrix[r][2] = num(row[@"a"], 0);
      m.payload.matrix[r][3] = num(row[@"u"], 0);
      m.payload.matrix[r][4] = num(row[@"v"], 0);
    }
    m.i = n;
  }
  else if ([t isEqualToString:@"motion"]) {
    m.type = MsgType::Motion;
    NSArray *steps = message[@"steps"];
    if (![steps isKindOfClass:[NSArray class]]) return NO;
    const int n = (int)MIN((NSUInteger)modsynth::MOTION_MAX, steps.count);
    for (int k = 0; k < n; k++) m.payload.motion[k] = (float)num(steps[k], 0);
    m.i = (int32_t)num(message[@"lane"], 0);
    m.vel = n;                                  // step count, reusing a field
  }
  else return NO;                               // an unknown `t` is dropped, as dsp.js drops it

  os_unfair_lock_lock(&_pushLock);
  const bool ok = _queue.push(m);
  os_unfair_lock_unlock(&_pushLock);
  if (!ok) _dropped.fetch_add(1, std::memory_order_relaxed);
  return ok;
}

// ── Audio thread from here down ──────────────────────────────────────────
// Nothing below allocates, frees, locks, or touches Objective-C refcounting.

- (void)applyMessage:(const Msg &)m to:(modsynth::Processor *)p {
  // "In N frames from now" becomes an absolute frame here, against the only
  // clock that matters — the one Processor schedules against. Sending an
  // absolute frame from the page cannot work: the web AudioContext and this
  // engine start at different moments, and a note was landing as late as the
  // web context was old (measured: eight seconds).
  Msg mm = m;
  if (mm.hasAtRel) {
    // The page measured atRel when it made the message, but the message then
    // crossed the bridge, and in the background that crossing is slow and
    // uneven (the page's process is throttled, the hop waits for it). Counting
    // atRel from the drain moved every note later by however long the hop
    // took — chords on the native engine went loose while the arp, on the web
    // engine, did not. The page stamps the wall clock on the message; the
    // delay is the difference, and comes off the offset. A stamp that is
    // missing, in the future, or implausibly old is ignored.
    double rel = mm.atRel;
    if (mm.ts > 0) {
      struct timespec tsNow;
      clock_gettime(CLOCK_REALTIME, &tsNow);
      const double nowMs = (double)tsNow.tv_sec * 1000.0 + (double)tsNow.tv_nsec / 1e6;
      const double delayMs = nowMs - mm.ts;
      if (delayMs > 0 && delayMs < 5000) {
        rel = std::max(0.0, rel - delayMs * 0.001 * _sampleRate);
        if (m.type == MsgType::NoteOn) {
          _dStamped++; _dDelaySum += delayMs; _dRelSum += mm.atRel * 1000.0 / _sampleRate;
          _drainSum += _curOff - _clk.estimate();
          _drainN++;
          _drainMean.store(_drainSum / (double)_drainN, std::memory_order_relaxed);
        }
      }
    }
    if (m.type == MsgType::NoteOn && !(mm.ts > 0)) _dBadStamp++;
    mm.at = (double)_partFrames[mm.part] + rel;
    mm.hasAt = true;
  } else if (m.type == MsgType::NoteOn) {
    _dPlain++;
  }
  const Msg &r = mm;
  switch (r.type) {
    case MsgType::Param:       p->setParam(r.i, r.v); break;
    case MsgType::ParamAll:    p->setAllParams(r.payload.params, r.i); break;
    case MsgType::NoteOn:      _notesOn.fetch_add(1, std::memory_order_relaxed);
                               p->noteOnMsg(r.note, r.vel, noteIdFrom(r.idKind, r.id), r.hasAt, r.at); break;
    case MsgType::NoteOff:     p->noteOffMsg(r.note, noteIdFrom(r.idKind, r.id), r.hasAt, r.at); break;
    case MsgType::Choke:       p->chokeMsg(r.note, noteIdFrom(r.idKind, r.id), r.hasAt, r.at); break;
    case MsgType::Panic:       p->panic(); break;
    case MsgType::AllOff:      p->allNotesOff(); break;
    case MsgType::Mw:          p->setMw(r.v); break;
    case MsgType::Bend:        p->setBend(r.v); break;
    case MsgType::Aftertouch:  p->setAt(r.v); break;
    case MsgType::CC:          p->setCC(r.i, r.v); break;
    case MsgType::Sustain:     p->setSustain(r.flag); break;
    case MsgType::Macro:       p->setMacro(r.i, r.v); break;
    case MsgType::Cap:         p->setCap(r.uni, r.poly); break;
    case MsgType::Tempo:       p->setTempo(r.v, r.hasBeat, r.beat);
                               if (_racks[r.part]) _racks[r.part]->setTempo(r.v);
                               break;
    case MsgType::Fx:          if (_racks[r.part]) _racks[r.part]->set(r.i, r.v); break;
    case MsgType::Strip:       if (_strips[r.part]) {
                                 if (r.i == 0) _strips[r.part]->setLevel(r.v);
                                 else if (r.i == 1) _strips[r.part]->setPan(r.v);
                               }
                               break;
    case MsgType::Mfx:         if (_mixfx[r.part]) _mixfx[r.part]->set(r.i, r.v); break;
    case MsgType::Master:      break;   // applied where the queue is drained: it needs no part
    case MsgType::Motion:      p->setMotion(r.i, r.payload.motion, (int)r.vel); break;
    case MsgType::Matrix: {
      // resize() inside the reserved capacity does not allocate, and
      // setMatrix's copy-assign reuses the engine's buffer because warmUp
      // already grew it to kMaxMatrixRows.
      std::vector<modsynth::MatrixRow> &rows = _matrixScratch[r.part];
      rows.resize((size_t)r.i);
      for (int k = 0; k < r.i; k++) {
        rows[k].s = r.payload.matrix[k][0];
        rows[k].d = r.payload.matrix[k][1];
        rows[k].a = r.payload.matrix[k][2];
        rows[k].u = r.payload.matrix[k][3];
        rows[k].v = r.payload.matrix[k][4];
      }
      p->setMatrix(rows);
      break;
    }
  }
}

- (void)renderInto:(float *)left right:(float *)right frames:(int)frames {
  if (frames <= 0) return;
  if (frames > _maxFrames) frames = _maxFrames;   // never write past the scratch

  // Where this block sits on the wall clock, for the recorder to line the host
  // up with the page's AudioContext. A clock read and a compare a block.
  const uint64_t blockFrame = _frames.load(std::memory_order_relaxed);
  {
    struct timespec tsNow;
    clock_gettime(CLOCK_REALTIME, &tsNow);
    const double off = (double)tsNow.tv_sec * 1000.0 + (double)tsNow.tv_nsec / 1e6
                     - (double)blockFrame * 1000.0 / _sampleRate;
    if (_clkReset.exchange(false, std::memory_order_relaxed)) {
      _clk.reset(); _clkOrigin.store(1e300, std::memory_order_relaxed);
      _drainSum = 0; _drainN = 0; _drainMean.store(0, std::memory_order_relaxed);
      _dDelaySum = _dRelSum = 0; _dStamped = _dBadStamp = _dPlain = 0; _cbMin = 0xffffffffu; _cbMax = 0;
    }
    if ((uint32_t)frames < _cbMin) _cbMin = (uint32_t)frames;
    if ((uint32_t)frames > _cbMax) _cbMax = (uint32_t)frames;
    _clkOrigin.store(_clk.update(off), std::memory_order_relaxed);
    _curOff = off;
    _curOffPub.store(off, std::memory_order_relaxed);
  }

  Msg m;
  while (_queue.pop(m)) {
    if (m.type == MsgType::Master) { _master->set(m.i, m.v); continue; }   // the bus belongs to no part
    modsynth::Processor *p = _live[m.part].load(std::memory_order_acquire);
    if (p) [self applyMessage:m to:p];            // a message for a part that
                                                  // does not exist is dropped
    else if (_graphLive[m.part].load(std::memory_order_acquire)) {
      // A graph part has no Processor but it has a strip and mõdFX, and the
      // page sets those the same way (fader, mute, solo, pan, the effects).
      if (m.type == MsgType::Strip && _strips[m.part]) {
        if (m.i == 0) _strips[m.part]->setLevel(m.v); else if (m.i == 1) _strips[m.part]->setPan(m.v);
      } else if (m.type == MsgType::Mfx && _mixfx[m.part]) _mixfx[m.part]->set(m.i, m.v);
    }
  }

  std::memset(left, 0, sizeof(float) * (size_t)frames);
  std::memset(right, 0, sizeof(float) * (size_t)frames);
  std::memset(_roomL.data(), 0, sizeof(float) * (size_t)frames);
  std::memset(_roomR.data(), 0, sizeof(float) * (size_t)frames);

  // The graph voices, into one pair of buses a part (0..7) and the three that
  // belong to no part (8 the master, 9 the chord's room, 10 the shared room).
  // Zeroed only once there is a graph part: until then this costs nothing.
  const bool graphOn = _graphOn.load(std::memory_order_acquire);
  constexpr int kBuses = modsynth::GraphPool::kBuses;
  float *gl[kBuses], *gr[kBuses];
  bool touched[kBuses];
  for (int b = 0; b < kBuses; b++) {
    gl[b] = _gbus.data() + (size_t)(2 * b) * (size_t)_maxFrames;
    gr[b] = gl[b] + _maxFrames;
    touched[b] = false;
  }
  if (graphOn) {
    std::memset(_gbus.data(), 0, sizeof(float) * (size_t)(2 * kBuses) * (size_t)_maxFrames);
    _graphs.render(blockFrame, frames, gl, gr, touched);
  }
  const int64_t kPartTail = (int64_t)(8.0 * _sampleRate);    // mõdFX tails: a reverb or delay outlives its last voice

  for (int part = 0; part < kMaxParts; part++) {
    modsynth::Processor *p = _live[part].load(std::memory_order_acquire);
    const bool gpart = graphOn && _graphLive[part].load(std::memory_order_acquire);
    if (gpart) { if (touched[part]) _graphTail[part] = kPartTail; else if (_graphTail[part] > 0) _graphTail[part] -= frames; }
    if (!p && !(gpart && _graphTail[part] > 0)) continue;
    if (p) p->process(_scratchL.data(), _scratchR.data(), frames);
    else { std::memset(_scratchL.data(), 0, sizeof(float) * (size_t)frames); std::memset(_scratchR.data(), 0, sizeof(float) * (size_t)frames); }
    // The rack: what fx.js is on the web, after the voices. The matrix's FX
    // destinations (a Space or Drive macro) are read here, from the engine
    // that computed them, so they apply per block and not at meter rate.
    if (modsynth::FxRack *rack = p ? _racks[part].get() : nullptr) {
      double mods[5];
      p->fxMods(mods);
      rack->setMods(mods);
      rack->process(_scratchL.data(), _scratchR.data(), frames);
    }
    // A part played as graphs adds its bus here, after the rack (a graph voice is a
    // web voice, which never had one) and before the strip, as a Processor's
    // output meets it. A part with both (a Processor patch and web-style voices)
    // gets both.
    if (gpart) for (int i = 0; i < frames; i++) { _scratchL[i] += gl[part][i]; _scratchR[i] += gr[part][i]; }
    // The strip: what the web's trim gain is to a part, then mõdFX, then the
    // meter, which on the web reads the chain's output, then the pan.
    modsynth::Strip *strip = _strips[part].get();
    if (strip) strip->gain(_scratchL.data(), _scratchR.data(), frames);
    if (modsynth::MixFx *fx = _mixfx[part].get())
      fx->process(_scratchL.data(), _scratchR.data(), frames);
    if (strip) strip->measure(_scratchL.data(), _scratchR.data(), frames);
    // The mixer's pan, after the meter: the web taps the meter upstream of it.
    if (strip) strip->applyPan(_scratchL.data(), _scratchR.data(), frames);
    _partFrames[part] += (uint64_t)frames;
    // The part's own bus, for a stem: what the web's _partBuses entry carries.
    if (modsynth::CaptureRing *c = _cap[1 + part].load(std::memory_order_acquire))
      c->write(_scratchL.data(), _scratchR.data(), frames, blockFrame);
    // The two ways into the master (master.h): the chord part direct, the rest
    // through the bus room.
    float *toL = part == kDirectPart ? left  : _roomL.data();
    float *toR = part == kDirectPart ? right : _roomR.data();
    for (int i = 0; i < frames; i++) {
      toL[i] += _scratchL[i];
      toR[i] += _scratchR[i];
    }
  }

  if (graphOn) {
    // Bus 8: straight into the master with no strip (the click, the legacy
    // Rhythm), the way the chord's direct path enters.
    for (int i = 0; i < frames; i++) { left[i] += gl[8][i]; right[i] += gr[8][i]; }
    // Buses 9 and 10 are sends, so what comes back is the reverb's tail alone.
    // 9 is the chord's own room, which on the web meets the master at the glue
    // compressor with no drive of its own in front: the direct path. 10 is the
    // shared room, which the web's convolver feeds into the master's input
    // (the drive, the dry path and the bus room): the room sum.
    // A reverb runs while its send has signal and for its tail afterwards.
    const int64_t kRoomTail = (int64_t)(4.0 * _sampleRate);
    float *rl[2] = {gl[9], gl[10]}, *rr[2] = {gr[9], gr[10]};
    for (int k = 0; k < 2; k++) {
      if (touched[9 + k]) _roomTail[k] = kRoomTail; else if (_roomTail[k] > 0) _roomTail[k] -= frames;
      if (_roomTail[k] <= 0) continue;
      _roomRack[k]->processSend(rl[k], rr[k], frames);
      float *toL = k == 0 ? left : _roomL.data(), *toR = k == 0 ? right : _roomR.data();
      for (int i = 0; i < frames; i++) { toL[i] += rl[k][i]; toR[i] += rr[k][i]; }
    }
  }

  // The master: drive, bus room, glue compressor, limiter, volume. What the
  // web's buildMasterBus does for the parts the web plays, for these.
  _master->process(left, right, _roomL.data(), _roomR.data(), frames);

  // What leaves for the speaker: the web's _masterOut, for the part of the mix
  // that is not Web Audio.
  if (modsynth::CaptureRing *c = _cap[0].load(std::memory_order_acquire))
    c->write(left, right, frames, blockFrame);

  // Loudest sample this block, held until read. Silence and work are
  // indistinguishable in a load figure; they are not in this.
  float pk = 0.0f;
  for (int i = 0; i < frames; i++) {
    const float a = left[i] < 0 ? -left[i] : left[i];
    if (a > pk) pk = a;
  }
  float was = _peak.load(std::memory_order_relaxed);
  while (pk > was && !_peak.compare_exchange_weak(was, pk, std::memory_order_relaxed)) {}

  _frames.fetch_add((uint64_t)frames, std::memory_order_relaxed);
}

// Off the audio graph: no AVAudioEngine, no render callback, no session.
// Just the DSP, asked whether it produces anything.
- (float)renderOfflinePeakForPart:(int)part frames:(int)frames {
  modsynth::Processor *p = (part >= 0 && part < kMaxParts)
                         ? _live[part].load(std::memory_order_acquire) : nullptr;
  if (!p) return -1.0f;                        // no processor: a different answer from silence
  if (frames > _maxFrames) frames = _maxFrames;
  // Messages are only applied by whoever drains the queue, and here that is
  // nobody — there is no render callback running. Drain it first, or this
  // renders a processor that has never been told to play anything and
  // reports silence, which is the wrong answer for the right reason.
  Msg m;
  while (_queue.pop(m)) {
    if (m.type == MsgType::Master) { _master->set(m.i, m.v); continue; }
    modsynth::Processor *q = _live[m.part].load(std::memory_order_acquire);
    if (q) [self applyMessage:m to:q];
  }
  float pk = 0.0f;
  p->process(_scratchL.data(), _scratchR.data(), frames);
  _partFrames[part] += (uint64_t)frames;
  for (int i = 0; i < frames; i++) {
    const float a = _scratchL[i] < 0 ? -_scratchL[i] : _scratchL[i];
    if (a > pk) pk = a;
  }
  return pk;
}

- (void)startCapture:(uint32_t)mask {
  os_unfair_lock_lock(&_capLock);
  bool running = false;
  for (int i = 0; i < kCapStreams; i++) if (_capRings[i] && _capRings[i]->active()) running = true;
  if (!running) _clkReset.store(true, std::memory_order_relaxed);   // a new take: measure the clock afresh
  for (int i = 0; i < kCapStreams; i++) {
    if (!(mask & (1u << i))) continue;
    if (!_capRings[i]) {
      _capRings[i] = std::make_unique<modsynth::CaptureRing>(kCapFrames);
      _cap[i].store(_capRings[i].get(), std::memory_order_release);
    }
    // Asking for a stream that is already running is a no-op: the page adds a
    // part's stem mid-take, and re-arming the master with it would throw away
    // everything the take has so far.
    if (!_capRings[i]->active()) _capRings[i]->arm();
  }
  os_unfair_lock_unlock(&_capLock);
}

- (void)stopCapture {
  os_unfair_lock_lock(&_capLock);
  for (int i = 0; i < kCapStreams; i++) if (_capRings[i]) _capRings[i]->stop();
  os_unfair_lock_unlock(&_capLock);
}

- (NSDictionary *)readCapture {
  NSMutableArray *streams = [NSMutableArray array];
  std::vector<float> l((size_t)kCapReadFrames), r((size_t)kCapReadFrames);
  os_unfair_lock_lock(&_capLock);
  for (int i = 0; i < kCapStreams; i++) {
    if (!_capRings[i]) continue;
    uint64_t f0 = 0, lost = 0;
    const size_t got = _capRings[i]->read(l.data(), r.data(), l.size(), f0, lost);
    if (!got && !lost) continue;
    NSMutableData *d = [NSMutableData dataWithLength:got * 2 * sizeof(float)];
    std::memcpy(d.mutableBytes, l.data(), got * sizeof(float));
    std::memcpy((char *)d.mutableBytes + got * sizeof(float), r.data(), got * sizeof(float));
    [streams addObject:@{@"id": @(i), @"frame0": @((double)f0), @"frames": @((int)got),
                         @"lost": @((double)lost), @"data": d}];
  }
  os_unfair_lock_unlock(&_capLock);
  const double origin = _clkOrigin.load(std::memory_order_relaxed);
  return @{@"streams": streams, @"originMs": @(origin < 1e299 ? origin : 0.0),
           @"drainMs": @(_drainMean.load(std::memory_order_relaxed)), @"sampleRate": @(_sampleRate),
           @"diag": @{@"notesStamped": @(_dStamped), @"notesBadStamp": @(_dBadStamp), @"notesUnscheduled": @(_dPlain),
                      @"meanWaitMs": @(_dStamped ? _dDelaySum / _dStamped : 0.0),
                      @"meanAheadMs": @(_dStamped ? _dRelSum / _dStamped : 0.0),
                      @"callbackMin": @(_cbMin == 0xffffffffu ? 0u : _cbMin), @"callbackMax": @(_cbMax)}};
}

- (float)meterForPart:(int)part {
  if (part < 0 || part >= kMaxParts || !_strips[part]) return 0.0f;
  return _strips[part]->takeRms();
}

- (uint64_t)framesRendered { return _frames.load(std::memory_order_relaxed); }
- (uint32_t)dropped        { return _dropped.load(std::memory_order_relaxed); }
- (uint32_t)notesOn        { return _notesOn.load(std::memory_order_relaxed); }
- (float)peakOut           { return _peak.exchange(0.0f, std::memory_order_relaxed); }

- (int)activeVoices {
  int n = 0;
  for (int part = 0; part < kMaxParts; part++) {
    modsynth::Processor *p = _live[part].load(std::memory_order_acquire);
    if (p) n += p->activeVoices();
  }
  return n;
}

@end
