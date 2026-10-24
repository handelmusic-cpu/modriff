/* Web-trim probe: the native master leaves 3 dB for Web Audio parts exactly when
   there are some in the mix. Drives the real mute/solo/fader paths with a stand-in
   for the native bridge and reads what is posted to the host as {t:'master', i:8}.

   Run (repo served; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/master-trim/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/toast/probe.js). */
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
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.waitForTimeout(1500);

  // A native chord, as _modNativeAttach leaves it, and a recorder for the posts.
  await page.evaluate(() => {
    window.__posts = [];
    MODNAT.started = true; MODNAT.attached.chord = { port: {}, eng: {} };
    window.__origPost = _modNativePost;
    _modNativePost = function (part, m) { if (m && m.t === 'master') window.__posts.push({ i: m.i, v: m.v }); };
    _modNativeMasterSync(true);
  });
  const last = async () => page.evaluate(() => { const p = window.__posts.filter(x => x.i === 8); return p.length ? p[p.length - 1].v : null; });
  const web = () => page.evaluate(() => _modNativeWebInMix());

  check(await last() === -3 && await web(), 'web parts in the mix: the native master leaves 3 dB', await last());

  // Mute every web part: nothing else is in the speaker, full level.
  await page.evaluate(() => { MIX_CHANNELS.forEach(c => { if (!MODNAT.attached[c.id]) window.sqMixMute[c.id] = true; }); sqSyncMixIndicators(); });
  check(await last() === 0 && !(await web()), 'every web part muted: back to 0 dB', await last());

  // One back: -3 again.
  await page.evaluate(() => { window.sqMixMute.drum = false; sqSyncMixIndicators(); });
  check(await last() === -3, 'one web part unmuted: -3 dB', await last());

  // Solo the chord: the web parts are shut out by the solo.
  await page.evaluate(() => { window.sqMixSolo.chord = true; sqSyncMixIndicators(); });
  check(await last() === 0, 'chord soloed: the web parts are silenced, 0 dB', await last());
  await page.evaluate(() => { window.sqMixSolo.chord = false; sqSyncMixIndicators(); });
  check(await last() === -3, 'solo released: -3 dB', await last());

  // A solo on a web part keeps it in the mix.
  await page.evaluate(() => { window.sqMixSolo.drum = true; sqSyncMixIndicators(); });
  check(await last() === -3, 'a web part soloed: -3 dB', await last());
  await page.evaluate(() => { window.sqMixSolo.drum = false; sqSyncMixIndicators(); });

  // The fader, through the engine's own message: every web part down is out of
  // the mix; one back up is in it.
  const fader = (id, v) => page.evaluate(([id, v]) => _webEngineSend({ v: 1, kind: 'param', part: 'mix', name: id, value: v }), [id, v]);
  const webIds = await page.evaluate(() => MIX_CHANNELS.filter(c => !MODNAT.attached[c.id]).map(c => c.id));
  for (const id of webIds) await fader(id, 0);
  check(await last() === 0 && !(await web()), 'every web fader at zero: 0 dB', await last());
  await fader(webIds[0], 0.5);
  check(await last() === -3, 'one web fader back up: -3 dB', await last());
  for (const id of webIds) await fader(id, 1);

  // Only posts that change: re-syncing the same state posts nothing.
  const n0 = await page.evaluate(() => window.__posts.length);
  await page.evaluate(() => { sqSyncMixIndicators(); _modNativeMasterSync(); });
  const n1 = await page.evaluate(() => window.__posts.length);
  check(n1 === n0, 'an unchanged state posts nothing', n1 - n0);

  // The other nine master numbers still go out on a forced sync, in order.
  await page.evaluate(() => { window.__posts.length = 0; _modNativeMasterSync(true); });
  const idx = (await page.evaluate(() => window.__posts.map(p => p.i))).join(',');
  check(idx === '0,1,2,3,4,5,6,7,8', 'a forced sync hands over all nine parameters', idx);

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
