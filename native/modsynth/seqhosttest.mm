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

    // Three seconds. At 120 BPM a step is 6000 frames; the first is 4800 frames out and the thread works 7200 ahead.
    run(h, 1500);
    NSDictionary *m1 = [h seqMirror];
    run(h, 1500);
    NSDictionary *m2 = [h seqMirror];
    const double first = [m2[@"firstFrame"] doubleValue], frame = [m2[@"frame"] doubleValue];
    const int steps = [m2[@"steps"] intValue];
    const int expect = (int)std::ceil((frame + 7200 - first) / 6000.0);
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

    // The bank: with no voice recorded every event is a miss, counted and not a crash.
    {
      NSDictionary *m = [h seqMirror];
      CHECK([m[@"misses"] intValue] == [m[@"events"] intValue] && [m[@"hits"] intValue] == 0, "no voice in the bank: all %d events are misses, none begun", [m[@"events"] intValue]);
      NSArray *lm = m[@"lastMiss"];
      CHECK([lm[0] intValue] == 0 && [lm[1] intValue] == 0, "and the last miss names the voice (part %d kit %d lane %d)", [lm[0] intValue], [lm[1] intValue], [lm[2] intValue]);
    }

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

    // A bank with voices in it: lanes 0 and 1 of kit 0 get a short sine each, on the drum bus (code 5), so the sequencer's
    // events become voices in the pool and are heard. The program's amplitude slot follows velocity (b = 1 on a unit gain).
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      auto entry = [&](int lane, double hz) {
        std::vector<double> p = {0x6d6f6467, SR, 3, 0};
        const double stop = 0.048 + 0.06, amp = 0.5;
        p.push_back(8); p.push_back(5);
        p.push_back(2); p.push_back(0); p.push_back(0); p.push_back(stop);
        p.push_back(hz); p.push_back(0); p.push_back(0); p.push_back(0);
        p.push_back(1); p.push_back(amp); p.push_back(0);
        p.push_back(2);
        p.push_back(1); p.push_back(2); p.push_back(-1);
        p.push_back(2); p.push_back(0); p.push_back(-1);
        // the amplitude is the slot after "1, " in the gain node: find it by value (0.5 at 0.9 reference velocity -> b = 0.5/0.9)
        size_t amp_i = 0; for (size_t i = 0; i < p.size(); i++) if (p[i] == amp) amp_i = i;
        std::vector<double> e = {1, 0, 0, (double)lane, 1, 0.048, 0.048, 0.9, (double)p.size()};
        e.insert(e.end(), p.begin(), p.end());
        e.push_back(1); e.push_back((double)amp_i); e.push_back(amp / 0.9); e.push_back(0);   // vel
        e.push_back(0); e.push_back(0);                                                          // accent, pitch
        e.push_back(1); e.push_back(3.0 + 0);                                                    // time: the osc stop (index 7 is stop; use the real one below)
        return e;
      };
      auto e0 = entry(0, 330), e1 = entry(1, 660);
      // time slots: the stop time of the osc is at index 4+4+... find it: the first occurrence of 0.108.
      for (auto *e : {&e0, &e1}) {
        size_t n = (size_t)(*e)[8], at = 9; size_t stopi = 0;
        for (size_t i = 0; i < n; i++) if (std::fabs((*e)[at + i] - 0.108) < 1e-12) stopi = i;
        e->back() = (double)stopi;
        e->push_back(0);                                                                         // mul list
      }
      CHECK([g seqPutBankEntry:bytes(e0)] && [g seqPutBankEntry:bytes(e1)], "two bank entries are taken");
      CHECK(![g seqPutBankEntry:[NSData dataWithBytes:"junk" length:8]], "a bank entry that does not parse is refused");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      std::vector<float> l(240), r(240); float peak = 0; int maxVoices = 0;
      for (int t = 0; t < 1500; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        maxVoices = std::max(maxVoices, [g graphStats][@"voices"] ? [[g graphStats][@"voices"] intValue] : 0);
        usleep(5000);
      }
      NSDictionary *m = [g seqMirror];
      CHECK([m[@"hits"] intValue] > 0 && [m[@"refused"] intValue] == 0, "events with a voice in the bank are begun: %d hits, %d refused", [m[@"hits"] intValue], [m[@"refused"] intValue]);
      CHECK([m[@"hits"] intValue] + [m[@"misses"] intValue] + [m[@"silent"] intValue] == [m[@"events"] intValue], "every event is a hit, a miss or silent (%d + %d + %d = %d)", [m[@"hits"] intValue], [m[@"misses"] intValue], [m[@"silent"] intValue], [m[@"events"] intValue]);
      CHECK(maxVoices > 0 && peak > 0.05f, "and they sound: up to %d voices, peak %.3f, with no page", maxVoices, peak);
      CHECK([m[@"lateStarts"] intValue] == 0 && [m[@"late"] intValue] == 0, "none began later than its lead allowed (late starts %d, late steps %d)", [m[@"lateStarts"] intValue], [m[@"late"] intValue]);
      [g seqStop];
    }

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
