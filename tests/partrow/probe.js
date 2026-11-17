/* The part switches (1.2): the bottom row only switches parts on and off, on Live and on Studio alike; the Studio strip picks the page.
   Before 1.2 a hold or a slide along this row opened a part's page (6.6); those gestures are gone and this test pins that they stay
   gone. Also kept from 6.6: a tap that will not sound yet says it was heard (tapWait).

   Driven on the real window with real touch (CDP Input.dispatchTouchEvent; touchEnd takes the points that ENDED):
     - in Studio, a tap on Bass switches Bass and does not change the page;
     - a hold on Bass (past the old hold time) opens nothing;
     - a slide along the row switches nothing and opens nothing;
     - the strip opens each page, marks the one showing, and its dots follow the switches;
     - in Live a tap switches, a hold opens nothing, and no strip is drawn;
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
  const state = () => page.evaluate(() => ({ page: _activePageId(), sel: studioSel(), bass: blEnabled, mel: mlEnabled, arp: arpOn, drums: drumsEnabled, chords: chordsEnabled }));

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

  // 2. A hold opens nothing. (Whether the browser turns a long press into a click is the engine's business: Chromium's touch
  // emulation sends a contextmenu instead, WebKit a click. Either way no page opens, and the state is put back after.)
  await hold('ft-bas-btn', 700);
  s = await state();
  check(s.sel === 'chords' && s.page === 'perform', 'hold on Bass: no page opens', JSON.stringify(s));
  await page.evaluate(() => { if (blEnabled) ftBassClick(); }); await page.waitForTimeout(200);

  // 3. A slide along the row does nothing.
  const before = await state();
  await slide('ft-drum-btn', 'ft-arp-btn');
  s = await state();
  check(s.sel === 'chords' && s.page === 'perform', 'slide Drums to Arp: no page opens', JSON.stringify(s));
  check(s.drums === before.drums && s.bass === before.bass && s.mel === before.mel && s.arp === before.arp, 'a slide switches nothing', JSON.stringify([before.drums, s.drums, before.arp, s.arp]));
  const gone = await page.evaluate(() => ({ wire: typeof wirePartRow, hold: typeof partHoldWire, hint: typeof _partHintOnce, holding: document.querySelectorAll('.ft-btn.holding,.ft-btn.scrub').length }));
  check(gone.wire === 'undefined' && gone.hold === 'undefined' && gone.hint === 'undefined' && gone.holding === 0, 'the hold and slide code is gone', JSON.stringify(gone));

  // 4. The strip picks the page; its dots follow the switches.
  const strip = await page.evaluate(() => { const el = document.getElementById('studio-strip'); return el ? [].slice.call(el.querySelectorAll('.ss-chip')).map(b => b.dataset.page) : null; });
  check(strip && strip.join(',') === 'Drums,Bass,Melody,Mel Seq,Arp,Chords,Sampler,mõdFX', 'the strip lists the eight pages in order', JSON.stringify(strip));
  const want = { 'Drums': ['accomp', 'drums'], 'Bass': ['accomp', 'bass'], 'Melody': ['perform', 'melody'], 'Mel Seq': ['accomp', 'melseq'], 'Arp': ['accomp', 'arp'], 'Chords': ['perform', 'chords'], 'Sampler': ['perform', 'smp'], 'mõdFX': ['perform', 'fx'] };
  for (const name of Object.keys(want)) {
    const k = await page.evaluate(n => [].slice.call(document.querySelectorAll('#studio-strip .ss-chip')).filter(b => b.dataset.page === n)[0].dataset.k, name);
    const c = await centre('ss-' + k); await touch('touchStart', [c]); await touch('touchEnd', []); await page.waitForTimeout(350);
    s = await state();
    const on = await page.evaluate(() => [].slice.call(document.querySelectorAll('#studio-strip .ss-chip.on')).map(b => b.dataset.page).join());
    check(s.page === want[name][0] && s.sel === want[name][1] && on === name, 'strip: ' + name + ' opens its page and is the one marked', JSON.stringify({ page: s.page, sel: s.sel, on }));
  }
  await page.evaluate(() => studioShow('bass')); await page.waitForTimeout(250);
  let dot = await page.evaluate(() => document.getElementById('ss-bass').classList.contains('part-on'));
  check(dot === false, 'Bass off: its chip has no dot');
  await tap('ft-bas-btn');
  dot = await page.evaluate(() => document.getElementById('ss-bass').classList.contains('part-on'));
  check(dot === true, 'Bass switched on: its chip shows the dot', String(dot));
  await tap('ft-bas-btn');
  const mel = await page.evaluate(() => ({ melody: document.getElementById('ss-melody').classList.contains('part-on'), fx: document.getElementById('ss-fx').classList.contains('part-on') }));
  check(!mel.melody && !mel.fx, 'Melody and mõdFX are not switched in the band, so their chips never carry a dot', JSON.stringify(mel));
  const cyc = await page.evaluate(() => { studioShow('chords'); const r = []; for (let i = 0; i < 8; i++) { tabTap('studio'); r.push(studioSel()); } return r.join('>'); });
  check(cyc === 'smp>fx>drums>bass>melody>melseq>arp>chords' || cyc === 'smp>drums>bass>melody>melseq>arp>chords>smp', 'a second tap on the Studio tab steps the strip, and wraps', cyc);

  // 5. Live: a tap switches, a hold is a slow tap, and no strip is drawn.
  await page.evaluate(() => setViewMode('basic')); await page.waitForTimeout(400);
  const shown = await page.evaluate(() => { const e = document.getElementById('studio-strip'); return e ? getComputedStyle(e).display : 'none'; });
  check(shown === 'none', 'Live: the Studio strip is not drawn', shown);
  await hold('ft-bas-btn', 700);
  s = await state();
  check(s.page === 'perform' && s.sel === 'chords', 'Live: a hold on Bass opens nothing', JSON.stringify(s));
  await page.evaluate(() => { if (blEnabled) ftBassClick(); }); await page.waitForTimeout(200);
  await tap('ft-bas-btn'); s = await state();
  check(s.bass === true, 'Live: a tap on Bass switches it', JSON.stringify(s));
  await tap('ft-bas-btn');
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); setPerformMode('chords'); }); await page.waitForTimeout(400);

  // 7. tapWait. Run a band, then bring Bass in; it joins on the next bar line.
  await page.evaluate(() => { document.getElementById('bpm').value = 60; });   // a bar is four seconds: room to look
  await page.evaluate(() => { if (!drumsEnabled) ftDrumClick(); });
  await page.evaluate(() => startEverything()); await page.waitForTimeout(1800);
  // The flash lasts half a second and a screenshot in the middle of this can eat it, so it is recorded, not sampled.
  await page.evaluate(() => { window.__flash = false; const b = document.getElementById('ft-bas-btn');
    new MutationObserver(() => { if (b.classList.contains('gen-landed')) window.__flash = true; }).observe(b, { attributes: true, attributeFilter: ['class'] }); });
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
  const landed = await page.evaluate(() => { const b = document.getElementById('ft-bas-btn'); return { waiting: b.classList.contains('tap-wait'), flash: window.__flash, playing: _blPlaying && window._blPlaying && window._blPlaying() }; });
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
