// The native song loop (docs/native-scheduling.md, slice 4, piece 2): which chord of which section is sounding and when it changes, as plain C++ with
// no iOS and no audio, so a Mac test can hold it to the page. It is a port of the stepping in index.html: `_playLoopSlot` (a chord starts, its window is
// published to the bass: `_blOnChord`, and the next one is peeked: `_songPeekNextSlot`), `tickSongLoop` (a bar line the drums announce is counted
// against the chord's bars), the timer path of `_playLoopSlot` (a chord of beats or eighths, or any chord with no drums to count, ends after its own
// length) and `_advanceLoopSlot` (the next chord, the end of a pass, a queued Next/Prev, a section that has had its passes).
//
// What it emits is what the page hands the bass for every chord: a ChordWindow (start and nominal end in frames, rest, root, slash bass, the next
// chord's root, the chord's tones, its phrase lock), plus where in the song it is (section, chord, pass). The host pushes them into the bass
// sequencer's ChordTimeline; the page stops calling `_blOnChord`.
//
// Time. A chord's length is bars (of the meter's `barSteps` sixteenths), beats and eighths (swung when Chart 8ths are), in beats, and a beat is the
// tempo map's (tempomap.h), so a chord follows a ritardando; the page measures it in milliseconds at the tempo of the moment the chord starts. At a
// constant tempo they are the same.
//
// Two ways a chord ends, chosen when it starts (the page's `_songSlotNeedsTimeout`, `snapMode` and `rhythmOn || sqOn`):
//  - by the bar clock: a chord of whole bars, with the drums playing and snap on, counts the bar lines the drums announce after its own start, and the
//    next chord starts on the line that makes the count (a chord that began mid-bar is back on the bar grid at the first line);
//  - by time: a chord of beats or eighths, or with no drums, or with snap off, ends one length after it began.
//
// Not in it, said plainly (the page's score refuses what it cannot do and says so): the practice loop and trainer, the endings, a chord tapped by
// hand (a jump), and the page's habit of counting a bar line it announced a moment before a timed chord ended (the engine counts the lines after a
// chord's start, whichever order the page's two clocks fire in).
//
// Control-side (the sequencer thread, under the host's lock).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <utility>
#include <vector>

#include "basscore.h"
#include "tempomap.h"
#include "voicing.h"

