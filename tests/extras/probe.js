/* Extras on and off, per Live widget (5.5): the widget's title is the switch.

   Driven on the real window with real touch (CDP):
     - Chords and Melody have a title button (44 pt, a caret, aria-expanded) and start
       open, so nothing moves for anyone who does not touch it;
     - closing Chords hides the rhythm bar, the More row and its chip and leaves the seven
       pads; closing Melody hides the Keys / Strip, octave, Hold, Glide and Touch Mod row
       and leaves the keys;
     - the choice is kept across a reload (modo-live-xoff) and is per widget;
     - the sheet's two eye buttons turn every widget's extras off and on, the Sampler
       and mõdFX included, and close the sheet;
     - three widgets at once: Chords, Melody and mõdFX with their extras off end above
       the transport on a 430 x 932 phone, and with them on they do not;
     - Studio is untouched: no title buttons, every control where it was.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/extras/probe.js
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
  const boot = async () => {
    await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); });
    await page.waitForTimeout(500);
  };
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); });
  await boot();
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const shown = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }, sel);
  const state = async () => ({
    chordsT: await page.evaluate(() => { const b = document.querySelector('.lv-xt[data-mod="chords"]'); return b && { exp: b.getAttribute('aria-expanded'), h: Math.round(b.getBoundingClientRect().height), t: b.textContent.trim() }; }),
    melT: await page.evaluate(() => { const b = document.querySelector('.lv-xt[data-mod="melody"]'); return b && { exp: b.getAttribute('aria-expanded'), h: Math.round(b.getBoundingClientRect().height), t: b.textContent.trim() }; }),
    cr: await shown('#cr-bar'), more: await shown('#chords-borrowed'), chip: await shown('#pf-more-chip'),
    diatonic: await page.evaluate(() => [...document.getElementById('chords-diatonic').children].filter(c => c.getBoundingClientRect().height > 0).length),
    melRow: await shown('.mel-ctl-row'), melRow2: await shown('.mel-row2'), keys: await shown('#mel-keys-wrap, .mel-keys, #melody-strip, .mel-btn'),
    stored: await page.evaluate(() => localStorage.getItem('modo-live-xoff')),
  });

  // ── 1. The default is open, and the title is the button.
  let s = await state();
  check(s.chordsT && s.chordsT.exp === 'true' && s.chordsT.h >= 44 && s.chordsT.t === 'Chords', 'Chords has a 44 pt title button, open', JSON.stringify(s.chordsT));
  check(s.melT && s.melT.exp === 'true' && s.melT.h >= 44 && s.melT.t === 'Melody', 'Melody has one too', JSON.stringify(s.melT));
  check(s.cr && s.more && s.chip && s.melRow, 'and everything is where it was', JSON.stringify([s.cr, s.more, s.chip, s.melRow]));

  // ── 2. Close Chords.
  await tap('.lv-xt[data-mod="chords"]'); s = await state();
  check(s.chordsT.exp === 'false' && !s.cr && !s.more && !s.chip, 'Chords closed: the rhythm bar, the More row and its chip are gone', JSON.stringify([s.cr, s.more, s.chip]));
  check(s.diatonic >= 7, 'the seven pads stay', s.diatonic);
  check(s.melRow && s.melT.exp === 'true', 'Melody is untouched', JSON.stringify([s.melRow, s.melT.exp]));
  // ── 3. Close Melody.
  await tap('.lv-xt[data-mod="melody"]'); s = await state();
  check(s.melT.exp === 'false' && !s.melRow && !s.melRow2, 'Melody closed: the control rows are gone', JSON.stringify([s.melRow, s.melRow2]));
  const keys = await page.evaluate(() => { const k = document.querySelector('#lv-slots .lv-slot[data-mod="melody"] #melody-strip, #lv-slots .lv-slot[data-mod="melody"] .mel-keys, #lv-slots .lv-slot[data-mod="melody"] .mel-btn'); if (!k) return null; const r = k.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  check(keys && keys[0] > 40 && keys[1] > 40, 'and the keys stay', JSON.stringify(keys));
  check(JSON.parse(s.stored).chords === true && JSON.parse(s.stored).melody === true, 'kept in modo-live-xoff', s.stored);

  // ── 4. Kept across a reload.
  await boot(); s = await state();
  check(s.chordsT.exp === 'false' && s.melT.exp === 'false' && !s.cr && !s.melRow, 'a reload keeps both closed', JSON.stringify([s.chordsT.exp, s.melT.exp]));
  await tap('.lv-xt[data-mod="chords"]'); s = await state();
  check(s.chordsT.exp === 'true' && s.cr && s.more && !s.melRow, 'opening Chords alone leaves Melody closed', JSON.stringify([s.cr, s.more, s.melRow]));

  // ── 5. Three at once.
  await page.evaluate(() => { lvSet(['chords', 'melody', 'fx']); chordMoreSet('off'); });
  await page.waitForTimeout(500);
  const heights = async () => page.evaluate(() => {
    window.scrollTo(0, 0);
    const slots = [...document.querySelectorAll('#lv-slots .lv-slot')].map(s => s.dataset.mod);
    const last = document.querySelector('#lv-slots .lv-slot[data-mod="fx"]'); const r = last.getBoundingClientRect();
    const bar = document.getElementById('top-stack').getBoundingClientRect();
    return { slots: slots.join(), bottom: Math.round(r.bottom + scrollY), barTop: Math.round(bar.top), win: innerHeight };
  });
  await tap('#tab-more');
  await tap('.ft-extras-btn:nth-of-type(2)');          // hide all
  const sheetShut = await page.evaluate(() => !document.getElementById('ft-more-menu').classList.contains('open'));
  s = await state();
  check(sheetShut, 'the eye button closes the sheet after it');
  check(s.chordsT.exp === 'false' && s.melT.exp === 'false', 'hide all: Chords and Melody closed', JSON.stringify([s.chordsT.exp, s.melT.exp]));
  const fxOpen = await page.evaluate(() => !document.querySelector('.lv-slot[data-mod="fx"]').classList.contains('lv-folded'));
  check(!fxOpen, 'and mõdFX folded to its pad');
  let h = await heights();
  check(h.slots === 'chords,melody,fx' && h.bottom <= h.barTop, 'three widgets, extras off: the whole stack ends above the bars', JSON.stringify(h));
  await tap('#tab-more');
  await tap('.ft-extras-btn:nth-of-type(1)');          // show all
  s = await state();
  const fxOpen2 = await page.evaluate(() => !document.querySelector('.lv-slot[data-mod="fx"]').classList.contains('lv-folded'));
  check(s.chordsT.exp === 'true' && s.melT.exp === 'true' && fxOpen2, 'show all: everything open again', JSON.stringify([s.chordsT.exp, s.melT.exp, fxOpen2]));
  h = await heights();
  check(h.bottom > h.barTop, 'with their extras on, the same three do not fit', JSON.stringify(h));

  // ── 6. Studio is untouched.
  await page.evaluate(() => { lvSet(LV_STD); setViewMode('advanced'); switchTab('perform'); setPerformMode('chords'); }); await page.waitForTimeout(400);
  check(!(await shown('.lv-xt')), 'Studio shows no title button');
  check(await shown('#cr-bar') && await shown('#chords-borrowed'), 'and the rhythm bar and the shelves are where they were');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
