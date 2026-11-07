#include "voicebank.h"
#include <cmath>

namespace modsynth {

bool BankEntry::fromDoubles(const double *d, size_t total) {
  size_t k = 0;
  auto need = [&](size_t m) { return k + m <= total; };
  if (!need(9) || d[0] != 1) return false;
  k = 1;
  part = (int)d[k++]; kit = (int)d[k++]; lane = (int)d[k++]; generation = d[k++];
  refAt = d[k++]; lead = d[k++]; refVel = d[k++];
  const double nn = d[k++];
  if (!(nn >= 1 && nn < 1e6) || !need((size_t)nn)) return false;
  const size_t n = (size_t)nn;
  prog.assign(d + k, d + k + n); k += n;
  mul.assign(n, 0);
  for (std::vector<BankSlot> *l : {&vel, &accent, &pitch}) {
    l->clear();
    if (!need(1)) return false;
    const double c = d[k++];
    if (!(c >= 0 && c <= (double)n) || !need((size_t)c * 3)) return false;
    for (size_t j = 0; j < (size_t)c; j++) { BankSlot s{(int)d[k], d[k + 1], (int)d[k + 2]}; k += 3; if (s.i < 0 || (size_t)s.i >= n) return false; l->push_back(s); }
  }
  time.clear();
  if (!need(1)) return false;
  double c = d[k++];
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c)) return false;
  for (size_t j = 0; j < (size_t)c; j++) { const int i = (int)d[k++]; if (i < 0 || (size_t)i >= n) return false; time.push_back(i); }
  if (!need(1)) return false;
  c = d[k++];
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c)) return false;
  for (size_t j = 0; j < (size_t)c; j++) { const int i = (int)d[k++]; if (i < 0 || (size_t)i >= n) return false; mul[(size_t)i] = 1; }
  // The chokes are optional: an entry written before them, or for a lane in no group, ends here.
  chokes.clear();
  if (k >= total) return true;
  c = d[k++];
  if (!(c >= 0 && c <= 64)) return false;
  for (size_t j = 0; j < (size_t)c; j++) {
    if (!need(2)) return false;
    BankChoke ch; ch.until = d[k++];
    const double no = d[k++];
    if (!(no >= 0 && no <= 64) || !need((size_t)no * 6)) return false;
    ch.ops.assign(d + k, d + k + (size_t)no * 6); k += (size_t)no * 6;
    chokes.push_back(std::move(ch));
  }
  floors.clear();
  if (k >= total) return true;
  if (!need(1)) return false;
  c = d[k++];
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c * 2)) return false;
  for (size_t j = 0; j < (size_t)c; j++) { const int i = (int)d[k++]; if (i < 0 || (size_t)i >= n) return false; floors.push_back({i, d[k++]}); }
  dur.clear(); from.clear(); refPitch = 0; refDur = -1; refFrom = 0;
  if (k >= total) return true;
  if (!need(4)) return false;
  refPitch = d[k++]; refDur = d[k++]; refFrom = d[k++];
  c = d[k++];
  if (!(c >= 0 && c <= (double)n)) return false;
  for (size_t j = 0; j < (size_t)c; j++) {
    if (!need(4)) return false;
    DurSlot s{(int)d[k], d[k + 1], d[k + 2], {}}; const double nh = d[k + 3]; k += 4;
    if (s.i < 0 || (size_t)s.i >= n || !(nh >= 0 && nh <= 8) || !need((size_t)nh * 2)) return false;
    for (size_t h = 0; h < (size_t)nh; h++) { s.hinges.push_back({d[k], d[k + 1]}); k += 2; }
    dur.push_back(std::move(s));
  }
  c = d[k++];
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c * 3)) return false;
  for (size_t j = 0; j < (size_t)c; j++) { BankSlot s{(int)d[k], d[k + 1], (int)d[k + 2]}; k += 3; if (s.i < 0 || (size_t)s.i >= n) return false; from.push_back(s); }
  held.clear();
  if (k >= total) return true;
  c = d[k++];
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c * 3)) return false;
  for (size_t j = 0; j < (size_t)c; j++) { Held h{(int)d[k], d[k + 1], d[k + 2]}; k += 3; if (h.i < 0 || (size_t)h.i >= n) return false; held.push_back(h); }
  cutOps.clear();
  if (k >= total) return true;
  c = d[k++];
  if (!(c >= 0 && c <= 600) || std::fmod(c, 6) != 0 || !need((size_t)c)) return false;
  cutOps.assign(d + k, d + k + (size_t)c); k += (size_t)c;
  isChord = false; toneLevel.clear(); toneTime.clear(); panSlot = -1; subStops.clear(); toneStops.clear();
  if (k >= total) return true;
  auto list = [&](std::vector<int> &out) {
    if (!need(1)) return false;
    const double m = d[k++];
    if (!(m >= 0 && m <= (double)n) || !need((size_t)m)) return false;
    for (size_t j = 0; j < (size_t)m; j++) { const int i = (int)d[k++]; if (i < 0 || (size_t)i >= n) return false; out.push_back(i); }
    return true;
  };
  auto pairs = [&](std::vector<Src> &out) {
    if (!need(1)) return false;
    const double m = d[k++];
    if (!(m >= 0 && m <= 64) || !need((size_t)m * 3)) return false;
    for (size_t j = 0; j < (size_t)m; j++) { const int a = (int)d[k], b = (int)d[k + 1], nd = (int)d[k + 2]; k += 3; if (a < 0 || b < 0 || nd < 0 || (size_t)a >= n || (size_t)b >= n) return false; out.push_back({a, b, nd}); }
    return true;
  };
  if (!list(toneLevel) || !list(toneTime) || !need(1)) return false;
  panSlot = (int)d[k++];
  if (panSlot >= (int)n) return false;
  if (!pairs(subStops) || !pairs(toneStops)) return false;
  velCurve.clear();
  if (k < total) {
    if (!need(1)) return false;
    const double m = d[k++];
    if (!(m >= 0 && m <= (double)n)) return false;
    for (size_t j = 0; j < (size_t)m; j++) {
      if (!need(4)) return false;
      DurSlot c{(int)d[k], d[k + 1], d[k + 2], {}}; const double nh = d[k + 3]; k += 4;
      if (c.i < 0 || (size_t)c.i >= n || !(nh >= 0 && nh <= 8) || !need((size_t)nh * 2)) return false;
      for (size_t h = 0; h < (size_t)nh; h++) { c.hinges.push_back({d[k], d[k + 1]}); k += 2; }
      velCurve.push_back(std::move(c));
    }
  }
  isChord = true;
  return true;
}

}  // namespace modsynth
