/* The native master bus's parameters travel as positions: the page posts
   {t:'master', i, v} and the C++ reads `i` as MasterParam. A reordered list on
   either side would send every value to the wrong stage, silently. This reads
   both and compares.
   Run: node tests/modsynth/master-order.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

const hdr = fs.readFileSync(path.join(root, 'native/modsynth/master.h'), 'utf8');
const body = hdr.slice(hdr.indexOf('enum MasterParam'), hdr.indexOf('};', hdr.indexOf('enum MasterParam')));
const names = [...body.matchAll(/\bMB_([A-Z0-9_]+)/g)].map(m => m[1]).filter(n => n !== 'COUNT');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/var MASTER_PARAMS = \[([\s\S]*?)\];/);
const js = m ? [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map(x => x[1]) : [];

// The C++ names a few stages differently from the page's keys; each pair is
// written out so a rename on one side shows up here.
const pairs = {
  vol: 'VOL', compTh: 'CMP_TH', compRatio: 'CMP_RATIO', limTh: 'LIM_TH', limRatio: 'LIM_RATIO',
  revSend: 'REV_SEND', drvAmt: 'DRV_AMT', drvOut: 'DRV_OUT', webTrim: 'WEB_TRIM',
  eqLo: 'EQ_LO', eqMid: 'EQ_MID', eqMidHz: 'EQ_MID_HZ', eqHi: 'EQ_HI'
};

let fail = 0;
function ok(c, label, detail) { if (!c) { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); } }
ok(js.length > 0, 'MASTER_PARAMS found in index.html');
ok(names.length === js.length, 'same number of parameters', `${names.length} in C++, ${js.length} in the page`);
for (let i = 0; i < Math.max(names.length, js.length); i++) {
  ok(pairs[js[i]] === names[i], `parameter ${i}`, `C++ ${names[i]}, page ${js[i]}`);
}
console.log(`tests/modsynth/master-order.test.js: ${fail ? fail + ' FAILED' : names.length + ' parameters in the same order'}`);
process.exit(fail ? 1 : 0);
