// The voice pool: what the host will call. Hand-built programs (a sine through
// a gain to a part bus), rendered through GraphPool in awkward block sizes and
// compared with the same program played alone through Graph. Exact equality,
// not closeness: the pool adds, it does not process.
#include <array>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#include "graphpool.h"

using namespace modsynth;
using V = std::vector<double>;
static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static const double SR = 48000;

static void param(V &p, double v0, std::vector<std::array<double, 4>> ev = {}) {
  p.push_back(v0); p.push_back((double)ev.size());
  for (auto &e : ev) for (double x : e) p.push_back(x);
}

// ext(code) <- gain <- osc.   Times are the recorder's own (absolute seconds).
static V sine(double hz, double start, double stop, double amp, int code,
              std::vector<std::array<double, 4>> gainEv = {}) {
  V p = {0x6d6f6467, SR, 3, 0};
  p.push_back(8); p.push_back(code);                                      // 0: ext
  p.push_back(2); p.push_back(0); p.push_back(start); p.push_back(stop);  // 1: osc, sine (-1e9 = unset)
  param(p, hz); param(p, 0);
  p.push_back(1); param(p, amp, gainEv);                                  // 2: gain
  p.push_back(2);                                                         // two edges
  p.push_back(1); p.push_back(2); p.push_back(-1);                        // osc -> gain
  p.push_back(2); p.push_back(0); p.push_back(-1);                        // gain -> ext
  return p;
}


// ext(code) <- gain(1) <- buffer source(id), one-shot, at the graph's own rate.
static V bufprog(int id, double start, int code) {
  V p = {0x6d6f6467, SR, 3, 0};
  p.push_back(8); p.push_back(code);                                       // 0: ext
  p.push_back(4); p.push_back(id); p.push_back(0); p.push_back(0); p.push_back(0);   // 1: buf, no loop
  p.push_back(start); p.push_back(-1e9); p.push_back(0);                  // start, stop (unset), offset
  param(p, 1); param(p, 0);
  p.push_back(1); param(p, 1);                                             // 2: gain
  p.push_back(2);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(0); p.push_back(-1);
  return p;
}

// ext(code) <- delay(maxDelay 1 s, `delay` s) <- osc.  The oscillator stops at `stop`, but
// the delay line is still playing it back until stop + delay: a voice in its release.
static V ringing(double hz, double start, double stop, double delay, int code) {
  V p = {0x6d6f6467, SR, 3, 0};
  p.push_back(8); p.push_back(code);                                      // 0: ext
  p.push_back(2); p.push_back(0); p.push_back(start); p.push_back(stop);  // 1: osc
  param(p, hz); param(p, 0);
  p.push_back(7); p.push_back(1.0); param(p, delay);                      // 2: delay
  p.push_back(2);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(0); p.push_back(-1);
  return p;
}

// ext(code) <- gain(amp) <- waveshaper(curve = 0.5 everywhere) <- osc.  The shaper turns the
// oscillator, and then silence, into a constant 0.5; the gain scales it to a DC level that
// never goes away: the 909 kick's click layer left 3e-6 of it behind.
static V dcResidue(double stop, double amp, int code) {
  V p = {0x6d6f6467, SR, 4, 0};
  p.push_back(8); p.push_back(code);                                      // 0: ext
  p.push_back(2); p.push_back(0); p.push_back(0.0); p.push_back(stop);    // 1: osc
  param(p, 440); param(p, 0);
  p.push_back(5); p.push_back(0); p.push_back(3);                         // 2: shaper, no oversampling, 3 points
  p.push_back(0.5); p.push_back(0.5); p.push_back(0.5);
  p.push_back(1); param(p, amp);                                          // 3: gain
  p.push_back(3);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(3); p.push_back(-1);
  p.push_back(3); p.push_back(0); p.push_back(-1);
  return p;
}

