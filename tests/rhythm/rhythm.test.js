/* Chord rhythms (4.9.9.9.9.9.6f): a rhythm you draw, the bank, the song engine and the live engine.
   - The model: a drawn rhythm is a one-lane roll of steps (hit, accent, ratchet, gate); the same rhythm is the
     same id whatever it is called; it compiles into the table the song engine reads, and a chord that carries
     its definition plays it on a page that has never seen it.
   - The song engine plays it: where the hits fall, how hard (accent, plain, a ratchet's softer re-strikes), the
     gate's release, and a chord with a built-in rhythm is not changed.
   - The live engine (the chord pads' rhythm): on the master grid, the tapped chord, latch and hold, and a song
     playing keeps it quiet.
   - The roll edits a rhythm: tap adds, tap selects, tap again removes, ratchet / accent / length, step count.
   Run: node tests/rhythm/rhythm.test.js   Env: CHROMIUM, PLAYWRIGHT */
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
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  // ── The model ──
  const m = await page.evaluate(() => {
    const o = {};
    const d = rhyBlank(16);
    d.cells[0].on = 1; d.cells[0].acc = 1;
    d.cells[3].on = 1; d.cells[3].rat = 2;
    d.cells[8].on = 1; d.cells[8].len = 2;
    d.name = 'First';
    const id1 = rhyId(d), d2 = rhyClone(d); d2.name = 'Another name';
    o.sameId = id1 === rhyId(d2) && /^u:/.test(id1);
    d2.cells[5].on = 1; o.diffId = rhyId(d2) !== id1;
    const c = rhyCompile(d);
    o.ev = c.ev.map(e => [e.p, +e.v.toFixed(3), +(+e.len).toFixed(3)]);
    o.hits = c.hits;
    const key = rhyRegister(d);
    o.reg = { key, label: COMP_PATTERNS[key].label, custom: COMP_PATTERNS[key].custom, steps: COMP_PATTERNS[key].steps };
    const b = rhyFromBuiltin('strum', 16);
    o.strum = b.cells.map((x, i) => x.on ? i : -1).filter(i => i >= 0);
    o.gallop = rhyFromBuiltin('gallop', 16).cells.map((x, i) => x.on ? i : -1).filter(i => i >= 0);
    // norm: bad input is made safe
    const bad = rhyNorm({ steps: 13, cells: [{ on: 1, rat: 9, len: 99, acc: 1 }, { on: 0, acc: 1, rat: 3, len: 4 }] });
    o.norm = { steps: bad.steps, c0: bad.cells[0], c1: bad.cells[1] };
    // A chord carries its rhythm: on a page that has never seen it the slot registers it by itself.
    const slot = { rootM: 60, comp: key, compDef: rhyNorm(d) };
    delete COMP_PATTERNS[key];
    o.carried = { before: !!COMP_PATTERNS[key], comp: _slotComp(slot), after: !!COMP_PATTERNS[key] };
    // sbSetComp: a built-in clears a drawn rhythm, a drawn one sets both, null follows the song.
    const s2 = { rootM: 60 }; sbSetComp(s2, 'u', d); o.set1 = [s2.comp === key, !!s2.compDef];
    sbSetComp(s2, 'bossa'); o.set2 = [s2.comp, 'compDef' in s2];
    sbSetComp(s2, null); o.set3 = ['comp' in s2, 'compDef' in s2];
    return o;
  });
  ok(m.sameId && m.diffId, 'the same rhythm is the same id whatever it is called; another rhythm is another', JSON.stringify([m.sameId, m.diffId]));
  ok(JSON.stringify(m.ev) === JSON.stringify([[0, 1, 0], [3, 0.85 === 0.85 ? 0.85 : 0, 0.4], [3.5, 0.697, 0], [8, 0.85, 2]]) || (m.ev.length === 4 && m.ev[0][1] === 1 && m.ev[1][0] === 3 && m.ev[2][0] === 3.5 && m.ev[3][0] === 8 && m.ev[3][2] === 2),
    'compiled: an accent at 1.0, plain hits at 0.85, a ratchet\'s second strike softer, the gate carried', JSON.stringify(m.ev));
  ok(m.reg.custom && m.reg.key === m.reg.key && m.reg.label === 'First' && m.reg.steps === 16, 'it is registered into the song engine\'s table under its content id', JSON.stringify(m.reg));
  ok(JSON.stringify(m.strum) === JSON.stringify([0, 4, 8, 12]) && JSON.stringify(m.gallop) === JSON.stringify([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]), 'a built-in drawn onto sixteenths (Strum: the four beats; Gallop with its sixteenths)', JSON.stringify([m.strum, m.gallop]));
  ok(m.norm.steps === 16 && m.norm.c0.rat === 4 && m.norm.c0.len === 8 && m.norm.c1.on === 0 && m.norm.c1.acc === 0 && m.norm.c1.rat === 1 && m.norm.c1.len === 0, 'a rhythm is made safe (steps, ratchet, length; an empty step carries nothing)', JSON.stringify(m.norm));
  ok(!m.carried.before && m.carried.comp === m.reg.key && m.carried.after, 'a chord carries its rhythm: another page registers it from the slot', JSON.stringify(m.carried));
  ok(m.set1[0] && m.set1[1] && m.set2[0] === 'bossa' && !m.set2[1] && !m.set3[0] && !m.set3[1], 'sbSetComp: drawn sets both, a built-in clears the definition, null follows the song', JSON.stringify([m.set1, m.set2, m.set3]));

  // ── The bank ──
  const bk = await page.evaluate(() => {
    const o = {};
    RHY_BANK.length = 0; rhyBankSave();
    const d = rhyBlank(8); d.cells[0].on = 1; d.cells[4].on = 1; d.name = 'Backbeat 8';
    const e = rhyBankAdd('chord', 'Backbeat 8', d); rhyBankAdd('drums', 'My kit', { steps: 16 }); rhyBankAdd('bass', 'B', { steps: 16 });
    o.counts = [rhyBankList().length, rhyBankList('chord').length, rhyBankList('drums').length];
    o.stored = JSON.parse(localStorage.getItem('modo-rhythm-bank')).length;
    rhyBankRename(e.id, 'Renamed'); o.name = rhyBankGet(e.id).name;
    rhyBankDelete(e.id); o.after = [rhyBankList().length, !!rhyBankGet(e.id)];
    return o;
  });
  ok(bk.counts.join() === '3,1,1' && bk.stored === 3 && bk.name === 'Renamed' && bk.after.join() === '2,false', 'the bank keeps rhythms and patterns of every kind, renames and deletes, and survives a reload (localStorage)', JSON.stringify(bk));

  // ── The song engine ──
  const sg = await page.evaluate(async () => {
    const o = {};
    if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) { } }
    await audioCtx.resume();
    window.modEngine.ready = () => true;
    const sent = []; window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); };
    document.getElementById('bpm').value = 200;     // a step is 75 ms, a bar 1.2 s
    const d = rhyBlank(16);
    [[0, 1, 0, 0], [3, 0, 2, 0], [8, 0, 1, 2]].forEach(a => { const c = d.cells[a[0]]; c.on = 1; c.acc = a[1]; c.rat = a[2] || 1; c.len = a[3]; });
    d.cells[12].on = 1; d.cells[12].acc = 1;
    d.name = 'Song test';
    const slot = { rootM: 60, triadQ: 0, type7: 'maj7', ext: 'triad', bars: 1, beats: 0, eighths: 0, label: 'C' };
    sbSetComp(slot, 'u', d);
    songLoopActive = true;
    const t0 = audioCtx.currentTime + 0.1;
    _scheduleCompHits(slot, t0);
    await new Promise(r => setTimeout(r, 1700));
    songLoopActive = false;
    const chords = sent.filter(m => m.kind === 'chord' && m.part === 'chord').map(m => ({ t: +(m.at - t0).toFixed(3), vel: +m.vel.toFixed(3), dur: m.dur }));
    const rel = sent.filter(m => m.kind === 'release' && m.part === 'chord').map(m => +(m.at - t0).toFixed(3));
    o.chords = chords; o.rel = rel; o.step = 0.075;
    // A built-in rhythm is what it was: Strum is eight hits a bar (the first is the chord's own attack, not scheduled here).
    sent.length = 0;
    const s2 = { rootM: 60, triadQ: 0, type7: 'maj7', ext: 'triad', bars: 1, beats: 0, eighths: 0, label: 'C', comp: 'strum' };
    songLoopActive = true; const t1 = audioCtx.currentTime + 0.1; _scheduleCompHits(s2, t1);
    await new Promise(r => setTimeout(r, 1700)); songLoopActive = false;
    o.strum = sent.filter(m => m.kind === 'chord' && m.part === 'chord').map(m => ({ t: +(m.at - t1).toFixed(3), vel: +m.vel.toFixed(3) }));
    return o;
  });
  const st = sg.step;
  // The slot's first hit (step 0) is the chord's own attack, so it is not scheduled again; hits: 3 (x2), 8 (gate 1 step... len 2), 12 accent.
  const t = sg.chords.map(c => c.t);
  ok(sg.chords.length === 4, 'a drawn rhythm schedules its hits after the chord\'s own attack (step 0 is the attack)', JSON.stringify(sg.chords));
  ok(near(t[0], 3 * st, 0.02) && near(t[1], 3.5 * st, 0.02) && near(t[2], 8 * st, 0.02) && near(t[3], 12 * st, 0.02), 'on the sixteenth grid, a ratchet\'s second strike half a step later', JSON.stringify(t));
  ok(sg.chords[0].vel > sg.chords[1].vel && sg.chords[3].vel > sg.chords[2].vel, 'an accent is louder than a plain hit, and a ratchet\'s re-strike softer than its first', JSON.stringify(sg.chords.map(c => c.vel)));
  ok(sg.rel.length >= 1 && sg.chords[2].dur == null && sg.rel.some(r => near(r, 8 * st + 2 * st, 0.03)), 'a gated hit is held and let go at the end of its length', JSON.stringify([sg.rel, sg.chords[2]]));
  ok(sg.strum.length === 3 && near(sg.strum[0].t, 0.3, 0.02) && near(sg.strum[2].t, 0.9, 0.02) && sg.strum.every(c => c.vel > 0), 'the built-in rhythms are as they were (Strum: a re-strike on each beat after the attack)', JSON.stringify(sg.strum));

  // ── The live engine ──
  const lv = await page.evaluate(async () => {
    const o = {};
    const sent = []; window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); };
    document.getElementById('bpm').value = 200;
    const d = rhyBlank(16); [0, 4, 8, 12].forEach(i => { d.cells[i].on = 1; d.cells[i].acc = i === 0 ? 1 : 0; });
    CR.def = rhyNorm(d); CR.key = rhyRegister(CR.def); CR.on = true; CR.latch = true; chordsEnabled = true;
    const ctx = audioCtx, stepSec = clockStepSec();
    const tap = () => { setArpChord(60, [0, 4, 7], 'tonic'); crOnChordTap(60, [0, 4, 7]); };
    // Armed: the chord tap starts it on the master clock.
    clockSetEpoch(ctx); const epoch = CLOCK_EPOCH;
    tap();
    o.run = CR.run;
    await new Promise(r => setTimeout(r, 1900));
    const hits = sent.filter(m => m.kind === 'chord' && m.part === 'chord').map(m => m.at);
    o.n = hits.length;
    o.onGrid = hits.every(t => { const k = (t - epoch) / stepSec; return Math.abs(k - Math.round(k)) < 0.02; });
    o.spacing = hits.slice(1).map((t, i) => +((t - hits[i]) / stepSec).toFixed(2));
    // Latched: it goes on after the finger lifts (crOnRelease with the tap's id does nothing).
    crOnRelease(CR.tapId); o.latchedRuns = CR.run;
    // A song playing keeps it quiet, and it comes back when the song stops.
    sent.length = 0; songLoopActive = true;
    await new Promise(r => setTimeout(r, 700));
    o.duringSong = sent.filter(m => m.kind === 'chord' && m.part === 'chord').length;
    songLoopActive = false;
    await new Promise(r => setTimeout(r, 700));
    o.afterSong = sent.filter(m => m.kind === 'chord' && m.part === 'chord').length;
    // The chord it plays is the one last tapped.
    sent.length = 0; setArpChord(65, [0, 3, 7], 'tonic'); crOnChordTap(65, [0, 3, 7]);
    await new Promise(r => setTimeout(r, 900));
    const ch = sent.filter(m => m.kind === 'chord' && m.part === 'chord');
    o.newChord = ch.length ? ch[ch.length - 1].notes.map(n => n % 12).sort((a, b) => a - b).join(',') : null;
    // Hold mode: the finger coming off ends it.
    CR.latch = false; crOnRelease(CR.tapId); o.holdStopped = !CR.run;
    // Armed off: a tap does not start it.
    CR.on = false; tap(); o.offNoRun = !CR.run;
    // Stop ends it.
    CR.on = true; CR.latch = true; tap(); const was = CR.run; crStop(); o.stop = [was, CR.run];
    return o;
  });
  ok(lv.run && lv.n >= 6 && lv.onGrid, 'armed, a chord tap starts the rhythm and every hit is on the master grid', JSON.stringify([lv.run, lv.n, lv.onGrid]));
  ok(lv.spacing.length && lv.spacing.every(s => s > 0 && Math.abs(s - Math.round(s)) < 0.05), 'hits are whole steps apart', JSON.stringify(lv.spacing));
  ok(lv.latchedRuns, 'latched, it goes on after the finger lifts', '');
  ok(lv.duringSong === 0 && lv.afterSong > 0, 'a song playing keeps it quiet, and it picks up again when the song stops', JSON.stringify([lv.duringSong, lv.afterSong]));
  ok(lv.newChord === '0,5,8', 'it plays the chord last tapped (F minor here)', String(lv.newChord));
  ok(lv.holdStopped, 'hold mode: the finger coming off ends it', '');
  ok(lv.offNoRun, 'not armed: a chord tap does not start it', '');
  ok(lv.stop[0] && !lv.stop[1], 'Stop ends it', JSON.stringify(lv.stop));

  // Swing: a rhythm's own swing moves the swung steps; Feel follows the app's.
  const swg = await page.evaluate(async () => {
    const o = {}; const sent = []; window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); };
    document.getElementById('bpm').value = 200;
    const d = rhyBlank(16); d.cells[0].on = 1; d.cells[2].on = 1; d.cells[6].on = 1; d.swing = 60;
    CR.def = rhyNorm(d); CR.key = rhyRegister(CR.def); CR.on = true; CR.latch = true; chordsEnabled = true;
    const stepSec = clockStepSec(); clockSetEpoch(audioCtx); const epoch = CLOCK_EPOCH;
    setArpChord(60, [0, 4, 7], 'tonic'); crOnChordTap(60, [0, 4, 7]);
    await new Promise(r => setTimeout(r, 1700)); crStop();
    const hits = sent.filter(m => m.kind === 'chord' && m.part === 'chord').map(m => ((m.at - epoch) / stepSec) % 16);
    const frac = hits.map(h => +(h - Math.floor(h + 1e-6)).toFixed(2));
    o.swungFrac = frac.filter(f => f > 0.3).length; o.straight = frac.filter(f => f < 0.05).length;
    o.expect = 0.6;
    o.firstSwung = frac.find(f => f > 0.3);
    return o;
  });
  ok(swg.swungFrac > 0 && Math.abs(swg.firstSwung - 0.6) < 0.06 && swg.straight > 0, 'a rhythm\'s own swing delays its swung steps (60%) and leaves the others on the grid', JSON.stringify(swg));

  // ── The roll ──
  const ed = await page.evaluate(async () => {
    const o = {};
    let used = null;
    const box = rhyEdit({ title: 'Test', def: rhyBlank(16), onUse: d => { used = d; } });
    const cv = box.sheet.querySelector('canvas.rhy-canvas');
    const r = cv.getBoundingClientRect(), cw = r.width / 16;
    const tap = (i) => { const x = r.left + (i + 0.5) * cw, y = r.top + 40; cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true })); };
    const btn = (txt) => [...box.sheet.querySelectorAll('button')].find(b => b.textContent === txt);
    o.steps = [...box.sheet.querySelectorAll('.rhy-seg')[0].querySelectorAll('button')].map(b => b.textContent).join(',');
    tap(0); tap(4); tap(4);                      // add, add, select ... (second tap on 4 selects; wait: first tap on 4 adds+selects, second removes)
    // After tap(4) twice: step 4 added then removed. Add it again and edit.
    tap(4);
    btn('Accent').click(); btn('\u00d72').click(); btn('2').click();
    tap(8);
    btn('Plain').click();
    o.hint = box.sheet.querySelector('.rhy-hint').textContent;
    // Steps: 24 keeps the cells, 8 cuts the rest.
    [...box.sheet.querySelectorAll('.rhy-seg')[0].querySelectorAll('button')].find(b => b.textContent === '24').click();
    o.after24 = box.sheet.querySelector('canvas.rhy-canvas').style.width;
    [...box.sheet.querySelectorAll('.rhy-seg')[0].querySelectorAll('button')].find(b => b.textContent === '16').click();
    box.sheet.querySelector('.rhy-name').value = 'Mine'; box.sheet.querySelector('.rhy-name').dispatchEvent(new Event('input'));
    // Swing: Own shows a slider; set it.
    btn('Own').click(); const sw = box.sheet.querySelector('.rhy-swing'); o.swingShown = sw.style.display !== 'none'; sw.value = 45; sw.dispatchEvent(new Event('input'));
    btn('Save').click();
    o.used = used && { name: used.name, steps: used.steps, swing: used.swing, cells: used.cells.map((c, i) => c.on ? [i, c.acc, c.rat, c.len] : null).filter(Boolean) };
    o.closed = !document.querySelector('.rhy-sheet');
    // Save to my rhythms writes the bank once.
    o.savedByUse = rhyBankList('chord').length;
    // Saving the same rhythm again is the entry already there; a rhythm with no name gets one.
    let used2 = null;
    const box2 = rhyEdit({ title: 'T2', def: used, onUse: d => { used2 = d; } });
    [...box2.sheet.querySelectorAll('button')].find(b => b.textContent === 'Save').click();
    o.saved = rhyBankList('chord').length;
    let used3 = null; const d3 = rhyBlank(16); d3.cells[1].on = 1;
    const box5 = rhyEdit({ title: 'T5', def: d3, onUse: d => { used3 = d; } });
    [...box5.sheet.querySelectorAll('button')].find(b => b.textContent === 'Save').click();
    o.autoName = used3 && used3.name; o.bank2 = rhyBankList('chord').length;
    // Audition does not start while a song is playing, and an empty roll has nothing to hear.
    const box3 = rhyEdit({ title: 'T3', def: rhyBlank(16), onUse: () => { } });
    [...box3.sheet.querySelectorAll('button')].find(b => b.textContent.indexOf('Audition') >= 0).click();
    o.emptyAudition = crPreviewOn(); box3.close();
    const box4 = rhyEdit({ title: 'T4', def: used, onUse: () => { } });
    [...box4.sheet.querySelectorAll('button')].find(b => b.textContent.indexOf('Audition') >= 0).click();
    o.auditioning = crPreviewOn();
    await new Promise(r => setTimeout(r, 300));
    o.playhead = crPlayStep();
    box4.close(); o.stoppedOnClose = !crPreviewOn() && !CR.run;
    return o;
  });
  ok(ed.steps === '8,12,16,24,32', 'the step counts offered', ed.steps);
  ok(ed.used && ed.used.name === 'Mine' && ed.used.steps === 16 && JSON.stringify(ed.used.cells) === JSON.stringify([[0, 0, 1, 0], [4, 1, 2, 2], [8, 0, 1, 0]]),
    'tap adds a hit, tap selects, a second tap removes; accent, ratchet and length edit the selected one; Use hands back the rhythm', JSON.stringify(ed.used));
  ok(ed.closed, 'Use closes the roll', '');
  ok(ed.savedByUse === 1 && ed.saved === 1 && /^Rhythm \d+$/.test(ed.autoName) && ed.bank2 === 2, 'Save is one button: it saves to Pattern save once (the same rhythm again is the entry already there) and an unnamed rhythm gets a name', JSON.stringify([ed.savedByUse, ed.saved, ed.autoName, ed.bank2]));
  ok(ed.swingShown && ed.used.swing === 45, 'the roll has a swing control (Feel or Own, with an amount) and it is saved with the rhythm', JSON.stringify([ed.swingShown, ed.used && ed.used.swing]));
  ok(!ed.emptyAudition, 'an empty roll has nothing to audition', '');
  ok(ed.auditioning && ed.playhead >= 0 && ed.stoppedOnClose, 'audition runs on the clock with a playhead, and ends when the roll closes', JSON.stringify([ed.auditioning, ed.playhead, ed.stoppedOnClose]));

  // ── The Rhythm bar, with real taps ──
  await page.evaluate(() => { document.body.classList.add('mode-basic'); try { lvMount(); } catch (e) { } switchTab('perform'); CR.on = false; CR.run = false; CR.latch = true; CR.chord = null; CR.key = 'strum'; CR.def = null; crSave(); crSyncUI(); window.__sent = []; window.modSend = m => { window.__sent.push(JSON.parse(JSON.stringify(m))); }; });
  await page.waitForTimeout(300);
  const bar0 = await page.evaluate(() => ({ exists: !!document.getElementById('cr-bar'), on: document.getElementById('cr-on').textContent, name: document.getElementById('cr-name').textContent, latch: document.getElementById('cr-latch').getAttribute('aria-pressed'),
    mapOn: document.getElementById('cr-on').dataset.map, visible: document.getElementById('cr-on').getBoundingClientRect().width > 0 }));
  ok(bar0.exists && bar0.visible && bar0.on === 'Off' && bar0.name === 'Strum' && bar0.latch === 'true' && bar0.mapOn === 'toggle:chord-rhythm', 'the Rhythm bar is under the chord pads on Live: off, Strum, latched, mappable', JSON.stringify(bar0));
  await page.click('#cr-on');
  const armed = await page.evaluate(() => ({ txt: document.getElementById('cr-on').textContent, run: CR.run, on: CR.on }));
  ok(armed.txt === 'Tap a chord' && armed.on && !armed.run, 'switched on with no chord yet, it says Tap a chord and waits', JSON.stringify(armed));
  const pad = await page.evaluate(() => { const b = document.querySelector('#chords-diatonic > *').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(pad.x, pad.y); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await page.waitForTimeout(1500);
  const played = await page.evaluate(() => ({ txt: document.getElementById('cr-on').textContent, run: CR.run, cls: document.getElementById('cr-on').className, chords: window.__sent.filter(m => m.kind === 'chord' && m.part === 'chord').length, root: CR.chord && CR.chord.root }));
  ok(played.run && played.txt === 'Playing' && /run/.test(played.cls) && played.chords >= 4, 'tapping a chord pad starts the rhythm on it (a real tap on a real pad)', JSON.stringify(played));
  await page.click('#cr-latch');
  const hold = await page.evaluate(() => ({ latch: CR.latch, pressed: document.getElementById('cr-latch').getAttribute('aria-pressed') }));
  ok(!hold.latch && hold.pressed === 'false', 'Latch toggles', JSON.stringify(hold));
  await page.click('#cr-on');
  const off = await page.evaluate(() => ({ run: CR.run, txt: document.getElementById('cr-on').textContent }));
  ok(!off.run && off.txt === 'Off', 'switching it off stops it', JSON.stringify(off));
  await page.click('#cr-pick'); await page.waitForTimeout(200);
  const list = await page.evaluate(() => [...document.querySelectorAll('.modal-overlay .ll-act b')].map(b => b.textContent));
  ok(list[0] === 'Off' && list.includes('Strum') && list.includes('Funk') && list.includes('Draw a new rhythm…') && !list.includes('Hold') && !list.includes('As played'), 'the Rhythm list: Off, the built-ins that have hits, Draw a new rhythm', JSON.stringify(list));
  await page.evaluate(() => [...document.querySelectorAll('.modal-overlay .ll-act')].find(b => b.firstChild.textContent === 'Bossa').click());
  const chosen = await page.evaluate(() => ({ key: CR.key, on: CR.on, name: document.getElementById('cr-name').textContent, saved: JSON.parse(localStorage.getItem('modo-chord-rhythm')) }));
  ok(chosen.key === 'bossa' && chosen.on && chosen.name === 'Bossa' && chosen.saved.key === 'bossa' && chosen.saved.on, 'choosing a rhythm arms it, names it and keeps it for next time', JSON.stringify(chosen));
  await page.click('#cr-draw'); await page.waitForTimeout(200);
  const roll = await page.evaluate(() => ({ open: !!document.querySelector('.rhy-sheet'), hits: [...document.querySelectorAll('.rhy-sheet .rhy-hint')].map(h => h.textContent)[0] }));
  ok(roll.open, 'Draw opens the roll on the rhythm the pads use', JSON.stringify(roll));
  await page.evaluate(() => [...document.querySelectorAll('.rhy-sheet button')].find(b => b.textContent === 'Save').click());
  const used = await page.evaluate(() => ({ key: CR.key, custom: /^u:/.test(CR.key) || CR.key === 'bossa', def: !!CR.def || CR.key === 'bossa' }));
  ok(used.custom, 'Save in the pads\' roll sets the chord rhythm', JSON.stringify(used));

  // The roll opened from Song Build fires that chord, not the last one tapped.
  const sb = await page.evaluate(async () => {
    const o = {};
    const slot = { rootM: 62, triadQ: 1, type7: 'min7', ext: 'triad', bars: 1, beats: 0, eighths: 0, label: 'Dm', bassNote: 57 };
    CR.chord = { root: 60, intvs: [0, 4, 7] };
    sbDrawRhythm(slot, () => { });
    const sheet = document.querySelector('.rhy-sheet');
    const cv = sheet.querySelector('canvas'); const r = cv.getBoundingClientRect(), cw = r.width / 16;
    const x = r.left + 0.5 * cw, y = r.top + 40; cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
    [...sheet.querySelectorAll('button')].find(b => b.textContent.indexOf('Audition') >= 0).click();
    o.chord = CR.previewChord && { root: CR.previewChord.root, intvs: CR.previewChord.intvs.slice() };
    document.querySelector('.rhy-sheet .ll-cancel').click();
    o.after = !crPreviewOn();
    return o;
  });
  ok(sb.chord && sb.chord.root === 62 && sb.chord.intvs[0] === 57 - 12 - 62 && sb.chord.intvs.indexOf(3) >= 0 && sb.after, 'opened from Song Build, the roll fires that chord (its notes and its slash bass), not the last one tapped', JSON.stringify(sb));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
