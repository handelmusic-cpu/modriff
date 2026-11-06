/* A whole drum score through the engine's own sequencer against the page's voices (docs/native-scheduling.md, slice 1).

   A pattern that uses what the page's scheduler does (swing, accents, velocities, tuned cells, ratchets, an ornament, an open hat
   shut by a closed one, the Aux Perc layer) is set up in the real page. The production prober records the lanes it plays into
   the bank (window._nsBank). native/modsynth/seqtool then lists the events the engine's sequencer makes for it, and the page
   records each of those hits fresh, in order, with its own choke registry live, so a closing hat shuts the open hats exactly as it
   does in the app, at the engine's own frames. native/modsynth/scoretest plays both: the engine side with the host thread's loop
   and code (DrumSequencer, DrumPlayer: bank patch, GraphPool begin, the choke cut) a block at a time, the page side as the page's
   own voices and the page's own edits, and nulls the sum of the pool's buses.

   Not in it: the host's strips and master chain (downstream of the pool, the same for both), the randomness of probability and
   humanize (the engine draws its own; it is held on statistics in drumgrid.test.js), a lane the bank refuses.

   Run: make -C native/modsynth scoretest seqtool && node tests/seq/score.test.js      Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
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

// The pattern: 16 steps. Lane 4 is the closed hat and lane 5 the open hat of the 808; the rest are a scatter that uses velocity,
// accent, tuning, a ratchet and an ornament. Aux Perc (lane 6, the Triangle, is refused by the prober, so it is left empty).
function pattern(seed) {
  const rnd = prng(seed), cell = () => ({ v: 0, r: 1, orn: 0, vel: 100 });
  const scatter = (density, o) => Array.from({ length: 16 }, () => { const c = cell(); if (rnd() < density) { c.v = rnd() < 0.2 ? 2 : 1; if (rnd() < 0.4) c.vel = 25 + Math.floor(rnd() * 75); if (o.tuned && rnd() < 0.4) c.p = Math.floor(rnd() * 11) - 5; if (rnd() < 0.1) { c.r = 2 + Math.floor(rnd() * 2); } } return c; });
  const grid = {};
  for (let t = 0; t < 8; t++) grid[t] = scatter(t === 0 ? 0.3 : 0.12, { tuned: t >= 2 });
  const set = (lane, steps, o) => steps.forEach(s => { grid[lane][s] = Object.assign({ v: 1, r: 1, orn: 0, vel: 100 }, o && o[s] || {}); });
  grid[4] = Array.from({ length: 16 }, cell); grid[5] = Array.from({ length: 16 }, cell);
  set(4, [1, 3, 6, 9, 11, 14], { 14: { r: 2 }, 6: { vel: 60 } });      // closed hat
  set(5, [2, 5, 10], { 10: { v: 2 } });                                  // open hat, shut by the closed hat at 3, 6 and 11
  grid[1][4] = { v: 2, r: 1, orn: 1, vel: 100 };
  const aux = {}; for (let t = 0; t < 8; t++) aux[t] = t === 6 ? Array.from({ length: 16 }, cell) : scatter(0.1, { tuned: true });
  return { grid, aux };
}

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const bin = name => { const b = path.join(root, 'native', 'modsynth', name); if (!fs.existsSync(b)) { console.error('build it first: make -C native/modsynth scoretest seqtool'); process.exit(2); } return b; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
  const SR = 48000, FIRST = 20000;

  // 1. The page, once: an offline context, the graph path on, a stand-in plugin that collects what the bank sends.
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
    Object.assign(window._webParams, { 'chord.reverb': 0.4, 'mel.reverb': 0.5 });
    window.setHumanize(0);
    window._test = { entries, BUFS };
  });

  const configs = [
    { name: 'swing 25 at 120 BPM', seed: 31337, bpm: 120, swing: 25 },
    { name: 'no swing at 100 BPM', seed: 7, bpm: 100, swing: 0 },
    { name: 'swing 50 at 140 BPM', seed: 99, bpm: 140, swing: 50 },
  ];
  for (const cfg of configs) {
  console.log('\n── ' + cfg.name + ' ──');
  // The pattern, the bank, the score.
  const setup = await page.evaluate(async (arg) => {
    const pat = arg.pat;
    document.getElementById('bpm').value = arg.bpm; sqRateMul = 1;
    window._sqRestoreState({ steps: 16, swing: arg.swing, swing8: false, mach: '808', grid: pat.grid, kitOn: true, aux: { mach: 'PERC', grid: pat.aux, on: true } });
    window._sqEnsureGrid();
    drumsEnabled = true;
    const rep = await window._nsBank.ensure();
    const { entries, BUFS } = window._test;
    const ns = window._sqNativeScore();
    return { score: Array.from(ns.score), kits: ns.kits, bpm: parseFloat(document.getElementById('bpm').value), rate: 1, failed: rep.failed.map(f => f.kit + ' ' + f.lane), built: rep.built, kept: rep.kept,
             entries: entries.map(e => Array.from(e)), bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
  }, { pat: pattern(cfg.seed), bpm: cfg.bpm, swing: cfg.swing });
  ok(setup.failed.length === 0 && setup.built + setup.kept > 10, 'the prober banks every lane the pattern plays (' + setup.built + ' recorded, ' + setup.kept + ' kept, none refused)', setup.failed.join(', '));

  // 2. The engine's event list for it.
  const cases = [1, SR, setup.bpm, setup.rate, FIRST, 7, 16, 0].concat(setup.score);
  fs.writeFileSync(path.join(tmp, 'seq.f64'), Buffer.from(Float64Array.from(cases).buffer));
  const st = spawnSync(bin('seqtool'), [path.join(tmp, 'seq.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (st.status !== 0) { console.error(st.stderr); process.exit(2); }
  const events = st.stdout.split('\n').filter(l => l.startsWith('E ')).map(l => { const f = l.split(' '); return { frame: +f[2], part: +f[3], kit: +f[4], lane: +f[5], vel: +f[6], accent: +f[7] !== 0, pitch: +f[8], dyn: +f[9], chokeGroup: +f[10], chokes: +f[11] !== 0, step: +f[12], bar: +f[13] }; }).filter(e => e.bar === 0);
  if (process.env.SCORE_DEBUG) events.filter(e => e.vel > 0).forEach((e, i) => console.log('  event', i, JSON.stringify(e)));
  console.log('the engine fires ' + events.length + ' events for the bar (' + events.filter(e => e.chokes).length + ' of them shut the hat group)');
  ok(events.length > 25 && events.length < 90, 'a bar with a few dozen hits (the page side keeps them all in one pool: under 96)', events.length);

  // 3. The page records each of those hits fresh, in order, with its choke registry live.
  const fresh = await page.evaluate(async (evs) => {
    const sr = 48000, voices = [];
    window._chokeReset(); window._nsBank.keepRecs = true; window._nsBank.recs = [];
    let miss = 0;
    for (const e of evs) {
      if (!(e.vel > 0)) continue;
      const t = (e.frame - 1e-6) / sr;                   // a millionth of a frame early, as every time in a bank voice is
      if (e.chokes) {
        window._chokeRun(t);
        window._nsBank.recs.forEach((rec, i) => { const inc = rec.takeIncrements(); for (const x of inc) voices[i].edits.push(x); });
      }
      const part = e.part ? 'auxperc' : 'drum';
      const r = await window._nsBank.record({ kind: 'hit', part, id: 1, kit: window._nsKitCodes[e.kit], lane: e.lane, vel: e.vel, accent: e.accent, pitch: e.pitch, dyn: e.dyn, at: t });
      if (!r) { miss++; window._nsBank.recs.push({ takeIncrements: () => [] }); voices.push({ e, prog: null, edits: [] }); continue; }
      voices.push({ e, prog: Array.from(r.prog), edits: [] });
    }
    window._nsBank.keepRecs = false;
    return { voices, miss };
  }, events);
  ok(fresh.miss === 0, 'the page made a voice for every hit', fresh.miss + ' made none');
  const edited = fresh.voices.filter(v => v.edits.length);
  console.log('the page\'s own chokes edited ' + edited.length + ' of its ' + fresh.voices.length + ' voices');
  ok(edited.length >= 1, 'the closing hats shut open hats on the page', edited.length);

  // 4. Both sides through the pool, nulled.
  const buf = [];
  buf.push(setup.bufs.length); setup.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
  buf.push(setup.entries.length); setup.entries.forEach(e => { buf.push(e.length); e.forEach(x => buf.push(x)); });
  buf.push(setup.bpm, setup.rate, FIRST, 7, 1.5 * SR);
  setup.score.forEach(x => buf.push(x));
  const vs = fresh.voices.filter(v => v.prog);
  buf.push(vs.length);
  vs.forEach(v => { buf.push(v.e.part, v.e.kit, v.e.lane, v.e.frame, v.prog.length); v.prog.forEach(x => buf.push(x)); buf.push(v.edits.length); v.edits.forEach(x => buf.push(x)); });
  fs.writeFileSync(path.join(tmp, 'score.f64'), Buffer.from(Float64Array.from(buf).buffer));
  if (process.env.SCORE_DUMP) fs.copyFileSync(path.join(tmp, 'score.f64'), path.join(process.env.SCORE_DUMP, 'score-' + cfg.seed + '.f64'));
  const run = spawnSync(bin('scoretest'), [path.join(tmp, 'score.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  if (process.env.SCORE_DEBUG) console.log(run.stdout);
  const line = run.stdout.split('\n').find(l => l.startsWith('SCORE ')).split(' ').slice(1).map(Number);
  const [depth, peak, nEv, nHits, nMiss, nRef, nCuts, nCutEdits, nLate, pageStolen, peakVoices] = line;
  const worst = run.stdout.split('\n').find(l => l.startsWith('WORST ')).split(' ').slice(1).map(Number);
  console.log('\nthe bar, engine against page: null depth ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ', peak ' + peak.toFixed(4) + ', worst 100 ms window ' + (worst[1] >= 999 ? 'bit-identical' : worst[1].toFixed(1) + ' dB') + ' at frame ' + worst[0]);
  console.log('engine: ' + nHits + ' hits begun of ' + nEv + ' events, ' + nMiss + ' missed the bank, ' + nRef + ' refused, ' + nCuts + ' cuts sending ' + nCutEdits + ' edits, ' + nLate + ' late starts, at most ' + peakVoices + ' voices at once');
  ok(nMiss === 0 && nRef === 0 && nHits === nEv, 'every event became a voice', JSON.stringify({ nMiss, nRef, nHits, nEv }));
  ok(nLate === 0, 'none began later than its lead allowed', nLate);
  ok(pageStolen === 0, 'the page side stole no voice (it would not be the reference)', pageStolen);
  ok(nCuts >= 1 && nCutEdits >= nCuts, 'the engine shut open hats too (' + nCuts + ' cuts)', nCuts);
  ok(depth >= PASS_DB && peak > 0.01, 'the whole bar is exact: ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ' (>= ' + PASS_DB + ' dB passes)', depth.toFixed(1) + ' dB');
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
