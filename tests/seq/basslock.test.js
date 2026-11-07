/* Locked phrases in the native bass line (native/modsynth/basscore.h, docs/native-scheduling.md slice 2) against the page's own scheduler.

   A lock is a line the player froze for one chord (PHRASE_LOCKS.bass, _blLockFor): while that chord sounds it replaces the bar, indexed from
   the chord's own downbeat, moved by the capo (window.phraseFold) and not re-rooted. The grid scheduler uses it for the whole chord; the walking
   line uses it a beat at a time (the four sixteenths of the locked bar that fall inside the beat) and its two-feel skip does not apply. The page's
   scheduler runs in the real page on a clock of its own, called once per tick, with the chord windows a song would have committed and locks stored
   against some of its chords; every note it sends is kept (with every draw inside the scheduler). native/modsynth/basstool runs the same score,
   windows (with their locks) and ticks. The two lists must be the same, note for note: when (to 1e-5 of a frame), which note, how long, how
   loud, accent, slide and the note it glides from. Each case is also run without its locks, to show they change the line.

   Run: make -C native/modsynth basstool && node tests/seq/basslock.test.js        Env: CHROMIUM, PLAYWRIGHT */
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

const SONGS = {
  'I-vi-IV-V': [[0, [0, 4, 7], null, 4], [9, [0, 3, 7], null, 4], [5, [0, 4, 7], null, 4], [7, [0, 4, 7, 10], null, 4]],
  'slash chords and a rest': [[2, [0, 3, 7, 10], null, 4], [7, [0, 4, 7, 10], 11, 4], [0, [0, 4, 7, 11], null, 2], [0, [0, 4, 7], null, 2, true], [9, [0, 3, 7, 10], null, 4]],
  'odd lengths, chords a little after a beat': [[0, [0, 4, 7], null, 3.1], [5, [0, 4, 7, 10], null, 2.9], [7, [0, 4, 7], null, 4.2], [9, [0, 3, 7], null, 3.35]],
  'changes every beat or two': [[0, [0, 4, 7], null, 1], [3, [0, 3, 7], null, 2], [5, [0, 4, 7], null, 1], [10, [0, 4, 7, 10], null, 3], [7, [0, 4, 7], null, 5]],
};
// locks: chord index in the song -> { steps, delta (the lock was written over a chord this many semitones below the one that sounds), seed }
const CONFIGS = [
  { name: 'grid: locks on the vi and the V, 16 steps, written at the pitch that sounds', style: 'funk', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 8, locks: { 1: { steps: 16, delta: 0, seed: 1 }, 3: { steps: 16, delta: 0, seed: 2 } } },
  { name: 'grid: locks moved by the capo (written 2, 5 and 10 semitones off), folded into the register', style: 'funk', song: 'I-vi-IV-V', bpm: 100, rate: 1, bars: 8, swing: 40, locks: { 0: { steps: 16, delta: 2, seed: 3 }, 2: { steps: 16, delta: 5, seed: 4 }, 3: { steps: 16, delta: 10, seed: 5 } } },
  { name: 'grid: locks of 12, 5 and 24 steps repeat inside a chord, swing on the sixteenths, rate 2', style: 'funk', song: 'I-vi-IV-V', bpm: 90, rate: 2, bars: 10, swing: 60, swing8: false, locks: { 0: { steps: 12, delta: 0, seed: 6 }, 1: { steps: 5, delta: 3, seed: 7 }, 3: { steps: 24, delta: 0, seed: 8 } } },
  { name: 'grid: slash chords, a rest, and chords that start off the beat', style: 'funk', song: 'slash chords and a rest', bpm: 110, rate: 1, bars: 10, locks: { 0: { steps: 16, delta: 0, seed: 9 }, 1: { steps: 8, delta: 7, seed: 10 }, 3: { steps: 16, delta: 0, seed: 11 } } },
  { name: 'grid: chords that start a little after a beat, locks everywhere', style: 'funk', song: 'odd lengths, chords a little after a beat', bpm: 120, rate: 1, bars: 10, locks: { 0: { steps: 16, delta: 0, seed: 12 }, 1: { steps: 16, delta: 4, seed: 13 }, 2: { steps: 16, delta: 0, seed: 14 }, 3: { steps: 16, delta: 9, seed: 15 } } },
  { name: 'grid: chords that change every beat or two', style: 'funk', song: 'changes every beat or two', bpm: 130, rate: 1, bars: 8, swing: 25, locks: { 0: { steps: 16, delta: 0, seed: 16 }, 2: { steps: 4, delta: 0, seed: 17 }, 4: { steps: 16, delta: 6, seed: 18 } } },
  { name: 'grid: Follow off, the locks are not used', style: 'funk', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 6, follow: false, locks: { 1: { steps: 16, delta: 0, seed: 19 } } },
  { name: 'walk: a locked chord in a walking line, no drums', style: 'jazz', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 8, drums: null, locks: { 1: { steps: 16, delta: 0, seed: 20 }, 3: { steps: 16, delta: 3, seed: 21 } } },
  { name: 'walk: the same two-feel (the lock ignores it), drums on', style: 'jazz', two: true, song: 'I-vi-IV-V', bpm: 100, rate: 1, bars: 8, drums: 3, locks: { 0: { steps: 16, delta: 0, seed: 22 }, 2: { steps: 16, delta: 8, seed: 23 } } },
  { name: 'walk: slash chords, a rest, short and long locks', style: 'jazz', song: 'slash chords and a rest', bpm: 140, rate: 1, bars: 10, drums: null, locks: { 1: { steps: 6, delta: 0, seed: 24 }, 2: { steps: 16, delta: 5, seed: 25 }, 4: { steps: 32, delta: 0, seed: 26 } } },
  { name: 'walk: chords that start off the beat, committed late', style: 'jazz', song: 'odd lengths, chords a little after a beat', bpm: 120, rate: 1, bars: 8, drums: 1, commitAhead: 0.05, locks: { 0: { steps: 16, delta: 0, seed: 27 }, 3: { steps: 16, delta: 2, seed: 28 } } },
];

