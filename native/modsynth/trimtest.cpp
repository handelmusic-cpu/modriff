// MB_WEB_TRIM, measured: that -3 dB takes 3 dB off the output and 0 gives it
// back exactly, that the change glides (nothing a listener would hear as a step
// in the chord when a web part is muted or soloed), and that a positive number,
// which the page never sends, cannot make the master louder.
//
// The compressor and limiter are set neutral (the "master off" numbers) so the
// only thing between the tone and the output is the volume and the trim.
#include "master.h"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace modsynth;

static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.6g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}

int main() {
  const double SR = 48000, PI = 3.14159265358979323846;
  const int N = 128;
  MasterBus m(SR);
  m.set(MB_VOL, 1.0); m.set(MB_CMP_TH, 0); m.set(MB_CMP_RATIO, 1);
  m.set(MB_LIM_TH, 0); m.set(MB_LIM_RATIO, 1); m.set(MB_REV_SEND, 0);
  m.set(MB_DRV_AMT, 0); m.set(MB_DRV_OUT, 4.0);   // kSpan: drive off is unity

  std::vector<float> L(N), R(N), z(N, 0.f);
  long t = 0;
  // One block of a 220 Hz tone through the bus; returns its peak.
  auto block = [&]() {
    for (int i = 0; i < N; i++, t++) L[i] = R[i] = (float)(0.25 * std::sin(2 * PI * 220 * t / SR));
    m.process(L.data(), R.data(), z.data(), z.data(), N);
    double pk = 0;
    for (int i = 0; i < N; i++) pk = std::fmax(pk, std::fabs((double)L[i]));
    return pk;
  };
  auto settle = [&](double sec) { double pk = 0; for (int b = 0; b < (int)(sec * SR / N); b++) pk = block(); return pk; };

  const double base = settle(1.0);
  check(std::fabs(20 * std::log10(base / 0.25)) < 0.1, "with no trim the tone passes at its own level", base);

  // Step to -3 dB and watch the peak per block until it gets there.
  m.set(MB_WEB_TRIM, -3);
  double first = block(), prev = first, worstStepDb = std::fabs(20 * std::log10(first / base));
  int blocksTo90 = -1;
  for (int b = 1; b < 4 * (int)(SR / N); b++) {
    const double pk = block();
    worstStepDb = std::fmax(worstStepDb, std::fabs(20 * std::log10(pk / prev)));
    // 90% of the way down in dB: -2.7 dB.
    if (blocksTo90 < 0 && 20 * std::log10(pk / base) < -2.7) blocksTo90 = b;
    prev = pk;
  }
  const double trimmed = settle(0.5);
  check(std::fabs(20 * std::log10(trimmed / base) + 3.0) < 0.05, "-3 dB takes 3 dB off", 20 * std::log10(trimmed / base));
  check(worstStepDb < 0.35, "and does it gradually: no block steps by more than 0.35 dB", worstStepDb);
  const double ms90 = (blocksTo90 + 1) * N / SR * 1000;
  check(ms90 > 100 && ms90 < 500, "it is 90% there between 100 and 500 ms", ms90);

  m.set(MB_WEB_TRIM, 0);
  const double back = settle(2.0);
  check(std::fabs(back / base - 1.0) < 0.002, "0 gives the level back", 20 * std::log10(back / base));

  m.set(MB_WEB_TRIM, +6);
  const double pos = settle(2.0);
  check(pos <= base * 1.002, "a positive trim is ignored, not a boost", 20 * std::log10(pos / base));

  printf("%s\n", fails ? "trimtest FAILED" : "trimtest ok");
  return fails ? 1 : 0;
}
