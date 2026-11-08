// The engine's tempo map (tempomap.h) and the three sequencers' use of it. Pure C++, no page: what the map must be (a constant stretch is
// bit-for-bit the old arithmetic; beats and frames are each other's inverse; a ramp is linear in time, which is the page's ritardando, bpm
// squared linear in beats) and what the sequencers must do with it (the same steps as before at a constant tempo; through a jump and a
// ramp the drums, the bass at twice the speed and the chord rhythm stay on one grid).
//   tempotest
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "basscore.h"
#include "chordcore.h"
#include "seqcore.h"
#include "tempomap.h"

static int fails = 0;
#define CHECK(c, ...) do { if (!(c)) { fails++; printf("FAIL "); } else printf("ok   "); printf(__VA_ARGS__); printf("\n"); } while (0)

static const double SR = 48000;

int main() {
  using namespace modsynth;

  // A constant stretch is the old arithmetic, bit for bit.
  {
    TempoMap m(SR, 120);
    size_t bad = 0, n = 0;
    for (double bpm : {40.0, 61.0, 99.5, 120.0, 133.0, 187.25, 220.0}) for (double rate : {0.5, 1.0, 2.0, 3.0}) {
      m.reset(bpm, 0);
      for (double f : {0.0, 1.0, 4800.0, 123456.789, 9.9e6}) {
        n++;
        if (m.span(f, 0.25 * rate) != (60.0 / bpm / 4.0 * rate) * SR) bad++;
      }
    }
    CHECK(bad == 0, "a constant tempo gives the old step length exactly (%zu of %zu differ)", bad, n);
  }

  // Beats and frames are each other's inverse, through jumps and ramps.
  {
    TempoMap m(SR, 100);
    m.jump(48000, 140);
    m.ramp(144000, 66, 96000);
    m.jump(400000, 90);
    m.ramp(500000, 150, 48000);
    double worst = 0;
    for (double f = 0; f < 800000; f += 997.3) worst = std::max(worst, std::fabs(m.frameAt(m.beatAt(f)) - f));
    CHECK(worst < 1e-6, "frameAt(beatAt(f)) = f through two jumps and two ramps (worst %.2g frames)", worst);
    // against a numerical integral of the tempo
    double b = 0, f = 0; const double dt = 1.0;
    double werr = 0;
    for (; f < 800000; f += dt) { b += m.bpmAt(f + dt * 0.5) / (60.0 * SR) * dt; if (std::fmod(f, 20000) < dt) werr = std::max(werr, std::fabs(b - m.beatAt(f + dt))); }
    CHECK(werr < 1e-4, "beatAt agrees with the integral of the tempo (worst %.2g beats)", werr);
  }

  // The ramp is the page's ritardando: bpm^2 falls linearly with the beats.
  {
    TempoMap m(SR, 120);
    m.ramp(10000, 66, 150000);
    const double b0 = m.beatAt(10000), a = 120.0 * 120.0;
    double lo = 1e9, hi = -1e9;
    for (int i = 1; i <= 20; i++) {
      const double f = 10000 + 150000.0 * i / 20.0, db = m.beatAt(f) - b0;
      const double k = (m.bpmAt(f) * m.bpmAt(f) - a) / db;
      lo = std::min(lo, k); hi = std::max(hi, k);
    }
    CHECK(std::fabs(hi - lo) < 1e-6 * std::fabs(lo), "through a ramp, bpm^2 is linear in the beats (slope %.6f to %.6f)", lo, hi);
    CHECK(std::fabs(m.bpmAt(10000 + 75000) - 93.0) < 1e-9 && std::fabs(m.bpmAt(200000) - 66.0) < 1e-12, "and the tempo is linear in time: 93 halfway, 66 after");
  }

  // A step that straddles a jump covers exactly a quarter note.
  {
    TempoMap m(SR, 120);
    m.jump(10000, 60);
    double worst = 0;
    for (double f = 9000; f < 11000; f += 37.1) worst = std::max(worst, std::fabs(m.beatAt(f + m.span(f, 0.25)) - m.beatAt(f) - 0.25));
    CHECK(worst < 1e-12, "a step across a jump is a quarter note (worst %.2g beats)", worst);
    const double before = m.span(0, 0.25), after = m.span(20000, 0.25);
    CHECK(before == (60.0 / 120 * 0.25) * SR && after == (60.0 / 60 * 0.25) * SR, "before it a step is %.0f frames, after it %.0f", before, after);
  }

  // The sequencers: at a constant tempo a map changes nothing.
  {
    const int N = 400;
    std::vector<double> a, b;
    for (int pass = 0; pass < 2; pass++) {
      TempoMap m(SR, 133);
      std::vector<double> &out = pass ? b : a;
      DrumSequencer d(SR); d.setTempo(133); d.setRate(1.5); if (pass) d.setTempoMap(&m);
      DrumScore sc; sc.steps = 16; d.setScore(sc); d.start(5000);
      d.run(5000 + N * 9000.0, [](const DrumEvent &) {}, [](const BarMark &) {}, [&](int, int, double f) { out.push_back(f); });
      BassSequencer q(SR); q.setTempo(133); q.setRate(2); if (pass) q.setTempoMap(&m);
      q.start(5000);
      for (int i = 0; i < N; i++) { out.push_back(q.nextFrame()); q.run(q.nextFrame() + 1, [](const BassEvent &) {}); }
      ChordSequencer c(SR); c.setTempo(133); if (pass) c.setTempoMap(&m);
      ChordScore cs; cs.steps = 16; c.setScore(cs); c.start(5000);
      for (int i = 0; i < N; i++) { out.push_back(c.nextFrame()); c.run(c.nextFrame() + 1, [](const ChordEvent &) {}); }
    }
    size_t bad = 0; for (size_t i = 0; i < a.size(); i++) if (a[i] != b[i]) bad++;
    CHECK(a.size() == b.size() && a.size() > 3 * N - 5 && bad == 0, "drums, bass and chord rhythm step to the same frames with a constant map as without one (%zu of %zu differ)", bad, a.size());
  }

  // And through a jump and a ritardando they stay on one grid: the drums, the bass at rate 2 and the chord rhythm.
  {
    const int N = 400;
    TempoMap m(SR, 120);
    const double first = 24000;
    m.jump(first + 100000, 96);                       // a jump (the trainer's step) ...
    m.ramp(first + 400000, 66, 200000);               // ... and a ritardando
    m.jump(first + 700000, 110);
    std::vector<double> D, B, C;
    DrumSequencer d(SR); d.setTempoMap(&m); DrumScore sc; sc.steps = 16; d.setScore(sc); d.start(first);
    d.run(first + 3.0e6, [](const DrumEvent &) {}, [](const BarMark &) {}, [&](int, int, double f) { D.push_back(f); });
    // blRateMul scales the step LENGTH: 0.5 is twice as fast
    BassSequencer q(SR); q.setRate(0.5); q.setTempoMap(&m); q.start(first);
    while (B.size() < 2 * D.size()) { B.push_back(q.nextFrame()); q.run(q.nextFrame() + 1, [](const BassEvent &) {}); }
    ChordSequencer c(SR); c.setTempoMap(&m); ChordScore cs; cs.steps = 16; c.setScore(cs); c.start(first);
    while (C.size() < D.size()) { C.push_back(c.nextFrame()); c.run(c.nextFrame() + 1, [](const ChordEvent &) {}); }
    double wB = 0, wC = 0, wG = 0;
    for (size_t n = 0; n < D.size(); n++) {
      wB = std::max(wB, std::fabs(B[2 * n] - D[n]));
      wC = std::max(wC, std::fabs(C[n] - D[n]));
      wG = std::max(wG, std::fabs(D[n] - m.frameAt(m.beatAt(first) + 0.25 * (double)n)));
    }
    CHECK(D.size() > (size_t)N && wB < 1e-6 && wC < 1e-6, "%zu steps: the bass (twice as fast) and the chord rhythm sit on the drums' steps through a jump and a ritardando (worst %.2g, %.2g frames)", D.size(), wB, wC);
    CHECK(wG < 1e-5, "and every step is the map's own grid, a quarter beat apart (worst %.2g frames)", wG);
    // the page-style constant tempo would have drifted off it: the map matters
    DrumSequencer d0(SR); d0.setTempo(120); d0.setScore(sc); d0.start(first);
    std::vector<double> D0; d0.run(first + 3.0e6, [](const DrumEvent &) {}, [](const BarMark &) {}, [&](int, int, double f) { D0.push_back(f); });
    size_t differ = 0; for (size_t n = 0; n < std::min(D.size(), D0.size()); n++) if (std::fabs(D[n] - D0[n]) > 1) differ++;
    CHECK(differ > D0.size() / 2, "a constant tempo is not that grid (%zu of %zu steps differ)", differ, D0.size());
  }

  // The bar line the walking line snaps to follows the map.
  {
    TempoMap m(SR, 120); m.ramp(1000, 80, 100000);
    DrumSequencer d(SR); d.setTempoMap(&m); DrumScore sc; sc.steps = 16; d.setScore(sc); d.start(1000);
    d.run(1000 + 20 * 6000.0, [](const DrumEvent &) {}, [](const BarMark &) {}, [](int, int, double) {});
    const double bar = d.nextBarFrame(), nf = d.nextFrame();
    const int toBar = (16 - d.step() % 16) % 16;
    CHECK(std::fabs(m.beatAt(bar) - m.beatAt(nf) - 0.25 * toBar) < 1e-9, "nextBarFrame is %d sixteenths of the map ahead of the next step", toBar);
  }

  printf(fails ? "\n%d FAILED\n" : "\nall passed\n", fails);
  return fails ? 1 : 0;
}
