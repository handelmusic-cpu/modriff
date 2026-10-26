// Plays what the page sent to the host, through the pool, and writes one part's
// bus. For tests/graph/page.test.js: the page's stand-in plugin records its
// messages, and this is the host.
//   graphmix <script.f64> <bus[,bus...]> <seconds> <out.f32>
// The named buses are summed into the one output.
// script: [n, then per event: type, frame, gid, len, payload...]
//   type 1  buffer  payload [id, sampleRate, nch, len, ch0..., ch1...]
//   type 2  begin   payload = the program; `frame` is the engine frame it starts
//   type 3  edit    payload = increments; applied before the first block
#include <cstdio>
#include <cstdlib>
#include <map>
#include <vector>
#include "graphpool.h"

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: graphmix script.f64 part seconds out.f32\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("script"); return 2; }
  std::vector<double> d; double v;
  while (fread(&v, sizeof v, 1, f) == 1) d.push_back(v);
  fclose(f);
  std::vector<int> parts;
  for (const char *c = argv[2]; *c;) { parts.push_back(atoi(c)); while (*c && *c != ',') c++; if (*c == ',') c++; }
  const long total = (long)(atof(argv[3]) * 48000.0);
  modsynth::GraphPool pool;
  std::map<int, int> handle;
  size_t k = 1;
  const int n = d.empty() ? 0 : (int)d[0];
  struct Edit { int gid; std::vector<double> inc; };
  std::vector<Edit> edits;
  for (int e = 0; e < n && k + 3 < d.size(); e++) {
    const int type = (int)d[k++]; const double frame = d[k++]; const int gid = (int)d[k++]; const size_t len = (size_t)d[k++];
    const double *p = &d[k];
    if (type == 1) {
      const int id = (int)p[0]; const double sr = p[1]; const int nch = (int)p[2]; const int bl = (int)p[3];
      std::vector<float> c0(bl), c1(nch > 1 ? bl : 0);
      for (int i = 0; i < bl; i++) c0[i] = (float)p[4 + i];
      for (int i = 0; i < (nch > 1 ? bl : 0); i++) c1[i] = (float)p[4 + bl + i];
      pool.buffers().put(id, sr, nch, bl, c0.data(), nch > 1 ? c1.data() : nullptr);
    } else if (type == 2) {
      const int h = pool.begin(p, len, 0.0, (uint64_t)frame);
      if (h < 0) { fprintf(stderr, "begin gid %d refused (%d)\n", gid, h); return 1; }
      handle[gid] = h;
    } else if (type == 3) {
      edits.push_back({gid, std::vector<double>(p, p + len)});
    }
    k += len;
  }
  for (auto &e : edits) {
    auto it = handle.find(e.gid);
    if (it == handle.end() || !pool.edit(it->second, e.inc.data(), e.inc.size())) { fprintf(stderr, "edit for gid %d refused\n", e.gid); return 1; }
  }
  std::vector<float> out; out.reserve(total * 2);
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  for (int i = 0; i < modsynth::GraphPool::kBuses; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); }
  for (long done = 0; done < total;) {
    const int nf = (int)std::min<long>(128, total - done);
    for (int i = 0; i < modsynth::GraphPool::kBuses; i++) { std::fill(bl[i].begin(), bl[i].end(), 0.f); std::fill(br[i].begin(), br[i].end(), 0.f); }
    pool.render((uint64_t)done, nf, pl, pr);
    for (int i = 0; i < nf; i++) {
      float l = 0, r = 0;
      for (int q : parts) { l += bl[q][i]; r += br[q][i]; }
      out.push_back(l); out.push_back(r);
    }
    done += nf;
  }
  FILE *o = fopen(argv[4], "wb");
  fwrite(out.data(), sizeof(float), out.size(), o);
  fclose(o);
  return 0;
}
