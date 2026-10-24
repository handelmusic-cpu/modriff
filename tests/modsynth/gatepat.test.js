/* The rhythmic gate's eight patterns exist twice: GATE_PATTERNS in index.html
   (the web chain's looping buffer) and GATE_PATTERNS in native/modsynth/
   mixfx.cpp (the native chain's table). A pattern edited in one and not the
   other is a part that gates differently on the phone than in the browser, with
   nothing to say so. This reads both and compares them bit for bit.
   Run: node tests/modsynth/gatepat.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

function rows(text) {
  return [...text.matchAll(/[\[{]\s*((?:[01]\s*,\s*){15}[01])\s*[\]}]/g)]
    .map(m => m[1].split(',').map(x => +x.trim()));
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cpp = fs.readFileSync(path.join(root, 'native/modsynth/mixfx.cpp'), 'utf8');
const hm = html.match(/const GATE_PATTERNS=\[([\s\S]*?)\n\];/);
const cm = cpp.match(/GATE_PATTERNS\[GATE_PAT_COUNT\]\[16\] = \{([\s\S]*?)\n\};/);
const web = hm ? rows(hm[1]) : [], nat = cm ? rows(cm[1]) : [];

let fail = 0;
function ok(c, label, detail) { if (!c) { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); } }
ok(web.length === 8, 'eight patterns in index.html', web.length);
ok(nat.length === 8, 'eight patterns in mixfx.cpp', nat.length);
for (let i = 0; i < 8; i++) ok(JSON.stringify(web[i]) === JSON.stringify(nat[i]), 'pattern ' + (i + 1) + ' matches', `${web[i]} vs ${nat[i]}`);
// The page picks the pattern index the same way for both chains (_fxGatePatIdx
// feeds nat.gatePat), so the count is the only other thing the C++ can drift on.
ok(/GATE_PAT_COUNT = 8;/.test(cpp), 'GATE_PAT_COUNT is 8');
console.log(`tests/modsynth/gatepat.test.js: ${fail ? fail + ' FAILED' : '8 patterns identical in the page and the native chain'}`);
process.exit(fail ? 1 : 0);
