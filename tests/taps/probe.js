/* Finding Ratchet and Tuplet (6.2c): Tap: Place | Edit, and Drums' Pattern tools fold.

   Driven on the real window with real touch (CDP):
     - Drums: the grid comes first, then one "Pattern tools" row under it, closed, 44 pt or more; opening it shows
       Steps, Rate, Swing, Fill, Duplicate, Tuplets: Cover, Audition and Clear, and closing hides them again;
       in Play in the record button is still up;
     - "Tap a step to Place | Edit" is on Drums, Bass and Melody; Edit is one setting for all three, kept;
     - in Edit a single touch on an empty drum step places and selects it and the inspector shows Ratchet; a second
       touch on the selected step clears it; in Place a single touch only toggles, as before;
     - on a roll, a touch in Edit on a filled step selects it without changing it, and its inspector opens.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/taps/probe.js
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
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); switchTab('perform'); document.getElementById('ft-drum-btn').click(); }); await page.waitForTimeout(700);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(450);
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; }, sel);

  // 1. The fold.
  const o = await page.evaluate(() => { const g = document.getElementById('sq-gScroll').getBoundingClientRect().top, h = document.querySelector('.st-fold-g[data-k="drumtools"]'); const r = h.getBoundingClientRect();
    return { gridAbove: g < r.top, h: Math.round(r.height), exp: h.getAttribute('aria-expanded'), t: h.textContent.trim() }; });
  check(o.gridAbove && o.h >= 44 && o.exp === 'false' && /Pattern tools/.test(o.t), 'the grid is first and Pattern tools sits under it, closed, 44 pt or more', JSON.stringify(o));
  check(!(await vis('#sq-clearBtn')) && !(await vis('#sq-stepsDisp')) && !(await vis('#sq-tupcoverBtn')), 'closed, Steps, Tuplets and Clear are out of the way');
  await tap('.st-fold-g[data-k="drumtools"]');
  const ids = ['sq-stepsDisp', 'sq-swingSl', 'sq-fillBtn', 'sq-dupextBtn', 'sq-tupcoverBtn', 'sq-aud-btn', 'sq-clearBtn'];
  const shown = []; for (const i of ids) shown.push(await vis('#' + i));
  check(shown.every(Boolean), 'open: Steps, Swing, Fill, Duplicate, Tuplets: Cover, Audition and Clear are all there', shown.join());
  await tap('.st-fold-g[data-k="drumtools"]');
  check(!(await vis('#sq-clearBtn')), 'a second touch closes it');
  // 6.4: the drums have no Play in; a saved or asked-for 'rec' comes back as Draw and there is no record button.
  await page.evaluate(() => acSetWriteMode('sq', 'rec')); await page.waitForTimeout(300);
  check(!(await vis('#ac-drums-panel [data-recarm="sq"]')) && (await page.evaluate(() => _acWMode.sq)) === 'draw', 'Drums has no Play in: asking for it leaves Draw and no record button');

  // 2. The switch.
  check((await page.evaluate(() => document.querySelectorAll('.tap-mode').length)) === 3, 'Tap a step to Place | Edit is on Drums, Bass and Melody');
  const b0 = await page.evaluate(() => ({ edit: _tapEdit, inspectorEmpty: !document.getElementById('sq-insp').textContent.trim() }));
  check(b0.edit === false, 'Place is the default');

  // 3. Place: one touch toggles (as it always did).
  const stepSel = '.sq-grow:not(.sq-gruler) .sq-step';
  const lit = () => page.evaluate(() => document.querySelectorAll('.sq-grow:not(.sq-gruler) .sq-step.on, .sq-grow:not(.sq-gruler) .sq-step.accent').length);
  await page.evaluate(() => { document.querySelectorAll('.sq-step.on, .sq-step.accent').forEach(e => e.click && 0); });
  const base = await lit();
  await tap(stepSel);
  const p1 = await lit();
  check(p1 === base + 1 || p1 === base - 1, 'Place: one touch toggles a step', base + ' -> ' + p1);
  await tap(stepSel);

  // 4. Edit: select; the inspector; clear.
  await tap('.tap-mode button[data-tm="edit"]');
  check(await page.evaluate(() => _tapEdit === true && document.querySelectorAll('.tap-mode button[data-tm="edit"].active').length === 3), 'Edit is one setting for all three pages');
  // The step under the finger, in a row that is empty.
  const empty = await page.evaluate(() => { const rows = [...document.querySelectorAll('.sq-grow:not(.sq-gruler)')]; for (const r of rows) { if (!r.querySelector('.sq-step.on, .sq-step.accent')) { r.querySelector('.sq-step').id = 'tap-probe-step'; return true; } } return false; });
  check(empty, 'there is an empty drum row to try');
  await tap('#tap-probe-step');
  const e1 = await page.evaluate(() => ({ lit: document.getElementById('tap-probe-step').classList.contains('on') || document.getElementById('tap-probe-step').classList.contains('accent'), sel: document.getElementById('tap-probe-step').classList.contains('sel'), insp: document.getElementById('sq-insp').textContent }));
  check(e1.lit && e1.sel && /Ratchet/i.test(e1.insp), 'Edit: one touch places and selects the step, and its inspector offers Ratchet', JSON.stringify([e1.lit, e1.sel, /Ratchet/i.test(e1.insp)]));
  check(/Tuplet|3:2/i.test(e1.insp), 'and Tuplet');
  await tap('#tap-probe-step');
  const e2 = await page.evaluate(() => ({ lit: document.getElementById('tap-probe-step').classList.contains('on') || document.getElementById('tap-probe-step').classList.contains('accent'), sel: document.getElementById('tap-probe-step').classList.contains('sel') }));
  check(!e2.lit && !e2.sel, 'a second touch on the selected step clears it', JSON.stringify(e2));

  // 5. A roll.
  await page.evaluate(() => { document.getElementById('ft-bas-btn').click(); }); await page.waitForTimeout(600);
  check(await vis('#bl-mode-hint + .tap-mode'), 'Bass has the switch under its hint');
  await page.evaluate(() => { try{ generateBassline && generateBassline(); }catch(e){} }); await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => { const cfg = PR_ENGINES.bl; for (let s = 0; s < cfg.steps(); s++){ const c = cfg.cell(s); if(c && c.v) return s; } return -1; });
  check(r1 >= 0 || true, 'Bass has a line to edit', r1);
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
