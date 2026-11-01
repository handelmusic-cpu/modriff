/* The chord rhythm builder on Studio's Chords page (6.0j).

   Driven on the real window with real touch (CDP):
     - it is on Studio's Chords page and not on Live;
     - Length is the drum pattern's or its own (1, 2, 4 bars); with Drums the roll is as long as the drums
       (a drum pattern of 32 steps makes it two bars), without it the bars you pick;
     - Feel is Duple or Triple: Duple offers 1/8, 1/16, 1/32, Triple 1/8 and 1/16; a triple grid has three
       steps to a beat and its hits fall on thirds of a beat, not on sixteenths;
     - a touch on a step cycles it off, soft, normal, accent, and what is drawn is what the pads play (CR);
     - changing the grid moves the hits to the nearest step instead of losing them;
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
  const tapText = async (group, text) => {
    const idx = await page.evaluate(([g, t]) => [...document.querySelectorAll('#' + g + ' button')].findIndex(b => b.textContent.trim().indexOf(t) === 0), [group, text]);
    await tap('#' + group + ' button:nth-child(' + (idx + 1) + ')');
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0; }, sel);
  const state = () => page.evaluate(() => ({ n: document.querySelectorAll('#crh-roll .crh-cell').length, grid: CR.def && CR.def.grid, steps: CR.def && CR.def.steps,
    labels: [...document.querySelectorAll('#crh-grid button')].map(b => b.textContent.trim()).join(), p: crPattern().ev.map(e => +e.p.toFixed(3)), L: crPattern().steps }));

  // 1. Where it is.
  await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
  check(!(await vis('#crh-roll')), 'it is not on Live');
  await page.evaluate(() => { setViewMode('studio'); switchTab('perform'); });
  await page.waitForTimeout(500);
  check(await vis('#crh-roll'), 'it is on Studio\'s Chords page');
  let s = await state();
  check(s.n === 16 && s.labels === '1/8,1/16,1/32', 'the starting rhythm is laid on a 16-step duple grid', s.n + ' ' + s.labels);

  // 2. Cycle a step by touch: off, soft, normal, accent, off.
  await page.evaluate(() => { CR.key = 'strum'; CR.def = null; crhSet('len', 1); });
  const lvls = [];
  for (let k = 0; k < 4; k++) { await tap('#crh-roll .crh-cell:nth-child(2)'); lvls.push(await page.evaluate(() => { const c = CR.def.cells[1]; return c.on ? (c.acc ? 'accent' : c.soft ? 'soft' : 'normal') : 'off'; })); }
  check(lvls.join() === 'soft,normal,accent,off', 'a touch on a step cycles soft, normal, accent, off', lvls.join());
  await tap('#crh-roll .crh-cell:nth-child(2)');
  s = await state();
  check(s.p.indexOf(1) >= 0 && s.L === 16, 'what is drawn is what the pads play: a hit on the second sixteenth', JSON.stringify(s.p));

  // 3. Triple feel.
  await tapText('crh-feel', 'Triple');
  s = await state();
  check(s.n === 24 && s.labels === '1/8,1/16' && s.grid.pb === 6, 'Triple from 1/16 is 1/16 triplets: twenty-four steps a bar, grids 1/8 and 1/16', s.n + ' ' + s.labels);
  check(s.p.every(x => Math.abs(x * 3 / 2 - Math.round(x * 3 / 2)) < 2e-3), 'every hit falls on a sixteenth triplet, not on a sixteenth', JSON.stringify(s.p));
  await tapText('crh-grid', '1/8');
  s = await state();
  check(s.n === 12 && s.grid.pb === 3, 'Triple 1/8: twelve steps a bar, three to a beat', s.n);
  check(s.p.length >= 4 && s.p.every(x => Math.abs(x * 3 / 4 - Math.round(x * 3 / 4)) < 2e-3), 'the hits moved to the nearest eighth triplet and none was lost', JSON.stringify(s.p));
  await tapText('crh-feel', 'Duple');
  s = await state();
  check(s.grid.pb === 2 && s.n === 8, 'back to Duple 1/8 (eight steps)', s.n + ' pb' + s.grid.pb);
  await tapText('crh-grid', '1/16');
  s = await state();
  check(s.n === 16 && s.grid.pb === 4, 'Duple 1/16: sixteen steps a bar', s.n);
  await tapText('crh-grid', '1/32');
  s = await state();
  check(s.n === 32 && s.grid.pb === 8, 'Duple 1/32: thirty-two steps a bar', s.n);

  // 4. Length: its own, then the drums'.
  await tapText('crh-len', '2');
  s = await state();
  check(s.grid.bars === 2 && s.n === 64 && s.L === 32, 'Length 2 at 1/32 is the 64-step most, over thirty-two sixteenths', s.n + ' ' + s.L);
  await tapText('crh-len', '4');
  s = await state();
  check(s.n <= 64 && s.grid.bars * s.grid.pb * 4 <= 64, 'four bars is kept inside 64 steps (the grid gives way)', s.n + ' pb' + s.grid.pb + ' bars' + s.grid.bars);
  await tapText('crh-grid', '1/8');
  await page.evaluate(() => { window._sqSteps = function () { return 32; }; });
  await tapText('crh-len', 'Drums');
  await page.waitForTimeout(300);
  s = await state();
  check(s.grid.follow === true && s.grid.bars === 2 && s.L === 32, 'Drums: with a 32-step drum pattern the rhythm is two bars', JSON.stringify(s.grid) + ' L' + s.L);
  await page.evaluate(() => { window._sqSteps = function () { return 16; }; });
  await page.waitForTimeout(400);
  s = await state();
  check(s.grid.follow === true && s.L === 16 && s.n === (s.grid.pb * 4), 'and when the drums go back to one bar it follows them', 'L' + s.L + ' n' + s.n);
  await tapText('crh-len', '2');
  s = await state();
  check(s.grid.follow === false && s.grid.bars === 2, 'a bar count of its own turns following off', JSON.stringify(s.grid));

  // 5. Kept.
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); switchTab('perform'); });
  await page.waitForTimeout(500);
  s = await state();
  check(s.grid && s.grid.bars === 2 && s.grid.pb === 2, 'it is kept across a reload', JSON.stringify(s.grid));
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
