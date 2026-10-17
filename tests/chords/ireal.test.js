/* iReal Pro chord symbols -> the chord model.
   Run: node tests/chords/ireal.test.js

   The import was written before the chord model and held back for it (the
   revert note on v4.7.2 says so). The reason is the list at the bottom of
   this file: _irealQ maps a quality onto triadQ/type7/ext, which hold ONE
   tension, so 17 of iReal Pro's 58 published qualities arrived as a
   different chord from the one on the chart — 7b5 had a natural fifth and a
   #11 and no flat five anywhere, 13b9 lost its thirteenth, 9sus lost its
   ninth. Going through parseChordSymbol instead gives the slot real ivs.

   _irealQ is still the fallback for anything the parser cannot read in full,
   so it is tested too, and the comparison is the point of the file. */
'use strict';
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const key = a => a.slice().sort((x, y) => x - y).join(',');
const ivsOf = q => { const s = M._irealSymbol('C' + q); const p = s && M.parseChordSymbol(s); return p ? p.ivs : null; };

// iReal Pro's published chord-quality list, from the custom chord chart
// protocol. Every one of them has to become a chord we can play.
const QUALITIES = ['5','2','add9','+','o','h','sus','^','-','^7','-7','7','7sus','h7','o7','^9','^13',
 '6','69','^7#11','^9#11','^7#5','-6','-69','-^7','-^9','-9','-11','-7b5','h9','-b6','-#5','9','7b9',
 '7#9','7#11','7b5','7#5','9#11','9b5','9#5','7b13','7#9#5','7#9b5','7#9#11','7b9#11','7b9b5','7b9#5',
 '7b9#9','7b9b13','7alt','13','13#11','13b9','13#9','9sus','13sus','11'];

// ── Every quality reaches a chord ───────────────────────────────────────────
{
  const unread = QUALITIES.filter(q => !ivsOf(q));
  ok(unread.length === 0, 'all ' + QUALITIES.length + ' iReal qualities parse; these did not: ' +
    unread.map(q => 'C' + q + ' -> ' + M._irealSymbol('C' + q)).join(', '));
}

// ── The spellings that are easy to get backwards ────────────────────────────
// iReal is asymmetric here and a wrong guess is silent: every chord still
// sounds, just not the one on the chart.
{
  const same = (q, sym, msg) => {
    const got = ivsOf(q), want = M.parseChordSymbol(sym);
    ok(got && want && key(got) === key(want.ivs),
      msg + ' — C' + q + ' should be ' + sym + ', got [' + (got || []) + ']');
  };
  same('-',   'Cm',      'a bare dash is a minor TRIAD');
  same('^',   'Cmaj7',   'a bare triangle is a major SEVENTH, not a triad');
  same('h',   'Cm7b5',   'a bare slashed circle is half-diminished, a seventh chord');
  same('o',   'Cdim',    'a bare ring is a diminished TRIAD');
  same('o7',  'Cdim7',   'with a 7 it is the diminished seventh');
  same('-^7', 'CmMaj7',  'dash-triangle is minor-major');
  same('+',   'Caug',    'plus is augmented');
  same('sus', 'Csus4',   'a bare sus is sus4');
  same('7sus','C7sus4',  'and so is 7sus');
  same('2',   'Cadd9',   'iReal writes an added ninth as 2');
  same('h9',  'Cm9b5',   'h9 keeps its ninth');
}

