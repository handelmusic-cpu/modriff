/* Chord sheets in, songs out: parseChordSheet, guessChordKey,
   songFromChordSheet, slotIvs.
   Run: node tests/chords/sheet.test.js

   The two sheets in sheets/ are real: Ultimate Guitar PDF exports, which are
   pictures of the page, run through text recognition (tesseract, standing in
   for the phone's), with the misreads left in — "Cc" and "CC" for C, "BC"
   for B C, logo scraps on the title line. Lyric lines are replaced with
   filler; the chord lines, headers and titles are exactly as recognised.
   The expected chords were read off the printed pages by hand. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const sheetOf = f => M.parseChordSheet(fs.readFileSync(path.join(__dirname, 'sheets', f), 'utf8'));
const shape = sh => sh.sections.map(s => s.name + (s.plays > 1 ? ' x' + s.plays : '') + ': ' + s.chords.join(' '));
const same = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, msg + '\n    want ' + w + '\n    got  ' + g);
};

// ── Party in the U.S.A.: a PDF with a text layer ────────────────────────────
// Ultimate Guitar's PDF export, first three pages, as the phone's PDFKit reads the
// text layer (the file in sheets/ is that text, not the PDF). It starts with a
// legend, "CHORDS" over "G D C" and a diagram for each, which is not music: read
// as chords it became an Intro of its own in the first on-phone import.
{
  const sh = sheetOf('party.pdftext.txt');
  const names = sh.sections.map(s => s.name);
  ok(sh.title === 'Party In The Usa' && sh.artist === 'Miley Cyrus', 'party title/artist: ' + sh.title + ' / ' + sh.artist);
  ok(names[0] === 'Intro' && sh.sections[0].chords.join(' ') === 'F# C# B F# C# B', 'the legend is not an Intro; the real Intro is F# C# B twice: ' + JSON.stringify(sh.sections[0]));
  ok(names.filter(n => n === 'Intro').length === 1, 'one Intro, not two');
  same(shape(sh).slice(0, 3), [
    'Intro: F# C# B F# C# B',
    'Verse 1: G D C G D C G D G D G C G C',
    'Pre-Chorus 1: G D G D G D C C C',
  ], 'party: intro, verse 1 and pre-chorus 1, as printed');
}

// ── Creep ───────────────────────────────────────────────────────────────────
{
  const sh = sheetOf('creep.ocr.txt');
  ok(sh.title === 'Creep' && sh.artist === 'Radiohead', 'creep title/artist: ' + sh.title + ' / ' + sh.artist);
  const L = 'G B C Cm';
  same(shape(sh), [
    'Intro: ' + L,
    'Verse 1: ' + L + ' ' + L,
    'Chorus: Cm Cm Cm ' + L,              // "Cm (x3, very short)"
    'Verse 2: ' + L + ' ' + L,
    'Chorus: Cm Cm Cm ' + L,
    'Bridge: ' + L + ' ' + L,
    'Verse 3: ' + L,
    'Chorus: ' + L + ' G',
  ], 'creep sections, in order');
  ok(sh.unread.length === 0, 'the fingering table is skipped quietly: ' + JSON.stringify(sh.unread));
  const r = M.songFromChordSheet(sh);
  ok(r.key.root === 7 && r.key.mode === 'major', 'creep is in G major: ' + JSON.stringify(r.key));
  const s0 = r.song.sections[0].slots;
  same(s0.map(x => x.numeral), ['I', 'III', 'IV', 'iv'], 'creep numerals');
  same(s0.map(x => x.func), ['tonic', 'modal', 'tonic', 'modal'].map((f, i) => i === 2 ? 'subdom' : f), 'creep functions');
  same(s0.map(x => x.label), ['G', 'B', 'C', 'Cm'], 'labels as written');
  ok(s0.every(x => x.named && x.bars === 1 && !x.isRest), 'named, one bar each');
  ok(s0[3].rootM === 60 && s0[0].rootM === 55, 'roots in the app\'s register around middle C');
}

// ── Don't Let the Sun Go Down on Me ─────────────────────────────────────────
{
  const sh = sheetOf('sun.ocr.txt');
  ok(sh.title === 'Dont Let The Sun Go Down On Me', 'sun title: ' + sh.title);
  ok(sh.artist === 'Elton John', 'artist wrapped onto the next line: ' + sh.artist);
  const A = 'G F C Cadd4 C F G G7', A2 = 'G F C Cadd4 C F C G G7';
  const CH = 'C Cadd4 Am D C F G C C7 F F Dm C/E F G C';   // "(Let ring)" dropped
  same(shape(sh), [
    'Verse: ' + A + ' ' + A + ' ' + A + ' ' + A2,
    'Chorus: ' + CH,
    'Verse: ' + A + ' ' + A2,
    'Chorus x2: ' + CH,                   // "[Chorus] (x2)" is a play count
  ], 'sun sections, in order');
  ok(sh.unread.length === 0, 'nothing left unread: ' + JSON.stringify(sh.unread));
  const r = M.songFromChordSheet(sh);
  ok(r.key.root === 0 && r.key.mode === 'major', 'sun is in C major: ' + JSON.stringify(r.key));
  ok(r.song.sections[3].plays === 2, 'second chorus plays twice');
  const ce = r.song.sections[1].slots.find(x => x.label === 'C');
  const slash = r.song.sections[1].slots.find(x => x.bassNote != null);
  ok(slash && slash.label === 'C' && slash.bassNote % 12 === 4, 'C/E: C over an E bass');
  const add4 = r.song.sections[0].slots[3];
  ok(add4.label === 'Cadd4' && M.slotIvs(add4).join(',') === '0,4,5,7', 'Cadd4 plays its own notes, not the nearest menu chord');
  ok(ce && M.slotIvs(ce).join(',') === '0,4,7', 'C is a triad');
}

// ── Formats and edges ───────────────────────────────────────────────────────
{
  const p = t => shape(M.parseChordSheet(t));
  same(p('{title: Song}\n{soc}\n[G]Hello [D/F#]there [Em7]friend\n{eoc}'), ['Chorus: G D/F# Em7'], 'ChordPro: inline chords and soc');
  same(p('[Intro] G B C Cm'), ['Intro: G B C Cm'], 'chords on the header line');
  same(p('[Verse]\nG  D  |  Em  C  x2'), ['Verse: G D Em C G D Em C'], 'bars and a trailing x2');
  same(p('[A]\nDmi  Bb9\nEmi7(b5)  A7  Dmi'), ['A: Dmi Bb9 Emi7(b5) A7 Dmi'], 'a section called A is a section; fake-book spellings');
  same(p('A day in the life\n[Verse]\nAm  G\nA man I knew'), ['Verse: Am G'], 'a lyric starting with "A" is a lyric');
  same(p('G  D  Em  Zz9'), [], 'one unreadable word makes the line a lyric, not a shorter chord line');
  ok(M.parseChordSheet('[Verse]\nG  D  Em  Hm').unread.length === 1, '...and is reported');
  same(p('cc dd'), [], 'misread letters alone never make a chord line');
  same(p('[Verse]\nG\n\nla la\n\nC (x2)'), ['Verse: G C C'], 'repeat on the chord line itself');
  const lone = M.parseChordSheet('Let It Be\n[Verse]\nC G');
  ok(lone.title === 'Let It Be', 'a two-letter last word is a word: ' + lone.title);
  ok(M.parseChordSheet('').sections.length === 0 && M.parseChordSheet(null).sections.length === 0, 'empty input');
}

// ── Keys ────────────────────────────────────────────────────────────────────
{
  const k = s => { const r = M.guessChordKey(s.split(' ')); return r.root + ' ' + r.mode; };
  ok(k('Am F C G Am') === '9 minor', 'Am F C G Am is A minor: ' + k('Am F C G Am'));
  ok(k('C Am F G C') === '0 major', 'C Am F G C is C major');
  ok(k('Dm7 G7 Cmaj7') === '0 major', 'ii V I lands on C');
  ok(k('Em C G D Em') === '4 minor', 'Em C G D Em is E minor');
}

// ── slotIvs: the one read every playback path makes ─────────────────────────
{
  const old = { rootM: 60, triadQ: 1, type7: 'min7', ext: '9th' };
  same(M.slotIvs(old), M.getIntvs(1, 'min7', '9th'), 'an old slot reads exactly as before');
  const mine = { rootM: 60, triadQ: 0, type7: null, ext: 'triad', ivs: [0, 4, 7, 10, 13, 21] };
  const a = M.slotIvs(mine); a.push(99);
  same(mine.ivs, [0, 4, 7, 10, 13, 21], 'callers get a copy, not the slot\'s array');
}

// ── slotFromChordSymbol: one symbol -> the fields that spell and sound it ───
// The shared path: chord-sheet import, the editor's Chord field and the iReal
// Pro import all build a slot through this, so they cannot disagree.
{
  const f = (sym, kr, km, near) => M.slotFromChordSymbol(sym, kr === undefined ? 0 : kr, km || 'major', near);

  ok(f('Zz9') === null, 'a symbol the parser refuses makes no slot');
  ok(f('') === null, 'an empty symbol makes no slot');

  // The notes are the parser's, unchanged — this is the whole point of ivs.
  same(f('C13b9').ivs, M.parseChordSymbol('C13b9').ivs, 'ivs come straight from the parser');
  ok(f('C13b9').named === true, 'a typed chord is named, so nothing is appended to its label');

  // Spelling survives: the label is the symbol as written, not re-derived.
  ok(f('Ebm7b5').label === 'E♭m7♭5', 'flats and the quality are kept as written: ' + f('Ebm7b5').label);
  ok(f('C#m').label === 'C♯m', 'sharps are prettified, not flipped to flats');
  ok(f('Cadd4').label === 'Cadd4', 'a quality the menu has no name for still labels itself');
  ok(f('C/G').label === 'C', 'the slash bass leaves the label (the drawer appends it)');
  ok(f('C/G').bassNote === 48 + 7, 'the slash bass becomes bassNote: ' + f('C/G').bassNote);
  ok(f('C/C').bassNote === null, 'a bass that is the root is not a slash chord');

  // Old fields are still filled, so the grid, colours and numerals keep working.
  const dm7 = f('Dm7', 0, 'major');
  ok(dm7.approx === false, 'a chord the menu has is exact in the old fields');
  same(M.getIntvs(dm7.triadQ, dm7.type7, dm7.ext), M.parseChordSymbol('Dm7').ivs,
    '...so the old fields alone still sound it');
  ok(f('C7b5b9#9b13').approx === true, 'a chord the menu cannot hold is flagged approx');

  // Numeral and function are read against the key it was typed in.
  ok(f('G', 0, 'major').numeral === 'V', 'G in C is V');
  ok(f('G', 0, 'major').func === 'dom', '...and dominant');
  ok(f('Dm', 0, 'major').numeral === 'ii', 'a minor chord numerals lowercase');
  // The quality has to be read off the notes: EXTS ignores triadQ once type7
  // is set, so every seventh chord's triadQ is 0 and reading it made these
  // four major.
  ok(f('Dm7', 0, 'major').numeral === 'ii', 'a m7 is lowercase too, not "II"');
  ok(f('Dm9', 0, 'major').numeral === 'ii', 'and a m9');
  ok(f('Bdim', 0, 'major').numeral === 'vii°', 'diminished gets its ring');
  ok(f('Bdim7', 0, 'major').numeral === 'vii°', '...and so does a diminished seventh');
  ok(f('Bm7b5', 0, 'major').numeral === 'viiø', 'half-diminished is ø, the way SUFFIX7 spells it');
  ok(f('Caug', 0, 'major').numeral === 'I+', 'augmented gets its plus');
  ok(f('Cmaj7', 0, 'major').numeral === 'I', 'a maj7 is still uppercase and unsigned');
  ok(f('C7', 0, 'major').numeral === 'I', 'and a dominant 7');
  ok(f('Csus4', 0, 'major').numeral === 'I', 'a sus chord has no third to be minor with');
  ok(f('G', 7, 'major').numeral === 'I', 'the same chord is I in its own key');
  ok(f('Ab', 0, 'major').func === 'modal', 'a chord out of the key is borrowed');

  // nearM: retyping a chord in the editor must not jump it an octave.
  ok(f('C', 0, 'major', 60).rootM === 60, 'C near middle C is middle C');
  ok(f('B', 0, 'major', 60).rootM === 59, 'B under a C slot steps down a semitone, not up eleven');
  ok(f('C#', 0, 'major', 60).rootM === 61, 'C♯ over a C slot steps up one');
  ok(f('F#', 0, 'major', 60).rootM === 66, 'a tritone away rounds to the near side: ' + f('F#', 0, 'major', 60).rootM);
  ok(f('C', 0, 'major', 72).rootM === 72, 'an octave up stays an octave up');
  ok(f('C', 0, 'major', null).rootM === 60, 'with nothing to stay near, C is middle C');
  ok(Math.abs(f('A', 0, 'major', null).rootM - 60) <= 6, 'and every root lands within a tritone of it');

  // The importer goes through it, so a sheet still builds the same song.
  const song = M.songFromChordSheet(M.parseChordSheet('[Verse]\nDm7 G7 Cmaj7')).song;
  const slots = song.sections[0].slots;
  same(slots.map(s => s.label), ['Dm7', 'G7', 'Cmaj7'], 'the importer still labels through the shared path');
  ok(slots.every(s => s.bars === 1 && s.isRest === false), '...and still gives every chord a bar');
  ok(slots.every(s => !('approx' in s)), '...and does not leave approx on the slot');
  same(slots[0].ivs, M.parseChordSymbol('Dm7').ivs, '...with the parser\'s notes');
}

console.log((fail ? 'FAIL' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
