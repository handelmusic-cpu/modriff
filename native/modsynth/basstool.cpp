// Runs the native bass line on scores and chord windows a test hands it and prints the notes, one per line, for
// tests/seq/bassgrid.test.js to hold against the page's own scheduler.
//   basstool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, rate, firstFrame, seed, nSteps, then the score (basscore.cpp), then the chord
//   windows (ChordTimeline::fromDoubles)]. The windows are all present from the start (the page's song commits them ahead of
//   the bass); `nSteps` steps are fired.
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
    modsynth::BassScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::BassSequencer q(sr);
    if (!q.timeline().fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad windows\n", c); return 2; }
    k += used;
    q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
    printf("CASE %d\n", c);
    int fired = 0;
    while (fired < nsteps) {
      fired += q.run(q.nextFrame() + 1, [](const modsynth::BassEvent &e) {
        printf("N %.17g %lld %d %.17g %.17g %d %d %d %d\n", e.frameExact, (long long)e.frame, e.midi, e.durFrames, e.vel, e.accent ? 1 : 0, e.slide ? 1 : 0, e.from, e.step);
      });
    }
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