struct Bus {
  std::vector<float> l[GraphPool::kBuses], r[GraphPool::kBuses];
  float *pl[GraphPool::kBuses], *pr[GraphPool::kBuses];
  explicit Bus(int n) {
    for (int i = 0; i < GraphPool::kBuses; i++) { l[i].assign(n, 0.f); r[i].assign(n, 0.f); pl[i] = l[i].data(); pr[i] = r[i].data(); }
  }
};

// Plays the pool for `total` frames in the given block sizes (cycled), into a bus.
static void run(GraphPool &pool, Bus &b, int total, const std::vector<int> &blocks) {
  uint64_t f = 0; size_t k = 0;
  while ((int)f < total) {
    const int n = std::min(blocks[k++ % blocks.size()], total - (int)f);
    float *bl[GraphPool::kBuses], *br[GraphPool::kBuses];
    for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i] + f; br[i] = b.pr[i] + f; }
    pool.render(f, n, bl, br);
    f += n;
  }
}

static std::vector<float> alone(const V &prog, const V &inc, int frames, int after = 0) {
  Graph g; std::vector<float> out(frames, 0.f);
  if (!g.load(prog.data(), prog.size(), 0.0)) return out;
  if (!inc.empty() && after == 0) g.apply(inc.data(), inc.size(), 0.0);
  int done = 0;
  while (done < frames) {
    const int n = std::min<int>(Graph::kQuantum, frames - done);
    g.render(n);
    const float *l = g.extBuf(0, 0);
    for (int i = 0; i < n; i++) out[done + i] = l[i];
    done += n;
  }
  return out;
}

