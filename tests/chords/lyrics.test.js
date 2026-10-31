/* Words as data: a chord sheet's lyrics land on the slots (slot.lyr, slot.ln).
   Run: node tests/chords/lyrics.test.js

   _sheetLyrics cuts each line of words at the columns its chords sat over, so the
   slot that starts a syllable carries it. The invariants are the ones the editor
   and the Stage view lean on: one entry per chord (or null when the sheet and the
   chords disagree, so words never land on the wrong chord), the words come out in
   the order they went in, and a chord-only sheet gains nothing. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), msg + '\n    want ' + JSON.stringify(want) + '\n    got  ' + JSON.stringify(got));
const words = t => M.parseChordSheet(t).sections.map(s => M._sheetLyrics(s));
// a new line starts where `ln` says so, so that is where the words part (the last
// word of one line never carries a trailing space of its own)
const joined = w => w.map(x => (x.ln ? ' ' : '') + x.lyr).join('').replace(/\s+/g, ' ').trim();

// padded columns: the cut follows the chord, not the word
{
  const [w] = words('[Verse]\nC       G       Am\nAmazing grace how sweet\n');
  eq(w.map(x => x.lyr), ['Amazing ', 'grace ho', 'w sweet'], 'padded: cut at the column each chord sat over');
  eq(w.map(x => x.ln), [true, false, false], 'padded: only the first chord starts the line');
  eq(joined(w), 'Amazing grace how sweet', 'padded: nothing lost, order kept');
}
// inline ChordPro: chord brackets sit in the text
{
  const [w] = words('[Verse]\n[C]Amazing [G]grace how [Am]sweet\n');
  eq(w.map(x => x.lyr), ['Amazing ', 'grace how ', 'sweet'], 'inline: the words follow their bracket');
  eq(joined(w), 'Amazing grace how sweet', 'inline: order kept');
}
// compact list (no column info): words shared out evenly, extras to the front
{
  const [w] = words('[Verse]\nC G Am F\nsome words here today\n');
  eq(w.map(x => x.lyr), ['some ', 'words ', 'here ', 'today'], 'compact: one word each');
  const [v] = words('[Verse]\nC G\none two three\n');
  eq(joined(v), 'one two three', 'compact: uneven split keeps every word');
  eq(v[0].lyr.split(' ').filter(Boolean).length >= v[1].lyr.split(' ').filter(Boolean).length, true, 'compact: the front takes the extra word');
}
// chord-only sheets gain nothing but a line start
{
  const [w] = words('[Verse]\nC G Am F\n');
  eq(w.every(x => x.lyr === ''), true, 'chord-only: no words invented');
  eq(w.map(x => x.ln), [true, false, false, false], 'chord-only: one line start');
}
// a repeat line reuses the line before it
{
  const [w] = words('[Verse]\nC G\nla la\n(repeat)\n');
  ok(w === null || w.length === 2, 'repeat marker never adds entries beyond the chords');
}
// sheet and chords disagreeing: null, never a guess
{
  const sec = M.parseChordSheet('[Verse]\nC G Am F\nsome words\n').sections[0];
  const broken = Object.assign({}, sec, { chords: sec.chords.slice(0, 3) });
  eq(M._sheetLyrics(broken), null, 'mismatch: null');
  eq(M._sheetLyrics({ chords: [], lines: [] }), null, 'no lines: null');
}
// through songFromChordSheet: the fields reach the slots
{
  const r = M.songFromChordSheet(M.parseChordSheet('[Verse]\nC       G\nHello   world\n[Chorus]\nAm F\n'));
  const s0 = r.song.sections[0].slots, s1 = r.song.sections[1].slots;
  ok(s0[0].ln === true && !s0[1].ln, 'song: line start on the first slot of the line');
  ok(s1.every(x => !x.lyr), 'song: a chord-only section carries no words');
  ok(s0[0].lyr && s0[0].lyr.trim() === 'Hello' && s0[1].lyr === 'world', 'song: Hello / world');
}
// the three real sheets: every cut accounts for every word, in order
for (const f of fs.readdirSync(path.join(__dirname, 'sheets'))) {
  const sh = M.parseChordSheet(fs.readFileSync(path.join(__dirname, 'sheets', f), 'utf8'));
  let secs = 0, cut = 0;
  sh.sections.forEach(s => {
    const w = M._sheetLyrics(s);
    if (!w) return;
    secs++;
    eq(w.length, s.chords.length, f + ': one entry per chord');
    const want = (s.lines || []).filter(r => !r.rep && r.lyric).map(r => String(r.lyric).replace(/\s+/g, ' ').trim()).join(' ').replace(/\s+/g, ' ').trim();
    if (want) { cut++; eq(joined(w).replace(/\s+/g, ' '), want.replace(/\s+/g, ' '), f + ': ' + (s.name || '?') + ' words intact'); }
  });
  ok(secs > 0, f + ': at least one section carried words (' + secs + ', ' + cut + ' with text)');
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `lyrics: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
