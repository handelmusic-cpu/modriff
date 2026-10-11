/* Batch 3 — Osc 3, FM from Osc 3, the Chaos source and matrix Via, measured
   on the real DSP. Run: node tests/modsynth/batch3.test.js */
'use strict';
const { makeSynth, peak, rms, hasBadSample } = require('./harness');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const bright = x => { let d = 0, e = 0; for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] * x[i]; } return 1000 * Math.sqrt(d / e); };
const MS = require('../../modsynth/params.js');
const SRC = id => MS.MOD_SOURCES.findIndex(s => s[0] === id);
const DST = id => MS.MOD_DESTS.findIndex(d => d[0] === id);

// Sines through no filter, so every added partial is the feature's doing.
const sine = s => s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass')
  .set('osc2.wave', 'classic').set('osc2.shape', 0).set('osc3.wave', 'classic').set('osc3.shape', 0);
const tail = s => { s.noteOn(48, 0.9); return s.render(60).L.subarray(3000); };

// Osc 3 is heard when on, and is silent and free when off.
{
  const a = makeSynth(); sine(a); a.set('osc1.on', 0);
  const off = tail(a);
  const b = makeSynth(); sine(b); b.set('osc1.on', 0).set('osc3.on', 1).set('osc3.level', 0.8);
  const on = tail(b);
  ok(rms(off) < 1e-6, 'osc 1 off, osc 3 off: silent (' + rms(off).toExponential(1) + ')');
  ok(rms(on) > 0.01 && !hasBadSample(on), 'osc 3 alone sounds (' + rms(on).toFixed(3) + ')');
  // An octave up on osc 3 alone measures twice the zero crossings of osc 1.
  const zc = x => { let n = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n; };
  const c = makeSynth(); sine(c); const z1 = zc(tail(c));
  const d = makeSynth(); sine(d); d.set('osc1.on', 0).set('osc3.on', 1).set('osc3.level', 0.8).set('osc3.oct', 1);
  const z3 = zc(tail(d));
  ok(Math.abs(z3 / z1 - 2) < 0.05, 'osc 3 octave tracks pitch (×' + (z3 / z1).toFixed(2) + ')');
}

// FM 3→1 brightens osc 1; FM 3→2 brightens osc 2, and so (via FM 2→1) osc 1.
{
  const b0 = (() => { const s = makeSynth(); sine(s); return bright(tail(s)); })();
  const b31 = (() => { const s = makeSynth(); sine(s); s.set('osc3.oct', 1).set('mix.fm3a', 0.6); return bright(tail(s)); })();
  ok(b31 > b0 * 1.5, 'FM 3→1 adds partials (' + Math.round(b0) + ' → ' + Math.round(b31) + ')');
  const chain = fm3b => { const s = makeSynth(); sine(s); s.set('osc2.ratio', 1).set('mix.fm', 0.4).set('osc3.oct', 2).set('mix.fm3b', fm3b); return bright(tail(s)); };
  const c0 = chain(0), c1 = chain(0.6);
  ok(c1 > c0 * 1.2, 'FM 3→2→1 chain is brighter than 2→1 alone (' + Math.round(c0) + ' → ' + Math.round(c1) + ')');
  // The FM 3 destination moves both routes.
  const s = makeSynth(); sine(s); s.set('osc3.oct', 1).set('mix.fm3a', 0.05);
  s.send({ t: 'matrix', rows: [{ s: SRC('m1'), d: DST('mix.fm3'), a: 0.8, u: 0, v: 0 }] }).set('macro.1', 1);
  ok(bright(tail(s)) > b0 * 1.5, 'FM 3 destination drives the operator');
}

// Chaos: per note, bounded, smooth, and different note to note.
{
  const s = makeSynth(); s.set('chaos.rate', 2);
  s.send({ t: 'matrix', rows: [{ s: SRC('chaos'), d: DST('pan'), a: 0.0001, u: 0, v: 0 }] });
  s.noteOn(48, 0.8).noteOn(55, 0.8);
  const v0 = s.proc.voices.filter(v => v.active);
  const a = [], b = [];
  for (let k = 0; k < 600; k++) { s.render(1); a.push(v0[0].src[SRC('chaos')]); b.push(v0[1].src[SRC('chaos')]); }
  const range = x => Math.max(...x) - Math.min(...x);
  let jump = 0; for (let i = 1; i < a.length; i++) jump = Math.max(jump, Math.abs(a[i] - a[i - 1]));
  let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  ok(range(a) > 0.2, 'chaos wanders (range ' + range(a).toFixed(2) + ' over 1.6 s)');
  ok(Math.max(...a.map(Math.abs)) <= 1, 'chaos stays within ±1');
  ok(jump < 0.05, 'chaos never jumps (largest step ' + jump.toFixed(3) + ' per block)');
  ok(diff / a.length > 0.05, 'two notes wander apart (' + (diff / a.length).toFixed(2) + ')');
  // Unused, it isn't computed at all.
  const q = makeSynth(); q.noteOn(48, 0.8); q.render(20);
  ok(q.proc.voices[0].src[SRC('chaos')] === 0, 'chaos idle when nothing reads it');
}

// Via: LFO → Amp via macro 1. Macro at 0 is a still note; at 1 it tremolos.
{
  const trem = m => {
    const s = makeSynth(); sine(s); s.set('lfo1.rate', 6).set('lfo1.depth', 1);
    s.send({ t: 'matrix', rows: [{ s: SRC('lfo1'), d: DST('amp'), a: -0.8, u: 0, v: SRC('m1') }] }).set('macro.1', m);
    // A440 and windows of exactly ten cycles, so the window itself adds no
    // ripple; past the decay, so the envelope adds none either.
    s.noteOn(69, 0.9); const L = s.render(300).L.subarray(24000);
    const W = Math.round(48000 / 440 * 10);
    const env = []; for (let i = 0; i + W <= L.length; i += W) env.push(rms(L.subarray(i, i + W)));
    return (Math.max(...env) - Math.min(...env)) / Math.max(...env);
  };
  const t0 = trem(0), t5 = trem(0.5), t1 = trem(1);
  ok(t0 < 0.05, 'via at 0 mutes the route (swing ' + t0.toFixed(3) + ')');
  ok(t5 > t0 + 0.1 && t1 > t5, 'via scales it (0.5 → ' + t5.toFixed(2) + ', 1 → ' + t1.toFixed(2) + ')');
}

// Cost, on a six-note chord: the third oscillator and the FM chain.
{
  const run = extra => { const s = makeSynth(); s.set('osc1.uni', 2).set('osc2.on', 1).set('osc2.level', 0.5).set('osc2.uni', 2); extra(s);
    [48, 52, 55, 59, 62, 64].forEach(n => s.noteOn(n, 0.8)); s.render(50);
    const t0 = process.hrtime.bigint(); s.render(1500); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const best = f => Math.min(run(f), run(f), run(f));
  const rt = 1500 * 128 / 48000 * 1000;
  const a = best(() => {}), b = best(s => s.set('osc3.on', 1).set('osc3.level', 0.5).set('osc3.uni', 2)),
        c = best(s => s.set('mix.fm3a', 0.4));
  console.log('  cost: two osc ' + (a / rt).toFixed(3) + ', three osc ' + (b / rt).toFixed(3) + ', two osc + osc 3 as FM ' + (c / rt).toFixed(3) + ' of real time');
  ok(b / a < 1.45, 'a third oscillator costs less than half again');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
