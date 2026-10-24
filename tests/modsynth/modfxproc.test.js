/* The mõdFX worklet against its C++ port, sample for sample.
   Runs the real ModFxProc source out of index.html (FX_WORKLET_SRC) and
   native/modsynth/wkrender on the same input and the same parameter changes,
   and compares every output sample. Needs `make -C native/modsynth wkrender`.
   Run: node tests/modsynth/modfxproc.test.js [path/to/wkrender] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const root = path.join(__dirname, '..', '..');
const BIN = process.argv[2] || path.join(root, 'native', 'modsynth', 'wkrender');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/const FX_WORKLET_SRC = `([\s\S]*?)`;\n/);
if (!m) { console.log('FAIL: FX_WORKLET_SRC not found'); process.exit(1); }
const SRC = vm.runInNewContext('`' + m[1] + '`');      // the page's template literal, escapes and all
const SR = 48000;

function makeProc() {
  let Cls = null;
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  const sb = { AudioWorkletProcessor, registerProcessor: (n, c) => { Cls = c; }, sampleRate: SR, Math, Float32Array, Float64Array, console };
  vm.createContext(sb); vm.runInContext(SRC, sb);
  return new Cls({});
}
// A deterministic source: a chord-ish sine stack under bursts of noise, so
// repeats, reversals and crushing all have something to show.
function source(nBlocks, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const n = nBlocks * 128, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const tone = 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 330 * t) + 0.12 * Math.sin(2 * Math.PI * 495 * t);
    const burst = (Math.floor(t * 6) % 3 === 0) ? 0.2 * (rnd() * 2 - 1) : 0;
    L[i] = tone + burst; R[i] = 0.8 * tone - burst;
  }
  return { L, R };
}
const NAMES = ['stutter', 'reverse', 'warp', 'crush', 'srate', 'grain', 'grainlen', 'fltmode', 'fltcut', 'fltres', 'fltdrv'];
const REST = { stutter: 0, reverse: 0, warp: 1, crush: 0, srate: 0, grain: 0, grainlen: 0.5, fltmode: 0, fltcut: 1, fltres: 0, fltdrv: 0 };

function runBoth(schedule, nBlocks, seed) {
  const { L, R } = source(nBlocks, seed);
  // Parameters per block: the latest change at or before it.
  const per = []; let cur = Object.assign({}, REST), si = 0;
  for (let b = 0; b < nBlocks; b++) {
    while (si < schedule.length && schedule[si].at <= b) { Object.assign(cur, schedule[si].set); si++; }
    per.push(Object.assign({}, cur));
  }
  const proc = makeProc();
  const js = new Float32Array(nBlocks * 256);
  for (let b = 0; b < nBlocks; b++) {
    const il = L.slice(b * 128, b * 128 + 128), ir = R.slice(b * 128, b * 128 + 128);
    const ol = new Float32Array(128), or = new Float32Array(128);
    const params = {}; NAMES.forEach(k => { params[k] = [per[b][k]]; });
    proc.process([[il, ir]], [[ol, or]], params);
    js.set(ol, b * 256); js.set(or, b * 256 + 128);
  }
  const buf = Buffer.alloc(8 + nBlocks * (88 + 1024));
  buf.writeUInt32LE(SR, 0); buf.writeUInt32LE(nBlocks, 4);
  let off = 8;
  for (let b = 0; b < nBlocks; b++) {
    NAMES.forEach(k => { buf.writeDoubleLE(per[b][k], off); off += 8; });
    for (let i = 0; i < 128; i++) { buf.writeFloatLE(L[b * 128 + i], off); off += 4; }
    for (let i = 0; i < 128; i++) { buf.writeFloatLE(R[b * 128 + i], off); off += 4; }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-'));
  fs.writeFileSync(path.join(dir, 'in.bin'), buf);
  cp.execFileSync(BIN, [path.join(dir, 'in.bin'), path.join(dir, 'out.bin')]);
  const raw = fs.readFileSync(path.join(dir, 'out.bin'));
  const cpp = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  fs.rmSync(dir, { recursive: true });
  let diff = 0, first = -1, peak = 0;
  for (let i = 0; i < js.length; i++) {
    peak = Math.max(peak, Math.abs(js[i]));
    if (!Object.is(js[i], cpp[i]) && js[i] !== cpp[i]) { diff++; if (first < 0) first = i; }
  }
  return { diff, first, n: js.length, peak, nonFinite: js.some(x => !isFinite(x)) };
}

let fail = 0, total = 0;
function scenario(name, schedule, nBlocks = 700, seed = 1) {
  const r = runBoth(schedule, nBlocks, seed);
  total++;
  const bad = r.diff > 0 || r.nonFinite || r.peak === 0;
  if (bad) { fail++; console.log(`  FAIL ${name}: ${r.diff} of ${r.n} samples differ` + (r.first >= 0 ? ` (first at ${r.first})` : '') + ` peak ${r.peak}`); }
  return r;
}

scenario('pass-through', []);
scenario('stutter 1/8', [{ at: 100, set: { stutter: 0.06 } }, { at: 400, set: { stutter: 0 } }]);
scenario('stutter, then a different slice', [{ at: 100, set: { stutter: 0.03 } }, { at: 250, set: { stutter: 0.12 } }, { at: 500, set: { stutter: 0 } }]);
scenario('reverse', [{ at: 120, set: { reverse: 0.08 } }, { at: 450, set: { reverse: 0 } }]);
scenario('warp down, up, double', [{ at: 80, set: { warp: 0.6 } }, { at: 250, set: { warp: 1.5 } }, { at: 420, set: { warp: 2 } }, { at: 560, set: { warp: 1 } }]);
scenario('grain', [{ at: 100, set: { grain: 0.12, grainlen: 0.3 } }, { at: 300, set: { grainlen: 0.9 } }, { at: 500, set: { grain: 0 } }]);
scenario('bit crush', [{ at: 60, set: { crush: 0.5 } }, { at: 300, set: { crush: 1 } }]);
scenario('sample-rate reduction', [{ at: 60, set: { srate: 0.4 } }, { at: 300, set: { srate: 1 } }]);
scenario('crush and rate together over a stutter', [{ at: 60, set: { crush: 0.7, srate: 0.5, stutter: 0.05 } }]);
scenario('Moog ladder', [{ at: 50, set: { fltmode: 1, fltcut: 0.5, fltres: 0.6, fltdrv: 0.3 } }, { at: 300, set: { fltcut: 0.2, fltres: 0.95 } }, { at: 550, set: { fltmode: 0 } }]);
scenario('MS-20 ladder', [{ at: 50, set: { fltmode: 2, fltcut: 0.6, fltres: 0.7, fltdrv: 0.5 } }, { at: 400, set: { fltcut: 0.15 } }]);
scenario('ladder over warp', [{ at: 50, set: { warp: 0.75, fltmode: 1, fltcut: 0.4, fltres: 0.5 } }]);

// Random schedules: any mode, any knob, changed every few blocks.
let s = 12345;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
for (let t = 0; t < 40; t++) {
  const sch = [];
  for (let at = 20; at < 700; at += 5 + Math.floor(rnd() * 90)) {
    const set = {};
    if (rnd() < 0.4) set.stutter = rnd() < 0.4 ? 0 : 0.02 + rnd() * 0.3;
    if (rnd() < 0.3) set.reverse = rnd() < 0.5 ? 0 : 0.02 + rnd() * 0.3;
    if (rnd() < 0.3) set.warp = rnd() < 0.4 ? 1 : 0.4 + rnd() * 1.8;
    if (rnd() < 0.3) set.crush = rnd() < 0.5 ? 0 : rnd();
    if (rnd() < 0.3) set.srate = rnd() < 0.5 ? 0 : rnd();
    if (rnd() < 0.3) { set.grain = rnd() < 0.5 ? 0 : 0.02 + rnd() * 0.6; set.grainlen = rnd(); }
    if (rnd() < 0.3) { set.fltmode = Math.floor(rnd() * 3); set.fltcut = rnd(); set.fltres = rnd(); set.fltdrv = rnd(); }
    sch.push({ at, set });
  }
  scenario('random schedule ' + t, sch, 700, 100 + t);
}
console.log(`tests/modsynth/modfxproc.test.js: ${total} runs, ${total - fail} bit-identical, ${fail} different`);
process.exit(fail ? 1 : 0);
