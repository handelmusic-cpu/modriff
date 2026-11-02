/* Studio comfort (6.2a - 6.2c): fold carets, the drum grid's scrolling and ruler, and the type floor.

   Driven on the real window with real touch (CDP):
     - Studio's Chords page has caret rows for Rhythm builder (open) and Chord voice (closed); each row is 44 pt
       or more; the pads stay above the builder;
     - the Borrowed & modal and Secondary dominants chords are all shown (6.3), under their own headings, and one
       small "More chords" caret in the "Play it" line hides both at once and shows them again; the row it replaced
       is gone, the caret is in a line that is already there (it adds no height), and the choice is kept;
     - a touch opens a closed block in place and a second touch closes it; the choice is kept across a reload;
     - Live has no caret rows and no More chords caret, and keeps its own shelves;
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

  // 1. The caret rows, and the chords that are not behind one.
  const keys = () => page.evaluate(() => [...document.querySelectorAll('.st-fold-h:not(.st-fold-g)')].map(h => h.dataset.k + ':' + h.getAttribute('aria-expanded')).join());
  const st = await page.evaluate(() => ({ hs: [...document.querySelectorAll('.st-fold-h:not(.st-fold-g)')].map(h => Math.round(h.getBoundingClientRect().height)),
    padsAbove: document.getElementById('chords-diatonic').getBoundingClientRect().top < document.getElementById('crh').getBoundingClientRect().top }));
  const k0 = await keys();
  check(k0 === 'crh:true,cvoice:false', 'Rhythm builder is open and Chord voice closed; no caret rows for the chords', k0);
  check(st.hs.every(h => h >= 44), 'every caret row is 44 pt or more', st.hs.join());
  check(st.padsAbove, 'the chords stay above the rhythm builder');
  check(!(await vis('#chord-voice-panel')), 'a closed block is out of the way');
  const sh = await page.evaluate(() => { const q = id => document.getElementById(id), r = e => e.getBoundingClientRect(), b = q('ch-xt');
    const lbl = document.querySelector('#chords-col > .chord-section-lbl'), lh = r(lbl).height;
    return { n: [q('chords-borrowed').children.length, q('chords-secdom').children.length], vis: [r(q('chords-borrowed')).height > 0, r(q('chords-secdom')).height > 0],
     heads: [...document.querySelectorAll('#chords-modal-wrap .chord-section-lbl, #chords-dom-wrap .chord-section-lbl')].map(e => r(e).height > 0 && getComputedStyle(e).display !== 'none').join(),
     bh: Math.round(r(b).height), lineH: Math.round(lh), exp: b.getAttribute('aria-expanded'), inLine: lbl.contains(b), below: r(q('chords-modal-wrap')).top >= r(q('chords-diatonic')).bottom - 1 }; });
  check(sh.n[0] > 0 && sh.n[1] > 0 && sh.vis[0] && sh.vis[1], 'Borrowed & modal and Secondary dominants are shown with nothing opened', JSON.stringify(sh.n));
  check(sh.heads === 'true,true', 'each keeps its own heading, so the rows say what they are');
  check(sh.inLine && sh.bh >= 44 && sh.lineH < 36 && sh.exp === 'true', 'one caret in the Play it line, 44 pt to touch, and the line does not grow for it', JSON.stringify([sh.bh, sh.lineH, sh.exp]));

  // 2. Hide all, show all, kept; and the blocks that do fold.
  await tap('#ch-xt');
  check(!(await vis('#chords-borrowed')) && !(await vis('#chords-secdom')) && (await page.evaluate(() => document.getElementById('ch-xt').getAttribute('aria-expanded'))) === 'false', 'a touch on the caret hides both rows of chords');
  await boot();
  check(!(await vis('#chords-borrowed')) && !(await vis('#chords-secdom')), 'hidden stays hidden across a reload');
  await tap('#ch-xt');
  check((await vis('#chords-borrowed')) && (await vis('#chords-secdom')), 'a second touch shows both again');
  await tap(hdr('crh'));
  check(!(await vis('#crh-roll')), 'the Rhythm builder still folds');
  await tap(hdr('crh'));
  await tap(hdr('cvoice'));
  check(await vis('#chord-voice-panel'), 'Chord voice opens');
  await boot();
  const kept = await keys();
  check(kept === 'crh:true,cvoice:true', 'what is open is kept across a reload', kept);
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  check(!(await vis('.st-fold-h:not(.st-fold-g)')) && !(await vis('#ch-xt')), 'Live has no caret rows and no More chords caret');
  // Studio's hidden state must not leak into Live: hide the chords here, then open Live's own shelf.
  await page.evaluate(() => { document.getElementById('ch-xt').click(); });
  await page.evaluate(() => { chordMoreSet('modal'); }); await page.waitForTimeout(200);
  check(await vis('#chords-borrowed'), 'what Studio hides does not hide the shelf Live opens with its own More row');
  await page.evaluate(() => { chordMoreSet('off'); document.getElementById('ch-xt').click(); });

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
