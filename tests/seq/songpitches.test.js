/* A song's native claim records the chord voice for every pitch the song can need. With Vary, a drop voicing or a practice key change that is
   every pitch 0..127, and the piano chord cannot be recorded below E1 ("length slots are neither a line nor a line held"). That refused the
   claim -- "native chord preparation refused" -- and a page-owned run pauses on leaving the app. Pitches only the "any voicing" filler asked
   for are optional now; the ones the chords need still are not.  Run: node tests/seq/songpitches.test.js */
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
      Object.assign(window._webParams, { 'chord.voice': 'piano' });
      sections[0].slots.push({ label: 'C', numeral: 'I', rootM: 60, triadQ: 'maj', type7: 'maj7', func: 'T', ext: 'triad', bassNote: null });
      const plain = window._songChordPitches();
      voiceVary = true;
      const vary = window._songChordPitches();
      const direct = await window._nsBank.ensureChord(vary.pitches);
      window._nsBank.have = {}; window._nsBank.bad = {}; window._nsBank.badWhy = {};
      const rep = await window._nsSong.prepareChords();
      // a pitch the chords need that the voice refuses is still a refusal
      window._nsBank.have = {}; window._nsBank.bad = {};
      const real = window._nsBank.buildChordNote;
      window._nsBank.buildChordNote = async function (v, p, h, s) { return p === 60 ? { ok: false, why: 'forced' } : real.call(this, v, p, h, s); };
      const needed = await window._nsSong.prepareChords();
      window._nsBank.buildChordNote = real;
      const sticky = await window._nsBank.ensureChord([60]);
      return { plainOptional: Object.keys(plain.optional).length, plainN: plain.pitches.length, varyOptional: Object.keys(vary.optional).length, varyN: vary.pitches.length,
        directFailed: direct.failed.length, directLow: direct.failed.every(f => f.pitch <= 28), rep, neededFailed: needed.failed.map(f => f.pitch), sticky: sticky.failed.map(f => f.why) };
    });
    ok(out.plainOptional === 0, 'without Vary every requested pitch is one the chords need', out);
    ok(out.varyOptional > 0 && out.varyN === 128, 'with Vary the filler pitches are marked optional', out);
    ok(out.directFailed > 0 && out.directLow, 'the piano voice cannot record the lowest pitches (the reason this was refused)', out);
    ok(out.rep.failed.length === 0 && out.rep.built > 0, 'prepareChords no longer refuses the song for them', out.rep);
    ok(out.neededFailed.length === 1 && out.neededFailed[0] === 60, 'a pitch the chord needs and the voice refuses is still a refusal', out.neededFailed);
    ok(out.sticky.length === 1 && /forced/.test(out.sticky[0]), 'a repeated refusal still names the first reason', out.sticky);
    ok(errors.length === 0, 'no page errors', errors);
  } finally { await browser.close(); server.close(); }
  process.exit(failed ? 1 : 0);
})();
