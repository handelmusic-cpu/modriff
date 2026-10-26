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
  p.push_back(2); p.push_back(0); p.push_back(start); p.push_back(stop);  // 1: osc, sine
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
  p.push_back(start); p.push_back(-1); p.push_back(0);                     // start, stop, offset
  param(p, 1); param(p, 0);
  p.push_back(1); param(p, 1);                                             // 2: gain
  p.push_back(2);
  p.push_back(1); p.push_back(2); p.push_back(-1);
  p.push_back(2); p.push_back(0); p.push_back(-1);
  return p;
}

struct Bus {
  std::vector<float> l[GraphPool::kMaxParts], r[GraphPool::kMaxParts];
  float *pl[GraphPool::kMaxParts], *pr[GraphPool::kMaxParts];
  explicit Bus(int n) {
    for (int i = 0; i < GraphPool::kMaxParts; i++) { l[i].assign(n, 0.f); r[i].assign(n, 0.f); pl[i] = l[i].data(); pr[i] = r[i].data(); }
  }
};

// Plays the pool for `total` frames in the given block sizes (cycled), into a bus.
static void run(GraphPool &pool, Bus &b, int total, const std::vector<int> &blocks) {
  uint64_t f = 0; size_t k = 0;
  while ((int)f < total) {
    const int n = std::min(blocks[k++ % blocks.size()], total - (int)f);
    float *bl[GraphPool::kMaxParts], *br[GraphPool::kMaxParts];
    for (int i = 0; i < GraphPool::kMaxParts; i++) { bl[i] = b.pl[i] + f; br[i] = b.pr[i] + f; }
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
    bool t[8] = {};
    float *bl[8], *br[8]; for (int i = 0; i < 8; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
    pool.render(0, 128, bl, br, t);
    CHECK(t[5] && !t[0] && !t[1] && !t[2] && !t[3] && !t[4] && !t[6] && !t[7], "only part 5 is touched");
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
    V p = sine(330, 0.0, -1, 0.5, 0);
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
      float *bl[8], *br[8]; for (int i = 0; i < 8; i++) { bl[i] = b2.pl[i] + f; br[i] = b2.pr[i] + f; }
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

  // 5. a full pool drops, and counts it.
  {
    GraphPool pool;
    V p = sine(200, 0.0, -1, 0.1, 0);
    int ok = 0;
    for (int i = 0; i < GraphPool::kMaxVoices + 5; i++) if (pool.begin(p.data(), p.size(), 0.0, 0) >= 0) ok++;
    CHECK(ok == GraphPool::kMaxVoices, "%d voices fit", ok);
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
        float *bl[8], *br[8]; for (int i = 0; i < 8; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
        pool.render(f, 128, bl, br); f += 128;
      }
    }
    CHECK(refused == 0, "600 short notes through %d slots: %d refused", GraphPool::kMaxVoices, refused);
  }

  // 7. the control thread begins and edits while the render thread runs.
  {
    GraphPool pool; Bus b(1 << 16);
    std::atomic<bool> stop{false};
    std::thread control([&] {
      V p = sine(300, 0.0, -1, 0.05, 1);
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
      float *bl[8], *br[8]; for (int i = 0; i < 8; i++) { bl[i] = b.pl[i]; br[i] = b.pr[i]; }
      pool.render(f, 128, bl, br); f += 128;
    }
    control.join();
    for (int i = 0; i < 400; i++) { float *bl[8], *br[8]; for (int j = 0; j < 8; j++) { bl[j] = b.pl[j]; br[j] = b.pr[j]; } pool.render(f, 128, bl, br); f += 128; }
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

  printf("%d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
