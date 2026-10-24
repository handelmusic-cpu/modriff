// See master.h. Read buildMasterBus and _webMasterApply in index.html beside
// this: the stages below are that graph's, in its order.
#include "master.h"
#include "dspkit.h"

#include <atomic>
#include <cmath>
#include <cstring>
#include <vector>

namespace modsynth {

using namespace dsp;

// ── Dynamics ────────────────────────────────────────────────────────────────
// WebKit's DynamicsCompressorKernel, which Blink inherited, written out from
// what it does:
//
//  - A static curve: linear up to the threshold, then an exponential knee, then
//    a straight line in dB at slope 1/ratio. The knee's steepness `k` is found
//    by bisection so the curve meets that line with the same slope.
//  - Make-up gain from the curve itself: the reduction it applies at 0 dBFS,
//    raised to 0.6 ("empirical/perceptual tuning" in the original). It is why a
//    compressor set to a low threshold is also louder, and the level matching
//    below depends on it.
//  - A detector: the loudest channel's sample through the curve gives an
//    attenuation, which an average follows (instantly down, 2.5 ms back up).
//  - Every 32 frames the average sets a target gain. Attacking, the envelope
//    approaches it at a rate set by the deepest reduction seen since the attack
//    began; releasing, it climbs at a rate from a four-point polynomial of how
//    much reduction is on (deeper releases faster). Both in a gain domain that
//    is pre-warped by asin and warped back by sin, which rounds the corners.
//  - The audio is delayed by 6 ms so the gain is ready before the peak that
//    asked for it arrives.
namespace {
constexpr double kPreDelay = 0.006, kSatRelease = 0.0025;
constexpr int kDivision = 32;
constexpr int kMaxPreDelay = 2048;               // frames; power of two, > 6 ms at 192 kHz
constexpr double kZones[4] = {0.09, 0.16, 0.42, 0.98};
inline double lin2db(double x) { return 20.0 * std::log10(x); }
}  // namespace

struct Dynamics::Impl {
  double sr;
  // Settings
  double thDb = 0, kneeDb = 30, ratio = 12, attack = 0.003, release = 0.25;
  bool dirty = true;
  // The static curve (derived)
  double linTh = 1, kneeTh = 1, ykneeThDb = 0, slope = 1, K = 5, makeup = 1;
  // Release polynomial and the rates (derived from release time)
  double ra = 0, rb = 0, rc = 0, rd = 0, re = 0, attackFrames = 1, satReleaseFrames = 1;
  // State
  float pre[2][kMaxPreDelay] = {};
  int preW = 0, preR = 0;
  double detector = 1, gain = 1, maxAttackDiff = -1, envRate = 1, desired = 1;
  int divPos = 0;
  double lastGainDb = 0;

  explicit Impl(double sampleRate) : sr(sampleRate) {
    const int d = (int)std::lround(kPreDelay * sr);
    preR = (kMaxPreDelay - d) & (kMaxPreDelay - 1);
  }

  double kneeCurve(double x, double k) const {
    if (x < linTh) return x;
    return linTh + (1 - std::exp(-k * (x - linTh))) / k;
  }
  double slopeAt(double x, double k) const {
    if (x < linTh) return 1;
    const double x2 = x * 1.001;
    const double xDb = lin2db(x), x2Db = lin2db(x2);
    const double yDb = lin2db(kneeCurve(x, k)), y2Db = lin2db(kneeCurve(x2, k));
    return (y2Db - yDb) / (x2Db - xDb);
  }
  double kAtSlope(double desired) const {
    const double x = dbToLin(thDb + kneeDb);
    double minK = 0.1, maxK = 10000, k = 5;
    for (int i = 0; i < 15; i++) {
      // A high k asymptotically approaches a slope of 0.
      if (slopeAt(x, k) < desired) maxK = k; else minK = k;
      k = std::sqrt(minK * maxK);
    }
    return k;
  }
  double saturate(double x) const {
    if (x < kneeTh) return kneeCurve(x, K);
    const double xDb = lin2db(x);
    return dbToLin(ykneeThDb + slope * (xDb - (thDb + kneeDb)));
  }

  void derive() {
    linTh = dbToLin(thDb);
    slope = 1.0 / ratio;
    K = kAtSlope(slope);
    kneeTh = dbToLin(thDb + kneeDb);
    ykneeThDb = lin2db(kneeCurve(kneeTh, K));
    makeup = std::pow(1.0 / saturate(1.0), 0.6);

    attackFrames = std::max(0.001, attack) * sr;
    const double rf = sr * release;
    satReleaseFrames = kSatRelease * sr;
    const double y1 = rf * kZones[0], y2 = rf * kZones[1], y3 = rf * kZones[2], y4 = rf * kZones[3];
    // A smooth function through four points, y = a + bx + cx² + dx³ + ex⁴, for
    // x = 0..3 standing for 15, 10, 5 and 0 dB of reduction: the coefficients
    // interpolate (y1..y4) there.
    ra = 0.9999999999999998 * y1 + 1.8432219684323923e-16 * y2 - 1.9373394351676423e-16 * y3 + 8.8245126786838e-17 * y4;
    rb = -1.5788320352845888 * y1 + 2.3305837032074286 * y2 - 0.9141194204840429 * y3 + 0.1623677525612032 * y4;
    rc = 0.5334142869106424 * y1 - 1.272736789213631 * y2 + 0.9258856042207512 * y3 - 0.18656310191776226 * y4;
    rd = 0.08783463138207234 * y1 - 0.1694162967925622 * y2 + 0.08588057951595272 * y3 - 0.00429891410546283 * y4;
    re = -0.042416883008123074 * y1 + 0.1115693827987602 * y2 - 0.09764676325265872 * y3 + 0.028494263462021576 * y4;
    dirty = false;
  }