int main() {
  const int N = 24000;
  const std::vector<int> odd = {37, 128, 100, 256, 1, 77, 512, 128};

  // 1. one voice, started between blocks, is the voice played alone, shifted.
  {
    GraphPool pool; Bus b(N);
    V p = sine(440, 0.0, 0.3, 0.5, 2);
    const uint64_t S = 1000;
    CHECK(pool.begin(p.data(), p.size(), 0.0, S) >= 0, "begin");
    run(pool, b, N, odd);
    auto ref = alone(p, {}, N);
    int bad = 0;
    for (int i = 0; i < N; i++) { const float want = i >= (int)S ? ref[i - S] : 0.f; if (b.l[2][i] != want) bad++; }
    CHECK(bad == 0, "one voice, shifted by 1000 frames: %d samples differ", bad);
    bool silent = true; for (int i = 0; i < N; i++) if (b.l[0][i] != 0 || b.l[3][i] != 0) silent = false;
    CHECK(silent, "other parts' buses stay silent");
    CHECK(pool.active() == 0, "the voice retired after its stop (%d active)", pool.active());
  }

  // 1b. `touched` says which parts had a voice write into them this block.
  {
    GraphPool pool; Bus b(512);
    V p = sine(440, 0.0, 0.3, 0.5, 5);
    pool.begin(p.data(), p.size(), 0.0, 0);
    bool t[GraphPool::kBuses] = {};
    float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
    pool.render(0, 128, bl, br, t);
    CHECK(t[5] && !t[0] && !t[1] && !t[2] && !t[3] && !t[4] && !t[6] && !t[7], "only part 5 is touched");
  }

  // 1c. killParts (an ending's landing, the page's hardKillAll): the voices of the named parts begun so far fade to nothing from the frame given, over the time given, whatever
  // block it falls in; a voice of those parts that has not started by then never does; a voice of another part, and one begun after the request, are left alone.
  {
    for (const std::vector<int> &blocks : {odd, std::vector<int>{240}, std::vector<int>{4096}}) {
      GraphPool pool; Bus b(N);
      V a0 = sine(440, 0.0, 10.0, 0.5, 0), a2 = sine(330, 0.0, 10.0, 0.5, 2), late = sine(550, 0.0, 10.0, 0.5, 0), after = sine(660, 0.0, 10.0, 0.5, 0);
      pool.begin(a0.data(), a0.size(), 0.0, 0);                  // part 0, sounding
      pool.begin(a2.data(), a2.size(), 0.0, 0);                  // part 2, sounding
      pool.begin(late.data(), late.size(), 0.0, 9000);           // part 0, due after the kill frame: never starts
      const uint64_t K = 6001; const int FADE = 1056;
      CHECK(pool.killParts(1u << 0, K, FADE), "the kill is queued");
      pool.begin(after.data(), after.size(), 0.0, K);            // part 0, begun after the request: left alone
      run(pool, b, N, blocks);
      auto r0 = alone(a0, {}, N), r2 = alone(a2, {}, N), ra = alone(after, {}, N);
      int bad = 0, badFade = 0, badAfter = 0, badOther = 0;
      for (int i = 0; i < N; i++) {
        float g = 1.f; if (i >= (int)K) g = i >= (int)K + FADE ? 0.f : 1.f - (float)(i - K) / (float)FADE;
        const float want = r0[i] * g + (i >= (int)K ? ra[i - K] : 0.f);
        if (std::fabs(b.l[0][i] - want) > 1e-5f) bad++;
        if (std::fabs(b.l[2][i] - r2[i]) > 0) badOther++;
      }
      (void)badFade; (void)badAfter;
      CHECK(bad == 0, "blocks %d: the part's earlier voices fade from %d over %d frames and the later one is untouched (%d samples differ)", blocks[0], (int)K, FADE, bad);
      CHECK(badOther == 0, "blocks %d: another part is not touched (%d samples differ)", blocks[0], badOther);
      CHECK(pool.active() == 2, "blocks %d: the faded voices and the one that never started are retired (%d active: the other part and the later one)", blocks[0], pool.active());
    }
  }

  // 2. two voices in one part sum.
  {
    GraphPool pool; Bus b(N);
    V p1 = sine(440, 0, 0.2, 0.4, 1), p2 = sine(660, 0, 0.25, 0.3, 1);
    pool.begin(p1.data(), p1.size(), 0.0, 100); pool.begin(p2.data(), p2.size(), 0.0, 4321);
    run(pool, b, N, odd);
    auto r1 = alone(p1, {}, N), r2 = alone(p2, {}, N);
    int bad = 0;
    for (int i = 0; i < N; i++) { float want = 0; if (i >= 100) want += r1[i - 100]; if (i >= 4321) want += r2[i - 4321]; if (b.l[1][i] != want) bad++; }
    CHECK(bad == 0, "two voices sum exactly: %d samples differ", bad);
  }

  // 3. a voice with no stop time plays until an edit stops it, then retires.
  {
    GraphPool pool; Bus b(N);
    V p = sine(330, 0.0, -1e9, 0.5, 0);
    int h = pool.begin(p.data(), p.size(), 0.0, 0);
    run(pool, b, 4800, odd);   // 0.1 s: still sounding
    CHECK(pool.active() == 1, "an unstopped voice is still active");
    // stop at 0.15 s: node 1 (the osc), param -1, op 6
    V inc = {1, -1, 6, 0, 0.15, 0};
    CHECK(pool.edit(h, inc.data(), inc.size()), "edit accepted");
    Bus b2(N);
    // continue from frame 4800
    uint64_t f = 4800; size_t k = 0;
    while ((int)f < N) {
      const int n = std::min(odd[k++ % odd.size()], N - (int)f);
      float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b2.pl[i] + f; br[i] = b2.pr[i] + f; }
      pool.render(f, n, bl, br); f += n;
    }
    double tailEnergy = 0; for (int i = 7200 + 200; i < N; i++) tailEnergy += std::fabs(b2.l[0][i]);
    CHECK(tailEnergy == 0, "silent after the edited stop (%g)", tailEnergy);
    CHECK(pool.active() == 0, "retired after the edit (%d active)", pool.active());
    CHECK(!pool.edit(h, inc.data(), inc.size()), "a finished voice's handle is refused");
  }

  // 4. an edit queued before the voice starts is the same as editing it first.
  {
    GraphPool pool; Bus b(N);
    V p = sine(550, 0.0, 0.5, 0.5, 4, {{0, 0.5, 0.0, 0}});   // gain set 0.5 at t=0
    V inc = {2, 0, 2, 0.0001, 0.3, 0};                       // exp ramp to ~0 at 0.3 s on the gain
    int h = pool.begin(p.data(), p.size(), 0.0, 2000);
    CHECK(pool.edit(h, inc.data(), inc.size()), "edit before start");
    run(pool, b, N, odd);
    auto ref = alone(p, inc, N);
    int bad = 0;
    for (int i = 0; i < N; i++) { const float want = i >= 2000 ? ref[i - 2000] : 0.f; if (b.l[4][i] != want) bad++; }
    CHECK(bad == 0, "edit before start matches edit-then-play: %d differ", bad);
  }

  // 5. a pool with no slot left at all (never rendered, so nothing could make way) drops, and counts it.
  {
    GraphPool pool;
    V p = sine(200, 0.0, -1e9, 0.1, 0);
    int ok = 0;
    for (int i = 0; i < GraphPool::kSlots + 5; i++) if (pool.begin(p.data(), p.size(), 0.0, 0) >= 0) ok++;
    CHECK(ok == GraphPool::kSlots, "%d voices fit", ok);
    CHECK(pool.dropped() == 5, "dropped %llu", (unsigned long long)pool.dropped());
  }

  // 6. slots are reused: many more notes than slots, one after another.
  {
    GraphPool pool; Bus b(N);
    V p = sine(440, 0.0, 0.01, 0.2, 0);
    int refused = 0; uint64_t f = 0;
    for (int note = 0; note < 600; note++) {
      if (pool.begin(p.data(), p.size(), 0.0, f) < 0) refused++;
      for (int blk = 0; blk < 4; blk++) {
        float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
        pool.render(f, 128, bl, br); f += 128;
      }
    }
    CHECK(refused == 0, "600 short notes through %d slots: %d refused", GraphPool::kSlots, refused);
  }

  // 7. the control thread begins and edits while the render thread runs.
  {
    GraphPool pool; Bus b(1 << 16);
    std::atomic<bool> stop{false};
    std::thread control([&] {
      V p = sine(300, 0.0, -1e9, 0.05, 1);
      V inc = {1, -1, 6, 0, 0.02, 0};
      for (int i = 0; i < 3000; i++) {
        int h = pool.begin(p.data(), p.size(), 0.0, 0);
        if (h >= 0) pool.edit(h, inc.data(), inc.size());
        std::this_thread::yield();
      }
      stop = true;
    });
    uint64_t f = 0;
    while (!stop.load()) {
      float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
      pool.render(f, 128, bl, br); f += 128;
    }
    control.join();
    for (int i = 0; i < 400; i++) { float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int j = 0; j < GraphPool::kBuses; j++) { bl[j] = b.pl[j]; br[j] = b.pr[j]; } pool.render(f, 128, bl, br); f += 128; }
    CHECK(pool.active() == 0, "after the storm every voice has retired (%d left)", pool.active());
  }


  // 8. recorded audio is played by id: refused until the clip is in the store,
  // then played at its own rate, once, and the voice retires when it runs out.
  {
    GraphPool pool; Bus b(N);
    V p = bufprog(7, 0.0, 3);
    CHECK(pool.begin(p.data(), p.size(), 0.0, 0) == -2, "an unknown buffer id is refused with -2");
    CHECK(pool.unknownBuffer() == 7, "and the id is reported (%d)", pool.unknownBuffer());
    std::vector<float> clip(3000);
    for (int i = 0; i < 3000; i++) clip[i] = (float)i / 3000.f;
    pool.buffers().put(7, SR, 1, 3000, clip.data(), nullptr);
    CHECK(pool.begin(p.data(), p.size(), 0.0, 500) >= 0, "begin once the clip is stored");
    run(pool, b, N, odd);
    int bad = 0;
    for (int i = 0; i < N; i++) { float want = (i >= 500 && i < 3500) ? clip[i - 500] : 0.f; if (std::fabs(b.l[3][i] - want) > 1e-6f) bad++; }
    CHECK(bad == 0, "the clip plays through unchanged: %d samples differ", bad);
    CHECK(b.r[3][1000] == b.l[3][1000], "a mono clip is centred");
    CHECK(pool.active() == 0, "the voice retired when the clip ran out (%d)", pool.active());
    // a clip at another rate plays at its own pace: 24 kHz plays at half speed
    GraphPool pool2; Bus b2(N);
    std::vector<float> slow(1000);
    for (int i = 0; i < 1000; i++) slow[i] = std::sin(2 * 3.14159265358979 * 440 * i / 24000.0);
    pool2.buffers().put(9, 24000.0, 1, 1000, slow.data(), nullptr);
    V p2 = bufprog(9, 0.0, 2);
    pool2.begin(p2.data(), p2.size(), 0.0, 0);
    run(pool2, b2, 4000, odd);
    // twice as many output samples as the clip has; sample 2k lands on clip[k]
    int bad2 = 0;
    for (int k = 1; k < 900; k++) if (std::fabs(b2.l[2][2 * k] - slow[k]) > 1e-5f) bad2++;
    CHECK(bad2 == 0, "a 24 kHz clip plays at half speed: %d samples off", bad2);
  }


  // 9. a voice that reaches the host late (its origin is already in the past)
  // is caught up, not started from its beginning: what sounds now is what
  // would be sounding had it arrived on time, and what was missed is dropped.
  {
    GraphPool pool; Bus b(N);
    V p = sine(440, 0.0, 0.4, 0.5, 6);
    pool.begin(p.data(), p.size(), 0.0, 1000);
    // the first block the pool sees begins at frame 5000: 4000 frames late
    uint64_t f = 5000; size_t k = 0;
    while ((int)f < N) {
      const int n = std::min(odd[k++ % odd.size()], N - (int)f);
      float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i] + f; br[i] = b.pr[i] + f; }
      pool.render(f, n, bl, br); f += n;
    }
    auto ref = alone(p, {}, N);
    int bad = 0;
    for (int i = 5000; i < N; i++) { const float want = ref[i - 1000]; if (std::fabs(b.l[6][i] - want) > 1e-6f) bad++; }
    CHECK(bad == 0, "a late voice is caught up to where it should be: %d samples differ", bad);
  }


  // 10. A full pool takes a voice instead of refusing the note. kMaxVoices-1 voices that
  // never end (held, quiet) plus one more of a different part; at block 37 (frame 4736) a
  // new note is due. The render thread fades out the quietest, the new note sounds from its
  // first sample, and every other voice is bit-identical to a run where nothing was stolen.
  {
    const int HOLD = GraphPool::kMaxVoices - 1, T = 94 * 128, T0 = 37 * 128;
    V held = sine(300, 0.0, -1e9, 0.01, 0);
    V quiet = sine(440, 0.0, -1e9, 0.002, 1);     // the quietest voice (held are 0.01): this one makes way
    V fresh = sine(880, 0.0, 0.5, 0.3, 2);
    auto play = [&](bool withNew, Bus &b, GraphPool &pool) {
      for (int i = 0; i < HOLD; i++) pool.begin(held.data(), held.size(), 0.0, 0);
      pool.begin(quiet.data(), quiet.size(), 0.0, 0);
      uint64_t f = 0; bool sent = false;
      while ((int)f < T) {
        if (withNew && !sent && f == (uint64_t)T0) { sent = pool.begin(fresh.data(), fresh.size(), 0.0, (uint64_t)T0) >= 0; CHECK(sent, "the new note was taken, not refused"); }
        float *bl[GraphPool::kBuses], *br[GraphPool::kBuses];
        for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i] + f; br[i] = b.pr[i] + f; }
        pool.render(f, 128, bl, br); f += 128;
      }
    };
    GraphPool ctl, pool; Bus bc(T), b(T);
    play(false, bc, ctl); play(true, b, pool);
    CHECK(ctl.stolen() == 0 && pool.stolen() == 1, "one steal (%llu), none in the control run (%llu)", (unsigned long long)pool.stolen(), (unsigned long long)ctl.stolen());
    CHECK(pool.dropped() == 0, "nothing dropped (%llu)", (unsigned long long)pool.dropped());
    CHECK(pool.active() == GraphPool::kMaxVoices, "%d sounding after the steal (cap %d)", pool.active(), GraphPool::kMaxVoices);
    int diff0 = 0; for (int i = 0; i < T; i++) if (b.l[0][i] != bc.l[0][i]) diff0++;
    CHECK(diff0 == 0, "the %d held voices are untouched by the steal: %d samples differ", HOLD, diff0);
    auto refN = alone(fresh, {}, T), refQ = alone(quiet, {}, T);
    int badN = 0; for (int i = 0; i < T; i++) { const float want = i >= T0 ? refN[i - T0] : 0.f; if (b.l[2][i] != want) badN++; }
    CHECK(badN == 0, "the new note sounds from its first sample, exactly: %d differ", badN);
    int badQ = 0; double stepFade = 0, stepOwn = 0, endLvl = 0, cut = std::fabs(refQ[T0]);
    for (int i = 0; i < T; i++) {
      const int k = i - T0;
      const float g = k < 0 ? 1.f : k < GraphPool::kFadeFrames ? (float)(GraphPool::kFadeFrames - k) / (float)GraphPool::kFadeFrames : 0.f;
      if (b.l[1][i] != refQ[i] * g) badQ++;
      if (k >= 0 && k <= GraphPool::kFadeFrames + 1 && i > 0) { stepFade = std::max(stepFade, (double)std::fabs(b.l[1][i] - b.l[1][i - 1])); stepOwn = std::max(stepOwn, (double)std::fabs(refQ[i] - refQ[i - 1])); }
      if (k > GraphPool::kFadeFrames) endLvl = std::max(endLvl, (double)std::fabs(b.l[1][i]));
    }
    CHECK(badQ == 0, "the stolen voice is its own sound times a linear ramp: %d differ", badQ);
    CHECK(stepFade <= stepOwn + 1e-9, "no click: largest step in the fade %.5f, the voice's own %.5f", stepFade, stepOwn);
    CHECK(endLvl == 0, "silent once the fade is over (%g)", endLvl);
    printf("  steal: fade %d frames (%.1f ms); step in fade %.5f vs own %.5f; a hard cut at that point would step %.5f (%.1fx)\n",
           GraphPool::kFadeFrames, 1000.0 * GraphPool::kFadeFrames / SR, stepFade, stepOwn, cut, cut / std::max(stepOwn, 1e-12));
  }

  // 10b. Who makes way: a voice already in its release goes before a quieter one that is still
  // held. The ringing voice (louder than anything held) has had its oscillator stopped; its
  // delay line is still playing it back at the moment the new note arrives.
  {
    const int HOLD = GraphPool::kMaxVoices - 1, T = 71 * 128, T0 = 37 * 128;
    V held = sine(300, 0.0, -1e9, 0.01, 0);
    V ring = ringing(500, 0.0, 0.09, 0.05, 1);    // oscillator off at 0.09 s (frame 4320), heard until 0.14 s (6720)
    V fresh = sine(880, 0.0, 0.5, 0.3, 2);
    GraphPool pool; Bus b(T);
    for (int i = 0; i < HOLD; i++) pool.begin(held.data(), held.size(), 0.0, 0);
    pool.begin(ring.data(), ring.size(), 0.0, 0);
    uint64_t f = 0;
    while ((int)f < T) {
      if (f == (uint64_t)T0) pool.begin(fresh.data(), fresh.size(), 0.0, (uint64_t)T0);
      float *bl[GraphPool::kBuses], *br[GraphPool::kBuses];
      for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i] + f; br[i] = b.pr[i] + f; }
      pool.render(f, 128, bl, br); f += 128;
    }
    auto refR = alone(ring, {}, T);
    double before = 0, after = 0, endHeld = 0;
    for (int i = T0 - 128; i < T0; i++) before = std::max(before, (double)std::fabs(refR[i]));
    for (int i = T0 + GraphPool::kFadeFrames + 1; i < T; i++) { after = std::max(after, (double)std::fabs(b.l[1][i])); }
    for (int i = T - 128; i < T; i++) endHeld = std::max(endHeld, (double)std::fabs(b.l[0][i]));
    CHECK(pool.stolen() == 1, "one steal (%llu)", (unsigned long long)pool.stolen());
    CHECK(before > 0.1 && after == 0, "the releasing voice (still at %.3f) was the one taken, silent after its fade (%g)", before, after);
    CHECK(endHeld > 0.5, "the held voices are all still sounding (%.3f)", endHeld);
  }

  // 10c. The case that filled the owner's pool: notes that never end. 600 unstopped notes, one
  // every 4 blocks. Before: 64 fit and 536 were refused. Now: none is refused, the cap holds.
  {
    GraphPool pool; Bus b(1 << 14);
    V p = sine(200, 0.0, -1e9, 0.01, 0);
    int refused = 0; uint64_t f = 0;
    for (int note = 0; note < 600; note++) {
      if (pool.begin(p.data(), p.size(), 0.0, f) < 0) refused++;
      for (int blk = 0; blk < 4; blk++) {
        float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
        pool.render(f, 128, bl, br); f += 128;
      }
    }
    CHECK(refused == 0 && pool.dropped() == 0, "600 never-ending notes: %d refused, %llu dropped", refused, (unsigned long long)pool.dropped());
    CHECK(pool.stolen() == 600 - GraphPool::kMaxVoices, "%llu stolen (expect %d)", (unsigned long long)pool.stolen(), 600 - GraphPool::kMaxVoices);
    CHECK(pool.active() == GraphPool::kMaxVoices, "%d sounding (cap %d)", pool.active(), GraphPool::kMaxVoices);
    CHECK(pool.peakActive() <= GraphPool::kMaxVoices + 1, "peak %d", pool.peakActive());
    printf("  never-ending notes: 600 begun, %llu stolen, %llu dropped, peak %d, %d sounding\n", (unsigned long long)pool.stolen(), (unsigned long long)pool.dropped(), pool.peakActive(), pool.active());
  }

  // 11. A voice whose sources have stopped but whose output sits at a constant a few millionths
  // off zero (a waveshaper whose curve does not pass through 0, then a gain at its floor) is
  // finished, not "still ringing" for ever. 300 of them, one per 4 blocks, never fill the pool.
  {
    GraphPool pool; Bus b(1 << 14);
    V p = dcResidue(0.05, 6e-6, 3);               // 0.5 * 6e-6 = 3e-6 of DC, above the old 1e-6 floor
    uint64_t f = 0; int refused = 0, peakDuring = 0;
    for (int note = 0; note < 300; note++) {
      if (pool.begin(p.data(), p.size(), 0.0, f) < 0) refused++;
      for (int blk = 0; blk < 4; blk++) {
        float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
        pool.render(f, 128, bl, br); f += 128;
      }
      peakDuring = std::max(peakDuring, pool.active());
    }
    for (int blk = 0; blk < 200; blk++) {
      float *bl[GraphPool::kBuses], *br[GraphPool::kBuses]; for (int i = 0; i < GraphPool::kBuses; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
      pool.render(f, 128, bl, br); f += 128;
    }
    CHECK(refused == 0 && pool.stolen() == 0, "300 DC-residue notes: %d refused, %llu stolen", refused, (unsigned long long)pool.stolen());
    CHECK(pool.active() == 0, "all retired (%d left)", pool.active());
    printf("  DC residue: 300 notes, most at once %d, %d left after 0.5 s\n", peakDuring, pool.active());
  }

  printf("%d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
