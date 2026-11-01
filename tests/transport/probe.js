/* The transport with a song of two sections (6.0i), on the phone widths that exist: 375, 390, 430.

   Before: the section arrows and Song ran off the right edge at every one of them and Song was squeezed
   to 12 pt. Now: nothing in the transport or the tab bar goes past the screen edge, the page does not
   scroll sideways, and the arrows and Song are each at least 44 x 44 and are hit at their centre.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/transport/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  for (const W of [375, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(() => {
      setModTier('pro'); setViewMode('studio'); switchTab('songs');
      const r = songFromChordSheet(parseChordSheet('[Verse]\nC G Am F\n[Chorus]\nF G C\n'), { len: 'lines', lineBars: 2 });
      sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
      buildSectionTabs(); renderChartSeq(); document.getElementById('chart-title').value = 'T'; saveToSetlist(); updateFtSongBtn(); syncFixedTransport();
    });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
      const over = [...document.querySelectorAll('#perf-bar *, #tab-bar *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none' && (r.right > innerWidth + 1 || r.left < -1); }).map(e => e.id || e.className).slice(0, 4);
      const hit = id => { const r = document.getElementById(id).getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e.id === id || document.getElementById(id).contains(e)); };
      return { prev: box('ft-sect-prev'), song: box('ft-song-btn'), next: box('ft-sect-next'), over, sx: document.documentElement.scrollWidth, hits: ['ft-sect-prev', 'ft-song-btn', 'ft-sect-next', 'ft-playstop-btn'].map(hit) };
    });
    check(m.over.length === 0 && m.sx <= W, W + ': nothing in the transport or the tabs runs past the edge, and the page does not scroll sideways', JSON.stringify([m.over, m.sx]));
    check([m.prev, m.song, m.next].every(b => b.w >= 44 && b.h >= 44), W + ': the section arrows and Song are each 44 x 44 or more', [m.prev, m.song, m.next].map(b => b.w + 'x' + b.h).join(' '));
    check(m.hits.every(Boolean), W + ': each is hit at its own centre', m.hits.join());
    check(errs.length === 0, W + ': no script errors', errs.join(' | ').slice(0, 160));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
