// How the page voices a chord (docs/native-scheduling.md, slice 4, piece 3), as plain C++ with no iOS and no audio, so a Mac test can hold it to the page.
// It is a line-for-line port of index.html's smartVoiceLead (the voice leading, with its memory of the last chord), chordVoicing (the voicing the
// player chose, Vary's lap through the types), voiceIntervals (Close and Spread), styledVoicing (Soul/R&B and Neo-soul), jazzVoicing (Drop 2 and Drop 3)
// and chordEngineEvent (the notes a chord becomes, and where a slash chord's bass goes).
//
// The page keeps the memory of the last chord in globals (_prevVoices, _styledPrevTop, _jazzPrev, _vvCount, _vvHist, _vvLastId); here it is a VoiceLead
// the song owns, so a song that plays in the engine leads its voices from its own last chord. It starts empty, as the page's does after a key change or
// the VoiceLead switch is toggled: the first chord of a song is centred, not led from whatever a pad played before.
//
// The guitar voices (a sampled voice, and so not in the engine yet) have their own grips and are left out; the page's score refuses them.
//
// Arithmetic. Every score is a sum then one more term, and the page's is a double sum. A fused multiply-add would round differently and could break a tie the
// other way, so each product is its own statement.
//
// Control-side (the sequencer thread): it allocates.
#pragma once
#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

namespace modsynth {

enum VoicingStyle { kVoiceClose = 0, kVoiceOpen, kVoiceDrop2, kVoiceDrop3, kVoiceRnb, kVoiceNeo, kVoicingStyles };

struct VoicingConfig {
  int style = kVoiceClose;          // the voicing set in Settings (a chord can carry its own: passed per call)
  bool vary = false;                // each fresh strike takes the next voicing type
  bool autoInv = true;              // VoiceLead
  int keyRoot = 0;                  // the key (the page's `root`), a pitch class, with the live capo added
  std::vector<int> modeSteps = {0, 2, 4, 5, 7, 9, 11};   // MODES[mode].steps; empty: no key to ask
};

class VoiceLead {
 public:
  void reset() { *this = VoiceLead(); }

