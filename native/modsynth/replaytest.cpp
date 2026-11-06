// The native-scheduling spike (docs/native-scheduling.md, slice 0): is replaying a voice program the
// page recorded once, with its time shifted and a few numbers patched, the same sound as a program the
// page records fresh for that note?
//   replaytest <cases.f64> <seconds>   prints one line per case: index, null depth in dB, peaks, then the best
//                                      depth within 2 frames of alignment and the frame offset that gave it
// cases.f64: [nbuffers, per buffer: id, sampleRate, nch, len, ch0..., ch1...; ncases, then per case compareFrom, shiftFrames and two sides (A = fresh, B = replayed), each:
//   nvoices, per voice: timeBase, startFrame, len, program...,
//   nedits,  per edit : voice, len, increments...]
// Only frames from compareFrom on are compared: a recorded voice can sound before its onset (a waveshaper's bias
// is a constant in the output from the moment the voice begins), and a replayed one begins at the onset.
// Each side is played through its own GraphPool, every bus summed, and B (advanced by shiftFrames, for a side
// begun later than A on purpose) is subtracted from A. The depth
// is -20 log10(rms(A-B) / rms(A)) (higher is a deeper null); 999 means the two are bit-identical.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "graphpool.h"

struct Voice { double timeBase, frame; std::vector<double> prog; };
struct Edit { int voice; std::vector<double> inc; };
struct Side { std::vector<Voice> v; std::vector<Edit> e; };

static bool readSide(const std::vector<double> &d, size_t &k, Side &s) {
  if (k >= d.size()) return false;
  const int nv = (int)d[k++];
  for (int i = 0; i < nv; i++) {
    Voice v; v.timeBase = d[k++]; v.frame = d[k++]; const size_t len = (size_t)d[k++];
    v.prog.assign(d.begin() + k, d.begin() + k + len); k += len; s.v.push_back(std::move(v));
  }
  const int ne = (int)d[k++];
  for (int i = 0; i < ne; i++) {
    Edit e; e.voice = (int)d[k++]; const size_t len = (size_t)d[k++];
    e.inc.assign(d.begin() + k, d.begin() + k + len); k += len; s.e.push_back(std::move(e));
  }
  return true;
}

struct Buf { int id, nch, len; double sr; std::vector<float> c[2]; };

static bool render(const Side &s, const std::vector<Buf> &bufs, long total, std::vector<float> &out) {
  modsynth::GraphPool pool;
  for (auto &b : bufs) pool.buffers().put(b.id, b.sr, b.nch, b.len, b.c[0].data(), b.nch > 1 ? b.c[1].data() : nullptr);
  std::vector<int> h;
  for (auto &v : s.v) {
    const int r = pool.begin(v.prog.data(), v.prog.size(), v.timeBase, (uint64_t)v.frame);
    if (r < 0) { fprintf(stderr, "begin refused (%d)\n", r); return false; }
    h.push_back(r);
  }
  for (auto &e : s.e) {
    if (e.voice < 0 || e.voice >= (int)h.size() || !pool.edit(h[e.voice], e.inc.data(), e.inc.size())) { fprintf(stderr, "edit refused\n"); return false; }
  }
  const int B = modsynth::GraphPool::kBuses;
  std::vector<float> bl[modsynth::GraphPool::kBuses], br[modsynth::GraphPool::kBuses];
  float *pl[modsynth::GraphPool::kBuses], *pr[modsynth::GraphPool::kBuses];
  for (int i = 0; i < B; i++) { bl[i].assign(128, 0.f); br[i].assign(128, 0.f); pl[i] = bl[i].data(); pr[i] = br[i].data(); }
  out.clear(); out.reserve(total * 2);
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
  if (argc < 3) { fprintf(stderr, "usage: replaytest cases.f64 seconds\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("cases"); return 2; }
  std::vector<double> d; double x;
  while (fread(&x, sizeof x, 1, f) == 1) d.push_back(x);
  fclose(f);
  const long total = (long)(atof(argv[2]) * 48000.0);
  size_t k = 0;
  std::vector<Buf> bufs;
  const int nb = d.empty() ? 0 : (int)d[k++];
  for (int i = 0; i < nb; i++) {
    Buf b; b.id = (int)d[k++]; b.sr = d[k++]; b.nch = (int)d[k++]; b.len = (int)d[k++];
    for (int c = 0; c < b.nch; c++) { b.c[c].resize(b.len); for (int j = 0; j < b.len; j++) b.c[c][j] = (float)d[k++]; }
    bufs.push_back(std::move(b));
  }
  const int n = (k < d.size()) ? (int)d[k++] : 0;
  for (int c = 0; c < n; c++) {
    Side a, b;
    const long from = (long)d[k++];
    const long shift = (long)d[k++];
    if (!readSide(d, k, a) || !readSide(d, k, b)) { fprintf(stderr, "short file at case %d\n", c); return 2; }
    std::vector<float> ra, rb;
    if (!render(a, bufs, total, ra) || !render(b, bufs, total, rb)) { printf("%d refused 0 0\n", c); continue; }
    if (const char *dir = getenv("REPLAY_DUMP")) {   // both renders, interleaved float32, for looking at a failing case
      char fn[512]; snprintf(fn, sizeof fn, "%s/case%d-A.f32", dir, c); if (FILE *o = fopen(fn, "wb")) { fwrite(ra.data(), 4, ra.size(), o); fclose(o); }
      snprintf(fn, sizeof fn, "%s/case%d-B.f32", dir, c); if (FILE *o = fopen(fn, "wb")) { fwrite(rb.data(), 4, rb.size(), o); fclose(o); }
    }
    // Depth at the stated alignment, and the best of the stated one and 1 and 2 frames either way: a voice whose
    // onset is one frame off (a start time that rounds the other way in the last bit of a double) is not a
    // different sound, and the second number says so.
    auto depthAt = [&](long extra, double &pa, double &pd) {
      double se = 0, sa = 0; pa = 0; pd = 0;
      for (long i = from * 2; i < (long)ra.size(); i++) {
        const long j = i + (shift + extra) * 2;
        if (j < 0 || j >= (long)rb.size()) continue;
        const double df = (double)ra[i] - (double)rb[j];
        se += df * df; sa += (double)ra[i] * ra[i];
        pa = std::max(pa, (double)std::fabs(ra[i])); pd = std::max(pd, std::fabs(df));
      }
      if (se == 0) return 999.0;
      if (sa == 0) return -999.0;
      return -20.0 * std::log10(std::sqrt(se / sa));
    };
    double pa, pd, pa2, pd2;
    const double depth = depthAt(0, pa, pd);
    double best = depth; long bestOff = 0;
    for (long e = -2; e <= 2; e++) { if (!e) continue; const double dd = depthAt(e, pa2, pd2); if (dd > best) { best = dd; bestOff = e; } }
    printf("%d %.2f %.6f %.9f %.2f %ld\n", c, depth, pa, pd, best, bestOff);
  }
  return 0;
}