namespace modsynth {

struct SongSlot {
  int bars = 0, beats = 0, eighths = 0;
  bool rest = false;
  int rootM = 0;               // the root, MIDI note, in the key the song was written in (the capo is added)
  int bassM = -1;              // a slash chord's bass, MIDI, or -1
  int lock = -1;               // its phrase lock in the score's table, or -1
  int melLock = -1;            // ...and its melody generator lock in the score's melody table, or -1
  std::vector<int> ivs;        // the chord's tones, semitones above the root
  int voicing = -1;            // the voicing the chord carries (VoicingStyle), or -1: the song's
  bool hold = false;           // struck held (comp "sustain", or "as played" with a ring) instead of decaying
  double ring = 0;             // "as played": beats the held chord rings before it is let go of (0: it is held into the next chord)
  int pat = -1;                // its comp rhythm in the voice's table, or -1: the chord is struck once and held or left to decay
};

// A comp rhythm (the page's COMP_PATTERNS entry with hits): the re-strikes of a chord after its first strike. A built-in lists its hits in eighths of a bar
// (p), all at full strength and ringing; a drawn one lays them over a loop of `steps` sixteenths (p, fractional for a ratchet), with a strength v and a gate
// `len` in steps (0: the hit rings and decays), and may carry a swing of its own.
struct CompHitDef { double p = 0, v = 1, len = 0; };
struct CompPattern {
  bool drawn = false;
  int steps = 16;
  double swing = -1;           // percent, or -1: the app's Feel
  std::vector<CompHitDef> ev;
};

// How the engine sounds the chords it steps (the page's playChartSlot2/playChord settings, read once): off, the engine only steps and hands the bass its windows.
struct SongVoiceCfg {
  bool on = false;
  int kit = 0;                 // the bank's code for the chord voice
  bool play = true;            // Chords are on (off: the chord before is stopped and nothing new sounds)
  bool pedal = false;          // Wet/dry at the top: the chord is a held pedal under the arp (wetDry >= .99)
  VoicingConfig vc;            // the voicing set in Settings, Vary, VoiceLead, and the key (without the capo)
  double decRaw = 2;           // the Decay knob, seconds
  double chordBeats = 0;       // the Length buttons: 0 = by the knob
  bool strum = false;
  double spread = 0, width = 0;
  bool sub = true;
  double velBase = 1;          // velScale(0)
  double feelSwing = 0;        // the app's swing, percent (the drawn rhythms' fallback)
  bool swing8 = true;          // the swing falls on the eighths (else the sixteenths)
  std::vector<CompPattern> patterns;
};

struct SongSection {
  std::vector<SongSlot> slots;
  int plays = 0;               // passes before it moves on (secPlays): 0 holds for ever
  bool follow = false;         // the old "go to the next section" flag, which the page's peek still reads
};

// The practice trainer (the page's prac and pracLoop): the bars to loop in one section, and what each chorus changes -- the tempo a step up to a ceiling, the key by an interval.
struct SongTrainer {
  bool loopOn = false; int loopSection = -1, loopA = -1, loopB = -1;      // chords a..b of one section play over and over; each pass is a chorus
  bool rampOn = false; int rampStep = 4, rampEvery = 2, rampMax = 140;
  bool keyOn = false; int keyEvery = 2, keyBy = 7;
};
// A chorus ended (the last section's final pass, or a pass of the loop): the frame the next one begins on, how many have gone, the tempo it steps to (0: unchanged), the key
// it steps by (semitones, 0: unchanged).
struct ChorusEvent { double frame = 0; int chorus = 0; double bpm = 0; int keyDelta = 0; };

// An ending (the page's ENDINGS: cold, finish, fade, tag, ritard). It is armed during the song and takes effect at the end of the pass, on the downbeat.
enum EndKind { kEndNone = 0, kEndCold, kEndFinish, kEndFade, kEndTag, kEndRitard };
struct EndingCfg {
  double barBeats = 4;         // meterBeatCount(): the beats of a bar
  double beatMul = 1;          // a beat's length against 60/bpm in the meter (_endBeatAt: 4/unit, 1.5 in compound time)
  double lookaheadSec = 0.15;  // how far ahead of a bar line the page hears of it (a ritardando lands on the first line announced after its curve is done)
  int armed = 0;               // an ending already armed when the song starts
};
// What the band lands on (the page's _endingLand): the drum lanes of the kit's kick, biggest cymbal and snare (-1: the kit has none), the tonic chord's root (the key
// without the live key change, MIDI) and tones, and the octave the bass's last note is in.
struct EndLanding {
  bool on = false;
  int kickLane = -1, cymLane = -1, snareLane = -1;
  int root = 60;
  std::vector<int> ivs;
  int bassOct = 2;
};
// What an ending asks of the host, in the order it happens.
//  Land: the band lands on the tonic together at `frame` (everything committed is faded out there, the hit and the chord and the bass note begin) and the song is over.
//  FadeStart: the master comes down in decibels over `durFrames` in `steps` equal steps from `frame`, the chart playing on; FadeEnd stops everything.
//  Ritard: the tempo steps through `steps` (frame, bpm) pairs, the chart playing on; the Land follows on a bar line.
struct EndingEvent {
  enum Type { Land, FadeStart, FadeEnd, Ritard } type = Land;
  double frame = 0;
  int kind = 0;                // the ending that was armed
  bool sustain = true, snare = false, soft = false;      // Land: the chord rings (else it is choked after the hold), the snare joins the hit, the hit is soft
  double holdSec = 0;          // Land: how long the landing holds before it is released (or choked)
  double durFrames = 0; int fadeSteps = 0;               // FadeStart
  double fromBpm = 0;          // Ritard: the tempo it began from (put back at the end)
  std::vector<std::pair<double, double>> tempoSteps;     // Ritard: (frame, bpm)
};

struct SongScore {
  int barSteps = 16;           // sixteenths in a bar (meterStepsPerBar)
  bool swingOn = false;        // Chart 8ths are swung
  double swing = 0;            // the Feel swing, percent, which sets how long a swung eighth is
  bool clocked = true;         // snap is on: a chord of whole bars counts the drums' bar lines
  int capo = 0;                // the live key change, semitones
  std::vector<PhraseLock> locks;
  std::vector<MelLock> melLocks;   // the melody generator's locks, which the slots name by melLock
  std::vector<SongSection> sections;
  SongTrainer trainer;
  EndingCfg ending;
  EndLanding landing;
  SongVoiceCfg voice;