  // Every slot is a new chord for Vary, even the same chord as the last one (playChartSlot2 raises _vvFresh).
  void fresh() { vvFresh_ = true; }
  // smartVoiceLead. `floor` (a slash chord's bass note) is INT_MIN for none.
  std::vector<int> smartVoiceLead(int rootM, const std::vector<int> &rel, int floor) {
    int LO = 48; const int HI = 79;
    if (floor != INT_MIN) LO = std::max(LO, std::min(floor + 1, HI - 12));
    const double CENTER = 64, PULL = 0.55;
    const size_t n = rel.size();
    if (n == 0) return rel;
    std::vector<std::vector<int>> pools(n);
    for (size_t i = 0; i < n; i++) {
      const int abs = rootM + rel[i];
      for (int k = -4; k <= 4; k++) { const int v = abs + k * 12; if (v >= LO && v <= HI) pools[i].push_back(v); }
      if (pools[i].empty()) { int v = abs; while (v < LO) v += 12; while (v > HI) v -= 12; pools[i].push_back(v); }
    }
    if (prev_.empty()) {
      const int shifts[] = {-24, -12, 0, 12, 24, 36};
      std::vector<int> best; bool have = false; double bestD = INFINITY;
      for (int sh : shifts) {
        std::vector<int> cand;
        bool bad = false;
        for (int s2 : rel) { const int v = rootM + s2 + sh; if (v < LO || v > HI) bad = true; cand.push_back(v); }
        if (bad) continue;
        double sum = 0; for (int v : cand) sum += v;
        const double mean = sum / (double)cand.size();
        const double d = std::fabs(mean - CENTER);
        if (d < bestD) { bestD = d; best = cand; have = true; }
      }
      if (!have) {
        for (size_t i = 0; i < n; i++) {
          const double target = (double)std::max((int)CENTER, LO) + (double)rel[i];
          int b = pools[i][0];
          for (int v : pools[i]) if (std::fabs((double)v - target) < std::fabs((double)b - target)) b = v;
          best.push_back(b);
        }
      }
      prev_ = best; std::sort(prev_.begin(), prev_.end());
      std::vector<int> out; for (int a : best) out.push_back(a - rootM);
      return out;
    }
    const std::vector<int> prevSorted = prev_;      // already sorted
    // The cartesian product of the pools, the first pool varying slowest (as flatMap builds it), and the first of equal scores wins.
    std::vector<size_t> idx(n, 0);
    double bestScore = INFINITY; std::vector<int> bestCombo; bool haveBest = false;
    for (;;) {
      std::vector<int> combo(n);
      for (size_t i = 0; i < n; i++) combo[i] = pools[i][idx[i]];
      std::vector<int> sorted = combo; std::sort(sorted.begin(), sorted.end());
      bool dup = false; for (size_t i = 1; i < n; i++) if (sorted[i] == sorted[i - 1]) dup = true;
      if (!dup && sorted[n - 1] - sorted[0] <= 24) {
        double move = 0;
        for (size_t i = 0; i < prevSorted.size(); i++) {
          const int s = i < sorted.size() ? sorted[i] : sorted.back();
          move += (double)std::abs(s - prevSorted[i]);
        }
        double sum = 0; for (int v : sorted) sum += v;
        const double mean = sum / (double)sorted.size();
        const double pull = PULL * std::fabs(mean - CENTER);
        const double score = move + pull;
        if (score < bestScore) { bestScore = score; bestCombo = combo; haveBest = true; }
      }
      // the next combination: the last pool turns fastest
      bool wrapped = true;
      for (size_t k = n; k-- > 0;) { if (++idx[k] < pools[k].size()) { wrapped = false; break; } idx[k] = 0; }
      if (wrapped) break;
    }
    if (!haveBest) return rel;
    prev_ = bestCombo; std::sort(prev_.begin(), prev_.end());
    std::vector<int> out; for (int a : bestCombo) out.push_back(a - rootM);
    return out;
  }

  // chordVoicing(rootM, relIntvs) with the voicing this strike is under: `voicing` is the slot's own or the setting.
  std::vector<int> chordVoicing(int rootM, const std::vector<int> &rel, int voicing, const VoicingConfig &c) {
    int style = voicing, vk = 0;
    if (c.vary) {
      const int step = vvStep(rootM, rel, c);
      style = (voicing + step) % kVoicingStyles;
      vk = step / kVoicingStyles;
    }
    std::vector<int> styled; bool haveStyled = false;
    if (style == kVoiceRnb || style == kVoiceNeo) haveStyled = styledVoicing(rootM, rel, style, vk, c, styled);
    else if (style == kVoiceDrop2 || style == kVoiceDrop3) haveStyled = jazzVoicing(rootM, rel, style == kVoiceDrop3 ? 3 : 2, vk, c, styled);
    if (haveStyled) return styled;
    return voiceIntervals(rel, style);
  }

  // voiceIntervals, without the guitar's shape: Close, and the Spread arrangement for everything else.
  static std::vector<int> voiceIntervals(const std::vector<int> &rel, int style) {
    if (style == kVoiceClose) return rel;
    if (rel.size() == 3) return {rel[0], rel[2], rel[1] + 12};
    if (rel.size() == 4) return {rel[0], rel[2], rel[1] + 12, rel[3] + 12};
    std::vector<int> out = rel;
    for (size_t i = 0; i < out.size(); i++) if (i > 0 && i % 2 == 1) out[i] += 12;
    return out;
  }

 private:
  static int pc(int x) { return ((x % 12) + 12) % 12; }

