// See fxrack.h. Read modsynth/fx.js beside this: each stage below is that
// file's stage, in the same order, with the same parameter arithmetic.
#include "fxrack.h"
#include "dspkit.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace modsynth {
namespace {

using namespace dsp;

constexpr int CHUNK = 32;      // control rate: parameters are re-derived this often




// type: 0 soft 1 tape 2 tube 3 diode 4 fold 5 hard (DRIVE_TYPES' order)
void makeCurve(Curve& c, int type, double amount) {
  const double k = 0.05 + amount * amount * 40;
  for (int i = 0; i < CURVE_N; i++) {
    const double x = (double)i / (CURVE_N - 1) * 2 - 1;
    double y;
    switch (type) {
      case 0: y = std::tanh(x * (1 + k * 0.4)); break;
      case 1: y = std::tanh(x * (1 + k * 0.25)) * 0.92 + x * 0.08; break;
      case 2: { const double g = 1 + k * 0.5;
                y = x >= 0 ? std::tanh(x * g) : std::tanh(x * g * 0.7) * 0.85; break; }
      case 3: { const double g = 1 + k;
                y = x >= 0 ? 1 - std::exp(-x * g) : -(1 - std::exp(x * g * 0.55)) * 0.8; break; }
      case 4: { double v = x * (1 + k * 0.35);
                for (int j = 0; j < 6; j++) { if (v > 1) v = 2 - v; else if (v < -1) v = -2 - v; else break; }
                y = v; break; }
      default: y = clampd(x * (1 + k), -1, 1); break;
    }
    c.t[i] = (float)y;
  }
}

// ── Compressor ──────────────────────────────────────────────────────────────
// Web Audio's DynamicsCompressor: a soft-knee feed-forward curve with an
// automatic make-up gain. The make-up is the part that matters for matching
// levels — it raises the output by 0.6 of the reduction applied at 0 dBFS —
// and fx.js's OTT trims were fitted with it in place.
struct Comp {
  double thresh = -24, knee = 30, ratio = 12, attack = 0.003, release = 0.25;
  double makeup = 1, gr = 0;     // gr: current gain reduction, dB (<= 0)
  double ka = 0, kr = 0;
  void prep(double sr) {
    ka = std::exp(-1.0 / (std::max(attack, 1e-4) * sr));
    kr = std::exp(-1.0 / (std::max(release, 1e-3) * sr));
    makeup = dbToLin(-0.6 * curveGain(0.0));
  }
  // dB of gain applied to an input of x dB.
  double curveGain(double x) const {
    const double lo = thresh - knee / 2, hi = thresh + knee / 2;
    if (x <= lo) return 0;
    double y;
    if (x >= hi || knee <= 0) y = thresh + (x - thresh) / ratio;
    else { const double d = x - lo; y = x + (1 / ratio - 1) * d * d / (2 * knee); }
    return y - x;
  }
  inline void run(float& l, float& r) {
    const double a = std::max(std::fabs((double)l), std::fabs((double)r));
    const double xdb = a > 1e-9 ? 20 * std::log10(a) : -180;
    const double target = curveGain(xdb);
    gr = target < gr ? target + (gr - target) * ka : target + (gr - target) * kr;
    const float g = (float)(dbToLin(gr) * makeup);
    l *= g; r *= g;
  }
};

}  // namespace

struct FxRack::Impl {
  double sr;
  double p[HOST_FX_COUNT];
  double m[5] = {0, 0, 0, 0, 0};          // drive amt, delay mix, reverb mix, chorus mix, phaser rate
  double bpm = 120;
  // Indices into p, found once by name.
  int I(const char* id) const {
    for (int i = 0; i < HOST_FX_COUNT; i++) if (std::strcmp(HOST_FX[i].id, id) == 0) return i;
    return 0;
  }
  struct Ix {
    int driveOn, driveType, driveAmt, driveTone, driveMix;
    int chOn, chRate, chDepth, chSpread, chVoices, chMix;
    int phOn, phRate, phDepth, phFb, phStages, phMix;
    int dlOn, dlSync, dlDiv, dlTime, dlFb, dlPong, dlTone, dlMix;
    int rvOn, rvSize, rvDecay, rvDamp, rvPre, rvWidth, rvMix;
    int cpOn, cpThresh, cpRatio, cpAttack, cpRelease, cpMakeup;
    int grOn, grAmount, grTone, grMix;
    int otOn, otDepth, otTime, otUp;
    int width, mvol;
  } x;

