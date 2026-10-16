// mõdSynth DSP core, in C++.
//
// A line-for-line port of modsynth/dsp.js (the AudioWorklet processor), not a
// re-imagining of it: same structure, same names, same order of operations,
// same single/double precision at every store. That is what lets the null
// test (tests/modsynth/null.test.js) compare the two sample by sample across
// every factory patch, and what makes "sounds the same" a measurement.
//
// No platform dependency. The Swift host feeds it the same messages the
// worklet's port receives today (see the Message section below) and calls
// process() from its render callback.
#pragma once
#include <cstdint>
#include <memory>
#include <vector>
#include "jsnum.h"
#include "params_gen.h"

namespace modsynth {

using js::f32;

constexpr int TABLE_SIZE = 2048;
constexpr int NUM_MIPS = 11;
constexpr int FRAMES = 4;
constexpr int CTRL = 32;
constexpr double CHOKE_SEC = 0.012;
constexpr int MAX_VOICES = 16;
constexpr int MAX_UNI = 8;
constexpr int MOTION_MAX = 16;
constexpr double TWO_PI = js::PI * 2;
constexpr double OUT_TRIM = 0.5;
constexpr int N_OSC = 3;
constexpr int N_DST = 42;
constexpr int N_SRC = 32;
constexpr int PD_N = 8192, PD_R = 32;

// A note id as the worklet sees one: a number, or null (a queued event that
// had none), or absent. The two empties are distinct in JS (null !== undefined).
struct NoteId {
  enum Kind : uint8_t { NUM, NUL, UND } kind = UND;
  double n = 0;
  static NoteId num(double v) { NoteId i; i.kind = NUM; i.n = v; return i; }
  static NoteId nul() { NoteId i; i.kind = NUL; return i; }
  bool isNullish() const { return kind != NUM; }
  bool same(const NoteId& o) const { return kind == o.kind && (kind != NUM || n == o.n); }   // ===
};

struct MatrixRow { double s = 0, d = 0, a = 0, u = 0, v = 0; };

// One table: len + 1 samples, the last repeating the first.
struct Table { std::vector<float> d; int len() const { return (int)d.size() - 1; } };

class FilterSlot {
 public:
  f32 s[8], ic[4], fv[12];
  std::vector<f32> comb;
  int cw[2] = {0, 0}; double cLast[2] = {0, 0};
  int model = 0; double g = 0, G = 0, k = 0;
  double drive = 1, outTrim = 1, res = 0, combN = 2;
  double fg[3] = {0.1, 0.2, 0.3}; double fk = 1;
  void reset();
  void set(int model, double cut, double res, double drv, double sr);
  void processBlock(f32* buf, int n, int ch);
};

struct Env {
  int stage = 0; double pos = 0, v = 0, from = 0, rel = 0;
  void gate(bool on);
  void kill() { stage = 0; pos = 0; v = 0; }
  double run(double a, double h, double d, double s, double r, double curve, double dt);
};

struct Lfo {
  double ph = 0, val = 0, sm = 0, age = 0;
  js::Rng rng;
  double hold = 0, next = 0;
  bool once = false, done = false;
  explicit Lfo(double seed = 0);
  void retrig(double phase);
  double step(int shape, double inc, double pw, double smooth, double dt);
  double eval(int shape, double pw, double smooth, double dt);
  void setPhase(double p) { ph = p - js::floor(p); }
};

struct Voice {
  int id;
  bool active = false;
  double note = 60, vel = 0.8; bool held = false, pedal = false;
  double age = 0, startTime = 0; NoteId noteId = NoteId::num(-1);
  double uniIdx = 0;
  double ph[N_OSC][MAX_UNI] = {};
  f32 drift[N_OSC][MAX_UNI], driftT[N_OSC][MAX_UNI];
  double subPh = 0;
  js::Rng rng;
  f32 fbA[N_OSC][MAX_UNI], fbB[N_OSC][MAX_UNI];
  double chW = 0, chS = 0;
  js::Rng rng3;
  std::vector<f32> ks; int ksW = 0; double ksLp = 0; int ksExc = 0;
  Env env[3];
  Lfo lfo[3];
  FilterSlot f1, f2, f1R;
  f32 md[N_DST], src[N_SRC];
  double glidePitch = 60, targetPitch = 60;
  double dcX = 0, dcY = 0, nzLp = 0;
  f32 pink[7];
  double blueLast = 0;
  double panL = 0, panR = 0;
  double alt = 1, randA = 0, randB = 0;
  double lastAmp = 0;
  double choke = 1; bool choking = false;

