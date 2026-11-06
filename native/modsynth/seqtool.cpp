// Runs the native drum sequencer on scores a test hands it and prints the events, one per line, for
// tests/seq/drumgrid.test.js to hold against the page's own scheduler.
//   seqtool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, rateMul, firstFrame, seed, nSteps, nChanges, (afterStep, bpm) x nChanges,
//   then a score (seqcore.cpp)]. A tempo change lands after that many steps have been fired, as the page's does: the
//   steps it had already committed keep their length.
// Output per case: "CASE i", then "E frameExact frame part kit lane vel accent pitch dyn chokeGroup chokes step bar",
// "B frameExact frame bar" for each bar line, then "END i steps".
#include <cstdio>
#include <utility>
#include <vector>
#include "seqcore.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: seqtool cases.f64\n"); return 2; }
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
    const int nch = (int)d[k++];
    std::vector<std::pair<int, double>> changes;
    for (int i = 0; i < nch; i++) { const int a = (int)d[k++]; changes.push_back({a, d[k++]}); }
    modsynth::DrumScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::DrumSequencer q(sr);
    q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
    printf("CASE %d\n", c);
    int fired = 0;
    while (fired < nsteps) {
      for (auto &ch : changes) if (ch.first == fired) q.setTempo(ch.second);
      fired += q.run(q.nextFrame() + 1,
        [](const modsynth::DrumEvent &e) {
          printf("E %.17g %lld %d %d %d %.17g %d %.17g %.17g %d %d %d %d\n", e.frameExact, (long long)e.frame, e.part, e.kit, e.lane,
                 e.vel, e.accent ? 1 : 0, e.pitch, e.dyn, e.chokeGroup, e.chokes ? 1 : 0, e.step, e.bar);
        },
        [](const modsynth::BarMark &b) { printf("B %.17g %lld %d\n", b.frameExact, (long long)b.frame, b.bar); });
    }
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
