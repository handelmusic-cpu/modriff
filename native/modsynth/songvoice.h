// The chord of a slot (docs/native-scheduling.md, slice 4, piece 3): what the page does when the song loop starts a chord, as plain C++. It is a port of
// index.html's _playChartSlot2 and playChord: a rest stops the chord that sounds (stopAll); any other chord is shifted by the live capo, voice-led
// (smartVoiceLead, with a slash chord's bass as the floor), voiced the way the player chose (chordVoicing: Close, Spread, Drop 2 and 3, Soul, Neo-soul, and
// Vary's lap through them), turned into notes with the slash bass under them (chordEngineEvent), and struck by the chord player (chordplay.h) once.
//
// How long it sounds. The comp "sustain" holds the chord flat for the whole slot (no decay of its own; the next chord's stop ends it); "as played" with
// a ring holds it and lets go of it that many beats after it began (_releaseChordAt, on the Release knob), without one holds it into the next chord; every other
// comp style strikes the chord and lets it decay by the Decay knob (cut by the Length buttons, and to 0.7 s with Strum on and no length), and the rhythm's own
// hits re-strike it -- those are piece 4 and not here. With the Wet/dry at the top the chord is a held pedal under the arp: the slash note is the bass (or the
// root) an octave down, and the chord is not stopped first.
//
// The beat is the tempo map's at the chord's moment: the page reads the tempo field when it plays the chord, which at a constant tempo is the same.
//
// Not in it: the arp's chord (slice 3), the glide, the Pure tuning cents, the sampled voices (the page's score refuses them), a chord struck by hand.
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
  // A new run of the song leads its voices from nothing, as the page does after a key change.
  void reset() { lead_.reset(); }

  VoiceAction chord(const SongChord &c, const SongVoiceCfg &cfg, const TempoMap &tm) {
    VoiceAction a;
    a.onset = c.w.t;
    const SongSlot &s = c.s;
    if (s.rest) { a.stop = true; return a; }                 // stopAll(atTime): the drums and bass go on
    lead_.fresh();                                           // every slot is a new chord for Vary
    const int playRoot = s.rootM + c.capo;
    const int playBass = s.bassM >= 0 ? s.bassM + c.capo : INT_MIN;
    const std::vector<int> &intvs = s.ivs;
    const std::vector<int> voiced = cfg.vc.autoInv ? lead_.smartVoiceLead(playRoot, intvs, playBass != INT_MIN ? playBass - 12 : INT_MIN) : intvs;

    VoicingConfig vc = cfg.vc;
    vc.keyRoot = ((cfg.vc.keyRoot + c.capo) % 12 + 12) % 12;      // the page's `root` moves with the key change
    const int style = s.voicing >= 0 ? s.voicing : cfg.vc.style;

    int slash; bool hold; double holdSec = -1;
    if (!cfg.pedal) {
      slash = playBass != INT_MIN ? playBass - 12 : INT_MIN;
      hold = s.hold;
      if (hold && s.ring > 0) holdSec = s.ring * (60.0 / tm.bpmAt(a.onset));
    } else {
      slash = (playBass != INT_MIN ? playBass : playRoot) - 12;
      hold = true;
    }
    // playChord: the voicing is settled whether or not the chord will sound, so the next one is led from this one either way.
    const std::vector<int> ivs = lead_.chordVoicing(playRoot, voiced, style, vc);
    if (!cfg.play) { a.stop = true; return a; }
    const VoicedChord vch = engineChord(playRoot, ivs, slash);
    ChordEvent &e = a.e;
    if (vch.bass >= 0) e.notes.push_back(vch.bass);
    for (int n : vch.notes) e.notes.push_back(n);
    e.subNote = vch.bass >= 0 ? vch.bass : vch.root;
    e.vel = std::max(0.0, std::min(1.0, cfg.velBase));
    e.onsetExact = a.onset;
    e.settings.strum = cfg.strum; e.settings.spread = cfg.spread; e.settings.width = cfg.width; e.settings.sub = cfg.sub;
    e.hold = hold; e.holdSec = holdSec;
    if (!hold) {
      double dec = cfg.chordBeats > 0 ? std::min(cfg.decRaw, cfg.chordBeats * (60.0 / tm.bpmAt(a.onset))) : cfg.decRaw;
      if (cfg.strum && !(cfg.chordBeats > 0)) dec = std::min(dec, 0.7);
      e.durSec = dec;
    }
    a.play = true;
    return a;
  }

 private:
  VoiceLead lead_;
};

}  // namespace modsynth
