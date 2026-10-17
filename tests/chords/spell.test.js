/* spellChord: an interval set -> the name a player would write.
   Run: node tests/chords/spell.test.js

   The test that matters is the ROUND TRIP: whatever spellChord returns, fed
   back through parseChordSymbol, must be the same notes it was given. A
   speller that is merely plausible puts a name on screen that is not the
   chord being played — which is the exact bug the chord model exists to fix,
   so a name that does not parse back is a failure, not a cosmetic one.

   It runs over every symbol in tonal-fixture.json (219 of them, Tonal's whole
   dictionary) plus every quality the app's own EXTS menu can build, in all
   twelve roots. Readability is checked separately and by hand, below: the
   round trip alone would accept "Cadd4add10add14" for Cmaj9. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const same = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, msg + '\n    want ' + w + '\n    got  ' + g);
};
const key = a => a.slice().sort((x, y) => x - y).join(',');

// ── The round trip, over Tonal's whole dictionary ───────────────────────────
// Every symbol the parser accepts: parse it, spell those notes, parse the
// spelling, and the notes must be identical. Not "the same pitch classes" —
// identical, because where a tension sits (9 vs 2) is what it sounds like.
{
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'tonal-fixture.json'), 'utf8'));
  const syms = (Array.isArray(fixture) ? fixture : Object.keys(fixture))
    .map(x => (typeof x === 'string' ? x : x.symbol)).filter(Boolean);
  let tried = 0, bad = [];
  for (const sym of syms) {
    const c = M.parseChordSymbol(sym);
    if (!c) continue;                       // the 7 named voicings it refuses
    tried++;
    const spelled = M.spellChord(c.root, c.ivs, c.bass);
    const back = M.parseChordSymbol(spelled);
    if (!back) { bad.push(sym + ' -> "' + spelled + '" does not parse'); continue; }
    if (key(back.ivs) !== key(c.ivs)) {
      bad.push(sym + ' -> "' + spelled + '" = [' + back.ivs + '], wanted [' + c.ivs + ']');
    }
  }
  ok(tried > 180, 'the fixture gave us ' + tried + ' parseable symbols to spell');
  ok(bad.length === 0, bad.length + ' of ' + tried + ' did not round-trip:\n      ' +
    bad.slice(0, 25).join('\n      ') + (bad.length > 25 ? '\n      …' : ''));
}

// ── The round trip, over the app's own quality menu ─────────────────────────
// Every chord a user can build from the Type row and the More picker, in all
// twelve roots. These are the sets that actually reach _slotExtSuffix.
{
  const t7s = [null].concat(['maj7', 'min7', 'dom7', 'halfdim', 'dim7', 'minMaj7', 'augMaj7', 'aug7']);
  let tried = 0, bad = [];
  for (const ext of Object.keys(M.EXTS)) {
    for (let q = 0; q < 4; q++) {
      for (const t7 of t7s) {
        let ivs;
        try { ivs = M.EXTS[ext](q, t7); } catch (e) { continue; }
        if (!ivs || !ivs.length) continue;
        for (let r = 0; r < 12; r++) {
          tried++;
          const spelled = M.spellChord(r, ivs, null);
          const back = M.parseChordSymbol(spelled);
          if (!back) { bad.push(ext + '/q' + q + '/' + t7 + ' [' + ivs + '] -> "' + spelled + '" unparseable'); continue; }
          if (back.root !== r) { bad.push('"' + spelled + '" came back rooted on ' + back.root + ', not ' + r); continue; }
          if (key(back.ivs) !== key(ivs)) {
            bad.push(ext + '/q' + q + '/' + t7 + ' -> "' + spelled + '" = [' + back.ivs + '], wanted [' + ivs + ']');
          }
        }
      }
    }
  }
  ok(tried > 1000, 'the quality menu gave us ' + tried + ' chords to spell');
  // Dedupe: the same failure repeats in all twelve roots.
  const uniq = [...new Set(bad.map(b => b.replace(/^"[A-G][♯♭]?/, '"').replace(/rooted on \d+, not \d+/, 'rooted wrong')))];
  ok(bad.length === 0, uniq.length + ' distinct failures (' + bad.length + ' with roots):\n      ' +
    uniq.slice(0, 25).join('\n      ') + (uniq.length > 25 ? '\n      …' : ''));
}

// ── Readability — by hand, because the round trip cannot judge it ───────────
// These are the names that go on screen, so they have to be the ones a player
// would write, not merely a set of notes that parses back.
{
  const s = sym => { const c = M.parseChordSymbol(sym); return c ? M.spellChord(c.root, c.ivs, c.bass) : null; };

  ok(s('C') === 'C', 'a major triad is its letter: ' + s('C'));
  ok(s('Cm') === 'Cm', 'minor: ' + s('Cm'));
  ok(s('C7') === 'C7', 'dominant seventh: ' + s('C7'));
  ok(s('Cmaj7') === 'Cmaj7', 'major seventh: ' + s('Cmaj7'));
  ok(s('Cm7') === 'Cm7', 'minor seventh: ' + s('Cm7'));
  ok(s('C9') === 'C9', 'a ninth is called nine, not 7add9: ' + s('C9'));
  ok(s('C13') === 'C13', 'a thirteenth: ' + s('C13'));
  ok(s('Cmaj9') === 'Cmaj9', 'major ninth: ' + s('Cmaj9'));
  ok(s('C6') === 'C6', 'a sixth: ' + s('C6'));
  ok(s('Csus4') === 'Csus4', 'sus4: ' + s('Csus4'));
  ok(s('Csus2') === 'Csus2', 'sus2: ' + s('Csus2'));
  ok(s('C5') === 'C5', 'a power chord: ' + s('C5'));
  ok(s('Cdim') === 'Cm♭5', 'a diminished triad is a minor with a flat five: ' + s('Cdim'));
  ok(s('Cdim7') === 'C°7', 'a diminished seventh keeps its ring: ' + s('Cdim7'));
  ok(s('Cm7b5') === 'Cm7♭5', 'half-diminished: ' + s('Cm7b5'));
  // "C♯5" would read back as a C♯ power chord — the accidental glues to the
  // root letter with nothing between them — so a bare altered fifth is named
  // with a word. Both of these are also what a player writes.
  ok(s('Caug') === 'Caug', 'augmented is spelled out: ' + s('Caug'));
  ok(s('CMb5') === 'Cmaj♭5', 'and so is a flat-five triad: ' + s('CMb5'));
  ok(s('C7#5') === 'C7♯5', 'with a seventh in the way, the accidental is safe: ' + s('C7#5'));
  ok(s('Cadd9') === 'Cadd9', 'an added ninth has no seventh, so it is an add: ' + s('Cadd9'));

  // The bug this function exists for: a chord with two tensions.
  ok(s('C13b9') === 'C13♭9', 'two tensions at once, which the old model could not hold: ' + s('C13b9'));
  ok(s('C7#9b13') === 'C7♯9♭13', 'and another: ' + s('C7#9b13'));
  ok(s('C7b9#11') === 'C7♭9♯11', 'and another: ' + s('C7b9#11'));

  // Flats, and a slash bass.
  ok(s('Ebm7') === 'E♭m7', 'a black-note root spells flat: ' + s('Ebm7'));
  ok(s('C/G') === 'C/G', 'the slash bass comes back: ' + s('C/G'));
  ok(s('C/E') === 'C/E', 'and an inversion: ' + s('C/E'));
  ok(s('C/C') === 'C', 'a bass that is the root is not written');
  ok(M.spellChord(0, [0, 4, 7], 0) === 'C', 'nor passed in as one');

  // Not the chord number when the stack is broken.
  const noNinth = M.parseChordSymbol('C7');
  const with13 = { root: 0, ivs: noNinth.ivs.concat([21]) };
  ok(s('C7') === 'C7' && M.spellChord(0, with13.ivs, null).indexOf('13') > 0,
    '1 3 5 ♭7 13 mentions its thirteenth');
  ok(M.spellChord(0, with13.ivs, null) === 'C7add13',
    '...as an add, not as C13 — there is no ninth under it: ' + M.spellChord(0, with13.ivs, null));

  // Missing notes are said only when reading the name back would put them
  // in. These are the ugly-but-correct names; the round trip above is why
  // they are spelled at all.
  ok(s('C7no5') === 'C7no5', 'a seventh with no fifth says so: ' + s('C7no5'));
  ok(s('C9no5') === 'C9no5', 'and a ninth: ' + s('C9no5'));
  ok(s('C5') === 'C5', 'a power chord is not "Cno3" — it is the name for it');
  ok(s('Csus4') === 'Csus4', 'a sus chord has no third and does not need to say so');
  ok(s('C11') === 'C11', 'a dominant 11 has no third by definition, so it stays silent: ' + s('C11'));
  ok(s('Cm11') === 'Cm11', 'a minor 11 keeps its third: ' + s('Cm11'));
  ok(s('C7alt') === 'Calt', 'the altered dominant is a name, not a stack: ' + s('C7alt'));

  // A 13th that skips its 11th is still a 13th; one that skips its 9th is not.
  ok(s('C13') === 'C13', 'a 13th with no 11th is a 13th');
  // 1 3 5 ♭7 9 11 is not an 11 chord — an 11 chord has no third.
  ok(M.spellChord(0, [0, 4, 7, 10, 14, 17], null) === 'C9add11',
    'a dominant with a third AND an 11th is a 9 with an add: ' + M.spellChord(0, [0, 4, 7, 10, 14, 17], null));

  // The low octave is a different degree from the high one.
  ok(s('C7add6') === 'C7add6', '9 semitones is a 6th, not a 13th: ' + s('C7add6'));
  ok(s('Cmadd4') === 'Cmadd4', '5 semitones is a 4th, not an 11th: ' + s('Cmadd4'));
  ok(s('Cadd2') === 'Cadd2', '2 semitones is a 2nd, not a 9th: ' + s('Cadd2'));
  ok(s('C69') === 'C6/9', 'six-nine: ' + s('C69'));

  ok(M.spellChord(0, [], null) === '', 'no notes, no name');
  ok(M.spellChord(0, null, null) === '', 'no set, no name');
}

// ── Against the slots the app actually holds ────────────────────────────────
// _slotExtSuffix's job: name a slot whose ext cannot say what it is. The
// "Dm" + "b9" case from the plan.
{
  const ivs = M.getIntvs(1, 'min7', 'b9');
  const spelled = M.spellChord(2, ivs, null);
  const back = M.parseChordSymbol(spelled);
  ok(back && key(back.ivs) === key(ivs),
    'the Dm/b9 slot names itself as something that parses back: ' + spelled);
  ok(/^D/.test(spelled), '...rooted on D: ' + spelled);
  ok(spelled.indexOf('♭9') > 0, '...and says ♭9 rather than dropping it: ' + spelled);
}

console.log((fail ? 'FAIL' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
