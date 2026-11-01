/* Settings as a list of rows (6.0h).

   Driven on the real window with real touch (CDP):
     - the transport sheet's Settings tile opens it; it is one list under Playing / Gear / App, not three panes;
     - every row is closed, at least 44 pt high, and says what it is set to;
     - a touch on a row opens it in place and the controls inside show; a second touch closes it;
     - the search narrows the list to rows that hold the words and opens them; clearing it brings the list back;
     - the old way in by pane name (Find, the tutorials) still lands: asking for the MIDI pane opens its row;
     - Done goes back to where it was opened from.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/settings/probe.js
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
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); });
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const vis = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

  // ── 1. In through the sheet.
  await tap('#tab-more'); await tap('#ft-settings-btn');
  const st = await page.evaluate(() => ({ active: document.querySelector('.tab-page.active').id,
    groups: [...document.querySelectorAll('#page-build .sgrp-t')].map(h => h.textContent.trim()).join(),
    rows: [...document.querySelectorAll('#page-build .settings-section')].map(e => ({ id: e.id, h: Math.round(e.querySelector('.ss-hdr').getBoundingClientRect().height), open: e.querySelector('.ss-body').classList.contains('open'), sum: (e.querySelector('.ss-preview') || {}).textContent || '' })),
    subnav: getComputedStyle(document.getElementById('set-subnav')).display }));
  check(st.active === 'page-build', 'the sheet\'s Settings tile opens Settings', st.active);
  check(st.groups === 'Playing,Gear,App' && st.subnav === 'none', 'one list under Playing / Gear / App, no panes', st.groups + ' ' + st.subnav);
  check(st.rows.length >= 11 && st.rows.every(r => !r.open), 'every row is closed', JSON.stringify(st.rows.map(r => r.id + ':' + r.open)));
  check(st.rows.every(r => r.h >= 44), 'every row is at least 44 pt high', st.rows.map(r => r.h).join());
  check(st.rows.every(r => r.sum), 'every row says what it is set to', st.rows.map(r => r.id + '=' + r.sum).join(' | '));

  // ── 1b. Samples, iCloud & backup, Packs & purchases and Help & about are rows of their own (6.0o),
  //        with the controls moved into them, not copied (one of each).
  const own = await page.evaluate(() => {
    const row = sel => { const e = document.querySelector(sel), s = e && e.closest('.settings-section'); return s ? s.id : null; };
    const names = {}; document.querySelectorAll('#page-build .settings-section').forEach(e => { names[e.id] = e.querySelector('.ss-hdr span').textContent.trim(); });
    const grp = id => { const e = document.getElementById(id), o = +getComputedStyle(e).order; const g = [...document.querySelectorAll('#page-build .sgrp-t')].map(h => ({ g: h.textContent.trim(), o: +getComputedStyle(h).order })).filter(h => h.o < o).pop(); return g && g.g; };
    return { names, grp: { samples: grp('ss-samples'), cloud: grp('ss-cloud'), packs: grp('ss-packs'), about: grp('ss-about') },
      where: { sampler: row('[onclick="smpOpenLibrary()"]'), sync: row('[data-sync]'), pro: row('#pro-row'), restore: row('[onclick="proRestore()"]'), tut: row('.tut-entry'), ver: row('#ft-ver'), credits: row('#credits-btn') },
      copies: { sampler: document.querySelectorAll('[onclick="smpOpenLibrary()"]').length, sync: document.querySelectorAll('[data-sync]').length, tut: document.querySelectorAll('#page-build .tut-entry').length } };
  });
  check(own.names['ss-samples'] === 'Samples' && own.names['ss-cloud'] === 'iCloud & backup' && own.names['ss-packs'] === 'Packs & purchases' && own.names['ss-about'] === 'Help & about', 'the four rows have the mock\'s names', JSON.stringify(own.names));
  check(own.grp.samples === 'Gear' && own.grp.cloud === 'App' && own.grp.packs === 'App' && own.grp.about === 'App', 'Samples is under Gear; iCloud, Packs and Help under App', JSON.stringify(own.grp));
  check(own.where.sampler === 'ss-samples' && own.where.sync === 'ss-cloud' && own.where.pro === 'ss-packs' && own.where.restore === 'ss-packs' && own.where.tut === 'ss-about' && own.where.ver === 'ss-about' && own.where.credits === 'ss-about', 'each control is in its row', JSON.stringify(own.where));
  check(own.copies.sampler === 1 && own.copies.sync === 1 && own.copies.tut === 1, 'moved, not copied', JSON.stringify(own.copies));

  // ── 2. Open and close a row by touch.
  check(!(await vis('#hz-amt')), 'a control inside a closed row is not on screen');
  await tap('#ss-global .ss-hdr');
  check(await vis('#hz-amt'), 'a touch on Sound & response opens it and its controls show');
  await tap('#ss-global .ss-hdr');
  check(!(await vis('#hz-amt')), 'a second touch closes it');

  // ── 3. Search.
  await page.evaluate(() => { const i = document.getElementById('set-find'); i.value = 'tune'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const f = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#page-build .settings-section')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id), open: document.querySelector('#ss-tune .ss-body').classList.contains('open') }));
  check(f.shown.includes('ss-tune') && f.shown.length < 7 && f.open, 'searching "tune" narrows the list and opens Master tune', f.shown.join());
  await page.evaluate(() => { const i = document.getElementById('set-find'); i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await vis('#set-none'), 'a search that matches nothing says so');
  await page.evaluate(() => { const i = document.getElementById('set-find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check((await page.evaluate(() => [...document.querySelectorAll('#page-build .settings-section')].filter(e => getComputedStyle(e).display === 'none').length)) === 0, 'clearing it brings every row back');

  // ── 4. The old way in by pane name.
  await page.evaluate(() => { setSettingsPane('midi'); });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector('#ss-midi .ss-body').classList.contains('open')) && await vis('#midi-rescan'), 'asking for the MIDI pane opens its row and shows its controls');

  // The packs row has its own way in by a search for a word that is only on it, and Find reaches the moved controls.
  await page.evaluate(() => { const i = document.getElementById('set-find'); i.value = 'restore purchases'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await page.evaluate(() => { const e = document.getElementById('ss-packs'); return getComputedStyle(e).display !== 'none' && e.querySelector('.ss-body').classList.contains('open'); }), 'searching "restore purchases" opens Packs & purchases');
  await page.evaluate(() => { const i = document.getElementById('set-find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const fnd = await page.evaluate(() => { window._findHarvestCache = null; return _findHarvestAll().filter(e => e.tab === 'build' && /Restore Purchases|◈ Sampler|iCloud sync/.test(e.name)).map(e => e.where); });
  check(fnd.length === 3 && fnd.every(w => /^Settings › (Packs & purchases|Samples|iCloud & backup)/.test(w)), 'Find names the new rows, not a pane', fnd.join(' | '));

  // ── 5. Done.
  await tap('.set-done');
  const back = await page.evaluate(() => document.querySelector('.tab-page.active').id);
  check(back !== 'page-build', 'Done goes back', back);
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
