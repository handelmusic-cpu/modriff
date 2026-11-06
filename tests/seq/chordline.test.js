/* A run of chords through the engine's own player against the page's chords (docs/native-scheduling.md, slice 2).

   Six chords, half a second apart and each held for more than that (so every chord stops the one before it), are sent through the real page as
   it sends them today, each recorded as the one program it is, with the edits the page's own voice code made on each when the next began (the
   chord before is held and faded in 22 ms, its sources stopped: _webChordStop). native/modsynth/chordseqtest plays the same chords through the
   engine's player (chordplay.h): each composed from the bank's one-note chords (the page's prober, window._nsBank.buildChordNote), begun in a pool,
   and the previous chord's voices stopped by the edits the bank holds for them. Both pools' buses are summed and nulled.

   Run: make -C native/modsynth chordseqtest && node tests/seq/chordline.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90), VOICES */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');
const VOICES = (process.env.VOICES || 'sine,sawtooth,piano,pad').split(',');
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
// [root, notes ascending, slash bass or null, vel]
let PROG_ALL = [[60, [60, 64, 67], null, 0.8], [57, [57, 60, 64], null, 0.5], [53, [53, 57, 60, 64], null, 0.9], [55, [55, 59, 62, 65], null, 0.7], [60, [64, 67, 72], null, 0.6], [62, [62, 65, 69, 72, 76], 50, 0.8]];
if (process.env.SINGLE) { PROG_ALL[0] = [60, [60], null, 0.8]; PROG_ALL[1] = [57, [57], null, 0.5]; }
const PROG = PROG_ALL.slice(0, parseInt(process.env.CHORDS || '6'));
const SETTINGS = [
  { name: 'Strum off, Width off', strum: false, spread: 0, width: 0 },
  { name: 'Strum on (150 ms), Width 0.4', strum: true, spread: 0.15, width: 0.4 },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chordline-'));
  const bin = path.join(root, 'native', 'modsynth', 'chordseqtest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth chordseqtest'); process.exit(2); }

  await page.evaluate(() => {
    const sr = 48000;
    const offline = new OfflineAudioContext(2, sr * 8, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    const BUFS = new Map();
    const stub = { graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {} };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    Object.assign(window._webParams, { 'chord.reverb': 0.4 });
    window._test = { BUFS };
  });
  const NEED = [...new Set(PROG.flatMap(([r, ns, b]) => [...ns, ...(b != null ? [b] : []), b != null ? b : r]))].sort((a, b) => a - b);
  for (const voice of VOICES) for (const S of SETTINGS) {
    const out = await page.evaluate(async ({ voice, S, PROG, NEED }) => {
      const sr = 48000;
      wave = voice; strumMode = S.strum; fxWidth = S.width; chordSubOn = true;
      document.getElementById('strum-spread').value = S.spread;
      const entries = [], why = {};
      for (const p of NEED) { const r = await window._nsBank.buildChordNote(voice, p); if (r.ok) entries.push(Array.from(r.entry)); else why[p] = r.why; }
      if (Object.keys(why).length) return { refused: why };
      const kit = window._nsKitCode('chord:' + voice), chords = [];
      window._nsBank.constRandom = true; window._chokeReset(); window._nsBank.keepRecs = true; window._nsBank.recs = [];
      let k = 0;
      for (const [rootN, notes, bass, vel] of PROG) {
        const onset = 2304 + 128 * 400 + 24000 * k + [0, 77, 5, 31, 101, 12][k], dur = 1.4;
        const r = await window._nsBank.record({ kind: 'chord', part: 'chord', id: 1, root: rootN, notes, bass, vel, dur, at: (onset - 1e-6) / sr });
        chords.push({ notes: (bass != null ? [bass] : []).concat(notes), subNote: bass != null ? bass : rootN, vel, dur, onset, prog: Array.from(r.prog) });
        k++;
      }
      await Promise.resolve(); await Promise.resolve();
      window._nsBank.recs.forEach((rec, i) => { chords[i].edits = (rec.capturedInc || []).slice(); });
      window._nsBank.keepRecs = false; window._nsBank.constRandom = false;
      return { entries, kit, chords, bufs: Array.from(window._test.BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
    }, { voice, S, PROG, NEED });
    if (out.refused) { ok(false, voice + ' / ' + S.name + ': the chord voice is banked', JSON.stringify(out.refused).slice(0, 200)); continue; }
    if (process.env.EDITS_DEBUG) { for (const c of out.chords.slice(0, 2)) { const e = []; for (let i = 0; i < c.edits.length; i += 6) e.push(c.edits.slice(i, i + 6).map(x => +x.toFixed(5)).join(',')); console.log('edits of chord at ' + c.onset + ' (' + c.notes + '): ' + e.join(' | ')); } }
    const buf = [];
    buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
    buf.push(out.entries.length); out.entries.forEach(e => { buf.push(e.length); e.forEach(x => buf.push(x)); });
    buf.push(out.kit, out.chords.length);
    out.chords.forEach(c => { buf.push(c.notes.length, ...c.notes, c.subNote, c.vel, c.dur, c.onset, S.strum ? 1 : 0, S.spread, S.width, 1, c.prog.length); c.prog.forEach(x => buf.push(x)); buf.push(c.edits.length); c.edits.forEach(x => buf.push(x)); });
    fs.writeFileSync(path.join(tmp, 'seq.f64'), Buffer.from(Float64Array.from(buf).buffer));
    const run = spawnSync(bin, [path.join(tmp, 'seq.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
    if (process.env.SCORE_DEBUG) console.log(run.stdout);
    const line = run.stdout.split('\n').find(l => l.startsWith('SEQ ')).split(' ').slice(1).map(Number);
    const [depth, peak, nCh, nV, nStops, nRef, nMiss] = line;
    const worst = run.stdout.split('\n').find(l => l.startsWith('WORST ')).split(' ').slice(1).map(Number);
    const paged = out.chords.filter(c => c.edits.length).length;
    ok(depth >= PASS_DB && peak > 0.01 && nRef === 0 && nMiss === 0 && nCh === PROG.length && nStops > 0,
       voice + ' / ' + S.name + ': ' + nCh + ' chords (' + nV + ' voices, ' + nStops + ' stops of the chord before; the page stopped ' + paged + ' of ' + PROG.length + '): ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ', worst 100 ms ' + (worst[1] >= 999 ? 'bit-identical' : worst[1].toFixed(1) + ' dB'),
       JSON.stringify({ depth, nRef, nMiss, nStops }));
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
