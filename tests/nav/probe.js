/* Navigation and part switches (7.2).

   Driven on the real window with real touch (CDP):
     - a tap on Studio, Song or Sound that is already lit steps to that tab's next section and wraps round
       (Studio: Chords, Melody, Sampler, mõdFX; Song: Build, Perform, Library; Sound: Mixer, Voices, mõdSynth); a tap from
       another tab only goes there, to the section it was left on;
     - Live, upright: scrolling the page down folds the tab row and the parts row away and shows a pull tab; the pull tab, a
       swipe up from the bottom centre, or leaving Live brings them back; a swipe up that starts at the side does not;
     - Drums: the Kit | Aux switch is above the grid it edits;
     - a part switched on with nothing in it is given its starter and the band starts, so it is heard; a part that has a
       pattern is switched on without starting anything.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/nav/probe.js
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const boot = async () => {
    await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(() => { setModTier('pro'); }); await page.waitForTimeout(300);
  };
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await boot();
  const cdp = await ctx.newCDPSession(page);
  const tapEl = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  };
  const state = () => page.evaluate(() => ({ page: _activePageId(), live: document.body.classList.contains('mode-basic'), perf: performMode, songs: songsMode, mix: MSX_UI.mode,
    lit: [...document.querySelectorAll('.tab-btn.active')].map(x => x.id.replace('tab-', '')).join() }));

  // 1. The tabs.
  await tapEl('#tab-live');
  let s = await state(); check(s.live && s.lit === 'live', 'Live is lit', JSON.stringify(s));
  await tapEl('#tab-studio'); s = await state();
  check(!s.live && s.lit === 'studio' && s.perf === 'chords', 'from Live, Studio opens on the section it was left on (Chords)', JSON.stringify(s));
  const studio = []; for (let i = 0; i < 4; i++) { await tapEl('#tab-studio'); studio.push((await state()).perf); }
  check(studio.join() === 'melody,pads,fx,chords', 'Studio steps Melody, Sampler, mõdFX and wraps to Chords', studio.join());
  await tapEl('#tab-songs'); s = await state(); check(s.lit === 'songs' && s.songs === 'build', 'Song opens on Build', JSON.stringify(s));
  const songs = []; for (let i = 0; i < 3; i++) { await tapEl('#tab-songs'); songs.push((await state()).songs); }
  check(songs.join() === 'perform,library,build', 'Song steps Perform, Library and wraps to Build', songs.join());
  await tapEl('#tab-mix'); s = await state(); check(s.lit === 'mix' && s.mix === 'mixer', 'Sound opens on the Mixer', JSON.stringify(s));
  const mix = []; for (let i = 0; i < 3; i++) { await tapEl('#tab-mix'); mix.push((await state()).mix); }
  check(mix.join() === 'voices,synth,mixer', 'Sound steps Voices, mõdSynth and wraps to the Mixer', mix.join());
  await tapEl('#tab-mix'); await tapEl('#tab-songs'); await tapEl('#tab-mix'); s = await state();
  check(s.mix === 'voices', 'a tap from another tab does not step: Sound is back on the section it was left on', JSON.stringify(s));
  await page.evaluate(() => { switchTab('accomp'); setAccompMode('bass'); }); await page.waitForTimeout(200);
  await tapEl('#tab-studio'); s = await state();
  check(s.page === 'perform' && s.perf === 'chords', 'on a part page, a tap on Studio lands on Chords', JSON.stringify(s));

  // 2. Live folds its bars away while the page scrolls down.
  await tapEl('#tab-live'); await page.waitForTimeout(400);
  const bars = () => page.evaluate(() => ({ hidden: document.body.classList.contains('live-nav-hide'), tab: getComputedStyle(document.getElementById('tab-bar')).display,
    parts: getComputedStyle(document.querySelector('.ft-parts')).display, pull: getComputedStyle(document.getElementById('live-pull')).display,
    play: document.getElementById('ft-playstop-btn').getBoundingClientRect().height > 0 }));
  let b = await bars(); check(!b.hidden && b.tab !== 'none' && b.parts !== 'none' && b.pull === 'none', 'at the top of Live the bars are shown', JSON.stringify(b));
  const scrollTo = async y => { await page.evaluate(y => { document.getElementById('page-perform').scrollTop = y; }, y); await page.waitForTimeout(150); };
  for (const y of [30, 80, 140, 220]) await scrollTo(y);
  await page.waitForTimeout(500);
  b = await bars(); check(b.hidden && b.tab === 'none' && b.parts === 'none' && b.pull !== 'none' && b.play, 'scrolling down folds the tabs and the parts row and shows the pull tab; Play stays', JSON.stringify(b));
  await scrollTo(150); await page.waitForTimeout(300);
  b = await bars(); check(b.hidden, 'a nudge back up does not bring them back');
  await tapEl('#live-pull'); b = await bars(); check(!b.hidden && b.tab !== 'none' && b.parts !== 'none', 'the pull tab brings them back');
  await scrollTo(0);
  for (const y of [30, 80, 140, 220, 300]) await scrollTo(y); await page.waitForTimeout(600);
  b = await bars(); check(b.hidden, 'folded again');
  const swipe = async (x, y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(250);
  };
  await swipe(30, 830, 760); b = await bars(); check(b.hidden, 'a swipe up from the side of the bottom edge does nothing');
  const playedBefore = await page.evaluate(() => isAnythingPlaying());
  await swipe(195, 830, 760); b = await bars(); check(!b.hidden && b.tab !== 'none' && b.parts !== 'none', 'a swipe up from the bottom centre brings them back');
  check((await page.evaluate(() => isAnythingPlaying())) === playedBefore, 'and the swipe did not press what it lifted over');
  for (const y of [0, 30, 80, 140, 220, 300]) await scrollTo(y); await page.waitForTimeout(600);
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(300);
  b = await bars(); check(!b.hidden && b.tab !== 'none', 'leaving Live puts them back');

  // 3. Drums: Kit | Aux above the grid.
  await page.evaluate(() => { switchTab('accomp'); setAccompMode('drums'); }); await page.waitForTimeout(400);
  const ord = await page.evaluate(() => { const t = s => document.querySelector(s).getBoundingClientRect().top; return [t('#sq-layerRow'), t('#sq-gScroll')]; });
  check(ord[0] < ord[1], 'Kit | Aux is above the drum grid', ord.map(Math.round).join('<'));

  // 4. A part switched on with nothing in it is heard.
  await page.evaluate(() => { localStorage.clear(); }); await boot();
  const heard = () => page.evaluate(() => ({ playing: isAnythingPlaying(), bl: blEnabled, notes: window._blHasNotes() }));
  await page.evaluate(() => { document.getElementById('ft-bas-btn').click(); }); await page.waitForTimeout(600);
  let h = await heard(); check(h.bl && h.notes && h.playing, 'Bass on over nothing: the starter is written and the band is running', JSON.stringify(h));
  await page.evaluate(() => { stopEverything(); }); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('ft-bas-btn').click(); document.getElementById('ft-bas-btn').click(); }); await page.waitForTimeout(500);
  h = await heard(); check(h.bl && h.notes && !h.playing, 'Bass switched off and on again, its line kept: nothing starts', JSON.stringify(h));
  await page.evaluate(() => { document.getElementById('ft-bas-btn').click(); document.getElementById('ft-drum-btn').click(); }); await page.waitForTimeout(600);
  h = await heard(); check(h.playing, 'Drums on over an empty kit starts the band', JSON.stringify(h));
  await page.evaluate(() => { stopEverything(); document.getElementById('ft-mel-btn').click(); }); await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ playing: isAnythingPlaying(), ml: mlEnabled, notes: window._mlHasNotes() }));
  check(m.ml && m.notes && m.playing, 'Melody on over nothing: the starter is written and the band is running', JSON.stringify(m));

  check(errs.length === 0, 'no script errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
