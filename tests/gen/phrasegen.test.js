/* PhraseGen, the melody and bass generators' composer (1.x), measured rather than read.

   Lifted out of index.html (between its ==PhraseGen== markers) and run in Node, many lines per style, counting:
     - written rhythms: each style draws from 8 to 16 hand-written cells, picked to suit the tempo and the kick;
     - variety: how many of 300 presses give a different line, and a different rhythm (Pop Hook was one fixed
       rhythm on every press);
     - key: every note is in the key's scale or the chord (Jazz, Funk and Motown may approach by a half step);
     - harmony: strong positions of a melody sit on chord tones; a bass says the root with the first note of a bar;
     - register: everything inside the range it was given; no note rings into the next (lengths fit the gaps);
     - tempo: at 170 bpm the busy styles write fewer notes, and fewer sixteenths, than at 75;
     - groove: a bass given a syncopated kick puts more of its notes on the kick than one given none;
     - meter: in 3/4 the bass's roots fall on the bars of twelve;
     - a theme put on another chord keeps its rhythm and fits the new chord.

   Run: node tests/gen/phrasegen.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const a = src.indexOf('// ==PhraseGen begin=='), b = src.indexOf('// ==PhraseGen end==');
if (a < 0 || b < 0) { console.log('FAIL PhraseGen markers not found'); process.exit(1); }
const window = {};
new Function('window', src.slice(a, b))(window);
const PG = window.PhraseGen;

let failed = 0;
const ok = (c, label, detail) => { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (detail !== undefined ? '  (' + detail + ')' : '')); };
const mod12 = x => ((x % 12) + 12) % 12;
// A seeded generator, so a failure can be replayed.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MEL = { steps: 16, keyPc: 0, scale: [0,2,4,5,7,9,11], chordRoot: 60, chordIvs: [0,4,7], bpm: 110, lo: 55, hi: 84, centre: 74 };
const BASS = { steps: 16, keyPc: 0, scale: [0,2,4,5,7,9,11], chordRoot: 48, chordIvs: [0,4,7], bpm: 110, lo: 33, hi: 57, centre: 40 };
const notes = cells => cells.map((c, i) => c.v ? { at: i, m: c.note + (c.oct + 1) * 12, len: c.len } : null).filter(Boolean);
const N = 300;
function run(part, base, style, extra, n, seed) {
  const R = rng(seed || 7), out = [];
  for (let i = 0; i < (n || N); i++) out.push(PG.generate(part, Object.assign({}, base, extra || {}, { style, rand: R })).cells);
  return out;
}
const STRONG = at => at % 4 === 0;
const CHROM_OK = { jazz: 1, funk: 1, motown: 1 };

for (const [part, base] of [['mel', MEL], ['bass', BASS]]) {
  for (const style of PG.styles(part)) {
    const lines = run(part, base, style);
    const keyLine = l => JSON.stringify(notes(l).map(n => [n.at, n.m, n.len]));
    const keyRhy = l => notes(l).map(n => n.at).join(',');
    const distinct = new Set(lines.map(keyLine)).size, rhythms = new Set(lines.map(keyRhy)).size;
    const all = lines.flatMap(notes);
    const scale = base.scale.map(d => mod12(base.keyPc + d)), chord = base.chordIvs.map(d => mod12(base.chordRoot + d));
    const inKey = all.filter(n => scale.includes(mod12(n.m)) || chord.includes(mod12(n.m))).length / all.length;
    const inRange = all.every(n => n.m >= base.lo && n.m <= base.hi);
    let overlaps = 0;
    for (const l of lines) { const ns = notes(l); ns.forEach((n, i) => { const nx = i + 1 < ns.length ? ns[i + 1].at : 16 + ns[0].at; if (n.len > nx - n.at) overlaps++; }); }
    // Very fixed styles (a pedal, a walk over one chord) are allowed to repeat themselves more.
    const want = { pedal: 12, halftime: 15, jazz: 15, arpeggio: 15 }[style] || 60;
    ok(distinct >= want * N / 100, part + ' ' + style + ': ' + distinct + ' different lines in ' + N + ' presses, ' + rhythms + ' rhythms', '>= ' + want + '%');
    ok(inKey >= (CHROM_OK[style] ? .9 : .995), part + ' ' + style + ': notes in the key or the chord', (inKey * 100).toFixed(1) + '%');
    ok(inRange && overlaps === 0, part + ' ' + style + ': in range, no note rings into the next', 'overlaps ' + overlaps);
    if (part === 'mel' && style !== 'scalerun') {
      const st = all.filter(n => STRONG(n.at)), ct = st.filter(n => chord.includes(mod12(n.m))).length / Math.max(1, st.length);
      ok(ct >= .75, part + ' ' + style + ': beats land on chord tones', (ct * 100).toFixed(0) + '%');
    }
    if (part === 'bass') {
      const first = lines.map(l => notes(l)[0]).filter(Boolean), roots = first.filter(n => mod12(n.m) === 0).length / first.length;
      ok(roots >= .8, part + ' ' + style + ': the first note is the root', (roots * 100).toFixed(0) + '%');
    }
  }
}

// ── the written rhythms ──
// Each style with a rhythm vocabulary has 8 to 16 cells, and in 4/4 its lines open with one of them (a quarter of
// presses move one onset a sixteenth, and the tail of a phrase is developed, so the opening cell is what is held).
for (const [part, base] of [['mel', MEL], ['bass', BASS]]) for (const style of PG.styles(part)) {
  const cells = PG.rhythms(part, style); if (!cells) continue;
  const L = Math.max(...cells.map(c => c[c.length - 1])) > 7 ? 16 : 8;
  const set = new Set(cells.map(c => c.join(',')));
  const ls = run(part, base, style, {}, 300, 17);
  const hit = ls.filter(l => set.has(notes(l).filter(n => n.at < L).map(n => n.at).join(','))).length / ls.length;
  ok(cells.length >= 8 && cells.length <= 16 && hit >= .6, part + ' ' + style + ': ' + cells.length + ' written rhythms, and the lines open with one', (hit * 100).toFixed(0) + '%');
}

// ── tempo ──
for (const [part, base, style] of [['mel', MEL, 'hook'], ['mel', MEL, 'funk'], ['bass', BASS, 'funk'], ['bass', BASS, 'motown'], ['mel', MEL, 'jazz']]) {
  const stat = bpm => { const ls = run(part, base, style, { bpm }, 300, 11); const ns = ls.flatMap(notes); return { per: ns.length / ls.length, six: ns.filter(n => n.at % 2).length / ns.length }; };
  const slow = stat(75), fast = stat(170);
  ok(fast.per < slow.per && fast.six < slow.six, part + ' ' + style + ': fewer notes and sixteenths at 170 bpm than at 75',
     slow.per.toFixed(2) + '/' + (slow.six * 100).toFixed(0) + '% -> ' + fast.per.toFixed(2) + '/' + (fast.six * 100).toFixed(0) + '%');
}

// ── groove ──
const kick = Array(16).fill(0); [0, 3, 6, 10, 11].forEach(i => kick[i] = 1);
const snare = Array(16).fill(0); [4, 12].forEach(i => snare[i] = 1);
const groove = { steps: 16, kick, snare, hat: Array(16).fill(1) };
// Motown is left out on purpose: its bass is a melodic line that plays through the kick, not on it.
for (const style of ['funk', 'rock', 'hook', 'riff']) {
  const on = (ls) => { const ns = ls.flatMap(notes); return { k: ns.filter(n => kick[n.at]).length / ns.length, s: ns.filter(n => snare[n.at]).length / ns.length }; };
  const free = on(run('bass', BASS, style, {}, 300, 5)), locked = on(run('bass', BASS, style, { groove }, 300, 5));
  ok(locked.k > free.k + .08, 'bass ' + style + ': locks onto the kick', (free.k * 100).toFixed(0) + '% -> ' + (locked.k * 100).toFixed(0) + '% of notes on a kick');
  if (style === 'funk') ok(locked.s < free.s, 'bass funk: keeps off the snare', (free.s * 100).toFixed(0) + '% -> ' + (locked.s * 100).toFixed(0) + '%');
}
{
  const ns = run('mel', MEL, 'hook', { groove }, 300, 9).flatMap(notes), f = run('mel', MEL, 'hook', {}, 300, 9).flatMap(notes);
  const k = x => x.filter(n => kick[n.at] && n.at % 4).length / x.length;
  ok(k(ns) > k(f), 'mel hook: borrows the kick\'s off-beat pushes', (k(f) * 100).toFixed(0) + '% -> ' + (k(ns) * 100).toFixed(0) + '%');
}

// ── key and mode ──
{
  const D = { keyPc: 2, scale: [0,2,3,5,7,9,10], chordRoot: 62, chordIvs: [0,3,7,10] };
  const sc = [0,2,3,5,7,9,10].map(d => mod12(2 + d));
  for (const st of ['hook', 'riff', 'rock', 'callresponse', 'latin', 'arpeggio']) {
    const ns = run('mel', MEL, st, D, 200, 3).flatMap(notes);
    ok(ns.every(n => sc.includes(mod12(n.m))), 'D Dorian over Dm7, mel ' + st + ': every note in D Dorian');
  }
  const E = { keyPc: 4, scale: [0,1,3,5,7,8,10], chordRoot: 40, chordIvs: [0,3,7] };
  const se = [0,1,3,5,7,8,10].map(d => mod12(4 + d));
  for (const st of ['rock', 'reggae', 'latin', 'pedal', 'hook']) {
    const ns = run('bass', BASS, st, E, 200, 4).flatMap(notes);
    ok(ns.every(n => se.includes(mod12(n.m))), 'E Phrygian, bass ' + st + ': every note in E Phrygian');
  }
  // A slash chord: the bass starts on its bass note.
  const sl = run('bass', BASS, 'rock', { chordRoot: 48, chordIvs: [-8, 0, 4, 7] }, 200, 6).map(l => notes(l)[0]);
  ok(sl.filter(n => mod12(n.m) === 4 || mod12(n.m) === 0).length / sl.length > .95, 'C/E: the bass starts on E or C');
}

// ── meter ──
{
  const ls = run('bass', BASS, 'rock', { steps: 24, meter: { beats: 3, unit: 4 } }, 200, 8);
  const r12 = ls.filter(l => { const n12 = notes(l).find(n => n.at >= 12 && n.at < 16); return !n12 || mod12(n12.m) === 0 || n12.at > 12; });
  const bar2 = ls.map(l => notes(l).find(n => n.at >= 12)).filter(Boolean);
  ok(bar2.filter(n => mod12(n.m) === 0).length / bar2.length > .8, '3/4, 24 steps: the second bar (step 12) starts on the root', (bar2.filter(n => mod12(n.m) === 0).length / bar2.length * 100).toFixed(0) + '%');
}

// ── longer grids ──
{
  const ls = run('mel', MEL, 'hook', { steps: 32 }, 200, 12);
  const halves = ls.filter(l => { const ns = notes(l); const A = ns.filter(n => n.at < 8).map(n => n.at).join(), B = ns.filter(n => n.at >= 16 && n.at < 24).map(n => n.at - 16).join(); return A === B; }).length;
  ok(halves / ls.length > .5, '32-step hook: the motif comes back (bar 2 opens with bar 1\'s rhythm)', (halves / ls.length * 100).toFixed(0) + '%');
  const ends = ls.map(l => notes(l).at(-1)), home = ends.filter(n => [0, 4].includes(mod12(n.m))).length / ends.length;
  ok(home > .9, '32-step hook: ends home (root or third)', (home * 100).toFixed(0) + '%');
  const all = run('bass', BASS, 'funk', { steps: 64 }, 100, 13);
  ok(all.every(l => notes(l).some(n => n.at >= 48)), '64-step bass: the last bar has notes');
}

// ── themes ──
for (const [part, base, style] of [['mel', MEL, 'hook'], ['mel', MEL, 'motown'], ['bass', BASS, 'funk'], ['bass', BASS, 'reggae']]) {
  let same = 0, fit = 0, strongN = 0, differ = 0;
  const R = rng(21);
  for (let i = 0; i < 100; i++) {
    const first = PG.generate(part, Object.assign({}, base, { style, rand: R }));
    // The same hook on an F chord, then on Am.
    const F = PG.generate(part, Object.assign({}, base, { style, rand: R, theme: first.theme, chordRoot: base.chordRoot + 5, chordIvs: [0,4,7] }));
    const a0 = notes(first.cells).map(n => n.at).join(), a1 = notes(F.cells).map(n => n.at).join();
    if (a0 === a1) same++;
    if (JSON.stringify(notes(first.cells).map(n => mod12(n.m))) !== JSON.stringify(notes(F.cells).map(n => mod12(n.m)))) differ++;
    const fc = [5, 9, 0];
    notes(F.cells).filter(n => n.at % 8 === 0).forEach(n => { strongN++; if (fc.includes(mod12(n.m))) fit++; });
  }
  ok(same >= 95, part + ' ' + style + ': a theme on another chord keeps its rhythm', same + '/100');
  ok(differ >= 95 && fit / strongN > .8, part + ' ' + style + ': ...and is refitted to that chord', 'downbeats on F chord tones ' + (fit / strongN * 100).toFixed(0) + '%');
}

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
