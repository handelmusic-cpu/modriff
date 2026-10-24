/* Text recognition fragments -> chord-sheet text: ocrObservationsToText.
   Run: node tests/chords/ocr.test.js

   The phone's recogniser (Apple Vision, in ModOcr.swift) does not return lines.
   It returns boxes — "G", "B" and "Cm" as three of them, each with where it sat
   on the page — and a chord sheet is chords above lyrics with spaces between.
   This rebuilds the page from boxes and checks that parseChordSheet reads it as
   it reads the text it was made from.

   The boxes are synthetic: each line of the two real sheets in sheets/ is cut
   into one box per word, placed at its column, with its row nudged and the
   order shuffled, the way a photo of a slightly skewed page comes back. What
   this cannot say is how well Vision reads a real photo — that needs a phone. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./load')();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const same = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, msg + '\n    want ' + w + '\n    got  ' + g);
};
const shape = sh => sh.sections.map(s => s.name + (s.plays > 1 ? ' x' + s.plays : '') + ': ' + s.chords.join(' '));

// A deterministic shuffle and jitter, so a failure is the same failure next run.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// Text -> fragments: one per whitespace-separated word, at its column, on its
// row. cw is a character's width, lh a line's height, as fractions of the page.
function boxes(text, opts) {
  const o = Object.assign({ cw: 0.011, lh: 0.02, gap: 0.012, jitter: 0.15, x0: 0.08, y0: 0.05 }, opts);
  const out = [];
  text.split('\n').forEach((line, row) => {
    const re = /\S+/g; let m;
    while ((m = re.exec(line))) {
      out.push({ t: m[0], x: o.x0 + m.index * o.cw, y: o.y0 + row * (o.lh + o.gap) + (rnd() - 0.5) * o.jitter * o.lh * 2,
                 w: m[0].length * o.cw, h: o.lh, c: 0.95 });
    }
  });
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// 1. The two real sheets, through boxes and back: the same chart.
for (const f of ['creep.ocr.txt', 'sun.ocr.txt']) {
  const text = fs.readFileSync(path.join(__dirname, 'sheets', f), 'utf8');
  const want = M.parseChordSheet(text);
  const got = M.parseChordSheet(M.ocrObservationsToText([{ obs: boxes(text) }]));
  same(shape(got), shape(want), f + ': the same sections and chords after boxes and back');
  same([got.title, got.artist], [want.title, want.artist], f + ': title and artist');
  ok(got.unread.length === want.unread.length, f + ': the same lines unread (' + got.unread.length + ' vs ' + want.unread.length + ')');
}

// 2. A chord over a lyric stays on its own line, and the column is kept.
{
  const t = M.ocrObservationsToText([{ obs: [
    { t: 'Cm', x: 0.30, y: 0.10, w: 0.04, h: 0.02 }, { t: 'G', x: 0.10, y: 0.10, w: 0.02, h: 0.02 },
    { t: 'When you were here before', x: 0.10, y: 0.14, w: 0.50, h: 0.02 },
  ] }]).split('\n');
  ok(t.length === 2, 'two lines: chords, then the lyric', JSON.stringify(t));
  ok(/^G\s+Cm$/.test(t[0]), 'chords left to right, spaced by where they were', JSON.stringify(t[0]));
  ok(t[0].indexOf('Cm') > 8, 'the second chord sits well to the right of the first', t[0].indexOf('Cm'));
}

// 3. Pages are separated, a wide vertical gap is a blank line, rubbish is dropped.
{
  const t = M.ocrObservationsToText([
    { obs: [{ t: '[Verse]', x: 0.1, y: 0.1, w: 0.07, h: 0.02 }, { t: 'G', x: 0.1, y: 0.14, w: 0.01, h: 0.02 },
            { t: 'C', x: 0.1, y: 0.40, w: 0.01, h: 0.02 }, { t: '  ', x: 0.5, y: 0.5, w: 0.1, h: 0.02 },
            { t: 'NaN', x: NaN, y: 0.5, w: 0.1, h: 0.02 }, { t: 'zero', x: 0.1, y: 0.6, w: 0.1, h: 0 }] },
    { obs: [{ t: '[Chorus]', x: 0.1, y: 0.1, w: 0.08, h: 0.02 }] },
    { obs: [] },
  ]);
  same(t.split('\n'), ['[Verse]', 'G', '', 'C', '', '[Chorus]'], 'pages joined by a blank line; a wide gap kept; empty and invalid boxes dropped');
}

// 4. Nothing in, nothing out; and a bare array works as one page.
ok(M.ocrObservationsToText([]) === '' && M.ocrObservationsToText(null) === '' && M.ocrObservationsToText([{ obs: [] }]) === '', 'empty input is the empty string');
ok(M.ocrObservationsToText([[{ t: 'Am', x: 0.1, y: 0.1, w: 0.02, h: 0.02 }]]) === 'Am', 'a bare array of boxes is one page');

// 5. A sheet that was only ever read as one box per line (a PDF's text layer).
{
  const text = fs.readFileSync(path.join(__dirname, 'sheets', 'creep.ocr.txt'), 'utf8');
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
  const obs = []; lines.forEach((l, row) => { if (l.trim()) obs.push({ t: l.trim(), x: 0.08 + (l.length - l.trimStart().length) * 0.011, y: 0.05 + row * 0.032, w: l.trim().length * 0.011, h: 0.02 }); });
  const got = M.parseChordSheet(M.ocrObservationsToText([{ obs }]));
  same(shape(got), shape(M.parseChordSheet(text)), 'whole lines (a PDF text layer) read the same');
}

// 6. Brackets the recogniser reads as letters. These three are what Vision's fast
//    recogniser returned for "[Verse 1]", "[Chorus]" and "[Bridge]" in a test
//    render (see ModOcr.swift); the repair puts them back, and only them.
{
  const one = t => M.ocrObservationsToText([{ obs: [{ t, x: 0.1, y: 0.1, w: 0.02 * t.length, h: 0.02 }] }]);
  same(['IVerse 11', 'IChorusl', 'IBridgel', '[Verse 1]', '|Intro|', 'l Outro l'].map(one),
       ['[Verse 1]', '[Chorus]', '[Bridge]', '[Verse 1]', '[Intro]', '[Outro]'], 'a bracket read as I, l, | or 1 is put back');
  same(['I love you', 'Chorus', 'Il', 'Is the Verse l', 'I Chorus line l'].map(one),
       ['I love you', 'Chorus', 'Il', 'Is the Verse l', 'I Chorus line l'], 'lyrics and plain words are left alone');
}

console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
