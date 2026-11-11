/* The melody generator's voice bank (native/modsynth/voicebank.h, docs/native-scheduling.md slice 3 part three) against the page's own voices.

   In the real page, on an OfflineAudioContext with a stand-in plugin, the production prober window._nsBank.buildMel records each synthesized melody voice in its two kinds (the note, and the
   note that slides in from the one before) and in the regimes of length it needs, and the entries go to the engine's bank. Then, for notes of every register, levels, accents, LENGTHS from 12 ms
   to 4 s, slides from other notes and over other times, and onsets at every phase of the 128-frame grid, the page records the same note fresh, as the app sends it today, and
   native/modsynth/banktest (in its `mel` mode) patches the bank's entry for it the way the player picks it (the engine's C++), begins it as the host's sequencer does, plays both through a GraphPool
   and nulls them.

   Also held: per-pitch sample preparation succeeds, and unsupported synth patches are refused; the signature changes when the voice or the fader does and the voice is then recorded again; the developer
   entry (window._nsMel) end to end against a stand-in plugin.

   Run: make -C native/modsynth banktest && node tests/seq/melbank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
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
const VOICES = (process.env.VOICES || 'sine,triangle,square,sawtooth,supersaw,pad,piano,rhodes,organ,pianoreal2,vibes,flute,violin').split(',');
// Decoded libraries and thousands of probe graphs must not accumulate in one
// browser process; each group still covers the full production pitch bank.
if(!process.env.VOICES){
  let failed = false;
  for(const [i, voices] of ['sine,triangle,square,sawtooth,supersaw,pad,rhodes', 'sine,piano', 'sine,organ', 'sine,pianoreal2', 'sine,vibes', 'sine,flute', 'sine,violin'].entries()){
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

  const rnd = prng(13579);
  const base = (o, i) => Object.assign({ vel: 0.5, accent: false, note: 66, dur: 0.15, from: -1, gt: 0 }, o, { onset: 2304 + 128 * (300 + 40 * i) + (i % 5) * 29 });
  const ctl = [
    {}, { vel: 0.3 }, { vel: 0.1 }, { vel: 0.03 }, { vel: 0.7 }, { vel: 1.1 }, { accent: true }, { accent: true, vel: 0.2 }, { note: 48 }, { note: 60 }, { note: 84 }, { note: 96 }, { note: 36 }, { note: 100 },
    { dur: 0.012 }, { dur: 0.02 }, { dur: 0.03 }, { dur: 0.06 }, { dur: 0.3 }, { dur: 0.9 }, { dur: 2 }, { dur: 4 },
    { vel: 0.2, accent: true, note: 72, dur: 0.4 }, { vel: 0.6, note: 55, dur: 0.1 },
  ].map(base);
  const rndCases = Array.from({ length: 14 }, (_, i) => base({ vel: +(0.03 + rnd() * 0.8).toFixed(3), accent: rnd() < 0.3, note: 40 + Math.floor(rnd() * 60), dur: +(0.02 + rnd() * rnd() * 3).toFixed(3) }, 30 + i));
  // the slides: from a note within 24 semitones (the page makes none past that), taking 20 ms to 0.4 s, never longer than 0.8 of the note
  const slides = [{ from: 60, gt: 0.06 }, { from: 54, note: 62, gt: 0.03 }, { from: 78, note: 66, gt: 0.1, accent: true }, { from: 48, note: 70, gt: 0.2, dur: 0.5, vel: 0.2 }, { from: 66, note: 67, gt: 0.02, dur: 0.05 }, { from: 40, note: 63, gt: 0.04 }, { from: 90, note: 66, gt: 0.3, dur: 1.2 }]
    .map((o, i) => base(o, 60 + i)).concat(Array.from({ length: 12 }, (_, i) => { const note = 50 + Math.floor(rnd() * 40); let from = note + (Math.floor(rnd() * 47) - 23); if (from === note) from += 3; const dur = +(0.03 + rnd() * rnd() * 2).toFixed(3); return base({ note, from, gt: +Math.min(0.025 + rnd() * 0.3, dur * 0.8).toFixed(3), dur, vel: +(0.03 + rnd() * 0.8).toFixed(3), accent: rnd() < 0.3 }, 70 + i); }));

  const runConfig = async (label, voices) => {
  const out = await page.evaluate(async ({ voices, plain, slides }) => {
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
      seqStart: () => Promise.resolve({ ok: true }), seqStop: () => Promise.resolve(), seqTempo: () => Promise.resolve(), seqMirror: () => Promise.resolve({ mel: { running: true } }),
      seqMelScore: o => { calls.score = (calls.score || 0) + 1; calls.scoreLen = atob(o.score).length / 8; return Promise.resolve({ ok: true }); },
      seqMelChords: o => { calls.chords = (calls.chords || 0) + 1; return Promise.resolve({ ok: true }); },
      seqMelStart: o => { calls.start = o; return Promise.resolve({ ok: true }); }, seqMelStop: () => { calls.stop = true; return Promise.resolve(); },
      seqMelArm: o => { calls.arm = o; return Promise.resolve(); },
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    const report = {}, fresh = [];
    for (const voice of voices) {
      setMlWave(voice);
      if(SAMPLED_WAVES[voice]){
        preloadSampleInstrument(SAMPLED_WAVES[voice]);
        const until = performance.now() + 15000;
        while(SAMPLE_STATE[SAMPLED_WAVES[voice]] === 'loading' && performance.now() < until) await new Promise(r => setTimeout(r, 10));
      }
      if (_wp('melgen.voice') !== voice) { report[voice] = { failed: [{ why: 'could not select the voice' }], built: 0, entries: 0 }; continue; }
      window._nsBank.have = {}; window._nsBank.bad = {};
      const before = entries.length;
      report[voice] = await window._nsBank.ensureMel();
      report[voice].entries = entries.length - before;
      if (!report[voice].built) continue;
      const code = window._nsKitCode('mel:' + voice);
      for (const c of plain) {
        const r = await window._nsBank.record({ kind: 'note', part: 'melgen', id: 1, note: c.note, vel: c.vel, accent: c.accent, at: (c.onset - 1e-6) / sr, dur: c.dur, tune: 0 });
        fresh.push({ voice, kit: code, lane: 0, c, prog: r ? Array.from(r.prog) : null });
      }
      for (const c of slides) {
        const r = await window._nsBank.record({ kind: 'note', part: 'melgen', id: 1, note: c.note, vel: c.vel, accent: c.accent, at: (c.onset - 1e-6) / sr, dur: c.dur, tune: 0, glideFrom: c.from, glideTime: c.gt });
        fresh.push({ voice, kit: code, lane: 1, c, prog: r ? Array.from(r.prog) : null });
      }
    }
    // The signature: the voice and the fader.
    setMlWave('sine');
    const s0 = window._nsBank.signatureMel();
    const lvl = window._webParams['mix.melgen']; window._webParams['mix.melgen'] = (lvl == null ? 1 : lvl) * 0.5;
    const s1 = window._nsBank.signatureMel(); window._webParams['mix.melgen'] = lvl;
    window._nsBank.have = {}; window._nsBank.bad = {};
    const b1 = entries.length; await window._nsBank.ensureMel(); const b2 = entries.length; await window._nsBank.ensureMel();
    const kept = entries.length === b2;
    const reasons = {};
    for (const v of ['pianoreal2', 'vibes', 'sampler', 'modsynth']) reasons[v] = (await window._nsBank.buildMel(v)).why;
    MODGRAPH.on = false; const off = await window._nsBank.buildMel('sine'); MODGRAPH.on = true;
    // The developer entry end to end against the stand-in: _nsMel.start() records the voice, sends the line and the chart and starts it with the voice's code; a sampled voice is refused with
    // its reason (and nothing started); a song arms it when the melody is playing and disarms it when it is not or when the engine cannot play the voice.
    const entry = {};
    setMlWave('sine'); window._nsBank.have = {}; window._nsBank.bad = {};
    const e0 = entries.length; Object.keys(calls).forEach(k => delete calls[k]);
    const st = await window._nsMel.start(250);
    entry.start = { ok: st.ok, sent: entries.length - e0, score: calls.score, chords: calls.chords, kit: calls.start && calls.start.kit, want: window._nsKitCode('mel:sine'), align: calls.start && calls.start.align };
    Object.keys(calls).forEach(k => delete calls[k]);
    setMlWave('modsynth'); const sm = await window._nsMel.start(250); setMlWave('sine');
    entry.sampled = { why: sm.why, started: !!calls.start };
    Object.keys(calls).forEach(k => delete calls[k]);
    window._mlSetClock(0, 0, false); const a0 = await window._nsMel.armForSong(); entry.off = { armed: a0.armed, arm: calls.arm };
    window._mlSetClock(0, 0, true); const a1 = await window._nsMel.armForSong(); entry.on = { armed: a1.armed, arm: calls.arm, want: window._nsKitCode('mel:sine') };
    Object.keys(calls).forEach(k => delete calls[k]);
    setMlWave('modsynth'); const a2 = await window._nsMel.armForSong(); setMlWave('sine'); window._mlSetClock(0, 0, false);
    entry.refused = { armed: a2.armed, why: a2.why, arm: calls.arm };
    delete window._nsBank.have['mel:sine'];
    window._nsBank.bad['mel:sine'] = window._nsBank.signatureMel();
    Object.keys(calls).forEach(k => delete calls[k]);
    const cached = await window._nsMel.start(250);
    entry.cachedRefused = {ok: cached.ok, why: cached.why, started: !!calls.start};
    return { entry, report, fresh, held: entries.map(e => Array.from(e)), bufs: Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })), sigChanged: s0 !== s1, sentOnce: b2 - b1, kept, reasons, off: off.why };
  }, { voices, plain: [...ctl, ...rndCases], slides });
  ok(errs.length === 0, label + ': the page threw nothing', errs.join(' | '));

  console.log('\n' + label + ' - what the prober banked:');
  voices.forEach(v => { const r = out.report[v]; console.log('  ' + v.padEnd(10) + (r.built ? 'banked (' + r.entries + ' entries)' : 'REFUSED') + (r.failed.length ? ' ' + JSON.stringify(r.failed) : '')); });
  const banked = voices.filter(v => out.report[v].built);
  ok(voices.every(v => !out.report[v].failed.length) && banked.length === voices.length && banked.every(v => out.report[v].entries >= 2), 'every selected melody voice is banked, including pitch-dependent graphs and their length regimes', JSON.stringify(out.report));
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
  list.forEach(f => { buf.push(6, f.kit, f.lane, f.c.vel, f.c.accent ? 1 : 0, f.c.note, f.c.dur, f.lane ? f.c.from : -1, f.lane ? f.c.gt : 0, f.c.onset, f.prog.length); f.prog.forEach(x => buf.push(x)); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melbank-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const bin = process.env.BANKTEST || path.join(root, 'native', 'modsynth', 'banktest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth banktest'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cases.f64'), 'mel'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const rows = run.stdout.trim().split('\n').map(l => l.split(' '));
  ok(rows.length === list.length, 'banktest answered every case', rows.length + ' of ' + list.length);
  const by = {}; let nOk = 0, nExact = 0, worst = 1e9, miss = 0;
  rows.forEach((r, i) => {
    const f = list[i], key = f.voice + ['', ' sliding'][f.lane];
    const b = by[key] = by[key] || { n: 0, ok: 0, worst: 1e9, bad: [] };
    if (r[1] === 'miss' || /^refused/.test(r[1])) { miss++; b.bad.push(r[1]); return; }
    const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
    b.n++; b.worst = Math.min(b.worst, depth); worst = Math.min(worst, depth);
    const d = f.c;
    if (depth >= PASS_DB && peak > 0) { b.ok++; nOk++; if (depth >= 999) nExact++; }
    else b.bad.push(`note ${d.note} vel ${d.vel} acc ${d.accent} dur ${d.dur} from ${f.lane ? d.from : '-'} time ${f.lane ? d.gt : '-'} onset ${d.onset}: ${r[1]} dB (best ${r[3]} at ${r[4]})`);
  });
  console.log('\nbank patch against the page\'s fresh voice, null depth (>= ' + PASS_DB + ' dB passes, 999 is bit-identical):');
  for (const [k, b] of Object.entries(by)) console.log('  ' + (b.ok === b.n ? 'ok   ' : 'FAIL ') + k.padEnd(18) + b.ok + ' of ' + b.n + ', worst ' + (b.worst < 1e8 ? b.worst.toFixed(1) : 'n/a') + ' dB' + (b.bad.length ? '\n         ' + b.bad.slice(0, +(process.env.SHOW || 6)).join('\n         ') : ''));
  ok(miss === 0, 'no note missed the bank', miss);
  ok(nOk === list.length, nOk + ' of ' + list.length + ' notes are exact (' + nExact + ' bit-identical, worst ' + worst.toFixed(1) + ' dB)', (list.length - nOk) + ' below ' + PASS_DB + ' dB');
  {
    const e = out.entry;
    ok(e.start.ok !== false && e.start.sent === out.report.sine.entries && e.start.score === 1 && e.start.chords === 1 && e.start.kit === e.start.want && e.start.align === true,
       '_nsMel.start(): records the voice, sends the line and the chart, and starts it on the drums\' bar line with the voice\'s code', JSON.stringify(e.start));
    ok(/mõdSynth/.test(e.sampled.why || '') && !e.sampled.started, '_nsMel.start() with an unsupported voice says why and starts nothing: ' + e.sampled.why, JSON.stringify(e.sampled));
    ok(e.off.armed === false && e.off.arm && e.off.arm.on === false && e.on.armed === true && e.on.arm && e.on.arm.on === true && e.on.arm.kit === e.on.want,
       'a song arms the melody when it is playing (with the voice\'s code) and disarms it when it is not', JSON.stringify([e.off, e.on]));
    ok(e.refused.armed === false && /mõdSynth/.test(e.refused.why || '') && e.refused.arm && e.refused.arm.on === false, 'and disarms it, with the reason, when the engine cannot play the voice: ' + e.refused.why, JSON.stringify(e.refused));
    ok(e.cachedRefused.ok === false && !e.cachedRefused.started && /refused/.test(e.cachedRefused.why), 'a cached refusal cannot start a part with no valid bank entry', JSON.stringify(e.cachedRefused));
  }
  ok(out.sigChanged, 'the Melody Gen fader is part of the voice\'s signature');
  ok(out.sentOnce === out.report.sine.entries && out.kept, 'the voice is recorded and sent once and kept while the signature holds', JSON.stringify({ sent: out.sentOnce, kept: out.kept }));
  };
  await runConfig('plain', VOICES);
  await browser.close(); srv.close();
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