  // [5, barSteps, swingOn, swing, clocked, capo, <lock table: readLocks>, nSections,
  //  per section: plays, follow, nSlots, per slot: bars, beats, eighths, rest, rootM, bassM, lock, voicing, hold, ring, pat, nIvs, ivs...,
  //  then the trainer: loopOn, loopSection, a, b, rampOn, step, every, max, keyOn, every, by; then the ending: barBeats, beatMul, lookaheadSec, armed; the landing: on, kick, cymbal, snare lanes, root, bass octave, nIvs, ivs...; then the voice: on, and when on: kit, play, pedal, style, vary, autoInv, keyRoot, nSteps, steps..., decRaw, chordBeats, strum, spread, width, sub, velBase, feelSwing, swing8,
  //  nPatterns, per pattern: drawn, steps, swing, nEv, (p, v, len) x nEv ; and optionally, after a -7: per slot of every section in order its melody lock index, then the melody lock table: readMelLocks]
  bool fromDoubles(const double *d, size_t n, size_t *used = nullptr);

  // slotTotalMs, in beats: the chord's own length, or one bar when it says none.
  double slotBeats(const SongSlot &s) const {
    const double eighth = swingOn ? 0.5 + (swing / 70.0) * 0.167 : 0.5;
    const double total = s.bars * (barSteps / 4.0) + s.beats + s.eighths * eighth;
    return total > 0 ? total : barSteps / 4.0;
  }
  bool playable(size_t i) const { return i < sections.size() && !sections[i].slots.empty(); }
};

// What the page hands the bass for each chord, and where it is.
struct SongChord {
  ChordWindow w;
  int section = 0, slot = 0, pass = 0;
  SongSlot s;                  // the chord as written (the key it was written in), and
  int capo = 0;                // the live key change to add to it
};

class SongSequencer {
 public:
  explicit SongSequencer(double sampleRate = 48000.0) : sr_(sampleRate), own_(sampleRate) {}
  void setScore(const SongScore &s) { score_ = s; }
  // A live chart edit is a new phrase on the next bar. At a natural chord
  // boundary, advance the OLD chart first so edits do not repeat its last slot
  // or swallow a queued move/ending. The trainer and pass count keep running.
  // Result: 0 preserves an ending already landed; 2 asks the host to stop
  // the chord because the edited chart became empty. Only 1 re-voices it.
  template<class Chorus,class Ending>
  int reviseAt(const SongScore &s,double frame,Chorus &&chorus,Ending &&ending) {
    if(running_ && began_ && haveNext_ && next_<=frame+1e-6) {
      advance();
      if(chorusEv_) {chorusEv_=false;chorus(lastChorus_);}
      for(const auto &ev:endQ_) ending(ev); endQ_.clear();
    }
    score_=s;
    if(!running_) return 0;
    if(!score_.playable((size_t)section_)) {
      section_=0; while(section_<(int)score_.sections.size() && !score_.playable((size_t)section_)) section_++;
      slot_=0;pass_=0;
    }
    if(section_>=(int)score_.sections.size()) {stop();return 2;}
    if(slot_>=(int)score_.sections[(size_t)section_].slots.size()) slot_=0;
    curStart_=frame;began_=false;haveNext_=false;counter_=0;
    while(!marks_.empty() && marks_.front()<=frame+1e-6) marks_.pop_front();
    return 1;
  }
  const SongScore &score() const { return score_; }
  void setTempoMap(const TempoMap *m) { tmap_ = m; }
  void setCapo(int c) { score_.capo = c; }
  int capoNow() const { return score_.capo + keyShift_; }       // the player's key change and the trainer's
  // _moveToSection's queue (songPendingSectionDelta): applied at the end of the pass.
  void queueMove(int delta) { pending_ = delta; }
  int queuedMove() const { return pending_; }

