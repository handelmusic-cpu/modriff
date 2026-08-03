/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — FX rack
   ───────────────────────────────────────────────────────────────────────────
   Everything after the voices, built from native Web Audio nodes so it costs
   almost nothing on the audio thread compared with running it in JS.

     in → drive → chorus → phaser → EQ → delay → reverb → comp → width →
          master → limiter → out

   Distortion first, modulation next, time-based effects after that and
   dynamics last is the order that keeps a resonant filter sweep from turning
   the delay tails into a mess. Bit crushing happens upstream inside the synth
   worklet (see js/dsp.js) because sample-and-hold has no native node.

   Every setter is idempotent and safe to call at UI rate; parameter changes
   ramp over RAMP seconds so a knob sweep never clicks.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const RAMP = 0.02;

  function ramp(param, v, ctx, t) {
    if (!Number.isFinite(v)) return;
    const now = ctx.currentTime;
    try {
      param.setTargetAtTime(v, now, (t || RAMP) * 0.4);
    } catch (e) {
      param.value = v;
    }
  }

  /* Waveshaper curves. Each returns a Float32Array mapping −1…1 → −1…1. */
  function makeCurve(type, amount) {
    const n = 2048;
    const c = new Float32Array(n);
    const k = 0.05 + amount * amount * 40;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      let y;
      switch (type) {
        case 'soft':
          y = Math.tanh(x * (1 + k * 0.4));
          break;
        case 'tape':
          // Gentle odd-order compression with a soft knee.
          y = Math.tanh(x * (1 + k * 0.25)) * 0.92 + x * 0.08;
          break;
        case 'tube': {
          // Asymmetric: more even harmonics on the positive half.
          const g = 1 + k * 0.5;
          y = x >= 0 ? Math.tanh(x * g) : Math.tanh(x * g * 0.7) * 0.85;
          break;
        }
        case 'diode': {
          const g = 1 + k;
          y = x >= 0 ? 1 - Math.exp(-x * g) : -(1 - Math.exp(x * g * 0.55)) * 0.8;
          break;
        }
        case 'fold': {
          let v = x * (1 + k * 0.35);
          for (let j = 0; j < 6; j++) {
            if (v > 1) v = 2 - v; else if (v < -1) v = -2 - v; else break;
          }
          y = v;
          break;
        }
        default: {                              // hard
          const g = 1 + k;
          y = Math.max(-1, Math.min(1, x * g));
          break;
        }
      }
      c[i] = y;
    }
    return c;
  }

  /** Generates a reverb impulse response. Rebuilt only when size/decay/damping
      actually change, and debounced, because it is by far the most expensive
      thing in the rack. */
  function makeImpulse(ctx, seconds, decay, damp, width) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(2, len, sr);
    // Damping is a running lowpass over the noise tail; without it a
    // generated IR sounds like a burst of hiss rather than a room.
    const cut = Math.exp(-Math.PI * 2 * (200 + (1 - damp) * 9000) / sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let z = 0;
      let seed = ch ? 0x1f2e3d : 0x9e3779b1;
      for (let i = 0; i < len; i++) {
        seed ^= seed << 13; seed |= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5; seed |= 0;
        const white = seed / 2147483648;
        z = white * (1 - cut) + z * cut;
        // Exponential decay with a short build-up so the onset isn't a click.
        const t = i / len;
        const env = Math.pow(1 - t, decay) * Math.min(1, i / (sr * 0.004));
        d[i] = z * env;
      }
    }
    if (width < 1) {
      const a = buf.getChannelData(0), b = buf.getChannelData(1);
      for (let i = 0; i < len; i++) {
        const mid = (a[i] + b[i]) * 0.5, side = (a[i] - b[i]) * 0.5 * width;
        a[i] = mid + side; b[i] = mid - side;
      }
    }
    return buf;
  }

  class FxRack {
    constructor(ctx) {
      this.ctx = ctx;
      this.p = Object.create(null);        // last applied raw values
      this.mod = Object.create(null);      // live modulation offsets from the matrix
      this._irKey = '';
      this._irTimer = null;

      const g = () => ctx.createGain();
      this.input = g();
      this.output = g();

      /* ── Drive ── */
      this.driveIn = g();
      this.shaper = ctx.createWaveShaper();
      this.shaper.oversample = '4x';
      this.driveTone = ctx.createBiquadFilter();
      this.driveTone.type = 'lowpass';
      this.driveTone.frequency.value = 12000;
      this.driveWet = g(); this.driveDry = g(); this.driveOut = g();
      this.input.connect(this.driveIn);
      this.driveIn.connect(this.shaper);
      this.shaper.connect(this.driveTone);
      this.driveTone.connect(this.driveWet);
      this.driveIn.connect(this.driveDry);
      this.driveWet.connect(this.driveOut);
      this.driveDry.connect(this.driveOut);

      /* ── Chorus / ensemble ── */
      this.chorusIn = this.driveOut;
      this.chorusWet = g(); this.chorusOut = g();
      this.chorusIn.connect(this.chorusOut);          // dry
      this.chorusVoices = [];
      for (let i = 0; i < 4; i++) {
        const d = ctx.createDelay(0.08);
        d.delayTime.value = 0.012 + i * 0.006;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.6 * (1 + i * 0.13);
        const amt = g();
        amt.gain.value = 0.002;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) pan.pan.value = i % 2 ? 0.8 : -0.8;
        const lvl = g();
        lvl.gain.value = 0;
        lfo.connect(amt); amt.connect(d.delayTime);
        this.chorusIn.connect(d);
        d.connect(lvl);
        if (pan) { lvl.connect(pan); pan.connect(this.chorusWet); }
        else lvl.connect(this.chorusWet);
        lfo.start();
        this.chorusVoices.push({ d, lfo, amt, lvl, pan, base: 0.012 + i * 0.006 });
      }
      this.chorusWet.connect(this.chorusOut);

      /* ── Phaser ── */
      this.phaserIn = this.chorusOut;
      this.phaserStages = [];
      this.phaserFb = g();
      this.phaserWet = g();
      this.phaserOut = g();
      this.phaserIn.connect(this.phaserOut);          // dry
      let node = this.phaserIn;
      const phaserHead = g();
      this.phaserIn.connect(phaserHead);
      this.phaserFb.connect(phaserHead);
      node = phaserHead;
      this.phaserLfo = ctx.createOscillator();
      this.phaserLfo.type = 'sine';
      this.phaserLfo.frequency.value = 0.3;
      this.phaserDepth = g();
      this.phaserDepth.gain.value = 800;
      this.phaserLfo.connect(this.phaserDepth);
      for (let i = 0; i < 12; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 400 * Math.pow(1.35, i);
        ap.Q.value = 0.6;
        this.phaserDepth.connect(ap.frequency);
        node.connect(ap);
        node = ap;
        this.phaserStages.push(ap);
      }
      this.phaserTail = node;
      this.phaserTail.connect(this.phaserWet);
      this.phaserTail.connect(this.phaserFb);
      this.phaserWet.connect(this.phaserOut);
      this.phaserLfo.start();

      /* ── EQ ── */
      this.eqLow = ctx.createBiquadFilter(); this.eqLow.type = 'lowshelf';
      this.eqMid = ctx.createBiquadFilter(); this.eqMid.type = 'peaking';
      this.eqHigh = ctx.createBiquadFilter(); this.eqHigh.type = 'highshelf';
      this.phaserOut.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);

      /* ── Delay (stereo, optional ping-pong) ── */
      this.delayIn = g();
      this.eqHigh.connect(this.delayIn);
      this.delayOut = g();
      this.eqHigh.connect(this.delayOut);             // dry
      this.dL = ctx.createDelay(4); this.dR = ctx.createDelay(4);
      this.fbL = g(); this.fbR = g();
      this.xL = g(); this.xR = g();                   // cross-feed for ping-pong
      this.dTone = ctx.createBiquadFilter();
      this.dTone.type = 'lowpass';
      this.dTone.frequency.value = 4000;
      this.dToneR = ctx.createBiquadFilter();
      this.dToneR.type = 'lowpass';
      this.dToneR.frequency.value = 4000;
      this.delayWet = g();
      const splitD = ctx.createChannelSplitter(2);
      const mergeD = ctx.createChannelMerger(2);
      this.delayIn.connect(splitD);
      splitD.connect(this.dL, 0);
      splitD.connect(this.dR, 1);
      this.dL.connect(this.dTone); this.dTone.connect(this.fbL);
      this.dR.connect(this.dToneR); this.dToneR.connect(this.fbR);
      this.fbL.connect(this.dL); this.fbR.connect(this.dR);      // straight feedback
      this.fbL.connect(this.xR); this.xR.connect(this.dR);        // ping-pong cross
      this.fbR.connect(this.xL); this.xL.connect(this.dL);
      this.dTone.connect(mergeD, 0, 0);
      this.dToneR.connect(mergeD, 0, 1);
      mergeD.connect(this.delayWet);
      this.delayWet.connect(this.delayOut);

      /* ── Reverb ── */
      this.revPre = ctx.createDelay(0.5);
      this.conv = ctx.createConvolver();
      this.conv.normalize = true;
      this.revWet = g();
      this.reverbOut = g();
      this.delayOut.connect(this.reverbOut);          // dry
      this.delayOut.connect(this.revPre);
      this.revPre.connect(this.conv);
      this.conv.connect(this.revWet);
      this.revWet.connect(this.reverbOut);

      /* ── Compressor ── */
      this.compIn = g();
      this.comp = ctx.createDynamicsCompressor();
      this.makeup = g();
      this.compOut = g();
      this.reverbOut.connect(this.compIn);
      this.compIn.connect(this.comp);
      this.comp.connect(this.makeup);
      this.makeup.connect(this.compOut);
      this.compBypass = g();
      this.compBypass.gain.value = 0;
      this.reverbOut.connect(this.compBypass);
      this.compBypass.connect(this.compOut);

      /* ── Stereo width (mid/side) ── */
      const sp = ctx.createChannelSplitter(2);
      const mg = ctx.createChannelMerger(2);
      this.compOut.connect(sp);
      const midA = g(), midB = g(), sideA = g(), sideB = g();
      midA.gain.value = 0.5; midB.gain.value = 0.5;
      sideA.gain.value = 0.5; sideB.gain.value = -0.5;
      sp.connect(midA, 0); sp.connect(midB, 1);
      sp.connect(sideA, 0); sp.connect(sideB, 1);
      const mid = g(), side = g();
      midA.connect(mid); midB.connect(mid);
      sideA.connect(side); sideB.connect(side);
      this.widthPos = g(); this.widthNeg = g();
      this.widthPos.gain.value = 1; this.widthNeg.gain.value = -1;
      side.connect(this.widthPos); side.connect(this.widthNeg);
      mid.connect(mg, 0, 0); mid.connect(mg, 0, 1);
      this.widthPos.connect(mg, 0, 0);
      this.widthNeg.connect(mg, 0, 1);

      /* ── Master ── */
      this.master = g();
      mg.connect(this.master);
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.08;
      this.limBypass = g();
      this.master.connect(this.limiter);
      this.limiter.connect(this.output);
      this.master.connect(this.limBypass);
      this.limBypass.connect(this.output);
      this.limBypass.gain.value = 0;

      /* Analyser tap for the scope and spectrum display. */
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.7;
      this.output.connect(this.analyser);

      this.bpm = 120;
    }

    connect(dest) { this.output.connect(dest); return this; }

    setTempo(bpm) {
      this.bpm = bpm > 0 ? bpm : 120;
      if (this.p['fx.delay.sync']) this._applyDelayTime();
    }

    /** Live modulation offsets from the mod matrix, keyed by parameter id. */
    setMod(id, v) {
      if (this.mod[id] === v) return;
      this.mod[id] = v;
      this.set(id, this.p[id], true);
    }

    _val(id) {
      const base = this.p[id];
      const m = this.mod[id] || 0;
      if (!m) return base;
      const p = MS.PARAM[id];
      if (!p || p.type === 'enum' || p.type === 'bool') return base;
      return MS.clamp(base + m * (p.max - p.min), p.min, p.max);
    }

    /** Applies a parameter. Unknown ids are ignored so patches from a newer
        build load into an older one without throwing. */
    set(id, value, fromMod) {
      if (value === undefined) return;
      if (!fromMod) this.p[id] = value;
      const ctx = this.ctx;
      const v = this._val(id);
      const on = k => !!this.p[k];

      switch (id) {
        /* Drive */
        case 'fx.drive.on':
        case 'fx.drive.type':
        case 'fx.drive.amount': {
          const active = on('fx.drive.on');
          const amt = this._val('fx.drive.amount') || 0;
          this.shaper.curve = makeCurve(this.p['fx.drive.type'] || 'tube', active ? amt : 0);
          // Gain compensation, or a drive sweep doubles as a volume sweep.
          ramp(this.driveIn.gain, 1, ctx);
          ramp(this.driveWet.gain, active ? this._val('fx.drive.mix') / (1 + amt * 1.4) : 0, ctx);
          ramp(this.driveDry.gain, active ? 1 - this._val('fx.drive.mix') : 1, ctx);
          break;
        }
        case 'fx.drive.tone':
          ramp(this.driveTone.frequency, 300 * Math.pow(60, v), ctx);
          break;
        case 'fx.drive.mix':
          this.set('fx.drive.on', this.p['fx.drive.on'], true);
          break;

        /* Chorus */
        case 'fx.chorus.on':
        case 'fx.chorus.voices':
        case 'fx.chorus.mix': {
          const active = on('fx.chorus.on');
          const nv = Math.max(1, Math.min(4, this.p['fx.chorus.voices'] | 0 || 2));
          const mix = active ? this._val('fx.chorus.mix') : 0;
          this.chorusVoices.forEach((cv, i) => ramp(cv.lvl.gain, i < nv ? mix / Math.sqrt(nv) : 0, ctx));
          ramp(this.chorusIn.gain, 1, ctx);
          break;
        }
        case 'fx.chorus.rate':
          this.chorusVoices.forEach((cv, i) => ramp(cv.lfo.frequency, v * (1 + i * 0.13), ctx));
          break;
        case 'fx.chorus.depth':
          this.chorusVoices.forEach(cv => ramp(cv.amt.gain, v * 0.006, ctx));
          break;
        case 'fx.chorus.spread':
          this.chorusVoices.forEach((cv, i) => {
            if (cv.pan) ramp(cv.pan.pan, (i % 2 ? 1 : -1) * v, ctx);
            ramp(cv.d.delayTime, cv.base * (0.5 + v), ctx);
          });
          break;

        /* Phaser */
        case 'fx.phaser.on':
        case 'fx.phaser.mix': {
          const active = on('fx.phaser.on');
          const mix = active ? this._val('fx.phaser.mix') : 0;
          ramp(this.phaserWet.gain, mix, ctx);
          ramp(this.phaserOut.gain, 1, ctx);
          ramp(this.phaserIn.gain, 1, ctx);
          break;
        }
        case 'fx.phaser.rate':
          ramp(this.phaserLfo.frequency, MS.clamp(v, 0.01, 20), ctx);
          break;
        case 'fx.phaser.depth':
          ramp(this.phaserDepth.gain, v * 2200, ctx);
          break;
        case 'fx.phaser.fb':
          ramp(this.phaserFb.gain, on('fx.phaser.on') ? v * 0.85 : 0, ctx);
          break;
        case 'fx.phaser.stages': {
          // Stages beyond the count are flattened rather than disconnected, so
          // the graph never has to be rebuilt mid-note.
          const n = Math.max(2, Math.min(12, v | 0));
          this.phaserStages.forEach((ap, i) => ramp(ap.Q, i < n ? 0.7 : 0.0001, ctx));
          break;
        }

        /* Delay */
        case 'fx.delay.on':
        case 'fx.delay.mix': {
          const active = on('fx.delay.on');
          ramp(this.delayWet.gain, active ? this._val('fx.delay.mix') : 0, ctx);
          ramp(this.delayIn.gain, active ? 1 : 0, ctx);
          break;
        }
        case 'fx.delay.sync':
        case 'fx.delay.div':
        case 'fx.delay.time':
          this._applyDelayTime();
          break;
        case 'fx.delay.fb':
        case 'fx.delay.pong': {
          const fb = MS.clamp(this._val('fx.delay.fb'), 0, 0.95);
          const pong = MS.clamp(this._val('fx.delay.pong'), 0, 1);
          // Straight and crossed feedback are complementary, so total loop
          // gain stays at `fb` however far the ping-pong control is pushed.
          ramp(this.fbL.gain, fb * (1 - pong), ctx);
          ramp(this.fbR.gain, fb * (1 - pong), ctx);
          ramp(this.xL.gain, fb * pong, ctx);
          ramp(this.xR.gain, fb * pong, ctx);
          break;
        }
        case 'fx.delay.tone': {
          const hz = 400 * Math.pow(40, v);
          ramp(this.dTone.frequency, hz, ctx);
          ramp(this.dToneR.frequency, hz, ctx);
          break;
        }

        /* Reverb */
        case 'fx.reverb.on':
        case 'fx.reverb.mix':
          ramp(this.revWet.gain, on('fx.reverb.on') ? this._val('fx.reverb.mix') * 1.4 : 0, ctx);
          break;
        case 'fx.reverb.pre':
          ramp(this.revPre.delayTime, MS.clamp(v, 0, 0.25), ctx);
          break;
        case 'fx.reverb.size':
        case 'fx.reverb.decay':
        case 'fx.reverb.damp':
        case 'fx.reverb.width':
          this._scheduleIR();
          break;

        /* Compressor */
        case 'fx.comp.on':
          ramp(this.compIn.gain, v ? 1 : 0, ctx);
          ramp(this.compBypass.gain, v ? 0 : 1, ctx);
          break;
        case 'fx.comp.thresh': ramp(this.comp.threshold, MS.clamp(v, -100, 0), ctx); break;
        case 'fx.comp.ratio': ramp(this.comp.ratio, MS.clamp(v, 1, 20), ctx); break;
        case 'fx.comp.attack': ramp(this.comp.attack, MS.clamp(v, 0, 1), ctx); break;
        case 'fx.comp.release': ramp(this.comp.release, MS.clamp(v, 0, 1), ctx); break;
        case 'fx.comp.makeup': ramp(this.makeup.gain, Math.pow(10, v / 20), ctx); break;

        /* Output */
        case 'fx.width':
          ramp(this.widthPos.gain, v, ctx);
          ramp(this.widthNeg.gain, -v, ctx);
          break;
        case 'master.vol':
          ramp(this.master.gain, v, ctx);
          break;
        case 'master.limit':
          ramp(this.limiter.threshold, v ? -1.5 : 0, ctx);
          ramp(this.limBypass.gain, v ? 0 : 1, ctx);
          ramp(this.master.gain, this._val('master.vol') * (v ? 1 : 1), ctx);
          break;
        default:
          break;
      }
    }

    _applyDelayTime() {
      const sync = this.p['fx.delay.sync'];
      let t;
      if (sync) {
        const beats = MS.DIV_BEATS[this.p['fx.delay.div']] || 1;
        t = beats * 60 / this.bpm;
      } else {
        t = this.p['fx.delay.time'] || 0.35;
      }
      t = MS.clamp(t, 0.005, 3.9);
      ramp(this.dL.delayTime, t, this.ctx, 0.08);
      // A hair of offset on the right side widens the tail without needing
      // ping-pong turned on.
      ramp(this.dR.delayTime, t * 1.0007, this.ctx, 0.08);
    }

    _scheduleIR() {
      const size = this.p['fx.reverb.size'] ?? 0.55;
      const decay = this.p['fx.reverb.decay'] ?? 2.4;
      const damp = this.p['fx.reverb.damp'] ?? 0.4;
      const width = this.p['fx.reverb.width'] ?? 1;
      const key = [size, decay, damp, width].map(x => (+x).toFixed(3)).join('|');
      if (key === this._irKey) return;
      this._irKey = key;
      // Building an IR allocates megabytes; debounce so dragging a knob
      // doesn't build one per animation frame.
      clearTimeout(this._irTimer);
      this._irTimer = setTimeout(() => {
        const seconds = MS.clamp(0.25 + size * 5.5, 0.1, 8);
        try {
          this.conv.buffer = makeImpulse(this.ctx, seconds, 1 + (12 - decay) * 0.35, damp, width);
        } catch (e) { /* context closed mid-build */ }
      }, 120);
    }

    /** Applies every host parameter of a patch in one go. */
    applyAll(values) {
      MS.HOST_PARAMS.forEach(p => {
        const v = values[p.id];
        if (v !== undefined) this.p[p.id] = v;
      });
      MS.HOST_PARAMS.forEach(p => this.set(p.id, this.p[p.id]));
      this._applyDelayTime();
      this._scheduleIR();
    }
  }

  MS.FxRack = FxRack;
  MS.makeCurve = makeCurve;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