// ── The ones the old one-tension mapping got wrong ──────────────────────────
// Each of these is a chord that used to arrive as a different chord. The
// assertion is the note set, named, so a regression says what broke.
{
  const has = (q, n) => { const i = ivsOf(q); return i && i.indexOf(n) >= 0; };
  const lacks = (q, n) => { const i = ivsOf(q); return i && i.indexOf(n) < 0; };

  ok(has('13b9', 13) && has('13b9', 21), '13b9 keeps BOTH its flat ninth and its thirteenth');
  ok(has('13#9', 15) && has('13#9', 21), '13#9 keeps both too');
  ok(has('7#9b13', 15) && has('7#9b13', 20), '7#9b13 keeps both');
  ok(has('7b9#11', 13) && has('7b9#11', 18), '7b9#11 keeps both');
  ok(has('7b9#9', 13) && has('7b9#9', 15), '7b9#9 has a flat NINE and a sharp nine');
  ok(has('7b9b13', 13) && has('7b9b13', 20), '7b9b13 keeps both');

  // A flat five is a flat five, not a sharp eleven — different note, and the
  // natural fifth has to go.
  ok(has('7b5', 6) && lacks('7b5', 7), '7b5 has a flat fifth and no natural fifth');
  ok(has('9b5', 6) && lacks('9b5', 7) && has('9b5', 14), '9b5 as well, with its ninth');
  ok(has('7b9b5', 6) && lacks('7b9b5', 7), 'and 7b9b5');
  ok(has('7#9b5', 6) && lacks('7#9b5', 7), 'and 7#9b5');

  // A sharp eleven is not a ninth. These used to gain a 9 nobody wrote.
  ok(lacks('7#11', 14) && has('7#11', 18), '7#11 is a sharp eleven with no ninth added');
  ok(lacks('^7#11', 14) && has('^7#11', 18), 'and maj7#11');
  ok(has('7#9#11', 15) && has('7#9#11', 18), '7#9#11 keeps both');
  ok(has('13#11', 18) && has('13#11', 21), '13#11 keeps both');

  // Sus chords with a number: the number is a note, and it used to vanish.
  ok(has('9sus', 14) && has('9sus', 5), '9sus has a ninth AND its fourth');
  ok(has('13sus', 21) && has('13sus', 5), '13sus has a thirteenth and its fourth');

  // A raised fifth on a minor triad used to be dropped entirely.
  ok(has('-#5', 8) && lacks('-#5', 7), '-#5 is a minor triad with a raised fifth');
}

// ── The fallback still works ────────────────────────────────────────────────
// _irealQ is no longer the main path but is still reached for anything the
// parser refuses, so it must keep answering.
{
  const q = M._irealQ('7');
  ok(q && typeof q.triadQ === 'number' && q.type7 === 'dom7', '_irealQ still maps a dominant seventh');
  ok(M._irealQ('') .ext === 'triad', '_irealQ still maps a bare triad');
  ok(M._irealPc('Bb') === 10 && M._irealPc('F#') === 6, '_irealPc reads accidentals');
}

// ── Roots and slash basses ──────────────────────────────────────────────────
{
  const s = M._irealSymbol('Bb-7');
  ok(M.parseChordSymbol(s) && M.parseChordSymbol(s).root === 10, 'a flat root survives: ' + s);
  const sl = M._irealSymbol('C7/E');
  const p = M.parseChordSymbol(sl);
  ok(p && p.bass === 4, 'a slash bass survives: ' + sl);
  ok(M._irealSymbol('') === null, 'nothing in, nothing out');
  ok(M._irealSymbol('n') === null, 'iReal\'s no-chord is not a chord');
}

// ── How many changed, as a number ───────────────────────────────────────────
// Not an assertion about which is right — the assertions above are that —
// but a count, so a change to either path is visible rather than quiet.
{
  let changed = 0;
  for (const q of QUALITIES) {
    const nw = ivsOf(q);
    let old = null;
    try { const o = M._irealQ(q); old = M.getIntvs(o.triadQ, o.type7 === 'none' ? null : o.type7, o.ext); } catch (e) {}
    if (!old || !nw || key(old) !== key(nw)) changed++;
  }
  ok(changed === 17, 'the chord model changes 17 of the 58 qualities (got ' + changed + ') — ' +
    'if this moved, something in either mapping moved with it');
}

console.log((fail ? 'FAIL' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
