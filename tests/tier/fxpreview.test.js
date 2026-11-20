/* A locked mõdFX patch is heard, not kept (FX_PREVIEW_SEC, two per patch).

   Free: tapping a locked patch loads it while the band plays and, when the time is up, puts the pad back on the
   patch (axes and targets) it was on. Two previews per patch, then the sheet. A free patch picked during one ends
   it. With nothing playing a tap says so and is not counted. A take starts clean. Owned: the patch is simply picked.
   The list says so before anyone taps (a note over it, a title on each locked patch).

   Run (repo served, Chromium available):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/fxpreview.test.js
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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('modo-dev-tier', 'free'); });
  await page.goto(URL); await page.waitForTimeout(1500);
  await page.click(`button[onclick="unlockAudio('roll')"]`); await page.waitForTimeout(2500);

  const axes = () => page.evaluate(() => [fxPadX, fxPadY, fxTargets.slice().sort().join('+')]);
  const idx = (name) => page.evaluate((n) => fxAllPresets().findIndex(x => x.name === n), name);
  const tapChip = (name) => page.evaluate((n) => {
    const i = fxAllPresets().findIndex(x => x.name === n);
    const el = [...document.querySelectorAll('.fx-preset')].find(b => b.getAttribute('onclick') === 'fxPickPreset(' + i + ')');
    if (!el) return 'no chip'; el.click(); return 'clicked';
  }, name);
  const count = (name) => page.evaluate((n) => freePreviewCount('fx', n), name);
  const sheetOpen = () => page.evaluate(() => !!document.getElementById('_pro-sheet'));
  const closeSheet = () => page.evaluate(() => { const s = document.getElementById('_pro-sheet'); if (s) s.remove(); });

  await page.evaluate(() => { setModOwned([]); FX_PREVIEW_SEC = 2; if (!isAnythingPlaying()) ftPlayStop(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { fxPickPreset(fxAllPresets().findIndex(x => x.name === 'Filter Sweep')); });
  const home = await axes();
  check(home[0] === 'cutoff' && home[1] === 'reso', 'free: the pad is on Filter Sweep to start', JSON.stringify(home));

  // The list says so before anyone taps.
  await page.evaluate(() => { try { fxSyncUI(); } catch (e) {} });
  const pre = await page.evaluate(() => ({ note: (document.querySelector('.fx-prev-note') || {}).textContent || '',
    title: ([...document.querySelectorAll('.fx-preset.tier-locked')][0] || {}).title || '' }));
  check(/hear it/i.test(pre.note) && /mõdSynth Engine/.test(pre.note), 'free: a note over the patch list says hear it and names the pack', pre.note.slice(0, 90));
  check(/hear it for/.test(pre.title) && /mõdSynth Engine/.test(pre.title), 'free: each locked patch says the same in its title', pre.title.slice(0, 90));

  // First preview: the patch is on, then the pad goes home.
  check(await tapChip('Wobble') === 'clicked', 'the locked Wobble chip is on screen and taps');
  await page.waitForTimeout(300);
  const during = await axes();
  const wob = await page.evaluate(() => { const p = fxAllPresets().find(x => x.name === 'Wobble'); return [p.x, p.y]; });
  check(during[0] === wob[0] && during[1] === wob[1], 'free: while it is being heard the pad has the patch', JSON.stringify([during, wob]));
  check(await count('Wobble') === 1 && !(await sheetOpen()), 'free: counted once, and the sheet did not open', String(await count('Wobble')));
  await page.waitForTimeout(2600);
  const back = await axes();
  check(JSON.stringify(back) === JSON.stringify(home), 'free: after the time the pad is back on Filter Sweep, axes and targets', JSON.stringify(back));

  // Second preview, then the sheet on the third.
  await tapChip('Wobble'); await page.waitForTimeout(2600);
  check(await count('Wobble') === 2 && JSON.stringify(await axes()) === JSON.stringify(home), 'free: a second preview, and back again', String(await count('Wobble')));
  await tapChip('Wobble'); await page.waitForTimeout(400);
  check(await sheetOpen() && JSON.stringify(await axes()) === JSON.stringify(home), 'free: the third tap opens the pack sheet and loads nothing');
  await closeSheet();

  // A free patch picked during a preview ends it and wins.
  await tapChip('Riser'); await page.waitForTimeout(300);
  await page.evaluate(() => fxPickPreset(fxAllPresets().findIndex(x => x.name === 'Tape Stop')));
  await page.waitForTimeout(2600);
  const ts = await page.evaluate(() => { const p = fxAllPresets().find(x => x.name === 'Tape Stop'); return [p.x, p.y]; });
  const a2 = await axes();
  check(a2[0] === ts[0] && a2[1] === ts[1], 'free: picking a free patch mid-preview ends the preview, and the free patch stays', JSON.stringify(a2));

  // Two previews in a row come home to the SAME place.
  await page.evaluate(() => fxPickPreset(fxAllPresets().findIndex(x => x.name === 'Filter Sweep')));
  await tapChip('Isolator'); await page.waitForTimeout(500); await tapChip('Decimator'); await page.waitForTimeout(2800);
  const home2 = await axes();
  check(home2[0] === 'cutoff' && home2[1] === 'reso', 'free: two previews in a row return to the original patch', JSON.stringify(home2));

  // Nothing playing: told, not counted.
  await page.evaluate(() => { if (isAnythingPlaying()) ftPlayStop(); });
  await page.waitForTimeout(800);
  const before = await count('Talk Box');
  await tapChip('Talk Box'); await page.waitForTimeout(300);
  check(await count('Talk Box') === before && !(await sheetOpen()) && JSON.stringify(await axes()) === JSON.stringify(home2), 'free: with nothing playing it says so and does not count', String(await count('Talk Box')));
  await page.evaluate(() => { if (!isAnythingPlaying()) ftPlayStop(); });
  await page.waitForTimeout(1000);

  // A take ends a preview.
  await tapChip('Grain'); await page.waitForTimeout(300);
  await page.evaluate(() => { _startRecording(); });
  await page.waitForTimeout(400);
  const rec = await axes();
  check(JSON.stringify(rec) === JSON.stringify(home2), 'free: a take that starts ends a preview, so it is not in the bounce', JSON.stringify(rec));
  await page.evaluate(() => { try { _stopRecording(); } catch (e) {} });
  await page.waitForTimeout(500);

  // Owned: the patch is just picked and stays.
  await page.waitForTimeout(9000);
  await page.evaluate(() => { setModOwned(['synth']); });
  await tapChip('Wobble'); await page.waitForTimeout(2800);
  const kept = await axes();
  const noteGone = await page.evaluate(() => { fxSyncUI(); return !document.querySelector('.fx-prev-note'); });
  check(kept[0] === wob[0] && kept[1] === wob[1] && noteGone, 'mõdSynth Engine: the patch is picked and stays, and there is no note', JSON.stringify(kept));

  check(errs.length === 0, 'nothing thrown', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
