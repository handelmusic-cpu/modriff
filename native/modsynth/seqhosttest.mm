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
      std::vector<double> ch = {2, 0, 192000, 0, 0, -1, 5, 3, 0, 4, 7, 192000, 384000, 0, 5, -1, 0, 3, 5, 9, 0};
      CHECK([g seqSetBassChords:bytes(ch)], "the chord windows are taken");
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
    // that is one oscillator and a gain, no sub), a rhythm of two hits a bar, the C major chord. Each hit composes three voices and stops the
    // chord before it; started with the drums running, it shares their downbeat.
    {
      ModEngineHost *g = fresh();
      [g ensureGraphPart:5];
      CHECK(![g seqChordStartWithBpm:120 leadMs:100 alignToDrums:YES kit:9], "no chord score, no chord start");
      CHECK(![g seqSetChordScore:[NSData dataWithBytes:"junk" length:8]], "a chord score that does not parse is refused");
      auto chordNote = [&](int pitch) {
        std::vector<double> p = {0x6d6f6467, SR, 3, 0};
        const double stop = 0.048 + 1.5, amp = 0.5;
        p.insert(p.end(), {8, 5, 2, 0, 0, stop, 220, 0, 0, 0, 1, amp, 0, 2, 1, 2, -1, 2, 0, -1});
        size_t amp_i = 0, stop_i = 0; for (size_t i = 0; i < p.size(); i++) { if (p[i] == amp) amp_i = i; if (std::fabs(p[i] - stop) < 1e-12) stop_i = i; }
        std::vector<double> e = {1, 3, 9, (double)pitch, 1, 0.048, 0.048, 0.8, (double)p.size()};
        e.insert(e.end(), p.begin(), p.end());
        e.insert(e.end(), {1, (double)amp_i, amp / 0.8, 0, 0, 0, 1, (double)stop_i, 0});       // velocity, accent, pitch; time; mul
        e.insert(e.end(), {0, 0});                                                            // no chokes, no floors
        e.insert(e.end(), {(double)pitch, 1.5, 0, 0, 0, 0});                                  // refPitch, refDur, refFrom, no length, glide or held slots
        e.insert(e.end(), {12, 2, 0, 5, 0, 0, 0,  2, 0, 1, 0, 0.022, 0});                     // the stop of the chord before: hold the gain, fade it
        e.insert(e.end(), {1, (double)amp_i, 0, -1, 0, 1, (double)stop_i, (double)stop_i, 1}); // chord block: level slot; no times; no panner; no sub; the tone's source
        e.insert(e.end(), {0});                                                               // no velocity curve
        return e;
      };
      for (int pitch : {60, 64, 67}) [g seqPutBankEntry:bytes(chordNote(pitch))];
      std::vector<double> cs = {1, 16, -1, 0, 1, 1, 1, 0.3, 0, 0, 0, 0, 60, 3, 60, 64, 67, 2, 0, 1, 0, 8, 1, 0};
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
      CHECK([[g graphStats][@"lateEdits"] intValue] == 0 && [m[@"late"] intValue] == 0, "no late edit, no late step");
      [g seqChordStop]; [g seqStop];
      const int hits = [[g seqMirror][@"chord"][@"hits"] intValue];
      run(g, 300);
      CHECK([[g seqMirror][@"chord"][@"hits"] intValue] == hits && ![[g seqMirror][@"chord"][@"running"] boolValue], "stopped: still %d hits", hits);
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
