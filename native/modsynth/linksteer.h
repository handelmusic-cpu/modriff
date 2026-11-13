// Ableton Link steering (docs/link.md, section 3): the arithmetic that keeps the engine's tempo map on a Link session's beat grid.
//
// Why this is its own header with no Link in it. The engine keeps its tempo map (every sequencer already reads it), and the session only
// steers it; the SDK itself is touched in one file of the app (ModLink.mm). What is here is plain arithmetic on a snapshot the render thread
// publishes -- "at engine frame F the session was at beat B and tempo T" -- so it compiles and is tested on the Mac without the SDK.
//
// The session's beat is the engine's quarter note. Between snapshots the session's timeline is a straight line at T, so its beat at any
// frame near F is B + (frame - F) * T / (60 * sr).
#pragma once
#include <algorithm>
#include <cmath>

namespace modsynth {

struct LinkSnap {
  double frame = 0;      // engine frame of the first sample of the block the snapshot was taken in
  double beat = 0;       // the session's beat when that sample reaches the output
  double tempo = 0;      // the session's tempo, quarter-note BPM
  int enabled = 0;       // the user has Link switched on
  int peers = 0;
  unsigned aligned = 0;  // counts the alignment requests the render thread has carried out (linkLaunch, alone)
};

inline double linkBeatAt(const LinkSnap &s, double frame, double sr) { return s.beat + (frame - s.frame) * s.tempo / (60.0 * sr); }

// The first frame at or after `frame` where the session is on a bar line (a multiple of `quantum` beats): where Play lands when others are
// already playing, so that every peer's bar one is the same instant.
inline double linkNextBar(const LinkSnap &s, double frame, double quantum, double sr) {
  if (!(s.tempo > 0) || !(quantum > 0)) return frame;
  const double b = linkBeatAt(s, frame, sr);
  const double nb = std::ceil(b / quantum - 1e-9) * quantum;
  return std::max(frame, s.frame + (nb - s.beat) * 60.0 * sr / s.tempo);
}

// `x` folded into [-period/2, period/2).
inline double linkWrap(double x, double period) {
  if (!(period > 0)) return x;
  x = std::fmod(x + period * 0.5, period);
  if (x < 0) x += period;
  return x - period * 0.5;
}

// How far the engine is behind the session at `frame`, in beats (positive: the engine is late and has to run faster). `engineBeat` is the
// engine's beat counted from its own bar one; `offset` is the whole number of beats the two bar lines are known to differ by.
inline double linkError(const LinkSnap &s, double frame, double engineBeat, double offset, double quantum, double sr) {
  return linkWrap(linkBeatAt(s, frame, sr) - engineBeat - offset, quantum);
}

// The tempo the map should take from here: the session's, pushed a little toward the error. The push is proportional (the error halves
// about every 0.35 s) and never more than 5 %, which is a pitch-free speed change too small to hear as one; inside 0.2 ms it is exactly the
// session's tempo, so a settled engine plays a constant tempo and not a jitter around one.
inline double linkSteerBpm(double sessionBpm, double errBeats) {
  const double errSec = errBeats * 60.0 / sessionBpm;
  if (std::fabs(errSec) < 0.0002) return sessionBpm;
  const double push = std::max(-0.05, std::min(0.05, errSec / 0.5));
  return sessionBpm * (1.0 + push);
}

}  // namespace modsynth
