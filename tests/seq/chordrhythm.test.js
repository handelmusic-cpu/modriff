/* The native chord rhythm (native/modsynth/chordcore.h, docs/native-scheduling.md slice 2) against the page's scheduleChordRhythm.

   The page's scheduler runs in the real page on a clock of its own (the way bassgrid.test.js and drumgrid.test.js do), with the chord and the
   rhythm set, and every chord it sends (kind 'chord') is kept. native/modsynth/chordtool runs the same score. The two lists must be the same hit
   for hit: when (to 1e-5 of a frame), the level, the length, the chord, and for a gated hit (a hold, and every ratchet's re-strikes) when the page lets go of it. The chord is the one the page sent for its first hit (the voicing is
   the page's; the engine plays it as given), and every later hit of the page must be that same chord, which is also checked.

   Run: make -C native/modsynth chordtool && node tests/seq/chordrhythm.test.js        Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
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
const CONFIGS = [
  { name: 'the built-in strum rhythm, C major, 120 BPM', key: 'strum', bpm: 120, chord: [60, [0, 4, 7]], swing: 0, swing8: true, bars: 6 },
  { name: 'the same with the Feel swing at 40 on the eighths, 100 BPM', key: 'strum', bpm: 100, chord: [60, [0, 4, 7]], swing: 40, swing8: true, bars: 6 },
  { name: 'a drawn rhythm with soft, plain and accented hits, its own swing', def: { cells: { 0: { on: 1, acc: 1 }, 3: { on: 1, soft: 1 }, 6: { on: 1 }, 8: { on: 1, acc: 1 }, 11: { on: 1, soft: 1 }, 14: { on: 1 } }, swing: 30 }, bpm: 110, chord: [57, [0, 3, 7, 10]], swing: 0, swing8: true, bars: 6 },
  { name: 'a drawn rhythm with held hits, ratchets of 2, 3 and 4 and a held ratchet, its own swing', def: { cells: { 0: { on: 1, len: 3 }, 4: { on: 1, rat: 3 }, 6: { on: 1, rat: 2, soft: 1 }, 8: { on: 1, acc: 1, rat: 4, len: 2 }, 12: { on: 1, soft: 1, len: 4 }, 15: { on: 1 } }, swing: 20 }, bpm: 120, chord: [57, [0, 3, 7, 10]], swing: 0, swing8: true, bars: 6 },
  { name: 'the built-in strum rhythm with the tempo changed twice while it plays (120, 90, 150), swing on the eighths', key: 'strum', bpm: 120, chord: [60, [0, 4, 7]], swing: 30, swing8: true, bars: 6, tempo: [{ tick: 40, bpm: 90 }, { tick: 110, bpm: 150 }] },
  { name: 'a drawn rhythm with held hits and ratchets, tempo 100 then 160 then 70', def: { cells: { 0: { on: 1, len: 3 }, 4: { on: 1, rat: 3 }, 8: { on: 1, acc: 1, rat: 2, len: 2 }, 12: { on: 1, soft: 1 } }, swing: 20 }, bpm: 100, chord: [57, [0, 3, 7, 10]], swing: 0, swing8: true, bars: 6, tempo: [{ tick: 30, bpm: 160 }, { tick: 120, bpm: 70 }] },
  { name: 'a drawn 12-step rhythm, the Feel swing on the sixteenths, a slash chord', def: { steps: 12, cells: { 0: { on: 1 }, 4: { on: 1, acc: 1 }, 7: { on: 1 }, 10: { on: 1, soft: 1 } } }, bpm: 130, chord: [60, [0, 4, 7, -8]], swing: 55, swing8: false, bars: 8 },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const result = await page.evaluate(async ({ configs }) => {
    const sr = 48000, out = [], extra = {};
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx;
    const sent = [], released = {};
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    // a gated hit is a chord sent without a length (dur null) and a release of its id at the end of the gate
    E.send = m => { if (m.kind === 'chord') sent.push(Object.assign({}, m)); else if (m.kind === 'release' && m.part === 'chord' && m.at != null) released[m.id] = m.at; };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    const LA = LOOK_AHEAD, FIRSTs = 1.0;
    for (const c of configs) {
      document.getElementById('bpm').value = c.bpm; c.bpm = parseFloat(document.getElementById('bpm').value);
      window._sqSetSwing(c.swing); window._sqSetSwing8(c.swing8);
      chordsEnabled = true; songLoopActive = false;
      CR.on = true; CR.preview = null; CR.chord = { root: c.chord[0], intvs: c.chord[1].slice() }; CR.tapT = -100;
      if (c.def) { const d = rhyBlank(c.def.steps || 16); Object.keys(c.def.cells).forEach(i => Object.assign(d.cells[i], c.def.cells[i])); d.swing = c.def.swing != null ? c.def.swing : null; d.name = 'test'; CR.key = 'u:' + 'test'; CR.def = rhyNorm(d); }
      else { CR.key = c.key; CR.def = null; }
      const pat = crPattern();
      const stepSec = 60 / c.bpm / 4, tEnd = FIRSTs + c.bars * pat.steps * stepSec;
      sent.length = 0; for (const k in released) delete released[k];
      fake.currentTime = 0.0013;
      CR.run = true; CR.nextT = FIRSTs; CR.step = 0;
      const jumps = [];
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        // a tempo the player sets between two ticks: the step the scheduler is about to place is the first to have it
        (c.tempo || []).forEach(t => { if (t.tick === guard) { document.getElementById('bpm').value = t.bpm; jumps.push(CR.nextT * sr, t.bpm); } });
        scheduleChordRhythm(); _schedHorizon = null;
        if (CR.nextT >= tEnd) break;
      }
      CR.run = false;
      const hits = sent.filter(m => m.at < tEnd - 1e-6).map(m => ({ at: m.at, vel: m.vel, dur: m.dur, hold: m.dur == null ? released[m.id] - m.at : null, notes: m.notes, bass: m.bass, root: m.root }));
      const first = sent[0];
      const sc = window._crNativeScore({ notes: (first.bass != null ? [first.bass] : []).concat(first.notes), root: first.root, bass: first.bass });
      out.push({ name: c.name, hits, tEnd, score: sc.score, ok: sc.ok, why: sc.why, bpm: c.bpm, steps: pat.steps, jumps });
      document.getElementById('bpm').value = c.bpm;
    }
    // a gated hit and a ratchet are in the score, not refused
    { CR.key = 'u:test'; const d = rhyBlank(16); d.cells[0].on = 1; d.cells[0].len = 2; d.name = 'test'; CR.def = rhyNorm(d); const a = window._crNativeScore({ notes: [60, 64, 67], root: 60, bass: null }); extra.gated = a.ok;
      const r = rhyBlank(16); r.cells[0].on = 1; r.cells[0].rat = 3; r.name = 'test'; CR.def = rhyNorm(r); const b = window._crNativeScore({ notes: [60, 64, 67], root: 60, bass: null }); extra.ratchet = b.ok; extra.why = a.why.concat(b.why).join(','); }
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return { list: out, extra };
  }, { configs: CONFIGS });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chordrhythm-'));
  const all = result.list;
  const cases = [all.length];
  all.forEach(c => { cases.push(SR, c.bpm, 1.0 * SR, 0, 4 * Math.ceil((c.tEnd - 1) / (60 / c.bpm / 4) - 1e-9), c.jumps.length / 2); c.jumps.forEach(x => cases.push(x)); c.score.forEach(x => cases.push(x)); });
  fs.writeFileSync(path.join(tmp, 'cr.f64'), Buffer.from(Float64Array.from(cases).buffer));
  const bin = path.join(root, 'native', 'modsynth', 'chordtool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth chordtool'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cr.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const native = []; let cur = null;
  run.stdout.split('\n').forEach(l => {
    const f = l.split(' ');
    if (f[0] === 'CASE') { cur = []; native.push(cur); }
    else if (f[0] === 'H') { const nn = +f[6]; cur.push({ fx: +f[1], vel: +f[2], dur: +f[3], hold: +f[4], holdSec: +f[5], notes: f.slice(7, 7 + nn).map(Number), sub: +f[7 + nn] }); }
  });
  console.log('\nhit lists, the engine against the page (frames to 1e-5):');
  all.forEach((c, i) => {
    const pg = c.hits, nat = native[i].filter(e => e.fx < c.tEnd * SR - 1e-6);
    const first = pg[0], chordOf = h => (h.bass != null ? [h.bass] : []).concat(h.notes).join('.');
    let same = nat.length === pg.length && pg.length > 6, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) { same = false; why = `hit ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `hit ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if ((p.hold != null) !== (n.hold === 1)) { same = false; why = `hit ${k}: the page ${p.hold != null ? 'holds' : 'does not hold'} it, the engine ${n.hold ? 'holds' : 'does not'}`; }
      else if (p.hold != null && Math.abs(p.hold - n.holdSec) * SR > 1e-5) { same = false; why = `hit ${k}: let go of after ${p.hold} s on the page, ${n.holdSec} native`; }
      else if (p.hold == null && Math.abs(p.dur - n.dur) > 1e-12) { same = false; why = `hit ${k}: length ${p.dur}, ${n.dur} native`; }
      else if (chordOf(p) !== chordOf(first) || n.notes.join('.') !== chordOf(first)) { same = false; why = `hit ${k}: the chord is ${chordOf(p)} on the page and ${n.notes.join('.')} native (the first was ${chordOf(first)})`; }
    }
    const nHeld = pg.filter(h => h.hold != null).length;
    ok(same && c.ok, c.name + ': ' + pg.length + ' hits identical, ' + nHeld + ' of them held (worst timing ' + worstT.toExponential(1) + ' frames)', why + ' ' + (c.why || []).join(','));
    if (c.name.indexOf('held hits') >= 0) ok(nHeld >= 12 && nHeld < pg.length, 'that rhythm has held and plain hits (' + nHeld + ' of ' + pg.length + ' held)', String(nHeld));
  });
  ok(result.extra.gated && result.extra.ratchet, 'a gated hit, and a ratchet (which is gated), are in the score and not refused', JSON.stringify(result.extra));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
