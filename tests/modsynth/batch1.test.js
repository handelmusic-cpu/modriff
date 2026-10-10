/* Batch 1 sound sources — measured, not listened to.
   PD / Metal / Chip / Hollow tables, oscillator phase feedback, and the
   Karplus–Strong pluck: each sounds, is finite, is in tune where it has a
   pitch, and does what its knob says. Plus the cost of using them.
   Run: node tests/modsynth/batch1.test.js */
'use strict';
const { makeSynth, peak, rms, hasBadSample } = require('./harness');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };

// Brightness: RMS of the first difference over RMS of the signal. The
// difference weights each partial by its frequency, so it rises with
// harmonic content where a zero-crossing count only follows the fundamental.
const zc = x => { let d = 0, e = 0; for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] * x[i]; } return 1000 * Math.sqrt(d / e); };
// Period by autocorrelation, searched between lo and hi samples.
function period(x, lo, hi) {
  let best = 0, bl = lo;
  for (let l = lo; l <= hi; l++) { let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; if (s > best) { best = s; bl = l; } }
  return bl;
}

// 1. Every new wave, at three shape positions.
['czsaw', 'czres', 'czpulse', 'metal', 'chip', 'hollow'].forEach(w => {
  [0, 0.5, 1].forEach(sh => {
    const s = makeSynth();
    s.set('osc1.wave', w).set('osc1.shape', sh).set('flt1.model', 'bypass');
    s.noteOn(57, 0.9);
    const { L } = s.render(60);
    const pk = peak(L), r = rms(L.subarray(4000));
    ok(!hasBadSample(L), w + ' @' + sh + ' is finite');
    ok(r > 0.005 && pk < 2, w + ' @' + sh + ' level rms=' + r.toFixed(4) + ' peak=' + pk.toFixed(2));
  });
});

// 2. The PD sweep brightens as Shape rises.
{
  const zcs = [0, 1].map(sh => {
    const s = makeSynth(); s.set('osc1.wave', 'czsaw').set('osc1.shape', sh).set('flt1.model', 'bypass');
    s.noteOn(45, 0.9); const { L } = s.render(60); return zc(L.subarray(3000));
  });
  ok(zcs[1] > zcs[0] * 1.5, 'PD Saw brightens with shape (' + zcs.map(Math.round).join(' → ') + ')');
}

// 3. Feedback brightens a sine, and stays finite at full.
{
  const zcs = [0, 0.5, 1].map(fb => {
    const s = makeSynth(); s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('osc1.fb', fb).set('flt1.model', 'bypass');
    s.noteOn(45, 0.9); const { L } = s.render(60);
    ok(!hasBadSample(L) && peak(L) < 2, 'feedback ' + fb + ' finite');
    return zc(L.subarray(3000));
  });
  ok(zcs[1] > zcs[0] * 1.3 && zcs[2] > zcs[1], 'feedback brightens (' + zcs.map(Math.round).join(' → ') + ')');
}

// 4. Pluck: in tune at three pitches, and Decay sets its length.
[45, 57, 69].forEach(note => {
  const s = makeSynth(); s.set('osc1.on', 0).set('mix.pluck', 1).set('flt1.model', 'bypass').set('env1.s', 1).set('env1.r', 2);
  s.noteOn(note, 0.9); const { L } = s.render(40);
  const f0 = 440 * Math.pow(2, (note - 69) / 12), T = 48000 / f0;
  const p = period(L.subarray(1500, 5500), Math.floor(T * 0.8), Math.ceil(T * 1.25));
  ok(Math.abs(p - T) / T < 0.02, 'pluck note ' + note + ' period ' + p + ' vs ' + T.toFixed(1));
});
{
  const tail = d => {
    const s = makeSynth(); s.set('osc1.on', 0).set('mix.pluck', 1).set('pluck.decay', d).set('flt1.model', 'bypass').set('env1.s', 1).set('env1.r', 4);
    s.noteOn(57, 0.9); const { L } = s.render(375);       // 1 s
    return rms(L.subarray(38000, 48000)) / rms(L.subarray(500, 5000));
  };
  const short = tail(0.1), long = tail(0.9);
  ok(long > short * 20, 'pluck decay: 1 s tail ratio ' + short.toExponential(1) + ' → ' + long.toExponential(1));
}

// 5. Cost: a 6-note chord with pluck + feedback on both oscillators vs plain.
{
  const run = extra => {
    const s = makeSynth(); s.set('osc2.on', 1).set('osc2.level', 0.6).set('osc1.uni', 2).set('osc2.uni', 2);
    extra(s); [48, 52, 55, 59, 62, 64].forEach(n => s.noteOn(n, 0.8));
    s.render(50);
    const t0 = process.hrtime.bigint(); s.render(1500); return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const best = f => Math.min(run(f), run(f), run(f));
  const base = best(() => {});
  const full = best(s => s.set('osc1.fb', 0.6).set('osc2.fb', 0.4).set('mix.pluck', 0.8));
  const rt = 1500 * 128 / 48000 * 1000;
  console.log('  cost: plain ' + (base / rt).toFixed(3) + ' of real time, with pluck+feedback ' + (full / rt).toFixed(3));
  ok(full < base * 1.6, 'pluck + feedback cost ' + (full / base).toFixed(2) + '× plain');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
