/* Songs: Build | Perform | Library (5.10).

   Driven on the real window with real touch (CDP):
     - the sub-nav is Build, Perform, Library, and there is no Chart page any more;
     - Library holds the setlist, the Setups and the pattern save, and those panels are
       the same ones (same ids, same handlers): a song saved to the setlist is listed and a
       touch on it loads it, a Setup saved by name is listed;
     - the Setlist is no longer under Perform's chart and the Setups are no longer in
       Settings;
     - Chart is a view of Perform (Tiles | Chart | Timeline), free for everyone, with its
       diagrams and its Print / Save PDF; the old way in (setSongsMode('chart'), Find)
       lands there; the choice is kept;
     - the transport sheet's Setups goes to the Library.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/library/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const SHEET = '[Verse]\nC       G       Am      F\nAmazing grace how sweet the sound\n[Chorus]\nAm F C G\n';
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
  await page.evaluate((text) => {
    setModTier('free'); setViewMode('advanced'); switchTab('songs'); setSongsMode('build');
    const r = songFromChordSheet(parseChordSheet(text), { len: 'lines', lineBars: 2 });
    sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
    root = r.song.root; mode = r.song.mode; curSection = 0; document.getElementById('chart-title').value = 'Grace';
    buildSectionTabs(); renderChartSeq(); saveToSetlist();
  }, SHEET);
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);

  // ── 1. The sub-nav and the Library.
  const nav = await page.evaluate(() => [...document.querySelectorAll('#songs-subnav .subnav-btn')].map(b => b.textContent.trim()));
  check(nav.join() === 'Build,Perform,Library', 'the sub-nav is Build, Perform, Library', nav.join());
  await tap('#songs-library-btn');
  const lib = await page.evaluate(() => ({ panel: document.getElementById('songs-library-panel').style.display !== 'none',
    inLib: ['setlist-items-perform', 'setups-items', 'setup-name', 'lib-banks'].map(id => !!document.getElementById(id) && document.getElementById('songs-library-panel').contains(document.getElementById(id))),
    perfSetlist: document.getElementById('songs-perform-panel').contains(document.getElementById('setlist-items-perform')),
    settingsSetups: document.getElementById('page-build').contains(document.getElementById('setups-panel')),
    items: document.querySelectorAll('#setlist-items-perform .sl-item').length }));
  check(lib.panel && lib.inLib.every(Boolean), 'Library shows the setlist, the Setups and the pattern save', JSON.stringify(lib.inLib));
  check(!lib.perfSetlist && !lib.settingsSetups, 'and they are no longer under Perform or in Settings', JSON.stringify([lib.perfSetlist, lib.settingsSetups]));
  check(lib.items === 1, 'the song saved a moment ago is in the setlist', lib.items);
  // load it by touch from another state
  await page.evaluate(() => { sections = [{ name: 'X', follow: 'repeat', plays: 1, slots: [] }]; curSetlistIdx = -1; });
  await tap('#setlist-items-perform .sl-item');
  check(await page.evaluate(() => sections.length === 2 && document.getElementById('chart-title').value === 'Grace'), 'a touch on it loads the song');
  await page.evaluate(() => { document.getElementById('setup-name').value = 'Gig rig'; });
  await tap('#setups-panel .sc-btn.primary');
  const su = await page.evaluate(() => [...document.querySelectorAll('#setups-items .sl-item, #setups-items .sl-name')].map(e => e.textContent).join('|'));
  check(/Gig rig/.test(su), 'a Setup saved by name is listed', su.slice(0, 60));
  check(await vis('#lib-banks button'), 'the pattern save has its button');

  // ── 2. Chart is a view of Perform.
  await tap('#songs-perform-btn');
  const sw = await page.evaluate(() => [...document.querySelectorAll('#pv-switch .tb')].map(b => b.textContent.trim()));
  check(sw.join() === 'Tiles,Chart,Timeline', 'Perform has Tiles | Chart | Timeline', sw.join());
  await tap('#pv-chart');
  const ch = await page.evaluate(() => ({ cards: document.querySelectorAll('#chord-chart-body .cc-card').length, panel: document.getElementById('songs-chart-panel').style.display !== 'none', tiles: getComputedStyle(document.getElementById('songs-full-chart')).display, print: !!([...document.querySelectorAll('#songs-chart-panel button')].find(b => /Print/.test(b.textContent))), stored: localStorage.getItem('modo-perform-view'), inPerform: document.getElementById('songs-perform-panel').contains(document.getElementById('songs-chart-panel')) }));
  check(ch.cards >= 8 && ch.panel && ch.tiles === 'none' && ch.print && ch.inPerform, 'Chart: the diagrams are there, free, with Print / Save PDF, in place of the tiles', JSON.stringify(ch));
  check(ch.stored === 'chart', 'and the choice is kept', ch.stored);
  await tap('#pv-tiles');
  check((await page.evaluate(() => [document.getElementById('songs-chart-panel').style.display, getComputedStyle(document.getElementById('songs-full-chart')).display])).join() === 'none,block', 'Tiles brings the tiles back and hides the chart');
  await page.evaluate(() => { setSongsMode('chart'); });
  const old = await page.evaluate(() => ({ perf: document.getElementById('songs-perform-panel').style.display !== 'none', view: songsPerformViewGet(), active: document.getElementById('songs-perform-btn').classList.contains('active') }));
  check(old.perf && old.view === 'chart' && old.active, 'setSongsMode(\'chart\') (Find, an old link) lands on Perform’s Chart view', JSON.stringify(old));

  // ── 3. The sheet's Setups.
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  await tap('#tab-more'); await tap('#ft-setups-btn');
  const sheet = await page.evaluate(() => ({ page: (document.querySelector('.tab-page.active') || {}).id, lib: document.getElementById('songs-library-panel').style.display !== 'none', focus: document.activeElement && document.activeElement.id }));
  check(sheet.page === 'page-songs' && sheet.lib, 'the sheet’s Setups goes to the Library', JSON.stringify(sheet));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