  explicit Impl(double sampleRate) : sr(sampleRate) {
    for (int i = 0; i < HOST_FX_COUNT; i++) p[i] = HOST_FX[i].def;
    x.driveOn = I("fx.drive.on"); x.driveType = I("fx.drive.type"); x.driveAmt = I("fx.drive.amount");
    x.driveTone = I("fx.drive.tone"); x.driveMix = I("fx.drive.mix");
    x.chOn = I("fx.chorus.on"); x.chRate = I("fx.chorus.rate"); x.chDepth = I("fx.chorus.depth");
    x.chSpread = I("fx.chorus.spread"); x.chVoices = I("fx.chorus.voices"); x.chMix = I("fx.chorus.mix");
    x.phOn = I("fx.phaser.on"); x.phRate = I("fx.phaser.rate"); x.phDepth = I("fx.phaser.depth");
    x.phFb = I("fx.phaser.fb"); x.phStages = I("fx.phaser.stages"); x.phMix = I("fx.phaser.mix");
    x.dlOn = I("fx.delay.on"); x.dlSync = I("fx.delay.sync"); x.dlDiv = I("fx.delay.div");
    x.dlTime = I("fx.delay.time"); x.dlFb = I("fx.delay.fb"); x.dlPong = I("fx.delay.pong");
    x.dlTone = I("fx.delay.tone"); x.dlMix = I("fx.delay.mix");
    x.rvOn = I("fx.reverb.on"); x.rvSize = I("fx.reverb.size"); x.rvDecay = I("fx.reverb.decay");
    x.rvDamp = I("fx.reverb.damp"); x.rvPre = I("fx.reverb.pre"); x.rvWidth = I("fx.reverb.width");
    x.rvMix = I("fx.reverb.mix");
    x.cpOn = I("fx.comp.on"); x.cpThresh = I("fx.comp.thresh"); x.cpRatio = I("fx.comp.ratio");
    x.cpAttack = I("fx.comp.attack"); x.cpRelease = I("fx.comp.release"); x.cpMakeup = I("fx.comp.makeup");
    x.grOn = I("fx.grit.on"); x.grAmount = I("fx.grit.amount"); x.grTone = I("fx.grit.tone"); x.grMix = I("fx.grit.mix");
    x.otOn = I("fx.ott.on"); x.otDepth = I("fx.ott.depth"); x.otTime = I("fx.ott.time"); x.otUp = I("fx.ott.upward");
    x.width = I("fx.width"); x.mvol = I("master.vol");
    build();
  }

  // ── fx.js _val / amt / live ──
  bool on(int i) const { return p[i] > 0.5; }
  double val(int i, int modSlot) const {
    const double base = p[i];
    if (modSlot < 0) return base;
    const double mm = m[modSlot];
    if (!mm) return base;
    return clampd(base + mm * (HOST_FX[i].max - HOST_FX[i].min), HOST_FX[i].min, HOST_FX[i].max);
  }
  double amt(int onI, int i, int modSlot) const {
    if (on(onI)) return val(i, modSlot);
    const double mm = m[modSlot];
    return mm > 0.001 ? clampd(HOST_FX[i].min + mm * (HOST_FX[i].max - HOST_FX[i].min), HOST_FX[i].min, HOST_FX[i].max) : 0;
  }
  bool live(int onI, int modSlot) const { return on(onI) || m[modSlot] > 0.001; }

