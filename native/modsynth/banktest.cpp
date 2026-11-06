// The voice bank (voicebank.h) against the voices the page records fresh: for each case the page's own program for a hit
// (recorded at that hit's time, begun at frame 0 as the app sends it today) and the bank's patched program for the same
// hit (begun on the grid, a lead before the onset) are played through a GraphPool each and nulled. The patching is the
// engine's C++, the reference programs come from the page (window._nsBank), so what is held is both halves together.
//   banktest <cases.f64>
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles (voicebank.h) ; nCases, per case: part, kit, lane, vel, accent,
//   pitch, onsetFrame, len, the page's fresh program (times absolute, onset at onsetFrame / 48000 s)]
// Prints per case: index, null depth in dB (999 = bit-identical), the loudest sample of the fresh render, the best depth
// within 2 frames of alignment and the offset that gave it, and "miss" for a hit the bank has no voice for.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>
#include "graphpool.h"
#include "voicebank.h"

static const double SR = 48000;

static bool render(modsynth::GraphPool &pool, long total, std::vector<float> &out) {
  const int B = modsynth::GraphPool::kBuses;
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  for (int i = 0; i < B; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); }
  out.clear(); out.reserve((size_t)total * 2);
  for (long done = 0; done < total;) {
    const int nf = (int)std::min<long>(128, total - done);
    for (int i = 0; i < B; i++) { std::fill(bl[i].begin(), bl[i].end(), 0.f); std::fill(br[i].begin(), br[i].end(), 0.f); }
    pool.render((uint64_t)done, nf, pl, pr);
    for (int i = 0; i < nf; i++) {
      float l = 0, r = 0;
      for (int q = 0; q < B; q++) { l += bl[q][i]; r += br[q][i]; }
      out.push_back(l); out.push_back(r);
    }
    done += nf;
  }
  return true;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: banktest cases.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  size_t k = 0;
  struct Buf { int id, nch, len; double sr; std::vector<float> c[2]; };
  std::vector<Buf> bufs;
  const int nb = (int)d[k++];
  for (int i = 0; i < nb; i++) {
    Buf b; b.id = (int)d[k++]; b.sr = d[k++]; b.nch = (int)d[k++]; b.len = (int)d[k++];
    for (int c = 0; c < b.nch; c++) { b.c[c].resize((size_t)b.len); for (int j = 0; j < b.len; j++) b.c[c][(size_t)j] = (float)d[k++]; }
    bufs.push_back(std::move(b));
  }
  modsynth::DrumBank bank;
  const int ne = (int)d[k++];
  for (int i = 0; i < ne; i++) {
    const size_t len = (size_t)d[k++];
    if (!bank.put(d.data() + k, len)) { fprintf(stderr, "entry %d refused\n", i); return 2; }
    k += len;
  }
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    const int part = (int)d[k++], kit = (int)d[k++], lane = (int)d[k++];
    const double vel = d[k++]; const bool acc = d[k++] != 0; const double pitch = d[k++];
    const long onset = (long)d[k++];
    const size_t len = (size_t)d[k++];
    std::vector<double> fresh(d.begin() + k, d.begin() + k + len); k += len;
    const modsynth::BankEntry *e = bank.find(part, kit, lane);
    if (!e) { printf("%d miss 0 0 0 0\n", c); continue; }
    modsynth::PatchedVoice pv;
    bank.patch(*e, vel, acc, pitch, onset, SR, 0, pv);
    const long total = onset + (long)(1.5 * SR);
    modsynth::GraphPool a, b;
    for (auto &bf : bufs) for (auto *p : {&a, &b}) p->buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
    const int ha = a.begin(fresh.data(), fresh.size(), 0.0, 0);
    if (ha < 0) { printf("%d refused-fresh(%d) 0 0 0 0\n", c, ha); continue; }
    const int hb = b.begin(pv.prog.data(), pv.prog.size(), pv.timeBase, pv.startFrame);
    if (hb < 0) { printf("%d refused-patched(%d) 0 0 0 0\n", c, hb); continue; }
    std::vector<float> ra, rb;
    render(a, total, ra); render(b, total, rb);
    auto depthAt = [&](long extra, double &pa) {
      double se = 0, sa = 0; pa = 0;
      for (long i = onset * 2; i < (long)ra.size(); i++) {
        const long j = i + extra * 2;
        if (j < 0 || j >= (long)rb.size()) continue;
        const double df = (double)ra[i] - (double)rb[j];
        se += df * df; sa += (double)ra[i] * ra[i];
        pa = std::max(pa, (double)std::fabs(ra[i]));
      }
      if (se == 0) return 999.0;
      if (sa == 0) return -999.0;
      return -20.0 * std::log10(std::sqrt(se / sa));
    };
    double pa, pa2;
    const double depth = depthAt(0, pa);
    double best = depth; long bestOff = 0;
    for (long o = -2; o <= 2; o++) { if (!o) continue; const double dd = depthAt(o, pa2); if (dd > best) { best = dd; bestOff = o; } }
    printf("%d %.2f %.6f %.2f %ld\n", c, depth, pa, best, bestOff);
  }
  return 0;
}
