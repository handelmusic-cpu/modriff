// The melody generator's grid cell and a phrase lock of it (docs/native-scheduling.md, slice 3, part three). Its own header because the chord timeline (basscore.h),
// which the bass and the melody both follow, carries the melody's locks beside the bass's.
#pragma once
#include <cstddef>
#include <utility>
#include <vector>

namespace modsynth {

// The page's melody cell {v, note, oct, len, accent, fix, vel, pr, more}: `more` are the other notes of a chord on the step (note, octave), the first being the cell's own.
struct MelCell {
  double v = 0, note = 0, oct = 5, len = 1, vel = 0, pr = 0;
  bool accent = false, fix = false;
  std::vector<std::pair<int, int>> more;
};

// A line the player froze for one chord (PHRASE_LOCKS.mel[key]): `steps` cells, written over the chord whose root is rootPc.
struct MelLock {
  int steps = 16;
  int rootPc = 0;
  std::vector<MelCell> cells;
};

// Reads one cell from d[k...] (v, note, oct, len, accent, fix, vel, pr, nMore, (note, oct) x nMore); k moves past it. False if it is cut short or absurd.
inline bool readMelCell(const double *d, size_t n, size_t &k, MelCell &c) {
  if (k + 9 > n) return false;
  c.v = d[k]; c.note = d[k + 1]; c.oct = d[k + 2]; c.len = d[k + 3]; c.accent = d[k + 4] != 0; c.fix = d[k + 5] != 0; c.vel = d[k + 6]; c.pr = d[k + 7];
  const double nm = d[k + 8]; k += 9;
  if (!(nm >= 0 && nm <= 16) || k + (size_t)nm * 2 > n) return false;
  c.more.clear();
  for (size_t i = 0; i < (size_t)nm; i++) { c.more.push_back({(int)d[k], (int)d[k + 1]}); k += 2; }
  return true;
}

// [nLocks, per lock: steps, rootPc, per cell: readMelCell's] read from d[k...]; k moves past them.
inline bool readMelLocks(const double *d, size_t n, size_t &k, std::vector<MelLock> &out) {
  if (k >= n) return false;
  const double nl = d[k++];
  if (!(nl >= 0 && nl <= 64)) return false;
  out.clear();
  for (size_t i = 0; i < (size_t)nl; i++) {
    if (k + 2 > n) return false;
    MelLock l; l.steps = (int)d[k]; l.rootPc = (int)d[k + 1]; k += 2;
    if (l.steps < 1 || l.steps > 256) return false;
    for (int j = 0; j < l.steps; j++) { MelCell c; if (!readMelCell(d, n, k, c)) return false; l.cells.push_back(std::move(c)); }
    out.push_back(std::move(l));
  }
  return true;
}

}  // namespace modsynth
