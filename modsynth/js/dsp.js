/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — DSP core (AudioWorkletProcessor)
   ───────────────────────────────────────────────────────────────────────────
   Runs on the audio thread. Everything below the FX rack lives here: the
   wavetable oscillators, the filters, the envelopes, the LFOs, the motion
   lanes, the modulation matrix and voice allocation.

   Loading: the host reads this file, wraps it in a Blob and calls addModule()
   on the resulting URL. That keeps the source readable *and* lets the app run
   straight off the filesystem, which a bare addModule('dsp.js') cannot do.

   Three structural choices worth knowing before reading further:

   · Wavetables are generated from *time-domain* frame functions, then
     band-limited by FFT → truncate harmonics → IFFT, once per mip level. A new
     waveform is therefore written as plain waveform maths (see WT_DEFS) and
     gets correct anti-aliasing for free, down to a single harmonic at the top
     of the keyboard.

   · Modulation runs at CTRL-sample granularity, not per sample. Amp gain and
     pan are the exceptions — they're linearly interpolated across the control
     block, because those are the two places a stepped value is plainly
     audible. Cutoff, pitch and shape are smoothed enough by what they feed.

   · Per-unison-line setup avoids transcendentals. Detune is a geometric
     series (one pow, then repeated multiplies), pan uses the sqrt equal-power
     law, and the mip level is chosen once per oscillator. Without that, an
     8×2 unison stack across 16 voices spends more time in Math than in DSP.

   Ordering contracts with js/params.js (pinned by tests/params.test.js):
     WT_ORDER  ↔ MS.WAVES          SRC_ORDER    ↔ MS.MOD_SOURCES
     FLT_ORDER ↔ MS.FILTER_MODELS  DST_ORDER    ↔ MS.MOD_DESTS
     LFO_SHAPES↔ MS.LFO_SHAPES     DIV_BEATS_DSP↔ MS.DIVS
   ═══════════════════════════════════════════════════════════════════════════ */

const TABLE_SIZE = 2048;
const NUM_MIPS = 11;          // 1024 harmonics down to 1
const FRAMES = 4;             // morph frames per wavetable set
const CTRL = 32;              // samples per control-rate update (~0.7 ms)
const MAX_VOICES = 16;
const MAX_UNI = 8;
const MOTION_MAX = 16;
const TWO_PI = Math.PI * 2;
const OUT_TRIM = 0.5;         // pre-FX headroom

/* Tempo divisions in beats (quarter notes), mirroring MS.DIVS. */
const DIV_BEATS_DSP = [
  32, 16, 8, 4, 3, 2, 4 / 3, 1.5, 1, 2 / 3, 0.75, 0.5,
  1 / 3, 0.375, 0.25, 1 / 6, 0.125, 1 / 12, 0.0625,
];

/* ── Cheap maths ──────────────────────────────────────────────────────────── */

