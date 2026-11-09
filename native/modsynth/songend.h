// What an ending's landing is made of (docs/native-scheduling.md, slice 4, piece 7b): the page's _endingLand as plain C++, so a Mac test can hold it to the page. The band lands
// on the key's tonic together on the downbeat: the kit's kick and biggest cymbal (a soft hit after a ritardando) and, for most endings, its snare; the tonic triad with its root an
// octave under it; the bass's last note on the tonic. After the hold the chord is let go of (a sustained one) or choked, and once it has died away everything is stopped.
//
// The host plays the plan (drum hits through the drum player, the chord through the chord player, the bass note through the bass player); the test prints it.
//
// Control-side (the sequencer thread).
#pragma once
#include <cmath>
#include <vector>

#include "basscore.h"
#include "seqcore.h"
#include "songcore.h"
#include "songvoice.h"

namespace modsynth {

struct LandingPlan {
  std::vector<DrumEvent> hits;       // the band hit, in the order the page plays it: kick, cymbal, snare
  VoiceAction chord;                 // the tonic chord (stop when Chords are off; nothing when the engine does not sound the chords)
  bool bass = false; BassEvent bassNote;
  double finishAt = 0;               // the frame everything is stopped on (the chord's stop, and the tempo an ending borrowed put back)
};

// `ds`: the drum score the kit's lanes (and their choke groups) come from; null in a test with none. `band`/`bassOn`: the drums / the bass were playing.
inline LandingPlan planLanding(const SongScore &sc, const EndingEvent &ev, SongVoicer &voicer, const TempoMap &tm, const DrumScore *ds, bool band, bool bassOn, double sr) {
  LandingPlan p;
  const double L = ev.frame;
  const EndLanding &lg = sc.landing;
  const int capo = sc.capo;                                // the landing is in the key the song was started in (the trainer's key is put back first)
  if (lg.on) {
    if (band && (!ds || ds->drumsEnabled)) {
      auto hit = [&](int lane, double vel) {
        if (lane < 0) return;
        DrumEvent e{};
        e.frameExact = L; e.frame = (int64_t)std::llround(L); e.part = 0; e.kit = ds ? ds->layers[0].kit : 0; e.lane = lane; e.vel = vel; e.accent = true; e.pitch = 0; e.dyn = 1;
        if (ds && lane < (int)ds->layers[0].lanes.size()) { e.chokeGroup = ds->layers[0].lanes[(size_t)lane].chokeGroup; e.chokes = ds->layers[0].lanes[(size_t)lane].chokes; }
        p.hits.push_back(e);
      };
      hit(lg.kickLane, 0.92);
      hit(lg.cymLane, ev.soft ? 0.58 : 0.92);
      if (ev.snare && lg.snareLane != lg.cymLane) hit(lg.snareLane, 0.8);
    }
    if (sc.voice.on) p.chord = voicer.landing(L, ev.sustain, ev.holdSec, sc, capo, tm);
    if (bassOn) {
      // _blEndNote: the tonic's root in the bass's octave, held as long as the chord (and a little over when the chord rings)
      BassEvent& be = p.bassNote; p.bass = true;
      be.frameExact = L; be.frame = (int64_t)std::llround(L);
      be.midi = (((lg.root + capo) % 12) + 12) % 12 + (lg.bassOct + 1) * 12;
      be.durFrames = std::max(0.2, ev.holdSec + (ev.sustain ? 0.4 : 0.0)) * sr; be.vel = 0.9; be.accent = true;
    }
  }
  p.finishAt = ev.sustain ? L + (ev.holdSec + sc.voice.decRaw + 0.14) * sr : L + ev.holdSec * sr;
  return p;
}

}  // namespace modsynth
