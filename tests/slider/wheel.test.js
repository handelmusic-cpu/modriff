/* A plain scroll over a slider or knob scrolls the page and changes nothing; Option-scroll edits it.

   Every control that took the wheel used to cancel the scroll and step itself per
   event, so scrolling Settings on a trackpad turned whatever knob was under the
   pointer: Drive reached 100% unseen and the whole mix distorted (see wheelEdits).
   Dragging, tapping and the arrow keys are untouched.
   Run (repo served; CLAUDE.md):  python3 -m http.server 8777 --bind 127.0.0.1 &  node tests/slider/wheel.test.js
   Env: URL, CHROME (default macOS Chrome) */
'use strict';
const { chromium } = require('playwright-core');
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 560 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.waitForTimeout(1500);
  try { await page.click('.unlock-btn >> text=Start', { timeout: 3000 }); } catch (e) {}
  await page.waitForTimeout(1500);
  await page.evaluate(() => { switchTab('build'); setSettingsPane('sounds'); const b = document.getElementById('ss-global-body'); if (b && !b.offsetParent) toggleSS('global'); });
  await page.waitForTimeout(500);
  const el = page.locator('#fx-drive');
  // Centre it, then hold the pointer on it, and say so: a pointer that is really over something else tests nothing.
  const over = async () => {
    await page.evaluate(() => document.getElementById('fx-drive').scrollIntoView({ block: 'center' }));
    const b = await el.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    return page.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y), s = document.getElementById('fx-drive'); return !!t && (t === s || s.contains(t) || t.contains(s) && t !== document.body && t.querySelectorAll('input[type=range]').length === 1); }, [x, y]);
  };
  check(await over(), 'the pointer is over the Drive control');
  const drive = () => page.evaluate(() => ({ slider: +document.getElementById('fx-drive').value, live: fxDrive }));

  // A trackpad flick is dozens of small wheel events, and the page must be able to move under them.
  // Up, because scrolling down only ever steps a knob that is already at 0 further down, and it is at 0.
  const tops = () => page.evaluate(() => { let m = 0; document.querySelectorAll('*').forEach(e => { m += e.scrollTop; }); return m; });
  const scrollBefore = await tops();
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -6);
  await page.waitForTimeout(300);
  const d1 = await drive();
  check(d1.slider === 0 && d1.live === 0, 'a plain scroll over Drive leaves it at 0', JSON.stringify(d1));
  const movedTo = await tops();
  check(movedTo < scrollBefore, 'and the page scrolled up instead', 'scroll ' + scrollBefore + ' -> ' + movedTo);

  // Option-scroll is the deliberate way (the dial and the slider under it each take their step, so only "it moved up" is held).
  check(await over(), 'and again after the page moved');
  await page.keyboard.down('Alt');
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -4);
  await page.keyboard.up('Alt'); await page.waitForTimeout(200);
  const d2 = await drive();
  check(d2.slider > 0.2 && d2.slider < 0.7 && d2.live === d2.slider, 'Option-scroll over Drive moves it up', JSON.stringify(d2));

  // Arrow keys still work on a focused slider.
  await page.evaluate(() => { const e = document.getElementById('fx-drive'); e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await el.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const d3 = await drive();
  check(d3.slider > 0 && d3.live === d3.slider, 'arrow keys still turn a focused Drive', JSON.stringify(d3));
  check(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
