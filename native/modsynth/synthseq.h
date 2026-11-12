// Sequencer notes for an existing part Processor. Graph programs cannot carry
// these: msxVoice's oscillator is only a silent handle for a note sent elsewhere.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <vector>

namespace modsynth {
struct SynthEvent {
  enum Kind { Note, Release, Choke, StopRelease, StopChoke } kind = Note;
  double note = 60, id = 0, frame = 0, end = 0, vel = 0.85;
  const double *group = nullptr; int count = 0;
};
struct SynthLane {
  double sr = 48000;
  std::function<bool(const SynthEvent &)> send;
  uint64_t notes = 0, releases = 0, chokes = 0, refused = 0;
  double nextId = -1;
  struct Held { double note, id, end; };
  std::vector<Held> held;

  // IDs stay negative and never rewind on transport restart. A delayed release
  // from a prior run must not let go of the new note (page IDs are positive).
  void reset() { notes = releases = chokes = refused = 0; }
  double play(int note, double frame, double dur, double now) {
    if (!send) { refused++; return 0; }
    const double id = nextId--, end = std::floor(std::max(0.0, frame + std::max(0.03, dur) * sr) + 0.5);
    frame = std::floor(std::max(0.0, frame) + 0.5);
    note = std::max(0, std::min(127, note));
    // msxVoice currently sends 0.85, independently of the surrounding graph's
    // velocity/envelope. Keep that contract until its dynamic path is changed.
    if (!send({SynthEvent::Note, (double)note, id, frame, end, 0.85})) { refused++; return 0; }
    held.erase(std::remove_if(held.begin(), held.end(), [&](const Held &h) { return h.end + 30 * sr < now; }), held.end());
    // Processor has at most sixteen voices; retain enough IDs to also cancel
    // densely scheduled notes that are still waiting in its event queue.
    if (held.size() >= 512) held.erase(held.begin());
    held.push_back({(double)note, id, end}); notes++; return id;
  }
  bool release(double note, double id, double frame) {
    frame = std::floor(std::max(0.0, frame) + 0.5);
    if (!send || !id || !send({SynthEvent::Release, note, id, frame, 0, 0})) { refused++; return false; }
    releases++; return true;
  }
  void stop(double frame, bool choke) {
    // Pack releases: a long run retains many IDs for patch tails. Sending one
    // queue message per ID could fill the host queue and lose the newest offs.
    double pairs[128]; int count = 0;
    auto flush = [&] {
      if (!count) return;
      SynthEvent e; e.kind = choke ? SynthEvent::StopChoke : SynthEvent::StopRelease;
      e.frame = std::floor(std::max(0.0, frame) + 0.5); e.group = pairs; e.count = count;
      if (!send || !send(e)) refused += count;
      else if (choke) chokes += count; else releases += count;
      count = 0;
    };
    for (const Held &h : held) {
      if (!choke && h.end < frame) continue;
      pairs[2 * count] = h.note; pairs[2 * count + 1] = h.id;
      if (++count == 64) flush();
    }
    flush(); held.clear();
  }
};
} // namespace modsynth
