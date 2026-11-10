/* The native song loop (native/modsynth/songcore.h, docs/native-scheduling.md slice 4, piece 2) against the page's own: startSongLoop,
   _playLoopSlot, tickSongLoop and _advanceLoopSlot, with the page's timers and the drums' bar announcements on a clock of our own.

   The page's loop runs in the real page. The clock is fake: setTimeout is replaced by a queue that runs when the fake time reaches it, the drums are a
   stand-in that announces a bar line (tickSongLoop(t), as scheduleRhythm and the sequencer do) when the line falls inside the look-ahead, and the
   player's Next/Prev and a key change arrive between two ticks. Every chord the loop hands the bass (_blOnChord, and the window it makes) is kept.
   native/modsynth/songtool is given the song as the engine reads it (window._songNativeScore) and the same ticks. The two lists must be the same,
   chord for chord: when it starts (to 1e-5 of a frame), when its window ends, rest, root, slash bass, the next chord's root, the chord's tones,
   whether it has a phrase lock, and where in the song it is (section, chord, pass).

   Piece 3 (native/modsynth/songvoice.h, voicing.h) adds what each chord SOUNDS like: the page's playChartSlot2 is run for real, its modEngine messages for
   the chord part are kept (stop, chord, release), and the engine's action for the same chord must be the same: the notes with the slash bass first, the
   sub's note, the level, the moment, and either a decay (how long) or a hold (never let go of, or let go of that many seconds on). The voicing is the
   page's own: VoiceLead, Close, Spread, Drop 2 and 3, Soul, Neo-soul, Vary's lap through them, a chord's own voicing, the key change, the pedal, the
   comp's hold and ring. The page's voicing memory is reset before each run and so is the engine's.

   Run: make -C native/modsynth songtool && node tests/seq/songstep.test.js        Env: CHROMIUM, PLAYWRIGHT, SONGTOOL (another build of the tool), SONG_DEBUG */
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
// A slot: [rootM, ivs, bars, beats, eighths, bass note, rest, lock]
const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM = [0, 4, 7, 10], M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11];
const CONFIGS = [
  { name: 'drums on, whole-bar chords: two sections, passes, the peek reads the follow flag', bpm: 120, drums: true, clocked: true, secs: 70,
    sections: [{ plays: 2, follow: 'next', slots: [[0, MAJ, 1], [9, MIN, 1], [5, MAJ, 1], [7, DOM, 1]] }, { plays: 1, slots: [[2, M7, 2], [7, DOM, 2]] }] },
  { name: 'drums on, chords of mixed lengths: bars, beats, eighths, a bar and two beats, rests, a slash chord', bpm: 100, drums: true, clocked: true, secs: 90,
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [2, M7, 0, 2], [7, DOM, 0, 2], [0, MAJ7, 1, 2], [9, MIN, 0, 1, 1, null], [5, MAJ, 1, 0, 0, 0, true], [0, MAJ, 1, 0, 0, 4], [7, DOM, 0, 0, 3]] }] },
  { name: 'no drums: every chord ends one length after it began, Chart 8ths swung', bpm: 110, drums: false, clocked: true, swingOn: true, swing: 40, secs: 60,
    sections: [{ plays: 1, slots: [[0, MAJ, 2], [5, MAJ, 0, 3], [7, DOM, 0, 1, 1], [9, MIN, 1]] }, { plays: 2, slots: [[2, M7, 1], [7, DOM, 1]] }] },
  { name: 'a queued Next at the end of a pass, an empty section skipped, a section that holds (plays inf)', bpm: 120, drums: true, clocked: true, secs: 120,
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [5, MAJ, 1]] }, { plays: 1, slots: [] }, { plays: 0, slots: [[9, MIN, 1], [2, M7, 1], [7, DOM, 1]] }, { plays: 1, slots: [[0, MAJ7, 2]] }],
    moves: [{ at: 5.2, delta: 1 }, { at: 40.2, delta: -1 }, { at: 62.2, delta: 1 }] },
  { name: 'starting part-way (section 1, chord 2), a key change while it plays (the capo)', bpm: 130, drums: true, clocked: true, secs: 60, start: { section: 1, slot: 2 },
    sections: [{ plays: 1, slots: [[0, MAJ, 1], [5, MAJ, 1]] }, { plays: 2, slots: [[2, M7, 1], [7, DOM, 1], [0, MAJ7, 1], [9, MIN, 1]] }],
    capo: [{ at: 7.3, by: 2 }, { at: 24.3, by: 5 }] },
  { name: 'phrase locks on two chords (the lock rides in the score, whichever chord asks), and melody locks on two others', bpm: 120, drums: true, clocked: true, secs: 50, locks: [[0, 0], [0, 2]], mlocks: [[0, 1], [0, 2]],
    sections: [{ plays: 2, slots: [[0, MAJ, 1], [9, MIN, 1], [5, MAJ, 2], [7, DOM, 1]] }] },
];

