// Runs the native bass line on scores and chord windows a test hands it and prints the notes, one per line, for
// tests/seq/bassgrid.test.js to hold against the page's own scheduler.
//   basstool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, rate, firstFrame, seed, nSteps, nTicks, nTape, then nTicks x (now, horizon, drumBar, windows),
//   then nTape random draws, then the score (basscore.cpp), then the chord windows (ChordTimeline::fromDoubles)]. Without ticks the
//   windows are all present from the start (the page's song commits them ahead of the bass) and `nSteps` steps are fired one after the
//   other (the grid). With ticks, the scheduler is called once per tick as the page's clock calls it (the walking line depends on
//   when: it skips a beat whose moment has passed), each tick is (now, horizon, drumBar, the windows the song had committed at that
//   moment in ChordTimeline::fromDoubles form, then `nScore` and that many doubles of a new score (0: the score stands), then `nPend` and that
//   many doubles of a pending line (BassPending::fromDoubles; 0: nothing new, a first double that is not 1: clear it)), and the tape is the
//   walking line's random draws (the page's own, in order).
// Output per case: "CASE i", "N frameExact frame midi durFrames vel accent slide from step" for each note, "END i steps".
#include <cstdio>
#include <vector>
#include "basscore.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: basstool cases.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const double sr = d[k++], bpm = d[k++], rate = d[k++], first = d[k++], seed = d[k++];
    const int nsteps = (int)d[k++];
    const int nTicks = (int)d[k++], nTape = (int)d[k++];
    // Ticks are variable length (the windows come with them): keep where each starts.
    std::vector<size_t> tickAt;
    for (int i = 0; i < nTicks; i++) {
      tickAt.push_back(k); k += 3;
      modsynth::ChordTimeline probe; size_t u = 0;
      if (!probe.fromDoubles(d.data() + k, d.size() - k, &u)) { fprintf(stderr, "case %d: bad windows in tick %d\n", c, i); return 2; }
      k += u;
      const size_t ns = (size_t)d[k++]; k += ns;
      const size_t np = (size_t)d[k++]; k += np;
    }
    std::vector<double> tape(d.begin() + (long)k, d.begin() + (long)k + nTape); k += (size_t)nTape;
    modsynth::BassScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::BassSequencer q(sr);
    if (!q.timeline().fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad windows\n", c); return 2; }
    k += used;
    (void)0;
    q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
    if (nTape) q.setRandomTape(tape);
    printf("CASE %d\n", c);
    auto out = [](const modsynth::BassEvent &e) {
      printf("N %.17g %lld %d %.17g %.17g %d %d %d %d\n", e.frameExact, (long long)e.frame, e.midi, e.durFrames, e.vel, e.accent ? 1 : 0, e.slide ? 1 : 0, e.from, e.step);
    };
    int fired = 0;
    if (nTicks) {
      for (int i = 0; i < nTicks; i++) {
        const size_t at = tickAt[(size_t)i];
        size_t u = 0;
        q.timeline().fromDoubles(d.data() + at + 3, d.size() - at - 3, &u);
        size_t j = at + 3 + u;
        const size_t ns = (size_t)d[j++];
        if (ns) { modsynth::BassScore ns2; if (!ns2.fromDoubles(d.data() + j, ns)) { fprintf(stderr, "case %d tick %d: bad score\n", c, i); return 2; } q.setScore(ns2); j += ns; }
        const size_t np = (size_t)d[j++];
        if (np) { modsynth::BassPending p; if (!p.fromDoubles(d.data() + j, np)) { fprintf(stderr, "case %d tick %d: bad pending line\n", c, i); return 2; } q.setPending(p); j += np; }
        fired += q.run(d[at], d[at + 1], d[at + 2], out);
      }
    } else {
      while (fired < nsteps) fired += q.run(q.nextFrame() + 1, out);
    }
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
