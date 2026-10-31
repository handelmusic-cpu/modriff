/* The More row on Live (5.4): one chip in the Chords heading brings in one shelf of
   chords as a single row under the seven.

   Driven on the real window with real touch (CDP):
     - it starts on Modal: eight pads in one row, straight under the seven, 64 pt tall
       and no narrower than 44 pt; the Studio shelf's own label is not repeated;
     - the chip steps Modal, Dominants, Mine, Off and round, naming each; the choice is
       kept across a reload (modo-live-more);
     - Dominants is five pads in one row, Off is none;
     - a pad in the row plays the chord it names (the same builders as Studio);
     - Mine is the pinned chords on a row of their own, and while it is not chosen they
       stay inside the key's row, as before;
     - Studio is as it was: no chip, the shelves where they were;
     - it fits at every phone width.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/more/probe.js
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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const boot = async () => {
    await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
    await page.waitForTimeout(400);
  };
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); });
  await boot();
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  // What is on screen as a row: the visible pads of each shelf.
  const rows = () => page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const info = id => { const el = document.getElementById(id); if (!el || !vis(el)) return null; const k = [...el.children].filter(vis).map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }); return { n: k.length, tops: [...new Set(k.map(x => x[1]))].length, minW: Math.min(...k.map(x => x[2]), 999), h: k.length ? k[0][3] : 0, top: k.length ? k[0][1] : 0, right: Math.max(...k.map(x => x[0] + x[2]), 0) }; };
    const dia = document.getElementById('chords-diatonic').getBoundingClientRect();
    const cr = document.getElementById('cr-bar').getBoundingClientRect();
    return { chip: (document.getElementById('pf-more-chip') || {}).textContent, chipVisible: vis(document.getElementById('pf-more-chip')),
             modal: info('chords-borrowed'), dom: info('chords-secdom'), mine: info('chords-user'), diaBottom: Math.round(dia.bottom), crTop: Math.round(cr.top), diaN: document.getElementById('chords-diatonic').children.length,
             docW: document.documentElement.scrollWidth, innerW: innerWidth,
             stored: localStorage.getItem('modo-live-more') };
  });

  // ── 1. The default.
  let r = await rows();
  check(r.chipVisible && r.chip === '+ Modal', 'Live starts on Modal, and the chip says so', r.chip);
  check(r.modal && r.modal.n === 8 && r.modal.tops === 1, 'eight pads in one row', JSON.stringify(r.modal));
  check(r.modal && r.modal.h >= 60 && r.modal.minW >= 44, 'at 64 pt tall and no narrower than 44 (at 430; narrower phones see 39 to 44: a play surface, like the keys)', r.modal && (r.modal.h + 'x' + r.modal.minW));
  check(r.modal && r.modal.top >= r.diaBottom && r.modal.top < r.crTop, 'straight under the seven, above the rhythm bar', JSON.stringify([r.diaBottom, r.modal && r.modal.top, r.crTop]));
  check(!r.dom && !r.mine, 'and nothing else is showing');

  // ── 2. A pad plays its chord.
  const before = await page.evaluate(() => [lastChordRoot, lastChordIntvs.join()]);
  await page.evaluate(() => { document.getElementById('chords-borrowed').children[1].scrollIntoView({ block: 'center' }); });
  const pad = await page.evaluate(() => { const c = document.getElementById('chords-borrowed').children[1]; return c.textContent.replace(/\s+/g, ' ').trim(); });
  await tap('#chords-borrowed > :nth-child(2)');
  const after = await page.evaluate(() => [lastChordRoot, lastChordIntvs.join(), lastChordFunc]);
  check(after[0] % 12 === 5 && /^0,3,7/.test(after[1]), 'tapping the iv pad (' + pad.slice(0, 20) + ') plays F minor (a 7th, as the Studio pad does)', JSON.stringify([before, after]));

  // ── 3. The chip steps.
  await tap('#pf-more-chip'); r = await rows();
  check(r.chip === '+ Dominants' && r.dom && r.dom.n === 5 && r.dom.tops === 1 && !r.modal, 'next: Dominants, five pads in a row, Modal gone', JSON.stringify([r.chip, r.dom, !!r.modal]));
  await tap('#pf-more-chip'); r = await rows();
  check(r.chip === '+ Mine' && !r.modal && !r.dom, 'next: Mine (nothing pinned, so no row)', JSON.stringify([r.chip, r.mine]));
  await tap('#pf-more-chip'); r = await rows();
  check(r.chip === '+ More' && !r.modal && !r.dom && !r.mine, 'next: Off, nothing shown, the chip says More', r.chip);
  check(r.stored === 'off', 'the choice is stored', r.stored);
  await tap('#pf-more-chip'); r = await rows();
  check(r.chip === '+ Modal' && r.modal && r.modal.n === 8, 'and round to Modal again', r.chip);

  // ── 4. Kept across a reload.
  await tap('#pf-more-chip');            // Dominants
  await boot(); r = await rows();
  check(r.chip === '+ Dominants' && r.dom && r.dom.n === 5, 'a reload keeps it', r.chip);

  // ── 5. Mine: pinned chords on a row of their own.
  await page.evaluate(() => { cpToggle(cpDegChord(8)); cpToggle(cpDegChord(10)); });
  r = await rows();
  const inKeyRow = r.diaN;
  check(inKeyRow === 9, 'while Mine is not chosen the two pinned chords sit in the key’s row, as before', inKeyRow + ' pads');
  await page.evaluate(() => { chordMoreSet('mine'); }); r = await rows();
  check(r.diaN === 7 && r.mine && r.mine.n === 2 && r.mine.tops === 1 && r.mine.top >= r.diaBottom, 'chosen, they leave it and take a row: seven in the key row, two in Mine', JSON.stringify([r.diaN, r.mine]));
  await page.evaluate(() => { chordMoreSet('off'); }); r = await rows();
  check(r.diaN === 9 && !r.mine, 'Off puts them back in the key’s row', r.diaN + ' pads');
  await page.evaluate(() => { cpToggle(cpDegChord(8)); cpToggle(cpDegChord(10)); chordMoreSet('modal'); });

  // ── 6. Studio is as it was.
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); setPerformMode('chords'); }); await page.waitForTimeout(400);
  r = await rows();
  check(!r.chipVisible, 'Studio has no chip');
  check(r.modal && r.dom && r.modal.n === 8 && r.dom.n === 5, 'and shows both shelves, as it always did', JSON.stringify([r.modal && r.modal.n, r.dom && r.dom.n]));
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(300);

  // ── 7. Every width.
  for (const W of [360, 375, 390, 402, 430, 440]) {
    await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(250);
    await page.evaluate(() => { chordMoreSet('modal'); }); r = await rows();
    check(r.modal && r.modal.right <= W && r.docW <= W && r.modal.minW >= 36, W + ' pt: the row fits, pads at least 36 wide', JSON.stringify([r.modal && r.modal.right, r.modal && r.modal.minW, r.docW]));
  }
  const heading = await page.evaluate(() => { const l = document.getElementById('pf-chords-lbl'); const r = l.getBoundingClientRect(); const kids = [...l.children].filter(c => c.getBoundingClientRect().width).map(c => c.getBoundingClientRect()); return { wraps: new Set(kids.map(k => Math.round(k.top))).size, right: Math.max(...kids.map(k => k.right)), w: innerWidth }; });
  check(heading.wraps === 1 && heading.right <= heading.w, 'the heading is one line at 440 pt', JSON.stringify(heading));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
