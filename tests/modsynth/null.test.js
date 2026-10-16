/* Null test: the C++ engine against modsynth/dsp.js, sample by sample.
   Each factory patch is loaded and played through the JS processor (the
   offline harness), every message it receives is recorded as a script, the
   same script is replayed into the C++ build (native/modsynth/render), and
   the two outputs are compared. Math.random — used only by a motion lane's
   random mode — is the same 32-bit xorshift on both sides.
   Run: node tests/modsynth/null.test.js [path/to/render] [--patch name] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = process.env.MODSYNTH_ROOT || path.join(__dirname, '..', '..', 'modsynth');
const MS = require(path.join(ROOT, 'params.js'));
require(path.join(ROOT, 'patches.js')); require(path.join(ROOT, 'patches-extra.js')); require(path.join(ROOT, 'patches-modern.js'));
const ALL = MS.FACTORY_PATCHES.concat(MS.MODERN_PATCHES);
const args = process.argv.slice(2);
const BIN = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', '..', 'native', 'modsynth', 'render');
const only = args.indexOf('--patch') >= 0 ? args[args.indexOf('--patch') + 1] : null;
let SR = 48000;

function xorshiftRandom() {
  let s = 0x12345678 >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const SRC = fs.readFileSync(path.join(ROOT, 'dsp.js'), 'utf8');
function makeProc() {
  let registered = null;
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  const M = Object.create(Math); M.random = xorshiftRandom();
  const sb = { AudioWorkletProcessor, registerProcessor: (n, c) => { registered = c; }, sampleRate: SR, currentTime: 0,
    Math: M, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, JSON, Date, console };
  sb.globalThis = sb; vm.createContext(sb); vm.runInContext(SRC, sb);
  const paramIndex = {}, values = new Float32Array(MS.DSP_PARAMS.length);
  MS.DSP_PARAMS.forEach(p => { paramIndex[p.id] = p.dspIndex; values[p.dspIndex] = MS.toNumber(p, p.def); });
  const proc = new registered({ processorOptions: { paramIndex, paramCount: MS.DSP_PARAMS.length, paramValues: values } });
  const script = [];
  const num = v => (v === undefined ? '-' : v === null ? 'null' : String(v));
  const send = m => {
    switch (m.t) {
      case 'p': script.push('p ' + m.i + ' ' + m.v); break;
      case 'on': script.push('on ' + m.note + ' ' + m.vel + ' ' + num(m.id) + ' ' + num(m.at)); break;
      case 'off': script.push('off ' + m.note + ' ' + num(m.id) + ' ' + num(m.at)); break;
      case 'choke': script.push('choke ' + m.note + ' ' + num(m.id) + ' ' + num(m.at)); break;
      case 'matrix': script.push('matrix ' + m.rows.length + m.rows.map(r => ' ' + [r.s, r.d, r.a, r.u, r.v].join(' ')).join('')); break;
      case 'motion': script.push('motion ' + m.lane + ' ' + m.steps.length + ' ' + Array.from(m.steps).join(' ')); break;
      case 'macro': script.push('macro ' + m.i + ' ' + m.v); break;
      case 'mw': case 'bend': case 'at': script.push(m.t + ' ' + m.v); break;
      case 'cc': script.push('cc ' + m.n + ' ' + m.v); break;
      case 'sustain': script.push('sustain ' + (m.v ? 1 : 0)); break;
      case 'tempo': script.push('tempo ' + m.bpm + ' ' + num(m.beat)); break;
      case 'cap': script.push('cap ' + (m.uni | 0) + ' ' + (m.poly | 0)); break;
      case 'panic': case 'allOff': script.push(m.t); break;
      default: throw new Error('unrecorded message ' + m.t);
    }
    proc.port.onmessage({ data: m });
  };
  const n = 128, bl = new Float32Array(n), br = new Float32Array(n), out = [];
  const render = blocks => { script.push('render ' + blocks); for (let b = 0; b < blocks; b++) { proc.process([], [[bl, br]]); out.push(Float32Array.from(bl), Float32Array.from(br)); } };
  return { send, render, script, out, proc };
}

var SRC_INDEX = {}; MS.MOD_SOURCES.forEach((s, i) => { SRC_INDEX[s[0]] = i; });
var DST_INDEX = {}; MS.MOD_DESTS.forEach((d, i) => { DST_INDEX[d[0]] = i; });

/* One patch, played the way the app plays it: loaded whole, a chord struck
   and released through ids, a repeated note, a scheduled note and a choke,
   the wheel and bend moved, the tempo changed — so envelopes, voice reuse,
   the event queue, the mono modes' fallbacks and the tempo-synced lanes all
   run. Then let ring out. */
