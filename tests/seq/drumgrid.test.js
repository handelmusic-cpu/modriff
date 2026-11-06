/* The native clock and drum grid (native/modsynth/seqcore.h, docs/native-scheduling.md slice 1) against the page's own
   scheduler.

   The real page runs window._sqScheduler on a fake clock I advance by hand, with window.modEngine stubbed to record the
   {kind:'hit'} messages it sends. The page's own export of the score (window._sqNativeScore) goes to
   native/modsynth/seqtool, which runs the C++ core for the same number of steps. The two EVENT LISTS are compared:

     deterministic cases   every event in order: part, kit, lane, velocity, accent, pitch, dyn exactly (the same doubles),
                           and the time to 1e-5 of a frame (the page counts seconds, the core frames); the whole-frame
                           time the host would start the voice on must match too, except where the unrounded time sits
                           within 1e-6 of a half frame, where either rounding is right and it is only counted;
                           and the bar lines (the page's _barAnnouncedT).
     random cases          probability and humanize differ from the page's by design (a native generator): the
                           statistics are compared instead (hit rates against the probability and against the page's,
                           the humanize timing and velocity spreads against the page's).

   Run: make -C native/modsynth seqtool && node tests/seq/drumgrid.test.js
   Env: CHROMIUM (default: Google Chrome on a Mac, /opt/pw-browsers/chromium elsewhere), PLAYWRIGHT (module path). */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const SR = 48000, FIRST = 1.0;
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

