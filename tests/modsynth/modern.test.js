/* The Modern bank against the schema: every value a real parameter in range,
   every matrix row a real source and destination, four macros wired on every
   patch, no name shared with the factory library (patches are looked up by
   name, so a clash would silently swap a saved sound).
   Run: node tests/modsynth/modern.test.js */
'use strict';
const MS = require('../../modsynth/params.js');
require('../../modsynth/patches.js');
require('../../modsynth/patches-extra.js');
require('../../modsynth/patches-modern.js');

const S = new Set(MS.MOD_SOURCES.map(x => x[0])), D = new Set(MS.MOD_DESTS.map(x => x[0]));
const old = new Set(MS.FACTORY_PATCHES.map(p => p.name));
let pass = 0, fail = 0;
const bad = msg => { console.log('  ' + msg); fail++; };

MS.MODERN_PATCHES.forEach(p => {
  const before = fail;
  Object.keys(p.values).forEach(k => {
    const q = MS.PARAM[k], v = p.values[k];
    if (!q) return bad(p.name + ': unknown parameter ' + k);
    if (q.type === 'enum') { if (!q.options.some(o => o[0] === v)) bad(p.name + ': ' + k + ' = ' + v + ' is not an option'); }
    else if (q.type !== 'bool' && (v < q.min || v > q.max)) bad(p.name + ': ' + k + ' = ' + v + ' out of range');
  });
  if (p.matrix.length > MS.MATRIX_SLOTS) bad(p.name + ': ' + p.matrix.length + ' matrix rows');
  p.matrix.forEach(r => { if (!S.has(r[0]) || !D.has(r[1])) bad(p.name + ': bad row ' + JSON.stringify(r)); });
  const used = new Set(p.matrix.filter(r => /^m\d$/.test(r[0])).map(r => +r[0][1]));
  for (let m = 1; m <= 4; m++) if (!used.has(m)) bad(p.name + ': macro ' + m + ' is wired to nothing');
  if (!p.macros || p.macros.length < 4) bad(p.name + ': macros are not named');
  if (old.has(p.name)) bad(p.name + ': shares a name with a factory patch');
  if (fail === before) pass++;
});
console.log(`${pass} modern patches valid, ${fail} problems (of ${MS.MODERN_PATCHES.length})`);
process.exit(fail ? 1 : 0);
