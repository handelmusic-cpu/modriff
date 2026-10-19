#import "ModEngineHost.h"

#import <os/lock.h>
#include <atomic>
#include <cstring>
#include <memory>
#include <vector>

#include "modsynth.h"

namespace {

constexpr int kMaxParts = 8;
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
  Mw, Bend, Aftertouch, CC, Sustain, Macro, Cap, Matrix, Motion, Tempo
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
  }
  return self;
}

- (BOOL)ensurePart:(int)part {
  if (part < 0 || part >= kMaxParts) return NO;
  if (_live[part].load(std::memory_order_acquire)) return YES;
  _parts[part] = std::make_unique<modsynth::Processor>(_sampleRate);
  // Release: everything the constructor wrote is visible before the render
  // thread can see a non-null pointer.
  _live[part].store(_parts[part].get(), std::memory_order_release);
  return YES;
}

- (void)warmUpPart:(int)part {
  if (![self ensurePart:part]) return;
  modsynth::Processor *p = _parts[part].get();

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
  for (int n = 0; n < 16; n++) { p->process(_scratchL.data(), _scratchR.data(), blk);
                                 _partFrames[part] += (uint64_t)blk; }
  p->panic();
  // panic() silences the voices; the capacity those vectors took stays.
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
    mm.at = (double)_partFrames[mm.part] + mm.atRel;
    mm.hasAt = true;
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
    case MsgType::Tempo:       p->setTempo(r.v, r.hasBeat, r.beat); break;
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

  Msg m;
  while (_queue.pop(m)) {
    modsynth::Processor *p = _live[m.part].load(std::memory_order_acquire);
    if (p) [self applyMessage:m to:p];            // a message for a part that
                                                  // does not exist is dropped
  }

  std::memset(left, 0, sizeof(float) * (size_t)frames);
  std::memset(right, 0, sizeof(float) * (size_t)frames);

  for (int part = 0; part < kMaxParts; part++) {
    modsynth::Processor *p = _live[part].load(std::memory_order_acquire);
    if (!p) continue;
    p->process(_scratchL.data(), _scratchR.data(), frames);
    _partFrames[part] += (uint64_t)frames;
    for (int i = 0; i < frames; i++) {
      left[i]  += _scratchL[i];
      right[i] += _scratchR[i];
    }
  }

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
