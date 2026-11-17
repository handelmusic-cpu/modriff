/* The native EQ against the page's drawing: `eqtest --grid` has the real engine (a
   part's strip, or the master bus) play a quiet tone at 16 frequencies for each of
   forty-odd settings (the browser reference cases, and two dozen from a generator,
   at 48 kHz and 44.1 kHz) and print the level it measured; this holds each number
   to eqResponseDb, the function that draws the panel's curve from the same fields.
   Where the two disagree, one of them is not the EQ the browser would give: the
   drawing is tied to the browser by curve.test.js, the engine by eqtest itself,
   and this ties them to each other through the fields as the page stores them.
   Run: node tests/eq/agree.test.js (builds eqtest if there is a compiler) */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '../..'), nat = path.join(root, 'native/modsynth');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const a = html.indexOf('// ── EQ CURVE ──'), b = html.indexOf('// ── END EQ CURVE ──');
const E = vm.runInNewContext(html.slice(a, b) + '\n;({eqResponseDb});', {});

try { execFileSync('make', ['-C', nat, 'eqtest'], { stdio: 'ignore' }); } catch (e) { /* use the binary that is there */ }
const out = execFileSync(path.join(nat, 'eqtest'), ['--grid'], { encoding: 'utf8', maxBuffer: 1 << 24 });

const KEYS = ['lo', 'mid', 'midHz', 'hi', 'loHz', 'hiHz', 'midQ', 'hpfOn', 'hpfHz', 'hpfQ', 'hpfSlope', 'lpfOn', 'lpfHz', 'lpfQ', 'lpfSlope', 'mid2', 'mid2Hz', 'mid2Q'];
const refs = JSON.parse(fs.readFileSync(path.join(__dirname, 'refs.json'), 'utf8'));
let pass = 0, fail = 0, worstAll = 0;
for (const line of out.trim().split('\n')) {
  const [head, tail] = line.split('|');
  const t = head.trim().split(/\s+/), kind = t[0], sr = +t[1], model = {};
  KEYS.forEach((k, i) => { model[k] = +t[2 + i]; });
  const got = tail.trim().split(/\s+/).map(Number);
  let worst = 0, wf = 0;
  got.forEach((db, i) => {
    const want = E.eqResponseDb(model, refs.freqs[i], sr);
    // Under about -60 dB the tone is under the noise of a quiet test (float rounding).
    if (want < -60 && db < -50) return;
    const d = Math.abs(db - want); if (d > worst) { worst = d; wf = refs.freqs[i]; }
  });
  worstAll = Math.max(worstAll, worst);
  // The strip is exact to a few hundredths of a dB; the bus has a glue compressor and a
  // limiter that add a level-dependent hair, so it gets a wider margin.
  const tol = kind === 'strip' ? 0.15 : 0.5;
  if (worst < tol) pass++; else { fail++; console.log('  FAIL ' + kind + ' ' + sr + ' ' + JSON.stringify(model) + '  worst ' + worst.toFixed(3) + ' dB at ' + wf + ' Hz'); }
}
console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} settings, engine and drawing agree (worst ${worstAll.toFixed(3)} dB)`);
process.exit(fail ? 1 : 0);
