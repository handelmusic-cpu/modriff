/* The native master bus against the browser's own.

   tests/modsynth/master-ref.json is what a browser's Web Audio says to the same
   stimulus: the glue compressor, the limiter, the chain between them and the
   volume, with and without drive, and the bus room's convolver (recorded by
   master-ref.html; its header says how to record it again). native/modsynth/
   mastertest renders the same cases through the C++ bus. Neither is a sample-for-
   sample match and neither is meant to be — DynamicsCompressorNode is
   implementation-defined and the room is a network, not a convolution — so what
   is held is the level: a reading every 10 ms, compared in dB.

   The first 120 ms is left out of the dynamics cases. A browser's offline
   compressor starts cold, with its detector at zero, and fades in over about a
   tenth of a second; the master bus has run in silence long before anything
   plays, so that fade is not behaviour worth copying.

   Run: make -C native/modsynth mastertest && node tests/modsynth/master.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'master-ref.json'), 'utf8'));
const cpp = JSON.parse(execFileSync(path.join(root, 'native/modsynth/mastertest'), { maxBuffer: 1 << 26 }).toString());

let fail = 0, checks = 0;
function ok(c, label, detail) { checks++; if (!c) { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); } }

const WIN0 = 12, WINS = 480, STEP = 60;
const name = s => JSON.stringify(s);

ok(ref.length === cpp.length, 'same number of cases', `${ref.length} recorded, ${cpp.length} rendered`);
for (let ci = 0; ci < ref.length - 1; ci++) {
  const r = ref[ci], c = cpp[ci], label = name(r.spec);
  let max = 0, sum = 0, n = 0, pkMax = 0;
  for (let i = WIN0; i < WINS; i++) {
    const d = Math.abs(r.rmsDb[i] - c.rmsDb[i]);
    max = Math.max(max, d); sum += d; n++;
    // Peaks are only comparable where there is a peak: a window the browser
    // rounds to 0.0000 is silence.
    if (i >= 14 && r.peak[i] > 0.001) pkMax = Math.max(pkMax, Math.abs(20 * Math.log10(r.peak[i] / Math.max(c.peak[i], 1e-9))));
  }
  const drive = !!r.spec.drive;
  // Drive's windows ripple (the oversamplers' filters differ, and the chord's
  // three notes beat through the curve), so it is held on the average per step.
  ok(sum / n < (drive ? 0.5 : 0.1), label + ' mean error', `${(sum / n).toFixed(2)} dB`);
  ok(max < (drive ? 2.5 : 1.0), label + ' worst window', `${max.toFixed(1)} dB`);
  ok(pkMax < 1.0, label + ' peaks', `${pkMax.toFixed(1)} dB`);
  for (let s = 0; s < 8; s++) {
    let a = 0, b = 0, k = 0;
    for (let w = 20; w < 58; w++) { a += Math.pow(10, r.rmsDb[s * STEP + w] / 10); b += Math.pow(10, c.rmsDb[s * STEP + w] / 10); k++; }
    ok(Math.abs(10 * Math.log10(b / a)) < 0.15, label + ` step ${s} level`, `${(10 * Math.log10(b / a)).toFixed(2)} dB`);
  }
}

// The room: 100 ms readings of seeded noise for 2 s, then silence.
{
  const r = ref[ref.length - 1].rmsDb100, c = cpp[cpp.length - 1].rmsDb100;
  const mean = a => a.slice(8, 19).reduce((x, y) => x + y, 0) / 11;
  ok(Math.abs(mean(r) - mean(c)) < 0.5, 'room steady level', `${(mean(c) - mean(r)).toFixed(2)} dB`);
  // 1.2 s after the input stops the tail is still within 4 dB of the convolver.
  let worst = 0;
  for (let i = 20; i < 32; i++) worst = Math.max(worst, Math.abs(r[i] - c[i]));
  ok(worst < 4, 'room tail, first 1.2 s', `${worst.toFixed(1)} dB`);
  // 30 dB down within 0.3 s of the convolver, 40 within 0.6. Not further: where
  // the impulse ends the convolver collapses and the network rings on, so the
  // last 20 dB arrive 1.5 s apart (see MASTER_ROOM_RT60). That is a room that,
  // at the default 5% send, is already 34 dB under the mix.
  const tDown = (a, db) => { const s = mean(a); for (let i = 20; i < a.length; i++) if (a[i] < s - db) return i / 10; return 99; };
  ok(Math.abs(tDown(r, 30) - tDown(c, 30)) < 0.3, 'room -30 dB time', `convolver ${tDown(r, 30)} s, network ${tDown(c, 30)} s`);
  ok(Math.abs(tDown(r, 40) - tDown(c, 40)) < 0.6, 'room -40 dB time', `convolver ${tDown(r, 40)} s, network ${tDown(c, 40)} s`);
}

// Hostile use: random settings moved every few blocks, +6 dBFS noise in both
// groups, block sizes that are not the browser's. Nothing may go non-finite or
// run away, and the whole bus must stay cheap. (maxAbs is high on purpose:
// bypass is neutral settings, and the web does not limit a bypassed bus either.)
{
  const st = JSON.parse(execFileSync(path.join(root, 'native/modsynth/mastertest'), ['stress']).toString());
  ok(st.nonFinite === 0, 'stress: every sample finite', `${st.nonFinite} not`);
  ok(st.maxAbs < 6, 'stress: output stays bounded', `${st.maxAbs}`);
  ok(st.load < 0.05, 'stress: under 5% of a core', `${(st.load * 100).toFixed(2)}%`);
}

console.log(`tests/modsynth/master.test.js: ${fail ? fail + ' FAILED of ' + checks : checks + ' checks, all passed'}`);
process.exit(fail ? 1 : 0);
