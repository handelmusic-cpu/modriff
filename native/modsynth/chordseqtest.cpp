// A run of chords through the engine's own player against the page's chords, nulled: each chord composed from the bank, begun in a pool,
// and the chord before it stopped by the edits the bank holds (chordplay.h), against the same chords as the page sends them, one program
// each, with the edits the page's own voice code made on each when the next began (_webChordStop).
//   chordseqtest <cases.f64>
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles ; kit ; nChords, per
//   chord: nNotes, notes..., subNote, vel, dur, onsetFrame, strum, spread, width, sub, hold, holdSec, len, the page's program (times absolute), nEdits
//   (doubles), the page's edit records for it (six doubles each, times absolute)]
// Prints "SEQ depth peak chords voices stops refused misses" and "WORST startFrame depth".
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "chordplay.h"
#include "graphpool.h"

static const double SR = 48000;
static const int kB = modsynth::GraphPool::kBuses;

struct Bus {
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  Bus() { for (int i = 0; i < kB; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); } }
  void block(modsynth::GraphPool &pool, uint64_t frame, int nf, std::vector<float> &out) {
    for (int i = 0; i < kB; i++) { std::fill(bl[i].begin(), bl[i].end(), 0.f); std::fill(br[i].begin(), br[i].end(), 0.f); }
    pool.render(frame, nf, pl, pr);
    for (int i = 0; i < nf; i++) { float l = 0, r = 0; for (int q = 0; q < kB; q++) { l += bl[q][i]; r += br[q][i]; } out.push_back(l); out.push_back(r); }
  }
};

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: chordseqtest cases.f64\n"); return 2; }
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
  modsynth::GraphPool a, b;
  for (auto &bf : bufs) for (auto *p : {&a, &b}) p->buffers().put(bf.id, bf.sr, bf.nch, bf.len, bf.c[0].data(), bf.nch > 1 ? bf.c[1].data() : nullptr);
  modsynth::DrumBank bank;
  const int ne = (int)d[k++];
  for (int i = 0; i < ne; i++) {
    const size_t len = (size_t)d[k++];
    if (!bank.put(d.data() + k, len)) { fprintf(stderr, "entry %d refused\n", i); return 2; }
    k += len;
  }
  modsynth::ChordPlayer pl;
  pl.sr = SR; pl.bank = &bank; pl.kit = (int)d[k++];
  pl.begin = [&](const double *prog, size_t n, double base, uint64_t start) { return b.begin(prog, n, base, start); };
  pl.edit = [&](int h, const double *inc, size_t n) {
    if (getenv("OPS_DEBUG")) { printf("engine edit on %d:", h); for (size_t i = 0; i < n; i += 6) printf(" [%g,%g,%g,%g,%.5f,%g]", inc[i], inc[i+1], inc[i+2], inc[i+3], inc[i+4], inc[i+5]); printf("\n"); }
    return !getenv("NOEDIT") && b.edit(h, inc, n); };
  const int nc = (int)d[k++];
  long lastEnd = 0, firstClear = 0;
  for (int c = 0; c < nc; c++) {
    modsynth::ChordEvent e; const int nn = (int)d[k++];
    for (int i = 0; i < nn; i++) e.notes.push_back((int)d[k++]);
    e.subNote = (int)d[k++]; e.vel = d[k++]; e.durSec = d[k++]; e.onsetExact = d[k++];
    e.settings.strum = d[k++] != 0; e.settings.spread = d[k++]; e.settings.width = d[k++]; e.settings.sub = d[k++] != 0;
    e.hold = d[k++] != 0; e.holdSec = d[k++];
    const size_t len = (size_t)d[k++];
    const double *prog = d.data() + k; k += len;
    const size_t ned = (size_t)d[k++];
    const double *ed = d.data() + k; k += ned;
    // the earliest voice the engine will begin for it: the truth is begun there
    std::vector<modsynth::ComposedVoice> vs;
    if (!modsynth::ChordComposer::compose(bank, pl.kit, e.notes, e.subNote, e.vel, e.durSec, e.onsetExact, e.settings, SR, 0, vs, e.hold)) { printf("SEQ miss 0 0 0 0 0 0\nWORST 0 0\n"); return 0; }
    uint64_t minStart = ~0ull, maxStart = 0;
    for (auto &v : vs) { minStart = std::min(minStart, v.v.startFrame); maxStart = std::max(maxStart, v.v.startFrame); }
    const int ha = a.begin(prog, len, (double)minStart / SR, minStart);
    if (ha < 0) { fprintf(stderr, "page chord %d refused (%d)\n", c, ha); return 2; }
    if (!getenv("NOEDIT") && ned && !a.edit(ha, ed, ned)) { fprintf(stderr, "page chord %d: edits refused\n", c); return 2; }
    pl.play(e, 0);
    lastEnd = std::max(lastEnd, (long)(e.onsetExact + std::min(e.hold ? e.holdSec + 2.5 : e.durSec, 3.0) * SR));
    if (c == 0) firstClear = (long)maxStart + 128;
  }
  const long total = lastEnd + (long)(0.6 * SR);
  std::vector<float> ra, rb; Bus busA, busB;
  for (long f0 = 0; f0 < total; f0 += 128) {
    const int nf = (int)std::min<long>(128, total - f0);
    busB.block(b, (uint64_t)f0, nf, rb);
    busA.block(a, (uint64_t)f0, nf, ra);
  }
  const size_t n = std::min(ra.size(), rb.size());
  if (getenv("FIRST_DIFF")) { for (size_t i = 0; i < n; i++) if (std::fabs(ra[i] - rb[i]) > 1e-5) { printf("first diff at frame %zu: page %g engine %g\n", i / 2, ra[i], rb[i]); break; } for (size_t fr : {53504u, 53506u, 53520u, 53600u, 54000u, 60000u}) printf("frame %zu page %.9g engine %.9g\n", fr, ra[fr * 2], rb[fr * 2]); }
  double se = 0, sa = 0, pk = 0;
  for (size_t i = (size_t)firstClear * 2; i < n; i++) { const double df = (double)ra[i] - (double)rb[i]; se += df * df; sa += (double)ra[i] * ra[i]; pk = std::max(pk, (double)std::fabs(ra[i])); }
  const double depth = se == 0 ? 999.0 : (sa == 0 ? -999.0 : -20.0 * std::log10(std::sqrt(se / sa)));
  printf("SEQ %.2f %.6f %llu %llu %llu %llu %llu %llu\n", depth, pk, (unsigned long long)pl.chords, (unsigned long long)pl.voices, (unsigned long long)pl.stops, (unsigned long long)pl.refused, (unsigned long long)pl.misses, (unsigned long long)pl.releases);
  const size_t W = 4800;
  double worst = 999, worstAt = 0;
  for (size_t s0 = (size_t)firstClear; s0 + W <= n / 2; s0 += W) {
    double e2 = 0, a2 = 0;
    for (size_t i = s0 * 2; i < (s0 + W) * 2; i++) { const double df = (double)ra[i] - (double)rb[i]; e2 += df * df; a2 += (double)ra[i] * ra[i]; }
    if (a2 < 1e-9) continue;
    const double dd = e2 == 0 ? 999.0 : -20.0 * std::log10(std::sqrt(e2 / a2));
    if (getenv("SCORE_DEBUG") && dd < 90) printf("WIN %zu depth %.1f\n", s0, dd);
    if (dd < worst) { worst = dd; worstAt = (double)s0; }
  }
  printf("WORST %.0f %.2f\n", worstAt, worst);
  return 0;
}
