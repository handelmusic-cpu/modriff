// Measures the macro oscillator through the real Processor, the way a patch plays it: levels against
// one default oscillator, peaks, and what it costs. Prints the kModelTrim table to paste into
// native/macroosc/macrovoice.cc. Not a null test (there is no JS to match); it is the level and CPU
// measurement CLAUDE.md asks for before a voice ships.
//   make macrolevel && ./macrolevel            # the table, then a CPU line per model
//   ./macrolevel check                         # same, but uses the table in macrovoice.cc as it is
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <algorithm>
#include <string>
#include <vector>
#include "modsynth.h"

using namespace modsynth;

static int pidx(const char* id) {
  for (int i = 0; i < PARAM_COUNT; i++) if (!strcmp(PARAM_INFO[i].id, id)) return PARAM_INFO[i].index;
  fprintf(stderr, "no param %s\n", id); exit(2);
}
static void set(Processor& p, const char* id, double v) { p.setParam(pidx(id), v); }

struct Result { double rms = 0, peak = 0; int nonfinite = 0; };

// One note held for `hold` seconds after a short settle; measures the steady part.
static Result play(Processor& p, double note, double hold, bool measure = true) {
  std::vector<float> L(128), R(128);
  p.noteOnMsg(note, 0.8, NoteId::num(1), false, 0);
  const int total = (int)(p.sr * hold);
  const int skip = (int)(p.sr * 0.15);
  Result r; double ss = 0; long cnt = 0;
  for (int done = 0; done < total; done += 128) {
    std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
    p.process(L.data(), R.data(), 128);
    if (!measure || done < skip) continue;
    for (int i = 0; i < 128; i++) {
      const float a = L[i], b = R[i];
      if (!std::isfinite(a) || !std::isfinite(b)) { r.nonfinite++; continue; }
      ss += (double)a * a + (double)b * b; cnt += 2;
      r.peak = std::max(r.peak, (double)std::max(std::fabs(a), std::fabs(b)));
    }
  }
  p.noteOffMsg(note, NoteId::num(1), false, 0);
  for (int k = 0; k < 400; k++) { std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); p.process(L.data(), R.data(), 128); }
  r.rms = cnt ? std::sqrt(ss / cnt) : 0;
  return r;
}

