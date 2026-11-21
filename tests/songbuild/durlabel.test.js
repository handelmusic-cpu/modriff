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

// The page's own _slotBeats and _tlWhere, lifted (not copied: a copy would keep passing if the real one changed), with the bar length
// as a variable.
const beatsSrc = grab(/\nfunction _slotBeats\([\s\S]*?\n\}\n/);
const whereSrc = grab(/\nfunction _tlWhere\([\s\S]*?\n\}\n/);
ok(beatsSrc !== '' && whereSrc !== '', '_slotBeats and _tlWhere are in index.html');
const make = steps => vm.runInNewContext(
  'var _steps=' + steps + ';function _songBarSteps(){return _steps;}' +
  beatsSrc + whereSrc + fnSrc + rowSrc + ';({_slotDurLabel:typeof _slotDurLabel==="function"?_slotDurLabel:null, SB_LEN_ROW:typeof SB_LEN_ROW!=="undefined"?SB_LEN_ROW:null, _tlWhere:_tlWhere});', {});
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

// The drag readout: "and a half" is a half beat INTO the bar, so in a 7/8 bar (3.5 beats) the downbeat of bar 2 is not one.
const seven = make(14);
eq(four._tlWhere(4.5), 'bar 2, beat 1 and a half', '4/4: half a beat into bar 2');
eq(four._tlWhere(4), 'bar 2, beat 1', '4/4: the downbeat of bar 2');
eq(seven._tlWhere(3.5), 'bar 2, beat 1', '7/8: 3.5 beats is the downbeat of bar 2');
eq(seven._tlWhere(4), 'bar 2, beat 1 and a half', '7/8: half a beat into bar 2');
eq(seven._tlWhere(3), 'bar 1, beat 4', '7/8: beat 4 of bar 1');

console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok ' + pass + ' passed');
process.exit(fail ? 1 : 0);
