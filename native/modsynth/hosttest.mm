// The capture path through the real host (ios/App/App/ModEngine/ModEngineHost.mm),
// built for the Mac: what readCapture hands back is exactly what renderInto
// produced, at the frames it says, and the take rules hold (a stream added
// mid-take does not restart the master; a reader that falls behind is told how
// much it lost; Stop ends the writing). The Swift above it only moves bytes.
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <algorithm>
#include <cmath>
#include <unistd.h>
#include <time.h>
#include <cstdio>
#include <vector>

static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.6g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}

struct Got { std::vector<float> l, r; double first = -1; double lost = 0; };
static Got take(NSDictionary* d, int id) {
  Got g;
  for (NSDictionary* s in d[@"streams"]) {
    if ([s[@"id"] intValue] != id) continue;
    const int n = [s[@"frames"] intValue];
    const float* p = (const float*)[(NSData*)s[@"data"] bytes];
    if (g.first < 0) g.first = [s[@"frame0"] doubleValue];
    g.lost += [s[@"lost"] doubleValue];
    g.l.insert(g.l.end(), p, p + n); g.r.insert(g.r.end(), p + n, p + 2 * n);
  }
  return g;
}

// What the page does: read until a read comes back empty (one call returns at
// most 2^17 frames a stream).
static NSDictionary* drain(ModEngineHost* h, std::vector<Got>& per) {
  per.assign(9, Got());
  NSDictionary* last = nil;
  for (int k = 0; k < 100; k++) {
    last = [h readCapture];
    if ([last[@"streams"] count] == 0) break;
    for (int id = 0; id < 9; id++) {
      Got g = take(last, id);
      if (g.l.empty() && g.lost == 0) continue;
      if (per[id].first < 0) per[id].first = g.first;
      per[id].lost += g.lost;
      per[id].l.insert(per[id].l.end(), g.l.begin(), g.l.end()); per[id].r.insert(per[id].r.end(), g.r.begin(), g.r.end());
    }
  }
  return last;
}

int main() {
  @autoreleasepool {
    const double sr = 48000;
    ModEngineHost* h = [[ModEngineHost alloc] initWithSampleRate:sr maxFrames:4096];
    [h warmUpPart:0];
    [h post:@{@"t": @"on", @"part": @0, @"note": @60, @"vel": @0.8, @"id": @1}];
    [h post:@{@"t": @"on", @"part": @0, @"note": @67, @"vel": @0.8, @"id": @2}];

    std::vector<float> L(4096), R(4096), outL, outR;
    auto render = [&](int blocks, int n) {
      for (int b = 0; b < blocks; b++) {
        [h renderInto:L.data() right:R.data() frames:n];
        outL.insert(outL.end(), L.begin(), L.begin() + n); outR.insert(outR.end(), R.begin(), R.begin() + n);
      }
    };

    render(10, 128);                                   // before the take: not captured
    const double startFrame = (double)outL.size();
    [h startCapture:1];                                // the master
    render(100, 128); render(20, 480); render(10, 37);
    [h startCapture:1 | 2];                            // a stem joins mid-take; the master keeps going
    const double joinFrame = (double)outL.size();
    render(50, 256);
    NSDictionary* d = [h readCapture];

    Got m = take(d, 0);
    const size_t total = outL.size() - (size_t)startFrame;
    check(m.l.size() == total, "the master capture holds every frame rendered since the take began", (double)m.l.size());
    check(m.first == startFrame, "and says which engine frame it starts at", m.first);
    size_t bad = 0;
    for (size_t i = 0; i < m.l.size(); i++)
      if (m.l[i] != outL[(size_t)startFrame + i] || m.r[i] != outR[(size_t)startFrame + i]) bad++;
    check(bad == 0, "sample for sample what renderInto returned (after master volume, the last stage)", (double)bad);
    double pk = 0; for (float x : m.l) pk = std::fmax(pk, std::fabs(x));
    check(pk > 0.01, "and it is the sound, not silence", pk);

    Got s = take(d, 1);
    check(s.first == joinFrame, "a stem added mid-take starts when it was asked for, not at the take's start", s.first);
    check(s.l.size() == (size_t)(50 * 256), "and holds everything after", (double)s.l.size());
    double spk = 0; for (float x : s.l) spk = std::fmax(spk, std::fabs(x));
    check(spk > 0.001, "the part's own bus has the part on it", spk);
    check(m.lost == 0 && s.lost == 0, "nothing lost to a reader that kept up", m.lost + s.lost);
    check([d[@"originMs"] doubleValue] > 1e12, "the wall-clock origin of frame 0 is reported", [d[@"originMs"] doubleValue]);

    // A reader that does not read for 12 s of audio loses the oldest and says so.
    [h stopCapture];
    [h startCapture:1];
    const double base = (double)outL.size();
    const int N = 12 * 48000 / 256;
    for (int b = 0; b < N; b++) [h renderInto:L.data() right:R.data() frames:256];
    outL.resize(outL.size() + (size_t)N * 256);
    std::vector<Got> per;
    d = drain(h, per);
    Got o = per[0];
    const double written = (double)N * 256;
    check(o.lost + (double)o.l.size() == written, "a reader that fell behind: frames read + frames lost = frames rendered", o.lost + (double)o.l.size());
    check(o.lost > 0 && o.first == base + o.lost, "the survivors start where the loss ends", o.first - base);

    // Stop ends the writing; what was written can still be drained.
    [h stopCapture];
    [h renderInto:L.data() right:R.data() frames:256];
    d = drain(h, per);
    check(per[0].l.size() == 0, "after Stop nothing more is captured", (double)per[0].l.size());

    // And a new take starts clean.
    const double again = (double)(base + written + 256);
    [h startCapture:1];
    [h renderInto:L.data() right:R.data() frames:128];
    d = [h readCapture];
    Got n2 = take(d, 0);
    check(n2.l.size() == 128 && n2.first == again && n2.lost == 0, "the next take begins at its own first frame, with nothing left over", n2.first - again);
  }
  printf("%s\n", fails ? "hosttest FAILED" : "hosttest ok");
  return fails ? 1 : 0;
}
