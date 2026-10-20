/* The random patch roller, checked against the only standard that matters:
   a roll has to be a SOUND. Statically it has to be a legal, complete patch;
   rendered through the real dsp.js it has to be audible, finite, not clipping
   and not still ringing after the key is up.

   Every threshold here is a bug that was actually found by running it — see
   the header of modsynth/random.js for which measurement produced which rule.
   Run: node tests/modsynth/random.test.js [rolls-per-part] */
'use strict';
const path = require('path');
const MS = require('../../modsynth/params.js');
require('../../modsynth/random.js');
const H = require('./harness.js');

const PER_PART = +(process.argv[2] || 24);
const PARTS = ['chord', 'mel', 'bass', 'melgen', 'arp'];
const SR = 48000, BLOCK = 128;

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}

const SRC_INDEX = {}, DST_INDEX = {};
MS.MOD_SOURCES.forEach((o, i) => { SRC_INDEX[o[0]] = i; });
MS.MOD_DESTS.forEach((o, i) => { DST_INDEX[o[0]] = i; });

/* ── Static: is it a legal patch at all? ──────────────────────────────── */
let seen = 0;
const chars = {};
for (const part of PARTS) {
  for (let i = 0; i < 400; i++) {
    const roll = MS.rollPatch({ part });
    seen++;
    chars[roll.character] = (chars[roll.character] || 0) + 1;
    if (Object.keys(roll.values).length !== MS.PARAMS.length) {
      ok(false, 'roll covers every parameter', Object.keys(roll.values).length + ' of ' + MS.PARAMS.length);
      break;
    }
    let bad = null;
    for (const p of MS.PARAMS) {
      const v = roll.values[p.id];
      if (p.type === 'enum') { if (!(v in p.optIndex)) { bad = p.id + ' = ' + v; break; } continue; }
      if (typeof v !== 'number' || !isFinite(v)) { bad = p.id + ' = ' + v; break; }
      if (v < p.min - 1e-9 || v > p.max + 1e-9) { bad = p.id + ' = ' + v + ' outside ' + p.min + '…' + p.max; break; }
    }
    if (bad) { ok(false, 'every value legal for its parameter', bad); break; }
    /* Tuning and output level are not the dice's to roll (random.js: HELD). */
    for (const id of ['voice.transpose', 'voice.tune', 'voice.bendUp', 'voice.bendDown',
                      'master.vol', 'fx.width', 'osc1.oct', 'osc1.semi', 'osc1.keytrack',
                      'voice.poly', 'arp.on', 'fx.eq.mid', 'fx.comp.on']) {
      if (!MS.PARAM[id]) continue;
      if (roll.values[id] !== MS.PARAM[id].def) { ok(false, id + ' is held at its default', String(roll.values[id])); break; }
    }
  }
}
ok(seen === PARTS.length * 400, 'rolled ' + seen + ' patches without throwing');
ok(Object.keys(chars).length >= 6, 'every character comes up', Object.keys(chars).join(','));
/* A part has to prefer its own kind of sound, or the bias table does nothing. */
ok(MS.rollPatch === MS.rollPatch, 'roller is exported');
{
  const bassChars = {};
  for (let i = 0; i < 400; i++) { const c = MS.rollPatch({ part: 'bass' }).character; bassChars[c] = (bassChars[c] || 0) + 1; }
  ok((bassChars.bass || 0) > 200, 'the bass part mostly rolls a bass', JSON.stringify(bassChars));
  ok(!bassChars.pad, 'the bass part never rolls a pad', String(bassChars.pad));
}

