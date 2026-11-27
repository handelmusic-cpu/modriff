/* Tuplet switches (a tuplet's own hits): what plays, what the grid shows and what each editor and writer does.

   The real page, its own scheduler on a fake clock for the sound (as drumgrid.test.js), real touch for the grid.

   Run: node tests/seq/tuplet.test.js
   Env: CHROMIUM, PLAYWRIGHT, URL (a server already running, e.g. dist/). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
const near = (a, b, e) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= (e || 1e-6));

function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

// ── in the page: put cells on the 808 (lanes 0, 1) and hear one bar of them on a fake clock ──────────
function installHarness() {
  window.T = {
    // The live cells (the page hands its own grids to the autosave), and the lanes as drawn.
    c: (ti, s) => window._sqCaptureState().grid[ti][s],
    aux: (ti, s) => window._sqCaptureState().aux.grid[ti][s],
    lane: ti => document.querySelector(`#sq-gInner .sq-grow[data-ti="${ti}"]`),
    sel() { const e = [...document.querySelectorAll('#sq-gInner .sq-step.sel')]; if (e.length !== 1) return 'marked ' + e.length;
      const box = e[0].parentNode; return box.classList.contains('sq-tup') ? [box.dataset.ti, box.dataset.s, e[0].dataset.hi].join() : 'a step'; },
    cell: o => Object.assign({ v: 1, r: 1, rs: 1, orn: 0, vel: 100 }, o),
    row: (cells, n) => Array.from({ length: n || 16 }, (_, s) => cells[s] ? T.cell(cells[s]) : T.cell({ v: 0 })),
    load(lanes, steps) {
      steps = steps || 16;
      const grid = {};
      for (let ti = 0; ti < 12; ti++) grid[ti] = T.row(lanes[ti] || {}, steps);
      window._sqRestoreState({ steps, swing: 0, mach: '808', grid, vols: {}, pitches: {}, kitOn: true, aux: { mach: 'PERC', grid: {}, on: false } });
      window._sqEnsureGrid();
    },
    // One bar from step 0, which lands on t = 1 s at 120 BPM (a step is 0.125 s). Times are returned from that point.
    play() {
      const sent = [], fake = { currentTime: 0, sampleRate: 48000, state: 'running' };
      const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready }, realCtx = getCtx, realAudio = audioCtx;
      clearTimeout(clockTimer);
      document.getElementById('bpm').value = 120; sqRateMul = 1; drumsEnabled = true; window.setHumanize(0);
      E.send = m => { if (m.kind === 'hit') sent.push(Object.assign({}, m)); };
      E.now = () => fake.currentTime; E.ready = () => true; window.getCtx = () => fake; audioCtx = fake;
      try {
        fake.currentTime = -100; CLOCK_EPOCH = 1; CLOCK_EPOCH_BPM = 120;
        window._sqResetStep(); window._sqResync(); window._barAnnouncedT = -1;
        for (fake.currentTime = 0.0013; fake.currentTime < 3.2; fake.currentTime += 0.0371) {
          _schedHorizon = Math.min(2.999, fake.currentTime + LOOK_AHEAD); window._sqScheduler(); _schedHorizon = null;
        }
      } finally { E.send = keep.send; E.now = keep.now; E.ready = keep.ready; window.getCtx = realCtx; audioCtx = realAudio; _schedHorizon = null; }
      return sent.filter(m => m.at < 2.999).sort((a, b) => a.at - b.at || a.lane - b.lane)
        .map(m => ({ t: Math.round((m.at - 1) * 1e6) / 1e6, lane: m.lane, dyn: m.dyn, accent: m.accent, pitch: m.pitch }));
    },
  };
}

// A page that stops answering would otherwise hang the run for good.
const watchdog = setTimeout(() => { console.log('FAIL the run did not finish in four minutes'); process.exit(3); }, 240000);

(async () => {
  const srv = process.env.URL ? null : await serve();
  const url = process.env.URL || 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(url); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.evaluate(() => { document.dispatchEvent(new CustomEvent('sq-start-request')); });
  await page.waitForTimeout(1500);
  await page.evaluate(installHarness);

  await playback(page);

  const d = await drumPage(browser, url, errs);
  await grid(d);
  await editor(d);
  await ghostPress(browser, url, errs);
  await writers(d);
  await leftovers(d);

  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  await browser.close(); if (srv) srv.close();
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();

// ── Task 2: the hit list and what it plays ───────────────────────────────────────────────
async function playback(page) {
  console.log('playback:');
  const has = await page.evaluate(() => !!window._sqTup);
  ok(has, 'the page has the tuplet hit list (window._sqTup)', 'undefined');
  if (!has) return;
  const r = await page.evaluate(() => {
    const A = window._sqTup, out = {}, five = o => T.cell(Object.assign({ v: 2, vel: 80, r: 5, rs: 4 }, o));
    const go = (c, key) => { T.load({ 0: { 0: c } }); out[key] = T.play(); };
    go(five(), 'plain');
    go(A.make(five()), 'made');
    let c = A.make(five()); c.hits[1].v = 0; c.hits[3].v = 0; go(c, 'gaps');
    c = A.make(five()); c.hits.forEach((h, i) => { h.v = i === 2 ? 2 : 0; }); c.hits[2].r = 2; c.hits[2].p = 5; go(c, 'one');
    c = A.make(five()); c.hits.forEach(h => { h.v = 0; }); go(c, 'off');
    out.offAt = A.at(T.row({ 0: c }), 2); out.offSounds = A.sounds(c);
    const a = A.make(five()), b = A.make(five());
    [1, 3].forEach(i => { a.hits[i].v = 0; }); [0, 2, 4].forEach(i => { b.hits[i].v = 0; });
    T.load({ 0: { 0: a }, 1: { 0: b } }); out.split = T.play();
    c = five({ hits: [{ v: 1, vel: 50 }, { v: 0, vel: 50 }, { v: 1, vel: 50 }] });
    out.shortLen = A.hits(c).length; out.shortKept = c.hits.length; go(c, 'short');
    c = five({ hits: Array.from({ length: 9 }, () => ({ v: 1, vel: 50 })) }); out.longLen = A.hits(c).length; go(c, 'long');
    c = A.make(five()); const copy = A.clone(c); copy.hits[0].vel = 5; out.deep = c.hits[0].vel;
    const g = x => ({ 0: [x] }), base = five();
    const s0 = A.sig(g(base), 1);
    out.sigR = A.sig(g(five({ r: 6 })), 1) !== s0; out.sigRs = A.sig(g(five({ rs: 8 })), 1) !== s0;
    const m = A.make(five()), s1 = A.sig(g(m), 1); m.hits[1].v = 0; out.sigHit = A.sig(g(m), 1) !== s1;
    out.sigPlain = A.sig(g(T.cell({ vel: 70 })), 1);
    // remove and a change of type
    c = A.make(five({ p: 3 })); c.hits[0].v = 0; c.hits[2].vel = 11; A.setType(c, 7, 4);
    out.typed = { r: c.r, rs: c.rs, n: c.hits.length, h0: c.hits[0].v, h2: c.hits[2].vel, h2v: c.hits[2].v };
    A.remove(c); out.removed = { v: c.v, r: c.r, rs: c.rs, hits: c.hits === undefined, p: c.p };
    c = five(); A.setType(c, 3, 2); out.typedPlain = { r: c.r, rs: c.rs, hits: c.hits === undefined, vel: c.vel };
    return out;
  });
  const T5 = [0, .1, .2, .3, .4], t = a => a.map(x => x.t), dyn = a => a.map(x => x.dyn);
  ok(near(t(r.plain), T5) && near(dyn(r.plain), [.8, .6, .6, .6, .6]) && r.plain.map(x => x.accent).join() === 'true,false,false,false,false', 'no list: five hits, the first accented, the rest at 75%', JSON.stringify(r.plain));
  ok(near(t(r.made), T5) && near(dyn(r.made), dyn(r.plain), .005) && r.made.map(x => x.accent).join() === r.plain.map(x => x.accent).join(), 'a list made from it sounds the same', JSON.stringify(r.made));
  ok(near(t(r.gaps), [0, .2, .4]), 'hits 2 and 4 off: three hits where 1, 3 and 5 were', JSON.stringify(r.gaps));
  ok(near(t(r.one), [.2, .25]) && r.one.map(x => x.pitch).join() === '5,5' && r.one.map(x => x.accent).join() === 'true,false' && near(dyn(r.one), [.6, .45]), 'one hit with ratchet 2 and pitch +5: two strokes inside its own length', JSON.stringify(r.one));
  ok(r.off.length === 0 && r.offAt === 0 && r.offSounds === false, 'all off: silent, still a tuplet over its steps', JSON.stringify([r.off, r.offAt, r.offSounds]));
  ok(near(t(r.split), T5) && r.split.map(x => x.lane).join() === '0,1,0,1,0', 'two lanes split a 5:4 between them', JSON.stringify(r.split));
  ok(r.shortLen === 5 && r.shortKept === 3 && near(t(r.short), [0, .2, .3, .4]), 'a list that is too short is padded on read', JSON.stringify([r.shortLen, r.shortKept, t(r.short)]));
  ok(r.longLen === 5 && near(t(r.long), T5), 'a list that is too long is cut on read', JSON.stringify([r.longLen, t(r.long)]));
  ok(r.deep === 80, 'a copy of a cell has its own hits', r.deep);
  ok(r.sigR && r.sigRs && r.sigHit, 'the pattern signature sees r, rs and a hit', JSON.stringify([r.sigR, r.sigRs, r.sigHit]));
  ok(r.sigPlain === '0:0:1:70:0', 'a plain step signs as it always did', r.sigPlain);
  ok(JSON.stringify(r.typed) === JSON.stringify({ r: 7, rs: 4, n: 7, h0: 0, h2: 60, h2v: 1 }), 'another type keeps hit 1 and rebuilds the rest', JSON.stringify(r.typed));
  ok(JSON.stringify(r.removed) === JSON.stringify({ v: 0, r: 1, rs: 1, hits: true, p: 3 }), 'removing leaves the step with hit 1\'s settings', JSON.stringify(r.removed));
  ok(JSON.stringify(r.typedPlain) === JSON.stringify({ r: 3, rs: 2, hits: true, vel: 80 }), 'without a list only the type changes', JSON.stringify(r.typedPlain));
}

// ── the drum page on a phone, with real touch ─────────────────────────────────────────────
async function drumPage(browser, url, errs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(url); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('studio'); switchTab('accomp'); setAccompMode('drums'); }); await page.waitForTimeout(700);
  await page.evaluate(installHarness);
  const cdp = await ctx.newCDPSession(page);
  // A finger on the middle of one element. `wait` after it: past the double-tap window unless the next tap is the pair's.
  // `still`: tap where it is, without scrolling it to the middle first.
  const tap = async (sel, wait, still) => {
    const b = await page.evaluate(([sel, still]) => { const e = document.querySelector(sel); if (!e) return null;
      if (!still) e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e }; }, [sel, !!still]);
    if (!b) return { missing: sel };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(wait == null ? 450 : wait);
    return b;
  };
  const show = (lanes, steps) => page.evaluate(([lanes, steps]) => { sqClearSelForTest(); T.load(lanes, steps); window._sqRenderGrid(); }, [lanes, steps]);
  await page.evaluate(() => { window.sqClearSelForTest = () => { if (window._sqClearSel) window._sqClearSel(); }; });
  return { page, ctx, tap, show };
}
const hit = (ti, s, i) => `#sq-gInner .sq-tup[data-ti="${ti}"][data-s="${s}"] .sq-hit[data-hi="${i}"]`;

// ── Task 4: the switches ─────────────────────────────────────────────────────────────
async function grid(d) {
  console.log('grid:');
  const { page, tap, show } = d, five = { 0: { v: 1, r: 5, rs: 4 } };
  await show({ 0: five });
  const widths = () => page.evaluate(() => [0, 1].map(ti => { const lane = T.lane(ti), last = lane.lastElementChild, row = lane.getBoundingClientRect();
    return Math.round((last.getBoundingClientRect().right - row.left) * 10) / 10; }));
  const n = await page.evaluate(() => ({ hits: document.querySelectorAll('#sq-gInner .sq-tup .sq-hit').length,
    nums: [].map.call(document.querySelectorAll('#sq-gInner .sq-tup .sq-hn'), e => e.textContent).join(''),
    lit: [].map.call(document.querySelectorAll('#sq-gInner .sq-tup .sq-hit'), e => e.classList.contains('on') ? 1 : 0).join('') }));
  ok(n.hits === 5 && n.nums === '12345' && n.lit === '11111', 'a 5:4 is five numbered switches, all on', JSON.stringify(n));
  if (!n.hits) return;
  let w = await widths();
  ok(Math.abs(w[0] - w[1]) <= 1, 'its row is as wide as a row of steps', w.join(' / '));
  await page.evaluate(() => gridZoomSet(2, { kind: 'sq' })); await page.waitForTimeout(300);
  w = await widths();
  const sizes = await page.evaluate(() => ({ hit: document.querySelector('#sq-gInner .sq-hit').getBoundingClientRect().width, step: T.lane(1).firstElementChild.getBoundingClientRect().width }));
  ok(Math.abs(w[0] - w[1]) <= 1 && Math.abs(sizes.hit / sizes.step - .8) < .06, 'and still is pinched wider, each switch four fifths of a step', JSON.stringify([w, sizes]));
  await page.evaluate(() => gridZoomSet(1, { kind: 'sq' })); await page.waitForTimeout(300);

  const geo = await page.evaluate(() => {
    const A = window._sqTup, row = T.row({ 12: { v: 1, r: 5, rs: 8 } }), five = T.row({ 0: { v: 1, r: 5, rs: 4 } });
    return { span: A.layout(row, 16).filter(x => x.tup).map(x => x.s + ':' + x.span).join(), at: [0, .9, 3.99, 4].map(p => { const h = A.hitAt(five, p); return h ? h.hi : null; }) };
  });
  ok(geo.span === '12:4', 'a tuplet past the end takes the room there is', geo.span);
  ok(JSON.stringify(geo.at) === '[0,1,4,null]', 'the hit sounding at a moment', JSON.stringify(geo.at));

  const vs = (ti, s) => page.evaluate(([ti, s]) => { const c = T.c(ti, s); return { v: c.v, list: c.hits ? c.hits.map(h => h.v).join('') : null, sel: T.sel() }; }, [ti, s]);
  await show({ 0: { 0: { v: 1, r: 7, rs: 4 } } });
  const t1 = await tap(hit(0, 0, 1)); const a1 = await vs(0, 0);
  ok(t1.hit && a1.list === '1011111', 'a finger on hit 2 of a 7:4 switches off that hit only', JSON.stringify([t1, a1]));
  await tap(hit(0, 0, 1)); ok((await vs(0, 0)).list === '1111111', 'and back on', JSON.stringify(await vs(0, 0)));

  await show({ 0: five });
  await tap(hit(0, 0, 2), 80); await tap(hit(0, 0, 2));
  const a2 = await vs(0, 0);
  ok(a2.list === null && a2.v === 1 && a2.sel === '0,0,2', 'a double tap on a lit hit selects it and changes nothing, no list left behind', JSON.stringify(a2));
  await tap(hit(0, 0, 4)); await tap(hit(0, 0, 4), 80); await tap(hit(0, 0, 4));
  const a3 = await vs(0, 0);
  ok(a3.list === '11111' && a3.sel === '0,0,4', 'a double tap on a dark hit lights and selects it', JSON.stringify(a3));

  await page.evaluate(() => { _tapEdit = true; });
  await show({ 0: five });
  await tap(hit(0, 0, 3)); const e1 = await vs(0, 0); await tap(hit(0, 0, 3)); const e2 = await vs(0, 0);
  await page.evaluate(() => { _tapEdit = false; });
  ok(e1.list === null && e1.sel === '0,0,3' && e2.list === '11101', 'Tap: Edit selects first and switches off on the second touch', JSON.stringify([e1, e2]));

  await show({ 0: { 0: { v: 1, r: 5, rs: 4 }, 2: { v: 1, r: 3, rs: 2 } } });
  const tups = () => page.evaluate(() => [].map.call(document.querySelectorAll('#sq-gInner .sq-tup[data-ti="0"]'), e => e.dataset.s).join());
  const c1 = await tups();
  await page.evaluate(() => { window._sqTup.remove(T.c(0, 0)); window._sqTup.sync(); });
  const c2 = await tups();
  ok(c1 === '0' && c2 === '2', 'a tuplet under another draws nothing until the first is removed', c1 + ' then ' + c2);

  await show({ 0: five, 1: { 4: { v: 1, r: 7, rs: 4 } } });
  // An automatic start is refused while the page's audio is still waking, so ask until it plays.
  for (let k = 0; k < 8 && !(await page.evaluate(() => window._sqPlaying())); k++) { await page.evaluate(() => { document.dispatchEvent(new CustomEvent('sq-start-request')); }); await page.waitForTimeout(700); }
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window._sqPlaying()), 'the drum sequencer starts', '');
  const sample = () => page.evaluate(() => [0, 1, 2].map(ti => { const row = T.lane(ti); const l = row.querySelectorAll('.sq-step.head');
    return { n: l.length, boxes: row.querySelectorAll('.sq-tup.head').length, hit: l.length && l[0].dataset.hi != null ? +l[0].dataset.hi : -1 }; }));
  const seen = new Set(); let worst = null;
  for (let k = 0; k < 70; k++) {
    if (k === 30) await page.evaluate(() => { window._sqTup.setType(T.c(0, 0), 3, 2); window._sqTup.sync(); });
    await page.waitForTimeout(47);
    const s = await sample();
    s.forEach(x => { if (x.n > 1 || x.boxes) worst = s; });
    if (k !== 30 && s.some(x => x.n !== 1)) worst = worst || s;
    if (s[0].hit >= 0) seen.add(s[0].hit);
  }
  await page.evaluate(() => { document.dispatchEvent(new CustomEvent('sq-stop-request')); }); await page.waitForTimeout(300);
  const left = await page.evaluate(() => document.querySelectorAll('#sq-gInner .sq-step.head').length);
  ok(!worst, 'while playing, one lit element a lane, never a tuplet\'s box, through a change of type', JSON.stringify(worst));
  ok(seen.size >= 3 && left === 0, 'the playhead walks the hits and is put out on stop', JSON.stringify([[...seen], left]));

  const x = await page.evaluate(async () => {
    let host = document.getElementById('sq-xstrip'); if (!host) { host = document.createElement('div'); host.id = 'sq-xstrip'; document.body.appendChild(host); }
    window._sqRestoreState({ steps: 16, mach: '808', grid: {}, aux: { mach: 'PERC', grid: { 0: T.row({ 0: { v: 1, r: 5, rs: 4 } }) }, on: true } });
    window._sqEnsureGrid(); window._sqRenderGrid();
    const q = () => host.querySelectorAll('.sq-xtup .sq-xhit'), n = q().length, seq = [];
    for (let k = 0; k < 3 && n; k++) { q()[2].dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); seq.push(T.aux(0, 0).hits[2].v); }
    return { n, seq: seq.join() };
  });
  ok(x.n === 5 && x.seq === '2,0,1', 'the Live Aux roll shows the same switches; a tap steps one hit on, accent, off', JSON.stringify(x));
}

// ── Task 5: the editor under the grid ────────────────────────────────────────────────
async function editor(d) {
  console.log('editor:');
  const { page, tap, show } = d;
  const insp = () => page.evaluate(() => { const h = document.getElementById('sq-insp'), btn = [...h.querySelectorAll('button')].map(b => b.textContent);
    const vel = h.querySelector('.pr-insp-vel');
    return { open: h.classList.contains('open'), head: (h.querySelector('.pr-insp-what') || {}).textContent || '', dash: btn.filter(x => x === '—').length,
      remove: btn.filter(x => /^Remove /.test(x)).join(), vel: vel ? +vel.value : null }; });
  // press a button by its label, inside the group whose caption is `group` (or anywhere in the editor)
  const press = (label, group) => page.evaluate(([label, group]) => { const h = document.getElementById('sq-insp');
    const scope = group ? [...h.querySelectorAll('.pr-insp-grp')].find(g => g.querySelector('.pr-insp-lbl').textContent === group) : h;
    const b = scope && [...scope.querySelectorAll('button')].find(b => b.textContent === label); if (!b) return false; b.click(); return true; }, [label, group]);
  const cell = (s) => page.evaluate(s => { const c = T.c(0, s); return JSON.parse(JSON.stringify({ v: c.v, r: c.r, rs: c.rs, vel: c.vel, p: c.p || 0, pr: c.pr || 0, orn: c.orn || 0, hits: c.hits || null })); }, s);
  const sel = () => page.evaluate(() => T.sel());
  const dbl = async (q) => { await tap(q, 80); await tap(q); };

  await show({ 0: { 0: { v: 1, r: 5, rs: 4 } } });
  await dbl(hit(0, 0, 1));
  let i = await insp(), c = await cell(0);
  const off = () => page.evaluate(() => [...document.querySelectorAll('#sq-insp button')].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + .5; }).map(b => b.textContent).join());
  ok(await off() === '', 'every button of the editor is on a 390 pt screen, Remove tuplet too', await off());
  ok(i.open && /· step 1 · hit 2 of 5$/.test(i.head) && i.vel === 75 && c.hits === null, 'opening a hit names it, shows what it plays with, and writes nothing', JSON.stringify([i, c]));
  ok(i.dash === 0 && i.remove === 'Remove tuplet', 'no dash buttons; only the tuplet is there to remove', JSON.stringify(i));
  await press('Flam', 'Orn'); i = await insp(); c = await cell(0);
  ok(c.hits && c.hits[1].orn === 1 && c.hits[0].orn === 0 && /Remove ornament/.test(i.remove), 'Flam goes on that hit alone, and can be removed', JSON.stringify([c.hits, i.remove]));
  await press('Remove ornament'); i = await insp(); c = await cell(0);
  ok(c.hits[1].orn === 0 && !/ornament/.test(i.remove), 'Remove ornament', JSON.stringify([c.hits[1], i.remove]));
  await press('+', 'Ratchet'); await press('+', 'Ratchet'); c = await cell(0); i = await insp();
  ok(c.hits[1].r === 3 && c.r === 5 && c.rs === 4 && /Remove ratchet/.test(i.remove), 'a ratchet inside one hit leaves the tuplet alone', JSON.stringify(c));
  await press('Remove ratchet'); c = await cell(0); i = await insp();
  ok(c.hits[1].r === 1 && !/ratchet/.test(i.remove), 'Remove ratchet', JSON.stringify([c.hits[1], i.remove]));
  await page.evaluate(() => { const s = document.querySelector('#sq-insp .pr-insp-vel'); s.value = '33'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await press('+', 'Pitch'); await press('−', 'Prob'); await press('Accent'); c = await cell(0);
  ok(JSON.stringify(c.hits[1]) === JSON.stringify({ v: 2, vel: 33, p: 1, pr: 90, orn: 0, r: 1 }) && c.hits[2].vel === 75 && c.pr === 0, 'velocity, pitch, probability and accent are the hit\'s own', JSON.stringify(c.hits));
  await press('✕'); c = await cell(0); i = await insp();
  ok(c.hits[1].v === 0 && i.open && await sel() === '0,0,1', 'the cross switches the hit off and keeps it selected', JSON.stringify([c.hits[1], i.open, await sel()]));
  await press('7:4', 'Tuplet'); c = await cell(0);
  ok(c.r === 7 && c.rs === 4 && c.hits.length === 7 && await page.evaluate(() => document.querySelectorAll('#sq-gInner .sq-hit').length) === 7, 'another type redraws with that many switches', JSON.stringify(c));
  await dbl(hit(0, 0, 0)); await press('✕'); await press('Remove tuplet'); c = await cell(0); i = await insp();
  ok(c.v === 0 && c.r === 1 && c.rs === 1 && c.hits === null && !i.open, 'Remove tuplet with hit 1 off leaves an empty step', JSON.stringify([c, i.open]));

  await show({});
  await tap(`#sq-gInner .sq-grow[data-ti="0"] > .sq-step:nth-child(1)`);
  i = await insp();
  ok(i.open && i.remove === '' && i.dash === 0, 'a plain step has nothing to remove and no dash', JSON.stringify(i));
  await press('+', 'Ratchet'); await press('Ruff', 'Orn'); i = await insp();
  ok(i.remove === 'Remove ratchet,Remove ornament', 'then a ratchet and an ornament to remove', i.remove);
  await press('Remove ratchet'); await press('Remove ornament'); c = await cell(0);
  ok(c.r === 1 && c.orn === 0, 'both removed', JSON.stringify(c));
  await press('5:4', 'Tuplet'); i = await insp();
  ok(await sel() === '0,0,0' && /hit 1 of 5$/.test(i.head), 'a step made a tuplet selects its first hit', JSON.stringify([await sel(), i.head]));
  await press('Remove tuplet'); c = await cell(0);
  ok(c.v === 1 && c.r === 1 && c.rs === 1 && c.hits === null && await sel() === 'a step', 'removing it gives the step back', JSON.stringify([c, await sel()]));

  await show({ 0: { 12: { v: 1 } } });
  const last = `#sq-gInner .sq-grow[data-ti="0"] > .sq-step:nth-child(13)`;
  await dbl(last);
  await press('5:8', 'Tuplet'); c = await cell(12);
  const toast = await page.evaluate(() => document.body.textContent.includes('5:8 would run past the end of the pattern'));
  ok(c.r === 1 && c.rs === 1 && toast, 'a tuplet that would run past the end is refused, and says so', JSON.stringify([c, toast]));
}

// Opening the editor scrolls the page under a finger that is still lifting: that press must not push a button there. (It
// did: a double tap on a lane in the middle of the screen could land on "Remove ratchet".) A page of its own each time,
// so the hint under the grid is still there as on a first visit.
async function ghostPress(browser, url, errs) {
  console.log('a press that opens the editor:');
  const q = '#sq-gInner .sq-grow[data-ti="1"] > .sq-step:nth-child(2)';
  const d = await drumPage(browser, url, errs), { page, tap, show } = d;
  await show({ 1: { 1: { r: 3 } } });
  await page.evaluate(() => { T.lane(1).scrollIntoView({ block: 'center' }); document.getElementById('sq-gScroll').scrollLeft = 0; });
  await page.waitForTimeout(400);
  await tap(q, 80, true); await tap(q, 600, true);
  const got = await page.evaluate(() => ({ r: T.c(1, 1).r, v: T.c(1, 1).v, open: document.getElementById('sq-insp').classList.contains('open') }));
  ok(got.r === 3 && got.v === 1 && got.open, 'a double tap on a ratcheted step opens the editor and presses nothing in it', JSON.stringify(got));
  // ...while a finger put down on a button of the editor still presses it.
  await tap('#sq-insp [aria-label="Remove ratchet"]', 450);
  const after = await page.evaluate(() => T.c(1, 1).r);
  ok(after === 1, 'and a tap that starts on the button presses it', after);
  // An assistive technology's activation is a click with no press of its own, some while after the last touch.
  await tap(q, 450); await tap(q, 80); await tap(q, 1000);
  const at = await page.evaluate(() => { const b = [...document.querySelectorAll('#sq-insp button')].find(b => b.textContent === 'Flam'); if (!b) return 'no editor';
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); return T.c(1, 1).orn; });
  ok(at === 1, 'a click that no touch made (assistive technology) still presses a button', at);
  await d.ctx.close();
}

// ── Task 6: what else writes drum cells ────────────────────────────────────────────────
async function writers(d) {
  console.log('other writers:');
  const { page, show } = d;
  const dark = '00000';
  const list = on => on.split('').map(v => ({ v: +v, vel: 90, p: 0, pr: 0, orn: 0, r: 1 }));
  await show({ 0: { 0: { v: 1, r: 5, rs: 4, hits: list(dark) } } });
  const a = await page.evaluate(() => { window._sqPlayIn(0, 2, false, 64); const c = T.c(0, 0);
    const one = { on: c.hits.map(h => h.v).join(''), vel: c.hits[3].vel, under: T.c(0, 2).v, lit: [...T.lane(0).querySelectorAll('.sq-hit')].map(e => e.classList.contains('on') ? 1 : 0).join('') };
    window._sqPlayIn(0, 0, true); one.head = c.hits === T.c(0, 0).hits ? '' : T.c(0, 0).hits.map(h => h.v).join(''); return one; });
  ok(a.on === '00010' && a.vel === 64 && a.under === 0 && a.lit === '00010', 'playing in at step 3 of a 5:4 lights the nearest hit (the fourth) at that velocity', JSON.stringify(a));
  ok(await page.evaluate(() => T.c(0, 0).hits.map(h => h.v).join('')) === '20010', 'and on its own step, the first hit', JSON.stringify(a));

  await show({ 0: { 0: { v: 1, r: 5, rs: 4 }, 1: { v: 1, vel: 55 } }, 1: { 1: { v: 1 } } });
  const b = await page.evaluate(() => { window._sqClearAt(1); const c = T.c(0, 0);
    return { on: c.hits ? c.hits.map(h => h.v).join('') : null, head: c.v, under: T.c(0, 1).vel + '/' + T.c(0, 1).v, other: T.c(1, 1).v }; });
  ok(b.on === '11011' && b.head === 1 && b.under === '55/1' && b.other === 0, 'clearing step 2 switches off the hit that starts in it, and leaves what is stored under', JSON.stringify(b));
  const b2 = await page.evaluate(() => { window._sqClearAt(0); return { on: T.c(0, 0).hits.map(h => h.v).join(''), head: T.c(0, 0).v }; });
  ok(b2.on === '00011' && b2.head === 1, 'clearing a tuplet\'s own step silences the two hits that start in it and keeps the tuplet', JSON.stringify(b2));

  await show({ 2: { 12: { v: 1, r: 5, rs: 4 } }, 3: { 6: { v: 1, r: 7, rs: 8, hits: list('1111111') } }, 4: { 0: { v: 1, r: 3, rs: 2 } } });
  const c = await page.evaluate(() => { window._sqFillRange(12, 16); const g = window._sqCaptureState().grid, over = [], kept = [];
    for (const ti in g) g[ti].forEach((c, s) => { if (c.v > 0 && c.r > 1 && c.rs > 1) { kept.push(ti + ':' + s); if (s + c.rs > 12) over.push(ti + ':' + s); } if (s >= 12 && c.hits) over.push('list ' + ti + ':' + s); });
    return { over, kept }; });
  ok(c.over.length === 0 && c.kept.join() === '4:0', 'a fill removes every tuplet that reaches into its stretch, and no other', JSON.stringify(c));

  const v = await page.evaluate(() => {
    let changed = 0, tries = 40, first = '';
    for (let k = 0; k < tries; k++) {
      const lanes = {}; for (let ti = 0; ti < 12; ti++) lanes[ti] = { 0: { v: 1, r: 5, rs: 4 }, 4: { v: 1, r: 5, rs: 4 }, 8: { v: 1, r: 5, rs: 4 }, 12: { v: 1, r: 5, rs: 4 } };
      T.load(lanes); window._sqSetStepsRaw(32, true);
      const g = window._sqCaptureState().grid;
      const n = document.querySelectorAll('#sq-gInner .sq-grow[data-ti]').length;   // the kit's lanes
      for (let ti = 0; ti < n; ti++) for (let s = 16; s < 28; s++) { const A = JSON.stringify(window._sqTup.clone(g[ti][s])), B = JSON.stringify(window._sqTup.clone(g[ti][s - 16])); if (A !== B) { changed++; if (!first) first = ti + ':' + s + ' ' + A + ' from ' + B + ' steps ' + window._sqSteps(); } }
    }
    return changed ? changed + ' cells, first ' + first : 0;
  });
  ok(v === 0, 'varying a lengthened pattern leaves the steps inside a tuplet alone (40 times over)', v);

  const m = await page.evaluate(() => {
    const A = window._sqTup; if (!A.lay) return null;
    const row = (on, vel) => ({ role: A.role('808', 'BD'), cells: T.row({ 0: { v: 1, r: 5, rs: 4, hits: on.split('').map(v => ({ v: +v, vel, p: 0, pr: 0, orn: 0, r: 1 })) } }) });
    const g = A.lay('808', [row('10101', 90), row('01010', 70)], 16), both = A.lay('808', [row('11000', 40), row('10000', 80)], 16);
    const plain = A.lay('808', [{ role: A.role('808', 'BD'), cells: T.row({ 0: { vel: 40 } }) }, { role: A.role('808', 'BD'), cells: T.row({ 0: { v: 2, vel: 80 } }) }], 16);
    const lane = x => Object.values(x).map(r => r[0]).find(c => c.v > 0);
    return { split: lane(g).hits.map(h => h.v + ':' + h.vel).join(), loud: lane(both).hits.map(h => h.v + ':' + h.vel).join(), plain: lane(plain).v + ':' + lane(plain).vel };
  });
  ok(m && m.split === '1:90,1:70,1:90,1:70,1:90', 'two halves of a split landing on one voice make the whole tuplet', JSON.stringify(m));
  ok(m && m.loud === '1:80,1:40,0:40,0:40,0:40' && m.plain === '2:80', 'where both sound the louder stays; plain steps collide as before', JSON.stringify(m));
}

// Patterns saved before this hold switched-off cells that still remember a tuplet (v 0, r 5, rs 4): the old cross, a tap
// off and a fill all left them. They look like plain steps, and switching one on must give a plain step: it used to bring
// the whole tuplet back, over whatever was drawn there, with neither of the editor's refusals.
async function leftovers(d) {
  console.log('switched-off tuplets from older saves:');
  const { page, tap, show } = d, old = { v: 0, r: 5, rs: 4 };
  const state = () => page.evaluate(() => { const c = T.c(0, 0); return { v: c.v, r: c.r, rs: c.rs, tups: [...document.querySelectorAll('#sq-gInner .sq-tup[data-ti="0"]')].map(e => e.dataset.s).join() }; });
  const plain = s => s.v > 0 && s.r === 1 && s.rs === 1 && s.tups === '2';
  await show({ 0: { 0: old, 2: { v: 1, r: 3, rs: 2 } } });
  await tap('#sq-gInner .sq-grow[data-ti="0"] > .sq-step:nth-child(1)');
  let s = await state(); ok(plain(s), 'a tap switches on a plain step, and the tuplet beside it stays', JSON.stringify(s));
  await show({ 0: { 0: old, 2: { v: 1, r: 3, rs: 2 } } });
  await page.evaluate(() => window._sqPlayIn(0, 0, false, 80));
  s = await state(); ok(plain(s), 'so does playing one in', JSON.stringify(s));
  const x = await page.evaluate(() => {
    const host = document.getElementById('sq-xstrip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'sq-xstrip' }));
    window._sqRestoreState({ steps: 16, mach: '808', grid: {}, aux: { mach: 'PERC', grid: { 0: T.row({ 0: { v: 0, r: 5, rs: 4 }, 2: { v: 1, r: 3, rs: 2 } }) }, on: true } });
    window._sqEnsureGrid(); window._sqRenderGrid();
    host.querySelector('.sq-xrow .sq-xc:not(.sq-xhit)').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const c = T.aux(0, 0); return { v: c.v, r: c.r, rs: c.rs, boxes: host.querySelectorAll('.sq-xtup').length };
  });
  ok(x.v === 1 && x.r === 1 && x.rs === 1 && x.boxes >= 1, 'and a tap on the Live Aux roll', JSON.stringify(x));
}
