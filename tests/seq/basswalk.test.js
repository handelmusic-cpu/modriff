/* The native walking line (native/modsynth/basscore.h, docs/native-scheduling.md slice 2) against the page's own scheduler.

   Jazz style with Follow on makes window._blScheduler walk: a quarter note a beat on the chord windows' own clock, re-anchored to each new
   chord's downbeat and snapped up onto the drums' bar line while they run, a half note on beats 1 and 3 in the two-feel, each note picked
   by _blWalkNote (beat 1 the chord's root, the beat before a change leading into the next root, the beats between stepping through chord
   and scale tones). The page's scheduler runs in the real page on a clock of its own, called once per tick as the page's clock calls it
   (what the walk does depends on WHEN: it skips a beat whose moment passed while it waited for its chord), with the chord windows a song
   would have committed, and every note it sends is kept, with every Math.random it drew inside the scheduler.
   native/modsynth/basstool runs the same score, windows and ticks, with the page's draws as the walk's random tape. The two lists must be
   the same, note for note: when (to 1e-5 of a frame), which note, how long, how loud, accent.

   And without the tape, with the engine's own generator: the walk's timing, length, level and accent are the same still (they do not depend
   on a draw), the downbeat notes are the chord's root in another octave at most, and every note is inside the walk's range.

   Run: make -C native/modsynth basstool && node tests/seq/basswalk.test.js        Env: CHROMIUM, PLAYWRIGHT */
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
  'I-vi-IV-V': [[0, [0, 4, 7], null, 4], [9, [0, 3, 7], null, 4], [5, [0, 4, 7], null, 4], [7, [0, 4, 7, 10], null, 4]],
  'ii-V-I with slash chords and a rest': [[2, [0, 3, 7, 10], null, 4], [7, [0, 4, 7, 10], 11, 4], [0, [0, 4, 7, 11], null, 2], [0, [0, 4, 7], null, 2, true], [9, [0, 3, 7, 10], null, 4]],
  'changes every beat or two': [[0, [0, 4, 7], null, 1], [3, [0, 3, 7], null, 2], [5, [0, 4, 7], null, 1], [10, [0, 4, 7, 10], null, 3], [7, [0, 4, 7], null, 5]],
  'odd lengths': [[0, [0, 4, 7], null, 3], [5, [0, 4, 7, 10], null, 5], [7, [0, 4, 7], 2, 7]],
  'chords that start a little after a beat': [[0, [0, 4, 7], null, 3.1], [5, [0, 4, 7, 10], null, 2.9], [7, [0, 4, 7], null, 4.2], [9, [0, 3, 7], null, 3.35]],
};
const CONFIGS = [
  { name: 'live hand chords just after beats, no drums', song: 'chords that start a little after a beat', bpm: 120, rate: 1, bars: 8, drums: null, two: false, root: 0, mode: 'major', commitAhead: 0, live: true },
  { name: 'live slash chords with the drums, two-feel', song: 'odd lengths', bpm: 110, rate: 1, bars: 8, drums: 1, two: true, root: 0, mode: 'major', commitAhead: 0, live: true },
  { name: 'four to the bar over I-vi-IV-V, no drums', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 8, drums: null, two: false, root: 0, mode: 'major' },
  { name: 'the same with the drums playing (their bar line three steps off the chart)', song: 'I-vi-IV-V', bpm: 100, rate: 1, bars: 8, drums: 3, two: false, root: 0, mode: 'major' },
  { name: 'two-feel over ii-V-I with slash chords and a rest', song: 'ii-V-I with slash chords and a rest', bpm: 140, rate: 1, bars: 10, drums: null, two: true, root: 0, mode: 'major' },
  { name: 'changes every beat or two, drums on', song: 'changes every beat or two', bpm: 110, rate: 1, bars: 8, drums: 5, two: false, root: 3, mode: 'minor' },
  { name: 'odd chord lengths at rate 2', song: 'odd lengths', bpm: 90, rate: 2, bars: 8, drums: null, two: false, root: 7, mode: 'mixolydian' },
  { name: 'the song commits each chord just before it starts (the walk waits for it and skips the beats that pass)', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 8, drums: null, two: false, root: 0, mode: 'major', commitAhead: 0.03 },
  { name: 'chords that start a little after a beat, drums on, committed late', song: 'chords that start a little after a beat', bpm: 120, rate: 1, bars: 8, drums: 1, two: false, root: 0, mode: 'major', commitAhead: 0.05 },
  { name: 'joining a song part-way through a chord, two-feel, drums on', song: 'I-vi-IV-V', bpm: 120, rate: 1, bars: 8, drums: 2, two: true, root: 0, mode: 'major', startAt: 7.31 },
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
    const grid = Array.from({ length: 16 }, (_, i) => ({ note: i % 12, oct: 2, len: 1, slide: false, accent: false, v: i % 3 === 0 ? 1 : 0, usr: 0 }));
    for (const c of configs) {
      document.getElementById('bpm').value = c.bpm; c.bpm = parseFloat(document.getElementById('bpm').value);
      blRateMul = c.rate; window.setHumanize(0);
      root = c.root; mode = c.mode;
      window._blRestoreState({ steps: 16, grid, follow: true, genStyle: 'jazz', walkFeel: c.two ? 'two' : 'four', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      const sd = 60 / c.bpm / 4 * c.rate, beat = sd * 4, tEnd = FIRSTs + c.bars * 16 * sd;
      // the drums' bar line, as window._sqNextBar reads it: the next step not yet committed is the first on their grid at or past the horizon
      window._sqNextBar = c.drums == null ? () => null : () => {
        const F0 = FIRSTs + c.drums * sd, n = Math.max(0, Math.ceil((_schedHorizon - F0) / sd)), nextT = F0 + n * sd;
        const toBar = ((16 - n % 16) % 16 + 16) % 16;
        return { t: nextT + toBar * sd };
      };
      fake.currentTime = 0.0013;
      window._blClearChords();
      const song = SONGS[c.song], slot = k => { const s = song[k % song.length]; return { rootM: s[0], ivs: s[1], bassNote: s[2], isRest: !!s[4] }; };
      // The chart: every chord the song will commit, with the moment it is committed (all at once, or just before it starts).
      const plan = []; { let t = FIRSTs, i = 0; while (t < tEnd + 6) { const dur = song[i % song.length][3] * beat; plan.push({ t, dur, i }); t += dur; i++; } }
      let committed = 0;
      const commit = now => { while (committed < plan.length && (c.commitAhead == null || plan[committed].t <= now + c.commitAhead)) { const p = plan[committed++]; if (c.live) window._blOnLiveChord(slot(p.i)); else window._blOnChord(slot(p.i), p.t, p.dur, slot(p.i + 1), 0); } };
      sent.length = 0;
      fake.currentTime = c.startAt != null ? c.startAt : 0.0013;
      commit(fake.currentTime);
      window._blSetClock(FIRSTs, 0, true);
      const ticks = [], tape = [], orig = Math.random;
      for (let guard = 0; guard < 100000; guard++) {
        fake.currentTime += 0.0371; _schedHorizon = fake.currentTime + LA;
        commit(fake.currentTime);
        const nb = window._sqNextBar();
        ticks.push([fake.currentTime * sr, _schedHorizon * sr, nb ? nb.t * sr : -1].concat(window._blNativeChords(sr), [0, 0]));
        Math.random = () => { const v = orig.call(Math); tape.push(v); return v; };
        try { window._blScheduler(); } finally { Math.random = orig; }
        _schedHorizon = null;
        if (fake.currentTime + LA >= tEnd) break;
      }
      window._blSetClock(0, 0, false);
      const sc = window._blNativeScore();
      out.push({ name: c.name, notes: sent.map(m => ({ at: m.at, note: m.note, dur: m.dur, vel: m.vel, accent: m.accent, slide: m.slide, from: m.from })), tEnd, ticks, tape,
                 score: sc.score, ok: sc.ok, why: sc.why, chords: window._blNativeChords(sr), bpm: c.bpm, rate: c.rate, two: c.two, live: c.live });
    }
    window._sqNextBar = realNB;
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready;
    return out;
  }, { configs: CONFIGS, SONGS });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
  const run = (c, withTape) => {
    const cases = [1, SR, c.bpm, c.rate, 1.0 * SR, 5, 0, c.ticks.length, withTape ? c.tape.length : 0].concat(...c.ticks, withTape ? c.tape : [], c.score, c.chords);
    fs.writeFileSync(path.join(tmp, 'walk.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const bin = path.join(root, 'native', 'modsynth', 'basstool');
    if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth basstool'); process.exit(2); }
    const r = spawnSync(bin, [path.join(tmp, 'walk.f64'), ...(c.live ? ['--live-chords'] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    return r.stdout.split('\n').filter(l => l.startsWith('N ')).map(l => { const f = l.split(' '); return { fx: +f[1], frame: +f[2], midi: +f[3], dur: +f[4], vel: +f[5], accent: +f[6] === 1, slide: +f[7] === 1, from: +f[8] }; });
  };

  console.log('\nthe walking line, the engine against the page, note for note (with the page\'s own random draws):');
  const native = result.map(c => run(c, true));
  result.forEach((c, i) => {
    const pg = c.notes, nat = native[i];
    let same = nat.length === pg.length, worstT = 0, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k], dt = Math.abs(p.at * SR - n.fx);
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) { same = false; why = `note ${k} at ${p.at * SR} frames on the page, ${n.fx} native`; }
      else if (p.note !== n.midi) { same = false; why = `note ${k}: midi ${p.note} on the page, ${n.midi} native (frame ${n.frame})`; }
      else if (Math.abs(p.dur * SR - n.dur) > 1e-5) { same = false; why = `note ${k}: length ${p.dur * SR} frames on the page, ${n.dur} native`; }
      else if (Math.abs(p.vel - n.vel) > 1e-12) { same = false; why = `note ${k}: level ${p.vel} on the page, ${n.vel} native`; }
      else if (!!p.accent !== n.accent || p.slide || n.slide || p.from != null) { same = false; why = `note ${k}: accent/slide differ`; }
    }
    ok(same && pg.length > 6 && c.ok, c.name + ': ' + pg.length + ' notes identical (worst timing ' + worstT.toExponential(1) + ' frames, ' + c.tape.length + ' draws)', why);
  });

  console.log('\nand with the engine\'s own generator (no tape): everything that does not depend on a draw is the same:');
  result.forEach((c, i) => {
    const pg = c.notes, nat = run(c, false);
    let same = nat.length === pg.length, why = nat.length + ' native, ' + pg.length + ' page';
    for (let k = 0; same && k < pg.length; k++) {
      const p = pg[k], n = nat[k];
      if (Math.abs(p.at * SR - n.fx) > 1e-5 || Math.abs(p.dur * SR - n.dur) > 1e-5 || Math.abs(p.vel - n.vel) > 1e-12 || !!p.accent !== n.accent) { same = false; why = `note ${k}: timing, length, level or accent differ`; }
      else if (p.accent && (p.note - n.midi) % 12 !== 0) { same = false; why = `downbeat ${k}: ${p.note} on the page, ${n.midi} native (not the same pitch class)`; }
    }
    const inRange = nat.every(n => n.midi >= 33 && n.midi <= 52);
    ok(same && inRange && pg.length > 6, c.name + ': timing, length, level and accent identical, downbeats the same pitch class, all inside 33..52', same ? 'out of range' : why);
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
