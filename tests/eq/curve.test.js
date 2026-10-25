/* The EQ panel's curve: eqResponseDb against the browser's own filters.
   Run: node tests/eq/curve.test.js

   The reference numbers are BiquadFilterNode.getFrequencyResponse (Chrome, 48 kHz)
   for lowshelf 120 Hz, peaking (Q 0.9) and highshelf 8 kHz, the same table
   native/modsynth/eqtest.cpp holds the native EQ to, so the drawing, the web nodes
   and the native EQ all answer to one set of numbers. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const a = html.indexOf('// ── EQ CURVE ──'), b = html.indexOf('// ── END EQ CURVE ──');
if (a < 0 || b < a) throw new Error('EQ CURVE markers not found in index.html');
const E = vm.runInNewContext(html.slice(a, b) + '\n;({eqBandDb, eqResponseDb});', {});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const F = [40, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];
const REFS = [
  ['low shelf +9',     { lo: 9, mid: 0, midHz: 1000, hi: 0 },   [8.87, 4.5, 0.524, 0.035, 0.002, 0, 0, 0, 0, 0]],
  ['peak +6 at 1 kHz', { lo: 0, mid: 6, midHz: 1000, hi: 0 },   [0.013, 0.116, 0.513, 2.152, 6, 2.137, 0.492, 0.104, 0.034, 0.011]],
  ['peak -8 at 3 kHz', { lo: 0, mid: -8, midHz: 3000, hi: 0 },  [-0.002, -0.018, -0.077, -0.309, -1.252, -4.987, -6.069, -1.37, -0.452, -0.15]],
  ['high shelf +10',   { lo: 0, mid: 0, midHz: 1000, hi: 10 },  [0, 0, 0, 0, 0.002, 0.033, 0.531, 5, 8.842, 9.851]],
  ['all three',        { lo: -6, mid: 4, midHz: 500, hi: -5 },  [-5.888, -2.695, 1.103, 3.979, 1.421, 0.314, -0.155, -2.484, -4.475, -4.934]],
];
for (const [name, e, want] of REFS) {
  let worst = 0;
  F.forEach((f, i) => { worst = Math.max(worst, Math.abs(E.eqResponseDb(e, f, 48000) - want[i])); });
  ok(worst < 0.05, 'curve matches the browser: ' + name + ' (worst ' + worst.toFixed(4) + ' dB)');
}
ok(E.eqResponseDb({ lo: 0, mid: 0, midHz: 1000, hi: 0 }, 1000, 48000) === 0, 'flat is exactly 0 dB');
ok(E.eqResponseDb({ lo: 12, mid: 0, midHz: 1000, hi: 0 }, 20, 44100) > 11, 'a +12 low shelf is nearly +12 at 20 Hz, at 44.1 kHz too');
console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
