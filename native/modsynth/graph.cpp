// See graph.h. The program layout is documented in tests/graph/graphrec.js and
// the parameter order per node type must match PARAMS there.
#include "graph.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>

namespace modsynth {
namespace {

constexpr double kPi = 3.14159265358979323846;
// "No start / no stop" in a program. Not -1: once times are relative to the
// note a start before the note's own origin is a small negative number.
constexpr double kUnset = -1e9;
constexpr int Q = Graph::kQuantum;
#ifndef MODSYNTH_BIQUAD_STEP
#define MODSYNTH_BIQUAD_STEP 8
#endif
constexpr int kBiquadStep = MODSYNTH_BIQUAD_STEP;

enum NodeType { T_GAIN = 1, T_OSC, T_BIQ, T_BUF, T_SHP, T_PAN, T_DEL, T_EXT };
enum EvKind { EV_SET = 0, EV_LIN, EV_EXP, EV_TGT };

struct Ev {
  int kind;
  double v, t, tc;
  double start;  // for a target: the timeline's value just before it
};

// An AudioParam: a starting value, a timeline of events, and the audio-rate
// signals connected to it, which are summed on top.
struct Param {
  double v0 = 0;
  std::vector<Ev> ev;
  std::vector<int> mods;  // node ids feeding it
  size_t cur = 0;         // timeline cursor: events [0, cur) are at or before now
  float buf[Q];

  // The timeline's value at time t (>= every earlier query: a cursor, not a
  // search). Follows the spec's algorithm for set, ramps and targets; a ramp
  // runs from the previous event to its own time.
  double at(double t) {
    while (cur < ev.size() && ev[cur].t <= t) cur++;
    return eval(t, cur);
  }

  // The same, for any t, without touching the cursor (an edit asks about a
  // time that may be behind it).
  double valueAt(double t) const {
    size_t k = 0;
    while (k < ev.size() && ev[k].t <= t) k++;
    return eval(t, k);
  }

  // `k` is the number of events at or before t.
  double eval(double t, size_t k) const {
    if (k == 0) {
      // Before the first event: the intrinsic value, unless the first event is
      // a ramp (the recorder anchors those, so it is not expected).
      return v0;
    }
    const Ev &e = ev[k - 1];
    const Ev *n = k < ev.size() ? &ev[k] : nullptr;
    if (n && (n->kind == EV_LIN || n->kind == EV_EXP)) {
      const double base = e.kind == EV_TGT ? e.start : e.v;
      const double span = n->t - e.t;
      if (span <= 0) return n->v;
      const double x = (t - e.t) / span;
      if (n->kind == EV_LIN) return base + (n->v - base) * x;
      if (base == 0 || (base < 0) != (n->v < 0) || n->v == 0) return base;
      return base * std::pow(n->v / base, x);
    }
    if (e.kind == EV_TGT) {
      if (e.tc <= 0) return e.v;
      return e.v + (e.start - e.v) * std::exp(-(t - e.t) / e.tc);
    }
    return e.v;
  }

  // An edit after load. Events go in after every event at or before their
  // time; `start` of a target is recomputed for the whole list, which is short.
  void insert(int kind, double v, double t, double tc) {
    size_t i = ev.size();
    while (i > 0 && ev[i - 1].t > t) i--;
    ev.insert(ev.begin() + i, Ev{kind, v, t, tc, 0});
    prepare();
    cur = 0;
  }
  void cancel(double t) {
    ev.erase(std::remove_if(ev.begin(), ev.end(), [t](const Ev &e) { return e.t >= t; }), ev.end());
    prepare();
    cur = 0;
  }
  // Drop everything after t and hold the value reached at t, if something was
  // in progress there. A ramp ending after t is cut short (the same kind of
  // ramp, ending at t on the value reached, so the stretch before t still
  // ramps); a target still decaying becomes a set at t; a param sitting at a
  // set value has nothing to hold. See graphrec.js.
  void hold(double t) {
    size_t k = 0;
    while (k < ev.size() && ev[k].t <= t) k++;
    const bool ramp = k < ev.size() && (ev[k].kind == EV_LIN || ev[k].kind == EV_EXP);
    const bool tgt = k > 0 && ev[k - 1].kind == EV_TGT;
    const int kind = ramp ? ev[k].kind : EV_SET;
    const double v = (ramp || tgt) ? eval(t, k) : 0.0;
    ev.erase(std::remove_if(ev.begin(), ev.end(), [t](const Ev &e) { return e.t > t; }), ev.end());
    if (ramp || tgt) insert(kind, v, t, 0);
    else { prepare(); cur = 0; }
  }

