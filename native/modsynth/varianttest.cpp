// Which recording of a recorded kit's lane the engine plays (voicebank.h findVariant, seqplay.h): the layer by how hard the stroke is
// within its step, the take by how often the lane has played. The page's own _drumLayerFor decides the layer; tests/seq/layerbank.test.js
// hands this program its answers for a spread of strengths, and every row has to land on the same layer. Each entry is a stand-in whose
// one program number names the (layer, take) it is, so the DrumPlayer's own play() is what is run.
//
// Input (doubles): nRows, then per row [layers, takesPerLayer, dyn, accent, expectedLayer].
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "seqplay.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: varianttest rows.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  const int nr = (int)d[k++];
  int bad = 0, checked = 0;
  for (int r = 0; r < nr; r++) {
    const int layers = (int)d[k++], takes = (int)d[k++]; const double dyn = d[k++]; const bool acc = d[k++] != 0; const int want = (int)d[k++];
    modsynth::DrumPlayer pl;
    for (int li = 0; li < layers; li++) for (int tk = 0; tk < takes; tk++) {
      const double e[] = {1, 0, 7, (double)modsynth::DrumBank::variantLane(3, li, tk), 1, 0, 0.048, 0.9, 1, (double)(li * 8 + tk), 0, 0, 0, 0, 0};
      if (!pl.bank.put(e, sizeof e / sizeof *e)) { fprintf(stderr, "entry refused\n"); return 2; }
    }
    int played = -1;
    pl.begin = [&](const double *p, size_t, double, uint64_t) { played = (int)p[0]; return 0; };
    for (int turn = 0; turn < 2 * takes + 1; turn++) {
      modsynth::DrumEvent ev{}; ev.frame = 48000; ev.frameExact = 48000; ev.part = 0; ev.kit = 7; ev.lane = 3; ev.vel = 0.9; ev.accent = acc; ev.pitch = 0; ev.dyn = dyn;
      played = -1; pl.play(ev, 0);
      checked++;
      if (played != want * 8 + turn % takes) { if (bad++ < 10) fprintf(stderr, "layers %d takes %d dyn %.4f accent %d turn %d: played layer %d take %d, wanted layer %d take %d\n", layers, takes, dyn, (int)acc, turn, played / 8, played % 8, want, turn % takes); }
    }
  }
  // A lane that is one voice is under its own number and takes no part in this; a hit with nothing banked for it is a miss.
  { modsynth::DrumPlayer pl; pl.begin = [&](const double *, size_t, double, uint64_t) { return 0; };
    modsynth::DrumEvent ev{}; ev.frame = 48000; ev.part = 0; ev.kit = 7; ev.lane = 3; ev.vel = 0.9; ev.dyn = 1; pl.play(ev, 0);
    if (pl.misses != 1 || pl.hits != 0) { fprintf(stderr, "an empty bank should miss once\n"); bad++; } }
  printf("%d checked, %d wrong\n", checked, bad);
  return bad ? 1 : 0;
}