  // Chord `slot` of `section` starts at `firstFrame`; `pass` is how many passes of the section have gone (songSectionPass).
  bool start(double firstFrame, int section, int slot, int pass = 0) {
    if (!score_.playable((size_t)std::max(section, 0))) return false;
    section_ = section; slot_ = slot; pass_ = pass; pending_ = 0;
    curStart_ = firstFrame; began_ = false; haveNext_ = false; marks_.clear();
    armed_ = score_.ending.armed; queued_ = 0; endingRunning_ = false; landPending_ = false; fadeEnd_ = 0; endQ_.clear();
    chorus_ = 0; keysDone_ = 0; keyShift_ = 0; lastSetBpm_ = 0; startBpm_ = tmap_ ? tmap_->bpmAt(firstFrame) : 120.0;
    running_ = true;
    return true;
  }
  void stop() { running_ = false; marks_.clear(); }
  bool running() const { return running_; }
  int chorus() const { return chorus_; }
  // The ending armed for the end of this pass (0: none): the page's songEnding. A queued one (a tag's finish) is the sequencer's own.
  void arm(int kind) { armed_ = kind; }
  int armedEnding() const { return armed_ ? armed_ : queued_; }
  bool endingRunning() const { return endingRunning_ || landPending_; }
  int keyShift() const { return keyShift_; }
  // _pracRestore, at a stop: the tempo goes back to where the run began, but only if it is still the one the trainer set (a tempo the player moved is theirs); the key
  // goes back (the shift is dropped). Returns the tempo to put back, or 0.
  double restore(double bpmNow) {
    const double back = (lastSetBpm_ > 0 && std::round(bpmNow) == lastSetBpm_ && startBpm_ > 0) ? startBpm_ : 0;
    lastSetBpm_ = 0; chorus_ = 0; keysDone_ = 0; keyShift_ = 0;
    return back;
  }
  int section() const { return section_; }
  int slot() const { return slot_; }
  int pass() const { return pass_; }
  double nextStart() const { return curStart_; }

  // The drums announced a bar line at `frame` (a BarMark's frameExact). Kept until the chord that counts it is the current one.
  void noteBar(double frame) { if (running_) marks_.push_back(frame); }

  // Where the song will be one chord from now, without moving it (what the window's next root is made from), for the chord run() is handing out:
  // the page writes the bass's line for that chord while this one sounds.
  void nextPlace(int &sec, int &slot) const { peekPlace(sec, slot); }

  // Fire every chord that starts before `horizon`, in order, handing each to emit(const SongChord&). `drums`: the drums are playing, so there is a
  // bar clock to count. Returns the number of chords started.
  template <class Emit>
  int run(double horizon, bool drums, Emit &&emit) { return run(horizon, drums, emit, [](const ChorusEvent &) {}, [](const EndingEvent &) {}); }
  template <class Emit, class Chorus>
  int run(double horizon, bool drums, Emit &&emit, Chorus &&chorus) { return run(horizon, drums, emit, chorus, [](const EndingEvent &) {}); }
  // As above; `chorus` is called (with the new chorus's first bar line) when a chorus has ended, before that chorus's first chord is handed out, so the
  // caller can step the tempo in time for the chord's length.
  template <class Emit, class Chorus, class Ending>
  int run(double horizon, bool drums, Emit &&emit, Chorus &&chorus, Ending &&ending) {
    int fired = 0, guard = 0;
    while (running_ && guard++ < 4096) {
      // An ending's own moments come between the chords: the fade's end, and a ritardando's landing on the first bar line announced after its curve.
      {
        const double boundary = began_ ? (haveNext_ ? next_ : INFINITY) : curStart_;
        if (landPending_) {
          for (double m : marks_) if (m >= landAfter_ - 1e-6) {
            if (m <= boundary + 1e-6) { landPending_ = false; endingRunning_ = false; running_ = false; ending(land(m, kEndRitard)); }
            break;
          }
          if (!running_) break;
        }
        if (fadeEnd_ > 0 && fadeEnd_ < horizon && fadeEnd_ <= boundary) {
          EndingEvent ev; ev.type = EndingEvent::FadeEnd; ev.frame = fadeEnd_; ev.kind = kEndFade;
          fadeEnd_ = 0; endingRunning_ = false; running_ = false; ending(ev);
          break;
        }
      }
      const SongSection *sec = score_.playable((size_t)section_) ? &score_.sections[(size_t)section_] : nullptr;
      if (!sec) { running_ = false; break; }
      if (slot_ >= (int)sec->slots.size()) slot_ = 0;
      const SongSlot &sl = sec->slots[(size_t)slot_];
      if (!began_) {
        if (curStart_ >= horizon) break;
        SongChord c = window(sl);
        emit(c);
        fired++;
        began_ = true; counter_ = 0; haveNext_ = false;
        // Chosen now, as the page does at _playLoopSlot: by time for a chord of beats or eighths (or none of either bar), or with no clock to count.
        timed_ = !score_.clocked || !drums || sl.beats > 0 || sl.eighths > 0 || sl.bars == 0;
        needBars_ = std::max(1, sl.bars);
      }
      if (!haveNext_) {
        if (timed_) {
          next_ = advanceBeats(curStart_, score_.slotBeats(sl));
          haveNext_ = true;
        } else {
          // _tickSongLoop: the lines after this chord began, counted; the one that makes the count is the next chord's start.
          while (!marks_.empty()) {
            const double m = marks_.front(); marks_.pop_front();
            if (m <= curStart_ + 1e-6) continue;       // the line that began it (or an older one): not a bar of its own
            if (++counter_ >= needBars_) { next_ = m; haveNext_ = true; break; }
          }
        }
      }
      if (!haveNext_ || next_ >= horizon) break;
      advance();
      if (chorusEv_) { chorusEv_ = false; chorus(lastChorus_); }
      for (const EndingEvent &ev : endQ_) ending(ev);
      endQ_.clear();
      if (!running_) break;
      // The lines that fell inside a chord that ran by time belong to no one's count.
      while (!marks_.empty() && marks_.front() <= next_ + 1e-6) marks_.pop_front();
      curStart_ = next_; began_ = false; haveNext_ = false;
    }
    return fired;
  }

