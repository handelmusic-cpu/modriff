#include "seqcore.h"

namespace modsynth {

// The flat layout (all doubles; the page writes it, tests/seq/drumgrid.test.js writes it, the host reads it):
//   [0]  1                                  layout version
//   [1]  steps  swing  swing8  beatSteps  barSteps  drumsEnabled  tupCover
//   [8]  hum.amt  timeMul  velMul  driftMul  maxMs  maxVel  maxDriftMs  partOff[0]  partOff[1]
//   [17] two layers, each: on  part  kit  nLanes, then per lane:
//        gain  pitch  play  chokeGroup  chokes  nCells, then per cell: v  vel  p  r  rs  orn  pr
bool DrumScore::fromDoubles(const double *d, size_t n, size_t *used) {
  size_t k = 0;
  auto need = [&](size_t m) { return k + m <= n; };
  if (!need(17) || d[0] != 1) return false;
  DrumScore s;
  k = 1;
  s.steps = (int)d[k++]; s.swing = d[k++]; s.swing8 = d[k++] != 0; s.beatSteps = (int)d[k++]; s.barSteps = (int)d[k++];
  s.drumsEnabled = d[k++] != 0; s.tupCover = d[k++] != 0;
  s.hum.amt = d[k++]; s.hum.timeMul = d[k++]; s.hum.velMul = d[k++]; s.hum.driftMul = d[k++];
  s.hum.maxMs = d[k++]; s.hum.maxVel = d[k++]; s.hum.maxDriftMs = d[k++];
  s.hum.partOff[0] = d[k++] != 0; s.hum.partOff[1] = d[k++] != 0;
  if (s.steps < 1 || s.steps > 256) return false;
  for (int li = 0; li < 2; li++) {
    if (!need(4)) return false;
    DrumLayer &L = s.layers[li];
    L.on = d[k++] != 0; L.part = (int)d[k++]; L.kit = (int)d[k++];
    const int nl = (int)d[k++];
    if (nl < 0 || nl > 64) return false;
    L.lanes.resize((size_t)nl);
    for (int ti = 0; ti < nl; ti++) {
      if (!need(6)) return false;
      DrumLane &l = L.lanes[(size_t)ti];
      l.gain = d[k++]; l.pitch = d[k++]; l.play = d[k++] != 0; l.chokeGroup = (int)d[k++]; l.chokes = d[k++] != 0;
      const int nc = (int)d[k++];
      if (nc < 0 || nc > 256 || !need((size_t)nc * 7)) return false;
      l.cells.resize((size_t)nc);
      for (int c = 0; c < nc; c++) {
        DrumCell &x = l.cells[(size_t)c];
        x.v = d[k++]; x.vel = d[k++]; x.p = d[k++]; x.r = d[k++]; x.rs = d[k++]; x.orn = d[k++]; x.pr = d[k++];
      }
    }
  }
  *this = s;
  if (used) *used = k;
  return true;
}

}  // namespace modsynth
