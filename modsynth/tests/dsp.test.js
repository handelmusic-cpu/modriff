/* DSP core behaviour tests. Run: node tests/dsp.test.js */
'use strict';
const { makeSynth, peak, rms, hasBadSample, estimateFreq, magnitudeAt } = require('./harness');
const MS = require('../js/params.js');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}
function section(name) { console.log('\n' + name); }

/* ── Every wavetable produces clean, band-limited audio ──────────────────── */
section('wavetables');
for (const [id, label] of MS.WAVES) {
  for (const shape of [0, 0.33, 0.67, 1]) {
    const s = makeSynth();
    s.set('osc1.wave', id).set('osc1.shape', shape).set('flt1.model', 'bypass').set('voice.drift', 0);
    s.noteOn(60, 1);
    const { L } = s.render(30);
    const tail = L.subarray(1500);
    ok(!hasBadSample(L), `${label} shape=${shape}: finite`);
    ok(rms(tail) > 0.002, `${label} shape=${shape}: audible`, 'rms=' + rms(tail).toFixed(5));
    ok(peak(L) < 1.2, `${label} shape=${shape}: bounded`, 'peak=' + peak(L).toFixed(3));
  }
}

/* Aliasing: a saw at the top of the keyboard should have nothing meaningful
   below its own fundamental. */
{
  const s = makeSynth();
  s.set('osc1.wave', 'classic').set('osc1.shape', 2 / 3).set('flt1.model', 'bypass').set('voice.drift', 0);
  s.noteOn(105, 1);                       // A7 ≈ 3520 Hz
  const b = s.render(60).L.subarray(3000);
  const fund = magnitudeAt(b, 3520, 48000);
  let worst = 0;
  for (let f = 100; f < 3300; f += 37) worst = Math.max(worst, magnitudeAt(b, f, 48000));
  const db = 20 * Math.log10(worst / fund);
  ok(db < -30, 'saw at A7: alias floor below −30 dB', db.toFixed(1) + ' dB');
}

/* ── Pitch accuracy ─────────────────────────────────────────────────────── */
section('pitch');
for (const [note, hz] of [[57, 220], [69, 440], [81, 880]]) {
  const s = makeSynth();
  s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass').set('voice.drift', 0);
  s.noteOn(note, 1);
  const f = estimateFreq(s.render(60).L.subarray(2000), 48000);
  ok(Math.abs(f - hz) / hz < 0.01, `note ${note} → ${hz} Hz`, f.toFixed(2));
}

/* Transpose and fine tune move pitch the right way and the right amount. */
{
  const s = makeSynth();
  s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass')
   .set('voice.drift', 0).set('voice.transpose', 12);
  s.noteOn(69, 1);
  const f = estimateFreq(s.render(60).L.subarray(2000), 48000);
  ok(Math.abs(f - 880) / 880 < 0.01, 'transpose +12 → 880 Hz', f.toFixed(2));
}

/* ── Filters ────────────────────────────────────────────────────────────── */
section('filters');
for (const [id, label] of MS.FILTER_MODELS) {
  const s = makeSynth();
  s.set('flt1.model', id).set('flt1.cutoff', 1200).set('flt1.res', 0.7).set('flt1.drive', 0.5);
  s.noteOn(48, 1);
  const { L } = s.render(40);
  ok(!hasBadSample(L), `${label}: finite`);
  ok(peak(L) < 4, `${label}: bounded`, 'peak=' + peak(L).toFixed(3));
  if (id !== 'bypass') ok(rms(L.subarray(1500)) > 0.0005, `${label}: passes signal`, 'rms=' + rms(L.subarray(1500)).toFixed(5));
}

/* Self-oscillation at max resonance must stay finite rather than blow up. */
for (const id of ['ladder4', 'ladder2', 'diode', 'svfLP', 'svfBP']) {
  const s = makeSynth();
  s.set('flt1.model', id).set('flt1.cutoff', 800).set('flt1.res', 1).set('flt1.drive', 1);
  s.noteOn(36, 1);
  const { L } = s.render(120);
  ok(!hasBadSample(L) && peak(L) < 10, `${id}: stable at full resonance`, 'peak=' + peak(L).toFixed(2));
}

