/* The Bass and Melody rolls in portrait (6.0q).

   Driven on the real window with real touch (CDP), on a 390 x 844 phone:
     - held upright, a touch screen defaults to Large: 44 x 44 cells, the ruler 30 pt, and the roll scrolls sideways;
     - a touch on a cell places the note on that step and that pitch, on the Bass roll and on the Melody roll, and
       the cell's edges are where they should be (a touch 21 pt from the centre is the same cell, 23 pt is the next);
     - the Fit / Large switch is two 44 pt buttons, Fit gives back the 22 pt rows and the whole bar in view, the note
       placed in one is still there in the other, and the choice is saved;
     - the ruler and the key gutter still open their column and row menus (the roll's other controls are untouched);
     - turned on its side, with no saved choice, it goes back to Fit and the cells share the wider screen.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/roll/probe.js
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
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); });
  const cdp = await ctx.newCDPSession(page);
  const touchAt = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  // The page point of a cell: scroll the roll so it is on screen, then read where it is.
  const cellPoint = (id, step, row) => page.evaluate(([id, step, row]) => {
    const wrap = document.getElementById(id + '-pr'), cv = document.getElementById(id + '-pr-canvas');
    wrap.scrollIntoView({ block: 'center' });
    wrap.scrollLeft = Math.max(0, step * PR_COL_W - 60); wrap.scrollTop = Math.max(0, row * PR_ROW_H - 100);
    const r = cv.getBoundingClientRect();
    return { x: r.left + step * PR_COL_W + PR_COL_W / 2, y: r.top + PR_RULER_H + row * PR_ROW_H + PR_ROW_H / 2 };
  }, [id, step, row]);
  const cellAt = ([id, step]) => page.evaluate(([id, step]) => { const c = PR_ENGINES[id].cell(step); return c && c.v ? c.note + (c.oct + 1) * 12 : null; }, [id, step]);

  const openPart = async (part, id) => {
    await page.evaluate(([part]) => { studioTab(); setAccompMode(part); switchTab('accomp'); }, [part]);
    await page.waitForTimeout(700);
    return id;
  };

  // ── 1. Upright, a touch screen opens on Large.
  await openPart('bass', 'bl');
  const g = await page.evaluate(() => ({ mode: prZoomMode(), row: PR_ROW_H, col: prColW('bl', PR_ENGINES.bl.steps()), ruler: PR_RULER_H, large: document.getElementById('bl-pr').classList.contains('pr-large'),
    canvasW: Math.round(document.getElementById('bl-pr-canvas').getBoundingClientRect().width), steps: PR_ENGINES.bl.steps(), wrapW: Math.round(document.getElementById('bl-pr').getBoundingClientRect().width) }));
  check(g.mode === 'large' && g.large, 'upright on a phone the roll opens on Large', g.mode);
  check(g.row === 44 && g.col === 44, 'cells are 44 x 44 pt', g.col + ' x ' + g.row);
  check(g.canvasW === g.steps * 44 && g.canvasW > g.wrapW, 'the roll is wider than the screen and scrolls sideways', g.canvasW + ' in ' + g.wrapW);

  // ── 2. A touch places the note on that step and pitch; the edges of a cell are where they should be.
  for (const [part, id] of [['bass', 'bl'], ['melody', 'ml']]) {
    await openPart(part, id);
    const lo = await page.evaluate(id => PR_ENGINES[id].hi, id);
    const row = 8, step = 5;
    const p = await cellPoint(id, step, row);
    await touchAt(p.x, p.y);
    const got = await cellAt([id, step]);
    check(got === lo - row, part + ': a touch places the note on that step and pitch', got + ' expected ' + (lo - row));
    const edge = await page.evaluate(([id, step, row, p]) => {
      const m = (dx, dy) => { const h = prHit(id, { clientX: p.x + dx, clientY: p.y + dy }); return h && [h.step, h.midi]; };
      const hi = PR_ENGINES[id].hi;
      return { same: JSON.stringify(m(21, 21)) === JSON.stringify([step, hi - row]) && JSON.stringify(m(-21, -21)) === JSON.stringify([step, hi - row]),
        up: m(0, -23), right: m(23, 0), hi };
    }, [id, step, row, p]);
    check(edge.same, part + ': 21 pt off the centre is the same cell');
    check(edge.up && edge.up[1] === edge.hi - row + 1 && edge.right && edge.right[0] === step + 1, part + ': 23 pt off is the next one', JSON.stringify([edge.up, edge.right]));
  }

  // ── 3. Fit and Large.
  await openPart('bass', 'bl');
  const sw = await page.evaluate(() => [...document.querySelectorAll('#bl-pr ~ .pr-bar [data-przoom]')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.przoom, Math.round(r.width), Math.round(r.height)]; }));
  check(sw.length === 2 && sw.every(b => b[1] >= 44 && b[2] >= 44), 'Fit and Large are 44 pt buttons', JSON.stringify(sw));
  const b = await page.evaluate(() => { const e = document.querySelector('#bl-pr ~ .pr-bar [data-przoom="fit"]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await touchAt(b.x, b.y);
  const f = await page.evaluate(() => ({ mode: prZoomMode(), row: PR_ROW_H, ruler: PR_RULER_H, col: prColW('bl', PR_ENGINES.bl.steps()), w: Math.round(document.getElementById('bl-pr-canvas').getBoundingClientRect().width),
    wrap: Math.round(document.getElementById('bl-pr').getBoundingClientRect().width), saved: modStore.getItem('modo-roll-zoom') }));
  check(f.mode === 'fit' && f.row === 22 && f.ruler === 14, 'Fit gives back the 22 pt rows', f.row + ' ' + f.ruler);
  check(f.w <= f.wrap, 'Fit puts the whole bar in view', f.w + ' in ' + f.wrap);
  check(f.saved === 'fit', 'the choice is saved', f.saved);
  check((await cellAt(['bl', 5])) !== null, 'the note placed in Large is still there in Fit');

  // ── 4. The ruler and the key gutter still open their menus (Large).
  await page.evaluate(() => prSetZoom('large')); await page.waitForTimeout(400);
  const rp = await page.evaluate(() => { const wrap = document.getElementById('bl-pr'); wrap.scrollIntoView({ block: 'center' }); wrap.scrollTop = 0; wrap.scrollLeft = 0; const r = document.getElementById('bl-pr-canvas').getBoundingClientRect(); return { x: r.left + 60, y: r.top + 10 }; });
  await touchAt(rp.x, rp.y);
  check(await page.evaluate(() => !!document.querySelector('.gclip-menu')), 'a touch on the ruler opens the column menu');
  await page.evaluate(() => gridClipClose());
  const kp = await page.evaluate(() => { const r = document.getElementById('bl-pr-keys').getBoundingClientRect(); return { x: r.left + 20, y: r.top + PR_RULER_H + 3 * PR_ROW_H + 22 }; });
  await touchAt(kp.x, kp.y);
  check(await page.evaluate(() => !!document.querySelector('.gclip-menu')), 'a touch on a key opens the row menu');
  await page.evaluate(() => gridClipClose());

  // ── 5. Turned on its side, with no saved choice, back to Fit.
  await page.evaluate(() => { modStore.removeItem('modo-roll-zoom'); });
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(700);
  const l = await page.evaluate(() => ({ mode: prZoomMode(), row: PR_ROW_H, w: Math.round(document.getElementById('bl-pr-canvas').getBoundingClientRect().width), wrap: Math.round(document.getElementById('bl-pr').getBoundingClientRect().width) }));
  check(l.mode === 'fit' && l.row === 22 && l.w <= l.wrap, 'on its side it goes back to Fit and fills the width', JSON.stringify(l));
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
