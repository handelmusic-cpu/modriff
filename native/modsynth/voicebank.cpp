#include "voicebank.h"

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
  return true;
}

}  // namespace modsynth