 private:
  double advanceBeats(double frame, double beats) const { return (tmap_ ? tmap_ : &own_)->advance(frame, beats); }

  // _blOnChord's window for the chord that starts now, with _songPeekNextSlot's next chord.
  SongChord window(const SongSlot &sl) const {
    SongChord c;
    ChordWindow &w = c.w;
    w.t = curStart_;
    w.end = advanceBeats(curStart_, score_.slotBeats(sl));
    w.rest = sl.rest;
    w.rootPc = mod12(sl.rootM + capoNow());
    w.bassPc = sl.bassM >= 0 ? mod12(sl.bassM + capoNow()) : -1;
    if (sl.ivs.empty()) { w.pcs = {w.rootPc, mod12(w.rootPc + 4), mod12(w.rootPc + 7)}; }
    else for (int d : sl.ivs) w.pcs.push_back(mod12(sl.rootM + capoNow() + d));
    const SongSlot *nx = peekNext();
    if (nx && !nx->rest) w.nextPc = nx->bassM >= 0 ? mod12(nx->bassM + capoNow()) : mod12(nx->rootM + capoNow());
    w.lock = sl.rest ? -1 : sl.lock;
    w.melLock = sl.rest ? -1 : sl.melLock;
    c.section = section_; c.slot = slot_; c.pass = pass_;
    c.s = sl; c.capo = capoNow();
    return c;
  }

  // _songPeekNextSlot: where the song will be one chord from now, without moving it. A queued move outranks the section's own follow flag; the
  // flag, not the pass count, is what the page's peek reads.
  const SongSlot *peekNext() const {
    int sec, slot;
    peekPlace(sec, slot);
    return &score_.sections[(size_t)sec].slots[(size_t)slot];
  }
  // The place itself.
  void peekPlace(int &outSec, int &outSlot) const {
    const SongSection &sec = score_.sections[(size_t)section_];
    if (slot_ + 1 < (int)sec.slots.size()) { outSec = section_; outSlot = slot_ + 1; return; }
    int playable = 0; for (size_t i = 0; i < score_.sections.size(); i++) if (score_.playable(i)) playable++;
    int idx = section_;
    if (pending_ != 0) idx = stepTo(idx, pending_);
    else if (sec.follow && playable > 1) idx = stepTo(idx, 1);
    if (!score_.sections[(size_t)idx].slots.empty()) { outSec = idx; outSlot = 0; } else { outSec = section_; outSlot = 0; }
  }
  int stepTo(int idx, int delta) const {
    const int n = (int)score_.sections.size();
    int i = ((idx + delta) % n + n) % n, guard = 0;
    while (!score_.playable((size_t)i) && guard < n) { i = ((i + delta) % n + n) % n; guard++; }
    return i;
  }

