// A run of the arpeggiator through the engine's own player against the page's notes, nulled: the arp's settings and chords go through the scheduler (arpcore.h), each event it makes
// is a voice from the bank begun in a pool (arpplay.h), against the page's own programs for the notes its scheduleArp sent, all begun in another pool; the two pools' buses are
// summed and nulled.
//   arpseqtest <cases.f64>
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles (voicebank.h) ; kit ; then the arptool case:
//   sampleRate, bpm, firstFrame, epochFrame, endFrame, nTape, tape..., nChords, per chord: atFrame, nNotes, notes..., the score (arpcore.h) ; nPage, per page voice: len, the program
//   (times absolute seconds)]
// Prints "ARP depth peak events voices misses refused lateStarts" and "WORST startFrame depth".
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "arpplay.h"
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
  if (argc < 2) { fprintf(stderr, "usage: arpseqtest cases.f64\n"); return 2; }
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
  modsynth::ArpPlayer pl;
  pl.sr = SR; pl.bank = &bank; pl.kit = (int)d[k++];
  pl.begin = [&](const double *prog, size_t n, double base, uint64_t start) { return b.begin(prog, n, base, start); };
  // the arptool case
  const double sr = d[k++], bpm = d[k++], first = d[k++], epoch = d[k++], endFrame = d[k++];
  const int nt = (int)d[k++];
  std::vector<double> tape(d.begin() + (long)k, d.begin() + (long)k + nt); k += (size_t)nt;
  const int nch = (int)d[k++];
  struct Ch { double at; std::vector<int> notes; };
  std::vector<Ch> chords;
  for (int i = 0; i < nch; i++) { Ch ch; ch.at = d[k++]; const int nn = (int)d[k++]; for (int j = 0; j < nn; j++) ch.notes.push_back((int)d[k++]); chords.push_back(ch); }
  modsynth::ArpScore sc; size_t used = 0;
  if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "bad score\n"); return 2; }
  k += used;
  const int np = (int)d[k++];
  // the page's voices, all begun at frame 0 (their times are absolute)
  for (int i = 0; i < np; i++) {
    const size_t len = (size_t)d[k++];
    if (a.begin(d.data() + k, len, 0.0, 0) < 0) { fprintf(stderr, "page voice %d refused\n", i); return 2; }
    k += len;
  }
  modsynth::TempoMap tm(sr, bpm);
  modsynth::ArpSequencer q(sr);
  q.setScore(sc); q.setTempoMap(&tm);
  if (!tape.empty()) q.setRandomTape(tape);
  q.start(first, epoch);
  uint64_t events = 0;
  long lastEnd = 0;
  auto emit = [&](const modsynth::ArpEvent &e) {
    events++;
    pl.play(e, 0);
    lastEnd = std::max(lastEnd, (long)(e.frameExact + (e.durSec + 0.2) * SR) + (long)e.notes.size() * 576);
  };
  for (const Ch &ch : chords) { q.run(ch.at, emit); q.setNotes(ch.notes); }
  q.run(endFrame, emit);
  const long total = lastEnd + (long)(0.3 * SR);
  std::vector<float> ra, rb; Bus busA, busB;
  for (long f0 = 0; f0 < total; f0 += 128) {
    const int nf = (int)std::min<long>(128, total - f0);
    busB.block(b, (uint64_t)f0, nf, rb);
    busA.block(a, (uint64_t)f0, nf, ra);
  }
  const size_t n = std::min(ra.size(), rb.size());
  double se = 0, sa = 0, pk = 0;
  for (size_t i = 0; i < n; i++) { const double df = (double)ra[i] - (double)rb[i]; se += df * df; sa += (double)ra[i] * ra[i]; pk = std::max(pk, (double)std::fabs(ra[i])); }
  const double depth = se == 0 ? 999.0 : (sa == 0 ? -999.0 : -20.0 * std::log10(std::sqrt(se / sa)));
  printf("ARP %.2f %.6f %llu %llu %llu %llu %llu %d\n", depth, pk, (unsigned long long)events, (unsigned long long)pl.voices, (unsigned long long)pl.misses, (unsigned long long)pl.refused, (unsigned long long)pl.lateStarts, np);
  const size_t W = 4800;
  double worst = 999, worstAt = 0;
  for (size_t s0 = 0; s0 + W <= n / 2; s0 += W) {
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
