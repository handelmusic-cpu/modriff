/* Studio comfort (6.2a - 6.2c): fold carets, the drum grid's scrolling and ruler, and the type floor.

   Driven on the real window with real touch (CDP):
     - Studio's Chords page has caret rows for Rhythm builder (open), Borrowed & modal, Secondary dominants
       and Chord voice (closed); each row is 44 pt or more; the pads stay above the builder;
     - a touch opens a closed block in place and a second touch closes it; the choice is kept across a reload;
     - Live has no caret rows;
     - the drum grid scrolls on both axes (touch-action pan-x pan-y) and its step numbers are inside the
       scroller, not cut off above it;
     - no text on Studio's Chords page or the drum page is under 10 px; the Settings tab's word is not
       clipped by the screen edge.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/folds/probe.js
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

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const boot = async () => {
    await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); switchTab('perform'); }); await page.waitForTimeout(500);
  };
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await boot();
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; }, sel);
  const hdr = (k) => '.st-fold-h[data-k="' + k + '"]';

  // 1. The caret rows.
  const st = await page.evaluate(() => ({ keys: [...document.querySelectorAll('.st-fold-h:not(.st-fold-g)')].map(h => h.dataset.k + ':' + h.getAttribute('aria-expanded')).join(),
    hs: [...document.querySelectorAll('.st-fold-h:not(.st-fold-g)')].map(h => Math.round(h.getBoundingClientRect().height)),
    padsAbove: document.getElementById('chords-diatonic').getBoundingClientRect().top < document.getElementById('crh').getBoundingClientRect().top }));
  check(st.keys === 'crh:true,modal:false,secdom:false,cvoice:false', 'Rhythm builder is open; Borrowed & modal, Secondary dominants and Chord voice are closed', st.keys);
  check(st.hs.every(h => h >= 44), 'every caret row is 44 pt or more', st.hs.join());
  check(st.padsAbove, 'the chords stay above the rhythm builder');
  check(!(await vis('#chords-borrowed')) && !(await vis('#chord-voice-panel')), 'closed blocks are out of the way');

  // 2. Open, close, kept.
  await tap(hdr('modal'));
  check(await vis('#chords-borrowed'), 'a touch on Borrowed & modal opens it in place');
  await tap(hdr('modal'));
  check(!(await vis('#chords-borrowed')), 'a second touch closes it');
  await tap(hdr('cvoice'));
  check(await vis('#chord-voice-panel'), 'Chord voice opens');
  await boot();
  const kept = await page.evaluate(() => [...document.querySelectorAll('.st-fold-h:not(.st-fold-g)')].map(h => h.dataset.k + ':' + h.getAttribute('aria-expanded')).join());
  check(kept === 'crh:true,modal:false,secdom:false,cvoice:true', 'what is open is kept across a reload', kept);
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  check(!(await vis('.st-fold-h:not(.st-fold-g)')), 'Live has no caret rows');

  // 3. The drum grid.
  await page.evaluate(() => { setViewMode('studio'); switchTab('perform'); document.getElementById('ft-drum-btn').click(); }); await page.waitForTimeout(700);
  const g = await page.evaluate(() => { const sc = document.getElementById('sq-gScroll'), r = sc.getBoundingClientRect(); const c = document.querySelector('.sq-gruler .sq-rcell.b4') || document.querySelector('.sq-gruler .sq-rcell');
    const q = c.getBoundingClientRect(); const rg = document.createRange(); const t = [...document.querySelectorAll('.sq-gruler .sq-rcell')].find(x => x.textContent.trim()); rg.selectNodeContents(t); const tr = rg.getBoundingClientRect();
    return { ta: getComputedStyle(sc).touchAction, textTop: tr.top, scTop: r.top, textBottom: tr.bottom, firstRowTop: document.querySelectorAll('.sq-grow')[1].getBoundingClientRect().top }; });
  check(/pan-x/.test(g.ta) && /pan-y/.test(g.ta), 'the grid scrolls on both axes, so the page can be scrolled from a finger on it', g.ta);
  check(g.textTop >= g.scTop - 0.5 && g.textBottom <= g.firstRowTop + 0.5, 'the step numbers are inside the scroller and above the first row, not cut off', JSON.stringify([g.scTop, g.textTop, g.textBottom, g.firstRowTop].map(Math.round)));

  // 4. Type.
  const small = async () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1) && parseFloat(cs.fontSize) < 10; }).map(e => (e.className || e.tagName) + ':' + parseFloat(getComputedStyle(e).fontSize)).slice(0, 6));
  let sm = await small();
  check(sm.length === 0, 'no text under 10 px on the drum page', sm.join(' | '));
  await page.evaluate(() => { document.getElementById('ft-chd-btn').click(); }); await page.waitForTimeout(500);
  sm = await small();
  check(sm.length === 0, 'no text under 10 px on Studio\'s Chords page', sm.join(' | '));
  const tm = await page.evaluate(() => { const l = document.querySelector('.tab-more .tm-lbl').getBoundingClientRect(); return { r: l.right, w: innerWidth, fs: parseFloat(getComputedStyle(document.querySelector('.tab-more .tm-lbl')).fontSize) }; });
  check(tm.r <= tm.w - 2 && tm.fs >= 10.5, 'the Settings tab\'s word is whole and not tiny', JSON.stringify(tm));
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
