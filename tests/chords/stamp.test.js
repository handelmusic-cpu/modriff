/* Slots carry the notes they were made with (step 5 of the chord model).
   Run: node tests/chords/stamp.test.js

   _slotWriteNotes puts the menu's recipe (triadQ, type7, ext) onto a slot as
   ivs, so a later change to EXTS cannot move a chord that is already on the
   chart. This checks that what it writes is exactly what getIntvs gives (so
   nothing sounds different the day it ships), that a stamped slot is deaf to a
   change in the table while an unstamped one is not, that the menu path
   replaces the notes a typed chord came in with, and that every recipe the menu
   can build stamps to a valid, ascending, unique set. */
'use strict';
const M = require('./load')({ _chordLabelFromData: (rootM, q, t7, ext) => 'relabelled:' + ext });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const same = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, msg + '\n    want ' + w + '\n    got  ' + g);
};

// 1. Every recipe the menu can build: stamped notes equal the table's, are
//    ascending and unique, and slotIvs returns them (as a copy).
{
  const t7s = [null, 'maj7', 'min7', 'dom7', 'halfdim', 'dim7', 'minMaj7', 'augMaj7', 'aug7'];
  let n = 0, bad = 0;
  for (const ext of Object.keys(M.EXTS)) for (const q of [0, 1, 2, 3]) for (const t7 of t7s) {
    let want; try { want = M.getIntvs(q, t7, ext); } catch (e) { continue; }
    if (!Array.isArray(want)) continue;
    const slot = { rootM: 62, triadQ: q, type7: t7, ext };
    M._slotWriteNotes(slot);
    n++;
    const asc = slot.ivs.every((x, i, a) => i === 0 || x > a[i - 1]);
    if (JSON.stringify(slot.ivs) !== JSON.stringify(want) || !asc) {
      bad++; if (bad < 4) console.log('    ' + ext + ' q' + q + ' ' + t7 + ': ' + slot.ivs + ' vs ' + want);
    }
    const r = M.slotIvs(slot); r.push(99);
    if (slot.ivs.indexOf(99) >= 0) bad++;                   // a caller's voicing must not write back
  }
  ok(n > 300 && bad === 0, 'every menu recipe stamps to getIntvs, ascending, as a copy (' + n + ' recipes, ' + bad + ' wrong)');
}

// 2. The point: a stamped chord does not move when the table does.
{
  const stamped = { rootM: 60, triadQ: 0, type7: 'dom7', ext: '11th' };
  const old     = { rootM: 60, triadQ: 0, type7: 'dom7', ext: '11th' };
  M._slotWriteNotes(stamped);
  const before = M.slotIvs(stamped).join(',');
  const saved = M.EXTS['11th'];
  M.EXTS['11th'] = () => [0, 4, 7, 10, 14, 17];            // the third comes back
  same(M.slotIvs(stamped).join(','), before, 'a stamped slot ignores a change to EXTS');
  ok(M.slotIvs(old).join(',') !== before, 'a slot with no notes still reads the table (the old-save path)');
  M.EXTS['11th'] = saved;
}

// 3. Rests and a slot that already has its own notes.
{
  const rest = { isRest: true, rootM: 60, triadQ: 0, type7: null, ext: 'triad' };
  M._slotWriteNotes(rest);
  ok(!('ivs' in rest), 'a rest is not stamped');
  const typed = { rootM: 60, triadQ: 0, type7: 'dom7', ext: '7th', ivs: [0, 4, 7, 10, 13, 21], named: true, label: 'C13b9' };
  same(M.slotIvs(typed), [0, 4, 7, 10, 13, 21], 'slotIvs reads a typed chord\'s own notes');
}

// 4. The menu path: picking a quality replaces what a typed chord came in with.
{
  const typed = { rootM: 60, triadQ: 0, type7: 'dom7', ext: '7th', ivs: [0, 4, 7, 10, 13, 21], named: true, label: 'C13b9' };
  typed.ext = '9th';
  M._slotFromMenu(typed);
  same(typed.ivs, M.getIntvs(0, 'dom7', '9th'), 'the menu replaces a typed chord\'s notes with its own');
  ok(!typed.named, 'and drops the typed name');
  ok(typed.label === 'relabelled:9th', 'and re-spells the label from the fields', typed.label);
  const plain = { rootM: 62, triadQ: 1, type7: 'min7', ext: '7th' };
  plain.ext = 'b9'; M._slotFromMenu(plain);
  same(plain.ivs, [0, 3, 7, 10, 13], 'a plain slot re-stamped on a menu change (m7b9)');
}

console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
