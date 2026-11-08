/* A locked Sounds Pack voice (6.9.9.9.7): tapping it in the sound list plays the current chord
   once in that voice, twice per voice, then only opens the sheet; the selected voice never
   changes; nothing reaches a take; the counts are modo-previews and survive a reload; with
   the Sounds Pack a tap selects the voice as before and previews nothing.

   Real touch (CDP Input.dispatchTouchEvent) on the Live page's chord Voice list. A sound is
   counted where it starts on the real AudioContext (the offline renders that make the chord
   are not sounds). The take is measured, as in tests/sampler/preview.test.js.

   Run (repo served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/voicepreview.test.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

async function boot(page) {
  await page.goto(URL); await page.waitForTimeout(1500);
  if (await page.$('.unlock-btn >> text=Random')) await page.click('.unlock-btn >> text=Random');
  await page.waitForTimeout(7000);   // the toast Random leaves at the top covers the Voice button until it goes
  await page.evaluate(() => {
    if (isAnythingPlaying()) ftPlayStop();
    window.__starts = 0; window.__toasts = []; window.__prev = 0;
    // A sound = a source started on the real context (the offline renders are not).
    const st = AudioBufferSourceNode.prototype.start, ost = OscillatorNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { if (this.context === getCtx()) window.__starts++; return st.apply(this, arguments); };
    const mt = window.majorToast; window.majorToast = function (m) { window.__toasts.push(String(m)); return mt.apply(this, arguments); };
    const pp = window.voicePreviewPlay; window.voicePreviewPlay = function () { window.__prev++; return pp.apply(this, arguments); };
  });
}
async function open(browser, tier) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
  await page.goto(URL); await page.evaluate(t => { localStorage.clear(); localStorage.setItem('modo-dev-tier', t); }, tier);
  await boot(page);
  page.__cdp = await ctx.newCDPSession(page);
  return page;
}
// A real touch on the element a function (run in the page) returns.
async function tapEl(page, src) {
  const pt = async () => page.evaluate(s => { const e = (new Function('return (' + s + ')()'))(); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, src);
  await pt(); await page.waitForTimeout(150);
  const r = await pt(); if (!r) throw new Error('no element for ' + src);
  const c = page.__cdp, p = { x: r[0], y: r[1], id: 1 };
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(60);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}
const OPEN = "() => [...document.querySelectorAll('.pp-cell, button')].filter(b => b.offsetParent && /^Voice/.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0)[0]";
const FREE = "() => [...document.querySelectorAll('.pb-root .pb-row')].find(b => /^Free voices/.test(b.textContent.trim()))";
const item = name => "() => [...document.querySelectorAll('.pb-root .cp-item')].find(b => b.textContent.trim().replace(/\\s*\\u{1F512}$/u, '') === '" + name + "')";
const snap = page => page.evaluate(() => ({ starts: window.__starts, toasts: window.__toasts.length, sheet: !!document.getElementById('_pro-sheet'), prev: window.__prev, store: localStorage.getItem('modo-previews'), wave: wave, listOpen: !!document.querySelector('.pb-root .cp-item') && !!document.querySelector('.pb-root').offsetParent }));
// The list reopens where it was left (the Free voices tier), so the row is tapped only when it is there.
const openList = async page => { if (!(await page.evaluate(() => [...document.querySelectorAll('.pb-root')].some(r => r.offsetParent && r.querySelector('.cp-item, .pb-row'))))) await tapEl(page, OPEN); if (await page.evaluate('!!(' + FREE + ')()')) await tapEl(page, FREE); };
const closeSheet = page => page.evaluate(() => { const o = document.getElementById('_pro-sheet'); if (o) o.remove(); });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });

  console.log('\n== free: the chord voice list');
  let page = await open(browser, 'free');
  const w0 = await page.evaluate(() => wave);
  await openList(page);
  const listed = await page.evaluate(() => [...document.querySelectorAll('.pb-root .cp-item')].map(b => b.textContent.trim()));
  check(listed.some(t => /^Organ/.test(t)) && /\u{1F512}/u.test(listed.find(t => /^Organ/.test(t)) || ''), 'the list shows Organ locked', listed.join(' | '));
  let s0 = await snap(page);
  await tapEl(page, item('Organ')); let s1 = await snap(page);
  check(s1.starts - s0.starts === 1 && s1.prev === 1, 'tap 1: one sound', JSON.stringify(s1));
  check(s1.toasts === 1 && !s1.sheet, 'tap 1: one toast, no sheet');
  check(s1.listOpen && s1.wave === w0, 'the list stays open and the voice is unchanged', s1.wave + ' vs ' + w0);
  await page.waitForTimeout(2700);
  await tapEl(page, item('Organ')); let s2 = await snap(page);
  check(s2.starts - s1.starts === 1 && s2.toasts === 2 && !s2.sheet, 'tap 2: a second sound, a second toast', JSON.stringify(s2));
  await page.waitForTimeout(2700);
  await tapEl(page, item('Organ')); let s3 = await snap(page);
  check(s3.starts === s2.starts && s3.sheet && s3.toasts === s2.toasts, 'tap 3: no sound, the sheet opens', JSON.stringify(s3));
  const what = await page.evaluate(() => document.querySelector('#_pro-sheet .pro-what').textContent);
  check(/Sounds Pack/.test(what), 'the sheet names the Sounds Pack', what);
  check(s3.wave === w0, 'the selected voice never changed', s3.wave);
  check(JSON.parse(s3.store)['voice:organ'] === 2, 'one key, modo-previews, counts voice:organ = 2', s3.store);
  await closeSheet(page);
  // Another voice has its own two. (The toast the last tap left sits over the Voice button for a while.)
  await page.waitForTimeout(4500);
  await openList(page);
  const s4 = await snap(page);
  await tapEl(page, item('Electric Piano'));
  const s5 = await snap(page);
  check(s5.starts - s4.starts === 1 && !s5.sheet && s5.wave === w0, 'a different voice (Electric Piano) still has its previews', JSON.stringify({ starts: s5.starts - s4.starts, sheet: s5.sheet }));
  // The level is one fixed level for all of them: the rendered chords peak at 0.45.
  const peaks = await page.evaluate(() => Object.keys(_vpCache).map(k => { let p = 0; const d = _vpCache[k].getChannelData(0); for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return k.split('|')[0] + '=' + p.toFixed(3); }));
  check(peaks.length >= 2 && peaks.every(x => Math.abs(+x.split('=')[1] - 0.45) < 0.02), 'the previews are at one level (-6 dB re full)', peaks.join(' '));
  check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));

  // Every voice the pack holds: it renders, sounds once on the real context, and peaks at the one level
  // (the recorded ones load first; the basses play their root).
  const all = await page.evaluate(async () => {
    const out = {};
    for (const w of SOUNDS_VOICES) {
      const s0 = window.__starts; await voicePreviewPlay(w);
      const k = Object.keys(_vpCache).find(k => k.startsWith(w + '|')); let pk = 0;
      if (k) { const d = _vpCache[k].getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
      out[w] = { sounded: window.__starts - s0, peak: +pk.toFixed(2), notes: _vpNotes(w).length };
      await new Promise(r => setTimeout(r, 200));
    }
    return out;
  });
  check(Object.keys(all).length === 7 && Object.values(all).every(v => v.sounded === 1 && v.peak === 0.45), 'all seven Sounds Pack voices preview, once each, at one level', JSON.stringify(all));
  check(all.bass_motown.notes === 1 && all.bass_hofner.notes === 1 && all.organ.notes >= 3, 'a vintage bass plays the root, the others the chord');

  console.log('\n== free: a take');
  await closeSheet(page);
  await page.evaluate(() => {
    const ctx = getCtx(), o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 220; g.gain.value = 0.05; o.connect(g); g.connect(window._masterOut); o.start();
    window.__peak = null;
    window._deliverFiles = async function (list) {
      const f = list.find(x => /\.wav$/.test(x.name)), u = new Uint8Array(await f.blob.arrayBuffer()), dv = new DataView(u.buffer);
      let off = 12; while (String.fromCharCode(u[off], u[off + 1], u[off + 2], u[off + 3]) !== 'data') off += 8 + dv.getUint32(off + 4, true);
      let pk = 0; for (let i = off + 8; i + 1 < u.length; i += 2) pk = Math.max(pk, Math.abs(dv.getInt16(i, true)) / 32768);
      window.__peak = pk;
    };
  });
  // A voice with previews left: Vibes (a recorded voice, in the Samples tier).
  await page.waitForTimeout(5000);
  const rec0 = await snap(page);
  await page.evaluate(() => toggleRecording());
  await page.waitForTimeout(600);
  await openList(page);
  const nm = await page.evaluate(() => [...document.querySelectorAll('.pb-root .cp-item')].find(b => /\u{1F512}/u.test(b.textContent) && !/^Organ/.test(b.textContent)).textContent.trim().replace(/\s*\u{1F512}$/u, ''));
  await tapEl(page, item(nm));
  const rec1 = await snap(page);
  check(rec1.starts === rec0.starts && rec1.sheet, 'during a take: no sound, the sheet opens', JSON.stringify({ starts: rec1.starts - rec0.starts, sheet: rec1.sheet }));
  check(JSON.parse(rec1.store)['voice:' + 'x'] === undefined && Object.keys(JSON.parse(rec1.store)).length === Object.keys(JSON.parse(s5.store)).length, 'and the take used nobody\'s preview up', rec1.store);
  await closeSheet(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => toggleRecording());
  for (let i = 0; i < 30 && (await page.evaluate(() => window.__peak)) === null; i++) await page.waitForTimeout(300);
  const pk = await page.evaluate(() => window.__peak);
  check(pk !== null && pk < 0.07, 'the take holds the tone and no voice: peak is the tone\'s', pk && pk.toFixed(3));

  console.log('\n== free: after a reload');
  await boot(page);
  await openList(page);
  const b0 = await snap(page);
  await tapEl(page, item('Organ')); const b1 = await snap(page);
  check(b1.starts === b0.starts && b1.sheet, 'Organ stayed spent: no sound, the sheet opens', JSON.stringify({ starts: b1.starts - b0.starts, sheet: b1.sheet }));
  check(JSON.parse(b1.store)['voice:organ'] === 2, 'the count survived the reload', b1.store);
  await page.close();

  console.log('\n== Sounds Pack: as before');
  page = await open(browser, 'pro');
  await openList(page);
  const p0 = await snap(page);
  await tapEl(page, item('Organ')); const p1 = await snap(page);
  check(p1.prev === 0 && p1.starts === p0.starts, '0 previews', p1.prev);
  check(p1.wave === 'organ', 'the tap selects the voice', p1.wave);
  check(!p1.sheet && p1.toasts === 0 && p1.store === null, 'no sheet, no toast, no modo-previews', JSON.stringify(p1));
  check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));
  await page.close();

  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
