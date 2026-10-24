// See modfxproc.h. Read FX_WORKLET_SRC in index.html beside this; the order of
// every expression is the JavaScript's (the null test is bit for bit, which
// needs -ffp-contract=off, exactly as the mõdSynth engine does).
#include "modfxproc.h"
#include "jsnum.h"

#include <algorithm>
#include <cmath>

namespace modsynth {

ModFxProc::ModFxProc(double sampleRate) : sr(sampleRate) {
  N = (int)(sampleRate * 4);                // a 4 s ring, longer than any 1-bar slice
  buf[0].assign((size_t)N, 0.f);
  buf[1].assign((size_t)N, 0.f);
}

double ModFxProc::ladder(int c, double x) {
  double* S = fs[c];
  const double G = fg, k = fk, drv = fdrv, a = 1 - G;
  if (fmode == 2) {
    // Two-pole Sallen-Key, MS-20 flavour.
    const double G2 = G * G;
    const double S1 = S[0] * a, S2 = S[1] * a;
    const double y2e = (G2 * x + G * S1 + S2) / (1 + k * G2 + 1e-9);
    const double t = k * y2e, ax = t < -3 ? -1 : t > 3 ? 1 : (t * (27 + t * t) / (27 + 9 * t * t));
    const double u = x - ax;
    double v = (u - S[0]) * G, y = v + S[0]; S[0] = y + v; const double o1 = y;
    v = (o1 - S[1]) * G; y = v + S[1]; S[1] = y + v;
    return y;
  }
  // Moog ladder: four poles inside one feedback loop, saturating at the input.
  const double G2 = G * G, G3 = G2 * G, G4 = G3 * G;
  const double S1 = S[0] * a, S2 = S[1] * a, S3 = S[2] * a, S4 = S[3] * a;
  const double d = drv * x, xd = d < -3 ? -1 : d > 3 ? 1 : (d * (27 + d * d) / (27 + 9 * d * d));
  const double Sig = G3 * S1 + G2 * S2 + G * S3 + S4;
  const double y4 = (G4 * xd + Sig) / (1 + k * G4);
  const double u = xd - k * y4;
  double v = (u - S[0]) * G, y = v + S[0]; S[0] = y + v; const double o1 = y;
  v = (o1 - S[1]) * G; y = v + S[1]; S[1] = y + v; const double o2 = y;
  v = (o2 - S[2]) * G; y = v + S[2]; S[2] = y + v; const double o3 = y;
  v = (o3 - S[3]) * G; y = v + S[3]; S[3] = y + v;
  return y;
}

void ModFxProc::process(const float* inL, const float* inR, float* outL, float* outR, int n, const ModFxParams& P) {
  const float* inp[2] = {inL, inR};
  float* out[2] = {outL, outR};
  const int chn = 2;
  const double stut = P.stutter, rev = P.reverse, warp = P.warp, crush = P.crush, srate = P.srate;
  // Sample-and-hold rate reduction: full rate down to about 500 Hz.
  const double holdN = srate > 0.001 ? js::max(1, js::round(js::pow(sr / 500, srate))) : 1;
  const double grainSec = P.grain, grainLen = P.grainlen;
  const Mode wantMode = stut > 0.001 ? STUTTER : rev > 0.001 ? REVERSE
                      : grainSec > 0.001 ? GRAIN
                      : js::abs(warp - 1) > 0.001 ? WARP : THRU;
  if (wantMode != mode) {
    bool go = true;
    if (wantMode == STUTTER || wantMode == REVERSE) {
      const double want = js::min(js::max(256, js::floor((wantMode == STUTTER ? stut : rev) * N)), N - 1);
      if (valid < want) go = false;
      else {
        sliceLen = (int)want;
        sliceStart = (w - sliceLen + N) % N;
        pos = 0;
      }
    } else if (wantMode == WARP) {
      rd = w;
    } else if (wantMode == GRAIN) {
      gCycle = 0; gPos = 0; gStart = w;
    }
    if (go) { mode = wantMode; xf = 0; }
  }
  const double gCycleN = js::max(64, js::floor(grainSec * sr));
  const double gLenN = js::max(32, js::floor(gCycleN * (0.06 + grainLen * 0.94)));
  const double bits = crush > 0.001 ? js::pow(2, 16 - crush * 13) : 0;
  valid = js::min(N, valid + n);
  if (mode == THRU && holdN == 1 && bits == 0 && xf >= 1) {
    // Nothing to do but listen.
    int w0 = w;
    for (int c = 0; c < chn; c++) {
      float* b = buf[c].data();
      int ww = w0;
      for (int k = 0; k < n; k++) {
        const float s = inp[c][k];
        out[c][k] = s;
        b[ww] = s;
        ww = (ww + 1) % N;
      }
    }
    w = (w0 + n) % N;
  } else {
    for (int c = 0; c < chn; c++) {
      float* o = out[c];
      const float* i = inp[c];
      float* b = buf[c].data();
      int ww = w; double rdd = rd; int64_t pp = pos; double xff = xf;
      if (c > 0) holdC -= n;                 // rewind so every channel walks the same grid
      const int64_t gPos0 = gPos, gCyc0 = gCycle, gSt0 = gStart;
      for (int k = 0; k < n; k++) {
        const double s = i[k];
        b[ww] = (float)s;
        double y = s;
        if (mode == STUTTER) {
          y = b[(sliceStart + pp) % N];
          pp++; if (pp >= sliceLen) pp = 0;
        } else if (mode == REVERSE) {
          y = b[(sliceStart + sliceLen - 1 - pp + N) % N];
          pp++; if (pp >= sliceLen) pp = 0;
        } else if (mode == GRAIN) {
          if (gCycle <= 0) { gStart = ww; gPos = 0; gCycle = (int64_t)gCycleN; }
          y = b[(gStart + gPos) % N];
          gPos++; if ((double)gPos >= gLenN) gPos = 0;
          gCycle--;
        } else if (mode == WARP) {
          const double i0 = js::floor(rdd), fr = rdd - i0;
          const double a = b[(int)(js::fmod(js::fmod(i0, N) + N, N))];
          const double bb = b[(int)(js::fmod(js::fmod(i0 + 1, N) + N, N))];
          y = a + (bb - a) * fr;
          rdd = js::fmod(rdd + warp, N);
        }
        if (holdN > 1) {
          if ((double)(holdC % (int64_t)holdN) == 0) holdV[c] = y;
          y = holdV[c];
          if (c == chn - 1) holdC++;
        }
        if (bits > 0) y = js::round(y * bits) / bits;
        if (xff < 1) { xff = js::min(1, xff + 1.0 / 256); y = s * (1 - xff) + y * xff; }
        o[k] = (float)y;
        ww = (ww + 1) % N;
      }
      if (c == chn - 1) { w = ww; rd = rdd; pos = pp; xf = xff; }
      else { gPos = gPos0; gCycle = gCyc0; gStart = gSt0; }
    }
  }
  // Ladder, after the mangle.
  const int fm = (int)js::toi32(P.fltmode);
  if (fm > 0) {
    const double cut = P.fltcut, res = P.fltres, drv = P.fltdrv;
    double fc = 20 * js::pow(900, cut < 0 ? 0 : cut > 1 ? 1 : cut);
    const double OS = 2, fsOS = sr * OS;
    if (fc > fsOS * 0.45) fc = fsOS * 0.45;
    fg = js::tan(js::PI * fc / fsOS) / (1 + js::tan(js::PI * fc / fsOS));
    fk = fm == 2 ? res * 1.85 : res * 3.85;
    fdrv = 1 + drv * 7;
    fmode = fm;
    const double norm = (1 + fk * (fm == 2 ? 0.6 : 0.5)) / (1 + drv * 1.6);
    for (int c = 0; c < chn; c++) {
      float* o = out[c];
      double z = fz[c];
      for (int k2 = 0; k2 < n; k2++) {
        const double xc = o[k2];
        const double y1 = ladder(c, (z + xc) * 0.5);
        const double y2 = ladder(c, xc);
        z = xc;
        o[k2] = (float)((y1 + y2) * 0.5 * norm);
      }
      fz[c] = z;
    }
  } else if (fmode != 0) {
    fmode = 0;
    for (int j = 0; j < 4; j++) { fs[0][j] = 0; fs[1][j] = 0; }
    fz[0] = 0; fz[1] = 0;
  }
}

}  // namespace modsynth