/* A lowpass well below the fundamental should measurably reduce level. */
{
  const open = makeSynth();
  open.set('flt1.model', 'ladder4').set('flt1.cutoff', 18000).set('flt1.res', 0);
  open.noteOn(60, 1);
  const a = rms(open.render(40).L.subarray(1500));
  const shut = makeSynth();
  shut.set('flt1.model', 'ladder4').set('flt1.cutoff', 90).set('flt1.res', 0);
  shut.noteOn(60, 1);
  const b = rms(shut.render(40).L.subarray(1500));
  ok(b < a * 0.5, 'ladder4 lowpass attenuates', `open=${a.toFixed(4)} shut=${b.toFixed(4)}`);
}

/* ── Envelopes ──────────────────────────────────────────────────────────── */
section('envelopes');
{
  // A long attack must not be at full level immediately.
  const s = makeSynth();
  s.set('env1.a', 0.5).set('env1.d', 4).set('env1.s', 1).set('flt1.model', 'bypass');
  s.noteOn(60, 1);
  const { L } = s.render(200);
  const early = rms(L.subarray(0, 1000));
  const late = rms(L.subarray(20000, 24000));
  ok(early < late * 0.35, 'attack ramps in', `early=${early.toFixed(4)} late=${late.toFixed(4)}`);
}
{
  // Release must actually silence the voice, and the voice must be recycled.
  const s = makeSynth();
  s.set('env1.r', 0.05).set('flt1.model', 'bypass');
  s.noteOn(60, 1);
  s.render(20);
  s.noteOff(60);
  s.render(80);
  const tail = s.render(40).L;
  ok(rms(tail) < 1e-5, 'release silences the voice', 'rms=' + rms(tail).toExponential(2));
  ok(s.proc.voices.filter(v => v.active).length === 0, 'voice returned to the pool');
}
{
  // Sustain level should be respected.
  const s = makeSynth();
  s.set('env1.a', 0.001).set('env1.d', 0.02).set('env1.s', 0.25).set('flt1.model', 'bypass').set('voice.velAmt', 0);
  s.noteOn(60, 1);
  const a = rms(s.render(60).L.subarray(4000));
  const s2 = makeSynth();
  s2.set('env1.a', 0.001).set('env1.d', 0.02).set('env1.s', 1).set('flt1.model', 'bypass').set('voice.velAmt', 0);
  s2.noteOn(60, 1);
  const b = rms(s2.render(60).L.subarray(4000));
  ok(Math.abs(a / b - 0.25) < 0.06, 'sustain 0.25 is a quarter of sustain 1.0', (a / b).toFixed(3));
}

/* ── Voice allocation ───────────────────────────────────────────────────── */
section('voices');
{
  const s = makeSynth();
  s.set('voice.poly', 4);
  [60, 62, 64, 65, 67, 69].forEach(n => s.noteOn(n, 0.8));
  s.render(10);
  ok(s.proc.voices.filter(v => v.active).length <= 4, 'polyphony limit respected');
}
{
  const s = makeSynth();
  s.noteOn(60, 0.8); s.noteOn(60, 0.8); s.noteOn(60, 0.8);
  s.render(10);
  ok(s.proc.voices.filter(v => v.active).length === 1, 'repeated note reuses one voice');
}
{
  const s = makeSynth();
  s.set('voice.mode', 'mono');
  s.noteOn(60, 0.8); s.noteOn(64, 0.8); s.noteOn(67, 0.8);
  s.render(10);
  ok(s.proc.voices.filter(v => v.active).length === 1, 'mono mode plays one voice');
  s.noteOff(67);
  s.render(10);
  ok(s.proc.voices[0].note === 64, 'mono falls back to the held note', String(s.proc.voices[0].note));
}
{
  const s = makeSynth();
  s.send({ t: 'sustain', v: 1 });
  s.noteOn(60, 0.8);
  s.noteOff(60);
  s.render(20);
  ok(s.proc.voices[0].active && s.proc.voices[0].pedal, 'sustain pedal holds the note');
  s.send({ t: 'sustain', v: 0 });
  s.render(200);
  ok(!s.proc.voices[0].active, 'releasing the pedal frees the note');
}
{
  const s = makeSynth();
  [60, 64, 67].forEach(n => s.noteOn(n, 0.8));
  s.render(5);
  s.send({ t: 'panic' });
  const { L } = s.render(10);
  ok(rms(L) === 0 && s.proc.voices.every(v => !v.active), 'panic stops everything');
}

