// modsynth/wt-frames.json (what the wavetable view draws) must be what the engine's own tables are: regenerate and compare.
// Fix: node build/wt-frames.mjs
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const { frames } = await import('../../build/wt-frames.mjs');
  const want = frames(), have = JSON.parse(fs.readFileSync(path.join(__dirname, '../../modsynth/wt-frames.json'), 'utf8'));
  assert.deepStrictEqual(have.order, want.order, 'wave order differs from params.js');
  assert.deepStrictEqual(have, want, 'modsynth/wt-frames.json is out of date: run node build/wt-frames.mjs');
  assert.strictEqual(have.frames.length, 22); assert.ok(have.frames.every(s => s.length === 4 && s.every(f => f.length === 128)));
  console.log('ok: ' + have.order.length + ' sets x 4 frames x ' + have.points + ' points match the engine');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