  // ── Drive ──
  Curve driveCurve; int dvType = -1; double dvAmt = -1; int dvSince = 1 << 20;
  Smooth dvWet, dvDry; bool dvActive = false; int dvTail = 0;
  Os2 dvOs[2]; BqC dvToneC; BqS dvToneS[2];
  // ── Chorus ──
  struct ChV { Dl d[2]; double ph = 0; Smooth lvl; double pan = 0; };
  ChV chv[4]; bool chActive = false; int chTail = 0; double chRate = 0.6, chAmt = 0.002, chSpreadV = 0.7;
  // ── Phaser ──
  BqC phC[12]; BqS1 phS[12][2]; double phPh = 0, phFbS[2] = {0, 0};
  Smooth phWet, phFbG; bool phActive = false; int phTail = 0; int phCtl = 0;
  // ── Delay ──
  Dl dlL, dlR; double dlTimeL = 0.35, dlTimeR = 0.35, dlTgt = 0.35; Smooth dlWet; BqC dlToneC; BqS dlToneS[2];
  double dlA = 0, dlX = 0; bool dlRun = false;
  // ── Reverb: an 8-line feedback delay network ──
  static constexpr int RN = 8;
  Dl rv[RN]; double rvLen[RN], rvCur[RN], rvG[RN], rvLp[RN];
  Dl rvPreL, rvPreR; double rvPreT = 0.01; Smooth rvWet; double rvOutScale = 0.1, rvCut = 0.5;
  Dl apL[2], apR[2]; double apLen[2][2]; double rvSideW = 1; bool rvRun = false; int rvTail = 0; double rvRt = 2;
  double rvSizeCache = -1, rvDecayCache = -1, rvDampCache = -1;
  double rvRtMul = 1;       // send mode: the fitted RT60 as a multiple of the convolver's -60 dB point
  bool rvWetOnly = false;   // processSend: the output is the tail alone, not input + tail
  // ── Compressor / OTT / Grit / width / master ──
  Comp comp; bool cpOnV = false;
  struct Band { BqC c[4]; BqS s[4][2]; int n = 2; Comp k; double pre = 1, post = 1; };
  Band ot[3]; Smooth otWet, otDry; bool otActive = false; int otTail = 0; int otCtl = 0;
  Curve gritCurve; double gritKey = -1; Os2 grOs[2]; BqC grToneC; BqS grToneS[2];
  Smooth grWet, grDry; bool grActive = false; int grTail = 0;
  Smooth wPos, wNeg, mvolS;

  void build() {
    for (auto* s : {&dvWet, &dvDry, &phWet, &phFbG, &dlWet, &rvWet, &otWet, &otDry, &grWet, &grDry, &wPos, &wNeg, &mvolS}) s->init(sr);
    dvDry.snap(1); otDry.snap(1); grDry.snap(1); wPos.snap(1); wNeg.snap(-1); mvolS.snap(0.8);
    for (int i = 0; i < 4; i++) {
      chv[i].d[0].init((int)(sr * 0.09)); chv[i].d[1].init((int)(sr * 0.09));
      chv[i].lvl.init(sr);
    }
    dlL.init((int)(sr * 4.0)); dlR.init((int)(sr * 4.0));
    rvPreL.init((int)(sr * 0.26)); rvPreR.init((int)(sr * 0.26));
    static const int base[RN] = {1117, 1559, 1993, 2467, 2971, 3469, 3947, 4421};
    for (int i = 0; i < RN; i++) {
      rvLen[i] = rvCur[i] = base[i] * sr / 44100.0;
      rv[i].init((int)(base[i] * sr / 44100.0 * 2.2) + 8);
      rvLp[i] = 0; rvG[i] = 0;
    }
    static const int apl[2] = {142, 107}, apr[2] = {162, 121};
    for (int i = 0; i < 2; i++) {
      apLen[0][i] = apl[i] * sr / 44100.0; apLen[1][i] = apr[i] * sr / 44100.0;
      apL[i].init((int)apLen[0][i] + 4); apR[i].init((int)apLen[1][i] + 4);
    }
    makeCurve(driveCurve, 2, 0); makeCurve(gritCurve, 5, 0.5);
    comp.thresh = -18; comp.ratio = 4; comp.attack = 0.005; comp.release = 0.18; comp.knee = 30; comp.prep(sr);
    // OTT's three bands: two cascaded biquads a side, so each crossover falls
    // at 24 dB/oct. Q is 0.707 dB, as fx.js has it.
    ot[0].n = 2; ot[0].c[0] = ot[0].c[1] = bqDesign(LP, 120, 0.707, sr, true);
    ot[1].n = 4; ot[1].c[0] = ot[1].c[1] = bqDesign(HP, 120, 0.707, sr, true);
    ot[1].c[2] = ot[1].c[3] = bqDesign(LP, 2500, 0.707, sr, true);
    ot[2].n = 2; ot[2].c[0] = ot[2].c[1] = bqDesign(HP, 2500, 0.707, sr, true);
    for (auto& b : ot) { b.k.thresh = -26; b.k.knee = 8; b.k.ratio = 12; }
    dvToneC = bqDesign(LP, 12000, 1, sr, true); dlToneC = bqDesign(LP, 4000, 1, sr, true);
    grToneC = bqDesign(LP, 4000, 0.5, sr, true);
    for (int i = 0; i < 12; i++) phC[i] = bqDesign(AP, 400 * std::pow(1.35, i), 0.6, sr, false);
    for (int i = 0; i < 4; i++) { chv[i].pan = i % 2 ? 0.8 : -0.8; }
  }

