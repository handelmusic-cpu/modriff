/* The red light in the Dynamic Island while bouncing (6.8, the page side).

   The island is drawn by a Live Activity, which is native, so this drives only what the page does: with a stand-in
   for the ModActivity plugin it checks that starting a bounce sends { on: true } once, stopping sends { on: false } once,
   a repaint of the bounce button sends nothing, a plugin that rejects does not break the bounce button, and with no
   plugin (a browser) nothing throws. The Swift and the widget extension are not run here: see docs/dynamic-island.md.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/bounceactivity/probe.js
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

  // No plugin: a browser.
  const none = await page.evaluate(() => { try { _isRecording = true; _updateRecBtn(); _isRecording = false; _updateRecBtn(); return 'ok'; } catch (e) { return String(e); } });
  check(none === 'ok', 'no plugin (a browser): the bounce button repaints and nothing throws', none);

  // A stand-in plugin through the same lookup the page uses in the app (window.Capacitor.Plugins).
  await page.evaluate(() => { window.__calls = []; window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.ModActivity = { set: o => { window.__calls.push(o.on); return Promise.resolve({ started: true }); } }; });
  await page.evaluate(() => { _isRecording = true; _updateRecBtn(); _updateRecBtn(); _updateRecBtn(); });
  let calls = await page.evaluate(() => window.__calls.slice());
  check(JSON.stringify(calls) === '[true]', 'bounce starts: one { on: true }, however often the button repaints', JSON.stringify(calls));
  await page.evaluate(() => { _isRecording = false; _updateRecBtn(); _updateRecBtn(); });
  calls = await page.evaluate(() => window.__calls.slice());
  check(JSON.stringify(calls) === '[true,false]', 'bounce stops: one { on: false }', JSON.stringify(calls));

  // A second bounce starts a new light.
  await page.evaluate(() => { _isRecording = true; _updateRecBtn(); _isRecording = false; _updateRecBtn(); });
  calls = await page.evaluate(() => window.__calls.slice());
  check(JSON.stringify(calls) === '[true,false,true,false]', 'a second bounce lights it again', JSON.stringify(calls));

  // A plugin that rejects must not break the button, and a later bounce tries again.
  await page.evaluate(() => { window.__calls = []; window.Capacitor.Plugins.ModActivity = { set: o => { window.__calls.push(o.on); return Promise.reject(new Error('no extension')); } }; });
  const rej = await page.evaluate(async () => { try { _isRecording = true; _updateRecBtn(); await new Promise(r => setTimeout(r, 50)); _isRecording = false; _updateRecBtn(); return 'ok'; } catch (e) { return String(e); } });
  const rc = await page.evaluate(() => window.__calls.slice());
  check(rej === 'ok' && rc[0] === true, 'a plugin that rejects does not break the bounce button', rej + ' ' + JSON.stringify(rc));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