// The voicing tests: one song (real MIDI roots: the voice leading lives in C3..G5), many ways to voice and strike it.
// A slot is [rootM, ivs, bars, beats, eighths, bass note, rest, lock, extra]; extra: {comp, ring, voicing}
const X7 = [0, 4, 7, 10], X9 = [0, 4, 7, 10, 14], M9 = [0, 3, 7, 10, 14], SUS = [0, 5, 7], MAJ13 = [0, 4, 7, 11, 14, 21], HALF = [0, 3, 6, 10], DIM7 = [0, 3, 6, 9], AUG = [0, 4, 8];
const VSONG = [
  { plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, X9, 1]] },
  { plays: 1, slots: [[50, M9, 1], [55, X7, 1, 0, 0, 59], [48, MAJ13, 1], [60, MAJ, 1, 0, 0, null, true], [52, X7, 1], [57, MIN, 1], [53, SUS, 1],
                      // half-diminished, augmented and diminished chords; plain major triads off the key (D, B flat); the same chord twice running;
                      // slash chords whose bass sits high enough to raise the floor the voicing keeps above it
                      [59, HALF, 1], [51, AUG, 1], [56, DIM7, 1], [50, MAJ, 1], [58, MAJ, 1], [48, MAJ, 1], [48, MAJ, 1], [55, X7, 1, 0, 0, 65], [53, MAJ, 1, 0, 0, 64]] },
];
// A song of random chords (a fixed seed): any root in C2..F4, any of the qualities, a slash bass now and then. Long runs through the voicing find the near-ties
// (two grips of almost the same cost) that a handful of hand-picked chords does not.
const QUAL = [MAJ, MIN, X7, M7, MAJ7, X9, M9, HALF, DIM7, AUG, SUS, MAJ13, [0, 4, 7, 9], [0, 3, 7, 9], [0, 4, 7, 10, 13, 20]];
function randomSong(seed, n) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const slots = [];
  for (let i = 0; i < n; i++) {
    const r = 36 + Math.floor(rnd() * 30), q = QUAL[Math.floor(rnd() * QUAL.length)], slash = rnd() < 0.2 ? r + 3 + Math.floor(rnd() * 12) : null;
    slots.push([r, q, 1, 0, 0, slash]);
  }
  return [{ plays: 0, slots }];
}
// shift: the whole song moved by that many semitones (the voice leading sits in a fixed register, so where the roots lie decides what it does)
const vcfg = (name, voice, extra) => Object.assign({ name: 'voicing: ' + name, bpm: 120, drums: true, clocked: true, secs: 80, sections: VSONG, voice }, extra || {});
CONFIGS.push(
  vcfg('Close, VoiceLead, the comp holds the chord flat', {}),
  vcfg('Spread, once a bar (decaying), Strum on caps the decay', { voicing: 'open', comp: 'bars', strum: true, decay: 1.6 }),
  vcfg('Drop 2', { voicing: 'drop2' }),
  vcfg('Drop 3, decaying', { voicing: 'drop3', comp: 'bars', decay: 2.4 }),
  vcfg('Soul / R&B', { voicing: 'rnb' }),
  vcfg('Neo-soul in C minor', { voicing: 'neosoul', mode: 'minor', root: 0 }),
  vcfg('Neo-soul in D dorian', { voicing: 'neosoul', mode: 'dorian', root: 2 }),
  vcfg('Vary on, from Close (a lap through all six types, then the next shape)', { vary: true }, { secs: 200 }),
  vcfg('Vary on, from Drop 2, Length 1 beat at 100 BPM (the decay is a beat)', { vary: true, voicing: 'drop2', comp: 'bars', strum: false, chordBeats: 1, decay: 3 }, { bpm: 100, secs: 260 }),
  vcfg('VoiceLead off, Close', { autoInv: false }),
  vcfg('VoiceLead off, Soul', { autoInv: false, voicing: 'rnb' }),
  vcfg('As played: held 2 beats, held into the next chord, tapped', { comp: 'played', plays: [2, null, 0] }, { bpm: 90 }),
  vcfg('chords that carry their own voicing (Soul, Drop 3, Spread) in a Close song', { own: ['rnb', 'drop3', 'open', 'neosoul'] }),
  vcfg('a key change while it plays with Neo-soul (the key the voicing asks moves with it)', { voicing: 'neosoul' }, { capo: [{ at: 9.3, by: 2 }, { at: 31.3, by: 5 }] }),
  vcfg('Wet/dry at the top: a held pedal under the arp', { wet: 1 }),
  vcfg('Chords off: only the stop', { chordsOff: true }),
  vcfg('Soul, the song an octave down', { voicing: 'rnb' }, { shift: -12 }),
  vcfg('Drop 2, five semitones up', { voicing: 'drop2' }, { shift: 5 }),
  vcfg('Drop 3, seven semitones down', { voicing: 'drop3' }, { shift: -7 }),
  vcfg('Neo-soul, nine semitones up', { voicing: 'neosoul' }, { shift: 9 }),
  vcfg('Spread, five semitones down, Strum on', { voicing: 'open', strum: true }, { shift: -5 }),
  vcfg('Close, two octaves down (the first chord is centred from a shift of 36)', {}, { shift: -24 }),
  vcfg('Vary on from Soul, the song three semitones up', { vary: true, voicing: 'rnb' }, { shift: 3, secs: 200 }),
  vcfg('48 random chords, Drop 2', { voicing: 'drop2' }, { sections: randomSong(11, 48), secs: 110 }),
  vcfg('48 random chords, Drop 3', { voicing: 'drop3' }, { sections: randomSong(23, 48), secs: 110 }),
  vcfg('48 random chords, Soul', { voicing: 'rnb' }, { sections: randomSong(37, 48), secs: 110 }),
  vcfg('48 random chords, Neo-soul in G major', { voicing: 'neosoul', root: 7 }, { sections: randomSong(41, 48), secs: 110 }),
  vcfg('48 random chords, Close', {}, { sections: randomSong(53, 48), secs: 110 }),
  vcfg('48 random chords, Spread, VoiceLead off', { voicing: 'open', autoInv: false }, { sections: randomSong(67, 48), secs: 110 }),
  vcfg('120 random chords, Vary on from Drop 2 (laps through every type)', { vary: true, voicing: 'drop2' }, { sections: randomSong(71, 120), secs: 250 }),
);