  // ── Control-rate updates ──
  void controls() {
    // Drive
    {
      const bool active = live(x.driveOn, 0);
      const double dAmt = amt(x.driveOn, x.driveAmt, 0);
      const double dMix = on(x.driveOn) ? val(x.driveMix, -1) : 1.0;
      const int type = (int)p[x.driveType];
      const double key = active ? dAmt : 0;
      // Rebuilding the curve is 2048 tanh calls; an LFO on the amount would do
      // it every chunk. Rate-limited, and skipped when the amount hasn't moved.
      dvSince += CHUNK;
      if (type != dvType || (std::fabs(key - dvAmt) > 0.004 && dvSince > 512) || dvAmt < 0) {
        makeCurve(driveCurve, type, key); dvType = type; dvAmt = key; dvSince = 0;
      }
      dvWet.t = active ? dMix / (1 + dAmt * 1.4) : 0;
      dvDry.t = active ? 1 - dMix : 1;
      dvToneC = bqDesign(LP, 300 * std::pow(60.0, val(x.driveTone, -1)), 1, sr, true);
      const bool run = active && dAmt > 0;
      if (run) { dvActive = true; dvTail = (int)(0.1 * sr); }
      else if (dvTail > 0) dvTail -= CHUNK; else dvActive = false;
    }
    // Chorus
    {
      const bool active = live(x.chOn, 3);
      const int nv = (int)clampd((int)p[x.chVoices] ? (int)p[x.chVoices] : 2, 1, 4);
      const double mix = amt(x.chOn, x.chMix, 3);
      chRate = val(x.chRate, -1); chAmt = val(x.chDepth, -1) * 0.006; chSpreadV = val(x.chSpread, -1);
      for (int i = 0; i < 4; i++) chv[i].lvl.t = i < nv ? mix / std::sqrt((double)nv) : 0;
      if (active && mix > 0.001) { chActive = true; chTail = (int)(0.1 * sr); }
      else if (chTail > 0) chTail -= CHUNK; else chActive = false;
    }
    // Phaser
    {
      const bool active = on(x.phOn);
      const double mix = active ? val(x.phMix, -1) : 0;
      phWet.t = mix; phFbG.t = active ? val(x.phFb, -1) * 0.85 : 0;
      if (active && mix > 0.001) { phActive = true; phTail = (int)(1.5 * sr); }
      else if (phTail > 0) phTail -= CHUNK; else phActive = false;
    }
    // Delay
    {
      const bool active = live(x.dlOn, 1);
      const double dmix = amt(x.dlOn, x.dlMix, 1);
      dlWet.t = active ? dmix : 0;
      double t;
      if (on(x.dlSync)) {
        const int di = (int)clampd(p[x.dlDiv], 0, DIV_COUNT - 1);
        t = DIV_BEATS[di] * 60.0 / bpm;
      } else t = p[x.dlTime];
      dlTgt = clampd(t, 0.005, 3.9);
      const double fb = clampd(val(x.dlFb, -1), 0, 0.95), pong = clampd(val(x.dlPong, -1), 0, 1);
      dlA = fb * (1 - pong); dlX = fb * pong;
      dlToneC = bqDesign(LP, 400 * std::pow(40.0, val(x.dlTone, -1)), 1, sr, true);
      dlRun = active && dmix > 0.001;
    }
    // Reverb
    {
      const double rmix = amt(x.rvOn, x.rvMix, 2);
      rvWet.t = rmix > 0.001 ? rmix * 1.4 : 0;
      rvPreT = clampd(val(x.rvPre, -1), 0, 0.25);
      const double size = p[x.rvSize], decay = p[x.rvDecay], damp = p[x.rvDamp];
      if (size != rvSizeCache || decay != rvDecayCache || damp != rvDampCache) {
        rvSizeCache = size; rvDecayCache = decay; rvDampCache = damp;
        const double L = clampd(0.25 + size * 5.5, 0.1, 8);
        const double e = 1 + (12 - decay) * 0.35;
        // The convolver's tail falls as (1-t)^e over L seconds; the time that
        // takes to reach -60 dB is where the network's own RT60 is put.
        rvRt = clampd(rvRtMul * L * (1 - std::pow(0.001, 1.0 / e)), 0.05, 8);
        const double scale = 0.6 + size * 1.0;
        for (int i = 0; i < RN; i++) {
          rvLen[i] = std::min(baseLen(i) * scale, (double)rv[i].mask - 4);
          rvG[i] = std::pow(10.0, -3.0 * rvLen[i] / (sr * rvRt));
        }
        rvCut = std::exp(-PI * 2 * (200 + (1 - damp) * 9000) / sr);
        // Unit-power white noise through the convolver comes out at about
        // 0.00125 * (44100 / sr) * sqrt(IR length) (Web Audio's normalisation);
        // the network is scaled to that, from its own steady-state energy.
        // A line's steady-state power under unit noise is 1 / (1 - g^2) — the
        // loop adds one injected sample per pass, it does not accumulate a
        // line's length of them — and 1 - g^2 is about 13.8 * len / (sr * RT60).
        const double A = 0.00125 * 44100.0 / sr * std::sqrt(L * sr);
        double meanLen = 0; for (int i = 0; i < RN; i++) meanLen += rvLen[i] / RN;
        rvOutScale = A * 0.5 * std::sqrt(13.8 * meanLen / (sr * rvRt)) / std::sqrt((1 - rvCut) / (1 + rvCut));
        rvSideW = val(x.rvWidth, -1);
      }
      rvRun = rvWet.t > 0 || rvWet.v > 1e-4;
    }
    // Compressor
    {
      cpOnV = on(x.cpOn);
      comp.thresh = clampd(val(x.cpThresh, -1), -100, 0);
      comp.ratio = clampd(val(x.cpRatio, -1), 1, 20);
      comp.attack = clampd(val(x.cpAttack, -1), 0, 1); comp.release = clampd(val(x.cpRelease, -1), 0, 1);
      comp.prep(sr);
      comp.makeup *= dbToLin(val(x.cpMakeup, -1));
    }
    // OTT
    {
      const bool active = on(x.otOn);
      const double d = active ? clampd(val(x.otDepth, -1), 0, 1) : 0;
      const double tm = clampd(val(x.otTime, -1), 0, 1), up = clampd(val(x.otUp, -1), 0, 1);
      const double preDb = 4 + up * 20, postDb = -(preDb * 0.62);
      for (int i = 0; i < 3; i++) {
        ot[i].pre = dbToLin(preDb); ot[i].post = dbToLin(postDb + (i == 1 ? -1.5 : 0));
        ot[i].k.attack = 0.0015 + tm * 0.03; ot[i].k.release = 0.04 + tm * 0.35; ot[i].k.prep(sr);
      }
      otWet.t = d; otDry.t = 1 - d * 0.85;
      if (active && d > 0.001) { otActive = true; otTail = (int)(0.5 * sr); }
      else if (otTail > 0) otTail -= CHUNK; else otActive = false;
    }
    // Grit
    {
      const bool active = on(x.grOn);
      const double a = clampd(val(x.grAmount, -1), 0, 1);
      const double mx = active ? clampd(val(x.grMix, -1), 0, 1) : 0;
      if (active && std::fabs(a - gritKey) > 0.004) { makeCurve(gritCurve, 5, 0.15 + a * 0.85); gritKey = a; }
      // Level-matched by measurement in fx.js, not by formula; the table is its own.
      static const double T[5] = {0.60, 0.156, 0.096, 0.087, 0.083};
      const double q = a * 4; const int i0 = std::min(3, (int)q); const double fr = q - i0;
      grWet.t = mx * (T[i0] + (T[i0 + 1] - T[i0]) * fr); grDry.t = 1 - mx;
      grToneC = bqDesign(LP, 600 * std::pow(30.0, clampd(val(x.grTone, -1), 0, 1)), 0.5, sr, true);
      if (active && mx > 0.001) { grActive = true; grTail = (int)(0.1 * sr); }
      else if (grTail > 0) grTail -= CHUNK; else grActive = false;
    }
    // Output
    {
      const double w = val(x.width, -1);
      wPos.t = w; wNeg.t = -w; mvolS.t = val(x.mvol, -1);
    }
  }
  double baseLen(int i) const {
    static const int base[RN] = {1117, 1559, 1993, 2467, 2971, 3469, 3947, 4421};
    return base[i] * sr / 44100.0;
  }

