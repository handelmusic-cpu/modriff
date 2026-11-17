/* The Studio strip (slice 1), measured at every shape the layout has to hold.

   Eight chips, every one at least 44 x 44 pt, no label clipped, one row from 390 pt wide and two rows of four below that; the
   strip stays on top while the page scrolls; it is not drawn in Live or on the open Duo (where the right pane has its own row).

   Run: node tests/layout/strip.probe.js */
'use strict';
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  for (const vp of ['se375', 'p390', 'p430', 'ipad820', 'duoClosed']) {
    const { page, ctx, errs } = await L.boot(h, vp, 'studio');
    const w = L.VIEWPORTS[vp].width;
    for (const name of ['Chords', 'Mel Seq']) {
      await L.goStudio(page, name);
      const g = await page.evaluate(() => {
        const el = document.getElementById('studio-strip'); if (!el) return null;
        const cs = getComputedStyle(el), chips = [].slice.call(el.querySelectorAll('.ss-chip')).map(b => {
          const r = b.getBoundingClientRect(), sp = b.querySelector('span');
          return { w: r.width, h: r.height, top: Math.round(r.top), clipped: sp.scrollWidth > sp.clientWidth + 0.5, margin: Math.round((r.width - sp.getBoundingClientRect().width) / 2 * 10) / 10 };
        });
        const r = el.getBoundingClientRect();
        return { display: cs.display, chips, rows: new Set(chips.map(c => c.top)).size, h: Math.round(r.height), right: Math.round(r.right), vw: innerWidth };
      });
      const tag = vp + ' (' + w + ') ' + name + ': ';
      R.check(g && g.display !== 'none', tag + 'the strip is drawn in Studio', g && g.display);
      if (!g) continue;
      R.check(g.chips.length === 8, tag + 'eight chips', g.chips.length);
      R.check(g.chips.every(c => c.w >= 43.5 && c.h >= 43.5), tag + 'every chip is at least 44 x 44', 'min ' + Math.round(Math.min(...g.chips.map(c => c.w))) + ' x ' + Math.round(Math.min(...g.chips.map(c => c.h))));
      R.check(g.chips.every(c => !c.clipped && c.margin >= 3), tag + 'no label is clipped and each has at least 3 pt either side', 'least margin ' + Math.min(...g.chips.map(c => c.margin)) + ' pt');
      R.check(g.rows === (w >= 390 && vp !== 'duoClosed' ? 1 : 2), tag + (w >= 390 && vp !== 'duoClosed' ? 'one row' : 'two rows of four'), g.rows + ' row(s), ' + g.h + ' pt tall');
      R.check(g.right <= g.vw, tag + 'nothing runs off the right edge', g.right + ' of ' + g.vw);
    }
    // Sticky: scroll the Chords page and the strip is still at the top of the screen.
    await L.goStudio(page, 'Chords');
    await page.evaluate(() => { window.scrollTo(0, 900); const pg = document.querySelector('.tab-page.active'); if (pg) pg.scrollTop = 900; });
    await page.waitForTimeout(250);
    const top = await page.evaluate(() => Math.round(document.getElementById('studio-strip').getBoundingClientRect().top));
    R.check(top >= -1 && top <= 16, vp + ': the strip stays on top while the page scrolls', 'top ' + top);
    // Live draws no strip.
    await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); window.scrollTo(0, 0); }); await page.waitForTimeout(400);
    const live = await page.evaluate(() => getComputedStyle(document.getElementById('studio-strip')).display);
    R.check(live === 'none', vp + ': Live draws no strip', live);
    R.check(errs.length === 0, vp + ': no page errors', errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // The open Duo: Live with a Studio page beside it. The strip is not drawn; the right pane's own Part row is.
  {
    const { page, ctx } = await L.boot(h, 'duoOpen', 'live');
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => ({ strip: getComputedStyle(document.getElementById('studio-strip')).display, wide: getComputedStyle(document.documentElement).getPropertyValue('--wide').trim() }));
    R.check(s.strip === 'none', 'open Duo (951 x 669): no strip beside Live', JSON.stringify(s));
    await ctx.close();
  }
  await h.close();
  R.done();
})();
