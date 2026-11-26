/* The MUTE / SOLO / FX chip (#ft-ms-led) must not sit on anything in the transport (2.0d).

   Before: it was a third child of the left cell, which is only as wide as the key's floor plus the tempo, so it
   overflowed onto Play (a held mõdFX pad painted "FX" over the play button) on every phone narrower than 430.
   Now: out of flow on a portrait phone; nothing is overlapped, Play does not move when it appears, and it is
   hit at its own centre.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/transport/led.probe.js
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
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  for (const W of [360, 375, 390, 402, 430]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: 860 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); sqSyncMixIndicators(); });
    const rect = () => page.evaluate(() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const led = document.getElementById('ft-ms-led');
      // Everything in the transport's two rows that the chip could land on, except the tempo (it hangs off its top edge).
      const hit = led.style.display === 'none' ? [] :
        ['ft-key', 'ft-playstop-btn', 'ft-rec-ring'].filter(id => {
          const a = r('ft-ms-led'), b = r(id);
          return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
        });
      const l = led.getBoundingClientRect();
      const top = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
      return { play: r('ft-playstop-btn'), hit, shown: led.style.display !== 'none',
        onTop: !!top && (top === led || led.contains(top)), over: led.getBoundingClientRect().right > innerWidth + 1 };
    });
    const base = await rect();
    for (const state of ['mute', 'solo', 'fx']) {
      await page.evaluate(s => {
        window.sqMixMute = {}; window.sqMixSolo = {}; fxEngaged = false;  // module-scope lets: bare names, not window.*
        if (s === 'mute') window.sqMixMute = { bass: true };
        if (s === 'solo') window.sqMixSolo = { bass: true };
        if (s === 'fx') { fxEngaged = true; fxTargets = ['bass']; }
        sqSyncMixIndicators();
      }, state);
      const m = await rect();
      check(m.shown, W + ' ' + state + ': the chip shows');
      check(m.hit.length === 0, W + ' ' + state + ': it is on none of the key, Play or the record ring', m.hit.join());
      check(Math.abs(m.play[0] - base.play[0]) < 0.5, W + ' ' + state + ': Play does not move when the chip appears', base.play[0] + ' -> ' + m.play[0]);
      check(m.onTop && !m.over, W + ' ' + state + ': it is hit at its own centre and inside the screen');
    }
    check(errs.length === 0, W + ': no script errors', errs.join(' | ').slice(0, 160));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
