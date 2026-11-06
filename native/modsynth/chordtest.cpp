// The chord comp's composition (chordcomp.h) against the page's own chord: for each case the page's single program for the whole chord
// (recorded at that chord's time) is played through a GraphPool, and the engine's n + 1 voices, composed from the bank's one-note chords,
// through another, and the two are nulled. The composing is the engine's C++, the one-note programs and the truth come from the page.
//   chordtest <cases.f64>
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles ; kit ; nCases, per
//   case: nNotes, notes..., subNote, vel, dur, onsetFrame, strum, spread, width, sub, len, the page's program (times absolute)]
// Prints per case: index, null depth in dB (999 = bit-identical), the loudest sample of the page's chord, the voices begun, the best
// depth within 2 frames and the offset, or "miss" when the bank lacks a pitch.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>
#include "chordcomp.h"
#include "graphpool.h"

static const double SR = 48000;

static void render(modsynth::GraphPool &pool, long total, std::vector<float> &out) {
  const int B = modsynth::GraphPool::kBuses;
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  for (int i = 0; i < B; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); }
  out.clear(); out.reserve((size_t)total * 2);
  for (long done = 0; done < total;) {
    const int nf = (int)std::min<long>(128, total - done);
    for (int i = 0; i < B; i++) { std::fill(bl[i].begin(), bl[i].end(), 0.f); std::fill(br[i].begin(), br[i].end(), 0.f); }
    pool.render((uint64_t)done, nf, pl, pr);
    for (int i = 0; i < nf; i++) { float l = 0, r = 0; for (int q = 0; q < B; q++) { l += bl[q][i]; r += br[q][i]; } out.push_back(l); out.push_back(r); }
    done += nf;
  }
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: chordtest cases.f64\n"); return 2; }
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
  const int kit = (int)d[k++];
  const int nc = (int)d[k++];
  for (int c = 0; c < nc; c++) {
    std::vector<int> notes; const int nn = (int)d[k++];
    for (int i = 0; i < nn; i++) notes.push_back((int)d[k++]);
    const int subNote = (int)d[k++];
    const double vel = d[k++], dur = d[k++]; const long onset = (long)d[k++];
    modsynth::ChordSettings cs; cs.strum = d[k++] != 0; cs.spread = d[k++]; cs.width = d[k++]; cs.sub = d[k++] != 0;
    const size_t len = (size_t)d[k++];
    std::vector<double> truth(d.begin() + (long)k, d.begin() + (long)(k + len)); k += len;
    std::vector<modsynth::ComposedVoice> vs;
    if (!modsynth::ChordComposer::compose(bank, kit, notes, subNote, vel, dur, (double)onset, cs, SR, 0, vs)) { printf("%d miss 0 0 0 0\n", c); continue; }
    modsynth::GraphPool a, b;
    for (auto &bf : bufs) for (auto *p : {&a, &b}) p->buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
    uint64_t minStart = ~0ull, maxStart = 0;
    for (auto &v : vs) { minStart = std::min(minStart, v.v.startFrame); maxStart = std::max(maxStart, v.v.startFrame); }
    // The truth is one voice: begun where the earliest of ours is, its times taken from there.
    const int ha = a.begin(truth.data(), truth.size(), (double)minStart / SR, minStart);
    if (ha < 0) { printf("%d refused-truth(%d) 0 0 0 0\n", c, ha); continue; }
    bool bad = false;
    for (auto &v : vs) if (b.begin(v.v.prog.data(), v.v.prog.size(), v.v.timeBase, v.v.startFrame) < 0) bad = true;
    if (bad) { printf("%d refused-composed 0 0 0 0\n", c); continue; }
    const long total = onset + (long)(std::min(dur, 3.0) * SR) + (long)(0.5 * SR);
    std::vector<float> ra, rb;
    render(a, total, ra); render(b, total, rb);
    const long from = (long)maxStart + 128;
    auto depthAt = [&](long extra, double &pa) {
      double se = 0, sa = 0; pa = 0;
      for (long i = from * 2; i < (long)ra.size(); i++) {
        const long j = i + extra * 2;
        if (j < 0 || j >= (long)rb.size()) continue;
        const double df = (double)ra[i] - (double)rb[j];
        se += df * df; sa += (double)ra[i] * ra[i]; pa = std::max(pa, (double)std::fabs(ra[i]));
      }
      if (se == 0) return 999.0;
      if (sa == 0) return -999.0;
      return -20.0 * std::log10(std::sqrt(se / sa));
    };
    double pa, pa2;
    const double depth = depthAt(0, pa);
    double best = depth; long bestOff = 0;
    for (long o = -2; o <= 2; o++) { if (!o) continue; const double dd = depthAt(o, pa2); if (dd > best) { best = dd; bestOff = o; } }
    printf("%d %.2f %.6f %zu %.2f %ld\n", c, depth, pa, vs.size(), best, bestOff);
  }
  return 0;
}
