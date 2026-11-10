// The native sequencer through the real host (ModEngineHost.mm), off the audio graph: the host's own thread steps
// the drum grid on the render clock with no page anywhere, to the events seqcore.h makes standalone, the playhead
// mirror follows what the render clock has reached, and it stops when the render clock does.
//   make seqhosttest && ./seqhosttest
// The render callback is stood in for by renderInto in a loop paced like the real one (a 240-frame block every 5 ms).
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <cmath>
#include <set>
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

// A synthetic one-note chord for a pitch (part 3: a tone that is one oscillator and a gain, no sub; part 4, the same held, with its release).
// `life`: seconds the voice would sound if nothing stopped it.
static std::vector<double> chordNoteEntry(int pitch, bool hold, double life = 1.5) {
  std::vector<double> p = {0x6d6f6467, SR, 3, 0};
  const double stop = 0.048 + life, amp = 0.5;
  p.insert(p.end(), {8, 5, 2, 0, 0, stop, 220, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
  size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
  std::vector<double> e = {1, hold ? 4.0 : 3.0, 9, (double)pitch, 1, 0.048, 0.048, 0.8, (double)p.size()};
  e.insert(e.end(), p.begin(), p.end());
  e.insert(e.end(), {1, (double)amp_i, amp / 0.8, 0, 0, 0, 1, (double)stop_i, 0});       // velocity, accent, pitch; time; mul
  e.insert(e.end(), {0, 0});                                                            // no chokes, no floors
  e.insert(e.end(), {(double)pitch, life, 0, 0, 0, 0});                                  // refPitch, refDur, refFrom, no length, glide or held slots
  e.insert(e.end(), {12, 2, 0, 5, 0, 0, 0,  2, 0, 1, 0, 0.022, 0});                     // the stop of the chord before: hold the gain, fade it
  e.insert(e.end(), {1, (double)amp_i, 0, -1, 0, 1, (double)stop_i, (double)stop_i, 1}); // chord block: level slot; no times; no panner; no sub; the tone's source
  e.insert(e.end(), {0});                                                               // no velocity curve
  // the release of a held chord: no sooner than 45 ms after the voice began; hold the gain, fall in 100 ms
  if (hold) e.insert(e.end(), {0.045, 12, 2, 0, 5, 0, 0, 0,  2, 0, 1, 0, 0.1, 0});
  return e;
}


// A synthetic arp voice (bank part 5): a sine on the arp bus (code 4) that sounds `life` seconds from a lead of 0.048, with a level slot that follows the velocity.
// lane 0 is the note's first regime of length (any length), lane 16 the block's tone. The layout is voicebank.h's, with the arp's tail: refLevel, no level slots, durMax, refPan, no pan slots.
static std::vector<double> arpEntry(int kit, int lane, double life) {
  std::vector<double> p = {0x6d6f6467, SR, 3, 0};
  const double stop = 0.048 + life, amp = 0.5;
  p.insert(p.end(), {8, 4, 2, 0, 0, stop, 330, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
  size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
  std::vector<double> e = {1, 5, (double)kit, (double)lane, 1, 0.048, 0.048, 0.8, (double)p.size()};
  e.insert(e.end(), p.begin(), p.end());
  e.insert(e.end(), {1, (double)amp_i, amp / 0.8, 0, 0, 0, 1, (double)stop_i, 0});       // velocity, accent, pitch; time; mul
  e.insert(e.end(), {0, 0});                                                            // no chokes, no floors
  e.insert(e.end(), {60, life, 0, 0, 0, 0});                                             // refPitch, refDur, refFrom, no length, glide or held slots
  e.insert(e.end(), {0});                                                               // no cut of the note before
  e.insert(e.end(), {0, 0, -1, 0, 0, 0});                                               // the chord block's lists (none), no velocity curve
  e.insert(e.end(), {0, 0});                                                            // no release
  e.insert(e.end(), {1, 0, 1e9, 0, 0});                                                 // refLevel, no level slots, durMax, refPan, no pan slots
  return e;
}
// The arp's score (arpcore.h): `pattern` 0 up .. 6 block, a sixteenth rate, an even gate, no motion, no humanize, `octaves`.
static std::vector<double> arpScore(int pattern, int octaves) {
  return {1, (double)pattern, 4, 0, 0.15, 0.5, 2, 0, 1, 0,  1, 1,  1, 0,  0,  2,  0, 0, 0, 0, 0, 0, 0, 0, (double)octaves};
}

// A synthetic melody voice (bank part 6): a sine on the melody generator's bus (code 2) that sounds `life` seconds from a lead of 0.048, with a level slot that follows the velocity.
// lane 0 is the plain note's first regime of length (any length). The layout is voicebank.h's, with the arp's tail and the melody's: refLevel, no level slots, durMax, refPan, no pan
// slots, refGtime, no slide-time slots.
static std::vector<double> melEntry(int kit, int lane, double life) {
  std::vector<double> p = {0x6d6f6467, SR, 3, 0};
  const double stop = 0.048 + life, amp = 0.5;
  p.insert(p.end(), {8, 2, 2, 0, 0, stop, 440, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
  size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
  std::vector<double> e = {1, 6, (double)kit, (double)lane, 1, 0.048, 0.048, 0.5, (double)p.size()};
  e.insert(e.end(), p.begin(), p.end());
  e.insert(e.end(), {1, (double)amp_i, amp / 0.5, 0, 0, 0, 1, (double)stop_i, 0});       // velocity, accent, pitch; time; mul
  e.insert(e.end(), {0, 0});                                                            // no chokes, no floors
  e.insert(e.end(), {66, life, 0, 0, 0, 0});                                             // refPitch, refDur, refFrom, no length, glide or held slots
  e.insert(e.end(), {0});                                                               // no cut of the note before
  e.insert(e.end(), {0, 0, -1, 0, 0, 0});                                               // the chord block's lists (none), no velocity curve
  e.insert(e.end(), {0, 0});                                                            // no release
  e.insert(e.end(), {1, 0, 1e9, 0, 0, 0.06, 0});                                        // refLevel, no level slots, durMax, refPan, no pan slots, refGtime, no slide-time slots
  return e;
}
// The melody generator's line (melcore.h): `cells` are {v, note, oct, len, more...}; Follow, written over a major triad on C in C major, 70 % level, no humanize, glide on.
struct MelCellSpec { int v, note, oct, len; std::vector<std::pair<int, int>> more; };
static std::vector<double> melScore(bool follow, const std::vector<MelCellSpec> &cells) {
  std::vector<double> d = {1, (double)cells.size(), 0, 1, follow ? 1.0 : 0.0, 0, 3, 0, 4, 7, 7, 0, 2, 4, 5, 7, 9, 11, 0.7,  0, 1, 1, 1, 14, 0.28, 18, 0,  1, 0.12, 1, (double)cells.size()};
  for (const MelCellSpec &c : cells) {
    d.insert(d.end(), {(double)c.v, (double)c.note, (double)c.oct, (double)c.len, 0, 0, 0, 0, (double)c.more.size()});
    for (const auto &m : c.more) { d.push_back(m.first); d.push_back(m.second); }
  }
  return d;
}

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

    // A ramp: the tempo goes from 60 up to 120 over 1.2 s and holds; the steps get closer, from 12000 frames apart to 6000, and the mirror says the tempo.
    {
      [h seqSetTempo:60 rate:0];
      run(h, 300);
      [h seqTakeEvents];
      NSDictionary *m0 = [h seqMirror];
      CHECK(std::fabs([m0[@"tempo"] doubleValue] - 60) < 1e-9, "the mirror says the tempo: %.2f", [m0[@"tempo"] doubleValue]);
      [h seqTempoRampTo:120 overMs:1200];
      run(h, 2000);
      NSData *evr = [h seqTakeEvents];
      const size_t nr = evr.length / sizeof(double) / 13; const double *er = (const double *)evr.bytes;
      std::vector<double> gaps;
      for (size_t i = 1; i < nr; i++) if (er[i * 13 + 11] != er[(i - 1) * 13 + 11]) gaps.push_back(er[i * 13] - er[(i - 1) * 13]);
      bool mono = gaps.size() > 8; double lo = 1e18, hi = 0;
      for (size_t i = 0; i < gaps.size(); i++) { if (i && gaps[i] > gaps[i - 1] + 1e-6) mono = false; lo = std::min(lo, gaps[i]); hi = std::max(hi, gaps[i]); }
      // events of one step share a frame; steps with no event leave no gap, so only the extremes are held to the numbers
      CHECK(mono && hi > 8000 && std::fabs(lo - 6000) < 1e-6, "through the ramp the steps close in monotonically (%zu gaps, from about %.0f to %.0f frames)", gaps.size(), hi, lo);
      CHECK(std::fabs([[h seqMirror][@"tempo"] doubleValue] - 120) < 1e-9, "and it holds 120");
      CHECK([[h graphStats][@"lateEdits"] intValue] == 0, "no late edit");
    }

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
      double stopAt = 0;
      auto entry = [&](int lane, double hz, double dur = 0.06) {
        std::vector<double> p = {0x6d6f6467, SR, 3, 0};
        const double stop = 0.048 + dur, amp = 0.5;
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
        stopAt = stop;
        return e;
      };
      auto e0 = entry(0, 330), e1 = entry(1, 660);
      // time slots: the stop time of the osc is at index 4+4+... find it: the first occurrence of 0.108.
      for (auto *e : {&e0, &e1}) {
        size_t n = (size_t)(*e)[8], at = 9; size_t stopi = 0;
        for (size_t i = 0; i < n; i++) if (std::fabs((*e)[at + i] - 0.108) < 1e-12) stopi = i;   // (the short voices; stopAt is for entry())
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

    // Chokes through the host: lane 0 an open voice that rings for two seconds (step 0), lane 1 a closing hit (step 4, half a
    // second later), both in choke group 1. With lane 1 choking, the open voice is cut by an edit the sequencer thread sends
    // when it begins the closing voice, so what is left a few hundred milliseconds on is the next bar's open voice and
    // nothing of this one; with lane 1 only ringing, the same score keeps the open voice sounding. Three hosts: choking, not choking, and one with the closing hit alone (what the chain leaves of it).
    {
      auto hatScore = [&](bool closes) {
        std::vector<double> d = {1, 16, 0, 1, 4, 16, 1, 1, 0, 1, 1, 0.5, 14, 0.28, 18, 0, 0};
        auto cell = [&](double v) { d.insert(d.end(), {v, 0, 0, 1, 1, 0, 0}); };
        d.insert(d.end(), {1, 0, 0, 2});
        d.insert(d.end(), {0.8, 0, 1, 1, 0, 16});            // lane 0: group 1, does not choke
        for (int s = 0; s < 16; s++) cell(s == 0 ? 1 : 0);
        d.insert(d.end(), {0.6, 0, 1, 1, closes ? 1.0 : 0.0, 16});   // lane 1: group 1, chokes when `closes`
        for (int s = 0; s < 16; s++) cell(s == 4 ? 1 : 0);
        d.insert(d.end(), {0, 1, 1, 0});
        return d;
      };
      // A voice (the short-sine program of the block above) 2 s long, with its choke: hold the gain, fall to nothing over
      // 4 ms (time constant), stop the oscillator 72 ms on; node 1 is the oscillator, node 2 the gain.
      auto voice = [&](int lane, double hz, double dur, bool choke) {
        std::vector<double> p = {0x6d6f6467, SR, 3, 0};
        const double stop = 0.048 + dur, amp = 0.5;
        p.insert(p.end(), {8, 5, 2, 0, 0, stop, hz, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
        size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
        std::vector<double> e = {1, 0, 0, (double)lane, 1, 0.048, 0.048, 0.9, (double)p.size()};
        e.insert(e.end(), p.begin(), p.end());
        e.insert(e.end(), {1, (double)amp_i, amp / 0.9, 0, 0, 0, 1, (double)stop_i, 0});
        if (choke) {
          e.insert(e.end(), {1, dur, 3});
          e.insert(e.end(), {2, 0, 5, 0, 0, 0});            // gain: cancelAndHold at the choke
          e.insert(e.end(), {2, 0, 3, 0.0001, 0, 0.004});   // gain: setTarget 0.0001, tc 4 ms
          e.insert(e.end(), {1, -1, 6, 0, 0.072, 0});       // oscillator: stop 72 ms after
        }
        return e;
      };
      ModEngineHost *A = fresh(), *B = fresh(), *C = fresh();
      NSArray<ModEngineHost *> *hs = @[A, B, C];
      for (int i = 0; i < 3; i++) {
        ModEngineHost *g = hs[i];
        [g ensureGraphPart:5];
        if (i < 2) [g seqPutBankEntry:bytes(voice(0, 330, 2.0, true))];
        [g seqPutBankEntry:bytes(voice(1, 990, 0.04, false))];
        [g seqSetDrumScore:bytes(hatScore(i != 1))];
        [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      }
      std::vector<float> l(240), r(240);
      std::vector<float> pk[3];
      for (int t = 0; t < 2100; t += 5) {
        for (int i = 0; i < 3; i++) {
          [hs[i] renderInto:l.data() right:r.data() frames:240];
          float m = 0; for (int k = 0; k < 240; k++) m = std::max(m, std::max(std::fabs(l[k]), std::fabs(r[k])));
          pk[i].push_back(m);
        }
        usleep(5000);
      }
      const double first = [[A seqMirror][@"firstFrame"] doubleValue];
      // From 150 ms after the closing hit (step 4 = first + 24000 frames) to just before the next bar's open voice begins.
      const size_t b0 = (size_t)((first + 24000 + 7200) / 240), b1 = (size_t)((first + 96000 - 2304 - 480) / 240);   // (a voice sounds from its begin, 2304 frames before its onset)
      float wa = 0, wb = 0, wc = 0; for (size_t k = b0; k < b1 && k < pk[0].size(); k++) { wa = std::max(wa, pk[0][k]); wb = std::max(wb, pk[1][k]); wc = std::max(wc, pk[2][k]); }
      NSDictionary *ma = [A seqMirror], *mb = [B seqMirror];
      CHECK(wb > 0.05f, "without the choke the open voice is still sounding after the closing hit (peak %.4f)", wb);
      // What is left is the chain's own tail after the closing hit's voice (the strip and the bus), which a third host with only
      // the closing hit shows: about as much as the cut leaves.
      CHECK(wa < wb * 0.1f && wa < wc * 4, "with the closing hit choking, the host cut it: peak %.4f against %.4f (%.0f dB down; the closing hit alone leaves %.4f)", wa, wb, 20 * std::log10((wa + 1e-9) / wb), wc);
      CHECK([ma[@"cuts"] intValue] >= 1 && [ma[@"cutEdits"] intValue] >= 1 && [mb[@"cuts"] intValue] == 0, "the cut is counted: %d cuts, %d edits (and %d without the choke)", [ma[@"cuts"] intValue], [ma[@"cutEdits"] intValue], [mb[@"cuts"] intValue]);
      CHECK([ma[@"refused"] intValue] == 0 && [ma[@"late"] intValue] == 0 && [[A graphStats][@"lateEdits"] intValue] == 0, "nothing refused, no late step, no late edit");
      [A seqStop]; [B seqStop];
    }

    // The bass line through the host: the same thread and bank, no page. A synthetic bass voice (one entry per variant: part 2) whose
    // cut of the note before is the hold and a 15 ms fade; a line of a note every step, two steps long, so every note starts inside
    // the tail of the one before and cuts it. Started with the drums running, it shares their downbeat.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      CHECK(![g seqBassStartWithBpm:120 rate:1 leadMs:100 alignToDrums:YES kit:7 seed:1], "no bass score, no bass start");
      CHECK(![g seqSetBassScore:[NSData dataWithBytes:"junk" length:8]], "a bass score that does not parse is refused");
      CHECK(![g seqSetBassChords:[NSData dataWithBytes:"junk" length:8]], "chord windows that do not parse are refused");
      // One note long, sounding for 0.3 s from a lead of 0.048; a level slot; the cut is a hold on the gain (node 2) and a ramp to nothing.
      auto bassVoice = [&](int lane) {
        std::vector<double> p = {0x6d6f6467, SR, 3, 0};
        const double stop = 0.048 + 0.3, amp = 0.5;
        p.insert(p.end(), {8, 5, 2, 0, 0, stop, 110, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
        size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
        std::vector<double> e = {1, 2, 7, (double)lane, 1, 0.048, 0.048, 0.9, (double)p.size()};
        e.insert(e.end(), p.begin(), p.end());
        e.insert(e.end(), {1, (double)amp_i, amp / 0.9, 0, 0, 0, 1, (double)stop_i, 0});   // velocity, accent, pitch; time; mul
        e.insert(e.end(), {0, 0});                                                         // no chokes, no floors
        e.insert(e.end(), {0, -1, 0, 0, 0, 0});                                            // refPitch, refDur, refFrom, no length, glide or held slots
        e.insert(e.end(), {12, 2, 0, 5, 0, 0, 0,  2, 0, 2, 0.0001, 0.015, 0});             // the cut: hold at the new note, fade over 15 ms
        return e;
      };
      for (int lane = 0; lane < 4; lane++) [g seqPutBankEntry:bytes(bassVoice(lane))];
      std::vector<double> bs = {1, 16, 0, 1, 0, 0, 3, 0, 4, 7, 7, 0, 2, 4, 5, 7, 9, 11, 0.7, 0, 1, 1, 0.5, 14, 0.28, 18, 0, 0, 0, 16};
      for (int s2 = 0; s2 < 16; s2++) bs.insert(bs.end(), {1, 0, 2, 2, 0, 0, 0, 0, 0});
      CHECK([g seqSetBassScore:bytes(bs)], "the bass line is taken");
      // Two chart windows (frames from the line's start): C for two bars, then F; the timeline holds them.
      std::vector<double> ch = {2, 0, 192000, 0, 0, -1, 5, 3, 0, 4, 7, -1, 192000, 384000, 0, 5, -1, 0, 3, 5, 9, 0, -1, 0};   // two windows, no lock; no lock table
      // A window can name a phrase lock (the page's frozen line for that chord): a table of one 2-step lock after the windows. One that names a
      // lock the table does not have is refused, and so is a table cut short.
      std::vector<double> chl = {1,  0, 192000, 0, 0, -1, -1, 3, 0, 4, 7, 0,   1,  2, 0,  1, 5, 3, 1, 0, 1, 0, 0, 0,  1, 7, 3, 1, 0, 0, 0, 0, 0};   // 1 window (lock 0); 1 lock: 2 steps, 2 cells
      CHECK([g seqSetBassChords:bytes(chl)], "chord windows with a phrase lock are taken");
      std::vector<double> chBad = chl; chBad[11] = 3;
      CHECK(![g seqSetBassChords:bytes(chBad)], "a window that names a lock the table does not have is refused");
      std::vector<double> chCut(chl.begin(), chl.end() - 4);
      CHECK(![g seqSetBassChords:bytes(chCut)], "a lock table cut short is refused");
      CHECK([g seqSetBassChords:bytes(ch)], "the chord windows are taken");
      // A line written ahead: [1, hasAt, at, steps, cells]. Taken, cleared by a first double that is not 1, refused when cut short or empty.
      std::vector<double> pl = {1, 1, 96000, 2,  1, 5, 3, 1, 0, 0, 0, 0, 0,  0, 0, 3, 1, 0, 0, 0, 0, 0};
      CHECK([g seqSetBassPending:bytes(pl)], "a line written ahead is taken");
      CHECK([g seqSetBassPending:bytes(std::vector<double>{0})], "and cleared");
      CHECK(![g seqSetBassPending:bytes(std::vector<double>(pl.begin(), pl.end() - 5))], "one cut short is refused");
      CHECK(![g seqSetBassPending:[NSData data]], "an empty one is refused");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqBassStartWithBpm:120 rate:1 leadMs:100 alignToDrums:YES kit:7 seed:3], "the bass starts");
      std::vector<float> l(240), r(240); float peak = 0;
      for (int t = 0; t < 1500; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        usleep(5000);
      }
      NSDictionary *m = [g seqMirror], *b = m[@"bass"];
      CHECK([b[@"running"] boolValue] && [b[@"steps"] intValue] > 8, "the bass line steps with no page: %d steps", [b[@"steps"] intValue]);
      CHECK([b[@"firstFrame"] doubleValue] == [m[@"firstFrame"] doubleValue], "and it shares the drums' downbeat (frame %.0f)", [b[@"firstFrame"] doubleValue]);
      CHECK([b[@"hits"] intValue] > 8 && [b[@"misses"] intValue] == 0 && [b[@"refused"] intValue] == 0, "its notes are begun from the bank: %d hits, %d misses, %d refused", [b[@"hits"] intValue], [b[@"misses"] intValue], [b[@"refused"] intValue]);
      CHECK([b[@"cuts"] intValue] >= [b[@"hits"] intValue] - 2, "each note after the first cuts the one before: %d cuts for %d notes", [b[@"cuts"] intValue], [b[@"hits"] intValue]);
      CHECK([b[@"lateStarts"] intValue] == 0 && [[g graphStats][@"lateEdits"] intValue] == 0, "none began late, no late edit");
      CHECK([b[@"windows"] intValue] == 2 && peak > 0.02f, "the chart is held (%d windows) and the line sounds: peak %.3f", [b[@"windows"] intValue], peak);
      [g seqBassStop];
      const int notes = [[g seqMirror][@"bass"][@"notes"] intValue];
      run(g, 300);
      CHECK([[g seqMirror][@"bass"][@"notes"] intValue] == notes && ![[g seqMirror][@"bass"][@"running"] boolValue], "stopped: still %d notes", notes);

      // The walking line (Jazz style with Follow on, over the chart): a quarter note a beat on the chart's own clock, snapped onto the
      // drums' bar line while they run. At 120 BPM a beat is 24000 frames; in 1.5 s of render that is a note a beat from the first one, and
      // the first note lands on the drums' bar line (here their first downbeat), not at the line's own start.
      std::vector<double> js = {1, 16, 0, 1, 1, 0, 3, 0, 4, 7, 7, 0, 2, 4, 5, 7, 9, 11, 0.7, 0, 1, 1, 0.5, 14, 0.28, 18, 0, 1, 0, 0};   // follow on, jazz on, four-feel, no cells
      CHECK([g seqSetBassScore:bytes(js)], "a walking score is taken");
      CHECK([g seqBassStartWithBpm:120 rate:1 leadMs:100 alignToDrums:YES kit:7 seed:5], "the walking line starts");
      for (int t = 0; t < 1500; t += 5) { [g renderInto:l.data() right:r.data() frames:240]; usleep(5000); }
      NSDictionary *wb = [g seqMirror][@"bass"];
      CHECK([wb[@"notes"] intValue] >= 3 && [wb[@"notes"] intValue] <= 5 && [wb[@"hits"] intValue] == [wb[@"notes"] intValue] && [wb[@"refused"] intValue] == 0, "the walking line plays a note a beat (3 to 5 in 1.5 s at 120 BPM, not the grid's 12) from the bank: %d notes, %d refused", [wb[@"notes"] intValue], [wb[@"refused"] intValue]);
      [g seqBassStop];
      [g seqStop];
    }

    // The chord comp through the host: the same thread and bank, no page. A synthetic one-note chord for each of three pitches (part 3: a tone
    // that is one oscillator and a gain, no sub; and part 4, the same held, with its release), a rhythm of two hits a bar, the C major chord, the
    // first hit gated. Each hit composes three voices and stops the chord before it, the gated one lets go of its three; started with the drums
    // running, it shares their downbeat.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      CHECK(![g seqChordStartWithBpm:120 leadMs:100 alignToDrums:YES kit:9], "no chord score, no chord start");
      CHECK(![g seqSetChordScore:[NSData dataWithBytes:"junk" length:8]], "a chord score that does not parse is refused");
      auto chordNote = [&](int pitch, bool hold) { return chordNoteEntry(pitch, hold); };
      for (int pitch : {60, 64, 67}) { [g seqPutBankEntry:bytes(chordNote(pitch, false))]; [g seqPutBankEntry:bytes(chordNote(pitch, true))]; }
      std::vector<double> cs = {1, 16, -1, 0, 1, 1, 1, 0.3, 0, 0, 0, 0, 60, 3, 60, 64, 67, 2, 0, 1, 3, 8, 1, 0};
      CHECK([g seqSetChordScore:bytes(cs)], "the chord rhythm is taken");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqChordStartWithBpm:120 leadMs:100 alignToDrums:YES kit:9], "the chord rhythm starts");
      std::vector<float> l(240), r(240); float peak = 0;
      for (int t = 0; t < 1800; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        usleep(5000);
      }
      NSDictionary *m = [g seqMirror], *c = m[@"chord"];
      CHECK([c[@"running"] boolValue] && [c[@"steps"] intValue] > 8, "the chord rhythm steps with no page: %d steps", [c[@"steps"] intValue]);
      CHECK([c[@"firstFrame"] doubleValue] == [m[@"firstFrame"] doubleValue], "and it shares the drums' downbeat (frame %.0f)", [c[@"firstFrame"] doubleValue]);
      CHECK([c[@"hits"] intValue] >= 2 && [c[@"chords"] intValue] == [c[@"hits"] intValue] && [c[@"voices"] intValue] == 3 * [c[@"chords"] intValue] && [c[@"misses"] intValue] == 0 && [c[@"refused"] intValue] == 0,
            "each hit composes three voices from the bank: %d hits, %d chords, %d voices, %d missed, %d refused", [c[@"hits"] intValue], [c[@"chords"] intValue], [c[@"voices"] intValue], [c[@"misses"] intValue], [c[@"refused"] intValue]);
      CHECK([c[@"stops"] intValue] >= 3 && peak > 0.02f, "the second chord stops the first (%d stops), and it sounds: peak %.3f", [c[@"stops"] intValue], peak);
      CHECK([c[@"releases"] intValue] >= 3 && [c[@"releases"] intValue] == 3 * (([c[@"chords"] intValue] + 1) / 2), "the gated hits let go of their voices: %d releases for %d chords (every other hit is gated)", [c[@"releases"] intValue], [c[@"chords"] intValue]);
      CHECK([[g graphStats][@"lateEdits"] intValue] == 0 && [m[@"late"] intValue] == 0, "no late edit, no late step");
      [g seqChordStop]; [g seqStop];
      const int hits = [[g seqMirror][@"chord"][@"hits"] intValue];
      run(g, 300);
      CHECK([[g seqMirror][@"chord"][@"hits"] intValue] == hits && ![[g seqMirror][@"chord"][@"running"] boolValue], "stopped: still %d hits", hits);
    }

    // The song loop through the host: the same thread, no page. A song of one section of two whole-bar chords (C, then F; the second also a slash chord over
    // A) and a second section, the drums running at 120 (a bar is two seconds). Started on the drums' bar line, it steps by their bar lines, hands the
    // bass one window a chord, and a queued Next takes the second section at the end of the pass.
    {
      ModEngineHost *g = fresh();
      CHECK(![g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "no song, no song start");
      CHECK(![g seqSetSong:[NSData dataWithBytes:"junk" length:8]], "a song that does not parse is refused");
      //  [3, barSteps, swingOn, swing, clocked, capo, nLocks, nSections, per section: plays, follow, nSlots,
      //   per slot: bars, beats, eighths, rest, rootM, bassM, lock, voicing, hold, ring, pat, nIvs, ivs, then the trainer, the ending, the landing, the voice: on]
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  2,
        0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, 57, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, 0, 1,   1, 0, 0, 0, 67, -1, -1, -1, 0, 0, -1, 4, 0, 4, 7, 10,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,    // the trainer: no loop, no tempo step, no key step
        4, 1, 0.15, 0,  0,                        // the ending (bar, beat, look-ahead, nothing armed), no landing
        0};
      CHECK([g seqSetSong:bytes(song)], "the song is taken");
      CHECK(![g seqSongStartWithLeadMs:100 alignToDrums:YES section:5 slot:0 pass:0], "a place that is not in the song is refused");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "the song starts");
      CHECK([[g seqMirror][@"song"][@"firstFrame"] doubleValue] >= [[g seqMirror][@"firstFrame"] doubleValue], "on a bar line of the drums");
      run(g, 1500);
      [g seqSongMove:1];
      CHECK([[g seqMirror][@"song"][@"pending"] intValue] == 1, "the mirror shows the Next that is waiting for the end of the pass");
      run(g, 6000);
      CHECK([[g seqMirror][@"song"][@"pending"] intValue] == 0, "and it is gone once the section has moved");
      NSDictionary *m = [g seqMirror], *sg = m[@"song"];
      CHECK([sg[@"running"] boolValue] && [sg[@"chords"] intValue] >= 4, "the song steps with no page: %d chords", [sg[@"chords"] intValue]);
      CHECK([sg[@"section"] intValue] == 1 && [sg[@"slot"] intValue] == 0, "the queued Next was taken at the end of the pass (now in section %d)", [sg[@"section"] intValue]);
      CHECK([m[@"bass"][@"windows"] intValue] >= 2, "and the bass has its chord windows: %d", [m[@"bass"][@"windows"] intValue]);
      NSArray *ask = sg[@"ask"];
      CHECK(ask.count == 9 && [ask[0] intValue] == [sg[@"chords"] intValue] && [ask[5] doubleValue] > [ask[4] doubleValue] && [ask[6] intValue] >= 0 && [ask[6] intValue] <= 1 && [ask[7] intValue] >= 0,
            "the mirror asks the page about the chord that follows: chord %d now (section %d chord %d), %d/%d next, ends %.0f frames after it began", [ask[0] intValue], [ask[1] intValue], [ask[2] intValue], [ask[6] intValue], [ask[7] intValue], [ask[5] doubleValue] - [ask[4] doubleValue]);
      CHECK([m[@"sampleRate"] doubleValue] == SR, "and says its sample rate (%.0f)", [m[@"sampleRate"] doubleValue]);
      [g seqSongSetCapo:2];
      [g seqSongStop];
      const int chords = [[g seqMirror][@"song"][@"chords"] intValue];
      run(g, 500);
      CHECK([[g seqMirror][@"song"][@"chords"] intValue] == chords && ![[g seqMirror][@"song"][@"running"] boolValue], "stopped: still %d chords", chords);
      [g seqStop];
    }

    // The chords of the song through the host: the same song loop, now sounding each chord itself (songvoice.h). One section of three chords, the drums
    // running at 120: C held and let go of after 2 beats (the comp "as played" with a ring), a rest, F over A decaying; then a second section with a chord
    // held into the next. The bank holds a one-note chord for every pitch the voicing can reach. Each chord that sounds is voiced from the bank (3 voices
    // for the triads, none missing), the rest and the next chord stop what rings, the held one lets go of its voices, and stopping the song stops the chord.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      for (int pitch = 24; pitch <= 91; pitch++) { [g seqPutBankEntry:bytes(chordNoteEntry(pitch, false, 6))]; [g seqPutBankEntry:bytes(chordNoteEntry(pitch, true, 6))]; }
      //  per slot: bars, beats, eighths, rest, rootM, bassM, lock, voicing, hold, ring, pat, nIvs, ivs; then the voice: on, kit, play, pedal, style, vary, autoInv, keyRoot,
      //  nSteps, steps, decRaw, chordBeats, strum, spread, width, sub, velBase, feelSwing, swing8, nPatterns, per pattern: drawn, steps, swing, nEv, (p, v, len)...
      //  The F chord over A (a bar) has the comp "every beat": hits at the 2nd, 3rd and 4th beat (eighths 2, 4, 6) after its first strike.
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  2,
        0, 0, 3,   1, 0, 0, 0, 60, -1, -1, -1, 1, 2, -1, 3, 0, 4, 7,   1, 0, 0, 1, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, 57, -1, -1, 0, 0, 0, 3, 0, 4, 7,
        0, 0, 1,   1, 0, 0, 0, 67, -1, -1, -1, 1, 0, -1, 4, 0, 4, 7, 10,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
        4, 1, 0.15, 0,  0,
        1, 9, 1, 0, 0, 0, 1, 0, 7, 0, 2, 4, 5, 7, 9, 11,  0.3, 0, 0, 0, 0, 0, 1,  0, 1,  1,  0, 0, -1, 4,  0, 1, 0,  2, 1, 0,  4, 1, 0,  6, 1, 0};
      CHECK([g seqSetSong:bytes(song)], "the song, with its voice, is taken");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "the song starts");
      std::vector<float> l(240), r(240); float peak = 0;
      for (int t = 0; t < 7000; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        usleep(5000);
        if (t == 5000) [g seqSongMove:1];
      }
      NSDictionary *sg = [g seqMirror][@"song"];
      const int chords = [sg[@"chords"] intValue], voiced = [sg[@"voiced"] intValue], rests = [sg[@"rests"] intValue];
      CHECK(chords >= 4 && rests >= 1 && voiced + rests == chords, "each chord is voiced or a rest: %d chords, %d voiced, %d rests", chords, voiced, rests);
      CHECK([sg[@"hits"] intValue] >= 3, "the comp re-strikes the chord after its first strike: %d hits", [sg[@"hits"] intValue]);
      CHECK([sg[@"voices"] intValue] >= 3 * (voiced + [sg[@"hits"] intValue]) - 1 && [sg[@"misses"] intValue] == 0 && [sg[@"refused"] intValue] == 0, "three voices a triad from the bank, none missing: %d voices, %d missed, %d refused", [sg[@"voices"] intValue], [sg[@"misses"] intValue], [sg[@"refused"] intValue]);
      CHECK([sg[@"stops"] intValue] >= 3 && peak > 0.02f, "a rest and the next chord stop what rings (%d stops), and it sounds: peak %.3f", [sg[@"stops"] intValue], peak);
      CHECK([sg[@"releases"] intValue] >= 3, "the chord with a ring lets go of its voices: %d releases", [sg[@"releases"] intValue]);
      CHECK([[g graphStats][@"lateEdits"] intValue] == 0, "no late edit");
      const int stops = [sg[@"stops"] intValue];
      // holdSongLoop: the progression freezes and the chord that sounds stays
      [g seqSongHold];
      const int heldChords = [[g seqMirror][@"song"][@"chords"] intValue], heldHits = [[g seqMirror][@"song"][@"hits"] intValue];
      run(g, 2500);
      NSDictionary *hs = [g seqMirror][@"song"];
      CHECK(![hs[@"running"] boolValue] && [hs[@"chords"] intValue] == heldChords && [hs[@"stops"] intValue] == stops && [hs[@"hits"] intValue] == heldHits,
            "a hold freezes the song (%d chords, no more hits) and leaves the chord ringing (stops %d, was %d)", [hs[@"chords"] intValue], [hs[@"stops"] intValue], stops);
      [g seqSongStop];
      CHECK([[g seqMirror][@"song"][@"stops"] intValue] > stops, "stopping the song stops the chord that rings");
      [g seqStop];
    }

    // The practice trainer through the host: a one-section song of two whole-bar chords at 120 with the drums running, the tempo stepped up 10 at the end of each chorus (a
    // chorus is the section's pass, four seconds), a key step of a fifth every chorus. After two choruses the tempo has moved and the key has shifted; stopping puts the tempo
    // back where the run began.
    {
      ModEngineHost *g = fresh();
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
        0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, -1, -1, -1, 1, 10, 1, 140, 1, 1, 7,
        4, 1, 0.15, 0,  0,
        0};
      CHECK([g seqSetSong:bytes(song)], "a song with the trainer on is taken");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "it starts");
      run(g, 9500);
      NSDictionary *m = [g seqMirror], *sg = m[@"song"];
      CHECK([sg[@"chorus"] intValue] >= 2 && [m[@"tempo"] doubleValue] >= 140 - 1e-9 && [sg[@"keyShift"] intValue] != 0,
            "after %d choruses the tempo has stepped to %.0f and the key by %d semitones", [sg[@"chorus"] intValue], [m[@"tempo"] doubleValue], [sg[@"keyShift"] intValue]);
      [g seqSongStop];
      NSDictionary *m2 = [g seqMirror];
      CHECK(fabs([m2[@"tempo"] doubleValue] - 120) < 1e-9 && [m2[@"song"][@"keyShift"] intValue] == 0, "stopping puts the tempo back to %.0f and drops the key shift", [m2[@"tempo"] doubleValue]);
      [g seqStop];
    }

    // The endings through the host. A one-section song of two whole-bar chords at 240 (a bar is a second) with the drums and the bass running, the voice on and a landing on the
    // kit's lanes 0 (kick) and 1 (cymbal). A finish armed during the first pass lands at its end: the song is over, the band hit and the chord and the bass note began from the
    // bank, the chord is let go of and stopped after its hold. Then a fade: the master comes down in decibels through four bars and back up after the stop.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      for (int pitch = 24; pitch <= 91; pitch++) { [g seqPutBankEntry:bytes(chordNoteEntry(pitch, false, 6))]; [g seqPutBankEntry:bytes(chordNoteEntry(pitch, true, 6))]; }
      auto song = [&](int armed) {
        return std::vector<double>{5, 16, 0, 0, 1, 0,  0,  1,
          0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
          0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
          4, 1, 0.15, (double)armed,
          1, 0, 1, -1, 60, 2, 3, 0, 4, 7,                       // the landing: kick lane 0, cymbal lane 1, no snare; C major; the bass in octave 2
          1, 9, 1, 0, 0, 0, 1, 0, 7, 0, 2, 4, 5, 7, 9, 11,  0.3, 0, 0, 0, 0, 0, 1,  0, 1,  0};
      };
      CHECK([g seqSetSong:bytes(song(2))], "a song with a finish armed and a landing is taken");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "it starts");
      run(g, 5500);
      NSDictionary *m = [g seqMirror], *sg = m[@"song"], *en = sg[@"ending"];
      CHECK(![sg[@"running"] boolValue] && [en[@"phase"] intValue] == 2 && [en[@"lands"] intValue] == 1, "the finish landed at the end of the pass (phase %d, %d landings) and the song is over", [en[@"phase"] intValue], [en[@"lands"] intValue]);
      CHECK(![m[@"running"] boolValue] && ![m[@"bass"][@"running"] boolValue] && ![m[@"chord"][@"running"] boolValue], "the drums, the bass and the chord rhythm stopped with it");
      CHECK([sg[@"voiced"] intValue] >= 3 && [sg[@"misses"] intValue] == 0, "the chords sounded, the landing's among them: %d voiced, %d missed", [sg[@"voiced"] intValue], [sg[@"misses"] intValue]);
      CHECK([sg[@"releases"] intValue] >= 3, "the landing chord is let go of after its hold (%d releases)", [sg[@"releases"] intValue]);
      CHECK([[g graphStats][@"lateEdits"] intValue] == 0, "no late edit");
      [g seqStop];
    }
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      for (int pitch = 24; pitch <= 91; pitch++) { [g seqPutBankEntry:bytes(chordNoteEntry(pitch, false, 6))]; [g seqPutBankEntry:bytes(chordNoteEntry(pitch, true, 6))]; }
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
          0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
          0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
          4, 1, 0.15, 3,                                        // a fade armed from the start
          0,
          1, 9, 1, 0, 0, 0, 1, 0, 7, 0, 2, 4, 5, 7, 9, 11,  0.3, 0, 0, 0, 0, 0, 1,  0, 1,  0};
      CHECK([g seqSetSong:bytes(song)], "a song with a fade armed is taken");
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "it starts");
      float lowest = 1.f; bool playedOn = false; int chordsAtFade = 0;
      for (int t = 0; t < 9500; t += 500) {
        run(g, 500);
        NSDictionary *sg = [g seqMirror][@"song"], *en = sg[@"ending"];
        lowest = std::min(lowest, [en[@"gain"] floatValue]);
        if ([en[@"phase"] intValue] == 1) { if (!chordsAtFade) chordsAtFade = [sg[@"chords"] intValue]; else if ([sg[@"chords"] intValue] > chordsAtFade) playedOn = true; }
      }
      NSDictionary *sg = [g seqMirror][@"song"], *en = sg[@"ending"];
      CHECK(playedOn, "the chart plays on through the fade");
      CHECK(lowest < 0.1f && [en[@"phase"] intValue] == 2 && ![sg[@"running"] boolValue], "the master came down to %.3f and the song stopped at the end of the fade", lowest);
      CHECK(fabs([en[@"gain"] floatValue] - 1.0) < 1e-6, "and it was brought back up afterwards (gain %.3f)", [en[@"gain"] floatValue]);
      [g seqStop];
    }


    // The arpeggiator through the host: the same thread and bank, no page. A synthetic arp voice (part 5: a note and a block's tone), the chord C major over two octaves,
    // started with the drums' bar line. Up: a note a sixteenth, each begun from the bank; Block: three voices a step. Then in a song: armed, it starts with the song on the same
    // bar line and takes each chord's tones (a slash chord's bass first, the octaves above), and a rest starts the pattern again on the chord that was. A finish fades its voices.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:4]; [g ensureGraphPart:5];
      CHECK(![g seqArpStartWithBpm:120 leadMs:100 alignToDrums:YES kit:3 seed:1], "no arp score, no arp start");
      CHECK(![g seqSetArpScore:[NSData dataWithBytes:"junk" length:8]], "an arp score that does not parse is refused");
      CHECK([g seqSetArpScore:bytes(arpScore(0, 1))], "the arp score is taken");
      CHECK(![g seqSetArpNotes:bytes(std::vector<double>{60, 300})], "a chord with a note out of range is refused");
      CHECK([g seqSetArpNotes:bytes(std::vector<double>{60, 64, 67, 72, 76, 79})], "the chord is taken");
      [g seqPutBankEntry:bytes(arpEntry(3, 0, 0.3))];
      [g seqPutBankEntry:bytes(arpEntry(3, 16, 0.3))];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqArpStartWithBpm:120 leadMs:100 alignToDrums:YES kit:3 seed:3], "the arp starts");
      std::vector<float> l(240), r(240); float peak = 0;
      for (int t = 0; t < 1500; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        usleep(5000);
      }
      NSDictionary *m = [g seqMirror], *a = m[@"arp"];
      CHECK([a[@"running"] boolValue] && [a[@"steps"] intValue] > 8 && [a[@"notes"] intValue] == [a[@"steps"] intValue], "the arp steps with no page: %d steps, %d notes", [a[@"steps"] intValue], [a[@"notes"] intValue]);
      CHECK([a[@"firstFrame"] doubleValue] == [m[@"firstFrame"] doubleValue], "and it shares the drums' downbeat (frame %.0f)", [a[@"firstFrame"] doubleValue]);
      CHECK([a[@"voices"] intValue] == [a[@"notes"] intValue] && [a[@"misses"] intValue] == 0 && [a[@"refused"] intValue] == 0, "each note is begun from the bank: %d voices, %d misses, %d refused", [a[@"voices"] intValue], [a[@"misses"] intValue], [a[@"refused"] intValue]);
      CHECK([a[@"lateStarts"] intValue] == 0 && [[g graphStats][@"lateEdits"] intValue] == 0 && peak > 0.02f, "none began late, and it sounds: peak %.3f", peak);
      [g seqArpStop];
      const int notes = [[g seqMirror][@"arp"][@"notes"] intValue];
      run(g, 300);
      CHECK([[g seqMirror][@"arp"][@"notes"] intValue] == notes && ![[g seqMirror][@"arp"][@"running"] boolValue], "stopped: still %d notes", notes);
      // Block: every tone of the chord is a voice, the three of a C major triad (twelve milliseconds apart in the strum).
      [g seqSetArpScore:bytes(arpScore(6, 1))];
      [g seqSetArpNotes:bytes(std::vector<double>{60, 64, 67})];
      CHECK([g seqArpStartWithBpm:120 leadMs:100 alignToDrums:YES kit:3 seed:3], "the block pattern starts");
      run(g, 1200);
      NSDictionary *b = [g seqMirror][@"arp"];
      CHECK([b[@"blocks"] intValue] >= 3 && [b[@"voices"] intValue] == 3 * [b[@"blocks"] intValue] && [b[@"misses"] intValue] == 0, "a block is a voice for each tone: %d blocks, %d voices", [b[@"blocks"] intValue], [b[@"voices"] intValue]);
      [g seqArpStop]; [g seqStop];
    }
    {
      // In a song: C for a bar, F over C (a slash chord) for a bar, a rest for a bar, G for a bar. The arp is armed, the Octaves control is 2.
      ModEngineHost *g = fresh();
      [g ensureGraphPart:4]; [g ensureGraphPart:5];
      [g seqPutBankEntry:bytes(arpEntry(3, 0, 0.3))];
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
        0, 0, 4,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
                   1, 0, 0, 0, 65,  48, -1, -1, 0, 0, -1, 3, 0, 4, 7,
                   1, 0, 0, 1, 60, -1, -1, -1, 0, 0, -1, 0,
                   1, 0, 0, 0, 67, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
        4, 1, 0.15, 0,
        0,
        0};
      CHECK([g seqSetSong:bytes(song)], "a song with a slash chord and a rest is taken");
      CHECK([g seqSetArpScore:bytes(arpScore(0, 2))], "the arp score is taken (two octaves)");
      [g seqArpArm:YES kit:3];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "the song starts");
      std::vector<std::vector<int>> seen;
      bool sawRestAgain = false;
      int lastChords = -1, lastNotes = 0;
      for (int t = 0; t < 3600; t += 20) {
        run(g, 20);
        NSDictionary *a = [g seqMirror][@"arp"];
        if ([a[@"chords"] intValue] != lastChords) {
          lastChords = [a[@"chords"] intValue];
          std::vector<int> tones; for (NSNumber *n in a[@"tones"]) tones.push_back([n intValue]);
          seen.push_back(tones);
        }
        lastNotes = [a[@"notes"] intValue];
      }
      NSDictionary *a = [g seqMirror][@"arp"], *sg = [g seqMirror][@"song"];
      CHECK([a[@"running"] boolValue] && [a[@"bySong"] boolValue] && [a[@"firstFrame"] doubleValue] == [sg[@"firstFrame"] doubleValue], "the arp started with the song, on its bar line (frame %.0f)", [a[@"firstFrame"] doubleValue]);
      CHECK(seen.size() >= 4, "it was handed each chord (%zu)", seen.size());
      if (seen.size() >= 4) {
        CHECK((seen[0] == std::vector<int>{60, 64, 67, 72, 76, 79}), "C major over two octaves: the triad and the triad an octave up");
        CHECK((seen[1] == std::vector<int>{48, 65, 69, 72, 60, 77, 81, 84}), "F over C: the slash bass first, then the chord, and an octave up of each");
        CHECK(seen[2] == seen[1], "a rest leaves the chord as it was (the page's rest stops the chord part, not the arp)");
        CHECK((seen[3] == std::vector<int>{67, 71, 74, 79, 83, 86}), "G major");
      }
      CHECK([a[@"voices"] intValue] == lastNotes && [a[@"misses"] intValue] == 0 && lastNotes > 20, "its notes began from the bank: %d voices for %d notes, %d misses", [a[@"voices"] intValue], lastNotes, [a[@"misses"] intValue]);
      [g seqSongStop];
      CHECK(![[g seqMirror][@"arp"][@"running"] boolValue], "stopping the song stops the arp it brought in");
      [g seqStop];
    }
    {
      // A finish fades what the band had committed: arp voices that would ring for six seconds are gone a moment after the landing (nothing else sounds: no kit voices, no chord).
      ModEngineHost *g = fresh();
      [g ensureGraphPart:4]; [g ensureGraphPart:5];
      [g seqPutBankEntry:bytes(arpEntry(3, 0, 6))];
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
        0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
        4, 1, 0.15, 2,
        1, 0, 1, -1, 60, 2, 3, 0, 4, 7,
        0};
      CHECK([g seqSetSong:bytes(song)], "a song with a finish armed is taken");
      [g seqSetArpScore:bytes(arpScore(0, 1))];
      [g seqArpArm:YES kit:3];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "it starts");
      std::vector<float> l(240), r(240); float before = 0, after = 0; double landed = 0;     // the mirror shows the landing a look-ahead before it sounds
      for (int t = 0; t < 7000; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240]; usleep(5000);
        NSDictionary *m = [g seqMirror], *en = m[@"song"][@"ending"];
        float pk = 0; for (int i = 0; i < 240; i++) pk = std::max(pk, std::max(std::fabs(l[i]), std::fabs(r[i])));
        if ([en[@"lands"] intValue] == 0) before = std::max(before, pk);
        else { if (!landed) landed = [m[@"frame"] doubleValue]; if (getenv("DBGKILL")) printf("  t+%.0f ms peak %.4f\n", ([m[@"frame"] doubleValue] - landed) / SR * 1000, pk); if ([m[@"frame"] doubleValue] > landed + 0.3 * SR) after = std::max(after, pk); }
      }
      NSDictionary *a = [g seqMirror][@"arp"];
      CHECK(landed > 0 && before > 0.02f, "the arp sounded until the landing (peak %.3f)", before);
      // what is left a moment on is the master chain's own tail (the strip, the bus room), a few per cent of the level; the voices alone would ring at it for six seconds
      CHECK(after < 0.1f * before && ![a[@"running"] boolValue], "and it is quiet after it (peak %.4f against %.4f before: only the chain's tail), though its voices would ring for six seconds, and the arp has stopped", after, before);
      [g seqStop];
    }


    // The melody generator through the host: the same thread and bank, no page. A synthetic melody voice (part 6), a line of a note every step with a chord on the first, started with the
    // drums' bar line. Then in a song: armed, it starts with the song on the same bar line and, with Follow on, plays each chord's tones (the line is written over C: over F it is F) and
    // with Follow off stays as written; stopping the song stops it. A finish fades its voices.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:2]; [g ensureGraphPart:5];
      CHECK(![g seqMelStartWithBpm:120 rate:1 leadMs:100 alignToDrums:YES kit:4 seed:1], "no melody score, no melody start");
      CHECK(![g seqSetMelScore:[NSData dataWithBytes:"junk" length:8]], "a melody score that does not parse is refused");
      CHECK(![g seqSetMelChords:[NSData dataWithBytes:"junk" length:8]], "chord windows that do not parse are refused");
      std::vector<MelCellSpec> cells(16, MelCellSpec{1, 0, 5, 1, {}});
      cells[0].more = {{4, 5}, {7, 5}};
      CHECK([g seqSetMelScore:bytes(melScore(false, cells))], "the melody line is taken");
      [g seqPutBankEntry:bytes(melEntry(4, 0, 0.3))];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      CHECK([g seqMelStartWithBpm:120 rate:1 leadMs:100 alignToDrums:YES kit:4 seed:3], "the melody starts");
      std::vector<float> l(240), r(240); float peak = 0;
      for (int t = 0; t < 1500; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240];
        for (int i = 0; i < 240; i++) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        usleep(5000);
      }
      NSDictionary *m = [g seqMirror], *a = m[@"mel"];
      CHECK([a[@"running"] boolValue] && [a[@"steps"] intValue] > 8, "the melody steps with no page: %d steps", [a[@"steps"] intValue]);
      CHECK([a[@"firstFrame"] doubleValue] == [m[@"firstFrame"] doubleValue], "and it shares the drums' downbeat (frame %.0f)", [a[@"firstFrame"] doubleValue]);
      CHECK([a[@"notes"] intValue] >= [a[@"steps"] intValue] + 2 && [a[@"voices"] intValue] == [a[@"notes"] intValue] && [a[@"misses"] intValue] == 0 && [a[@"refused"] intValue] == 0,
            "each note is begun from the bank, the step with a chord as three: %d steps, %d notes, %d voices, %d misses", [a[@"steps"] intValue], [a[@"notes"] intValue], [a[@"voices"] intValue], [a[@"misses"] intValue]);
      CHECK([a[@"lateStarts"] intValue] == 0 && [[g graphStats][@"lateEdits"] intValue] == 0 && peak > 0.02f, "none began late, and it sounds: peak %.3f", peak);
      [g seqMelStop];
      const int notes = [[g seqMirror][@"mel"][@"notes"] intValue];
      run(g, 300);
      CHECK([[g seqMirror][@"mel"][@"notes"] intValue] == notes && ![[g seqMirror][@"mel"][@"running"] boolValue], "stopped: still %d notes", notes);
      [g seqStop];
    }
    for (int follow = 0; follow < 2; follow++) {
      // In a song: C for a bar, F for a bar, at 240 (a bar is a second). The melody is armed; its line is a note on every fourth step, a C.
      ModEngineHost *g = fresh();
      [g ensureGraphPart:2]; [g ensureGraphPart:5];
      [g seqPutBankEntry:bytes(melEntry(4, 0, 0.3))];
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
        0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
                   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
        4, 1, 0.15, 0,
        0,
        0};
      std::vector<MelCellSpec> cells(16, MelCellSpec{0, 0, 5, 1, {}});
      for (int i = 0; i < 16; i += 4) cells[(size_t)i] = MelCellSpec{1, 0, 5, 1, {}};
      CHECK([g seqSetSong:bytes(song)], "a two-chord song is taken");
      CHECK([g seqSetMelScore:bytes(melScore(follow != 0, cells))], "the melody line is taken (Follow %s)", follow ? "on" : "off");
      [g seqMelArm:YES kit:4 rate:1];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "the song starts");
      std::set<int> pcs; int sawFirst = 0, sawSecond = 0;
      for (int t = 0; t < 2600; t += 10) {
        run(g, 10);
        NSDictionary *mm = [g seqMirror], *ml = mm[@"mel"];
        const int last = [ml[@"lastMidi"] intValue];
        if (last >= 0) { pcs.insert(last % 12); if ([mm[@"song"][@"chords"] intValue] == 1) sawFirst++; else sawSecond++; }
      }
      NSDictionary *m = [g seqMirror], *a = m[@"mel"], *sg = m[@"song"];
      CHECK([a[@"running"] boolValue] && [a[@"bySong"] boolValue] && [a[@"firstFrame"] doubleValue] == [sg[@"firstFrame"] doubleValue], "the melody started with the song, on its bar line (frame %.0f)", [a[@"firstFrame"] doubleValue]);
      CHECK([a[@"windows"] intValue] >= 1 && [a[@"voices"] intValue] == [a[@"notes"] intValue] && [a[@"notes"] intValue] >= 6 && [a[@"misses"] intValue] == 0, "it was handed the song's chords and its notes began from the bank: %d notes, %d windows, %d misses", [a[@"notes"] intValue], [a[@"windows"] intValue], [a[@"misses"] intValue]);
      if (follow) CHECK(pcs.count(0) && pcs.count(5), "Follow on: it plays the C chord's root and then the F chord's (pitch classes seen:%s%s)", pcs.count(0) ? " C" : "", pcs.count(5) ? " F" : "");
      else CHECK(pcs.size() == 1 && pcs.count(0), "Follow off: it stays as written, a C, over both chords (%zu pitch classes)", pcs.size());
      [g seqSongStop];
      CHECK(![[g seqMirror][@"mel"][@"running"] boolValue], "stopping the song stops the melody it brought in");
      [g seqStop];
    }
    {
      // A finish fades what the band had committed: melody voices that would ring for six seconds are gone a moment after the landing (nothing else sounds).
      ModEngineHost *g = fresh();
      [g ensureGraphPart:2]; [g ensureGraphPart:5];
      [g seqPutBankEntry:bytes(melEntry(4, 0, 6))];
      std::vector<double> song = {5, 16, 0, 0, 1, 0,  0,  1,
        0, 0, 2,   1, 0, 0, 0, 60, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,   1, 0, 0, 0, 65, -1, -1, -1, 0, 0, -1, 3, 0, 4, 7,
        0, -1, -1, -1, 0, 4, 2, 140, 0, 2, 7,
        4, 1, 0.15, 2,
        1, 0, 1, -1, 60, 2, 3, 0, 4, 7,
        0};
      std::vector<MelCellSpec> cells(16, MelCellSpec{0, 0, 5, 1, {}});
      for (int i = 0; i < 16; i += 4) cells[(size_t)i] = MelCellSpec{1, 0, 5, 1, {}};
      CHECK([g seqSetSong:bytes(song)], "a song with a finish armed is taken");
      [g seqSetMelScore:bytes(melScore(true, cells))];
      [g seqMelArm:YES kit:4 rate:1];
      [g seqSetDrumScore:bytes(score())];
      [g seqStartWithBpm:240 rate:1 leadMs:100 seed:3];
      CHECK([g seqSongStartWithLeadMs:100 alignToDrums:YES section:0 slot:0 pass:0], "it starts");
      std::vector<float> l(240), r(240); float before = 0, after = 0; double landed = 0;
      for (int t = 0; t < 7000; t += 5) {
        [g renderInto:l.data() right:r.data() frames:240]; usleep(5000);
        NSDictionary *m = [g seqMirror], *en = m[@"song"][@"ending"];
        float pk = 0; for (int i = 0; i < 240; i++) pk = std::max(pk, std::max(std::fabs(l[i]), std::fabs(r[i])));
        if ([en[@"lands"] intValue] == 0) before = std::max(before, pk);
        else { if (!landed) landed = [m[@"frame"] doubleValue]; if ([m[@"frame"] doubleValue] > landed + 0.3 * SR) after = std::max(after, pk); }
      }
      NSDictionary *a = [g seqMirror][@"mel"];
      CHECK(landed > 0 && before > 0.02f, "the melody sounded until the landing (peak %.3f)", before);
      CHECK(after < 0.1f * before && ![a[@"running"] boolValue], "and it is quiet after it (peak %.4f against %.4f before), though its voices would ring for six seconds, and the melody has stopped", after, before);
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
