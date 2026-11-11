/* The arp voice bank (native/modsynth/voicebank.h, docs/native-scheduling.md slice 3 part two) against the page's own arp voices.

   In the real page, on an OfflineAudioContext with a stand-in plugin, the production prober window._nsBank.buildArp records each
   synthesized arp voice in its three variants (the note panned left, the note panned right, one tone of the block), and the entries go to
   the engine's bank. Then, for notes of every register, velocities, dynamic levels, LENGTHS from 20 ms to 4 s and onsets at every phase of
   the 128-frame grid, the page records the same step fresh, as the app sends it today, and native/modsynth/banktest (in its `arp` mode)
   patches the bank's entry for it (the engine's C++), begins it as the host's sequencer does, plays both through a GraphPool and nulls them.
   The block is the page's real chord message for the part (the tones 12 ms apart), against the engine's one tone patched for each place.

   Also held: sample probes without a pitch explain why; the signature (the voice, the fader, the macro filter) changes when one of them does.

   Run: make -C native/modsynth banktest && node tests/seq/arpbank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
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
const VOICES = (process.env.VOICES || 'sine,sawtooth,square,supersaw,piano,organ,rhodes,pad,pianoreal2,vibes,flute,violin').split(',');
// Decoded libraries and thousands of probe graphs must not accumulate in one
// browser process; each group still covers the full production pitch bank.
if(!process.env.VOICES){
  let failed = false;
  for(const [i, voices] of ['sine,sawtooth,square,supersaw,rhodes,pad', 'sine,piano', 'sine,organ', 'sine,pianoreal2', 'sine,vibes', 'sine,flute', 'sine,violin'].entries()){
    const run = spawnSync(process.execPath, [__filename], {env: {...process.env, VOICES: voices, ARP_SKIP_FX: i ? '1' : '0'}, stdio: 'inherit'});
    if(run.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}


(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const rnd = prng(24680);
  const base = (o, i) => Object.assign({ vel: 0.7, level: 1, note: 60, dur: 0.15 }, o, { onset: 2304 + 128 * (300 + 40 * i) + (i % 5) * 29 });
  const ctl = [
    {}, { vel: 0.35 }, { vel: 0.1 }, { vel: 0.05 }, { vel: 1 }, { vel: 1.3 }, { level: 0.55 }, { level: 0.3 }, { note: 36 }, { note: 48 }, { note: 84 }, { note: 96 }, { note: 24 }, { note: 108 },
    { dur: 0.012 }, { dur: 0.02 }, { dur: 0.027 }, { dur: 0.033 }, { dur: 0.06 }, { dur: 0.3 }, { dur: 0.9 }, { dur: 2 }, { dur: 4 },
    { vel: 0.4, level: 0.55, note: 72, dur: 0.4 }, { vel: 1, level: 0.8, note: 41, dur: 0.1 },
  ].map(base);
  const rndCases = Array.from({ length: 14 }, (_, i) => base({ vel: +(0.05 + rnd() * 1.2).toFixed(3), level: +(0.3 + rnd() * 0.7).toFixed(3), note: 30 + Math.floor(rnd() * 70), dur: +(0.02 + rnd() * rnd() * 3).toFixed(3) }, 30 + i));
  // The block: the page's real chord message for the part, 2 to 6 tones.
  const blocks = [[60, 64, 67], [48, 55, 60, 64, 67, 72], [36, 43], [72, 76, 79, 83, 86]].map((notes, i) => Object.assign(base({ dur: [0.15, 0.4, 1.2, 0.05][i] }, 60 + i), { notes }))
    .concat(Array.from({ length: 4 }, (_, i) => Object.assign(base({ dur: +(0.03 + rnd() * 1.5).toFixed(3) }, 70 + i), { notes: Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => 30 + Math.floor(rnd() * 70)).sort((a, b) => a - b) })));

  const runConfig = async (label, voices, fx) => {
  const out = await page.evaluate(async ({ voices, notes, blocks, fx }) => {
    const sr = 48000;
    const offline = new OfflineAudioContext(2, sr * 8, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    const entries = [], BUFS = new Map(), calls = {};
    const stub = {
      graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {},
      seqScore: () => Promise.resolve({ ok: true }),
      seqBank: o => { if (o.clear) entries.length = 0; if (o.entry) entries.push(dec(o.entry)); return Promise.resolve({ ok: true }); },
      seqStart: () => Promise.resolve({ ok: true }), seqStop: () => Promise.resolve(), seqTempo: () => Promise.resolve(), seqMirror: () => Promise.resolve({ arp: { running: true } }),
      seqArpScore: o => { calls.score = (calls.score || 0) + 1; calls.scoreLen = atob(o.score).length / 8; return Promise.resolve({ ok: true }); },
      seqArpNotes: o => { calls.notes = Array.from(new Float64Array(Uint8Array.from(atob(o.notes), c => c.charCodeAt(0)).buffer)); return Promise.resolve({ ok: true }); },
      seqArpStart: o => { calls.start = o; return Promise.resolve({ ok: true }); }, seqArpStop: () => { calls.stop = true; return Promise.resolve(); },
      seqArpArm: o => { calls.arm = o; return Promise.resolve(); },
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    const report = {}, fresh = [];
    if (fx) Object.assign(window._webParams, fx);
    for (const voice of voices) {
      setArpWave(voice);
      if(SAMPLED_WAVES[voice]){
        preloadSampleInstrument(SAMPLED_WAVES[voice]);
        const until = performance.now() + 15000;
        while(SAMPLE_STATE[SAMPLED_WAVES[voice]] === 'loading' && performance.now() < until) await new Promise(r => setTimeout(r, 10));
      }
      if (_wp('arp.voice') !== voice) { report[voice] = { failed: [{ why: 'could not select the voice' }], built: 0, entries: 0 }; continue; }
      window._nsBank.have = {}; window._nsBank.bad = {};
      const before = entries.length;
      report[voice] = await window._nsBank.ensureArp();
      report[voice].entries = entries.length - before;
      if (!report[voice].built) continue;
      const code = window._nsKitCode('arp:' + voice);
      for (const lane of [0, 1]) for (const c of notes) {
        const r = await window._nsBank.record({ kind: 'note', part: 'arp', id: 1, note: c.note, vel: c.vel, level: c.level, pan: lane ? 0.75 : -0.75, at: (c.onset - 1e-6) / sr, dur: c.dur, tune: 0 });
        fresh.push({ voice, kit: code, lane, c, tones: [c.note], prog: r ? Array.from(r.prog) : null });
      }
      for (const c of blocks) {
        window._nsBank.constRandom = true;
        const r = await window._nsBank.record({ kind: 'chord', part: 'arp', id: 1, root: null, notes: c.notes.slice(), bass: null, vel: 1, at: (c.onset - 1e-6) / sr, dur: c.dur, tunes: c.notes.map(() => 0) });
        window._nsBank.constRandom = false;
        fresh.push({ voice, kit: code, lane: 2, c: Object.assign({}, c, { vel: 1, level: 1, note: c.notes[0] }), tones: c.notes.slice(), prog: r ? Array.from(r.prog) : null });
      }
    }
    // The signature: the voice, the fader, the macro filter.
    setArpWave('sine');
    const s0 = window._nsBank.signatureArp();
    const lvl = window._webParams['mix.arp']; window._webParams['mix.arp'] = (lvl == null ? 1 : lvl) * 0.5;
    const s1 = window._nsBank.signatureArp(); window._webParams['mix.arp'] = lvl;
    const fc = window._webParams['fx.cutoff']; window._webParams['fx.cutoff'] = fc === 0.5 ? 0.3 : 0.5;
    const s2 = window._nsBank.signatureArp(); window._webParams['fx.cutoff'] = fc;
    window._nsBank.have = {}; window._nsBank.bad = {};
    const b1 = entries.length; await window._nsBank.ensureArp(); const b2 = entries.length; await window._nsBank.ensureArp();
    const kept = entries.length === b2;
    // Voices the engine cannot play yet are refused with their reason, not recorded wrongly.
    const reasons = {};
    for (const v of ['pianoreal2', 'vibes', 'sampler', 'modsynth']) reasons[v] = (await window._nsBank.buildArp(v)).why;
    MODGRAPH.on = false; const off = await window._nsBank.buildArp('sine'); MODGRAPH.on = true;
    // The developer entry end to end against the stand-in: _nsArp.start() records the voice, sends the settings and the chord the arp is on and starts it with the
    // voice's code; a sampled voice is refused with its reason (and nothing started); a song arms it when the arp is on and disarms it when it is off.
    const entry = {};
    setArpWave('sine'); window._nsBank.have = {}; window._nsBank.bad = {};
    setArpChord(60, [0, 4, 7]); arpOcts = 2; setArpChord(60, [0, 4, 7]);
    const e0 = entries.length; Object.keys(calls).forEach(k => delete calls[k]);
    const st = await window._nsArp.start(250);
    entry.start = { ok: st.ok, sent: entries.length - e0, score: calls.score, notes: calls.notes, kit: calls.start && calls.start.kit, want: window._nsKitCode('arp:sine'), align: calls.start && calls.start.align, scoreLen: calls.scoreLen };
    arpOcts = 1;
    Object.keys(calls).forEach(k => delete calls[k]);
    setArpWave('modsynth'); const sm = await window._nsArp.start(250); setArpWave('sine');
    entry.sampled = { why: sm.why, started: !!calls.start };
    Object.keys(calls).forEach(k => delete calls[k]);
    arpOn = false; const a0 = await window._nsArp.armForSong(); entry.off = { armed: a0.armed, arm: calls.arm };
    arpOn = true; const a1 = await window._nsArp.armForSong(); entry.on = { armed: a1.armed, arm: calls.arm, want: window._nsKitCode('arp:sine') };
    Object.keys(calls).forEach(k => delete calls[k]);
    setArpWave('modsynth'); const a2 = await window._nsArp.armForSong(); setArpWave('sine'); arpOn = false;
    entry.refused = { armed: a2.armed, why: a2.why, arm: calls.arm };
    return { entry, report, fresh, held: entries.map(e => Array.from(e)), bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })), sigChanged: [s0 !== s1, s0 !== s2], sentOnce: b2 - b1, kept, reasons, off: off.why };
  }, { voices, notes: [...ctl, ...rndCases], blocks, fx });
  ok(errs.length === 0, label + ': the page threw nothing', errs.join(' | '));

  console.log('\n' + label + ' - what the prober banked:');
  voices.forEach(v => { const r = out.report[v]; console.log('  ' + v.padEnd(10) + (r.built ? 'banked (' + r.entries + ' entries) ' + JSON.stringify(r.failed) : 'REFUSED ' + JSON.stringify(r.failed))); });
  const banked = voices.filter(v => out.report[v].built);
  ok(voices.every(v => !out.report[v].failed.length) && banked.length === voices.length && banked.every(v => out.report[v].entries >= 2), 'every selected arp voice is banked, including pitch-specific instruments, an entry for each regime of length of the note and of the block tone', JSON.stringify(out.report));
  for (const v of ['pianoreal2', 'vibes', 'sampler']) ok(/sampled/.test(out.reasons[v] || ''), 'a sample probe without its required pitch explains why: ' + out.reasons[v], out.reasons[v]);
  ok(/mõdSynth/.test(out.reasons.modsynth || ''), 'a mõdSynth voice is refused with its reason: ' + out.reasons.modsynth, out.reasons.modsynth);
  ok(/Native sound/.test(out.off || ''), 'with Native sound off the prober says so: ' + out.off, out.off);

  const buf = [];
  buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
  const seen = new Map(); out.held.forEach(h => seen.set(h[2] + ':' + h[3], h));
  buf.push(seen.size); for (const h of seen.values()) { buf.push(h.length); h.forEach(x => buf.push(x)); }
  const list = out.fresh.filter(f => f.prog);
  ok(list.length === out.fresh.length, 'every fresh recording made one voice', (out.fresh.length - list.length) + ' did not');
  buf.push(list.length);
  list.forEach(f => { buf.push(5, f.kit, f.lane, f.c.vel, 0, f.tones[0], f.c.dur, f.c.level, f.tones.length); f.tones.forEach(x => buf.push(x)); buf.push(f.c.onset, f.prog.length); f.prog.forEach(x => buf.push(x)); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arpbank-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const bin = process.env.BANKTEST || path.join(root, 'native', 'modsynth', 'banktest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth banktest'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cases.f64'), 'arp'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const rows = run.stdout.trim().split('\n').map(l => l.split(' '));
  ok(rows.length === list.length, 'banktest answered every case', rows.length + ' of ' + list.length);
  const by = {}; let nOk = 0, nExact = 0, worst = 1e9, miss = 0;
  rows.forEach((r, i) => {
    const f = list[i], key = f.voice + ['', ' right', ' block'][f.lane];
    const b = by[key] = by[key] || { n: 0, ok: 0, worst: 1e9, bad: [] };
    if (r[1] === 'miss' || /^refused/.test(r[1])) { miss++; b.bad.push(r[1]); return; }
    const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
    b.n++; b.worst = Math.min(b.worst, depth); worst = Math.min(worst, depth);
    const d = f.c;
    if (depth >= PASS_DB && peak > 0) { b.ok++; nOk++; if (depth >= 999) nExact++; }
    else b.bad.push(`tones ${f.tones.join(',')} vel ${d.vel} level ${d.level} dur ${d.dur} onset ${d.onset}: ${r[1]} dB (best ${r[3]} at ${r[4]})`);
  });
  console.log('\nbank patch against the page\'s fresh voice, null depth (>= ' + PASS_DB + ' dB passes, 999 is bit-identical):');
  for (const [k, b] of Object.entries(by)) console.log('  ' + (b.ok === b.n ? 'ok   ' : 'FAIL ') + k.padEnd(18) + b.ok + ' of ' + b.n + ', worst ' + (b.worst < 1e8 ? b.worst.toFixed(1) : 'n/a') + ' dB' + (b.bad.length ? '\n         ' + b.bad.slice(0, +(process.env.SHOW || 6)).join('\n         ') : ''));
  ok(miss === 0, 'no step missed the bank', miss);
  ok(nOk === list.length, nOk + ' of ' + list.length + ' steps are exact (' + nExact + ' bit-identical, worst ' + worst.toFixed(1) + ' dB)', (list.length - nOk) + ' below ' + PASS_DB + ' dB');
  if (!fx) {
    const e = out.entry;
    ok(e.start.ok !== false && e.start.sent === out.report.sine.entries && e.start.score === 1 && JSON.stringify(e.start.notes) === JSON.stringify([60, 64, 67, 72, 76, 79]) && e.start.kit === e.start.want && e.start.align === true,
       '_nsArp.start(): records the voice, sends the settings and the chord the arp is on (two octaves), and starts it on the drums\' bar line with the voice\'s code', JSON.stringify(e.start));
    ok(/mõdSynth/.test(e.sampled.why || '') && !e.sampled.started, '_nsArp.start() with an unsupported voice says why and starts nothing: ' + e.sampled.why, JSON.stringify(e.sampled));
    ok(e.off.armed === false && e.off.arm && e.off.arm.on === false && e.on.armed === true && e.on.arm && e.on.arm.on === true && e.on.arm.kit === e.on.want,
       'a song arms the arp when it is on (with the voice\'s code) and disarms it when it is off', JSON.stringify([e.off, e.on]));
    ok(e.refused.armed === false && /mõdSynth/.test(e.refused.why || '') && e.refused.arm && e.refused.arm.on === false, 'and disarms it, with the reason, when the engine cannot play the voice: ' + e.refused.why, JSON.stringify(e.refused));
  }
  ok(out.sigChanged[0] && out.sigChanged[1], 'the Arp fader and the macro filter are part of the voice\'s signature', JSON.stringify(out.sigChanged));
  ok(out.sentOnce === out.report.sine.entries && out.kept, 'the voice is recorded and sent once and kept while the signature holds', JSON.stringify({ sent: out.sentOnce, kept: out.kept }));
  };
  await runConfig('plain', VOICES, null);
  // The mõdFX macro's filter (it opens with the velocity up to a ceiling, and its envelope follows the length) and its width (the panner).
  if(process.env.ARP_SKIP_FX !== '1') await runConfig('filter, envelope and width', ['sine', 'supersaw', 'rhodes'], { 'fx.cutoff': 0.5, 'fx.env': 0.4, 'fx.reso': 0.3, 'fx.width': 1 });
  await browser.close(); srv.close();
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
