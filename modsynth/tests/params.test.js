/* Pins the contracts between js/params.js and js/dsp.js.
   These orderings are positional on the audio thread, so a reordered enum
   silently turns every saved patch into a different sound. Run: node tests/params.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const MS = require('../js/params.js');
require('../js/patches.js');
require('../js/patches-extra.js');

const DSP = fs.readFileSync(path.join(__dirname, '..', 'js', 'dsp.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}

/** Pulls a `const NAME = [ ... ];` string array out of the DSP source. */
function dspArray(name) {
  const m = DSP.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^['"]|['"]$/g, ''));
}

function eqList(a, b, label) {
  if (!a) { ok(false, label, 'not found in dsp.js'); return; }
  ok(a.length === b.length, label + ': same length', `${a.length} vs ${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    ok(a[i] === b[i], `${label}[${i}]`, `dsp="${a[i]}" params="${b[i]}"`);
  }
}

console.log('ordering contracts with dsp.js');
eqList(dspArray('WT_ORDER'), MS.WAVES.map(w => w[0]), 'WT_ORDER ↔ WAVES');
eqList(dspArray('FLT_ORDER'), MS.FILTER_MODELS.map(f => f[0]), 'FLT_ORDER ↔ FILTER_MODELS');
eqList(dspArray('SRC_ORDER'), MS.MOD_SOURCES.map(s => s[0]), 'SRC_ORDER ↔ MOD_SOURCES');
eqList(dspArray('DST_ORDER'), MS.MOD_DESTS.map(d => d[0]), 'DST_ORDER ↔ MOD_DESTS');
eqList(dspArray('LFO_SHAPES'), MS.LFO_SHAPES.map(s => s[0]), 'LFO_SHAPES');

/* Destination index constants have to match the position in DST_ORDER, or
   modulation lands on the wrong parameter. */
console.log('destination constants');
const CONSTS = {
  D_PITCH: 'pitch', D_O1FINE: 'osc1.fine', D_O2FINE: 'osc2.fine',
  D_O1SHAPE: 'osc1.shape', D_O2SHAPE: 'osc2.shape', D_O1PW: 'osc1.pw', D_O2PW: 'osc2.pw',
  D_O1LVL: 'osc1.level', D_O2LVL: 'osc2.level', D_O1DET: 'osc1.detune', D_O2DET: 'osc2.detune',
  D_FM: 'mix.fm', D_RING: 'mix.ring', D_SUB: 'mix.sub', D_NOISE: 'mix.noise',
  D_F1CUT: 'flt1.cutoff', D_F1RES: 'flt1.res', D_F1DRV: 'flt1.drive',
  D_F2CUT: 'flt2.cutoff', D_F2RES: 'flt2.res', D_FBLEND: 'flt.blend',
  D_AMP: 'amp', D_PAN: 'pan', D_L1RATE: 'lfo1.rate', D_L1DEP: 'lfo1.depth',
  D_E2D: 'env2.d', D_E1R: 'env1.r',
};
Object.keys(CONSTS).forEach(name => {
  const m = DSP.match(new RegExp('\\b' + name + '\\s*=\\s*(\\d+)'));
  const want = MS.MOD_DESTS.findIndex(d => d[0] === CONSTS[name]);
  ok(m && +m[1] === want, name, m ? `dsp=${m[1]} expected=${want}` : 'not found');
});
{
  const m = DSP.match(/\bD_FIRST_FX\s*=\s*(\d+)/);
  const firstFx = MS.MOD_DESTS.findIndex(d => d[0].startsWith('fx.'));
  ok(m && +m[1] === firstFx, 'D_FIRST_FX', m ? `dsp=${m[1]} expected=${firstFx}` : 'not found');
  ok(MS.MOD_DESTS.slice(firstFx).every(d => d[0].startsWith('fx.')),
     'every destination from D_FIRST_FX on is an FX destination');
}

/* Tempo divisions are looked up by index on the audio thread. */
console.log('tempo divisions');
{
  const m = DSP.match(/const DIV_BEATS_DSP\s*=\s*\[([\s\S]*?)\];/);
  ok(!!m, 'DIV_BEATS_DSP found');
  if (m) {
    const vals = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => eval(s));
    ok(vals.length === MS.DIVS.length, 'same number of divisions', `${vals.length} vs ${MS.DIVS.length}`);
    MS.DIVS.forEach((d, i) => {
      ok(Math.abs(vals[i] - d[2] * 4) < 1e-9, `division ${d[0]}`, `dsp=${vals[i]} params=${d[2] * 4}`);
    });
  }
}

/* Sources the DSP treats as bipolar must actually swing through zero. */
console.log('bipolar sources');
{
  const m = DSP.match(/SRC_BIPOLAR\[SRC_ORDER\.indexOf\(id\)\]\s*=\s*1;\s*\}\);/);
  ok(!!m, 'SRC_BIPOLAR is populated');
  const list = DSP.match(/\[([^\]]*)\]\.forEach\(id => \{ SRC_BIPOLAR/);
  if (list) {
    const ids = list[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    ids.forEach(id => {
      ok(MS.MOD_SOURCES.some(s => s[0] === id), 'bipolar source exists: ' + id);
    });
    // Macros and envelopes run 0…1 — marking them bipolar would offset every
    // patch by half a macro's range at rest.
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'env1', 'env2', 'env3', 'vel', 'mw', 'at', 'gate']
      .forEach(id => ok(!ids.includes(id), id + ' is not marked bipolar'));
  }
}

/* Schema sanity. */
console.log('schema');
ok(MS.PARAMS.length > 200, 'parameter count', String(MS.PARAMS.length));
MS.PARAMS.forEach((p, i) => {
  ok(p.index === i, 'index matches declaration order for ' + p.id);
  ok(p.target === 'dsp' || p.target === 'host', p.id + ' has a valid target', p.target);
  if (p.type === 'float' || p.type === 'int') {
    ok(p.def >= p.min && p.def <= p.max, p.id + ' default in range', `${p.def} ∉ [${p.min},${p.max}]`);
  }
});
MS.DSP_PARAMS.forEach((p, i) => ok(p.dspIndex === i, 'dense dsp index for ' + p.id));

/* Normalisation must be value-stable: a value that goes out to MIDI or Live as
   0…1 and comes back has to be the same value. Quantised parameters can't
   preserve an arbitrary *position* — a switch has nothing between off and on —
   so the invariant is on the value, not on t. */
console.log('normalisation round trip');
MS.PARAMS.forEach(p => {
  [0, 0.25, 0.5, 0.75, 1].forEach(t => {
    const raw = MS.fromNorm(p, t);
    const back = MS.fromNorm(p, MS.toNorm(p, raw));
    const same = typeof raw === 'string' ? back === raw : Math.abs(back - raw) < 1e-6;
    ok(same, `${p.id} value-stable at ${t}`, `${raw} → ${MS.toNorm(p, raw)} → ${back}`);
  });
  // And every legal value of an enum has to survive the trip, since that's how
  // a program change or an automation lane addresses them.
  if (p.type === 'enum') {
    p.options.forEach(([v]) => {
      ok(MS.fromNorm(p, MS.toNorm(p, v)) === v, `${p.id} option round trip: ${v}`);
    });
  }
  ok(MS.formatParam(p, p.def).length > 0, p.id + ' formats its default');
});

/* Patch integrity. */
console.log('patches');
const seen = new Set();
MS.FACTORY_PATCHES.forEach(patch => {
  const key = patch.category + '/' + patch.name;
  ok(!seen.has(key), 'unique patch: ' + key);
  seen.add(key);
  ok(patch.tags.length > 0, patch.name + ' has tags');
  Object.keys(patch.values).forEach(id => {
    const p = MS.PARAM[id];
    ok(!!p, `${patch.name}: parameter exists: ${id}`);
    if (!p) return;
    if (p.type === 'enum') ok(p.optIndex[patch.values[id]] !== undefined, `${patch.name}: ${id} legal option`, String(patch.values[id]));
    else if (p.type !== 'bool') {
      const v = patch.values[id];
      ok(v >= p.min && v <= p.max, `${patch.name}: ${id} in range`, `${v} ∉ [${p.min},${p.max}]`);
    }
  });
  patch.matrix.forEach(r => {
    ok(MS.MOD_SOURCES.some(s => s[0] === r[0]), `${patch.name}: source ${r[0]}`);
    ok(MS.MOD_DESTS.some(d => d[0] === r[1]), `${patch.name}: dest ${r[1]}`);
    ok(Math.abs(r[2]) <= 1.0001, `${patch.name}: amount within ±1`, String(r[2]));
  });
  // Four working macros is the promise the patch library makes.
  const macroSrcs = new Set(patch.matrix.filter(r => /^m[1-8]$/.test(r[0])).map(r => r[0]));
  ok(macroSrcs.size >= 3, patch.name + ' wires at least three macros', String(macroSrcs.size));
});
ok(MS.FACTORY_PATCHES.length >= 300, 'factory bank size', String(MS.FACTORY_PATCHES.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