  explicit Voice(int id);
  void reset();
  struct Snap;
  void noteOn(double note, double vel, NoteId noteId, const struct Snap& S, double time, bool hasGlide, double glideFrom);
  void noteOff();
  void kill() { active = false; held = false; pedal = false; reset(); }
  bool finished() const;
};

// The per-block parameter snapshot (dsp.js `S`). Field types follow JS: the
// ones dsp.js keeps in typed arrays are float (lfoDiv is the one where that
// rounds anything), the rest double.
struct Voice::Snap {
  int poly = 1, mode = 0; double glide = 0; bool glideAuto = false;
  double bendUp = 0, bendDown = 0, transpose = 0, tune = 0, drift = 0, velAmt = 0, velCurve = 0, vspread = 0;
  bool oOn[3] = {}; int oWave[3] = {}; double oShape[3] = {}, oPw[3] = {}, oTune[3] = {}, oLevel[3] = {}, oPan[3] = {};
  int oUni[3] = {1, 1, 1}; double oDet[3] = {}, oWidth[3] = {}, oBlend[3] = {}, oKt[3] = {1, 1, 1};
  bool oFree[3] = {true, true, true}; double oPhase[3] = {};
  bool sync = false, fmRatio = false; double oFb[3] = {};
  double fm3a = 0, fm3b = 0, chaosRate = 0, pluck = 0, pluckDecay = 0, pluckTone = 0, pluckOct = 0;
  double fm = 0, ring = 0, sub = 0; int subWave = 0; double subOct = 0, noise = 0; int noiseType = 0; double noiseFlt = 0;
  int fModel[2] = {}; double fCut[2] = {}, fRes[2] = {}, fDrv[2] = {}, fKt[2] = {}, fEnv[2] = {}, fVel[2] = {};
  int route = 0; double blend = 0, spread = 0, drive = 0; int driveType = 0;
  struct E { double a = 0, h = 0, d = 0, s = 0, r = 0, curve = 0, vel = 0; } env[3];
  bool env3loop = false;
  int32_t lfoShape[3] = {}; f32 lfoRate[3], lfoDiv[3], lfoDepth[3], lfoPhase[3], lfoDelay[3], lfoFade[3], lfoSm[3];
  uint8_t lfoSync[3] = {}; int32_t lfoMode[3] = {}; f32 lfoPw[3];
  struct M { bool on = false; int steps = 1; double div = 1, rate = 0; bool sync = false; double slew = 0; int mode = 0; double depth = 0; } mot[2];
  bool crushOn = false; double crushBits = 1, crushRate = 0.02, crushMix = 0;
};
using Snap = Voice::Snap;

class Processor {
 public:
  explicit Processor(double sampleRate, const float* paramValues = nullptr);

