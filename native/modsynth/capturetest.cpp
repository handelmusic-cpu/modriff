// The capture ring, measured: that what comes out is what went in at the
// position it went in, that a reader falling behind loses the oldest audio and
// says how much (and where the rest starts), that arming forgets the last take,
// and — with a real writer thread racing a real reader on a ring small enough
// to be lapped over and over — that no frame is ever handed back torn.
//
// Every sample is a function of its absolute frame, so a torn or misplaced
// frame cannot pass for a good one.
#include "capture.h"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>
#include <vector>
using namespace modsynth;

static int fails = 0;
static void check(bool ok, const char* what, double got) {
  printf("%s %s (%.6g)\n", ok ? "ok  " : "FAIL", what, got);
  if (!ok) fails++;
}

// Left is a ramp of the frame number, right is its negative minus one, so a
// swapped channel or an off-by-one shows. Frame numbers up to 2^23 are exact.
static float vL(uint64_t f) { return (float)(f % 8388608ull); }
static float vR(uint64_t f) { return -1.0f - (float)(f % 8388608ull); }

static void put(CaptureRing& r, uint64_t from, int n, std::vector<float>& L, std::vector<float>& R) {
  L.resize(n); R.resize(n);
  for (int i = 0; i < n; i++) { L[i] = vL(from + i); R[i] = vR(from + i); }
  r.write(L.data(), R.data(), n, from);
}

int main() {
  std::vector<float> L, R, oL(8192), oR(8192);

  // A take comes back whole, in order, at the frame it was written.
  {
    CaptureRing r(4096);
    r.arm();
    uint64_t f = 100000, total = 0, bad = 0, expect = f;
    const int blocks[] = {128, 37, 480, 512, 1};
    for (int b = 0; b < 40; b++) {
      const int n = blocks[b % 5];
      put(r, f, n, L, R); f += n;
      if (b % 3 == 2) {
        uint64_t f0, lost;
        const size_t got = r.read(oL.data(), oR.data(), oL.size(), f0, lost);
        if (lost || (got && f0 != expect)) bad++;
        for (size_t i = 0; i < got; i++) if (oL[i] != vL(f0 + i) || oR[i] != vR(f0 + i)) bad++;
        expect = f0 + got; total += got;
      }
    }
    uint64_t f0, lost;
    const size_t got = r.read(oL.data(), oR.data(), oL.size(), f0, lost);
    for (size_t i = 0; i < got; i++) if (oL[i] != vL(f0 + i) || oR[i] != vR(f0 + i)) bad++;
    total += got;
    check(total == f - 100000, "every frame written is read back", (double)total);
    check(bad == 0, "in order, at the absolute frame it was written, channels the right way round", (double)bad);
  }

  // Not armed: the writer is a no-op and the reader finds nothing.
  {
    CaptureRing r(4096);
    uint64_t f0, lost;
    put(r, 0, 256, L, R);
    check(r.read(oL.data(), oR.data(), 256, f0, lost) == 0, "an unarmed ring takes nothing", 0);
    r.arm();
    check(r.read(oL.data(), oR.data(), 256, f0, lost) == 0, "an armed ring is empty until the engine writes", 0);
    put(r, 5000, 256, L, R);
    check(r.read(oL.data(), oR.data(), 256, f0, lost) == 256 && f0 == 5000, "the first block written starts the take", (double)f0);
    r.stop();
    put(r, 5256, 256, L, R);
    check(r.read(oL.data(), oR.data(), 256, f0, lost) == 0, "a stopped ring takes no more", 0);
  }

  // Stop leaves the audio readable: the last drain after Stop is how the tail
  // of a take reaches the file.
  {
    CaptureRing r(4096);
    r.arm(); put(r, 0, 300, L, R); r.stop();
    uint64_t f0, lost;
    check(r.read(oL.data(), oR.data(), 4096, f0, lost) == 300, "what was written before Stop can still be drained", 300);
  }

  // Arming again forgets the last take, even one never read.
  {
    CaptureRing r(4096);
    r.arm(); put(r, 0, 1000, L, R);
    r.arm(); put(r, 90000, 64, L, R);
    uint64_t f0, lost;
    const size_t got = r.read(oL.data(), oR.data(), 4096, f0, lost);
    check(got == 64 && f0 == 90000 && lost == 0, "a new take starts clean at its own first frame", (double)f0);
  }

  // A reader that falls behind loses the oldest audio, says how much, and the
  // frames it does get are exactly the newest ones.
  {
    CaptureRing r(2048);
    r.arm();
    uint64_t f = 0;
    for (int b = 0; b < 20; b++) { put(r, f, 300, L, R); f += 300; }   // 6000 written, 2048 held
    uint64_t f0, lost, total = 0, totalLost = 0, bad = 0;
    for (;;) {
      const size_t got = r.read(oL.data(), oR.data(), 512, f0, lost);
      totalLost += lost;
      if (!got) break;
      for (size_t i = 0; i < got; i++) if (oL[i] != vL(f0 + i) || oR[i] != vR(f0 + i)) bad++;
      total += got;
    }
    check(total + totalLost == 6000, "frames read + frames reported lost = frames written", (double)(total + totalLost));
    check(total == r.capacity(), "a ring that was lapped hands back exactly what it still holds", (double)total);
    check(bad == 0, "and every one is the right sample at the right frame", (double)bad);
  }

  // The race: a writer at full speed against a reader that sleeps, on a ring
  // that is lapped constantly. Nothing returned may be torn, positions must
  // only move forward, and every frame is accounted for as read or lost.
  {
    CaptureRing r(2048);
    r.arm();
    const uint64_t N = 6'000'000;
    std::atomic<bool> wdone{false};
    std::thread w([&] {
      std::vector<float> a, b;
      uint64_t f = 0;
      while (f < N) {
        const int n = (int)std::min<uint64_t>(128 + (f / 128) % 5 * 37, N - f);
        put(r, f, n, a, b); f += n;
        if ((f / 128) % 64 == 0) std::this_thread::yield();
      }
      wdone.store(true, std::memory_order_release);
    });
    uint64_t f0, lost, read = 0, lostTotal = 0, bad = 0, end = 0, reads = 0;
    // Drain until the writer is done and a read after that comes back empty.
    for (bool finished = false; !finished;) {
      finished = wdone.load(std::memory_order_acquire);
      for (;;) {
        const size_t got = r.read(oL.data(), oR.data(), 700, f0, lost);
        lostTotal += lost; reads++;
        if (!got) break;
        if (f0 < end) bad++;                          // went backwards
        for (size_t i = 0; i < got; i++) if (oL[i] != vL(f0 + i) || oR[i] != vR(f0 + i)) bad++;
        end = f0 + got; read += got;
        if (reads % 4 == 0) std::this_thread::sleep_for(std::chrono::microseconds(150));
      }
    }
    w.join();
    check(bad == 0, "6M frames raced through a 2048-frame ring: none torn, none out of order", (double)bad);
    check(read + lostTotal == N, "every frame is read or reported lost", (double)(read + lostTotal));
    printf("     (read %.1f%%, lost %.1f%%, in %llu reads)\n", 100.0 * read / N, 100.0 * lostTotal / N,
           (unsigned long long)reads);
  }

  printf("%s\n", fails ? "capturetest FAILED" : "capturetest ok");
  return fails ? 1 : 0;
}
