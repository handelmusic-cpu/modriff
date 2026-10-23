// Renders ModFxProc for the null test: reads blocks of (params, 128 stereo
// input samples) from a file, writes the output blocks to another.
// Usage: wkrender in.bin out.bin
#include "modfxproc.h"
#include <cstdio>
#include <cstdint>
#include <vector>
using namespace modsynth;
int main(int argc, char** argv) {
  if (argc < 3) return 2;
  FILE* f = fopen(argv[1], "rb"); FILE* o = fopen(argv[2], "wb");
  if (!f || !o) return 2;
  uint32_t sr, nb;
  if (fread(&sr, 4, 1, f) != 1 || fread(&nb, 4, 1, f) != 1) return 2;
  ModFxProc P(sr);
  std::vector<float> L(128), R(128);
  for (uint32_t b = 0; b < nb; b++) {
    double v[11];
    if (fread(v, 8, 11, f) != 11) return 3;
    if (fread(L.data(), 4, 128, f) != 128 || fread(R.data(), 4, 128, f) != 128) return 3;
    ModFxParams p;
    p.stutter = v[0]; p.reverse = v[1]; p.warp = v[2]; p.crush = v[3]; p.srate = v[4];
    p.grain = v[5]; p.grainlen = v[6]; p.fltmode = v[7]; p.fltcut = v[8]; p.fltres = v[9]; p.fltdrv = v[10];
    P.process(L.data(), R.data(), L.data(), R.data(), 128, p);
    fwrite(L.data(), 4, 128, o); fwrite(R.data(), 4, 128, o);
  }
  fclose(f); fclose(o);
  return 0;
}