  // Once per 32 frames: pick the envelope's rate from where the average is.
  void division() {
    if (!std::isfinite(detector)) detector = 1;
    desired = std::asin(std::min(1.0, detector)) / (0.5 * PI);
    const bool releasing = desired > gain;
    double diffDb = lin2db(gain / desired);
    if (releasing) {
      maxAttackDiff = -1;
      if (!std::isfinite(diffDb)) diffDb = -1;
      double x = std::min(0.0, std::max(-12.0, diffDb));
      x = 0.25 * (x + 12);
      const double x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
      const double rel = ra + rb * x + rc * x2 + rd * x3 + re * x4;
      envRate = dbToLin(5.0 / rel);                 // dB of climb per frame, 5 dB spacing
    } else {
      if (!std::isfinite(diffDb)) diffDb = 1;
      if (maxAttackDiff == -1 || maxAttackDiff < diffDb) maxAttackDiff = diffDb;
      const double eff = std::max(0.5, maxAttackDiff);
      envRate = 1 - std::pow(0.25 / eff, 1.0 / attackFrames);
    }
  }

  void process(float* L, float* R, int n) {
    if (dirty) derive();
    double gSum = 0;
    for (int i = 0; i < n; i++) {
      if (divPos == 0) division();
      divPos = (divPos + 1) % kDivision;

      const float inL = L[i], inR = R[i];
      pre[0][preW] = inL; pre[1][preW] = inR;
      const double a = std::max(std::fabs((double)inL), std::fabs((double)inR));
      const double shaped = saturate(a);
      const double att = a <= 0.0001 ? 1.0 : shaped / a;
      const double attDb = std::max(2.0, -lin2db(att));
      const double satRate = dbToLin(attDb / satReleaseFrames) - 1;
      const bool rel = att > detector;
      detector += (att - detector) * (rel ? satRate : 1.0);
      if (detector > 1) detector = 1;

      if (envRate < 1) gain += (desired - gain) * envRate;
      else { gain *= envRate; if (gain > 1) gain = 1; }
      const double total = makeup * std::sin(0.5 * PI * gain);
      gSum += total;
      L[i] = (float)(pre[0][preR] * total);
      R[i] = (float)(pre[1][preR] * total);
      preW = (preW + 1) & (kMaxPreDelay - 1);
      preR = (preR + 1) & (kMaxPreDelay - 1);
    }
    lastGainDb = n > 0 ? lin2db(std::max(1e-9, gSum / n)) : lastGainDb;
  }
};

Dynamics::Dynamics(double sampleRate) : d(new Impl(sampleRate)) {}
Dynamics::~Dynamics() = default;
void Dynamics::set(double th, double knee, double ratio, double attack, double release) {
  Impl& s = *d;
  if (th == s.thDb && knee == s.kneeDb && ratio == s.ratio && attack == s.attack && release == s.release) return;
  s.thDb = th; s.kneeDb = knee; s.ratio = ratio < 1 ? 1 : ratio; s.attack = attack; s.release = release;
  s.dirty = true;
}
void Dynamics::process(float* L, float* R, int n) { d->process(L, R, n); }
double Dynamics::reductionDb() const { return d->lastGainDb; }

// ── The master bus ──────────────────────────────────────────────────────────
namespace {
// buildMasterBus's constants: the glue is slow and wide, the limiter fast and
// narrow. The thresholds and ratios arrive from the page; these do not move.
constexpr double kGlueKnee = 22, kGlueAttack = 0.012, kGlueRelease = 0.22;
constexpr double kLimKnee = 1, kLimAttack = 0.001, kLimRelease = 0.1;
// DRIVE_SPAN: how far over full scale the drive accepts before it must clip.
constexpr double kSpan = 4;
constexpr int kDriveN = 8192;                       // the web builds 8192 points when span > 1

struct DriveCurve {
  std::vector<float> t;
  DriveCurve() : t((size_t)kDriveN, 0.f) {}
  // The page's _driveCurve: a classic soft saturator, squared so the low end of
  // the knob stays gentle. Index (n-1), not n: see the comment there.
  void build(double amount) {
    const double k = amount * amount * 45;
    for (int i = 0; i < kDriveN; i++) {
      const double x = ((i * 2.0) / (kDriveN - 1) - 1) * kSpan;
      t[(size_t)i] = (float)((k < 0.01 ? x : (1 + k) * x / (1 + k * std::fabs(x))) / kSpan);
    }
  }
  inline float apply(float x) const {
    const float p = (x + 1.0f) * 0.5f * (kDriveN - 1);
    if (p <= 0) return t[0];
    if (p >= kDriveN - 1) return t[kDriveN - 1];
    const int i = (int)p; const float fr = p - (float)i;
    return t[(size_t)i] + (t[(size_t)i + 1] - t[(size_t)i]) * fr;
  }
};
}  // namespace

struct MasterBus::Impl {
  double sr;
  double p[MB_COUNT];
  Dynamics glue, lim;
  Fdn room;
  DriveCurve curve; double curveAmt = -1;
  Os2 os[2][2];                                      // [group][channel]
  Smooth vol, send, webTrim;
  std::atomic<float> rms{0.0f};

