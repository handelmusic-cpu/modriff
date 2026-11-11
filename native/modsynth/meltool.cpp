// Runs the native melody generator's scheduler on scores and chord windows a test hands it and prints the notes, one per line, for tests/seq/melgrid.test.js to hold against the
// page's own _mlScheduler.
//   meltool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, rate, firstFrame, seed, nSteps, nTicks, nTape, then nTicks x (horizon, windows: ChordTimeline::fromDoubles, with the melody locks),
//   then nTape random draws (the page's own, in order), then the score (melcore.h), then the chord windows]. With ticks the scheduler is called once per tick as the page's clock calls it,
//   each with the windows the song had committed at that moment; without, the windows are all present from the start and `nSteps` steps are fired one after the other.
// Output per case: "CASE i", "N frameExact frame midi durFrames vel accent glideFrom glideFrames step" for each note, "END i steps".
#include <cstdio>
#include <vector>
#include "melcore.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: meltool cases.f64\n"); return 2; }
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
    const int tickCount = (int)d[k++], nTape = (int)d[k++];
    const bool pendingTicks = tickCount < 0;
    const int nTicks = std::abs(tickCount);
    std::vector<size_t> tickAt;
    for (int i = 0; i < nTicks; i++) {
      tickAt.push_back(k); k += 1;
      if (pendingTicks) { const size_t n = (size_t)d[k++]; k += n; }
      modsynth::ChordTimeline probe; size_t u = 0;
      if (!probe.fromDoubles(d.data() + k, d.size() - k, &u)) { fprintf(stderr, "case %d: bad windows in tick %d\n", c, i); return 2; }
      k += u;
    }
    std::vector<double> tape(d.begin() + (long)k, d.begin() + (long)k + nTape); k += (size_t)nTape;
    modsynth::MelScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::MelSequencer q(sr);
    if (!q.timeline().fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad windows\n", c); return 2; }
    k += used;
    q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
    if (nTape) q.setRandomTape(tape);
    printf("CASE %d\n", c);
    auto out = [](const modsynth::MelEvent &e) {
      printf("N %.17g %lld %d %.17g %.17g %d %d %.17g %d\n", e.frameExact, (long long)e.frame, e.midi, e.durFrames, e.vel, e.accent ? 1 : 0, e.glideFrom, e.glideFrames, e.step);
    };
    int fired = 0;
    if (nTicks) {
      for (int i = 0; i < nTicks; i++) {
        const size_t at = tickAt[(size_t)i];
        size_t start = at + 1;
        if (pendingTicks) {
          const size_t n = (size_t)d[start++];
          if (n) {
            modsynth::MelPending p;
            if (!p.fromDoubles(d.data() + start, n)) return 2;
            q.setPending(p);
          }
          start += n;
        }
        q.timeline().fromDoubles(d.data() + start, d.size() - start);
        fired += q.run(d[at], out);
      }
    } else {
      while (fired < nsteps) fired += q.run(q.nextFrame() + 1, out);
    }
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
