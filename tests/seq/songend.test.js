/* The endings in the engine (native/modsynth/songcore.h EndingEvent, songend.h; docs/native-scheduling.md, slice 4, piece 7b) against the page's own: armEnding, then the song's pass
   ends and _runEnding does what it does -- for real, in the page, on a clock of our own (as in songstep.test.js), with everything it sends the sound engine kept.

   native/modsynth/songtool runs the engine's song on the same score and ticks (the player's tap on an ending is a tick, move = 10 + the ending) and prints what it asks of the host:
   the landing (E), the band hit (D), the tonic chord (K), the bass's last note (B), the moment it is all stopped (F), a fade's start and end, a ritardando's tempo steps.
   Held to the page's:
     cold, finish   the landing's moment (the downbeat after the pass), the kit's kick, cymbal and snare with their levels, the chord (notes, slash bass, sustained or a stab), the
                    bass's note and its length, the release and the stop after it (the page's timers wake from the announcement, a look-ahead before the engine's frames: compared to
                    that);
     tag            the last two chords again, then the finish a pass later, the chords of the whole run;
     ritard         the tempo it steps to (every step's value, the spacing of the steps) and the bar line it lands on, with the soft hit;
     fade           the 56 steps of the master in decibels, their spacing, the chart playing on through it, and the stop at its end.

   Run: make -C native/modsynth songtool && node tests/seq/songend.test.js        Env: CHROMIUM, PLAYWRIGHT, SONGTOOL */
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
const MAJ = [0, 4, 7], MIN = [0, 3, 7], M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11], DOM = [0, 4, 7, 10];
const CODE = { cold: 1, finish: 2, fade: 3, tag: 4, ritard: 5 };
// [rootM, ivs, bars, beats, eighths, bass note, rest]
const FOUR = [{ plays: 0, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }];
const CASES = [
  { name: 'finish: the whole band lands on the tonic and the chord rings out', kind: 'finish', bpm: 120, armAt: 4.6, sections: FOUR },
  { name: 'cold: the final bar plays and everything stops dead on the downbeat after it', kind: 'cold', bpm: 120, armAt: 4.6, sections: FOUR },
  { name: 'finish in C minor at 90 BPM, armed late in a pass', kind: 'finish', bpm: 90, armAt: 7.3, mode: 'minor', root: 0, sections: [{ plays: 0, slots: [[48, MIN, 1], [53, MIN, 1], [55, DOM, 1]] }] },
  { name: 'cold in 3/4 (the bar is three beats)', kind: 'cold', bpm: 120, armAt: 4.6, meter: [3, 4], sections: FOUR },
  { name: 'finish in D (the landing is the tonic of the key it is in)', kind: 'finish', bpm: 120, armAt: 4.6, root: 2, sections: FOUR },
  { name: 'finish in 3/4 (the hold is the bar of three beats)', kind: 'finish', bpm: 100, armAt: 4.6, meter: [3, 4], sections: FOUR },
  { name: 'tag: the last two chords again, then the finish', kind: 'tag', bpm: 120, armAt: 4.6, sections: FOUR },
  { name: 'tag in a section of one chord: nothing to repeat, it finishes', kind: 'tag', bpm: 120, armAt: 4.6, sections: [{ plays: 0, slots: [[48, MAJ, 1]] }] },
  { name: 'ritardando: the tempo steps down, the chart plays on, the band lands on a bar line', kind: 'ritard', bpm: 120, armAt: 4.6, sections: FOUR, secs: 60 },
  { name: 'ritardando at 80 BPM', kind: 'ritard', bpm: 80, armAt: 6.1, sections: FOUR, secs: 70 },
  { name: 'ritardando at 100 BPM', kind: 'ritard', bpm: 100, armAt: 5.0, sections: FOUR, secs: 70 },
  { name: 'ritardando at 140 BPM', kind: 'ritard', bpm: 140, armAt: 3.3, sections: FOUR, secs: 60 },
  { name: 'ritardando at 110 BPM, armed late', kind: 'ritard', bpm: 110, armAt: 7.7, sections: FOUR, secs: 70 },
  { name: 'ritardando in 2/4 at 150 BPM: a bar line falls just after the curve ends, too soon to have been heard of, so it lands on the next', kind: 'ritard', bpm: 150, armAt: 2.9, meter: [2, 4], sections: FOUR, secs: 40 },
  { name: 'ritardando over two sections that play once each: nothing moves while it slows', kind: 'ritard', bpm: 120, armAt: 4.6, sections: [{ plays: 1, slots: [[48, MAJ, 1], [57, M7, 1]] }, { plays: 1, slots: [[53, MAJ7, 1], [55, DOM, 1]] }], secs: 60 },
  { name: 'fade over two sections that play once each: the chart goes round without moving on', kind: 'fade', bpm: 120, armAt: 4.6, sections: [{ plays: 1, slots: [[48, MAJ, 1], [57, M7, 1]] }, { plays: 1, slots: [[53, MAJ7, 1], [55, DOM, 1]] }], secs: 60 },
  { name: 'tag, then a cold armed during the tag: the player\'s ending wins over the queued finish', kind: 'tag', bpm: 120, armAt: 4.6, arm2: { kind: 'cold', at: 10.3 }, sections: FOUR, secs: 40 },
  { name: 'fade: the master comes down over four bars with the chart playing', kind: 'fade', bpm: 120, armAt: 4.6, sections: FOUR, secs: 60 },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songend-'));
  const bin = process.env.SONGTOOL || path.join(root, 'native', 'modsynth', 'songtool');

  for (const c of CASES) {
    const run = await page.evaluate(({ c, CODE }) => {
      const sr = 48000, fake = { currentTime: 0, sampleRate: sr, state: 'running' };
      const off = new OfflineAudioContext(2, sr, sr);
      const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
      clearTimeout(clockTimer);
      const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realBl = window._blPlaying, realSetTimeout = window.setTimeout, realClearTimeout = window.clearTimeout;
      const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
      const sent = [];
      E.send = m => { sent.push(Object.assign({ wall: fake.currentTime }, m)); }; E.now = () => fake.currentTime; E.ready = () => true;
      window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
      let timers = [], tid = 1;
      window.setTimeout = (fn, ms) => { const id = tid++; timers.push({ id, t: fake.currentTime + (ms || 0) / 1000, fn }); return id; };
      window.clearTimeout = id => { timers = timers.filter(x => x.id !== id); };
      const runTimers = () => { for (let g = 0; g < 1000; g++) { timers.sort((a, b) => a.t - b.t || a.id - b.id); const x = timers[0]; if (!x || x.t > fake.currentTime + 1e-12) break; timers.shift(); try { x.fn(); } catch (e) { } } };
      const LA = LOOK_AHEAD, T0 = 1.0, DT = 0.003;
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      fake.currentTime = 0.0013; timers = [];
      stopSongLoop();
      root = c.root || 0; mode = c.mode || 'major'; _bassAutoSync = false; songCompStyle = 'sustain'; snapMode = 'bar'; rhythmOn = false; window._sqSetSwing(0);
      METER.beats = c.meter ? c.meter[0] : 4; METER.unit = c.meter ? c.meter[1] : 4;
      window._sqPlaying = () => true; window._blPlaying = () => true; drumsEnabled = true; songEnding = null; _endQueued = null; _endingRunning = false; _endLandPending = null; _endRestore = null;
      const mk = a => { const s = { rootM: a[0], ivs: a[1].slice(), bars: a[2] || 0, beats: a[3] || 0, eighths: a[4] || 0, isRest: !!a[6], label: 'x' }; if (a[5] != null) s.bassNote = a[5]; return s; };
      sections = c.sections.map((s, i) => ({ name: 'S' + i, slots: s.slots.map(mk), plays: s.plays }));
      songCurrentSection = 0; songCurrentSlot = 0; _songHeldAt = null; songSectionPass = 0; songPendingSectionDelta = 0; songWaitingForBar = false; masterVol = 0.8;
      const events = [];
      const rg = _setBpmGliss; _setBpmGliss = function (v) { const r = rg.apply(this, arguments); events.push({ t: fake.currentTime, what: 'bpm', v: r }); return r; };
      const rs = stopEverything; stopEverything = function () { events.push({ t: fake.currentTime, what: 'stopEverything' }); try { return rs.apply(this, arguments); } catch (e) { } };
      const ra = applyMasterBus; applyMasterBus = function () { events.push({ t: fake.currentTime, what: 'master', v: masterVol }); return ra.apply(this, arguments); };
      const barSec = _songBarSteps() * 60 / bpm / 4, marks = []; for (let m = T0; m < T0 + (c.secs || 40) + 10; m += barSec) marks.push(m);
      let announced = 0; window._barAnnouncedT = 0;
      const startVol = masterVol;
      startSongLoop(false, T0);
      const sc = window._songNativeScore({ chords: true }), ticks = [];
      sent.length = 0;
      let armed = false, armed2 = false;
      for (let g = 0; g < 100000; g++) {
        fake.currentTime += DT;
        const horizon = fake.currentTime + LA, mk2 = [];
        while (announced < marks.length && marks[announced] < horizon) { const m = marks[announced++]; mk2.push(m * sr); window._barAnnouncedT = m; tickSongLoop(m); }
        runTimers();
        let move = 0;
        if (c.arm2 && !armed2 && fake.currentTime >= c.arm2.at) { armed2 = true; armEnding(c.arm2.kind); move = 10 + CODE[c.arm2.kind]; }
        if (!armed && fake.currentTime >= c.armAt) { armed = true; armEnding(c.kind); move = 10 + CODE[c.kind]; events.push({ t: fake.currentTime, what: 'armed' }); }
        ticks.push([fake.currentTime * sr, horizon * sr, 1, mk2.length].concat(mk2, [move, 1e9]));
        if (fake.currentTime > T0 + (c.secs || 40)) break;
      }
      stopSongLoop();
      _setBpmGliss = rg; stopEverything = rs; applyMasterBus = ra;
      window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout; window._sqPlaying = realSq; window._blPlaying = realBl;
      window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
      METER.beats = 4; METER.unit = 4; root = 0; mode = 'major';
      return { events, sent, ticks, score: sc.score, ok: sc.ok, why: sc.why, bpm, first: T0 * sr, DT, LA, startVol, decay: parseFloat(document.getElementById('decay').value) || 2 };
    }, { c, CODE });

    // the engine, on the same score and ticks
    const cases = [1, SR, run.bpm, run.first, 0, 0, 0, run.ticks.length].concat(...run.ticks, run.score);
    fs.writeFileSync(path.join(tmp, 'song.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'song.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(c.name + ': ' + r.stderr); process.exit(2); }
    const eng = { E: [], D: [], K: [], B: [], F: [], V: [], W: [] };
    r.stdout.split('\n').forEach(l => {
      const f = l.split(' ');
      if (l.startsWith('E ')) { const ns = +f[11]; eng.E.push({ type: +f[1], frame: +f[2], kind: +f[3], sustain: +f[4], snare: +f[5], soft: +f[6], hold: +f[7], dur: +f[8], steps: +f[9], from: +f[10], tempo: Array.from({ length: ns }, (_, i) => [+f[12 + 2 * i], +f[13 + 2 * i]]) }); }
      else if (l.startsWith('D ')) eng.D.push({ frame: +f[1], lane: +f[2], vel: +f[3], accent: +f[4] });
      else if (l.startsWith('K ')) { if (f[1] === 'stop') eng.K.push({ stop: true, frame: +f[2] }); else { const nn = +f[7]; eng.K.push({ frame: +f[1], vel: +f[2], dur: +f[3], hold: +f[4], holdSec: +f[5], sub: +f[6], notes: f.slice(8, 8 + nn).map(Number) }); } }
      else if (l.startsWith('B ')) eng.B.push({ frame: +f[1], midi: +f[2], dur: +f[3], vel: +f[4], accent: +f[5] });
      else if (l.startsWith('F ')) eng.F.push(+f[1]);
      else if (l.startsWith('V ')) { const nn = +f[7]; eng.V.push({ frame: +f[1], vel: +f[2], dur: +f[3], hold: +f[4], holdSec: +f[5], sub: +f[6], notes: f.slice(8, 8 + nn).map(Number) }); }
      else if (l.startsWith('W ')) eng.W.push({ t: +f[1], rest: +f[3], section: +f[8], slot: +f[9] });
    });
    const sent = run.sent, ev = run.events;
    let bad = null;
    const land = eng.E.find(e => e.type === 0);
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const pgChords = sent.filter(m => m.kind === 'chord' && m.part === 'chord');
    const pgHits = sent.filter(m => m.kind === 'hit'), pgBass = sent.filter(m => m.kind === 'note' && m.part === 'bass'), pgRel = sent.filter(m => m.kind === 'release' && m.part === 'chord');
    const stopEv = ev.find(e => e.what === 'stopEverything');

    // the chords of the whole run: the page's strikes against the engine's, the landing chord last
    const engChords = [];
    eng.V.forEach(v => engChords.push(v));
    if (land) { const k = eng.K[0]; if (k && !k.stop) engChords.push(k); }
    engChords.sort((a, b) => a.frame - b.frame);
    for (let k = 0; k < pgChords.length && !bad; k++) {
      const p = pgChords[k], n = engChords[k];
      if (!n) { bad = `chord ${k}: the page struck ${pgChords.length}, the engine ${engChords.length}`; break; }
      const notes = (p.bass != null ? [p.bass] : []).concat(p.notes), sub = p.bass != null ? p.bass : p.root;
      if (!near(p.at * SR, n.frame, 1e-5)) bad = `chord ${k}: struck at ${p.at * SR} on the page, ${n.frame} native`;
      else if (notes.join() !== n.notes.join()) bad = `chord ${k}: notes ${notes.join()} on the page, ${n.notes.join()} native`;
      else if (sub !== n.sub) bad = `chord ${k}: sub ${sub} on the page, ${n.sub} native`;
      else if ((p.dur == null) !== !!n.hold) bad = `chord ${k}: ${p.dur == null ? 'held' : 'decaying'} on the page, ${n.hold ? 'held' : 'decaying'} native`;
      else if (p.dur != null && Math.abs(p.dur - n.dur) > 1e-12) bad = `chord ${k}: decays ${p.dur} s on the page, ${n.dur} native`;
    }
    if (!bad && engChords.length < pgChords.length) bad = `${engChords.length} chords native, ${pgChords.length} on the page`;
    ok(!bad && pgChords.length >= 3, c.name + ': the chords of the run (' + pgChords.length + ', the landing one last) are the same', bad || '');

    if (c.kind === 'ritard') {
      // the tempo: every step's value, the spacing of the steps (the page's timers wake on a tick: within one), the bar line it lands on
      const pg = ev.filter(e => e.what === 'bpm'), en = eng.E.find(e => e.type === 3);
      let tb = null;
      if (!en) tb = 'the engine began no ritardando';
      else if (pg.length !== en.tempo.length) tb = `${pg.length} steps on the page, ${en.tempo.length} native`;
      else for (let i = 0; i < pg.length && !tb; i++) {
        if (i === 0 && Math.abs(pg[0].t - en.tempo[0][0] / SR) > run.DT + 1e-6) tb = `the first step at ${pg[0].t.toFixed(4)} s on the page, ${(en.tempo[0][0] / SR).toFixed(4)} native`;
        else if (pg[i].v !== en.tempo[i][1]) tb = `step ${i + 1}: tempo ${pg[i].v} on the page, ${en.tempo[i][1]} native`;
        else if (i > 0 && Math.abs((pg[i].t - pg[i - 1].t) - (en.tempo[i][0] - en.tempo[i - 1][0]) / SR) > run.DT + 1e-6) tb = `step ${i + 1}: ${(pg[i].t - pg[i - 1].t).toFixed(4)} s after the one before on the page, ${((en.tempo[i][0] - en.tempo[i - 1][0]) / SR).toFixed(4)} native`;
      }
      ok(!tb && pg.length >= 6, '    ...and the ritardando steps the tempo ' + pg.map(e => e.v).join('>') + ' at the same spacing', tb || '');
    }
    if (c.kind === 'fade') {
      const pg = ev.filter(e => e.what === 'master' && e.v !== run.startVol || e.what === 'master' && e.v === 0).filter((e, i, a) => true);
      const steps = ev.filter(e => e.what === 'master' && e.t > c.armAt);
      const fs0 = eng.E.find(e => e.type === 1), fe = eng.E.find(e => e.type === 2);
      let fb = null;
      if (!fs0 || !fe) fb = 'the engine began or ended no fade';
      else {
        const gains = steps.map(s => s.v / run.startVol);
        const want = Array.from({ length: 56 }, (_, i) => i + 1 >= 56 ? 0 : Math.pow(10, (-48 * (i + 1) / 56) / 20));
        const got = gains.slice(0, 56);
        if (got.length < 56) fb = `${got.length} steps on the page`;
        else for (let i = 0; i < 56 && !fb; i++) if (Math.abs(got[i] - want[i]) > 1e-9) fb = `step ${i + 1}: gain ${got[i]} on the page, ${want[i]} by the dB curve`;
        if (!fb && fs0.steps !== 56) fb = 'the engine fades in ' + fs0.steps + ' steps';
        const span = (steps[55].t - steps[0].t) / 55 * 56;      // the page's steps are spaced dur/56 apart
        if (!fb && Math.abs(span - fs0.dur / SR) > 56 * run.DT + 0.01) fb = `the page fades over ${span.toFixed(3)} s, the engine over ${(fs0.dur / SR).toFixed(3)}`;
        if (!fb && stopEv && Math.abs(stopEv.t - fe.frame / SR) > run.LA + 2 * run.DT) fb = `stopped at ${stopEv.t.toFixed(3)} s on the page, ${(fe.frame / SR).toFixed(3)} native`;
      }
      ok(!fb, '    ...and the fade rides the master down in decibels in 56 steps over four bars, then stops', fb || '');
    }
    if (land) {
      // the landing: the downbeat, the band hit, the bass note, when it is let go and stopped
      let lb = null;
      const Lp = pgHits.length ? pgHits[0].at : (pgChords.length ? pgChords[pgChords.length - 1].at : null);
      if (Lp == null) lb = 'the page landed nothing';
      else if (!near(Lp * SR, land.frame, 1e-5)) lb = `landed at ${Lp * SR} on the page, ${land.frame} native`;
      else if (pgHits.length !== eng.D.length) lb = `${pgHits.length} drum hits on the page, ${eng.D.length} native`;
      else for (let i = 0; i < pgHits.length && !lb; i++) { const p = pgHits[i], n = eng.D[i]; if (p.lane !== n.lane || Math.abs(p.vel - n.vel) > 1e-12 || !!p.accent !== !!n.accent || !near(p.at * SR, n.frame, 1e-5)) lb = `hit ${i}: lane ${p.lane} level ${p.vel} on the page, lane ${n.lane} level ${n.vel} native`; }
      if (!lb) {
        const pb = pgBass[pgBass.length - 1], nb = eng.B[0];
        if (!pb || !nb) lb = 'a bass note on one side only';
        else if (pb.note !== nb.midi || Math.abs(pb.vel - nb.vel) > 1e-12 || !pb.accent !== !nb.accent || Math.abs(pb.dur - nb.dur / SR) > 1e-9) lb = `bass note ${pb.note} for ${pb.dur} s on the page, ${nb.midi} for ${nb.dur / SR} native`;
      }
      if (!lb && stopEv) {
        // the page's timers wake from the announcement (a look-ahead before the downbeat); the engine counts from the downbeat itself
        const dt = stopEv.t - eng.F[0] / SR;
        if (dt > 0.01 || dt < -(run.LA + 2 * run.DT)) lb = `stopped at ${stopEv.t.toFixed(3)} s on the page, ${(eng.F[0] / SR).toFixed(3)} native`;
      }
      if (!lb && land.sustain) {
        const rel = pgRel[pgRel.length - 1], k = eng.K[0];
        if (!rel || !k) lb = 'no release';
        else { const dt = rel.wall - (k.frame / SR + k.holdSec); if (dt > 0.01 || dt < -(run.LA + 2 * run.DT)) lb = `let go at ${rel.wall.toFixed(3)} s on the page, ${(k.frame / SR + k.holdSec).toFixed(3)} native`; }
      }
      ok(!lb, '    ...and the landing at ' + (land.frame / SR).toFixed(3) + ' s: ' + eng.D.length + ' drum hits (' + eng.D.map(d => d.lane + '@' + d.vel).join(' ') + '), the chord, the bass note, let go and stopped as the page does', lb || '');
    } else if (c.kind !== 'fade') ok(false, '    ...and the engine landed', 'no landing');
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