  // _vvStep: how many times this chord has been struck as a NEW chord, with the flag the jazz voicing reads.
  int vvStep(int rootM, const std::vector<int> &rel, const VoicingConfig &c) {
    vvNew_ = false;
    if (!c.vary) return 0;
    std::vector<int> p; for (int x : rel) p.push_back(pc(x));
    std::sort(p.begin(), p.end());
    std::string id = std::to_string(pc(rootM)) + ":";
    for (size_t i = 0; i < p.size(); i++) { if (i) id += ","; id += std::to_string(p[i]); }
    auto it = vvCount_.find(id);
    if (vvFresh_ || id != vvLastId_ || it == vvCount_.end()) {
      vvCount_[id] = (it == vvCount_.end()) ? 0 : it->second + 1;
      vvNew_ = true;
    }
    vvFresh_ = false; vvLastId_ = id;
    return vvCount_[id];
  }

  struct Facts { std::vector<int> rel; int third, fifth, sev; bool diatonic; std::vector<int> keyPcs; int rpc; };
  static bool has(const std::vector<int> &v, int x) { return std::find(v.begin(), v.end(), x) != v.end(); }
  // What styledVoicing and jazzVoicing both work out first: the chord's third and fifth, whether it is in the key, and its seventh.
  // The two differ only in the seventh a chord with no seventh of its own takes (styled: 10 on a plain major triad that is not diatonic).
  bool facts(int rootM, const std::vector<int> &relIntvs, const VoicingConfig &c, bool jazz, Facts &f) const {
    for (int s : relIntvs) { const int p = pc(s); if (!has(f.rel, p)) f.rel.push_back(p); }
    f.third = has(f.rel, 4) ? 4 : has(f.rel, 3) ? 3 : -1;
    if (f.third < 0) return false;                     // sus and power chords keep their shape
    f.fifth = has(f.rel, 7) ? 7 : has(f.rel, 6) ? 6 : has(f.rel, 8) ? 8 : 7;
    for (int s : c.modeSteps) f.keyPcs.push_back(pc(c.keyRoot + s));
    f.rpc = pc(rootM);
    auto inKey = [&](int semi) { return has(f.keyPcs, pc(f.rpc + semi)); };
    f.diatonic = has(f.keyPcs, f.rpc) && inKey(f.third) && inKey(f.fifth);
    f.sev = has(f.rel, 11) ? 11 : has(f.rel, 10) ? 10 : (has(f.rel, 9) && f.fifth == 6) ? 9 : -1;
    if (f.sev < 0) {
      if (f.diatonic) f.sev = inKey(11) ? 11 : inKey(10) ? 10 : (f.fifth == 6 && inKey(9)) ? 9 : -1;
      if (f.sev < 0) {
        if (jazz) f.sev = (f.third == 4 && f.fifth == 7) ? (f.diatonic ? 11 : 10) : (f.third == 3 && f.fifth == 7) ? 10 : f.fifth == 6 ? 10 : 11;
        else f.sev = (f.third == 4 && f.fifth == 7) ? (f.rel.size() == 3 && !f.diatonic ? 10 : 11) : (f.third == 3 && f.fifth == 7) ? 10 : f.fifth == 6 ? 10 : 11;
      }
    }
    return true;
  }

