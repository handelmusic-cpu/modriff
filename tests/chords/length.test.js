/* How long a chord lasts when a chord sheet is imported: the whole-song lengths
   (a half bar to four), reading it off the layout ('lines'), and what a section
   must add up to.
   Run: node tests/chords/length.test.js

   A sheet does not say how long a chord lasts. What it does say is which line of
   words each chord sits over and, when the spacing survived, how far along the line.
   The two sheets in sheets/ are real (see sheet.test.js); the column cases are
   written out, because both real ones lost their spacing on the way in and are
   exactly the "compact line" the reader must not take as a position. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), msg + '\n    want ' + JSON.stringify(want) + '\n    got  ' + JSON.stringify(got));
const sheetOf = f => M.parseChordSheet(fs.readFileSync(path.join(__dirname, 'sheets', f), 'utf8'));
const dur = sl => ({ bars: sl.bars, beats: sl.beats, eighths: sl.eighths });
const eighths = (sl, barE) => sl.bars * barE + sl.beats * 2 + sl.eighths;

// ── slotDurFromEighths ──────────────────────────────────────────────────
eq(M.slotDurFromEighths(16, 8), { bars: 2, beats: 0, eighths: 0 }, 'two bars of 4/4');
eq(M.slotDurFromEighths(4, 8), { bars: 0, beats: 2, eighths: 0 }, 'a half bar of 4/4 is two beats');
eq(M.slotDurFromEighths(10, 8), { bars: 1, beats: 1, eighths: 0 }, 'a bar and a beat');
eq(M.slotDurFromEighths(3, 6), { bars: 0, beats: 1, eighths: 1 }, 'a half bar of 3/4 is a beat and an eighth');
eq(M.slotDurFromEighths(12, 6), { bars: 2, beats: 0, eighths: 0 }, 'two bars of 3/4');
eq(M.slotDurFromEighths(0, 8), { bars: 0, beats: 0, eighths: 1 }, 'never nothing');

// ── _sheetSplit: shares of a number of beats ────────────────────────────
eq(M._sheetSplit([1, 1], 8), [4, 4], 'equal halves');
eq(M._sheetSplit([3, 1], 8), [6, 2], 'three to one');
eq(M._sheetSplit([1, 1, 1], 8).reduce((a, b) => a + b, 0), 8, 'thirds still add to eight');
eq(M._sheetSplit([100, 1, 1], 8), [6, 1, 1], 'a chord is never squeezed below a beat');
eq(M._sheetSplit([0, 5], 6), [3, 3], 'a zero or negative weight is no information: equal');
{
  let bad = 0, seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(rnd() * 8), units = n + Math.floor(rnd() * 12);
    const w = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 30));
    const u = M._sheetSplit(w, units);
    if (u.reduce((a, b) => a + b, 0) !== units || u.some(x => x < 1)) bad++;
  }
  ok(bad === 0, '500 random splits: always exactly the beats asked for, never below one each (' + bad + ' bad)');
}

// ── Whole-song lengths ─────────────────────────────────────────────────
const creep = sheetOf('creep.ocr.txt');
const allSlots = (o, opts) => M.songFromChordSheet(o, opts).song.sections.flatMap(s => s.slots);
ok(allSlots(creep).every(sl => sl.bars === 1 && sl.beats === 0 && sl.eighths === 0), 'no options: every chord one bar, exactly as before');
ok(allSlots(creep, { len: 0.5 }).every(sl => sl.bars === 0 && sl.beats === 2 && sl.eighths === 0), 'half a bar');
ok(allSlots(creep, { len: 2 }).every(sl => sl.bars === 2 && sl.beats === 0), 'two bars');
ok(allSlots(creep, { len: 4 }).every(sl => sl.bars === 4), 'four bars');
ok(allSlots(creep, { len: 0.5, barEighths: 6 }).every(sl => sl.bars === 0 && sl.beats === 1 && sl.eighths === 1), 'half a bar of 3/4');
ok(allSlots(creep, { len: 'nonsense' }).every(sl => sl.bars === 1), 'a length it does not know is one bar');

// ── The sheet that came in is not written to ───────────────────────────
{
  const before = JSON.stringify(creep);
  M.songFromChordSheet(creep, { len: 'lines', lineBars: 4 });
  ok(JSON.stringify(creep) === before, 'songFromChordSheet leaves the parsed sheet as it found it');
}

// ── By line, on the real sheets (no columns survive in them) ────────────
// Creep's verse is four lines of two chords. A line of two chords with no columns is
// split evenly, so a line of L bars gives each chord L/2 bars.
{
  const verse = (opts) => M.songFromChordSheet(creep, opts).song.sections.find(s => /Verse 1/.test(s.name));
  const v2 = verse({ len: 'lines', lineBars: 2 }), v4 = verse({ len: 'lines', lineBars: 4 }), v1 = verse({ len: 'lines', lineBars: 1 });
  ok(v2.slots.length === 8 && v2.slots.every(sl => sl.bars === 1 && sl.beats === 0), 'a line is 2 bars: each of its two chords gets 1', JSON.stringify(v2.slots.map(dur)));
  ok(v4.slots.every(sl => sl.bars === 2 && sl.beats === 0), 'a line is 4 bars: each chord 2 bars (what Creep actually is)', JSON.stringify(v4.slots.map(dur)));
  ok(v1.slots.every(sl => sl.bars === 0 && sl.beats === 2), 'a line is 1 bar: each chord 2 beats', JSON.stringify(v1.slots.map(dur)));
  ok(v4.slots.reduce((a, sl) => a + eighths(sl, 8), 0) / 8 === 16, 'and the verse is four lines of four bars: 16 bars');
}
// A repeated line (x3) repeats the lengths of the one it repeats: the Chorus opens
// with Cm (x3), a line of one chord, then the rest.
{
  const ch = M.songFromChordSheet(creep, { len: 'lines', lineBars: 2 }).song.sections.find(s => s.name === 'Chorus');
  ok(ch.slots.length === 7 && ch.slots[0].label === 'Cm' && ch.slots[1].label === 'Cm' && ch.slots[2].label === 'Cm', 'the chorus opens with Cm three times', ch.slots.map(s => s.label).join(' '));
  eq([0, 1, 2].map(i => dur(ch.slots[i])), [0, 1, 2].map(() => ({ bars: 2, beats: 0, eighths: 0 })), 'a lone chord holds its whole line (2 bars) and its repeats do the same');
}

// ── Every line adds up, on every real sheet and every setting ───────────
{
  let bad = 0, checked = 0;
  ['creep.ocr.txt', 'sun.ocr.txt', 'party.pdftext.txt'].forEach(f => {
    const sh = sheetOf(f);
    [1, 2, 4].forEach(L => [8, 6].forEach(barE => {
      const song = M.songFromChordSheet(sh, { len: 'lines', lineBars: L, barEighths: barE }).song;
      sh.sections.forEach((sec, si) => {
        const slots = song.sections[si].slots;
        let at = 0;
        sec.lines.forEach(r => {
          const want = r.rep ? null : Math.max(r.lyric == null ? Math.round(r.n * barE / 2) : r.n, Math.round(L * barE / 2)) * 2;
          const got = slots.slice(at, at + r.n).reduce((a, sl) => a + eighths(sl, barE), 0);
          if (want != null && got !== want) bad++;
          if (slots.slice(at, at + r.n).some(sl => eighths(sl, barE) < 2)) bad++;
          at += r.n; checked++;
        });
      });
    }));
  });
  ok(bad === 0 && checked > 100, 'every chord line is its bars exactly (a beat each at least), ' + checked + ' lines over 3 sheets x 3 settings x 2 meters (' + bad + ' bad)');
}

// ── Columns: where a chord sits over the words ─────────────────────────
// Padded: G over the start and D far along a 29-character line.
{
  const text = '[Verse]\nG                    D\nI hopped off the plane at LAX\n';
  const sh = M.parseChordSheet(text);
  eq(sh.sections[0].lines[0].cols, [0, 21], 'the columns of a padded line are kept');
  const sl = M.songFromChordSheet(sh, { len: 'lines', lineBars: 2 }).song.sections[0].slots;
  eq(sl.map(dur), [{ bars: 1, beats: 2, eighths: 0 }, { bars: 0, beats: 2, eighths: 0 }], 'a chord that sits three quarters along holds three quarters of the line (1.5 bars and 0.5 bar)');
}
// Compact: the same chords one space apart are a list, not a position.
{
  const sh = M.parseChordSheet('[Verse]\nG D\nI hopped off the plane at LAX\n');
  eq(sh.sections[0].lines[0].cols, null, 'chords one space apart have no columns');
  const sl = M.songFromChordSheet(sh, { len: 'lines', lineBars: 2 }).song.sections[0].slots;
  eq(sl.map(dur), [{ bars: 1, beats: 0, eighths: 0 }, { bars: 1, beats: 0, eighths: 0 }], 'and share the line evenly');
}
// A line of chords with no words under it (an Intro) is a bar a chord at the least.
{
  const sh = M.parseChordSheet('[Intro]\nG D C G\n[Verse]\nG\nWords here\n');
  const secs = M.songFromChordSheet(sh, { len: 'lines', lineBars: 2 }).song.sections;
  eq(secs[0].slots.map(dur), [0, 1, 2, 3].map(() => ({ bars: 1, beats: 0, eighths: 0 })), 'four chords with no words under them: a bar each, not squeezed into the line');
  eq(dur(secs[1].slots[0]), { bars: 2, beats: 0, eighths: 0 }, 'a lone chord holds the whole line');
}
// ChordPro: the chord's place in the words is the bracket's.
{
  const sh = M.parseChordSheet('[Verse]\n[G]When you were [B]here\n');
  const r = sh.sections[0].lines[0];
  eq([r.cols, r.lyric], [[0, 14], 'When you were here'], 'ChordPro brackets give the words and the columns');
  const sl = M.songFromChordSheet(sh, { len: 'lines', lineBars: 2 }).song.sections[0].slots;
  eq(sl.map(dur), [{ bars: 1, beats: 2, eighths: 0 }, { bars: 0, beats: 2, eighths: 0 }], 'ChordPro: G over most of the line, B at the end');
}
// More chords than beats grow the line to a beat a chord.
{
  const sh = M.parseChordSheet('[Verse]\nG C D G C D G C D G\nwords\n');
  const sl = M.songFromChordSheet(sh, { len: 'lines', lineBars: 1 }).song.sections[0].slots;
  ok(sl.length === 10 && sl.every(s => eighths(s, 8) === 2), 'ten chords on a one-bar line get a beat each rather than being squeezed', JSON.stringify(sl.map(dur)));
}

console.log((fail ? 'FAILED ' : 'ok ') + pass + ' passed' + (fail ? ', ' + fail + ' failed' : ''));
process.exit(fail ? 1 : 0);
