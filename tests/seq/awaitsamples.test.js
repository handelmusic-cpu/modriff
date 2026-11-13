/* A native claim needs the band's sampled instruments decoded first. The chord voice never asked for its own load, so a song whose chord
   voice was a sampled instrument not yet loaded was refused ("native chord preparation refused") and the run stayed on the page, which
   pauses on leaving the app. window._nsBank.awaitSamples loads and waits. Run: node tests/seq/awaitsamples.test.js */
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
      const sr = 48000, offline = new OfflineAudioContext(2, sr * 8, sr); audioCtx = offline;
      const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
      const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
      const stub = new Proxy({ graphBuf() {}, graphBegin() {}, graphEdit() {} }, { get: (t, k) => k in t ? t[k] : async () => ({ ok: true }) });
      window.modNativePlugin = () => stub; window._nsIntonation.sync = async () => ({ ok: true });
      modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']); _ensureAllPartBuses(offline);
      const lib = SAMPLED_WAVES.violin;
      Object.assign(window._webParams, { 'chord.voice': 'violin' });
      delete SAMPLE_STATE[lib]; (SAMPLE_BUFFERS[lib] || {}) && Object.keys(SAMPLE_BUFFERS[lib] || {}).forEach(k => delete SAMPLE_BUFFERS[lib][k]);
      window._nsBank.have = {}; window._nsBank.bad = {};
      const before = await window._nsBank.ensureChord([60, 64, 67]);
      const waited = await window._nsBank.awaitSamples(15000);
      const stateAfter = SAMPLE_STATE[lib];
      window._nsBank.have = {}; window._nsBank.bad = {};
      const after = await window._nsBank.ensureChord([60, 64, 67]);
      SAMPLE_STATE[lib] = 'error';
      const broken = await window._nsBank.awaitSamples(500);
      SAMPLE_STATE[lib] = 'loading';
      const slow = await window._nsBank.awaitSamples(120);
      SAMPLE_STATE[lib] = 'ready';
      return { before, waited, stateAfter, after, broken, slow };
    });
    ok(out.before.failed.length > 0, 'an unloaded sampled chord voice is refused by ensureChord', out.before);
    ok(out.waited.ok === true && out.stateAfter === 'ready', 'awaitSamples loads it and resolves ok', out);
    ok(out.after.failed.length === 0 && out.after.built === 3, 'the chord then records its three pitches', out.after);
    ok(out.broken.ok === false && /could not be loaded/.test(out.broken.why), 'a voice whose recordings failed is named', out.broken);
    ok(out.slow.ok === false && /did not finish loading/.test(out.slow.why), 'a load that never finishes times out with a reason', out.slow);
    ok(errors.length === 0, 'no page errors', errors);
  } finally { await browser.close(); server.close(); }
  process.exit(failed ? 1 : 0);
})();
