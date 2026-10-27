/* The sampler's microphone take inside the app: asked of iOS first, then recorded
   through the plugin's own input (micStart / micRead / micStop) rather than the web
   view's getUserMedia, which failed on the phone with an InvalidStateError. Against a
   stand-in plugin that hands back one second of a ramp at 44.1 kHz.
   - Denied: nothing is recorded, Settings is opened.
   - Granted: the take is the samples the plugin returned, at the plugin's rate, and
     the plugin is stopped when the take ends.
   - A plugin without micStart falls back to getUserMedia.
   Run: node tests/sampler/mic.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
const stub = (perm, withMic) => `
  window.__calls = [];
  const N = 44100;
  let sent = false;
  const P = {
    micPermission: () => Promise.resolve(${JSON.stringify(perm)}),
    openSettings: () => { window.__calls.push('openSettings'); return Promise.resolve({ opened: true }); },
    ${withMic ? `
    micStart: () => { window.__calls.push('micStart'); sent = false; return Promise.resolve({ sampleRate: 44100, channels: 1 }); },
    micRead: () => {
      if (sent) return Promise.resolve({ frames: 0, sampleRate: 44100, data: '' });
      sent = true;
      const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) { f[i] = i / N; f[N + i] = -i / N; }
      let s = ''; const u = new Uint8Array(f.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return Promise.resolve({ frames: N, sampleRate: 44100, data: btoa(s) });
    },
    micStop: () => { window.__calls.push('micStop'); return Promise.resolve(); },` : ''}
  };
  ['start','stop','ensurePart','post','stats','meters','shareFile','fileAppend','shareFiles','fileDelete','wavFinish','pcmAdd','captureStart','captureRead','captureStop'].forEach(m => P[m] = () => Promise.resolve({ sampleRate: 48000 }));
  window.Capacitor = { isNativePlatform: () => true, Plugins: { ModEngine: P } };
  window.__gum = 0;
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => { window.__gum++; return Promise.reject(Object.assign(new Error('x'), { name: 'InvalidStateError' })); } }, configurable: true });
`;
(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const run = async (perm, withMic, fn) => {
    const page = await browser.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.addInitScript(stub(perm, withMic));
    await page.goto(url); await page.waitForTimeout(1200); await page.mouse.click(5, 5); await page.waitForTimeout(300);
    await page.evaluate(() => { if (!getCtx()) audioCtx = new AudioContext(); return getCtx() && getCtx().resume(); });
    const r = await page.evaluate(fn); r.errs = errs; await page.close(); return r;
  };
  const take = async () => { const n0 = SMP_LIB.length; smpRecStart('mic'); await new Promise(r => setTimeout(r, 500)); const rec = smpRecording(); const frames = _smpRec && _smpRec.frames; smpRecStop(); await new Promise(r => setTimeout(r, 700));
    const clip = SMP_LIB[SMP_LIB.length - 1]; return { n: SMP_LIB.length - n0, rec, frames, dur: clip && clip.dur, calls: window.__calls.slice(), gum: window.__gum }; };

  const g = await run({ granted: true, status: 'granted' }, true, take);
  ok(g.n === 1 && g.rec === true && g.frames === 44100, 'granted: a take of the plugin\'s samples is kept', JSON.stringify(g));
  ok(Math.abs(g.dur - 1) < 0.01, 'at the plugin\'s rate (1 s of 44100 frames is 1 s long)', String(g.dur));
  ok(g.calls.includes('micStart') && g.calls.includes('micStop') && g.gum === 0, 'the plugin is started and stopped, and getUserMedia is not used', JSON.stringify(g));

  const d = await run({ granted: false, status: 'denied' }, true, async () => { smpRecStart('mic'); await new Promise(r => setTimeout(r, 1800)); return { rec: smpRecording(), calls: window.__calls.slice(), gum: window.__gum }; });
  ok(!d.rec && d.calls.includes('openSettings') && !d.calls.includes('micStart') && d.gum === 0, 'denied: nothing recorded, Settings opened', JSON.stringify(d));

  const f = await run({ granted: true, status: 'granted' }, false, async () => { smpRecStart('mic'); await new Promise(r => setTimeout(r, 600)); return { rec: smpRecording(), gum: window.__gum }; });
  ok(f.gum === 1, 'a plugin without micStart falls back to getUserMedia', JSON.stringify(f));
  ok(g.errs.length + d.errs.length + f.errs.length === 0, 'no page errors', [...g.errs, ...d.errs, ...f.errs].join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
