/* The part switches in Studio (6.6): a tap switches the part, a hold or a slide opens its page; and a tap that will
   not sound yet says it was heard (tapWait).

   Driven on the real window with real touch (CDP Input.dispatchTouchEvent; touchEnd takes the points that ENDED):
     - in Studio, on a page that is not Bass's, a tap on Bass switches Bass and does not change the page (in 6.0 - 6.5
       it opened the page and a second tap switched it);
     - a hold on Bass (past the hold time) opens the Bass page, does not switch Bass, and the release is not a tap;
     - a slide along the row from Drums to Arp opens each page it passes, ends on Arp, and switches nothing;
     - a hold on the switch of the page you are already on is a slow tap: it switches the part;
     - a tap right after a hold or a slide still switches (the swallow is a short window, not a flag left standing);
     - in Live nothing opens: a hold is a slow tap there;
     - tapWait: Bass switched on mid-song joins on the drums' bar line and, while it waits, wears .tap-wait and reads
       as off; it lights, with the flash, when it lands; switching it off while it waits ends the wait; Stop ends it;
       a wait under 0.3 s draws nothing.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/partrow/probe.js
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
    await page.evaluate(() => { setModTier('pro'); setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(500);
  };
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await boot();
  const cdp = await ctx.newCDPSession(page);
  const centre = (id) => page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (id) => { const c = await centre(id); await touch('touchStart', [c]); await touch('touchEnd', []); await page.waitForTimeout(120); };
  const hold = async (id, ms) => { const c = await centre(id); await touch('touchStart', [c]); await page.waitForTimeout(ms); await touch('touchEnd', []); await page.waitForTimeout(150); };
  const slide = async (from, to) => {
    const a = await centre(from), b = await centre(to), n = 14;
    await touch('touchStart', [a]);
    for (let i = 1; i <= n; i++) { await touch('touchMove', [{ x: a.x + (b.x - a.x) * i / n, y: a.y }]); await page.waitForTimeout(25); }
    await touch('touchEnd', []); await page.waitForTimeout(250);
  };
  const state = () => page.evaluate(() => ({ page: _activePageId(), sel: studioPartSel(), bass: blEnabled, mel: mlEnabled, arp: arpOn, drums: drumsEnabled, chords: chordsEnabled }));

  // Begin on Chords' page, Bass off.
  const s0 = await state();
  check(s0.page === 'perform' && s0.sel === 'chords' && !s0.bass, 'start: Studio, Chords page, Bass off', JSON.stringify(s0));

  // 1. A tap switches; the page stays.
  await tap('ft-bas-btn');
  let s = await state();
  check(s.bass === true && s.page === 'perform' && s.sel === 'chords', 'tap on Bass: Bass on, still on the Chords page', JSON.stringify(s));
  await tap('ft-bas-btn');
  s = await state();
  check(s.bass === false && s.sel === 'chords', 'second tap: Bass off again', JSON.stringify(s));

  // 2. A hold opens the page and does not switch.
  await hold('ft-bas-btn', 700);
  s = await state();
  check(s.sel === 'bass' && s.page === 'accomp', 'hold on Bass: its page is open', JSON.stringify(s));
  check(s.bass === false, 'the hold did not switch Bass, and nor did its release', JSON.stringify(s));

  // 3. A tap straight after still switches (the swallow is a window, not a flag).
  await page.waitForTimeout(600);
  await tap('ft-mel-btn');
  s = await state();
  check(s.mel === true && s.sel === 'bass', 'tap on Mel after the hold: Mel on, page unchanged', JSON.stringify(s));
  await tap('ft-mel-btn');

  // 4. A hold on the page you are on is a slow tap.
  await hold('ft-bas-btn', 700);
  s = await state();
  check(s.bass === true && s.sel === 'bass', 'hold on the open page\'s own switch: it switches (slow tap)', JSON.stringify(s));
  await tap('ft-bas-btn');

  // 5. A slide from Drums to Arp opens each page on the way and switches nothing.
  await page.evaluate(() => { switchTab('perform'); setPerformMode('chords'); partSelSync(); });
  const seen = [];
  await page.evaluate(() => { window.__seen = []; const o = partOpen; window.partOpen = function (p) { window.__seen.push(p); return o(p); }; });
  const before = await state();
  await slide('ft-drum-btn', 'ft-arp-btn');
  s = await state();
  const passed = await page.evaluate(() => window.__seen.join('>'));
  check(s.sel === 'arp', 'slide Drums to Arp: ends on the Arp page', JSON.stringify(s));
  check(passed.indexOf('drums') === 0 && /bass/.test(passed) && /mel/.test(passed) && /arp$/.test(passed), 'the slide opened the pages it passed, in order', passed);
  check(s.drums === before.drums && s.bass === before.bass && s.mel === before.mel && s.arp === before.arp, 'a slide switches nothing', JSON.stringify([before.drums, s.drums, before.arp, s.arp]));
  await tap('ft-arp-btn'); s = await state();
  check(s.arp !== before.arp, 'a tap right after a slide switches', JSON.stringify(s));
  await tap('ft-arp-btn');

  // 6. Live: nothing opens, a hold is a slow tap.
  await page.evaluate(() => setViewMode('basic')); await page.waitForTimeout(400);
  await hold('ft-bas-btn', 700);
  s = await state();
  check(s.bass === true && s.page === 'perform', 'Live: a hold on Bass switches it and opens nothing', JSON.stringify(s));
  await tap('ft-bas-btn');
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); setPerformMode('chords'); }); await page.waitForTimeout(400);

  // 7. tapWait. Run a band, then bring Bass in; it joins on the next bar line.
  await page.evaluate(() => { document.getElementById('bpm').value = 60; });   // a bar is four seconds: room to look
  await page.evaluate(() => { if (!drumsEnabled) ftDrumClick(); });
  await page.evaluate(() => startEverything()); await page.waitForTimeout(1800);
  await tap('ft-bas-btn');
  await page.waitForTimeout(150);
  const w = await page.evaluate(() => {
    const b = document.getElementById('ft-bas-btn'), cs = getComputedStyle(b);
    return { waiting: b.classList.contains('tap-wait'), on: blEnabled, dash: cs.borderTopStyle, dur: b.style.getPropertyValue('--wait'),
      bg: cs.backgroundColor, offBg: getComputedStyle(document.getElementById('ft-aux-btn') || document.getElementById('ft-arp-btn')).backgroundColor };
  });
  check(w.on && w.waiting, 'Bass tapped on mid-song: it wears .tap-wait while it waits for the bar line', JSON.stringify(w));
  check(parseFloat(w.dur) > 0.3 && parseFloat(w.dur) < 4.5, 'the wait is the time to the bar line, from the engine', w.dur);
  check(w.dash === 'dashed', 'drawn with a dashed edge', w.dash);
  check(w.bg === w.offBg, 'and drawn as OFF while it waits (same fill as an off switch)', w.bg + ' vs ' + w.offBg);
  // Shot for the eye.
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/wait.png' : '/tmp/partrow-wait.png', clip: { x: 0, y: 620, width: 390, height: 224 } });
  const waitSec = parseFloat(w.dur);
  await page.waitForTimeout(Math.max(0, waitSec * 1000 - 150 + 250));
  const landed = await page.evaluate(() => { const b = document.getElementById('ft-bas-btn'); return { waiting: b.classList.contains('tap-wait'), flash: b.classList.contains('gen-landed'), playing: _blPlaying && window._blPlaying && window._blPlaying() }; });
  check(!landed.waiting && landed.flash, 'when it lands the wait is gone and the switch flashes', JSON.stringify(landed));

  // Switched off while waiting.
  await tap('ft-bas-btn');               // off
  await page.waitForTimeout(200);
  await tap('ft-bas-btn');               // on again: a new wait
  await page.waitForTimeout(150);
  const w2 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('tap-wait'));
  await tap('ft-bas-btn');               // off while waiting
  await page.waitForTimeout(150);
  const w3 = await page.evaluate(() => ({ w: document.getElementById('ft-bas-btn').classList.contains('tap-wait'), on: blEnabled }));
  check(w2 && !w3.w && !w3.on, 'switched off while it waits: the wait ends and it is off', JSON.stringify([w2, w3]));

  // Stop ends a wait.
  await tap('ft-mel-btn'); await page.waitForTimeout(150);
  const w4 = await page.evaluate(() => document.getElementById('ft-mel-btn').classList.contains('tap-wait'));
  await page.evaluate(() => stopEverything()); await page.waitForTimeout(300);
  const w5 = await page.evaluate(() => document.querySelectorAll('.tap-wait').length);
  check(w4 && w5 === 0, 'Stop ends every wait', JSON.stringify([w4, w5]));

  // Under 0.3 s draws nothing.
  const none = await page.evaluate(() => { const b = document.getElementById('ft-chd-btn'); tapWait(b, 0.2); return b.classList.contains('tap-wait'); });
  check(none === false, 'a wait under 0.3 s draws nothing', none);

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
