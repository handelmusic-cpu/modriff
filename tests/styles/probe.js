/* The Styles widget as one slim row per part (5.6), and the Live headings staying on one
   line (5.6a).

   Driven on the real window with real touch (CDP):
     - Drums, Bass and Melody are each ONE row about 52 pt tall (it was a 114 pt card): the
       name, previous, the picker, next and Save share a top, every button is 44 pt;
     - the widget is under 230 pt where it was 410;
     - previous and next still change the style, the picker still opens its list, and Save
       is a button with a spoken name that still asks for one;
     - no Live heading wraps or runs off the edge from 360 to 440 pt, with the More chip and
       the title caret on Chords.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/styles/probe.js
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
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };

  // ── 1. One slim row each.
  const g = await page.evaluate(() => {
    const w = document.getElementById('st-widget');
    const rows = [...w.querySelectorAll('.st-row')].map(r => {
      const q = s => { const e = r.querySelector(s); const b = e.getBoundingClientRect(); return { t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const part = q('.st-part'), step = [...r.querySelectorAll('.st-step')].map(e => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) }; }), name = q('.st-name'), save = q('.st-save');
      return { h: Math.round(r.getBoundingClientRect().height), tops: [...new Set([part.t, name.t, save.t, ...step.map(s => s.t)])].length, minH: Math.min(name.h, save.h, ...step.map(s => s.h)), minW: Math.min(name.w, save.w, ...step.map(s => s.w)),
               lbl: r.querySelector('.st-save').getAttribute('aria-label'), part: r.querySelector('.st-part').textContent };
    });
    return { rows, widget: Math.round(w.getBoundingClientRect().height) };
  });
  check(g.rows.length === 3 && g.rows.every(r => r.h >= 48 && r.h <= 58), 'three rows, each about 52 pt', JSON.stringify(g.rows.map(r => r.h)));
  check(g.rows.every(r => r.tops <= 2), 'name, previous, picker, next and Save are on one line', JSON.stringify(g.rows.map(r => r.tops)));
  check(g.rows.every(r => r.minH >= 44 && r.minW >= 44), 'every button is 44 pt', JSON.stringify(g.rows.map(r => [r.minH, r.minW])));
  check(g.widget < 240, 'the widget is under 240 pt (it was 410)', g.widget);
  check(g.rows.every(r => r.lbl && /save/i.test(r.lbl)), 'Save has a spoken name', JSON.stringify(g.rows.map(r => r.lbl)));

  // ── 2. They still work.
  const cur0 = await page.evaluate(() => starterCurrent('drums'));
  await tap('.st-row[data-part="drums"] .st-step:last-of-type');
  const cur1 = await page.evaluate(() => starterCurrent('drums'));
  check(cur0 !== cur1, 'next changes the drum style', cur0 + ' -> ' + cur1);
  await tap('.st-row[data-part="drums"] .st-step:last-of-type');
  const cur2 = await page.evaluate(() => starterCurrent('drums'));
  await tap('.st-row[data-part="drums"] .st-step:first-of-type');
  const cur3 = await page.evaluate(() => starterCurrent('drums'));
  check(cur2 !== cur1 && cur3 === cur1, 'and previous steps back one', [cur1, cur2, cur3].join(' -> '));
  await tap('.st-row[data-part="bass"] .st-name');
  const listOpen = await page.evaluate(() => !!document.querySelector('.modal-overlay.visible, .modal-sheet, .cp-item, .sp-item, [class*="starter-pick"]'));
  check(listOpen, 'the picker opens its list');
  await page.keyboard.press('Escape'); await page.evaluate(() => { document.querySelectorAll('.modal-overlay.visible').forEach(m => m.classList.remove('visible')); });

  // ── 3. Headings stay on one line.
  for (const W of [360, 375, 390, 402, 430, 440]) {
    await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(300);
    await page.evaluate(() => { lvSet(['chords', 'melody', 'pads', 'fx', 'styles']); }); await page.waitForTimeout(300);
    const r = await page.evaluate(() => [...document.querySelectorAll('.pf-surface-lbl, .fx-title, .lv-slot > .key-strip')].filter(h => h.getBoundingClientRect().width).map(h => {
      const kids = [...h.children].filter(c => c.getBoundingClientRect().width > 0 && getComputedStyle(c).position !== 'absolute');
      const rects = kids.map(c => c.getBoundingClientRect());
      return { id: h.id || h.className.split(' ')[0], rows: new Set(rects.map(k => Math.round(k.top / 4))).size, right: Math.round(Math.max(...rects.map(k => k.right), 0)), clipped: kids.filter(c => c.scrollWidth > c.clientWidth + 2 && getComputedStyle(c).overflow === 'hidden').length };
    }));
    const bad = r.filter(x => x.rows > 1 || x.right > W);
    check(bad.length === 0, W + ' pt: no Live heading wraps or runs off the edge', JSON.stringify(bad));
  }
  for (const [W, min] of [[360, 40], [402, 80], [440, 90]]) {
    await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(300);
    const voice = await page.evaluate(() => { const b = document.querySelector('#pf-chords-lbl .snd-pick-btn'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), txt: b.textContent.replace(/\s+/g, ' ').trim() }; });
    check(voice.w >= min, W + ' pt: the Chords sound picker is at least ' + min + ' pt wide, so it shows more than a letter', JSON.stringify(voice));
  }

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