  // _advanceLoopSlot (the endings are not here): the next chord; past the last chord of a practice loop back to its first (a pass of the loop is a chorus); at the
  // end of a pass a queued move, or the pass counted and the section left when it has had its plays, and a chorus when that was the last section's final pass.
  void advance() {
    const SongSection &sec = score_.sections[(size_t)section_];
    const SongTrainer &tr = score_.trainer;
    slot_++;
    if (tr.loopOn && section_ == tr.loopSection && loopValid() && slot_ > tr.loopB && pending_ == 0 && !armed_ && !queued_ && !endingRunning_ && !landPending_) { slot_ = tr.loopA; chorusDone(); return; }
    if (slot_ < (int)sec.slots.size()) return;
    slot_ = 0;
    // An armed ending lands here, on the downbeat, rather than wherever the player hit stop. Most take the song over and it ends; a fade, a tag and a ritardando keep
    // the chart going and own which part of it plays ('hold': the section again from `slot_`, the pass not counted).
    if (armed_ || queued_) {
      const int kind = armed_ ? armed_ : queued_;
      armed_ = 0; queued_ = 0;
      if (runEnding(kind)) return;
      running_ = false;
      return;
    }
    if (endingRunning_ || landPending_) return;      // the chart goes round; no pass is counted and nothing moves while it fades or slows
    if (pending_ != 0) { moveToSection(pending_); pending_ = 0; return; }
    int playable = 0, last = -1;
    for (size_t i = 0; i < score_.sections.size(); i++) if (score_.playable(i)) { playable++; last = (int)i; }
    const bool wasLast = section_ == last;
    pass_++;
    const bool leaving = sec.plays > 0 && pass_ >= sec.plays && playable > 1;
    if (leaving) moveToSection(1);
    // The last section's final pass is the end of the chorus. A last section on "for ever" or a one-section chart never leaves, so each of its passes counts.
    if (wasLast && (leaving || sec.plays == 0 || playable == 1)) chorusDone();
  }
  double beatSecAt(double frame) const { return 60.0 / std::max(1.0, bpmAtFrame(frame)) * score_.ending.beatMul; }
  double bpmAtFrame(double frame) const { return (tmap_ ? tmap_ : &own_)->bpmAt(frame); }
  EndingEvent land(double frame, int kind) const {
    EndingEvent ev; ev.type = EndingEvent::Land; ev.frame = frame; ev.kind = kind;
    const double beat = beatSecAt(frame);
    if (kind == kEndCold) { ev.sustain = false; ev.snare = true; ev.holdSec = beat * 0.5; }
    else if (kind == kEndFinish) { ev.sustain = true; ev.snare = true; ev.holdSec = beat * score_.ending.barBeats; }
    else { ev.sustain = true; ev.soft = true; ev.holdSec = beat * 2.0; }     // a ritardando's landing: a soft hit, held two beats
    return ev;
  }
  // _runEnding, at the pass boundary next_. True when the chart goes on (the caller replays the section from slot_), false when the song is over.
  bool runEnding(int kind) {
    const double L = next_;
    const double sr = sr_;
    if (kind == kEndCold || kind == kEndFinish) { endQ_.push_back(land(L, kind)); return false; }
    if (kind == kEndFade) {
      endingRunning_ = true;
      EndingEvent ev; ev.type = EndingEvent::FadeStart; ev.frame = L; ev.kind = kind;
      ev.durFrames = beatSecAt(L) * score_.ending.barBeats * 4.0 * sr; ev.fadeSteps = 56;     // four bars, in 56 steps
      fadeEnd_ = L + ev.durFrames + 0.14 * sr;
      endQ_.push_back(ev);
      return true;
    }
    if (kind == kEndTag) {
      const SongSection &sec = score_.sections[(size_t)section_];
      const int n = (int)sec.slots.size();
      if (n >= 2) { slot_ = std::max(0, n - 2); queued_ = kEndFinish; endingRunning_ = false; return true; }
      endingRunning_ = false;
      return runEnding(kEndFinish);
    }
    if (kind == kEndRitard) {
      endingRunning_ = true;
      const double from = bpmAtFrame(L), w = 0.55;
      const int N = std::max(4, (int)std::lround(2.0 * score_.ending.barBeats * 2.0) - 2);
      EndingEvent ev; ev.type = EndingEvent::Ritard; ev.frame = L; ev.kind = kind; ev.fromBpm = from;
      // the page walks the curve a step every half beat of the tempo it has just set: the square of the tempo falls in a straight line over the steps
      double t = L + 0.5 * 60.0 / std::max(1.0, from) * score_.ending.beatMul * sr;
      for (int i = 1; i <= N; i++) {
        const double bpm = from * std::sqrt(1.0 + (w * w - 1.0) * std::min(1.0, (double)i / N));
        ev.tempoSteps.push_back({t, std::max(40.0, std::min(220.0, std::round(bpm)))});
        if (i < N) t += 0.5 * 60.0 / std::max(1.0, bpm) * score_.ending.beatMul * sr;
      }
      landPending_ = true; landAfter_ = t + score_.ending.lookaheadSec * sr;     // the first bar line announced after the curve is done
      endQ_.push_back(ev);
      return true;
    }
    return false;
  }
  // pracLoopValid: the bars to loop exist.
  bool loopValid() const {
    const SongTrainer &tr = score_.trainer;
    return tr.loopSection >= 0 && (size_t)tr.loopSection < score_.sections.size() && tr.loopA >= 0 && tr.loopA <= tr.loopB &&
           (size_t)tr.loopB < score_.sections[(size_t)tr.loopSection].slots.size();
  }
  // _pracChorusDone: a chorus is over; step what is on (the tempo up by a step to its ceiling every few choruses, the key by an interval, twelve keys in all).
  void chorusDone() {
    const SongTrainer &tr = score_.trainer;
    ChorusEvent ev; ev.frame = next_; ev.chorus = ++chorus_;
    const int n = chorus_;
    if (tr.rampOn && n % std::max(1, tr.rampEvery) == 0) {
      const double cur = (tmap_ ? tmap_ : &own_)->bpmAt(next_), nxt = std::min((double)tr.rampMax, cur + tr.rampStep);
      if (nxt > cur) { ev.bpm = std::max(40.0, std::min(220.0, std::round(nxt))); lastSetBpm_ = ev.bpm; }
    }
    if (tr.keyOn && n % std::max(1, tr.keyEvery) == 0 && keysDone_ < 11) {
      keysDone_++;
      int k = (keysDone_ * tr.keyBy) % 12;
      if (k > 6) k -= 12;
      ev.keyDelta = k - keyShift_;
      keyShift_ = k;
    }
    lastChorus_ = ev; chorusEv_ = true;
  }
  void moveToSection(int delta) {
    section_ = stepTo(section_, delta);
    pass_ = 0;
  }

