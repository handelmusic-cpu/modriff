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
#include "seqcore.h"
#include "seqplay.h"
#include "bassplay.h"
#include "arpplay.h"
#include "melplay.h"
#include "chordcore.h"
#include "songcore.h"
#include "songvoice.h"
#include "songend.h"
#include "voicebank.h"
#include <functional>
#include <thread>
#include <unistd.h>

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


// ── The native sequencer (seqcore.h, docs/native-scheduling.md slice 1) ──────
// A thread of its own, not the render callback: the voices it will start are begun with GraphPool::begin,
// which parses a program into a Graph and allocates, so it must run on a control-side thread. It reads the
// render thread's frame counter, expands the score up to a horizon a little ahead of it, and so keeps stepping
// whatever the web view is doing (the page's timers are what iOS throttles). Each event is handed to the DrumPlayer
// (seqplay.h), which begins the bank's voice for it in the pool; the events are also optionally kept, for a test.
struct HostSeq : modsynth::DrumPlayer {   // bank, choke groups, begin/edit and the hit counters live in seqplay.h
  static constexpr int kEventDoubles = 13;      // frameExact frame part kit lane vel accent pitch dyn chokeGroup chokes step bar
  static constexpr int kRing = 256;
  struct Fired { double frame; int step, bar; };
  os_unfair_lock lock = OS_UNFAIR_LOCK_INIT;
  modsynth::DrumSequencer seq;
  const std::atomic<uint64_t> *frames;
  double lookahead;                              // frames the thread expands ahead of the render counter
  std::thread th;
  std::atomic<bool> quit{false}, threadOn{false};
  bool hasScore = false;
  // counters and the playhead ring: under `lock`
  uint64_t steps = 0, events = 0, late = 0, firstFrame = 0, recDropped = 0;
  Fired ring[kRing];
  uint32_t ringN = 0;
  bool record = false;
  std::vector<double> rec;
  size_t recCap = 0;
  // The bass line (basscore.h, bassplay.h): its own clock and score and the chord timeline it follows, on the same thread and the
  // same bank (part 2). The chords come from the page as frames from the line's start; `bassOrigin` is where the engine's clock
  // has that start.
  modsynth::BassSequencer bseq;
  modsynth::BassPlayer bplay;
  bool hasBass = false;
  std::vector<double> bassChords;
  std::vector<double> bassPendingRaw;     // a line written ahead, as the page sent it (frames from the line's start); placed on the clock when it arrives and at the start
  double bassOrigin = 0;
  uint64_t bassSteps = 0, bassNotes = 0, bassFirst = 0;
  int bassLastMidi = -1;
  // The song loop (songcore.h): which chord of which section sounds and when it changes; it hands the bass its chord windows, in place of the page's
  // _blOnChord. It counts the bar lines the drums announce.
  modsynth::SongSequencer sseq;
  modsynth::SongVoicer svoice;            // the chord of each slot (songvoice.h): voiced and struck by cplay below, when the score says how the chords sound
  // The endings (songcore.h EndingEvent): what is waiting for a render-clock moment (the tempo put back, the master brought back up, the stop of a landing chord), the fade in
  // progress, and what the mirror reports.
  struct EndTimed { double frame; int what; double v; };      // what: 0 tempo (v = bpm), 1 master gain (v), 2 stop the chord
  std::vector<EndTimed> endTimers;
  std::function<bool(uint32_t, uint64_t, int)> kill;          // GraphPool::killParts under the pool's lock
  std::atomic<float> *endGain = nullptr;                      // the master's multiplier an ending's fade rides
  bool fading = false; double fadeT0 = 0, fadeDur = 0; int fadeSteps = 0, fadeDone = 0;
  double endRestoreBpm = 0;                                   // a ritardando's starting tempo, put back when the landing is over
  int endPhase = 0; double endAt = 0; uint64_t endLands = 0;   // 0 none, 1 a fade or ritardando is running, 2 landed
  bool hasSong = false;
  uint64_t songChords = 0, songFirst = 0, songVoiced = 0, songRests = 0, songHits = 0;
  // The chord the song last started and the one it will go to (the page writes the bass's line for that one while this sounds): the count of chords started,
  // where it is in the song, its window in frames, where next, and the live key change. Read by the mirror.
  double ask[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
  // The chord comp (chordcore.h, chordplay.h): the rhythm's clock and the chord it strikes, on the same thread, bank and pool.
  modsynth::ChordSequencer cseq;
  modsynth::ChordPlayer cplay;
  bool hasChord = false;
  uint64_t chordSteps = 0, chordHits = 0, chordFirst = 0;
  // The arpeggiator (arpcore.h, arpplay.h): its own clock, score and chord, on the same thread and bank (part 5). In a song it follows the chords the song steps (the
  // engine makes its tones from each, as setArpChord does) and, when armed, starts with the song on the drums' bar line.
  modsynth::ArpSequencer aseq;
  modsynth::ArpPlayer aplay;
  bool hasArp = false, arpArmed = false, arpBySong = false;
  int arpKit = 0;
  uint64_t arpSteps = 0, arpNotesN = 0, arpFirst = 0, arpChords = 0;
  // The melody generator (melcore.h, melplay.h): its line and its copy of the chord timeline (with its own locks), on the same thread and bank (part 6). In a song it is handed the
  // song's chord windows as the bass is and, when armed, starts with the song on the drums' bar line.
  modsynth::MelSequencer mseq;
  modsynth::MelPlayer mplay;
  bool hasMel = false, melArmed = false, melBySong = false;
  int melKit = 0;
  double melRate = 1, melOrigin = 0;
  std::vector<double> melChords;           // the page's windows for a start by hand (frames from the line's start); placed on the clock at the start and when they arrive
  uint64_t melSteps = 0, melNotesN = 0, melFirst = 0;
  int melLastMidi = -1;                    // the last note struck, for the mirror

  struct LiveChord {
    double frame;
    modsynth::ChordTimeline bass, mel;
    std::vector<int> tones;
  };
  std::vector<LiveChord> liveChords;
  uint64_t liveChanges = 0;
  double liveFrame = -1;

  // One tempo for the drums, the bass and the chord rhythm (tempomap.h): a tempo the page sets is a jump at the render clock, and the engine can move
  // it by itself (a ramp). Under `lock`.
  modsynth::TempoMap tmap;
  void setTempoNow(double bpm) { tmap.jump((double)frames->load(std::memory_order_relaxed), bpm); }
  HostSeq(const std::atomic<uint64_t> *f, double rate) : seq(rate), frames(f), lookahead(0.15 * rate), bseq(rate), cseq(rate), aseq(rate), mseq(rate), sseq(rate), svoice(rate), tmap(rate) {
    sr = rate; bplay.sr = rate; bplay.bank = &bank; cplay.sr = rate; cplay.bank = &bank; aplay.sr = rate; aplay.bank = &bank; mplay.sr = rate; mplay.bank = &bank;
    seq.setTempoMap(&tmap); bseq.setTempoMap(&tmap); cseq.setTempoMap(&tmap); sseq.setTempoMap(&tmap); aseq.setTempoMap(&tmap); mseq.setTempoMap(&tmap);
  }
  // The page's chord windows, shifted onto the clock. Under `lock`.
  void placeChords() {
    if (bassChords.empty()) { bseq.timeline().clear(); return; }
    bseq.timeline().setSampleRate(sr);
    bseq.timeline().fromDoubles(bassChords.data(), bassChords.size(), nullptr, bassOrigin);
  }
  // The page's chord windows for a melody started by hand, shifted onto the clock. Under `lock`.
  void placeMelChords() {
    if (melChords.empty()) { mseq.timeline().clear(); return; }
    mseq.timeline().setSampleRate(sr);
    mseq.timeline().fromDoubles(melChords.data(), melChords.size(), nullptr, melOrigin);
  }
  void placePending() {
    if (bassPendingRaw.empty()) return;
    modsynth::BassPending p;
    if (p.fromDoubles(bassPendingRaw.data(), bassPendingRaw.size(), bassOrigin)) bseq.setPending(p);
  }
  ~HostSeq() { quit.store(true); if (th.joinable()) th.join(); }

  // hardKillAll names the arp, the bass, the melody generator, the drums and the Aux layer. The pool's mask is over the HOST's part slots (the page's MODGRAPH.CODE: bass 3,
  // arp 4, drum 5, aux 6), which are not the bank's part codes (drum 0, aux 1, bass 2): the mask used to be 0x7, which named the chord, the melody and the generator -- no
  // voice of the band at all. The engine plays the melody generator (slot 2), the bass, the arp, the drums and the Aux layer.
  static constexpr uint32_t kKillParts = (1u << 2) | (1u << 3) | (1u << 4) | (1u << 5) | (1u << 6);

  // stopEverything at `frame` (the end of a fade): what the band had committed is faded out there, the sequencers and the song stop, the chord is stopped.
  void landStop(double frame) {
    liveChords.clear();
    if (kill) kill(kKillParts, (uint64_t)frame, 1056);
    seq.stop(); bseq.stop(); cseq.stop(); aseq.stop(); arpBySong = false; mseq.stop(); melBySong = false; sseq.stop(); svoice.reset();
    cplay.stopAt(frame);
  }
  // An ending's landing (_endingLand): everything the band had committed rings into the downbeat and is faded out there; on it, the whole band at once -- the kit's kick, its
  // biggest cymbal and (for most endings) its snare, the key's tonic chord with its root an octave under, and the bass's last note on the tonic -- then, after the hold, the
  // chord is let go of (or choked), and a moment later everything is stopped and the tempo the ending borrowed is put back.
  void landing(const modsynth::EndingEvent &ev, double now) {
    const double L = ev.frame;
    const modsynth::SongScore &sc = sseq.score();
    const bool band = seq.running(), bassOn = bseq.running();
    endPhase = 2; endAt = L; endLands++;
    // stopSongLoopIfActive: the trainer's run is over (its tempo and key go back); the band is faded out at the downbeat
    { const double back = sseq.restore(tmap.bpmAt(now)); if (back > 0) setTempoNow(back); }
    if (kill) kill(kKillParts, (uint64_t)L, 1056);
    seq.stop(); bseq.stop(); cseq.stop(); aseq.stop(); arpBySong = false; mseq.stop(); melBySong = false; sseq.stop(); svoice.reset();
    const modsynth::LandingPlan plan = modsynth::planLanding(sc, ev, svoice, tmap, &seq.score(), band, bassOn, sr);
    for (const modsynth::DrumEvent &e : plan.hits) play(e, now);
    if (plan.chord.play) { cplay.play(plan.chord.e, now); songVoiced++; } else if (plan.chord.stop) cplay.stopAt(L);
    if (plan.bass) bplay.play(plan.bassNote, now);
    // After the hold the chord is let go of (a sustained one: its own release was queued with it) or choked; the ending is finished once it has died away
    endTimers.push_back({plan.finishAt, 2, 0});
    if (endRestoreBpm > 0) { endTimers.push_back({plan.finishAt, 0, endRestoreBpm}); endRestoreBpm = 0; }
  }
  // Flush to the chord boundary before replacing any timeline: a message may
  // arrive before its timestamp, and the arp otherwise takes the new chord early.
  // Notes already committed by a previous tick remain untouched, as on the page.
  void followUntil(double now, double horizon) {
    // The walking line snaps to the drums' next bar after that grid ran.
    if (bseq.running() && hasBass)
      bassSteps += (uint64_t)bseq.run(now, horizon, seq.nextBarFrame(), [&](const modsynth::BassEvent &e) { bassNotes++; bassLastMidi = e.midi; bplay.play(e, now); });
    if (aseq.running() && hasArp)
      arpSteps += (uint64_t)aseq.run(horizon, [&](const modsynth::ArpEvent &e) { arpNotesN++; aplay.play(e, now); });
    if (mseq.running() && hasMel)
      melSteps += (uint64_t)mseq.run(horizon, [&](const modsynth::MelEvent &e) { melNotesN++; melLastMidi = e.midi; mplay.play(e, now); }, now);
  }
  void discardIdleLiveChords() {
    if (!bseq.running() && !mseq.running() && !aseq.running()) liveChords.clear();
  }
  void applyLiveChords(double now) {
    if (sseq.running() || (!bseq.running() && !mseq.running() && !aseq.running())) { liveChords.clear(); return; }
    while (!liveChords.empty() && liveChords.front().frame < now + lookahead) {
      LiveChord c = std::move(liveChords.front()); liveChords.erase(liveChords.begin());
      followUntil(now, c.frame);
      // Each part keeps its own phrase-lock table; copying just the window
      // indices would make the melody play a bass lock or a stale song lock.
      bseq.setLiveTimeline(std::move(c.bass));
      mseq.timeline() = std::move(c.mel);
      aseq.setNotes(c.tones);
      liveFrame = c.frame; liveChanges++; arpChords++;
    }
  }
  void tick() {
    os_unfair_lock_lock(&lock);
    tmap.prune((double)frames->load(std::memory_order_relaxed) - sr);     // the clock never goes back; keep a second
    if (seq.running() && hasScore) {
      const double now = (double)frames->load(std::memory_order_relaxed);
      seq.run(now + lookahead,
        [&](const modsynth::DrumEvent &e) {
          events++;
          play(e, now);
          if (!record) return;
          if (rec.size() + kEventDoubles > recCap) { recDropped++; return; }
          const double d[kEventDoubles] = {e.frameExact, (double)e.frame, (double)e.part, (double)e.kit, (double)e.lane, e.vel,
                                           e.accent ? 1.0 : 0.0, e.pitch, e.dyn, (double)e.chokeGroup, e.chokes ? 1.0 : 0.0, (double)e.step, (double)e.bar};
          rec.insert(rec.end(), d, d + kEventDoubles);
        },
        [&](const modsynth::BarMark &b) { sseq.noteBar(b.frameExact); },
        [&](int step, int bar, double frame) {
          steps++;
          if (frame < now) late++;               // its moment had passed before the thread got to it
          ring[ringN % kRing] = {frame, step, bar}; ringN++;
        });
    }
    {
      // Ending timers and the fade, by the render clock.
      const double now = (double)frames->load(std::memory_order_relaxed);
      if (fading && endGain) {
        while (fadeDone < fadeSteps && now >= fadeT0 + fadeDur * (fadeDone + 1) / fadeSteps) {
          fadeDone++;
          // even in decibels, not in gain: a fader is ridden on a dB scale; the last step is silence
          endGain->store(fadeDone >= fadeSteps ? 0.f : (float)std::pow(10.0, (-48.0 * fadeDone / fadeSteps) / 20.0), std::memory_order_relaxed);
        }
        if (fadeDone >= fadeSteps) fading = false;
      }
      for (size_t i = 0; i < endTimers.size();) {
        const EndTimed t = endTimers[i];
        if (now < t.frame) { i++; continue; }
        endTimers.erase(endTimers.begin() + (long)i);
        if (t.what == 0) setTempoNow(t.v);
        else if (t.what == 1 && endGain) endGain->store((float)t.v, std::memory_order_relaxed);
        else if (t.what == 2) cplay.stopAt(t.frame);
      }
    }
    if (sseq.running() && hasSong) {
      const double now = (double)frames->load(std::memory_order_relaxed);
      // What a chord does to the sound: strike it, or stop the one that rings (a rest, Chords off). Hits are the re-strikes of the comp's rhythm.
      auto act = [&](const modsynth::VoiceAction &a, bool isHit) {
        if (a.play) { if (isHit) songHits++; else songVoiced++; cplay.play(a.e, now); }
        else if (a.stop) { if (!isHit) songRests++; cplay.stopAt(a.onset); }
      };
      auto hits = [&](double horizon) { svoice.flush(horizon, sseq.score(), sseq.capoNow(), tmap, [&](const modsynth::VoiceAction &a) { act(a, true); }); };
      sseq.run(now + lookahead, seq.running(), [&](const modsynth::SongChord &c) {
        bseq.timeline().push(c.w); songChords++;
        if (hasMel) mseq.timeline().push(c.w);
        if (aseq.running() && hasArp) {
          // setArpChord in _playChartSlot2: the arp's tones are the chord's (a slash chord's bass first, the octaves above), from the moment the chord begins; the steps before it
          // are the chord before's. A rest does not change the chord: it starts the pattern again.
          arpSteps += (uint64_t)aseq.run(c.w.t, [&](const modsynth::ArpEvent &e) { arpNotesN++; aplay.play(e, now); });
          if (c.s.rest) aseq.restart();
          else aseq.setNotes(modsynth::arpChordNotes(c.s.rootM + c.capo, c.s.bassM >= 0 ? c.s.bassM + c.capo : -1, c.s.ivs, aseq.score().octaves));
          arpChords++;
        }
        { int ns = 0, nl = 0; sseq.nextPlace(ns, nl);
          const double a9[9] = {(double)songChords, (double)c.section, (double)c.slot, (double)c.pass, c.w.t, c.w.end, (double)ns, (double)nl, (double)c.capo};
          std::memcpy(ask, a9, sizeof ask); }
        if (!sseq.score().voice.on) return;
        hits(c.w.t);                                  // the chord before plays its last re-strikes first: the player takes them in time order
        act(svoice.chord(c, sseq.score(), tmap), false);
      }, [&](const modsynth::ChorusEvent &ev) {
        // The practice trainer stepped the tempo at a chorus's first bar line. The drums have already laid their steps out to their look-ahead at the old tempo, and the
        // other parts follow the same map, so it takes effect at the first step the drums have not laid out, never before the bar line.
        if (ev.bpm > 0) tmap.jump(std::max(ev.frame, seq.running() ? seq.nextFrame() : ev.frame), ev.bpm);
      }, [&](const modsynth::EndingEvent &ev) {
        using EE = modsynth::EndingEvent;
        if (ev.type == EE::Ritard) {
          // the slowdown: the tempo steps the page's way, at the first step the drums have not laid out
          endPhase = 1; endAt = ev.frame; endRestoreBpm = std::round(ev.fromBpm);
          for (const auto &st : ev.tempoSteps) tmap.jump(std::max(st.first, seq.running() ? seq.nextFrame() : st.first), st.second);
        } else if (ev.type == EE::FadeStart) {
          endPhase = 1; endAt = ev.frame; fading = true; fadeT0 = ev.frame; fadeDur = ev.durFrames; fadeSteps = ev.fadeSteps; fadeDone = 0;
        } else if (ev.type == EE::FadeEnd) {
          // stopEverything: the band, the chord and the song stop; the master comes back up a moment later
          endPhase = 2; endAt = ev.frame; endLands++;
          landStop(ev.frame);
          if (endGain) endTimers.push_back({ev.frame + 0.6 * sr, 1, 1.0});
        } else {
          landing(ev, now);
        }
      });
      if (sseq.score().voice.on) hits(now + lookahead);
      bseq.timeline().prune(now);
      if (hasMel) mseq.timeline().prune(now);
    }
    const double followNow = (double)frames->load(std::memory_order_relaxed);
    applyLiveChords(followNow);
    followUntil(followNow, followNow + lookahead);
    if (cseq.running() && hasChord) {
      const double now = (double)frames->load(std::memory_order_relaxed);
      chordSteps += (uint64_t)cseq.run(now + lookahead, [&](const modsynth::ChordEvent &e) { chordHits++; cplay.play(e, now); });
    }
    os_unfair_lock_unlock(&lock);
  }
  void startThread() {
    if (threadOn.exchange(true)) return;
    th = std::thread([this] {
      pthread_setname_np("modriff.sequencer");
      // The same class of thread the audio work asks for: it has a deadline of a few milliseconds a tick.
      pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
      while (!quit.load(std::memory_order_relaxed)) { tick(); usleep(4000); }
    });
  }
};
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
  std::atomic<float> _masterRms;           // the loudest block's RMS out of the master, held until read (the mixer's master meter)
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
  std::atomic<float> _endGain;            // an ending's fade rides this multiplier on the master (the sequencer thread sets it, the render callback ramps to it)
  float _endGainPrev;
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
  // Last, so it is destroyed first: its thread reads _frames and must be joined before that goes.
  std::unique_ptr<HostSeq> _hostSeq;
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
    _masterRms.store(0.0f);
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
    _endGain.store(1.0f); _endGainPrev = 1.0f;
    _hostSeq = std::make_unique<HostSeq>(&_frames, sampleRate);
    {
      // The sequencer thread begins voices the way the page's graphBegin does, under the same lock. Raw pointers: the
      // members outlive the thread (it is joined first, see _hostSeq).
      modsynth::GraphPool *pool = &_graphs; os_unfair_lock *lk = &_graphLock;
      _hostSeq->begin = [pool, lk](const double *prog, size_t n, double base, uint64_t start) {
        os_unfair_lock_lock(lk);
        const int h = pool->begin(prog, n, base, start);
        os_unfair_lock_unlock(lk);
        return h;
      };
      _hostSeq->edit = [pool, lk](int handle, const double *inc, size_t n) {
        os_unfair_lock_lock(lk);
        const bool ok = pool->edit(handle, inc, n);
        os_unfair_lock_unlock(lk);
        return ok;
      };
      _hostSeq->kill = [pool, lk](uint32_t mask, uint64_t at, int fade) {
        os_unfair_lock_lock(lk);
        const bool ok = pool->killParts(mask, at, fade);
        os_unfair_lock_unlock(lk);
        return ok;
      };
      _hostSeq->endGain = &_endGain;
      _hostSeq->bplay.begin = _hostSeq->begin;
      _hostSeq->bplay.edit = _hostSeq->edit;
      _hostSeq->cplay.begin = _hostSeq->begin;
      _hostSeq->cplay.edit = _hostSeq->edit;
      _hostSeq->aplay.begin = _hostSeq->begin;
      _hostSeq->mplay.begin = _hostSeq->begin;
    }
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

// ── The native sequencer (see HostSeq above) ─────────────────────────────

// The drum score as the page exports it (float64s, seqcore.cpp has the layout). Any thread; it takes effect at the
// next step, as an edit to the page's grid does.
- (BOOL)seqSetDrumScore:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::DrumScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->seq.setScore(s);
  _hostSeq->hasScore = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// Begins at step 0 with its downbeat `leadMs` from now on the engine's own clock. NO without a score.
- (BOOL)seqStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs seed:(double)seed {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasScore) { os_unfair_lock_unlock(&q.lock); return NO; }
  q.seq.setTempo(bpm > 0 ? bpm : 120);
  q.setTempoNow(bpm > 0 ? bpm : 120);
  q.seq.setRate(rate > 0 ? rate : 1);
  if (seed != 0) q.seq.seed((uint64_t)seed);
  const double first = (double)_frames.load(std::memory_order_relaxed) + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  q.steps = q.events = q.late = q.recDropped = 0; q.resetCounters(); q.ringN = 0; q.firstFrame = (uint64_t)first;
  q.rec.clear();
  q.seq.start(first);
  os_unfair_lock_unlock(&q.lock);
  q.startThread();
  return YES;
}

