/* Renders every factory patch through the real DSP core.
   Catches patches that are silent, deafening, unstable or NaN.
   Run: node tests/patches.test.js */
'use strict';
const { makeSynth, peak, rms, hasBadSample } = require('./harness');
const MS = require('../js/params.js');
require('../js/patches.js');
require('../js/patches-extra.js');

const SRC_INDEX = {}; MS.MOD_SOURCES.forEach((s, i) => { SRC_INDEX[s[0]] = i; });
const DST_INDEX = {}; MS.MOD_DESTS.forEach((d, i) => { DST_INDEX[d[0]] = i; });

/** Loads a patch into a fresh processor, plays a chord, returns the audio. */
function audition(patch, notes, blocks) {
  const s = makeSynth();
  const values = MS.paramDefaults();
  Object.keys(patch.values).forEach(k => { if (MS.PARAM[k]) values[k] = patch.values[k]; });

  MS.DSP_PARAMS.forEach(p => {
    s.proc.port.deliver({ t: 'p', i: p.dspIndex, v: MS.toNumber(p, values[p.id]) });
  });
  const rows = (patch.matrix || [])
    .filter(r => r[0] !== 'none' && r[1] !== 'none' && r[2])
    .map(r => ({ s: SRC_INDEX[r[0]], d: DST_INDEX[r[1]], a: r[2], u: r[3] ? 1 : 0 }));
  s.proc.port.deliver({ t: 'matrix', rows });
  if (patch.motion) {
    patch.motion.forEach((lane, i) => {
      const arr = new Float32Array(MS.MOTION_STEPS);
      for (let n = 0; n < Math.min(lane.length, MS.MOTION_STEPS); n++) arr[n] = lane[n];
      s.proc.port.deliver({ t: 'motion', lane: i, steps: arr });
    });
  }
  // Macros sit at zero by default; push them to the middle so macro routings
  // are actually exercised rather than multiplied by nothing.
  for (let m = 1; m <= MS.MACRO_COUNT; m++) s.proc.port.deliver({ t: 'macro', i: m, v: 0.5 });

  notes.forEach(n => s.noteOn(n, 0.85));
  return s.render(blocks);
}

let pass = 0, fail = 0;
const silent = [], hot = [], broken = [];

MS.FACTORY_PATCHES.forEach(patch => {
  // Chord for polyphonic sounds, single low note for anything mono/bass.
  const mono = patch.values['voice.mode'] && patch.values['voice.mode'] !== 'poly';
  const bassy = /bass|sub|kick/.test(patch.tags.join(' ') + patch.category.toLowerCase());
  const notes = mono || bassy ? [36] : [48, 55, 60, 64];
  const { L, R } = audition(patch, notes, 90);

  const label = patch.category + ' / ' + patch.name;
  if (hasBadSample(L) || hasBadSample(R)) { broken.push(label); fail++; return; }

  const pk = Math.max(peak(L), peak(R));
  // Attack transients live in the first blocks; sustained patches need the
  // tail measured too, or a slow attack reads as silence.
  const level = Math.max(rms(L.subarray(0, 4000)), rms(L.subarray(4000)));

  if (level < 2e-4) { silent.push(label + '  rms=' + level.toExponential(2)); fail++; return; }
  if (pk > 4) { hot.push(label + '  peak=' + pk.toFixed(2)); fail++; return; }
  pass++;
});

if (broken.length) { console.log('\nNaN / Infinity:'); broken.forEach(x => console.log('  ' + x)); }
if (silent.length) { console.log('\nSilent:'); silent.forEach(x => console.log('  ' + x)); }
if (hot.length) { console.log('\nToo hot:'); hot.forEach(x => console.log('  ' + x)); }

console.log(`\n${pass} patches sounded correct, ${fail} failed (of ${MS.FACTORY_PATCHES.length})`);
process.exit(fail ? 1 : 0);