function play(patch) {
  const s = makeProc();
  const values = MS.paramDefaults();
  Object.keys(patch.values).forEach(k => { if (MS.PARAM[k]) values[k] = patch.values[k]; });
  MS.DSP_PARAMS.forEach(p => s.send({ t: 'p', i: p.dspIndex, v: MS.toNumber(p, values[p.id]) }));
  const rows = (patch.matrix || []).filter(r => r[0] !== 'none' && r[1] !== 'none' && r[2])
    .map(r => ({ s: SRC_INDEX[r[0]], d: DST_INDEX[r[1]], a: r[2], u: r[3] ? 1 : 0, v: SRC_INDEX[r[4]] || 0 }));
  s.send({ t: 'matrix', rows });
  (patch.motion || []).forEach((lane, i) => {
    const arr = new Float32Array(MS.MOTION_STEPS);
    for (let n = 0; n < Math.min(lane.length, MS.MOTION_STEPS); n++) arr[n] = lane[n];
    s.send({ t: 'motion', lane: i, steps: arr });
  });
  s.send({ t: 'tempo', bpm: 112, beat: 0 });
  for (let m = 1; m <= MS.MACRO_COUNT; m++) s.send({ t: 'macro', i: m, v: 0.5 });
  const mono = patch.values['voice.mode'] && patch.values['voice.mode'] !== 'poly';
  const notes = mono ? [36, 43] : [48, 55, 60, 64];
  notes.forEach((n, k) => s.send({ t: 'on', note: n, vel: 0.85 - k * 0.1, id: 100 + k }));
  s.render(40);
  s.send({ t: 'mw', v: 0.6 }); s.send({ t: 'bend', v: -0.4 }); s.send({ t: 'at', v: 0.3 });
  s.render(20);
  s.send({ t: 'off', note: notes[0], id: 100 });
  s.send({ t: 'on', note: 67, vel: 0.7, id: 200, at: 60 * 128 + 300 });
  s.send({ t: 'off', note: 67, id: 200, at: 60 * 128 + 9000 });
  s.render(30);
  s.send({ t: 'on', note: notes[1], vel: 0.9, id: 201 });       // a repeated pitch, new id
  s.send({ t: 'tempo', bpm: 140 });
  s.render(25);
  s.send({ t: 'choke', note: notes[1], id: 201 });
  notes.slice(2).forEach((n, k) => s.send({ t: 'off', note: n, id: 102 + k }));
  s.send({ t: 'bend', v: 0 });
  s.render(110);
  return s;
}

/* The rest of the message set, on every eighth patch at 44.1 kHz: the
   sustain pedal, the CCs, the load governor's caps, all-notes-off and
   panic, scheduled chokes, the mono modes' fallback to a held key, and a
   tempo set with a beat. */
function playExtra(patch, mode) {
  const s = makeProc();
  const values = MS.paramDefaults();
  Object.keys(patch.values).forEach(k => { if (MS.PARAM[k]) values[k] = patch.values[k]; });
  if (mode != null) values['voice.mode'] = mode;
  MS.DSP_PARAMS.forEach(p => s.send({ t: 'p', i: p.dspIndex, v: MS.toNumber(p, values[p.id]) }));
  const rows = (patch.matrix || []).filter(r => r[0] !== 'none' && r[1] !== 'none' && r[2])
    .map(r => ({ s: SRC_INDEX[r[0]], d: DST_INDEX[r[1]], a: r[2], u: r[3] ? 1 : 0, v: SRC_INDEX[r[4]] || 0 }));
  rows.push({ s: SRC_INDEX.exp, d: DST_INDEX['flt1.cutoff'], a: 0.3, u: 0, v: 0 });
  rows.push({ s: SRC_INDEX.breath, d: DST_INDEX.amp, a: -0.2, u: 0, v: SRC_INDEX.foot });
  s.send({ t: 'matrix', rows });
  s.send({ t: 'tempo', bpm: 96, beat: 3.25 });
  s.send({ t: 'cc', n: 11, v: 0.7 }); s.send({ t: 'cc', n: 2, v: 0.4 }); s.send({ t: 'cc', n: 4, v: 0.9 });
  s.send({ t: 'cap', uni: 3, poly: 5 });
  s.send({ t: 'on', note: 50, vel: 0.8, id: 1 });
  s.send({ t: 'on', note: 57, vel: 0.6, id: 2 });
  s.render(12);
  s.send({ t: 'sustain', v: 1 });
  s.send({ t: 'off', note: 50, id: 1 });
  s.send({ t: 'on', note: 62, vel: 0.7, id: 3 });
  s.send({ t: 'off', note: 57, id: 2 });            // a mono mode falls back to 62
  s.render(15);
  s.send({ t: 'on', note: 64, vel: 0.5, id: 4, at: 27 * 128 + 70 });
  s.send({ t: 'choke', note: 64, id: 4, at: 27 * 128 + 4000 });
  s.send({ t: 'off', note: 62, id: 3, at: 27 * 128 + 2000 });
  s.send({ t: 'off', note: 62, id: 3, at: 27 * 128 + 2500 });   // replaces the one before
  s.render(20);
  s.send({ t: 'sustain', v: 0 });
  s.send({ t: 'cap', uni: 8, poly: 16 });
  s.render(10);
  s.send({ t: 'on', note: 45, vel: 1, id: 5 }); s.send({ t: 'on', note: 52, vel: 0.3 });
  s.render(10);
  s.send({ t: 'allOff' });
  s.render(20);
  s.send({ t: 'on', note: 69, vel: 0.9, id: 6 });
  s.render(8);
  s.send({ t: 'panic' });
  s.render(6);
  return s;
}

