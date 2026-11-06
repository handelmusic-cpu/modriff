// A whole drum score through the engine's own sequencer against the voices the page records for the same hits, nulled.
//   scoretest <cases.f64>
// The engine side is what the host's thread does with no host around it: a DrumSequencer expands the score a lookahead ahead
// of a render clock that advances a block at a time, a DrumPlayer (seqplay.h, the host's code) patches the bank's voice for each
// event, begins it in a GraphPool and cuts the hat group, and the pool renders. The page side is the same hits recorded fresh
// by the page at the engine's own frames, each begun where the engine begins its own voice, with the edits the page's own choke made on it. The two pools'
// buses are summed and compared, which is everything but the host's strips and master (those are downstream of the pool and
// the same for both).
// cases.f64: [nBuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1... ; nEntries, per entry: len, entry doubles ;
//   bpm, rate, firstFrame, seed, tail frames ; the score (seqcore.cpp) ; nHits, per hit: part, kit, lane, frame, len, the page's
//   fresh program (times absolute), nEdits (doubles), the page's edit records for that voice (six doubles each, absolute)]
// The hits are in the order the sequencer fires them; a mismatch with the engine's own event list is an error.
// Prints: "SCORE depth peak events hits misses refused cuts cutEdits lateStarts pageStolen enginePeakVoices", then
//   "WORST startFrame depth" for the 100 ms window with the lowest depth.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "graphpool.h"
#include "seqplay.h"

static const double SR = 48000;
static const int kB = modsynth::GraphPool::kBuses;

struct Bus {
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  Bus() { for (int i = 0; i < kB; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); } }
  // one block of the pool, summed over the buses, appended to out
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
  if (argc < 2) { fprintf(stderr, "usage: scoretest cases.f64\n"); return 2; }
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
  modsynth::DrumPlayer pl;
  pl.sr = SR;
  const int ne = (int)d[k++];
  for (int i = 0; i < ne; i++) {
    const size_t len = (size_t)d[k++];
    if (!pl.bank.put(d.data() + k, len)) { fprintf(stderr, "entry %d refused\n", i); return 2; }
    k += len;
  }
  pl.begin = [&](const double *prog, size_t n, double base, uint64_t start) { return b.begin(prog, n, base, start); };
  pl.edit = [&](int h, const double *inc, size_t n) { return b.edit(h, inc, n); };
  const double bpm = d[k++], rate = d[k++], first = d[k++], seed = d[k++];
  const long tail = (long)d[k++];
  modsynth::DrumScore sc; size_t used = 0;
  if (!sc.fromDoubles(d.data() + k, d.size() - k, &used)) { fprintf(stderr, "bad score\n"); return 2; }
  k += used;
  const int nh = (int)d[k++];
  const int only = getenv("SCORE_ONLY") ? atoi(getenv("SCORE_ONLY")) : -1;   // debugging: just this hit, to find the one that is not exact
  struct Hit { int part, kit, lane; long frame; };
  std::vector<Hit> hits;
  long lastFrame = 0;
  for (int i = 0; i < nh; i++) {
    Hit h{(int)d[k], (int)d[k + 1], (int)d[k + 2], (long)d[k + 3]}; k += 4;
    const size_t len = (size_t)d[k++];
    // Begun where the engine begins its own voice for the hit (on the grid, a lead before the onset), with the program's times
    // taken from that frame. A voice has output before its onset (a waveshaper turns silence into a small constant: the kick has
    // one), and it starts when the voice is begun, so a page voice begun at frame 0 would carry that from the start of the bar.
    long start = h.frame - modsynth::DrumBank::kLeadFrames;
    start -= ((start % 128) + 128) % 128;
    if (start < 0) start = 0;
    const int ha = (only >= 0 && i != only) ? 0 : a.begin(d.data() + k, len, (double)start / SR, (uint64_t)start);
    k += len;
    const size_t ned = (size_t)d[k++];
    if (ha < 0) { fprintf(stderr, "page voice %d refused (%d)\n", i, ha); return 2; }
    if ((only < 0 || i == only) && ned && !a.edit(ha, d.data() + k, ned)) { fprintf(stderr, "page voice %d: edits refused\n", i); return 2; }
    k += ned;
    hits.push_back(h); lastFrame = std::max(lastFrame, h.frame);
  }

  // The engine: the host thread's loop, one render block at a time.
  modsynth::DrumSequencer q(SR);
  q.setScore(sc); q.setTempo(bpm); q.setRate(rate); q.seed((uint64_t)seed); q.start(first);
  const long total = lastFrame + tail;
  std::vector<float> ra, rb; Bus busA, busB;
  size_t seen = 0; int mismatch = 0;
  int peakB = 0;
  for (long f0 = 0; f0 < total; f0 += 128) {
    const int nf = (int)std::min<long>(128, total - f0);
    q.run((double)f0 + 7200, [&](const modsynth::DrumEvent &e) {
      if (e.bar != 0) return;                 // the page's list is the first bar
      if (!(e.vel > 0)) { pl.play(e, (double)f0); return; }   // (the page makes no voice for it either)
      if (seen >= hits.size() || hits[seen].part != e.part || hits[seen].lane != e.lane || hits[seen].frame != (long)e.frame) mismatch++;
      seen++;
      if (only < 0 || (int)seen - 1 == only) pl.play(e, (double)f0);
    }, [](const modsynth::BarMark &) {});
    busB.block(b, (uint64_t)f0, nf, rb);
    peakB = std::max(peakB, b.active());
    busA.block(a, (uint64_t)f0, nf, ra);
  }
  if (seen != hits.size() || mismatch) { fprintf(stderr, "the engine fired %zu events, the page's list has %zu (%d differ)\n", seen, hits.size(), mismatch); return 2; }

  const size_t n = std::min(ra.size(), rb.size());
  double se = 0, sa = 0, pk = 0;
  for (size_t i = 0; i < n; i++) { const double df = (double)ra[i] - (double)rb[i]; se += df * df; sa += (double)ra[i] * ra[i]; pk = std::max(pk, (double)std::fabs(ra[i])); }
  const double depth = se == 0 ? 999.0 : (sa == 0 ? -999.0 : -20.0 * std::log10(std::sqrt(se / sa)));
  printf("SCORE %.2f %.6f %zu %llu %llu %llu %llu %llu %llu %llu %d\n", depth, pk, hits.size(), (unsigned long long)pl.hits, (unsigned long long)pl.misses,
         (unsigned long long)pl.refused, (unsigned long long)pl.cuts, (unsigned long long)pl.cutEdits, (unsigned long long)pl.lateStarts,
         (unsigned long long)a.stolen(), peakB);
  // The worst 100 ms: where, if it is not exact, to look.
  const size_t W = 4800;
  double worst = 999, worstAt = 0;
  for (size_t s0 = 0; s0 + W <= n / 2; s0 += W) {
    double e2 = 0, a2 = 0;
    for (size_t i = s0 * 2; i < (s0 + W) * 2; i++) { const double df = (double)ra[i] - (double)rb[i]; e2 += df * df; a2 += (double)ra[i] * ra[i]; }
    if (a2 < 1e-9) continue;
    const double dd = e2 == 0 ? 999.0 : -20.0 * std::log10(std::sqrt(e2 / a2));
    if (getenv("SCORE_DEBUG") && dd < 90) printf("WIN %zu depth %.1f energy page %.3g engine-error %.3g\n", s0, dd, a2, e2);
    if (dd < worst) { worst = dd; worstAt = (double)s0; }
  }
  printf("WORST %.0f %.2f\n", worstAt, worst);
  return 0;
}