  // ── Stages ──
  void drive(float* L, float* R, int n) {
    if (!dvActive && dvWet.v < 1e-4) return;
    float* ch[2] = {L, R};
    for (int c = 0; c < 2; c++)
      for (int i = 0; i < n; i++) {
        float dry; const float wet = dvOs[c].run(driveCurve, ch[c][i], &dry);
        const float t = (float)bqRun(dvToneC, dvToneS[c], wet);
        ch[c][i] = t; dryTmp[c][i] = dry;
      }
    for (int i = 0; i < n; i++) {
      const float w = (float)dvWet.next(), d = (float)dvDry.next();
      L[i] = L[i] * w + dryTmp[0][i] * d;
      R[i] = R[i] * w + dryTmp[1][i] * d;
    }
  }
  float dryTmp[2][CHUNK];

  void chorus(float* L, float* R, int n) {
    if (!chActive) { for (auto& v : chv) v.lvl.v = v.lvl.t; return; }
    for (int i = 0; i < n; i++) {
      const float inL = L[i], inR = R[i];
      float oL = inL, oR = inR;
      for (int v = 0; v < 4; v++) {
        ChV& cv = chv[v];
        cv.d[0].write(inL); cv.d[1].write(inR);
        const double lvl = cv.lvl.next();
        cv.ph += 2 * PI * chRate * (1 + v * 0.13) / sr; if (cv.ph > 2 * PI) cv.ph -= 2 * PI;
        const double base = (0.012 + v * 0.006) * (0.5 + chSpreadV);
        const double t = clampd(base + chAmt * std::sin(cv.ph), 0.0005, 0.079) * sr;
        if (lvl < 1e-6) continue;
        const float a = cv.d[0].read(t) * (float)lvl, b = cv.d[1].read(t) * (float)lvl;
        // StereoPanner on a stereo input, as the spec defines it.
        const double pan = (v % 2 ? 1 : -1) * chSpreadV;
        double gl, gr;
        if (pan <= 0) { const double xx = pan + 1; gl = std::cos(xx * PI / 2); gr = std::sin(xx * PI / 2); oL += a + b * (float)gl; oR += b * (float)gr; }
        else { gl = std::cos(pan * PI / 2); gr = std::sin(pan * PI / 2); oL += a * (float)gl; oR += b + a * (float)gr; }
      }
      L[i] = oL; R[i] = oR;
    }
  }