// The practice trainer: a loop of bars, the tempo step and the key step each chorus
const pcfg = (name, prac, extra) => Object.assign({ name: 'trainer: ' + name, bpm: 100, drums: true, clocked: true, secs: 90, prac }, extra || {});
CONFIGS.push(
  pcfg('loop chords 2 to 3 of a four-chord section, each pass a chorus, the tempo up 6 a chorus to 130', { loop: [0, 1, 2], ramp: { step: 6, every: 1, max: 130 } },
       { sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }, { plays: 1, slots: [[50, M7, 1]] }] }),
  pcfg('the key up a fifth every second chorus and the tempo every chorus, a chart with two sections (a chorus is the last section\'s final pass)', { ramp: { step: 4, every: 1, max: 140 }, key: { every: 2, by: 7 } },
       { secs: 200, sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1]] }, { plays: 1, slots: [[53, MAJ7, 1], [55, DOM, 1]] }] }),
  pcfg('a chart of one section: every pass is a chorus; the key by a fourth every chorus, all twelve keys', { key: { every: 1, by: 5 }, min: 11 },
       { secs: 400, sections: [{ plays: 1, slots: [[48, MAJ, 1], [57, MIN, 1]] }] }),
  pcfg('a last section that loops for ever: each of its passes counts', { ramp: { step: 5, every: 2, max: 125 }, key: { every: 3, by: 1 } },
       { secs: 220, sections: [{ plays: 1, slots: [[48, MAJ, 1], [57, M7, 1]] }, { plays: 0, slots: [[53, MAJ7, 1], [55, DOM, 1]] }] }),
  pcfg('a Next tapped in a loop: the loop lets the pass finish, then the section moves on', { loop: [0, 0, 1], ramp: { step: 4, every: 1, max: 130 }, min: 2 },
       { moves: [{ at: 20.4, delta: 1 }], sections: [{ plays: 2, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1]] }, { plays: 0, slots: [[55, DOM, 1], [50, M7, 1]] }] }),
  pcfg('a one-chord loop (the same chord again), the tempo to its ceiling and holding there', { loop: [0, 2, 2], ramp: { step: 30, every: 1, max: 150 } },
       { sections: [{ plays: 1, slots: [[48, MAJ, 1], [57, M7, 1], [53, MAJ7, 1], [55, DOM, 1]] }] }),
);

