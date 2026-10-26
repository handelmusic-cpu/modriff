// The graph path's reverb send (FxRack::setSendReverb / processSend), driven from a
// file so tests/graph/sendreverb.test.js can hold it against a browser ConvolverNode.
//   sendtest <seconds> <exponent> <in.f32 (mono)> <out.f32 (L then R, interleaved)>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "fxrack.h"
int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: sendtest seconds exponent in.f32 out.f32\n"); return 2; }
  FILE *f = fopen(argv[3], "rb"); if (!f) { perror("in"); return 2; }
  std::vector<float> in; float v; while (fread(&v, sizeof v, 1, f) == 1) in.push_back(v); fclose(f);
  modsynth::FxRack rack(48000.0);
  rack.setSendReverb(atof(argv[1]), atof(argv[2]));
  std::vector<float> L(in), R(in), out;
  for (size_t o = 0; o < in.size(); o += 128) {
    const int n = (int)std::min<size_t>(128, in.size() - o);
    rack.processSend(&L[o], &R[o], n);
  }
  out.resize(in.size() * 2);
  for (size_t i = 0; i < in.size(); i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
  f = fopen(argv[4], "wb"); fwrite(out.data(), sizeof(float), out.size(), f); fclose(f);
}
