// The chord of a slot (docs/native-scheduling.md, slice 4, piece 3): what the page does when the song loop starts a chord, as plain C++. It is a port of
// index.html's _playChartSlot2 and playChord: a rest stops the chord that sounds (stopAll); any other chord is shifted by the live capo, voice-led
// (smartVoiceLead, with a slash chord's bass as the floor), voiced the way the player chose (chordVoicing: Close, Spread, Drop 2 and 3, Soul, Neo-soul, and
// Vary's lap through them), turned into notes with the slash bass under them (chordEngineEvent), and struck by the chord player (chordplay.h) once.
//
// How long it sounds. The comp "sustain" holds the chord flat for the whole slot (no decay of its own; the next chord's stop ends it); "as played" with
// a ring holds it and lets go of it that many beats after it began (_releaseChordAt, on the Release knob), without one holds it into the next chord; every other
// comp style strikes the chord and lets it decay by the Decay knob (cut by the Length buttons, and to 0.7 s with Strum on and no length), and the rhythm's own
// hits re-strike it (piece 4, below: SongVoicer::flush). With the Wet/dry at the top the chord is a held pedal under the arp: the slash note is the bass (or the
// root) an octave down, and the chord is not stopped first.
//
// The beat is the tempo map's at the chord's moment: the page reads the tempo field when it plays the chord, which at a constant tempo is the same.
//
// Not in it: the arp's chord (slice 3), the glide, the Pure tuning cents, the sampled voices (the page's score refuses them), a chord struck by hand, the page's
// habit of playing a hit of the chord before after the next chord's first strike when its timers fire out of order.
//
// Control-side (the sequencer thread).
#pragma once
#include <climits>

#include "chordplay.h"
#include "songcore.h"
#include "tempomap.h"
#include "voicing.h"

namespace modsynth {

struct VoiceAction {
  bool stop = false;           // stop the chord that sounds, at `onset`
  bool play = false;           // strike `e` (which stops the chord before)
  double onset = 0;            // frames
  ChordEvent e;
};

class SongVoicer {
 public:
  explicit SongVoicer(double sampleRate = 48000.0) : sr_(sampleRate) {}
  void setSampleRate(double sr) { sr_ = sr; }
  // A new run of the song leads its voices from nothing, as the page does after a key change.
  void reset() { lead_.reset(); hits_.clear(); }

  // The chord that starts now (_playChartSlot2): the action for its first strike, and its comp's re-strikes planned (_scheduleCompHits) for flush().
  VoiceAction chord(const SongChord &c, const SongScore &sc, const TempoMap &tm) {
    const SongVoiceCfg &cfg = sc.voice;
    VoiceAction a;
    a.onset = c.w.t;
    const SongSlot &s = c.s;
    hits_.clear();                                           // _clearCompTimers: the chord before has no more hits to play
    if (s.rest) { a.stop = true; return a; }                 // stopAll(atTime): the drums and bass go on
    slot_ = s;
    lead_.fresh();                                           // every slot is a new chord for Vary
    const int playRoot = s.rootM + c.capo;
    const int playBass = s.bassM >= 0 ? s.bassM + c.capo : INT_MIN;
    const std::vector<int> voiced = voiceLead(playRoot, playBass, cfg);

    int slash; bool hold; double holdSec = -1;
    if (!cfg.pedal) {
      slash = playBass != INT_MIN ? playBass - 12 : INT_MIN;
      hold = s.hold;
      if (hold && s.ring > 0) holdSec = s.ring * (60.0 / tm.bpmAt(a.onset));
    } else {
      slash = (playBass != INT_MIN ? playBass : playRoot) - 12;
      hold = true;
    }
    strike(a, playRoot, voiced, slash, hold, holdSec, 1.0, c.capo, cfg, tm);
    plan(c, sc, tm);
    return a;
  }

