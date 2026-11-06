/* A whole bass line through the engine's own sequencer and player against the page's voices (docs/native-scheduling.md, slice 2).

   A line that uses what the page's bass scheduler does (Follow over a chart with slash chords and a rest, swing, accents, levels, long
   notes that overlap the next, slides) is set up in the real page. The production prober records the bass voice into the bank
   (window._nsBank.buildBass). native/modsynth/basstool then lists the notes the engine's sequencer makes for it, and the page records
   each of those notes fresh, in order, so its own voice code cuts each note short when the next starts inside its tail (the bass is
   monophonic). native/modsynth/bassscoretest plays both: the engine side with the host thread's loop and code (BassSequencer,
   BassPlayer: bank patch for the note, level, accent, length and glide, GraphPool begin, the cut of the note before), the page side as
   the page's own voices and the page's own edits, and nulls the sum of the pool's buses.

   Not in it: the host's strips and master chain (downstream of the pool, the same for both), the randomness of probability and humanize
   (the engine draws its own; held on statistics in bassgrid.test.js), the walking line, locked phrases, the sampled voices.

   Run: make -C native/modsynth bassscoretest basstool && node tests/seq/bassline.test.js      Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');
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
function busyGrid(seed, steps, o) {
  const rnd = prng(seed), g = [];
  for (let s = 0; s < steps; s++) {
    const c = { note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 };
    if (rnd() < o.density) {
      c.v = 1; c.note = Math.floor(rnd() * 12); c.oct = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.5) c.note = (o.gridRoot + o.gridIntvs[Math.floor(rnd() * o.gridIntvs.length)]) % 12;
      if (rnd() < 0.3) c.len = 2 + Math.floor(rnd() * 3);
      if (rnd() < 0.3) c.slide = true;
      if (rnd() < 0.25) c.accent = true;
      if (rnd() < 0.3) c.vel = 20 + Math.floor(rnd() * 79);
    }
    g.push(c);
  }
  return g;
}
const SONGS = {
  'I-vi-IV-V': [[0, [0, 4, 7], null, 4], [9, [0, 3, 7], null, 4], [5, [0, 4, 7], null, 4], [7, [0, 4, 7, 10], null, 4]],
  'slash and a short rest': [[0, [0, 4, 7], 4, 4], [7, [0, 4, 7], 11, 2], [0, [0, 4, 7], null, 1, true], [2, [0, 3, 7, 10], null, 4], [5, [0, 4, 7, 11], null, 3]],
};
const CONFIGS = [
  { name: 'Electric, I-vi-IV-V, swing 25', voice: 'electric', seed: 11, song: 'I-vi-IV-V', bpm: 120, swing: 25, swing8: true, steps: 16, bars: 4, density: 0.5, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
  { name: 'Acid, slash chords and a rest, slides', voice: 'sawtooth', seed: 12, song: 'slash and a short rest', bpm: 100, swing: 0, swing8: true, steps: 16, bars: 4, density: 0.55, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0 },
  { name: 'Sub, 12 steps, swing on the sixteenths', voice: 'sine', seed: 13, song: 'I-vi-IV-V', bpm: 130, swing: 50, swing8: false, steps: 12, bars: 5, density: 0.5, gridRoot: 9, gridIntvs: [0, 3, 7], mode: 'minor', root: 9 },
  { name: 'Upright, Follow off, long notes', voice: 'upright', seed: 14, song: 'I-vi-IV-V', bpm: 90, swing: 0, swing8: true, steps: 16, bars: 4, density: 0.5, gridRoot: 0, gridIntvs: [0, 4, 7], mode: 'major', root: 0, follow: false },
  { name: 'Triangle at rate 2', voice: 'triangle', seed: 15, song: 'slash and a short rest', bpm: 110, rate: 2, swing: 30, swing8: true, steps: 16, bars: 5, density: 0.45, gridRoot: 7, gridIntvs: [0, 4, 7, 10], mode: 'mixolydian', root: 7 },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const bin = name => { const b = path.join(root, 'native', 'modsynth', name); if (!fs.existsSync(b)) { console.error('build it first: make -C native/modsynth bassscoretest basstool'); process.exit(2); } return b; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bassline-'));
  const SR = 48000, FIRST = 1.0;

  await page.evaluate(async () => {
    const sr = 48000;
    const offline = new OfflineAudioContext(2, sr * 8, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    const entries = [], BUFS = new Map();
    const stub = {
      graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {},
      seqScore: () => Promise.resolve({ ok: true }),
      seqBank: o => { if (o.clear) entries.length = 0; if (o.entry) entries.push(dec(o.entry)); return Promise.resolve({ ok: true }); },
      seqStart: () => Promise.resolve({ ok: true }), seqStop: () => Promise.resolve(), seqTempo: () => Promise.resolve(), seqMirror: () => Promise.resolve({}),
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    window.setHumanize(0);
    window._test = { entries, BUFS };
  });

  for (const cfg of CONFIGS) {
    console.log('\n── ' + cfg.name + ' ──');
    const setup = await page.evaluate(async ({ cfg, SONGS, grid }) => {
      const sr = 48000;
      window.setBlWave(cfg.voice);
      document.getElementById('bpm').value = cfg.bpm; blRateMul = cfg.rate || 1;
      window._sqSetSwing(cfg.swing); window._sqSetSwing8(cfg.swing8);
      root = cfg.root; mode = cfg.mode;
      window._blRestoreState({ steps: cfg.steps, grid, follow: cfg.follow !== false, genStyle: 'funk', gridRootPc: cfg.gridRoot, gridIntvs: cfg.gridIntvs });
      // The chart: windows as the song commits them, from FIRST on, enough to cover the line.
      const bpm = parseFloat(document.getElementById('bpm').value), beat = 60 / bpm, song = SONGS[cfg.song];
      const tEnd = 1 + cfg.bars * cfg.steps * (60 / bpm / 4 * (cfg.rate || 1));
      window._blClearChords();
      const slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      let t = 1, i = 0;
      while (t < tEnd + 4) { const dur = song[i % song.length][3] * beat; window._blOnChord(slot(i), t, dur, slot(i + 1), 0); t += dur; i++; }
      window._nsBank.have = {}; window._nsBank.bad = {};
      const rep = await window._nsBank.ensureBass();
      const { entries, BUFS } = window._test;
      const sc = window._blNativeScore();
      return { score: sc.score, ok: sc.ok, chords: window._blNativeChords(sr), bpm, rate: cfg.rate || 1, kit: window._nsKitCode('bass:' + cfg.voice), rep,
               entries: entries.map(e => Array.from(e)), bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
    }, { cfg, SONGS, grid: busyGrid(cfg.seed, cfg.steps, cfg) });
    ok(setup.ok && setup.rep.failed.length === 0, 'the line is one the engine can play, and the voice is banked (' + cfg.voice + ')', JSON.stringify(setup.rep.failed));

    // The engine's notes for it.
    const stepFrames = 60 / setup.bpm / 4 * setup.rate * SR, nSteps = cfg.bars * cfg.steps;
    fs.writeFileSync(path.join(tmp, 'bass.f64'), Buffer.from(Float64Array.from([1, SR, setup.bpm, setup.rate, FIRST * SR, 7, nSteps].concat(setup.score, setup.chords)).buffer));
    const bt = spawnSync(bin('basstool'), [path.join(tmp, 'bass.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (bt.status !== 0) { console.error(bt.stderr); process.exit(2); }
    const notes = bt.stdout.split('\n').filter(l => l.startsWith('N ')).map(l => { const f = l.split(' '); return { frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, slide: +f[7] === 1, from: +f[8], step: +f[9] }; });
    // The engine side is run on for the whole window the page's list covers; keep to the steps the line has.
    console.log('the engine plays ' + notes.length + ' notes (' + notes.filter(n => n.slide).length + ' slide on, ' + notes.filter(n => n.from >= 0).length + ' glide from the last)');
    ok(notes.length > 12 && notes.length < 90, 'a line with a few dozen notes (the page side keeps them all in one pool)', notes.length);

    // The page records each fresh, in order, with its own cut of the note before.
    const fresh = await page.evaluate(async (ns) => {
      const sr = 48000, voices = [];
      window._chokeReset(); window._nsBank.keepRecs = true; window._nsBank.recs = [];
      let miss = 0;
      for (const n of ns) {
        const r = await window._nsBank.record({ kind: 'note', part: 'bass', id: 1, note: n.midi, vel: n.vel, accent: n.accent, slide: n.slide, from: n.from >= 0 ? n.from : null, at: (n.frame - 1e-6) / sr, dur: n.dur / sr, tune: 0 });
        if (!r) { miss++; voices.push({ frame: n.frame, prog: null }); continue; }
        voices.push({ frame: n.frame, prog: Array.from(r.prog) });
      }
      await Promise.resolve(); await Promise.resolve();
      // The page's cut of the note before is cancelScheduledValues, a set to the gain's current value and a ramp; the engine's is the
      // hold and the ramp (the set is the page reading a gain of 1 from a note that has not begun, and the cancel drops ramps the
      // engine's later edit would find already rendered: see the note in _nsBank.buildBass). The reference is the page's own edits
      // with exactly that change, record for record.
      window._nsBank.recs.forEach((rec, i) => {
        const inc = (rec.capturedInc || []).slice(), out = [];
        for (let k = 0; k < inc.length; k += 6) { if (inc[k + 2] === 0) continue; out.push(inc[k], inc[k + 1], inc[k + 2] === 4 ? 5 : inc[k + 2], inc[k + 3], inc[k + 4], inc[k + 5]); }
        voices[i].edits = out; voices[i].raw = inc.length / 6;
      });
      window._nsBank.keepRecs = false;
      return { voices, miss };
    }, notes);
    ok(fresh.miss === 0, 'the page made a voice for every note', fresh.miss + ' made none');
    const cut = fresh.voices.filter(v => v.edits && v.edits.length);
    console.log('the page cut ' + cut.length + ' of its ' + fresh.voices.length + ' notes short, the next having started inside their tails');
    ok(cut.length >= 1 || cfg.follow === false, 'notes overlap: the monophonic cut is exercised', cut.length);

    // Both through the pool, nulled.
    const buf = [];
    buf.push(setup.bufs.length); setup.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
    const seen = new Map(); setup.entries.forEach(h => seen.set(h[2] + ':' + h[3], h));
    buf.push(seen.size); for (const h of seen.values()) { buf.push(h.length); h.forEach(x => buf.push(x)); }
    buf.push(setup.kit, setup.bpm, setup.rate, FIRST * SR, 7, 1.5 * SR);
    setup.score.forEach(x => buf.push(x)); setup.chords.forEach(x => buf.push(x));
    buf.push(fresh.voices.length);
    fresh.voices.forEach(v => { buf.push(v.frame, v.prog.length); v.prog.forEach(x => buf.push(x)); buf.push(v.edits.length); v.edits.forEach(x => buf.push(x)); });
    fs.writeFileSync(path.join(tmp, 'line.f64'), Buffer.from(Float64Array.from(buf).buffer));
    const run = spawnSync(bin('bassscoretest'), [path.join(tmp, 'line.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
    if (process.env.SCORE_DEBUG) { console.log(run.stdout); fs.copyFileSync(path.join(tmp, 'line.f64'), path.join(process.env.SCORE_DEBUG, 'line-' + cfg.seed + '.f64')); console.log(notes.map((n, i) => i + ':' + n.frame + ' m' + n.midi + ' d' + (n.dur / SR).toFixed(2) + ' v' + n.vel.toFixed(2) + (n.accent ? 'A' : '') + (n.slide ? 'S' : '') + (n.from >= 0 ? 'G' + n.from : '')).join('\n')); }
    const line = run.stdout.split('\n').find(l => l.startsWith('SCORE ')).split(' ').slice(1).map(Number);
    const [depth, peak, nNotes, nHits, nMiss, nRef, nCuts, nLate, pageStolen] = line;
    const worst = run.stdout.split('\n').find(l => l.startsWith('WORST ')).split(' ').slice(1).map(Number);
    console.log('the line, engine against page: null depth ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ', peak ' + peak.toFixed(4) + ', worst 100 ms window ' + (worst[1] >= 999 ? 'bit-identical' : worst[1].toFixed(1) + ' dB') + ' at frame ' + worst[0]);
    console.log('engine: ' + nHits + ' notes begun of ' + nNotes + ', ' + nMiss + ' missed the bank, ' + nRef + ' refused, ' + nCuts + ' cuts of the note before, ' + nLate + ' late starts');
    ok(nMiss === 0 && nRef === 0 && nHits === nNotes, 'every note became a voice', JSON.stringify({ nMiss, nRef, nHits, nNotes }));
    ok(nLate === 0 && pageStolen === 0, 'none began late, and the page side stole no voice', JSON.stringify({ nLate, pageStolen }));
    ok(nCuts === cut.length, 'the engine cut the same ' + cut.length + ' notes the page did', nCuts + ' against ' + cut.length);
    ok(depth >= PASS_DB && peak > 0.01, 'the whole line is exact: ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ' (>= ' + PASS_DB + ' dB passes)', depth.toFixed(1) + ' dB');
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
