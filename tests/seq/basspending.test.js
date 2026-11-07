/* Lines written ahead in the native bass line (native/modsynth/basscore.h BassPending, docs/native-scheduling.md slice 2) against the page's own scheduler.

   With Follow off and Sync on the page writes each chord's bass line while the chord before it sounds (_blPregen) and holds it for the chord's first
   step (_blPendingAt); a plain regenerate while the pattern plays (blGenerate) is held for the top of the loop; _blLand puts a waiting line in at
   once. The generator and its dice stay the page's: it hands the engine the line (window._blNativePending) with the moment it takes over, and the engine
   swaps it in -- at that moment (the first step at or after it, within 2 ms), or at the wrap of the loop, unless the moment is still ahead of the clock.
   The page's scheduler runs in the real page on a clock of its own, called once per tick, with these events happening between ticks; native/modsynth/basstool
   runs the same ticks, each carrying the score and pending line the page would send at that moment. The note lists must be the same, note for note
   (time to 1e-5 of a frame, pitch, length, level, accent, slide, glide source), and the line must actually have changed during the run.

   Run: make -C native/modsynth basstool && node tests/seq/basspending.test.js        Env: CHROMIUM, PLAYWRIGHT */
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
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

const SONGS = {
  'six-beat chords (changes fall mid-bar)': [[0, [0, 4, 7], null, 6], [9, [0, 3, 7], null, 6], [5, [0, 4, 7], null, 6], [7, [0, 4, 7, 10], null, 6]],
  'changes every bar and a half, a rest': [[2, [0, 3, 7, 10], null, 6], [7, [0, 4, 7, 10], 11, 6], [0, [0, 4, 7], null, 3, true], [9, [0, 3, 7, 10], null, 6]],
};
// events: at (s): when the page does it; kind pregen (chord k, optionally an explicit moment `to`), generate, land
const CONFIGS = [
  { name: 'Follow off: a line written a chord ahead takes over at each chord start (mid-bar)', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 2.5, kind: 'pregen', k: 1 }, { at: 5.5, kind: 'pregen', k: 2 }, { at: 8.5, kind: 'pregen', k: 3 }] },
  { name: 'Follow off: a plain regenerate while it plays waits for the top of the loop', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 2.2, kind: 'generate' }, { at: 4.1, kind: 'generate' }, { at: 9.4, kind: 'generate' }] },
  { name: 'Follow off: a plain regenerate replaces the line held for a chord (and its moment)', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 2.5, kind: 'pregen', k: 1 }, { at: 3.2, kind: 'generate' }] },
  { name: 'Follow on: a regenerate while it plays, waiting for the loop, remapped onto the chart', song: 'six-beat chords (changes fall mid-bar)', bpm: 110, rate: 1, bars: 8, follow: true,
    events: [{ at: 2.2, kind: 'generate' }, { at: 6.3, kind: 'generate' }] },
  { name: 'Follow off: a moment already behind the clock lands at once', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 4.5, kind: 'pregen', k: 1, to: 4.0 }] },
  { name: 'Follow off: _blLand puts a waiting line in at once', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 2.5, kind: 'pregen', k: 1 }, { at: 3.05, kind: 'land' }, { at: 5.5, kind: 'pregen', k: 2 }] },
  { name: 'Follow off: a line written far ahead is held through the wraps until its chord', song: 'six-beat chords (changes fall mid-bar)', bpm: 120, rate: 1, bars: 8, follow: false,
    events: [{ at: 2.0, kind: 'pregen', k: 3 }] },
  { name: 'Follow off: 12 steps, rate 2, swing, slash chords and a rest', song: 'changes every bar and a half, a rest', bpm: 100, rate: 2, bars: 14, follow: false, steps: 12, swing: 40,
    events: [{ at: 1.9, kind: 'pregen', k: 1 }, { at: 3.6, kind: 'generate' }, { at: 5.5, kind: 'pregen', k: 3 }, { at: 7.7, kind: 'pregen', k: 4 }] },
];

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const result = await page.evaluate(async ({ configs, SONGS }) => {
    const sr = 48000, out = [];
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx, realNB = window._sqNextBar;
    const sent = [];
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    E.send = m => { if (m.kind === 'note' && m.part === 'bass') sent.push(Object.assign({}, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    const LA = LOOK_AHEAD, FIRSTs = 1.0;
    const steps = c => c.steps || 16;
    for (const c of configs) {
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      blRateMul = c.rate; window.setHumanize(0);
      window._sqSetSwing(c.swing || 0); window._sqSetSwing8(true);
      root = 0; mode = 'major';
      const grid = Array.from({ length: steps(c) }, (_, i) => ({ note: i % 12, oct: 2, len: 1, slide: i % 5 === 1, accent: i % 4 === 0, v: i % 3 === 0 || i % 5 === 1 ? 1 : 0, usr: 0 }));
      window._blRestoreState({ steps: steps(c), grid, follow: c.follow, genStyle: 'funk', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      PHRASE_LOCKS.bass = {};
      const sd = 60 / bpm / 4 * c.rate, beat = sd * 4, tEnd = FIRSTs + c.bars * steps(c) * sd;
      window._sqNextBar = () => null;
      const song = SONGS[c.song], slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      fake.currentTime = 0.0013;
      window._blClearChords();
      const plan = []; { let t = FIRSTs, i = 0; while (t < tEnd + 6) { const dur = song[i % song.length][3] * beat; plan.push({ t, dur, i }); t += dur; i++; } }
      plan.forEach(p => window._blOnChord(slot(p.i), p.t, p.dur, slot(p.i + 1), 0));
      sent.length = 0;
      window._blSetClock(FIRSTs, 0, true);
      const ticks = [], evs = c.events.map(e => Object.assign({ done: false }, e));
      let prevScore = null, changes = 0;
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        // what the player or the song does between two ticks: the page writes a line, and tells the engine
        let sc = null, pend = null;
        evs.forEach(e => {
          if (e.done || fake.currentTime < e.at) return;
          e.done = true;
          if (e.kind === 'pregen') { const s = song[e.k % song.length]; window._blPregen(s[0], s[1], e.to != null ? e.to : plan[e.k].t); }
          else if (e.kind === 'generate') window.blGenerate();
          else if (e.kind === 'land') window._blLand();
          sc = window._blNativeScore().score; pend = window._blNativePending(sr); changes++;
        });
        const nb = window._sqNextBar();
        ticks.push([fake.currentTime * sr, _schedHorizon * sr, nb ? nb.t * sr : -1].concat(window._blNativeChords(sr), [sc ? sc.length : 0], sc || [], [pend ? pend.length : 0], pend || []));
        window._blScheduler();
        _schedHorizon = null;
        if (fake.currentTime + LA >= tEnd) break;
      }
      window._blSetClock(0, 0, false);
      // the first score the engine starts from is the one the page had before any event: rebuilt from the same restore
      window._blRestoreState({ steps: steps(c), grid, follow: c.follow, genStyle: 'funk', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      const sc0 = window._blNativeScore();
      out.push({ name: c.name, notes: sent.map(m => ({ at: m.at, note: m.note, dur: m.dur, vel: m.vel, accent: m.accent, slide: m.slide, from: m.from })), tEnd, ticks, tape: [],
                 score: sc0.score, ok: sc0.ok, why: sc0.why, chords: window._blNativeChords(sr), bpm, rate: c.rate, events: changes, distinct: new Set(sent.map(m => m.note + ':' + Math.round(m.at * 1000) % 2000)).size });
    }
    window._sqNextBar = realNB;
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { configs: CONFIGS, SONGS });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pend-'));
  const run = c => {
    const cases = [1, SR, c.bpm, c.rate, 1.0 * SR, 5, 0, c.ticks.length, 0].concat(...c.ticks, c.score, c.chords);
    fs.writeFileSync(path.join(tmp, 'pend.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const bin = path.join(root, 'native', 'modsynth', 'basstool');
    if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth basstool'); process.exit(2); }
    const r = spawnSync(bin, [path.join(tmp, 'pend.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    return r.stdout.split('\n').filter(l => l.startsWith('N ')).map(l => { const f = l.split(' '); return { fx: +f[1], frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, slide: +f[7] === 1, from: +f[8] }; });
  };
  console.log('\nlines written ahead, the engine against the page, note for note:');
  result.forEach(c => {
    const pg = c.notes, nat = run(c);
    let same = nat.length === pg.length, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      const pf = p.from == null ? -1 : p.from;
      if (dt > 1e-5) { same = false; why = `note ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (p.note !== n.midi) { same = false; why = `note ${k}: midi ${p.note} on the page, ${n.midi} native (frame ${n.frame})`; }
      else if (Math.abs(p.dur * SR - n.dur) > 1e-5) { same = false; why = `note ${k}: length ${p.dur * SR} frames on the page, ${n.dur} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `note ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if (!!p.accent !== n.accent || !!p.slide !== n.slide || pf !== n.from) { same = false; why = `note ${k}: accent/slide/from differ (${p.accent}/${p.slide}/${pf} page, ${n.accent}/${n.slide}/${n.from} native)`; }
    }
    ok(same && pg.length > 20 && c.ok && c.events > 0, c.name + ': ' + pg.length + ' notes identical (worst timing ' + worstT.toExponential(1) + ' frames, ' + c.events + ' events)', why + ' ' + (c.why || []).join(','));
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
