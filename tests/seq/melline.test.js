/* The melody generator's sound end to end (native/modsynth/melcore.h, melplay.h, docs/native-scheduling.md slice 3 part three): the page's real _mlScheduler runs on a clock of its own with the
   chord windows a song would have committed, and every note it sends for the part "melgen" is kept; each is recorded as the program the page's voice code makes for it (the slides with their
   source and time). native/modsynth/melseqtest runs the engine's scheduler on the same line and chart (the page's own random draws as the tape), begins each event it makes from the voice bank (the
   page's prober, window._nsBank.ensureMel) in a pool, and the two pools' buses are summed and nulled.

   The bank test (melbank.test.js) holds one note to the page's, the scheduler test (melgrid.test.js) holds the list of notes; this holds them together: Follow over a progression, chords on a step,
   the portamento (which needs the note before), short notes in their own regime, a locked phrase.

   Run: make -C native/modsynth melseqtest && node tests/seq/melline.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90), VOICES, MELSEQ (another build of the tool) */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');
const VOICES = (process.env.VOICES || 'sine,rhodes,pad').split(',');
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
  { name: 'Follow over I-vi-IV-V, accents and levels, notes across the roll', song: 'I-vi-IV-V', bpm: 120, bars: 3, grid: { seed: 2 } },
  { name: 'a dense line: the portamento slides almost every note in', song: 'I-vi-IV-V', bpm: 120, bars: 3, grid: { seed: 11, density: 0.9 }, glideTime: 0.2 },
  { name: 'chords on a step (each note turned down by the root of how many), with Follow off', song: 'I-vi-IV-V', bpm: 120, bars: 3, follow: false, grid: { seed: 8, chords: 0.5, maxMore: 4 } },
  { name: 'short notes: the melody at four times the speed (notes of 29 ms), glide on', song: 'I-vi-IV-V', bpm: 120, rate: 0.25, bars: 6, grid: { seed: 14, density: 0.8 } },
  { name: 'twice the speed (58 ms notes) with long notes among them, swung', song: 'slash chords and a rest', bpm: 120, rate: 0.5, bars: 5, swing: 50, grid: { seed: 17, density: 0.7 } },
  { name: 'locked phrases with chords in them, moved by the capo', song: 'I-vi-IV-V', bpm: 120, bars: 4, grid: { seed: 22 }, locks: { 0: { steps: 16, delta: 2, seed: 33, chords: 0.4 }, 2: { steps: 16, delta: 5, seed: 34, chords: 0.4 } } },
  { name: 'step probability on some steps (the page\'s draws as the tape)', song: 'I-vi-IV-V', bpm: 120, bars: 4, grid: { seed: 18, pr: 1 } },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melline-'));
  const bin = process.env.MELSEQ || path.join(root, 'native', 'modsynth', 'melseqtest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth melseqtest'); process.exit(2); }
  const grids = {}, lockGrids = {};
  CONFIGS.forEach(c => {
    grids[c.name] = melGrid(c.grid.seed, c.steps || 16, c.grid);
    lockGrids[c.name] = {}; Object.keys(c.locks || {}).forEach(k => { const l = c.locks[k]; lockGrids[c.name][k] = melGrid(l.seed, l.steps, { chords: l.chords }); });
  });
  await page.evaluate(() => {
    const sr = 48000;
    const offline = new OfflineAudioContext(2, sr * 8, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    const BUFS = new Map(), entries = [];
    const stub = {
      graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {},
      seqScore: () => Promise.resolve({ ok: true }), seqBank: o => { if (o.clear) entries.length = 0; if (o.entry) entries.push(dec(o.entry)); return Promise.resolve({ ok: true }); },
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    window._test = { BUFS, entries };
  });

  for (const voice of VOICES) {
    const bank = await page.evaluate(async voice => {
      setMlWave(voice);
      window._test.entries.length = 0; window._nsBank.have = {}; window._nsBank.bad = {};
      const rep = await window._nsBank.ensureMel();
      return { rep, entries: window._test.entries.map(e => Array.from(e)), kit: window._nsKitCode('mel:' + voice), bufs: Array.from(window._test.BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
    }, voice);
    ok(bank.rep.built === 1, voice + ': the voice is banked (' + bank.entries.length + ' entries)', JSON.stringify(bank.rep));
    if (!bank.rep.built) continue;
    for (const c of CONFIGS) {
      const run = await page.evaluate(async ({ c, SONGS, grid, lockGrid }) => {
        const sr = 48000, fake = { currentTime: 0, sampleRate: sr, state: 'running' };
        const off = new OfflineAudioContext(2, sr, sr);
        const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
        clearTimeout(clockTimer);
        const realCtx = getCtx, realAudio = audioCtx;
        const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready }, sent = [];
        E.send = m => { if (m && m.part === 'melgen' && m.kind === 'note') sent.push(Object.assign({}, m)); }; E.now = () => fake.currentTime; E.ready = () => true;
        window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
        const LA = LOOK_AHEAD, FIRSTs = 1.0;
        document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
        mlRateMul = c.rate || 1; window.setHumanize(0);
        window._sqSetSwing(c.swing || 0); window._sqSetSwing8(true);
        root = 0; mode = 'major';
        melMono = true; melAuto = true; melGlideOn = true; melGlideTime = c.glideTime || 0.12;
        window._mlRestoreState({ steps: 16, grid, follow: c.follow !== false, gridRootPc: 0, gridIntvs: [0, 4, 7] });
        const sd = 60 / bpm / 4 * (c.rate || 1), beat = 60 / bpm, tEnd = FIRSTs + c.bars * 16 * sd;
        const song = SONGS[c.song], slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
        PHRASE_LOCKS.mel = {};
        if (c.locks) Object.keys(c.locks).forEach(k => {
          const sl = slot(+k), lk = c.locks[k];
          PHRASE_LOCKS.mel[window.phraseKey(sl)] = { grid: lockGrid[k], steps: lk.steps, rootPc: (((sl.rootM - lk.delta) % 12) + 12) % 12 };
        });
        fake.currentTime = 0.0013;
        window._blClearChords();
        { let t = FIRSTs, i = 0; while (t < tEnd + 6) { const dur = song[i % song.length][3] * beat; window._blOnChord(slot(i), t, dur, slot(i + 1), 0); t += dur; i++; } }
        window._mlSetClock(FIRSTs, 0, true);
        const tape = [], orig = Math.random; let lastH = 0;
        for (let guard = 0; guard < 100000; guard++) {
          fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA; lastH = _schedHorizon;
          Math.random = () => { const v = orig.call(Math); tape.push(v); return v; };
          try { window._mlScheduler(); } finally { Math.random = orig; }
          _schedHorizon = null;
          if (fake.currentTime + LA >= tEnd) break;
        }
        window._mlSetClock(0, 0, false);
        const sc = window._mlNativeScore(), chords = window._mlNativeChords(sr);
        PHRASE_LOCKS.mel = {};
        window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
        window._sqSetSwing(0); melGlideTime = 0.12; mlRateMul = 1;
        // the page's program for each note it sent
        const progs = [];
        for (const m of sent) {
          const r = await window._nsBank.record(Object.assign({}, m, { at: m.at - 1e-6 / sr }));
          progs.push(r ? Array.from(r.prog) : null);
        }
        return { bpm, rate: c.rate || 1, end: lastH * sr, tape, score: sc.score, chords, progs, n: sent.length, durs: sent.map(m => m.dur), slides: sent.filter(m => m.glideFrom != null).length, poly: sent.filter((m, i) => i && sent[i - 1].at === m.at).length };
      }, { c, SONGS, grid: grids[c.name], lockGrid: lockGrids[c.name] });
      const progs = run.progs.filter(Boolean);
      const buf = [];
      buf.push(bank.bufs.length); bank.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(ch => ch.forEach(x => buf.push(x))); });
      buf.push(bank.entries.length); bank.entries.forEach(e => { buf.push(e.length); e.forEach(x => buf.push(x)); });
      buf.push(bank.kit, SR, run.bpm, run.rate, 1.0 * SR, run.end, run.tape.length);
      run.tape.forEach(x => buf.push(x));
      run.score.forEach(x => buf.push(x));
      run.chords.forEach(x => buf.push(x));
      buf.push(progs.length); progs.forEach(p => { buf.push(p.length); p.forEach(x => buf.push(x)); });
      fs.writeFileSync(path.join(tmp, 'melline.f64'), Buffer.from(Float64Array.from(buf).buffer));
      const r = spawnSync(bin, [path.join(tmp, 'melline.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
      if (process.env.SCORE_DEBUG) console.log(r.stdout);
      const mel = r.stdout.split('\n').find(l => l.startsWith('MEL ')).split(' ').slice(1).map(Number);
      const worst = r.stdout.split('\n').find(l => l.startsWith('WORST ')).split(' ').slice(1).map(Number);
      const [depth, peak, events, voices, misses, refused, late, slides] = mel;
      const shortest = Math.min(...run.durs);
      ok(progs.length === run.n && events === run.n && misses === 0 && refused === 0 && peak > 0.005 && depth >= PASS_DB,
         voice + ' / ' + c.name + ': ' + run.n + ' notes (' + run.slides + ' slides, ' + run.poly + ' chord notes, shortest ' + (shortest * 1000).toFixed(0) + ' ms): ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ', worst 100 ms ' + (worst[1] >= 999 ? 'bit-identical' : worst[1].toFixed(1) + ' dB'),
         JSON.stringify({ n: run.n, progs: progs.length, events, misses, refused, depth, peak, late, slides }));
    }
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
