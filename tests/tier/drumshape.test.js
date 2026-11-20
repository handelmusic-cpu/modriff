/* The drum Shape sheet is hear-only without the mõdSynth Engine (FREE_LIMITS.drumShape).

   Free: the sheet opens with a note at the top (before any slider is touched), every slider
   changes what the lane sounds like while the sheet is open, and closing it puts back what the
   lane had: nothing, or a shape that arrived with a song. Level and Tune stay the lane's own and
   free. The doors (the lane sheet's Shape row, the row menu's Shape...) say "hear" before the sheet
   opens. With the mõdSynth Engine the shape is kept and there is no note.

   Run (repo served, Chromium available):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/drumshape.test.js
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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('modo-dev-tier', 'free'); });
  await page.goto(URL); await page.waitForTimeout(1500);
  await page.click(`button[onclick="unlockAudio('blank')"]`); await page.waitForTimeout(1500);

  // The drum code is in a closure; the page exports its shape table and the kit id (the key, on the kit's own layer).
  const shapeNow = () => page.evaluate(() => { const m = window._sqParams().shapes[window._sqMach()]; return m && m[0] ? JSON.parse(JSON.stringify(m[0])) : null; });
  const clearShapes = () => page.evaluate(() => { const sh = window._sqParams().shapes; Object.keys(sh).forEach(k => delete sh[k]); });
  const sliderOf = (label) => page.evaluate((l) => +[...document.querySelectorAll('.sq-shape-row')].find(r => r.querySelector('.sq-shape-l').textContent === l).querySelector('input').value, label);
  const slide = (label, v) => page.evaluate(([l, x]) => {
    const row = [...document.querySelectorAll('.sq-shape-row')].find(r => r.querySelector('.sq-shape-l').textContent === l);
    const rg = row.querySelector('input'); rg.value = x; rg.dispatchEvent(new Event('input', { bubbles: true })); rg.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, v]);
  const open = () => page.evaluate(() => { window.sqShapeSheet(0); });
  const done = async () => { await page.click('.modal-sheet button:has-text("Done")'); await page.waitForTimeout(150); };

  // ── Free
  await page.evaluate(() => { setModOwned([]); });
  await clearShapes();
  check(await page.evaluate(() => !modHas('synth')), 'free: no mõdSynth Engine, kit ' + await page.evaluate(() => window._sqMach()));

  // The doors say hear before the sheet opens.
  const doors = await page.evaluate(() => {
    window.sqLaneSheet(0);
    const lane = [...document.querySelectorAll('.ll-act')].map(b => b.textContent).find(t => /^Shape/.test(t)) || '';
    document.querySelector('.modal-sheet button:last-child') && [...document.querySelectorAll('.modal-sheet button')].filter(b => b.textContent === 'Done').forEach(b => b.click());
    return lane;
  });
  check(/Hear/.test(doors) && /mõdSynth Engine/.test(doors), 'free: the lane sheet\'s Shape row says hear it and names the pack before opening', doors.slice(0, 110));

  await open(); await page.waitForTimeout(300);
  const note = await page.evaluate(() => { const n = document.querySelector('[data-shape-note]'); const first = document.querySelector('.sq-shape').firstElementChild; return n && { text: n.textContent, first: first === n }; });
  check(note && note.first && /hear every setting/.test(note.text) && /mõdSynth Engine/.test(note.text), 'free: the note is the first thing in the sheet, before any slider', note && note.text.slice(0, 100));

  await slide('Decay', 3); await slide('Tone', -0.6); await slide('Drive', 0.8); await slide('Pan', 0.5);
  const during = await shapeNow();
  check(during && during.d === 3 && during.t === -0.6 && during.x === 0.8 && during.n === 0.5, 'free: while the sheet is open the lane has the shape (so it can be heard)', JSON.stringify(during));
  await done();
  check(await shapeNow() === null, 'free: closing the sheet puts the kit\'s drum back', JSON.stringify(await shapeNow()));
  check(await page.evaluate(() => !document.querySelector('.sq-tlbl .sq-lane-dot.shp.on')), 'free: no lane is marked shaped afterwards (the legend is not a lane)');

  // Level and Tune are the lane's own: free, and they stay.
  await open(); await slide('Level', 0.5); await slide('Tune', 5); await done();
  await open(); const own = [await sliderOf('Level'), await sliderOf('Tune')];
  check(own[0] === 0.5 && own[1] === 5, 'free: Level and Tune stay (they are the lane\'s own controls)', JSON.stringify(own));
  await slide('Level', 0.8); await slide('Tune', 0); await done();

  // A shape that arrived with a song keeps sounding: the sheet edits it, close restores it.
  await page.evaluate(() => { window._sqParams().shapes[window._sqMach()] = { 0: { d: 2, t: 0, x: 0.4, s: 1, b: 0, n: 0 } }; });
  await open(); await slide('Decay', 0.5); await slide('Drive', 0); await done();
  const arrived = await shapeNow();
  check(arrived && arrived.d === 2 && arrived.x === 0.4, 'free: a shape that arrived with a song is back as it was after the sheet closes', JSON.stringify(arrived));

  // Escape closes it the same way.
  await open(); await slide('Decay', 4); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check((await shapeNow()).d === 2, 'free: Escape restores it too');

  // ── With the mõdSynth Engine
  await page.evaluate(() => { setModOwned(['synth']); });
  await clearShapes();
  await open(); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.querySelector('[data-shape-note]')), 'mõdSynth Engine: no note');
  await slide('Decay', 3); await slide('Tone', 0.4); await done();
  const kept = await shapeNow();
  check(kept && kept.d === 3 && kept.t === 0.4, 'mõdSynth Engine: the shape is kept after the sheet closes', JSON.stringify(kept));
  const label = await page.evaluate(() => { window.sqLaneSheet(0); const t = [...document.querySelectorAll('.ll-act')].map(b => b.textContent).find(x => /^Shape/.test(x)) || ''; [...document.querySelectorAll('.modal-sheet button')].filter(b => b.textContent === 'Done').forEach(b => b.click()); return t; });
  check(!/Hear decay/.test(label), 'mõdSynth Engine: the door says nothing about hearing only', label.slice(0, 80));

  check(errs.length === 0, 'nothing thrown', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
