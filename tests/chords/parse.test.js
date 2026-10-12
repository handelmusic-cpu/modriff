/* The general chord model: parseChordSymbol, chordFromSlot, chordEngineEvent.
   Run: node tests/chords/parse.test.js

   1. Every symbol in Tonal.js's chord dictionary (tonal-fixture.json) parses
      to the notes Tonal gives it, except the differences listed below — each
      one a decision, written down with its reason.
   2. Symbols no dictionary holds, which is the point of not using one.
   3. Every EXTS quality the app plays today, spelled as a symbol, parses to
      the notes the app already plays for it.
   4. chordFromSlot reads an old slot exactly as getIntvs does.
   5. chordEngineEvent: the message a native engine receives. */
'use strict';
const load = require('./load');
const fixture = require('./tonal-fixture.json');
const M = load();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const pcs = a => [...new Set(a.map(x => ((x % 12) + 12) % 12))].sort((x, y) => x - y).join(',');
const ivs = s => { const c = M.parseChordSymbol(s); return c ? c.ivs.join(',') : 'NULL'; };

// ── 1. Tonal's dictionary ───────────────────────────────────────────────────
// Where Tonal and this parser part ways on purpose. Tonal is a dictionary, and
// a hand-written one is not consistent with itself; the parser applies one
// rule everywhere, so it agrees with the dictionary's majority and not its
// exceptions.
const DIFFERS = {
  // ♭5 replaces the fifth, always. Tonal does that for Cm7♭5 and C9♭5 but
  // reads it as an added ♯11 over a natural fifth in these.
  'CM6b5': 'b5', 'C6b5': 'b5', 'C7b5b13': 'b5', 'C7b5#9': 'b5', 'C7#9b5': 'b5',
  'C9b5b13': 'b5', 'C7b5b9': 'b5', 'C7b9b5': 'b5', 'C7b5b9b13': 'b5',
  // ♭13 / ♭6 is added and the fifth stays. Tonal keeps the fifth in C7♯9♭13
  // and CmMaj7♭6 but drops it in these.
  'C7b13': 'b13', 'C9b13': 'b13', 'CM7b6': 'b13', 'C^7b6': 'b13', 'Cmb6M7': 'b13', 'Cmb6b9': 'b13',
  // alt is the app's own: 1 3 ♭7 ♭9 ♯9 ♭13, as EXTS.alt has always played it.
  // Tonal's 7alt has no ♭9 or ♭13 at all.
  'C7alt': 'alt', 'Calt7': 'alt',
  // add13 adds a 13th. Tonal's M7add13 also adds a 9th nobody wrote.
  'CM7add13': 'add',
  // Refused rather than guessed: named voicings and spellings with no one
  // reading. A refusal is visible; a guess is a wrong chord.
  'C67': 'refused', 'Co7M7': 'refused', 'C4': 'refused', 'Cquartal': 'refused',
  'Csus24': 'refused', 'Cm11A': 'refused', 'Cphryg': 'refused',
};
let exact = 0, octave = 0;
for (const [sym, want] of Object.entries(fixture)) {
  const c = M.parseChordSymbol(sym);
  const agrees = c && pcs(c.ivs) === pcs(want);
  if (DIFFERS[sym]) {
    // A listed difference that has stopped differing should come off the list.
    ok(!agrees, sym + ' is listed as differing from Tonal (' + DIFFERS[sym] + ') but now agrees');
    if (DIFFERS[sym] === 'refused') ok(c === null, sym + ' should be refused, got ' + ivs(sym));
    continue;
  }
  ok(agrees, sym + ': tonal ' + want.join(',') + ', parsed ' + ivs(sym));
  if (agrees) { if (c.ivs.join(',') === want.join(',')) exact++; else octave++; }
}
console.log('  tonal: ' + exact + ' exact, ' + octave + ' same notes in another octave, ' +
  Object.keys(DIFFERS).length + ' listed differences, of ' + Object.keys(fixture).length);

