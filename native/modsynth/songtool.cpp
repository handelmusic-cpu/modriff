// Runs the native song loop on a score and a list of ticks a test hands it and prints the chord windows it emits, one per line, for
// tests/seq/songstep.test.js to hold against the page's own loop.
//   songtool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, firstFrame, section, slot, pass, nTicks, then nTicks x (now, horizon, drumsPlaying, nMarks,
//   marks..., queuedMove, capo (1e9: none)), then the score (songcore.h)]. A tick is one call of the scheduler: the bar lines the drums announced since the last
//   one (frames), a Next/Prev the player queued before it (+1, -1, or 0), and the horizon it fires chords up to.
// Output per case: "CASE i", "A section chord pass t end nextSection nextChord capo queuedMove" for each chord the song starts (what the host's mirror asks the page about), "C frame chorus bpm keyDelta" when a practice chorus ends, "E type frame kind sustain snare soft holdSec durFrames fadeSteps fromBpm nSteps (frame bpm)..." for an ending (type 0 land, 1 fade start, 2 fade end, 3 ritard), "P now queuedMove" after each tick (what the mirror shows), "W t end rest rootPc bassPc nextPc lock section slot pass nPcs pcs..." per chord, and when the score says how the chords sound
// (songvoice.h) the action that follows it: "S onset" (stop the chord that sounds) or "V onset vel dur hold holdSec subNote nNotes notes..." (strike it), and the
// re-strikes of its comp as "H" lines of the same shape (or "T onset" for one that only stops), in the order the engine plays them, "END i n", and after each chord's "W" line the
// arp's chord as "Q nNotes notes..." (or "Q rest": the chord stays and the pattern starts again), with the Octaves control from the environment ARP_OCTS (1 to 3).
#include <cstdio>
#include <vector>
#include <cstdlib>
#include "arpcore.h"
#include "songcore.h"
#include "songvoice.h"
#include "songend.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: songtool cases.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const double sr = d[k++], bpm = d[k++], first = d[k++];
    const int section = (int)d[k++], slot = (int)d[k++], pass = (int)d[k++];
    const int nTicks = (int)d[k++];
    struct Tick { double now, horizon; bool drums; std::vector<double> marks; int move; double capo; };
    std::vector<Tick> ticks;
    for (int i = 0; i < nTicks; i++) {
      Tick t; t.now = d[k++]; t.horizon = d[k++]; t.drums = d[k++] != 0;
      const int nm = (int)d[k++];
      for (int j = 0; j < nm; j++) t.marks.push_back(d[k++]);
      t.move = (int)d[k++];
      t.capo = d[k++];
      ticks.push_back(std::move(t));
    }
    modsynth::SongScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::TempoMap tm(sr, bpm);
    modsynth::SongSequencer q(sr);
    modsynth::SongVoicer voicer(sr);
    q.setScore(sc); q.setTempoMap(&tm);
    if (!q.start(first, section, slot, pass)) { fprintf(stderr, "case %d: cannot start\n", c); return 2; }
    printf("CASE %d\n", c);
    int fired = 0;
    for (const Tick &t : ticks) {
      for (double m : t.marks) q.noteBar(m);
      if (t.move >= 10) q.arm(t.move - 10);             // 10 + the ending the player armed (1 cold, 2 finish, 3 fade, 4 tag, 5 ritard)
      else if (t.move) q.queueMove(t.move);
      if (t.capo < 1e8) q.setCapo((int)t.capo);
      auto show = [](const char *tag, const char *stopTag, const modsynth::VoiceAction &a) {
        if (a.play) {
          printf("%s %.17g %.17g %.17g %d %.17g %d %zu", tag, a.onset, a.e.vel, a.e.durSec, a.e.hold ? 1 : 0, a.e.holdSec, a.e.subNote, a.e.notes.size());
          for (int n : a.e.notes) printf(" %d", n);
          printf("\n");
        } else if (a.stop) printf("%s %.17g\n", stopTag, a.onset);
      };
      auto hits = [&](double horizon) { voicer.flush(horizon, q.score(), q.capoNow(), tm, [&](const modsynth::VoiceAction &a) { show("H", "T", a); }); };
      fired += q.run(t.horizon, t.drums, [&](const modsynth::SongChord &ch) {
        const modsynth::ChordWindow &w = ch.w;
        { int ns = 0, nl = 0; q.nextPlace(ns, nl); printf("A %d %d %d %.17g %.17g %d %d %d %d\n", ch.section, ch.slot, ch.pass, w.t, w.end, ns, nl, ch.capo, q.queuedMove()); }
        if (q.score().voice.on) hits(w.t);
        printf("W %.17g %.17g %d %d %d %d %d %d %d %d %zu", w.t, w.end, w.rest ? 1 : 0, w.rootPc, w.bassPc, w.nextPc, w.lock, ch.section, ch.slot, ch.pass, w.pcs.size());
        for (int p : w.pcs) printf(" %d", p);
        printf("\n");
        if (w.melLock >= 0) printf("L 1 %d %d\n", q.score().melLocks[(size_t)w.melLock].rootPc, q.score().melLocks[(size_t)w.melLock].steps);   // the melody generator's locked phrase for it: the root it was written over, its steps
        else printf("L 0 0 0\n");
        // the arp's chord (setArpChord in _playChartSlot2): a rest leaves it as it was and starts the pattern again; else the tones, with the slash bass first and the octaves above
        { const char *oc = getenv("ARP_OCTS"); const int octs = oc ? atoi(oc) : 1;
          if (ch.s.rest) printf("Q rest\n");
          else { const std::vector<int> an = modsynth::arpChordNotes(ch.s.rootM + ch.capo, ch.s.bassM >= 0 ? ch.s.bassM + ch.capo : -1, ch.s.ivs, octs);
                 printf("Q %zu", an.size()); for (int n : an) printf(" %d", n); printf("\n"); } }
        if (q.score().voice.on) show("V", "S", voicer.chord(ch, q.score(), tm));
      }, [&](const modsynth::ChorusEvent &ev) {
        // the practice trainer stepped: the tempo is stepped on the bar line the new chorus begins on (the host puts it after the drums' expanded steps)
        if (ev.bpm > 0) tm.jump(ev.frame, ev.bpm);
        printf("C %.17g %d %.17g %d\n", ev.frame, ev.chorus, ev.bpm, ev.keyDelta);
      }, [&](const modsynth::EndingEvent &ev) {
        // an ending: a ritardando steps the tempo map, the rest are the host's business and are only printed
        if (ev.type == modsynth::EndingEvent::Ritard) for (const auto &st : ev.tempoSteps) tm.jump(st.first, st.second);
        printf("E %d %.17g %d %d %d %d %.17g %.17g %d %.17g %zu", (int)ev.type, ev.frame, ev.kind, ev.sustain ? 1 : 0, ev.snare ? 1 : 0, ev.soft ? 1 : 0, ev.holdSec, ev.durFrames,
               ev.fadeSteps, ev.fromBpm, ev.tempoSteps.size());
        for (const auto &st : ev.tempoSteps) printf(" %.17g %.17g", st.first, st.second);
        printf("\n");
        if (ev.type == modsynth::EndingEvent::Land) {
          // the landing the host would play: the band hit, the chord, the bass note, when it is all stopped (the drums and the bass are taken to be playing)
          const modsynth::LandingPlan lp = modsynth::planLanding(q.score(), ev, voicer, tm, nullptr, true, true, sr);
          for (const modsynth::DrumEvent &h : lp.hits) printf("D %.17g %d %.17g %d\n", h.frameExact, h.lane, h.vel, h.accent ? 1 : 0);
          if (lp.chord.play) {
            printf("K %.17g %.17g %.17g %d %.17g %d %zu", lp.chord.onset, lp.chord.e.vel, lp.chord.e.durSec, lp.chord.e.hold ? 1 : 0, lp.chord.e.holdSec, lp.chord.e.subNote, lp.chord.e.notes.size());
            for (int n : lp.chord.e.notes) printf(" %d", n);
            printf("\n");
          } else if (lp.chord.stop) printf("K stop %.17g\n", lp.chord.onset);
          if (lp.bass) printf("B %.17g %d %.17g %.17g %d\n", lp.bassNote.frameExact, lp.bassNote.midi, lp.bassNote.durFrames, lp.bassNote.vel, lp.bassNote.accent ? 1 : 0);
          printf("F %.17g\n", lp.finishAt);
        }
      });
      if (q.score().voice.on) hits(t.horizon);
      printf("P %.17g %d\n", t.now, q.queuedMove());          // the host's mirror after this tick: the Next/Prev still waiting
    }
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
