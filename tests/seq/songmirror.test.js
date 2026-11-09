/* The engine's song on the page's song screens (docs/native-scheduling.md, slice 4, piece 6): the page's own loop and the mirror of the engine's, side by side.

   The page's loop runs for real on a clock of our own (as in songstep.test.js): startSongLoop, the drums' bar lines, a Next/Prev tapped between two ticks. Every time it
   lights a chord (_highlightLoopSlot) we keep which chord, which pass of its section ("Pass 2 of 3") and the queued move the Next/Prev buttons show at that moment, and when.
   native/modsynth/songtool runs the engine's song on the same score and ticks and prints, per tick, what the host's mirror holds (song.pending, and the ask each chord
   start leaves). window._songMirror.apply is given those mirrors tick by tick, with a clock of the same kind, and what it lights is held to what the page's loop lit:
   the same chords in the same order with the same pass and the same queued move, each lit at the chord's start (the page's loop waits out its lead the same way). The
   Next/Prev light is checked on its own: the values the page's variable takes, in order. A tap of Next also goes to the engine (songGotoSection) while it drives.

   Run: make -C native/modsynth songtool && node tests/seq/songmirror.test.js        Env: CHROMIUM, PLAYWRIGHT, SONGTOOL */
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
      if (process.env.INDEX && q.url.split('?')[0] === '/index.html') p = process.env.INDEX;
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM = [0, 4, 7, 10], M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11];
const CASES = [
  { name: 'two sections with passes (Pass 2 of 2), a section that loops for ever', bpm: 120, secs: 70, moves: [],
    sections: [{ plays: 2, follow: 'next', slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }, { plays: 0, slots: [[50, M7, 2], [55, DOM, 1]] }] },
  { name: 'Next tapped in the middle of a pass: it pulses until the pass ends, then the section moves', bpm: 120, secs: 90, moves: [{ at: 5.2, delta: 1 }, { at: 40.2, delta: -1 }, { at: 62.7, delta: 1 }],
    sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, MIN, 1]] }, { plays: 1, slots: [] }, { plays: 0, slots: [[53, MAJ, 1], [55, DOM, 1], [50, M7, 1]] }, { plays: 1, slots: [[48, MAJ7, 2]] }] },
  { name: 'chords of beats and eighths, a rest', bpm: 100, secs: 40, moves: [{ at: 8.3, delta: 1 }],
    sections: [{ plays: 2, slots: [[48, MAJ, 0, 2], [55, DOM, 0, 2], [57, MIN, 1], [53, MAJ, 0, 3, 0, null, true], [52, M7, 0, 1]] }, { plays: 1, slots: [[50, MAJ, 1]] }] },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songmirror-'));
  const bin = process.env.SONGTOOL || path.join(root, 'native', 'modsynth', 'songtool');

  for (const c of CASES) {
    // 1. the page's loop, for real
    const run = await page.evaluate(({ c }) => {
      const sr = 48000;
      const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
      const off = new OfflineAudioContext(2, sr, sr);
      const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
      clearTimeout(clockTimer);
      const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realSetTimeout = window.setTimeout, realClearTimeout = window.clearTimeout, realHl = _highlightLoopSlot;
      const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
      E.send = () => {}; E.now = () => fake.currentTime; E.ready = () => true;
      window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
      let timers = [], tid = 1;
      window.setTimeout = (fn, ms) => { const id = tid++; timers.push({ id, t: fake.currentTime + (ms || 0) / 1000, fn }); return id; };
      window.clearTimeout = id => { timers = timers.filter(x => x.id !== id); };
      const runTimers = () => { for (let g = 0; g < 1000; g++) { timers.sort((a, b) => a.t - b.t || a.id - b.id); const x = timers[0]; if (!x || x.t > fake.currentTime + 1e-12) break; timers.shift(); try { x.fn(); } catch (e) { } } };
      const LA = LOOK_AHEAD, T0 = 1.0, DT = 0.0371;
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      fake.currentTime = 0.0013; timers = [];
      stopSongLoop();
      root = 0; mode = 'major'; window.setHumanize(0); _bassAutoSync = false; songCompStyle = 'sustain'; snapMode = 'bar'; rhythmOn = false; songSwingOn = false;
      window._sqSetSwing(0); window._sqPlaying = () => true;
      const mk = a => { const s = { rootM: a[0], ivs: a[1].slice(), bars: a[2] || 0, beats: a[3] || 0, eighths: a[4] || 0, isRest: !!a[6], label: 'x' }; if (a[5] != null) s.bassNote = a[5]; return s; };
      sections = c.sections.map((s, i) => ({ name: 'S' + i, slots: s.slots.map(mk), plays: s.plays, follow: s.follow }));
      songCurrentSection = 0; songCurrentSlot = 0; _songHeldAt = null; songSectionPass = 0; songPendingSectionDelta = 0; songWaitingForBar = false;
      const hint = () => { const e = document.getElementById('sec-plays-hint'); return e ? e.textContent : ''; };
      curSection = 0; { const e = document.getElementById('sec-plays-hint'); if (e) e.textContent = ''; }
      const lit = [], pend = [];
      _highlightLoopSlot = function (si, ci) { lit.push({ si, ci, pass: songSectionPass, pending: songPendingSectionDelta, t: fake.currentTime, hint: hint(), loop: songLoopSection + '/' + songLoopSlot }); return realHl.apply(this, arguments); };
      const barSec = _songBarSteps() * 60 / bpm / 4, marks = []; for (let m = T0; m < T0 + c.secs + 10; m += barSec) marks.push(m);
      let announced = 0; window._barAnnouncedT = 0;
      startSongLoop(false, T0);
      const sc = window._songNativeScore(), ticks = [], moves = c.moves.map(m => Object.assign({ done: false }, m));
      let lastPend = songPendingSectionDelta; pend.push(lastPend);
      for (let g = 0; g < 200000; g++) {
        fake.currentTime += DT;
        const horizon = fake.currentTime + LA, mk2 = [];
        while (announced < marks.length && marks[announced] < horizon) { const m = marks[announced++]; mk2.push(m * sr); window._barAnnouncedT = m; tickSongLoop(m); }
        runTimers();
        let move = 0; moves.forEach(m => { if (!m.done && fake.currentTime >= m.at) { m.done = true; songGotoSection(m.delta); move = m.delta; } });
        ticks.push([fake.currentTime * sr, horizon * sr, 1, mk2.length].concat(mk2, [move, 1e9]));
        if (songPendingSectionDelta !== lastPend) { lastPend = songPendingSectionDelta; pend.push(lastPend); }
        if (fake.currentTime > T0 + c.secs) break;
      }
      stopSongLoop();
      _highlightLoopSlot = realHl; window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout; window._sqPlaying = realSq;
      window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
      return { lit, pend, ticks, score: sc.score, bpm, first: T0 * sr, DT };
    }, { c });
    const cases = [1, SR, run.bpm, run.first, 0, 0, 0, run.ticks.length].concat(...run.ticks, run.score);
    fs.writeFileSync(path.join(tmp, 'song.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'song.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    // the host's mirror after each tick: the latest ask and the queued move
    const mirrors = []; let ask = null, n = 0;
    r.stdout.split('\n').forEach(l => {
      const f = l.split(' ');
      if (l.startsWith('A ')) { n++; ask = [n, +f[1], +f[2], +f[3], +f[4], +f[5], +f[6], +f[7], +f[8]]; }
      else if (l.startsWith('P ')) mirrors.push({ frame: +f[1], pending: +f[2], ask: ask && ask.slice() });
    });

    // 2. the engine's mirror through the page's screens
    const res = await page.evaluate(({ c, mirrors, DT }) => {
      const sr = 48000, fake = { t: 0 };
      const realSetTimeout = window.setTimeout, realHl = _highlightLoopSlot, realClear = window.clearTimeout;
      let timers = [], tid = 1;
      window.setTimeout = (fn, ms) => { const id = tid++; timers.push({ id, t: fake.t + (ms || 0) / 1000, fn }); return id; };
      const runTimers = () => { for (let g = 0; g < 1000; g++) { timers.sort((a, b) => a.t - b.t || a.id - b.id); const x = timers[0]; if (!x || x.t > fake.t + 1e-12) break; timers.shift(); try { x.fn(); } catch (e) { } } };
      stopSongLoop(); songSectionPass = 0; songPendingSectionDelta = 0; songLoopActive = false;
      window._songMirror.seen = 0; window._songMirror.live = false; window._songMirror.cmdAt = 0;
      const hint = () => { const e = document.getElementById('sec-plays-hint'); return e ? e.textContent : ''; };
      curSection = 0; { const e = document.getElementById('sec-plays-hint'); if (e) e.textContent = ''; }
      const lit = [], pend = []; let lastPend = 0; pend.push(0);
      _highlightLoopSlot = function (si, ci) { lit.push({ si, ci, pass: songSectionPass, pending: songPendingSectionDelta, t: fake.t, hint: hint(), loop: songLoopSection + '/' + songLoopSlot }); return realHl.apply(this, arguments); };
      mirrors.forEach(m => {
        fake.t = m.frame / sr;
        runTimers();
        window._songMirror.apply({ sampleRate: sr, frame: m.frame, song: { running: true, pending: m.pending, ask: m.ask || [0, 0, 0, 0, 0, 0, 0, 0, 0] } });
        runTimers();
        if (songPendingSectionDelta !== lastPend) { lastPend = songPendingSectionDelta; pend.push(lastPend); }
      });
      const stillLive = songLoopActive;
      songPendingSectionDelta = 1;
      const realApply = applySongPlayingHighlights, cleared = []; applySongPlayingHighlights = function (x) { cleared.push(x); return realApply.apply(this, arguments); };
      window._songMirror.apply({ sampleRate: sr, frame: 0, song: { running: false } });
      applySongPlayingHighlights = realApply;
      const afterEnd = { active: songLoopActive, pending: songPendingSectionDelta, cleared: cleared.join() };
      _highlightLoopSlot = realHl; window.setTimeout = realSetTimeout; window.clearTimeout = realClear;
      return { lit, pend, stillLive, afterEnd };
    }, { c, mirrors, DT: run.DT });

    // 3. the same lights
    const A = run.lit, B = res.lit;
    let bad = null, worstT = 0;
    const n2 = Math.min(A.length, B.length);
    for (let k = 0; k < n2 && !bad; k++) {
      const a = A[k], b = B[k];
      if (a.si !== b.si || a.ci !== b.ci) bad = `light ${k}: chord ${a.si}/${a.ci} on the page's loop, ${b.si}/${b.ci} on the mirror`;
      else if (a.pass !== b.pass) bad = `light ${k}: pass ${a.pass + 1} on the page's loop, ${b.pass + 1} on the mirror`;
      // (the page's loop writes the pass line when it first counts a pass, so on its very first chord the line is still empty; the mirror writes it at once)
      else if (a.hint !== '' && a.hint !== b.hint) bad = `light ${k}: the pass line says "${a.hint}" on the page's loop, "${b.hint}" on the mirror`;
      else if (a.loop !== b.loop) bad = `light ${k}: the loop's place is ${a.loop} on the page's loop, ${b.loop} on the mirror`;
      else if (a.pending !== b.pending) bad = `light ${k}: Next/Prev pending ${a.pending} on the page's loop, ${b.pending} on the mirror`;
      else { worstT = Math.max(worstT, Math.abs(a.t - b.t)); if (Math.abs(a.t - b.t) > 2 * run.DT) bad = `light ${k}: at ${a.t.toFixed(3)} s on the page's loop, ${b.t.toFixed(3)} on the mirror`; }
    }
    if (!bad && B.length < A.length - 1) bad = A.length + ' lights on the page, ' + B.length + ' on the mirror';
    ok(!bad && A.length > 6, c.name + ': ' + A.length + ' chords lit identically (chord, pass, queued move; worst ' + (worstT * 1000).toFixed(0) + ' ms apart)', bad || '');
    const pa = run.pend.join(), pb = res.pend.join();
    ok(pa === pb && run.pend.length >= (c.moves.length ? 2 : 1), '    ...and the Next/Prev light takes the same values in order: ' + pa, 'page ' + pa + ', mirror ' + pb);
    ok(res.stillLive && !res.afterEnd.active && res.afterEnd.pending === 0 && res.afterEnd.cleared === 'false', '    ...and stopping leaves the screens as stopSongLoop does (nothing playing, nothing queued)', JSON.stringify(res.afterEnd));
  }
  // the page's own buttons reach the engine while it drives the song
  const cmds = await page.evaluate(() => {
    const sent = [], P = { seqSongMove: a => { sent.push('move ' + a.delta); return Promise.resolve(); }, seqSongStop: () => { sent.push('stop'); return Promise.resolve(); }, seqSongHold: () => { sent.push('hold'); return Promise.resolve(); }, seqSongArm: a => { sent.push('arm ' + a.kind); return Promise.resolve(); } };
    const keep = window._nsSong.plugin; window._nsSong.plugin = () => P;
    sections = [{ name: 'A', slots: [{ rootM: 48, ivs: [0, 4, 7], bars: 1, label: 'C' }, { rootM: 55, ivs: [0, 4, 7], bars: 1, label: 'G' }], plays: 2 }, { name: 'B', slots: [{ rootM: 50, ivs: [0, 3, 7], bars: 1, label: 'Dm' }], plays: 1 }];
    const out = {};
    window._nsSong.driving = true; songLoopActive = true; songLoopSection = 0; songLoopSlot = 1;
    songGotoSection(1); out.afterNext = songPendingSectionDelta;
    holdSongLoop(); out.held = _songHeldAt && (_songHeldAt.section + '/' + _songHeldAt.slot); out.drivingAfterHold = window._nsSong.driving;
    window._nsSong.driving = true; songLoopActive = true;
    stopSongLoop(); out.drivingAfterStop = window._nsSong.driving;
    songEnding = null; _endingRunning = false; songLoopActive = true; window._nsSong.driving = true; armEnding('ritard'); out.armed = songEnding; armEnding('ritard'); out.disarmed = songEnding; armEnding('fade');
    window._nsSong.plugin = keep; window._nsSong.driving = false; songLoopActive = false; _songHeldAt = null; songPendingSectionDelta = 0;
    out.sent = sent; return out;
  });
  ok(cmds.sent.join() === 'move 1,hold,stop,arm 5,arm 0,arm 3' && cmds.armed === 'ritard' && cmds.disarmed === null && cmds.afterNext === 1 && cmds.held === '0/1' && !cmds.drivingAfterHold && !cmds.drivingAfterStop,
     'the page\'s Next, Hold, Stop and the endings it arms and disarms reach the engine while it drives (' + cmds.sent.join(', ') + '), the hold remembers chord ' + cmds.held, JSON.stringify(cmds));
  // an ending the engine has taken over: the armed light goes out, as _runEnding clears songEnding, and a stop clears what it left
  const endUi = await page.evaluate(() => {
    songEnding = 'fade'; window._songMirror.live = false; window._songMirror.seen = 0;
    sections = [{ name: 'A', slots: [{ rootM: 48, ivs: [0, 4, 7], bars: 1, label: 'C' }], plays: 1 }];
    window._songMirror.apply({ sampleRate: 48000, frame: 0, song: { running: true, pending: 0, ending: { armed: 0, phase: 1 }, ask: [1, 0, 0, 0, 0, 96000, 0, 0, 0] } });
    const out = { lit: songEnding, running: _endingRunning };
    window._songMirror.apply({ sampleRate: 48000, frame: 0, song: { running: false } });
    out.after = { running: _endingRunning, active: songLoopActive };
    return out;
  });
  ok(endUi.lit === null && endUi.running === true && endUi.after.running === false && endUi.after.active === false, 'the armed light goes out when the engine runs the ending, and a stop clears what it left', JSON.stringify(endUi));
  // the trainer's choruses: the page does what its own loop does at the end of one (_pracChorusDone), once for each the engine has counted
  const chor = await page.evaluate(() => {
    let calls = 0; const real = _pracChorusDone; _pracChorusDone = function () { calls++; };
    sections = [{ name: 'A', slots: [{ rootM: 48, ivs: [0, 4, 7], bars: 1, label: 'C' }], plays: 1 }];
    window._songMirror.end(); window._songMirror.chorusSeen = 0;
    const mk = (n, c) => ({ sampleRate: 48000, frame: 0, song: { running: true, pending: 0, chorus: c, ask: [n, 0, 0, 0, 0, 96000, 0, 0, 0] } });
    window._songMirror.apply(mk(1, 0)); window._songMirror.apply(mk(2, 1)); window._songMirror.apply(mk(3, 1)); window._songMirror.apply(mk(4, 3));
    const out = { calls, seen: window._songMirror.chorusSeen };
    _pracChorusDone = real; window._songMirror.end();
    return out;
  });
  ok(chor.calls === 3 && chor.seen === 3, 'the page steps its own tempo and key display once for each chorus the engine counts (' + chor.calls + ' calls for choruses 0, 1, 1, 3)', JSON.stringify(chor));
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
