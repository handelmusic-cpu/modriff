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
// Four chords in a Verse (two of them two beats long), then the Perform page.
const loadSong = page => page.evaluate(() => { setSongsMode('build'); const p = document.getElementById('chart-chord-picker');
  [1, 4, 0, 5].forEach(i => p.children[i].querySelector('.cpick-tri').click()); const sl = sections[curSection].slots;
  sl[0].bars = 0; sl[0].beats = 2; sl[1].bars = 0; sl[1].beats = 2; setSongsMode('perform'); window.scrollTo(0, 0); });
const tops = (page, sels) => page.evaluate(ss => ss.map(s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }), sels);
const same = a => a.every(x => x !== null && Math.abs(x - a[0]) <= 2);

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

    // ── Task 2: Perform's order, tabs and transport row ───────────────────────
    for (const vp of ['se375', 'p430', 'ipad820', 'phoneLand', 'duoClosed']) {
      const { page, ctx, errs } = await openSong(h, vp);
      await loadSong(page); await page.waitForTimeout(400);
      const t = vp + ': ';
      const tabs = await tops(page, ['#pv-switch', '#pv-stage']), tr = await tops(page, ['#prev-section-btn', '#slb-auto-btn', '#next-section-btn', '#slb-save-btn']);
      const order = await tops(page, ['.setlist-nav', '#pv-switch', '#prev-section-btn', '#songs-full-chart']);
      R.check(same(tabs), t + 'the tabs and Stage share one line', tabs.join());
      R.check(same(tr), t + 'Prev, Play, Next and Save share one line', tr.join());
      R.check(order.every(x => x !== null) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], t + 'song, then tabs, then transport, then the tiles', order.join());
      if (vp === 'se375') {
        R.check(order[3] < 560, t + 'the first chord tile starts within 560 pt of the top', order[3]);
        await page.evaluate(() => songsPerformViewSet('chart')); await page.waitForTimeout(300);
        const cp = await box(page, '#songs-chart-panel');
        R.check(cp && cp.shown && cp.top < 560, t + 'the chart panel starts within 560 pt of the top', JSON.stringify(cp));
        R.check(await attr(page, '#pv-chart', 'aria-pressed') === 'true' && await attr(page, '#pv-tiles', 'aria-pressed') === 'false', t + 'the Chart tab is marked');
        await page.evaluate(() => songsPerformViewSet('tiles')); await page.waitForTimeout(200);
      }
      const ov = await page.evaluate(() => [...document.querySelectorAll('#songs-perform-panel button')].filter(b => b.offsetParent && b.id !== 'prev-section-btn' && b.id !== 'next-section-btn' && b.scrollWidth > b.clientWidth + 1).map(b => (b.textContent || '').trim().slice(0, 18) + ' ' + b.scrollWidth + '>' + b.clientWidth));
      R.check(ov.length === 0, t + 'no button on Perform overflows its box', ov.join(' | '));
      const tabBox = await page.evaluate(() => ['pv-tiles', 'pv-chart', 'pv-timeline', 'pv-stage'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      R.check(tabBox.every(b => b[0] >= 44 && b[1] >= 44), t + 'every tab and Stage are at least 44 pt each way (tests/targets)', JSON.stringify(tabBox));
      R.check(await attr(page, '#prev-section-btn', 'aria-label') === 'Previous section' && await attr(page, '#next-section-btn', 'aria-label') === 'Next section', t + 'Prev and Next keep their accessible names');
      const sq = await page.evaluate(() => ['prev-section-btn', 'next-section-btn'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      R.check(sq.every(b => b[0] >= 44 && b[1] >= 44), t + 'Prev and Next are at least 44 pt each way', JSON.stringify(sq));
      if (vp === 'se375') {
        await click(page, '#slb-auto-btn'); await page.waitForTimeout(400);
        const playing = await text(page, '#slb-auto-btn'), tr2 = await tops(page, ['#prev-section-btn', '#slb-auto-btn', '#next-section-btn', '#slb-save-btn']);
        R.check(/stop/i.test(playing) && same(tr2), t + 'Play reads "Stop song" while the song plays and still fits the row', JSON.stringify([playing, tr2]));
        await click(page, '#slb-auto-btn');
      }
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      // A free build: the timeline and Stage keep their lock marks; no song loaded: the page still draws and nothing throws.
      const { page, ctx, errs } = await openSong(h, 'se375', () => setModTier('free'));
      await page.evaluate(() => setSongsMode('perform')); await page.waitForTimeout(300);
      R.check(await page.evaluate(() => document.getElementById('pv-stage').classList.contains('pv-locked') && document.getElementById('pv-timeline').classList.contains('pv-locked')), 'free build: Stage and Timeline keep their lock marks');
      R.check((await text(page, '#slb-title')).length > 0 && (await box(page, '#songs-cur')).shown && (await box(page, '#pv-switch')).shown, 'no song loaded: the banner, header and tabs still draw');
      await click(page, '#slb-auto-btn'); await click(page, '#next-section-btn'); await click(page, '#prev-section-btn'); await page.waitForTimeout(300);
      R.check(errs.length === 0, 'no song loaded: Play, Next and Prev throw nothing', errs.join('|'));
      await ctx.close();
    }
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exitCode = 1; });
