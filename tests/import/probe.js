/* Chord sheet import: how long each chord lasts (the window), and one length for
   every chord (Songs > Build).

   Driven on the real window with the real Creep sheet from tests/chords/sheets:
     - the choices are on screen, By line first, and "A line is" only shows for it;
     - each setting changes the bars shown under each section, and the numbers are
       right (Creep's verse is four lines of two chords: 8 chords);
     - the choice is kept for next time (modo-sheetlen) and read back;
     - Make the song builds slots with the lengths the preview showed;
     - the Length row of the chord editor has an All chords... button, and the sheet
       it opens sets every chord, leaves a rest alone, and Undo puts the lengths back.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/import/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/song/probe.js). */
'use strict';
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const CREEP = fs.readFileSync(path.join(__dirname, '../chords/sheets/creep.ocr.txt'), 'utf8');
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

  const open = () => page.evaluate((text) => {
    const old = document.querySelector('.csi-overlay'); if (old) old.remove();
    openChordSheetImport();
    const ta = document.querySelector('.csi-text'); ta.value = text; ta.dispatchEvent(new Event('input'));
  }, CREEP);
  const state = () => page.evaluate(() => {
    const on = [...document.querySelectorAll('[data-csilen].active')].map(b => b.dataset.csilen).join();
    const lb = [...document.querySelectorAll('[data-csilb].active')].map(b => b.dataset.csilb).join();
    const lineRow = document.querySelector('.csi-linebars');
    const bars = {}; document.querySelectorAll('.csi-sec').forEach(r => { const n = r.querySelector('.csi-name'); bars[n.childNodes[0].textContent.trim()] = n.querySelector('.csi-bars').textContent; });
    return { on, lb, lineShown: lineRow.style.display !== 'none', bars };
  });
  const click = (sel) => page.evaluate((s) => { document.querySelector(s).click(); }, sel);

  // ── 1. The window.
  await open(); await page.waitForTimeout(400);
  let st = await state();
  check(st.on === 'lines' && st.lb === '2' && st.lineShown, 'opens on By line, 2 bars to a line, with that row showing', JSON.stringify([st.on, st.lb, st.lineShown]));
  check(st.bars['Verse 1'] === '8 bars', 'Creep verse 1 is four lines of two chords: at 2 bars a line, 8 bars', st.bars['Verse 1']);
  await click('[data-csilb="4"]'); await page.waitForTimeout(250);
  st = await state();
  check(st.bars['Verse 1'] === '16 bars', 'at 4 bars a line it is 16 (each chord two bars, which is what the song is)', st.bars['Verse 1']);
  await click('[data-csilb="1"]'); await page.waitForTimeout(250);
  st = await state(); check(st.bars['Verse 1'] === '4 bars', 'at 1 bar a line, 4 bars', st.bars['Verse 1']);
  await click('[data-csilen="1"]'); await page.waitForTimeout(250);
  st = await state();
  check(st.on === '1' && !st.lineShown && st.bars['Verse 1'] === '8 bars', 'a plain 1 bar each: eight chords, 8 bars, and the line row goes away', JSON.stringify([st.on, st.lineShown, st.bars['Verse 1']]));
  await click('[data-csilen="0.5"]'); await page.waitForTimeout(250);
  st = await state(); check(st.bars['Verse 1'] === '4 bars', 'half a bar each: 4 bars', st.bars['Verse 1']);
  await click('[data-csilen="4"]'); await page.waitForTimeout(250);
  st = await state(); check(st.bars['Verse 1'] === '32 bars', 'four bars each: 32', st.bars['Verse 1']);

  // ── 2. Kept for next time.
  const saved = await page.evaluate(() => JSON.parse(modStore.getItem('modo-sheetlen')));
  check(saved && saved.len === 4 && saved.lineBars === 1, 'the choice is kept in modo-sheetlen', JSON.stringify(saved));
  await open(); await page.waitForTimeout(400);
  st = await state(); check(st.on === '4', 'and the window opens on it next time', st.on);
  await page.evaluate(() => { modStore.setItem('modo-sheetlen', '{"len":"banana","lineBars":7}'); });
  await open(); await page.waitForTimeout(400);
  st = await state(); check(st.on === 'lines' && st.lb === '2', 'a damaged saved choice falls back to By line, 2 bars', JSON.stringify([st.on, st.lb]));

  // ── 3. Make the song: the slots carry what the preview said.
  await click('[data-csilb="4"]'); await page.waitForTimeout(250);
  await click('.csi-go'); await page.waitForTimeout(500);
  const made = await page.evaluate(() => {
    const v = sections.find(s => /Verse 1/.test(s.name));
    return { n: v.slots.length, lens: [...new Set(v.slots.map(x => x.bars + ':' + x.beats + ':' + x.eighths))].join() };
  });
  check(made.n === 8 && made.lens === '2:0:0', 'Make the song: Verse 1 is eight chords of two bars each', JSON.stringify(made));

  // ── 4. All chords: the chord editor and the sheet.
  const btn = await page.evaluate(() => {
    const ins = document.createElement('div');
    sbBuildChordEditor(ins, sections[0].slots[0], 0, sections[0].slots, () => {});
    const rows = [...ins.querySelectorAll('.ci-row')];
    const len = rows.find(r => (r.querySelector('.ci-lbl') || {}).textContent === 'Length');
    return len ? [...len.querySelectorAll('button')].map(b => b.textContent) : null;
  });
  check(btn && btn.some(t => /All chords/.test(t)), 'the chord editor\'s Length row has an All chords… button', JSON.stringify(btn));
  const all = await page.evaluate(() => {
    const snap = () => sections.map(s => s.slots.map(x => x.bars + ':' + x.beats + ':' + x.eighths).join(' ')).join('|');
    const original = snap();
    sections[0].slots[1].isRest = true; const keepRest = [sections[0].slots[1].bars, sections[0].slots[1].beats, sections[0].slots[1].eighths].join(':');
    sbLengthAll(() => {});
    const half = [...document.querySelectorAll('.ll-act')].find(b => /Half a bar/.test(b.textContent));
    half.click();
    const lens = new Set(); sections.forEach(s => s.slots.forEach((x, i) => { if (!x.isRest) lens.add(x.bars + ':' + x.beats + ':' + x.eighths); }));
    const rest = [sections[0].slots[1].bars, sections[0].slots[1].beats, sections[0].slots[1].eighths].join(':');
    const toast = document.getElementById('_toast').textContent;
    document.querySelector('#_toast ._toast-btn').click();
    return { lens: [...lens].join(), keepRest, rest, toast, same: snap() === original };
  });
  check(all.lens === '0:2:0', 'Half a bar puts 2 beats on every chord', all.lens);
  check(all.keepRest === all.rest, 'a rest keeps its length', all.keepRest + ' -> ' + all.rest);
  check(/Half a bar on all \d+ chords/.test(all.toast), 'the toast says how many', all.toast);
  check(all.same, 'and Undo puts every length back, section by section');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
