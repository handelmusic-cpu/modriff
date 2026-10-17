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
// 256 messages of headroom between the caller's thread and the audio thread.
// At a 128-frame block that is far more than a buffer's worth of traffic even
// when a whole chord, its matrix and a patch change arrive together.
constexpr int kQueueSlots = 256;

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
  for (int n = 0; n < 16; n++) p->process(_scratchL.data(), _scratchR.data(), blk);
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
  switch (m.type) {
    case MsgType::Param:       p->setParam(m.i, m.v); break;
    case MsgType::ParamAll:    p->setAllParams(m.payload.params, m.i); break;
    case MsgType::NoteOn:      _notesOn.fetch_add(1, std::memory_order_relaxed);
                               p->noteOnMsg(m.note, m.vel, noteIdFrom(m.idKind, m.id), m.hasAt, m.at); break;
    case MsgType::NoteOff:     p->noteOffMsg(m.note, noteIdFrom(m.idKind, m.id), m.hasAt, m.at); break;
    case MsgType::Choke:       p->chokeMsg(m.note, noteIdFrom(m.idKind, m.id), m.hasAt, m.at); break;
    case MsgType::Panic:       p->panic(); break;
    case MsgType::AllOff:      p->allNotesOff(); break;
    case MsgType::Mw:          p->setMw(m.v); break;
    case MsgType::Bend:        p->setBend(m.v); break;
    case MsgType::Aftertouch:  p->setAt(m.v); break;
    case MsgType::CC:          p->setCC(m.i, m.v); break;
    case MsgType::Sustain:     p->setSustain(m.flag); break;
    case MsgType::Macro:       p->setMacro(m.i, m.v); break;
    case MsgType::Cap:         p->setCap(m.uni, m.poly); break;
    case MsgType::Tempo:       p->setTempo(m.v, m.hasBeat, m.beat); break;
    case MsgType::Motion:      p->setMotion(m.i, m.payload.motion, (int)m.vel); break;
    case MsgType::Matrix: {
      // resize() inside the reserved capacity does not allocate, and
      // setMatrix's copy-assign reuses the engine's buffer because warmUp
      // already grew it to kMaxMatrixRows.
      std::vector<modsynth::MatrixRow> &rows = _matrixScratch[m.part];
      rows.resize((size_t)m.i);
      for (int r = 0; r < m.i; r++) {
        rows[r].s = m.payload.matrix[r][0];
        rows[r].d = m.payload.matrix[r][1];
        rows[r].a = m.payload.matrix[r][2];
        rows[r].u = m.payload.matrix[r][3];
        rows[r].v = m.payload.matrix[r][4];
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
    for (int i = 0; i < frames; i++) {
      left[i]  += _scratchL[i];
      right[i] += _scratchR[i];
    }
  }

  // The loudest sample this block, held until something reads it. A load
  // figure cannot tell silence from work; this can.
  float pk = 0.0f;
  for (int i = 0; i < frames; i++) {
    const float a = left[i] < 0 ? -left[i] : left[i];
    if (a > pk) pk = a;
  }
  float was = _peak.load(std::memory_order_relaxed);
  while (pk > was && !_peak.compare_exchange_weak(was, pk, std::memory_order_relaxed)) {}

  _frames.fetch_add((uint64_t)frames, std::memory_order_relaxed);
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
