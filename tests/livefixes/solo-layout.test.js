/* Run after npm run build: node tests/livefixes/solo-layout.test.js
   Measures the shipped page with real touch input, including width persistence and rotation. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.resolve(__dirname, '../../dist');
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const boot = async () => {
      await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
      await page.getByText('Start', { exact: true }).first().tap();
      await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
      await page.evaluate(() => document.fonts.ready);
    };
    await boot();
    for (const [width, height] of [[320,568], [360,800], [390,844], [440,956], [568,320], [667,375], [844,390], [956,440]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const live = await page.evaluate(() => {
        const rect = el => el.getBoundingClientRect().toJSON();
        return { key: rect(document.querySelector('.mel-btn')), slots: rect(document.getElementById('lv-slots')),
          grid: rect(document.getElementById('chords-diatonic')),
          pads: [...document.querySelectorAll('#chords-diatonic > *')].map(rect),
          widthShown: !!document.getElementById('mel-key-width').getClientRects().length,
          scrollWidth: document.documentElement.scrollWidth };
      });
      assert.equal(live.key.height, 128);
      assert.equal(live.widthShown, false, 'width lives in the controls sheet');
      assert.equal(live.scrollWidth, width, 'no horizontal page overflow');
      assert.equal(new Set(live.pads.map(r => r.y)).size, width > height ? 1 : 2);
      if (width > height) {
        assert.ok(live.slots.width >= width - 26, JSON.stringify(live.slots));
        assert.equal(live.grid.width, live.slots.width);
        assert.ok(live.pads.every(r => r.width >= 44 && r.height >= 88));
      }
      await page.evaluate(() => lvSheetOpen(document.querySelector('.lv-slot[data-mod=melody]')));
      await page.waitForTimeout(240);
      const sheet = await page.evaluate(() => {
        const r = el => el.getBoundingClientRect().toJSON();
        return { sheet: r(document.querySelector('.lv-sheet')),
          controls: ['mel-glide-btn','tmod-toggle','tmod-axis'].map(id => r(document.getElementById(id))),
          widthShown: !!document.getElementById('mel-key-width').getClientRects().length };
      });
      assert.ok(sheet.widthShown);
      const centers = sheet.controls.map(r => r.y + r.height / 2);
      assert.ok(Math.max(...centers) - Math.min(...centers) < 1, JSON.stringify(sheet));
      assert.ok(sheet.controls.every(r => r.left >= sheet.sheet.left + 10 && r.right <= sheet.sheet.right - 10), JSON.stringify(sheet));
      await page.evaluate(() => lvSheetClose());
      await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); setPerformMode('melody'); });
      assert.equal(await page.locator('.mel-btn').first().evaluate(e => e.getBoundingClientRect().height), 128);
      await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
      console.log(`${width}×${height}: Live and Studio keys 128px; ${width > height ? 'one chord row, full width' : 'two chord rows'}; gesture controls aligned inside sheet`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => lvSheetOpen(document.querySelector('.lv-slot[data-mod=melody]')));
    for (const [label, width] of [['S',26], ['M',44], ['L',64], ['XL',96], ['AUTO',null]]) {
      await page.locator('#mel-key-width').tap();
      assert.equal(await page.locator('#mel-key-width').textContent(), 'Width: ' + label);
      assert.equal(await page.evaluate(() => localStorage.getItem('modo-mel-kw')), width == null ? null : String(width));
      if (width != null) assert.equal(await page.locator('.mel-btn').first().evaluate(e => parseFloat(getComputedStyle(e).width)), width);
    }
    await page.locator('#mel-key-width').tap(); // Save S, then restore it from a fresh page.
    await boot();
    await page.evaluate(() => lvSheetOpen(document.querySelector('.lv-slot[data-mod=melody]')));
    assert.equal(await page.locator('#mel-key-width').textContent(), 'Width: S');
    const before = await page.evaluate(() => ({ glide: melGlideOn, mod: melModOn }));
    await page.locator('#mel-glide-btn').tap();
    await page.locator('#tmod-toggle').tap();
    await page.locator('#tmod-axis [data-axis=speed]').tap();
    assert.deepEqual(await page.evaluate(() => ({ glide: melGlideOn, mod: melModOn, axis: melModAxis })),
      { glide: !before.glide, mod: !before.mod, axis: 'speed' });
    await page.locator('#tmod-axis [data-axis=depth]').tap();
    await page.evaluate(() => { if (!melModOn) toggleMelMod(); lvSheetClose(); });
    const key = page.locator('.mel-btn').filter({ has: page.locator('.mel-inner') }).nth(10);
    await key.scrollIntoViewIfNeeded();
    const rect = await key.boundingBox(), x = rect.x + rect.width / 2;
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => {
      window._soloTouch = { downs: 0, ups: 0, moves: 0 };
      document.addEventListener('pointerdown', e => { if (e.target.closest('.mel-btn')) _soloTouch.downs++; }, true);
      document.addEventListener('pointerup', e => { if (e.target.closest('.mel-btn')) _soloTouch.ups++; }, true);
      document.addEventListener('pointermove', e => { if (e.target.closest('.mel-btn')) _soloTouch.moves++; }, true);
    });
    const point = y => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(rect.y + rect.height * .8) });
    const low = await page.evaluate(() => melModY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(rect.y + rect.height * .2) });
    const high = await page.evaluate(() => melModY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: point(rect.y + rect.height * .2) });
    const touch = await page.evaluate(() => ({ ..._soloTouch, held: document.querySelectorAll('.mel-btn.held').length }));
    assert.ok(high > low + .5, JSON.stringify({ low, high, touch }));
    assert.equal(touch.downs, 1); assert.equal(touch.ups, 1); assert.ok(touch.moves >= 1); assert.equal(touch.held, 0);
    assert.deepEqual(errors, []);
    console.log('Width: AUTO → S → M → L → XL → AUTO; saved choice restored; all row controls respond to taps.');
    console.log('Touch Mod:', JSON.stringify({ low, high, ...touch }), '; no page errors.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exit(1); });