  // Fills in each event's `start` (a target's departure value). Run once at load.
  void prepare() {
    for (size_t i = 0; i < ev.size(); i++) {
      if (ev[i].kind != EV_TGT) { ev[i].start = ev[i].v; continue; }
      if (i == 0) { ev[i].start = v0; continue; }
      const Ev &p = ev[i - 1];
      double base = p.kind == EV_TGT ? p.v + (p.start - p.v) * (p.tc <= 0 ? 0 : std::exp(-(ev[i].t - p.t) / p.tc)) : p.v;
      ev[i].start = base;
    }
  }
};

// A periodic wave: band-limited tables, a few per octave, crossfaded, the way
// a browser builds a PeriodicWave. Cached by content, because the recorder
// sends the coefficients with every note that uses them.
struct Wave {
  static constexpr int N = 4096;
  static constexpr int kPerOct = 3;
  int nRanges = 0;
  double lowest = 0;  // fundamental of range 0
  std::vector<std::vector<float>> tab;  // [range][N + 1] (guard point)

  void build(const std::vector<double> &re, const std::vector<double> &im, double sr, bool normalize) {
    const double nyq = sr / 2;
    const int maxPartials = N / 2;
    lowest = nyq / maxPartials;
    nRanges = (int)std::ceil(kPerOct * std::log2(nyq / lowest)) + 1;
    int K = (int)std::max(re.size(), im.size());
    tab.assign(nRanges, std::vector<float>(N + 1, 0.0f));
    double scale = 1.0;
    for (int r = 0; r < nRanges; r++) {
      // partials that do not alias at the top of this range
      const double top = lowest * std::pow(2.0, (r + 1.0) / kPerOct);
      int kmax = std::min(K - 1, (int)std::floor(nyq / top));
      std::vector<double> t(N, 0.0);
      for (int k = 1; k <= kmax; k++) {
        const double a = k < (int)re.size() ? re[k] : 0, b = k < (int)im.size() ? im[k] : 0;
        if (a == 0 && b == 0) continue;
        for (int i = 0; i < N; i++) {
          const double ph = 2 * kPi * k * i / N;
          t[i] += a * std::cos(ph) + b * std::sin(ph);
        }
      }
      if (r == 0 && normalize) {
        // The wave's peak is between the table's points (a band-limited saw
        // overshoots in a lobe narrower than a sample of the table), and the
        // browser normalises by the real peak: finding it on the table's own
        // grid read 4% low and made every saw and square 4% too loud.
        constexpr int F = 8;
        double m = 0;
        for (int i = 0; i < N * F; i++) {
          double v = 0;
          for (int k = 1; k <= kmax; k++) {
            const double a = k < (int)re.size() ? re[k] : 0, b = k < (int)im.size() ? im[k] : 0;
            if (a == 0 && b == 0) continue;
            const double ph = 2 * kPi * k * ((double)i / (N * F));
            v += a * std::cos(ph) + b * std::sin(ph);
          }
          m = std::max(m, std::fabs(v));
        }
        scale = m > 0 ? 1.0 / m : 1.0;
      }
      for (int i = 0; i < N; i++) tab[r][i] = (float)(t[i] * scale);
      tab[r][N] = tab[r][0];
    }
  }