// A small seeded generator, so the same patterns are made every run.
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A busy grid: every feature the scheduler reads, in a spread no pattern a person made would have.
function busyGrid(seed, lanes, steps, o) {
  o = o || {}; const rnd = prng(seed), grid = {};
  for (let ti = 0; ti < lanes; ti++) {
    const row = [];
    for (let s = 0; s < steps; s++) {
      const c = { v: 0, r: 1, orn: 0, vel: 100 };
      if (rnd() < (o.density || 0.4)) {
        c.v = rnd() < 0.2 ? 2 : 1;
        if (rnd() < 0.3) c.vel = 20 + Math.floor(rnd() * 80);
        if (rnd() < 0.15) c.p = Math.floor(rnd() * 13) - 6;
        if (rnd() < 0.15) { c.r = 2 + Math.floor(rnd() * 3); if (rnd() < 0.6) c.rs = 1 + Math.floor(rnd() * 4); }
        if (rnd() < 0.15) c.orn = 1 + Math.floor(rnd() * 2);
        if (o.prob && rnd() < 0.5) c.pr = o.prob;
      }
      row.push(c);
    }
    grid[ti] = row;
  }
  return grid;
}
function laneSettings(seed, lanes) {
  const rnd = prng(seed), vols = {}, pitches = {};
  for (let ti = 0; ti < lanes; ti++) { vols[ti] = Math.round((0.3 + rnd() * 0.7) * 100) / 100; pitches[ti] = rnd() < 0.3 ? Math.floor(rnd() * 7) - 3 : 0; }
  return { vols, pitches };
}

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  // Put the page's drum sequencer in the state "playing" with its real context, then take the clock away from it.
  await page.evaluate(() => { document.dispatchEvent(new CustomEvent('sq-start-request')); });
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => window._sqPlaying()), 'the page\'s drum sequencer is running (so its scheduler has its bus)', '');

  const lanes808 = await page.evaluate(() => window._sqMachines()['808'].tracks.length);
  const lanesPerc = await page.evaluate(() => window._sqMachines()['PERC'].tracks.length);

  // ── The cases ──────────────────────────────────────────────────────────────────────────────────
  // swing8: 8ths or 16ths; meter: [beats, unit]; auxOn: the second layer; changes: tempo changes by step.
  const det = [];
  const mk = (name, o) => det.push(Object.assign({ name, bpm: 120, rate: 1, steps: 16, swing: 0, swing8: true, bars: 6, aux: true, tupCover: true, drums: true, kitOn: true, seed: 11, density: 0.4, meter: [4, 4] }, o));
  mk('plain 120, 16 steps');
  mk('swing 8ths 50', { swing: 50, seed: 12 });
  mk('swing 16ths 66', { swing: 66, swing8: false, seed: 13 });
  mk('odd tempo 93 swing 33', { bpm: 93, swing: 33, seed: 14 });
  mk('tempo 61 (non-integer frames a step)', { bpm: 61, seed: 15 });
  mk('rate x2', { rate: 2, seed: 16 });
  mk('rate x0.5, swing 40', { rate: 0.5, swing: 40, seed: 17 });
  mk('32 steps, 4/4', { steps: 32, seed: 18 });
  mk('64 steps, 4/4 (a bar line every 16)', { steps: 64, seed: 19, bars: 3 });
  mk('12 steps (not a whole bar)', { steps: 12, seed: 20 });
  mk('7/8 meter, 14 steps', { steps: 14, meter: [7, 8], seed: 21 });
  mk('6/8 compound, 12 steps, swing', { steps: 12, meter: [6, 8], swing: 50, seed: 22 });
  mk('tuplet cover off', { tupCover: false, density: 0.55, seed: 23 });
  mk('dense, many ratchets and tuplets', { density: 0.8, seed: 24 });
  mk('drums switch off (aux still plays)', { drums: false, seed: 25 });
  mk('kit layer off, aux only', { kitOn: false, seed: 26 });
  mk('aux layer off', { aux: false, seed: 27 });
  mk('tempo change 120 -> 87 after 21 steps', { changes: [[21, 87]], seed: 28 });
  mk('tempo change twice', { changes: [[10, 140], [47, 72]], seed: 29, bars: 8 });

  const stat = [];
  stat.push({ name: 'probability 30 and 75', kind: 'prob' });
  stat.push({ name: 'humanize 1.0 (time and velocity)', kind: 'human', amt: 1 });
  stat.push({ name: 'humanize 0.4', kind: 'human', amt: 0.4 });
  stat.push({ name: 'humanize drift only', kind: 'drift' });
  stat.push({ name: 'humanize off for the aux part', kind: 'humanoff' });

  const result = await page.evaluate(async ({ det, stat, lanes808, lanesPerc, grids }) => {
    const out = { det: [], stat: [] };
    const fake = { currentTime: 0, sampleRate: 48000, state: 'running' };
    clearTimeout(clockTimer);                                     // the page's own clock is not wanted any more
    const realCtx = getCtx, realAudio = audioCtx;
    const sent = [];
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = m => { if (m.kind === 'hit') sent.push(Object.assign({}, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => fake; audioCtx = fake;
    const LA = LOOK_AHEAD;

    function setup(c) {
      // The tempo is whatever the page's own #bpm field holds after it has had its say (it rounds to its step): read it back.
      document.getElementById('bpm').value = c.bpm; c.bpm = parseFloat(document.getElementById('bpm').value);
      sqRateMul = c.rate;
      METER.beats = c.meter[0]; METER.unit = c.meter[1];
      drumsEnabled = c.drums;
      window._sqSetTupCover(c.tupCover);
      window._sqRestoreState({ steps: c.steps, swing: c.swing, swing8: c.swing8, mach: '808', grid: c.grid, vols: c.vols, pitches: c.pitches,
        kitOn: c.kitOn, aux: { mach: 'PERC', grid: c.auxGrid, on: c.aux, vols: c.auxVols, pitches: c.auxPitches } });
      window._sqEnsureGrid();
      drumsEnabled = c.drums;
      const h = c.human || {};
      window.setHumanize(h.amt || 0); window.setHumanizeMix('time', h.time != null ? h.time : 1); window.setHumanizeMix('vel', h.vel != null ? h.vel : 1);
      window.setHumanizeMix('drift', h.drift != null ? h.drift : 0);
      ['drum', 'auxperc'].forEach(p => { if ((window._humanState().off.indexOf(p) >= 0) !== ((h.off || []).indexOf(p) >= 0)) window.toggleHumanPart(p); });
    }
    // Runs the page's scheduler on the fake clock until its horizon has passed `until` seconds.
    function runPage(c, tEnd) {
      sent.length = 0; const bars = [];
      // clockAlignTo returns the epoch itself while the epoch is still ahead of "now" + the lead: that pins the first step.
      fake.currentTime = -100;
      CLOCK_EPOCH = FIRSTs; CLOCK_EPOCH_BPM = c.bpm;
      window._sqResetStep(); window._sqResync(); window._barAnnouncedT = -1;
      fake.currentTime = 0.0013;
      let lastBar = -1; const changes = (c.changes || []).slice(), steps = []; let fired = 0, H = 0;
      const sd = () => 60 / parseFloat(document.getElementById('bpm').value) / 4 * c.rate;
      let nextT = FIRSTs;   // replicates sqNextT only to count steps for the tempo changes
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; H = fake.currentTime + LA; _schedHorizon = H;
        // steps that the scheduler is about to commit, counted the way it counts them
        const before = fired; while (nextT < H) { nextT += sd(); fired++; }
        window._sqScheduler(); _schedHorizon = null;
        if (window._barAnnouncedT !== lastBar) { lastBar = window._barAnnouncedT; bars.push(lastBar); }
        if (changes.length && fired >= changes[0][0]) {
          // The change lands once `after` steps have been committed. The page has committed `fired` of them by now, which
          // is the first call at which at least that many are; the native side is told the real count.
          document.getElementById('bpm').value = changes[0][1]; changes.shift();
          c.changeAt = c.changeAt || []; c.changeAt.push([fired, parseFloat(document.getElementById('bpm').value)]);   // sd() now reads the new tempo
        }
        if (nextT >= tEnd) break;
      }
      return { msgs: sent.slice(), bars, fired };
    }
    const FIRSTs = 1.0;

    for (const c of det) {
      const g = grids[c.name];
      Object.assign(c, g);
      setup(c);
      const tEnd = FIRSTs + c.bars * (c.meter[0] * 16 / c.meter[1]) * (60 / c.bpm / 4 * c.rate);   // bars of the meter, in seconds
      const r = runPage(c, tEnd);
      const exp = window._sqNativeScore();
      out.det.push({ name: c.name, msgs: r.msgs, bars: r.bars, fired: r.fired, score: exp.score, kits: exp.kits, changeAt: c.changeAt || [], bpm: c.bpm, rate: c.rate });
    }

    // Statistics: one long run each, with the page's Math.random.
    for (const c of stat) {
      const o = { name: c.name, kind: c.kind };
      const base = { bpm: 120, rate: 1, steps: 16, swing: 0, swing8: true, aux: true, tupCover: true, drums: true, kitOn: true, meter: [4, 4], human: null };
      Object.assign(base, grids[c.name]);
      if (c.kind === 'human') base.human = { amt: c.amt, time: 1, vel: 1, drift: 0 };
      if (c.kind === 'drift') base.human = { amt: 1, time: 0, vel: 0, drift: 1 };
      if (c.kind === 'humanoff') base.human = { amt: 1, time: 1, vel: 1, drift: 0, off: ['auxperc'] };
      setup(base);
      const r = runPage(base, FIRSTs + 2400 * 0.125);   // 2400 sixteenths at 120: 150 bars
      const exp = window._sqNativeScore();
      Object.assign(o, { msgs: r.msgs, fired: r.fired, score: exp.score, kits: exp.kits, human: base.human });
      out.stat.push(o);
    }
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { det: det.map(c => ({ name: c.name, bpm: c.bpm, rate: c.rate, steps: c.steps, swing: c.swing, swing8: c.swing8, bars: c.bars, aux: c.aux, tupCover: c.tupCover, drums: c.drums, kitOn: c.kitOn, meter: c.meter, changes: c.changes })),
       stat: stat.map(c => ({ name: c.name, kind: c.kind, amt: c.amt })), lanes808, lanesPerc,
       grids: (() => {
         const g = {};
         det.forEach(c => { const l = laneSettings(c.seed + 1000, lanes808), la = laneSettings(c.seed + 2000, lanesPerc);
           g[c.name] = { grid: busyGrid(c.seed, lanes808, c.steps, { density: c.density }), auxGrid: busyGrid(c.seed + 500, lanesPerc, c.steps, { density: c.density }), vols: l.vols, pitches: l.pitches, auxVols: la.vols, auxPitches: la.pitches }; });
         // The random cases: every cell a plain hit on two lanes, so rates are countable.
         const flat = (lanes, prob) => { const o = {}; for (let ti = 0; ti < lanes; ti++) o[ti] = Array.from({ length: 16 }, (_, s) => (ti < 2 ? { v: s % 4 === 3 ? 2 : 1, r: 1, orn: 0, vel: 100, pr: ti === 0 ? 30 : 75 } : { v: 0, r: 1, orn: 0, vel: 100 })); return o; };
         stat.forEach(c => { g[c.name] = { grid: flat(lanes808), auxGrid: flat(lanesPerc), vols: {}, pitches: {}, auxVols: {}, auxPitches: {} }; });
         // Humanize cases want every step to play, so no probability.
         stat.filter(c => c.kind !== 'prob').forEach(c => { for (const k of ['grid', 'auxGrid']) for (const ti in g[c.name][k]) g[c.name][k][ti].forEach(x => { if (x.v) x.pr = 0; }); });
         return g;
       })() });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  // ── Hand the scores to the C++ core ────────────────────────────────────────────────────────────
  const all = result.det.concat(result.stat);
  const buf = [all.length];
  all.forEach((c, i) => {
    const sd = c.kind ? 0.125 : 0;
    const nsteps = c.fired;
    buf.push(SR, c.bpm || 120, c.rate || 1, FIRST * SR, 1000 + i, nsteps);
    const ch = c.changeAt || [];
    buf.push(ch.length); ch.forEach(x => buf.push(x[0], x[1]));
    c.score.forEach(x => buf.push(x));
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumgrid-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const bin = path.join(root, 'native', 'modsynth', 'seqtool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth seqtool'); process.exit(2); }
  const run = spawnSync(bin, [path.join(tmp, 'cases.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const nat = [];
  for (const line of run.stdout.split('\n')) {
    const f = line.split(' ');
    if (f[0] === 'CASE') nat.push({ e: [], b: [] });
    else if (f[0] === 'E') { const n = nat[nat.length - 1]; n.e.push({ fx: +f[1], frame: +f[2], part: +f[3], kit: +f[4], lane: +f[5], vel: +f[6], accent: f[7] === '1', pitch: +f[8], dyn: +f[9], cg: +f[10], chokes: f[11] === '1', step: +f[12], bar: +f[13] }); }
    else if (f[0] === 'B') nat[nat.length - 1].b.push({ fx: +f[1], frame: +f[2], bar: +f[3] });
  }
  ok(nat.length === all.length, 'seqtool answered every case', nat.length + ' of ' + all.length);

  // ── Deterministic cases: the event lists, exactly ───────────────────────────────────────────────
  console.log('\nevent lists, page (window._sqScheduler on a fake clock) against the native core:');
  let totalEvents = 0;
  result.det.forEach((c, i) => {
    const n = nat[i];
    const pe = c.msgs.map(m => ({ part: m.part === 'auxperc' ? 1 : 0, kit: c.kits.indexOf(m.kit), lane: m.lane, vel: m.vel, accent: m.accent, pitch: m.pitch, dyn: m.dyn, at: m.at }));
    totalEvents += pe.length;
    let bad = '', maxT = 0, ties = 0, frameMiss = 0;
    if (pe.length !== n.e.length) bad = 'counts differ: page ' + pe.length + ', native ' + n.e.length;
    for (let k = 0; !bad && k < pe.length; k++) {
      const a = pe[k], b = n.e[k];
      const dT = Math.abs(a.at * SR - b.fx); maxT = Math.max(maxT, dT);
      if (a.part !== b.part || a.kit !== b.kit || a.lane !== b.lane || a.vel !== b.vel || a.accent !== b.accent || a.pitch !== b.pitch || a.dyn !== b.dyn) {
        bad = 'event ' + k + ' differs: page ' + JSON.stringify(a) + ' native ' + JSON.stringify(b); break;
      }
      if (dT > 1e-5) { bad = 'event ' + k + ' time differs by ' + dT + ' frames: page ' + (a.at * SR) + ' native ' + b.fx; break; }
      if (Math.round(a.at * SR) !== b.frame) { const fr = Math.abs(((a.at * SR) % 1) - 0.5); if (fr < 1e-6) ties++; else { frameMiss++; bad = 'event ' + k + ' frame ' + Math.round(a.at * SR) + ' vs ' + b.frame; break; } }
    }
    // The page announces the bar line a step ahead of itself and the first call is at bar 1 (the pattern's first wrap);
    // the native core numbers the same lines. Compare the times.
    const pb = c.bars.filter(t => t > 0), nb = n.b.map(x => x.fx);
    let barBad = '';
    const common = Math.min(pb.length, nb.length);
    for (let k = 0; k < common && !barBad; k++) if (Math.abs(pb[k] * SR - nb[k]) > 1e-5) barBad = 'bar ' + k + ': page ' + pb[k] * SR + ' native ' + nb[k];
    if (!barBad && Math.abs(pb.length - nb.length) > 1) barBad = 'bar counts ' + pb.length + ' vs ' + nb.length;
    ok(!bad && !barBad, c.name + ': ' + pe.length + ' events, ' + common + ' bar lines, max time error ' + maxT.toExponential(1) + ' frames' + (ties ? ', ' + ties + ' half-frame ties' : ''), bad || barBad);
  });
  console.log('       ' + totalEvents + ' events compared in all.');
  ok(totalEvents > 3000, 'enough events to mean something', totalEvents);

  // ── Random cases: statistics ───────────────────────────────────────────────────────────────────
  console.log('\nrandomised features, page against native (a different generator, so statistics):');
  const stats = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return { n: a.length, mean: m, sd: Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length), min: Math.min(...a), max: Math.max(...a) }; };
  result.stat.forEach((c, j) => {
    const n = nat[result.det.length + j];
    const pm = c.msgs.filter(m => m.part === 'drum');
    if (c.kind === 'prob') {
      const rate = (evs, lane) => evs.filter(e => e.lane === lane).length;
      // lane 0 has probability 30 on every step of a 16-step pattern, lane 1 75; steps fired / 16 patterns.
      const patterns = c.fired / 16;
      const exp = [0.30 * 16 * patterns, 0.75 * 16 * patterns];
      const sigma = exp.map((e, k) => Math.sqrt(16 * patterns * (k ? 0.75 * 0.25 : 0.30 * 0.70)));
      const drumN = n.e.filter(e => e.part === 0);
      [0, 1].forEach(k => {
        const pc = rate(pm, k), nc = rate(drumN, k);
        ok(Math.abs(pc - exp[k]) < 4 * sigma[k] && Math.abs(nc - exp[k]) < 4 * sigma[k], 'probability ' + (k ? 75 : 30) + ': expected ' + exp[k].toFixed(0) + ', page ' + pc + ', native ' + nc + ' (4 sigma = ' + (4 * sigma[k]).toFixed(0) + ')', '');
      });
    } else {
      // Offset of each hit from its step's own time (steps are 0.125 s at 120 BPM; the swing is 0), and velocity relative to the cell.
      const off = ev => ev.map(e => e.fx - Math.round((e.fx - FIRST * SR) / 6000) * 6000 - FIRST * SR);
      const pOff = pm.map(m => m.at * SR - Math.round((m.at * SR - FIRST * SR) / 6000) * 6000 - FIRST * SR);
      const dN = n.e.filter(e => e.part === 0), nOff = off(dN);
      const pV = pm.filter(m => !m.accent).map(m => m.vel / 0.8), nV = dN.filter(e => !e.accent).map(e => e.vel / 0.8);
      const pA = pm.filter(m => m.accent).map(m => m.vel / 0.8), nA = dN.filter(e => e.accent).map(e => e.vel / 0.8);
      const sp = stats(pOff), sn = stats(nOff), vp = stats(pV), vn = stats(nV), ap = stats(pA), an = stats(nA);
      const fmt = s => 'n ' + s.n + ' mean ' + s.mean.toFixed(3) + ' sd ' + s.sd.toFixed(3) + ' [' + s.min.toFixed(3) + ', ' + s.max.toFixed(3) + ']';
      if (c.kind === 'human') {
        const amt = c.human.amt, span = 14 / 1000 * amt * SR;   // frames, full spread on an off-beat; half on a downbeat
        console.log('       ' + c.name + '\n         timing (frames from the step): page ' + fmt(sp) + '\n                                        native ' + fmt(sn) + '\n         velocity (plain hits):         page ' + fmt(vp) + '\n                                        native ' + fmt(vn) + '\n         velocity (accents):            page ' + fmt(ap) + '\n                                        native ' + fmt(an));
        ok(sn.max <= span * 1.0001 && sn.min >= -span * 1.0001 && sp.max <= span * 1.0001 && sp.min >= -span * 1.0001, 'humanize ' + amt + ': timing inside +/- ' + span.toFixed(0) + ' frames on both', '');
        ok(Math.abs(sn.sd - sp.sd) < 0.08 * sp.sd && Math.abs(sn.mean - sp.mean) < 0.1 * sp.sd + 5, 'humanize ' + amt + ': timing spread matches the page (sd ' + sn.sd.toFixed(1) + ' vs ' + sp.sd.toFixed(1) + ')', '');
        ok(vn.min >= 0.35 - 1e-9 && vn.max <= 1 + 1e-9 && Math.abs(vn.mean - vp.mean) < 0.01 && Math.abs(vn.sd - vp.sd) < 0.01 && Math.abs(vn.min - vp.min) < 0.02, 'humanize ' + amt + ': velocity spread matches the page (mean ' + vn.mean.toFixed(3) + ' vs ' + vp.mean.toFixed(3) + ')', '');
        ok(Math.abs(an.mean - ap.mean) < 0.01 && Math.abs(an.min - ap.min) < 0.02, 'humanize ' + amt + ': accents are humanized less, as on the page (mean ' + an.mean.toFixed(3) + ' vs ' + ap.mean.toFixed(3) + ')', '');
      } else if (c.kind === 'drift') {
        // Time offsets here are the slow drift alone: one value per step, the page's from its fake audio clock (the scheduling
        // moment) and the native core's from the step's own time. They differ by the look-ahead's worth of a 10 s sine.
        const maxD = Math.max(...pm.map(m => nearestNative(m.at * SR, dN)));
        console.log('       drift only: largest gap between a page hit and the native hit at the same step ' + maxD.toFixed(1) + ' frames (' + (maxD / SR * 1000).toFixed(2) + ' ms); drift range page ' + fmt(sp) + ', native ' + fmt(sn));
        ok(sn.max < 18 / 1000 * SR && sn.min > -18 / 1000 * SR && Math.abs(sn.mean - sp.mean) < 0.2 * 18 / 1000 * SR, 'drift stays inside +/- 18 ms and is centred like the page\'s', '');
        ok(maxD < 0.004 * SR, 'drift differs from the page by under 4 ms (the look-ahead\'s worth of a slow sine)', maxD);
      } else if (c.kind === 'humanoff') {
        const aN = n.e.filter(e => e.part === 1), aP = c.msgs.filter(m => m.part === 'auxperc');
        const offA = ev => ev.map(e => e.fx - Math.round((e.fx - FIRST * SR) / 6000) * 6000 - FIRST * SR);
        const pa = aP.map(m => m.at * SR - Math.round((m.at * SR - FIRST * SR) / 6000) * 6000 - FIRST * SR);
        ok(aP.length > 0 && aN.length > 0 && pa.every(x => Math.abs(x) < 1e-6) && offA(aN).every(x => Math.abs(x) < 1e-6), 'humanize off for the aux part: its hits stay exactly on the grid on both (' + aP.length + ' page, ' + aN.length + ' native)', '');
        ok(sn.sd > 100 && sp.sd > 100, 'while the kit part stays humanized (sd ' + sn.sd.toFixed(0) + ' native, ' + sp.sd.toFixed(0) + ' page frames)', '');
      }
    }
  });
  function nearestNative(x, list) { let best = 1e18; for (const e of list) { const d = Math.abs(e.fx - x); if (d < best) best = d; } return best; }

  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
