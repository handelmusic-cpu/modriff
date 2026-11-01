/* The tab bar and what hangs off it (5.3): Live | Studio | Song | Sound | caret.

   Driven on the real window in an emulated phone with real touch (CDP), because the
   things worth holding here are about where a finger goes:
     - four tabs and a caret, 52 pt, an icon and a word each, no Settings, Accomp or
       Play tab, and the old handle band and Live / Studio switch gone from the transport;
     - Live and Studio are views of one page: the lit tab follows the view whichever
       way it was changed (tap, the L key, Find reaching for Accomp);
     - in Studio the part switches pick a part's page, a second tap on the one you are
       on toggles it, and from Song or Sound or in Live they are still plain switches;
     - the caret opens the sheet, Settings is the sheet's first row, it opens a full
       screen, and Done goes back to where it was opened from;
     - at every phone width the five slots fit.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tabs/probe.js
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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { setModTier('pro'); });

  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const st = () => page.evaluate(() => ({
    lit: [...document.querySelectorAll('.tab-btn.active')].map(b => b.id.replace('tab-', '')).join(),
    page: (document.querySelector('.tab-page.active') || {}).id,
    basic: document.body.classList.contains('mode-basic'),
    sel: [...document.querySelectorAll('.ft-parts .ft-btn.sel')].map(b => b.id.replace(/^ft-|-btn$/g, '')).join(),
    acc: typeof accompMode !== 'undefined' ? accompMode : null,
    perf: typeof performMode !== 'undefined' ? performMode : null,
    sheet: document.getElementById('ft-more-menu').classList.contains('open'),
  }));

  // ── 1. The bar itself.
  const bar = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#tab-bar .tab-btn')].map(b => ({ id: b.id, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width), ico: !!b.querySelector('svg.ico'), t: b.textContent.trim() }));
    const m = document.getElementById('tab-more').getBoundingClientRect();
    return { tabs, more: [Math.round(m.width), Math.round(m.height)], grip: !!document.getElementById('ft-drawer-grip'), band: !!document.querySelector('.ft-vmt-band'),
             oldTabs: ['tab-build', 'tab-accomp', 'tab-perform'].filter(i => document.getElementById(i)),
             sheetView: !!document.querySelector('#ft-more-menu #vmt-basic, #ft-more-menu #vmt-adv'),
             padTop: parseFloat(getComputedStyle(document.getElementById('perf-bar')).paddingTop), perfH: Math.round(document.getElementById('perf-bar').getBoundingClientRect().height) };
  });
  check(bar.tabs.map(t => t.t).join() === 'Live,Studio,Song,Sound', 'four tabs: Live, Studio, Song, Sound', bar.tabs.map(t => t.t).join());
  check(bar.tabs.every(t => t.h >= 50 && t.ico), 'each is 50 pt or more (as the mock has them) and has an icon', JSON.stringify(bar.tabs.map(t => [t.h, t.ico])));
  check(bar.more[0] >= 50 && bar.more[1] >= 50, 'the caret is a 58 x 50 target', bar.more.join('x'));
  check(bar.oldTabs.length === 0, 'no Settings, Accomp or Play tab', bar.oldTabs.join());
  check(!bar.grip && !bar.band && !bar.sheetView, 'the handle band and the Live / Studio switch are gone from the transport and the sheet');
  check(bar.padTop <= 10, 'the transport has no band above it', bar.padTop + ' pt padding, bar ' + bar.perfH + ' pt');

  // ── 2. Live and Studio, by finger.
  let s = await st();
  check(s.lit === 'live' && s.basic && s.page === 'page-perform', 'starts on Live', JSON.stringify(s));
  await tap('#tab-studio'); s = await st();
  check(s.lit === 'studio' && !s.basic && s.page === 'page-perform', 'Studio tab: Studio view of Play, Studio lit', JSON.stringify(s));
  await tap('#tab-live'); s = await st();
  check(s.lit === 'live' && s.basic, 'Live tab goes back', JSON.stringify(s));

  // ── 3. The part switches in Live are switches.
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  const bass0 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
  await tap('#ft-bas-btn'); s = await st();
  const bass1 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
  check(bass0 !== bass1 && s.page === 'page-perform' && s.sel === '', 'Live: Bass toggles and goes nowhere', bass0 + '->' + bass1 + ' ' + s.page);

  // ── 4. In Studio they pick a page.
  await tap('#tab-studio');
  const d0 = await page.evaluate(() => drumsEnabled);
  await tap('#ft-drum-btn'); s = await st();
  const d1 = await page.evaluate(() => drumsEnabled);
  check(s.page === 'page-accomp' && s.acc === 'drums' && s.sel === 'drum' && s.lit === 'studio', 'Studio: Drums opens the Drums page, Studio stays lit, Drums is ringed', JSON.stringify(s));
  check(d0 === d1, 'and the first tap did not switch the drums on or off', d0 + '->' + d1);
  await tap('#ft-drum-btn');
  const d2 = await page.evaluate(() => drumsEnabled);
  check(d2 !== d1, 'a second tap on the part you are on does', d1 + '->' + d2);
  await tap('#ft-bas-btn'); s = await st();
  check(s.page === 'page-accomp' && s.acc === 'bass' && s.sel === 'bas', 'Bass opens the Bass page', JSON.stringify(s));
  await tap('#ft-mel-btn'); s = await st();
  check(s.acc === 'melody' && s.sel === 'mel', 'Mel opens the Melody sequencer page', JSON.stringify(s));
  await tap('#ft-arp-btn'); s = await st();
  check(s.acc === 'arp' && s.sel === 'arp', 'Arp opens the Arp page', JSON.stringify(s));
  await tap('#ft-chd-btn'); s = await st();
  check(s.page === 'page-perform' && s.perf === 'chords' && s.sel === 'chd' && s.lit === 'studio', 'Chords opens the Chords surface on Play', JSON.stringify(s));
  const subnavHidden = await page.evaluate(() => { const e = document.getElementById('bm-subnav'); return !e || e.hidden || e.getBoundingClientRect().height === 0; });
  await tap('#ft-bas-btn');
  check(subnavHidden && await page.evaluate(() => { const e = document.getElementById('bm-subnav'); return !e || e.hidden || e.getBoundingClientRect().height === 0; }), 'Accomp has no sub-nav of its own any more');

  // ── 5. Studio, but on Song: the row is five switches again.
  await tap('#tab-songs');
  const b2 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
  await tap('#ft-bas-btn'); s = await st();
  const b3 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
  check(s.page === 'page-songs' && b2 !== b3 && s.sel === '', 'on Song, Bass toggles and does not navigate', s.page + ' ' + b2 + '->' + b3);

  // ── 6. The caret, Settings and Done.
  await tap('#tab-more'); s = await st();
  const sheet = await page.evaluate(() => ({ exp: document.getElementById('tab-more').getAttribute('aria-expanded'),
    first: (document.querySelector('#ft-more-menu .ft-sheet-row:not(:empty) .ft-btn') || {}).id }));
  check(s.sheet && sheet.exp === 'true' && sheet.first === 'ft-settings-btn', 'the caret opens the sheet and Settings is its first row', JSON.stringify(sheet));
  await tap('#ft-settings-btn'); s = await st();
  check(s.page === 'page-build' && s.lit === '' && !s.sheet, 'Settings opens full screen with no tab lit and the sheet closed', JSON.stringify(s));
  const done = await page.evaluate(() => { const d = document.querySelector('.set-done'); const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; });
  check(done[1] >= 44 && done[2] < 120, 'a Done button is in view, 44 pt', done.join('x@'));
  await tap('.set-done'); s = await st();
  check(s.page === 'page-songs' && s.lit === 'songs', 'Done goes back to Song, where it was opened from', JSON.stringify(s));

  // ── 7. Other ways in keep the tab honest.
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  await page.evaluate(() => { switchTab('accomp'); }); s = await st();
  check(s.page === 'page-accomp' && !s.basic && s.lit === 'studio', 'asking for Accomp from Live (Find, a tutorial) puts the app in Studio', JSON.stringify(s));
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('Alt+KeyL'); await page.waitForTimeout(300); s = await st();
  check(s.basic && s.page === 'page-perform' && s.lit === 'live', 'Option+L from Accomp lands on Live', JSON.stringify(s));
  await page.keyboard.press('Alt+KeyL'); await page.waitForTimeout(300); s = await st();
  check(!s.basic && s.lit === 'studio', 'and again is Studio', JSON.stringify(s));
  for (const [k, want] of [['Digit1', 'live'], ['Digit2', 'studio'], ['Digit3', 'songs'], ['Digit4', 'mix']]) {
    await page.keyboard.press('Alt+' + k); await page.waitForTimeout(250); s = await st();
    check(s.lit === want, 'Option+' + k.slice(-1) + ' is ' + want, JSON.stringify(s.lit));
  }
  await page.keyboard.press('Alt+Digit5'); await page.waitForTimeout(250); s = await st();
  check(s.page === 'page-build', 'Option+5 is Settings', s.page);
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
  await page.focus('#tab-live');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); s = await st();
  check(s.lit === 'studio', 'arrow keys move along the tabs', JSON.stringify(s));

  // ── 8. Every width.
  for (const W of [360, 375, 390, 393, 402, 430, 440]) {
    await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#tab-bar .tab-btn, #tab-more')].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.width]; });
      const clipped = [...document.querySelectorAll('#tab-bar .tab-btn')].filter(b => { const sp = b.querySelector('span'); return sp && sp.scrollWidth > b.clientWidth + 1; }).length;
      return { l: Math.min(...tabs.map(t => t[0])), r: Math.max(...tabs.map(t => t[1])), n: tabs.length, minW: Math.min(...tabs.map(t => t[2])), clipped, docW: document.documentElement.scrollWidth, innerW: innerWidth };
    });
    check(r.n === 5 && r.l >= 0 && r.r <= W + 0.5 && r.docW <= W && r.clipped === 0, W + ' pt: five slots fit, nothing clipped, page not wider', JSON.stringify(r));
  }

  // ── 9. A phone on its side, with the island at one edge: nothing under the insets.
  {
    const ctx2 = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true });
    const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push(String(e)));
    await p2.goto(URL); await p2.evaluate(() => { localStorage.clear(); }); await p2.reload(); await p2.waitForTimeout(1500);
    await p2.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await p2.waitForTimeout(800);
    const c2 = await ctx2.newCDPSession(p2);
    await c2.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 59, bottom: 21, right: 59 } });
    await p2.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); }); await p2.waitForTimeout(600);
    const r = await p2.evaluate(() => {
      const box = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
      const parts = ['#ft-drum-btn', '#ft-bas-btn', '#ft-mel-btn', '#ft-arp-btn', '#ft-chd-btn'].map(box);
      return { tabL: box('#tab-live'), more: box('#tab-more'), key: box('.ft-key'), parts, arpW: parts[3][1] - parts[3][0], page: box('#page-perform'), docW: document.documentElement.scrollWidth,
               tabsFull: box('#tab-bar') };
    });
    const lo = 59, hi = 852 - 59;
    check(r.tabL[0] >= lo && r.more[1] <= hi, 'landscape: the tabs and the caret sit between the insets', JSON.stringify([r.tabL, r.more]));
    check(r.key[0] >= lo && Math.max(...r.parts.map(x => x[1])) <= hi && Math.min(...r.parts.map(x => x[0])) >= lo, 'landscape: the key and the part switches sit between the insets', JSON.stringify([r.key, r.parts]));
    check(r.page[0] >= lo && r.page[1] <= hi, 'landscape: the page does too', JSON.stringify(r.page));
    check(r.arpW <= 150, 'landscape: Arp is a switch the size of the others, not the width of the bar', r.arpW + ' pt');
    check(r.tabsFull[1] - r.tabsFull[0] > 600, 'landscape: the tab bar spans the width (an empty sub-tab dock takes none)', JSON.stringify(r.tabsFull));
    check(r.docW <= 852, 'landscape: the page is no wider than the phone', r.docW);
    await ctx2.close();
  }

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
