#include "basscore.h"

namespace modsynth {

// [nLocks, per lock: steps, rootPc, per cell: v, note, oct, len, slide, accent, fix, vel, pr] read from d[k...]; k moves past them.
bool readLocks(const double *d, size_t n, size_t &k, std::vector<PhraseLock> &out) {
  if (k >= n) return false;
  const double nl = d[k++];
  if (!(nl >= 0 && nl <= 64)) return false;
  out.clear();
  for (size_t i = 0; i < (size_t)nl; i++) {
    if (k + 2 > n) return false;
    PhraseLock l; l.steps = (int)d[k]; l.rootPc = (int)d[k + 1]; k += 2;
    if (l.steps < 1 || l.steps > 256 || k + (size_t)l.steps * 9 > n) return false;
    for (int j = 0; j < l.steps; j++) {
      BassCell b;
      b.v = d[k]; b.note = d[k + 1]; b.oct = d[k + 2]; b.len = d[k + 3]; b.slide = d[k + 4] != 0; b.accent = d[k + 5] != 0; b.fix = d[k + 6] != 0;
      b.vel = d[k + 7]; b.pr = d[k + 8]; k += 9;
      l.cells.push_back(b);
    }
    out.push_back(std::move(l));
  }
  return true;
}

bool ChordTimeline::fromDoubles(const double *d, size_t n, size_t *used, double offset) {
  size_t k = 0;
  if (n < 1) return false;
  const double nw = d[k++];
  if (!(nw >= 0 && nw <= 4096)) return false;
  std::vector<ChordWindow> out;
  for (size_t i = 0; i < (size_t)nw; i++) {
    if (k + 7 > n) return false;
    ChordWindow w;
    w.t = d[k] + offset; w.end = d[k + 1] + offset; w.rest = d[k + 2] != 0; w.rootPc = (int)d[k + 3]; w.bassPc = (int)d[k + 4]; w.nextPc = (int)d[k + 5];
    const double np = d[k + 6]; k += 7;
    if (!(np >= 0 && np <= 16) || k + (size_t)np > n) return false;
    for (size_t j = 0; j < (size_t)np; j++) w.pcs.push_back((int)d[k++]);
    if (k >= n) return false;
    w.lock = (int)d[k++];
    out.push_back(std::move(w));
  }
  std::vector<PhraseLock> locks;
  if (!readLocks(d, n, k, locks)) return false;
  for (const ChordWindow &w : out) if (w.lock >= (int)locks.size()) return false;
  w_ = std::move(out);
  locks_ = std::move(locks);
  if (used) *used = k;
  return true;
}

bool BassScore::fromDoubles(const double *d, size_t n, size_t *used) {
  size_t k = 0;
  auto need = [&](size_t m) { return k + m <= n; };
  if (!need(7) || d[0] != 1) return false;
  k = 1;
  BassScore s;
  s.steps = (int)d[k++]; s.swing = d[k++]; s.swing8 = d[k++] != 0; s.follow = d[k++] != 0; s.gridRootPc = (int)d[k++];
  if (s.steps < 1 || s.steps > 256) return false;
  double c = d[k++];
  if (!(c >= 0 && c <= 12) || !need((size_t)c + 1)) return false;
  for (size_t i = 0; i < (size_t)c; i++) s.gridIntvs.push_back((int)d[k++]);
  c = d[k++];
  if (!(c >= 0 && c <= 12) || !need((size_t)c + 11)) return false;
  for (size_t i = 0; i < (size_t)c; i++) s.scalePcs.push_back((int)d[k++]);
  s.stepVel = d[k++];
  s.hum.amt = d[k++]; s.hum.timeMul = d[k++]; s.hum.velMul = d[k++]; s.hum.driftMul = d[k++];
  s.hum.maxMs = d[k++]; s.hum.maxVel = d[k++]; s.hum.maxDriftMs = d[k++];
  s.hum.partOff[0] = d[k++] != 0;
  s.jazz = d[k++] != 0; s.twoFeel = d[k++] != 0;
  const double nc = d[k++];
  if (!(nc >= 0 && nc <= 256) || !need((size_t)nc * 9)) return false;
  for (size_t i = 0; i < (size_t)nc; i++) {
    BassCell b;
    b.v = d[k]; b.note = d[k + 1]; b.oct = d[k + 2]; b.len = d[k + 3]; b.slide = d[k + 4] != 0; b.accent = d[k + 5] != 0; b.fix = d[k + 6] != 0;
    b.vel = d[k + 7]; b.pr = d[k + 8]; k += 9;
    s.cells.push_back(b);
  }
  *this = std::move(s);
  if (used) *used = k;
  return true;
}

}  // namespace modsynth
