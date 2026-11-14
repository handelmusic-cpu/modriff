/* The Macro Osc source: the model list the page stores must be the C++ one, and the patches that use it
   must be valid. The sound itself is measured by native/modsynth/macrolevel.cpp (levels, peaks, CPU), not here.
   Run: node tests/modsynth/macro.test.js */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const MS = require('../../modsynth/params.js');
require('../../modsynth/patches.js');
require('../../modsynth/patches-extra.js');
require('../../modsynth/patches-modern.js');
const nFactory = MS.MODERN_PATCHES.length;
require('../../modsynth/patches-levels.js');
require('../../modsynth/patches-macro.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } };

// 1. The C++ model table and params.js agree on ids and order (a song stores the id).
const dir = path.join(__dirname, '..', '..', 'native', 'macroosc');
execFileSync('make', ['-s', '-C', dir, 'macrotest'], { stdio: ['ignore', 'ignore', 'inherit'] });
const cpp = execFileSync(path.join(dir, 'macrotest'), ['--ids']).toString().trim().split('\n');
const js = MS.MACRO_MODELS.map(m => m[0]);
ok(JSON.stringify(cpp) === JSON.stringify(js), 'model ids differ: C++ ' + cpp + ' / params.js ' + js);

// 2. The new parameters are DSP parameters with the last indices, so no existing index moved.
const last = MS.DSP_PARAMS.slice(-7).map(p => p.id);
ok(JSON.stringify(last) === JSON.stringify(['mix.mosc', 'mosc.model', 'mosc.harmonics', 'mosc.timbre', 'mosc.morph', 'mosc.env', 'mosc.oct']),
  'macro params are not the last seven DSP params: ' + last);

// 3. The patches: valid keys and values, unique names, a model each, sound on.
const mine = MS.MODERN_PATCHES.slice(nFactory);
ok(mine.length === 12, 'expected 12 macro patches, got ' + mine.length);
const names = new Set(MS.FACTORY_PATCHES.concat(MS.MODERN_PATCHES.slice(0, nFactory)).map(p => p.name));
const SRC = new Set(MS.MOD_SOURCES.map(s => s[0])), DST = new Set(MS.MOD_DESTS.map(d => d[0]));
const models = new Set();
for (const p of mine) {
  ok(!names.has(p.name), 'name already used: ' + p.name); names.add(p.name);
  ok(p.category === 'Macro Osc', p.name + ': category');
  Object.keys(p.values).forEach(k => {
    const d = MS.PARAM[k];
    if (!d) return ok(false, p.name + ': unknown parameter ' + k);
    const v = p.values[k];
    if (d.type === 'enum') ok(d.optIndex[v] !== undefined, p.name + ': ' + k + ' = ' + v + ' is not an option');
    else ok(typeof v === 'number' && v >= d.min && v <= d.max, p.name + ': ' + k + ' = ' + v + ' out of range');
  });
  ok(p.values['mix.mosc'] > 0 && p.values['osc1.on'] === 0, p.name + ': macro source on, osc 1 off');
  models.add(p.values['mosc.model']);
  (p.matrix || []).forEach(r => {
    ok(r[0] === 'none' || SRC.has(r[0]) || /^m[1-8]$/.test(r[0]), p.name + ': matrix source ' + r[0]);
    ok(DST.has(r[1]), p.name + ': matrix destination ' + r[1]);
  });
}
ok(models.size === MS.MACRO_MODELS.length, 'every model has a patch: ' + [...models].length + ' of ' + MS.MACRO_MODELS.length);

// 4. Each patch played through the real C++ engine the way the app plays it (whole patch, a chord or a line, wheel and
//    bend): it sounds, nothing is non-finite, the peak stays under 1 and the level is near the app's own default
//    chord patch, after that patch's trim (the app applies it; these have none).
execFileSync('make', ['-s', '-C', path.join(__dirname, '..', '..', 'native', 'modsynth'), 'render'], { stdio: ['ignore', 'ignore', 'inherit'] });
const RENDER = path.join(__dirname, '..', '..', 'native', 'modsynth', 'render');
const SRCI = {}; MS.MOD_SOURCES.forEach((x, i) => { SRCI[x[0]] = i; });
const DSTI = {}; MS.MOD_DESTS.forEach((x, i) => { DSTI[x[0]] = i; });
function run(patch) {
  const v = MS.paramDefaults();
  Object.keys(patch.values).forEach(k => { if (MS.PARAM[k]) v[k] = patch.values[k]; });
  const L = [];
  MS.DSP_PARAMS.forEach(p => L.push('p ' + p.dspIndex + ' ' + MS.toNumber(p, v[p.id])));
  const rows = (patch.matrix || []).filter(r => r[0] !== 'none' && r[1] !== 'none' && r[2])
    .map(r => ({ s: SRCI[r[0]] !== undefined ? SRCI[r[0]] : 0, d: DSTI[r[1]], a: r[2], u: r[3] ? 1 : 0, v: SRCI[r[4]] || 0 }));
  L.push('matrix ' + rows.length + rows.map(r => ' ' + [r.s, r.d, r.a, r.u, r.v].join(' ')).join(''));
  for (let m = 1; m <= MS.MACRO_COUNT; m++) L.push('macro ' + m + ' 0.5');
  const mono = patch.values['voice.mode'] && patch.values['voice.mode'] !== 'poly';
  const notes = mono ? [38, 43, 41] : [48, 55, 60, 64];
  if (mono) { notes.forEach((n, i) => { L.push('on ' + n + ' 0.85 ' + (100 + i) + ' -'); L.push('render 60'); L.push('off ' + n + ' ' + (100 + i) + ' -'); L.push('render 12'); }); }
  else { notes.forEach((n, i) => L.push('on ' + n + ' ' + (0.85 - i * 0.05) + ' ' + (100 + i) + ' -')); L.push('render 90'); L.push('mw 0.6'); L.push('bend 0.3'); L.push('render 40'); notes.forEach((n, i) => L.push('off ' + n + ' ' + (100 + i) + ' -')); L.push('render 120'); }
  const r = spawnSync(RENDER, ['48000'], { input: L.join('\n') + '\n', maxBuffer: 1 << 28 });
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
  let ss = 0, pk = 0, bad = 0;
  for (const x of f) { if (!isFinite(x)) { bad++; continue; } ss += x * x; pk = Math.max(pk, Math.abs(x)); }
  return { rms: Math.sqrt(ss / f.length), pk, bad };
}
const refName = 'Stab Keys';
const refP = MS.MODERN_PATCHES.concat(MS.FACTORY_PATCHES).find(p => p.name === refName);
const refRun = run(refP), refRms = refRun.rms * ((MS.PATCH_TRIM && MS.PATCH_TRIM[refName]) || 1);
console.log('reference ' + refName + ': rms ' + refRms.toFixed(4) + ', peak ' + refRun.pk.toFixed(3));
for (const p of mine) {
  const r = run(p), db = 20 * Math.log10(r.rms * (MS.PATCH_TRIM[p.name] || 1) / refRms);   // after the patch's trim, as the app plays it
  console.log('  ' + p.name.padEnd(16) + ' rms ' + r.rms.toFixed(4) + '  ' + (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB  peak ' + r.pk.toFixed(3));
  ok(r.bad === 0, p.name + ': ' + r.bad + ' non-finite samples');
  ok(r.rms > 0.003, p.name + ': is silent (rms ' + r.rms + ')');
  ok(r.pk * (MS.PATCH_TRIM[p.name] || 1) < 1, p.name + ': peak ' + r.pk + ' reaches full scale');
  ok(Math.abs(db) <= 2, p.name + ': ' + db.toFixed(1) + ' dB from the app\'s own chord patch');
}

console.log(fails ? fails + ' failed' : 'macro osc: model list matches C++, ' + mine.length + ' patches valid, all ' + models.size + ' models covered');
process.exit(fails ? 1 : 0);