// A voice the page recorded (voicebank.h's layout, float64s). NO if it does not parse. Replaces the same part, kit and lane.
- (BOOL)seqPutBankEntry:(NSData *)entry {
  const size_t n = entry.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), entry.bytes, n * sizeof(double));
  os_unfair_lock_lock(&_hostSeq->lock);
  const bool ok = _hostSeq->bank.put(d.data(), n);
  os_unfair_lock_unlock(&_hostSeq->lock);
  return ok;
}

- (void)seqClearBank {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->bank.clear();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// One live chord, with times relative to its wall-clock stamp. This uses the
// same block offset as beginGraph, so the chord and its followers share a clock.
- (NSDictionary *)seqLiveChord:(NSData *)bass melody:(NSData *)mel notes:(NSData *)notes timestampMs:(double)ts {
  auto read = [](NSData *data, std::vector<double> &v) {
    if (!data.length || data.length % sizeof(double)) return false;
    v.resize(data.length / sizeof(double)); std::memcpy(v.data(), data.bytes, data.length);
    for (double x : v) if (!std::isfinite(x)) return false;
    return true;
  };
  std::vector<double> b, m, n;
  if (!std::isfinite(ts) || !read(bass, b) || !read(mel, m) || !read(notes, n) || n.size() > 64 ||
      b.size() < 3 || m.size() < 3 || b[0] != 1 || m[0] != 1 || b[2] <= 0 || m[2] <= 0)
    return @{ @"ok": @NO, @"why": @"invalid live chord" };
  double frame = (double)_frames.load(std::memory_order_relaxed);
  const double off = _curOffPub.load(std::memory_order_relaxed);
  if (ts > 0 && std::isfinite(off)) {
    const double f = (ts - off) * _sampleRate / 1000.0;
    if (f > frame - 5 * _sampleRate && f < frame + 5 * _sampleRate) frame = std::max(0.0, f);
  }
  // Window offsets travel in seconds, independent of the current hardware rate.
  b[2] *= _sampleRate; m[2] *= _sampleRate;
  HostSeq::LiveChord c; c.frame = frame;
  c.bass.setSampleRate(_sampleRate); c.mel.setSampleRate(_sampleRate);
  size_t ub = 0, um = 0;
  if (!c.bass.fromDoubles(b.data(), b.size(), &ub, frame) || ub != b.size() ||
      !c.mel.fromDoubles(m.data(), m.size(), &um, frame) || um != m.size() ||
      c.bass.size() != 1 || c.mel.size() != 1 || b[1] != 0 || m[1] != 0)
    return @{ @"ok": @NO, @"why": @"invalid live windows" };
  for (double x : n) {
    if (x < 0 || x > 127 || x != std::floor(x)) return @{ @"ok": @NO, @"why": @"invalid live tones" };
    c.tones.push_back((int)x);
  }
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  NSString *why = q.sseq.running() ? @"song owns the timeline" :
      (!q.bseq.running() && !q.mseq.running() && !q.aseq.running()) ? @"no native followers" :
      q.liveChords.size() >= 64 ? @"live chord queue full" : nil;
  if (!why) {
    auto at = std::upper_bound(q.liveChords.begin(), q.liveChords.end(), frame,
        [](double f, const HostSeq::LiveChord &x) { return f < x.frame; });
    q.liveChords.insert(at, std::move(c));
  }
  os_unfair_lock_unlock(&q.lock);
  return why ? @{ @"ok": @NO, @"why": why } : @{ @"ok": @YES, @"frame": @(frame) };
}

// ── The bass line (slice 2): the same thread, the same bank ──────────────────

// The bass score (window._blNativeScore().score). NO if it does not parse.
- (BOOL)seqSetBassScore:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::BassScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->bseq.setScore(s);
  _hostSeq->hasBass = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// The chord windows (window._blNativeChords), frames from the line's start. Replaces the timeline, wherever the line is.
- (BOOL)seqSetBassChords:(NSData *)chords {
  const size_t n = chords.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), chords.bytes, n * sizeof(double));
  modsynth::ChordTimeline probe;
  if (n && !probe.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->bassChords = d;
  _hostSeq->placeChords();
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// A line written ahead (window._blNativePending), frames from the line's start. It replaces the one waiting, if any.
- (BOOL)seqSetBassPending:(NSData *)pending {
  const size_t n = pending.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), pending.bytes, n * sizeof(double));
  modsynth::BassPending probe;
  if (!n || !probe.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->bassPendingRaw = d;
  _hostSeq->placePending();
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// Starts the line at step 0: with the drums' downbeat if they are running (so the two share a bar line), otherwise `leadMs` from
// now. `kit` is the bank's code for the bass voice that is on. NO without a score.
- (BOOL)seqBassStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasBass) { os_unfair_lock_unlock(&q.lock); return NO; }
  q.bseq.setTempo(bpm > 0 ? bpm : 120);
  q.setTempoNow(bpm > 0 ? bpm : 120);
  q.bseq.setRate(rate > 0 ? rate : 1);
  if (seed != 0) q.bseq.seed((uint64_t)seed);
  double first = (double)_frames.load(std::memory_order_relaxed) + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  if (align && q.seq.running() && q.seq.nextFrame() > (double)_frames.load(std::memory_order_relaxed)) first = q.seq.nextFrame();
  q.bplay.reset(); q.bplay.kit = kit;
  q.bassSteps = q.bassNotes = 0; q.bassFirst = (uint64_t)first; q.bassOrigin = first;
  q.placeChords();
  q.bseq.start(first);
  q.placePending();            // a line sent before the start waits for its moment from here (start clears what was waiting)
  os_unfair_lock_unlock(&q.lock);
  q.startThread();
  return YES;
}

