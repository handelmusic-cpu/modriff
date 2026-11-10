/* The native melody generator's scheduler (native/modsynth/melcore.h, docs/native-scheduling.md slice 3 part three) against the page's own window._mlScheduler.

   The page's scheduler runs in the real page on a clock of its own, called once per tick, with the chord windows a song would have committed (window._blOnChord, which the bass and the
   melody share) and phrase locks stored against some of the chords (PHRASE_LOCKS.mel); every note it sends the sound engine for the part "melgen" is kept, with every Math.random draw made inside
   the scheduler (the step probability and the humanize), which native/modsynth/meltool is handed as a tape. meltool runs the same score and windows (window._mlNativeScore, window._mlNativeChords) on
   the same ticks. The two lists must be the same, note for note: when each is struck (to 1e-5 of a frame), which note, how long, how loud, the accent, the note it slides from and how long the
   slide takes. The cases: Follow off and on over a progression (re-rooted by the chord's root into G3..C6 widened to C3..C7 round the note as written), slash chords, a rest, chords that start off the beat;
   pinned steps; chords on a step (every note, each turned down by the square root of how many; explicit Mono plays the first only); the portamento in Mono (on and off, two glide times, a single
   note after a chord); swing on the eighths and sixteenths; the speed multiplier; step probability and the humanize; phrase locks (moved by the capo, folded into G3..C6, with chords in them); a line written
   over a minor seventh chord. Each lock case is also run without its locks, to show they change the line.

   Run: make -C native/modsynth meltool && node tests/seq/melgrid.test.js        Env: CHROMIUM, PLAYWRIGHT, MELTOOL */
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
function prng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// A song: [root pitch class, intervals, slash bass or null, beats, rest]
const SONGS = {
  'I-vi-IV-V': [[0, [0, 4, 7], null, 4], [9, [0, 3, 7], null, 4], [5, [0, 4, 7], null, 4], [7, [0, 4, 7, 10], null, 4]],
  'slash chords and a rest': [[2, [0, 3, 7, 10], null, 4], [7, [0, 4, 7, 10], 11, 4], [0, [0, 4, 7, 11], null, 2], [0, [0, 4, 7], null, 2, true], [9, [0, 3, 7, 10], null, 4]],
  'odd lengths, chords a little after a beat': [[0, [0, 4, 7], null, 3.1], [5, [0, 4, 7, 10], null, 2.9], [7, [0, 4, 7], null, 4.2], [9, [0, 3, 7], null, 3.35]],
  'changes every beat or two': [[0, [0, 4, 7], null, 1], [3, [0, 3, 7], null, 2], [5, [0, 4, 7], null, 1], [10, [0, 4, 7, 10], null, 3], [7, [0, 4, 7], null, 5]],
};
// A busy melody: notes across the roll (C3 to C7) so the register logic has work, lengths, accents, levels, pins, probability and chords on some steps.
function melGrid(seed, steps, o) {
  const rnd = prng(seed), g = [];
  o = o || {};
  for (let s = 0; s < steps; s++) {
    const c = { note: 0, oct: 5, len: 1, accent: false, v: 0, usr: 0 };
    if (rnd() < (o.density || 0.6)) {
      c.v = 1; c.note = Math.floor(rnd() * 12); c.oct = o.oct != null ? o.oct : 3 + Math.floor(rnd() * 4);
      if (rnd() < 0.25) c.len = 2 + Math.floor(rnd() * 3);
      if (rnd() < 0.25) c.accent = true;
      if (rnd() < 0.3) c.vel = 20 + Math.floor(rnd() * 79);
      if (o.fix && rnd() < o.fix) c.fix = 1;
      if (o.pr && rnd() < 0.5) c.pr = 30 + Math.floor(rnd() * 60);
      if (o.chords && rnd() < o.chords) { c.more = []; const n = 1 + Math.floor(rnd() * Math.min(7, o.maxMore || 3)); for (let i = 0; i < n; i++) c.more.push({ note: Math.floor(rnd() * 12), oct: 3 + Math.floor(rnd() * 4) }); }
    }
    g.push(c);
  }
  return g;
}
const CONFIGS = [
  { name: 'Follow off: the line as written on every chord, no chart', song: 'I-vi-IV-V', bpm: 120, bars: 6, follow: false, grid: { seed: 1 } },
  { name: 'Follow on over I-vi-IV-V: re-rooted onto each chord, notes across the roll', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 2 } },
  { name: 'Follow on over a line written over a minor seventh (Dm7), tones of its own', song: 'I-vi-IV-V', bpm: 110, bars: 8, grid: { seed: 3 }, gridRoot: 2, gridIntvs: [0, 3, 7, 10] },
  { name: 'slash chords and a rest in the chart', song: 'slash chords and a rest', bpm: 100, bars: 10, grid: { seed: 4 } },
  { name: 'chords that start a little after a beat', song: 'odd lengths, chords a little after a beat', bpm: 120, bars: 10, grid: { seed: 5 } },
  { name: 'chords that change every beat or two', song: 'changes every beat or two', bpm: 130, bars: 8, grid: { seed: 6 }, swing: 25 },
  { name: 'pinned steps stay where they were written', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 7, fix: 0.5 } },
  { name: 'chords on a step: every note sounds, turned down by the root of how many', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 8, chords: 0.5, maxMore: 5 } },
  { name: 'chords on a step with Follow off', song: 'I-vi-IV-V', bpm: 120, bars: 6, follow: false, grid: { seed: 9, chords: 0.6 } },
  { name: 'explicit Mono plays the first note of a chord only', song: 'I-vi-IV-V', bpm: 120, bars: 6, mono: true, auto: false, grid: { seed: 10, chords: 0.6 } },
  { name: 'portamento (Mono, Auto): a single note slides from the one before', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 11, density: 0.85 } },
  { name: 'portamento with a longer glide time (0.35 s)', song: 'I-vi-IV-V', bpm: 90, bars: 8, glideTime: 0.35, grid: { seed: 12, density: 0.9 } },
  { name: 'portamento switched off', song: 'I-vi-IV-V', bpm: 120, bars: 6, glideOn: false, grid: { seed: 13, density: 0.85 } },
  { name: 'Poly (Mono false): no portamento, chords play', song: 'I-vi-IV-V', bpm: 120, bars: 6, mono: false, grid: { seed: 14, density: 0.85, chords: 0.3 } },
  { name: 'swing on the eighths (45%)', song: 'I-vi-IV-V', bpm: 120, bars: 8, swing: 45, grid: { seed: 15, density: 0.8 } },
  { name: 'swing on the sixteenths (60%), the melody at half the speed', song: 'I-vi-IV-V', bpm: 100, bars: 10, rate: 2, swing: 60, swing8: false, grid: { seed: 16, density: 0.8 } },
  { name: 'a 24-step line at twice the speed', song: 'slash chords and a rest', bpm: 120, bars: 8, rate: 0.5, steps: 24, grid: { seed: 17 } },
  { name: 'probability on some steps (the page\'s draws as the tape)', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 18, pr: 1 } },
  { name: 'the humanize on (time and velocity) with probability', song: 'I-vi-IV-V', bpm: 120, bars: 8, human: 1, grid: { seed: 19, pr: 1, density: 0.8 } },
  { name: 'the melody generator left tight in Settings > Humanize', song: 'I-vi-IV-V', bpm: 120, bars: 6, human: 1, humanOff: true, grid: { seed: 20, pr: 1 } },
  { name: 'locks on the vi and the V, written at the pitch that sounds', song: 'I-vi-IV-V', bpm: 120, bars: 8, grid: { seed: 21 }, locks: { 1: { steps: 16, delta: 0, seed: 31 }, 3: { steps: 16, delta: 0, seed: 32 } } },
  { name: 'locks moved by the capo (2, 5 and 10 semitones off), folded into G3..C6, with chords in them', song: 'I-vi-IV-V', bpm: 100, bars: 8, swing: 40, grid: { seed: 22 }, locks: { 0: { steps: 16, delta: 2, seed: 33, chords: 0.4 }, 2: { steps: 16, delta: 5, seed: 34, chords: 0.4 }, 3: { steps: 16, delta: 10, seed: 35 } } },
  { name: 'locks of 12, 5 and 24 steps repeat inside a chord, sixteenths swung', song: 'I-vi-IV-V', bpm: 90, bars: 10, rate: 2, swing: 60, swing8: false, grid: { seed: 23 }, locks: { 0: { steps: 12, delta: 0, seed: 36 }, 1: { steps: 5, delta: 3, seed: 37 }, 2: { steps: 24, delta: 0, seed: 38 } } },
  { name: 'locks with slash chords, a rest, and chords off the beat', song: 'slash chords and a rest', bpm: 110, bars: 10, grid: { seed: 24 }, locks: { 0: { steps: 16, delta: 0, seed: 39 }, 1: { steps: 8, delta: 7, seed: 40 }, 3: { steps: 16, delta: 0, seed: 41 }, 4: { steps: 16, delta: 4, seed: 42 } } },
  { name: 'Follow off: the locks are not used', song: 'I-vi-IV-V', bpm: 120, bars: 6, follow: false, grid: { seed: 25 }, locks: { 1: { steps: 16, delta: 0, seed: 43 } } },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const grids = {}, lockGrids = {};
  CONFIGS.forEach(c => {
    grids[c.name] = melGrid(c.grid.seed, c.steps || 16, c.grid);
    lockGrids[c.name] = {}; Object.keys(c.locks || {}).forEach(k => { const l = c.locks[k]; lockGrids[c.name][k] = melGrid(l.seed, l.steps, { chords: l.chords }); });
  });
  const result = await page.evaluate(async ({ configs, SONGS, grids, lockGrids }) => {
    const sr = 48000, out = [];
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx;
    const sent = [];
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = m => { if (m.kind === 'note' && m.part === 'melgen') sent.push(Object.assign({}, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    const LA = LOOK_AHEAD, FIRSTs = 1.0;
    const runOne = (c, withLocks) => {
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      mlRateMul = c.rate || 1; window.setHumanize(c.human || 0); window.setHumanizeMix('drift', 0); window.setHumanizeMix('time', 1); window.setHumanizeMix('vel', 1);   // (the drift is read at the step's own time by the engine and at the clock's by the page: a look-ahead apart)
      if (window._humanState().off.indexOf('melgen') >= 0) window.toggleHumanPart('melgen');
      if (c.humanOff) window.toggleHumanPart('melgen');
      window._sqSetSwing(c.swing || 0); window._sqSetSwing8(c.swing8 !== false);
      root = 0; mode = 'major';
      melMono = c.mono == null ? true : c.mono; melAuto = c.auto == null ? true : c.auto; melGlideOn = c.glideOn !== false; melGlideTime = c.glideTime || 0.12;
      const steps = c.steps || 16;
      window._mlRestoreState({ steps, grid: grids[c.name], follow: c.follow !== false, gridRootPc: c.gridRoot || 0, gridIntvs: c.gridIntvs || [0, 4, 7] });
      const sd = 60 / bpm / 4 * (c.rate || 1), beat = 60 / bpm, tEnd = FIRSTs + c.bars * 16 * sd;
      const song = SONGS[c.song], slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      PHRASE_LOCKS.mel = {};
      if (withLocks && c.locks) Object.keys(c.locks).forEach(k => {
        const sl = slot(+k), lk = c.locks[k];
        PHRASE_LOCKS.mel[window.phraseKey(sl)] = { grid: lockGrids[c.name][k], steps: lk.steps, rootPc: (((sl.rootM - lk.delta) % 12) + 12) % 12 };
      });
      fake.currentTime = 0.0013;
      window._blClearChords();
      const plan = []; { let t = FIRSTs, i = 0; while (t < tEnd + 6) { const dur = song[i % song.length][3] * beat; plan.push({ t, dur, i }); t += dur; i++; } }
      let committed = 0;
      const commit = () => { while (committed < plan.length) { const p = plan[committed++]; window._blOnChord(slot(p.i), p.t, p.dur, slot(p.i + 1), 0); } };
      sent.length = 0;
      commit();
      window._mlSetClock(FIRSTs, 0, true);
      const ticks = [], tape = [], orig = Math.random;
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        ticks.push([_schedHorizon * sr].concat(window._mlNativeChords(sr)));
        Math.random = () => { const v = orig.call(Math); tape.push(v); return v; };
        try { window._mlScheduler(); } finally { Math.random = orig; }
        _schedHorizon = null;
        if (fake.currentTime + LA >= tEnd) break;
      }
      window._mlSetClock(0, 0, false);
      const sc = window._mlNativeScore();
      return { notes: sent.map(m => ({ at: m.at, note: m.note, dur: m.dur, vel: m.vel, accent: m.accent, glideFrom: m.glideFrom, glideTime: m.glideTime })), tEnd, ticks, tape,
               score: sc.score, ok: sc.ok, why: sc.why, chords: window._mlNativeChords(sr), bpm, rate: c.rate || 1 };
    };
    for (const c of configs) {
      const a = runOne(c, true), b = c.locks ? runOne(c, false) : null;
      out.push(Object.assign({ name: c.name, differs: b ? JSON.stringify(a.notes) !== JSON.stringify(b.notes) : null, nGlide: a.notes.filter(n => n.glideFrom != null).length,
                               nPoly: a.notes.filter((n, i) => i && a.notes[i - 1].at === n.at).length }, a));
    }
    window.setHumanize(0); if (window._humanState().off.indexOf('melgen') >= 0) window.toggleHumanPart('melgen');
    window._sqSetSwing(0); window._sqSetSwing8(true);
    melMono = true; melAuto = true; melGlideOn = true; melGlideTime = 0.12; mlRateMul = 1;
    PHRASE_LOCKS.mel = {};
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { configs: CONFIGS, SONGS, grids, lockGrids });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melgrid-'));
  const bin = process.env.MELTOOL || path.join(root, 'native', 'modsynth', 'meltool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth meltool'); process.exit(2); }
  const run = c => {
    const cases = [1, SR, c.bpm, c.rate, 1.0 * SR, 5, 0, c.ticks.length, c.tape.length].concat(...c.ticks, c.tape, c.score, c.chords);
    fs.writeFileSync(path.join(tmp, 'mel.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'mel.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    return r.stdout.split('\n').filter(l => l.startsWith('N ')).map(l => { const f = l.split(' '); return { fx: +f[1], frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, gfrom: +f[7], gframes: +f[8] }; });
  };
  console.log('\nthe melody generator, the engine against the page, note for note:');
  result.forEach(c => {
    const pg = c.notes, nat = run(c);
    let same = nat.length === pg.length, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      const pf = p.glideFrom == null ? -1 : p.glideFrom;
      if (dt > 1e-5) { same = false; why = `note ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (p.note !== n.midi) { same = false; why = `note ${k}: midi ${p.note} on the page, ${n.midi} native (frame ${n.frame})`; }
      else if (Math.abs(p.dur * SR - n.dur) > 1e-5) { same = false; why = `note ${k}: length ${p.dur * SR} frames on the page, ${n.dur} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `note ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if (!!p.accent !== n.accent || pf !== n.gfrom) { same = false; why = `note ${k}: accent/glide source differ (${p.accent}/${pf} page, ${n.accent}/${n.gfrom} native)`; }
      else if (pf >= 0 && Math.abs(p.glideTime * SR - n.gframes) > 1e-5) { same = false; why = `note ${k}: slide of ${p.glideTime * SR} frames on the page, ${n.gframes} native`; }
    }
    const extra = (c.nGlide ? ', ' + c.nGlide + ' slides' : '') + (c.nPoly ? ', ' + c.nPoly + ' chord notes' : '');
    ok(same && pg.length > 20 && c.ok, c.name + ': ' + pg.length + ' notes identical (worst timing ' + worstT.toExponential(1) + ' frames' + extra + ')', why + ' ' + (c.why || []).join(','));
    if (c.differs !== null) {
      const wantDiffer = !/Follow off/.test(c.name);
      ok(c.differs === wantDiffer, '  ...' + (wantDiffer ? 'and the locks change the line (it is not the unlocked one)' : 'and the line is the unlocked one, as it must be'), 'differs=' + c.differs);
    }
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
