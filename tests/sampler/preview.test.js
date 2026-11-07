/* A locked pad (6.9.9.9.5): free sees the grid, a tap plays that pad's sample softly,
   twice, then only opens the sheet; it never reaches a take; the counts survive a reload;
   with the Sampler Engine nothing changes.

   Real touch (CDP Input.dispatchTouchEvent). Sounds are counted where they start
   (AudioBufferSourceNode.start), toasts at majorToast, sheets at #_pro-sheet. The take is
   measured: a steady tone at 0.05 is recorded, a pad is tapped just before the take starts
   and again during it, and the file's peak must still be the tone's.

   Run (repo served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/sampler/preview.test.js
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

async function open(browser, tier, keep) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
  await page.goto(URL); await page.evaluate(t => { localStorage.clear(); localStorage.setItem('modo-dev-tier', t); }, tier);
  await boot(page);
  page.__cdp = await ctx.newCDPSession(page);
  return page;
}
async function boot(page) {
  await page.goto(URL); await page.waitForTimeout(1500);
  if (await page.$('.unlock-btn >> text=Random')) await page.click('.unlock-btn >> text=Random');
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (isAnythingPlaying()) ftPlayStop();
    window.__starts = 0; window.__toasts = []; window.__prevCalls = 0;
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { window.__starts++; return st.apply(this, arguments); };
    const mt = window.majorToast; window.majorToast = function (m) { window.__toasts.push(String(m)); return mt.apply(this, arguments); };
    const pp = window.psPreviewPlay; window.psPreviewPlay = function () { window.__prevCalls++; return pp.apply(this, arguments); };
  });
  await page.waitForFunction(() => { const s = SMP_SLOTS['p:PA:0'], t = SMP_SLOTS['p:PA:1']; return s && SMP_BUF[s.id] && t && SMP_BUF[t.id]; }, null, { timeout: 15000 });
}
// A tap on pad i with a real touch.
async function tap(page, i) {
  const r = await page.evaluate(i => {
    const p = document.querySelector('#ps-grid .ps-pad[data-i="' + i + '"]');
    p.scrollIntoView({ block: 'center' });
    const b = p.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2];
  }, i);
  await page.waitForTimeout(150);
  const r2 = await page.evaluate(i => { const b = document.querySelector('#ps-grid .ps-pad[data-i="' + i + '"]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, i);
  const c = page.__cdp, pt = { x: r2[0], y: r2[1], id: 1 };
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
  await page.waitForTimeout(60);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}
const snap = page => page.evaluate(() => ({ starts: window.__starts, toasts: window.__toasts.length, sheet: !!document.getElementById('_pro-sheet'), prev: window.__prevCalls, store: localStorage.getItem('modo-previews') }));
const closeSheet = page => page.evaluate(() => { const o = document.getElementById('_pro-sheet'); if (o) o.remove(); });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });

  console.log('\n== free: locked pads');
  let page = await open(browser, 'free');
  const look = await page.evaluate(() => ({ pads: [...document.querySelectorAll('#ps-grid .ps-pad')].filter(p => p.style.display !== 'none').length,
    locked: [...document.querySelectorAll('#ps-grid .ps-pad')].filter(p => p.style.display !== 'none' && p.classList.contains('ps-locked')).length,
    wave: [...document.querySelectorAll('#ps-grid .ps-pad .ps-wf path')].filter(p => (p.getAttribute('d') || '').length > 20).length,
    op: getComputedStyle(document.querySelector('#ps-grid .ps-pad')).opacity }));
  check(look.pads >= 4 && look.locked === look.pads, 'every pad on show is drawn locked', JSON.stringify(look));
  check(look.wave >= look.pads, 'the preset waveforms are drawn', look.wave);
  check(+look.op < 1, 'dimmed', look.op);

  let s0 = await snap(page);
  await tap(page, 0); let s1 = await snap(page);
  check(s1.starts - s0.starts === 1 && s1.prev === 1, 'tap 1: one sound', JSON.stringify(s1));
  check(s1.toasts === 1 && !s1.sheet, 'tap 1: one toast, no sheet');
  await page.waitForTimeout(2700);
  await tap(page, 0); let s2 = await snap(page);
  check(s2.starts - s1.starts === 1, 'tap 2: a second sound', JSON.stringify(s2));
  check(s2.toasts === 2 && !s2.sheet, 'tap 2: another toast, still no sheet');
  await page.waitForTimeout(2700);
  await tap(page, 0); let s3 = await snap(page);
  check(s3.starts === s2.starts && s3.prev === s2.prev, 'tap 3: no sound');
  check(s3.sheet && s3.toasts === s2.toasts, 'tap 3: the sheet opens (and no toast)');
  const sheetText = await page.evaluate(() => document.querySelector('#_pro-sheet .pro-what').textContent);
  check(/sampler.*Sampler Engine/i.test(sheetText), 'the sheet names the pack', sheetText);
  check(s3.store && JSON.parse(s3.store)['pad:PA1'] === 2, 'one key, modo-previews, counts pad PA1 = 2', s3.store);
  await closeSheet(page);
  const sel = await page.evaluate(() => ({ sel: PS.sel, live: Object.keys(PS_LIVE).length, ev: JSON.stringify(typeof PS_PAT !== 'undefined' ? PS_PAT : null).length }));
  check(sel.live === 0, 'nothing was struck (PS_LIVE empty)', JSON.stringify(sel));
  // Another pad has its own two.
  await tap(page, 1); let s4 = await snap(page);
  check(s4.starts - s3.starts === 1, 'a different pad still has its previews', JSON.stringify(s4));
  // A storage that throws: the preview still plays.
  await page.waitForTimeout(2700);
  await page.evaluate(() => { window.__ss = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('full'); }; });
  await tap(page, 2); let s5 = await snap(page);
  check(s5.starts - s4.starts === 1 && !s5.sheet, 'storage that throws: the preview plays anyway', JSON.stringify(s5));
  await page.evaluate(() => { Storage.prototype.setItem = window.__ss; });
  check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));

  console.log('\n== free: a take');
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
  // pad 3 is untouched: tap it, and start the take while it is still sounding.
  await page.waitForTimeout(2700);
  let b0 = await snap(page);
  await tap(page, 3); let b1 = await snap(page);
  check(b1.starts - b0.starts === 1, 'before the take: a preview sounds', JSON.stringify(b1));
  await page.evaluate(() => toggleRecording());
  await page.waitForTimeout(900);
  await closeSheet(page);
  await page.waitForTimeout(2700);
  let b2 = await snap(page);
  await tap(page, 3); await tap(page, 0); let b3 = await snap(page);
  check(b3.starts === b2.starts && b3.prev === b2.prev, 'during the take: 0 previews', JSON.stringify({ starts: b3.starts - b2.starts, prev: b3.prev - b2.prev }));
  check(b3.sheet, 'during the take: a locked pad opens the sheet');
  check(JSON.parse(b3.store)['pad:PA4'] === 1, 'and the take did not use up a preview', b3.store);
  await closeSheet(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => toggleRecording());
  for (let i = 0; i < 30 && (await page.evaluate(() => window.__peak)) === null; i++) await page.waitForTimeout(300);
  const peak = await page.evaluate(() => window.__peak);
  check(peak !== null && peak > 0.03 && peak < 0.07, 'the take holds the tone and nothing else: peak is the tone\'s (0.05)', peak);

  console.log('\n== free: after a reload');
  await boot(page);
  const before = await snap(page);
  await tap(page, 0); const after = await snap(page);
  check(after.starts === before.starts && after.sheet, 'pad 1 stayed spent: no sound, the sheet opens', JSON.stringify(after));
  check(JSON.parse(after.store)['pad:PA1'] === 2, 'the count survived the reload', after.store);
  await page.close();

  console.log('\n== Sampler Engine: as before');
  page = await open(browser, 'pro');
  const pro = await page.evaluate(() => ({ locked: document.querySelectorAll('#ps-grid .ps-pad.ps-locked').length, op: getComputedStyle(document.querySelector('#ps-grid .ps-pad')).opacity }));
  check(pro.locked === 0 && +pro.op === 1, 'no locked style', JSON.stringify(pro));
  const p0 = await snap(page);
  await tap(page, 0); await tap(page, 0); await tap(page, 0);
  const p1 = await snap(page);
  check(p1.prev === 0, '0 previews', p1.prev);
  check(p1.starts - p0.starts >= 3, 'each tap strikes the pad as before', p1.starts - p0.starts);
  check(!p1.sheet && p1.toasts === 0 && p1.store === null, 'no sheet, no toast, no modo-previews', JSON.stringify(p1));
  check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));
  await page.close();

  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