/** tanh-shaped soft clip; saturates to ±1 near |x| = 3. Far cheaper than tanh. */
function sat(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

/** Asymmetric clip — the even harmonics that make diode/tube stages bark. */
function satAsym(x) {
  return x >= 0 ? sat(x * 1.15) : sat(x * 0.72) * 0.86;
}

/** 0…1 → 0…1 with a bend. k>0 fast-then-slow, k<0 the reverse, k=0 linear.
    One multiply and one divide, which is why envelopes can afford it. */
function curveMap(t, k) {
  if (k === 0) return t;
  return t * (1 + k) / (1 + k * t);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** 32-bit xorshift in −1…1. Deterministic, and much cheaper than Math.random
    inside a per-sample loop. */
function makeRng(seed) {
  let s = seed | 0 || 0x2545f491;
  return function () {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return s / 2147483648;
  };
}

/* ── FFT (iterative radix-2, in place) ────────────────────────────────────── */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        const ur = re[a], ui = im[a];
        re[a] = ur + vr; im[a] = ui + vi;
        re[b] = ur - vr; im[b] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* ── Wavetable frame definitions ──────────────────────────────────────────────
   Each entry is a set of FRAMES time-domain functions of t ∈ [0,1). Band
   limiting happens afterwards, so these can be as discontinuous as they like.
   `osc.shape` crossfades between adjacent frames. */

const sin1 = t => Math.sin(TWO_PI * t);

/** A frame declared by its harmonic spectrum rather than its waveform.
    `amp(k)` and optional `phase(k)` describe Σ amp(k)·sin(2πkt + phase(k)).
    Declaring a frame this way skips the analysis FFT entirely, which is the
    difference between a seven-second startup and a fiftieth of one. */
function additive(amp, n, phase) {
  return { spectrum: amp, phase: phase || null, maxH: n };
}

/** Resonant peak weighting used by the vowel-ish tables. */
function formantAmp(k, f0, peaks) {
  let a = 0;
  for (let p = 0; p < peaks.length; p++) {
    const fc = peaks[p][0], bw = peaks[p][1], g = peaks[p][2];
    const d = (k * f0 - fc) / bw;
    a += g / (1 + d * d);
  }
  return a / k;
}

const WT_ORDER = [
  'classic', 'pulse', 'supersaw', 'harmonic', 'formant', 'bell',
  'digital', 'vocal', 'reed', 'string', 'glass', 'growl',
  'fold', 'noise', 'vintage', 'sync',
];

const WT_DEFS = {
  /* The analog spine: sine → triangle → saw → square. */
  classic: [
    sin1,
    additive(k => (k % 2 ? (k % 4 === 1 ? 1 : -1) / (k * k) : 0), 255),
    additive(k => 1 / k, 512),
    additive(k => (k % 2 ? 1 / k : 0), 512),
  ],
  /* Frames here are only a fallback — `pulse` is rendered at runtime as
     saw(φ) − saw(φ+width), band-limited by construction, which gives genuine
     PWM instead of a morph between fixed duty cycles. */
  pulse: [0.5, 0.35, 0.2, 0.08].map(d =>
    additive(k => 2 * Math.sin(Math.PI * k * d) / (Math.PI * k), 512)
  ),
  /* Saw with progressively softened corners — the top of a super-saw stack
     without the detuning, which the unison engine adds separately. */
  supersaw: [0, 0.004, 0.012, 0.035].map(c =>
    additive(k => Math.exp(-k * c) / k, 512)
  ),
  /* Drawbar / organ registrations. */
  harmonic: [
    additive(k => ([0, 1, 0.7, 0, 0.45, 0, 0, 0, 0.3][k] || 0), 16),
    additive(k => ([0, 1, 0, 0.8, 0, 0.6, 0, 0.4, 0, 0.25][k] || 0), 16),
    additive(k => ([0, 1, 0.85, 0.6, 0.5, 0.35, 0.3, 0.2, 0.35][k] || 0), 16),
    additive(k => (k <= 32 && (k & (k - 1)) === 0 ? 1 / Math.sqrt(k) : 0), 32),
  ],
  /* ah → eh → ee → oo */
  formant: [
    [[730, 220, 1], [1090, 260, 0.5], [2440, 400, 0.25]],
    [[530, 190, 1], [1840, 300, 0.45], [2480, 420, 0.2]],
    [[270, 160, 1], [2290, 330, 0.5], [3010, 480, 0.22]],
    [[300, 150, 1], [870, 220, 0.35], [2240, 400, 0.1]],
  ].map(peaks => additive(k => formantAmp(k, 110, peaks), 220)),
  /* Metallic, near-inharmonic partial sets. */
  bell: [
    additive(k => ([0, 1, 0, 0.6, 0, 0.45, 0, 0, 0, 0.3, 0, 0, 0, 0.22][k] || 0), 32),
    additive(k => ([0, 1, 0, 0.7, 0, 0, 0.5, 0, 0, 0, 0, 0.4, 0, 0, 0, 0.3][k] || 0), 32),
    additive(k => (k === 1 ? 1 : k === 3 ? 0.5 : k === 7 ? 0.42 : k === 11 ? 0.36 : k === 17 ? 0.3 : k === 23 ? 0.2 : 0), 40),
    additive(k => (k === 1 ? 1 : k % 5 === 0 ? 0.5 / Math.sqrt(k) : 0), 60),
  ],
  /* Two-operator FM spectra, written in the time domain and band-limited
     afterwards — far easier to read than the Bessel expansion. */
  digital: [1, 2, 3, 5].map((ratio, n) => {
    const idx = 1.2 + n * 1.4;
    return t => Math.sin(TWO_PI * t + idx * Math.sin(TWO_PI * ratio * t));
  }),
  vocal: [
    [[600, 180, 1], [1040, 240, 0.6], [2250, 380, 0.3], [2450, 400, 0.2]],
    [[400, 160, 1], [1700, 280, 0.55], [2300, 380, 0.3], [3200, 500, 0.15]],
    [[250, 140, 1], [2100, 320, 0.6], [3100, 480, 0.35], [3800, 520, 0.2]],
    [[350, 150, 1], [700, 200, 0.5], [2600, 420, 0.4], [3600, 520, 0.3]],
  ].map(peaks => additive(k => formantAmp(k, 98, peaks), 240)),
  /* Narrow pulses: clarinet-ish odd stacks through to a reedy oboe. */
  reed: [
    additive(k => (k % 2 ? 1 / (k * k * 0.06 + k) : 0), 200),
    additive(k => (k % 2 ? Math.exp(-k * 0.05) / k : 0.12 * Math.exp(-k * 0.14) / k), 200),
    additive(k => Math.exp(-Math.pow((k - 4) / 7, 2)) / Math.sqrt(k), 200),
    additive(k => Math.exp(-Math.pow((k - 9) / 11, 2)) / Math.sqrt(k), 240),
  ],
  string: [
    additive(k => Math.sin(Math.PI * k * 0.13) / k, 400),
    additive(k => Math.sin(Math.PI * k * 0.24) / k, 400),
    additive(k => (Math.sin(Math.PI * k * 0.09) / k) * Math.exp(-k * 0.006), 400),
    additive(k => (1 / k) * (1 + 0.35 * Math.sin(k * 0.9)), 400),
  ],
  glass: [
    additive(k => Math.exp(-Math.pow((k - 6) / 9, 2)) / Math.sqrt(k) + (k === 1 ? 0.6 : 0), 300),
    additive(k => Math.exp(-Math.pow((k - 14) / 12, 2)) / Math.sqrt(k) + (k === 1 ? 0.4 : 0), 300),
    additive(k => (k % 3 === 1 ? Math.exp(-k * 0.03) / Math.sqrt(k) : 0), 300),
    additive(k => (k % 7 === 1 ? 0.9 / Math.sqrt(k) : 0), 340),
  ],
  /* Phase-offset saw pairs — the raw material for reese and neuro bass.
     saw(t) − saw(t+off) has a closed form per harmonic, so it stays on the
     cheap spectrum path: amplitude (2/k)·sin(θ/2), phase θ/2 − π/2, θ = 2πk·off. */
  growl: [0.02, 0.12, 0.28, 0.45].map(off => additive(
    k => 1.2 * Math.abs(Math.sin(Math.PI * k * off)) / k,
    400,
    k => Math.PI * k * off - Math.PI / 2 + (Math.sin(Math.PI * k * off) < 0 ? Math.PI : 0)
  )),
  /* Sine driven through progressively harder wave folding. */
  fold: [1, 2.2, 3.8, 6].map(g => t => {
    let x = Math.sin(TWO_PI * t) * g;
    for (let i = 0; i < 4; i++) {
      if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x; else break;
    }
    return x;
  }),
  /* Deterministic pseudo-noise. Band-limiting turns these into rich, stable,
     alias-free "dirty" tables rather than actual hiss. */
  noise: [11, 977, 4441, 20011].map(seed => {
    const rng = makeRng(seed);
    const amps = new Float64Array(257);
    const phs = new Float64Array(257);
    for (let k = 1; k <= 256; k++) { amps[k] = Math.abs(rng()) / Math.pow(k, 0.6); phs[k] = rng() * Math.PI; }
    return additive(k => amps[k] || 0, 256, k => phs[k] || 0);
  }),
  /* Deliberately imperfect: droop, a little even-harmonic asymmetry and a
     rounded corner — most of what separates an old saw from a perfect one. */
  vintage: [
    t => { const s = 2 * t - 1; return s * (1 - 0.14 * s * s) + 0.05 * Math.sin(TWO_PI * 2 * t); },
    t => { const s = 2 * ((t + 0.03) % 1) - 1; return sat(s * 1.3) * 0.92 + 0.04 * Math.sin(TWO_PI * 3 * t); },
    t => (t < 0.48 ? 1 : -1) * (1 - 0.1 * Math.sin(TWO_PI * t)) * 0.8,
    t => { const s = 2 * t - 1; return 0.55 * s + 0.45 * Math.sign(s) * Math.pow(Math.abs(s), 0.7); },
  ],
  /* Pre-swept sync shapes, so the classic tearing sound is available without
     paying for real-time hard sync. */
  sync: [1.6, 2.6, 4.1, 6.3].map(r => t => {
    const p = (t * r) % 1;
    return (2 * p - 1) * (1 - t * 0.25);
  }),
};

/* ── Wavetable bank ───────────────────────────────────────────────────────────
   bank[shape][frame][mip] → Float32Array(len + 1); the extra sample repeats
   index 0 so the interpolator never has to wrap. */
let WT_BANK = null;

function buildWavetables() {
  if (WT_BANK) return WT_BANK;
  const aRe = new Float64Array(TABLE_SIZE);   // analysis scratch
  const aIm = new Float64Array(TABLE_SIZE);
  const sRe = new Float64Array(TABLE_SIZE);   // the frame's full spectrum
  const sIm = new Float64Array(TABLE_SIZE);
  const wRe = new Float64Array(TABLE_SIZE);   // per-mip synthesis scratch
  const wIm = new Float64Array(TABLE_SIZE);
  const bank = [];

  for (let s = 0; s < WT_ORDER.length; s++) {
    const frames = WT_DEFS[WT_ORDER[s]];
    const set = [];
    for (let fr = 0; fr < FRAMES; fr++) {
      const gen = frames[Math.min(fr, frames.length - 1)];
      sRe.fill(0); sIm.fill(0);
      let topH;

      if (typeof gen === 'function') {
        // Time-domain frame: analyse once at full resolution.
        for (let n = 0; n < TABLE_SIZE; n++) { aRe[n] = gen(n / TABLE_SIZE); aIm[n] = 0; }
        fft(aRe, aIm, false);
        // Scale out the unnormalised forward transform so both paths agree.
        for (let k = 1; k < TABLE_SIZE; k++) { sRe[k] = aRe[k] / TABLE_SIZE; sIm[k] = aIm[k] / TABLE_SIZE; }
        topH = (TABLE_SIZE >> 1) - 1;
      } else {
        // Spectrum frame: X[k] = (A/2)·e^{i(φ − π/2)}, conjugate-mirrored, which
        // inverse-transforms to Σ A·sin(2πkt + φ).
        topH = Math.min(gen.maxH, (TABLE_SIZE >> 1) - 1);
        for (let k = 1; k <= topH; k++) {
          const A = gen.spectrum(k);
          if (!A) continue;
          const ph = gen.phase ? gen.phase(k) : 0;
          const cr = (A / 2) * Math.sin(ph);
          const ci = -(A / 2) * Math.cos(ph);
          sRe[k] = cr; sIm[k] = ci;
          sRe[TABLE_SIZE - k] = cr; sIm[TABLE_SIZE - k] = -ci;
        }
      }

      const mips = [];
      for (let lvl = 0; lvl < NUM_MIPS; lvl++) {
        const len = Math.max(64, TABLE_SIZE >> lvl);
        const maxH = Math.max(1, Math.min(Math.min((TABLE_SIZE >> 1) >> lvl, topH), (len >> 1) - 1));
        // Synthesise at the mip's own length — an order of magnitude less work
        // than transforming at full size and decimating.
        const re = wRe.subarray(0, len), im = wIm.subarray(0, len);
        re.fill(0); im.fill(0);
        for (let k = 1; k <= maxH; k++) {
          re[k] = sRe[k]; im[k] = sIm[k];
          re[len - k] = sRe[TABLE_SIZE - k]; im[len - k] = sIm[TABLE_SIZE - k];
        }
        fft(re, im, true);
        const out = new Float32Array(len + 1);
        let peak = 1e-9;
        for (let n = 0; n < len; n++) {
          const v = re[n];
          out[n] = v;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
        // Normalise each mip to its own peak so running up the keyboard
        // doesn't change level as mips switch over.
        const norm = 1 / peak;
        for (let n = 0; n < len; n++) out[n] *= norm;
        out[len] = out[0];
        mips.push(out);
      }
      set.push(mips);
    }
    bank.push(set);
  }
  WT_BANK = bank;
  return bank;
}

/* ── Filter models ────────────────────────────────────────────────────────── */
const FLT_ORDER = [
  'bypass', 'ladder4', 'ladder2', 'svfLP', 'svfHP', 'svfBP',
  'svfNotch', 'svfPeak', 'diode', 'comb', 'formant',
];
const F_BYPASS = 0, F_LADDER4 = 1, F_LADDER2 = 2, F_SVFLP = 3, F_SVFHP = 4,
      F_SVFBP = 5, F_SVFNOTCH = 6, F_SVFPEAK = 7, F_DIODE = 8, F_COMB = 9, F_FORMANT = 10;

const VOWELS = [
  [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010],
  [570, 840, 2410], [300, 870, 2240],
];

/** One stereo filter slot. Coefficients are shared; state is per channel, so
    L and R never bleed through each other's integrators. */
class FilterSlot {
  constructor() {
    this.s = new Float32Array(8);        // ladder integrators, [ch*4 + pole]
    this.ic = new Float32Array(4);       // SVF state, [ch*2 + n]
    this.fv = new Float32Array(12);      // formant SVF state, [ch*6 + n*2 + i]
    this.comb = null; this.cw = [0, 0]; this.cLast = [0, 0];
    this.model = F_BYPASS; this.g = 0; this.G = 0; this.k = 0;
    this.drive = 1; this.outTrim = 1; this.res = 0; this.combN = 2;
    this.fg = [0.1, 0.2, 0.3]; this.fk = 1;
  }

  reset() {
    this.s.fill(0); this.ic.fill(0); this.fv.fill(0);
    if (this.comb) this.comb.fill(0);
    this.cLast[0] = this.cLast[1] = 0;
  }

  /** Control-rate coefficient update. `cut` in Hz, `res`/`drv` 0…1. */
  set(model, cut, res, drv, sr) {
    this.model = model;
    if (model === F_BYPASS) return;
    cut = clamp(cut, 12, sr * 0.47);
    const g = Math.tan(Math.PI * cut / sr);
    this.g = g;
    this.G = g / (1 + g);
    this.res = res;
    this.drive = 1 + drv * 9;
    this.outTrim = 1 / (1 + drv * 2.2);
    if (model === F_LADDER4) this.k = res * 4.2;
    else if (model === F_LADDER2 || model === F_DIODE) this.k = res * 3.4;
    else this.k = 2 - 1.94 * res;                 // SVF damping: 2 → 0.06
    if (model === F_COMB) {
      if (!this.comb) this.comb = new Float32Array(16384);   // two 8192 channels
      this.combN = clamp(sr / cut, 2, 8100);
    }
    if (model === F_FORMANT) {
      // `cut` sweeps the vowel rather than a corner frequency.
      const pos = clamp(Math.log2(cut / 120) / 5, 0, 0.9999) * (VOWELS.length - 1);
      const i0 = pos | 0, fr = pos - i0;
      const v0 = VOWELS[i0], v1 = VOWELS[Math.min(i0 + 1, VOWELS.length - 1)];
      for (let n = 0; n < 3; n++) {
        const f = v0[n] + (v1[n] - v0[n]) * fr;
        this.fg[n] = Math.tan(Math.PI * clamp(f, 40, sr * 0.45) / sr);
      }
      this.fk = 2 - 1.8 * res;
    }
  }

  /** Filters `n` samples of `buf` in place on channel `ch`.
      State is loaded into locals for the whole block and written back once —
      per-sample `this.` property loads were costing more than the filter
      maths, which is why there is no single-sample entry point. */
  processBlock(buf, n, ch) {
    const m = this.model;
    if (m === F_BYPASS) return;
    const G = this.G, iG = 1 - G, drive = this.drive, trim = this.outTrim;

    if (m === F_LADDER4 || m === F_LADDER2 || m === F_DIODE) {
      const four = m === F_LADDER4, diode = m === F_DIODE;
      const k = this.k;
      const gp = four ? G * G * G * G : G * G;
      const c1 = G * G * G, c2 = G * G;
      const denom = 1 / (1 + k * gp);
      const b = ch << 2, st = this.s;
      let s1 = st[b], s2 = st[b + 1], s3 = st[b + 2], s4 = st[b + 3];
      for (let i = 0; i < n; i++) {
        const S1 = iG * s1, S2 = iG * s2, S3 = iG * s3, S4 = iG * s4;
        const sig = four ? c1 * S1 + c2 * S2 + G * S3 + S4 : G * S1 + S2;
        // Zero-delay feedback solve, then one saturation inside the loop. That
        // single nonlinearity is where the ladder's compression comes from.
        let u = (buf[i] * drive - k * sig) * denom;
        u = diode ? satAsym(u) : sat(u);
        const y1 = G * u + S1; s1 = 2 * y1 - s1;
        const y2 = G * y1 + S2; s2 = 2 * y2 - s2;
        if (!four) { buf[i] = y2 * trim; continue; }
        const y3 = G * y2 + S3; s3 = 2 * y3 - s3;
        const y4 = G * y3 + S4; s4 = 2 * y4 - s4;
        buf[i] = y4 * trim;
      }
      st[b] = s1; st[b + 1] = s2; st[b + 2] = s3; st[b + 3] = s4;
      return;
    }

    if (m === F_COMB) {
      const cb = this.comb, base = ch * 8192, N = 8192;
      const d = this.combN, fb = 0.2 + this.res * 0.78;
      let w = this.cw[ch], last = this.cLast[ch];
      for (let i = 0; i < n; i++) {
        let rp = w - d;
        if (rp < 0) rp += N;
        const i0 = rp | 0, frac = rp - i0;
        const a = cb[base + i0], bnd = cb[base + ((i0 + 1) & 8191)];
        let dl = a + (bnd - a) * frac;
        dl = dl * 0.5 + last * 0.5;                 // one-pole damping in the loop
        last = dl;
        const inp = sat(buf[i] * drive);
        cb[base + w] = inp + dl * fb;
        w = (w + 1) & 8191;
        buf[i] = (inp * 0.4 + dl) * trim;
      }
      this.cw[ch] = w; this.cLast[ch] = last;
      return;
    }

    if (m === F_FORMANT) {
      const base = ch * 6, k = this.fk, fv = this.fv, fg = this.fg;
      const g0 = fg[0], g1 = fg[1], g2 = fg[2];
      const A0 = 1 / (1 + g0 * (g0 + k)), A1 = 1 / (1 + g1 * (g1 + k)), A2 = 1 / (1 + g2 * (g2 + k));
      let a0 = fv[base], b0 = fv[base + 1];
      let a1 = fv[base + 2], b1 = fv[base + 3];
      let a2 = fv[base + 4], b2 = fv[base + 5];
      for (let i = 0; i < n; i++) {
        const xs = sat(buf[i] * drive);
        let v3 = xs - b0;
        let v1 = A0 * a0 + g0 * A0 * v3;
        let v2 = b0 + g0 * A0 * a0 + g0 * g0 * A0 * v3;
        a0 = 2 * v1 - a0; b0 = 2 * v2 - b0;
        let acc = v1;
        v3 = xs - b1;
        v1 = A1 * a1 + g1 * A1 * v3;
        v2 = b1 + g1 * A1 * a1 + g1 * g1 * A1 * v3;
        a1 = 2 * v1 - a1; b1 = 2 * v2 - b1;
        acc += v1 * 0.55;
        v3 = xs - b2;
        v1 = A2 * a2 + g2 * A2 * v3;
        v2 = b2 + g2 * A2 * a2 + g2 * g2 * A2 * v3;
        a2 = 2 * v1 - a2; b2 = 2 * v2 - b2;
        acc += v1 * 0.3;                            // three band-pass taps
        buf[i] = acc * 1.4 * trim;
      }
      fv[base] = a0; fv[base + 1] = b0;
      fv[base + 2] = a1; fv[base + 3] = b1;
      fv[base + 4] = a2; fv[base + 5] = b2;
      return;
    }

    // Shared TPT state-variable core for the remaining models.
    const g = this.g, k = this.k, ic = this.ic, b = ch << 1;
    const A1c = 1 / (1 + g * (g + k)), A2c = g * A1c, A3c = g * A2c;
    const bpGain = 1 + this.res * 2;
    const doDrive = drive > 1.02;
    let ic1 = ic[b], ic2 = ic[b + 1];
    for (let i = 0; i < n; i++) {
      const xs = doDrive ? sat(buf[i] * drive) : buf[i];
      const v3 = xs - ic2;
      const v1 = A1c * ic1 + A2c * v3;
      const v2 = ic2 + A2c * ic1 + A3c * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      let out;
      if (m === F_SVFLP) out = v2;
      else if (m === F_SVFHP) out = xs - k * v1 - v2;
      else if (m === F_SVFBP) out = v1 * bpGain;
      else if (m === F_SVFNOTCH) out = xs - k * v1;
      else out = v2 - (xs - k * v1 - v2);                    // peak
      buf[i] = out * trim;
    }
    ic[b] = ic1; ic[b + 1] = ic2;
  }
}

/* ── Envelope ─────────────────────────────────────────────────────────────────
   Stage-timed rather than coefficient-timed: `pos` walks 0→1 over the stage's
   real duration and a curve is applied on the way out. Exact times matter more
   than analog authenticity here — a 4 ms pluck has to actually be 4 ms. */
const E_IDLE = 0, E_ATK = 1, E_HOLD = 2, E_DEC = 3, E_SUS = 4, E_REL = 5;

class Env {
  constructor() { this.stage = E_IDLE; this.pos = 0; this.v = 0; this.from = 0; this.rel = 0; }
  gate(on) {
    if (on) { this.stage = E_ATK; this.pos = 0; this.from = this.v; }
    else if (this.stage !== E_IDLE && this.stage !== E_REL) { this.stage = E_REL; this.pos = 0; this.rel = this.v; }
  }
  kill() { this.stage = E_IDLE; this.pos = 0; this.v = 0; }
  /** Advance by `dt` seconds; returns the new level. */
  run(a, h, d, s, r, curve, dt) {
    switch (this.stage) {
      case E_ATK:
        this.pos += a > 1e-5 ? dt / a : 1;
        if (this.pos >= 1) { this.pos = 0; this.v = 1; this.stage = h > 1e-5 ? E_HOLD : E_DEC; }
        else this.v = this.from + (1 - this.from) * curveMap(this.pos, -curve * 0.85);
        break;
      case E_HOLD:
        this.pos += dt / h;
        this.v = 1;
        if (this.pos >= 1) { this.pos = 0; this.stage = E_DEC; }
        break;
      case E_DEC:
        this.pos += d > 1e-5 ? dt / d : 1;
        if (this.pos >= 1) { this.v = s; this.stage = E_SUS; }
        else this.v = 1 - (1 - s) * curveMap(this.pos, 3 + curve * 2.5);
        break;
      case E_SUS:
        this.v = s;
        break;
      case E_REL:
        this.pos += r > 1e-5 ? dt / r : 1;
        if (this.pos >= 1) { this.v = 0; this.stage = E_IDLE; }
        else this.v = this.rel * (1 - curveMap(this.pos, 3 + curve * 2.5));
        break;
      default:
        this.v = 0;
    }
    return this.v;
  }
}

/* ── Modulation source / destination ordering ─────────────────────────────── */
const SRC_ORDER = [
  'none', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'mot1', 'mot2',
  'vel', 'keytrack', 'note', 'mw', 'bend', 'at', 'exp', 'breath', 'foot',
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8',
  'rand', 'rand2', 'unison', 'gate', 'alt',
];
const DST_ORDER = [
  'none', 'pitch', 'osc1.fine', 'osc2.fine', 'osc1.shape', 'osc2.shape',
  'osc1.pw', 'osc2.pw', 'osc1.level', 'osc2.level', 'osc1.detune', 'osc2.detune',
  'mix.fm', 'mix.ring', 'mix.sub', 'mix.noise',
  'flt1.cutoff', 'flt1.res', 'flt1.drive', 'flt2.cutoff', 'flt2.res', 'flt.blend',
  'amp', 'pan',
  'lfo1.rate', 'lfo2.rate', 'lfo3.rate', 'lfo1.depth', 'lfo2.depth', 'lfo3.depth',
  'env2.d', 'env1.r',
  'fx.drive.amount', 'fx.delay.mix', 'fx.reverb.mix', 'fx.chorus.mix',
  'fx.phaser.rate', 'fx.crush.mix',
];
/* Which sources swing through zero. The matrix's "unipolar" flag rescales
   −1…1 into 0…1, which is only meaningful for these; applying it to a source
   that is already 0…1 (a macro, an envelope, the mod wheel) would offset it by
   half its range and leave the control doing nothing at rest. */
const SRC_BIPOLAR = new Uint8Array(SRC_ORDER.length);
['lfo1', 'lfo2', 'lfo3', 'mot1', 'mot2', 'bend', 'keytrack',
 'rand', 'rand2', 'unison', 'alt'].forEach(id => { SRC_BIPOLAR[SRC_ORDER.indexOf(id)] = 1; });

const D_PITCH = 1, D_O1FINE = 2, D_O2FINE = 3, D_O1SHAPE = 4, D_O2SHAPE = 5,
      D_O1PW = 6, D_O2PW = 7, D_O1LVL = 8, D_O2LVL = 9, D_O1DET = 10, D_O2DET = 11,
      D_FM = 12, D_RING = 13, D_SUB = 14, D_NOISE = 15,
      D_F1CUT = 16, D_F1RES = 17, D_F1DRV = 18, D_F2CUT = 19, D_F2RES = 20, D_FBLEND = 21,
      D_AMP = 22, D_PAN = 23,
      D_L1RATE = 24, D_L1DEP = 27, D_E2D = 30, D_E1R = 31, D_FIRST_FX = 32;
const N_DST = DST_ORDER.length;
const N_SRC = SRC_ORDER.length;

/* LFO shapes, in params.js order. */
const LFO_SHAPES = ['sine', 'tri', 'saw', 'ramp', 'square', 'pulse', 'sh', 'smooth', 'exp', 'trap'];

/** One LFO. Phase-driven, so tempo sync is just "read the beat clock". */
class Lfo {
  constructor(seed) {
    this.ph = 0; this.val = 0; this.sm = 0; this.age = 0;
    this.rng = makeRng(seed);
    this.hold = this.rng(); this.next = this.rng();
    this.once = false; this.done = false;
  }
  retrig(phase) {
    this.ph = phase % 1; this.age = 0; this.done = false;
    this.hold = this.rng(); this.next = this.rng();
  }
  /** Advance by `inc` cycles and evaluate. */
  step(shape, inc, pw, smooth, dt) {
    this.age += dt;
    this.ph += inc;
    if (this.ph >= 1) {
      this.ph -= Math.floor(this.ph);
      this.hold = this.next;
      this.next = this.rng();
      if (this.once) this.done = true;
    } else if (this.ph < 0) {
      this.ph -= Math.floor(this.ph);
    }
    return this.eval(shape, pw, smooth, dt);
  }
  /** Evaluate at the current phase, without advancing (used by tempo sync). */
  eval(shape, pw, smooth, dt) {
    const p = this.ph;
    let v;
    switch (shape) {
      case 0: v = Math.sin(TWO_PI * p); break;
      case 1: v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
      case 2: v = 1 - 2 * p; break;
      case 3: v = 2 * p - 1; break;
      case 4: v = p < pw ? 1 : -1; break;
      case 5: v = p < pw * 0.5 ? 1 : -1; break;
      case 6: v = this.hold; break;
      case 7: { const t = p; v = this.hold + (this.next - this.hold) * (t * t * (3 - 2 * t)); break; }
      case 8: v = 2 * Math.exp(-p * 4) - 1; break;
      default: {
        const e = clamp(pw, 0.02, 0.48);
        v = p < e ? p / e : p < 0.5 ? 1 : p < 0.5 + e ? 1 - 2 * (p - 0.5) / e : -1;
        break;
      }
    }
    if (smooth > 0.001) {
      const c = 1 - Math.exp(-dt / (0.0005 + smooth * 0.25));
      this.sm += (v - this.sm) * c;
      v = this.sm;
    } else this.sm = v;
    this.val = this.done ? 0 : v;
    return this.val;
  }
  /** Tempo-locked: set phase straight from the transport. */
  setPhase(p) { this.ph = p - Math.floor(p); }
}

/* ── Voice ────────────────────────────────────────────────────────────────── */
class Voice {
  constructor(id) {
    this.id = id;
    this.active = false;
    this.note = 60; this.vel = 0.8; this.held = false; this.pedal = false;
    this.age = 0; this.startTime = 0; this.noteId = -1;
    this.uniIdx = 0;                                  // stack position in Uni Mono

    this.ph = [new Float64Array(MAX_UNI), new Float64Array(MAX_UNI)];
    this.drift = [new Float32Array(MAX_UNI), new Float32Array(MAX_UNI)];
    this.driftT = [new Float32Array(MAX_UNI), new Float32Array(MAX_UNI)];
    this.subPh = 0;
    this.rng = makeRng(0x9e37 + id * 2654435761);

    this.env = [new Env(), new Env(), new Env()];
    this.lfo = [new Lfo(id * 7919 + 13), new Lfo(id * 104729 + 7), new Lfo(id * 15485863 + 3)];
    this.f1 = new FilterSlot();
    this.f2 = new FilterSlot();

    this.md = new Float32Array(N_DST);
    this.src = new Float32Array(N_SRC);

    this.glidePitch = 60; this.targetPitch = 60;
    this.dcX = 0; this.dcY = 0; this.nzLp = 0;
    this.pink = new Float32Array(7);
    this.blueLast = 0;
    this.panL = 0; this.panR = 0;
    this.alt = 1; this.randA = 0; this.randB = 0;
    this.lastAmp = 0;
  }

  reset() {
    this.f1.reset(); this.f2.reset();
    this.dcX = this.dcY = this.nzLp = 0;
    this.pink.fill(0); this.blueLast = 0;
    this.panL = this.panR = 0;
    this.env.forEach(e => e.kill());
    this.md.fill(0);
    this.lastAmp = 0;
  }

  noteOn(note, vel, noteId, S, time, glideFrom) {
    this.note = note; this.vel = vel; this.noteId = noteId;
    this.held = true; this.pedal = false; this.active = true;
    this.startTime = time; this.age = 0;
    this.randA = this.rng(); this.randB = this.rng();
    this.alt = -this.alt;
    this.targetPitch = note;
    if (glideFrom != null && S.glide > 0.0005) this.glidePitch = glideFrom;
    else this.glidePitch = note;

    for (let o = 0; o < 2; o++) {
      const free = S.oFree[o];
      const base = S.oPhase[o];
      for (let u = 0; u < MAX_UNI; u++) {
        this.ph[o][u] = free ? (this.rng() * 0.5 + 0.5) % 1 : (base + u * 0.11) % 1;
        this.driftT[o][u] = (this.rng() * 0.5 + 0.5);
      }
    }
    this.subPh = 0;
    for (let n = 0; n < 3; n++) this.env[n].gate(true);
    for (let n = 0; n < 3; n++) {
      const mode = S.lfoMode[n];
      this.lfo[n].once = mode === 3;
      if (mode === 0 || mode === 3) this.lfo[n].retrig(S.lfoPhase[n]);
    }
    // Only clear the filters if this voice was genuinely silent; otherwise a
    // fast repeated note would click on every retrigger.
    if (this.lastAmp < 0.0015) { this.f1.reset(); this.f2.reset(); this.dcX = this.dcY = 0; }
  }

  noteOff() {
    this.held = false; this.pedal = false;
    for (let n = 0; n < 3; n++) this.env[n].gate(false);
  }

  kill() { this.active = false; this.held = false; this.pedal = false; this.reset(); }

  finished() { return this.env[0].stage === E_IDLE && this.lastAmp < 1e-4; }
}

/* ── Processor ────────────────────────────────────────────────────────────── */
class ModSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    this.ix = opt.paramIndex || {};
    this.pv = new Float32Array(opt.paramCount || 640);
    if (opt.paramValues) this.pv.set(opt.paramValues.subarray(0, this.pv.length));

    this.sr = sampleRate;
    this.bank = buildWavetables();

    this.voices = [];
    for (let v = 0; v < MAX_VOICES; v++) this.voices.push(new Voice(v));

    this.matrix = [];
    this.macros = new Float32Array(9);
    this.mw = 0; this.bend = 0; this.at = 0; this.expr = 0; this.breath = 0; this.foot = 0;
    this.sustain = false;
    this.bpm = 120;
    this.beat = 0;
    this.lastNote = null;
    this.heldNotes = [];
    this.evq = [];                    // scheduled note events, sorted by frame

    this.motion = [new Float32Array(MOTION_MAX), new Float32Array(MOTION_MAX)];
    this.motPos = [0, 0]; this.motDir = [1, 1]; this.motVal = [0, 0]; this.motPhase = [0, 0];

    // Global LFOs back the mono/free modes so every voice shares one phase.
    this.gLfo = [new Lfo(20011), new Lfo(30013), new Lfo(40009)];
    this.gsrc = new Float32Array(N_SRC);
    this.gmod = new Float32Array(N_DST);

    this.dirty = true;
    this.S = null;
    this.frame = 0;
    this.peak = 0;
    this.reportCounter = 0;

    // Scratch, reused across voices within a control block.
    this.tInc = [new Float64Array(MAX_UNI), new Float64Array(MAX_UNI)];
    this.tGL = [new Float32Array(MAX_UNI), new Float32Array(MAX_UNI)];
    this.tGR = [new Float32Array(MAX_UNI), new Float32Array(MAX_UNI)];
    this.tMip = [0, 0];
    this.tabA = [null, null];        // resolved wavetables for this block
    this.tabB = [null, null];
    this.mixF = [0, 0];
    this.isPulse = [false, false];
    this.bM = [new Float32Array(CTRL), new Float32Array(CTRL)];    // mono / left sum
    this.bR = [new Float32Array(CTRL), new Float32Array(CTRL)];    // right sum
    this.bRaw = [new Float32Array(CTRL), new Float32Array(CTRL)];  // ungained, for FM/ring
    this.syncAt = new Int32Array(CTRL + 1);
    this.mixL = new Float32Array(CTRL);
    this.mixR = new Float32Array(CTRL);
    this.mixT = new Float32Array(CTRL);   // parallel-routing copy
    this.chL = 0; this.chR = 0; this.cAcc = 1;   // crusher sample-and-hold

    this.port.onmessage = ev => this.onMessage(ev.data);
    this.port.postMessage({ t: 'ready', waves: WT_ORDER.length, maxVoices: MAX_VOICES });
  }

  onMessage(m) {
    switch (m.t) {
      case 'p': this.pv[m.i] = m.v; this.dirty = true; break;
      case 'pAll': this.pv.set(m.v.subarray(0, this.pv.length)); this.dirty = true; break;
      // `at` is an absolute frame number (host: time × sampleRate). Without it
      // an arpeggiator inherits the message queue's jitter, which at a 128
      // frame block is several milliseconds — plainly audible as sloppy timing.
      case 'on':
        if (m.at != null && m.at > this.now()) this.queue(m.at, 1, m.note, m.vel);
        else this.noteOn(m.note, m.vel, m.id);
        break;
      case 'off':
        if (m.at != null && m.at > this.now()) this.queue(m.at, 0, m.note, 0);
        else this.noteOff(m.note);
        break;
      case 'panic': this.panic(); break;
      case 'allOff': this.allNotesOff(); break;
      case 'mw': this.mw = m.v; break;
      case 'bend': this.bend = m.v; break;
      case 'at': this.at = m.v; break;
      case 'cc': this.setCC(m.n, m.v); break;
      case 'sustain': this.setSustain(!!m.v); break;
      case 'macro': this.macros[m.i] = m.v; break;
      case 'matrix': this.matrix = m.rows || []; break;
      case 'motion': this.motion[m.lane].set(m.steps.subarray(0, MOTION_MAX)); break;
      case 'tempo':
        this.bpm = m.bpm > 0 ? m.bpm : 120;
        if (m.beat != null) this.beat = m.beat;
        break;
      default: break;
    }
  }

  /** Absolute frame counter. `currentFrame` is a worklet global; the fallback
      keeps the offline test harness working. */
  now() {
    return typeof currentFrame === 'number' ? currentFrame : this.frame;
  }

  /** Queues a note event for a future frame, keeping the queue sorted. */
  queue(at, type, note, vel) {
    const q = this.evq;
    const ev = { at, type, note, vel };
    let i = q.length;
    while (i > 0 && q[i - 1].at > at) i--;
    q.splice(i, 0, ev);
    if (q.length > 512) q.shift();          // runaway guard
  }

  /** Applies every queued event due before `frameEnd`. */
  drainQueue(frameEnd) {
    const q = this.evq;
    while (q.length && q[0].at <= frameEnd) {
      const ev = q.shift();
      if (ev.type === 1) this.noteOn(ev.note, ev.vel, -1);
      else this.noteOff(ev.note);
    }
  }

  setCC(n, v) {
    if (n === 11) this.expr = v;
    else if (n === 2) this.breath = v;
    else if (n === 4) this.foot = v;
  }

  setSustain(on) {
    this.sustain = on;
    if (!on) {
      for (const v of this.voices) if (v.active && v.pedal) v.noteOff();
    }
  }

  /* ── Snapshot ────────────────────────────────────────────────────────────
     Reads the flat parameter array into named fields once per block, and only
     when something has changed. The audio path never touches the index map. */
  snapshot() {
    const p = this.pv, ix = this.ix;
    const g = id => p[ix[id]] || 0;
    const S = this.S || {};

    S.poly = Math.max(1, p[ix['voice.poly']] | 0);
    S.mode = g('voice.mode') | 0;
    S.glide = g('voice.glide');
    S.glideAuto = g('voice.glideAuto') > 0.5;
    S.bendUp = g('voice.bendUp');
    S.bendDown = g('voice.bendDown');
    S.transpose = g('voice.transpose');
    S.tune = g('voice.tune') / 100;
    S.drift = g('voice.drift');
    S.velAmt = g('voice.velAmt');
    S.velCurve = g('voice.velCurve');
    S.vspread = g('voice.spread');

    S.oOn = S.oOn || [0, 0]; S.oWave = S.oWave || [0, 0]; S.oShape = S.oShape || [0, 0];
    S.oPw = S.oPw || [0, 0]; S.oTune = S.oTune || [0, 0]; S.oLevel = S.oLevel || [0, 0];
    S.oPan = S.oPan || [0, 0]; S.oUni = S.oUni || [1, 1]; S.oDet = S.oDet || [0, 0];
    S.oWidth = S.oWidth || [0, 0]; S.oBlend = S.oBlend || [0, 0]; S.oKt = S.oKt || [1, 1];
    S.oFree = S.oFree || [1, 1]; S.oPhase = S.oPhase || [0, 0];
    for (let o = 0; o < 2; o++) {
      const q = 'osc' + (o + 1) + '.';
      S.oOn[o] = g(q + 'on') > 0.5;
      S.oWave[o] = g(q + 'wave') | 0;
      S.oShape[o] = g(q + 'shape');
      S.oPw[o] = g(q + 'pw');
      S.oTune[o] = g(q + 'oct') * 12 + g(q + 'semi') + g(q + 'fine') / 100;
      S.oLevel[o] = g(q + 'level');
      S.oPan[o] = g(q + 'pan');
      S.oUni[o] = clamp(p[ix[q + 'uni']] | 0, 1, MAX_UNI);
      S.oDet[o] = g(q + 'detune');
      S.oWidth[o] = g(q + 'width');
      S.oBlend[o] = g(q + 'blend');
      S.oKt[o] = g(q + 'keytrack');
      S.oFree[o] = g(q + 'free') > 0.5;
      S.oPhase[o] = g(q + 'phase');
    }
    S.sync = g('osc2.sync') > 0.5;
    S.fmRatio = g('osc2.ratio') > 0.5;

    S.fm = g('mix.fm');
    S.ring = g('mix.ring');
    S.sub = g('mix.sub');
    S.subWave = g('mix.subWave') | 0;
    S.subOct = g('mix.subOct');
    S.noise = g('mix.noise');
    S.noiseType = g('mix.noiseType') | 0;
    S.noiseFlt = g('mix.noiseFlt');

    S.fModel = S.fModel || [0, 0]; S.fCut = S.fCut || [0, 0]; S.fRes = S.fRes || [0, 0];
    S.fDrv = S.fDrv || [0, 0]; S.fKt = S.fKt || [0, 0]; S.fEnv = S.fEnv || [0, 0];
    S.fVel = S.fVel || [0, 0];
    for (let n = 0; n < 2; n++) {
      const q = 'flt' + (n + 1) + '.';
      S.fModel[n] = g(q + 'model') | 0;
      S.fCut[n] = g(q + 'cutoff');
      S.fRes[n] = g(q + 'res');
      S.fDrv[n] = g(q + 'drive');
      S.fKt[n] = g(q + 'keytrack');
      S.fEnv[n] = g(q + 'env');
      S.fVel[n] = g(q + 'vel');
    }
    S.route = g('flt.route') | 0;
    S.blend = g('flt.blend');

    S.env = S.env || [{}, {}, {}];
    for (let n = 0; n < 3; n++) {
      const q = 'env' + (n + 1) + '.';
      const E = S.env[n];
      E.a = g(q + 'a'); E.h = g(q + 'h'); E.d = g(q + 'd');
      E.s = g(q + 's'); E.r = g(q + 'r'); E.curve = g(q + 'curve'); E.vel = g(q + 'vel');
    }
    S.env3loop = g('env3.loop') > 0.5;

    S.lfoShape = S.lfoShape || new Int32Array(3);
    S.lfoRate = S.lfoRate || new Float32Array(3);
    S.lfoSync = S.lfoSync || new Uint8Array(3);
    S.lfoDiv = S.lfoDiv || new Float32Array(3);
    S.lfoDepth = S.lfoDepth || new Float32Array(3);
    S.lfoPhase = S.lfoPhase || new Float32Array(3);
    S.lfoDelay = S.lfoDelay || new Float32Array(3);
    S.lfoFade = S.lfoFade || new Float32Array(3);
    S.lfoSm = S.lfoSm || new Float32Array(3);
    S.lfoMode = S.lfoMode || new Int32Array(3);
    S.lfoPw = S.lfoPw || new Float32Array(3);
    for (let n = 0; n < 3; n++) {
      const q = 'lfo' + (n + 1) + '.';
      S.lfoShape[n] = g(q + 'shape') | 0;
      S.lfoRate[n] = g(q + 'rate');
      S.lfoSync[n] = g(q + 'sync') > 0.5 ? 1 : 0;
      S.lfoDiv[n] = DIV_BEATS_DSP[g(q + 'div') | 0] || 1;
      S.lfoDepth[n] = g(q + 'depth');
      S.lfoPhase[n] = g(q + 'phase');
      S.lfoDelay[n] = g(q + 'delay');
      S.lfoFade[n] = g(q + 'fade');
      S.lfoSm[n] = g(q + 'smooth');
      S.lfoMode[n] = g(q + 'mode') | 0;
      S.lfoPw[n] = g(q + 'pw');
    }

    S.mot = S.mot || [{}, {}];
    for (let n = 0; n < 2; n++) {
      const q = 'mot' + (n + 1) + '.';
      const M = S.mot[n];
      M.on = g(q + 'on') > 0.5;
      M.steps = clamp(p[ix[q + 'steps']] | 0, 1, MOTION_MAX);
      M.div = DIV_BEATS_DSP[g(q + 'div') | 0] || 1;
      M.rate = g(q + 'rate');
      M.sync = g(q + 'sync') > 0.5;
      M.slew = g(q + 'slew');
      M.mode = g(q + 'mode') | 0;
      M.depth = g(q + 'depth');
    }

    for (let m = 1; m <= 8; m++) this.macros[m] = g('macro.' + m);

    S.crushOn = g('fx.crush.on') > 0.5;
    S.crushBits = clamp(g('fx.crush.bits'), 1, 16);
    S.crushRate = clamp(g('fx.crush.rate'), 0.02, 1);
    S.crushMix = g('fx.crush.mix');

    this.S = S;
    this.dirty = false;
    return S;
  }

  /* ── Voice allocation ──────────────────────────────────────────────────── */
  freeVoice(poly) {
    const n = Math.min(poly, MAX_VOICES);
    let oldest = null, best = Infinity, released = null, rBest = Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.voices[i];
      if (!v.active) return v;
      if (!v.held && !v.pedal && v.lastAmp < rBest) { rBest = v.lastAmp; released = v; }
      if (v.startTime < best) { best = v.startTime; oldest = v; }
    }
    // Prefer stealing the quietest voice already in its release tail.
    return released || oldest || this.voices[0];
  }

  noteOn(note, vel, id) {
    const S = this.dirty || !this.S ? this.snapshot() : this.S;
    this.heldNotes = this.heldNotes.filter(n => n.note !== note);
    this.heldNotes.push({ note, vel });

    const mono = S.mode >= 1;
    const anySounding = this.voices.some(v => v.active && (v.held || v.pedal));
    // Mono/free LFOs restart at the top of a phrase, not on every key.
    if (!anySounding) {
      for (let n = 0; n < 3; n++) if (S.lfoMode[n] === 1) this.gLfo[n].retrig(S.lfoPhase[n]);
    }

    if (mono) {
      const stack = S.mode === 3 ? Math.min(S.poly, MAX_VOICES) : 1;
      const legato = S.mode === 2 && anySounding;
      const from = this.lastNote;
      for (let s = 0; s < stack; s++) {
        const v = this.voices[s];
        v.uniIdx = stack > 1 ? (s / Math.max(1, stack - 1)) * 2 - 1 : 0;
        if (legato && v.active) {
          // Legato: envelopes keep running, only the pitch moves.
          v.note = note; v.vel = vel; v.noteId = id; v.targetPitch = note; v.held = true;
          if (S.glide <= 0.0005) v.glidePitch = note;
        } else {
          v.noteOn(note, vel, id, S, this.frame, S.glideAuto && !anySounding ? null : from);
        }
      }
      for (let s = stack; s < MAX_VOICES; s++) if (this.voices[s].active) this.voices[s].noteOff();
    } else {
      // Re-use a voice already sounding this exact note so a repeated key
      // doesn't pile up stacked tails.
      let v = null;
      for (let i = 0; i < Math.min(S.poly, MAX_VOICES); i++) {
        const c = this.voices[i];
        if (c.active && c.held && c.note === note) { v = c; break; }
      }
      if (!v) v = this.freeVoice(S.poly);
      v.uniIdx = 0;
      v.noteOn(note, vel, id, S, this.frame, S.glideAuto ? null : this.lastNote);
    }
    this.lastNote = note;
  }

  noteOff(note) {
    this.heldNotes = this.heldNotes.filter(n => n.note !== note);
    const S = this.S || this.snapshot();
    const mono = S.mode >= 1;

    if (mono && this.heldNotes.length) {
      // Fall back to the most recent key still down.
      const prev = this.heldNotes[this.heldNotes.length - 1];
      const stack = S.mode === 3 ? Math.min(S.poly, MAX_VOICES) : 1;
      for (let s = 0; s < stack; s++) {
        const v = this.voices[s];
        if (!v.active) continue;
        if (S.mode === 2) { v.note = prev.note; v.targetPitch = prev.note; v.held = true; }
        else v.noteOn(prev.note, prev.vel, -1, S, this.frame, v.note);
      }
      this.lastNote = prev.note;
      return;
    }

    for (const v of this.voices) {
      if (!v.active || v.note !== note || !v.held) continue;
      if (this.sustain) { v.held = false; v.pedal = true; }
      else v.noteOff();
    }
  }

  allNotesOff() {
    this.heldNotes.length = 0;
    for (const v of this.voices) if (v.active && (v.held || v.pedal)) v.noteOff();
  }

  panic() {
    this.heldNotes.length = 0;
    this.sustain = false;
    this.evq.length = 0;
    for (const v of this.voices) v.kill();
  }

  /* ── Global per-control-block work: motion lanes and shared LFOs ────────── */
  runGlobal(S, dt) {
    for (let n = 0; n < 2; n++) {
      const M = S.mot[n];
      if (!M.on) { this.motVal[n] = 0; continue; }
      if (M.sync) {
        // Locked to the transport, so a Live session and the app agree.
        const abs = Math.floor(this.beat / M.div);
        if (M.mode === 0) this.motPos[n] = ((abs % M.steps) + M.steps) % M.steps;
        else if (M.mode === 1) {
          const span = Math.max(1, M.steps * 2 - 2);
          const q = ((abs % span) + span) % span;
          this.motPos[n] = q < M.steps ? q : span - q;
        } else if (M.mode === 2) {
          if (abs !== this.motLastStep) { this.motLastStep = abs; this.motPos[n] = (Math.random() * M.steps) | 0; }
        } else this.motPos[n] = Math.min(abs, M.steps - 1);
      } else {
        this.motPhase[n] += M.rate * dt;
        while (this.motPhase[n] >= 1) {
          this.motPhase[n] -= 1;
          const last = M.steps - 1;
          if (M.mode === 0) this.motPos[n] = (this.motPos[n] + 1) % M.steps;
          else if (M.mode === 1) {
            this.motPos[n] += this.motDir[n];
            if (this.motPos[n] >= last) { this.motPos[n] = last; this.motDir[n] = -1; }
            else if (this.motPos[n] <= 0) { this.motPos[n] = 0; this.motDir[n] = 1; }
          } else if (M.mode === 2) this.motPos[n] = (Math.random() * M.steps) | 0;
          else this.motPos[n] = Math.min(this.motPos[n] + 1, last);
        }
      }
      const target = this.motion[n][clamp(this.motPos[n], 0, MOTION_MAX - 1)] * M.depth;
      if (M.slew > 0.001) {
        const c = 1 - Math.exp(-dt / (0.0008 + M.slew * 0.4));
        this.motVal[n] += (target - this.motVal[n]) * c;
      } else this.motVal[n] = target;
    }

    for (let n = 0; n < 3; n++) {
      const mode = S.lfoMode[n];
      if (mode !== 1 && mode !== 2) continue;
      const L = this.gLfo[n];
      if (S.lfoSync[n]) {
        L.setPhase(this.beat / S.lfoDiv[n] + S.lfoPhase[n]);
        L.age += dt;
        L.eval(S.lfoShape[n], S.lfoPw[n], S.lfoSm[n], dt);
      } else {
        L.step(S.lfoShape[n], S.lfoRate[n] * dt, S.lfoPw[n], S.lfoSm[n], dt);
      }
    }

    /* Global mod row for the FX destinations. Per-voice sources can't drive a
       single shared effect, so they read as zero here. */
    const gs = this.gsrc;
    gs.fill(0);
    for (let n = 0; n < 3; n++) gs[4 + n] = this.gLfo[n].val * S.lfoDepth[n];
    gs[7] = this.motVal[0]; gs[8] = this.motVal[1];
    gs[12] = this.mw; gs[13] = this.bend; gs[14] = this.at;
    gs[15] = this.expr; gs[16] = this.breath; gs[17] = this.foot;
    for (let m = 0; m < 8; m++) gs[18 + m] = this.macros[m + 1];
    const gm = this.gmod;
    for (let d = D_FIRST_FX; d < N_DST; d++) gm[d] = 0;
    const rows = this.matrix;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const d = row.d | 0;
      if (d < D_FIRST_FX) continue;
      const s = row.s | 0;
      if (s <= 0 || !row.a) continue;
      let val = gs[s];
      if (row.u && SRC_BIPOLAR[s]) val = val * 0.5 + 0.5;
      gm[d] += val * row.a;
    }
  }

  /* ── Main render ───────────────────────────────────────────────────────── */
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0], R = out.length > 1 ? out[1] : out[0];
    const n = L.length;
    L.fill(0);
    if (R !== L) R.fill(0);

    const S = this.dirty || !this.S ? this.snapshot() : this.S;
    const dtC = CTRL / this.sr;

    let activeCount = 0;
    for (const v of this.voices) {
      if (v.active && v.finished()) v.kill();
      if (v.active) activeCount++;
    }

    const frameBase = this.now();
    for (let off = 0; off < n; off += CTRL) {
      const blk = Math.min(CTRL, n - off);
      const dt = blk / this.sr;
      if (this.evq.length) this.drainQueue(frameBase + off + blk);
      this.runGlobal(S, dt);
      for (const v of this.voices) {
        if (v.active) this.renderVoice(v, S, L, R, off, blk, dt);
      }
      this.beat += (this.bpm / 60) * dt;
    }

    /* ── Bit / sample-rate crusher ─────────────────────────────────────────
       Lives here rather than in the native FX chain because sample-and-hold
       has no Web Audio equivalent, and the summed output is exactly where a
       crusher wants to sit. */
    if (S.crushOn) {
      const mix = clamp(S.crushMix + this.gmod[N_DST - 1], 0, 1);
      const levels = Math.pow(2, S.crushBits) - 1;
      const step = 2 / levels;
      const inv = 1 / step;
      let hL = this.chL, hR = this.chR, acc = this.cAcc;
      const rate = S.crushRate;
      for (let s = 0; s < n; s++) {
        acc += rate;
        if (acc >= 1) {
          acc -= Math.floor(acc);
          hL = Math.round(L[s] * inv) * step;
          hR = Math.round(R[s] * inv) * step;
        }
        L[s] += (hL - L[s]) * mix;
        if (R !== L) R[s] += (hR - R[s]) * mix;
      }
      this.chL = hL; this.chR = hR; this.cAcc = acc;
    }

    let peak = 0;
    for (let s = 0; s < n; s++) {
      const l = L[s] < 0 ? -L[s] : L[s];
      const r = R[s] < 0 ? -R[s] : R[s];
      const a = l > r ? l : r;
      if (a > peak) peak = a;
    }
    this.peak = peak;
    this.frame += n;

    if (++this.reportCounter >= 8) {
      this.reportCounter = 0;
      this.port.postMessage({
        t: 'meter',
        voices: activeCount,
        peak: this.peak,
        gmod: Array.prototype.slice.call(this.gmod, D_FIRST_FX, N_DST),
      });
    }
    return true;
  }

  renderVoice(v, S, L, R, off, blk, dt) {
    const sr = this.sr;
    const src = v.src;
    const md = v.md;
    const e = S.env;

    const velCurved = S.velCurve === 0 ? v.vel
      : S.velCurve > 0 ? Math.pow(v.vel, 1 + S.velCurve * 2)
      : Math.pow(v.vel, 1 / (1 - S.velCurve * 2));

    /* Envelope times can themselves be modulated, so use last block's matrix
       output before advancing — a one-block lag nobody can hear. */
    const e2dMod = md[D_E2D] ? Math.pow(2, md[D_E2D] * 4) : 1;
    const e1rMod = md[D_E1R] ? Math.pow(2, md[D_E1R] * 4) : 1;

    const env1 = v.env[0].run(e[0].a, e[0].h, e[0].d, e[0].s, e[0].r * e1rMod, e[0].curve, dt);
    const env2 = v.env[1].run(e[1].a, e[1].h, e[1].d * e2dMod, e[1].s, e[1].r, e[1].curve, dt);
    const env3 = v.env[2].run(e[2].a, e[2].h, e[2].d, e[2].s, e[2].r, e[2].curve, dt);
    if (S.env3loop && (v.env[2].stage === E_SUS || v.env[2].stage === E_IDLE) && v.active) v.env[2].gate(true);

    v.age += dt;

    /* ── LFOs ─────────────────────────────────────────────────────────── */
    for (let i = 0; i < 3; i++) {
      const mode = S.lfoMode[i];
      const shared = mode === 1 || mode === 2;
      const lf = shared ? this.gLfo[i] : v.lfo[i];
      let depth = clamp(S.lfoDepth[i] + md[D_L1DEP + i], 0, 1);
      let raw;
      if (shared) {
        raw = lf.val;                                  // already advanced in runGlobal
      } else {
        const rateMod = md[D_L1RATE + i] ? Math.pow(2, md[D_L1RATE + i] * 4) : 1;
        if (S.lfoSync[i]) {
          lf.age += dt;
          lf.setPhase(lf.ph + (this.bpm / 60) * dt / S.lfoDiv[i] * rateMod);
          raw = lf.eval(S.lfoShape[i], S.lfoPw[i], S.lfoSm[i], dt);
        } else {
          raw = lf.step(S.lfoShape[i], S.lfoRate[i] * rateMod * dt, S.lfoPw[i], S.lfoSm[i], dt);
        }
      }
      // Delay, then fade in. Per-voice LFOs measure from note-on, a mono LFO
      // from the top of the phrase, and a free-running one never waits.
      const age = mode === 2 ? 1e9 : lf.age;
      let gate = 1;
      if (S.lfoDelay[i] > 0 && age < S.lfoDelay[i]) gate = 0;
      else if (S.lfoFade[i] > 0) gate = clamp((age - S.lfoDelay[i]) / S.lfoFade[i], 0, 1);
      src[4 + i] = raw * depth * gate;
    }

    src[1] = env1; src[2] = env2; src[3] = env3;
    src[7] = this.motVal[0]; src[8] = this.motVal[1];
    src[9] = velCurved;
    src[10] = (v.note - 60) / 36;
    src[11] = v.note / 127;
    src[12] = this.mw; src[13] = this.bend; src[14] = this.at;
    src[15] = this.expr; src[16] = this.breath; src[17] = this.foot;
    for (let m = 0; m < 8; m++) src[18 + m] = this.macros[m + 1];
    src[26] = v.randA; src[27] = v.randB;
    src[28] = v.uniIdx;
    src[29] = v.held ? 1 : 0;
    src[30] = v.alt;

    /* ── Matrix ───────────────────────────────────────────────────────── */
    md.fill(0);
    const rows = this.matrix;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const s = row.s | 0, d = row.d | 0;
      if (s <= 0 || d <= 0 || !row.a) continue;
      let val = src[s];
      if (row.u && SRC_BIPOLAR[s]) val = val * 0.5 + 0.5;
      md[d] += val * row.a;
    }

    /* ── Pitch ────────────────────────────────────────────────────────── */
    if (S.glide > 0.0005 && v.glidePitch !== v.targetPitch) {
      const c = 1 - Math.exp(-dt / (S.glide * 0.35 + 1e-9));
      v.glidePitch += (v.targetPitch - v.glidePitch) * c;
      if (Math.abs(v.glidePitch - v.targetPitch) < 0.0005) v.glidePitch = v.targetPitch;
    } else v.glidePitch = v.targetPitch;

    const bendSemi = this.bend >= 0 ? this.bend * S.bendUp : this.bend * S.bendDown;
    const basePitch = v.glidePitch + S.transpose + S.tune + bendSemi + md[D_PITCH] * 24
      + (S.mode === 3 ? v.uniIdx * S.vspread * 0.5 : 0);

    /* ── Oscillator setup (control rate) ──────────────────────────────── */
    const bank = this.bank;
    const inc = this.tInc, ugL = this.tGL, ugR = this.tGR, mipOf = this.tMip;

    const lvl0 = clamp(S.oLevel[0] + md[D_O1LVL], 0, 2) * (S.oOn[0] ? 1 : 0);
    const lvl1 = clamp(S.oLevel[1] + md[D_O2LVL], 0, 2) * (S.oOn[1] ? 1 : 0);
    const shape0 = clamp(S.oShape[0] + md[D_O1SHAPE], 0, 1);
    const shape1 = clamp(S.oShape[1] + md[D_O2SHAPE], 0, 1);
    const pw0 = clamp(S.oPw[0] + md[D_O1PW], 0.02, 0.98);
    const pw1 = clamp(S.oPw[1] + md[D_O2PW], 0.02, 0.98);
    const uni0 = S.oUni[0], uni1 = S.oUni[1];

    const fmAmt = clamp(S.fm + md[D_FM], 0, 1);
    const fmDepth = fmAmt * fmAmt * 2.5;
    const ringAmt = clamp(S.ring + md[D_RING], 0, 1);
    const subAmt = clamp(S.sub + md[D_SUB], 0, 1);
    const noiseAmt = clamp(S.noise + md[D_NOISE], 0, 1);

    const needO2 = S.oOn[1] || fmDepth > 0.0001 || ringAmt > 0.0001;
    const needO1 = S.oOn[0] || ringAmt > 0.0001;

    for (let o = 0; o < 2; o++) {
      if (o === 0 ? !needO1 : !needO2) continue;
      const kt = S.oKt[o];
      const tuneOff = S.oTune[o] + (o === 0 ? md[D_O1FINE] : md[D_O2FINE]) * 12;
      let f;
      if (o === 1 && S.fmRatio) {
        // Ratio mode: osc 2 is a multiple of osc 1, so an FM patch keeps its
        // timbre all the way up the keyboard.
        const r = Math.max(0.25, Math.round(Math.pow(2, S.oTune[1] / 12) * 4) / 4);
        f = 440 * Math.pow(2, (basePitch - 69) / 12) * r;
      } else {
        const tracked = 60 + (basePitch - 60) * kt;
        f = 440 * Math.pow(2, (tracked + tuneOff - 69) / 12);
      }
      f = clamp(f, 0.02, sr * 0.49);

      const n = o === 0 ? uni0 : uni1;
      const det = clamp(S.oDet[o] + (o === 0 ? md[D_O1DET] : md[D_O2DET]) * 100, 0, 200);
      const width = S.oWidth[o];
      const blendU = S.oBlend[o];
      const opan = S.oPan[o];
      // A stack of n should sit at roughly one oscillator's loudness.
      const comp = 1 / Math.sqrt(n * 0.55 + 0.45);

      // Detune as a geometric series: one pow for the span, one for the step.
      const lo = n === 1 ? 1 : Math.pow(2, -det / 1200);
      const stepMul = n === 1 ? 1 : Math.pow(2, (2 * det / 1200) / (n - 1));
      let fu = f * lo;
      const centre = (n - 1) >> 1;
      for (let u = 0; u < n; u++) {
        let fd = fu;
        if (S.drift > 0.0001) {
          v.driftT[o][u] -= dt * (0.35 + u * 0.07);
          if (v.driftT[o][u] <= 0) { v.driftT[o][u] += 1; v.drift[o][u] = v.rng(); }
          fd *= 1 + v.drift[o][u] * S.drift * 0.004;    // ≈ ±7 cents at full
        }
        inc[o][u] = fd / sr;
        const lvlU = n === 1 ? 1 : (u === centre && (n & 1) ? 1 : blendU);
        const spr = n === 1 ? 0 : (u / (n - 1)) * 2 - 1;
        const pan = clamp(opan + spr * width, -1, 1);
        ugL[o][u] = Math.sqrt((1 - pan) * 0.5) * lvlU * comp;
        ugR[o][u] = Math.sqrt((1 + pan) * 0.5) * lvlU * comp;
        fu *= stepMul;
      }
      // One mip for the whole stack, chosen from the highest detuned line so
      // nothing in the stack can alias.
      const top = f * Math.pow(2, det / 1200) * (1 + S.drift * 0.005);
      mipOf[o] = clamp(Math.ceil(Math.log2(Math.max(1e-9, TABLE_SIZE * top / sr))), 0, NUM_MIPS - 1);
    }

    /* Resolve the actual Float32Arrays now, once. Doing `bank[w][frame][mip]`
       inside the sample loop was costing more than the interpolation itself. */
    const tabA = this.tabA, tabB = this.tabB, mixF = this.mixF, isPulse = this.isPulse;
    for (let o = 0; o < 2; o++) {
      const m = (o === 0 ? shape0 : shape1) * (FRAMES - 1);
      let fa = m | 0;
      if (fa >= FRAMES - 1) fa = FRAMES - 1;
      const fb = fa + 1 < FRAMES ? fa + 1 : fa;
      let mx = m - fa;
      if (mx < 0.0008) mx = 0; else if (mx > 0.9992) { fa = fb; mx = 0; }
      isPulse[o] = S.oWave[o] === 1;
      // PWM reads the pure saw twice rather than morphing fixed duty cycles.
      const set = isPulse[o] ? bank[0] : bank[S.oWave[o]];
      const frA = isPulse[o] ? 2 : fa;
      tabA[o] = set[frA][mipOf[o]];
      tabB[o] = isPulse[o] ? tabA[o] : set[fb][mipOf[o]];
      mixF[o] = isPulse[o] ? 0 : mx;
    }

    /* ── Filters ──────────────────────────────────────────────────────── */
    const kt1 = S.fKt[0] * (v.note - 60) / 12;
    const cut1 = clamp(
      S.fCut[0] * Math.pow(2, md[D_F1CUT] * 8 + S.fEnv[0] * env2 * 7 + kt1 + S.fVel[0] * velCurved * 4),
      12, sr * 0.47
    );
    v.f1.set(S.fModel[0], cut1, clamp(S.fRes[0] + md[D_F1RES], 0, 0.995),
             clamp(S.fDrv[0] + md[D_F1DRV], 0, 1), sr);

    const usesF2 = S.fModel[1] !== F_BYPASS;
    if (usesF2) {
      const kt2 = S.fKt[1] * (v.note - 60) / 12;
      const cut2 = clamp(
        S.fCut[1] * Math.pow(2, md[D_F2CUT] * 8 + S.fEnv[1] * env2 * 7 + kt2 + S.fVel[1] * velCurved * 4),
        12, sr * 0.47
      );
      v.f2.set(S.fModel[1], cut2, clamp(S.fRes[1] + md[D_F2RES], 0, 0.995), S.fDrv[1], sr);
    }
    const fblend = clamp(S.blend + md[D_FBLEND], 0, 1);
    const route = usesF2 ? S.route : 0;

    /* ── Amp & pan, interpolated across the block ─────────────────────── */
    const velGain = 1 - S.velAmt + S.velAmt * velCurved;
    // OUT_TRIM leaves room for a wide chord to sum without slamming the FX
    // rack; a single note lands around −16 dBFS, which is normal headroom.
    let amp = env1 * velGain * (1 + md[D_AMP]) * OUT_TRIM;
    if (amp < 0) amp = 0;
    if (S.mode === 3) amp *= 1 / Math.sqrt(Math.max(1, Math.min(S.poly, MAX_VOICES)));
    const panPos = clamp(
      md[D_PAN] + (S.vspread && S.mode !== 3 ? ((v.note % 12) / 11 - 0.5) * 2 * S.vspread : 0),
      -1, 1
    );
    const tgtL = Math.sqrt((1 - panPos) * 0.5) * amp;
    const tgtR = Math.sqrt((1 + panPos) * 0.5) * amp;
    const dL = (tgtL - v.panL) / blk, dR = (tgtR - v.panR) / blk;
    let curL = v.panL, curR = v.panR;

    const subInc = 440 * Math.pow(2, (basePitch + S.subOct * 12 - 69) / 12) / sr;
    const noiseCut = 0.015 + S.noiseFlt * 0.985;
    const noiseOpen = S.noiseFlt > 0.985;

    /* ── Oscillator rendering ─────────────────────────────────────────────
       Per unison line over the whole block, rather than per sample across all
       lines. Phase, increment, gains and the table all stay in registers for
       the length of the inner loop, which is worth several times the cost of
       the interpolation it wraps. */
    const bM = this.bM, bR = this.bR, bRaw = this.bRaw;
    // A mono signal only needs one filter chain and one accumulator. Split
    // routing is the one case that makes a mono source genuinely stereo.
    const stereoField =
      (uni0 > 1 && S.oWidth[0] > 0.001) || (uni1 > 1 && S.oWidth[1] > 0.001) ||
      S.oPan[0] < -0.001 || S.oPan[0] > 0.001 || S.oPan[1] < -0.001 || S.oPan[1] > 0.001;
    const stereo = stereoField || route === 2;

    for (let o = 0; o < 2; o++) {
      bM[o].fill(0, 0, blk);
      bRaw[o].fill(0, 0, blk);
      if (stereo) bR[o].fill(0, 0, blk);
    }

    /* Hard sync resets osc 2 wherever osc 1 wraps. Osc 1's phase accumulator
       doesn't depend on osc 2 — FM shifts the read position, not the phase —
       so the wrap points can be computed up front and osc 2 still rendered
       first for FM. Both features stay live at once. */
    let syncCount = 0;
    if (S.sync && needO1 && needO2) {
      const syncAt = this.syncAt;
      let p = v.ph[0][0];
      const d = inc[0][0];
      for (let i = 0; i < blk; i++) {
        p += d;
        if (p >= 1) { p -= 1; syncAt[syncCount++] = i; }
      }
    }

    // Osc 2 first: it is the modulator for FM and the partner for ring mod.
    const syncAt = this.syncAt;
    for (let oi = 0; oi < 2; oi++) {
      const o = oi === 0 ? 1 : 0;
      if (o === 0 ? !needO1 : !needO2) continue;
      const n = o === 0 ? uni0 : uni1;
      const phArr = v.ph[o], incArr = inc[o], glArr = ugL[o], grArr = ugR[o];
      const tA = tabA[o], tB = tabB[o], fmix = mixF[o];
      const len = tA.length - 1;
      const pulse = isPulse[o], pw = o === 0 ? pw0 : pw1;
      const lvl = o === 0 ? lvl0 : lvl1;
      const mAcc = bM[o], rAcc = bRaw[o], rgtAcc = bR[o];
      const pmBuf = bRaw[1];
      const pmAmt = o === 0 ? fmDepth / (uni1 || 1) : 0;
      const doSync = o === 1 && syncCount > 0;

      for (let u = 0; u < n; u++) {
        let ph = phArr[u];
        const dph = incArr[u];
        const gl = glArr[u] * lvl, gr = grArr[u] * lvl;
        let sIdx = 0;
        for (let i = 0; i < blk; i++) {
          ph += dph;
          if (ph >= 1) ph -= 1;
          if (doSync && sIdx < syncCount && i === syncAt[sIdx]) { ph = 0; sIdx++; }

          let s;
          if (pulse) {
            // The difference of two band-limited saws is a band-limited pulse
            // at any width — genuine PWM with no extra tables.
            let a = ph * len;
            const i0 = a | 0, fA = a - i0;
            const s1 = tA[i0] + (tA[i0 + 1] - tA[i0]) * fA;
            let p2 = ph + pw;
            if (p2 >= 1) p2 -= 1;
            a = p2 * len;
            const i1 = a | 0, fB = a - i1;
            s = (s1 - (tA[i1] + (tA[i1 + 1] - tA[i1]) * fB)) * 0.62;
          } else {
            let rp = ph;
            if (pmAmt !== 0) {
              rp += pmAmt * pmBuf[i];
              rp -= rp | 0;
              if (rp < 0) rp += 1;
            }
            const a = rp * len;
            const i0 = a | 0, f = a - i0;
            const vA = tA[i0] + (tA[i0 + 1] - tA[i0]) * f;
            s = fmix === 0 ? vA : vA + (tB[i0] + (tB[i0 + 1] - tB[i0]) * f - vA) * fmix;
          }

          rAcc[i] += s;
          mAcc[i] += s * gl;
          if (stereo) rgtAcc[i] += s * gr;
        }
        phArr[u] = ph;
      }
    }

    /* ── Mix, DC block, filter, amp ─────────────────────────────────────
       The mix is assembled into a scratch buffer so the filters can run over
       a whole block with their state in registers. */
    const m0 = bM[0], m1 = bM[1], r0 = bR[0], r1 = bR[1];
    const raw0 = bRaw[0], raw1 = bRaw[1];
    const ringScale = ringAmt * 1.6 / ((uni0 || 1) * (uni1 || 1));
    const f1 = v.f1, f2 = v.f2;
    const mixL = this.mixL, mixR = this.mixR;

    for (let i = 0; i < blk; i++) {
      let sL = m0[i] + m1[i];
      let sR = stereo ? r0[i] + r1[i] : 0;

      if (ringAmt > 0.0001) {
        const rm = raw0[i] * raw1[i] * ringScale;
        sL += rm; if (stereo) sR += rm;
      }

      if (subAmt > 0.0001) {
        v.subPh += subInc;
        if (v.subPh >= 1) v.subPh -= 1;
        const p = v.subPh;
        let sv;
        if (S.subWave === 0) sv = Math.sin(TWO_PI * p);
        else if (S.subWave === 1) sv = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        else if (S.subWave === 2) sv = p < 0.5 ? 1 : -1;
        else sv = 2 * p - 1;
        const sg = sv * subAmt;
        sL += sg; if (stereo) sR += sg;
      }

      if (noiseAmt > 0.0001) {
        let nz = v.rng();
        if (S.noiseType === 1) {
          // Paul Kellet's pink filter — cheap and close enough to −3 dB/oct.
          const p = v.pink;
          p[0] = 0.99886 * p[0] + nz * 0.0555179;
          p[1] = 0.99332 * p[1] + nz * 0.0750759;
          p[2] = 0.96900 * p[2] + nz * 0.1538520;
          p[3] = 0.86650 * p[3] + nz * 0.3104856;
          p[4] = 0.55000 * p[4] + nz * 0.5329522;
          p[5] = -0.7616 * p[5] - nz * 0.0168980;
          const o = (p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + nz * 0.5362) * 0.18;
          p[6] = nz * 0.115926;
          nz = o;
        } else if (S.noiseType === 2) {
          const d = nz - v.blueLast; v.blueLast = nz; nz = d * 0.7;
        } else if (S.noiseType === 3) {
          nz = nz > 0.985 || nz < -0.985 ? nz * 6 : 0;
        }
        v.nzLp += (nz - v.nzLp) * noiseCut;
        const ng = (noiseOpen ? nz : v.nzLp) * noiseAmt * 0.6;
        sL += ng; if (stereo) sR += ng;
      }

      /* DC blocker — PWM, folding and asymmetric drive all produce offset, and
         a DC-shifted signal eats filter headroom for nothing. */
      const mid = stereo ? (sL + sR) * 0.5 : sL;
      const hp = mid - v.dcX + 0.9985 * v.dcY;
      v.dcX = mid; v.dcY = hp;
      const corr = hp - mid;
      mixL[i] = sL + corr;
      if (stereo) mixR[i] = sR + corr;
    }

    /* ── Filter block ─────────────────────────────────────────────────── */
    if (route === 1) {                                   // parallel
      const tmp = this.mixT;
      tmp.set(mixL.subarray(0, blk));
      f1.processBlock(mixL, blk, 0);
      f2.processBlock(tmp, blk, 0);
      for (let i = 0; i < blk; i++) mixL[i] = mixL[i] * (1 - fblend) + tmp[i] * fblend;
      if (stereo) {
        tmp.set(mixR.subarray(0, blk));
        f1.processBlock(mixR, blk, 1);
        f2.processBlock(tmp, blk, 1);
        for (let i = 0; i < blk; i++) mixR[i] = mixR[i] * (1 - fblend) + tmp[i] * fblend;
      }
    } else if (route === 2) {                            // split: L → 1, R → 2
      f1.processBlock(mixL, blk, 0);
      f2.processBlock(mixR, blk, 1);
    } else {                                             // serial
      f1.processBlock(mixL, blk, 0);
      if (usesF2) f2.processBlock(mixL, blk, 0);
      if (stereo) {
        f1.processBlock(mixR, blk, 1);
        if (usesF2) f2.processBlock(mixR, blk, 1);
      }
    }

    /* ── Amp ramp and output ──────────────────────────────────────────── */
    if (stereo) {
      for (let i = 0; i < blk; i++) {
        curL += dL; curR += dR;
        L[off + i] += mixL[i] * curL;
        R[off + i] += mixR[i] * curR;
      }
    } else {
      for (let i = 0; i < blk; i++) {
        curL += dL; curR += dR;
        const s = mixL[i];
        L[off + i] += s * curL;
        R[off + i] += s * curR;
      }
    }

    v.panL = tgtL; v.panR = tgtR;
    v.lastAmp = amp;
  }
}

registerProcessor('modsynth', ModSynthProcessor);
