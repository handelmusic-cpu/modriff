// The engine's tempo (docs/native-scheduling.md, slice 4, piece 1): quarter-note BPM as a function of the frame, so that a tempo can move
// while the engine runs and every sequencer stays on the same grid.
//
// Why a map and not a number. Until now each sequencer held its own constant `bpm_` and added one step length to its `next_` per step. A tempo
// the engine moves by itself -- the practice trainer's jump at the end of a chorus, a ritardando, a tempo change written in the song -- has
// to land on the same frame for the drums, the bass and the chord rhythm, whatever scheduling moment each of them reads it at. So the tempo
// is a piecewise function of the frame (a jump is a new segment; a ramp is a segment whose tempo changes linearly in time, then holds), and a
// step is "the span of 0.25 beats that starts here": every sequencer asks the same map, and a step of the bass at rate 2 is exactly half a
// step of the drums, even in the middle of a ramp.
//
// The ramp is linear in TIME, which is the page's ritardando: it steps the tempo so that its square falls linearly with the BEATS
// (index.html, _runEnding 'ritard'), and bpm^2 linear in beats is bpm linear in time (d(bpm^2)/db = k with db/dt = bpm/60 gives dbpm/dt = k/120).
// Beats are the integral of bpm/60 over time, so inside a segment beatAt is a quadratic in the frame and frameAt is its root.
//
// For a stretch of constant tempo `span` returns exactly what the sequencers computed before the map existed ((60 / bpm * beats) * sampleRate),
// bit for bit, so adding the map changes nothing until a tempo moves.
//
// Control-side (the sequencer thread, under the host's lock). Segments are few; lookups are linear from the end, where the clock is.
#pragma once
#include <algorithm>
#include <cmath>
#include <vector>

namespace modsynth {

class TempoMap {
 public:
  explicit TempoMap(double sampleRate = 48000.0, double bpm = 120.0) : sr_(sampleRate) { reset(bpm, 0); }
  void setSampleRate(double sr) { sr_ = sr; }

  // One constant tempo from `frame` on; whatever came before is forgotten.
  void reset(double bpm, double frame = 0) {
    s_.clear();
    s_.push_back({frame, 0.0, clampBpm(bpm), 0.0});
  }
  // The tempo becomes `bpm` at `frame`, and stays. A later segment (a ramp already planned beyond `frame`) is replaced.
  void jump(double frame, double bpm) {
    bpm = clampBpm(bpm);
    if (frame <= s_.front().f0) { reset(bpm, s_.front().f0); return; }
    // The host says the tempo every time a page asks, whether it changed or not; the same constant tempo again is not a new segment.
    if (s_.size() == 1 || s_.back().f0 <= frame) { const Seg &l = s_.back(); if (l.slope == 0.0 && l.bpm0 == bpm && l.f0 <= frame) return; }
    cut(frame);
    const double b = beatAt(frame);
    s_.push_back({frame, b, bpm, 0.0});
  }
  // From `frame` the tempo moves in a straight line (in time) to `bpm1` over `durFrames`, then holds it. Starts from the tempo at `frame`.
  void ramp(double frame, double bpm1, double durFrames) {
    bpm1 = clampBpm(bpm1);
    if (!(durFrames > 0)) { jump(frame, bpm1); return; }
    const double bpm0 = bpmAt(frame);
    if (frame <= s_.front().f0) { const double f0 = s_.front().f0; s_.clear(); s_.push_back({f0, 0.0, bpm0, 0.0}); frame = f0; } else cut(frame);
    const double slope = (bpm1 - bpm0) / durFrames;
    const double b0 = beatAt(frame);
    // The segment that was running keeps its tempo up to `frame`; the ramp is its own segment, and the hold after it another.
    s_.push_back({frame, b0, bpm0, slope});
    const double u = durFrames;
    s_.push_back({frame + u, b0 + (bpm0 * u + slope * u * u * 0.5) / (60.0 * sr_), bpm1, 0.0});
  }

  double bpmAt(double frame) const {
    const Seg &g = s_[segAtFrame(frame)];
    return g.bpm0 + g.slope * (frame - g.f0);
  }
  // Quarter notes since the map's origin at `frame`.
  double beatAt(double frame) const {
    const Seg &g = s_[segAtFrame(frame)];
    const double u = frame - g.f0;
    return g.beat0 + (g.bpm0 * u + g.slope * u * u * 0.5) / (60.0 * sr_);
  }
  // The frame at which `beat` quarter notes have passed.
  double frameAt(double beat) const {
    size_t i = 0;
    for (size_t k = s_.size(); k-- > 0;) if (s_[k].beat0 <= beat) { i = k; break; }
    const Seg &g = s_[i];
    const double c = 60.0 * sr_ * (beat - g.beat0);          // frames * bpm the segment must accumulate
    const double den = g.bpm0 + std::sqrt(std::max(0.0, g.bpm0 * g.bpm0 + 2.0 * g.slope * c));
    return g.f0 + (den > 0 ? 2.0 * c / den : 0.0);          // the stable root of slope/2 u^2 + bpm0 u - c, and c / bpm0 when slope is 0
  }
  // The length in frames of `beats` quarter notes that start at `frame`.
  double span(double frame, double beats) const {
    const size_t i = segAtFrame(frame);
    const Seg &g = s_[i];
    if (g.slope == 0.0) {
      const double len = (60.0 / g.bpm0 * beats) * sr_;
      if (i + 1 >= s_.size() || frame + len <= s_[i + 1].f0) return len;      // the stretch stays inside a constant tempo: the old arithmetic
    }
    return frameAt(beatAt(frame) + beats) - frame;
  }
  double advance(double frame, double beats) const { return frame + span(frame, beats); }

  // Forget the segments that ended before `frame` (the clock never goes back).
  void prune(double frame) {
    while (s_.size() > 1 && s_[1].f0 <= frame) s_.erase(s_.begin());
  }
  size_t segments() const { return s_.size(); }

 private:
  struct Seg { double f0, beat0, bpm0, slope; };      // tempo bpm0 + slope * (frame - f0) from f0 until the next segment
  static double clampBpm(double b) { return std::max(1.0, std::min(1000.0, b)); }
  size_t segAtFrame(double frame) const {
    for (size_t k = s_.size(); k-- > 0;) if (s_[k].f0 <= frame) return k;
    return 0;
  }
  // Drop what lies at or after `frame`, so a new segment can start there.
  void cut(double frame) {
    while (s_.size() > 1 && s_.back().f0 >= frame) s_.pop_back();
  }

  double sr_;
  std::vector<Seg> s_;
};

}  // namespace modsynth