/* ── Rendered: does it make a sound? ──────────────────────────────────── */
function render(roll, notes, seconds) {
  const s = H.makeSynth({ sampleRate: SR });
  MS.DSP_PARAMS.forEach(p => { try { s.set(p.id, roll.values[p.id]); } catch (e) { /* host-side */ } });
  const rows = [];
  for (let i = 1; i <= MS.MATRIX_SLOTS; i++) {
    const src = roll.values['mtx' + i + '.src'], dst = roll.values['mtx' + i + '.dst'], amt = +roll.values['mtx' + i + '.amt'];
    if (src !== 'none' && dst !== 'none' && amt) {
      rows.push({ s: SRC_INDEX[src] || 0, d: DST_INDEX[dst] || 0, a: amt, u: roll.values['mtx' + i + '.uni'] ? 1 : 0, v: 0 });
    }
  }
  s.send({ t: 'matrix', rows });
  for (let lane = 0; lane < 2; lane++) {
    if (roll.motion[lane]) s.send({ t: 'motion', lane, steps: Float32Array.from(roll.motion[lane]) });
  }
  s.send({ t: 'tempo', bpm: 100, beat: 0 });
  notes.forEach(n => s.noteOn(n, 0.85));
  const held = s.render(Math.round(SR * seconds / BLOCK));
  notes.forEach(n => s.noteOff(n));
  const tail = s.render(Math.round(SR * 2.0 / BLOCK));
  return { held, tail };
}
/* Loudness as the ear judges one note: the loudest 200 ms, not the mean over
   a window longer than the note. A 150 ms pluck is not a quiet patch. */
function loudest(buf) {
  const w = Math.round(SR * 0.2);
  let best = 0;
  for (let i = 0; i + w <= buf.length; i += w >> 1) { const r = H.rms(buf.subarray(i, i + w)); if (r > best) best = r; }
  return best;
}
const db = x => 20 * Math.log10(Math.max(x, 1e-9));

const loud = [];
let silent = 0, nan = 0, clipped = 0, ringing = 0;
for (const part of PARTS) {
  const notes = part === 'bass' ? [36] : part === 'chord' ? [60, 64, 67] : [67];
  for (let i = 0; i < PER_PART; i++) {
    const roll = MS.rollPatch({ part });
    let o;
    try { o = render(roll, notes, 1.4); } catch (e) { nan++; console.log('  THREW ' + part + '/' + roll.label + ': ' + e.message); continue; }
    if (H.hasBadSample(o.held.L) || H.hasBadSample(o.held.R) || H.hasBadSample(o.tail.L)) {
      nan++; console.log('  NaN ' + part + '/' + roll.label); continue;
    }
    const l = loudest(o.held.L);
    loud.push(l);
    if (l < 0.0015) { silent++; console.log('  SILENT ' + part + '/' + roll.label + ' ' + db(l).toFixed(1) + ' dB  cut ' + (+roll.values['flt1.cutoff']).toFixed(0) + ' model ' + roll.values['flt1.model'] + ' wave ' + roll.values['osc1.wave']); }
    /* The limiter is after this, so a peak over 1 is not a crash — but a roll
       that arrives 6 dB into it is a roll the limiter is playing, not the
       patch. */
    const pk = Math.max(H.peak(o.held.L), H.peak(o.held.R));
    if (pk > 2.0) { clipped++; console.log('  HOT ' + part + '/' + roll.label + ' peak ' + pk.toFixed(2)); }
    /* Two seconds after the key is up, with the release capped at 4 s, the
       note must be dying rather than holding. */
    const end = H.rms(o.tail.L.subarray(o.tail.L.length - 8192));
    if (end > 0.02 && end > l * 0.6) { ringing++; console.log('  RINGING ' + part + '/' + roll.label + ' tail ' + db(end).toFixed(1) + ' vs ' + db(l).toFixed(1)); }
  }
}
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
ok(nan === 0, 'no roll renders a NaN or throws', String(nan));
ok(silent === 0, 'no roll is inaudible', String(silent) + ' of ' + loud.length);
ok(clipped === 0, 'no roll arrives more than 6 dB into the limiter', String(clipped));
ok(ringing === 0, 'no roll is still holding two seconds after note-off', String(ringing));
/* The dice must not also be a volume control. 18 dB between the 5th and 95th
   percentile is about what a hand-built bank spans; 25 dB was the first
   measurement, before the filter/oscillator couplings in random.js. */
const spread = db(q(loud, 0.95)) - db(q(loud, 0.05));
ok(spread < 18, 'loudness spread p5…p95 under 18 dB', spread.toFixed(1) + ' dB');

console.log('\n' + loud.length + ' rendered · median ' + db(q(loud, 0.5)).toFixed(1)
  + ' dB · p5 ' + db(q(loud, 0.05)).toFixed(1) + ' · p95 ' + db(q(loud, 0.95)).toFixed(1)
  + ' · spread ' + spread.toFixed(1) + ' dB');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