// ── 2. Beyond any dictionary ────────────────────────────────────────────────
const CASES = {
  'C13b9':        '0,4,7,10,13,21',      // the chord the old model could not hold
  'C13♭9':        '0,4,7,10,13,21',
  'C7b5b9#9b13':  '0,4,6,10,13,15,20',   // empty in Tonal
  'Calt':         '0,4,10,13,15,20',     // empty in Tonal
  'C7(b9,#11,13)':'0,4,7,10,13,18,21',
  'C9#11b13':     '0,4,7,10,14,18,20',
  'C-7':          '0,3,7,10',            // jazz minor
  'C7-9':         '0,4,7,10,13',         // ...and a later "-" is a flat
  'C+7':          '0,4,8,10',
  'C7+9':         '0,4,7,10,15',
  'CΔ':           '0,4,7,11',
  'Cmaj':         '0,4,7',
  'Cmaj#11':      '0,4,7,11,18',
  'Cm(maj7)':     '0,3,7,11',
  'Cø':           '0,3,6,10',
  'C°7':          '0,3,6,9',
  'C6/9':         '0,4,7,9,14',
  'Cm69':         '0,3,7,9,14',
  'C7sus4':       '0,5,7,10',
  'C9sus4':       '0,5,7,10,14',
  'Csus':         '0,5,7',
  'C7omit3':      '0,7,10',
  'Cmadd9':       '0,3,7,14',
  'C11':          '0,7,10,14,17',        // dominant 11 drops its third
  'Cm11':         '0,3,7,10,14,17',
  'Cadd11':       '0,4,7,17',            // ...and asking for it keeps it
  'C5':           '0,7',
};
for (const [sym, want] of Object.entries(CASES)) ok(ivs(sym) === want, sym + ': want ' + want + ', got ' + ivs(sym));

// Roots, accidentals and slash basses.
{
  const r = s => { const c = M.parseChordSymbol(s); return c && [c.root, c.bass]; };
  ok(String(r('F#m7')) === '6,', 'F#m7 root 6');
  ok(String(r('B♭maj7')) === '10,', 'B♭maj7 root 10');
  ok(String(r('Bb9')) === '10,', 'Bb9 is B♭ ninth, not B ♭9');
  ok(String(r('C13b9/E')) === '0,4', 'C13b9/E bass 4');
  ok(String(r('Am7/G')) === '9,7', 'Am7/G bass 7');
  ok(String(r('C/C')) === '0,', 'a slash to the root is no slash');
  ok(ivs('C6/9/E') === '0,4,7,9,14' && M.parseChordSymbol('C6/9/E').bass === 4, '6/9 with a slash bass');
}
// Strict: anything not understood in full is refused, not half-played.
['', 'H7', 'Cxyz', 'C7b9q', 'C99', 'c7', null, 7].forEach(s =>
  ok(M.parseChordSymbol(s) === null, JSON.stringify(s) + ' should be refused'));

// ── 3. What the app plays today, by name ────────────────────────────────────
// Each EXTS quality on the chord it is usually on, against the symbol a
// player would write for it. If these drift apart, a chord typed by name
// sounds different from the same chord picked from the quality menu.
const APP = [
  ['triad', 0, null, 'C'], ['triad', 1, null, 'Cm'], ['triad', 2, null, 'Cdim'], ['triad', 3, null, 'Caug'],
  ['7th', 0, 'dom7', 'C7'], ['7th', 0, 'maj7', 'Cmaj7'], ['7th', 1, 'min7', 'Cm7'],
  ['7th', 2, 'halfdim', 'Cm7b5'], ['7th', 2, 'dim7', 'Cdim7'], ['7th', 1, 'minMaj7', 'CmMaj7'],
  ['9th', 0, 'dom7', 'C9'], ['9th', 0, 'maj7', 'Cmaj9'], ['9th', 1, 'min7', 'Cm9'],
  ['sus2', 0, null, 'Csus2'], ['sus4', 0, null, 'Csus4'], ['add9', 0, null, 'Cadd9'], ['add9', 1, null, 'Cmadd9'],
  ['6th', 0, null, 'C6'], ['6th', 1, null, 'Cm6'], ['69', 0, null, 'C69'],
  ['11th', 1, 'min7', 'Cm11'], ['#11', 0, 'dom7', 'C9#11'],
  ['13th', 0, 'dom7', 'C13'], ['13th', 1, 'min7', 'Cm13'], ['13th', 0, 'maj7', 'Cmaj13'],
  ['b9', 0, 'dom7', 'C7b9'], ['#9', 0, 'dom7', 'C7#9'], ['b13', 0, 'dom7', 'C7b13'],
  ['alt', 0, 'dom7', 'C7alt'], ['7sus4', 0, 'dom7', 'C7sus4'], ['maj9', 0, null, 'Cmaj9'],
  ['dim7', 2, null, 'Cdim7'], ['aug', 0, null, 'Caug'], ['power', 0, null, 'C5'],
];
APP.forEach(([ext, q, t7, sym]) => {
  const app = M.getIntvs(q, t7, ext).slice().sort((a, b) => a - b).join(',');
  ok(app === ivs(sym), ext + '/' + q + '/' + t7 + ' plays ' + app + ' but ' + sym + ' parses ' + ivs(sym));
});
// The one known disagreement, kept visible: the app's '11th' on a dominant
// stacks the 11th over the major third; the symbol C11 drops the third. Which
// the app should do is a musical call, not a parser one.
ok(M.getIntvs(0, 'dom7', '11th').join(',') === '0,4,7,10,14,17' && ivs('C11') === '0,7,10,14,17',
  "app '11th' on dom7 keeps the 3rd, C11 drops it — update this note if either changes");

