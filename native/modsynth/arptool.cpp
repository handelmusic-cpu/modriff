// Runs the native arpeggiator on scores a test hands it and prints the events, one per line, for tests/seq/arpgrid.test.js to hold against the page's scheduleArp.
//   arptool <cases.f64>
// cases.f64: [nCases, per case: sampleRate, bpm, firstFrame, epochFrame, endFrame, nTape, tape..., nChords, per chord: atFrame, nNotes, notes..., then the score (arpcore.h)]
// A chord is the arp's chord from `atFrame` on (setArpChord: the pattern starts again). Output per case: "CASE i", "N frame midi durSec vel level pan gateIdx" per note,
// "B frame durSec n notes..." per block, "END i steps".
#include <cstdio>
#include <vector>
#include "arpcore.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: arptool cases.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const double sr = d[k++], bpm = d[k++], first = d[k++], epoch = d[k++];
    const double endFrame = d[k++];
    const int nt = (int)d[k++];
    std::vector<double> tape(d.begin() + (long)k, d.begin() + (long)k + nt); k += (size_t)nt;
    const int nch = (int)d[k++];
    struct Ch { double at; std::vector<int> notes; };
    std::vector<Ch> chords;
    for (int i = 0; i < nch; i++) { Ch ch; ch.at = d[k++]; const int nn = (int)d[k++]; for (int j = 0; j < nn; j++) ch.notes.push_back((int)d[k++]); chords.push_back(ch); }
    modsynth::ArpScore sc; size_t used = 0;
    if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "case %d: bad score\n", c); return 2; }
    k += used;
    modsynth::TempoMap tm(sr, bpm);
    modsynth::ArpSequencer q(sr);
    q.setScore(sc); q.setTempoMap(&tm);
    if (!tape.empty()) q.setRandomTape(tape);
    printf("CASE %d\n", c);
    q.start(first, epoch);
    int fired = 0;
    auto emit = [](const modsynth::ArpEvent &e) {
      if (e.midi >= 0) printf("N %.17g %d %.17g %.17g %.17g %.17g %d\n", e.frameExact, e.midi, e.durSec, e.vel, e.level, e.pan, e.gateIdx);
      else { printf("B %.17g %.17g %zu", e.frameExact, e.durSec, e.notes.size()); for (int n : e.notes) printf(" %d", n); printf("\n"); }
    };
    // a chord takes over at its moment: the steps due before it are the old chord's, the rest the new one's
    for (const Ch &ch : chords) { fired += q.run(ch.at, emit); q.setNotes(ch.notes); }
    fired += q.run(endFrame, emit);
    printf("END %d %d\n", c, fired);
  }
  return 0;
}
