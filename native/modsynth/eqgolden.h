// Three-band EQ scenarios that only use the parameters the three-band EQ had, and
// a hash of what comes out. The hashes in eqtest.cpp were recorded from the engine
// before the EQ grew (commit 98058de: `git archive` it, build this file against
// that tree, print), so a pass here means a song saved before the five- and
// six-band EQ sounds the same to the bit now: the shelves at their old corners, the
// peak at Q 0.9, the filters off. Run again against a changed engine it says
// whether anything it does to those three bands moved.
#pragma once
#include "master.h"
#include "mixfx.h"
#include <cmath>
#include <cstdint>
#include <vector>

namespace eqgolden {

struct Hash {
  uint64_t h = 1469598103934665603ull;
  void add(float f) { uint32_t u; static_assert(sizeof u == sizeof f, ""); __builtin_memcpy(&u, &f, 4); for (int i = 0; i < 4; i++) { h ^= (u >> (8 * i)) & 0xff; h *= 1099511628211ull; } }
};

// A fixed input: two tones and some noise from a counter-driven generator (no rand(),
// so every machine sees the same numbers).
inline void input(std::vector<float>& L, std::vector<float>& R, int N) {
  L.resize((size_t)N); R.resize((size_t)N);
  uint32_t x = 12345;
  for (int i = 0; i < N; i++) {
    x = x * 1664525u + 1013904223u;
    const double nz = ((int32_t)x / 2147483648.0) * 0.05;
    L[(size_t)i] = (float)(0.25 * std::sin(0.031 * i) + 0.15 * std::sin(0.7 * i) + nz);
    R[(size_t)i] = (float)(0.2 * std::sin(0.047 * i) + 0.1 * std::sin(1.3 * i) - nz);
  }
}

// One part's strip: the three bands set, moved part-way through, then cleared.
inline uint64_t strip(bool chainIn) {
  const int N = 48000;
  modsynth::MixFx m(48000.0);
  m.set(modsynth::MFX_ACTIVE, chainIn ? 1 : 0);
  m.set(modsynth::MFX_TAU, 0.01);
  std::vector<float> L, R; input(L, R, N);
  Hash h;
  for (int off = 0; off < N; off += 128) {
    const int b = off / 128;
    if (b == 0) { m.set(modsynth::MFX_EQ_LO, 5); m.set(modsynth::MFX_EQ_MID, -4); m.set(modsynth::MFX_EQ_MID_HZ, 2500); m.set(modsynth::MFX_EQ_HI, 3); }
    if (b == 120) { m.set(modsynth::MFX_EQ_MID, 7); m.set(modsynth::MFX_EQ_MID_HZ, 900); m.set(modsynth::MFX_EQ_LO, -6); }
    if (b == 260) { m.set(modsynth::MFX_EQ_HI, 0); m.set(modsynth::MFX_EQ_MID, 0); }
    if (b == 330) { m.set(modsynth::MFX_EQ_LO, 0); }
    const int n = std::min(128, N - off);
    m.process(L.data() + off, R.data() + off, n);
  }
  for (int i = 0; i < N; i++) { h.add(L[(size_t)i]); h.add(R[(size_t)i]); }
  return h.h;
}

// The master bus: the same three bands, the same kind of moves.
inline uint64_t master() {
  const int N = 48000;
  modsynth::MasterBus m(48000.0);
  std::vector<float> L, R, z((size_t)N, 0.f); input(L, R, N);
  Hash h;
  for (int off = 0; off < N; off += 128) {
    const int b = off / 128;
    if (b == 0) { m.set(modsynth::MB_EQ_LO, -3); m.set(modsynth::MB_EQ_MID, 6); m.set(modsynth::MB_EQ_MID_HZ, 700); m.set(modsynth::MB_EQ_HI, -5); }
    if (b == 120) { m.set(modsynth::MB_EQ_MID, -2); m.set(modsynth::MB_EQ_MID_HZ, 3100); m.set(modsynth::MB_EQ_LO, 4); }
    if (b == 260) { m.set(modsynth::MB_EQ_HI, 0); m.set(modsynth::MB_EQ_MID, 0); }
    if (b == 330) { m.set(modsynth::MB_EQ_LO, 0); }
    const int n = std::min(128, N - off);
    m.process(L.data() + off, R.data() + off, z.data() + off, z.data() + off, n);
  }
  for (int i = 0; i < N; i++) { h.add(L[(size_t)i]); h.add(R[(size_t)i]); }
  return h.h;
}

}  // namespace eqgolden
