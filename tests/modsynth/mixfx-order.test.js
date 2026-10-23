/* The mõdFX chain's parameters travel as positions: the page posts {t:'mfx', i, v}
   and the C++ reads `i` as MixFxParam. A reordered list on either side would
   send every value to the wrong knob, silently. This reads both and compares.
   Run: node tests/modsynth/mixfx-order.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

const hdr = fs.readFileSync(path.join(root, 'native/modsynth/mixfx.h'), 'utf8');
const body = hdr.slice(hdr.indexOf('enum MixFxParam'), hdr.indexOf('};', hdr.indexOf('enum MixFxParam')));
const names = [...body.matchAll(/\bMFX_([A-Z0-9_]+)/g)].map(m => m[1]).filter(n => n !== 'COUNT');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/var MFX_PARAMS = \[([\s\S]*?)\];/);
const js = m ? [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map(x => x[1]) : [];

// 'lpHz' ↔ LP_HZ, 'drvAmt' ↔ DRV_AMT, 'fmt1Hz' ↔ FMT1_HZ: camelCase, upper-cased with _ at the humps.
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

let fail = 0;
function ok(c, label, detail) { if (!c) { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); } }
ok(js.length > 0, 'MFX_PARAMS found in index.html');
ok(names.length === js.length, 'same number of parameters', `${names.length} in C++, ${js.length} in the page`);
for (let i = 0; i < Math.max(names.length, js.length); i++) {
  // The C++ names a few by what they do rather than the page's key.
  const want = names[i], got = js[i] && snake(js[i]);
  ok(want === got, `parameter ${i}`, `C++ ${want}, page ${got}`);
}
console.log(`tests/modsynth/mixfx-order.test.js: ${fail ? fail + ' FAILED' : names.length + ' parameters in the same order'}`);
process.exit(fail ? 1 : 0);
