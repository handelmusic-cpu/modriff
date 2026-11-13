// Ableton Link steering through the real host (ModEngineHost.mm), with the session faked: no SDK and no network, so every number is
// repeatable. The fake is what the SDK is to the host -- a beat line over host time that somebody else can move -- and the host time of
// each block is derived from the frame counter, so the "audio clock" and the "session clock" agree exactly unless the test says otherwise.
//   make linkhosttest && ./linkhosttest
// What is checked is docs/link.md, section 3: Play lands on the session's bar line, the engine follows a tempo change without losing or
// doubling a step, a tempo the page repeats does not move the session, alone nothing waits, and a session joined mid-play is pulled in by
// beats without a jump.
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <cmath>
#include <vector>
#include <unistd.h>
#include <mach/mach_time.h>

static const double SR = 48000;
static int failed = 0;
#define CHECK(c, ...) do { const bool ok_ = (c); if (!ok_) failed++; printf("%s ", ok_ ? "ok  " : "FAIL"); printf(__VA_ARGS__); printf("\n"); } while (0)

// seqhosttest's score: 16 steps, a hit every step on lane 1.
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

static double tps;                       // mach ticks per second
static const uint64_t H0 = 1000000000;   // the host time of frame 0
static uint64_t hostOf(double frame) { return H0 + (uint64_t)llround(frame / SR * tps); }

// The session: beat = beatRef + (host - hostRef) seconds * tempo / 60.
struct Fake {
  int enabled = 1, peers = 1;
  double tempo = 120, beatRef = 0; uint64_t hostRef = H0;
  int proposals = 0, aligns = 0; double lastProposal = 0; uint64_t lastAlign = 0;
  double beatAt(uint64_t host) const { return beatRef + ((double)host - (double)hostRef) / tps * tempo / 60.0; }
  void setTempo(double bpm, uint64_t host) { beatRef = beatAt(host); hostRef = host; tempo = bpm; }
  void shift(double beats) { beatRef += beats; }
};
static void hook(void *ctx, ModLinkIO *io) {
  Fake *f = (Fake *)ctx;
  if (io->proposeBpm > 0) { f->proposals++; f->lastProposal = io->proposeBpm; f->setTempo(io->proposeBpm, io->hostTime); }
  // Alone, a request maps the beat at once; that is all the host ever asks for.
  if (io->align) { f->aligns++; f->lastAlign = io->alignHostTime; f->beatRef = 0; f->hostRef = io->alignHostTime; }
  io->beat = f->beatAt(io->hostTime); io->tempo = f->tempo; io->enabled = f->enabled; io->peers = f->peers;
}

static void run(ModEngineHost *h, int ms) {
  std::vector<float> l(240), r(240);
  for (int t = 0; t < ms; t += 5) { [h renderInto:l.data() right:r.data() frames:240 hostTime:hostOf((double)[h framesRendered])]; usleep(5000); }
}
static double fold(double x, double p) { x = std::fmod(x + p / 2, p); if (x < 0) x += p; return x - p / 2; }
// How far the next step the drums will lay out is from the session's sixteenth grid, ms: measured from the session, not from the
// engine's own idea of its error.
static double gridMs(ModEngineHost *h, const Fake &f) {
  NSDictionary *m = [h seqMirror];
  return fold(f.beatAt(hostOf([m[@"nextFrame"] doubleValue])), 0.25) * 60000.0 / f.tempo;
}

