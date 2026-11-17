/* Slice 2: the Sound tab is Mix, and the shared voice tone lives on Mix > Voices.

   - the tab reads "Mix" (and Find names it so); no UI string still says "Sound ›";
   - Tone, Reso, Sweep, Width and Drift exist once each, in the Voice tone card on Mix > Voices, and nowhere on the Chords page;
   - turning one still reaches the engine's variable (onFxInput), and the Studio Pack lock still holds them on a free build;
   - Chords, Melody and Arp each carry a link row that lands on that card;
   - Voices has no control under 44 pt and the page has no sideways overflow at 375, 390 and 430.

   Run: node tests/layout/mix.probe.js */
'use strict';
const fs = require('fs');
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  const src = fs.readFileSync(L.ROOT + '/index.html', 'utf8');
  R.check(!/Sound ›/.test(src), 'no UI string still says "Sound ›"', (src.match(/Sound ›/g) || []).length + ' left');

  for (const vp of ['p430', 'p390', 'se375']) {
    const { page, ctx, errs } = await L.boot(h, vp, 'studio');
    const label = await page.evaluate(() => ({ tab: document.querySelector('#tab-mix span').textContent, find: FIND_TAB_NAMES.mix, sub: (document.querySelector('#mix-subnav .subnav-lbl') || {}).textContent }));
    R.check(label.tab === 'Mix' && label.find === 'Mix' && label.sub === 'Mix', vp + ': the tab, Find and the sub-nav say Mix', JSON.stringify(label));

    // The five sliders: once each, in the card, not on Chords.
    const where = await page.evaluate(() => ['fx-cutoff', 'fx-reso', 'fx-env', 'fx-width', 'fx-drift'].map(id => {
      const all = document.querySelectorAll('#' + id), e = all[0];
      return { id, n: all.length, inCard: !!(e && e.closest('#voice-tone-panel')), inChords: !!(e && e.closest('#pf-chords-panel')), inPane: !!(e && e.closest('#mix-voices-pane')) };
    }));
    R.check(where.every(w => w.n === 1 && w.inCard && w.inPane && !w.inChords), vp + ': the five sliders exist once each, in the Voice tone card on Mix > Voices', JSON.stringify(where.filter(w => !(w.n === 1 && w.inCard))));

    await L.goMix(page, 'Voices');
    const vis = await page.evaluate(() => { const p = document.getElementById('voice-tone-panel'), r = p.getBoundingClientRect(); return { shown: r.height > 0 && getComputedStyle(p).display !== 'none', w: Math.round(r.width), vw: innerWidth, title: p.querySelector('.panel-title').textContent.trim() }; });
    R.check(vis.shown && vis.w <= vis.vw, vp + ': the Voice tone card is drawn and fits', JSON.stringify(vis));
    R.check(/shared by Chords, Melody and Arp/.test(vis.title), vp + ': the card says it is shared', vis.title);

    const small = (await page.evaluate(L.SCAN)).filter(c => L.isSmall(c) && !L.KNOWN_SMALL.some(rx => rx.test(c.key)));
    R.check(small.length === 0, vp + ': Mix > Voices has no control under 44 pt', small.map(c => c.key + ' ' + c.w + 'x' + c.h).slice(0, 4).join('; '));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    R.check(over <= 1, vp + ': no sideways overflow on Mix > Voices', over + ' pt');

    if (vp === 'p430') {
      // The sliders still reach the engine.
      const before = await page.evaluate(() => fxCutoff);
      await page.evaluate(() => { const e = document.getElementById('fx-cutoff'); e.value = '0.31'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      const after = await page.evaluate(() => ({ v: fxCutoff, label: document.getElementById('fxcut-val').textContent }));
      R.check(Math.abs(after.v - 0.31) < 1e-6 && after.v !== before, 'turning Tone sets fxCutoff and its readout', JSON.stringify(after));
      // The Studio Pack lock.
      await page.evaluate(() => { setModTier('free'); }); await page.waitForTimeout(400);
      const lock = await page.evaluate(() => ['fx-cutoff', 'fx-reso', 'fx-env', 'fx-width', 'fx-drift'].map(id => document.getElementById(id).disabled));
      R.check(lock.every(Boolean), 'a free build holds all five with the Studio Pack lock', JSON.stringify(lock));
      await page.evaluate(() => { setModTier('pro'); }); await page.waitForTimeout(400);
      const open = await page.evaluate(() => ['fx-cutoff', 'fx-reso', 'fx-env', 'fx-width', 'fx-drift'].map(id => document.getElementById(id).disabled));
      R.check(open.every(x => !x), 'and the pack releases them', JSON.stringify(open));
      // The link rows.
      for (const name of ['Chords', 'Melody', 'Arp']) {
        await L.goStudio(page, name);
        const r = await page.evaluate(() => { const a = [].slice.call(document.querySelectorAll('.tab-page.active .voice-tone-link')).filter(b => b.getBoundingClientRect().height > 0); return { n: a.length, h: a[0] ? Math.round(a[0].getBoundingClientRect().height) : 0 }; });
        R.check(r.n === 1 && r.h >= 44, name + ': one visible link row to the Voice tone card, at least 44 pt tall', JSON.stringify(r));
        await page.evaluate(() => { const b = [].slice.call(document.querySelectorAll('.tab-page.active .voice-tone-link')).filter(x => x.getBoundingClientRect().height > 0)[0]; b.click(); });
        await page.waitForTimeout(500);
        const at = await page.evaluate(() => ({ tab: _tabFor(_activePageId()), mode: MSX_UI.mode }));
        R.check(at.tab === 'mix' && at.mode === 'voices', name + ': the link lands on Mix > Voices', JSON.stringify(at));
      }
    }
    R.check(errs.length === 0, vp + ': no page errors', errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await h.close();
  R.done();
})();
