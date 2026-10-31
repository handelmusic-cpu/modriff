/* Tab in (5.0): ASCII tab, the kind Ultimate Guitar serves, to notes, to a .mid, and into
   the melody roll. Measured on the real page, not read off the diff.
   - parseAsciiTab: string and fret to pitch (standard, capo, labels that say another
     tuning, a Tuning: line, bass), a note ringing until its string is struck again or the
     bar ends, h/p/slides as softer second notes, a bend's target is not a note, two-digit
     frets, bar lines costing no time, section names.
   - tabToMidi: the bytes, decoded here by a second reader: tempo, markers, every note on and
     off at col*120 ticks.
   - The dialog: preview, the 8th/16th choice changing the file, Download .mid saving it.
   - Into the melody roll: the right steps and pitches, lifted whole octaves to clear C3,
     Follow turned off, Undo, and then playing it: the engine is sent those notes at those steps.
   Run: node tests/tab/tab.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
const J = x => JSON.stringify(x);
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
// A second, independent SMF reader.
function readSmf(bytes) {
  const b = Buffer.from(bytes); let p = 0; const out = { notes: [], markers: [], tempo: null, name: null, program: null, end: 0 };
  const str = n => { const s = b.toString('latin1', p, p + n); p += n; return s; };
  if (str(4) !== 'MThd') return null; p += 4; out.format = b.readUInt16BE(p); out.ntrk = b.readUInt16BE(p + 2); out.tpq = b.readUInt16BE(p + 4); p += 6;
  if (str(4) !== 'MTrk') return null; const len = b.readUInt32BE(p); p += 4; const stop = p + len;
  let tick = 0, run = 0; const on = {};
  const vl = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 127); } while (c & 128); return v; };
  while (p < stop) {
    tick += vl(); let s = b[p];
    if (s === 0xff) { p++; const t = b[p++], l = vl(); const d = b.slice(p, p + l); p += l;
      if (t === 0x51) out.tempo = (d[0] << 16) | (d[1] << 8) | d[2];
      if (t === 0x06) out.markers.push([tick, d.toString('latin1')]);
      if (t === 0x03) out.name = d.toString('latin1');
      if (t === 0x2f) out.end = tick; continue; }
    if (s & 0x80) { run = s; p++; } else s = run;
    const hi = s & 0xf0;
    if (hi === 0x90 || hi === 0x80) { const n = b[p++], v = b[p++];
      if (hi === 0x90 && v > 0) on[n] = { n, on: tick, v }; else if (on[n]) { out.notes.push({ n, on: on[n].on, off: tick, v: on[n].v }); delete on[n]; } }
    else if (hi === 0xc0) out.program = b[p++]; else p += 2;
  }
  out.stuck = Object.keys(on).length; out.notes.sort((a, b2) => a.on - b2.on || a.n - b2.n); return out;
}

const T_BASIC = [
  'e|0---------------|', 'B|----1-----------|', 'G|--------0-------|', 'D|------------2---|', 'A|----------------|', 'E|----------------|'].join('\n');

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200); await page.mouse.click(5, 5); await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(600);

  // ── parseAsciiTab ──
  const P = (t, o) => page.evaluate(([t, o]) => { const r = parseAsciiTab(t, o); return r; }, [t, o]);
  let r = await P(T_BASIC);
  ok(r.notes.length === 4 && r.blocks.length === 1 && r.total === 16, 'a six-string bar: four notes, one block, 16 columns', J({ n: r.notes.length, t: r.total }));
  ok(J(r.notes.map(n => [n.t, n.midi, n.len])) === J([[0, 64, 16], [4, 60, 12], [8, 55, 8], [12, 52, 4]]),
    'open e = E4, B fret 1 = C4, G open, D fret 2; each rings to the bar end', J(r.notes.map(n => [n.t, n.midi, n.len])));
  ok(r.tuning === 'E A D G B E' && r.blocks[0].inst === 'guitar', 'standard tuning read', r.tuning);

  r = await P('Capo: 2nd fret\n' + T_BASIC);
  ok(r.capo === 2 && r.notes[0].midi === 66, 'a capo lifts every note', J([r.capo, r.notes[0].midi]));

  r = await P(['e|-12-10-----|', 'B|-----------|', 'G|-----------|', 'D|-----------|', 'A|-----------|', 'E|-----------|'].join('\n'));
  ok(J(r.notes.map(n => [n.t, n.midi])) === J([[1, 76], [4, 74]]), 'two-digit frets read as one fret each (12 -> E5, 10 -> D5)', J(r.notes.map(n => [n.t, n.midi])));

  // Drop D by its labels; Eb by a Tuning: line.
  const drop = ['e|-0--------|', 'B|----------|', 'G|----------|', 'D|----------|', 'A|----------|', 'D|-0--------|'].join('\n');
  r = await P(drop);
  ok(r.tuning === 'D A D G B E' && r.notes.map(n => n.midi).sort().join() === '38,64', 'labels D A D G B E: the low string is D2', r.tuning + ' ' + r.notes.map(n => n.midi));
  r = await P('Tuning: Eb Ab Db Gb Bb Eb\n' + T_BASIC);
  ok(J(r.notes.map(n => n.midi)) === J([63, 59, 54, 51]), 'a Tuning: line wins over the labels (Eb Ab Db Gb Bb Eb: Eb4, Bb3+1, Gb3, Db3+2)', r.notes.map(n => n.midi));
  r = await P('Tuning: Half step down\n' + T_BASIC);
  ok(r.notes[0].midi === 63, 'Half step down is one semitone under', String(r.notes[0].midi));
  // No labels at all: standard.
  r = await P(T_BASIC.replace(/^[A-G]\|/gm, '|'));
  ok(r.notes.length === 4 && r.notes[0].midi === 64, 'a staff with no labels is read as standard', J(r.notes.map(n => n.midi)));

  // Bass, four lines.
  r = await P(['G|--------------|', 'D|--------------|', 'A|----3---------|', 'E|0-------------|'].join('\n').replace(/\|$/gm, '|'));
  ok(r.blocks[0].inst === 'bass' && J(r.notes.map(n => n.midi)) === J([28, 36]), 'four lines are a bass: E1 and C2', J(r.notes.map(n => n.midi)) + r.blocks[0].inst);
  r = await P(['G|--------------|', 'D|--------------|', 'A|----3---------|', 'E|0-------------|'].join('\n'), { inst: 'guitar' });
  ok(r.notes.length === 2, 'Guitar forced onto four lines still reads', String(r.notes.length));

  // Techniques.
  const tech = ['e|-5h7p5---7b9r7---/12-x-(5)-|', 'B|---------------------------|', 'G|---------------------------|', 'D|---------------------------|', 'A|---------------------------|', 'E|---------------------------|'].join('\n');
  r = await P(tech);
  const vel = r.notes.map(n => n.vel + ':' + (n.midi - 64));
  ok(J(vel) === J(['92:5', '72:7', '72:5', '92:7', '72:12']), 'h/p make soft notes; a bend\'s target, x and (5) make none', J(vel));

  // Bar lines cost no time; two bars of 16.
  const two = ['e|0---------------|--------------0-|', 'B|----------------|----------------|', 'G|----------------|----------------|', 'D|----------------|----------------|', 'A|----------------|----------------|', 'E|----------------|----------------|'].join('\n');
  r = await P(two);
  ok(r.total === 32 && J(r.notes.map(n => n.t)) === J([0, 30]), 'two bars: 32 columns, the bar line is not one of them', J({ t: r.total, n: r.notes.map(n => n.t) }));

  // Sections, two blocks, lyrics and chords ignored.
  const song = '[Intro]\n' + T_BASIC + '\n\nAm       G\nSome words in the way\n\nChorus:\n' + T_BASIC;
  r = await P(song);
  ok(r.blocks.length === 2 && r.blocks[0].name === 'Intro' && r.blocks[1].name === 'Chorus' && r.blocks[1].start === 16 && r.total === 32,
    'sections named, blocks end to end, lyrics and chord lines ignored', J(r.blocks.map(b => [b.name, b.start])));
  r = await P('Just some lyrics a-ha, b-b-baby\nAm G C\n');
  ok(r.notes.length === 0, 'lyrics are not tab', String(r.notes.length));

  // ── tabToMidi ──
  const bytes = await page.evaluate(([t, o]) => Array.from(tabToMidi(parseAsciiTab(t), o)), [song, { colTicks: 120, bpm: 90, title: 'Riff' }]);
  const m = readSmf(bytes);
  ok(m && m.format === 0 && m.tpq === 480 && m.tempo === Math.round(60000000 / 90), 'SMF type 0, 480 tpq, tempo 90', J(m && [m.format, m.tpq, m.tempo]));
  ok(m.notes.length === 8 && m.stuck === 0, 'eight notes, every one switched off', J([m.notes.length, m.stuck]));
  ok(J(m.notes.slice(0, 4).map(n => [n.on, n.off, n.n])) === J([[0, 1920, 64], [480, 1920, 60], [960, 1920, 55], [1440, 1920, 52]]), 'ticks are column * 120', J(m.notes.slice(0, 4).map(n => [n.on, n.off, n.n])));
  ok(J(m.markers) === J([[0, 'Intro'], [1920, 'Chorus']]) && m.name === 'Riff' && m.program === 25, 'section markers, name, guitar program', J([m.markers, m.name, m.program]));
  ok(m.end === 3840, 'the file runs to the end of the last bar', String(m.end));
  const m8 = readSmf(await page.evaluate(t => Array.from(tabToMidi(parseAsciiTab(t), { colTicks: 240, bpm: 120 })), T_BASIC));
  ok(m8.notes[1].on === 960, 'an 8th per dash doubles every time', String(m8.notes[1].on));

  // ── the dialog ──
  const dlg = await page.evaluate(() => {
    document.querySelectorAll('.csi-overlay').forEach(e => e.remove());
    openTabImport();
    return !!document.querySelector('.tbi-text');
  });
  ok(dlg, 'the dialog opens');
  await page.evaluate(t => { const ta = document.querySelector('.tbi-text'); ta.value = t; ta.dispatchEvent(new Event('input')); }, song);
  await page.waitForTimeout(300);
  const pv = await page.evaluate(() => ({ head: document.querySelector('.csi-head').textContent, rows: document.querySelectorAll('.csi-sec').length,
    go: document.querySelector('.tbi-go').disabled, roll: document.querySelector('.tbi-roll').disabled, opts: document.querySelectorAll('.tbi-block option').length,
    active: [...document.querySelectorAll('[data-tbicol].active')].map(b => b.dataset.tbicol) }));
  ok(/8 notes/.test(pv.head) && pv.rows === 2 && !pv.go && !pv.roll && pv.opts === 2 && pv.active[0] === '120', 'preview: 8 notes, two parts, buttons live, 16th picked', J(pv));
  await page.evaluate(() => document.querySelector('[data-tbicol="240"]').click());
  const dl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('.tbi-go').click());
  const d = await dl; let fileOk = false, fname = '';
  if (d) { fname = d.suggestedFilename(); const rd = readSmf(fs.readFileSync(await d.path())); fileOk = rd && rd.notes.length === 8 && rd.notes[1].on === 960; }
  ok(d && /\.mid$/.test(fname) && fileOk, 'Download .mid saves a file with the 8th-note timing', fname);
  ok(!(await page.evaluate(() => !!document.querySelector('.csi-overlay'))), 'and the dialog closes');

  // ── into the melody roll ──
  // A riff with low notes (E2, A2 = 40, 45) so the lift is exercised, and a chord on step 8.
  const riff = ['e|--------0-------|', 'B|--------0-------|', 'G|----------------|', 'D|----------------|', 'A|----0-----------|', 'E|0---------------|'].join('\n');
  await page.evaluate(() => { melMono = true; melAuto = true; });
  await page.evaluate(t => { document.querySelectorAll('.csi-overlay').forEach(e => e.remove()); openTabImport();
    const ta = document.querySelector('.tbi-text'); ta.value = t; ta.dispatchEvent(new Event('input')); }, '[Verse]\n' + riff);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => { mlFollow = true; return window._mlCaptureState().steps; });
  await page.evaluate(() => document.querySelector('.tbi-roll').click());
  const st = await page.evaluate(() => { const s = window._mlCaptureState(); return { steps: s.steps, follow: s.follow,
    cells: s.grid.map((c, i) => c.v ? [i, c.note + (c.oct + 1) * 12, c.len, (c.more || []).map(e => e.note + (e.oct + 1) * 12), c.usr] : null).filter(Boolean) }; });
  // E2=40 lifted +12 = 52, A2=45 -> 57, B3 (59) and e4 (64) are also lifted? lowest is 40, so lift is 12 for all.
  ok(st.steps === 16 && st.follow === false, '16 steps, Follow off', J(st));
  ok(st.cells.length === 3 && st.cells[0][0] === 0 && st.cells[0][1] === 52 && st.cells[1][1] === 57 && st.cells[2][0] === 8 && st.cells[2][1] === 71 && J(st.cells[2][3]) === '[76]',
    'notes land on their steps, lifted an octave, the two strings struck together are one chord step', J(st.cells));
  ok(st.cells[0][2] === 16 && st.cells[1][2] === 12 && st.cells[2][2] === 8 && st.cells.every(c => c[4] === 1), 'lengths in steps (a string rings to the bar end unless struck again), all marked as the player\'s own', J(st.cells));
  // Undo puts the roll back.
  await page.evaluate(() => { const b = document.querySelector('#_toast ._toast-btn'); if (b) b.click(); });
  const undone = await page.evaluate(() => ({ steps: window._mlCaptureState().steps, follow: window._mlCaptureState().follow, v: window._mlCaptureState().grid.filter(c => c.v).length }));
  ok(undone.steps === before && undone.follow === true && undone.v === 0, 'Undo restores the roll and Follow', J(undone));

  // Play the imported roll and count what the engine is sent.
  await page.evaluate(t => { document.querySelectorAll('.csi-overlay').forEach(e => e.remove()); openTabImport();
    const ta = document.querySelector('.tbi-text'); ta.value = t; ta.dispatchEvent(new Event('input')); }, riff);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.tbi-roll').click());
  const play = await page.evaluate(async () => {
    if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) { } }
    await audioCtx.resume();
    const sent = []; window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); }; window.modEngine.ready = () => true;
    document.getElementById('bpm').value = 240; try { setBPM(240); } catch (e) { }
    window.mlPlay(); await new Promise(r => setTimeout(r, 1200)); window.mlPlay();
    return { bpm: parseFloat(document.getElementById('bpm').value), notes: sent.filter(m => m.kind === 'note' && m.part === 'melgen').sort((a, b) => a.at - b.at).map(m => ({ n: m.note, at: m.at })) };
  });
  const first = play.notes.slice(0, 4);
  ok(first.length >= 4 && J(first.slice(0, 2).map(x => x.n)) === J([52, 57]) && J(first.slice(2).map(x => x.n).sort()) === J([71, 76]),
    'played back: 52, 57, then 71 and 76 together', J(first));
  const sixteenth = 60 / play.bpm / 4;   // the tempo the clock really took (it is capped below 240)
  ok(Math.abs((first[1].at - first[0].at) - 4 * sixteenth) < 0.01 && Math.abs((first[2].at - first[1].at) - 4 * sixteenth) < 0.01 && Math.abs(first[2].at - first[3].at) < 0.01,
    'at steps 0, 4 and 8 of the clock (' + play.bpm + ' bpm)', J(first.map(x => +x.at.toFixed(3))));

  ok(errs.length === 0, 'no page errors', errs.join('; '));
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