- (void)seqBassStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->bseq.stop();
  _hostSeq->discardIdleLiveChords();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (void)seqBassSetTempo:(double)bpm rate:(double)rate {
  os_unfair_lock_lock(&_hostSeq->lock);
  if (bpm > 0) { _hostSeq->bseq.setTempo(bpm); _hostSeq->setTempoNow(bpm); }
  if (rate > 0) _hostSeq->bseq.setRate(rate);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// ── The arpeggiator (slice 3): the same thread, the same bank ────────────────

// The arp's settings (window._arpNativeScore().score). NO if it does not parse.
- (BOOL)seqSetArpScore:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::ArpScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->aseq.setScore(s);
  _hostSeq->hasArp = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// The chord the arp is on, MIDI notes with the octaves already added (window._arpNativeNotes()); the pattern starts again. Empty: no chord.
- (BOOL)seqSetArpNotes:(NSData *)notes {
  const size_t n = notes.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), notes.bytes, n * sizeof(double));
  std::vector<int> v;
  for (double x : d) { if (!(x >= 0 && x <= 127)) return NO; v.push_back((int)x); }
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->aseq.setNotes(v);
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// The arp starts with the song (on its bar line, following its chords) whenever one is started, until disarmed. `kit` is the bank's code for the arp voice.
- (void)seqArpArm:(BOOL)on kit:(int)kit {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->arpArmed = on; _hostSeq->arpKit = kit;
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// Starts the arp on its own: with the drums' downbeat when they are running and `align` is set, else `leadMs` from now; on the chord it was given (seqSetArpNotes).
// NO without a score.
- (BOOL)seqArpStartWithBpm:(double)bpm leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasArp) { os_unfair_lock_unlock(&q.lock); return NO; }
  if (bpm > 0) q.setTempoNow(bpm);
  if (seed != 0) q.aseq.seed((uint64_t)seed);
  const double now = (double)_frames.load(std::memory_order_relaxed);
  double first = now + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  if (align && q.seq.running() && q.seq.nextFrame() > now) first = q.seq.nextBarFrame() > now ? q.seq.nextBarFrame() : q.seq.nextFrame();
  q.aplay.reset(); q.aplay.kit = kit;
  q.arpSteps = q.arpNotesN = q.arpChords = 0; q.arpFirst = (uint64_t)first; q.arpBySong = false;
  q.aseq.start(first, q.seq.running() ? q.seq.epochFrame() : first);
  os_unfair_lock_unlock(&q.lock);
  q.startThread();
  return YES;
}