  // ── Messages: the worklet port's, one method each ──
  void setParam(int i, double v);                       // {t:'p', i, v}
  void noteOnMsg(double note, double vel, NoteId id, bool hasAt, double at);   // {t:'on'}
  void noteOffMsg(double note, NoteId id, bool hasAt, double at);              // {t:'off'}
  void chokeMsg(double note, NoteId id, bool hasAt, double at);                // {t:'choke'}
  void panic();
  void allNotesOff();
  void setMw(double v) { mw = v; }
  void setBend(double v) { bend = v; }
  void setAt(double v) { at = v; }
  void setCC(int n, double v);
  void setSustain(bool on);
  void setMacro(int i, double v) { if (i >= 0 && i < 9) macros[i] = v; }
  void setCap(double uni, double poly);
  void setMatrix(const std::vector<MatrixRow>& rows);
  void setMotion(int lane, const float* steps, int n);
  void setTempo(double bpm, bool hasBeat, double beat);
  // Math.random's stand-in for the motion lanes' random mode. The worklet
  // calls Math.random(); here it is a function the host (or the null test)
  // supplies, so the two can be given the same sequence.
  double (*random)(void*) = nullptr; void* randomCtx = nullptr;
  uint32_t randState = 0x12345678u;   // the default: a 32-bit xorshift, as the null test's Math.random
  void setAllParams(const float* v, int n) { for (int i = 0; i < n && i < PARAM_COUNT; i++) pv[i] = v[i]; dirty = true; }   // {t:'pAll'}

  // Renders n frames (n = 128 in the worklet) into L and R, overwriting them.
  void process(float* L, float* R, int n);

  double sr;
  int activeVoices() const;

 private:
  struct Ev { double at; int type; double note, vel; NoteId id; };
  struct Held { double note, vel; NoteId id; };

  f32 pv[PARAM_COUNT];
  int ix(const char* id) const;
  std::vector<std::vector<std::vector<Table>>>* bank;
  std::vector<std::unique_ptr<Voice>> voices;
  std::vector<MatrixRow> matrix;
  f32 macros[9];
  double mw = 0, bend = 0, at = 0, expr = 0, breath = 0, foot = 0;
  bool sustain = false;
  double bpm = 120, beat = 0;
  bool hasLastNote = false; double lastNote = 0;
  std::vector<Held> heldNotes;
  std::vector<Ev> evq;
  f32 motion[2][MOTION_MAX];
  double motPos[2] = {0, 0}, motDir[2] = {1, 1}, motVal[2] = {0, 0}, motPhase[2] = {0, 0};
  bool hasMotLastStep = false; double motLastStep = 0;
  Lfo gLfo[3];
  f32 gsrc[N_SRC], gmod[N_DST];
  bool dirty = true; bool hasS = false; Snap S;
  double frame = 0;
  int capUni = MAX_UNI, capPoly = MAX_VOICES;
  bool chaosUsed = false;
  double tInc[N_OSC][MAX_UNI] = {};
  f32 tGL[N_OSC][MAX_UNI], tGR[N_OSC][MAX_UNI];
  double tMip[N_OSC] = {};
  const Table* tabA[N_OSC] = {}; const Table* tabB[N_OSC] = {};
  double mixF[N_OSC] = {}; bool isPulse[N_OSC] = {}; bool need[N_OSC] = {};
  f32 bM[N_OSC][CTRL], bR[N_OSC][CTRL], bRaw[N_OSC][CTRL];
  double gChW = 0, gChS = 0; js::Rng gRng;
  int32_t syncAt[CTRL + 1] = {};
  f32 mixL[CTRL], mixR[CTRL], mixT[CTRL];
  double chL = 0, chR = 0, cAcc = 1;
  int ixCache[PARAM_COUNT];

  double now() const { return frame; }
  void queue(double at, int type, double note, double vel, NoteId id);
  void drainQueue(double frameEnd);
  void unqueueOff(const NoteId& id);
  void noteOffId(const NoteId& id, double note);
  void chokeId(const NoteId& id);
  const Snap& snapshot();
  Voice* freeVoice(int poly);
  void noteOn(double note, double vel, NoteId id);
  void noteOff(double note);
  void runGlobal(const Snap& S, double dt);
  void renderVoice(Voice& v, const Snap& S, float* L, float* R, int off, int blk, double dt);
  double rand01();
};

}  // namespace modsynth