  // The chord an ending lands on (_endingLandChord): the key's tonic triad on its root with the root an octave under it, struck at `frame`, ringing for `holdSec` and then
  // let go of (sustain), or struck to decay and choked by the caller at the end of the hold (a stab). Voiced as the player chose but not voice-led (playSlashChord).
  VoiceAction landing(double frame, bool sustain, double holdSec, const SongScore &sc, int capo, const TempoMap &tm) {
    const SongVoiceCfg &cfg = sc.voice;
    VoiceAction a; a.onset = frame;
    const int root = sc.landing.root + capo;
    VoicingConfig vc = cfg.vc;
    vc.keyRoot = ((cfg.vc.keyRoot + capo) % 12 + 12) % 12;
    slot_ = SongSlot();
    const std::vector<int> ivs = lead_.chordVoicing(root, sc.landing.ivs, cfg.vc.style, vc);
    if (!cfg.play) { a.stop = true; return a; }
    const VoicedChord vch = engineChord(root, ivs, root - 12);
    ChordEvent &e = a.e;
    if (vch.bass >= 0) e.notes.push_back(vch.bass);
    for (int n : vch.notes) e.notes.push_back(n);
    e.rootNote = vch.root;
    e.subNote = vch.bass >= 0 ? vch.bass : vch.root;
    e.vel = std::max(0.0, std::min(1.0, cfg.velBase));
    e.onsetExact = frame;
    e.settings.strum = cfg.strum; e.settings.spread = cfg.spread; e.settings.width = cfg.width; e.settings.sub = cfg.sub;
    e.hold = sustain; e.holdSec = sustain ? holdSec : -1;
    if (!sustain) {
      double dec = cfg.chordBeats > 0 ? std::min(cfg.decRaw, cfg.chordBeats * (60.0 / tm.bpmAt(frame))) : cfg.decRaw;
      if (cfg.strum && !(cfg.chordBeats > 0)) dec = std::min(dec, 0.7);
      e.durSec = dec;
    }
    a.play = true;
    return a;
  }

  // The re-strikes of the chord that began (the page's _drainCompPending): every hit due before `horizon`, in order, each to emit(VoiceAction). `capo` is the
  // live key change, read when the hit is played, as the page reads it.
  template <class Emit>
  void flush(double horizon, const SongScore &sc, int capo, const TempoMap &tm, Emit &&emit) {
    const SongVoiceCfg &cfg = sc.voice;
    size_t i = 0;
    for (; i < hits_.size() && hits_[i].t < horizon; i++) emit(hit(hits_[i], cfg, capo, tm));
    hits_.erase(hits_.begin(), hits_.begin() + (long)i);
  }
  void clearHits() { hits_.clear(); }       // a hold: the chord stays, its rhythm does not go on (holdSongLoop clears the comp timers)
  size_t pending() const { return hits_.size(); }
  double nextHit() const { return hits_.empty() ? INFINITY : hits_.front().t; }

 private:
  struct Hit { double t, vel, holdSec; };      // holdSec 0: it rings and decays

  std::vector<int> voiceLead(int playRoot, int playBass, const SongVoiceCfg &cfg) {
    return cfg.vc.autoInv ? lead_.smartVoiceLead(playRoot, slot_.ivs, playBass != INT_MIN ? playBass - 12 : INT_MIN) : slot_.ivs;
  }

  // playChord for the voiced chord: the voicing the slot is under, the notes, the level, held (never let go of when holdSec < 0) or decaying. The voicing is
  // settled whether or not the chord will sound, so the next one is led from this one either way.
  void strike(VoiceAction &a, int playRoot, const std::vector<int> &voiced, int slash, bool hold, double holdSec, double velMul, int capo,
              const SongVoiceCfg &cfg, const TempoMap &tm) {
    VoicingConfig vc = cfg.vc;
    vc.keyRoot = ((cfg.vc.keyRoot + capo) % 12 + 12) % 12;      // the page's `root` moves with the key change
    const int style = slot_.voicing >= 0 ? slot_.voicing : cfg.vc.style;
    const std::vector<int> ivs = lead_.chordVoicing(playRoot, voiced, style, vc);
    if (!cfg.play) { a.stop = true; return; }
    const VoicedChord vch = engineChord(playRoot, ivs, slash);
    ChordEvent &e = a.e;
    if (vch.bass >= 0) e.notes.push_back(vch.bass);
    for (int n : vch.notes) e.notes.push_back(n);
    e.rootNote = vch.root;
    e.subNote = vch.bass >= 0 ? vch.bass : vch.root;
    e.vel = std::max(0.0, std::min(1.0, cfg.velBase * velMul));
    e.onsetExact = a.onset;
    e.settings.strum = cfg.strum; e.settings.spread = cfg.spread; e.settings.width = cfg.width; e.settings.sub = cfg.sub;
    e.hold = hold; e.holdSec = holdSec;
    if (!hold) {
      double dec = cfg.chordBeats > 0 ? std::min(cfg.decRaw, cfg.chordBeats * (60.0 / tm.bpmAt(a.onset))) : cfg.decRaw;
      if (cfg.strum && !(cfg.chordBeats > 0)) dec = std::min(dec, 0.7);
      e.durSec = dec;
    }
    a.play = true;
  }