- (void)seqArpStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->aseq.stop(); _hostSeq->arpBySong = false;
  _hostSeq->discardIdleLiveChords();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// ── The melody generator (slice 3, part three): the same thread, the same bank ─────────────

// The melody generator's line (window._mlNativeScore().score). NO if it does not parse.
- (BOOL)seqSetMelPending:(NSData *)pending {
  const size_t n = pending.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), pending.bytes, n * sizeof(double));
  modsynth::MelPending line;
  os_unfair_lock_lock(&_hostSeq->lock);
  const bool ok = line.fromDoubles(d.data(), n, _hostSeq->melFirst);
  if (ok) _hostSeq->mseq.setPending(line);
  os_unfair_lock_unlock(&_hostSeq->lock);
  return ok;
}

- (BOOL)seqSetMelScore:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::MelScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->mseq.setScore(s);
  _hostSeq->hasMel = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// The chord windows with the melody's locks (window._mlNativeChords), frames from the line's start, for a start by hand (a song makes its own). Empty clears them.
- (BOOL)seqSetMelChords:(NSData *)chords {
  const size_t n = chords.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), chords.bytes, n * sizeof(double));
  modsynth::ChordTimeline probe;
  if (n && !probe.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->melChords = d;
  _hostSeq->placeMelChords();
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// The melody starts with the song (on its bar line, following its chords) whenever one is started, until disarmed. `kit` is the bank's code for the voice; `rate` the melody's rate multiplier.
- (void)seqMelArm:(BOOL)on kit:(int)kit rate:(double)rate {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->melArmed = on; _hostSeq->melKit = kit; _hostSeq->melRate = rate > 0 ? rate : 1;
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// Starts the melody by itself: with the drums' bar line when they are running and `align` is set, else `leadMs` from now. NO without a score.
- (BOOL)seqMelStartWithBpm:(double)bpm rate:(double)rate leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit seed:(double)seed {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasMel) { os_unfair_lock_unlock(&q.lock); return NO; }
  q.mseq.setTempo(bpm > 0 ? bpm : 120);
  q.setTempoNow(bpm > 0 ? bpm : 120);
  q.mseq.setRate(rate > 0 ? rate : 1);
  if (seed != 0) q.mseq.seed((uint64_t)seed);
  double first = (double)_frames.load(std::memory_order_relaxed) + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  if (align && q.seq.running() && q.seq.nextFrame() > (double)_frames.load(std::memory_order_relaxed)) first = q.seq.nextBarFrame() > (double)_frames.load(std::memory_order_relaxed) ? q.seq.nextBarFrame() : q.seq.nextFrame();
  q.mplay.reset(); q.mplay.kit = kit;
  q.melSteps = q.melNotesN = 0; q.melFirst = (uint64_t)first; q.melOrigin = first; q.melBySong = false;
  q.placeMelChords();
  q.mseq.start(first);
  os_unfair_lock_unlock(&q.lock);
  q.startThread();
  return YES;
}

- (void)seqMelStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->mseq.stop(); _hostSeq->melBySong = false;
  _hostSeq->discardIdleLiveChords();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (void)seqMelSetTempo:(double)bpm rate:(double)rate {
  os_unfair_lock_lock(&_hostSeq->lock);
  if (bpm > 0) { _hostSeq->mseq.setTempo(bpm); _hostSeq->setTempoNow(bpm); }
  if (rate > 0) _hostSeq->mseq.setRate(rate);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// ── The song loop (slice 4): the chords of the chart, stepped by the engine ──

// The song (window._songNativeScore().score). NO if it does not parse.
- (BOOL)seqSetSong:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::SongScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.setScore(s);
  _hostSeq->hasSong = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// Starts the song at chord `slot` of `section`, `pass` passes in: on the drums' next bar line when they are running and `align` is set, else `leadMs` from
// now. The bass follows the windows it makes (its own chart is cleared). NO without a song, or with no chord at that place.
- (BOOL)seqSongStartWithLeadMs:(double)leadMs alignToDrums:(BOOL)align section:(int)section slot:(int)slot pass:(int)pass {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasSong) { os_unfair_lock_unlock(&q.lock); return NO; }
  const double now = (double)_frames.load(std::memory_order_relaxed);
  double first = now + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  if (align && q.seq.running()) { const double bar = q.seq.nextBarFrame(); if (bar > now) first = bar; }
  q.liveChords.clear();
  q.bseq.timeline().clear();
  q.bseq.timeline().setSampleRate(_sampleRate);
  q.bseq.timeline().setLocks(q.sseq.score().locks);
  const BOOL ok = q.sseq.start(first, section, slot, pass);
  q.songChords = 0; q.songFirst = (uint64_t)first; q.songVoiced = q.songRests = q.songHits = 0; std::memset(q.ask, 0, sizeof q.ask);
  q.endTimers.clear(); q.fading = false; q.endPhase = 0; q.endRestoreBpm = 0; if (q.endGain) q.endGain->store(1.0f, std::memory_order_relaxed);
  // The chords the song sounds itself: a fresh run of voice leading, the chord player on the song's voice, nothing left ringing from before.
  q.svoice.reset();
  if (q.sseq.score().voice.on) { q.cplay.reset(); q.cplay.kit = q.sseq.score().voice.kit; }
  // The melody generator, when it is armed: the same windows as the bass, its own locks, on the same bar line.
  q.mseq.timeline().clear(); q.mseq.timeline().setSampleRate(_sampleRate); q.mseq.timeline().setMelLocks(q.sseq.score().melLocks);
  if (ok && q.hasMel && q.melArmed) {
    q.mplay.reset(); q.mplay.kit = q.melKit; q.melSteps = q.melNotesN = 0; q.melFirst = (uint64_t)first;
    q.mseq.setTempo(q.tmap.bpmAt(first)); q.mseq.setRate(q.melRate);
    q.mseq.start(first);
    q.melBySong = true;
  }
  // The arp, when it is armed: on the same bar line, following the song's chords from the first.
  if (ok && q.hasArp && q.arpArmed) {
    q.aplay.reset(); q.aplay.kit = q.arpKit; q.arpSteps = q.arpNotesN = q.arpChords = 0; q.arpFirst = (uint64_t)first;
    q.aseq.start(first, q.seq.running() ? q.seq.epochFrame() : first);
    q.arpBySong = true;
  }
  os_unfair_lock_unlock(&q.lock);
  if (ok) q.startThread();
  return ok;
}

- (void)seqSongStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.stop();
  if (_hostSeq->arpBySong) { _hostSeq->aseq.stop(); _hostSeq->arpBySong = false; }
  if (_hostSeq->melBySong) { _hostSeq->mseq.stop(); _hostSeq->melBySong = false; }       // the arp the song brought in goes with it
  // The page's stopSongLoop stops the chord: a held chord (the comp "sustain") would ring for ever otherwise.
  if (_hostSeq->sseq.score().voice.on) { _hostSeq->svoice.reset(); _hostSeq->cplay.stopAt((double)_frames.load(std::memory_order_relaxed)); }
  _hostSeq->endTimers.clear(); _hostSeq->fading = false; _hostSeq->endPhase = 0; if (_hostSeq->endGain) _hostSeq->endGain->store(1.0f, std::memory_order_relaxed);
  // _pracRestore: the trainer's tempo goes back to where the run began (if the player has not moved it since), and its key shift is dropped.
  { const double now = (double)_frames.load(std::memory_order_relaxed), back = _hostSeq->sseq.restore(_hostSeq->tmap.bpmAt(now)); if (back > 0) _hostSeq->setTempoNow(back); }
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// The ending the player armed for the end of this pass (1 cold, 2 finish, 3 fade, 4 tag, 5 ritard; 0 disarms).
- (void)seqSongArm:(int)kind {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.arm(kind);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// holdSongLoop: the progression freezes and the chord that sounds stays (its rhythm and the bass's chart end; the stop would cut the chord).
- (void)seqSongHold {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.stop();
  _hostSeq->svoice.clearHits();
  _hostSeq->bseq.timeline().clear();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

/// A Next (+1) or Prev (-1) the player queued: taken at the end of the pass.
- (void)seqSongMove:(int)delta {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.queueMove(delta);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

/// The live key change, in semitones.
- (void)seqSongSetCapo:(int)capo {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->sseq.setCapo(capo);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// ── The chord comp (slice 2): the same thread, the same bank ─────────────────

// The chord rhythm and the chord it strikes (window._crNativeScore().score). NO if it does not parse.
- (BOOL)seqSetChordScore:(NSData *)score {
  const size_t n = score.length / sizeof(double);
  std::vector<double> d(n);
  if (n) std::memcpy(d.data(), score.bytes, n * sizeof(double));
  modsynth::ChordScore s;
  if (!s.fromDoubles(d.data(), n)) return NO;
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->cseq.setScore(s);
  _hostSeq->hasChord = true;
  os_unfair_lock_unlock(&_hostSeq->lock);
  return YES;
}

// Starts the rhythm at step 0: with the drums' downbeat when they run and `align` is set, else `leadMs` from now. `kit` is the bank's code for the
// chord voice. NO without a score.
- (BOOL)seqChordStartWithBpm:(double)bpm leadMs:(double)leadMs alignToDrums:(BOOL)align kit:(int)kit {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  if (!q.hasChord) { os_unfair_lock_unlock(&q.lock); return NO; }
  q.cseq.setTempo(bpm > 0 ? bpm : 120);
  q.setTempoNow(bpm > 0 ? bpm : 120);
  double first = (double)_frames.load(std::memory_order_relaxed) + (leadMs > 0 ? leadMs : 0) * _sampleRate / 1000.0;
  if (align && q.seq.running() && q.seq.nextFrame() > (double)_frames.load(std::memory_order_relaxed)) first = q.seq.nextFrame();
  q.cplay.reset(); q.cplay.kit = kit;
  q.chordSteps = q.chordHits = 0; q.chordFirst = (uint64_t)first;
  q.cseq.start(first);
  os_unfair_lock_unlock(&q.lock);
  q.startThread();
  return YES;
}

- (void)seqChordStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->cseq.stop();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (void)seqChordSetTempo:(double)bpm {
  os_unfair_lock_lock(&_hostSeq->lock);
  if (bpm > 0) { _hostSeq->cseq.setTempo(bpm); _hostSeq->setTempoNow(bpm); }
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (void)seqStop {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->seq.stop();
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (void)seqSetTempo:(double)bpm rate:(double)rate {
  os_unfair_lock_lock(&_hostSeq->lock);
  if (bpm > 0) { _hostSeq->seq.setTempo(bpm); _hostSeq->setTempoNow(bpm); }
  if (rate > 0) _hostSeq->seq.setRate(rate);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// The tempo moves in a straight line (in time) from what it is now to `bpm` over `ms`, then holds it: a ritardando, or a tempo the engine moves by
// itself. All three sequencers follow it on one grid.
- (void)seqTempoRampTo:(double)bpm overMs:(double)ms {
  os_unfair_lock_lock(&_hostSeq->lock);
  if (bpm > 0) _hostSeq->tmap.ramp((double)_frames.load(std::memory_order_relaxed), bpm, ms > 0 ? ms * _sampleRate / 1000.0 : 0);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

// Keep (up to `capacity` events) what the sequencer expands, for a test to read with seqTakeEvents.
- (void)seqRecord:(BOOL)on capacity:(int)capacity {
  os_unfair_lock_lock(&_hostSeq->lock);
  _hostSeq->record = on;
  _hostSeq->recCap = on ? (size_t)(capacity > 0 ? capacity : 0) * HostSeq::kEventDoubles : 0;
  _hostSeq->rec.clear();
  if (on) _hostSeq->rec.reserve(_hostSeq->recCap);
  os_unfair_lock_unlock(&_hostSeq->lock);
}

- (NSData *)seqTakeEvents {
  os_unfair_lock_lock(&_hostSeq->lock);
  NSData *d = [NSData dataWithBytes:_hostSeq->rec.data() length:_hostSeq->rec.size() * sizeof(double)];
  _hostSeq->rec.clear();
  os_unfair_lock_unlock(&_hostSeq->lock);
  return d;
}

// What the page draws from. step and bar are the last step whose moment has come on the render clock (what is being
// heard, give or take the output latency), not the one the thread has expanded to.
- (NSDictionary *)seqMirror {
  HostSeq &q = *_hostSeq;
  os_unfair_lock_lock(&q.lock);
  const double now = (double)_frames.load(std::memory_order_relaxed);
  int step = -1, bar = 0;
  const uint32_t have = q.ringN < (uint32_t)HostSeq::kRing ? q.ringN : (uint32_t)HostSeq::kRing;
  for (uint32_t k = 0; k < have; k++) {
    const HostSeq::Fired &f = q.ring[(q.ringN - 1 - k) % HostSeq::kRing];
    if (f.frame <= now) { step = f.step; bar = f.bar; break; }
  }
  NSDictionary *r = @{@"sampleRate": @(_sampleRate), @"running": @(q.seq.running()), @"step": @(step), @"bar": @(bar), @"frame": @(now), @"tempo": @(q.tmap.bpmAt(now)),
                      @"steps": @((double)q.steps), @"events": @((double)q.events), @"late": @((double)q.late),
                      @"firstFrame": @((double)q.firstFrame), @"nextFrame": @(q.seq.nextFrame()),
                      @"recDropped": @((double)q.recDropped),
                      @"live": @{@"changes": @((double)q.liveChanges), @"pending": @(q.liveChords.size()), @"frame": @(q.liveFrame)},
                      @"hits": @((double)q.hits), @"misses": @((double)q.misses), @"silent": @((double)q.silent), @"refused": @((double)q.refused),
                      @"lateStarts": @((double)q.lateStarts), @"bank": @((double)q.bank.size()),
                      @"cuts": @((double)q.cuts), @"cutEdits": @((double)q.cutEdits),
                      @"chord": @{@"running": @(q.cseq.running()), @"nextStep": @(q.cseq.step()), @"steps": @((double)q.chordSteps), @"hits": @((double)q.chordHits),
                                  @"chords": @((double)q.cplay.chords), @"voices": @((double)q.cplay.voices), @"stops": @((double)q.cplay.stops), @"releases": @((double)q.cplay.releases),
                                  @"misses": @((double)q.cplay.misses), @"refused": @((double)q.cplay.refused), @"firstFrame": @((double)q.chordFirst)},
                      @"bass": @{@"running": @(q.bseq.running()), @"nextStep": @(q.bseq.step()), @"steps": @((double)q.bassSteps), @"notes": @((double)q.bassNotes),
                                 @"hits": @((double)q.bplay.hits), @"misses": @((double)q.bplay.misses), @"refused": @((double)q.bplay.refused),
                                 @"cuts": @((double)q.bplay.cuts), @"lateStarts": @((double)q.bplay.lateStarts), @"firstFrame": @((double)q.bassFirst),
                                 @"lastMidi": @(q.bassLastMidi), @"lastMissLane": @(q.bplay.lastMissLane), @"windows": @((double)q.bseq.timeline().size())},
                      @"arp": @{@"running": @(q.aseq.running()), @"steps": @((double)q.arpSteps), @"notes": @((double)q.aplay.notes), @"blocks": @((double)q.aplay.blocks),
                                @"voices": @((double)q.aplay.voices), @"misses": @((double)q.aplay.misses), @"refused": @((double)q.aplay.refused), @"lateStarts": @((double)q.aplay.lateStarts),
                                @"firstFrame": @((double)q.arpFirst), @"nextFrame": @(q.aseq.nextFrame()), @"lastMissLane": @(q.aplay.lastMissLane), @"chords": @((double)q.arpChords),
                                @"armed": @(q.arpArmed), @"bySong": @(q.arpBySong),
                                @"tones": ({ NSMutableArray *t = [NSMutableArray array]; for (int n : q.aseq.notes()) [t addObject:@(n)]; t; })},
                      @"mel": @{@"running": @(q.mseq.running()), @"nextStep": @(q.mseq.step()), @"steps": @((double)q.melSteps), @"notes": @((double)q.mplay.notes), @"slides": @((double)q.mplay.slides),
                                @"voices": @((double)q.mplay.voices), @"misses": @((double)q.mplay.misses), @"refused": @((double)q.mplay.refused), @"lateStarts": @((double)q.mplay.lateStarts),
                                @"firstFrame": @((double)q.melFirst), @"nextFrame": @(q.mseq.nextFrame()), @"lastMissLane": @(q.mplay.lastMissLane), @"windows": @((double)q.mseq.timeline().size()),
                                @"armed": @(q.melArmed), @"bySong": @(q.melBySong), @"lastMidi": @(q.melLastMidi)},
                      @"song": @{@"running": @(q.sseq.running()), @"section": @(q.sseq.section()), @"slot": @(q.sseq.slot()), @"pass": @(q.sseq.pass()),
                                 @"chords": @((double)q.songChords), @"firstFrame": @((double)q.songFirst), @"nextStart": @(q.sseq.nextStart()),
                                 @"pending": @(q.sseq.queuedMove()), @"ending": @{@"armed": @(q.sseq.armedEnding()), @"phase": @(q.endPhase), @"at": @(q.endAt), @"lands": @((double)q.endLands), @"gain": @(q.endGain ? q.endGain->load() : 1.0f)}, @"chorus": @(q.sseq.chorus()), @"keyShift": @(q.sseq.keyShift()), @"ask": @[@(q.ask[0]), @(q.ask[1]), @(q.ask[2]), @(q.ask[3]), @(q.ask[4]), @(q.ask[5]), @(q.ask[6]), @(q.ask[7]), @(q.ask[8])],
                                 @"voiced": @((double)q.songVoiced), @"hits": @((double)q.songHits), @"rests": @((double)q.songRests), @"misses": @((double)q.cplay.misses), @"refused": @((double)q.cplay.refused),
                                 @"voices": @((double)q.cplay.voices), @"stops": @((double)q.cplay.stops), @"releases": @((double)q.cplay.releases)},
                      @"lastMiss": @[@(q.lastMissPart), @(q.lastMissKit), @(q.lastMissLane)]};
  os_unfair_lock_unlock(&q.lock);
  return r;
}

- (NSDictionary *)graphStats {
  return @{@"voices": @(_graphs.active()), @"dropped": @((double)_graphs.dropped()),
           @"droppedBusy": @((double)_graphs.droppedBusy()), @"droppedRefused": @((double)_graphs.droppedRefused()),
           @"peakVoices": @(_graphs.peakActive()), @"stolen": @((double)_graphs.stolen()), @"lateEdits": @((double)_graphs.lateEdits())};
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
    // Only while there is a Processor: this is the Processor's own clock (applyMessage
    // places a note on it), and a part played as graphs runs here for its voices and
    // their tail with no Processor, a clock that is not the Processor's. One built
    // later (a part set to a mõdSynth patch after it had been playing as graphs) started
    // at zero and was handed notes that many seconds late: the arp, switched to a patch
    // after about twenty seconds of playing, was silent for twenty seconds and kept
    // playing for twenty after Stop.
    if (p) _partFrames[part] += (uint64_t)frames;
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
  // An ending's fade, after the master: a ramp across the block to where the sequencer thread has put it, so the steps of the fade are never heard as steps.
  { const float g = _endGain.load(std::memory_order_relaxed);
    if (g != 1.0f || _endGainPrev != 1.0f) {
      const float g0 = _endGainPrev, d = (g - g0) / (float)frames;
      for (int i = 0; i < frames; i++) { const float m = g0 + d * (float)(i + 1); left[i] *= m; right[i] *= m; }
      _endGainPrev = g;
    } }

  // What leaves for the speaker: the web's _masterOut, for the part of the mix
  // that is not Web Audio.
  if (modsynth::CaptureRing *c = _cap[0].load(std::memory_order_acquire))
    c->write(left, right, frames, blockFrame);

  // Loudest sample this block, held until read. Silence and work are
  // indistinguishable in a load figure; they are not in this.
  float pk = 0.0f;
  double sq = 0.0;
  for (int i = 0; i < frames; i++) {
    const float a = left[i] < 0 ? -left[i] : left[i];
    if (a > pk) pk = a;
    sq += (double)left[i] * left[i] + (double)right[i] * right[i];
  }
  {
    const float rms = (float)std::sqrt(sq / (2.0 * (double)frames));
    float held = _masterRms.load(std::memory_order_relaxed);
    while (rms > held && !_masterRms.compare_exchange_weak(held, rms, std::memory_order_relaxed)) {}
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
  if (part == kMaxParts) return _masterRms.exchange(0.0f, std::memory_order_relaxed);   // the master, one past the parts
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
