// Renders every model and prints what it does: size, level, peak, NaNs, silence. Not a pass/fail
// test of the sound (nothing to compare it with); it is the check that all fourteen models run, stay finite
// and bounded, and that a model switch and a note-on do not blow up.
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
#include "macrovoice.h"

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--ids") {   // for tests/modsynth/macro.test.js
    for (int m = 0; m < macroosc::kModels; m++) printf("%s\n", macroosc::kModelInfo[m].id);
    return 0;
  }
  const double sr = 48000;
  printf("sizeof(MacroVoice) = %zu bytes\n", sizeof(macroosc::MacroVoice));
  for (int m = 0; m < macroosc::kModels; m++) {
    auto* v = new macroosc::MacroVoice();
    v->init(sr);
    v->noteOn(0.8);
    std::vector<float> buf((size_t)(sr * 2));
    for (size_t i = 0; i < buf.size(); i += 32)
      v->render(m, 48, 0.5f, 0.5f, 0.5f, &buf[i], (int)std::min<size_t>(32, buf.size() - i));
    double ss = 0, pk = 0; int bad = 0;
    for (float x : buf) { if (!std::isfinite(x)) bad++; else { ss += (double)x * x; pk = std::max(pk, (double)std::fabs(x)); } }
    printf("%-9s rms %.4f  peak %.3f  nonfinite %d\n", macroosc::kModelInfo[m].id, std::sqrt(ss / buf.size()), pk, bad);
    delete v;
  }
}
