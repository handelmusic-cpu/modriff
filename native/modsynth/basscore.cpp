#include "basscore.h"

namespace modsynth {

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
    out.push_back(std::move(w));
  }
  w_ = std::move(out);
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
  if (!(c >= 0 && c <= 12) || !need((size_t)c + 9)) return false;
  for (size_t i = 0; i < (size_t)c; i++) s.scalePcs.push_back((int)d[k++]);
  s.stepVel = d[k++];
  s.hum.amt = d[k++]; s.hum.timeMul = d[k++]; s.hum.velMul = d[k++]; s.hum.driftMul = d[k++];
  s.hum.maxMs = d[k++]; s.hum.maxVel = d[k++]; s.hum.maxDriftMs = d[k++];
  s.hum.partOff[0] = d[k++] != 0;
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
