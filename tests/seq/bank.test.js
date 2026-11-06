/* The drum voice bank (native/modsynth/voicebank.h, docs/native-scheduling.md slice 1) against the page's own voices.

   In the real page, on an OfflineAudioContext with a stand-in plugin (the way tests/graph/replay.inpage.js does it), the
   production prober window._nsBank records every lane of the kits the score plays and builds its bank entries, which a
   stand-in seqBank collects. Then, for hits at many velocities, accents, pitches and onset frames (every phase of the
   128-frame grid), the page records the same hit fresh, as the app sends it today. native/modsynth/banktest patches the
   bank's entry for the same hit (the engine's C++), begins it on the grid as the host's sequencer does, plays both
   through a GraphPool and nulls them.

   Also held: a lane whose voice does not obey (the two noise voices of the spike) is refused with its reason and not
   banked; changing what is baked into a recording (the Drums fader, a lane's Shape) changes the signature, so the lane is
   recorded again, and the new entry plays at the new level.

   Run: make -C native/modsynth banktest && node tests/seq/bank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
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

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const rnd = prng(2468);
  const cases = [];     // what to record fresh: part, kit, lane, vel, accent, pitch, onset
  const out = await page.evaluate(async (arg0) => {
    const { rndCases } = arg0;
    const sr = 48000, SECS = 8;
    const offline = new OfflineAudioContext(2, sr * SECS, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
    const entries = [], posted = [], BUFS = new Map();
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    // A stand-in for the app's plugin: the graph path's recorder talks to it, and so do window._nsDrum and window._nsBank.
    const stub = {
      graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {},
      seqScore: o => { posted.push('score'); return Promise.resolve({ ok: true }); },
      seqBank: o => { if (o.clear) entries.length = 0; if (o.entry) entries.push(dec(o.entry)); return Promise.resolve({ ok: true }); },
      seqStart: o => Promise.resolve({ ok: true }), seqStop: () => Promise.resolve(), seqTempo: () => Promise.resolve(), seqMirror: () => Promise.resolve({}),
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    Object.assign(window._webParams, { 'chord.reverb': 0.4, 'mel.reverb': 0.5 });

    const report = {};
    const setScore = (kit, aux) => {
      const lanes = n => { const g = {}; for (let t = 0; t < n; t++) g[t] = Array.from({ length: 16 }, (_, s) => ({ v: s === 0 ? 1 : 0, r: 1, orn: 0, vel: 100 })); return g; };
      window._sqRestoreState({ steps: 16, swing: 0, mach: kit, grid: lanes(window._sqMachines()[kit].tracks.length), kitOn: true,
        aux: { mach: 'PERC', grid: aux ? lanes(window._sqMachines()['PERC'].tracks.length) : {}, on: !!aux } });
      window._sqEnsureGrid();
      drumsEnabled = true;
    };
    const b64 = typed => { const u = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    for (const kit of ['808', '909']) {
      setScore(kit, kit === '808');
      window._nsBank.have = {}; window._nsBank.bad = {};
      report[kit] = await window._nsBank.ensure();
    }
    // Which entries the bank holds: [part, kit name, lane, doubles]
    const held = entries.map(e => ({ part: e[1], kit: window._nsKitCodes[e[2]], lane: e[3], d: Array.from(e) }));
    // The cases: fresh recordings of hits the entries cover.
    const fresh = [];
    for (const h of held) {
      for (const c of rndCases) {
        const part = h.part ? 'auxperc' : 'drum';
        const r = await window._nsBank.record({ kind: 'hit', part, id: 1, kit: h.kit, lane: h.lane, vel: c.vel, accent: c.accent, pitch: c.pitch, dyn: null, at: (c.onset - 1e-6) / sr });   // nominal frame, a millionth early: see voicebank.h
        fresh.push({ part: h.part, kit: h.kit, lane: h.lane, vel: c.vel, accent: c.accent, pitch: c.pitch, onset: c.onset, prog: r ? Array.from(r.prog) : null });
      }
    }
    // The chokes: for each lane that registers in the choke group, an open voice and a closing hit at several distances. The
    // page's own _chokeGroup is run on the fresh voice (its edit records are what the page would send), and the engine's cut
    // must do the same to the bank's patched voice.
    const chokeCases = [];
    const dts = [{ vel: 0.9, accent: false, pitch: 0, dt: 1500 }, { vel: 0.6, accent: true, pitch: 0, dt: 6000 }, { vel: 0.9, accent: false, pitch: 3, dt: 12000 }, { vel: 0.8, accent: false, pitch: 0, dt: 60000 }];
    for (const h of held) {
      const part = h.part ? 'auxperc' : 'drum';
      window._chokeReset();
      const probe = await window._nsBank.record({ kind: 'hit', part, id: 1, kit: h.kit, lane: h.lane, vel: 0.9, accent: false, pitch: 0, dyn: null, at: 60000 / sr }, 60000 / sr, false);
      if (!probe || !probe.inc || !probe.inc.length) continue;     // not a hat
      for (const c of dts) {
        const onset = 2304 + 128 * 300 + 37, chokeAt = onset + c.dt;
        window._chokeReset();
        const r = await window._nsBank.record({ kind: 'hit', part, id: 1, kit: h.kit, lane: h.lane, vel: c.vel, accent: c.accent, pitch: c.pitch, dyn: null, at: (onset - 1e-6) / sr }, (chokeAt - 1e-6) / sr, false);   // a millionth of a frame early, as the onset is

        chokeCases.push({ part: h.part, kit: h.kit, lane: h.lane, vel: c.vel, accent: c.accent, pitch: c.pitch, onset, chokeAt, prog: Array.from(r.prog), inc: r.inc });
      }
    }
    // Signature: the Drums fader is baked into a recording.
    setScore('808', false);
    const sigBefore = window._nsBank.signature('drum', '808', 0);
    const lvl = window._webParams['mix.drum'];
    window._webParams['mix.drum'] = (lvl == null ? 1 : lvl) * 0.5;
    const sigAfter = window._nsBank.signature('drum', '808', 0);
    const before = entries.length;
    const rep2 = await window._nsBank.ensure();
    window._webParams['mix.drum'] = lvl;
    const grew = entries.length - before;
    // The developer entry end to end against the stand-in: start() empties the host's bank, records and sends the lanes, sends
    // the score and starts the sequencer; with Native sound off it says so and sends nothing.
    setScore('808', true);
    const before2 = entries.length; posted.length = 0;
    const started = await window._nsDrum.start(250);
    const sentEntries = entries.length;
    MODGRAPH.on = false;
    const refusedOff = await window._nsDrum.start();
    MODGRAPH.on = true;
    return { started: { ok: started.ok, built: started.bank && started.bank.built, failed: started.bank && started.bank.failed.length, scores: posted.length, entries: sentEntries }, refusedOff: refusedOff.why, report, held, fresh, chokeCases, bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })), sigChanged: sigBefore !== sigAfter, rebuilt: rep2.built, kept: rep2.kept, grew };
  }, { rndCases: [
    // controls first: each parameter alone, so a failure names its cause
    { vel: 0.9, accent: false, pitch: 0, onset: 2304 + 128 * 400 },        // the reference itself, on the grid
    { vel: 0.9, accent: false, pitch: 0, onset: 2304 + 128 * 400 + 77 },   // onset between grid lines
    { vel: 0.5, accent: false, pitch: 0, onset: 2304 + 128 * 523 + 5 },
    { vel: 0.9, accent: true, pitch: 0, onset: 2304 + 128 * 611 + 100 },
    { vel: 0.9, accent: false, pitch: 4, onset: 2304 + 128 * 700 + 30 },
    { vel: 0.9, accent: false, pitch: -5, onset: 2304 + 128 * 800 },
    { vel: 0.9, accent: false, pitch: 5, onset: 72735 },
    { vel: 0.9, accent: true, pitch: 5, onset: 72735 },
    { vel: 0.65, accent: false, pitch: 5, onset: 72735 },
    { vel: 0.65, accent: true, pitch: 5, onset: 72735 },
    { vel: 0.65, accent: true, pitch: 0, onset: 72735 },
    { vel: 0.65, accent: false, pitch: 0, onset: 72735 },
    { vel: 0.9, accent: false, pitch: 0, onset: 72735 },
    ].concat(Array.from({ length: 6 }, () => ({ vel: +(0.3 + rnd() * 0.7).toFixed(3), accent: rnd() < 0.3, pitch: [0, -3, 2, 5, -7, 1.5][Math.floor(rnd() * 6)], onset: 20000 + Math.floor(rnd() * 100000) }))) });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  console.log('\nwhat the prober banked (per kit):');
  let banked = 0;
  for (const [kit, r] of Object.entries(out.report)) {
    console.log('  ' + kit + ': ' + r.built + ' recorded and banked, ' + r.failed.length + ' refused');
    r.failed.forEach(f => console.log('     refused  ' + f.kit + ' lane ' + f.lane + ' ' + f.name + ': ' + f.why));
    banked += r.built;
  }
  ok(banked > 10 && out.held.length === banked, 'lanes were banked (' + banked + ' entries reached the host)', out.held.length + ' held');
  const refused = Object.values(out.report).flatMap(r => r.failed.map(f => f.kit + ' ' + f.lane));
  // The one voice the prober cannot bank: its program changes size above some pitch, so no one reference covers it.
  // It is named here so that fixing it, or a second one appearing, is noticed.
  ok(refused.length === 1 && refused[0] === 'PERC 6', 'only the Aux Perc Triangle (PERC lane 6) is refused, with its reason above', refused.join(', '));

  // ── the bank's patches against the fresh recordings ───────────────────────────────────────────
  const buf = [];
  // The clips the voices name (the noise the drums use), in the file replaytest reads: the host's pool needs them before a program names them.
  buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
  buf.push(out.held.length);
  out.held.forEach(h => { buf.push(h.d.length); h.d.forEach(x => buf.push(x)); });
  const list = out.fresh.filter(c => c.prog);
  ok(list.length === out.fresh.length, 'every fresh recording made one voice', (out.fresh.length - list.length) + ' did not');
  const kitCode = {}; out.held.forEach(h => { kitCode[h.kit] = h.d[2]; });
  buf.push(list.length);
  list.forEach(c => { buf.push(c.part, kitCode[c.kit], c.lane, c.vel, c.accent ? 1 : 0, c.pitch, c.onset, c.prog.length); c.prog.forEach(x => buf.push(x)); });
  buf.push(out.chokeCases.length);
  out.chokeCases.forEach(c => { buf.push(c.part, kitCode[c.kit], c.lane, c.vel, c.accent ? 1 : 0, c.pitch, c.onset, c.chokeAt, c.prog.length); c.prog.forEach(x => buf.push(x)); buf.push(c.inc.length); c.inc.forEach(x => buf.push(x)); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const bin = path.join(root, 'native', 'modsynth', 'banktest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth banktest'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cases.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const lines = run.stdout.trim().split('\n');
  const rows = lines.filter(l => !/^choke /.test(l)).map(l => l.split(' '));
  const crow = lines.filter(l => /^choke /.test(l)).map(l => l.split(' ').slice(1));
  ok(rows.length === list.length, 'banktest answered every case', rows.length + ' of ' + list.length);
  const by = {}; let nOk = 0, nExact = 0, worst = 1e9, miss = 0;
  rows.forEach((r, i) => {
    const c = list[i], key = c.kit + ' lane ' + c.lane + (c.part ? ' (aux)' : '');
    if (r[1] === 'miss' || /^refused/.test(r[1])) { miss++; (by[key] = by[key] || { n: 0, ok: 0, worst: 1e9, bad: [] }).bad.push(r[1]); return; }
    const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
    const b = by[key] = by[key] || { n: 0, ok: 0, worst: 1e9, bad: [] };
    b.n++; b.worst = Math.min(b.worst, depth); worst = Math.min(worst, depth);
    if (depth >= PASS_DB && peak > 0) { b.ok++; nOk++; if (depth >= 999) nExact++; if (process.env.SHOW_OK) console.log('   passes: ' + key + ` vel ${c.vel} acc ${c.accent} pitch ${c.pitch} onset ${c.onset} (phase ${(c.onset - 2304) % 128})`); } else b.bad.push(`vel ${c.vel} acc ${c.accent} pitch ${c.pitch} onset ${c.onset}: ${r[1]} dB (best ${r[3]} at ${r[4]})`);
  });
  console.log('\nbank patch against the page\'s fresh voice, null depth (>= ' + PASS_DB + ' dB passes, 999 is bit-identical):');
  for (const [k, b] of Object.entries(by)) console.log('  ' + (b.ok === b.n ? 'ok   ' : 'FAIL ') + k.padEnd(22) + b.ok + ' of ' + b.n + ', worst ' + (b.worst < 1e8 ? b.worst.toFixed(1) : 'n/a') + ' dB' + (b.bad.length ? '\n         ' + b.bad.join('\n         ') : ''));
  ok(miss === 0, 'no hit missed the bank', miss);
  ok(nOk === list.length, nOk + ' of ' + list.length + ' hits are exact (' + nExact + ' bit-identical, worst ' + worst.toFixed(1) + ' dB)', (list.length - nOk) + ' below ' + PASS_DB + ' dB');

  // ── chokes: the closing hat shutting the open one ─────────────────────────────────────────────
  const chLanes = [...new Set(out.chokeCases.map(c => c.kit + ' lane ' + c.lane + (c.part ? ' (aux)' : '')))];
  console.log('\nchokes, the engine\'s cut against the page\'s own (' + chLanes.length + ' hat lanes: ' + chLanes.join(', ') + '):');
  ok(chLanes.length >= 2 && out.chokeCases.length === chLanes.length * 4, 'the hat lanes register in the choke group', chLanes.length + ' lanes, ' + out.chokeCases.length + ' cases');
  ok(crow.length === out.chokeCases.length, 'banktest answered every choke case', crow.length + ' of ' + out.chokeCases.length);
  let cOk = 0, cCut = 0, cWorst = 1e9, cutN = 0, cutDeep = 0;
  crow.forEach((r, i) => {
    const c = out.chokeCases[i], depth = parseFloat(r[1]), pk = parseFloat(r[2]), tail = parseFloat(r[3]), sent = parseInt(r[4]), uncut = parseFloat(r[5]);
    const good = depth >= PASS_DB && pk > 0;
    if (good) cOk++; else console.log('  FAIL ' + c.kit + ' lane ' + c.lane + ` dt ${c.chokeAt - c.onset}: ${r[1]} dB, ${sent} voices cut`);
    cWorst = Math.min(cWorst, depth);
    if (c.inc.length) cCut++;
    if (process.env.SHOW_OK) console.log('   ' + c.kit + ' lane ' + c.lane + ` dt ${c.chokeAt - c.onset}: ${r[1]} dB, peak ${pk.toFixed(4)}, tail after 200 ms ${tail.toFixed(5)}, page edits ${c.inc.length / 6}, engine cut ${sent}, same tail uncut ${uncut.toFixed(5)}`);
    if (c.inc.length && uncut > 1e-4) { cutN++; if (tail < uncut && (c.chokeAt - c.onset > 2000 || tail < uncut * 0.2)) cutDeep++; }
  });
  ok(cOk === out.chokeCases.length, cOk + ' of ' + out.chokeCases.length + ' chokes are exact (worst ' + cWorst.toFixed(1) + ' dB)', (out.chokeCases.length - cOk) + ' below ' + PASS_DB + ' dB');
  ok(cutN > 0 && cutDeep === cutN, 'where a choke found a voice, 200 ms later the tail is lower than the uncut voice\'s (a fifth of it for the early chokes; what is left is the page\'s own, a layer of the open hat that is not in the group) (' + cutDeep + ' of ' + cutN + ')', cutDeep + ' of ' + cutN);
  ok(cCut > 0 && cCut < out.chokeCases.length, cCut + ' of ' + out.chokeCases.length + ' chokes found a voice to cut, the rest came after the voice had ended on its own', cCut);

  ok(out.started.ok === true && out.started.built === 15 && out.started.failed === 1 && out.started.entries === 15 && out.started.scores >= 1, '_nsDrum.start(): empties the bank, records and sends the 15 lanes the score can play (8 kit, 7 of 8 aux; the Triangle is refused), sends the score, starts', JSON.stringify(out.started));
  ok(/Native sound is off/.test(out.refusedOff || ''), '_nsDrum.start() with Native sound off says so and does nothing', out.refusedOff);
  ok(out.sigChanged, 'the Drums fader is part of a lane\'s signature');
  ok(out.rebuilt > 0 && out.grew === out.rebuilt, 'with the fader moved, the lanes are recorded again and sent (' + out.rebuilt + ' rebuilt)', JSON.stringify({ rebuilt: out.rebuilt, grew: out.grew }));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
