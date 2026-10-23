// The wiring, end to end: a macro wired in the mod matrix to the reverb mix
// (as the factory patches' "Space" macros are) must reach the rack through
// Processor::fxMods, and with the reverb switched off must leave a tail.
#include "modsynth.h"
#include "fxrack.h"
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
using namespace modsynth;
static double tailRms(bool space) {
  const double sr = 48000;
  Processor P(sr); FxRack R(sr);
  for (int i = 0; i < HOST_FX_COUNT; i++) R.set(i, HOST_FX[i].def);   // reverb off, as shipped
  if (space) {
    std::vector<MatrixRow> rows(1); rows[0].s = 18; rows[0].d = 38; rows[0].a = 1;   // macro 1 → fx.reverb.mix
    P.setMatrix(rows);
    // A macro is a parameter (macro.1); setMacro alone is overwritten the next time the snapshot is taken.
    for (int i = 0; i < PARAM_COUNT; i++) if (std::string(PARAM_INFO[i].id) == "macro.1") P.setParam(PARAM_INFO[i].index, 0.8);
  }
  P.noteOnMsg(60, 0.8, NoteId::num(1), false, 0);
  std::vector<float> L(128), Rr(128); double e = 0; long n = 0;
  for (int b = 0; b < 750; b++) {
    if (b == 100) P.noteOffMsg(60, NoteId::num(1), false, 0);
    P.process(L.data(), Rr.data(), 128);
    double m[5]; P.fxMods(m); R.setMods(m);
    R.process(L.data(), Rr.data(), 128);
    if (b > 400) for (float x : L) { e += (double)x * x; n++; }       // well after the note's own release
  }
  return std::sqrt(e / (double)n);
}
int main() {
  const double dry = tailRms(false), wet = tailRms(true);
  printf("tail after the note: macro at rest %.2g, Space up %.2g\n", dry, wet);
  const bool ok = wet > 1e-4 && wet > dry * 20;
  printf("%s\n", ok ? "ok: the macro reaches the rack and makes a tail" : "FAIL");
  return ok ? 0 : 1;
}