  bool styledVoicing(int rootM, const std::vector<int> &relIntvs, int style, int vk, const VoicingConfig &c, std::vector<int> &out) {
    Facts f;
    if (!facts(rootM, relIntvs, c, false, f)) return false;
    const int third = f.third, fifth = f.fifth, sev = f.sev;
    auto inKey = [&](int semi) { return has(f.keyPcs, pc(f.rpc + semi)); };
    auto ok = [&](int semi) { return !f.diatonic || inKey(semi); };
    const bool dom = third == 4 && sev == 10;
    // keyPick: the first of the offered tones the key has, else the first
    auto keyPick = [&](std::initializer_list<int> l) { for (int a : l) if (inKey(a)) return a; return *l.begin(); };
    const int NONE = INT_MIN;
    const int nine = dom ? keyPick({14, 13, 15}) : (ok(14) ? 14 : NONE);
    const int thirteen = dom ? keyPick({21, 20}) : (ok(21) ? 21 : NONE);
    std::vector<int> v;
    if (fifth == 6 || fifth == 8) {
      v = {0, sev, third + 12, fifth + 12};
      if (fifth == 6 && sev == 10 && nine != NONE && ok(14)) v.insert(v.begin() + 2, 14);
    } else if (style == kVoiceNeo) {
      if (dom)             v = {0, 10, nine, 17, thirteen};
      else if (third == 3) v = {0, sev, nine, 15, ok(17) ? 17 : 19};
      else                 v = {0, sev, nine, 16, ok(21) ? 21 : 19};
    } else {
      if (dom)             v = {0, 10, nine, 16, thirteen};
      else                 v = {0, sev, nine, third + 12, 19};
    }
    v.erase(std::remove(v.begin(), v.end(), NONE), v.end());
    const std::vector<int> v0 = v;
    const int turn = vk ? vk % 3 : 0;
    if (turn) {
      std::vector<int> up2(v.begin() + 1, v.end());
      if (turn == 1) up2[0] += 12; else up2.back() -= 12;
      std::sort(up2.begin(), up2.end());
      v.assign(1, 0); v.insert(v.end(), up2.begin(), up2.end());
    }
    std::vector<int> best = v; double bc = INFINITY;
    for (int sh : {-24, -12, 0, 12}) {
      const int top = rootM + sh + v0.back(), low = rootM + sh;
      if (low < 40 || top > 84 || rootM + sh + v.back() > 86) continue;
      double sum = 0; for (int x : v0) sum += x;
      const double mean = sum / (double)v0.size() + rootM + sh;
      double cc = std::fabs(mean - 63);
      if (hasPrevTop_ && c.autoInv) { const double term = std::fabs((double)(top - prevTop_)) * 0.6; cc = cc + term; }
      if (cc < bc) { bc = cc; best.clear(); for (int x : v) best.push_back(x + sh); }
    }
    prevTop_ = rootM + best.back(); hasPrevTop_ = true;
    out = best;
    return true;
  }

