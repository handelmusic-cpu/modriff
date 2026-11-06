// A whole bass line through the engine's own sequencer and player against the voices the page records for the same notes, nulled.
//   bassscoretest <cases.f64>
// The engine side is the host thread's loop with no host: a BassSequencer expanding the score and the chord windows a lookahead
// ahead of a render clock that advances a block at a time, a BassPlayer (bassplay.h) patching the bank's voice for each note,
// beginning it in a GraphPool and cutting the note before it. The page side is the same notes recorded fresh by the page at the
// engine's own frames, in order, each begun where the engine begins its own with the edits the page's own voice code made on it
// (the mono cut). The pools' buses are summed and compared.
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles ;
//   voiceKit, bpm, rate, firstFrame, seed, tail frames ; the bass score ; the chord windows ; nNotes, per note: frame, len, the page's
//   fresh program (times absolute), nEdits (doubles), its edit records (six doubles each, absolute)]
// Prints: "SCORE depth peak notes hits misses refused cuts lateStarts pageStolen" and "WORST startFrame depth".
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "bassplay.h"
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
    for (int i = 0; i < nf; i++) {
      float l = 0, r = 0;
      for (int q = 0; q < kB; q++) { l += bl[q][i]; r += br[q][i]; }
      out.push_back(l); out.push_back(r);
    }
  }
};

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: bassscoretest cases.f64\n"); return 2; }
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
  modsynth::BassPlayer pl;
  pl.sr = SR; pl.bank = &bank; pl.kit = (int)d[k++];
  pl.begin = [&](const double *prog, size_t n, double base, uint64_t start) { return b.begin(prog, n, base, start); };
  pl.edit = [&](int h, const double *inc, size_t n) { return b.edit(h, inc, n); };
  const double bpm = d[k++], rate = d[k++], first = d[k++], seed = d[k++];
  const long tail = (long)d[k++];
  modsynth::BassScore sc; size_t used = 0;
  if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "bad score\n"); return 2; }
  k += used;
  modsynth::BassSequencer q(SR);
  if (!q.timeline().fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "bad windows\n"); return 2; }
  k += used;
  const int nh = (int)d[k++];
  const int only = getenv("SCORE_ONLY") ? atoi(getenv("SCORE_ONLY")) : -1;   // debugging: just this note
  std::vector<long> frames;
  long lastFrame = 0;
  for (int i = 0; i < nh; i++) {
    const long frame = (long)d[k++];
    const size_t len = (size_t)d[k++];
    long start = frame - modsynth::DrumBank::kLeadFrames;
    start -= ((start % 128) + 128) % 128;
    if (start < 0) start = 0;
    const int ha = (only >= 0 && i != only) ? 0 : a.begin(d.data() + k, len, (double)start / SR, (uint64_t)start);
    k += len;
    const size_t ned = (size_t)d[k++];
    if (ha < 0) { fprintf(stderr, "page voice %d refused (%d)\n", i, ha); return 2; }
    if ((only < 0 || i == only) && ned && !a.edit(ha, d.data() + k, ned)) { fprintf(stderr, "page voice %d: edits refused\n", i); return 2; }
    k += ned;
    frames.push_back(frame); lastFrame = std::max(lastFrame, frame);
  }

  q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
  const long total = lastFrame + tail;
  std::vector<float> ra, rb; Bus busA, busB;
  size_t seen = 0; int mismatch = 0;
  for (long f0 = 0; f0 < total; f0 += 128) {
    const int nf = (int)std::min<long>(128, total - f0);
    q.run((double)f0 + 7200, [&](const modsynth::BassEvent &e) {
      if (seen >= frames.size()) { seen++; return; }      // the line goes on past what the page recorded: not played, not compared
      if (frames[seen] != (long)e.frame) mismatch++;
      seen++;
      if (only < 0 || (int)seen - 1 == only) pl.play(e, (double)f0);
    });
    busB.block(b, (uint64_t)f0, nf, rb);
    busA.block(a, (uint64_t)f0, nf, ra);
  }
  if (seen < frames.size() || mismatch) { fprintf(stderr, "the engine fired %zu notes, the page's list has %zu (%d differ)\n", seen, frames.size(), mismatch); return 2; }

  const size_t n = std::min(ra.size(), rb.size());
  const size_t upto = (size_t)(lastFrame + tail) * 2 < n ? (size_t)(lastFrame + tail) * 2 : n;
  double se = 0, sa = 0, pk = 0;
  for (size_t i = 0; i < upto; i++) { const double df = (double)ra[i] - (double)rb[i]; se += df * df; sa += (double)ra[i] * ra[i]; pk = std::max(pk, (double)std::fabs(ra[i])); }
  const double depth = se == 0 ? 999.0 : (sa == 0 ? -999.0 : -20.0 * std::log10(std::sqrt(se / sa)));
  printf("SCORE %.2f %.6f %zu %llu %llu %llu %llu %llu %llu\n", depth, pk, frames.size(), (unsigned long long)pl.hits, (unsigned long long)pl.misses,
         (unsigned long long)pl.refused, (unsigned long long)pl.cuts, (unsigned long long)pl.lateStarts, (unsigned long long)a.stolen());
  const size_t W = 4800;
  double worst = 999, worstAt = 0;
  for (size_t s0 = 0; s0 + W <= upto / 2; s0 += W) {
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
