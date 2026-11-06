/* The native bass line (native/modsynth/basscore.h, docs/native-scheduling.md slice 2) against the page's own scheduler.

   The page's window._blScheduler is run in the real page on a clock of its own (the way drumgrid.test.js does the drums), with the
   chord windows the song would have committed, and every note it sends (modSend kind 'note', part 'bass') is kept.
   native/modsynth/basstool runs the same score and the same windows. The two lists must be the same: when each note starts (to 1e-5
   of a frame), which note, how long, how loud, accent, slide and the note it glides from.

   What is exact is held exactly; what the page draws from Math.random (probability, humanize) is held on statistics, as the drums are.

   Run: make -C native/modsynth basstool && node tests/seq/bassgrid.test.js        Env: CHROMIUM, PLAYWRIGHT */
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
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A busy bass grid: every field the scheduler reads.
function busyGrid(seed, steps, o) {
  o = o || {}; const rnd = prng(seed), g = [];
  for (let s = 0; s < steps; s++) {
    const c = { note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 };
    if (rnd() < (o.density || 0.55)) {
      c.v = 1; c.note = Math.floor(rnd() * 12); c.oct = 1 + Math.floor(rnd() * 3);
      // Half the notes are the line's own chord tones (root, third, fifth, seventh of the chord it was written over): a line that
      // follows maps those by role, and the root onto a slash bass.
      if (o.gridRoot != null && rnd() < 0.5) c.note = (o.gridRoot + o.gridIntvs[Math.floor(rnd() * o.gridIntvs.length)]) % 12;
      if (rnd() < 0.25) c.len = 2 + Math.floor(rnd() * 3);
      if (rnd() < 0.2) c.slide = true;
      if (rnd() < 0.25) c.accent = true;
      if (rnd() < 0.08) c.fix = true;
      if (rnd() < 0.3) c.vel = 20 + Math.floor(rnd() * 79);
      if (o.prob && rnd() < 0.5) c.pr = o.prob;
    }
    g.push(c);
  }
  return g;
}
// Chords: [rootM (semitones from C), ivs, bass pc or null, beats, rest]. A chart's slots, as _blOnChord reads them.
const SONGS = {
  'I-vi-IV-V': [[0, [0, 4, 7], null, 4], [9, [0, 3, 7], null, 4], [5, [0, 4, 7], null, 4], [7, [0, 4, 7, 10], null, 4]],
  'slash and a rest': [[0, [0, 4, 7], 4, 4], [7, [0, 4, 7], 11, 2], [0, [0, 4, 7], null, 2, true], [2, [0, 3, 7, 10], null, 4], [5, [0, 4, 7, 11], null, 3], [8, [0, 4, 7], null, 5]],
  'a short rest': [[0, [0, 4, 7], null, 2], [0, [0, 4, 7], null, 1, true], [5, [0, 4, 7], null, 5]],
  'short changes': [[0, [0, 4, 7], null, 1], [3, [0, 3, 7], null, 1], [5, [0, 4, 7], null, 2], [10, [0, 4, 7, 10], null, 1], [7, [0, 4, 7], null, 3]],
};

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  // Deterministic cases: no probability, no humanize.
  const det = [
    { name: 'follow, I-vi-IV-V, 16 steps', seed: 1, song: 'I-vi-IV-V', bpm: 120, rate: 1, steps: 16, swing: 0, swing8: true, follow: true, bars: 8, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
    { name: 'swing 40 on the eighths, minor key', seed: 2, song: 'I-vi-IV-V', bpm: 100, rate: 1, steps: 16, swing: 40, swing8: true, follow: true, bars: 8, gridRoot: 9, gridIntvs: [0, 3, 7], mode: 'minor', root: 9 },
    { name: 'swing 60 on the sixteenths, rate 2', seed: 3, song: 'slash and a rest', bpm: 110, rate: 2, steps: 16, swing: 60, swing8: false, follow: true, bars: 10, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
    { name: 'slash chords and a rest', seed: 4, song: 'slash and a rest', bpm: 90, rate: 1, steps: 16, swing: 0, swing8: true, follow: true, bars: 8, gridRoot: 2, gridIntvs: [0, 3, 7, 10], mode: 'dorian', root: 2 },
    { name: 'a 12-step line over chords that change every beat', seed: 5, song: 'short changes', bpm: 130, rate: 1, steps: 12, swing: 25, swing8: true, follow: true, bars: 10, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
    { name: 'a 32-step line, dense, sixty-four seconds in', seed: 6, song: 'I-vi-IV-V', bpm: 140, rate: 1, steps: 32, swing: 15, swing8: true, follow: true, bars: 6, gridRoot: 7, gridIntvs: [0, 4, 7, 10], mode: 'mixolydian', root: 7, density: 0.8 },
    { name: 'Follow off: the line as written', seed: 7, song: 'I-vi-IV-V', bpm: 120, rate: 1, steps: 16, swing: 30, swing8: true, follow: false, bars: 6, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
  ];
  det.push({ name: 'a line of slides across a rest in the chart', seed: 8, song: 'a short rest', bpm: 120, rate: 1, steps: 16, swing: 0, swing8: true, follow: true, bars: 6, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0, slides: true });
  const stat = [
    { name: 'probability 30 and 75', kind: 'prob' },
    { name: 'humanize 1.0', kind: 'human', amt: 1 },
    { name: 'humanize off for the bass', kind: 'humanoff' },
  ];

  const result = await page.evaluate(async ({ det, stat, SONGS, grids }) => {
    const sr = 48000, out = { det: [], stat: [], refused: [] };
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx;
    const sent = [];
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = m => { if (m.kind === 'note' && m.part === 'bass') sent.push(Object.assign({}, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    const LA = LOOK_AHEAD, FIRSTs = 1.0;

    function setup(c) {
      document.getElementById('bpm').value = c.bpm; c.bpm = parseFloat(document.getElementById('bpm').value);
      blRateMul = c.rate;
      window._sqSetSwing(c.swing); window._sqSetSwing8(c.swing8);
      root = c.root; mode = c.mode;
      window._blRestoreState({ steps: c.steps, grid: c.grid, follow: c.follow, genStyle: 'funk', gridRootPc: c.gridRoot, gridIntvs: c.gridIntvs });
      const h = c.human || {};
      window.setHumanize(h.amt || 0); window.setHumanizeMix('time', 1); window.setHumanizeMix('vel', 1); window.setHumanizeMix('drift', h.drift != null ? h.drift : 0);
      if ((window._humanState().off.indexOf('bass') >= 0) !== !!(h.off && h.off.indexOf('bass') >= 0)) window.toggleHumanPart('bass');
    }
    // The chord windows the song would have committed, as many as cover [FIRSTs, tEnd + 4 s], looping the progression.
    function chords(c, tEnd) {
      fake.currentTime = 0.0013;     // _blOnChord drops windows already behind the clock: the clock of the last case must not eat these
      window._blClearChords();
      const beat = 60 / c.bpm, song = SONGS[c.song];
      let t = FIRSTs, i = 0;
      const slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      while (t < tEnd + 4) {
        const s = song[i % song.length], dur = s[3] * beat;
        window._blOnChord(slot(i), t, dur, slot(i + 1), 0);
        t += dur; i++;
      }
    }
    function runPage(c, tEnd) {
      sent.length = 0;
      fake.currentTime = 0.0013;
      window._blSetClock(FIRSTs, 0, true);
      const stepSec = 60 / c.bpm / 4 * c.rate;
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        window._blScheduler(); _schedHorizon = null;
        if (window._blClock().t >= tEnd) break;
      }
      window._blSetClock(0, 0, false);
      return sent.filter(m => m.at < tEnd).map(m => ({ at: m.at, note: m.note, dur: m.dur, vel: m.vel, accent: m.accent, slide: m.slide, from: m.from }));
    }

    for (const c of det) {
      Object.assign(c, grids[c.name]);
      setup(c);
      const tEnd = FIRSTs + c.bars * c.steps * (60 / c.bpm / 4 * c.rate);
      chords(c, tEnd);
      const r = runPage(c, tEnd);
      const sc = window._blNativeScore();
      out.det.push({ name: c.name, notes: r, tEnd, score: sc.score, ok: sc.ok, why: sc.why, chords: window._blNativeChords(sr), bpm: c.bpm, rate: c.rate });
    }
    for (const c of stat) {
      const base = { bpm: 120, rate: 1, steps: 16, swing: 0, swing8: true, follow: true, song: 'I-vi-IV-V', gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0, human: null };
      Object.assign(base, grids[c.name]);
      if (c.kind === 'human') base.human = { amt: c.amt };
      if (c.kind === 'humanoff') base.human = { amt: 1, off: ['bass'] };
      setup(base);
      const tEnd = FIRSTs + 2400 * 0.125;
      chords(base, tEnd);
      const r = runPage(base, tEnd);
      const sc = window._blNativeScore();
      out.stat.push({ name: c.name, kind: c.kind, notes: r, tEnd, score: sc.score, chords: window._blNativeChords(sr), human: base.human });
    }
    // What the engine's score refuses, and says why.
    {
      const c = Object.assign({}, det[0], grids[det[0].name]); setup(c); chords(c, 20);
      window._blRestoreState({ genStyle: 'jazz', follow: true });
      out.refused.push(window._blNativeScore().why.join(','));
      window._blRestoreState({ genStyle: 'funk', follow: true });
      out.refused.push(String(window._blNativeScore().ok));
    }
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { det, stat, SONGS, grids: (() => {
    const g = {};
    det.forEach(c => { g[c.name] = { grid: c.slides ? Array.from({ length: c.steps }, (_, i) => ({ note: (i * 5) % 12, oct: 2, len: 1, slide: true, accent: false, v: 1, usr: 0 })) : busyGrid(c.seed, c.steps, { density: c.density, gridRoot: c.gridRoot, gridIntvs: c.gridIntvs }) }; });
    stat.forEach(c => {
      const cells = Array.from({ length: 16 }, (_, s) => ({ note: 0, oct: 2, len: 1, slide: false, accent: s % 4 === 3, v: 0, usr: 0 }));
      cells[0].v = 1; cells[4].v = 1; cells[8].v = 1; cells[12].v = 1;
      if (c.kind === 'prob') { cells[0].pr = 30; cells[4].pr = 75; cells[8].pr = 30; cells[12].pr = 75; }
      g[c.name] = { grid: cells };
    });
    return g;
  })() });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  // The native side: the same score and the same windows, the same number of steps.
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bass-'));
  const all = [...result.det.map(c => Object.assign({ kind: 'det' }, c)), ...result.stat.map(c => Object.assign({}, c))];
  const cases = [all.length];
  all.forEach((c, i) => {
    const stepFrames = (60 / (c.bpm || 120) / 4 * (c.rate || 1)) * SR;
    const nSteps = Math.ceil((c.tEnd * SR - 1 * SR) / stepFrames - 1e-9);
    cases.push(SR, c.bpm || 120, c.rate || 1, 1.0 * SR, 11 + i, nSteps);
    c.score.forEach(x => cases.push(x)); c.chords.forEach(x => cases.push(x));
  });
  fs.writeFileSync(path.join(tmp, 'bass.f64'), Buffer.from(Float64Array.from(cases).buffer));
  const bin = path.join(root, 'native', 'modsynth', 'basstool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth basstool'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'bass.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const native = []; let cur = null;
  run.stdout.split('\n').forEach(l => {
    const f = l.split(' ');
    if (f[0] === 'CASE') { cur = []; native.push(cur); }
    else if (f[0] === 'N') cur.push({ fx: +f[1], frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, slide: +f[7] === 1, from: +f[8], step: +f[9] });
  });
  ok(native.length === all.length, 'basstool answered every case', native.length + ' of ' + all.length);

  console.log('\nevent lists, the engine against the page (frames to 1e-5, every field):');
  result.det.forEach((c, i) => {
    const nat = native[i].filter(e => e.fx < c.tEnd * SR - 1e-6), pg = c.notes;
    let same = nat.length === pg.length, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) { same = false; why = `note ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (p.note !== n.midi) { same = false; why = `note ${k}: midi ${p.note} on the page, ${n.midi} native (frame ${n.frame})`; }
      else if (Math.abs(p.dur * SR - n.dur) > 1e-5) { same = false; why = `note ${k}: length ${p.dur * SR} frames on the page, ${n.dur} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `note ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if (!!p.accent !== n.accent || !!p.slide !== n.slide) { same = false; why = `note ${k}: accent/slide differ`; }
      else if ((p.from == null ? -1 : p.from) !== n.from) { same = false; why = `note ${k}: glides from ${p.from} on the page, ${n.from} native`; }
    }
    ok(same && pg.length > 10 && c.ok, c.name + ': ' + pg.length + ' notes identical (worst timing ' + worstT.toExponential(1) + ' frames)', why);
  });
  ok(/walking/.test(result.refused[0]) && result.refused[1] === 'true', 'the score refuses a walking line and says so (' + result.refused[0] + ') and accepts the same line in another style', result.refused.join(' | '));

  // Statistics.
  console.log('\nwhat the page draws from Math.random, on statistics:');
  const base = result.det.length;
  const prob = result.stat.findIndex(c => c.kind === 'prob');
  {
    const c = result.stat[prob], pg = c.notes, nat = native[base + prob].filter(e => e.fx < c.tEnd * SR);
    const per = (list, stepOf) => [0, 4, 8, 12].map(st => list.filter(e => stepOf(e) === st).length);
    const stepFrames = 60 / 120 / 4 * SR, bars = Math.round((c.tEnd - 1) / (16 * stepFrames / SR));
    const pgSteps = per(pg, e => Math.round(((e.at - 1) * SR / stepFrames)) % 16), natSteps = per(nat, e => e.step);
    const exp = [0.3, 0.75, 0.3, 0.75].map(p => p * bars);
    const sig = exp.map((e, k) => Math.sqrt(bars * [0.3, 0.75, 0.3, 0.75][k] * (1 - [0.3, 0.75, 0.3, 0.75][k])));
    ok(pgSteps.every((n, k) => Math.abs(n - exp[k]) < 4 * sig[k]) && natSteps.every((n, k) => Math.abs(n - exp[k]) < 4 * sig[k]), 'probability 30 and 75: expected ' + exp.map(x => x.toFixed(0)).join('/') + ' of ' + bars + ', page ' + pgSteps.join('/') + ', native ' + natSteps.join('/'), '');
  }
  const hi = result.stat.findIndex(c => c.kind === 'human');
  {
    const c = result.stat[hi], pg = c.notes, nat = native[base + hi].filter(e => e.fx < c.tEnd * SR);
    const stepFrames = 60 / 120 / 4 * SR;
    const dev = (list, f) => list.map(e => f(e));
    const pgDev = dev(pg, e => (e.at - 1) * SR - Math.round((e.at - 1) * SR / stepFrames) * stepFrames), natDev = dev(nat, e => e.fx - 1 * SR - Math.round((e.fx - SR) / stepFrames) * stepFrames);
    const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };
    const span = 0.014 * SR;
    ok(Math.max(...natDev.map(Math.abs)) <= span * 1.0001 && Math.max(...pgDev.map(Math.abs)) <= span * 1.0001, 'humanize 1.0: timing inside +/-' + span.toFixed(0) + ' frames on both', '');
    ok(Math.abs(sd(natDev) - sd(pgDev)) < 0.08 * sd(pgDev), 'humanize 1.0: timing spread matches the page (sd ' + sd(natDev).toFixed(1) + ' vs ' + sd(pgDev).toFixed(1) + ' frames)', '');
    const vmin = a => Math.min(...a.map(e => e.vel)), vmean = a => a.reduce((x, e) => x + e.vel, 0) / a.length;
    ok(Math.abs(vmean(nat) - vmean(pg)) < 0.01 && Math.abs(vmin(nat) - vmin(pg)) < 0.02, 'humanize 1.0: level spread matches the page (mean ' + vmean(nat).toFixed(3) + ' vs ' + vmean(pg).toFixed(3) + ')', '');
  }
  const ho = result.stat.findIndex(c => c.kind === 'humanoff');
  {
    const c = result.stat[ho], pg = c.notes, nat = native[base + ho].filter(e => e.fx < c.tEnd * SR);
    const stepFrames = 60 / 120 / 4 * SR;
    const exact = a => a.every(x => Math.abs(x) < 1e-6);
    ok(exact(pg.map(e => (e.at - 1) * SR - Math.round((e.at - 1) * SR / stepFrames) * stepFrames)) && exact(nat.map(e => e.fx - SR - Math.round((e.fx - SR) / stepFrames) * stepFrames)), 'humanize off for the bass: its notes stay exactly on the grid on both', '');
  }
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
