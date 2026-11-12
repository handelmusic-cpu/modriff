/* Hand chords reach native bass, melody and arp through one timestamped message.
   Exercise the real page's pad/chart and keyboard paths, separate phrase locks,
   slash tones, octave expansion, song ownership, bridge failures and web fallback.
   Run: node tests/seq/livechord.test.js */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.join(__dirname, '../..');
let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); }
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
    await page.waitForTimeout(1000);
    const out = await page.evaluate(async () => {
      const messages = [], decode = b => Array.from(new Float64Array(Uint8Array.from(atob(b), x => x.charCodeAt(0)).buffer));
      const plugin = { seqLiveChord: m => { messages.push(m); return Promise.resolve({ ok: true, frame: 12345 }); } };
      window.modNativePlugin = () => plugin;
      modGraphEnable(plugin, ['bass', 'melgen', 'arp']);
      const fake = { currentTime: 12.5, sampleRate: 44100 };
      clearTimeout(clockTimer);
      window.getCtx = () => fake;
      songLoopActive = false; _songBaseRoot = 0; root = 7; arpOcts = 3;
      const slot = { rootM: 65, ivs: [0, 4, 7, 11], bassNote: 48, isRest: false };
      window._blRestoreState({ steps: 2, grid: [{ v: 1, note: 0, oct: 2, len: 1 }], follow: true, gridRootPc: 0, gridIntvs: [0,4,7] });
      window._mlRestoreState({ steps: 2, grid: [{ v: 1, note: 0, oct: 4, len: 1 }], follow: true, gridRootPc: 0, gridIntvs: [0,4,7] });
      PHRASE_LOCKS.bass = {}; PHRASE_LOCKS.mel = {};
      const key = window.phraseKey(slot);
      PHRASE_LOCKS.bass[key] = { steps: 1, rootPc: 5, grid: [{ v: 1, note: 7, oct: 2, len: 1, accent: true }] };
      PHRASE_LOCKS.mel[key] = { steps: 1, rootPc: 5, grid: [{ v: 1, note: 11, oct: 4, len: 1, more: [{ note: 2, oct: 5 }] }] };
      const t0 = Date.now();
      _blLiveSlot(slot); await Promise.resolve();
      const m = messages[0];
      const first = { locksEnabled: !!window.phraseLockGet('bass', key), bass: decode(m.bass), mel: decode(m.mel), notes: decode(m.notes), ts: m.ts, t0, t1: Date.now(),
        expectedBass: window._blNativeChords(1, fake.currentTime), expectedMel: window._mlNativeChords(1, fake.currentTime), last: window._nsLiveChord.last, windows: window._blChordWindows() };
      // The keyboard chord identity is already sounding pitch too. Do not add
      // the chart's current capo a second time, even with its old base present.
      fake.currentTime = 14.125; arpOcts = 1;
      window._blOnLiveChord({ rootM: 62, ivs: [0,3,7], bassNote: null, isRest: false }); await Promise.resolve();
      const keyboard = { bass: decode(messages[1].bass), notes: decode(messages[1].notes) };
      // Each live tap replaces the open page window; it must not serialize an
      // ever-growing list of old pad chords as a native song chart.
      for (let i = 0; i < 10; i++) { fake.currentTime += 0.01; window._blOnLiveChord({ rootM: 60 + i, ivs: [0,4,7] }); }
      await Promise.resolve();
      const burst = messages.slice(2).map(m => ({ bass: decode(m.bass), mel: decode(m.mel) }));
      const count = messages.length;
      songLoopActive = true; await window._nsLiveChord.send(slot, fake.currentTime); songLoopActive = false;
      MODGRAPH.on = false; window._blOnLiveChord(slot); MODGRAPH.on = true;
      const guarded = messages.length === count;
      window.modNativePlugin = () => ({}); window._blOnLiveChord(slot);
      const oldHost = messages.length === count;
      window.modNativePlugin = () => ({ seqLiveChord: () => Promise.reject(new Error('bridge disconnected')) });
      const rejection = await window._nsLiveChord.send(slot, fake.currentTime);
      window.modNativePlugin = () => ({ seqLiveChord: () => Promise.resolve({ ok: false, why: 'song owns the timeline' }) });
      const refused = await window._nsLiveChord.send(slot, fake.currentTime);
      return { first, keyboard, burst, guarded, oldHost, rejection, refused };
    });
    const f = out.first;
    ok(JSON.stringify(f.bass) === JSON.stringify(f.expectedBass) && JSON.stringify(f.mel) === JSON.stringify(f.expectedMel), 'both production exporters preserve their own phrase locks', f);
    ok(f.bass[0] === 1 && f.bass[1] === 0 && f.bass[2] === 3600 && f.bass[4] === 5 && f.bass[5] === 0 && f.windows[0].rootPc === 5, 'one open window in seconds, sounding root and slash bass, no second capo', f.bass);
    ok(f.locksEnabled ? f.bass.includes(7) && f.mel.includes(11) && f.mel.includes(-7) && f.mel.length > f.bass.length : f.bass.at(-1) === 0 && f.mel.at(-1) === 0, f.locksEnabled ? 'bass and polyphonic melody locks have separate tables' : 'the free web page exports empty lock tables', [f.bass, f.mel]);
    ok(JSON.stringify(f.notes) === JSON.stringify([48,65,69,72,76,60,77,81,84,88,72,89,93,96,100]), 'slash bass first, full chord and three octaves for the arp', f.notes);
    ok(f.ts >= f.t0 - 2 && f.ts <= f.t1 + 2 && f.last.ok && f.last.frame === 12345, 'the AudioContext chord time maps to the graph voice wall clock', f);
    ok(out.keyboard.bass[4] === 2 && JSON.stringify(out.keyboard.notes) === '[62,65,69]', 'keyboard chord updates use their own sounding pitches', out.keyboard);
    ok(out.burst.length === 10 && out.burst.every(m => m.bass[0] === 1 && m.mel[0] === 1 && m.bass[1] === 0 && m.mel[1] === 0), 'ten rapid hand chords remain ten independent single-window changes', out.burst);
    ok(out.guarded && out.oldHost, 'the running page song, web path and older host retain their scheduling', out);
    ok(!out.rejection.ok && out.rejection.why.includes('bridge disconnected') && !out.refused.ok, 'bridge failure and native ownership refusal remain visible', out);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
