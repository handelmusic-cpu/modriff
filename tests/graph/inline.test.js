/* index.html carries a copy of tests/graph/graphrec.js (the page is one file and
   has no bundler). This fails if the two have drifted. Run: node tests/graph/inline.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = fs.readFileSync(path.join(__dirname, 'graphrec.js'), 'utf8');
const a = html.indexOf('// <graphrec>'), b = html.indexOf('// </graphrec>');
if (a < 0 || b < 0) { console.log('FAIL the markers are missing from index.html'); process.exit(1); }
const body = html.slice(html.indexOf('\n', a) + 1, b);
if (body !== src) {
  let i = 0; while (i < body.length && body[i] === src[i]) i++;
  console.log('FAIL index.html\'s copy of graphrec.js differs from tests/graph/graphrec.js, first at character ' + i);
  console.log('  page: ' + JSON.stringify(body.slice(Math.max(0, i - 40), i + 60)));
  console.log('  file: ' + JSON.stringify(src.slice(Math.max(0, i - 40), i + 60)));
  process.exit(1);
}
console.log('ok   index.html carries the current graphrec.js (' + src.length + ' characters)');
