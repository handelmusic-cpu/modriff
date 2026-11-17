/* The EQ panel's curve: eqResponseDb against the browser's own filters.
   Run: node tests/eq/curve.test.js

   The reference numbers are BiquadFilterNode.getFrequencyResponse (Chrome, 48 kHz)
   for lowshelf 120 Hz, peaking (Q 0.9) and highshelf 8 kHz, the same table
   native/modsynth/eqtest.cpp holds the native EQ to, so the drawing, the web nodes
   and the native EQ all answer to one set of numbers.

   Then tests/eq/refs.json: the five- and six-band EQ (the high-pass and low-pass at
   both slopes and three resonances, the peak's width, the shelves' corners, the second
   peak), recorded from the same browser by tests/eq/record-refs.js, which is also what
   native/modsynth/eqtest.cpp is held to. And the rules for what an EQ is when it is
   saved: optional fields only, missing means default, flat means no entry. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const a = html.indexOf('// ── EQ CURVE ──'), b = html.indexOf('// ── END EQ CURVE ──');
if (a < 0 || b < a) throw new Error('EQ CURVE markers not found in index.html');
const E = vm.runInNewContext(html.slice(a, b) + '\n;({eqBandDb, eqResponseDb, eqNorm, eqMerge, eqFlat, eqPersist, EQ_DEF, EQ_LIM, _eqNat});', {});

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

// ── the five- and six-band EQ against the browser ──
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'refs.json'), 'utf8'));
for (const c of R.cases) {
  let worst = 0;
  R.freqs.forEach((f, i) => { worst = Math.max(worst, Math.abs(E.eqResponseDb(c.model, f, c.sr) - c.db[i])); });
  ok(worst < 0.05, 'curve matches the browser: ' + c.name + ' (worst ' + worst.toFixed(4) + ' dB)');
}

// ── what an EQ is, saved and loaded ──
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
// an old song's EQ (four fields, or fewer) reads as itself with everything new at its default
const old = { lo: 3, mid: -2, midHz: 700, hi: 1.5 };
const n = E.eqNorm(old, true);
ok(n.lo === 3 && n.mid === -2 && n.midHz === 700 && n.hi === 1.5, 'an old EQ keeps its four fields');
ok(n.loHz === 120 && n.hiHz === 8000 && n.midQ === 0.9, 'an old EQ has the shelves at 120 Hz and 8 kHz and the peak at Q 0.9, exactly');
ok(n.hpfOn === 0 && n.lpfOn === 0 && n.mid2 === 0, 'an old EQ has both filters off and no second peak');
ok(same(E.eqPersist(n), old), 'an old EQ saves back as the same four fields, nothing added');
ok(same(E.eqNorm(null, true), E.eqNorm({}, true)) && E.eqFlat(E.eqNorm(undefined, true)), 'nothing saved is flat');
ok(E.eqNorm({ lo: 'x', midHz: null, hpfSlope: 7 }, true).lo === 0, 'a field that is not a number is the default');
ok(E.eqNorm({ midHz: null }, true).midHz === 1000, 'a null is a missing field');
// clamps
const w = E.eqNorm({ lo: 99, loHz: 5, hiHz: 99999, midQ: 100, hpfHz: 1, lpfHz: 1e6, hpfQ: 0, lpfQ: 1e3, hpfSlope: 24.2, lpfSlope: 12, hpfOn: true, lpfOn: 'yes' }, true);
ok(w.lo === 12 && w.loHz === 40 && w.hiHz === 16000 && w.midQ === 8 && w.hpfHz === 20 && w.lpfHz === 20000 && w.hpfQ === 0.5 && w.lpfQ === 10, 'every field is held to its limits');
ok(w.hpfSlope === 24 && w.lpfSlope === 12, 'a slope is 12 or 24');
ok(w.hpfOn === 1 && w.lpfOn === 0, 'on is 0 or 1 ("yes" is not on)');
// a strip has no second peak
ok(E.eqNorm({ mid2: 5 }, false).mid2 === 0 && E.eqNorm({ mid2: 5 }, true).mid2 === 5, 'only the master keeps a second peak');
// persist: a new field only once it has left its default
const moved = E.eqNorm({ lo: 2, hpfOn: 1, hpfHz: 200 }, true);
const pm = E.eqPersist(moved);
ok(pm.hpfOn === 1 && pm.hpfHz === 200 && !('hpfQ' in pm) && !('loHz' in pm) && !('lpfOn' in pm), 'a saved EQ carries only the new fields that moved');
ok(same(E.eqNorm(pm, true), moved), 'save then load gives the same EQ');
// merge: only the fields given
const cur = E.eqNorm({ lo: 4, hpfOn: 1 }, true);
E.eqMerge(cur, { hi: -3, lpfOn: 1, lpfSlope: 24 });
ok(cur.lo === 4 && cur.hpfOn === 1 && cur.hi === -3 && cur.lpfOn === 1 && cur.lpfSlope === 24, 'merge sets what it is given and leaves the rest');
// flat includes the filters
ok(E.eqFlat(E.eqNorm({}, true)), 'defaults are flat');
ok(!E.eqFlat(E.eqNorm({ hpfOn: 1 }, true)) && !E.eqFlat(E.eqNorm({ lpfOn: 1 }, true)), 'a filter on is not flat, even with every gain at 0 dB');
ok(!E.eqFlat(E.eqNorm({ mid2: 3 }, true)), 'a second peak off 0 dB is not flat');
ok(E.eqFlat(E.eqNorm({ loHz: 300, midQ: 2, hpfHz: 400, lpfHz: 3000, hpfSlope: 24 }, true)), 'moving a corner, width or slope alone, with the filters off, is still flat');
// the response of a flat EQ is 0 dB everywhere, whatever its corners
ok(E.eqResponseDb({ loHz: 300, midQ: 2, hpfHz: 400, hpfSlope: 24 }, 1000, 48000) === 0, 'flat with other fields moved is exactly 0 dB');
// the old three-argument calls still work
ok(E.eqResponseDb({ lo: 0, mid: 6, midHz: 1000, hi: 0 }, 1000, 48000) > 5.99, 'a partial EQ (the old four fields) still draws');
// the native names: every key the page posts
const nat = E._eqNat(E.eqNorm({ hpfOn: 1, hpfSlope: 24, mid2: 2 }, true));
ok(nat.eqHpfOn === 1 && nat.eqHpfSlope === 24 && nat.eqLoHz === 120 && nat.eqMid2 === 2 && nat.eqMidQ === 0.9, 'the native parameter names carry the EQ');
// 24 dB is steeper than 12 dB, and resonance adds a peak
const r12 = E.eqResponseDb({ hpfOn: 1, hpfHz: 400, hpfSlope: 12 }, 100, 48000), r24 = E.eqResponseDb({ hpfOn: 1, hpfHz: 400, hpfSlope: 24 }, 100, 48000);
ok(r24 < r12 * 1.8 && r24 < -20 && r12 < -10, '24 dB per octave is about twice the 12 dB at an octave and a half below (' + r12.toFixed(1) + ', ' + r24.toFixed(1) + ' dB)');
ok(E.eqResponseDb({ lpfOn: 1, lpfHz: 3000, lpfQ: 6 }, 3000, 48000) > 12, 'a low-pass at Q 6 peaks at its corner');

console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
