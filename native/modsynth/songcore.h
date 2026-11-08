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

struct SongScore {
  int barSteps = 16;           // sixteenths in a bar (meterStepsPerBar)
  bool swingOn = false;        // Chart 8ths are swung
  double swing = 0;            // the Feel swing, percent, which sets how long a swung eighth is
  bool clocked = true;         // snap is on: a chord of whole bars counts the drums' bar lines
  int capo = 0;                // the live key change, semitones
  std::vector<PhraseLock> locks;
  std::vector<SongSection> sections;
  SongVoiceCfg voice;

  // [3, barSteps, swingOn, swing, clocked, capo, <lock table: readLocks>, nSections,
  //  per section: plays, follow, nSlots, per slot: bars, beats, eighths, rest, rootM, bassM, lock, voicing, hold, ring, pat, nIvs, ivs...,
  //  then the voice: on, and when on: kit, play, pedal, style, vary, autoInv, keyRoot, nSteps, steps..., decRaw, chordBeats, strum, spread, width, sub, velBase, feelSwing, swing8,
  //  nPatterns, per pattern: drawn, steps, swing, nEv, (p, v, len) x nEv]
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
  const SongScore &score() const { return score_; }
  void setTempoMap(const TempoMap *m) { tmap_ = m; }
  void setCapo(int c) { score_.capo = c; }
  // _moveToSection's queue (songPendingSectionDelta): applied at the end of the pass.
  void queueMove(int delta) { pending_ = delta; }
  int queuedMove() const { return pending_; }

  // Chord `slot` of `section` starts at `firstFrame`; `pass` is how many passes of the section have gone (songSectionPass).
  bool start(double firstFrame, int section, int slot, int pass = 0) {
    if (!score_.playable((size_t)std::max(section, 0))) return false;
    section_ = section; slot_ = slot; pass_ = pass; pending_ = 0;
    curStart_ = firstFrame; began_ = false; haveNext_ = false; marks_.clear();
    running_ = true;
    return true;
  }
  void stop() { running_ = false; marks_.clear(); }
  bool running() const { return running_; }
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
  int run(double horizon, bool drums, Emit &&emit) {
    int fired = 0, guard = 0;
    while (running_ && guard++ < 4096) {
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
    w.rootPc = mod12(sl.rootM + score_.capo);
    w.bassPc = sl.bassM >= 0 ? mod12(sl.bassM + score_.capo) : -1;
    if (sl.ivs.empty()) { w.pcs = {w.rootPc, mod12(w.rootPc + 4), mod12(w.rootPc + 7)}; }
    else for (int d : sl.ivs) w.pcs.push_back(mod12(sl.rootM + score_.capo + d));
    const SongSlot *nx = peekNext();
    if (nx && !nx->rest) w.nextPc = nx->bassM >= 0 ? mod12(nx->bassM + score_.capo) : mod12(nx->rootM + score_.capo);
    w.lock = sl.rest ? -1 : sl.lock;
    c.section = section_; c.slot = slot_; c.pass = pass_;
    c.s = sl; c.capo = score_.capo;
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

  // _advanceLoopSlot (the loop of a practice section and the endings are not here): the next chord; at the end of a pass a queued move, or the
  // pass counted and the section left when it has had its plays.
  void advance() {
    const SongSection &sec = score_.sections[(size_t)section_];
    slot_++;
    if (slot_ < (int)sec.slots.size()) return;
    slot_ = 0;
    if (pending_ != 0) { moveToSection(pending_); pending_ = 0; return; }
    int playable = 0; for (size_t i = 0; i < score_.sections.size(); i++) if (score_.playable(i)) playable++;
    pass_++;
    const bool leaving = sec.plays > 0 && pass_ >= sec.plays && playable > 1;
    if (leaving) moveToSection(1);
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
};

}  // namespace modsynth
