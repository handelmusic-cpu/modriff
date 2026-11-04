/* Which toasts the Live page gets (6.7).

   On Live a toast is for a major action only: a recording or capture (majorToast), a purchase gate, a failure, a
   refusal that says what to do first, or a toast with an action. Everything else is not drawn on Live and is still
   read out through the screen-reader region. Studio, Song and Sound show every toast as before.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/toasts/probe.js
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
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.goto(URL); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); }); await page.waitForTimeout(300);
  // Shown means the toast element exists and is visible after a beat; cleared first so one case cannot leak into the next.
  const shown = async (msg, opts) => {
    await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) { clearTimeout(t._to); t.style.opacity = '0'; t.textContent = ''; } const r = document.getElementById('_toast-sr'); if (r) r.textContent = ''; });
    await page.waitForTimeout(80);
    await page.evaluate(([m, o]) => { o && o.act ? showToast(m, { actionLabel: 'Undo', onAction() {} }) : o && o.major ? majorToast(m) : showToast(m); }, [msg, opts || null]);
    await page.waitForTimeout(250);
    return page.evaluate(m => { const t = document.getElementById('_toast'); return !!t && t.textContent.indexOf(m) >= 0 && parseFloat(getComputedStyle(t).opacity) > 0.5; }, msg);
  };
  const sr = () => page.evaluate(() => (document.getElementById('_toast-sr') || {}).textContent || '');

  // Live.
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(500);
  check(await page.evaluate(() => lvActive()), 'on the Live page');
  check(!(await shown('Drums: 4/4 Basic')), 'Live: a style change draws no toast');
  check((await sr()).indexOf('Drums: 4/4 Basic') >= 0, '... and is still read out to a screen reader', await sr());
  check(!(await shown('Ending: cold stop')), 'Live: arming an ending draws no toast');
  check(!(await shown('Undo')), 'Live: Undo draws no toast');
  check(!(await shown('Touch Mod on — slide up and down a note')), 'Live: a mode switch draws no toast');
  check(await shown('Could not open that file'), 'Live: a failure is drawn');
  check(await shown('Start audio first'), 'Live: a refusal that says what to do first is drawn');
  check(await shown('Capturing pads — play, then tap again', { major: true }), 'Live: a recording / capture toast (majorToast) is drawn');
  check(await shown('Deleted a thing', { act: true }), 'Live: a toast with an action is drawn');
  // A purchase gate, through the real path.
  await page.evaluate(() => { setModTier('free'); }); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('_toast') && (document.getElementById('_toast').style.opacity = '0'); });
  const gate = await page.evaluate(() => { const r = freeBlocked('That sound', 'sounds'); const t = document.getElementById('_toast'); return { r, txt: t ? t.textContent : '', op: t ? getComputedStyle(t).opacity : '' }; });
  await page.waitForTimeout(250);
  const gateShown = await page.evaluate(() => { const t = document.getElementById('_toast'); return !!t && t.textContent.length > 4 && parseFloat(getComputedStyle(t).opacity) > 0.5; });
  check(gateShown, 'Live: a purchase gate (freeBlocked) is drawn', JSON.stringify(gate));
  await page.evaluate(() => { setModTier('pro'); }); await page.waitForTimeout(200);

  // Studio and Song: everything as before.
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(500);
  check(await page.evaluate(() => !lvActive()), 'Studio is not Live');
  check(await shown('Drums: 4/4 Basic'), 'Studio: a style change is drawn, as before');
  await page.evaluate(() => { switchTab('songs'); }); await page.waitForTimeout(400);
  check(await shown('Saved to setlist'), 'Song: a save is drawn, as before');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
