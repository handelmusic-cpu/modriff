// Renders a recorded graph (tests/graph/graphrec.js) to raw float32, for
// tests/graph/voices.test.js to hold against the browser's render of the same
// voice.   graphrender <program.f64> <seconds> <out.f32>
// The program's first host endpoint is written, left and right interleaved.
#include <cstdio>
#include <cstdlib>
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
  modsynth::Graph g;
  if (!g.load(prog.data(), prog.size(), 0.0)) { fprintf(stderr, "load: %s\n", g.error()); return 1; }
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
