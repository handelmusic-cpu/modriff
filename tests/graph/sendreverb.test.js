/* The graph path's reverb send held against the browser's ConvolverNode.
   The page's rooms are a convolver over noise falling as (1-t)^2.5 for
   chord.reverbSize seconds (buildReverb); the native send is the rack's reverb
   network, fitted to that shape and level, wet only, at unit gain. Fed the same
   noise, the tail's level should match and so should how it decays: the power per
   100 ms of an impulse's response, in dB, within 3.5 dB for the first 1.2 s (the convolver is 22 dB down by then).
   Run: make -C native/modsynth sendtest && node tests/graph/sendreverb.test.js
   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..'), SR = 48000, SECS = 1.8;
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };

// Unit-power noise and an impulse, a fixed seed.
let q = 777 >>> 0; const rnd = () => { q = (q + 0x6D2B79F5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = SR * 6;
const noise = new Float32Array(N); for (let i = 0; i < N; i++) noise[i] = (rnd() * 2 - 1) * Math.sqrt(3);
const imp = new Float32Array(N); imp[0] = 1;

async function browser(inputs) {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage(); await p.goto('about:blank');
  const r = await p.evaluate(async ({ inputs, sr, secs, seed }) => {
    let q = seed >>> 0; const rnd = () => { q = (q + 0x6D2B79F5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const out = [];
    for (const arr of inputs) {
      const ctx = new OfflineAudioContext(2, arr.length, sr);
      const len = Math.floor(sr * secs), ir = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
      const cv = ctx.createConvolver(); cv.buffer = ir; cv.connect(ctx.destination);
      const src = ctx.createBufferSource(), buf = ctx.createBuffer(1, arr.length, sr); buf.getChannelData(0).set(arr);
      src.buffer = buf; src.connect(cv); src.start();
      const o = await ctx.startRendering(); out.push([Array.from(o.getChannelData(0)), Array.from(o.getChannelData(1))]);
    }
    return out;
  }, { inputs: inputs.map(a => Array.from(a)), sr: SR, secs: SECS, seed: 99 });
  await b.close(); return r;
}
function native(inp) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'send-')), i = path.join(d, 'in.f32'), o = path.join(d, 'out.f32');
  fs.writeFileSync(i, Buffer.from(inp.buffer));
  execFileSync(path.join(root, 'native/modsynth/sendtest'), [String(SECS), '2.5', i, o]);
  const x = new Float32Array(fs.readFileSync(o).buffer.slice(0)), L = new Float32Array(inp.length), R = new Float32Array(inp.length);
  for (let k = 0; k < inp.length; k++) { L[k] = x[2 * k]; R[k] = x[2 * k + 1]; }
  return [L, R];
}
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const db = x => 20 * Math.log10(Math.max(x, 1e-12));

(async () => {
  const [bn, bi] = await browser([noise, imp]);
  const nn = native(noise), ni = native(imp);
  // steady noise, after the tail has filled
  const a = SR * 3, b = SR * 6;
  const lvB = db((rms(bn[0], a, b) + rms(bn[1], a, b)) / 2), lvN = db((rms(nn[0], a, b) + rms(nn[1], a, b)) / 2);
  console.log(`noise in, tail level: browser ${lvB.toFixed(2)} dB, native ${lvN.toFixed(2)} dB`);
  ok(Math.abs(lvB - lvN) < 1, 'the tail on steady noise is within 1 dB of the convolver', (lvN - lvB).toFixed(2) + ' dB');
  // decay of the impulse response, per 100 ms
  const W = SR * 0.1; let worst = 0, line = [];
  for (let w = 0; w + W <= SR * 1.2; w += W) {
    const eb = db((rms(bi[0], w, w + W) + rms(bi[1], w, w + W)) / 2), en = db((rms(ni[0], w, w + W) + rms(ni[1], w, w + W)) / 2);
    line.push((en - eb).toFixed(1)); worst = Math.max(worst, Math.abs(en - eb));
  }
  console.log('impulse, native minus browser per 100 ms (dB):', line.join(' '));
  ok(worst < 3.5, 'the impulse response decays like the convolver\'s over 1.2 s (worst 100 ms window under 3.5 dB)', worst.toFixed(1) + ' dB');
  let dry = 0; for (let i = 0; i < 64; i++) dry = Math.max(dry, Math.abs(ni[0][i]));
  ok(dry < 0.05, 'wet only: an impulse does not come straight through', dry.toFixed(3));
  process.exit(fail ? 1 : 0);
})();
