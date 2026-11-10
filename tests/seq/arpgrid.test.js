/* The native arpeggiator (native/modsynth/arpcore.h, docs/native-scheduling.md, slice 3) against the page's own: scheduleArp with nextArpNote, scheduleArpNote and scheduleArpBlock,
   run for real in the page on a clock of our own, everything it sends the sound engine (a 'note' or a 'chord' message for the part 'arp') kept.

   The page's settings are set (pattern, rate, octaves, gate pattern, velocity shape, gate, decay, swing, rate motion, humanize), the chord is loaded with setArpChord (and changed
   mid-run: the pattern starts again), and the scheduler is run to a horizon we choose between the chord changes. window._arpNativeScore() writes the same settings for the engine,
   and native/modsynth/arptool runs its arpeggiator on them. The two lists of events must be the same: when each is struck (to 1e-5 of a frame), which tone or which block, how
   long, how hard (the step's accent with the humanize), its place in the pattern's dynamic shape and its pan.

   The patterns that draw (Random, Weighted, Walk) and the humanize draw from Math.random in the page and a native generator in the engine (the owner accepted that). For this test
   the engine is handed the page's own draws, in order, as a tape: the lists are then the same note for note, and the order of the draws is held too.

   Run: make -C native/modsynth arptool && node tests/seq/arpgrid.test.js        Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (process.env.INDEX && q.url.split('?')[0] === '/index.html') p = process.env.INDEX;
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
const C = [{ at: 0, root: 60, ivs: [0, 4, 7] }];
const CH = [{ at: 0, root: 60, ivs: [0, 4, 7] }, { at: 3.1, root: 65, ivs: [0, 3, 7, 10] }, { at: 6.7, root: 55, ivs: [0, 4, 7, 11, 14] }, { at: 9.2, root: 62, ivs: [0, 3, 7] }];
// rate: an index into ARP_RATES (11 = 1/16, 8 = 1/8, 10 = 1/12, 5 = 1/4, 6 = 1/8., 13 = 1/32)
const CASES = [
  { name: 'Up, sixteenths, three tones', pat: 'up', rate: 11, chords: C, secs: 6 },
  { name: 'Down, eighth triplets, gate 0.8', pat: 'down', rate: 10, gate: 0.8, chords: C, secs: 6 },
  { name: 'Bounce over two octaves, a Hill dynamic', pat: 'bounce', octs: 2, rate: 11, shape: 'hill', chords: C, secs: 6 },
  { name: 'Up/down ("ud") over three octaves, a Valley', pat: 'ud', octs: 3, rate: 8, shape: 'valley', chords: C, secs: 6 },
  { name: 'Pedal over two octaves with the Swing gate pattern', pat: 'pedal', octs: 2, rate: 11, gatePat: 1, chords: CH, secs: 12 },
  { name: 'Up with the Skip and the Accent gate patterns, Cresc and Decrsc', pat: 'up', rate: 11, gatePat: 2, shape: 'cresc', chords: CH, secs: 12 },
  { name: 'Up with the Accent gate pattern, Decrsc', pat: 'up', rate: 8, gatePat: 3, shape: 'decrsc', chords: CH, secs: 12 },
  { name: 'Block on quarters (the chord struck whole)', pat: 'block', rate: 5, chords: CH, secs: 12 },
  { name: 'Block on sixteenths, the Skip gate pattern', pat: 'block', rate: 11, gatePat: 2, chords: CH, secs: 8 },
  { name: 'Up with the Feel swinging the eighths (45%) at 1/8', pat: 'up', rate: 8, swing: 45, chords: CH, secs: 12 },
  { name: 'Up with the Feel swinging the sixteenths (40%) at 1/16', pat: 'up', rate: 11, swing: 40, swing8: false, chords: CH, secs: 12 },
  { name: 'Up at 1/16 with the Feel swinging the eighths: the odd sixteenths stay straight', pat: 'up', rate: 11, swing: 50, chords: CH, secs: 8 },
  { name: 'Eighth triplets (1/12) with the Feel swinging: a triplet is not swung', pat: 'up', rate: 10, swing: 50, chords: C, secs: 6 },
  { name: 'The arp started half a sixteenth off the lattice, the Feel swinging: nothing on a step off the grid is swung', pat: 'up', rate: 11, swing: 50, firstOff: 0.5, chords: C, secs: 6 },
  { name: 'Triplets and dotted rates are not swung', pat: 'up', rate: 6, swing: 50, chords: C, secs: 6 },
  { name: 'Accelerate: 1/8 then 1/16 then 1/32, a rung two beats', pat: 'up', rate: 8, motion: 'up', motionN: 3, motionHold: 2, chords: CH, secs: 12 },
  { name: 'Accelerate from a dotted eighth: a step that would run over the rung ends on its beat', pat: 'up', rate: 6, motion: 'up', motionN: 3, motionHold: 2, chords: C, secs: 10 },
  { name: 'Decelerate from 1/32', pat: 'bounce', rate: 13, motion: 'down', motionN: 3, motionHold: 2, chords: C, secs: 8 },
  { name: 'Swell: up the ladder and back, a rung of one beat, with swing', pat: 'up', rate: 8, motion: 'swell', motionN: 4, motionHold: 1, swing: 30, chords: CH, secs: 12 },
  { name: 'Free timing at 130 ms', pat: 'up', free: true, freeMs: 130, gatePat: 2, chords: CH, secs: 8 },
  { name: 'Random', pat: 'rand', rate: 11, chords: CH, secs: 10, draws: true },
  { name: 'Weighted', pat: 'weighted', octs: 2, rate: 11, chords: CH, secs: 10, draws: true },
  { name: 'Walk', pat: 'walk', octs: 2, rate: 11, chords: CH, secs: 10, draws: true },
  { name: 'Up with humanize on (time and velocity), Accent gate pattern', pat: 'up', rate: 11, gatePat: 3, human: 1, chords: CH, secs: 10, draws: true },
  { name: 'Random with humanize and rate motion at 87 BPM', pat: 'rand', rate: 8, human: 0.6, motion: 'up', motionN: 3, motionHold: 2, bpm: 87, chords: CH, secs: 12, draws: true },
  { name: 'Walk with humanize, the arp switched out of it (Settings > Humanize): no draws for the feel', pat: 'walk', rate: 11, human: 1, humanOffArp: true, chords: CH, secs: 6, draws: true },
  { name: 'Up with the Accent gate pattern and a rest in the song (the page starts the pattern again; the chord stays)', pat: 'up', octs: 2, rate: 11, gatePat: 3, shape: 'cresc', chords: [{ at: 0, root: 60, ivs: [0, 4, 7] }, { at: 2.37, rest: true }, { at: 4.1, root: 65, ivs: [0, 3, 7, 10] }, { at: 5.3, rest: true }], secs: 8 },
  { name: 'Bounce with a rest (its direction starts again going up)', pat: 'bounce', octs: 2, rate: 8, chords: [{ at: 0, root: 60, ivs: [0, 4, 7] }, { at: 1.9, rest: true }, { at: 3.3, rest: true }], secs: 6 },
  { name: 'Up at 97 BPM, gate 0.3, decay 0.03 (the Decay caps the note)', pat: 'up', rate: 11, gate: 0.9, decay: 0.03, bpm: 97, chords: CH, secs: 8 },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);
  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arpgrid-'));
  const bin = process.env.ARPTOOL || path.join(root, 'native', 'modsynth', 'arptool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth arptool'); process.exit(2); }

  for (const c of CASES) {
    const run = await page.evaluate(({ c }) => {
      const sr = 48000, fake = { currentTime: 0, sampleRate: sr, state: 'running' };
      const off = new OfflineAudioContext(2, sr, sr);
      const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
      clearTimeout(clockTimer);
      const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realSetTimeout = window.setTimeout, realRandom = Math.random;
      const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready }, sent = [];
      E.send = m => { if (m && m.part === 'arp') sent.push(m); }; E.now = () => fake.currentTime; E.ready = () => true;
      window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
      window.setTimeout = (fn, ms) => 0;                // the readout under the arp
      window._sqPlaying = () => true;
      const bpm = c.bpm || 120; document.getElementById('bpm').value = bpm;
      const T0 = 1.0; CLOCK_EPOCH = T0; fake.currentTime = 0.5;
      arpOn = true; arpPat = c.pat; arpOcts = c.octs || 1; arpRateIdx = c.rate == null ? 11 : c.rate; arpFree = !!c.free; arpFreeMs = c.freeMs || 150; arpGatePat = c.gatePat || 0; arpVelShape = c.shape || 'flat';
      arpMotion = c.motion || 'off'; arpMotionN = c.motionN || 3; arpMotionHold = c.motionHold || 2;
      document.getElementById('arp-gate').value = c.gate == null ? 0.5 : c.gate; document.getElementById('decay').value = c.decay == null ? 2 : c.decay;
      window._sqSetSwing(c.swing || 0); window._sqSetSwing8(c.swing8 !== false);
      window.setHumanize(c.human || 0); window.setHumanizeMix('drift', 0); window.setHumanizeMix('time', 1); window.setHumanizeMix('vel', 1);
      const isOff = () => window._humanState().off.indexOf('arp') >= 0;
      if (isOff()) window.toggleHumanPart('arp');
      if (c.humanOffArp) window.toggleHumanPart('arp');
      const out = { chords: [], tape: [] };
      // a rest is the page's own: _playChartSlot2 on a rest slot stops the chord and starts the arp's pattern again, and leaves arpNotes as they were
      const setChord = ch => {
        if (ch.rest) { sections = [{ name: 'R', slots: [{ rootM: 0, ivs: [0], isRest: true, label: 'x' }] }]; _playChartSlot2(0, 0, T0 + ch.at); out.chords.push({ at: ch.at, rest: true }); }
        else { setArpChord(ch.root, ch.ivs.slice()); out.chords.push({ at: ch.at, notes: arpNotes.slice() }); }
      };
      arpNextBeat = T0 + (c.firstOff || 0) * (60 / bpm / 4);
      setChord(c.chords[0]);
      const horizon = h => { _schedHorizon = T0 + h; };
      // the draws the arp makes are kept, in order, to be handed to the engine
      const run = () => { Math.random = function () { const v = realRandom(); out.tape.push(v); return v; }; try { scheduleArp(); } finally { Math.random = realRandom; } };
      for (let i = 1; i < c.chords.length; i++) { horizon(c.chords[i].at); run(); arpNextBeat = arpNextBeat; setChord(c.chords[i]); }
      horizon(c.secs); run();
      _schedHorizon = null;
      out.score = window._arpNativeScore().score;           // the settings as they stood for the run
      window.setTimeout = realSetTimeout; window._sqPlaying = realSq; window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
      window.setHumanize(0); if (isOff()) window.toggleHumanPart('arp'); window._sqSetSwing(0); window._sqSetSwing8(true); arpOn = false; arpSounding = false; arpMotion = 'off'; arpFree = false;
      out.sent = sent; out.bpm = bpm; out.first = (T0 + (c.firstOff || 0) * (60 / bpm / 4)) * sr; out.epoch = T0 * sr; out.end = (T0 + c.secs) * sr;
      return out;
    }, { c });

    const buf = [1, SR, run.bpm, run.first, run.epoch, run.end, c.draws ? run.tape.length : 0].concat(c.draws ? run.tape : [], [run.chords.length]);
    run.chords.forEach(ch => buf.push(run.epoch + ch.at * SR, ch.rest ? -1 : ch.notes.length, ...(ch.rest ? [] : ch.notes)));
    fs.writeFileSync(path.join(tmp, 'arp.f64'), Buffer.from(Float64Array.from(buf.concat(run.score)).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'arp.f64')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { console.error(c.name + ': ' + r.stderr); process.exit(2); }
    const nat = [];
    r.stdout.split('\n').forEach(l => {
      const f = l.split(' ');
      if (l.startsWith('N ')) nat.push({ frame: +f[1], midi: +f[2], dur: +f[3], vel: +f[4], level: +f[5], pan: +f[6] });
      else if (l.startsWith('B ')) { const n = +f[3]; nat.push({ frame: +f[1], block: true, dur: +f[2], notes: f.slice(4, 4 + n).map(Number) }); }
    });
    const pg = run.sent;
    let bad = null, worstT = 0;
    if (nat.length !== pg.length) bad = `${pg.length} events on the page, ${nat.length} native`;
    for (let k = 0; k < pg.length && !bad; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.frame);
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) bad = `event ${k}: at ${p.at * SR} on the page, ${n.frame} native`;
      else if (p.kind === 'chord') {
        if (!n.block) bad = `event ${k}: a block on the page, a note native`;
        else if (p.notes.join() !== n.notes.join()) bad = `event ${k}: block ${p.notes.join()} on the page, ${n.notes.join()} native`;
        else if (Math.abs(p.dur - n.dur) > 1e-9) bad = `event ${k}: block of ${p.dur} s on the page, ${n.dur} native`;
      } else {
        if (n.block) bad = `event ${k}: a note on the page, a block native`;
        else if (p.note !== n.midi) bad = `event ${k}: tone ${p.note} on the page, ${n.midi} native`;
        else if (Math.abs(p.dur - n.dur) > 1e-9) bad = `event ${k}: ${p.dur} s on the page, ${n.dur} native`;
        else if (Math.abs(p.vel - n.vel) > 1e-12 || Math.abs(p.level - n.level) > 1e-12) bad = `event ${k}: vel ${p.vel} level ${p.level} on the page, ${n.vel}, ${n.level} native`;
        else if (p.pan !== n.pan) bad = `event ${k}: pan ${p.pan} on the page, ${n.pan} native`;
      }
    }
    ok(!bad && pg.length > 8, c.name + ': ' + pg.length + ' events identical (worst timing ' + worstT.toExponential(1) + ' frames' + (c.draws ? ', ' + run.tape.length + ' draws' : '') + ')', bad || '');
  }
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