int main() {
  @autoreleasepool {
    mach_timebase_info_data_t tb; mach_timebase_info(&tb); tps = 1e9 * (double)tb.denom / (double)tb.numer;

    { // Link off: the hook is there and says "disabled". Nothing may differ from a host without it.
      Fake f; f.enabled = 0; f.tempo = 133;
      ModEngineHost *h = [[ModEngineHost alloc] initWithSampleRate:SR maxFrames:4096];
      [h setLinkHook:hook context:&f]; [h seqSetDrumScore:bytes(score())];
      run(h, 100);
      const double now = (double)[h framesRendered];
      [h seqStartWithBpm:120 rate:1 leadMs:100 seed:3];
      NSDictionary *m = [h seqMirror];
      CHECK([m[@"firstFrame"] doubleValue] == now + 4800, "disabled: the downbeat is exactly the asked lead away (%.0f)", [m[@"firstFrame"] doubleValue] - now);
      run(h, 600); m = [h seqMirror];
      CHECK([m[@"tempo"] doubleValue] == 120 && ![m[@"link"][@"on"] boolValue] && [m[@"link"][@"jumps"] intValue] == 0, "disabled: the tempo is the page's (%.3f), no steering", [m[@"tempo"] doubleValue]);
      [h seqSetTempo:97 rate:0]; run(h, 50);
      CHECK([[h seqMirror][@"tempo"] doubleValue] == 97 && f.proposals == 0, "disabled: the page still sets the tempo, and proposes nothing");
    }

    { // Others are playing at 126, somewhere in a bar. Play waits for their bar line and follows.
      Fake f; f.tempo = 126; f.beatRef = 2.37;
      ModEngineHost *h = [[ModEngineHost alloc] initWithSampleRate:SR maxFrames:4096];
      [h setLinkHook:hook context:&f]; [h seqSetDrumScore:bytes(score())];
      run(h, 200);
      const double now = (double)[h framesRendered];
      [h seqStartWithBpm:100 rate:1 leadMs:100 seed:3];
      NSDictionary *m = [h seqMirror];
      const double first = [m[@"firstFrame"] doubleValue], bar = fold(f.beatAt(hostOf(first)), 4.0) * 60000.0 / f.tempo;
      const double waitMs = (first - now) / 48.0, barMs = 4 * 60000.0 / 126;
      CHECK(std::fabs(bar) < 0.05, "connected: bar one is on the session's bar line (%.4f ms off)", bar);
      CHECK(waitMs >= 100 && waitMs < 100 + barMs + 1, "connected: Play waited %.0f ms, at least the lead and less than a bar more (%.0f)", waitMs, barMs);
      CHECK(f.aligns == 0, "connected: the session's bar line is not asked to move");
      run(h, 2500); m = [h seqMirror];
      CHECK(std::fabs([m[@"tempo"] doubleValue] - 126) < 0.02 && f.proposals == 0, "connected: the session's tempo, not the page's 100 (%.4f), nothing proposed", [m[@"tempo"] doubleValue]);
      CHECK(std::fabs(gridMs(h, f)) < 0.25 && std::fabs([m[@"link"][@"errMs"] doubleValue]) < 0.25, "connected: steps on the session's grid (%.4f ms; the engine says %.4f)", gridMs(h, f), [m[@"link"][@"errMs"] doubleValue]);

      // The page repeats its tempo, as it does with every change of rate. The session must not hear of it.
      [h seqSetTempo:100 rate:1]; run(h, 300); m = [h seqMirror];
      CHECK(f.proposals == 0 && std::fabs([m[@"tempo"] doubleValue] - 126) < 0.02, "connected: a tempo the page repeats moves nothing (%.3f)", [m[@"tempo"] doubleValue]);

      // Somebody else moves the tempo. Count the steps across it: the session's beats since bar one, in sixteenths.
      const double beatFirst = f.beatAt(hostOf(first));      // read before the change: the fake keeps one straight line, not its past
      f.setTempo(141.5, hostOf((double)[h framesRendered]));
      double worst = 0; for (int i = 0; i < 12; i++) { run(h, 250); worst = std::max(worst, std::fabs(gridMs(h, f))); }
      m = [h seqMirror];
      const double beats = f.beatAt(hostOf([m[@"nextFrame"] doubleValue])) - beatFirst;
      const double laid = [m[@"steps"] doubleValue];
      CHECK(std::fabs(beats * 4 - laid) < 0.05, "tempo change: %.0f steps laid out for %.3f sixteenths of the session (none lost, none doubled)", laid, beats * 4);
      CHECK(std::fabs(gridMs(h, f)) < 0.25 && std::fabs([m[@"tempo"] doubleValue] - 141.5) < 0.02, "tempo change: back on the grid at the new tempo (%.4f ms, %.3f); worst on the way %.2f ms", gridMs(h, f), [m[@"tempo"] doubleValue], worst);
      CHECK(worst < 25, "tempo change: never further than the look-ahead explains (%.2f ms)", worst);
      CHECK([m[@"link"][@"segments"] intValue] < 400, "the map stays small (%d segments, %d tempo moves)", [m[@"link"][@"segments"] intValue], [m[@"link"][@"jumps"] intValue]);

      // Stopped: the engine keeps showing the session's tempo.
      [h seqStop]; f.setTempo(88, hostOf((double)[h framesRendered])); run(h, 400);
      CHECK(std::fabs([[h seqMirror][@"tempo"] doubleValue] - 88) < 0.02, "stopped: the tempo still follows the session (%.3f)", [[h seqMirror][@"tempo"] doubleValue]);
    }

    { // Alone: nothing waits, and the session's bar line is put on ours.
      Fake f; f.peers = 0; f.tempo = 110; f.beatRef = 1.9;
      ModEngineHost *h = [[ModEngineHost alloc] initWithSampleRate:SR maxFrames:4096];
      [h setLinkHook:hook context:&f]; [h seqSetDrumScore:bytes(score())];
      run(h, 200);
      const double now = (double)[h framesRendered];
      [h seqStartWithBpm:110 rate:1 leadMs:100 seed:3];
      const double first = [[h seqMirror][@"firstFrame"] doubleValue];
      CHECK(first == now + 4800, "alone: Play does not wait (%.0f frames)", first - now);
      run(h, 1500);
      NSDictionary *m = [h seqMirror];
      CHECK(f.aligns == 1 && f.lastAlign == hostOf(first), "alone: the session's beat 0 was asked onto bar one, once");
      CHECK(std::fabs(fold(f.beatAt(hostOf(first)), 4.0)) < 1e-6 && std::fabs(gridMs(h, f)) < 0.25, "alone: the session's bar line is ours (%.4f ms)", gridMs(h, f));

      // Someone joins and their session wins: its bar line is 1.3 beats from ours. No jump; the beats are pulled together.
      f.peers = 1; f.shift(1.3);
      const double before = [m[@"steps"] doubleValue], f0 = [m[@"nextFrame"] doubleValue];
      double worst = 0; for (int i = 0; i < 24; i++) { run(h, 250); worst = std::max(worst, std::fabs(gridMs(h, f))); }
      m = [h seqMirror];
      CHECK([m[@"link"][@"rebars"] intValue] == 1 && [m[@"link"][@"offset"] doubleValue] == 1, "joined mid-play: the bar lines are known to be one beat apart, not chased");
      CHECK(std::fabs(gridMs(h, f)) < 0.25, "joined mid-play: the beats meet (%.4f ms after 6 s; the 0.3 beats were %.0f ms)", gridMs(h, f), 0.3 * 60000 / 110);
      // Pulled, not jumped: the steps laid out in those 6 s are the frames at a tempo within 5 % of the session's.
      const double steps = [m[@"steps"] doubleValue] - before, span = ([m[@"nextFrame"] doubleValue] - f0) / SR, eff = steps / 4 / span * 60;
      CHECK(eff > 110 * 0.95 && eff < 110 * 1.05, "joined mid-play: caught up by playing at %.2f for a while, not by skipping", eff);
    }
  }
  printf(failed ? "\n%d FAILED\n" : "\nall passed\n", failed);
  return failed ? 1 : 0;
}
