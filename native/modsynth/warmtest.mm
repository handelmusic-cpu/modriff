// What the speaker hears while a part is being warmed up. start() has already
// started the audio engine when the page calls ensurePart, so the render
// callback is running (on another thread) while warmUpPart plays its notes.
// It must hear nothing: the warm-up is done before the part is published.
// (Before the fix: peak 0.5-0.65 for ~60 ms at every launch.)
#import <Foundation/Foundation.h>
#import "ModEngineHost.h"
#include <atomic>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>
int main() {
  @autoreleasepool {
    ModEngineHost* h = [[ModEngineHost alloc] initWithSampleRate:48000 maxFrames:4096];
    std::atomic<bool> go{true};
    std::atomic<long> blocksLoud{0}, blocks{0};
    std::atomic<float> peak{0};
    std::thread audio([&] {
      std::vector<float> L(512), R(512);
      while (go.load()) {
        [h renderInto:L.data() right:R.data() frames:512];
        float pk = 0; for (int i = 0; i < 512; i++) pk = std::fmax(pk, std::fmax(std::fabs(L[i]), std::fabs(R[i])));
        blocks++; if (pk > 0.001f) blocksLoud++;
        if (pk > peak.load()) peak.store(pk);
        std::this_thread::sleep_for(std::chrono::microseconds(800));   // faster than real time, so the race is easy to hit
      }
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    [h warmUpPart:0];
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    go = false; audio.join();
    printf("blocks %ld, loud blocks %ld, peak %.4f\n", blocks.load(), blocksLoud.load(), peak.load());
    printf("%s\n", blocksLoud.load() == 0 ? "warmtest ok: silent during warm-up" : "warmtest FAILED: the warm-up is audible");
    return blocksLoud.load() == 0 ? 0 : 1;
  }
}
