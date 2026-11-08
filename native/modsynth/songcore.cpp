#include "songcore.h"

namespace modsynth {

bool SongScore::fromDoubles(const double *d, size_t n, size_t *used) {
  size_t k = 0;
  auto need = [&](size_t m) { return k + m <= n; };
  if (!need(6) || d[0] != 1) return false;
  k = 1;
  SongScore s;
  s.barSteps = (int)d[k++]; s.swingOn = d[k++] != 0; s.swing = d[k++]; s.clocked = d[k++] != 0; s.capo = (int)d[k++];
  if (s.barSteps < 1 || s.barSteps > 256) return false;
  if (!readLocks(d, n, k, s.locks)) return false;
  if (!need(1)) return false;
  const double ns = d[k++];
  if (!(ns >= 0 && ns <= 256)) return false;
  for (size_t i = 0; i < (size_t)ns; i++) {
    if (!need(3)) return false;
    SongSection sec; sec.plays = (int)d[k]; sec.follow = d[k + 1] != 0; const double nsl = d[k + 2]; k += 3;
    if (!(nsl >= 0 && nsl <= 1024)) return false;
    for (size_t j = 0; j < (size_t)nsl; j++) {
      if (!need(8)) return false;
      SongSlot sl;
      sl.bars = (int)d[k]; sl.beats = (int)d[k + 1]; sl.eighths = (int)d[k + 2]; sl.rest = d[k + 3] != 0; sl.rootM = (int)d[k + 4]; sl.bassM = (int)d[k + 5];
      sl.lock = (int)d[k + 6];
      const double ni = d[k + 7]; k += 8;
      if (!(ni >= 0 && ni <= 16) || !need((size_t)ni)) return false;
      for (size_t q = 0; q < (size_t)ni; q++) sl.ivs.push_back((int)d[k++]);
      if (sl.lock >= (int)s.locks.size()) return false;
      sec.slots.push_back(std::move(sl));
    }
    s.sections.push_back(std::move(sec));
  }
  *this = std::move(s);
  if (used) *used = k;
  return true;
}

}  // namespace modsynth