// ── 4. Old slots read through unchanged ─────────────────────────────────────
{
  let n = 0, same = 0;
  Object.keys(M.EXTS).forEach(ext => [0, 1, 2, 3].forEach(q =>
    [null, 'maj7', 'min7', 'dom7', 'halfdim', 'dim7', 'minMaj7', 'augMaj7', 'aug7'].forEach(t7 => {
      const slot = { rootM: 62, triadQ: q, type7: t7, ext: ext, bassNote: null };
      const c = M.chordFromSlot(slot);
      n++;
      if (c.ivs.join(',') === M.getIntvs(q, t7, ext).join(',') && c.root === 2 && c.rootM === 62) same++;
    })));
  ok(same === n, 'chordFromSlot matches getIntvs on ' + same + '/' + n + ' old slots');
  ok(M.chordFromSlot({ rootM: 60, triadQ: 0, type7: null }).ivs.join(',') === '0,4,7', 'a slot with no ext is a triad');
  ok(M.chordFromSlot({ rootM: 60, triadQ: 0, ext: 'triad', ivs: [0, 4, 7, 10, 13, 21] }).ivs.join(',') === '0,4,7,10,13,21',
    'a slot with its own ivs uses them');
  ok(M.chordFromSlot({ rootM: 57, triadQ: 1, bassNote: 43 }).bass === 7, 'bass note read as a pitch class');
  ok(M.chordFromSlot({ isRest: true }) === null && M.chordFromSlot(null) === null, 'rests and nothing are null');
  const s = { rootM: 60, triadQ: 0, ivs: [0, 4, 7] };
  M.chordFromSlot(s).ivs.push(99);
  ok(s.ivs.length === 3, 'chordFromSlot does not hand out the slot\'s own array');
}

// ── 5. The engine message ───────────────────────────────────────────────────
{
  const e = M.chordEngineEvent(M.parseChordSymbol('C13b9/E'), 60, { vel: 0.9, at: 1.25, dur: 0.5, part: 'chord' });
  ok(e.v === 1 && e.kind === 'chord', 'versioned message');
  ok(e.notes.join(',') === '60,64,67,70,73,81', 'C13b9 at middle C: ' + e.notes);
  ok(e.bass === 52, 'slash E under the chord: ' + e.bass);
  ok(e.vel === 0.9 && e.at === 1.25 && e.dur === 0.5 && e.part === 'chord', 'timing and part carried');
  ok(JSON.stringify(JSON.parse(JSON.stringify(e))) === JSON.stringify(e), 'survives a JSON round trip (the bridge)');
  const held = M.chordEngineEvent(M.parseChordSymbol('Am7'), 57);
  ok(held.dur === null && held.vel === 0.8 && held.at === 0, 'defaults: held, 0.8, now');
  ok(held.id !== e.id, 'each message has its own id, so a release can name it');
  const voiced = M.chordEngineEvent(M.parseChordSymbol('Cmaj7'), 60, { ivs: [-1, 4, 7, 12] });
  ok(voiced.notes.join(',') === '59,64,67,72', 'already-voiced intervals win over the raw set');
  const low = M.chordEngineEvent(M.parseChordSymbol('C/G'), 60, { ivs: [-5, 0, 4] });
  ok(low.bass < Math.min(...low.notes), 'the bass stays under a voicing that reaches below the root');
  const edge = M.chordEngineEvent(M.parseChordSymbol('C13'), 120);
  ok(edge.notes.every(n => n >= 0 && n <= 127 && Number.isInteger(n)), 'notes clamp to MIDI range');
}

console.log((fail ? 'FAIL' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
