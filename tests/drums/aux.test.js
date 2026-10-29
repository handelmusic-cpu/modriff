/* The Aux sequencer (4.9.9.9.9.9.6e): its own roll on Live and its own bank of eight patterns.
   - The Aux grid is a Live widget, always the Aux layer; a cell steps off > on > accent > off.
   - A1-A8 hold the Aux layer only: choosing one never touches the kit or P1-P8, saving one
     keeps the roll, an empty slot starts as a copy, Clr empties it.
   - Playing, a pick waits for the loop to come round and the kit goes on untouched.
   - A groove load keeps the Aux line that was there in its slot.
   - The bank rides the rig (_sqCaptureState / _sqRestoreState) and, in Studio, the Drum
     Patterns panel is the Aux bank while the Aux layer is the one being edited.
   Run: node tests/drums/aux.test.js   Env: CHROMIUM, PLAYWRIGHT */
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
    const hits = g => { let n = 0; Object.keys(g || {}).forEach(k => (g[k] || []).forEach(c => { if (c && c.v > 0) n++; })); return n; };
    const st = () => window._sqCaptureState();
    const tap = (host, lane, step) => { const el = host.querySelectorAll('.sq-xlane')[lane].querySelectorAll('.sq-xc')[step]; el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return el; };
    const cells = () => document.querySelector('#sq-xstrip');
    o.widget = { has: !!cells(), focusIsKit: document.querySelector('#sq-layerRow') == null || true, lanes: cells() && cells().querySelectorAll('.sq-xlane').length, slots: cells() && cells().querySelectorAll('.sq-pslot').length, name: cells() && cells().querySelector('.sq-xname').textContent };
    o.liveSlots = LV.slots.join(',');

    // A cell steps off > on > accent > off.
    const h = cells();
    const el = tap(h, 0, 0); o.t1 = [el.classList.contains('on'), el.classList.contains('accent')];
    tap(cells(), 0, 0); o.t2 = [cells().querySelectorAll('.sq-xlane')[0].querySelectorAll('.sq-xc')[0].classList.contains('on'), cells().querySelectorAll('.sq-xlane')[0].querySelectorAll('.sq-xc')[0].classList.contains('accent')];
    tap(cells(), 0, 0); o.t3 = [cells().querySelectorAll('.sq-xlane')[0].querySelectorAll('.sq-xc')[0].classList.contains('on'), cells().querySelectorAll('.sq-xlane')[0].querySelectorAll('.sq-xc')[0].classList.contains('accent')];
    // Make a line: three hits on lane 0 and two on lane 2.
    [0, 4, 8].forEach(s => tap(cells(), 0, s)); [2, 10].forEach(s => tap(cells(), 2, s));
    o.line = hits(st().aux.grid);
    const kit0 = JSON.stringify(st().grid);

    // Save to A1, pick the empty A2: it keeps what is on screen (a copy to vary), then change it and A1 is not touched.
    const slotBtn = i => cells().querySelectorAll('.sq-pslot')[i];
    [...cells().querySelectorAll('.sq-xedit')].find(b => b.textContent === 'Save').click();
    o.saved = !!st().auxPats && !!st().auxPats[0];
    slotBtn(1).click();
    o.copy = { cur: document.querySelector('#sq-xstrip .sq-pslot.edit') && document.querySelector('#sq-xstrip .sq-pslot.edit').textContent, hits: hits(st().aux.grid) };
    tap(cells(), 3, 5); tap(cells(), 3, 6);
    o.edited = hits(st().aux.grid);
    slotBtn(0).click();                                   // back to A1: A2's edit was kept in A2, A1 loads as saved
    o.backA1 = hits(st().aux.grid);
    slotBtn(1).click();
    o.A2 = hits(st().aux.grid);
    o.kitUntouched = JSON.stringify(st().grid) === kit0;

    // Clr empties the roll and the slot, with an undo.
    [...cells().querySelectorAll('.sq-xedit')].find(b => b.textContent === 'Clr').click();
    o.cleared = { hits: hits(st().aux.grid), slot: !!(st().auxPats && st().auxPats[1]) };
    slotBtn(0).click();
    o.reload = hits(st().aux.grid);

    // The Drum Patterns panel in Studio is the Aux bank while Aux is the layer being edited.
    document.body.classList.remove('mode-basic'); if (typeof setPerformMode === 'function') try { setPerformMode('chords'); } catch (e) { }
    window._sqSetFocus(1);
    o.panel = { title: document.getElementById('sq-ptitle').textContent, first: document.querySelector('#sq-pslots .sq-pslot').textContent, chainHidden: document.getElementById('sq-chainRow').style.display === 'none' };
    window._sqSetFocus(0);
    o.panelKit = { title: document.getElementById('sq-ptitle').textContent, chain: document.getElementById('sq-chainRow').style.display };

    // The bank rides the rig.
    const cap = JSON.parse(JSON.stringify(st()));
    o.cap = { n: cap.auxPats.filter(Boolean).length, cur: cap.auxCur };
    window._sqRestoreState(Object.assign({}, cap, { auxPats: [null, null, null, null, null, null, null, null], auxCur: 0 }));
    o.restoredEmpty = st().auxPats === undefined;
    window._sqRestoreState(cap);
    o.restored = { n: st().auxPats.filter(Boolean).length, cur: st().auxCur };
    // A state with no bank (every older rig) leaves the bank alone.
    const noBank = JSON.parse(JSON.stringify(cap)); delete noBank.auxPats; delete noBank.auxCur;
    window._sqRestoreState(noBank);
    o.keptByOld = st().auxPats && st().auxPats.filter(Boolean).length;
    return o;
  });
  ok(r.widget.has && r.widget.lanes >= 5 && r.widget.slots === 8 && r.widget.name === 'Aux' && /aux/.test(r.liveSlots), 'the Aux roll is a Live widget: its own lanes, eight slots', JSON.stringify([r.widget, r.liveSlots]));
  ok(r.t1[0] && !r.t1[1] && r.t2[1] && !r.t3[0] && !r.t3[1], 'a cell steps off > on > accent > off', JSON.stringify([r.t1, r.t2, r.t3]));
  ok(r.line === 5, 'the roll takes a line', String(r.line));
  ok(r.saved, 'Save keeps the roll in the Aux bank', '');
  ok(r.copy.hits === 5 && r.copy.cur === 'A2' + (r.copy.cur === 'A2' ? '' : ''), 'an empty slot starts as a copy of what is on screen', JSON.stringify(r.copy));
  ok(r.edited === 7 && r.backA1 === 5 && r.A2 === 7, 'each slot keeps its own pattern', JSON.stringify([r.edited, r.backA1, r.A2]));
  ok(r.kitUntouched, 'choosing and saving Aux patterns never touches the kit', '');
  ok(r.cleared.hits === 0 && !r.cleared.slot && r.reload === 5, 'Clr empties the roll and its slot; the other slot is intact', JSON.stringify([r.cleared, r.reload]));
  ok(r.panel.title === 'Aux Patterns' && /^A1/.test(r.panel.first) && r.panel.chainHidden && r.panelKit.title === 'Drum Patterns' && r.panelKit.chain === '', 'in Studio the Drum Patterns panel is the Aux bank while Aux is the layer edited, and the kit\'s again after', JSON.stringify([r.panel, r.panelKit]));
  ok(r.cap.n === 2 && r.restored.n === 2 && r.restored.cur === r.cap.cur && r.restoredEmpty, 'the bank rides the rig and comes back', JSON.stringify([r.cap, r.restored, r.restoredEmpty]));
  ok(r.keptByOld === 2, 'a rig with no bank leaves the bank alone', String(r.keptByOld));

  // Playing: the kit goes on, and a queued Aux pick lands on the loop wrap.
  const p2 = await page.evaluate(async () => {
    const o = {};
    document.body.classList.add('mode-basic'); lvMount();
    document.getElementById('bpm').value = 220;
    const hits = g => { let n = 0; Object.keys(g || {}).forEach(k => (g[k] || []).forEach(c => { if (c && c.v > 0) n++; })); return n; };
    const st = () => window._sqCaptureState();
    if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) { } }
    await audioCtx.resume();
    window._sqRestoreState(Object.assign({}, st(), { auxPats: st().auxPats, auxCur: 0 }));
    const A = st().auxPats; o.start = { cur: st().auxCur, hits: hits(st().aux.grid), a1: hits(A[0].grid), a2: hits(A[1] ? A[1].grid : {}) };
    document.getElementById('ft-playstop-btn').click();      // play
    await new Promise(r => setTimeout(r, 400));
    o.playing = window._sqPlaying();
    const kit = JSON.stringify(st().grid);
    const pick = document.querySelectorAll('#sq-xstrip .sq-pslot')[1];
    // A2 is empty after the Clr above: queue A3, which is empty too and so must keep the line.
    document.querySelectorAll('#sq-xstrip .sq-pslot')[2].click();
    o.queued = !!document.querySelector('#sq-xstrip .sq-pslot.nextup');
    await new Promise(r => setTimeout(r, 2600));         // a 16-step loop at 220 bpm is about 1.1 s
    o.landed = { cur: st().auxCur, nextup: !!document.querySelector('#sq-xstrip .sq-pslot.nextup'), hits: hits(st().aux.grid) };
    o.kitGoesOn = JSON.stringify(st().grid) === kit;
    document.getElementById('ft-playstop-btn').click();
    return o;
  });
  ok(p2.start.cur === 0 && p2.start.a1 === 5, 'A1 is where it was', JSON.stringify(p2.start));
  ok(p2.playing && p2.queued, 'playing, a pick is queued (nextup) rather than made', JSON.stringify(p2));
  ok(p2.landed.cur === 2 && !p2.landed.nextup && p2.kitGoesOn, 'it lands on the loop wrap and the kit is not touched', JSON.stringify([p2.landed, p2.kitGoesOn]));

  // A groove load keeps the Aux line that was there.
  const g = await page.evaluate(() => {
    const o = {};
    const hits = g => { let n = 0; Object.keys(g || {}).forEach(k => (g[k] || []).forEach(c => { if (c && c.v > 0) n++; })); return n; };
    const st = () => window._sqCaptureState();
    window._sqRestoreState(Object.assign({}, st(), { auxPats: [null, null, null, null, null, null, null, null], auxCur: 0 }));
    const A0 = JSON.parse(JSON.stringify(st().aux.grid));
    // Put a known line on the Aux layer.
    const h = document.querySelector('#sq-xstrip'); [0, 5, 9].forEach(s => h.querySelectorAll('.sq-xlane')[1].querySelectorAll('.sq-xc')[s].dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    o.before = hits(st().aux.grid);
    const idx = RHYTHMS.findIndex(r => r.name === 'Samba'); sqLoadGroove(idx);
    o.after = hits(st().aux.grid);
    const bank = st().auxPats; o.slot0 = bank && bank[0] ? hits(bank[0].grid) : null;
    return o;
  });
  ok(g.before >= 3 && g.slot0 === g.before, 'a groove load puts the Aux line that was there into its slot first', JSON.stringify(g));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
