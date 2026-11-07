// Runs the native chord rhythm on scores a test hands it and prints the hits, one per line, for tests/seq/chordrhythm.test.js to hold against the
// page's scheduleChordRhythm.
//   chordtool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, firstFrame, startStep, nSteps, then the score (chordcore.h)]
// Output per case: "CASE i", "H frameExact vel durSec nNotes notes... subNote" per hit, "END i steps".
#include <cstdio>
#include <vector>
#include "chordcore.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: chordtool cases.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const double sr = d[k++], bpm = d[k++], first = d[k++]; const int startStep = (int)d[k++], nsteps = (int)d[k++];
    modsynth::ChordScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::ChordSequencer q(sr);
    q.setScore(sc); q.setTempo(bpm); q.start(first, startStep);
    printf("CASE %d\n", c);
    int fired = 0;
    while (fired < nsteps) fired += q.run(q.nextFrame() + 1, [](const modsynth::ChordEvent &e) {
      printf("H %.17g %.17g %.17g %zu", e.onsetExact, e.vel, e.durSec, e.notes.size());
      for (int n : e.notes) printf(" %d", n);
      printf(" %d\n", e.subNote);
    });
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
