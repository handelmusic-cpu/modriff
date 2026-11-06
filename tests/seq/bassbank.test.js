/* The bass voice bank (native/modsynth/voicebank.h, docs/native-scheduling.md slice 2) against the page's own bass voices.

   In the real page, on an OfflineAudioContext with a stand-in plugin, the production prober window._nsBank.buildBass records each
   synthesized bass voice (Sub, Tri, Sqr, Acid, Acid 303, Electric, Upright) and its slide and glide variants, and the entries go to the
   engine's bank. Then, for notes of every register, levels, accents, LENGTHS from 30 ms to 6 s, glides from other notes and onsets
   at every phase of the 128-frame grid, the page records the same note fresh, as the app sends it today, and native/modsynth/banktest
   (in its `bass` mode) patches the bank's entry for it (the engine's C++), begins it as the host's sequencer does, plays both through a
   GraphPool and nulls them.

   Also held: a sampled voice is refused with its reason; the Drums-style signature (the voice, its level, the filter, the fader) changes
   when one of them does, and the voice is then recorded again.

   Run: make -C native/modsynth banktest && node tests/seq/bassbank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
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
const VOICES = ['sine', 'triangle', 'square', 'sawtooth', 'acid303', 'electric', 'upright'];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const rnd = prng(97531);
  // Controls first (one quantity at a time, so a failure names its cause), then random combinations.
  const base = (o, i) => Object.assign({ vel: 0.7, accent: false, note: 41, dur: 0.25, from: null }, o, { onset: 2304 + 128 * (300 + 40 * i) + (i % 5) * 29 });
  const ctl = [
    {}, { vel: 0.35 }, { vel: 0.1 }, { vel: 0.05 }, { accent: true }, { note: 28 }, { note: 55 }, { note: 76 },
    { dur: 0.03 }, { dur: 0.09 }, { dur: 0.6 }, { dur: 1.5 }, { dur: 6 },
    { vel: 0.4, accent: true, note: 33, dur: 0.9 }, { vel: 0.7, accent: true, note: 64, dur: 0.12 },
  ].map(base);
  const rndCases = Array.from({ length: 10 }, (_, i) => base({ vel: +(0.04 + rnd() * 0.66).toFixed(3), accent: rnd() < 0.3, note: 28 + Math.floor(rnd() * 49), dur: +(0.03 + rnd() * rnd() * 5).toFixed(3) }, 20 + i));
  const slideCases = [{ from: 36 }, { from: 28, note: 33 }, { from: 70, note: 45, accent: true }, { from: 41, note: 52, vel: 0.3, dur: 1.2 }, { from: 50, note: 41, dur: 0.07 }].map(base)
    .concat(Array.from({ length: 6 }, (_, i) => base({ from: 28 + Math.floor(rnd() * 49), note: 28 + Math.floor(rnd() * 49), vel: +(0.05 + rnd() * 0.65).toFixed(3), accent: rnd() < 0.3, dur: +(0.03 + rnd() * rnd() * 4).toFixed(3) }, 40 + i)));

  const out = await page.evaluate(async ({ voices, plain, glide }) => {
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
      seqBassScore: o => { calls.score = (calls.score || 0) + 1; return Promise.resolve({ ok: true }); }, seqBassChords: o => { calls.chords = (calls.chords || 0) + 1; return Promise.resolve({ ok: true }); },
      seqBassStart: o => { calls.start = o; return Promise.resolve({ ok: true }); }, seqBassStop: () => Promise.resolve(), seqBassTempo: () => Promise.resolve(),
    };
    const calls = {};
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    const report = {}, fresh = [];
    for (const voice of voices) {
      window.setBlWave(voice);
      window._nsBank.have = {}; window._nsBank.bad = {};
      const before = entries.length;
      report[voice] = await window._nsBank.ensureBass();
      report[voice].entries = entries.length - before;
      // Lane = slide * 2 + glide: the note's own slide (a longer tail) and where it glides from are independent.
      for (const variant of [0, 1, 2, 3]) {
        const code = window._nsKitCode('bass:' + voice);
        for (const c of (variant & 1 ? glide : plain)) {
          const r = await window._nsBank.record({ kind: 'note', part: 'bass', id: 1, note: c.note, vel: c.vel, accent: c.accent, slide: !!(variant & 2), from: variant & 1 ? c.from : null, at: (c.onset - 1e-6) / sr, dur: c.dur, tune: 0 });
          fresh.push({ voice, kit: code, lane: variant, c, prog: r ? Array.from(r.prog) : null });
        }
      }
    }
    // The signature: the voice, its level, the filter, the fader.
    window.setBlWave('sine');
    const s0 = window._nsBank.signatureBass();
    const lvl = window._webParams['mix.bass']; window._webParams['mix.bass'] = (lvl == null ? 1 : lvl) * 0.5;
    const s1 = window._nsBank.signatureBass(); window._webParams['mix.bass'] = lvl;
    window._nsBank.have = {}; window._nsBank.bad = {};
    const b1 = entries.length; await window._nsBank.ensureBass(); const b2 = entries.length; await window._nsBank.ensureBass();
    const kept = entries.length === b2;
    // The developer entry end to end against the stand-in: _nsBass.start() records the voice (4 entries), sends the line and the chart,
    // and starts the line with the bank's code for the voice; with Native sound off it says so; a walking line is refused.
    window.setBlWave('triangle'); window._nsBank.have = {}; window._nsBank.bad = {};
    window._blRestoreState({ steps: 16, follow: true, genStyle: 'funk', gridRootPc: 0, gridIntvs: [0, 4, 7], grid: Array.from({ length: 16 }, (_, i) => ({ note: i % 12, oct: 2, len: 1, slide: false, accent: false, v: 1, usr: 0 })) });
    window._blClearChords(); window._blOnChord({ rootM: 0, ivs: [0, 4, 7], bassNote: null, isRest: false }, 1, 2, null, 0);
    const e0 = entries.length; Object.keys(calls).forEach(k => delete calls[k]);
    const started = await window._nsBass.start(250);
    const entry = { ok: started.ok, sent: entries.length - e0, score: calls.score, chords: calls.chords, kit: calls.start && calls.start.kit, want: window._nsKitCode('bass:triangle'), align: calls.start && calls.start.align };
    MODGRAPH.on = false; const off = await window._nsBass.start(); MODGRAPH.on = true;
    window._blRestoreState({ genStyle: 'jazz', follow: true });
    const walk = await window._nsBass.sync(); window._blRestoreState({ genStyle: 'funk', follow: true });
    const rb = await window._nsBank.buildBass('upright_real');
    return { report, fresh, held: entries.map(e => Array.from(e)), bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })), sigChanged: s0 !== s1, entry, off: off.why, walk: walk.ok, sentOnce: b2 - b1, kept, sampled: rb.ok ? 'ok' : rb.why };
  }, { voices: VOICES, plain: [...ctl, ...rndCases], glide: slideCases });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  console.log('\nwhat the prober banked:');
  VOICES.forEach(v => { const r = out.report[v]; console.log('  ' + v.padEnd(10) + (r.built ? 'banked (' + r.entries + ' entries)' : 'REFUSED ' + JSON.stringify(r.failed))); });
  ok(VOICES.every(v => out.report[v].built === 1 && out.report[v].entries === 4), 'every synthesized bass voice is banked, in four variants (the note slides, glides, both, neither)', JSON.stringify(out.report));
  ok(/sampled/.test(out.sampled), 'a sampled voice is refused: ' + out.sampled, out.sampled);

  const buf = [];
  buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
  // Only the entries of the voices under test, each once (the signature test above banked sine again, last).
  const seen = new Map(); out.held.forEach(h => seen.set(h[2] + ':' + h[3], h));
  buf.push(seen.size); for (const h of seen.values()) { buf.push(h.length); h.forEach(x => buf.push(x)); }
  const list = out.fresh.filter(f => f.prog);
  ok(list.length === out.fresh.length, 'every fresh recording made one voice', (out.fresh.length - list.length) + ' did not');
  buf.push(list.length);
  list.forEach(f => { buf.push(2, f.kit, f.lane, f.c.vel, f.c.accent ? 1 : 0, f.c.note, f.c.dur, f.lane & 1 ? f.c.from : -1, f.c.onset, f.prog.length); f.prog.forEach(x => buf.push(x)); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bassbank-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const bin = path.join(root, 'native', 'modsynth', 'banktest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth banktest'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cases.f64'), 'bass'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const rows = run.stdout.trim().split('\n').map(l => l.split(' '));
  ok(rows.length === list.length, 'banktest answered every case', rows.length + ' of ' + list.length);
  const by = {}; let nOk = 0, nExact = 0, worst = 1e9, miss = 0;
  rows.forEach((r, i) => {
    const f = list[i], key = f.voice + ['', ' gliding', ' sliding', ' slide+glide'][f.lane];
    const b = by[key] = by[key] || { n: 0, ok: 0, worst: 1e9, bad: [] };
    if (r[1] === 'miss' || /^refused/.test(r[1])) { miss++; b.bad.push(r[1]); return; }
    const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
    b.n++; b.worst = Math.min(b.worst, depth); worst = Math.min(worst, depth);
    const d = f.c;
    if (depth >= PASS_DB && peak > 0) { b.ok++; nOk++; if (depth >= 999) nExact++; }
    else b.bad.push(`note ${d.note} vel ${d.vel} acc ${d.accent} dur ${d.dur} from ${d.from} onset ${d.onset}: ${r[1]} dB (best ${r[3]} at ${r[4]})`);
  });
  console.log('\nbank patch against the page\'s fresh voice, null depth (>= ' + PASS_DB + ' dB passes, 999 is bit-identical):');
  for (const [k, b] of Object.entries(by)) console.log('  ' + (b.ok === b.n ? 'ok   ' : 'FAIL ') + k.padEnd(18) + b.ok + ' of ' + b.n + ', worst ' + (b.worst < 1e8 ? b.worst.toFixed(1) : 'n/a') + ' dB' + (b.bad.length ? '\n         ' + b.bad.slice(0, 6).join('\n         ') : ''));
  ok(miss === 0, 'no note missed the bank', miss);
  ok(nOk === list.length, nOk + ' of ' + list.length + ' notes are exact (' + nExact + ' bit-identical, worst ' + worst.toFixed(1) + ' dB)', (list.length - nOk) + ' below ' + PASS_DB + ' dB');
  ok(out.entry.ok === true && out.entry.sent === 4 && out.entry.score === 1 && out.entry.chords === 1 && out.entry.kit === out.entry.want && out.entry.align === true, '_nsBass.start(): records the voice (4 entries), sends the line and the chart, starts it on the drums\' downbeat with the voice\'s code', JSON.stringify(out.entry));
  ok(/Native sound is off/.test(out.off || '') && out.walk === true, '_nsBass says so with Native sound off (' + out.off + ') and takes a walking line now (' + out.walk + ')', JSON.stringify([out.off, out.walk]));
  ok(out.sigChanged, 'the bass fader is part of the voice\'s signature');
  ok(out.sentOnce === 4 && out.kept, 'the voice is recorded and sent once (4 entries) and kept while the signature holds', JSON.stringify({ sent: out.sentOnce, kept: out.kept }));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
