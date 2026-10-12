/* Regenerates tonal-fixture.json: every chord symbol in Tonal.js's dictionary,
   on C, with the semitones Tonal gives it. Tonal is the oracle for the parser,
   not a dependency of the app, so it is not in package.json — install it
   somewhere scratch and point this at its browser build:

     npm i tonal@6   (anywhere)
     node tests/chords/make-tonal-fixture.js /path/to/node_modules/tonal/browser/tonal.min.js

   The browser build because tonal 6.5's package.json names dist files that
   its tarball does not contain, so require('tonal') fails under node. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const sb = {}; sb.self = sb; sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), sb);
const T = sb.Tonal;
const out = {};
T.ChordType.all().forEach(t => t.aliases.forEach(a => {
  const c = T.Chord.get('C' + a);
  if (!c.empty) out['C' + a] = c.intervals.map(i => T.Interval.semitones(i));
}));
fs.writeFileSync(path.join(__dirname, 'tonal-fixture.json'), JSON.stringify(out, null, 0).replace(/\],/g, '],\n') + '\n');
console.log(Object.keys(out).length + ' symbols');