  static int mod12(int x) { return ((x % 12) + 12) % 12; }

  SongScore score_;
  double sr_;
  TempoMap own_;                 // a constant 120 when the host gives none (tests)
  const TempoMap *tmap_ = nullptr;
  bool running_ = false;
  int section_ = 0, slot_ = 0, pass_ = 0, pending_ = 0;
  double curStart_ = 0;          // where the current chord starts (or will, if it is not begun)
  bool began_ = false;           // its window has been emitted
  bool timed_ = true;
  int counter_ = 0, needBars_ = 1;
  bool haveNext_ = false;
  double next_ = 0;
  std::deque<double> marks_;
  int chorus_ = 0, keysDone_ = 0, keyShift_ = 0;       // the trainer's run: choruses gone, keys stepped to, the distance from the start key
  double lastSetBpm_ = 0, startBpm_ = 120;           // the tempo it last set, and the one the run began at
  bool chorusEv_ = false;
  ChorusEvent lastChorus_;
  int armed_ = 0, queued_ = 0;                       // the ending armed for the end of the pass, and one queued for the pass after (a tag's finish)
  bool endingRunning_ = false, landPending_ = false;  // a fade or a ritardando is playing the chart; a ritardando's landing is waiting for a bar line
  double landAfter_ = 0, fadeEnd_ = 0;
  std::vector<EndingEvent> endQ_;
};

}  // namespace modsynth
