/* The rhythm bank across the parts (4.9.9.9.9.9.6h): drums, bass and melody patterns and chord rhythms are kept
   under a name, listed by kind, renamed, deleted (with an undo) and loaded back exactly — and what is loaded is the
   pattern only: the Aux layer, the sound and the other parts are not touched. The Styles widget and the starter
   lists carry the entries, and a running beat takes a loaded drum pattern at the wrap of its loop.
   Run: node tests/rhythm/bank.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => {
    const o = {};
    RHY_BANK.length = 0; rhyBankSave();
    const toasts = []; const st = window.showToast; window.showToast = function (m) { toasts.push(String(m)); return st && st.apply(this, arguments); };
    const kitSig = () => JSON.stringify(window._sqKitTemplate().grid);
    const bassSig = () => JSON.stringify(window._blCaptureState().grid);
    const melSig = () => JSON.stringify(window._mlCaptureState().grid);

    // Drums.
    sqLoadGroove(RHYTHMS.findIndex(r => r.name === 'Hip Hop'));
    const kit1 = kitSig(), aux1 = JSON.stringify(window._sqCaptureState().aux.grid);
    const e1 = bankSave('drums', 'My boom');
    sqLoadGroove(RHYTHMS.findIndex(r => r.name === '4/4 Basic'));
    o.kitChanged = kitSig() !== kit1;
    const auxMid = JSON.stringify(window._sqCaptureState().aux.grid);
    bankLoad(e1);
    o.kitBack = kitSig() === kit1;
    o.auxKept = JSON.stringify(window._sqCaptureState().aux.grid) === auxMid;
    o.drumMeta = bankMeta(e1);

    // Bass.
    window.setBlGenStyle('funk'); window.blGenerate();
    const b1 = bassSig(); const e2 = bankSave('bass', 'My funk');
    window.blClear(); o.bassCleared = !window._blHasNotes();
    const waveBefore = window._blCaptureState().wave;
    bankLoad(e2); o.bassBack = bassSig() === b1; o.bassWave = window._blCaptureState().wave === waveBefore;

    // Melody, with a chord on a step.
    window.mlClear(); const cfg = PR_ENGINES.ml; melMono = true; melAuto = true; cfg.toggle(0, 72); cfg.toggle(0, 76); cfg.toggle(4, 74);
    const m1 = melSig(); const e3 = bankSave('mel', 'Chordy');
    window.mlClear(); o.melCleared = !window._mlHasNotes();
    bankLoad(e3); o.melBack = melSig() === m1; o.melChord = !!(window._mlCaptureState().grid[0].more || []).length;

    // A chord rhythm.
    const d = rhyBlank(16); d.cells[0].on = 1; d.cells[6].on = 1; d.cells[6].acc = 1; d.name = 'Pocket';
    CR.def = rhyNorm(d); CR.key = rhyRegister(CR.def);
    const e4 = bankSave('chord', 'Pocket');
    CR.key = 'strum'; CR.def = null;
    bankLoad(e4); o.chordLoaded = [/^u:/.test(CR.key), CR.def && CR.def.name, CR.on];
    o.counts = BANK_KINDS.map(k => rhyBankList(k[0]).length).join();
    o.toasts = toasts.filter(t => /^Kept /.test(t));
    o.nothing = (() => { window.mlClear(); const n = toasts.length; const x = bankSave('mel', 'Empty'); return [x, toasts.slice(n).join('|')]; })();

    // Starters and the widget.
    o.lists = ['drums', 'bass', 'mel'].map(p => starterList(p).filter(x => /^bank:/.test(x.id)).map(x => x.label).join('|'));
    o.settings = ['drums', 'bass', 'mel'].map(p => [...document.getElementById('starter-' + p).options].filter(x => /^bank:/.test(x.value)).length);
    bankLoad(e2);
    await new Promise(r => setTimeout(r, 200));
    o.cur = starterCurrent('bass');
    const node = starterWidgetNode(); starterWidgetSync();
    o.widgetName = node.querySelector('.st-row[data-part="bass"] .st-name').textContent;
    // Edit the line and it is no longer that entry.
    window.blClear(); window.blGenerate(); starterWidgetSync();
    o.curAfterEdit = starterCurrent('bass');
    // Rotating onto an entry loads it.
    starterSetStyle('bass', 'bank:' + e2.id);
    window.blClear(); STARTERS.bass = 'bank:' + e2.id; starterOnEnable('bass');
    o.starterLoaded = bassSig() === b1;
    // Rename / delete with undo.
    rhyBankRename(e2.id, 'Funk 2'); o.renamed = rhyBankGet(e2.id).name;
    const copy = JSON.parse(JSON.stringify(e2)); rhyBankDelete(e2.id); o.deleted = !rhyBankGet(e2.id);
    RHY_BANK.push(copy); rhyBankSave(); o.restored = !!rhyBankGet(e2.id);
    return o;
  });
  ok(r.kitChanged && r.kitBack, 'a drum pattern kept under a name comes back exactly', JSON.stringify([r.kitChanged, r.kitBack]));
  ok(r.auxKept, 'loading a drum pattern leaves the Aux layer alone', '');
  ok(r.bassCleared && r.bassBack && r.bassWave, 'a bass line is kept and loaded back; the voice is not touched', JSON.stringify([r.bassCleared, r.bassBack, r.bassWave]));
  ok(r.melCleared && r.melBack && r.melChord, 'a melody line is kept with its chords', JSON.stringify([r.melCleared, r.melBack, r.melChord]));
  ok(r.chordLoaded[0] && r.chordLoaded[1] === 'Pocket' && r.chordLoaded[2], 'a chord rhythm is kept and loading it puts it on the pads (and arms it)', JSON.stringify(r.chordLoaded));
  ok(r.counts === '1,1,1,1', 'one entry of each kind', r.counts);
  ok(r.toasts.length === 4 && /My boom/.test(r.toasts[0]), 'keeping says what was kept', JSON.stringify(r.toasts));
  ok(r.nothing[0] === null && /Nothing in melody/.test(r.nothing[1]), 'nothing is kept from an empty part', JSON.stringify(r.nothing));
  ok(r.lists[0] === 'My boom' && r.lists[1] === 'My funk' && r.lists[2] === 'Chordy' && r.settings.join() === '1,1,1', 'the starter lists (Settings, the Styles widget\'s rotation) carry the entries', JSON.stringify([r.lists, r.settings]));
  ok(/^bank:/.test(r.cur) && r.widgetName === 'My funk' && !/^bank:/.test(r.curAfterEdit), 'the widget names a kept pattern while it is what is there, and not once it has been changed', JSON.stringify([r.cur, r.widgetName, r.curAfterEdit]));
  ok(r.starterLoaded, 'a kept pattern can be the starter a part is switched on with', '');
  ok(r.renamed === 'Funk 2' && r.deleted && r.restored, 'rename, delete, and put back', JSON.stringify([r.renamed, r.deleted, r.restored]));
  ok(!r.drumMeta || /16 steps/.test(r.drumMeta), 'the list shows steps and the kit', r.drumMeta);

  // The bank sheet.
  await page.evaluate(() => { RHY_BANK.length = 0; rhyBankSave(); const d = rhyBlank(16); d.cells[2].on = 1; rhyBankAdd('chord', 'Offbeat', d); sqLoadGroove(RHYTHMS.findIndex(r => r.name === 'Boom Bap')); window.__tabs = []; rhyBankOpen('chord'); });
  await page.waitForTimeout(300);
  const ui = await page.evaluate(async () => {
    const o = {};
    const sheet = document.querySelector('.lib-sheet');
    o.tabs = [...sheet.querySelectorAll('.lib-tabs button')].map(b => b.textContent).join(',');
    o.on = sheet.querySelector('.lib-tabs button.on').textContent;
    o.rows = [...sheet.querySelectorAll('.rb-row .rb-name b')].map(b => b.textContent);
    // Keep the kit under a name typed in the sheet.
    [...sheet.querySelectorAll('.lib-tabs button')].find(b => b.textContent === 'Drums').click();
    o.emptyDrums = !!sheet.querySelector('.rb-empty');
    sheet.querySelector('.rb-save input').value = 'Typed name';
    [...sheet.querySelectorAll('.rb-save button')][0].click();
    o.kept = rhyBankList('drums').map(e => e.name);
    o.rowsAfter = [...sheet.querySelectorAll('.rb-row .rb-name b')].map(b => b.textContent);
    // Delete and undo.
    [...sheet.querySelectorAll('.rb-row .rb-del')][0].click();
    o.afterDelete = rhyBankList('drums').length;
    const undo = document.querySelector('#_toast button'); if (undo) undo.click();
    o.afterUndo = rhyBankList('drums').length;
    return o;
  });
  ok(ui.tabs === 'Chords,Drums,Bass,Melody' && ui.on === 'Chords' && ui.rows.join() === 'Offbeat', 'the bank sheet: a tab per kind, the entries of that kind', JSON.stringify(ui));
  ok(ui.emptyDrums && ui.kept.join() === 'Typed name' && ui.rowsAfter.join() === 'Typed name', 'keep the part under a name typed in the sheet', JSON.stringify([ui.emptyDrums, ui.kept, ui.rowsAfter]));
  ok(ui.afterDelete === 0 && ui.afterUndo === 1, 'delete, and Undo brings it back', JSON.stringify([ui.afterDelete, ui.afterUndo]));

  // A running beat takes a loaded drum pattern at the wrap.
  const q = await page.evaluate(async () => {
    const o = {};
    if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) { } }
    await audioCtx.resume();
    document.getElementById('bpm').value = 220;
    sqLoadGroove(RHYTHMS.findIndex(r => r.name === 'Hip Hop'));
    const tpl = window._sqKitTemplate();
    sqLoadGroove(RHYTHMS.findIndex(r => r.name === '4/4 Basic'));
    const other = JSON.stringify(window._sqKitTemplate().grid);
    document.getElementById('ft-playstop-btn').click();
    await new Promise(r => setTimeout(r, 300));
    o.playing = window._sqPlaying();
    o.ret = window._sqApplyKitTemplate(tpl);
    o.beforeWrap = JSON.stringify(window._sqKitTemplate().grid) === other;
    await new Promise(r => setTimeout(r, 2600));
    o.afterWrap = JSON.stringify(window._sqKitTemplate().grid) === JSON.stringify(tpl.grid);
    document.getElementById('ft-playstop-btn').click();
    return o;
  });
  ok(q.playing && q.ret === 'queued' && q.beforeWrap && q.afterWrap, 'while the beat runs, a loaded drum pattern waits for the loop to wrap', JSON.stringify(q));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
