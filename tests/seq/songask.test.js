/* The page's half of the engine's song loop (docs/native-scheduling.md, slice 4, piece 5): the engine ASKS, each time it starts a chord, for the bass's line for the chord
   that follows (and for this one when nothing wrote it ahead), and the page ANSWERS with its own generator.

   native/modsynth/songtool runs the engine's song on a score and bar lines made here and prints, for every chord it starts, the ask the host's mirror would hold: where
   in the song it is, the chord's window, where it goes next. For each ask window._songAnswer is run in the real page, and what it sends (the bass's score and the line
   waiting for the next chord) is held to what the page's own loop would have done on the same state with the same dice: _syncPregenNext for the next chord's line
   (its grid cell for cell and the moment it is held for, in frames), the grid _syncRegenAt lands for a chord nothing wrote ahead for. The page's generator draws its
   notes from Math.random, so both runs of a chord get the same stream.

   The margin is measured too: the engine publishes the ask when it starts the chord (a look-ahead before the chord sounds); the page polls the mirror every 40 ms and
   answers in a measured time; the line has to be in the engine's hands before the next chord starts. Time left, for the shortest chord of each song, is printed.

   Run: make -C native/modsynth songtool && node tests/seq/songask.test.js        Env: CHROMIUM, PLAYWRIGHT, SONGTOOL, INDEX (another copy of index.html) */
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
      let p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (process.env.INDEX && q.url.split('?')[0] === '/index.html') p = process.env.INDEX;     // another build of the page (the mutation checks)
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM = [0, 4, 7, 10], M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11];
// [rootM, ivs, bars, beats, eighths, bass note, rest]
const CASES = [
  { name: 'two sections with passes, a rest, a slash chord (funk)', bpm: 120, style: 'funk', secs: 60, moves: [],
    sections: [{ plays: 2, follow: 'next', slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1, 0, 0, 57], [55, DOM, 1], [60, MAJ, 1, 0, 0, null, true]] }, { plays: 1, slots: [[50, M7, 2], [55, DOM, 1]] }] },
  { name: 'short chords: halves of a bar and beats (rock)', bpm: 100, style: 'rock', secs: 40, moves: [],
    sections: [{ plays: 1, slots: [[48, MAJ, 0, 2], [55, DOM, 0, 2], [57, MIN, 1], [53, MAJ, 0, 3], [52, M7, 0, 1]] }] },
  { name: 'a queued Next at the end of a pass: the peek says one place, the loop goes another', bpm: 120, style: 'funk', secs: 70, moves: [{ at: 5.2, delta: 1 }],
    sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, MIN, 1]] }, { plays: 1, slots: [[53, MAJ, 1], [55, DOM, 1]] }, { plays: 1, slots: [[50, M7, 1]] }] },
  { name: 'Follow on: the engine makes the bass follow each chord itself, nothing is asked', bpm: 120, style: 'funk', secs: 40, moves: [], follow: true, none: true,
    sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }] },
  { name: 'Bass+Mel Free: nothing is asked', bpm: 120, style: 'funk', secs: 40, moves: [], sync: false, none: true,
    sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }] },
  { name: 'a key change (the capo) in the asks: the line is written over what will sound', bpm: 120, style: 'funk', secs: 50, moves: [], capo: 3,
    sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1, 0, 0, 57], [55, DOM, 1]] }] },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songask-'));
  const bin = process.env.SONGTOOL || path.join(root, 'native', 'modsynth', 'songtool');

  for (const c of CASES) {
    // 1. the song as the engine reads it, and the bar lines the drums would announce
    const setup = await page.evaluate(({ c }) => {
      const sr = 48000;
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      root = 0; mode = 'major'; _songBaseRoot = -1; songCompStyle = 'sustain'; snapMode = 'bar';
      const mk = a => { const s = { rootM: a[0], ivs: a[1].slice(), bars: a[2] || 0, beats: a[3] || 0, eighths: a[4] || 0, isRest: !!a[6], label: 'x' }; if (a[5] != null) s.bassNote = a[5]; return s; };
      sections = c.sections.map((s, i) => ({ name: 'S' + i, slots: s.slots.map(mk), plays: s.plays, follow: s.follow }));
      const sc = window._songNativeScore(), T0 = 1.0, barSec = _songBarSteps() * 60 / bpm / 4, LA = 0.15, DT = 0.0371;
      const marks = []; for (let m = T0; m < T0 + c.secs + 10; m += barSec) marks.push(m);
      const ticks = [], moves = c.moves.map(m => Object.assign({ done: false }, m));
      let announced = 0, now = 0.0013;
      for (let g = 0; g < 100000; g++) {
        now += DT;
        const horizon = now + LA, mk2 = [];
        while (announced < marks.length && marks[announced] < horizon) mk2.push(marks[announced++] * sr);
        let move = 0; moves.forEach(m => { if (!m.done && now >= m.at) { m.done = true; move = m.delta; } });
        ticks.push([now * sr, horizon * sr, 1, mk2.length].concat(mk2, [move, 1e9]));
        if (now > T0 + c.secs) break;
      }
      return { ticks, score: sc.score, ok: sc.ok, bpm, first: T0 * sr };
    }, { c });
    const cases = [1, SR, setup.bpm, setup.first, 0, 0, 0, setup.ticks.length].concat(...setup.ticks, setup.score);
    fs.writeFileSync(path.join(tmp, 'song.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'song.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    const asks = r.stdout.split('\n').filter(l => l.startsWith('A ')).map(l => l.split(' ').slice(1).map(Number));
    // [section, chord, pass, t, end, nextSection, nextChord, capo]; the host's mirror holds [count, section, chord, pass, t, end, nextSection, nextChord, capo]
    const mirrorAsks = asks.map((a, i) => { const m = [i + 1].concat(a); if (c.capo) m[8] = c.capo; return m; });

    // 2. the page's own loop's writes, and the answers, on the same state with the same dice
    const res = await page.evaluate(({ c, mirrorAsks, bassFirst }) => {
      const sr = 48000, out = { rows: [], ms: [] };
      const mulberry = a => () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const realRandom = Math.random;
      const state = { steps: 16, grid: Array.from({ length: 16 }, () => ({ note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 })), follow: !!c.follow, genStyle: c.style, gridRootPc: 0, gridIntvs: [0, 4, 7] };
      _bassAutoSync = c.sync !== false;
      const decodePending = d => { if (d[0] !== 1) return null; const n = d[3], cells = []; for (let s = 0; s < n; s++) cells.push(d.slice(4 + 9 * s, 13 + 9 * s).join()); return { at: d[1] ? d[2] : null, cells }; };
      const orig = window._blPregen;
      let pre = null;
      window.__preAnswer = null;
      const gridOf = score => { const g = score.slice(score.length - 9 * 16), o = []; for (let i = 0; i < 16; i++) o.push(g.slice(9 * i, 9 * i + 9).join()); return o; };
      mirrorAsks.forEach((ask, k) => {
        const [, cs, cc, , t, end, ns, nc] = ask;
        const slot = sections[cs].slots[cc], nextSlot = sections[ns].slots[nc];
        window._blRestoreState(JSON.parse(JSON.stringify(state)));
        const active = _bassAutoSync && !window.blIsFollowOn();
        const preMatch = !!(pre && pre.sec === cs && pre.slot === cc), needNow = active && !preMatch && !slot.isRest;
        const capo = ask[8];
        if (capo) { _songBaseRoot = 0; root = capo; _lastChordKey = { root: capo, mode: 'major' }; }
        const placed = sl => { const r = sl.rootM + capo; let iv = slotIvs(sl).slice(); if (sl.bassNote != null) iv = [sl.bassNote + capo - r].concat(iv); return [r, iv]; };
        // the page's own loop: _syncRegenAt's line for this chord (when nothing wrote it ahead), then _syncPregenNext for the next. _syncPregenNext calls _blPregen,
        // which the page lets work only while its own bass plays: it is given the engine-player wrapper for the call
        window._blRestoreState(JSON.parse(JSON.stringify(state)));
        const ref = { now: null, next: null };
        const wrap = function (r, i, a) { window._blPregen = orig; try { return window._blPregenFor(r, i, a); } finally { window._blPregen = wrap; } };
        try {
          if (needNow) { Math.random = mulberry(5000 + k); window._blPregenFor(placed(slot)[0], placed(slot)[1], null); window._blLand(); ref.now = gridOf(window._blNativeScore().score); }
          Math.random = mulberry(9000 + k);
          window._blPregen = wrap; _syncPre.bl = null;
          _syncPregenNext(slot, (t - bassFirst) / sr, nextSlot);
          const wrote = _syncPre.bl === nextSlot;
          ref.next = wrote ? decodePending(window._blNativePending(sr, 0)) : null;
          pre = wrote ? { sec: ns, slot: nc } : null;
          window._blNativePendingTake(sr, 0);
        } finally { window._blPregen = orig; }
        // the answer, from the same state, the same draws in the same order
        window._blRestoreState(JSON.parse(JSON.stringify(state)));
        if (capo) { _songBaseRoot = 0; root = capo; _lastChordKey = { root: capo, mode: 'major' }; }
        const seeds = needNow ? [5000 + k, 9000 + k] : [9000 + k]; let si = 0;
        const origFor = window._blPregenFor;
        window._blPregenFor = function (r, i, a) { Math.random = mulberry(seeds[si++]); return origFor(r, i, a); };
        const t0 = performance.now();
        const ans = window._songAnswer(ask, bassFirst, sr, window.__preAnswer || null);
        const ms = performance.now() - t0;
        window._blPregenFor = origFor;
        _songBaseRoot = -1; root = 0; _lastChordKey = { root: 0, mode: 'major' };
        window.__preAnswer = ans.pre;
        out.rows.push({ left: window._blNativePending(sr, 0)[0] !== 0, k, ref, got: { now: ans.score ? gridOf(ans.score) : null, next: ans.pending ? decodePending(ans.pending) : null }, ms, t, end });
        out.ms.push(ms);
      });
      Math.random = realRandom;
      return out;
    }, { c, mirrorAsks, bassFirst: setup.first });

    if (process.env.ASK_DEBUG) res.rows.slice(0, 2).forEach(w => console.log(JSON.stringify(w.ref).slice(0, 700) + '\n' + JSON.stringify(w.got).slice(0, 700)));
    let bad = null, nNow = 0, nNext = 0, worstAt = 0, minMargin = Infinity;
    const POLL = 0.04, LOOK = 0.15;
    res.rows.forEach(w => {
      if (bad) return;
      if (w.left) { bad = `chord ${w.k}: the page keeps its own copy of the line it sent the engine`; return; }
      if (w.ref.next || w.got.next) {
        if (!w.ref.next || !w.got.next) { bad = `chord ${w.k}: the page's loop wrote ${w.ref.next ? 'a' : 'no'} line ahead, the answer ${w.got.next ? 'sent one' : 'sent none'}`; return; }
        const atF = w.ref.next.at;
        worstAt = Math.max(worstAt, Math.abs(atF - w.got.next.at));
        if (Math.abs(atF - w.got.next.at) > 1e-3) bad = `chord ${w.k}: held for frame ${atF} by the page's loop, ${w.got.next.at} by the answer`;
        else if (w.ref.next.cells.join('|') !== w.got.next.cells.join('|')) bad = `chord ${w.k}: the next chord's line differs from the page's own`;
        else nNext++;
        // time left: the ask is in the mirror a look-ahead before the chord sounds; polled within POLL, answered in ms; the line is needed when the chord ends
        const left = (w.end - w.t) / SR + LOOK - POLL - w.ms / 1000;
        minMargin = Math.min(minMargin, left);
      }
      if (!bad && (w.ref.now || w.got.now)) {
        if (!w.ref.now || !w.got.now || w.ref.now.join('|') !== w.got.now.join('|')) bad = `chord ${w.k}: the line for the chord itself differs from what the page's loop lands`;
        else nNow++;
      }
    });
    const maxMs = Math.max(...res.ms);
    ok(!bad && res.rows.length > 6 && (c.none ? nNext === 0 && nNow === 0 : nNext > 3), c.name + ': ' + res.rows.length + ' asks, ' + nNext + ' lines written ahead identical (held to the same frame), ' + nNow + ' lines for the chord itself identical', (bad || '') + ' ' + JSON.stringify({ ok: setup.ok }));
    if (!c.none) ok(minMargin > 0.05, '    ...and in time: the answer takes at most ' + maxMs.toFixed(1) + ' ms; with a 40 ms poll the shortest chord leaves ' + (minMargin * 1000).toFixed(0) + ' ms before it is needed', 'margin ' + minMargin);
  }
  const melodyAnswers = await page.evaluate(() => {
    const rows = [], sr = 48000, realRandom = Math.random;
    const seed = () => { let a = 91; Math.random = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };
    const grid = Array.from({length: 16}, () => ({note: 0, oct: 4, len: 1, v: 1}));
    for(const bassFollow of [false, true]) for(const follow of [false, true]) for(const rest of [false, true]) for(const capo of [0, 3]) {
      const setup = () => {
        _bassAutoSync = true; root = capo; mode = 'major'; _songBaseRoot = 0;
        _lastChordKey = {root: capo, mode: 'major'};
        sections = [{slots: [{rootM:48, ivs:[0,4,7], bars:1}, {rootM:55, ivs:[0,4,7,10], bars:1, bassNote:59, isRest:rest}]}];
        window._blRestoreState({steps:16, grid, follow:bassFollow, genStyle:'funk', gridRootPc:0, gridIntvs:[0,4,7]});
        window._mlRestoreState({steps:16, grid, follow, genStyle:'chord', gridRootPc:0, gridIntvs:[0,4,7]});
        window._mlSetClock(1, 0, true);
        window._mlNativePendingTake(sr, 0);
        seed();
      };
      setup();
      _syncPregenNext(sections[0].slots[0], 1, sections[0].slots[1]);
      const expected = window._mlNativePendingTake(sr, 0);
      setup();
      const answer = window._songAnswer([1,0,0,0,sr,3*sr,0,1,capo], 0, sr, {sec:0,slot:0}, 0, {sec:0,slot:0});
      rows.push({bassFollow,follow,rest,capo, expected, actual:answer.mel.pending || [0], left:window._mlNativePendingTake(sr,0)});
    }
    Math.random = realRandom; window._mlSetClock(0,0,false);
    return rows;
  });
  for(const r of melodyAnswers) ok(JSON.stringify(r.expected) === JSON.stringify(r.actual) && r.left[0] === 0,
    'melody handshake ' + JSON.stringify({bassFollow:r.bassFollow, follow:r.follow, rest:r.rest, capo:r.capo}), JSON.stringify(r));
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
