// Renders a recorded graph (tests/graph/graphrec.js) to raw float32, for
// tests/graph/voices.test.js to hold against the browser's render of the same
// voice.   graphrender <program.f64> <seconds> <out.f32> [increments.f64|-] [buffers.f64]
// With increments, they are applied once the graph is loaded, as a live edit
// (a release) that was recorded after the program was sent. buffers is the
// audio the program names, as doubles: [n, then per buffer id, sampleRate,
// nCh, len, ch0..., ch1...]; test use only (the app sends it as typed arrays).
// The program's first host endpoint is written, left and right interleaved.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "graph.h"

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: graphrender prog.f64 seconds out.f32\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("prog"); return 2; }
  std::vector<double> prog;
  double v;
  while (fread(&v, sizeof v, 1, f) == 1) prog.push_back(v);
  fclose(f);
  modsynth::BufferStore store;
  if (argc > 5) {
    FILE *fb = fopen(argv[5], "rb");
    if (!fb) { perror("buffers"); return 2; }
    std::vector<double> bd;
    while (fread(&v, sizeof v, 1, fb) == 1) bd.push_back(v);
    fclose(fb);
    size_t k = 1;
    const int nb = bd.empty() ? 0 : (int)bd[0];
    for (int b = 0; b < nb && k + 3 < bd.size(); b++) {
      const int id = (int)bd[k++]; const double sr = bd[k++]; const int nch = (int)bd[k++]; const int len = (int)bd[k++];
      std::vector<float> c0(len), c1(nch > 1 ? len : 0);
      for (int i = 0; i < len; i++) c0[i] = (float)bd[k++];
      for (int i = 0; i < (nch > 1 ? len : 0); i++) c1[i] = (float)bd[k++];
      store.put(id, sr, nch, len, c0.data(), nch > 1 ? c1.data() : nullptr);
    }
  }
  modsynth::Graph g;
  if (!g.load(prog.data(), prog.size(), 0.0, &store)) { fprintf(stderr, "load: %s\n", g.error()); return 1; }
  if (argc > 4 && std::string(argv[4]) != "-") {
    FILE *fi = fopen(argv[4], "rb");
    if (!fi) { perror("increments"); return 2; }
    std::vector<double> inc;
    while (fread(&v, sizeof v, 1, fi) == 1) inc.push_back(v);
    fclose(fi);
    if (!g.apply(inc.data(), inc.size(), 0.0)) { fprintf(stderr, "apply: %s\n", g.error()); return 1; }
  }
  if (g.extCount() < 1) { fprintf(stderr, "no endpoint\n"); return 1; }
  const long total = (long)(atof(argv[2]) * g.sampleRate());
  std::vector<float> out;
  out.reserve(total * 2);
  for (long done = 0; done < total;) {
    const int n = (int)std::min<long>(modsynth::Graph::kQuantum, total - done);
    g.render(n);
    const float *l = g.extBuf(0, 0), *r = g.extBuf(0, 1);
    for (int s = 0; s < n; s++) { out.push_back(l[s]); out.push_back(r[s]); }
    done += n;
  }
  FILE *o = fopen(argv[3], "wb");
  fwrite(out.data(), sizeof(float), out.size(), o);
  fclose(o);
  return 0;
}
