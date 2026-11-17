// Writes modsynth/wt-frames.json: the four morph frames of every wavetable set, one cycle each, cut down to 128 points and whole
// numbers (-100..100). The synth page draws the wavetable view from this; it never builds the engine's bank (the full tables take
// seconds to make, and the native engine has no way to hand them over). Run after a change to the frame definitions in
// modsynth/dsp.js: `node build/wt-frames.mjs`; tests/modsynth/wtframes.test.js fails while the file is out of date.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeSynth } = require(path.join(root, 'tests/modsynth/harness.js'));

export function frames() {
  const synth = makeSynth();
  const MS = synth.MS, bank = synth.proc.bank;
  const order = MS.WAVES.map(w => w[0]);
  if (bank.length !== order.length) throw new Error('bank has ' + bank.length + ' sets, params.js lists ' + order.length);
  const POINTS = 128;
  const sets = bank.map(set => set.map(frame => {
    const t = frame[0], step = (t.length - 1) / POINTS, out = [];
    for (let i = 0; i < POINTS; i++) out.push(Math.round(t[Math.floor(i * step)] * 100) + 0);
    return out;
  }));
  // Through JSON: the bank's arrays belong to the engine's sandbox, and a deep comparison cares which realm made them.
  return JSON.parse(JSON.stringify({ order, points: POINTS, frames: sets }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'modsynth/wt-frames.json');
  fs.writeFileSync(out, JSON.stringify(frames()) + '\n');
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
