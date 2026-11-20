/* How a chord's length is said (Song > Build). One function, _slotDurLabel, is the only place a length becomes words: the chord
   tiles, the printed chart, the Exact editor and the Length row's readout all call it. It used to print the stored parts
   ("2♪" for two eighths, "1bar" with no space) while the Length row's own "2♪" meant two BEATS.
   Run: node tests/songbuild/durlabel.test.js

   Lifts the functions out of index.html (the way tests/chords/load.js does), so this runs the code that ships. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (got, want, m) => ok(JSON.stringify(got) === JSON.stringify(want), m + '\n    want ' + JSON.stringify(want) + '\n    got  ' + JSON.stringify(got));
const grab = re => { const m = re.exec(html); return m ? m[0] : ''; };

const fnSrc = grab(/\nfunction _slotDurLabel\([\s\S]*?\n\}\n/);
const rowSrc = grab(/\nvar SB_LEN_ROW\s*=\s*\[[\s\S]*?\n\];/);
ok(fnSrc !== '', '_slotDurLabel is in index.html');
ok(rowSrc !== '', 'SB_LEN_ROW is in index.html');

// The page's own _slotBeats (a bar is _songBarSteps() sixteenths; zero means "a bar"), with the bar length as a variable.
const make = steps => vm.runInNewContext(
  'var _steps=' + steps + ';function _songBarSteps(){return _steps;}' +
  'function _slotBeats(slot){var s=_songBarSteps();var q=((slot.bars||0)*s+(slot.beats||0)*4+(slot.eighths||0)*2)/4;return q>0?q:s/4;}' +
  fnSrc + rowSrc + ';({_slotDurLabel:typeof _slotDurLabel==="function"?_slotDurLabel:null, SB_LEN_ROW:typeof SB_LEN_ROW!=="undefined"?SB_LEN_ROW:null});', {});
const four = make(16), three = make(12);
const lab = (M, s) => M._slotDurLabel ? M._slotDurLabel(Object.assign({ bars: 0, beats: 0, eighths: 0 }, s)) : '(missing)';

eq(lab(four, { bars: 1 }), '1 bar', 'one bar');
eq(lab(four, { bars: 2 }), '2 bars', 'two bars');
eq(lab(four, { beats: 1 }), '1 beat', 'one beat');
eq(lab(four, { beats: 2 }), '2 beats', 'two beats');
eq(lab(four, { eighths: 1 }), '½ beat', 'one eighth is half a beat');
eq(lab(four, { beats: 1, eighths: 1 }), '1½ beats', 'a beat and an eighth');
eq(lab(four, { bars: 1, beats: 2 }), '1 bar + 2 beats', 'a bar and two beats');
eq(lab(four, { bars: 2, eighths: 1 }), '2 bars + ½ beat', 'two bars and an eighth');
eq(lab(four, {}), '1 bar', 'a slot with no length is a bar, as it always was');
// Review focus 1: a bar is not always four beats.
eq(lab(three, { bars: 1 }), '1 bar', '3/4: one bar');
eq(lab(three, { beats: 3 }), '1 bar', '3/4: three beats is a bar');
eq(lab(three, { beats: 2 }), '2 beats', '3/4: two beats');
// Review focus 2: odd stored mixes read as the total, never empty and never negative.
eq(lab(four, { beats: 5, eighths: 3 }), '1 bar + 2½ beats', 'beats 5 and eighths 3 in 4/4 is a bar and two and a half beats');
ok(/\S/.test(lab(four, { beats: 0, eighths: 0, bars: 0 })), 'an all-zero slot is never an empty label');

ok(four.SB_LEN_ROW && JSON.stringify(four.SB_LEN_ROW.map(p => p.short)) === JSON.stringify(['½', '1 beat', '2 beats', '1 bar', '2 bars', '4 bars']),
  'the Length row offers ½, 1 beat, 2 beats, 1 bar, 2 bars, 4 bars, in that order');
ok(four.SB_LEN_ROW && four.SB_LEN_ROW.every(p => typeof p.title === 'string' && p.title.length),
  'every Length option has a title (its tooltip)');
if (four.SB_LEN_ROW) eq(four.SB_LEN_ROW.map(p => [p.bars, p.beats, p.eighths]),
  [[0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [2, 0, 0], [4, 0, 0]], 'what each option stores (bars, beats, eighths)');

console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok ' + pass + ' passed');
process.exit(fail ? 1 : 0);