  void phaser(float* L, float* R, int n) {
    if (!phActive && phWet.v < 1e-4) { return; }
    const double rate = clampd(val(x.phRate, 4), 0.01, 20);
    const double depth = val(x.phDepth, -1) * 2200;
    const int ns = (int)clampd(p[x.phStages], 2, 12);
    for (int i = 0; i < n; i++) {
      if ((phCtl++ & 15) == 0) {
        for (int s = 0; s < ns; s++) {
          const double f = 400 * std::pow(1.35, s) + depth * std::sin(phPh);
          phC[s] = bqDesign(AP, f, 0.6, sr, false);
        }
      }
      phPh += 2 * PI * rate / sr; if (phPh > 2 * PI) phPh -= 2 * PI;
      const double fb = phFbG.next(), wet = phWet.next();
      float* ch[2] = {L, R};
      for (int c = 0; c < 2; c++) {
        const double in = ch[c][i];
        double y = in + fb * phFbS[c];
        for (int s = 0; s < ns; s++) y = bqRun1(phC[s], phS[s][c], y);
        phFbS[c] = y;
        ch[c][i] = (float)(in + wet * y);
      }
    }
  }

  void delay(float* L, float* R, int n) {
    if (!dlRun && dlWet.v < 1e-4) { return; }
    const double slew = 1.0 - std::exp(-1.0 / (sr * 0.032));
    for (int i = 0; i < n; i++) {
      dlTimeL += (dlTgt - dlTimeL) * slew; dlTimeR += (dlTgt * 1.0007 - dlTimeR) * slew;
      const double wg = dlWet.next();
      const float inL = dlRun ? L[i] : 0, inR = dlRun ? R[i] : 0;
      const double yL = dlL.read(dlTimeL * sr), yR = dlR.read(dlTimeR * sr);
      const double tL = bqRun(dlToneC, dlToneS[0], yL), tR = bqRun(dlToneC, dlToneS[1], yR);
      // fx.js routes the straight feedback through fbL and the cross-feed
      // through xR *after* it, so the cross path carries both gains.
      const double fL = dlA * tL, fR = dlA * tR;
      dlL.write((float)(inL + fL + dlX * fR));
      dlR.write((float)(inR + fR + dlX * fL));
      L[i] += (float)(wg * tL); R[i] += (float)(wg * tR);
    }
  }

