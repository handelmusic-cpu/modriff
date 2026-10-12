/* Lifts the chord model out of index.html and runs it in a sandbox, so the
   tests exercise the exact code the app ships rather than a copy of it.
   Takes TRIAD through the END CHORD MODEL marker (the tables, EXTS and the
   model) plus getIntvs, which chordFromSlot reads old slots through. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
module.exports = function load(){
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const a = html.indexOf('const TRIAD = {');
  const b = html.indexOf('// ── END CHORD MODEL ──');
  const g = /\nfunction getIntvs\([\s\S]*?\n\}\n/.exec(html);
  if (a < 0 || b < a || !g) throw new Error('chord model markers not found in index.html');
  const src = html.slice(a, b) + g[0] +
    '\n;({parseChordSymbol, chordFromSlot, chordEngineEvent, chordNotePc, getIntvs, EXTS});';
  return vm.runInNewContext(src, {});
};