  // The table value at phase p in [0,1) for a fundamental of f Hz.
  inline float read(double p, double f) const {
    double pr = f <= lowest ? 0.0 : kPerOct * std::log2(f / lowest);
    if (pr > nRanges - 1) pr = nRanges - 1;
    const int r0 = (int)pr;
    const int r1 = std::min(r0 + 1, nRanges - 1);
    const double fr = pr - r0;
    const double x = p * N;
    const int i = (int)x;
    const double w = x - i;
    const float a0 = tab[r0][i], a1 = tab[r0][i + 1];
    float v = (float)(a0 + (a1 - a0) * w);
    if (r1 != r0 && fr > 0) {
      const float b0 = tab[r1][i], b1 = tab[r1][i + 1];
      const float u = (float)(b0 + (b1 - b0) * w);
      v = (float)(v + (u - v) * fr);
    }
    return v;
  }
};

const Wave &basicWave(int type, double sr) {
  static std::map<std::pair<int, int>, std::unique_ptr<Wave>> cache;
  auto key = std::make_pair(type, (int)sr);
  auto it = cache.find(key);
  if (it != cache.end()) return *it->second;
  std::vector<double> re(2048, 0.0), im(2048, 0.0);
  for (int k = 1; k < 2048; k++) {
    switch (type) {
      case 0: im[k] = k == 1 ? 1.0 : 0.0; break;
      case 1: im[k] = (k & 1) ? 4.0 / (kPi * k) : 0.0; break;
      case 2: im[k] = ((k & 1) ? 1.0 : -1.0) * 2.0 / (kPi * k); break;
      case 3: im[k] = (k & 1) ? 8.0 * ((((k - 1) / 2) & 1) ? -1.0 : 1.0) / ((kPi * k) * (kPi * k)) : 0.0; break;
    }
  }
  auto w = std::make_unique<Wave>();
  w->build(re, im, sr, true);
  const Wave &ref = *w;
  cache[key] = std::move(w);
  return ref;
}

const Wave &customWave(const std::vector<double> &re, const std::vector<double> &im, double sr) {
  static std::map<std::vector<double>, std::unique_ptr<Wave>> cache;
  std::vector<double> key;
  key.push_back(sr);
  key.insert(key.end(), re.begin(), re.end());
  key.insert(key.end(), im.begin(), im.end());
  auto it = cache.find(key);
  if (it != cache.end()) return *it->second;
  auto w = std::make_unique<Wave>();
  w->build(re, im, sr, true);
  const Wave &ref = *w;
  cache[key] = std::move(w);
  return ref;
}

struct Edge { int from, to, param; };

struct Node {
  int type = 0;
  int code = 0;
  int nch = 1;                     // channels of out[]
  float out[2][Q];
  std::vector<Edge> in;            // audio inputs (param < 0)
  std::vector<Param> p;            // by the recorder's param order
  // oscillator
  const Wave *wave = nullptr;
  double start = kUnset, stop = kUnset, phase = 0;
  bool hasStart() const { return start > kUnset / 2; }
  bool hasStop() const { return stop > kUnset / 2; }
  bool started = false;
  // biquad
  int ftype = 0;
  double bq[5] = {1, 0, 0, 0, 0};
  double st[2][4] = {};            // x1 x2 y1 y2 per channel
  // buffer source
  std::shared_ptr<const AudioData> buf;
  bool loop = false;
  double loopStart = 0, loopEnd = 0, offset = 0, pos = 0;
  // shaper
  std::vector<float> curve;
  // delay
  double maxDelay = 1;
  std::vector<float> dl[2];
  size_t dlw = 0;
};


inline double detuneRatio(double c) { return std::pow(2.0, c / 1200.0); }

}  // namespace

struct Graph::Impl {
  std::vector<Node> nodes;
  std::vector<int> order;
  std::vector<int> ext;  // node indices
};

void BufferStore::put(int id, double sr, int nch, int len, const float *ch0, const float *ch1) {
  auto a = std::make_shared<AudioData>();
  a->sr = sr; a->nch = nch < 2 ? 1 : 2; a->len = len;
  a->d[0].assign(ch0, ch0 + len);
  if (a->nch == 2) a->d[1].assign(ch1 ? ch1 : ch0, (ch1 ? ch1 : ch0) + len);
  std::lock_guard<std::mutex> lk(mu_);
  m_[id] = std::move(a);
}
void BufferStore::drop(int id) { std::lock_guard<std::mutex> lk(mu_); m_.erase(id); }
void BufferStore::clear() { std::lock_guard<std::mutex> lk(mu_); m_.clear(); }
std::shared_ptr<const AudioData> BufferStore::get(int id) const {
  std::lock_guard<std::mutex> lk(mu_);
  auto it = m_.find(id);
  return it == m_.end() ? nullptr : it->second;
}
int BufferStore::count() const { std::lock_guard<std::mutex> lk(mu_); return (int)m_.size(); }

Graph::Graph() : d_(new Impl) {}
Graph::~Graph() = default;

bool Graph::load(const double *p, size_t len, double timeBase, const BufferStore *store) {
  Impl &d = *d_;
  d.nodes.clear(); d.order.clear(); d.ext.clear();
  unknownBuf_ = -1;
  frame_ = 0;
  size_t i = 0;
  auto need = [&](size_t n) { return i + n <= len; };
  if (!need(4) || p[0] != 0x6d6f6467) { err_ = "bad magic"; return false; }
  sr_ = p[1];
  const int nNodes = (int)p[2];
  i = 4;
  d.nodes.resize(nNodes);
  auto readParam = [&](Param &pr) -> bool {
    if (!need(2)) return false;
    pr.v0 = p[i++];
    const int ne = (int)p[i++];
    if (!need((size_t)ne * 4)) return false;
    for (int e = 0; e < ne; e++) {
      Ev ev; ev.kind = (int)p[i++]; ev.v = p[i++]; ev.t = p[i++] - timeBase; ev.tc = p[i++]; ev.start = 0;
      pr.ev.push_back(ev);
    }
    pr.prepare();
    // Room for edits that arrive while it plays (a release is a handful of
    // events on one param), so applying them on the render thread never
    // allocates.
    pr.ev.reserve(pr.ev.size() + 16);
    return true;
  };
  auto readParams = [&](Node &n, int count) -> bool {
    n.p.resize(count);
    for (int k = 0; k < count; k++) if (!readParam(n.p[k])) return false;
    return true;
  };
  for (int k = 0; k < nNodes; k++) {
    Node &n = d.nodes[k];
    if (!need(1)) { err_ = "short node"; return false; }
    n.type = (int)p[i++];
    std::memset(n.out, 0, sizeof n.out);
    bool good = true;
    switch (n.type) {
      case T_EXT:
        if (!need(1)) { good = false; break; }
        n.code = (int)p[i++]; n.nch = 2; d.ext.push_back(k);
        break;
      case T_GAIN: good = readParams(n, 1); break;
      case T_OSC: {
        if (!need(1)) { good = false; break; }
        const int w = (int)p[i++];
        if (w == 4) {
          if (!need(1)) { good = false; break; }
          const int cnt = (int)p[i++];
          if (!need((size_t)cnt * 2)) { good = false; break; }
          std::vector<double> re(cnt), im(cnt);
          for (int a = 0; a < cnt; a++) re[a] = p[i++];
          for (int a = 0; a < cnt; a++) im[a] = p[i++];
          n.wave = &customWave(re, im, sr_);
        } else {
          n.wave = &basicWave(w, sr_);
        }
        if (!need(2)) { good = false; break; }
        n.start = p[i++]; n.stop = p[i++];
        if (n.hasStart()) n.start -= timeBase;
        if (n.hasStop()) n.stop -= timeBase;
        good = readParams(n, 2);
        break;
      }
      case T_BIQ:
        if (!need(1)) { good = false; break; }
        n.ftype = (int)p[i++];
        good = readParams(n, 4);
        break;
      case T_BUF:
        if (!need(7)) { good = false; break; }
        {
          const int id = (int)p[i++];
          if (id >= 0) {
            if (store) n.buf = store->get(id);
            if (!n.buf) { unknownBuf_ = id; err_ = "unknown buffer"; return false; }
          }
        }
        n.loop = p[i++] != 0; n.loopStart = p[i++]; n.loopEnd = p[i++];
        n.start = p[i++]; n.stop = p[i++]; n.offset = p[i++];
        if (n.hasStart()) n.start -= timeBase;
        if (n.hasStop()) n.stop -= timeBase;
        good = readParams(n, 2);
        break;
      case T_SHP: {
        if (!need(2)) { good = false; break; }
        i++;  // oversample: not applied yet, see render
        const int cnt = (int)p[i++];
        if (!need((size_t)cnt)) { good = false; break; }
        n.curve.resize(cnt);
        for (int a = 0; a < cnt; a++) n.curve[a] = (float)p[i++];
        break;
      }
      case T_PAN: good = readParams(n, 1); break;
      case T_DEL:
        if (!need(1)) { good = false; break; }
        n.maxDelay = p[i++];
        good = readParams(n, 1);
        if (good) {
          const size_t cap = (size_t)std::ceil(n.maxDelay * sr_) + Q + 2;
          n.dl[0].assign(cap, 0.f); n.dl[1].assign(cap, 0.f);
        }
        break;
      default: err_ = "unknown node type"; return false;
    }
    if (!good) { err_ = "short node body"; return false; }
  }
  if (!need(1)) { err_ = "no edges"; return false; }
  const int nEdges = (int)p[i++];
  if (!need((size_t)nEdges * 3)) { err_ = "short edges"; return false; }
  for (int e = 0; e < nEdges; e++) {
    Edge ed; ed.from = (int)p[i++]; ed.to = (int)p[i++]; ed.param = (int)p[i++];
    if (ed.from < 0 || ed.from >= nNodes || ed.to < 0 || ed.to >= nNodes) { err_ = "edge out of range"; return false; }
    Node &dst = d.nodes[ed.to];
    if (ed.param < 0) dst.in.push_back(ed);
    else {
      if (ed.param >= (int)dst.p.size()) { err_ = "edge to missing param"; return false; }
      dst.p[ed.param].mods.push_back(ed.from);
    }
  }
  // A topological order: every node after everything that feeds it, including
  // modulators of its params. A cycle (a feedback path) is refused, not guessed.
  std::vector<int> indeg(nNodes, 0);
  std::vector<std::vector<int>> outs(nNodes);
  for (int k = 0; k < nNodes; k++) {
    for (auto &e : d.nodes[k].in) { outs[e.from].push_back(k); indeg[k]++; }
    for (auto &pr : d.nodes[k].p) for (int m : pr.mods) { outs[m].push_back(k); indeg[k]++; }
  }
  std::vector<int> q;
  for (int k = 0; k < nNodes; k++) if (!indeg[k]) q.push_back(k);
  for (size_t h = 0; h < q.size(); h++) {
    d.order.push_back(q[h]);
    for (int o : outs[q[h]]) if (--indeg[o] == 0) q.push_back(o);
  }
  if ((int)d.order.size() != nNodes) { err_ = "cycle in graph"; return false; }
  quiet_ = 0;
  tail_ = 4 * Q;
  for (const Node &n : d.nodes)
    if (n.type == T_DEL) tail_ = std::max<uint64_t>(tail_, (uint64_t)std::ceil(n.maxDelay * sr_) + 4 * Q);
  err_ = "";
  return true;
}

bool Graph::apply(const double *p, size_t len, double timeBase) {
  Impl &d = *d_;
  if (len % 6) { err_ = "bad increment length"; return false; }
  for (size_t i = 0; i < len; i += 6) {
    const int id = (int)p[i], pi = (int)p[i + 1], op = (int)p[i + 2];
    const double v = p[i + 3], t = p[i + 4] - timeBase, tc = p[i + 5];
    if (id < 0 || id >= (int)d.nodes.size()) { err_ = "increment to unknown node"; return false; }
    Node &n = d.nodes[id];
    if (pi < 0) {
      if (op == 6) n.stop = t;
      else if (op == 7) n.start = t;
      else { err_ = "bad node op"; return false; }
      continue;
    }
    if (pi >= (int)n.p.size()) { err_ = "increment to missing param"; return false; }
    Param &pr = n.p[pi];
    switch (op) {
      case 0: pr.insert(EV_SET, v, t, 0); break;
      case 1: pr.insert(EV_LIN, v, t, 0); break;
      case 2: pr.insert(EV_EXP, v, t, 0); break;
      case 3: pr.insert(EV_TGT, v, t, tc); break;
      case 4: pr.cancel(t); break;
      case 5: pr.hold(t); break;
      default: err_ = "bad param op"; return false;
    }
  }
  err_ = "";
  return true;
}

int Graph::extCount() const { return (int)d_->ext.size(); }
int Graph::extId(int i) const { return d_->nodes[d_->ext[i]].code; }
const float *Graph::extBuf(int i, int ch) const { return d_->nodes[d_->ext[i]].out[ch ? 1 : 0]; }

namespace {

// RBJ cookbook coefficients, as the Web Audio spec writes them.
void biquadCoeffs(Node &n, double sr, double fc, double Qv, double gainDb) {
  const double nyq = sr / 2;
  double f = std::min(std::max(fc, 0.0), nyq) / nyq;  // normalised 0..1
  double b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  const double w0 = kPi * f, cw = std::cos(w0), sw = std::sin(w0);
  const double A = std::pow(10.0, gainDb / 40.0);
  switch (n.ftype) {
    case 0: {  // lowpass
      if (f >= 1) { b0 = 1; break; }
      if (f <= 0) { b0 = 0; break; }
      const double g = Qv; double gdb = std::pow(10.0, g / 20.0);
      const double alpha = sw / (2 * gdb);
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    }
    case 1: {  // highpass
      if (f >= 1) { b0 = 0; break; }
      if (f <= 0) { b0 = 1; break; }
      const double gdb = std::pow(10.0, Qv / 20.0);
      const double alpha = sw / (2 * gdb);
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    }
    case 2: {  // bandpass
      if (f <= 0 || f >= 1) { b0 = 0; break; }
      if (Qv <= 0) { b0 = 1; break; }
      const double alpha = sw / (2 * Qv);
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    }
    case 3: {  // lowshelf
      const double S = 1, alpha = sw / 2 * std::sqrt((A + 1 / A) * (1 / S - 1) + 2);
      const double k2 = 2 * std::sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + k2); b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - k2);
      a0 = (A + 1) + (A - 1) * cw + k2; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - k2;
      break;
    }
    case 4: {  // highshelf
      const double S = 1, alpha = sw / 2 * std::sqrt((A + 1 / A) * (1 / S - 1) + 2);
      const double k2 = 2 * std::sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + k2); b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - k2);
      a0 = (A + 1) - (A - 1) * cw + k2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - k2;
      break;
    }
    case 5: {  // peaking
      if (f <= 0 || f >= 1) { b0 = 1; break; }
      if (Qv <= 0) { b0 = A * A; break; }
      const double alpha = sw / (2 * Qv);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    }
    case 6: {  // notch
      if (f <= 0 || f >= 1) { b0 = 1; break; }
      if (Qv <= 0) { b0 = 0; break; }
      const double alpha = sw / (2 * Qv);
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    }
    case 7: {  // allpass
      if (f <= 0 || f >= 1) { b0 = 1; break; }
      if (Qv <= 0) { b0 = -1; break; }
      const double alpha = sw / (2 * Qv);
      b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    }
  }
  n.bq[0] = b0 / a0; n.bq[1] = b1 / a0; n.bq[2] = b2 / a0; n.bq[3] = a1 / a0; n.bq[4] = a2 / a0;
}

}  // namespace

