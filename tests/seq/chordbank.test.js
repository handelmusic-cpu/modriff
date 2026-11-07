/* The chord comp's voice (native/modsynth/chordcomp.h, docs/native-scheduling.md slice 2) against the page's own chord.

   The page plays a chord as ONE program: a sub oscillator under the root and an independent block per note, sharing only a level factor, a
   pan and a strum offset of the note count. The engine plays it as n + 1 voices composed from a bank of one-note chords the page records
   once per pitch (window._nsBank.buildChordNote): each note's program with the sub silenced, its tone's level times the note's factor, its
   times moved by the strum offset, its panner set; and the sub from the root's program with the tone silenced.

   In the real page, on an OfflineAudioContext with a stand-in plugin, the prober records the pitches a set of chords needs, and for each chord
   (triads, sevenths, a five- and a six-note chord, a slash chord, an inversion whose root is not its lowest note, a single note) at several
   levels, lengths, onsets, with Strum on and off, with the Width panner on and off, the page records the chord as it sends it today.
   native/modsynth/chordtest composes the same chord from the bank (the engine's C++), plays both through a GraphPool and nulls them.

   Run: make -C native/modsynth chordtest && node tests/seq/chordbank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90), VOICES */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');
const VOICES = (process.env.VOICES || 'sine,triangle,sawtooth,square,piano,pad').split(',');
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
// [root, notes (ascending), slash bass or null]
const CHORDS = [
  [60, [60, 64, 67], null], [62, [62, 66, 69], null], [48, [48, 55, 64], null], [60, [60, 64, 67, 71], null], [55, [55, 60, 64, 67, 71], null],
  [60, [60, 63, 67, 70, 74, 77], null], [60, [60, 64, 67], 52], [60, [64, 67, 72], null], [57, [57], null], [67, [67, 71, 74, 77], null],
];
const SETTINGS = [
  { name: 'Strum off, Width off', strum: false, spread: 0, width: 0 },
  { name: 'Strum on (120 ms), Width off', strum: true, spread: 0.12, width: 0 },
  { name: 'Strum off, Width 0.4', strum: false, spread: 0, width: 0.4 },
  { name: 'Strum on (200 ms), Width 0.4', strum: true, spread: 0.2, width: 0.4 },
];
const LEVELS = [{ vel: 0.8, dur: 1.0 }, { vel: 0.35, dur: 0.4 }, { vel: 0.9, dur: 3.0 }, { vel: 0.1, dur: 0.15 }];
const ONSETS = [2304 + 128 * 400, 2304 + 128 * 400 + 77, 2304 + 128 * 523 + 5];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chordbank-'));
  const bin = path.join(root, 'native', 'modsynth', 'chordtest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth chordtest'); process.exit(2); }

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

  const NEED = [...new Set(CHORDS.flatMap(([r, ns, b]) => [...ns, ...(b != null ? [b] : []), b != null ? b : r]))].sort((a, b) => a - b);
  const total = { n: 0, ok: 0, exact: 0, worst: 1e9 };
  for (const voice of VOICES) {
    console.log('\n── chord voice: ' + voice + ' ──');
    for (const S of SETTINGS) {
      const out = await page.evaluate(async ({ voice, S, CHORDS, LEVELS, ONSETS, NEED }) => {
        const sr = 48000;
        wave = voice; strumMode = S.strum; fxWidth = S.width; chordSubOn = true;
        document.getElementById('strum-spread').value = S.spread;
        window.modParamsSync && window.modParamsSync();
        const entries = [], why = {};
        for (const p of NEED) {
          const r = await window._nsBank.buildChordNote(voice, p);
          if (r.ok) entries.push(Array.from(r.entry)); else why[p] = r.why;
        }
        if (Object.keys(why).length) return { refused: why, entries: entries.length };
        const kit = window._nsKitCode('chord:' + voice), cases = [];
        window._nsBank.constRandom = true;
        let ci = 0;
        for (const [rootN, notes, bass] of CHORDS) {
          for (const L of LEVELS) {
            const onset = ONSETS[ci++ % ONSETS.length];
            window._chokeReset();
            const r = await window._nsBank.record({ kind: 'chord', part: 'chord', id: 1, root: rootN, notes, bass, vel: L.vel, dur: L.dur, at: (onset - 1e-6) / sr });
            const all = (bass != null ? [bass] : []).concat(notes);
            cases.push({ notes: all, subNote: bass != null ? bass : rootN, vel: L.vel, dur: L.dur, onset, prog: r ? Array.from(r.prog) : null });
          }
        }
        window._nsBank.constRandom = false;
        const BUFS = window._test.BUFS;
        return { entries, kit, cases, bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
      }, { voice, S, CHORDS, LEVELS, ONSETS, NEED });
      if (out.refused) {
        console.log('  ' + S.name.padEnd(34) + 'REFUSED: ' + JSON.stringify(out.refused).slice(0, 200));
        ok(false, voice + ' / ' + S.name + ': the chord voice is banked', JSON.stringify(out.refused).slice(0, 200));
        continue;
      }
      const buf = [];
      buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
      buf.push(out.entries.length); out.entries.forEach(e => { buf.push(e.length); e.forEach(x => buf.push(x)); });
      buf.push(out.kit);
      const list = out.cases.filter(c => c.prog);
      buf.push(list.length);
      list.forEach(c => { buf.push(c.notes.length, ...c.notes, c.subNote, c.vel, c.dur, c.onset, S.strum ? 1 : 0, S.spread, S.width, 1, c.prog.length); c.prog.forEach(x => buf.push(x)); });
      fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
      const run = spawnSync(bin, [path.join(tmp, 'cases.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
      const rows = run.stdout.trim().split('\n').map(l => l.split(' '));
      let nOk = 0, exact = 0, worst = 1e9; const bad = [];
      rows.forEach((r, i) => {
        const c = list[i];
        if (r[1] === 'miss' || /^refused/.test(r[1])) { bad.push(r[1] + ' ' + c.notes.join('.')); return; }
        const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
        worst = Math.min(worst, depth);
        if (depth >= PASS_DB && peak > 0) { nOk++; if (depth >= 999) exact++; } else bad.push(`${c.notes.join('.')} vel ${c.vel} dur ${c.dur} onset ${c.onset}: ${r[1]} dB (best ${r[4]} at ${r[5]})`);
      });
      total.n += list.length; total.ok += nOk; total.exact += exact; total.worst = Math.min(total.worst, worst);
      console.log('  ' + (nOk === list.length ? 'ok   ' : 'FAIL ') + S.name.padEnd(34) + nOk + ' of ' + list.length + ', ' + exact + ' bit-identical, worst ' + (worst < 1e8 ? worst.toFixed(1) : 'n/a') + ' dB' + (bad.length ? '\n         ' + bad.slice(0, 5).join('\n         ') : ''));
      if (nOk !== list.length) fail++;
    }
  }
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  const sig = await page.evaluate(async () => {
    const sent = [];
    const stub = { graphBuf() {}, graphBegin() {}, graphEdit() {}, seqScore: () => Promise.resolve({}), seqBank: o => { sent.push(1); return Promise.resolve({ ok: true }); } };
    window.modNativePlugin = () => stub;
    wave = 'sine'; strumMode = false; fxWidth = 0; chordSubOn = true; window._nsBank.have = {}; window._nsBank.bad = {};
    const a = await window._nsBank.ensureChord([60, 64, 67]), b = await window._nsBank.ensureChord([60, 64, 67, 71]);
    const s0 = window._nsBank.signatureChord(); fxWidth = 0.4; modParamsSync(); const s1 = window._nsBank.signatureChord();
    const c = await window._nsBank.ensureChord([60]);
    return { a, b, c, changed: s0 !== s1, sent: sent.length };
  });
  const ent = await page.evaluate(async () => {
    const sent = [], calls = {};
    const stub = { graphBuf() {}, graphBegin() {}, graphEdit() {}, seqScore: () => Promise.resolve({}), seqBank: o => { sent.push(1); return Promise.resolve({ ok: true }); },
      seqChordScore: o => { calls.score = (calls.score || 0) + 1; return Promise.resolve({ ok: true }); }, seqChordStart: o => { calls.start = o; return Promise.resolve({ ok: true }); }, seqChordStop: () => Promise.resolve(), seqChordTempo: () => Promise.resolve() };
    window.modNativePlugin = () => stub;
    wave = 'sine'; strumMode = false; fxWidth = 0; chordSubOn = true; window._nsBank.have = {}; window._nsBank.bad = {};
    chordsEnabled = true; CR.chord = { root: 60, intvs: [0, 4, 7] }; CR.key = 'strum'; CR.def = null; CR.preview = null;
    const started = await window._nsChord.start(250);
    const entry = { ok: started.ok, sent: sent.length, score: calls.score, kit: calls.start && calls.start.kit, want: window._nsKitCode('chord:sine'), align: calls.start && calls.start.align };
    MODGRAPH.on = false; const off = await window._nsChord.start(); MODGRAPH.on = true;
    const d = rhyBlank(16); d.cells[0].on = 1; d.cells[0].len = 2; d.name = 'gate'; CR.key = 'u:gate'; CR.def = rhyNorm(d);
    const gated = await window._nsChord.start(); CR.key = 'strum'; CR.def = null;
    return { entry, off: off.why, gated: gated.why };
  });
  ok(ent.entry.ok === true && ent.entry.sent >= 3 && ent.entry.score === 1 && ent.entry.kit === ent.entry.want && ent.entry.align === true && /Native sound is off/.test(ent.off || '') && /gated/.test(ent.gated || ''),
     '_nsChord.start(): records the chord\'s pitches (and the sub\'s), sends the rhythm once, starts it on the drums\' downbeat with the voice\'s code; says so with Native sound off; refuses a gated rhythm', JSON.stringify(ent));
  ok(sig.a.built === 3 && sig.b.built === 1 && sig.b.kept === 3 && sig.changed && sig.c.built === 1 && sig.sent === 5, 'ensureChord: records the pitches a chord needs once (3, then 1 more, the rest kept), and again when the Width changes the signature', JSON.stringify(sig));
  await browser.close(); srv.close();
  ok(total.ok === total.n && total.n > 0, total.ok + ' of ' + total.n + ' chords are exact (' + total.exact + ' bit-identical, worst ' + total.worst.toFixed(1) + ' dB)', (total.n - total.ok) + ' below ' + PASS_DB + ' dB');
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
