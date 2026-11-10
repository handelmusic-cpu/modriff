/* The arp's sound end to end (native/modsynth/arpcore.h, arpplay.h, docs/native-scheduling.md slice 3 part two): the page's real scheduleArp runs on a clock of its own and everything
   it sends for the part "arp" is kept; each note or block it sent is recorded as the program the page's voice code makes for it. native/modsynth/arpseqtest runs the engine's
   arpeggiator on the same settings and chords (the page's own random draws as the tape), begins each event it makes from the voice bank (the page's prober,
   window._nsBank.ensureArp) in a pool, and the two pools' buses are summed and nulled.

   The bank test (arpbank.test.js) holds one step to the page's, the scheduler test (arpgrid.test.js) holds the list of steps; this holds them together: the chord changing mid-run, the
   dynamic shape and the gate pattern, the block's strum, the notes shorter than the attack (their own regime), overlapping tails.

   Run: make -C native/modsynth arpseqtest && node tests/seq/arpline.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90), VOICES, ARPSEQ (another build of the tool) */
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
// 120 BPM, so a sixteenth is 6000 frames and every step is a whole frame (the page puts a note on the first whole frame at or after its time; the engine rounds)
const C1 = [{ at: 0, root: 60, ivs: [0, 4, 7] }, { at: 1.1, root: 65, ivs: [0, 3, 7, 10] }];
// rate: an index into ARP_RATES (11 = 1/16, 8 = 1/8, 10 = 1/12, 5 = 1/4, 13 = 1/32)
const CASES = [
  { name: 'Up over two octaves, sixteenths, the Accent gate pattern, Cresc, the chord changing', pat: 'up', octs: 2, rate: 11, gatePat: 3, shape: 'cresc', chords: C1, secs: 2.4 },
  { name: 'Down, eighth triplets, gate 0.8, Hill', pat: 'down', rate: 10, gate: 0.8, shape: 'hill', chords: C1, secs: 2.4 },
  { name: 'Bounce over two octaves (its own levels), Valley', pat: 'bounce', octs: 2, rate: 11, shape: 'valley', chords: C1, secs: 2.4 },
  { name: 'Block on eighths, the chord changing (the strum, 12 ms a tone)', pat: 'block', rate: 8, chords: C1, secs: 2.4 },
  { name: 'Up at 1/32 with a gate of 0.45: notes of 28 ms, a hair over the attack', pat: 'up', rate: 13, gate: 0.45, chords: C1, secs: 1.6 },
  { name: 'Up at 1/32 with a gate of 0.3: notes shorter than the attack', pat: 'up', rate: 13, gate: 0.3, chords: C1, secs: 1.6 },
  { name: 'Free timing at 40 ms, the Skip gate pattern', pat: 'up', free: true, freeMs: 40, gatePat: 2, chords: C1, secs: 1.6 },
  { name: 'Up at 1/16 with a Decay of 0.1: the Decay caps the note', pat: 'up', rate: 11, gate: 0.9, decay: 0.1, chords: C1, secs: 2.4 },
  { name: 'Random over two octaves (the page\'s draws as the tape)', pat: 'rand', octs: 2, rate: 11, chords: C1, secs: 2.4, draws: true },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arpline-'));
  const bin = process.env.ARPSEQ || path.join(root, 'native', 'modsynth', 'arpseqtest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth arpseqtest'); process.exit(2); }
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
      setArpWave(voice);
      window._test.entries.length = 0; window._nsBank.have = {}; window._nsBank.bad = {};
      const rep = await window._nsBank.ensureArp();
      return { rep, entries: window._test.entries.map(e => Array.from(e)), kit: window._nsKitCode('arp:' + voice), bufs: Array.from(window._test.BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch })) };
    }, voice);
    ok(bank.rep.built === 1, voice + ': the voice is banked (' + bank.entries.length + ' entries)', JSON.stringify(bank.rep));
    if (!bank.rep.built) continue;
    for (const c of CASES) {
      const run = await page.evaluate(async ({ c, voice }) => {
        const sr = 48000, fake = { currentTime: 0, sampleRate: sr, state: 'running' };
        const off = new OfflineAudioContext(2, sr, sr);
        const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
        clearTimeout(clockTimer);
        const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realSetTimeout = window.setTimeout, realRandom = Math.random;
        const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready }, sent = [];
        E.send = m => { if (m && m.part === 'arp') sent.push(m); }; E.now = () => fake.currentTime; E.ready = () => true;
        window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
        window.setTimeout = (fn, ms) => 0;
        window._sqPlaying = () => true;
        const bpm = 120; document.getElementById('bpm').value = bpm;
        const T0 = 1.0; CLOCK_EPOCH = T0; fake.currentTime = 0.5;
        arpOn = true; arpPat = c.pat; arpOcts = c.octs || 1; arpRateIdx = c.rate == null ? 11 : c.rate; arpFree = !!c.free; arpFreeMs = c.freeMs || 150; arpGatePat = c.gatePat || 0; arpVelShape = c.shape || 'flat';
        arpMotion = 'off';
        document.getElementById('arp-gate').value = c.gate == null ? 0.5 : c.gate; document.getElementById('decay').value = c.decay == null ? 2 : c.decay;
        window._sqSetSwing(0); window.setHumanize(0);
        const out = { chords: [], tape: [] };
        const setChord = ch => { setArpChord(ch.root, ch.ivs.slice()); out.chords.push({ at: ch.at, notes: arpNotes.slice() }); };
        arpNextBeat = T0;
        setChord(c.chords[0]);
        const horizon = h => { _schedHorizon = T0 + h; };
        const run = () => { Math.random = function () { const v = realRandom(); out.tape.push(v); return v; }; try { scheduleArp(); } finally { Math.random = realRandom; } };
        for (let i = 1; i < c.chords.length; i++) { horizon(c.chords[i].at); run(); setChord(c.chords[i]); }
        horizon(c.secs); run();
        _schedHorizon = null;
        out.score = window._arpNativeScore().score;
        window.setTimeout = realSetTimeout; window._sqPlaying = realSq; window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
        arpOn = false; arpSounding = false; arpFree = false;
        out.bpm = bpm; out.first = T0 * sr; out.epoch = T0 * sr; out.end = (T0 + c.secs) * sr;
        // the page's program for each thing it sent (a block's draws are all 0.5, as the bank's block voice was recorded)
        out.progs = []; out.n = sent.length;
        for (const m of sent) {
          window._nsBank.constRandom = m.kind === 'chord';
          const r = await window._nsBank.record(Object.assign({}, m, { at: m.at - 1e-6 / sr }));
          window._nsBank.constRandom = false;
          out.progs.push(r ? Array.from(r.prog) : null);
        }
        out.durs = sent.filter(m => m.kind === 'note').map(m => m.dur);
        out.blocks = sent.filter(m => m.kind === 'chord').length;
        return out;
      }, { c, voice });
      const progs = run.progs.filter(Boolean);
      const buf = [];
      buf.push(bank.bufs.length); bank.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(ch => ch.forEach(x => buf.push(x))); });
      buf.push(bank.entries.length); bank.entries.forEach(e => { buf.push(e.length); e.forEach(x => buf.push(x)); });
      buf.push(bank.kit, SR, run.bpm, run.first, run.epoch, run.end, c.draws ? run.tape.length : 0);
      if (c.draws) run.tape.forEach(x => buf.push(x));
      buf.push(run.chords.length); run.chords.forEach(ch => buf.push(run.epoch + ch.at * SR, ch.notes.length, ...ch.notes));
      run.score.forEach(x => buf.push(x));
      buf.push(progs.length); progs.forEach(p => { buf.push(p.length); p.forEach(x => buf.push(x)); });
      fs.writeFileSync(path.join(tmp, 'arpline.f64'), Buffer.from(Float64Array.from(buf).buffer));
      const r = spawnSync(bin, [path.join(tmp, 'arpline.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
      if (process.env.SCORE_DEBUG) console.log(r.stdout);
      const arp = r.stdout.split('\n').find(l => l.startsWith('ARP ')).split(' ').slice(1).map(Number);
      const worst = r.stdout.split('\n').find(l => l.startsWith('WORST ')).split(' ').slice(1).map(Number);
      const [depth, peak, events, voices, misses, refused, late] = arp;
      const shortest = run.durs.length ? Math.min(...run.durs) : 0;
      ok(progs.length === run.n && events === run.n && misses === 0 && refused === 0 && peak > 0.005 && depth >= PASS_DB,
         voice + ' / ' + c.name + ': ' + run.n + ' events (' + voices + ' voices' + (run.blocks ? ', ' + run.blocks + ' blocks' : ', shortest note ' + (shortest * 1000).toFixed(1) + ' ms') + '): ' + (depth >= 999 ? 'bit-identical' : depth.toFixed(1) + ' dB') + ', worst 100 ms ' + (worst[1] >= 999 ? 'bit-identical' : worst[1].toFixed(1) + ' dB'),
         JSON.stringify({ n: run.n, progs: progs.length, events, misses, refused, depth, peak, late }));
    }
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
