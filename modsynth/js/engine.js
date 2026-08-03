/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — engine host
   ───────────────────────────────────────────────────────────────────────────
   Owns the AudioContext, the synth worklet, the FX rack and the single
   authoritative copy of every parameter value. Everything else in the app —
   the UI, MIDI, the arpeggiator, the patch library — talks to this and
   nothing else touches Web Audio directly.

   Worklet loading deserves a note. `audioWorklet.addModule('js/dsp.js')` fails
   under file:// because the module fetch is cross-origin, so the source is
   fetched (or read from an inlined string in the single-file build), wrapped
   in a Blob and loaded from a blob: URL. That path works served, unserved,
   and inside Max for Live's jweb.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const SRC_INDEX = Object.create(null);
  MS.MOD_SOURCES.forEach((s, i) => { SRC_INDEX[s[0]] = i; });
  const DST_INDEX = Object.create(null);
  MS.MOD_DESTS.forEach((d, i) => { DST_INDEX[d[0]] = i; });
  const FX_DEST_IDS = MS.MOD_DESTS.slice(-6).map(d => d[0]);

  /* Three ways in, tried in order, because no single one covers every way this
     app gets opened:

       blob:   works when the page has a real origin (http, https). Preferred —
               errors report readable line numbers against the blob.
       data:   the only one that works from file://, where the page origin is
               opaque and a blob: fetch is refused outright.
       direct: the plain URL, for the case where the source couldn't be read
               but the browser can fetch it itself. */
  async function loadWorkletModule(ctx, url) {
    let src = root.MS_DSP_SOURCE || null;      // set by the single-file build
    if (!src) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) src = await res.text();
      } catch (e) { /* file:// with no fetch access — fall through */ }
    }

    if (src) {
      const blobUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(blobUrl);
        return 'blob';
      } catch (e) {
        // Opaque origin: fall through to the data URL.
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      await ctx.audioWorklet.addModule(
        'data:application/javascript;charset=utf-8,' + encodeURIComponent(src)
      );
      return 'data';
    }

    await ctx.audioWorklet.addModule(url);
    return 'direct';
  }

  class Engine {
    constructor(opts) {
      opts = opts || {};
      this.dspUrl = opts.dspUrl || 'js/dsp.js';
      this.ready = false;
      this.values = MS.paramDefaults();
      this.matrix = [];                 // [{src, dst, amt, uni}] by id
      this.motion = [new Float32Array(MS.MOTION_STEPS), new Float32Array(MS.MOTION_STEPS)];
      this.macroNames = ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'];
      this.bpm = 120;
      this.voiceCount = 0;
      this.peak = 0;
      this.onMeter = null;
      this.onReady = null;
      this._noteId = 0;
      this._pending = [];               // param sets made before the worklet exists
      this._activeNotes = new Map();    // note → count, for the UI keyboard
    }

    /** Creates the audio graph. Must be called from a user gesture. */
    async init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        return this;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* retried on gesture */ } }

      this.loadMode = await loadWorkletModule(this.ctx, this.dspUrl);

      const paramIndex = Object.create(null);
      const paramValues = new Float32Array(MS.DSP_PARAMS.length);
      MS.DSP_PARAMS.forEach(p => {
        paramIndex[p.id] = p.dspIndex;
        paramValues[p.dspIndex] = MS.toNumber(p, this.values[p.id]);
      });

      this.node = new AudioWorkletNode(this.ctx, 'modsynth', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { paramIndex, paramCount: MS.DSP_PARAMS.length, paramValues },
      });
      this.node.onprocessorerror = e => console.error('MōdSynth DSP error', e);
      this.node.port.onmessage = ev => this._onWorkletMessage(ev.data);

      this.fx = new MS.FxRack(this.ctx);
      this.node.connect(this.fx.input);
      this.fx.connect(this.ctx.destination);
      this.fx.setTempo(this.bpm);
      this.fx.applyAll(this.values);

      this.ready = true;
      this._pending.forEach(([id, v]) => this.set(id, v));
      this._pending.length = 0;
      this.pushMatrix();
      this.pushMotion(0);
      this.pushMotion(1);
      this.setTempo(this.bpm);
      if (this.onReady) this.onReady(this);
      return this;
    }

    _onWorkletMessage(m) {
      if (m.t === 'meter') {
        this.voiceCount = m.voices;
        this.peak = m.peak;
        if (m.gmod && this.fx) {
          // The worklet computes matrix output for FX destinations, because
          // only it has the LFO and motion state. Applied here at meter rate,
          // which is plenty for a delay-mix or reverb-mix sweep.
          for (let i = 0; i < FX_DEST_IDS.length; i++) {
            const id = FX_DEST_IDS[i];
            if (MS.PARAM[id] && MS.PARAM[id].target === 'host') this.fx.setMod(id, m.gmod[i] || 0);
          }
        }
        if (this.onMeter) this.onMeter(this);
      }
    }

    /* ── Parameters ─────────────────────────────────────────────────────── */

    get(id) { return this.values[id]; }

    /** Sets a parameter in real units. Safe before init(). */
    set(id, value) {
      const p = MS.PARAM[id];
      if (!p) return;
      if (p.type === 'enum' && typeof value === 'number') value = p.options[MS.clamp(Math.round(value), 0, p.max)][0];
      if (p.type === 'bool') value = value ? 1 : 0;
      if (p.type !== 'enum' && p.type !== 'bool') {
        value = MS.clamp(+value, p.min, p.max);
        if (p.step) value = Math.round(value / p.step) * p.step;
      }
      this.values[id] = value;
      if (!this.ready) { this._pending.push([id, value]); return; }
      if (p.target === 'dsp') {
        this.node.port.postMessage({ t: 'p', i: p.dspIndex, v: MS.toNumber(p, value) });
      } else {
        this.fx.set(id, value);
      }
    }

    /** Normalised 0…1 setter — what MIDI CCs and Live automation speak. */
    setNorm(id, t) {
      const p = MS.PARAM[id];
      if (!p) return;
      this.set(id, MS.fromNorm(p, t));
    }

    getNorm(id) {
      const p = MS.PARAM[id];
      return p ? MS.toNorm(p, this.values[id]) : 0;
    }

    /** Applies a whole set of values at once (patch load). */
    setAll(values, opts) {
      const skip = (opts && opts.skip) || null;
      MS.PARAMS.forEach(p => {
        if (skip && skip(p)) return;
        const v = values[p.id];
        this.values[p.id] = v === undefined ? p.def : v;
      });
      if (!this.ready) return;
      const arr = new Float32Array(MS.DSP_PARAMS.length);
      MS.DSP_PARAMS.forEach(p => { arr[p.dspIndex] = MS.toNumber(p, this.values[p.id]); });
      this.node.port.postMessage({ t: 'pAll', v: arr });
      this.fx.applyAll(this.values);
    }

    /* ── Modulation matrix ──────────────────────────────────────────────── */

    /** rows: [{src, dst, amt, uni}] using string ids. */
    setMatrix(rows) {
      this.matrix = rows.slice(0, MS.MATRIX_SLOTS);
      // Mirror into the parameter table so the matrix is part of a patch and
      // is automatable/mappable like anything else.
      for (let i = 0; i < MS.MATRIX_SLOTS; i++) {
        const r = this.matrix[i] || { src: 'none', dst: 'none', amt: 0, uni: 0 };
        this.values['mtx' + (i + 1) + '.src'] = r.src || 'none';
        this.values['mtx' + (i + 1) + '.dst'] = r.dst || 'none';
        this.values['mtx' + (i + 1) + '.amt'] = r.amt || 0;
        this.values['mtx' + (i + 1) + '.uni'] = r.uni ? 1 : 0;
      }
      this.pushMatrix();
    }

    /** Rebuilds the matrix from the parameter table (after a patch load). */
    syncMatrixFromParams() {
      const rows = [];
      for (let i = 1; i <= MS.MATRIX_SLOTS; i++) {
        rows.push({
          src: this.values['mtx' + i + '.src'] || 'none',
          dst: this.values['mtx' + i + '.dst'] || 'none',
          amt: this.values['mtx' + i + '.amt'] || 0,
          uni: this.values['mtx' + i + '.uni'] ? 1 : 0,
        });
      }
      this.matrix = rows;
      this.pushMatrix();
    }

    pushMatrix() {
      if (!this.ready) return;
      const rows = this.matrix
        .filter(r => r && r.src && r.src !== 'none' && r.dst && r.dst !== 'none' && r.amt)
        .map(r => ({ s: SRC_INDEX[r.src] || 0, d: DST_INDEX[r.dst] || 0, a: +r.amt || 0, u: r.uni ? 1 : 0 }));
      this.node.port.postMessage({ t: 'matrix', rows });
      // FX destinations that nothing drives must fall back to their base value.
      if (this.fx) {
        FX_DEST_IDS.forEach(id => {
          if (!rows.some(r => MS.MOD_DESTS[r.d] && MS.MOD_DESTS[r.d][0] === id)) this.fx.setMod(id, 0);
        });
      }
    }

    setMotion(lane, steps) {
      this.motion[lane].set(steps.subarray ? steps.subarray(0, MS.MOTION_STEPS) : steps.slice(0, MS.MOTION_STEPS));
      this.pushMotion(lane);
    }

    setMotionStep(lane, i, v) {
      this.motion[lane][i] = MS.clamp(v, -1, 1);
      this.pushMotion(lane);
    }

    pushMotion(lane) {
      if (!this.ready) return;
      this.node.port.postMessage({ t: 'motion', lane, steps: new Float32Array(this.motion[lane]) });
    }

    /* ── Playing ────────────────────────────────────────────────────────── */

    noteOn(note, vel) {
      if (!this.ready) return;
      note = MS.clamp(note | 0, 0, 127);
      this.node.port.postMessage({ t: 'on', note, vel: vel === undefined ? 0.8 : MS.clamp(vel, 0.0001, 1), id: this._noteId++ });
      this._activeNotes.set(note, (this._activeNotes.get(note) || 0) + 1);
    }

    noteOff(note) {
      if (!this.ready) return;
      note = MS.clamp(note | 0, 0, 127);
      this.node.port.postMessage({ t: 'off', note });
      const n = (this._activeNotes.get(note) || 1) - 1;
      if (n <= 0) this._activeNotes.delete(note); else this._activeNotes.set(note, n);
    }

    allNotesOff() {
      if (this.ready) this.node.port.postMessage({ t: 'allOff' });
      this._activeNotes.clear();
    }

    panic() {
      if (this.ready) this.node.port.postMessage({ t: 'panic' });
      this._activeNotes.clear();
    }

    heldNotes() { return Array.from(this._activeNotes.keys()); }

    /* ── Performance controls ───────────────────────────────────────────── */

    /** −1…1. */
    setBend(v) {
      this.bend = MS.clamp(v, -1, 1);
      if (this.ready) this.node.port.postMessage({ t: 'bend', v: this.bend });
    }

    /** 0…1. */
    setModWheel(v) {
      this.modWheel = MS.clamp(v, 0, 1);
      if (this.ready) this.node.port.postMessage({ t: 'mw', v: this.modWheel });
    }

    setAftertouch(v) {
      this.aftertouch = MS.clamp(v, 0, 1);
      if (this.ready) this.node.port.postMessage({ t: 'at', v: this.aftertouch });
    }

    setSustain(on) {
      this.sustain = !!on;
      if (this.ready) this.node.port.postMessage({ t: 'sustain', v: this.sustain ? 1 : 0 });
    }

    /** Any other continuous controller the DSP knows about (expression, breath, foot). */
    setCC(n, v) {
      if (this.ready) this.node.port.postMessage({ t: 'cc', n, v: MS.clamp(v, 0, 1) });
    }

    setMacro(i, v) {
      this.set('macro.' + i, MS.clamp(v, 0, 1));
      if (this.ready) this.node.port.postMessage({ t: 'macro', i, v: MS.clamp(v, 0, 1) });
    }

    setTempo(bpm, beat) {
      this.bpm = MS.clamp(bpm || 120, 20, 400);
      if (this.fx) this.fx.setTempo(this.bpm);
      if (this.ready) this.node.port.postMessage({ t: 'tempo', bpm: this.bpm, beat });
    }

    /* ── Analysis ───────────────────────────────────────────────────────── */

    getWaveform(arr) {
      if (!this.fx) return null;
      this.fx.analyser.getByteTimeDomainData(arr);
      return arr;
    }

    getSpectrum(arr) {
      if (!this.fx) return null;
      this.fx.analyser.getByteFrequencyData(arr);
      return arr;
    }

    /** Renders the current patch offline — used by the patch browser to draw
        a waveform thumbnail without making a sound. */
    async renderPreview(note, seconds) {
      if (!root.OfflineAudioContext) return null;
      const sr = 22050;
      const oc = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
      await loadWorkletModule(oc, this.dspUrl);
      const paramIndex = Object.create(null);
      const paramValues = new Float32Array(MS.DSP_PARAMS.length);
      MS.DSP_PARAMS.forEach(p => {
        paramIndex[p.id] = p.dspIndex;
        paramValues[p.dspIndex] = MS.toNumber(p, this.values[p.id]);
      });
      const n = new AudioWorkletNode(oc, 'modsynth', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { paramIndex, paramCount: MS.DSP_PARAMS.length, paramValues },
      });
      n.connect(oc.destination);
      n.port.postMessage({ t: 'matrix', rows: this.matrix
        .filter(r => r && r.src !== 'none' && r.dst !== 'none' && r.amt)
        .map(r => ({ s: SRC_INDEX[r.src] || 0, d: DST_INDEX[r.dst] || 0, a: +r.amt || 0, u: r.uni ? 1 : 0 })) });
      n.port.postMessage({ t: 'on', note: note || 60, vel: 0.9, id: 0 });
      setTimeout(() => {}, 0);
      const buf = await oc.startRendering();
      return buf;
    }
  }

  MS.Engine = Engine;
  MS.SRC_INDEX = SRC_INDEX;
  MS.DST_INDEX = DST_INDEX;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
