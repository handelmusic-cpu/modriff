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
      const chips = await page.evaluate(() => [...document.querySelectorAll('#songs-pick .sg-chip')].map(b => { const r = b.getBoundingClientRect(); return { n: b.dataset.m, h: Math.round(r.height), over: b.scrollWidth > b.clientWidth + 1 }; }));
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
    R.check(/t:'Song'[^\n]*getElementById\('songs-head'\)/.test(HTML) && !/el:'#songs-subnav'/.test(HTML), 'the tutorial step spotlights the header (or the switch where the header is not drawn), never the hidden switch by selector');
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

    // ── Task 3: widgets, and the switch that hides them ───────────────────────
    const WIDGET_SEL = { endings: '#songs-ending-row', practice: '#songs-practice-row', key: '.pf-w-key', setlist: '#songs-perform-panel > .panel' };
    const shown = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }), sel);
    const allShown = async page => { for (const w of Object.keys(WIDGET_SEL)) if (!await shown(page, WIDGET_SEL[w])) return false; return true; };
    const checks = page => page.evaluate(() => [...document.querySelectorAll('#pf-wsheet input[data-w]')].map(c => c.dataset.w + ':' + c.checked).join());
    const stored = page => page.evaluate(() => localStorage.getItem('modo-perform-widgets'));
    {
      const { page, ctx, errs } = await openSong(h, 'se375');
      await loadSong(page); await page.waitForTimeout(300);
      R.check(await allShown(page), 'widgets: Endings, Practice, key controls and the Setlist are all shown by default');
      const wb = await box(page, '#pf-widgets-btn');
      R.check(wb && wb.shown && wb.h >= 44 && !(await box(page, '#pf-wsheet')).shown && await attr(page, '#pf-widgets-btn', 'aria-expanded') === 'false', 'widgets: the switch is a 44 pt button with its sheet closed', JSON.stringify(wb));
      await click(page, '#pf-widgets-btn'); await page.waitForTimeout(100);
      const labels = await page.evaluate(() => [...document.querySelectorAll('#pf-wsheet label')].map(l => l.textContent.trim().replace(/\s+/g, ' ')));
      R.check(labels.length === 4 && /^Endings/.test(labels[0]) && /^Practice/.test(labels[1]) && /^Key and saved settings/.test(labels[2]) && /^Setlist/.test(labels[3]) && await checks(page) === 'endings:true,practice:true,key:true,setlist:true' && await attr(page, '#pf-widgets-btn', 'aria-expanded') === 'true',
        'widgets: the sheet lists Endings, Practice, Key and saved settings, Setlist, all checked', JSON.stringify(labels));
      const rows = await page.evaluate(() => [...document.querySelectorAll('#pf-wsheet label')].map(l => Math.round(l.getBoundingClientRect().height)));
      R.check(rows.every(x => x >= 44), 'widgets: each checklist row is 44 pt tall', rows.join());
      await page.evaluate(() => { const c = document.querySelector('#pf-wsheet input[data-w=endings]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
      R.check(!await shown(page, '#songs-ending-row') && await stored(page) === '["endings"]' && await shown(page, '#songs-practice-row'), 'widgets: unchecking Endings hides it, stores ["endings"], and leaves the others', await stored(page));
      await page.evaluate(() => { const c = document.querySelector('#pf-wsheet input[data-w=endings]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
      R.check(await shown(page, '#songs-ending-row') && await stored(page) === '[]', 'widgets: checking it brings it back');
      // A hidden widget keeps its state: an armed ending is still armed when Endings is hidden and shown again.
      await page.evaluate(() => { songEnding = 'ritard'; _updateEndingUI(); const c = document.querySelector('#pf-wsheet input[data-w=endings]'); c.checked = false;   // armed directly: armEnding lands at once when nothing is playing
         c.dispatchEvent(new Event('change', { bubbles: true })); });
      const hiddenArmed = await page.evaluate(() => songEnding);
      await page.evaluate(() => { const c = document.querySelector('#pf-wsheet input[data-w=endings]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
      R.check(hiddenArmed === 'ritard' && await page.evaluate(() => songEnding === 'ritard' && document.querySelector('#songs-ending-row [data-ending=ritard]').classList.contains('armed')), 'widgets: an armed ending stays armed while its widget is hidden, and shows armed again');
      await page.evaluate(() => { songEnding = null; _updateEndingUI(); });
      // The choice survives a reload.
      await page.evaluate(() => { const c = document.querySelector('#pf-wsheet input[data-w=practice]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.reload(); await page.waitForTimeout(1500);
      await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(500);
      await page.evaluate(() => { switchTab('songs'); setSongsMode('perform'); }); await page.waitForTimeout(300);
      R.check(!await shown(page, '#songs-practice-row') && await shown(page, '#songs-ending-row') && await checks(page) === 'endings:true,practice:false,key:true,setlist:true', 'widgets: the choice survives a reload', await checks(page));
      R.check(errs.length === 0, 'widgets: no page errors', errs.join('|'));
      await ctx.close();
    }
    // Hostile storage: never a throw, never a widget stuck hidden with no way back.
    for (const [name, val] of [['not json', 'not json'], ['an object', '{"a":1}'], ['a number', '7'], ['unknown names', '["bogus"]'], ['500 names', JSON.stringify(Array.from({ length: 500 }, (_, i) => 'x' + i))], ['non-strings', '[1,null,{"a":1}]']]) {
      const { page, ctx, errs } = await openSong(h, 'se375', () => localStorage.setItem('modo-perform-widgets', 'x'));
      await page.evaluate(v => { localStorage.setItem('modo-perform-widgets', v); setSongsMode('perform'); }, val); await page.waitForTimeout(300);
      R.check(await allShown(page) && await checks(page) === 'endings:true,practice:true,key:true,setlist:true' && errs.length === 0, 'storage ' + name + ': every widget is shown, every checkbox is checked, no page error', errs.join('|'));
      await ctx.close();
    }
    {
      // At a small phone: five endings on one line, the key stepper not clipped.
      const { page, ctx } = await openSong(h, 'se375');
      await loadSong(page); await page.waitForTimeout(300);
      const endTops = await page.evaluate(() => [...document.querySelectorAll('#songs-ending-row .end-btn')].map(b => Math.round(b.getBoundingClientRect().top)));
      R.check(endTops.length === 5 && new Set(endTops).size === 1, 'widgets: the five endings share one line at 375 pt', endTops.join());
      const key = await page.evaluate(() => { const g = document.querySelector('.tg.pf-w-key'); if (!g) return null; const gr = g.getBoundingClientRect(); return { clipped: g.scrollWidth > g.clientWidth + 1,
        inside: [...g.children].every(c => { const r = c.getBoundingClientRect(); return r.left >= gr.left - 1 && r.right <= gr.right + 1; }) }; });
      R.check(key && !key.clipped && key.inside, 'widgets: the key stepper (minus, key name, plus) sits inside its box without clipping', JSON.stringify(key));
      await ctx.close();
    }

    // ── Task 4: Light, and every width ────────────────────────────────────────
    // The contrast of a control's text against what it sits on: the first opaque background up its ancestors (a half-transparent one is
    // blended over the page behind it).
    const CONTRAST = sel => {
      const num = c => { let m = c.match(/color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[ \/]+/).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
        m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
      const e = document.querySelector(sel); if (!e) return null;
      let bg = { r: 255, g: 255, b: 255, a: 1 }; const chain = []; for (let x = e; x; x = x.parentElement) chain.push(x);
      for (const x of chain.reverse()) { const c = num(getComputedStyle(x).backgroundColor); if (c && c.a > 0) bg = { r: bg.r * (1 - c.a) + c.r * c.a, g: bg.g * (1 - c.a) + c.g * c.a, b: bg.b * (1 - c.a) + c.b * c.a, a: 1 }; }
      const fg = num(getComputedStyle(e).color); if (!fg) return null;
      const f2 = { r: bg.r * (1 - fg.a) + fg.r * fg.a, g: bg.g * (1 - fg.a) + fg.g * fg.a, b: bg.b * (1 - fg.a) + fg.b * fg.a };
      const a = lum(f2), b = lum(bg); return Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100;
    };
    for (const light of [false, true]) {
      const { page, ctx, errs } = await openSong(h, 'p430');
      await loadSong(page);
      await page.evaluate(l => { if (l) document.body.classList.add('light-mode'); songsPickToggle(true); }, light); await page.waitForTimeout(300);
      const t = (light ? 'Light: ' : 'dark: ');
      const targets = ['#songs-cur', '#songs-pick .sg-chip.on', '#songs-pick .sg-chip:not(.on)', '#pv-tiles', '#pv-chart', '#pv-stage', '#songs-ending-row .ms-lbl', '#songs-ending-row .end-btn', '#pf-widgets-btn', '#songs-setlist-nav .pf-cap', '#prev-section-btn .pf-cap'];
      const got = await page.evaluate(([f, ts]) => { const fn = eval('(' + f + ')'); return ts.map(s => [s, fn(s)]); }, [CONTRAST.toString(), targets]);
      const low = got.filter(([s, c]) => c !== null && c < 4.5);
      R.check(got.every(([s, c]) => c !== null) && low.length === 0, t + 'text on the header, chips, tabs, Stage, captions, endings and the widgets switch is at least 4.5:1', JSON.stringify(low.length ? low : got.map(g => g[1])));
      R.check(await page.evaluate(() => getComputedStyle(document.getElementById('pv-switch')).boxShadow === 'none'), t + 'the tab group draws no inset box (the .tg look is gone)');
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }
    for (const vp of ['ipad820', 'duoOpen', 'phoneLand']) {
      const { page, ctx, errs } = await openSong(h, vp);
      await loadSong(page); await page.waitForTimeout(300);
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, panel: Math.round(document.getElementById('songs-perform-panel').getBoundingClientRect().width) }));
      R.check(w.doc <= w.win && w.panel <= 701, vp + ': Perform neither scrolls sideways nor runs wider than 700 pt', JSON.stringify(w));
      const trT = await tops(page, ['#prev-section-btn', '#slb-auto-btn', '#next-section-btn', '#slb-save-btn']);
      R.check(same(trT), vp + ': the transport row is one line', trT.join());
      R.check(errs.length === 0, vp + ': no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      const { page, ctx } = await openSong(h, 'ipad820', () => document.documentElement.classList.add('mac-app'));
      await loadSong(page); await page.waitForTimeout(300);
      const trM = await tops(page, ['#prev-section-btn', '#slb-auto-btn', '#next-section-btn', '#slb-save-btn']);
      R.check(same(trM) && !(await box(page, '#songs-head')).shown && (await box(page, '#songs-subnav')).shown, 'Mac app: Perform keeps the old three-way switch, no header picker, and a one-line transport row', trM.join());
      await ctx.close();
    }

    // ── Review fixes ──────────────────────────────────────────────────────────
    // A free build draws an "Add-on" badge on Timeline and on Stage: at every width they must neither overflow nor run into each other.
    for (const vp of ['se375', 'p390', 'p430', 'ipad820', 'phoneLand', 'duoOpen', 'duoClosed']) {
      const { page, ctx, errs } = await openSong(h, vp, () => setModTier('free'));
      await page.evaluate(() => { setSongsMode('perform'); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
      const g = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), sw = document.getElementById('pv-switch'), st = document.getElementById('pv-stage'), pn = document.getElementById('songs-perform-panel').getBoundingClientRect();
        return { swOver: sw.scrollWidth > sw.clientWidth + 1, stOver: st.scrollWidth > st.clientWidth + 1, tlRight: Math.round(r('pv-timeline').right), stLeft: Math.round(r('pv-stage').left), stRight: Math.round(r('pv-stage').right), panelRight: Math.round(pn.right),
          locked: document.getElementById('pv-stage').classList.contains('pv-locked') && document.getElementById('pv-timeline').classList.contains('pv-locked') }; });
      R.check(g.locked && !g.swOver && !g.stOver && g.tlRight <= g.stLeft && g.stRight <= g.panelRight + 1, 'free build at ' + vp + ': the Add-on badges neither overflow their buttons nor run into each other', JSON.stringify(g));
      R.check(errs.length === 0, 'free build at ' + vp + ': no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      // The tutorial's Song step finds something to point at, in the Mac app too (where the header picker is not drawn).
      for (const mac of [false, true]) {
        const { page, ctx } = await openSong(h, 'ipad820', mac ? () => document.documentElement.classList.add('mac-app') : null);
        const r = await page.evaluate(() => { const st = TUT_LIST.filter(x => x.id === 'song')[0].steps[0]; const e = typeof st.el === 'function' ? st.el() : document.querySelector(st.el);
          if (!e) return null; const b = e.getBoundingClientRect(); return { id: e.id, ok: b.width > 0 && b.height > 0 }; });
        R.check(r && r.ok, (mac ? 'Mac app' : 'phone') + ': the Song tutorial step points at something drawn', JSON.stringify(r));
        await ctx.close();
      }
    }
    {
      // Keyboard: Escape in the picker hands focus back to the header button (as Studio's picker does); the header names what it opens.
      const { page, ctx } = await openSong(h, 'p390');
      await page.evaluate(() => songsPickToggle(true)); await page.focus('#songs-pick .sg-chip[data-m=library]'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      R.check(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'songs-cur' && !(await box(page, '#songs-pick')).shown, 'picker: Escape from a chip closes it and focus returns to the header button');
      R.check(await attr(page, '#songs-cur', 'aria-controls') === 'songs-pick' && await attr(page, '#songs-pick', 'role') === 'group' && (await attr(page, '#songs-pick', 'aria-label') || '').length > 0, 'picker: the header says what it controls, and the picker is a labelled group');
      R.check(await page.evaluate(() => [...document.querySelectorAll('#songs-pick .sg-chip')].filter(b => b.getAttribute('aria-current')).map(b => b.dataset.m).join()) === 'build', 'picker: the chip for the page you are on carries aria-current');
      await click(page, '#songs-cur'); await page.focus('#songs-pick .sg-chip[data-m=perform]'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      R.check(await mode(page) === 'perform' && await page.evaluate(() => document.activeElement && document.activeElement.id) === 'songs-cur' && await page.evaluate(() => document.querySelector('#songs-pick .sg-chip[aria-current]').dataset.m) === 'perform',
        'picker: choosing a page by keyboard moves focus to the header and marks the new page');
      await ctx.close();
    }
    R.check(!/on the chart below/.test(HTML), 'Loop bars no longer says "on the chart below" (the chart is above the Practice card now)');
    {
      // The widgets sheet opens into view, even from the bottom of the page.
      const { page, ctx } = await openSong(h, 'se375');
      await loadSong(page); await page.waitForTimeout(300);
      await page.evaluate(() => { window.scrollTo(0, 1e6); pfWidgetsToggle(); }); await page.waitForTimeout(500);
      const sh = await page.evaluate(() => { const r = document.getElementById('pf-wsheet').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
      R.check(sh.top >= 0 && sh.bottom <= sh.vh - 170, 'widgets: opening the sheet from the bottom of the page brings all of it above the bottom bar', JSON.stringify(sh));
      await ctx.close();
    }
    // The storage filter itself: a bare string and an array-like object must not hide anything (the earlier cases hold no real widget names).
    for (const [name, val] of [['a bare string', '"endings"'], ['an array-like object', '{"length":1,"0":"endings"}']]) {
      const { page, ctx, errs } = await openSong(h, 'se375');
      await page.evaluate(v => { localStorage.setItem('modo-perform-widgets', v); setSongsMode('perform'); }, val); await page.waitForTimeout(300);
      R.check(await allShown(page) && errs.length === 0, 'storage ' + name + ': every widget stays shown', errs.join('|'));
      await ctx.close();
    }

    // ── Arrow captions: the setlist arrows and the section arrows look alike, so each pair says what it moves ──
    for (const vp of ['se375', 'p430', 'phoneLand', 'ipad820']) {
      const { page, ctx, errs } = await openSong(h, vp);
      await loadSong(page); await page.waitForTimeout(300);
      const arrows = await page.evaluate(() => {
        const info = b => { const c = b.querySelector('.pf-cap'), r = b.getBoundingClientRect(), cr = c ? c.getBoundingClientRect() : null;
          return { cap: c ? c.textContent.trim() : null, capHidden: c ? c.getAttribute('aria-hidden') : null, size: c ? parseFloat(getComputedStyle(c).fontSize) : 0,
            inside: !!cr && cr.width > 0 && cr.left >= r.left - 1 && cr.right <= r.right + 1 && cr.top >= r.top - 1 && cr.bottom <= r.bottom + 1, over: b.scrollWidth > b.clientWidth + 1,
            w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label') }; };
        return { song: [...document.querySelectorAll('#songs-setlist-nav .sn-btn')].map(info), sect: ['prev-section-btn', 'next-section-btn'].map(i => info(document.getElementById(i))) };
      });
      const t = vp + ': ';
      R.check(arrows.song.length === 2 && arrows.song.every(a => a.cap === 'song'), t + 'the setlist arrows are captioned "song"', JSON.stringify(arrows.song.map(a => a.cap)));
      R.check(arrows.sect.length === 2 && arrows.sect.every(a => a.cap === 'section'), t + 'the section arrows are captioned "section"', JSON.stringify(arrows.sect.map(a => a.cap)));
      const all = arrows.song.concat(arrows.sect);
      R.check(all.every(a => a.size >= 10.4 && a.inside && !a.over && a.capHidden === 'true' && a.w >= 44 && a.h >= 44), t + 'every caption is at least 10.5 px, sits inside its button, and the buttons stay 44 pt (captions are hidden from screen readers)', JSON.stringify(all.map(a => [a.size, a.inside, a.over, a.w, a.h])));
      R.check(arrows.song.map(a => a.label).join() === 'Previous song,Next song' && arrows.sect.map(a => a.label).join() === 'Previous section,Next section', t + 'the accessible names are unchanged');
      const trL = await tops(page, ['#prev-section-btn', '#slb-auto-btn', '#next-section-btn', '#slb-save-btn']);
      R.check(same(trL), t + 'the transport row is still one line', trL.join());
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }

    // ── The header on a desktop browser (html.desktop-web, 880 px and up): Studio's own desktop rules hide every .ss-cur and lay every
    // .ss-pick out as a static row, and the header once shared those class names, so it vanished at 1000 px and the old switch is hidden too.
    for (const [w, view] of [[900, 'advanced'], [1000, 'basic'], [1280, 'basic'], [1280, 'advanced']]) {
      const { page, ctx, errs } = await openSong(h, { width: w, height: 800 });
      await page.evaluate(v => { document.documentElement.classList.add('desktop-web'); window.dispatchEvent(new Event('resize')); setViewMode(v); switchTab('songs'); setSongsMode('build'); }, view);
      await page.waitForTimeout(400);
      const t = 'desktop web ' + w + ' ' + view + ': ';
      const cur = await box(page, '#songs-cur');
      R.check(cur && cur.shown && cur.w >= 44 && cur.h >= 44, t + 'the header button is drawn and at least 44 pt', JSON.stringify(cur));
      await click(page, '#songs-cur'); await page.waitForTimeout(150);
      const chips = await page.evaluate(() => [...document.querySelectorAll('#songs-pick .sg-chip')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.m, Math.round(r.width), Math.round(r.height)]; }));
      R.check(chips.length === 3 && chips.every(c => c[1] > 0 && c[2] >= 44), t + 'a tap opens the three choices, each drawn and 44 pt tall', JSON.stringify(chips));
      await click(page, '#songs-pick [data-m=perform]'); await page.waitForTimeout(200);
      R.check(await mode(page) === 'perform' && (await box(page, '#songs-perform-panel')).shown && !(await box(page, '#songs-pick')).shown, t + 'picking Perform shows it and closes the choices');
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exitCode = 1; });
