/* Minimal AudioWorklet shim so the DSP core can be exercised under Node.
   Gives us real numbers out of the real signal path — no browser required. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/** Loads js/dsp.js in a sandbox with the worklet globals it expects.
    Returns { Processor, instantiate(opts) }. */
function loadDsp(sampleRate = 48000) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'dsp.js'), 'utf8');
  let registered = null;

  class FakePort {
    constructor() { this.onmessage = null; this.sent = []; }
    postMessage(m) { this.sent.push(m); }
    /** Deliver a message to the processor as the browser would. */
    deliver(m) { if (this.onmessage) this.onmessage({ data: m }); }
  }

  class AudioWorkletProcessor {
    constructor() { this.port = new FakePort(); }
  }

  const sandbox = {
    AudioWorkletProcessor,
    registerProcessor: (name, cls) => { registered = { name, cls }; },
    sampleRate,
    currentTime: 0,
    Math, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, JSON,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'dsp.js' });

  if (!registered) throw new Error('dsp.js did not call registerProcessor');
  return registered;
}

/** Builds a processor wired to the real parameter schema. */
function makeSynth(opts = {}) {
  const MS = require(path.join(ROOT, 'js', 'params.js'));
  const sampleRate = opts.sampleRate || 48000;
  const { cls } = loadDsp(sampleRate);

  const paramIndex = {};
  const values = new Float32Array(MS.DSP_PARAMS.length);
  MS.DSP_PARAMS.forEach(p => {
    paramIndex[p.id] = p.dspIndex;
    values[p.dspIndex] = MS.toNumber(p, p.def);
  });

  const proc = new cls({
    processorOptions: {
      paramIndex,
      paramCount: MS.DSP_PARAMS.length,
      paramValues: values,
    },
  });

  const api = {
    proc,
    MS,
    sampleRate,
    set(id, v) {
      const p = MS.PARAM[id];
      if (!p) throw new Error('unknown param ' + id);
      if (p.target !== 'dsp') throw new Error(id + ' is a host param');
      proc.port.deliver({ t: 'p', i: p.dspIndex, v: MS.toNumber(p, v) });
      return api;
    },
    send(m) { proc.port.deliver(m); return api; },
    noteOn(note, vel = 0.8) { proc.port.deliver({ t: 'on', note, vel, id: note }); return api; },
    noteOff(note) { proc.port.deliver({ t: 'off', note }); return api; },
    /** Renders `blocks` × 128 frames and returns interleaved-free {L,R}. */
    render(blocks) {
      const n = 128;
      const L = new Float32Array(blocks * n);
      const R = new Float32Array(blocks * n);
      const bl = new Float32Array(n), br = new Float32Array(n);
      for (let b = 0; b < blocks; b++) {
        proc.process([], [[bl, br]]);
        L.set(bl, b * n);
        R.set(br, b * n);
      }
      return { L, R };
    },
  };
  return api;
}

/** Peak absolute value. */
function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

/** RMS. */
function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/** True if the buffer contains a NaN or Infinity. */
function hasBadSample(buf) {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return true;
  return false;
}

/** Naive DFT magnitude at one frequency — enough to test aliasing. */
function magnitudeAt(buf, freq, sampleRate) {
  let re = 0, im = 0;
  const w = 2 * Math.PI * freq / sampleRate;
  for (let i = 0; i < buf.length; i++) {
    re += buf[i] * Math.cos(w * i);
    im -= buf[i] * Math.sin(w * i);
  }
  return 2 * Math.sqrt(re * re + im * im) / buf.length;
}

/** Estimates fundamental frequency by counting positive-going zero crossings. */
function estimateFreq(buf, sampleRate) {
  let crossings = 0, first = -1, last = -1;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      if (first < 0) first = i; else last = i;
      crossings++;
    }
  }
  if (crossings < 2 || last <= first) return 0;
  return sampleRate * (crossings - 1) / (last - first);
}

module.exports = { loadDsp, makeSynth, peak, rms, hasBadSample, magnitudeAt, estimateFreq };