  // _compRestrike1: one re-strike. The chord is voice-led again from where it is (the same voicing, since its own is the nearest), struck at the hit's level,
  // gated or ringing; with Wet/dry at the top only a slash chord's bass pedal is struck again.
  VoiceAction hit(const Hit &h, const SongVoiceCfg &cfg, int capo, const TempoMap &tm) {
    VoiceAction a; a.onset = h.t;
    const SongSlot &s = slot_;
    const int playRoot = s.rootM + capo;
    const int playBass = s.bassM >= 0 ? s.bassM + capo : INT_MIN;
    const std::vector<int> voiced = voiceLead(playRoot, playBass, cfg);
    if (!cfg.pedal) {
      const bool gated = h.holdSec > 0;
      strike(a, playRoot, voiced, playBass != INT_MIN ? playBass - 12 : INT_MIN, gated, gated ? h.holdSec : -1, h.vel, capo, cfg, tm);
    } else if (playBass != INT_MIN) {
      strike(a, playRoot, voiced, playBass - 12, true, -1, h.vel, capo, cfg, tm);
    }
    return a;
  }

  // _sqSwingOffset(step, stepSec, amt), in frames.
  static double swingOffset(int step, double sd, double amt, bool swing8) {
    const int unit = swing8 ? 4 : 2;
    if ((((step % unit) + unit) % unit) != unit / 2) return 0;
    return (amt / 100.0) * sd * ((double)unit / 4.0);
  }

  // _scheduleCompHits: the hits of the chord's rhythm after its first strike, up to the end of the slot (less 10 ms).
  void plan(const SongChord &c, const SongScore &sc, const TempoMap &tm) {
    const SongVoiceCfg &cfg = sc.voice;
    if (c.s.pat < 0 || c.s.pat >= (int)cfg.patterns.size()) return;
    const CompPattern &p = cfg.patterns[(size_t)c.s.pat];
    const double base = c.w.t, cut = c.w.end - 0.01 * sr_;
    if (!p.drawn) {
      // a built-in: positions in eighths of a bar, every bar of the slot, none past the end of a short bar
      const double barBeats = sc.barSteps / 4.0, slotBeats = sc.slotBeats(c.s), barEighths = sc.barSteps / 2.0;
      const int bars = (int)std::ceil(slotBeats / barBeats - 1e-6);
      for (int b = 0; b < bars; b++) for (const CompHitDef &e : p.ev) {
        if (b == 0 && e.p == 0) continue;                    // that is the first strike
        if (e.p >= barEighths) continue;
        const double t = tm.advance(base, b * barBeats + e.p * 0.5);
        if (t >= cut) continue;
        hits_.push_back({t, 1.0, 0});
      }
    } else {
      // a drawn rhythm: a loop of `steps` sixteenths from the start of the chord, with its swing, strengths and gates
      const double sd = tm.span(base, 0.25), loopBeats = p.steps * 0.25;
      const double amt = p.swing >= 0 ? p.swing : cfg.feelSwing;
      for (int r = 0; r < 4096; r++) {
        if (!(tm.advance(base, r * loopBeats) - base < (c.w.end - c.w.t) - 0.01 * sr_)) break;
        for (const CompHitDef &e : p.ev) {
          if (r == 0 && e.p == 0) continue;
          const double sOff = swingOffset((int)std::floor(e.p + 1e-9), sd, amt, cfg.swing8);
          const double t = tm.advance(base, r * loopBeats + e.p * 0.25) + sOff;
          if (t >= cut) continue;
          hits_.push_back({t, e.v, e.len > 0 ? e.len * sd / sr_ : 0});
        }
      }
    }
    std::stable_sort(hits_.begin(), hits_.end(), [](const Hit &x, const Hit &y) { return x.t < y.t; });
  }

  double sr_;
  VoiceLead lead_;
  SongSlot slot_;               // the chord the hits belong to
  std::vector<Hit> hits_;
};

}  // namespace modsynth
