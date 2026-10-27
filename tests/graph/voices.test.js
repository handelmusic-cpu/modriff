/* The graph interpreter against the browser, voice by voice.

   For each case the page's real makeVoice is run twice with the same
   Math.random: into an OfflineAudioContext (the browser's own answer) and into
   the recorder (tests/graph/graphrec.js). native/modsynth/graphrender plays the
   recorded program, and the two renders are compared: sample error, level
   error per 10 ms, and where they differ most.

   Run: make -C native/modsynth graphrender && node tests/graph/voices.test.js [wave,wave]
   Env: CHROMIUM (default /opt/pw-browsers/chromium), PLAYWRIGHT (path to playwright). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { writeBuffers } = require('./common.js');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }

const root = path.join(__dirname, '..', '..');
const SR = 48000, DUR = 1.6;
const WAVES = (process.argv[2] || 'sine,triangle,square,sawtooth,supersaw,pad,piano,organ,rhodes').split(',');
const MIDI = [48, 60, 72];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'));

function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/plain' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

// Runs in the page. mode 'real' renders with an OfflineAudioContext; 'rec' records.
async function pageRun(args) {
  const { wave, midi, mode, sr, dur, seed, release } = args;
  let s = seed >>> 0;
  Math.random = function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window._webParams = Object.assign(window._webParams || {}, { 'master.tune': 440, 'fx.drift': 0, 'chord.glide': false, 'chord.glideTime': 0 });
  const ctx = mode === 'real' ? new OfflineAudioContext(2, Math.round(sr * dur), sr) : new GraphRec({ sampleRate: sr });
  const g = ctx.createGain();
  g.connect(ctx.destination);
  // The caller's own envelope, as playChord builds it: attack, hold, decay.
  // t0 is not on a 128-frame boundary (frame 480) on purpose: a browser's
  // oscillator that starts part-way through a render quantum reads that
  // quantum's frequency-modulation samples from the wrong end, and the
  // interpreter reproduces that (see graph.cpp). Aligned starts do not show it.
  const t0 = 0.01, atk = 0.02, hold = 0.8, dec = 0.6;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.4, t0 + atk);
  g.gain.setValueAtTime(0.4, t0 + atk + 0.01);
  let oscs;
  if (release) {
    // A held note: it sustains until a release that is only decided later, the
    // way a chord on a held pad is. The voice is built to ring for the whole
    // second; the release then arrives as edits to a graph that is already
    // sent, exactly as _webChordReleaseAt makes them.
    oscs = makeVoice(ctx, midi, g, t0, 1.4, wave, 'chord');
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + hold + dec);
    oscs = makeVoice(ctx, midi, g, t0, atk + hold + dec, wave, 'chord');
  }
  let prog = null;
  if (mode !== 'real' && release) prog = Array.from(ctx.program());
  if (release) {
    const relT = 0.5, rdec = 0.5;
    g.gain.cancelAndHoldAtTime(relT);
    g.gain.exponentialRampToValueAtTime(0.0001, relT + rdec);
    (oscs || []).forEach(o => { try { o.stop(relT + rdec + 0.05); } catch (e) {} });
  }
  if (mode === 'real') {
    const b = await ctx.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1), out = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
    return { f32: Array.from(out) };
  }
  const plain = list => list.map(b => ({ id: b.id, sampleRate: b.sampleRate, channels: b.channels.map(c => Array.from(c)) }));
  if (release) return { prog, inc: Array.from(ctx.takeIncrements()), bufs: plain(ctx.takeNewBuffers()), unsupported: ctx.unsupported };
  const program = Array.from(ctx.program());
  return { prog: program, bufs: plain(ctx.takeNewBuffers()), unsupported: ctx.unsupported };
}

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  let fail = 0;
  const report = [];
  const CASES = [];
for (const wave of WAVES) { for (const midi of MIDI) CASES.push([wave, midi, false]); CASES.push([wave, 60, true]); }
for (const [wave, midi, release] of CASES) {
    // A fresh page per run: makeVoice caches its noise buffer on first use and
    // that buffer belongs to whichever context made it.
    const run = async mode => {
      const page = await browser.newPage();
      await page.addInitScript({ path: path.join(__dirname, 'graphrec.js') });
      await page.goto(url);
      await page.waitForTimeout(600);
      const r = await page.evaluate(pageRun, { wave, midi, mode, sr: SR, dur: DUR, seed: 12345 + midi, release });
      await page.close();
      return r;
    };
    const real = await run('real');
    const rec = await run('rec');
    const tag = `${wave}-${midi}${release ? '-rel' : ''}`;
    const pf = path.join(tmp, `${tag}.f64`), of = path.join(tmp, `${tag}.f32`);
    fs.writeFileSync(pf, Buffer.from(Float64Array.from(rec.prog).buffer));
    const args = [pf, String(DUR), of];
    const bf = path.join(tmp, `${tag}.buf.f64`); writeBuffers(bf, rec.bufs || []);
    if (release) { const inf = path.join(tmp, `${tag}.inc.f64`); fs.writeFileSync(inf, Buffer.from(Float64Array.from(rec.inc).buffer)); args.push(inf); } else args.push('-');
    args.push(bf);
    execFileSync(path.join(root, 'native/modsynth/graphrender'), args);
    const nat = new Float32Array(fs.readFileSync(of).buffer.slice(0));
    const ref = Float32Array.from(real.f32);
    if (process.env.DUMP) { fs.mkdirSync(process.env.DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.DUMP, `${tag}.ref.f32`), Buffer.from(ref.buffer)); fs.writeFileSync(path.join(process.env.DUMP, `${tag}.nat.f32`), Buffer.from(nat.buffer.slice(0))); fs.writeFileSync(path.join(process.env.DUMP, `${tag}.f64`), fs.readFileSync(pf)); }
    const n = Math.min(nat.length, ref.length);
    let eRef = 0, eErr = 0, peakRef = 0, peakNat = 0;
    for (let i = 0; i < n; i++) { eRef += ref[i] * ref[i]; const d = ref[i] - nat[i]; eErr += d * d; peakRef = Math.max(peakRef, Math.abs(ref[i])); peakNat = Math.max(peakNat, Math.abs(nat[i])); }
    // level per 10 ms
    const W = SR / 100 * 2; let worst = 0;
    for (let w = 0; w + W <= n; w += W) {
      let a = 0, b = 0; for (let i = w; i < w + W; i++) { a += ref[i] * ref[i]; b += nat[i] * nat[i]; }
      if (a > 1e-10) worst = Math.max(worst, Math.abs(10 * Math.log10((b + 1e-20) / a)));
    }
    const snr = 10 * Math.log10(eRef / Math.max(eErr, 1e-30));
    const row = { wave, midi, release: release || undefined, snrDb: +snr.toFixed(1), peakRef: +peakRef.toFixed(3), peakNat: +peakNat.toFixed(3), worstWindowDb: +worst.toFixed(2), unsupported: rec.unsupported };
    report.push(row);
    // What is held: the render is the browser's to within -75 dB (the weakest
    // voice, a plain sawtooth, is 76; the rest are 80 to 114), no 10 ms window
    // off by more than 0.1 dB, same peak.
    const bad = [];
    if (snr < 75) bad.push('snr ' + snr.toFixed(1) + ' dB');
    if (worst > 0.1) bad.push('window ' + worst.toFixed(2) + ' dB');
    if (Math.abs(peakNat - peakRef) > 0.005 * Math.max(peakRef, 0.01)) bad.push('peak ' + peakNat + ' vs ' + peakRef);
    if (Object.keys(rec.unsupported).length) bad.push('unsupported ' + JSON.stringify(rec.unsupported));
    if (bad.length) { fail++; row.FAIL = bad.join('; '); }
    console.log(JSON.stringify(row));
  }
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all ' + report.length + ' voices within tolerance');
  process.exit(fail ? 1 : 0);
})();
