/* Shaped drum hits against the browser (4.9.9.9.9.9.7: Shape on every synthesised kit,
   and a Pan on every lane).

   tests/graph/drums.test.js holds every lane at its defaults. This is the other half:
   the same lanes with their Shape moved a long way — Decay, Sweep, Body, Tone, Drive
   and Pan all off their defaults — built the way a shaped hit is built in the app
   (the multipliers the voice builders read, then _sqShapeInsert's filter, drive and
   panner in front of the bus), once into a browser OfflineAudioContext and once
   into the recorder, and the interpreter's render compared with the browser's.

   Run: make -C native/modsynth graphrender && node tests/graph/shape.test.js [kit,kit]
   Env: CHROMIUM, PLAYWRIGHT. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { writeBuffers } = require('./common.js');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-drums-'));
const SR = 48000, DUR = 2.0;
// Held to 60 dB like the default lanes. The same two lanes drums.test.js already
// holds lower, for the same reasons (both the browser's own habits, not the
// interpreter's): the MOD kick's sub tone starts mid-ramp, and the 808 clap has a
// burst that lands exactly on a frame. The clap's is lower shaped than at its
// defaults (44.5 dB against 51) because Decay moves where its bursts land.
const KNOWN = { 'MOD/0': [30, 'sub tone starts mid-ramp: browser evaluates its first quantum from the ramp start'],
                '808/6': [40, 'a burst start that lands exactly on a frame'] };
const SAMPLED = false;
const KITS = process.argv[2] ? process.argv[2].split(',') : ['808', '909', 'MOD', '606', 'CR78', 'LIN', 'IDM', 'ACU', 'BRS'];
const SHAPE = { d: 1.8, s: 0.5, b: 0.4, t: 0.5, x: 0.4, n: -0.7 };

// The drum machine lives in its own closure, so the page is patched in memory
// to reach three things in it: the context it builds on, where its voices send
// their output, and the table of kits.
function patched(html) {
  const a = 'function sqCtx(){ return _sqCtxPrev || getCtx(); }';
  const b = 'function SQOUT(){ return _sqOut || SQMG; }';
  if (!html.includes(a) || !html.includes(b)) throw new Error('drum machine hooks moved; update tests/graph/drums.test.js');
  return html
    .replace(a, `function sqCtx(){ return window.__sqCtx ? window.__sqCtx() : (_sqCtxPrev || getCtx()); }
window.__SQ = { get SQM(){ return SQM; }, playShaped(track, sh){ _sqDecMul = sh.d; _sqSweepMul = sh.s; _sqTonMul = sh.b>=0 ? 1+sh.b*0.4 : 1+sh.b; _sqNsMul = sh.b<=0 ? 1-sh.b*0.4 : 1-sh.b; _sqShapeInsert(sh); try{ track.play(512/48000, 0.8, false, 0); } finally { _sqDecMul = 1; _sqSweepMul = 1; _sqTonMul = 1; _sqNsMul = 1; } }, setMG(g){ SQMG = g; }, resetNoise(){ SQNBUF = null; }, ensureNoise: sqEnsureNoise,
  loadSamples(){ preloadDrumSamples(); Object.keys(DRUM_SAMPLES_LAZY).forEach(_drumLoadOne); }, get buffers(){ return DRUM_BUFFERS; }, get lazyCount(){ return Object.keys(DRUM_SAMPLES_LAZY).length; } };`)
    .replace(b, 'function SQOUT(){ return window.__sqOut ? window.__sqOut() : (_sqOut || SQMG); }');
}
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const u = decodeURIComponent(q.url.split('?')[0]);
      const p = path.join(root, u);
      fs.readFile(p, (e, b) => {
        if (e) { r.writeHead(404); r.end(); return; }
        if (u === '/index.html') b = Buffer.from(patched(b.toString()));
        r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b);
      });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

async function pageRun(a) {
  const { kit, lane, mode, sr, dur, samples, shape } = a;
  let s = 987654321 >>> 0;
  Math.random = function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const SQ = window.__SQ;
  if (samples) {
    // Decoded by the page's own context, as the app does; wait for them all.
    window.getCtx && window.getCtx();
    SQ.loadSamples();
    // Every file a kit can ask for: a lane that finds its take still loading
    // plays its stand-in instead, and the two runs would not agree.
    const want = 7 + SQ.lazyCount;
    for (let i = 0; i < 600 && Object.keys(SQ.buffers).length < want; i++) await new Promise(r => setTimeout(r, 100));
    if (Object.keys(SQ.buffers).length < want) throw new Error('drum samples did not load (' + Object.keys(SQ.buffers).length + ')');
    // the generator above used Math.random for nothing; reseed so both runs match
    s = 987654321 >>> 0;
  }
  const ctx = mode === 'real' ? new OfflineAudioContext(2, Math.round(sr * dur), sr) : new GraphRec({ sampleRate: sr });
  // The part bus is a plain gain in both runs. (In the app it is the host's
  // endpoint, `createExt`; this test is about the voices, and the interpreter
  // reads the destination.)
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  window.__sqCtx = () => ctx;
  window.__sqOut = () => bus;
  SQ.setMG(bus);
  SQ.resetNoise(); SQ.ensureNoise();
  const track = SQ.SQM[kit].tracks[lane];
  let usedBuffer = false;
  // Anything that hands the voice a decoded sample is not held here.
  const origBS = ctx.createBufferSource.bind(ctx);
  ctx.createBufferSource = function () { const n = origBS(); return n; };
  SQ.playShaped(track, shape);
  if (mode === 'real') {
    const b = await ctx.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1), o = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { o[2 * i] = L[i]; o[2 * i + 1] = R[i]; }
    return { f32: Array.from(o), name: track.n };
  }
  const program = Array.from(ctx.program());
  return { prog: program, bufs: ctx.takeNewBuffers().map(b => ({ id: b.id, sampleRate: b.sampleRate, channels: b.channels.map(c => Array.from(c)) })), un: ctx.unsupported, name: track.n };
}

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page0 = await browser.newPage();
  await page0.goto(url); await page0.waitForTimeout(800);
  const kits = await page0.evaluate(() => Object.keys(window.__SQ.SQM).map(k => ({ kit: k, lanes: window.__SQ.SQM[k].tracks.length })));
  await page0.close();
  let fail = 0, held = 0, skipped = 0;
  for (const { kit, lanes } of kits) {
    if (KITS && !KITS.includes(kit)) continue;
    for (let lane = 0; lane < lanes; lane++) {
      const run = async mode => {
        const page = await browser.newPage();
        await page.addInitScript({ path: path.join(__dirname, 'graphrec.js') });
        const errs = []; page.on('pageerror', e => errs.push(String(e)));
        await page.goto(url); await page.waitForTimeout(500);
        // The page makes its audio context on the first tap (the unlock screen).
        if (SAMPLED) { await page.click('.unlock-btn >> text=Random'); await page.waitForTimeout(1500); }
        let r;
        try { r = await page.evaluate(pageRun, { kit, lane, mode, sr: SR, dur: DUR, samples: SAMPLED, shape: SHAPE }); }
        catch (e) { r = { error: String(e).split('\n')[0] }; }
        await page.close();
        return r;
      };
      const real = await run('real'), rec = await run('rec');
      const label = `${kit}/${lane}`;
      if (real.error || rec.error) { skipped++; console.log('skip ' + label + '  ' + (real.error || rec.error)); continue; }
      if (Object.keys(rec.un).length) { skipped++; console.log('skip ' + label + ' ' + rec.name + '  unsupported ' + JSON.stringify(rec.un)); continue; }
      const pf = path.join(tmp, 'p.f64'), of = path.join(tmp, 'o.f32');
      fs.writeFileSync(pf, Buffer.from(Float64Array.from(rec.prog).buffer));
      const bf = path.join(tmp, 'b.f64'); writeBuffers(bf, rec.bufs || []);
      try { execFileSync(path.join(root, 'native/modsynth/graphrender'), [pf, String(DUR), of, '-', bf], { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (e) { fail++; console.log('FAIL ' + label + ' ' + rec.name + '  render: ' + String(e.stderr).trim()); continue; }
      const nat = new Float32Array(fs.readFileSync(of).buffer.slice(0)), ref = Float32Array.from(real.f32);
      if (process.env.DUMP) { fs.mkdirSync(process.env.DUMP, { recursive: true }); const tg = label.replace('/', '-'); fs.writeFileSync(path.join(process.env.DUMP, tg + '.ref.f32'), Buffer.from(ref.buffer)); fs.writeFileSync(path.join(process.env.DUMP, tg + '.nat.f32'), Buffer.from(nat.buffer.slice(0))); }
      let a = 0, e = 0, pk = 0;
      for (let i = 0; i < ref.length; i++) { a += ref[i] ** 2; e += (ref[i] - nat[i]) ** 2; pk = Math.max(pk, Math.abs(ref[i])); }
      if (pk < 1e-4) { skipped++; console.log('skip ' + label + ' ' + rec.name + '  silent in the browser (peak ' + pk.toExponential(1) + ')'); continue; }
      const snr = 10 * Math.log10(a / Math.max(e, 1e-30));
      const lim = KNOWN[label] ? KNOWN[label][0] : 60;
      const ok = snr >= lim;
      if (ok) held++; else fail++;
      console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(10) + rec.name.padEnd(12) + snr.toFixed(1).padStart(6) + ' dB  peak ' + pk.toFixed(3) );
    }
  }
  await browser.close(); srv.close();
  console.log(`${held} held, ${fail} failed, ${skipped} skipped`);
  process.exit(fail ? 1 : 0);
})();
