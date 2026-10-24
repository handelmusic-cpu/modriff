/* A saved song stores its drums, bass and melody, and loading it puts them back.
   Also: the dice never hands a free build a Pro drum kit.

   saveToSetlist used to read sqMach, sqGrid, blWave, blGrid ... as bare names.
   They are locals of the sequencer's and the bass's own IIFEs, so the first read
   threw a ReferenceError that the surrounding try/catch swallowed, and a saved
   song carried only its chords and its melody — while the toast said
   "Saved with rhythm & bass". Reading the code could not show that; saving a
   song and opening the stored record does.

   Run (repo served; Chrome or Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/song/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/toast/probe.js). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);

  // ── 1. Put recognisable drums and bass on screen, with the rhythm switch on.
  const made = await page.evaluate(() => {
    setModTier('pro');
    // Drums: the 606, steps 1, 5 and 9 of the first row struck.
    const sq = window._sqCaptureState();
    sq.mach = '606'; sq.steps = 16;
    const row = Object.keys(sq.grid)[0];
    sq.grid[row] = sq.grid[row].map((c, i) => Object.assign({}, c, { v: (i % 4 === 0) ? 1 : 0 }));
    window._sqRestoreState(sq);
    // Bass: a fifth on step 3 and a high note on step 9, on a plain saw.
    const bl = window._blCaptureState();
    bl.wave = 'saw';
    bl.grid[2] = Object.assign({}, bl.grid[2], { note: 7, oct: 2, v: 1, usr: 1 });
    bl.grid[8] = Object.assign({}, bl.grid[8], { note: 11, oct: 3, v: 1, usr: 1 });
    window._blRestoreState(bl);
    // A chart to save.
    sections.length = 0;
    sections.push({ name: 'Verse', follow: 'repeat', plays: 1, slots: [{ rootM: 48, bars: 1, beats: 0, eighths: 0, label: 'C' }] });
    document.getElementById('chart-title').value = 'Round trip';
    if (!songSaveRhythm) toggleSaveRhythm();
    curSetlistIdx = -1; localStorage.setItem('prism-sl', '[]'); setlistData = [];
    saveToSetlist();
    const sqNow = window._sqCaptureState(), blNow = window._blCaptureState();
    return { row, kit: sqNow.mach, hits: sqNow.grid[row].map(c => c.v).join(''),
             blWave: blNow.wave, b2: blNow.grid[2].note + '/' + blNow.grid[2].oct, b8: blNow.grid[8].note + '/' + blNow.grid[8].oct };
  });
  check(made.kit === '606' && made.hits.startsWith('1000100010001000'), 'the drums on screen are the ones set', made.kit + ' ' + made.hits);
  check(made.blWave === 'saw' && made.b2 === '7/2' && made.b8 === '11/3', 'the bass on screen is the one set', made.blWave + ' ' + made.b2 + ' ' + made.b8);

  // ── 2. The stored record carries them.
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('prism-sl'))[0]);
  check(!!rec, 'the song was stored');
  const r = rec && rec.savedRhythm, b = rec && rec.savedBass, m = rec && rec.savedMelody;
  check(!!r, 'the stored song has its drums (savedRhythm)');
  check(!!b, 'the stored song has its bass (savedBass)');
  check(!!m, 'the stored song has its melody (savedMelody)');
  check(r && r.mach === '606', 'the stored drum kit is the 606', r && r.mach);
  check(r && r.grid && r.grid[made.row] && r.grid[made.row].map(c => c.v).join('').startsWith('1000100010001000'), 'the stored drum pattern is the one struck');
  check(b && b.wave === 'saw', 'the stored bass voice is the saw', b && b.wave);
  check(b && b.grid && b.grid[2].note === 7 && b.grid[8].note === 11, 'the stored bass line is the one written');

  // ── 3. Wreck the live state, load the song, and it comes back.
  const back = await page.evaluate(() => {
    const sq = window._sqCaptureState();
    sq.mach = 'JAZZ'; sq.grid = {};            // a different kit with an empty grid
    window._sqRestoreState(sq);
    const bl = window._blCaptureState();
    bl.wave = 'sine'; bl.grid = bl.grid.map(c => Object.assign({}, c, { v: 0, note: 0 }));
    window._blRestoreState(bl);
    const wrecked = { kit: window._sqCaptureState().mach, blWave: window._blCaptureState().wave };
    loadSong(JSON.parse(localStorage.getItem('prism-sl'))[0], 0);
    const sqNow = window._sqCaptureState(), blNow = window._blCaptureState();
    const row = Object.keys(sqNow.grid)[0];
    return { wrecked, kit: sqNow.mach, hits: (sqNow.grid[row] || []).map(c => c.v).join(''),
             blWave: blNow.wave, b2: blNow.grid[2].note, b8: blNow.grid[8].note };
  });
  check(back.wrecked.kit === 'JAZZ' && back.wrecked.blWave === 'sine', 'the live state really was changed first', JSON.stringify(back.wrecked));
  check(back.kit === '606', 'loading puts the drum kit back', back.kit);
  check(back.hits.startsWith('1000100010001000'), 'loading puts the drum pattern back', back.hits);
  check(back.blWave === 'saw', 'loading puts the bass voice back', back.blWave);
  check(back.b2 === 7 && back.b8 === 11, 'loading puts the bass line back', back.b2 + ',' + back.b8);

  // ── 4. A song saved WITHOUT the rhythm switch carries none (the switch still means something).
  const plain = await page.evaluate(() => {
    if (songSaveRhythm) toggleSaveRhythm();
    document.getElementById('chart-title').value = 'Chords only';
    curSetlistIdx = -1; localStorage.setItem('prism-sl', '[]'); setlistData = [];
    saveToSetlist();
    const s = JSON.parse(localStorage.getItem('prism-sl'))[0];
    return { r: !!s.savedRhythm, b: !!s.savedBass };
  });
  check(plain.r === false && plain.b === false, 'with +Rhythm off the song stores chords only', JSON.stringify(plain));

  // ── 5. A song made with a Pro kit and a Pro bass opens in a free build with
  //      stand-ins, and saving it there keeps the originals. (This is what the
  //      rhythm snapshot makes testable: until it worked, a song never held a
  //      kit or a bass voice for the free build to swap.)
  const keep = await page.evaluate(async () => {
    setModTier('pro');
    window._sqPickDrumKit('909'); window.setBlWave('upright2');
    await new Promise(r => setTimeout(r, 100));
    sections.length = 0;
    sections.push({ name: 'Verse', follow: 'repeat', plays: 1, slots: [{ rootM: 48, bars: 1, beats: 0, eighths: 0, label: 'C' }] });
    document.getElementById('chart-title').value = 'Pro kit';
    if (!songSaveRhythm) toggleSaveRhythm();
    curSetlistIdx = -1; localStorage.setItem('prism-sl', '[]'); setlistData = [];
    saveToSetlist();
    const made = JSON.parse(localStorage.getItem('prism-sl'))[0];
    setModTier('free'); freeApplyLimits();
    const toasts = []; const st = window.showToast; window.showToast = function (m) { toasts.push(String(m)); return st.apply(this, arguments); };
    loadSong(made, 0);
    await new Promise(r => setTimeout(r, 300));
    const live = { kit: window._sqDrumKit(), bass: window._blCaptureState().wave };
    document.getElementById('chart-title').value = 'Pro kit';
    saveToSetlist();
    const again = JSON.parse(localStorage.getItem('prism-sl'))[0];
    return { made: { kit: made.savedRhythm.mach, bass: made.savedBass.wave }, live,
             banner: toasts.filter(t => /This song/.test(t)),
             again: { kit: again.savedRhythm.mach, bass: again.savedBass.wave } };
  });
  check(keep.made.kit === '909' && keep.made.bass === 'upright2', 'the Pro song stored its Pro kit and bass', JSON.stringify(keep.made));
  check(['808','606','LIN','JAZZ'].includes(keep.live.kit), 'a free build plays a free kit instead', keep.live.kit);
  check(keep.live.bass !== 'upright2', 'and a free bass voice instead', keep.live.bass);
  check(keep.banner.length === 1 && /drum kit/.test(keep.banner[0]) && /Pro sound/.test(keep.banner[0]), 'one banner names the kit and the sound', keep.banner[0]);
  check(keep.again.kit === '909' && keep.again.bass === 'upright2', 'saving it again in the free build keeps the originals', JSON.stringify(keep.again));

  // ── 6. The dice, on a free build, never rolls a Pro drum kit.
  const dice = await page.evaluate(() => {
    setModTier('free');
    const seen = {}; let proRolls = 0;
    for (let i = 0; i < 80; i++) {
      randomizeSettings(); const k = window._sqDrumKit(); seen[k] = (seen[k] || 0) + 1;
      if (!freeAllowsKit(k)) proRolls++;
    }
    return { seen, proRolls };
  });
  check(dice.proRolls === 0, 'the dice never rolls a Pro kit on free (80 rolls)', JSON.stringify(dice.seen));
  check(Object.keys(dice.seen).length >= 3, 'and it still varies the kit', Object.keys(dice.seen).join(','));

  check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
