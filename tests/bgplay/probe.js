/* The page half of the background-play test switch (6.9.4): off unless `modo-bgtest` is set inside the app with the
   native sound on, tells the engine, and logs the page while the app is away. See inpage.js for the checks.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/bgplay/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.addScriptTag({ path: __dirname + '/inpage.js' });
  const res = await page.evaluate(() => window.__bgprobe());
  let fails = 0;
  for (const [ok, what, d] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + what + (d ? '  (' + d + ')' : '')); if (!ok) fails++; }
  if (errs.length) { console.log('FAIL script errors: ' + errs.join(' | ').slice(0, 200)); fails++; }
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