module.exports = { makeProc, play, playExtra, ALL, MS, SRC_INDEX, DST_INDEX, setRate: r => { SR = r; } };
if (require.main === module) main();
function main() {
// The C++ build reads its parameter slots from a header generated from
// params.js. A param added here and not regenerated there would shift every
// slot after it, so a stale header fails before anything is rendered.
const HDR = path.join(__dirname, '..', '..', 'native', 'modsynth', 'params_gen.h');
if (fs.existsSync(HDR) && fs.readFileSync(HDR, 'utf8') !== require(path.join(__dirname, '..', '..', 'native', 'modsynth', 'gen-params.js'))) {
  console.error('native/modsynth/params_gen.h is out of date with modsynth/params.js — run: make -C native/modsynth params_gen.h');
  process.exit(1);
}
if (!fs.existsSync(BIN)) { console.error('no C++ build at ' + BIN + ' — see native/modsynth/README.md'); process.exit(2); }
let worst = 0, worstName = '', exact = 0, close = 0, bad = [], samples = 0, quiet = [], peaks = [];
const list = only ? ALL.filter(p => p.name === only) : ALL;
const runs = [];
list.forEach(patch => runs.push({ patch, sr: 48000, go: () => play(patch) }));
list.forEach((patch, i) => { if (i % 8 === 0) ['poly', 'mono', 'legato', 'unison'].forEach(m =>
  runs.push({ patch: Object.assign({}, patch, { name: patch.name + ' [' + m + ', 44.1k]' }), sr: 44100, go: () => playExtra(patch, m) })); });
runs.forEach(({ patch, sr, go }) => {
  SR = sr;
  const s = go();
  const res = cp.spawnSync(BIN, [String(SR)], { input: s.script.join('\n') + '\n', maxBuffer: 1 << 28 });
  if (res.status !== 0) { bad.push(patch.name + ' (exit ' + res.status + ')'); return; }
  const c = new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.length / 4);
  let k = 0, diff = 0, peak = 1e-9, first = -1;
  for (const buf of s.out) for (let i = 0; i < buf.length; i++, k++) {
    const d = Math.abs(buf[i] - c[k]); if (d > diff) diff = d; if (d > 0 && first < 0) first = k;
    const a = Math.abs(buf[i]); if (a > peak) peak = a;
  }
  samples += k; peaks.push(peak); if (peak < 1e-3) quiet.push(patch.name + ' (' + (20 * Math.log10(peak)).toFixed(0) + ' dBFS)');
  if (k !== c.length) { bad.push(patch.name + ' (length ' + c.length + ' vs ' + k + ')'); return; }
  const rel = diff / peak;
  if (diff === 0) exact++;
  else if (rel < 1e-6) close++;
  else bad.push(patch.category + ' / ' + patch.name + ': max |Δ| ' + diff.toExponential(2) + ' (' + (20 * Math.log10(rel)).toFixed(1) + ' dB re peak), first at sample ' + first);
  if (rel > worst) { worst = rel; worstName = patch.name; }
});
peaks.sort((a, b) => a - b);
console.log('compared ' + samples + ' samples; patch peaks from ' + (20 * Math.log10(peaks[0])).toFixed(1) + ' to ' + (20 * Math.log10(peaks[peaks.length - 1])).toFixed(1) + ' dBFS, median ' + (20 * Math.log10(peaks[peaks.length >> 1])).toFixed(1) + (quiet.length ? '; under -60 dBFS: ' + quiet.join(', ') : ''));
console.log(runs.length + ' runs (' + list.length + ' patches, and the full message set on every eighth in each voice mode at 44.1 kHz): ' + exact + ' bit-identical, ' + close + ' within -120 dB, ' + bad.length + ' different');
if (worst > 0) console.log('largest difference: ' + worstName + ', ' + (20 * Math.log10(worst)).toFixed(1) + ' dB re its peak');
bad.slice(0, 20).forEach(b => console.log('  ' + b));
process.exit(bad.length ? 1 : 0);
}