  bool jazzVoicing(int rootM, const std::vector<int> &relIntvs, int drop, int vk, const VoicingConfig &c, std::vector<int> &out) {
    Facts f;
    if (!facts(rootM, relIntvs, c, true, f)) return false;
    const int third = f.third, fifth = f.fifth, sev = f.sev, rpc = f.rpc;
    auto inKey = [&](int semi) { return has(f.keyPcs, pc(f.rpc + semi)); };
    std::vector<int> up;
    if (fifth == 6 && sev == 9)          up = {3, 6, 9, 0};
    else if (fifth == 6)                 up = {3, 6, 10, 5};
    else if (fifth == 8)                 up = {4, 8, sev, 2};
    else if (third == 4 && sev == 10) {
      if (!f.diatonic)                   up = {4, 10, 3, 8};
      else                               up = {4, inKey(9) ? 9 : 8, 10, inKey(2) ? 2 : 1};
    }
    else if (third == 4)                 up = (sev == 11) ? std::vector<int>{4, 7, 11, 2} : std::vector<int>{4, 7, 9, 2};
    else                                 up = {3, 7, sev, (!f.diatonic || inKey(2)) ? 2 : 5};
    struct Cand { std::vector<int> v; int inv; };
    std::vector<Cand> cands;
    for (int r = 0; r < 4; r++) {
      std::vector<int> order(up.begin() + r, up.end()); order.insert(order.end(), up.begin(), up.begin() + r);
      std::vector<int> close; int prev = -1;
      for (int p : order) { int v = pc(p); while (v <= prev) v += 12; close.push_back(v); prev = v; }
      std::vector<int> dropped = close;
      const int di = drop == 3 ? 1 : 2;
      dropped[(size_t)di] -= 12;
      std::sort(dropped.begin(), dropped.end());
      for (int oct = 3; oct <= 6; oct++) {
        const int base = rpc + oct * 12;
        std::vector<int> v; for (int x : dropped) v.push_back(base + x);
        const int top = v.back();
        if (top < 64 || top > 79 || v[0] < 45) continue;
        cands.push_back({v, r});
      }
    }
    if (cands.empty()) return false;
    auto cost = [&](const std::vector<int> &v) {
      double cc;
      if (c.autoInv && !jazzPrev_.empty()) {
        cc = 0;
        for (size_t i = 0; i < v.size(); i++) cc += (double)std::abs(v[i] - jazzPrev_[i]);
        const double term = (double)std::abs(v[3] - jazzPrev_[3]) * 0.5;
        cc = cc + term;
      } else cc = (double)std::abs(v[3] - 72);
      return cc;
    };
    // The nearest of each inversion, nearest first.
    struct Ranked { std::vector<int> v; double c; int inv; };
    std::vector<Ranked> byInv;
    for (int inv = 0; inv < 4; inv++) {
      bool any = false; Ranked b{};
      for (const Cand &cd : cands) { if (cd.inv != inv) continue; const double cc = cost(cd.v); if (!any || cc < b.c) { b = {cd.v, cc, inv}; any = true; } }
      if (any) byInv.push_back(b);
    }
    std::stable_sort(byInv.begin(), byInv.end(), [](const Ranked &a, const Ranked &b) { return a.c < b.c; });
    std::vector<int> best = byInv[0].v; int bestInv = byInv[0].inv;
    if (vk || (c.vary && !vvLastId_.empty())) {
      std::vector<int> &h = vvHist_[vvLastId_];
      const Ranked *pick = nullptr;
      if (vvNew_) { for (const Ranked &x : byInv) if (!has(h, x.inv)) { pick = &x; break; } }
      else { for (const Ranked &x : byInv) if (!h.empty() && x.inv == h[0]) { pick = &x; break; } }
      if (pick) { best = pick->v; bestInv = pick->inv; }
      if (vvNew_) { h.insert(h.begin(), bestInv); if (h.size() > 2) h.resize(2); }
    }
    jazzPrev_ = best;
    int bass = rpc + 36; while (bass + 12 <= best[0] - 5) bass += 12; while (bass > best[0] - 5) bass -= 12;
    out.clear(); out.push_back(bass);
    for (int m : best) out.push_back(m);
    for (int &m : out) m -= rootM;
    return true;
  }

  std::vector<int> prev_;                         // _prevVoices: the last chord's voices, sorted
  bool hasPrevTop_ = false; int prevTop_ = 0;      // _styledPrevTop
  std::vector<int> jazzPrev_;                     // _jazzPrev
  std::map<std::string, int> vvCount_;
  std::map<std::string, std::vector<int>> vvHist_;
  std::string vvLastId_;
  bool vvFresh_ = false, vvNew_ = false;
};

// chordEngineEvent: the notes a voiced chord becomes (rootM + each interval, in the voiced order, held to 0..127) and a slash chord's bass, which goes
// directly under the lowest chord tone: the nearest octave of it below, never on or above it. `slash` is INT_MIN for none. Returns the bass note, or -1.
struct VoicedChord { std::vector<int> notes; int bass = -1; int root = 60; };
inline VoicedChord engineChord(int rootM, const std::vector<int> &ivs, int slash) {
  auto clamp = [](int n) { return std::max(0, std::min(127, n)); };
  VoicedChord v;
  v.root = clamp(rootM);
  for (int i : ivs) v.notes.push_back(clamp(rootM + i));
  if (slash != INT_MIN && !ivs.empty()) {
    const int lo = *std::min_element(ivs.begin(), ivs.end());
    int b = (((slash - rootM) % 12) + 12) % 12;
    while (b >= lo) b -= 12;
    while (b < lo - 12) b += 12;
    v.bass = clamp(rootM + b);
  }
  return v;
}

}  // namespace modsynth