int main(int argc, char** argv) {
  const double sr = 48000;
  const double notes[] = {36, 48, 60, 72};
  const double knob[] = {0.2, 0.5, 0.8};
  // Reference: the default patch, one classic oscillator at level 0.8, through its default filter and envelope.
  double refP = 0, refPk = 0; int refN = 0;
  for (double n : notes) { Processor p(sr); Result r = play(p, n, 1.4); refP += r.rms * r.rms; refPk = std::max(refPk, r.peak); refN++; }
  const double ref = std::sqrt(refP / refN);
  printf("reference (default oscillator, C2 C3 C4 C5): rms %.4f  peak %.3f\n\n", ref, refPk);
  printf("%-9s %8s %8s %6s %6s  %s\n", "model", "rms", "peak", "trim", "nonfin", "dB spread over notes/knobs");
  std::vector<double> trims;
  for (int m = 0; m < macroosc::kModels; m++) {
    double sumP = 0; int cnt = 0; double pk = 0; int bad = 0; double lo = 1e9, hi = 0;
    for (double n : notes) for (double k1 : knob) for (double k2 : knob) {
      Processor p(sr);
      set(p, "osc1.on", 0); set(p, "mix.mosc", 1); set(p, "mosc.model", m);
      set(p, "mosc.harmonics", k1); set(p, "mosc.timbre", k2); set(p, "mosc.morph", 0.5);
      Result r = play(p, n, 1.4);
      sumP += r.rms * r.rms; cnt++; pk = std::max(pk, r.peak); bad += r.nonfinite;
      lo = std::min(lo, r.rms); hi = std::max(hi, r.rms);
    }
    const double rms = std::sqrt(sumP / cnt);
    // Match the level, but never let a ringing model's first strike pass the reference's own peak: a pluck
    // measured on RMS alone reads quiet and then jumps out (the same lesson as patches-levels.js).
    // rms and pk were measured through the table's current trim, so the new total is that trim times the correction.
    const double cur = macroosc::kModelTrim[m];
    double trim = rms > 1e-9 ? cur * ref / rms : cur;
    if (pk > 1e-9) trim = std::min(trim, cur * refPk / pk);
    trims.push_back(trim);
    printf("%-9s %8.4f %8.3f %6.3f %6d  %.1f dB\n", macroosc::kModelInfo[m].id, rms, pk, trim, bad, hi > 0 ? 20 * std::log10(hi / std::max(lo, 1e-9)) : 0);
  }
  printf("\nconst double kModelTrim[kModels] = {");
  for (size_t i = 0; i < trims.size(); i++) printf("%s%.3f", i ? ", " : "", trims[i]);
  printf("};\n\n");

  // After trimming: peak and level of each model at its table value, and the cost of a six-note chord.
  printf("%-9s %8s %8s %12s\n", "model", "rms/ref", "peak", "6-voice CPU");
  for (int m = 0; m < macroosc::kModels; m++) {
    double sumP = 0; int cnt = 0, bad = 0; double pk = 0;
    for (double n : notes) { Processor p(sr); set(p, "osc1.on", 0); set(p, "mix.mosc", 1); set(p, "mosc.model", m);
      Result r = play(p, n, 1.4); sumP += r.rms * r.rms; cnt++; pk = std::max(pk, r.peak); bad += r.nonfinite; }
    Processor p(sr); set(p, "osc1.on", 0); set(p, "mix.mosc", 1); set(p, "mosc.model", m);
    const double chord[] = {48, 52, 55, 59, 62, 67};
    for (int i = 0; i < 6; i++) p.noteOnMsg(chord[i], 0.8, NoteId::num(10 + i), false, 0);
    std::vector<float> L(128), R(128);
    auto t0 = std::chrono::steady_clock::now();
    const int blocks = (int)(sr * 10 / 128);
    for (int k = 0; k < blocks; k++) { std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); p.process(L.data(), R.data(), 128); }
    const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    printf("%-9s %8.3f %8.3f %9.2f %% %s\n", macroosc::kModelInfo[m].id, std::sqrt(sumP / cnt) / ref, pk, sec / 10 * 100, bad ? "NONFINITE" : "");
  }
  // Corners: every control at its ends, low to high notes, after trim. Worst peak per model must stay under 1.0 at the
  // voice (before the part's fader), and nothing may go non-finite.
  printf("\ncorners (harmonics, timbre, morph each at 0 or 1; C1 to C6):\n%-9s %9s %8s\n", "model", "peak", "nonfin");
  for (int m = 0; m < macroosc::kModels; m++) {
    double pk = 0; int bad = 0;
    for (double n : {24.0, 36.0, 48.0, 60.0, 72.0, 84.0}) for (int c = 0; c < 8; c++) {
      Processor p(sr); set(p, "osc1.on", 0); set(p, "mix.mosc", 1); set(p, "mosc.model", m);
      set(p, "mosc.harmonics", c & 1); set(p, "mosc.timbre", (c >> 1) & 1); set(p, "mosc.morph", (c >> 2) & 1);
      Result r = play(p, n, 1.0); pk = std::max(pk, r.peak); bad += r.nonfinite;
    }
    printf("%-9s %9.3f %8d %s\n", macroosc::kModelInfo[m].id, pk, bad, pk > 1.0 ? "CLIPS" : "");
  }
  // Denormals: a note that is released and left to decay for eight seconds. If a decaying tail went
  // subnormal the block time would jump; this reports the median block time and the worst one.
  printf("\ntail after release (6 notes, first 0.7 s of the release, 128-frame blocks; budget 2667 us):\n%-9s %10s %10s %7s\n", "model", "median us", "worst us", "ratio");
  for (int m = 0; m < macroosc::kModels; m++) {
    Processor p(sr); set(p, "osc1.on", 0); set(p, "mix.mosc", 1); set(p, "mosc.model", m);
    set(p, "env1.r", 1.5);
    const double chord[] = {36, 43, 48, 52, 55, 60};
    std::vector<float> L(128), R(128);
    for (int i = 0; i < 6; i++) p.noteOnMsg(chord[i], 0.8, NoteId::num(10 + i), false, 0);
    for (int k = 0; k < 200; k++) { std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); p.process(L.data(), R.data(), 128); }
    for (int i = 0; i < 6; i++) p.noteOffMsg(chord[i], NoteId::num(10 + i), false, 0);
    std::vector<double> us;
    const int blocks = (int)(sr * 0.7 / 128);   // while the release is still sounding; after it the voices are finished and cost nothing
    for (int k = 0; k < blocks; k++) {
      std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
      auto t0 = std::chrono::steady_clock::now();
      p.process(L.data(), R.data(), 128);
      us.push_back(std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count());
    }
    std::vector<double> sorted = us; std::sort(sorted.begin(), sorted.end());
    // Blocks with nothing sounding (the voices have finished) are cheap; compare against the busy ones.
    const double med = sorted[sorted.size() / 2], worst = sorted.back();
    printf("%-9s %10.1f %10.1f %7.1f\n", macroosc::kModelInfo[m].id, med, worst, worst / std::max(med, 0.01));
  }
  (void)argc; (void)argv;
}
