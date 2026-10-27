/* Live edits and the AudioParam timeline, on small graphs, against the browser.

   voices.test.js covers a release on real voices. This covers the cases a
   release does not reach: a choke that lands in the middle of a decay, a
   target that is still settling when it is cancelled, a source stopped early,
   and the plain automation methods. Each case is a builder (run into the
   browser's OfflineAudioContext and into the recorder) and an optional edit
   that runs afterwards on the same objects, which on the recorder side becomes
   increments sent to a graph that is already loaded.

   Run: make -C native/modsynth graphrender && node tests/graph/edits.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-edits-'));
const SR = 48000, DUR = 1.5;

// `build` makes the graph and returns an object of named nodes for `edit`.
const CASES = {
  'exp decay, held mid-ramp, then a fast fade (a chord choke)': {
    build: `const o=ctx.createOscillator();o.frequency.value=220;const g=ctx.createGain();g.gain.setValueAtTime(0.5,0.0107);g.gain.exponentialRampToValueAtTime(0.0001,1.2);o.connect(g);g.connect(out);o.start(0);return {g,o};`,
    edit: `n.g.gain.cancelAndHoldAtTime(0.4);n.g.gain.linearRampToValueAtTime(0,0.4+0.022);n.o.stop(0.5);` },
  'setTarget still settling, held, then released': {
    build: `const o=ctx.createOscillator();o.frequency.value=330;const g=ctx.createGain();g.gain.setValueAtTime(0,0);g.gain.setTargetAtTime(0.6,0.05,0.2);o.connect(g);g.connect(out);o.start(0);return {g,o};`,
    edit: `n.g.gain.cancelAndHoldAtTime(0.3);n.g.gain.setTargetAtTime(0.0001,0.3,0.05);n.o.stop(0.9);` },
  'cancelScheduledValues then set (the other release path)': {
    build: `const o=ctx.createOscillator();o.frequency.value=110;const g=ctx.createGain();g.gain.setValueAtTime(0.4,0);g.gain.linearRampToValueAtTime(0.1,1.0);o.connect(g);g.connect(out);o.start(0);return {g,o};`,
    edit: `n.g.gain.cancelScheduledValues(0.5);n.g.gain.setValueAtTime(0.4,0.5);n.g.gain.exponentialRampToValueAtTime(0.0001,0.9);` },
  'a source stopped early': {
    build: `const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=196;const g=ctx.createGain();g.gain.value=0.3;o.connect(g);g.connect(out);o.start(0);o.stop(1.4);return {g,o};`,
    edit: `n.o.stop(0.6);` },
  'param automation: linear, exponential, target in sequence': {
    build: `const o=ctx.createOscillator();o.frequency.setValueAtTime(200,0);o.frequency.linearRampToValueAtTime(400,0.3);o.frequency.exponentialRampToValueAtTime(800,0.6);o.frequency.setTargetAtTime(300,0.7,0.1);const g=ctx.createGain();g.gain.value=0.4;o.connect(g);g.connect(out);o.start(0);return {g,o};`,
    edit: `` },
  'biquad sweep and a shaper, stereo pan': {
    build: `const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=110;const f=ctx.createBiquadFilter();f.type='lowpass';f.Q.value=6;f.frequency.setValueAtTime(300,0);f.frequency.exponentialRampToValueAtTime(4000,0.8);const p=ctx.createStereoPanner();p.pan.value=-0.6;o.connect(f);f.connect(p);p.connect(out);o.start(0);return {o};`,
    edit: `` },
  'delay line': {
    build: `const o=ctx.createOscillator();o.frequency.value=440;const e=ctx.createGain();e.gain.setValueAtTime(0.5,0);e.gain.setValueAtTime(0,0.05);const d=ctx.createDelay(1);d.delayTime.value=0.25;o.connect(e);e.connect(d);d.connect(out);o.start(0);return {o};`,
    edit: `` },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  let fail = 0;
  for (const [name, c] of Object.entries(CASES)) {
    const run = async mode => {
      const page = await browser.newPage();
      await page.addInitScript({ path: path.join(__dirname, 'graphrec.js') });
      await page.goto('about:blank');
      const r = await page.evaluate(async ({ build, edit, mode, SR, DUR }) => {
        const ctx = mode === 'real' ? new OfflineAudioContext(2, Math.round(SR * DUR), SR) : new GraphRec({ sampleRate: SR });
        const out = ctx.destination;
        const n = new Function('ctx', 'out', build)(ctx, out);
        let prog = null;
        if (mode !== 'real') prog = Array.from(ctx.program());
        if (edit) new Function('ctx', 'n', edit)(ctx, n);
        if (mode === 'real') {
          const b = await ctx.startRendering(); const L = b.getChannelData(0), R = b.getChannelData(1), o = new Float32Array(L.length * 2);
          for (let i = 0; i < L.length; i++) { o[2 * i] = L[i]; o[2 * i + 1] = R[i]; }
          return { f32: Array.from(o) };
        }
        return { prog, inc: Array.from(ctx.takeIncrements()), un: ctx.unsupported };
      }, { build: c.build, edit: c.edit, mode, SR, DUR });
      await page.close();
      return r;
    };
    const real = await run('real'), rec = await run('rec');
    const pf = path.join(tmp, 'p.f64'), inf = path.join(tmp, 'i.f64'), of = path.join(tmp, 'o.f32');
    fs.writeFileSync(pf, Buffer.from(Float64Array.from(rec.prog).buffer));
    const args = [pf, String(DUR), of];
    if (rec.inc.length) { fs.writeFileSync(inf, Buffer.from(Float64Array.from(rec.inc).buffer)); args.push(inf); }
    execFileSync(path.join(root, 'native/modsynth/graphrender'), args);
    const nat = new Float32Array(fs.readFileSync(of).buffer.slice(0)), ref = Float32Array.from(real.f32);
    let a = 0, e = 0;
    for (let i = 0; i < ref.length; i++) { a += ref[i] ** 2; e += (ref[i] - nat[i]) ** 2; }
    const snr = 10 * Math.log10(a / Math.max(e, 1e-30));
    const ok = snr >= 60 && !Object.keys(rec.un).length;
    if (!ok) fail++;
    console.log((ok ? 'ok   ' : 'FAIL ') + snr.toFixed(1).padStart(6) + ' dB  ' + name);
  }
  await browser.close();
  console.log(fail ? fail + ' FAILED' : 'all ' + Object.keys(CASES).length + ' cases within tolerance');
  process.exit(fail ? 1 : 0);
})();
