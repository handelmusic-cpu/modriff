/* Words as data (5.1): the lyric a chord sheet carries survives import, the
   editor, the Chart, a save and a share link.

   Driven on the real window with the real Creep and party sheets:
     - Make the song puts words on the slots and a line start on each line's first;
     - the Chart shows them under the chord names, and escapes what was typed;
     - the chord editor has a Words row; typing sets slot.lyr, "New line" toggles
       slot.ln, Undo puts both back, and either makes the song unsaved;
     - a saved song reloads with its words, and a share link round-trips them.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/words/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/import/probe.js). */
'use strict';
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const SHEET = '[Verse]\nC       G       Am\nAmazing grace how sweet\nF       C\nThe sound that saved\n[Chorus]\nAm F\n';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { setModTier('pro'); });

  // ── 1. Import puts the words on the chords.
  await page.evaluate((text) => {
    openChordSheetImport();
    const ta = document.querySelector('.csi-text'); ta.value = text; ta.dispatchEvent(new Event('input'));
  }, SHEET);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.csi-go').click());
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => sections.map(s => s.slots.map(x => [x.lyr || '', x.ln ? 1 : 0])));
  check(got[0].length === 5 && got[1].length === 2, 'verse has five chords, chorus two', JSON.stringify([got[0].length, got[1].length]));
  check(got[0][0][0] === 'Amazing ' && got[0][0][1] === 1 && got[0][3][1] === 1 && got[0][1][1] === 0 && got[0][4][1] === 0,
        'line starts sit on the first chord of each line', JSON.stringify(got[0].map(r => r[1])));
  check(got[1].every(r => r[0] === ''), 'a chord-only chorus carries no words', JSON.stringify(got[1]));

  // ── 2. The Chart shows them, and escapes.
  const chart = await page.evaluate(() => {
    sections[0].slots[1].lyr = '<b>x</b> & y';
    renderChordChart();
    const host = document.getElementById('chord-chart-body');
    const l = [...host.querySelectorAll('.cc-lyr')].map(e => e.textContent);
    return { l, bold: host.querySelectorAll('.cc-lyr b').length };
  });
  check(chart.l.length >= 4 && chart.l[0] === 'Amazing', 'chart: words under the chord names', JSON.stringify(chart.l));
  check(chart.l[1] === '<b>x</b> & y' && chart.bold === 0, 'chart: typed markup is text, not markup', JSON.stringify(chart.l[1]));
  await page.evaluate(() => { sections[0].slots[1].lyr = 'grace how '; });

  // ── 3. The editor.
  await page.evaluate(() => { markSongSaved(); });
  const ed = await page.evaluate(() => {
    const ins = document.createElement('div'); document.body.appendChild(ins);
    window.__repaints = 0;
    sbBuildChordEditor(ins, sections[0].slots[2], 2, sections[0].slots, () => { window.__repaints++; });
    const row = [...ins.querySelectorAll('.ci-row')].find(r => (r.querySelector('.ci-lbl') || {}).textContent === 'Words');
    window.__ins = ins;
    return { has: !!row, val: row && row.querySelector('input').value, btn: row && row.querySelector('button').textContent };
  });
  check(ed.has && ed.val === 'w sweet' && ed.btn === 'New line', 'editor: a Words row showing the chord\'s words and a New line switch', JSON.stringify(ed));
  await page.evaluate(() => {
    const row = [...window.__ins.querySelectorAll('.ci-row')].find(r => r.querySelector('.ci-lbl').textContent === 'Words');
    const i = row.querySelector('input'); i.value = 'way sweet '; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('blur'));
  });
  let st = await page.evaluate(() => ({ lyr: sections[0].slots[2].lyr, dirty: songIsDirty() }));
  check(st.lyr === 'way sweet ' && st.dirty, 'editor: typing sets slot.lyr (trailing space kept) and the song is unsaved', JSON.stringify(st));
  await page.evaluate(() => { document.querySelector('#_toast ._toast-btn')?.click(); });
  st = await page.evaluate(() => ({ lyr: sections[0].slots[2].lyr, dirty: songIsDirty() }));
  check(st.lyr === 'w sweet' && !st.dirty, 'editor: Undo restores the words and the saved state', JSON.stringify(st));
  await page.evaluate(() => {
    const row = [...window.__ins.querySelectorAll('.ci-row')].find(r => r.querySelector('.ci-lbl').textContent === 'Words');
    row.querySelector('button').click();
  });
  st = await page.evaluate(() => ({ ln: !!sections[0].slots[2].ln, dirty: songIsDirty() }));
  check(st.ln && st.dirty, 'editor: New line sets slot.ln and the song is unsaved', JSON.stringify(st));
  await page.evaluate(() => { document.querySelector('#_toast ._toast-btn')?.click(); });
  st = await page.evaluate(() => ({ ln: !!sections[0].slots[2].ln, dirty: songIsDirty() }));
  check(!st.ln && !st.dirty, 'editor: Undo takes the line start back', JSON.stringify(st));
  await page.evaluate(() => {
    const row = [...window.__ins.querySelectorAll('.ci-row')].find(r => r.querySelector('.ci-lbl').textContent === 'Words');
    const i = row.querySelector('input'); i.value = ''; i.dispatchEvent(new Event('blur'));
  });
  st = await page.evaluate(() => 'lyr' in sections[0].slots[2]);
  check(st === false, 'editor: emptying the field removes the key rather than keeping an empty string');

  // ── 4. Save, reload, load.
  const want = await page.evaluate(() => JSON.stringify(sections.map(s => s.slots.map(x => [x.lyr || '', x.ln ? 1 : 0]))));
  await page.evaluate(() => { document.getElementById('chart-title').value = 'Words test'; saveToSetlist(); });
  await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => {
    const sl = loadSLData(); const i = sl.findIndex(s => s.title === 'Words test');
    if (i < 0) return null;
    loadSong(sl[i], i);
    return JSON.stringify(sections.map(s => s.slots.map(x => [x.lyr || '', x.ln ? 1 : 0])));
  });
  check(back === want, 'save then load: every word and line start comes back', back === null ? 'song not found' : '');

  // ── 5. Share link.
  const shared = await page.evaluate(async () => {
    const data = await decodeSetup(await encodeSetup(_songShareData()));
    sections = [{ name: 'x', slots: [] }];
    _applySharedSong(data);
    return JSON.stringify(sections.map(s => s.slots.map(x => [x.lyr || '', x.ln ? 1 : 0])));
  });
  check(shared === want, 'share link: the words travel with the chords');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