/* ── Pitch bend and mod wheel ───────────────────────────────────────────── */
section('bend / wheel');
{
  const s = makeSynth();
  s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass')
   .set('voice.drift', 0).set('voice.bendUp', 12);
  s.noteOn(69, 1);
  s.send({ t: 'bend', v: 1 });
  const f = estimateFreq(s.render(60).L.subarray(3000), 48000);
  ok(Math.abs(f - 880) / 880 < 0.02, 'bend +1 with 12-semitone range → 880 Hz', f.toFixed(1));
}
{
  const s = makeSynth();
  s.set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass').set('voice.drift', 0);
  s.noteOn(69, 1);
  s.send({ t: 'bend', v: -1 });          // default range is 2 semitones down
  const f = estimateFreq(s.render(60).L.subarray(3000), 48000);
  const want = 440 * Math.pow(2, -2 / 12);
  ok(Math.abs(f - want) / want < 0.02, 'bend −1 with default range', f.toFixed(1) + ' want ' + want.toFixed(1));
}
{
  // Mod wheel through the matrix to filter cutoff must open the filter.
  const s = makeSynth();
  s.set('flt1.model', 'ladder4').set('flt1.cutoff', 150).set('flt1.res', 0);
  s.send({ t: 'matrix', rows: [{ s: MS.MOD_SOURCES.findIndex(x => x[0] === 'mw'), d: MS.MOD_DESTS.findIndex(x => x[0] === 'flt1.cutoff'), a: 0.7, u: 0 }] });
  s.noteOn(48, 1);
  const closed = rms(s.render(40).L.subarray(1500));
  s.send({ t: 'mw', v: 1 });
  const opened = rms(s.render(40).L);
  ok(opened > closed * 1.5, 'mod wheel → cutoff opens the filter', `${closed.toFixed(4)} → ${opened.toFixed(4)}`);
}

/* ── Macros ─────────────────────────────────────────────────────────────── */
section('macros');
{
  const s = makeSynth();
  s.set('flt1.model', 'ladder4').set('flt1.cutoff', 150);
  s.send({ t: 'matrix', rows: [{ s: MS.MOD_SOURCES.findIndex(x => x[0] === 'm1'), d: MS.MOD_DESTS.findIndex(x => x[0] === 'flt1.cutoff'), a: 0.8, u: 0 }] });
  s.noteOn(48, 1);
  const a = rms(s.render(40).L.subarray(1500));
  s.set('macro.1', 1);
  const b = rms(s.render(40).L);
  ok(b > a * 1.5, 'macro 1 → cutoff', `${a.toFixed(4)} → ${b.toFixed(4)}`);
}

/* ── LFOs, motion, mod matrix ───────────────────────────────────────────── */
section('modulation');
for (const [id, label] of MS.LFO_SHAPES) {
  const s = makeSynth();
  s.set('lfo1.shape', id).set('lfo1.rate', 6).set('flt1.model', 'ladder4').set('flt1.cutoff', 600);
  s.send({ t: 'matrix', rows: [{ s: 4, d: MS.MOD_DESTS.findIndex(x => x[0] === 'flt1.cutoff'), a: 0.6, u: 0 }] });
  s.noteOn(48, 1);
  const { L } = s.render(60);
  ok(!hasBadSample(L) && peak(L) < 4, `LFO ${label}: stable`);
}
{
  // A motion lane must actually move the destination.
  const s = makeSynth();
  const steps = new Float32Array(16);
  for (let i = 0; i < 16; i++) steps[i] = i % 2 ? 1 : -1;
  s.set('mot1.on', 1).set('mot1.sync', 0).set('mot1.rate', 12)
   .set('flt1.model', 'ladder4').set('flt1.cutoff', 700);
  s.send({ t: 'motion', lane: 0, steps });
  s.send({ t: 'matrix', rows: [{ s: MS.MOD_SOURCES.findIndex(x => x[0] === 'mot1'), d: MS.MOD_DESTS.findIndex(x => x[0] === 'flt1.cutoff'), a: 0.9, u: 0 }] });
  s.noteOn(40, 1);
  const { L } = s.render(200);
  // Compare the loudness of successive slices; a stepped filter should vary.
  const slices = [];
  for (let i = 0; i < 8; i++) slices.push(rms(L.subarray(4000 + i * 2000, 6000 + i * 2000)));
  const spread = Math.max(...slices) / (Math.min(...slices) + 1e-9);
  ok(spread > 1.4, 'motion lane moves the filter', 'spread=' + spread.toFixed(2));
  ok(!hasBadSample(L), 'motion lane: finite');
}
{
  // Every destination should be reachable without producing garbage.
  MS.MOD_DESTS.forEach(([id], di) => {
    if (di === 0) return;
    const s = makeSynth();
    s.send({ t: 'matrix', rows: [{ s: 4, d: di, a: 0.8, u: 0 }] });   // LFO 1 → dest
    s.set('lfo1.rate', 8);
    s.noteOn(60, 0.9);
    const { L } = s.render(40);
    ok(!hasBadSample(L) && peak(L) < 6, `dest ${id}: stable`, 'peak=' + peak(L).toFixed(2));
  });
}