  void reverb(float* L, float* R, int n) {
    if (!rvRun) {
      rvWet.v = 0;
      if (rvWetOnly) { std::memset(L, 0, sizeof(float) * (size_t)n); std::memset(R, 0, sizeof(float) * (size_t)n); }
      return;
    }
    for (int i = 0; i < n; i++) {
      rvCurSlew();
      const double wg = rvWet.next();
      // Pre-delay, then two allpasses a side to smear the onset.
      rvPreL.write(L[i]); rvPreR.write(R[i]);
      double inL = rvPreL.read(rvPreT * sr), inR = rvPreR.read(rvPreT * sr);
      for (int a = 0; a < 2; a++) {
        // Schroeder allpass: y = -g x + d,  line <- x + g y.
        const double dl = apL[a].read(apLen[0][a]);
        const double yl = -0.6 * inL + dl; apL[a].write((float)(inL + 0.6 * yl)); inL = yl;
        const double dr = apR[a].read(apLen[1][a]);
        const double yr = -0.6 * inR + dr; apR[a].write((float)(inR + 0.6 * yr)); inR = yr;
      }
      double xs[RN], sum = 0;
      for (int k = 0; k < RN; k++) {
        double v = rv[k].read(rvCur[k]);
        xs[k] = v; sum += v;
      }
      const double s2 = sum * (2.0 / RN);
      double oL = 0, oR = 0;
      static const double sg[RN] = {1, 1, -1, -1, 1, -1, -1, 1};
      for (int k = 0; k < RN; k++) {
        const double inj = (k & 1) ? inR : inL;
        rv[k].write((float)(inj * sg[k] + rvG[k] * (xs[k] - s2)));
        if (k & 1) oR += xs[k] * sg[(k + 3) & 7]; else oL += xs[k] * sg[(k + 1) & 7];
      }
      oL *= rvOutScale; oR *= rvOutScale;
      // Damping is a tone on the tail, as the convolver's noise was lowpassed
      // once; in the loop it would shorten the decay, not colour it.
      rvLp[0] = oL * (1 - rvCut) + rvLp[0] * rvCut; oL = rvLp[0];
      rvLp[1] = oR * (1 - rvCut) + rvLp[1] * rvCut; oR = rvLp[1];
      const double mid = (oL + oR) * 0.5, side = (oL - oR) * 0.5 * rvSideW;
      // The input was read into the pre-delay above, so a send can overwrite it.
      if (rvWetOnly) { L[i] = (float)(wg * (mid + side)); R[i] = (float)(wg * (mid - side)); }
      else { L[i] += (float)(wg * (mid + side)); R[i] += (float)(wg * (mid - side)); }
    }
  }
  void rvCurSlew() {
    for (int k = 0; k < RN; k++) rvCur[k] += (rvLen[k] - rvCur[k]) * 0.0005;
  }

  void compressor(float* L, float* R, int n) {
    if (!cpOnV) return;
    for (int i = 0; i < n; i++) comp.run(L[i], R[i]);
  }

  void ott(float* L, float* R, int n) {
    if (!otActive && otWet.v < 1e-4) return;
    for (int i = 0; i < n; i++) {
      const double w = otWet.next(), d = otDry.next();
      float oL = 0, oR = 0;
      const float inL = L[i], inR = R[i];
      for (int b = 0; b < 3; b++) {
        double a = inL, c = inR;
        for (int s = 0; s < ot[b].n; s++) { a = bqRun(ot[b].c[s], ot[b].s[s][0], a); c = bqRun(ot[b].c[s], ot[b].s[s][1], c); }
        float l = (float)(a * ot[b].pre), r = (float)(c * ot[b].pre);
        ot[b].k.run(l, r);
        oL += l * (float)ot[b].post; oR += r * (float)ot[b].post;
      }
      L[i] = (float)(inL * d + oL * w); R[i] = (float)(inR * d + oR * w);
    }
  }

