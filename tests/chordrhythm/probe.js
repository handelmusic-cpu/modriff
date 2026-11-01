/* The chord rhythm builder on Studio's Chords page (6.0j, steps as a free count in 6.0k).

   Driven on the real window with real touch (CDP):
     - it is on Studio's Chords page and not on Live;
     - Steps is any count from 1 to 64 (6, 9, 12, 15, 18, 24 are a touch away), the loop cut into that many equal
       steps: twelve over a bar is eighth triplets, nine and fifteen are their own grids, and every hit falls on a step;
     - the - and + on Steps and on Length move by exactly one for one touch (not two), and stop at 1 and 64;
     - Length is the drum pattern's (Drums) or its own number of sixteenths, 1 to 64 as the drum grid is;
       with Drums a 32-step drum pattern makes the loop 32, and when the drums change it follows;
     - a touch on a step cycles it off, soft, normal, accent, and what is drawn is what the pads play (CR);
     - changing the count moves the hits to the nearest step instead of losing them;
     - it is kept (modo-chord-rhythm) across a reload.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/chordrhythm/probe.js
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
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0; }, sel);
  const state = () => page.evaluate(() => ({ cells: document.querySelectorAll('#crh-roll .crh-cell').length, grid: CR.def && CR.def.grid,
    p: crPattern().ev.map(e => +e.p.toFixed(3)), L: crPattern().steps, nval: document.getElementById('crh-nval').textContent, lval: document.getElementById('crh-lval').textContent }));
  const chip = async (n) => { const i = await page.evaluate(n => [...document.querySelectorAll('#crh-chips button')].findIndex(b => b.textContent.trim() === String(n)), n); await tap('#crh-chips button:nth-child(' + (i + 1) + ')'); };
  const onGrid = (p, n, L) => p.every(x => Math.abs(x * n / L - Math.round(x * n / L)) < 2e-3);

  // 1. Where it is.
  await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
  check(!(await vis('#crh-roll')), 'it is not on Live');
  await page.evaluate(() => { setViewMode('studio'); switchTab('perform'); });
  await page.waitForTimeout(500);
  check(await vis('#crh-roll'), 'it is on Studio\'s Chords page');
  let s = await state();
  check(s.cells === 16 && s.nval === '16' && s.lval === '16', 'the starting rhythm is laid on its own 16 steps over 16 sixteenths', s.cells + ' ' + s.nval + ' ' + s.lval);

  // 2. Cycle a step by touch.
  await page.evaluate(() => { CR.key = 'strum'; CR.def = null; crhSet('n', 16); });
  const lvls = [];
  for (let k = 0; k < 4; k++) { await tap('#crh-roll .crh-cell:nth-child(2)'); lvls.push(await page.evaluate(() => { const c = CR.def.cells[1]; return c.on ? (c.acc ? 'accent' : c.soft ? 'soft' : 'normal') : 'off'; })); }
  check(lvls.join() === 'soft,normal,accent,off', 'a touch on a step cycles soft, normal, accent, off', lvls.join());
  await tap('#crh-roll .crh-cell:nth-child(2)');
  s = await state();
  check(s.p.indexOf(1) >= 0 && s.L === 16, 'what is drawn is what the pads play: a hit on the second sixteenth', JSON.stringify(s.p));
  const hits16 = s.p.length;

  // 3. A free count of steps.
  await chip(32); await chip(16); s = await state();
  check(s.p.length === hits16, 'finer and back: 32 steps and 16 again keeps every hit', s.p.length + ' of ' + hits16);
  for (const n of [12, 9, 15, 6, 18, 24]) {
    await chip(n);
    s = await state();
    check(s.cells === n && s.grid.n === n && s.L === 16 && onGrid(s.p, n, 16) && s.p.length >= 1, n + ' steps over the bar: that many cells and every hit on a step', s.cells + ' ' + JSON.stringify(s.p));
  }
  await chip(12);
  s = await state();
  check(s.cells === 12 && s.p.every(x => Math.abs(x * 3 / 4 - Math.round(x * 3 / 4)) < 2e-3), '12 is the eighth triplet: every hit on a third of a beat', JSON.stringify(s.p));

  // 4. The steppers move by one.
  await tap('#crh-nplus'); s = await state();
  check(s.grid.n === 13 && s.cells === 13, 'one touch on + is one more step (13)', s.grid.n);
  await tap('#crh-nminus'); await tap('#crh-nminus'); s = await state();
  check(s.grid.n === 11 && s.cells === 11, 'two touches on - are two fewer (11)', s.grid.n);
  await page.evaluate(() => crhSet('n', 64)); await tap('#crh-nplus'); s = await state();
  check(s.grid.n === 64 && s.cells === 64, 'it stops at 64', s.grid.n);
  await page.evaluate(() => crhSet('n', 1)); await tap('#crh-nminus'); s = await state();
  check(s.grid.n === 1 && s.cells === 1, 'and at 1', s.grid.n);
  await chip(16);

  // 5. Length.
  await tap('#crh-lplus'); s = await state();
  check(s.grid.len === 17 && s.grid.follow === false && s.L === 17, 'one touch on + is one sixteenth longer (17) and it is its own length', s.grid.len + ' L' + s.L);
  await page.evaluate(() => crhSet('len', 64)); await tap('#crh-lplus'); s = await state();
  check(s.grid.len === 64 && s.L === 64, 'Length stops at 64', s.grid.len);
  await page.evaluate(() => crhSet('len', 16));
  await page.evaluate(() => { window._sqSteps = function () { return 32; }; });
  await tap('#crh-follow'); await page.waitForTimeout(300); s = await state();
  check(s.grid.follow === true && s.L === 32 && s.grid.len === 16, 'Drums: with a 32-step drum pattern the loop is 32 (its own 16 is kept)', JSON.stringify(s.grid) + ' L' + s.L);
  await page.evaluate(() => { window._sqSteps = function () { return 20; }; });
  await page.waitForTimeout(400); s = await state();
  check(s.L === 20, 'and when the drums change to 20 it follows', 'L' + s.L);
  await tap('#crh-follow'); s = await state();
  check(s.grid.follow === false && s.L === 16, 'Drums off goes back to its own length', JSON.stringify(s.grid) + ' L' + s.L);

  // 6. Kept.
  await page.evaluate(() => crhSet('n', 9)); await page.evaluate(() => crhSet('len', 24));
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); switchTab('perform'); });
  await page.waitForTimeout(500);
  s = await state();
  check(s.grid && s.grid.n === 9 && s.grid.len === 24, 'it is kept across a reload', JSON.stringify(s.grid));
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
