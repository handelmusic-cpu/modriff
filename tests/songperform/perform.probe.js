/* Song > Perform and the Song header (1.9.9.9u): the page's name as a header picker (Build / Perform / Library), the Perform page's
   order, tabs and transport row, its widgets and the switch that hides them, and the other themes and widths.
   Run: node tests/songperform/perform.probe.js   (serves the repo itself; env URL / CHROMIUM as for the other layout probes) */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('../layout/lib.js');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

// Boot at a viewport on the Song tab, Build mode. `pre` runs in the page before the Song tab opens.
async function openSong(h, vp, pre) {
  const { page, ctx, errs } = await L.boot(h, vp, 'live');
  if (pre) await page.evaluate(pre);
  await page.evaluate(() => { switchTab('songs'); setSongsMode('build'); });
  await page.waitForTimeout(300);
  return { page, ctx, errs };
}
const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(),
  c = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY), shown: r.width > 0 && r.height > 0 && c.display !== 'none' }; }, sel);
const attr = (page, sel, a) => page.evaluate(([s, n]) => (document.querySelector(s) || { getAttribute: () => null }).getAttribute(n), [sel, a]);
const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent, sel);
const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); }, sel);
const mode = page => page.evaluate(() => songsMode);

(async () => {
  const h = await L.start(), R = L.reporter();
  try {
    // ── Task 1: the header picker ─────────────────────────────────────────────
    for (const vp of ['se375', 'p390', 'p430', 'ipad820', 'phoneLand']) {
      const { page, ctx, errs } = await openSong(h, vp);
      const t = vp + ': ';
      const cur = await box(page, '#songs-cur'), pick = await box(page, '#songs-pick');
      R.check(cur && cur.shown && cur.w >= 44 && cur.h >= 44, t + 'the header button is there and at least 44 pt', JSON.stringify(cur));
      R.check(await text(page, '#songs-cur-n') === 'Build' && pick && !pick.shown && await attr(page, '#songs-cur', 'aria-expanded') === 'false', t + 'it names the page (Build) and the picker is closed', await text(page, '#songs-cur-n'));
      await click(page, '#songs-cur'); await page.waitForTimeout(150);
      const chips = await page.evaluate(() => [...document.querySelectorAll('#songs-pick .ss-chip')].map(b => { const r = b.getBoundingClientRect(); return { n: b.dataset.m, h: Math.round(r.height), over: b.scrollWidth > b.clientWidth + 1 }; }));
      R.check(chips.map(c => c.n).join() === 'build,perform,library' && chips.every(c => c.h >= 44 && !c.over) && await attr(page, '#songs-cur', 'aria-expanded') === 'true',
        t + 'a tap opens three chips (Build, Perform, Library), each 44 pt tall and not overflowing', JSON.stringify(chips));
      await click(page, '#songs-pick [data-m=perform]'); await page.waitForTimeout(200);
      R.check(await mode(page) === 'perform' && await text(page, '#songs-cur-n') === 'Perform' && (await box(page, '#songs-perform-panel')).shown && !(await box(page, '#songs-build-panel')).shown && !(await box(page, '#songs-pick')).shown,
        t + 'picking Perform shows the Perform page, relabels the header and closes the picker');
      await click(page, '#songs-cur'); await click(page, '#songs-pick [data-m=library]'); await page.waitForTimeout(200);
      R.check(await mode(page) === 'library' && await text(page, '#songs-cur-n') === 'Library', t + 'picking Library switches to it');
      await click(page, '#songs-cur');
      await page.evaluate(() => document.getElementById('songs-library-panel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      R.check(!(await box(page, '#songs-pick')).shown, t + 'a tap outside closes an open picker');
      await click(page, '#songs-cur'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      R.check(!(await box(page, '#songs-pick')).shown && await attr(page, '#songs-cur', 'aria-expanded') === 'false', t + 'Escape closes it');
      await click(page, '#songs-cur'); await page.evaluate(() => setSongsMode('build')); await page.waitForTimeout(150);
      R.check(!(await box(page, '#songs-pick')).shown && await text(page, '#songs-cur-n') === 'Build', t + 'a mode change from script while it is open closes it and relabels');
      await click(page, '#songs-cur'); await page.evaluate(() => { switchTab('live'); switchTab('songs'); }); await page.waitForTimeout(200);
      R.check(!(await box(page, '#songs-pick')).shown, t + 'leaving the Song tab with it open and coming back finds it closed');
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      // The Mac app keeps the three-way switch (Studio's Mac layout keeps its row too).
      const { page, ctx } = await openSong(h, 'ipad820', () => document.documentElement.classList.add('mac-app'));
      R.check((await box(page, '#songs-subnav')).shown && !(await box(page, '#songs-head')).shown, 'Mac app: the old three-way switch is shown and the header picker is not');
      await ctx.close();
    }
    // Everything that pointed at the old switch now points at the header.
    R.check(/el:'#songs-head'/.test(HTML) && !/el:'#songs-subnav'/.test(HTML), 'the tutorial step spotlights the header, not the hidden switch');
    R.check(/\['#songs-cur',/.test(HTML), 'the "what is this" labels include the header button');
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exitCode = 1; });
