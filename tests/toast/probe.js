/* Toast swipe probe: real touch (CDP Input.dispatchTouchEvent) against showToast.
   A toast has to be sent away with a swipe (sideways or up) or a tap; a short
   drag springs back; the Undo button still works and a swiped-away Undo does
   not fire; an untouched toast still times out. Prints PASS/FAIL per check.

   Run (repo served; Chrome or Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/toast/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/stems/probe.js). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, ms = 120, steps = 8) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(ms / steps); }
    await touch('touchEnd');
    await page.waitForTimeout(350);
  };
  const state = () => page.evaluate(() => { const t = document.getElementById('_toast'); const r = t.getBoundingClientRect(); return { op: t.style.opacity, pe: t.style.pointerEvents, tf: t.style.transform, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  const show = async (msg, o) => { await page.evaluate(([m, o]) => { window.__act = 0; if (o && o.action) { o = Object.assign({}, o, { onAction() { window.__act++; } }); } showToast(m, o); }, [msg, o]); await page.waitForTimeout(500); return state(); };

  let s = await show('A long toast that would stay for twenty seconds', { ms: 20000 });
  check(s.op === '1' && s.pe === 'auto', 'a toast is shown and touchable', s.op + '/' + s.pe);

  await drag(s.cx, s.cy, s.cx - 200, s.cy);
  s = await state(); check(s.op === '0' && s.pe === 'none', 'swipe left sends it away', s.op + '/' + s.pe);

  s = await show('again, after a dismissal', { ms: 20000 });
  check(s.op === '1' && s.tf === '', 'a toast shown after a dismissal is back in place', s.op + ' tf=' + JSON.stringify(s.tf));
  await drag(s.cx, s.cy, s.cx + 200, s.cy);
  s = await state(); check(s.op === '0', 'swipe right sends it away', s.op);

  s = await show('swipe up', { ms: 20000 });
  await drag(s.cx, s.cy, s.cx, s.cy - 60);
  s = await state(); check(s.op === '0', 'swipe up sends it away', s.op);

  s = await show('tap it', { ms: 20000 });
  await touch('touchStart', s.cx, s.cy); await touch('touchEnd'); await page.waitForTimeout(350);
  s = await state(); check(s.op === '0', 'a tap sends it away', s.op);

  s = await show('a small drag only', { ms: 20000 });
  await drag(s.cx, s.cy, s.cx + 30, s.cy);
  s = await state(); check(s.op === '1' && s.tf === '', 'a short drag springs back', s.op + ' tf=' + JSON.stringify(s.tf));
  await page.waitForTimeout(3000);
  s = await state(); check(s.op === '0', 'and then times out in 2.5 s, not the 20 it was given', s.op);

  s = await show('untouched, default time');
  await page.waitForTimeout(2300);
  s = await state(); check(s.op === '0', 'an untouched toast still times out by itself', s.op);

  s = await show('held under the finger', { ms: 1500 });
  await touch('touchStart', s.cx, s.cy); await page.waitForTimeout(2500); 
  s = await state(); check(s.op === '1', 'a held toast does not time out under the finger', s.op);
  await touch('touchEnd'); await page.waitForTimeout(350);

  s = await show('Cleared', { action: true, actionLabel: 'Undo' });
  const btn = await page.evaluate(() => { const r = document.querySelector('#_toast ._toast-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await touch('touchStart', btn.x, btn.y); await touch('touchEnd'); await page.waitForTimeout(350);
  check(await page.evaluate(() => window.__act) === 1, 'the Undo button still fires its action');

  s = await show('Cleared again', { action: true, actionLabel: 'Undo' });
  await drag(s.cx - 60, s.cy, s.cx - 260, s.cy);
  s = await state();
  check(s.op === '0' && await page.evaluate(() => window.__act) === 0, 'swiping an Undo toast away does not fire the Undo', s.op);

  if (errs.length) { console.log('page errors:', errs); fails++; }
  console.log(fails ? 'toast probe FAILED' : 'toast probe ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
