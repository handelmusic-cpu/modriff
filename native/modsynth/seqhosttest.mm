// The native sequencer through the real host (ModEngineHost.mm), off the audio graph: the host's own thread steps
// the drum grid on the render clock with no page anywhere, to the events seqcore.h makes standalone, the playhead
// mirror follows what the render clock has reached, and it stops when the render clock does.
//   make seqhosttest && ./seqhosttest
// The render callback is stood in for by renderInto in a loop paced like the real one (a 240-frame block every 5 ms).
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <cmath>
#include <vector>
#include <unistd.h>
#include "seqcore.h"

static const double SR = 48000;
static int failed = 0;
#define CHECK(c, ...) do { const bool ok_ = (c); if (!ok_) failed++; printf("%s ", ok_ ? "ok  " : "FAIL"); printf(__VA_ARGS__); printf("\n"); } while (0)

// The score layout of seqcore.cpp: 16 steps, lane 0 an accent on step 0 and hits on 4, 8, 12; lane 1 a hit every
// step at probability 100 (always); the second layer off.
static std::vector<double> score() {
  std::vector<double> d = {1, 16, 0, 1, 4, 16, 1, 1, 0, 1, 1, 0.5, 14, 0.28, 18, 0, 0};
  auto cell = [&](double v) { d.insert(d.end(), {v, 0, 0, 1, 1, 0, 0}); };
  d.insert(d.end(), {1, 0, 0, 2});
  d.insert(d.end(), {0.8, 0, 1, 0, 0, 16});
  for (int s = 0; s < 16; s++) cell(s == 0 ? 2 : (s % 4 == 0 ? 1 : 0));
  d.insert(d.end(), {0.6, 0, 1, 0, 0, 16});
  for (int s = 0; s < 16; s++) cell(1);
  d.insert(d.end(), {0, 1, 1, 0});
  return d;
}
static NSData *bytes(const std::vector<double> &d) { return [NSData dataWithBytes:d.data() length:d.size() * sizeof(double)]; }

static ModEngineHost *fresh() { return [[ModEngineHost alloc] initWithSampleRate:SR maxFrames:4096]; }

// Renders `ms` of silence paced like a real callback.
static void run(ModEngineHost *h, int ms) {
  std::vector<float> l(240), r(240);
  for (int t = 0; t < ms; t += 5) { [h renderInto:l.data() right:r.data() frames:240]; usleep(5000); }
}

int main() {
  @autoreleasepool {
    ModEngineHost *h = fresh();
    CHECK(![h seqStartWithBpm:120 rate:1 leadMs:100 seed:1], "no score, no start");
    CHECK(![h seqSetDrumScore:[NSData dataWithBytes:"junk" length:4]], "a score that does not parse is refused");
    CHECK([h seqSetDrumScore:bytes(score())], "the score is taken");
    [h seqRecord:YES capacity:20000];
    CHECK([h seqStartWithBpm:120 rate:1 leadMs:100 seed:7], "start");

    // Three seconds. At 120 BPM a step is 6000 frames; the first is 4800 frames out and the thread works 4800 ahead.
    run(h, 1500);
    NSDictionary *m1 = [h seqMirror];
    run(h, 1500);
    NSDictionary *m2 = [h seqMirror];
    const double first = [m2[@"firstFrame"] doubleValue], frame = [m2[@"frame"] doubleValue];
    const int steps = [m2[@"steps"] intValue];
    const int expect = (int)std::ceil((frame + 4800 - first) / 6000.0);
    CHECK(steps >= expect - 1 && steps <= expect + 1, "steps fired %d, expected about %d for %.0f frames of render clock", steps, expect, frame);
    CHECK([m2[@"late"] intValue] == 0, "no step was expanded after its moment (late %d)", [m2[@"late"] intValue]);
    CHECK([m1[@"steps"] intValue] > 0 && [m2[@"steps"] intValue] > [m1[@"steps"] intValue], "steps advance between two looks (%d then %d)", [m1[@"steps"] intValue], [m2[@"steps"] intValue]);
    // The playhead is the last step whose moment the render clock has reached.
    const int wantStep = frame < first ? -1 : (int)std::floor((frame - first) / 6000.0) % 16;
    CHECK([m2[@"step"] intValue] == wantStep, "playhead step %d, render clock says %d", [m2[@"step"] intValue], wantStep);
    CHECK([m2[@"running"] boolValue], "running");

    // Events: the same list the core makes alone.
    NSData *ev = [h seqTakeEvents];
    const size_t n = ev.length / sizeof(double) / 13;
    const double *e = (const double *)ev.bytes;
    modsynth::DrumScore sc; auto d = score(); sc.fromDoubles(d.data(), d.size());
    modsynth::DrumSequencer q(SR); q.setScore(sc); q.setTempo(120); q.start(first);
    std::vector<modsynth::DrumEvent> ref;
    while (ref.size() < n) q.run(q.nextFrame() + 1, [&](const modsynth::DrumEvent &x) { ref.push_back(x); }, [](const modsynth::BarMark &) {});
    bool same = n > 0 && ref.size() >= n;
    for (size_t i = 0; same && i < n; i++) {
      const double *x = e + i * 13; const auto &r = ref[i];
      if (x[0] != r.frameExact || (int)x[4] != r.lane || x[5] != r.vel || (x[6] != 0) != r.accent || (int)x[12] != r.bar) same = false;
    }
    CHECK(same, "%zu events, identical to the core run alone from the same first frame", n);

    // Tempo: from the next step on, steps are 12000 frames apart.
    [h seqTakeEvents];
    [h seqSetTempo:60 rate:0];
    run(h, 1000);
    ev = [h seqTakeEvents];
    const size_t n2 = ev.length / sizeof(double) / 13; const double *e2 = (const double *)ev.bytes;
    double gap = 0; for (size_t i = 1; i < n2; i++) if (e2[i * 13 + 11] != e2[(i - 1) * 13 + 11]) { gap = e2[i * 13] - e2[(i - 1) * 13]; break; }
    CHECK(n2 > 0 && std::fabs(gap - 12000) < 1e-6, "after tempo 60 the steps are %.0f frames apart", gap);

    // The render clock stops: so does the sequencer (no new steps while nothing renders).
    usleep(150000);
    const int before = [[h seqMirror][@"steps"] intValue];
    usleep(400000);
    const int after = [[h seqMirror][@"steps"] intValue];
    CHECK(after == before, "with the render clock stopped the sequencer stands still (%d, %d)", before, after);

    // Stop: nothing more even when the clock runs.
    [h seqStop];
    const int s0 = [[h seqMirror][@"steps"] intValue];
    run(h, 500);
    NSDictionary *m3 = [h seqMirror];
    CHECK(![m3[@"running"] boolValue] && [m3[@"steps"] intValue] == s0, "stopped: still %d steps", [m3[@"steps"] intValue]);
    h = nil;   // the thread is joined by the host going away; a hang here fails the run
    CHECK(true, "the host goes away with its thread");
  }
  printf(failed ? "\n%d FAILED\n" : "\nall passed\n", failed);
  return failed ? 1 : 0;
}