  explicit Impl(double sampleRate)
      : sr(sampleRate), glue(sampleRate), lim(sampleRate), room(sampleRate, MASTER_ROOM_SECONDS, MASTER_ROOM_SCALE, MASTER_ROOM_RT60) {
    // The state buildMasterBus + _webMasterApply leave a fresh page in:
    // master on, volume .72, glue .35 (threshold -13 dB, ratio 3.25), room 5%.
    const double def[MB_COUNT] = {0.72, -13, 3.25, -3, 20, 0.05, 0, kSpan, 0};
    for (int i = 0; i < MB_COUNT; i++) p[i] = def[i];
    vol.init(sr, 0.008); vol.snap(p[MB_VOL]);
    send.init(sr, 0.008); send.snap(p[MB_REV_SEND]);
    webTrim.init(sr, 0.12); webTrim.snap(1.0);
    curve.build(0);
    curveAmt = 0;
  }

  void process(float* L, float* R, const float* rL, const float* rR, int n) {
    if (p[MB_DRV_AMT] != curveAmt) { curve.build(p[MB_DRV_AMT]); curveAmt = p[MB_DRV_AMT]; }
    glue.set(p[MB_CMP_TH], kGlueKnee, p[MB_CMP_RATIO], kGlueAttack, kGlueRelease);
    lim.set(p[MB_LIM_TH], kLimKnee, p[MB_LIM_RATIO], kLimAttack, kLimRelease);
    vol.t = p[MB_VOL]; send.t = p[MB_REV_SEND];
    webTrim.t = dbToLin(p[MB_WEB_TRIM] > 0 ? 0 : p[MB_WEB_TRIM]);

    const double out = p[MB_DRV_OUT];
    const bool shape = curveAmt > 0;
    // 2x oversampling exists to stop saturation aliasing, and it doubles the
    // work on the whole mix; the web pays for it only when the knob is doing
    // something audible (_webApplyDrive), and so does this.
    const bool over = curveAmt > 0.05;
    const float inv = (float)(1.0 / kSpan);
    const double trim = dbToLin(MASTER_ROOM_TRIM_DB);
    float junk;
    for (int i = 0; i < n; i++) {
      float x[2][2] = {{L[i], R[i]}, {rL[i], rR[i]}};
      for (int g = 0; g < 2; g++)
        for (int c = 0; c < 2; c++) {
          const float u = x[g][c] * inv;
          x[g][c] = (float)((shape ? (over ? os[g][c].run(curve, u, &junk) : curve.apply(u)) : u) * out);
        }
      const double s = send.next();
      double wl, wr;
      room.tick(x[1][0] * s, x[1][1] * s, wl, wr);
      wl *= trim; wr *= trim;
      L[i] = (float)(x[0][0] + x[1][0] + wl);
      R[i] = (float)(x[0][1] + x[1][1] + wr);
    }
    glue.process(L, R, n);
    lim.process(L, R, n);
    double sq = 0;
    for (int i = 0; i < n; i++) {
      const double v = vol.next() * webTrim.next();
      L[i] = (float)(L[i] * v); R[i] = (float)(R[i] * v);
      sq += (double)L[i] * L[i] + (double)R[i] * R[i];
    }
    if (n > 0) {
      const float r = (float)std::sqrt(sq / (2.0 * n));
      float was = rms.load(std::memory_order_relaxed);
      while (r > was && !rms.compare_exchange_weak(was, r, std::memory_order_relaxed)) {}
    }
  }
};

MasterBus::MasterBus(double sampleRate) : d(new Impl(sampleRate)) {}
MasterBus::~MasterBus() = default;
void MasterBus::set(int i, double v) {
  if (i < 0 || i >= MB_COUNT || !std::isfinite(v)) return;
  d->p[i] = v;
}
double MasterBus::get(int i) const { return (i < 0 || i >= MB_COUNT) ? 0 : d->p[i]; }
void MasterBus::process(float* L, float* R, const float* rL, const float* rR, int n) { d->process(L, R, rL, rR, n); }
float MasterBus::takeRms() { return d->rms.exchange(0.0f, std::memory_order_relaxed); }

}  // namespace modsynth
