/* Editing on the timeline (5.9): Songs > Build, Strip | Timeline.

   Driven on the real window with real touch (CDP) on a written song, "Amazing grace":
   a Verse of two lines (four chords over two bars, then two chords) and a Chorus.
     - the switch is there for the Practice Pack and not without it; the strip is hidden while
       the timeline is up; it shows only the section being edited, one column per chord;
     - a touch on a column selects that chord and the strip's own controls open under it;
     - a JOIN between two chords on a card is a handle you can drag: it snaps to a beat, the
       two chords keep their sum, neither goes to nothing, the panel says where the second
       one lands while you drag ("bar 1, beat 4") and the edit is one Undo;
     - a drag that does not reach the next beat changes nothing and leaves no toast;
     - Even shares a line out equally, 1 / 2 / 4 bars makes the line that long with its
       chords in proportion, Split cuts a chord in two (the words stay on the first half),
       and each is one Undo;
     - the song is "unsaved" after each, and Perform's timeline shows the new lengths.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tledit/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const SHEET = '[Verse]\nC       G       Am      F\nAmazing grace how sweet the sound\nC       G\nThat saved a wretch like me\n[Chorus]\nAm F C G\n';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  const load = () => page.evaluate((text) => {
    const r = songFromChordSheet(parseChordSheet(text), { len: 'lines', lineBars: 2 });
    sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
    root = r.song.root; mode = r.song.mode; curSection = 0; chartSeqIdx = 1;
    document.getElementById('chart-title').value = 'Amazing test';
    buildSectionTabs(); renderChartSeq(); markSongSaved();
  }, SHEET);
  await page.evaluate(() => { setModTier('free'); setViewMode('advanced'); switchTab('songs'); setSongsMode('build'); });
  await load(); await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const center = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  const tap = async (sel) => {
    const b = await center(sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const drag = async (sel, dx) => {
    const b = await center(sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + dx * i / 8, y: b.y }] });
    const mid = await page.evaluate(() => (document.getElementById('tl-where') || {}).textContent);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    return mid;
  };
  const durs = () => page.evaluate(() => sections[0].slots.map(x => Math.round(_slotBeats(x) * 2)));
  const undo = async () => { await page.evaluate(() => { const b = document.querySelector('#_toast ._toast-btn'); if (b) b.click(); }); await page.waitForTimeout(300); };

  // ── 1. The switch is the pack's.
  check(await page.evaluate(() => getComputedStyle(document.getElementById('bt-switch')).display === 'none'), 'free: no Strip | Timeline switch');
  await page.evaluate(() => { setModTier('pro'); renderChartSeq(); }); await page.waitForTimeout(250);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('bt-switch')).display !== 'none'), 'pro: the switch is there');
  await tap('#bt-timeline');
  const sections_n = await page.evaluate(() => sections.filter(x => x.slots.length).length);
  const v = await page.evaluate(() => ({ cols: document.querySelectorAll('#chart-timeline .tl-col').length, want: sections.reduce((a, x) => a + x.slots.length, 0), heads: document.querySelectorAll('#chart-timeline .tl-secl').length, strip: getComputedStyle(document.getElementById('chart-sequence')).display, sel: [...document.querySelectorAll('#chart-timeline .tl-col.tl-sel')].map(c => c.dataset.ci).join(), joins: document.querySelectorAll('#chart-timeline .tl-block:first-of-type .tl-join').length, stored: localStorage.getItem('modo-build-view'), panel: getComputedStyle(document.getElementById('tl-panel')).display }));
  check(v.cols === v.want && v.heads === sections_n && v.strip === 'none' && v.stored === 'timeline' && v.panel !== 'none', 'Timeline: every section on the page (a heading and a column per chord), the strip hidden, the panel up', JSON.stringify(v));
  check(v.sel === '1', 'the selected chord (the second) is marked', v.sel);
  check(v.joins === 4, 'a join between each pair of chords on a card (3 on the first line, 1 on the second)', v.joins);

  // ── 2. Select by touch.
  await tap('#chart-timeline .tl-col[data-ci="2"]');
  const sel = await page.evaluate(() => ({ idx: chartSeqIdx, marked: [...document.querySelectorAll('#chart-timeline .tl-col.tl-sel')].map(c => c.dataset.ci).join(), editor: !!document.querySelector('#chart-inspector .ci-row') }));
  check(sel.idx === 2 && sel.marked === '2' && sel.editor, 'a touch selects the chord and opens the strip’s controls under it', JSON.stringify(sel));

  // ── 3. Drag a join.
  const d0 = await durs();
  const beatPx = (await page.evaluate(() => { const r = document.querySelector('#chart-timeline .tl-card .tl-row').getBoundingClientRect(); const n = document.querySelectorAll('#chart-timeline .tl-card:first-child .tl-col').length; return r.width / 8; }));
  const mid = await drag('#chart-timeline .tl-join[data-ci="0"]', beatPx);
  const d1 = await durs();
  check(d0[0] + d0[1] === d1[0] + d1[1] && d1[0] === d0[0] + 2 && d1[1] === d0[1] - 2, 'dragging the first join a beat right: the first chord is a beat longer, the second a beat shorter, the sum the same', JSON.stringify([d0.slice(0, 2), d1.slice(0, 2)]));
  check(/starts on bar 1, beat 4/.test(mid || ''), 'while dragging, the panel says where it lands', JSON.stringify(mid));
  check(await page.evaluate(() => songIsDirty()), 'the song is unsaved after it');
  await undo();
  const d2 = await durs();
  check(JSON.stringify(d2) === JSON.stringify(d0), 'one Undo puts it back', JSON.stringify(d2));
  // no change for a nudge that does not reach the next beat
  await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.textContent = ''; });
  const t0 = await page.evaluate(() => (document.getElementById('_toast') || {}).textContent || '');
  await drag('#chart-timeline .tl-join[data-ci="0"]', beatPx * 0.3);
  const d3 = await durs();
  const t1 = await page.evaluate(() => (document.getElementById('_toast') || {}).textContent || '');
  check(JSON.stringify(d3) === JSON.stringify(d0) && t1 === t0, 'a drag short of the next beat changes nothing and makes no toast', JSON.stringify([d3.slice(0, 2), t1]));
  // clamp: far left cannot take the first chord to nothing
  await drag('#chart-timeline .tl-join[data-ci="0"]', -beatPx * 8);
  const d4 = await durs();
  check(d4[0] >= 2 && d4[0] + d4[1] === d0[0] + d0[1], 'dragged all the way left it stops at a beat (the first chord keeps one)', JSON.stringify(d4.slice(0, 2)));
  await undo();

  // ── 4. Even, 1 / 2 / 4 bars, Split.
  await tap('#chart-timeline .tl-col[data-ci="1"]');
  await drag('#chart-timeline .tl-join[data-ci="0"]', beatPx * 2);
  await undo(); await drag('#chart-timeline .tl-join[data-ci="1"]', beatPx);
  const uneven = await durs();
  await tap('#tl-panel .tl-tools .tb:nth-child(5)');
  const even = await durs();
  check(uneven.slice(0, 4).some(x => x !== uneven[0]) && even.slice(0, 4).every(x => x === 4), 'Even shares the line out: four chords of two beats', JSON.stringify([uneven.slice(0, 4), even.slice(0, 4)]));
  await undo();
  await tap('#tl-panel .tl-tools .tb:nth-child(2)');         // 1 bar
  const one = await durs();
  check(one.slice(0, 4).reduce((a, b) => a + b, 0) === 8 && one.slice(0, 4).every(x => x === 2), '1 bar: the line is a bar long, a beat a chord', JSON.stringify(one.slice(0, 4)));
  await undo();
  await tap('#tl-panel .tl-tools .tb:nth-child(4)');         // 4 bars
  const four = await durs();
  check(four.slice(0, 4).reduce((a, b) => a + b, 0) === 32, '4 bars: the line is four bars long', JSON.stringify(four.slice(0, 4)));
  await undo();
  const words0 = await page.evaluate(() => [sections[0].slots[0].lyr, sections[0].slots.length]);
  await tap('#chart-timeline .tl-col[data-ci="0"]');
  await tap('#tl-panel .tl-tools .tb:nth-child(6)');         // Split
  const sp = await page.evaluate(() => ({ n: sections[0].slots.length, a: Math.round(_slotBeats(sections[0].slots[0]) * 2), b: Math.round(_slotBeats(sections[0].slots[1]) * 2), l0: sections[0].slots[0].lyr, l1: sections[0].slots[1].lyr, lab0: sections[0].slots[0].label, lab1: sections[0].slots[1].label }));
  check(sp.n === words0[1] + 1 && sp.a + sp.b === 4 && sp.l0 === words0[0] && !sp.l1 && sp.lab0 === sp.lab1, 'Split cuts the chord in two: the same chord, the same total, the words on the first half', JSON.stringify(sp));
  await undo();
  check((await page.evaluate(() => sections[0].slots.length)) === words0[1], 'and Undo takes the cut back');

  // ── 5. Perform sees it.
  await tap('#chart-timeline .tl-col[data-ci="0"]');
  const pre = await durs();
  await drag('#chart-timeline .tl-join[data-ci="0"]', beatPx);
  const perf = await page.evaluate(() => { setSongsMode('perform'); songsPerformViewSet('timeline'); const c = document.querySelectorAll('#songs-full-chart .tl-block:first-child .tl-col'); return [Math.round(parseFloat(c[0].style.flexGrow) * 2), Math.round(parseFloat(c[1].style.flexGrow) * 2)]; });
  check(perf[0] === pre[0] + 2 && perf[1] === pre[1] - 2, 'Perform\u2019s timeline shows the new lengths', JSON.stringify([pre.slice(0, 2), perf]));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
