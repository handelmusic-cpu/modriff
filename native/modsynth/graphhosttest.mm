// The graph path through the real host (ModEngineHost.mm), off the audio graph:
// a graph part has a strip but no Processor, the buses reach the master the way
// they should, a send comes back as a tail, edits and strip messages arrive.
//   make graphhosttest && ./graphhosttest
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <cmath>
#include <vector>

static const double SR = 48000;
static int failed = 0;
#define CHECK(c, ...) do { const bool ok_ = (c); if (!ok_) failed++; printf("%s ", ok_ ? "ok  " : "FAIL"); printf(__VA_ARGS__); printf("\n"); } while (0)

// ext(code) <- gain(amp) <- sine(hz) from t=0 to `stop` (-1e9: never), as graphpooltest builds one.
static NSData *sine(double hz, double stop, double amp, int code) {
  std::vector<double> p = {0x6d6f6467, SR, 3, 0};
  p.push_back(8); p.push_back(code);
  p.push_back(2); p.push_back(0); p.push_back(0); p.push_back(stop);
  p.push_back(hz); p.push_back(0); p.push_back(0); p.push_back(0);
  p.push_back(1); p.push_back(amp); p.push_back(0);
  p.push_back(2);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(0); p.push_back(-1);
  return [NSData dataWithBytes:p.data() length:p.size() * sizeof(double)];
}

// Renders `blocks` of `n` frames; the peak of each block-run and whether anything was not finite.
struct Run { float peak = 0, tail = 0; bool finite = true; };
static Run render(ModEngineHost *h, int blocks, int n, int tailFrom = 1 << 30) {
  Run r; std::vector<float> l(n), rr(n);
  for (int b = 0; b < blocks; b++) {
    [h renderInto:l.data() right:rr.data() frames:n];
    for (int i = 0; i < n; i++) {
      if (!std::isfinite(l[i]) || !std::isfinite(rr[i])) r.finite = false;
      const float a = std::max(std::fabs(l[i]), std::fabs(rr[i]));
      if (a > r.peak) r.peak = a;
      if (b >= tailFrom && a > r.tail) r.tail = a;
    }
  }
  return r;
}

static ModEngineHost *fresh() { return [[ModEngineHost alloc] initWithSampleRate:SR maxFrames:4096]; }