function prng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// A busy locked line: notes at both ends of the register (so the fold has work), slides, accents, lengths and levels. No probability: a
// step short of its chance draws from the engine's own generator, which the page's draws do not reach.
function lockGrid(seed, steps) {
  const rnd = prng(seed), g = [];
  for (let s = 0; s < steps; s++) {
    const c = { note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 };
    if (rnd() < 0.6) {
      c.v = 1; c.note = Math.floor(rnd() * 12); c.oct = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.25) c.len = 2 + Math.floor(rnd() * 3);
      if (rnd() < 0.25) c.slide = true;
      if (rnd() < 0.25) c.accent = true;
      if (rnd() < 0.3) c.vel = 20 + Math.floor(rnd() * 79);
    }
    g.push(c);
  }
  return g;
}

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const grids = {}; CONFIGS.forEach(c => { grids[c.name] = {}; Object.keys(c.locks).forEach(k => { grids[c.name][k] = lockGrid(c.locks[k].seed, c.locks[k].steps); }); });
  const result = await page.evaluate(async ({ configs, SONGS, grids }) => {
    const sr = 48000, out = [];
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx, realNB = window._sqNextBar;
    const sent = [];
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = m => { if (m.kind === 'note' && m.part === 'bass') sent.push(Object.assign({}, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    const LA = LOOK_AHEAD, FIRSTs = 1.0;
    const grid = Array.from({ length: 16 }, (_, i) => ({ note: i % 12, oct: 2, len: 1, slide: i % 5 === 1, accent: false, v: i % 3 === 0 || i % 5 === 1 ? 1 : 0, usr: 0 }));
    const runOne = (c, withLocks) => {
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      blRateMul = c.rate; window.setHumanize(0);
      window._sqSetSwing(c.swing || 0); window._sqSetSwing8(c.swing8 !== false);
      root = 0; mode = 'major';
      window._blRestoreState({ steps: 16, grid, follow: c.follow !== false, genStyle: c.style, walkFeel: c.two ? 'two' : 'four', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      const sd = 60 / bpm / 4 * c.rate, beat = sd * 4, tEnd = FIRSTs + c.bars * 16 * sd;
      window._sqNextBar = c.drums == null ? () => null : () => {
        const F0 = FIRSTs + c.drums * sd, n = Math.max(0, Math.ceil((_schedHorizon - F0) / sd)), nextT = F0 + n * sd;
        const toBar = ((16 - n % 16) % 16 + 16) % 16;
        return { t: nextT + toBar * sd };
      };
      const song = SONGS[c.song], slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      // the locks: stored against the chord's identity, written over a chord `delta` semitones below the one that sounds
      PHRASE_LOCKS.bass = {};
      if (withLocks) Object.keys(c.locks).forEach(k => {
        const sl = slot(+k), lk = c.locks[k];
        PHRASE_LOCKS.bass[window.phraseKey(sl)] = { grid: grids[c.name][k], steps: lk.steps, rootPc: (((sl.rootM - lk.delta) % 12) + 12) % 12 };
      });
      fake.currentTime = 0.0013;
      window._blClearChords();
      const plan = []; { let t = FIRSTs, i = 0; while (t < tEnd + 6) { const dur = song[i % song.length][3] * beat; plan.push({ t, dur, i }); t += dur; i++; } }
      let committed = 0;
      const commit = now => { while (committed < plan.length && (c.commitAhead == null || plan[committed].t <= now + c.commitAhead)) { const p = plan[committed++]; window._blOnChord(slot(p.i), p.t, p.dur, slot(p.i + 1), 0); } };
      sent.length = 0;
      commit(fake.currentTime);
      window._blSetClock(FIRSTs, 0, true);
      const ticks = [], tape = [], orig = Math.random;
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        commit(fake.currentTime);
        const nb = window._sqNextBar();
        ticks.push([fake.currentTime * sr, _schedHorizon * sr, nb ? nb.t * sr : -1].concat(window._blNativeChords(sr), [0, 0]));
        Math.random = () => { const v = orig.call(Math); tape.push(v); return v; };
        try { window._blScheduler(); } finally { Math.random = orig; }
        _schedHorizon = null;
        if (fake.currentTime + LA >= tEnd) break;
      }
      window._blSetClock(0, 0, false);
      const sc = window._blNativeScore();
      const locked = window._blNativeChords(sr);
      return { notes: sent.map(m => ({ at: m.at, note: m.note, dur: m.dur, vel: m.vel, accent: m.accent, slide: m.slide, from: m.from })), tEnd, ticks, tape,
               score: sc.score, ok: sc.ok, why: sc.why, chords: locked, bpm, rate: c.rate };
    };
    for (const c of configs) {
      const a = runOne(c, true), b = runOne(c, false);
      out.push(Object.assign({ name: c.name, plainCount: b.notes.length, differs: JSON.stringify(a.notes) !== JSON.stringify(b.notes) }, a));
    }
    window._sqNextBar = realNB; PHRASE_LOCKS.bass = {};
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { configs: CONFIGS, SONGS, grids });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const run = c => {
    const cases = [1, SR, c.bpm, c.rate, 1.0 * SR, 5, 0, c.ticks.length, c.tape.length].concat(...c.ticks, c.tape, c.score, c.chords);
    fs.writeFileSync(path.join(tmp, 'lock.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const bin = path.join(root, 'native', 'modsynth', 'basstool');
    if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth basstool'); process.exit(2); }
    const r = spawnSync(bin, [path.join(tmp, 'lock.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    return r.stdout.split('\n').filter(l => l.startsWith('N ')).map(l => { const f = l.split(' '); return { fx: +f[1], frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, slide: +f[7] === 1, from: +f[8] }; });
  };
  console.log('\nlocked phrases, the engine against the page, note for note:');
  result.forEach(c => {
    const pg = c.notes, nat = run(c);
    let same = nat.length === pg.length, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      const pf = p.from == null ? -1 : p.from;
      if (dt > 1e-5) { same = false; why = `note ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (p.note !== n.midi) { same = false; why = `note ${k}: midi ${p.note} on the page, ${n.midi} native (frame ${n.frame})`; }
      else if (Math.abs(p.dur * SR - n.dur) > 1e-5) { same = false; why = `note ${k}: length ${p.dur * SR} frames on the page, ${n.dur} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `note ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if (!!p.accent !== n.accent || !!p.slide !== n.slide || pf !== n.from) { same = false; why = `note ${k}: accent/slide/from differ (${p.accent}/${p.slide}/${pf} page, ${n.accent}/${n.slide}/${n.from} native)`; }
    }
    ok(same && pg.length > 20 && c.ok, c.name + ': ' + pg.length + ' notes identical (worst timing ' + worstT.toExponential(1) + ' frames)', why + ' ' + (c.why || []).join(','));
    const wantDiffer = !/Follow off/.test(c.name);
    ok(c.differs === wantDiffer, '  ...' + (wantDiffer ? 'and the locks change the line (it is not the unlocked one)' : 'and the line is the unlocked one, as it must be'), 'differs=' + c.differs);
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
