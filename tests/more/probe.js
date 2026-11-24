/* Live's More chords picker. Run with node tests/more/probe.js.
   Set URL to a served dist/index.html to test the shipping bundle. */
'use strict';
const assert = require('node:assert/strict');
const layout = require('../layout/lib.js');

(async () => {
  const app = await layout.start();
  try {
    const { page, ctx, errs } = await layout.boot(app, 'p430', 'live');
    const cdp = await ctx.newCDPSession(page);
    const trigger = page.locator('#live-more-pad');
    const menu = page.locator('#live-more-menu');
    const choice = row => menu.locator('button[value="' + row + '"]');
    const borrowed = page.locator('#chords-borrowed');
    const dominants = page.locator('#chords-secdom');
    const mine = page.locator('#chords-user');
    const tap = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const rect = await locator.boundingBox();
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 };
      const hit = await locator.evaluate((target, pt) => target.contains(document.elementFromPoint(pt.x, pt.y)), point);
      assert.ok(hit, 'touch target is reachable: ' + locator);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
    };
    const current = () => page.evaluate(() => chordMoreGet());
    const pick = async row => {
      const before = await current();
      await tap(trigger);
      await menu.waitFor({ state: 'visible' });
      assert.equal(await current(), before, 'opening leaves the chosen shelf alone');
      assert.equal(await choice(before).getAttribute('aria-pressed'), 'true');
      await tap(choice(row));
      await menu.waitFor({ state: 'hidden' });
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(await trigger.textContent(), 'More chords');
      assert.equal(await current(), row);
    };

    await page.evaluate(() => {
      root = 0;
      setMode('major');
      window.moreChordAttacks = [];
      const attack = _triggerChordImmediate;
      _triggerChordImmediate = function(...args) {
        window.moreChordAttacks.push({ pitch: args[0] % 12, quality: args[1] });
        return attack.apply(this, args);
      };
    });
    assert.equal(await current(), 'off');
    assert.equal(await borrowed.isVisible(), false);
    await pick('dom');
    assert.equal(await dominants.locator(':scope > *').count(), 5);
    assert.equal(await dominants.isVisible(), true);
    await pick('modal');
    assert.equal(await borrowed.locator(':scope > *').count(), 8);
    assert.equal(await borrowed.isVisible(), true);
    assert.equal(await dominants.isVisible(), false);
    assert.equal(await page.locator('#chords-modal-wrap .chord-section-lbl').isVisible(), true);

    await tap(trigger);
    await menu.waitFor({ state: 'visible' });
    await page.locator('#pf-chords-lbl').tap({ position: { x: 5, y: 10 } });
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await current(), 'modal');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

    await trigger.press('Enter');
    assert.equal(await choice('modal').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    assert.equal(await menu.isVisible(), false);

    await page.evaluate(() => { cpToggle(cpDegChord(8)); cpToggle(cpDegChord(10)); });
    assert.equal(await page.locator('#chords-diatonic .cp-inrow').count(), 2);
    await pick('mine');
    assert.equal(await page.locator('#chords-diatonic .cp-inrow').count(), 0);
    assert.equal(await mine.locator(':scope > *').count(), 2);
    assert.equal(await mine.isVisible(), true);
    await pick('off');
    assert.equal(await mine.isVisible(), false);
    assert.equal(await page.locator('#chords-diatonic .cp-inrow').count(), 2);
    await pick('modal');
    assert.deepEqual(await page.evaluate(() => window.moreChordAttacks), [], 'picker interactions produce zero chord attacks');
    await tap(borrowed.locator(':scope > :nth-child(2) .btn-tri'));
    const attacks = await page.evaluate(() => window.moreChordAttacks);
    assert.equal(attacks.length, 1);
    assert.equal(attacks[0].pitch, 5, 'the iv pad still plays F minor');
    console.log('Direct shelf selection, two pinned chords and dismissals work. Picker produced 0 attacks and the iv pad produced 1.');

    await page.reload();
    const splash = page.locator('#audio-unlock');
    if (await splash.isVisible()) {
      await page.locator('#unlock-choices button').first().tap();
      await splash.waitFor({ state: 'hidden' });
    }
    await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
    assert.equal(await current(), 'modal');
    assert.equal(await borrowed.isVisible(), true);

    for (const [width, height] of [[320,568], [375,667], [390,844], [430,932], [568,320], [844,390]]) {
      await page.setViewportSize({ width, height });
      await tap(trigger);
      await menu.waitFor({ state: 'visible' });
      const sizes = await menu.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const bottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--botstack')) || 0;
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, limit: innerHeight - bottom,
          choices: [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
      });
      assert.ok(sizes.left >= 0 && sizes.right <= width && sizes.top >= 0 && sizes.bottom <= sizes.limit + 1, JSON.stringify(sizes));
      assert.ok(sizes.choices.every(height => height >= 44), JSON.stringify(sizes));
      await page.keyboard.press('Escape');
      assert.equal(await menu.isVisible(), false);
      console.log(width + '×' + height + ': menu fits above the transport with four 44px choices.');
    }

    await tap(trigger);
    await menu.waitFor({ state: 'visible' });
    await page.evaluate(() => renderChords());
    assert.equal(await menu.isVisible(), false, 'a key or mode rebuild closes the old anchor');
    await tap(trigger);
    await menu.waitFor({ state: 'visible' });
    await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); setPerformMode('chords'); });
    assert.equal(await trigger.isVisible(), false);
    assert.equal(await menu.isVisible(), false);
    assert.deepEqual(errs, []);
    console.log('Saved choice survived reload. Rebuild and Studio close the picker. No page errors.');
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
