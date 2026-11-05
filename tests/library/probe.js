/* Songs: Build | Perform | Library (5.10, reshaped in 6.9b).

   Driven on the real window with real touch (CDP):
     - the sub-nav is Build, Perform, Library, and there is no Chart page any more;
     - Library is one page of three sections, in order: common progressions, saved songs, and
       the ways to import (iReal Pro, a PDF / photo / chord sheet). No four-way switch, no
       setlist, Setups or pattern save on it;
     - a saved song is on that page and a touch on it loads it (and lands on Build);
     - Song › Build has Common progressions and Saved songs a tap away, in both the card view and
       the timeline view, each opening the sheet on its own list;
     - the Setlist is under Perform's chart, the Setups are in Settings, and the transport sheet's
       Setups goes to Settings;
     - Saved patterns have a Save / Open row on the Drums, Bass and Melody pages (Arp has none);
     - Chart is a view of Perform (Tiles | Chart | Timeline), free for everyone, with its
       diagrams and its Print / Save PDF; the old way in (setSongsMode('chart'), Find)
       lands there; the choice is kept.

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
  const lib = await page.evaluate(() => {
    const P = document.getElementById('songs-library-panel');
    return { panel: P.style.display !== 'none',
      heads: [...P.querySelectorAll('.sb-hdr-lbl')].map(e => e.textContent.trim()),
      switchGone: !document.getElementById('lib-switch'),
      moved: ['setlist-items-perform', 'setups-items', 'setup-name', 'lib-banks'].map(id => !!document.getElementById(id) && P.contains(document.getElementById(id))),
      perfSetlist: document.getElementById('songs-perform-panel').contains(document.getElementById('setlist-items-perform')),
      settingsSetups: document.getElementById('page-build').contains(document.getElementById('setups-panel')),
      common: P.querySelectorAll('#lib-sec-common .lib-row').length,
      mine: [...P.querySelectorAll('#lib-sec-songs .lib-rowname')].map(e => e.textContent),
      imports: [...P.querySelectorAll('#lib-sec-import .ll-act b')].map(e => e.textContent) };
  });
  check(lib.panel && lib.heads.join() === 'Common progressions,Saved songs,Import a song', 'Library: common progressions, then saved songs, then import', lib.heads.join());
  check(lib.switchGone && lib.moved.every(x => !x), 'no switch, and no setlist / Setups / pattern save on it', JSON.stringify(lib.moved));
  check(lib.perfSetlist && lib.settingsSetups, 'the setlist is under Perform and the Setups are in Settings', JSON.stringify([lib.perfSetlist, lib.settingsSetups]));
  check(lib.common === 5, 'common progressions show the first five', lib.common);
  check(lib.mine.join() === 'Grace', 'the song saved a moment ago is under Saved songs', lib.mine.join());
  check(lib.imports.join() === 'iReal Pro,PDF, photo or chord sheet', 'import: iReal Pro and PDF / photo / chord sheet', lib.imports.join());
  await tap('#lib-sec-common .lib-more');
  check(await page.evaluate(() => document.querySelectorAll('#lib-sec-common .lib-row').length > 5), 'Show all lists every progression');
  // a search narrows both lists
  await page.evaluate(() => { const q = document.getElementById('lib-page-q'); q.value = 'grace'; q.dispatchEvent(new Event('input')); });
  const srch = await page.evaluate(() => ({ mine: document.querySelectorAll('#lib-sec-songs .lib-row').length, common: document.querySelectorAll('#lib-sec-common .lib-row').length }));
  check(srch.mine === 1 && srch.common === 0, 'the search filters both lists', JSON.stringify(srch));
  await page.evaluate(() => { const q = document.getElementById('lib-page-q'); q.value = ''; q.dispatchEvent(new Event('input')); });
  // load it by touch from another state: it lands on Build with the chart filled
  await page.evaluate(() => { sections = [{ name: 'X', follow: 'repeat', plays: 1, slots: [] }]; curSetlistIdx = -1; });
  await tap('#lib-sec-songs .lib-row');
  await tap('.ll-act.primary');
  const landed = await page.evaluate(() => ({ ok: sections.length === 2 && document.getElementById('chart-title').value === 'Grace', build: document.getElementById('songs-build-panel').style.display !== 'none', lib: document.getElementById('songs-library-panel').style.display })); 
  check(landed.ok && landed.build && landed.lib === 'none', 'a touch on a saved song loads it and lands on Build', JSON.stringify(landed));
  // a progression, added as a section
  await tap('#songs-library-btn');
  const nSec = await page.evaluate(() => sections.length);
  await tap('#lib-sec-common .lib-row');
  await tap('.ll-act:not(.primary):not(#lib-imp-ireal):not(#lib-imp-sheet)');
  check(await page.evaluate(n => sections.length === n + 1 && songsMode === 'build', nSec), 'a common progression added from the page becomes a section on Build');
  // the importers
  await tap('#songs-library-btn');
  await tap('#lib-imp-ireal');
  const ir = await page.evaluate(() => ({ sheet: !!document.querySelector('.lib-sheet'), on: (document.querySelector('.lib-tabs button.on') || {}).textContent, box: !!document.querySelector('.lib-import-in') }));
  check(ir.sheet && ir.on === 'iReal Pro' && ir.box, 'iReal Pro import opens the importer on its tab', JSON.stringify(ir));
  await page.evaluate(() => _libSheet && _libSheet.close());
  await tap('#lib-imp-sheet');
  check(await page.evaluate(() => !!document.querySelector('.csi-overlay .csi-file')), 'PDF / photo / chord sheet opens the chord-sheet reader (it takes a PDF)');
  check(await page.evaluate(() => /pdf/.test(document.querySelector('.csi-input').accept)), 'and its file picker accepts a PDF');
  await tap('.csi-cancel');
  check(await page.evaluate(() => songsMode === 'library'), 'cancelling leaves you on the Library');

  // ── 1b. Build has both a tap away, in the card view and the timeline view.
  await tap('#songs-build-btn');
  for (const tl of [false, true]) {
    await page.evaluate(tl => document.body.classList.toggle('bt-timeline', tl), tl);
    const v = await page.evaluate(() => [...document.querySelectorAll('#sb-start button')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.replace('›', '').trim(), w: r.width, h: r.height }; }));
    check(v.length === 2 && v[0].t === 'Common progressions' && v[1].t === 'Saved songs' && v.every(b => b.w > 100 && b.h >= 44), 'Build (' + (tl ? 'timeline' : 'cards') + ') shows Common progressions and Saved songs', JSON.stringify(v));
  }
  await page.evaluate(() => document.body.classList.remove('bt-timeline'));
  await tap('#sb-start button:nth-child(2)');
  const sv = await page.evaluate(() => ({ on: (document.querySelector('.lib-tabs button.on') || {}).textContent, rows: [...document.querySelectorAll('#lib-host .lib-rowname')].map(e => e.textContent) }));
  check(sv.on === 'My songs' && sv.rows.join() === 'Grace', 'Saved songs opens the sheet on the saved songs', JSON.stringify(sv));
  await page.evaluate(() => _libSheet && _libSheet.close());
  await tap('#sb-start button:nth-child(1)');
  const cm = await page.evaluate(() => ({ on: (document.querySelector('.lib-tabs button.on') || {}).textContent, rows: document.querySelectorAll('#lib-host .lib-row').length }));
  check(cm.on === 'Common' && cm.rows > 5, 'Common progressions opens the sheet on the progressions', JSON.stringify(cm));
  await page.evaluate(() => _libSheet && _libSheet.close());

  // ── 1c. The setlist is under Perform, with the song in it, and a touch loads it.
  await page.evaluate(() => { sections = [{ name: 'X', follow: 'repeat', plays: 1, slots: [] }]; curSetlistIdx = -1; });
  await tap('#songs-perform-btn');
  check(await vis('#setlist-items-perform .sl-item'), 'Perform shows the setlist');
  await tap('#setlist-items-perform .sl-item .sl-name');
  check(await page.evaluate(() => sections.length === 2 && document.getElementById('chart-title').value === 'Grace'), 'a touch on a setlist song loads it');
  // Setups in Settings: saved by name and listed.
  await page.evaluate(() => { openSettings(); setSettingsPane('ui'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('setup-name').value = 'Gig rig'; });
  await tap('#setups-panel .sc-btn.primary');
  const su = await page.evaluate(() => [...document.querySelectorAll('#setups-items .sl-item, #setups-items .sl-name')].map(e => e.textContent).join('|'));
  check(/Gig rig/.test(su), 'a Setup saved by name in Settings is listed', su.slice(0, 60));

  // ── 2. Chart is a view of Perform.
  await page.evaluate(() => { switchTab('songs'); });
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
  const sheet = await page.evaluate(() => ({ page: (document.querySelector('.tab-page.active') || {}).id, focus: document.activeElement && document.activeElement.id }));
  check(sheet.page === 'page-build' && sheet.focus === 'setup-name', 'the sheet’s Setups goes to Settings, with the name field ready', JSON.stringify(sheet));

  // ── 4. Saved patterns live on their instrument's page: a row under the part switch that follows it.
  await page.evaluate(() => { switchTab('accomp'); setAccompMode('drums'); });
  const rows = {};
  for (const [m, lbl, tab] of [['drums', 'Saved drum patterns', 'Drums'], ['bass', 'Saved basslines', 'Bassline'], ['melody', 'Saved melody lines', 'Melody']]) {
    await page.evaluate(m => setAccompMode(m), m);
    rows[m] = await page.evaluate(() => { const r = document.getElementById('ac-patterns-row'), b = r.getBoundingClientRect(); return { shown: b.width > 0 && b.height >= 44, lbl: document.getElementById('ac-patterns-lbl').textContent }; });
    check(rows[m].shown && rows[m].lbl === lbl, m + ' page has its own saved-patterns row', JSON.stringify(rows[m]));
    await tap('#ac-patterns-row .st-sv:nth-of-type(2)');
    const on = await page.evaluate(() => (document.querySelector('.lib-tabs button.on') || {}).textContent);
    check(on === tab, m + ': Open lands on that part\u2019s tab', String(on));
    await page.evaluate(() => { document.querySelectorAll('.smp-x').forEach(c => c.click()); });
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => setAccompMode('drums'));
  const before = await page.evaluate(() => rhyBankList('drums').length);
  await page.evaluate(() => { const sq = window._sqCaptureState(), row = Object.keys(sq.grid)[0]; sq.grid[row] = sq.grid[row].map((c, i) => Object.assign({}, c, { v: i % 4 === 0 ? 1 : 0 })); window._sqRestoreState(sq); });
  await page.evaluate(() => bankSave('drums', 'Probe beat'));
  check(await page.evaluate(b => rhyBankList('drums').length === b + 1, before), 'Save on the Drums page stores a drum pattern');
  await page.evaluate(() => setAccompMode('arp'));
  check(!(await vis('#ac-patterns-row')), 'Arp has no saved patterns, so the row hides');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