// The comp's rhythms: the re-strikes after a chord's first strike. Drawn rhythms: cells {on, acc, rat (ratchet), len (gate in steps)}.
const cells = (n, spec) => Array.from({ length: n }, (_, i) => Object.assign({ on: 0, acc: 0, rat: 1, len: 0 }, spec[i] ? Object.assign({ on: 1 }, spec[i]) : {}));
const PUMP = { name: 'Pump', steps: 16, swing: null, cells: cells(16, { 0: { acc: 1 }, 3: { len: 2 }, 6: { rat: 2 }, 8: { acc: 1 }, 11: { rat: 3 }, 14: { len: 4 } }) };
const SWUNG = { name: 'Swung', steps: 16, swing: 55, cells: cells(16, { 0: {}, 2: {}, 4: { acc: 1 }, 6: {}, 8: {}, 10: { len: 1 }, 12: { acc: 1 }, 14: {} }) };
const RATSW = { name: 'Ratswing', steps: 16, swing: 70, cells: cells(16, { 0: { acc: 1 }, 2: { rat: 3 }, 3: {}, 6: { rat: 2 }, 7: { len: 1 }, 10: { rat: 4 }, 11: {} }) };
const TWELVE = { name: 'Twelve', steps: 12, swing: null, cells: cells(12, { 0: { acc: 1 }, 4: {}, 7: { rat: 2 }, 9: { len: 3 } }) };
const TRIPLET = { name: 'Triplet', grid: { n: 12, len: 16, follow: false }, swing: null, cells: Array.from({ length: 12 }, (_, i) => ({ on: [0, 2, 3, 6, 8, 9, 11].includes(i) ? 1 : 0, acc: i === 0 ? 1 : 0, soft: i === 3 ? 1 : 0, rat: i === 8 ? 2 : 1, len: i === 11 ? 2 : 0 })) };
// A song for the comp: chords of two bars, a bar, a half bar, beats and eighths, a rest, a slash chord
const CSONG = [
  { plays: 2, slots: [[48, MAJ, 2], [57, M7, 1], [53, MAJ7, 0, 2], [55, X7, 1, 0, 0, 59], [50, M7, 0, 0, 3], [60, MAJ, 1, 0, 0, null, true], [52, X7, 1, 2], [55, MAJ, 1]] },
];
const ccfg = (name, voice, extra) => Object.assign({ name: 'comp: ' + name, bpm: 120, drums: true, clocked: true, secs: 90, sections: VSONG, voice, comps: true }, extra || {});
CONFIGS.push(
  ccfg('Every beat, one-bar chords', { comp: 'strum' }),
  ccfg('Bossa over chords of two bars, a bar, half a bar, beats and eighths', { comp: 'bossa' }, { sections: CSONG, secs: 100 }),
  ccfg('Gallop (sixteenths between the eighths) and Beats 1 and 3, chord by chord', { comps: ['gallop', 'backbeat', null, 'clave', 'push'], comp: 'strum' }, { sections: CSONG, secs: 100 }),
  ccfg('Eighths with Strum on and Length 2 beats, Spread', { comp: 'eighths', strum: true, chordBeats: 2, voicing: 'open' }),
  ccfg('Every beat, Drop 2 (a hit keeps its chord\'s grip)', { comp: 'strum', voicing: 'drop2' }),
  ccfg('Every beat, Vary on from Close', { comp: 'strum', vary: true }, { secs: 160 }),
  ccfg('Every beat, Vary on from Drop 3', { comp: 'skank', vary: true, voicing: 'drop3' }, { secs: 160 }),
  ccfg('a drawn rhythm: accents, ratchets and gates', { comp: PUMP }, { sections: CSONG, secs: 100 }),
  ccfg('a drawn rhythm of twelve sixteenths', { comp: TWELVE }, { sections: CSONG, secs: 100 }),
  ccfg('a drawn rhythm with a swing of its own, the Feel at 20', { comp: SWUNG }, { sections: CSONG, secs: 100, swing: 20 }),
  ccfg('a drawn rhythm that follows the Feel (swing 45)', { comp: PUMP }, { sections: CSONG, secs: 100, swing: 45 }),
  ccfg('a triplet grid rhythm with soft hits, a ratchet and a gate', { comp: TRIPLET }, { sections: CSONG, secs: 100 }),
  ccfg('drawn and built-in rhythms chord by chord, slash chords, as played and a hold between', { comps: [PUMP, 'strum', 'played', TWELVE, 'sustain', SWUNG, 'bossa'], plays: [1, null, 0] }, { sections: CSONG, secs: 100, swing: 30 }),
  ccfg('at 90 BPM with Length 1 beat', { comp: PUMP, chordBeats: 1, decay: 3 }, { bpm: 90, sections: CSONG, secs: 100 }),
  ccfg('3/4 bars of twelve sixteenths: a position past the end of the short bar is not played', { comp: 'strum' }, { meter: [3, 4], sections: CSONG, secs: 100 }),
  ccfg('the Feel swinging the sixteenths instead of the eighths', { comp: PUMP }, { sections: CSONG, secs: 100, swing: 40, sw16: true }),
  ccfg('a ratchet on a swung step with a hit on the next one (their order swaps)', { comp: RATSW }, { sections: CSONG, secs: 100 }),
  ccfg('Wet/dry at the top: only the slash chord\'s bass is struck again', { comp: 'strum', wet: 1 }),
  ccfg('Chords off: the hits only stop', { comp: 'strum', chordsOff: true }),
  ccfg('a key change while the hits play (Soul, every beat)', { comp: 'strum', voicing: 'rnb' }, { capo: [{ at: 9.3, by: 2 }, { at: 31.3, by: 5 }] }),
  ccfg('no drums: the hits ride the chord\'s own clock', { comp: 'strum' }, { drums: false, sections: CSONG, secs: 100 }),
  ccfg('50 random chords with a rhythm from the list on each', { comps: ['strum', PUMP, 'bossa', null, TRIPLET, 'eighths', 'push', SWUNG, 'gallop', TWELVE], comp: 'backbeat', voicing: 'neosoul' }, { sections: randomSong(97, 50), secs: 120, swing: 25 }),
);

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const result = await page.evaluate(async ({ configs }) => {
    const sr = 48000, out = [];
    const fake = { currentTime: 0, sampleRate: sr, state: 'running' };
    const off = new OfflineAudioContext(2, sr, sr);
    const ctxProxy = new Proxy(off, { get: (t, p) => p === 'currentTime' ? fake.currentTime : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    clearTimeout(clockTimer);
    const realCtx = getCtx, realAudio = audioCtx, realSq = window._sqPlaying, realSetTimeout = window.setTimeout, realClearTimeout = window.clearTimeout;
    const E = window.modEngine, keep = { send: E.send, now: E.now, ready: E.ready };
    let sounds = [], nowRecs = () => 0;
    // what the arp is handed for each chord (setArpChord, through the page's own playChartSlot2): the tones after it, or a rest
    let arpCalls = [];
    const origPCS = window.playChartSlot2;
    window.playChartSlot2 = function (si, ci, atTime) {
      const r = origPCS.apply(this, arguments);
      const sl = sections[si] && sections[si].slots[ci];
      arpCalls.push({ at: atTime, rest: !!(sl && sl.isRest), notes: sl && !sl.isRest ? arpNotes.slice() : null });
      return r;
    };
    E.send = m => { if (m && m.part === 'chord' && (m.kind === 'chord' || m.kind === 'stop' || m.kind === 'release')) sounds.push(Object.assign({ ci: nowRecs() }, m)); };
    E.now = () => fake.currentTime; E.ready = () => true;
    window.getCtx = () => ctxProxy; audioCtx = ctxProxy;
    // The page's timers run when the fake time reaches them.
    let timers = [], tid = 1;
    window.setTimeout = (fn, ms) => { const id = tid++; timers.push({ id, t: fake.currentTime + (ms || 0) / 1000, fn }); return id; };
    window.clearTimeout = id => { timers = timers.filter(x => x.id !== id); };
    const runTimers = () => { for (let g = 0; g < 1000; g++) { timers.sort((a, b) => a.t - b.t || a.id - b.id); const x = timers[0]; if (!x || x.t > fake.currentTime + 1e-12) break; timers.shift(); try { x.fn(); } catch (e) { } } };
    const LA = LOOK_AHEAD, T0 = 1.0, DT = 0.0371;
    const origOnChord = window._blOnChord;
    // The page's tick drains the comp's waiting re-strikes AFTER the drums have announced a bar line, so a hit in the last tick before a chord change is thrown
    // away with the rest when the chord changes (and one at or after the change never plays). The engine plays every hit before the next chord and none at or
    // after it, so the page is held to that: the hits due before a chord starts go out as it starts, and the later ones are cleared with it, as they are.
    const origPlayLoopSlot = _playLoopSlot;
    _playLoopSlot = function (atTime) {
      if (atTime != null) _compPending.filter(e => !e.done && e.hitT < atTime).sort((a, b) => a.hitT - b.hitT).forEach(e => { e.done = true; try { _compRestrike(e.slot, e.hitT, e.opt); } catch (err) { } });
      return origPlayLoopSlot.apply(this, arguments);
    };
    let cfgIdx = -1;
    for (const c of configs) {
      cfgIdx++;
      document.getElementById('bpm').value = c.bpm; const bpm = parseFloat(document.getElementById('bpm').value);
      fake.currentTime = 0.0013; timers = [];
      stopSongLoop();
      root = 0; mode = 'major';
      window.setHumanize(0);
      window._blRestoreState({ steps: 16, grid: Array.from({ length: 16 }, () => ({ note: 0, oct: 2, len: 1, slide: false, accent: false, v: 0, usr: 0 })), follow: true, genStyle: 'funk', gridRootPc: 0, gridIntvs: [0, 4, 7] });
      _bassAutoSync = false; songCompStyle = 'sustain';
      snapMode = c.clocked ? 'bar' : 'off'; rhythmOn = false;
      METER.beats = c.meter ? c.meter[0] : 4; METER.unit = c.meter ? c.meter[1] : 4;
      window._sqSetSwing8(!c.sw16);
      // how the chords are voiced and struck, and the memory the voicing leads from
      const V = c.voice || {};
      voicing = V.voicing || 'close'; voiceVary = !!V.vary; autoInvOn = V.autoInv !== false; strumMode = !!V.strum; chordBeats = V.chordBeats || 0;
      wetDry = V.wet != null ? V.wet : 0.5; chordsEnabled = !V.chordsOff; document.getElementById('decay').value = V.decay || 2;
      if (V.mode) { mode = V.mode; }
      if (V.root != null) root = V.root;
      _prevVoices = []; _styledPrevTop = null; _jazzPrev = null; _vvCount = {}; _vvHist = {}; _vvLastId = null; _vvFresh = false; _vvNew = false;
      songSwingOn = !!c.swingOn; if (c.swing != null) window._sqSetSwing(c.swing); else window._sqSetSwing(0);
      window._sqPlaying = () => !!c.drums;
      const mk = a => { const s = { rootM: a[0] + (c.shift || 0), ivs: a[1].slice(), bars: a[2] || 0, beats: a[3] || 0, eighths: a[4] || 0, isRest: !!a[6], label: 'x' }; if (a[5] != null) s.bassNote = a[5] + (c.shift || 0); return s; };
      sections = c.sections.map((s, i) => ({ name: 'S' + i, slots: s.slots.map(mk), plays: s.plays, follow: s.follow }));
      songCompStyle = (V.comp && typeof V.comp === 'object') ? rhyRegister(V.comp) : (V.comp || 'sustain');
      let n = 0, nc = 0;
      sections.forEach(sec => sec.slots.forEach(sl => {
        if (V.own && !sl.isRest && n % 3 === 1) sl.voicing = V.own[Math.floor(n / 3) % V.own.length];
        if (V.plays && !sl.isRest) { const r = V.plays[n % V.plays.length]; sl.ring = r; }
        n++;
      }));
      // a comp of its own for some of the chords (a built-in's name, a drawn rhythm, or null: the song's)
      if (V.comps) sections.forEach(sec => sec.slots.forEach(sl => {
        if (sl.isRest) return;
        const v = V.comps[nc++ % V.comps.length];
        if (v == null) return;
        if (typeof v === 'string') sl.comp = v; else sbSetComp(sl, 'x', v);
      }));
      PHRASE_LOCKS.bass = {}; PHRASE_LOCKS.mel = {};
      // the melody generator's locks, with chords in some of their steps
      (c.mlocks || []).forEach(([si, ci]) => {
        const sl = sections[si].slots[ci];
        PHRASE_LOCKS.mel[window.phraseKey(sl)] = { grid: Array.from({ length: 16 }, (_, i) => ({ v: i % 2 === 0 ? 1 : 0, note: (i * 5) % 12, oct: 4, len: 1, accent: false, vel: 0, pr: 0, more: i % 4 === 0 ? [{ note: (i + 4) % 12, oct: 4 }] : undefined })), steps: 16, rootPc: sl.rootM % 12 };
      });
      (c.locks || []).forEach(([si, ci], n) => {
        const sl = sections[si].slots[ci];
        PHRASE_LOCKS.bass[window.phraseKey(sl)] = { grid: Array.from({ length: 16 }, (_, i) => ({ v: i % 3 === 0 ? 1 : 0, note: i % 12, oct: 2, len: 1, slide: false, accent: false, vel: 0, pr: 0 })), steps: 16, rootPc: sl.rootM % 12 };
      });
      const st = c.start || { section: 0, slot: 0 };
      songCurrentSection = st.section; songCurrentSlot = st.slot; _songHeldAt = null; songSectionPass = 0; songPendingSectionDelta = 0; songWaitingForBar = false;
      const recs = [];
      nowRecs = () => recs.length;
      arpCalls = []; arpOcts = 1 + (cfgIdx % 3);
      window._blOnChord = function (slot, atTime, durSec, nextSlot, capoOverride) {
        origOnChord.apply(this, arguments);
        const w = window._blPeekLast();
        recs.push({ t: w.t, end: w.end, rest: w.rest ? 1 : 0, rootPc: w.rootPc, bassPc: w.bassPc == null ? -1 : w.bassPc, nextPc: w.nextPc == null ? -1 : w.nextPc, pcs: w.pcs.slice(),
                    lock: window._blLockFor(w) ? 1 : 0, melLock: window._mlLockFor(w) ? [window._mlLockFor(w).rootPc, window._mlLockFor(w).steps].join() : '', section: songLoopSection, slot: songLoopSlot, pass: songSectionPass });
      };
      const barSec = _songBarSteps() * 60 / bpm / 4;
      const marks = []; for (let m = T0; m < T0 + c.secs + 10; m += barSec) marks.push(m);
      let announced = 0;
      window._barAnnouncedT = 0;      // the last run's bar lines must not make this start look announced already
      sounds = [];
      // the practice trainer: a loop of bars, a tempo step and a key step per chorus; what each chorus ended with is kept
      const P = c.prac || {};
      prac.ramp.on = !!P.ramp; if (P.ramp) Object.assign(prac.ramp, P.ramp);
      prac.key.on = !!P.key; if (P.key) Object.assign(prac.key, P.key);
      pracLoop = P.loop ? { sel: 3, si: P.loop[0], a: P.loop[1], b: P.loop[2] } : { sel: 0, si: -1, a: -1, b: -1 };
      const chorusEvs = [], cur = { bpm: 0, d: 0 };
      const realGliss = _setBpmGliss, realTrans = transposeSong, realDone = _pracChorusDone;
      _setBpmGliss = function (v) { const r = realGliss.apply(this, arguments); cur.bpm = r; return r; };
      transposeSong = function (d) { cur.d += d; return realTrans.apply(this, arguments); };
      _pracChorusDone = function () { cur.bpm = 0; cur.d = 0; realDone.apply(this, arguments); chorusEvs.push({ n: _pracRun.chorus, bpm: cur.bpm, d: cur.d }); };
      startSongLoop(false, T0);
      const sc = window._songNativeScore({ chords: true });
      const ticks = [], moves = (c.moves || []).map(m => Object.assign({ done: false }, m)), capos = (c.capo || []).map(m => Object.assign({ done: false }, m));
      for (let guard = 0; guard < 200000; guard++) {
        fake.currentTime += DT;
        const horizon = fake.currentTime + LA, mk2 = [];
        if (c.drums) while (announced < marks.length && marks[announced] < horizon) { const m = marks[announced++]; mk2.push(m * sr); window._barAnnouncedT = m; tickSongLoop(m); }
        runTimers();
        let move = 0, capo = 1e9;
        moves.forEach(m => { if (!m.done && fake.currentTime >= m.at) { m.done = true; songGotoSection(m.delta); move = m.delta; } });
        capos.forEach(m => { if (!m.done && fake.currentTime >= m.at) { m.done = true; root = (root + m.by) % 12; capo = (_songBaseRoot >= 0 ? root - _songBaseRoot : 0); } });
        ticks.push([fake.currentTime * sr, horizon * sr, c.drums ? 1 : 0, mk2.length].concat(mk2, [move, capo]));
        if (fake.currentTime > T0 + c.secs) break;
      }
      stopSongLoop();
      _setBpmGliss = realGliss; transposeSong = realTrans; _pracChorusDone = realDone;
      prac.ramp.on = false; prac.key.on = false; pracLoop = { sel: 0, si: -1, a: -1, b: -1 };
      out.push({ arpCalls, arpOcts, chorusEvs, prac: c.prac || null, name: c.name, comps: !!c.comps, minHits: c.minHits, recs, sounds, chordsOk: sc.chords, chordWhy: sc.chordWhy, chordsOff: !!V.chordsOff, ticks, score: sc.score, ok: sc.ok, why: sc.why, bpm, first: T0 * sr, section: st.section, slot: st.slot, locks: (c.locks || []).length });
    }
    _playLoopSlot = origPlayLoopSlot; METER.beats = 4; METER.unit = 4; window._sqSetSwing8(true);
    window.playChartSlot2 = origPCS; arpOcts = 1;
    window._blOnChord = origOnChord; window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout; window._sqPlaying = realSq;
    window.getCtx = realCtx; audioCtx = realAudio; E.send = keep.send; E.now = keep.now; E.ready = keep.ready; PHRASE_LOCKS.bass = {}; PHRASE_LOCKS.mel = {};
    return out;
  }, { configs: CONFIGS });
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'song-'));
  const bin = process.env.SONGTOOL || path.join(root, 'native', 'modsynth', 'songtool');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth songtool'); process.exit(2); }
  console.log('\nthe song loop, the engine against the page, chord for chord:');
  result.forEach(c => {
    const cases = [1, SR, c.bpm, c.first, c.section, c.slot, 0, c.ticks.length].concat(...c.ticks, c.score);
    fs.writeFileSync(path.join(tmp, 'song.f64'), Buffer.from(Float64Array.from(cases).buffer));
    const r = spawnSync(bin, [path.join(tmp, 'song.f64')], { encoding: 'utf8', maxBuffer: 1 << 26, env: Object.assign({}, process.env, { ARP_OCTS: String(c.arpOcts) }) });
    if (r.status !== 0) { console.error(c.name + ': ' + r.stderr); if (process.env.SONG_DUMP) fs.copyFileSync(path.join(tmp, 'song.f64'), process.env.SONG_DUMP); process.exit(2); }
    const nat = [], natHits = [], natChoruses = [];
    r.stdout.split('\n').forEach(l => {
      const f = l.split(' ');
      if (l.startsWith('W ')) { const np = +f[11]; nat.push({ t: +f[1], end: +f[2], rest: +f[3], rootPc: +f[4], bassPc: +f[5], nextPc: +f[6], lock: +f[7] >= 0 ? 1 : 0, section: +f[8], slot: +f[9], pass: +f[10], pcs: f.slice(12, 12 + np).map(Number) }); }
      else if (l.startsWith('L ')) nat[nat.length - 1].melLock = +f[1] ? f[2] + ',' + f[3] : '';
      else if (l.startsWith('Q ')) nat[nat.length - 1].arp = f[1] === 'rest' ? null : f.slice(2, 2 + +f[1]).map(Number);
      else if (l.startsWith('V ')) { const nn = +f[7]; nat[nat.length - 1].act = { kind: 'V', onset: +f[1], vel: +f[2], dur: +f[3], hold: +f[4], holdSec: +f[5], sub: +f[6], notes: f.slice(8, 8 + nn).map(Number) }; }
      else if (l.startsWith('S ')) nat[nat.length - 1].act = { kind: 'S', onset: +f[1] };
      else if (l.startsWith('H ')) { const nn = +f[7]; natHits.push({ after: nat.length, kind: 'V', onset: +f[1], vel: +f[2], dur: +f[3], hold: +f[4], holdSec: +f[5], sub: +f[6], notes: f.slice(8, 8 + nn).map(Number) }); }
      else if (l.startsWith('C ')) natChoruses.push({ frame: +f[1], n: +f[2], bpm: +f[3], d: +f[4] });
      else if (l.startsWith('T ')) natHits.push({ after: nat.length, kind: 'S', onset: +f[1] });
    });
    const pg = c.recs;
    if (process.env.SONG_DEBUG) { console.log(c.name); console.log('page  ', pg.slice(-4).map(p => (p.t).toFixed(3) + '/' + p.section + '.' + p.slot).join(' ')); console.log('native', nat.slice(-4).map(n => (n.t / SR).toFixed(3) + '/' + n.section + '.' + n.slot).join(' ')); }
    // The engine runs a look-ahead ahead of the page's timers, so it may hold a chord or two more at the end of the run: the page's list is the prefix.
    let bad = null, worstT = 0;
    for (let k = 0; k < Math.min(pg.length, nat.length) && !bad; k++) {
      const p = pg[k], n = nat[k];
      const dt = Math.max(Math.abs(p.t * SR - n.t), Math.abs(p.end * SR - n.end));
      worstT = Math.max(worstT, dt);
      if (dt > 1e-5) bad = `chord ${k}: window ${p.t * SR}..${p.end * SR} on the page, ${n.t}..${n.end} native`;
      else if (p.section !== n.section || p.slot !== n.slot || p.pass !== n.pass) bad = `chord ${k}: at section ${p.section} chord ${p.slot} pass ${p.pass} on the page, ${n.section}/${n.slot}/${n.pass} native`;
      else if (p.rest !== n.rest || p.rootPc !== n.rootPc || p.bassPc !== n.bassPc || p.nextPc !== n.nextPc || p.lock !== n.lock || p.melLock !== n.melLock || p.pcs.join() !== n.pcs.join()) bad = `chord ${k}: ${JSON.stringify(p)} on the page, ${JSON.stringify(n)} native`;
    }
    if (!bad && nat.length < pg.length) bad = nat.length + ' chords native, ' + pg.length + ' on the page';
    const same = !bad && pg.length > 6, why = bad || '';
    ok(same && c.ok && (!c.locks || nat.filter(n => n.lock).length > 0), c.name + ': ' + pg.length + ' chords identical (worst timing ' + worstT.toExponential(1) + ' frames)', why + ' ' + (c.why || []).join(','));

    if (c.prac) {
      // each chorus' effects, in order: the tempo it stepped to (0: none) and the key it stepped by
      let cbad = null;
      const pc = c.chorusEvs, nc = natChoruses;
      for (let k = 0; k < pc.length && !cbad; k++) {
        const p = pc[k], n = nc[k];
        if (!n) cbad = `chorus ${k + 1}: the page ended one, the engine has ${nc.length}`;
        else if (p.n !== n.n || p.bpm !== n.bpm || p.d !== n.d) cbad = `chorus ${k + 1}: tempo ${p.bpm} key ${p.d} on the page, tempo ${n.bpm} key ${n.d} native`;
      }
      if (!cbad && nc.length < pc.length) cbad = pc.length + ' choruses on the page, ' + nc.length + ' native';
      const tempi = pc.filter(e => e.bpm).map(e => e.bpm).join('>'), keys = pc.filter(e => e.d).length;
      ok(!cbad && pc.length >= (c.prac.min || 3) && (!c.prac.ramp || tempi) && (!c.prac.key || keys), '    ...and the trainer steps the same: ' + pc.length + ' choruses, tempo ' + (tempi || 'unchanged') + ', ' + keys + ' key steps', cbad || '');
    }
    // The arp's chord for each chord: what the page's setArpChord left in arpNotes (or a rest, which leaves it alone) against the engine's.
    {
      let abad = null, nA = 0, nR = 0;
      for (let k = 0; k < Math.min(pg.length, nat.length) && !abad; k++) {
        const call = c.arpCalls.find(a => Math.abs(a.at - pg[k].t) < 1e-9);
        if (!call) { abad = `chord ${k}: the page never handed it to the arp (at ${pg[k].t})`; break; }
        if (call.rest !== (nat[k].arp === null)) { abad = `chord ${k}: ${call.rest ? 'a rest' : 'a chord'} on the page, ${nat[k].arp === null ? 'a rest' : 'a chord'} native`; break; }
        if (call.rest) { nR++; continue; }
        if (call.notes.join() !== nat[k].arp.join()) abad = `chord ${k}: the arp is on ${call.notes.join()} on the page, ${nat[k].arp.join()} native`;
        else nA++;
      }
      ok(!abad && nA + nR > 4, '    ...and the arp is handed the same tones (Octaves ' + c.arpOcts + '): ' + nA + ' chords, ' + nR + ' rests', abad || '');
    }
    // What each chord sounds like: the page's messages for it against the engine's action.
    if (process.env.SONG_DEBUG && /voicing/.test(c.name)) console.log(c.name + '\n  ' + nat.slice(0, 9).map(n => n.act && n.act.notes ? n.act.notes.join('.') : '-').join('  '));
    // The page's strike (its chord message and the release that goes with it) against the engine's action: '' when they are the same.
    const diff = (cm, rel, act, who) => {
      const notes = (cm.bass != null ? [cm.bass] : []).concat(cm.notes), sub = cm.bass != null ? cm.bass : cm.root;
      if (notes.join() !== act.notes.join()) return `${who}: notes ${notes.join()} on the page, ${act.notes.join()} native`;
      if (sub !== act.sub) return `${who}: sub ${sub} on the page, ${act.sub} native`;
      if (Math.abs(cm.vel - act.vel) > 1e-12) return `${who}: level ${cm.vel} on the page, ${act.vel} native`;
      if (Math.abs(cm.at * SR - act.onset) > 1e-5) return `${who}: struck at ${cm.at * SR} on the page, ${act.onset} native`;
      if ((cm.dur == null) !== !!act.hold) return `${who}: ${cm.dur == null ? 'held' : 'decaying'} on the page, ${act.hold ? 'held' : 'decaying'} native`;
      if (cm.dur != null && Math.abs(cm.dur - act.dur) > 1e-12) return `${who}: decays ${cm.dur} s on the page, ${act.dur} native`;
      if (cm.dur == null && !!rel !== (act.holdSec >= 0)) return `${who}: ${rel ? 'let go of' : 'held into the next chord'} on the page, holdSec ${act.holdSec} native`;
      if (rel && Math.abs((rel.at - cm.at) - act.holdSec) > 1e-9) return `${who}: let go ${rel.at - cm.at} s after on the page, ${act.holdSec} native`;
      return null;
    };
    let vbad = null, nChord = 0, nStop = 0, nRel = 0, nHold = 0, worstS = 0;
    for (let k = 0; k < Math.min(pg.length, nat.length) && !vbad; k++) {
      const t = pg[k].t, act = nat[k].act;
      // (a re-strike of the chord before that falls on this very moment was sent first, and is the same instant: the strike is the last)
      const cm = c.sounds.filter(m => m.kind === 'chord' && Math.abs(m.at - t) < 1e-9).pop();
      const rel = cm && c.sounds.find(m => m.kind === 'release' && m.id === cm.id);
      const st = c.sounds.find(m => m.kind === 'stop' && Math.abs(m.at - t) < 1e-9);
      if (!act) { vbad = `chord ${k}: the engine did nothing`; break; }
      if (pg[k].rest || c.chordsOff) {
        if (act.kind !== 'S' || !st) vbad = `chord ${k}: should only stop (page ${st ? 'stopped' : 'did not stop'}, engine ${act.kind})`;
        else { nStop++; worstS = Math.max(worstS, Math.abs(act.onset - st.at * SR)); if (Math.abs(act.onset - st.at * SR) > 1e-5) vbad = `chord ${k}: stop at ${st.at * SR} on the page, ${act.onset}`; }
        continue;
      }
      if (!cm) { vbad = `chord ${k}: the page struck nothing at ${t}`; break; }
      if (act.kind !== 'V') { vbad = `chord ${k}: the engine only stopped`; break; }
      vbad = diff(cm, rel, act, 'chord ' + k);
      if (!vbad) { nChord++; if (rel) nRel++; if (cm.dur == null) nHold++; worstS = Math.max(worstS, Math.abs(cm.at * SR - act.onset)); }
    }
    ok(!vbad && nChord + nStop > 6 && c.chordsOk, '    ...and sounds the same: ' + nChord + ' chords struck (' + nHold + ' held, ' + nRel + ' let go of), ' + nStop + ' stops, worst ' + worstS.toExponential(1) + ' frames',
       (vbad || '') + ' ' + (c.chordWhy || []).join(','));
    // The comp's re-strikes: the page's chord messages that are not a chord's first strike, in time order, against the engine's hits.
    if (c.comps) {
      const starts = pg.map(p => p.t);
      // A re-strike of the chord before that falls on the very frame the next chord starts is replaced by that chord's strike, whichever side of the frame its rounding
      // put it: left out of both.
      const onStart = f => starts.some(t => Math.abs(f - t * SR) < 1);
      const pgHits = c.sounds.filter(m => m.kind === 'chord' && !onStart(m.at * SR)).map((m, i) => ({ m, i })).sort((a, b) => a.m.at - b.m.at || a.i - b.i).map(x => x.m);
      // (the engine's own are those printed before the chord they land on: the last re-strikes of the chord before. One printed after it is the chord's own first
      // position struck again, which the page never does, and stays in to be found)
      const natHits2 = natHits.filter(h => { const j = starts.findIndex(t => Math.abs(h.onset - t * SR) < 1); return j < 0 || h.after > j; });
      natHits.length = 0; natHits2.forEach(h => natHits.push(h));
      let hbad = null, nH = 0, nHRel = 0, nHStop = 0;
      for (let k = 0; k < pgHits.length && !hbad; k++) {
        const cm = pgHits[k], act = natHits[k];
        if (!act) { hbad = `hit ${k}: the engine has ${natHits.length} hits, the page ${pgHits.length}`; break; }
        if (c.chordsOff) { if (act.kind !== 'S' || Math.abs(act.onset - cm.at * SR) > 1e-5) hbad = `hit ${k}: should only stop, at ${cm.at * SR}`; else nHStop++; continue; }
        if (act.kind !== 'V') { hbad = `hit ${k}: the engine only stopped`; break; }
        const rel = c.sounds.find(m => m.kind === 'release' && m.id === cm.id);
        hbad = diff(cm, rel, act, 'hit ' + k);
        if (!hbad) { nH++; if (rel) nHRel++; }
      }
      if (hbad && process.env.SONG_DEBUG) {
        const k0 = Math.max(0, +(hbad.match(/hit (\d+)/) || [0, 0])[1] - 4);
        for (let k = k0; k < k0 + 9; k++) console.log('  hit ' + k + ': page ' + (pgHits[k] ? (pgHits[k].at * SR).toFixed(2) + ' ' + pgHits[k].notes + (pgHits[k].bass != null ? '/' + pgHits[k].bass : '') : '-') + '   native ' + (natHits[k] ? natHits[k].onset.toFixed(2) + ' ' + natHits[k].notes : '-'));
        console.log('  chord starts: ' + pg.slice(0, 14).map(p => (p.t * SR).toFixed(0)).join(' '));
      }
      // the engine plays hits a look-ahead further than the page's run lasts, never fewer, and none out of time order
      if (!hbad && natHits.length < pgHits.length) hbad = `${natHits.length} hits native, ${pgHits.length} on the page`;
      for (let k = 1; k < natHits.length && !hbad; k++) if (natHits[k].onset < natHits[k - 1].onset) hbad = `hit ${k} is earlier than the one before`;
      ok(!hbad && nH + nHStop > (c.minHits || 6), '    ...and its rhythm re-strikes the same: ' + nH + ' hits (' + nHRel + ' gated, let go of)' + (nHStop ? ', ' + nHStop + ' stops' : ''), (hbad || '') + ' (page ' + pgHits.length + ', engine ' + natHits.length + ')');
    }
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