  void grit(float* L, float* R, int n) {
    if (!grActive && grWet.v < 1e-4) return;
    float* ch[2] = {L, R};
    for (int c = 0; c < 2; c++)
      for (int i = 0; i < n; i++) {
        float dry; const float s = grOs[c].run(gritCurve, ch[c][i], &dry);
        dryTmp[c][i] = dry; ch[c][i] = (float)bqRun(grToneC, grToneS[c], s);
      }
    for (int i = 0; i < n; i++) {
      const float w = (float)grWet.next(), d = (float)grDry.next();
      L[i] = L[i] * w + dryTmp[0][i] * d; R[i] = R[i] * w + dryTmp[1][i] * d;
    }
  }

  // Nothing in the page's own graph is allowed past the master bus's limiter,
  // and the native engine has no master bus yet. Until it does, a part cannot
  // hand the speaker more than about 1.2: identity below 0.9, then a soft knee.
  static inline float safe(double x) {
    const double a = std::fabs(x);
    if (a < 0.9) return (float)x;
    const double y = 0.9 + 0.3 * std::tanh((a - 0.9) / 0.3);
    return (float)(x < 0 ? -y : y);
  }
  void output(float* L, float* R, int n) {
    for (int i = 0; i < n; i++) {
      const double mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5;
      const double wp = wPos.next(), wn = wNeg.next(), mv = mvolS.next();
      L[i] = safe((mid + side * wp) * mv);
      R[i] = safe((mid + side * wn) * mv);
    }
  }
};

FxRack::FxRack(double sr) : d(new Impl(sr)) {}
FxRack::~FxRack() = default;
void FxRack::set(int i, double v) { if (i >= 0 && i < HOST_FX_COUNT) d->p[i] = v; }
void FxRack::setMods(const double* m5) { for (int i = 0; i < 5; i++) d->m[i] = m5[i]; }
void FxRack::setTempo(double bpm) { d->bpm = bpm > 0 ? bpm : 120; }

void FxRack::setSendReverb(double seconds, double exponent) {
  Impl& s = *d;
  // The page's reverbs are a convolver over noise that falls as (1-t)^exponent
  // for `seconds` (buildReverb: 2.5 over chord.reverbSize). The rack's reverb is
  // fitted to that shape from size and decay (controls(), above), so ask for the
  // inverse of those two maps. Undamped: the page's impulse is plain noise.
  s.p[s.x.rvOn] = 1;
  s.p[s.x.rvSize] = clampd((seconds - 0.25) / 5.5, 0, 1);
  s.p[s.x.rvDecay] = clampd(12 - (exponent - 1) / 0.35, HOST_FX[s.x.rvDecay].min, HOST_FX[s.x.rvDecay].max);
  s.p[s.x.rvDamp] = 0;
  s.p[s.x.rvPre] = 0;
  s.p[s.x.rvWidth] = 1;
  // A network falls at one rate throughout and this convolver's impulse falls
  // slowly at first, then collapses where the impulse ends (as master.h found for
  // the bus room), so the -60 dB point is the wrong thing to pin. Measured against
  // a ConvolverNode on the page's impulse (tests/graph/sendreverb.test.js): an RT60
  // 1.8 times that point and 3.5 dB more level than the unit-gain fit holds the
  // first 1.2 s of the tail (all of it that sits less than 22 dB down) to within
  // +1.2 / -3.1 dB, and the level on steady noise to 0.3 dB.
  s.rvRtMul = 1.8; s.rvSizeCache = -1;
  s.p[s.x.rvMix] = 1.5 / 1.4;     // controls() puts 1.4 on the mix; 1.5 is the measured trim
}

void FxRack::processSend(float* L, float* R, int n) {
  Impl& s = *d;
  s.rvWetOnly = true;
  for (int off = 0; off < n; off += CHUNK) {
    const int k = std::min(CHUNK, n - off);
    s.controls();
    s.reverb(L + off, R + off, k);
  }
  s.rvWetOnly = false;
}

void FxRack::process(float* L, float* R, int n) {
  Impl& s = *d;
  for (int off = 0; off < n; off += CHUNK) {
    const int k = std::min(CHUNK, n - off);
    float* l = L + off; float* r = R + off;
    s.controls();
    s.drive(l, r, k);
    s.chorus(l, r, k);
    s.phaser(l, r, k);
    s.delay(l, r, k);
    s.reverb(l, r, k);
    s.compressor(l, r, k);
    s.ott(l, r, k);
    s.grit(l, r, k);
    s.output(l, r, k);
  }
}

}  // namespace modsynth