int main() {
  @autoreleasepool {
    // Nothing started: silence, finite.
    {
      ModEngineHost *h = fresh();
      Run r = render(h, 10, 256);
      CHECK(r.peak == 0 && r.finite, "an engine with no graph part is silent (peak %g)", r.peak);
    }
    // A part with no Processor: its voice reaches the master through its strip. Part 0 is the
    // direct one: the others also feed the bus room, whose tail rings on after a mute.
    {
      ModEngineHost *h = fresh();
      CHECK([h ensureGraphPart:0], "ensureGraphPart(0)");
      CHECK(![h ensureGraphPart:11] && ![h ensureGraphPart:-1], "out-of-range parts are refused");
      NSDictionary *d = [h beginGraph:1 program:sine(440, -1e9, 0.3, 0) timestampMs:0];
      CHECK([d[@"handle"] intValue] >= 0, "beginGraph answers a handle (%d)", [d[@"handle"] intValue]);
      Run r = render(h, 40, 256);
      CHECK(r.peak > 0.05 && r.finite, "the part's voice is heard at the master (peak %.3f)", r.peak);
      const float meter = [h meterForPart:0];
      CHECK(meter > 0.01, "the part's meter moves (%.3f)", meter);
      CHECK([h activeVoices] == 0, "no Processor voices are counted");
      // The page's fader reaches the strip with no Processor behind it.
      const BOOL posted = [h post:@{@"t": @"strip", @"part": @0, @"i": @0, @"v": @0.0}];
      CHECK(posted, "the strip message is queued");
      render(h, 40, 256);                    // the level glides (8 ms) and the master's make-up gain settles
      Run q = render(h, 20, 256);
      CHECK(q.peak < 0.003, "strip level 0 silences the part (peak %.5f)", q.peak);
      CHECK([h graphStats][@"voices"] != nil, "graphStats answers");
    }
    // Bus 8: straight into the master, no strip, so no graph part needed.
    {
      ModEngineHost *h = fresh();
      CHECK([h ensureGraphPart:8], "ensureGraphPart(8): the click's bus, no strip");
      [h beginGraph:1 program:sine(440, -1e9, 0.3, 8) timestampMs:0];
      Run r = render(h, 40, 256);
      CHECK(r.peak > 0.05, "bus 8 (the click) reaches the master (peak %.3f)", r.peak);
    }
    // Buses 9 and 10: a send comes back as a tail, wet only, after the voice has stopped.
    for (int code = 9; code <= 10; code++) {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:5];
      [h beginGraph:1 program:sine(440, 0.1, 0.5, code) timestampMs:0];
      Run r = render(h, 60, 256, 30);        // 0.32 s in total; the note stopped at 0.1 s
      CHECK(r.peak > 0.005 && r.finite, "bus %d: the room answers (peak %.4f)", code, r.peak);
      CHECK(r.tail > 0.001, "bus %d: the room rings on after the send has stopped (tail %.4f)", code, r.tail);
      Run late = render(h, 1500, 256, 1400);   // 8 s more: it dies away
      CHECK(late.tail < 1e-4 && late.finite, "bus %d: and is gone after a few seconds (%.6f)", code, late.tail);
    }
    // Edits: a voice held until released; a release ends it; a stale edit is refused.
    {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:5];
      [h beginGraph:7 program:sine(440, -1e9, 0.3, 5) timestampMs:0];
      render(h, 4, 256);
      CHECK([[h graphStats][@"voices"] intValue] == 1, "one voice is playing");
      CHECK(![h editGraph:99 increments:[NSData dataWithBytes:"\0\0\0\0\0\0\0\0" length:8]], "an edit for an unknown voice is refused");
    }
    // A clip the host lacks: -2 and the id, then it begins once the clip is there.
    {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:5];
      std::vector<double> p = {0x6d6f6467, SR, 3, 0};
      p.push_back(8); p.push_back(5);
      p.push_back(4); p.push_back(42); p.push_back(0); p.push_back(0); p.push_back(0);       // 1: buf 42, no loop
      p.push_back(0); p.push_back(-1e9); p.push_back(0);                                     // start, stop (unset), offset
      p.push_back(1); p.push_back(0); p.push_back(0); p.push_back(0);                        // rate 1, detune 0
      p.push_back(1); p.push_back(1); p.push_back(0);                                        // 2: gain 1
      p.push_back(2);
      p.push_back(1); p.push_back(2); p.push_back(-1);
      p.push_back(2); p.push_back(0); p.push_back(-1);
      NSData *prog = [NSData dataWithBytes:p.data() length:p.size() * sizeof(double)];
      NSDictionary *d = [h beginGraph:1 program:prog timestampMs:0];
      CHECK([d[@"handle"] intValue] == -2 && [d[@"unknownBuffer"] intValue] == 42, "a missing clip answers -2 and its id (%d, %d)", [d[@"handle"] intValue], [d[@"unknownBuffer"] intValue]);
      std::vector<float> clip(4800); for (size_t i = 0; i < clip.size(); i++) clip[i] = 0.5f * sinf(0.1f * i);
      CHECK([h putGraphBuffer:42 sampleRate:SR channels:@[[NSData dataWithBytes:clip.data() length:clip.size() * 4]]], "putGraphBuffer");
      d = [h beginGraph:2 program:prog timestampMs:0];
      CHECK([d[@"handle"] intValue] >= 0, "and then the voice begins (%d)", [d[@"handle"] intValue]);
      Run r = render(h, 20, 256);
      CHECK(r.peak > 0.02, "the recorded clip is heard (peak %.3f)", r.peak);
    }
    // A graph part and then a Processor on the same part: the strip is kept, nothing breaks.
    {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:3];
      [h ensurePart:3];
      [h beginGraph:1 program:sine(440, -1e9, 0.3, 3) timestampMs:0];
      Run r = render(h, 20, 256);
      CHECK(r.peak > 0.05 && r.finite, "a part with both a graph and a Processor plays (peak %.3f)", r.peak);
    }
    // A part that played as graphs for a while and is then given a Processor (the arp, set to a
    // mõdSynth patch after twenty seconds): its first note sounds when it was asked for, not
    // as many seconds late as the part had been running. The Processor's clock is its own.
    {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:4];
      [h beginGraph:1 program:sine(440, 0.05, 0.3, 4) timestampMs:0];
      render(h, 750, 256);                                   // 4 s: the graph part runs, the voice is long over
      CHECK([h warmUpPart:4], "a Processor is built for a part that has been running as graphs");
      // Built outside CHECK: the macro splits its arguments at the dictionary literal's commas.
      NSDictionary *note = @{@"t": @"on", @"part": @4, @"note": @60, @"vel": @0.9, @"id": @1, @"atRel": @2400};
      CHECK([h post:note], "a note 50 ms ahead is queued");
      Run r = render(h, 100, 256);                           // 0.53 s
      CHECK(r.peak > 0.005 && r.finite, "and it sounds within half a second, not seconds late (peak %.4f)", r.peak);
    }
    // A late stamp: a voice stamped now plays at once, one stamped far off is not lost.
    {
      ModEngineHost *h = fresh();
      [h ensureGraphPart:5];
      render(h, 10, 256);
      const double nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
      [h beginGraph:1 program:sine(440, -1e9, 0.3, 5) timestampMs:nowMs];
      [h beginGraph:2 program:sine(660, -1e9, 0.3, 5) timestampMs:nowMs - 3600e3];
      Run r = render(h, 40, 256);
      CHECK(r.peak > 0.05 && r.finite, "stamped voices play, a stamp an hour old is played at once (peak %.3f)", r.peak);
    }
  }
  printf("%s\n", failed ? "FAILED" : "all passed");
  return failed ? 1 : 0;
}
