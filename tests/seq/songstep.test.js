/* The native song loop (native/modsynth/songcore.h, docs/native-scheduling.md slice 4, piece 2) against the page's own: startSongLoop,
   _playLoopSlot, tickSongLoop and _advanceLoopSlot, with the page's timers and the drums' bar announcements on a clock of our own.

   The page's loop runs in the real page. The clock is fake: setTimeout is replaced by a queue that runs when the fake time reaches it, the drums are a
   stand-in that announces a bar line (tickSongLoop(t), as scheduleRhythm and the sequencer do) when the line falls inside the look-ahead, and the
   player's Next/Prev and a key change arrive between two ticks. Every chord the loop hands the bass (_blOnChord, and the window it makes) is kept.
   native/modsynth/songtool is given the song as the engine reads it (window._songNativeScore) and the same ticks. The two lists must be the same,
   chord for chord: when it starts (to 1e-5 of a frame), when its window ends, rest, root, slash bass, the next chord's root, the chord's tones,
   whether it has a phrase lock, and where in the song it is (section, chord, pass).

   Run: make -C native/modsynth songtool && node tests/seq/songstep.test.js        Env: CHROMIUM, PLAYWRIGHT */
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
// A slot: [rootM, ivs, bars, beats, eighths, bass note, rest, lock]
const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM = [0, 4, 7, 10], M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11];
const CONFIGS = [
  { name: 'drums on, whole-bar chords: two sections, passes, the peek reads the follow flag', bpm: 120, drums: true, clocked: true, secs: 70,
    sections: [{ plays: 2, follow: 'next', slots: [[0, MAJ, 1], [9, MIN, 1], [5, MAJ, 1], [7, DOM, 1]] }, { plays: 1, slots: [[2, M7, 2], [7, DOM, 2]] }] },
  { name: 'drums on, chords of mixed lengths: bars, beats, eighths, a bar and two beats, rests, a slash chord', bpm: 100, drums: true, clocked: true, secs: 90,
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [2, M7, 0, 2], [7, DOM, 0, 2], [0, MAJ7, 1, 2], [9, MIN, 0, 1, 1, null], [5, MAJ, 1, 0, 0, 0, true], [0, MAJ, 1, 0, 0, 4], [7, DOM, 0, 0, 3]] }] },
  { name: 'no drums: every chord ends one length after it began, Chart 8ths swung', bpm: 110, drums: false, clocked: true, swingOn: true, swing: 40, secs: 60,
    sections: [{ plays: 1, slots: [[0, MAJ, 2], [5, MAJ, 0, 3], [7, DOM, 0, 1, 1], [9, MIN, 1]] }, { plays: 2, slots: [[2, M7, 1], [7, DOM, 1]] }] },
  { name: 'a queued Next at the end of a pass, an empty section skipped, a section that holds (plays inf)', bpm: 120, drums: true, clocked: true, secs: 120,
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [5, MAJ, 1]] }, { plays: 1, slots: [] }, { plays: 0, slots: [[9, MIN, 1], [2, M7, 1], [7, DOM, 1]] }, { plays: 1, slots: [[0, MAJ7, 2]] }],
    moves: [{ at: 5.2, delta: 1 }, { at: 40.2, delta: -1 }, { at: 62.2, delta: 1 }] },
  { name: 'starting part-way (section 1, chord 2), a key change while it plays (the capo)', bpm: 130, drums: true, clocked: true, secs: 60, start: { section: 1, slot: 2 },
    sections: [{ plays: 1, slots: [[0, MAJ, 1], [5, MAJ, 1]] }, { plays: 2, slots: [[2, M7, 1], [7, DOM, 1], [0, MAJ7, 1], [9, MIN, 1]] }],
    capo: [{ at: 7.3, by: 2 }, { at: 24.3, by: 5 }] },
  { name: 'phrase locks on two chords (the lock rides in the score, whichever chord asks)', bpm: 120, drums: true, clocked: true, secs: 50, locks: [[0, 0], [0, 2]],
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [9, MIN, 1], [5, MAJ, 2], [7, DOM, 1]] }] },
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
    const sr = 48000, out = [];
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realSetTimeout = window.setTimeout, realClearTimeout = window.clearTimeout;
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = () => {}; E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    // The page's timers run when the fake time reaches them.
    let timers = [], tid = 1;
    window.setTimeout = (fn, ms) => { const id = tid++; timers.push({ id, t: fake.currentTime + (ms || 0) / 1000, fn }); return id; };
    window.clearTimeout = id => { timers = timers.filter(x => x.id !== id); };
    const runTimers = () => { for (let g = 0; g < 1000; g++) { timers.sort((a, b) => a.t - b.t || a.id - b.id); const x = timers[0]; if (!x || x.t > fake.currentTime + 1e-12) break; timers.shift(); try { x.fn(); } catch (e) { } } };
    const LA = LOOK_AHEAD, T0 = 1.0, DT = 0.0371;
    const origOnChord = window._blOnChord;
    for (const c of configs) {
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      fake.currentTime = 0.0013; timers = [];
      stopSongLoop();
      root = 0; mode = 'major';
      window.setHumanize(0);
      window._blRestoreState({ steps: 16, grid: Array.from({ length: 16 }, () => ({ note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 })), follow: true, genStyle: 'funk', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      _bassAutoSync = false; songCompStyle = 'sustain';
      snapMode = c.clocked ? 'bar' : 'off'; rhythmOn = false;
      songSwingOn = !!c.swingOn; if (c.swing != null) window._sqSetSwing(c.swing); else window._sqSetSwing(0);
      window._sqPlaying = () => !!c.drums;
      const mk = a => { const s = { rootM: a[0], ivs: a[1].slice(), bars: a[2] || 0, beats: a[3] || 0, eighths: a[4] || 0, isRest: !!a[6], label: 'x' }; if (a[5] != null) s.bassNote = a[5]; return s; };
      sections = c.sections.map((s, i) => ({ name: 'S' + i, slots: s.slots.map(mk), plays: s.plays, follow: s.follow }));
      PHRASE_LOCKS.bass = {};
      (c.locks || []).forEach(([si, ci], n) => {
        const sl = sections[si].slots[ci];
        PHRASE_LOCKS.bass[window.phraseKey(sl)] = { grid: Array.from({ length: 16 }, (_, i) => ({ v: i % 3 === 0 ? 1 : 0, note: i % 12, oct: 2, len: 1, slide: false, accent: false, vel: 0, pr: 0 })), steps: 16, rootPc: sl.rootM % 12 };
      });
      const st = c.start || { section: 0, slot: 0 };
      songCurrentSection = st.section; songCurrentSlot = st.slot; _songHeldAt = null; songSectionPass = 0; songPendingSectionDelta = 0; songWaitingForBar = false;
      const recs = [];
      window._blOnChord = function (slot, atTime, durSec, nextSlot, capoOverride) {
        origOnChord.apply(this, arguments);
        const w = window._blPeekLast();
        recs.push({ t: w.t, end: w.end, rest: w.rest ? 1 : 0, rootPc: w.rootPc, bassPc: w.bassPc == null ? -1 : w.bassPc, nextPc: w.nextPc == null ? -1 : w.nextPc, pcs: w.pcs.slice(),
                    lock: window._blLockFor(w) ? 1 : 0, section: songLoopSection, slot: songLoopSlot, pass: songSectionPass });
      };
      const barSec = _songBarSteps() * 60 / bpm / 4;
      const marks = []; for (let m = T0; m < T0 + c.secs + 10; m += barSec) marks.push(m);
      let announced = 0;
      window._barAnnouncedT = 0;      // the last run's bar lines must not make this start look announced already
      startSongLoop(false, T0);
      const sc = window._songNativeScore();
      const ticks = [], moves = (c.moves || []).map(m => Object.assign({ done: false }, m)), capos = (c.capo || []).map(m => Object.assign({ done: false }, m));
      for (let guard = 0; guard < 200000; guard++) {
        fake.currentTime += DT;
        const horizon = fake.currentTime + LA, mk2 = [];
        if (c.drums) while (announced < marks.length && marks[announced] < horizon) { const m = marks[announced++]; mk2.push(m * sr); window._barAnnouncedT = m; tickSongLoop(m); }
        runTimers();
        let move = 0, capo = 1e9;
        moves.forEach(m => { if (!m.done && fake.currentTime >= m.at) { m.done = true; songGotoSection(m.delta); move = m.delta; } });
        capos.forEach(m => { if (!m.done && fake.currentTime >= m.at) { m.done = true; root = (root + m.by) % 12; capo = (_songBaseRoot >= 0 ? root - _songBaseRoot : 0); } });
        ticks.push([fake.currentTime * sr, horizon * sr, c.drums ? 1 : 0, mk2.length].concat(mk2, [move, capo]));
        if (fake.currentTime > T0 + c.secs) break;
      }
      stopSongLoop();
      out.push({ name: c.name, recs, ticks, score: sc.score, ok: sc.ok, why: sc.why, bpm, first: T0 * sr, section: st.section, slot: st.slot, locks: (c.locks || []).length });
    }
    window._blOnChord = origOnChord; window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout; window._sqPlaying = realSq;
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready; PHRASE_LOCKS.bass = {};
    return out;
  }, { configs: CONFIGS });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'song-'));
  const bin = path.join(root, 'native', 'modsynth', 'songtool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth songtool'); process.exit(2); }
  console.log('\nthe song loop, the engine against the page, chord for chord:');
  result.forEach(c => {
    const cases = [1, SR, c.bpm, c.first, c.section, c.slot, 0, c.ticks.length].concat(...c.ticks, c.score);
    fs.writeFileSync(path.join(tmp, 'song.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'song.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    const nat = r.stdout.split('\n').filter(l => l.startsWith('W ')).map(l => { const f = l.split(' '); const np = +f[11]; return { t: +f[1], end: +f[2], rest: +f[3], rootPc: +f[4], bassPc: +f[5], nextPc: +f[6], lock: +f[7] >= 0 ? 1 : 0, section: +f[8], slot: +f[9], pass: +f[10], pcs: f.slice(12, 12 + np).map(Number) }; });
    const pg = c.recs;
    if (process.env.SONG_DEBUG) { console.log(c.name); console.log('page  ', pg.slice(-4).map(p => (p.t).toFixed(3) + '/' + p.section + '.' + p.slot).join(' ')); console.log('native', nat.slice(-4).map(n => (n.t / SR).toFixed(3) + '/' + n.section + '.' + n.slot).join(' ')); }
    // The engine runs a look-ahead ahead of the page's timers, so it may hold a chord or two more at the end of the run: the page's list is the prefix.
    let bad = null, worstT = 0;
    for (let k = 0; k < Math.min(pg.length, nat.length) && !bad; k++) {
      const p = pg[k], n = nat[k];
      const dt = Math.max(Math.abs(p.t * SR - n.t), Math.abs(p.end * SR - n.end));
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) bad = `chord ${k}: window ${p.t * SR}..${p.end * SR} on the page, ${n.t}..${n.end} native`;
      else if (p.section !== n.section || p.slot !== n.slot || p.pass !== n.pass) bad = `chord ${k}: at section ${p.section} chord ${p.slot} pass ${p.pass} on the page, ${n.section}/${n.slot}/${n.pass} native`;
      else if (p.rest !== n.rest || p.rootPc !== n.rootPc || p.bassPc !== n.bassPc || p.nextPc !== n.nextPc || p.lock !== n.lock || p.pcs.join() !== n.pcs.join()) bad = `chord ${k}: ${JSON.stringify(p)} on the page, ${JSON.stringify(n)} native`;
    }
    if (!bad && nat.length < pg.length) bad = nat.length + ' chords native, ' + pg.length + ' on the page';
    const same = !bad && pg.length > 6, why = bad || '';
    ok(same && c.ok && (!c.locks || nat.filter(n => n.lock).length > 0), c.name + ': ' + pg.length + ' chords identical (worst timing ' + worstT.toExponential(1) + ' frames)', why + ' ' + (c.why || []).join(','));
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