/* ── Oscillator features ────────────────────────────────────────────────── */
section('oscillators');
{
  const s = makeSynth();
  s.set('osc2.on', 1).set('osc2.level', 0.9).set('mix.fm', 0.7).set('osc2.ratio', 1).set('osc2.semi', 12);
  s.noteOn(48, 1);
  const { L } = s.render(40);
  ok(!hasBadSample(L) && peak(L) < 3, 'FM: stable', 'peak=' + peak(L).toFixed(3));
}
{
  const s = makeSynth();
  s.set('osc2.on', 1).set('osc2.level', 0.9).set('osc2.sync', 1).set('osc2.semi', 7);
  s.noteOn(48, 1);
  const { L } = s.render(40);
  ok(!hasBadSample(L) && rms(L) > 0.005, 'hard sync: audible and finite');
}
{
  const s = makeSynth();
  s.set('osc2.on', 1).set('osc2.level', 0.9).set('mix.ring', 1).set('osc2.semi', 5);
  s.noteOn(48, 1);
  const { L } = s.render(40);
  ok(!hasBadSample(L) && rms(L) > 0.005, 'ring mod: audible and finite');
}
{
  // PWM at two widths must give measurably different spectra.
  const mk = pw => {
    const s = makeSynth();
    s.set('osc1.wave', 'pulse').set('osc1.pw', pw).set('flt1.model', 'bypass').set('voice.drift', 0);
    s.noteOn(45, 1);
    return s.render(50).L.subarray(2000);
  };
  const a = mk(0.5), b = mk(0.12);
  const f0 = 110;
  const evenA = magnitudeAt(a, f0 * 2, 48000), evenB = magnitudeAt(b, f0 * 2, 48000);
  ok(evenA < evenB * 0.25, 'PWM: 50% duty suppresses the 2nd harmonic', `${evenA.toFixed(4)} vs ${evenB.toFixed(4)}`);
}
for (const [id, label] of MS.NOISE_TYPES) {
  const s = makeSynth();
  s.set('mix.noise', 0.8).set('mix.noiseType', id).set('osc1.level', 0).set('flt1.model', 'bypass');
  s.noteOn(60, 1);
  const { L } = s.render(40);
  ok(!hasBadSample(L) && rms(L) > 1e-4, `noise ${label}: audible and finite`, 'rms=' + rms(L).toFixed(5));
}
{
  const s = makeSynth();
  s.set('mix.sub', 0.9).set('osc1.level', 0).set('flt1.model', 'bypass').set('mix.subWave', 'sine');
  s.noteOn(69, 1);
  const f = estimateFreq(s.render(60).L.subarray(2000), 48000);
  ok(Math.abs(f - 220) / 220 < 0.02, 'sub oscillator is an octave down', f.toFixed(1));
}
{
  // Unison should widen the stereo image.
  const s = makeSynth();
  s.set('osc1.uni', 7).set('osc1.detune', 30).set('osc1.width', 1).set('flt1.model', 'bypass');
  s.noteOn(48, 1);
  const { L, R } = s.render(60);
  let diff = 0;
  for (let i = 3000; i < L.length; i++) diff += Math.abs(L[i] - R[i]);
  ok(diff / (L.length - 3000) > 0.005, 'unison produces stereo width', (diff / (L.length - 3000)).toFixed(4));
}

/* ── Glide ──────────────────────────────────────────────────────────────── */
section('glide');
{
  const s = makeSynth();
  s.set('voice.mode', 'legato').set('voice.glide', 0.3)
   .set('osc1.wave', 'classic').set('osc1.shape', 0).set('flt1.model', 'bypass').set('voice.drift', 0);
  s.noteOn(60, 1);
  s.render(40);
  s.noteOn(72, 1);
  const early = estimateFreq(s.render(8).L, 48000);
  const late = estimateFreq(s.render(120).L.subarray(8000), 48000);
  ok(early < late * 0.85, 'glide slides up rather than jumping', `${early.toFixed(0)} → ${late.toFixed(0)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
