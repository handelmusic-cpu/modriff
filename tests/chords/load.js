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
  // The iReal pieces live with the library rather than in the model block,
  // so they are lifted by name. _irealQ is the pre-chord-model mapping, kept
  // as the fallback for a symbol the parser cannot read — the ireal test
  // compares the two, so it needs both.
  const grab = (name, kind) => {
    const re = kind === 'var'
      ? new RegExp('\\nvar ' + name + ' = \\[[\\s\\S]*?\\n\\];')
      : new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n');
    const m = re.exec(html);
    if (!m) throw new Error(name + ' not found in index.html');
    return m[0];
  };
  const ireal = grab('IREAL_Q_MAP', 'var') + grab('_irealSymbol') + grab('_irealQ') + grab('_irealPc');
  const src = html.slice(a, b) + g[0] + ireal +
    '\n;({parseChordSymbol, chordFromSlot, chordEngineEvent, chordNotePc, getIntvs, EXTS,' +
    ' slotIvs, parseChordSheet, songFromChordSheet, guessChordKey, _sheetChordWords,' +
    ' slotFromChordSymbol, _legacyFromIvs, spellChord,' +
    ' _irealSymbol, _irealQ, _irealPc, IREAL_Q_MAP});';
  return vm.runInNewContext(src, {});
};
