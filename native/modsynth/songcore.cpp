#include "songcore.h"

namespace modsynth {

bool SongScore::fromDoubles(const double *d, size_t n, size_t *used) {
  size_t k = 0;
  auto need = [&](size_t m) { return k + m <= n; };
  if (!need(6) || d[0] != 5) return false;
  k = 1;
  SongScore s;
  s.barSteps = (int)d[k++]; s.swingOn = d[k++] != 0; s.swing = d[k++]; s.clocked = d[k++] != 0; s.capo = (int)d[k++];
  if (s.barSteps < 1 || s.barSteps > 256) return false;
  if (!readLocks(d, n, k, s.locks)) return false;
  if (!need(1)) return false;
  const double ns = d[k++];
  if (!(ns >= 0 && ns <= 256)) return false;
  for (size_t i = 0; i < (size_t)ns; i++) {
    if (!need(3)) return false;
    SongSection sec; sec.plays = (int)d[k]; sec.follow = d[k + 1] != 0; const double nsl = d[k + 2]; k += 3;
    if (!(nsl >= 0 && nsl <= 1024)) return false;
    for (size_t j = 0; j < (size_t)nsl; j++) {
      if (!need(12)) return false;
      SongSlot sl;
      sl.bars = (int)d[k]; sl.beats = (int)d[k + 1]; sl.eighths = (int)d[k + 2]; sl.rest = d[k + 3] != 0; sl.rootM = (int)d[k + 4]; sl.bassM = (int)d[k + 5];
      sl.lock = (int)d[k + 6]; sl.voicing = (int)d[k + 7]; sl.hold = d[k + 8] != 0; sl.ring = d[k + 9]; sl.pat = (int)d[k + 10];
      if (sl.voicing >= kVoicingStyles) return false;
      const double ni = d[k + 11]; k += 12;
      if (!(ni >= 0 && ni <= 16) || !need((size_t)ni)) return false;
      for (size_t q = 0; q < (size_t)ni; q++) sl.ivs.push_back((int)d[k++]);
      if (sl.lock >= (int)s.locks.size()) return false;
      sec.slots.push_back(std::move(sl));
    }
    s.sections.push_back(std::move(sec));
  }
  // the practice trainer
  if (!need(11)) return false;
  {
    SongTrainer &t = s.trainer;
    t.loopOn = d[k] != 0; t.loopSection = (int)d[k + 1]; t.loopA = (int)d[k + 2]; t.loopB = (int)d[k + 3];
    t.rampOn = d[k + 4] != 0; t.rampStep = (int)d[k + 5]; t.rampEvery = (int)d[k + 6]; t.rampMax = (int)d[k + 7];
    t.keyOn = d[k + 8] != 0; t.keyEvery = (int)d[k + 9]; t.keyBy = (int)d[k + 10];
    k += 11;
  }
  // the ending
  if (!need(4)) return false;
  { EndingCfg &e = s.ending; e.barBeats = d[k]; e.beatMul = d[k + 1]; e.lookaheadSec = d[k + 2]; e.armed = (int)d[k + 3]; k += 4; if (e.armed < 0 || e.armed > kEndRitard) return false; }
  // the landing
  if (!need(1)) return false;
  if (d[k++] != 0) {
    if (!need(6)) return false;
    EndLanding &l = s.landing;
    l.on = true; l.kickLane = (int)d[k]; l.cymLane = (int)d[k + 1]; l.snareLane = (int)d[k + 2]; l.root = (int)d[k + 3]; l.bassOct = (int)d[k + 4];
    const double ni = d[k + 5]; k += 6;
    if (!(ni >= 1 && ni <= 12) || !need((size_t)ni)) return false;
    for (size_t q = 0; q < (size_t)ni; q++) l.ivs.push_back((int)d[k++]);
  }
  // how the chords sound
  if (!need(1)) return false;
  if (d[k++] != 0) {
    if (!need(8)) return false;
    SongVoiceCfg &v = s.voice;
    v.on = true; v.kit = (int)d[k]; v.play = d[k + 1] != 0; v.pedal = d[k + 2] != 0;
    v.vc.style = (int)d[k + 3]; v.vc.vary = d[k + 4] != 0; v.vc.autoInv = d[k + 5] != 0; v.vc.keyRoot = (int)d[k + 6];
    const double nst = d[k + 7]; k += 8;
    if (v.vc.style < 0 || v.vc.style >= kVoicingStyles || !(nst >= 0 && nst <= 24) || !need((size_t)nst + 10)) return false;
    v.vc.modeSteps.clear();
    for (size_t q = 0; q < (size_t)nst; q++) v.vc.modeSteps.push_back((int)d[k++]);
    v.decRaw = d[k]; v.chordBeats = d[k + 1]; v.strum = d[k + 2] != 0; v.spread = d[k + 3]; v.width = d[k + 4]; v.sub = d[k + 5] != 0; v.velBase = d[k + 6];
    v.feelSwing = d[k + 7]; v.swing8 = d[k + 8] != 0;
    const double np = d[k + 9]; k += 10;
    if (!(np >= 0 && np <= 256)) return false;
    for (size_t q = 0; q < (size_t)np; q++) {
      if (!need(4)) return false;
      CompPattern cp; cp.drawn = d[k] != 0; cp.steps = (int)d[k + 1]; cp.swing = d[k + 2]; const double ne = d[k + 3]; k += 4;
      if ((cp.drawn && (cp.steps < 1 || cp.steps > 256)) || !(ne >= 0 && ne <= 1024) || !need((size_t)ne * 3)) return false;
      for (size_t j = 0; j < (size_t)ne; j++) { cp.ev.push_back({d[k], d[k + 1], d[k + 2]}); k += 3; }
      v.patterns.push_back(std::move(cp));
    }
    for (const SongSection &sec : s.sections) for (const SongSlot &sl : sec.slots) if (sl.pat >= (int)v.patterns.size()) return false;
  }
  // The melody generator's locks are optional, after a -7: a score written for the bass alone ends above.
  if (k < n && d[k] == -7) {
    k++;
    size_t total = 0;
    for (const SongSection &sec : s.sections) total += sec.slots.size();
    if (!need(total)) return false;
    std::vector<int> idx;
    for (size_t i = 0; i < total; i++) idx.push_back((int)d[k++]);
    if (!readMelLocks(d, n, k, s.melLocks)) return false;
    size_t q = 0;
    for (SongSection &sec : s.sections) for (SongSlot &sl : sec.slots) { sl.melLock = idx[q++]; if (sl.melLock >= (int)s.melLocks.size()) return false; }
  }
  *this = std::move(s);
  if (used) *used = k;
  return true;
}

}  // namespace modsynth
