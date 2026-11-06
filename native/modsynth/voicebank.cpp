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
  if (!(c >= 0 && c <= (double)n) || !need((size_t)c * 5 + 1)) return false;
  for (size_t j = 0; j < (size_t)c; j++) {
    DurSlot s{(int)d[k], d[k + 1], d[k + 2], (int)d[k + 3], d[k + 4]}; k += 5;
    if (s.i < 0 || (size_t)s.i >= n || s.mode < 0 || s.mode > 2) return false;
    dur.push_back(s);
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
  return true;
}

}  // namespace modsynth
