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

    // Where a note lands against where it was meant to, when callbacks come in
    // bursts. A message waits for the next callback and is placed from that
    // block's wall time, so on a bursty engine the notes are placed from the
    // first block after a gap: audibly nothing, but the file put them 31 and 46
    // ms early on the phone, because the clock origin was a typical block.
    // origin + drainMs must put each note where it was meant (its stamp plus its
    // offset), whatever the cadence. Measured on the stem of a part, as the mean
    // error over 24 notes against each note's intended wall time; the same
    // patch's attack is in both, so a bursty run is judged against a smooth one.
    {
      auto nowMs = [] { struct timespec t; clock_gettime(CLOCK_REALTIME, &t); return t.tv_sec * 1000.0 + t.tv_nsec / 1e6; };
      auto run = [&](int K, double* errNoShift) {
        ModEngineHost* g = [[ModEngineHost alloc] initWithSampleRate:sr maxFrames:4096];
        [g warmUpPart:0];
        std::vector<float> gl(4096), gr(4096);
        [g startCapture:1 | 2];
        const double blockMs = 128.0 * 1000 / sr, cyc = K * blockMs;
        const int per = (int)std::ceil(450.0 / cyc), NOTES = 24;
        struct Note { double target; };
        std::vector<Note> notes;
        double S = nowMs() + 30;
        uint32_t seed = 987654321u;
        auto rnd = [&] { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed / 4294967296.0; };
        for (int c = 0; c < NOTES * per + 4; c++) {
          if (c % per == 1 && (int)notes.size() < NOTES) {            // a message arrives somewhere in the gap
            const double at = S + (c - 1) * cyc + 0.3 * cyc + rnd() * 0.5 * cyc;
            while (nowMs() < at) {}
            const double ts = nowMs();
            const double rel = 6000;                                  // 125 ms ahead
            const int id = 1000 + (int)notes.size();
            [g post:@{@"t": @"on", @"part": @0, @"note": @60, @"vel": @0.9, @"id": @(id), @"atRel": @(rel), @"ts": @(ts)}];
            [g post:@{@"t": @"off", @"part": @0, @"note": @60, @"id": @(id), @"atRel": @(rel + 4800), @"ts": @(ts)}];
            notes.push_back({ts + rel * 1000 / sr});
          }
          const double due = S + c * cyc;
          while (nowMs() < due) {}
          for (int j = 0; j < K; j++) [g renderInto:gl.data() right:gr.data() frames:128];
        }
        std::vector<Got> pp;
        NSDictionary* dd = drain(g, pp);
        const double origin = [dd[@"originMs"] doubleValue], shift = [dd[@"drainMs"] doubleValue];
        const Got& st = pp[1];
        double sum = 0, sum0 = 0; int n = 0;
        for (const Note& nt : notes) {
          const double fexp = (nt.target - origin) * sr / 1000;
          const long a = (long)(fexp - 0.03 * sr - st.first), b = (long)(fexp + 0.10 * sr - st.first);
          if (a < 0 || b >= (long)st.l.size()) continue;
          float mx = 0; for (long i = a; i < b; i++) mx = std::fmax(mx, std::fabs(st.l[i]));
          if (mx < 0.005f) continue;
          long on = a; while (on < b && std::fabs(st.l[on]) < 0.25f * mx) on++;
          const double wall = origin + (st.first + on) * 1000 / sr;
          sum += wall + shift - nt.target; sum0 += wall - nt.target; n++;
        }
        printf("     K=%2d: %2d notes, origin-only error %+6.1f ms, with drainMs (%+.1f) %+6.1f ms\n", K, n, n ? sum0 / n : 0, shift, n ? sum / n : 0);
        if (errNoShift) *errNoShift = n ? sum0 / n : 0;
        return n ? sum / n : 1e9;
      };
      double raw16 = 0;
      const double smooth = run(1, nullptr);
      const double bursty = run(16, &raw16);
      check(std::fabs(bursty - smooth) < 3.0, "a bursty engine puts a note where a smooth one does (ms apart, with drainMs)", bursty - smooth);
      check(std::fabs(raw16 - smooth) > 8.0, "(and without it the bursty run would have been 8+ ms off)", raw16 - smooth);
    }
  }
  printf("%s\n", fails ? "hosttest FAILED" : "hosttest ok");
  return fails ? 1 : 0;
}
