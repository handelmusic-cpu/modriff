/* A held (sustained or gated) chord is banked by recording its release at two moments and requiring the same result. The release is not run
   under the recorder, so it read the REAL audio clock; once the context was more than ~2 s old every held chord was refused ("the release of a
   held chord depends on its level or moment"), the song's native claim failed and the run stayed on the page, which pauses on leaving the app.
   Offline contexts (the other chord tests) stay at clock 0 and could not show it: this one waits on a real, running context.
   Run: node tests/seq/heldchordclock.test.js */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.join(__dirname, '../..');
let failed = 0;
const ok = (c, label, detail) => { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); };
(async () => {
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.PAGE_PATH || '/index.html'));
    await page.waitForTimeout(1200);
    await page.getByText('Start', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const out = await page.evaluate(async () => {
      const ctx = getCtx();
      const stub = new Proxy({ graphBuf() {}, graphBegin() {}, graphEdit() {} }, { get: (t, k) => k in t ? t[k] : async () => ({ ok: true }) });
      window.modNativePlugin = () => stub; window._nsIntonation.sync = async () => ({ ok: true });
      modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
      while (ctx.currentTime < 4) await new Promise(r => setTimeout(r, 100));   // a phone's context is always older than the 2 s the probe sits at
      const res = { clock: ctx.currentTime };
      for (const voice of ['piano', 'sine', 'organ']) {
        Object.assign(window._webParams, { 'chord.voice': voice });
        for (const iso of [false, true]) {
          window._nsBank.isolated = iso; window._nsBank.have = {}; window._nsBank.bad = {}; window._nsBank.badWhy = {};
          const r = await window._nsBank.ensureChord([34, 48, 60, 72], true);
          res[voice + (iso ? ' isolated' : '')] = { built: r.built, failed: r.failed.map(f => f.why) };
        }
      }
      window._nsBank.isolated = false;
      return res;
    });
    ok(out.clock >= 4, 'the audio clock is well past the 2 s the probe sits at', out.clock);
    for (const k of Object.keys(out)) if (k !== 'clock') ok(out[k].failed.length === 0 && out[k].built === 4, 'held chord banks on a running clock: ' + k, out[k]);
    ok(errors.length === 0, 'no page errors', errors);
  } finally { await browser.close(); server.close(); }
  process.exit(failed ? 1 : 0);
})();