void Graph::render(int frames) {
  Impl &d = *d_;
  frames = std::min(frames, Q);
  const double t0 = (double)frame_ / sr_;
  const double dt = 1.0 / sr_;
  float sum[2][Q];

  for (int idx : d.order) {
    Node &n = d.nodes[idx];
    // Params first: timeline, plus whatever is modulating them.
    for (Param &pr : n.p) {
      for (int s = 0; s < frames; s++) pr.buf[s] = (float)pr.at(t0 + s * dt);
      for (int m : pr.mods) {
        const Node &src = d.nodes[m];
        for (int s = 0; s < frames; s++) pr.buf[s] += src.out[0][s] + (src.nch > 1 ? 0.f : 0.f);
      }
    }
    // Summed audio input, up-mixed to stereo when any source is.
    int inCh = 0;
    for (auto &e : n.in) inCh = std::max(inCh, d.nodes[e.from].nch);
    if (inCh) {
      for (int c = 0; c < inCh; c++) std::memset(sum[c], 0, sizeof(float) * frames);
      for (auto &e : n.in) {
        const Node &src = d.nodes[e.from];
        for (int c = 0; c < inCh; c++) {
          const float *sp = src.out[src.nch > 1 ? c : 0];
          for (int s = 0; s < frames; s++) sum[c][s] += sp[s];
        }
      }
    }

    switch (n.type) {
      case T_EXT:
        n.nch = 2;
        for (int c = 0; c < 2; c++) {
          if (inCh) std::memcpy(n.out[c], sum[inCh > 1 ? c : 0], sizeof(float) * frames);
          else std::memset(n.out[c], 0, sizeof(float) * frames);
        }
        break;
      case T_GAIN: {
        n.nch = inCh ? inCh : 1;
        const float *g = n.p[0].buf;
        for (int c = 0; c < n.nch; c++)
          for (int s = 0; s < frames; s++) n.out[c][s] = inCh ? sum[c][s] * g[s] : 0.f;
        break;
      }
      case T_OSC: {
        n.nch = 1;
        const float *fq = n.p[0].buf, *dc = n.p[1].buf;
        // A browser starts a source at the first whole frame at or after its
        // start time, with no allowance for rounding: 1.1 s is 52800.00000000001
        // frames, so it begins a frame later than 0.1 s does. Matching that
        // exactly (a one-sample shift of a saw is a 10% error) is why there is no
        // epsilon here.
        const double startF = n.start * sr_, stopF = n.stop * sr_;
        const double firstF = std::ceil(startF);
        // A browser reads a moving frequency (events on it, or a signal into it)
        // sample by sample, and in that mode it does not apply the sub-sample
        // start: the first frame begins at phase 0 (measured: 440 Hz's first
        // step is sin(2 pi 440 / 48000) wherever in the frame the start falls).
        // A still frequency is read once and the start is applied.
        const bool aRate = !n.p[0].ev.empty() || !n.p[0].mods.empty() || !n.p[1].ev.empty() || !n.p[1].mods.empty();
        int qoff = 0;  // where in this block the oscillator began, for its first block only
        for (int s = 0; s < frames; s++) {
          const double fr = (double)(frame_ + s);
          const double delta = firstF - startF;  // how far into a frame it already is when it begins
          const bool on = n.hasStart() && fr >= firstF && (!n.hasStop() || fr < stopF);
          if (!on) { n.out[0][s] = 0; continue; }
          if (!n.started) qoff = s;
          // A browser oscillator that begins part-way through a render quantum
          // reads that quantum's frequency and detune samples from the start of
          // the quantum, not from where it began: the first frame it makes
          // gets the value meant for frame 0. It is a quirk (a 0.1 rad phase
          // offset on an FM voice, measured), but it is what the page sounds
          // like, so it is what the page's recording is held to. It lasts the
          // one block.
          const double f = fq[s - qoff] * detuneRatio(dc[s - qoff]);
          // ...and starts between frames: the first frame is already `delta`
          // of a frame into the cycle.
          if (!n.started) { n.started = true; n.phase = aRate ? 0.0 : delta * f / sr_; n.phase -= std::floor(n.phase); }
          n.out[0][s] = n.wave->read(n.phase, std::fabs(f));
          n.phase += f / sr_;
          n.phase -= std::floor(n.phase);
        }
        break;
      }
      case T_BIQ: {
        n.nch = inCh ? inCh : 1;
        // A browser recomputes a biquad's coefficients for every frame while
        // any of its params is moving. `kBiquadStep` is how often we do: 1 is
        // the browser's own, and costs a cos, a sin and a pow a sample. Measured
        // on a lowpass sweep (tests/graph/edits.test.js): 1 gives 72.4 dB against
        // the browser, 4 gives 71.9, 8 about 70, 16 gives 65.1. 8 is the default:
        // the loss is far below anything heard and it is an eighth of the cost.
        // A param holding still costs one computation a block.
        const bool moving = !n.p[0].ev.empty() || !n.p[0].mods.empty() || !n.p[1].ev.empty() || !n.p[2].ev.empty() || !n.p[3].ev.empty();
        const int step = moving ? kBiquadStep : frames;
        for (int s0 = 0; s0 < frames; s0 += step) {
          const int e = std::min(frames, s0 + step);
          biquadCoeffs(n, sr_, n.p[0].buf[s0] * detuneRatio(n.p[1].buf[s0]), n.p[2].buf[s0], n.p[3].buf[s0]);
          const double *c = n.bq;
          for (int ch = 0; ch < n.nch; ch++) {
            double *z = n.st[ch];
            for (int s = s0; s < e; s++) {
              const double x = inCh ? sum[ch][s] : 0.0;
              const double y = c[0] * x + c[1] * z[0] + c[2] * z[1] - c[3] * z[2] - c[4] * z[3];
              z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y;
              n.out[ch][s] = (float)y;
            }
          }
        }
        break;
      }
      case T_BUF: {
        n.nch = 1;
        const AudioData *B = n.buf.get();
        // A buffer recorded at another rate plays at its own pace, resampled.
        const double rateMul = B ? B->sr / sr_ : 1.0;
        if (B && B->nch > 1) n.nch = 2;
        const float *rate = n.p[0].buf, *dc = n.p[1].buf;
        const double startF = n.start * sr_, stopF = n.stop * sr_;
        const double firstF = std::ceil(startF);
        for (int s = 0; s < frames; s++) {
          for (int c = 0; c < n.nch; c++) n.out[c][s] = 0;
          const double fr = (double)(frame_ + s);
          const double delta = firstF - startF;
          if (!B || !n.hasStart() || fr < firstF || (n.hasStop() && fr >= stopF)) continue;
          // The buffer is read from where it would be `delta` of a frame after
          // its start, as a browser does for a start between frames.
          if (!n.started) { n.started = true; n.pos = n.offset * B->sr + delta * rate[s] * rateMul * detuneRatio(dc[s]); }
          double lo = 0, hi = B->len;
          if (n.loop && n.loopEnd > n.loopStart) { lo = n.loopStart * B->sr; hi = std::min<double>(n.loopEnd * B->sr, B->len); }
          if (n.pos >= hi) { if (n.loop) n.pos = lo + std::fmod(n.pos - lo, std::max(1.0, hi - lo)); else continue; }
          const int i0 = (int)n.pos; const double fr2 = n.pos - i0;
          int i1 = i0 + 1;
          if (i1 >= B->len) i1 = n.loop ? (int)lo : B->len - 1;
          for (int c = 0; c < n.nch; c++) {
            const std::vector<float> &dv = B->d[B->nch > 1 ? c : 0];
            n.out[c][s] = (float)(dv[i0] + (dv[i1] - dv[i0]) * fr2);
          }
          n.pos += rate[s] * rateMul * detuneRatio(dc[s]);
        }
        break;
      }
      case T_SHP: {
        n.nch = inCh ? inCh : 1;
        const int L = (int)n.curve.size();
        for (int c = 0; c < n.nch; c++)
          for (int s = 0; s < frames; s++) {
            const float x = inCh ? sum[c][s] : 0.f;
            if (L < 2) { n.out[c][s] = x; continue; }
            const double v = (L - 1) * 0.5 * (x + 1.0);
            if (v <= 0) n.out[c][s] = n.curve[0];
            else if (v >= L - 1) n.out[c][s] = n.curve[L - 1];
            else { const int k = (int)v; const double w = v - k; n.out[c][s] = (float)(n.curve[k] + (n.curve[k + 1] - n.curve[k]) * w); }
          }
        break;
      }
      case T_PAN: {
        n.nch = 2;
        const float *pn = n.p[0].buf;
        for (int s = 0; s < frames; s++) {
          const double pv = std::max(-1.0, std::min(1.0, (double)pn[s]));
          if (inCh < 2) {
            const double x = (pv + 1) * 0.5, m = inCh ? sum[0][s] : 0.f;
            n.out[0][s] = (float)(m * std::cos(x * kPi / 2));
            n.out[1][s] = (float)(m * std::sin(x * kPi / 2));
          } else {
            const double l = sum[0][s], r = sum[1][s];
            if (pv <= 0) {
              const double x = pv + 1;
              n.out[0][s] = (float)(l + r * std::cos(x * kPi / 2));
              n.out[1][s] = (float)(r * std::sin(x * kPi / 2));
            } else {
              const double x = pv;
              n.out[0][s] = (float)(l * std::cos(x * kPi / 2));
              n.out[1][s] = (float)(r + l * std::sin(x * kPi / 2));
            }
          }
        }
        break;
      }
      case T_DEL: {
        n.nch = inCh ? inCh : 1;
        const size_t cap = n.dl[0].size();
        const float *dtm = n.p[0].buf;
        for (int c = 0; c < n.nch; c++) {
          size_t w = n.dlw;
          for (int s = 0; s < frames; s++) {
            n.dl[c][w] = inCh ? sum[c][s] : 0.f;
            const double dd = std::min(std::max((double)dtm[s], 0.0), n.maxDelay) * sr_;
            double rp = (double)w - dd; if (rp < 0) rp += cap;
            const size_t r0 = (size_t)rp % cap, r1 = (r0 + 1) % cap;
            const double fr = rp - std::floor(rp);
            n.out[c][s] = (float)(n.dl[c][r0] + (n.dl[c][r1] - n.dl[c][r0]) * fr);
            w = (w + 1) % cap;
          }
        }
        n.dlw = (n.dlw + frames) % cap;
        break;
      }
    }
  }
  double pk = 0;
  for (int e : d.ext) {
    const Node &n = d.nodes[e];
    for (int c = 0; c < 2; c++)
      for (int s2 = 0; s2 < frames; s2++) pk = std::max(pk, (double)std::fabs(n.out[c][s2]));
  }
  if (pk < 1e-6) quiet_ += frames; else quiet_ = 0;
  frame_ += frames;
}

bool Graph::finished() const {
  const Impl &d = *d_;
  for (const Node &n : d.nodes) {
    if (n.type != T_OSC && n.type != T_BUF) continue;
    if (!n.hasStart()) continue;                     // never started: nothing to wait for
    const bool stopped = n.hasStop() && (double)frame_ >= n.stop * sr_;
    const bool ranOut = n.type == T_BUF && !n.loop && n.started && (!n.buf || n.pos >= n.buf->len);
    if (!stopped && !ranOut) return false;
  }
  return quiet_ >= tail_;
}

}  // namespace modsynth
