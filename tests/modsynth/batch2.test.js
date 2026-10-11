/* Batch 2 — pre-filter drive and filter spread, measured on the real DSP.
   (Grit is in the native FX rack and is measured in the browser.)
   Run: node tests/modsynth/batch2.test.js */
'use strict';
const { makeSynth, peak, rms, hasBadSample } = require('./harness');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const bright = x => { let d = 0, e = 0; for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] * x[i]; } return 1000 * Math.sqrt(d / e); };

// A sine, so every added partial is the drive's doing.
const base = s => s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass');
const b0 = (() => { const s = makeSynth(); base(s); s.noteOn(45, 0.9); return bright(s.render(60).L.subarray(3000)); })();
['soft', 'asym', 'fold', 'rect'].forEach(t => {
  const s = makeSynth(); base(s); s.set('mix.drive', 0.8).set('mix.driveType', t);
  s.noteOn(45, 0.9); const { L } = s.render(60);
  const b = bright(L.subarray(3000));
  ok(!hasBadSample(L) && peak(L) < 2, t + ' finite, peak ' + peak(L).toFixed(2));
  ok(b > b0 * 1.5, t + ' adds harmonics (' + Math.round(b0) + ' → ' + Math.round(b) + ')');
});

// Spread: one mono saw through a resonant low-pass; L and R must differ, and
// more with more spread. Off, they are identical.
const lrDiff = sp => {
  const s = makeSynth(); s.set('osc1.wave', 'classic').set('osc1.shape', 0.66).set('flt1.model', 'ladder4')
    .set('flt1.cutoff', 900).set('flt1.res', 0.3).set('flt.spread', sp);
  s.noteOn(45, 0.9); const { L, R } = s.render(60);
  const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = L[i] - R[i];
  return rms(d.subarray(3000)) / rms(L.subarray(3000));
};
const d0 = lrDiff(0), d5 = lrDiff(0.5), d1 = lrDiff(1);
ok(d0 < 1e-6, 'no spread: L = R (' + d0.toExponential(1) + ')');
ok(d5 > 0.1 && d1 > d5, 'spread widens: 0.5 → ' + d5.toFixed(2) + ', 1 → ' + d1.toFixed(2));

// Cost: chord with drive + spread vs plain.
{
  const run = extra => { const s = makeSynth(); s.set('osc1.uni', 2); extra(s); [48, 52, 55, 59, 62, 64].forEach(n => s.noteOn(n, 0.8)); s.render(50);
    const t0 = process.hrtime.bigint(); s.render(1500); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const best = f => Math.min(run(f), run(f), run(f));
  const a = best(() => {}), b = best(s => s.set('mix.drive', 0.6).set('mix.driveType', 'asym').set('flt.spread', 0.5));
  const rt = 1500 * 128 / 48000 * 1000;
  console.log('  cost: plain ' + (a / rt).toFixed(3) + ', drive + spread ' + (b / rt).toFixed(3) + ' of real time');
  ok(b < a * 1.8, 'drive + spread cost ' + (b / a).toFixed(2) + '×');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
