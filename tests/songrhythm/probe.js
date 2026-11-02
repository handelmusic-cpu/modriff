/* The rhythm picked on Studio's Chords page is the song's default rhythm (6.3).

   Before, a song ignored it: a chord with no rhythm of its own played the song's comp, one hit at the top of each
   bar, so a chord that lasted several bars sounded as a chord struck once a bar however busy the rhythm was. Now a
   chord that has not been given another follows the rhythm that is switched on, plays it over its whole length and is
   cut where the next chord starts.

   Driven on the real window: the song loop plays a slow-chord song (chords of 2 to 3 bars) and a fast-chord song
   (a beat or two each) and the chord attacks are counted per chord (playChord is wrapped; each chord has its own
   root, so a count is by root). At 160 BPM a bar is 1.5 s.
     - Rhythm off: one hit a bar, as it always was (slow 3,2,2,3; fast 1 each);
     - Every beat: 4 a bar on a slow chord (12,8,8,12) and the two beats a quick chord has (2, 2, 1, 1, 2, 2);
     - Eighths: 8 a bar (24,16,16,24) and (4, 4, 2, 2, 4, 4);
     - a rhythm drawn with two hits a bar: 6,4,4,6 on the slow song, and on the fast one only the hit on the downbeat
       (the second falls after the next chord has begun and is not played);
     - a chord with a rhythm of its own keeps it whatever is switched on (Beats 1 & 3 on a slow chord: 6);
     - the labels: the chord editor, the "All chords" list and the Studio picker call a built-in the same thing.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/songrhythm/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

const BPM = 160;
// [root, bars, beats, label]: every chord has its own root so a count is by root.
const SONGS = {
  slow: [[48, 3, 0, 'C'], [53, 2, 0, 'F'], [55, 2, 0, 'G'], [57, 3, 0, 'Am']],
  fast: [[48, 0, 2, 'C'], [53, 0, 2, 'F'], [55, 0, 1, 'G'], [57, 0, 1, 'Am'], [50, 0, 2, 'Dm'], [59, 0, 2, 'Bm']],
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(800);

  const count = (chords, cr, own) => page.evaluate(async ({ chords, cr, own, BPM }) => {
    stopSongLoop();
    document.getElementById('bpm').value = BPM; try { setBPM(BPM); } catch (e) { }
    sections.length = 0;
    const slots = chords.map((c, i) => Object.assign({ rootM: c[0], triadQ: 'maj', type7: false, ext: '', bassNote: null, bars: c[1], beats: c[2], eighths: 0, label: c[3], func: 'tonic', isRest: false },
      own && i === 0 ? { comp: own } : {}));
    sections.push({ name: 'A', slots, plays: 1, follow: 'repeat' });
    curSection = 0; songCurrentSection = 0; songCurrentSlot = -1; _songHeldAt = null;
    setSongCompStyle('bars');
    CR.on = false; CR.key = 'strum'; CR.def = null; CR.run = false;
    if (cr === 'drawn') { const d = rhyBlank(16); d.name = 'Two'; d.cells[0].on = 1; d.cells[8].on = 1; crSetRhythm(rhyRegister(d), d); }
    else if (cr) crSetRhythm(cr, null);
    const log = [], orig = window.playChord;
    window.playChord = function () { log.push({ root: arguments[0], t: arguments[5] }); return orig.apply(this, arguments); };
    const total = slots.reduce((a, s) => a + slotTotalMs(s) / 1000, 0);
    startSongLoop(false);
    await new Promise(r => setTimeout(r, total * 1000 + 600));
    stopSongLoop(); window.playChord = orig; CR.on = false;
    const t0 = Math.min(...log.filter(l => l.t != null).map(l => l.t));
    return slots.map(s => log.filter(l => l.t != null && l.t < t0 + total - 0.02 && l.root === s.rootM).length);
  }, { chords, cr, own, BPM });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cases = [
    ['slow', null, null, [3, 2, 2, 3], 'Studio rhythm off: a chord is struck once a bar, as it always was'],
    ['fast', null, null, [1, 1, 1, 1, 1, 1], 'Studio rhythm off, quick chords: one strike each'],
    ['slow', 'strum', null, [12, 8, 8, 12], 'Every beat on slow chords: four a bar for the whole of each chord'],
    ['fast', 'strum', null, [2, 2, 1, 1, 2, 2], 'Every beat on quick chords: cut where the next chord starts'],
    ['slow', 'eighths', null, [24, 16, 16, 24], 'Eighths on slow chords: eight a bar for the whole of each chord'],
    ['fast', 'eighths', null, [4, 4, 2, 2, 4, 4], 'Eighths on quick chords: cut where the next chord starts'],
    ['slow', 'drawn', null, [6, 4, 4, 6], 'a drawn rhythm of two hits a bar fills slow chords'],
    ['fast', 'drawn', null, [1, 1, 1, 1, 1, 1], 'a drawn rhythm: the hit that falls after the next chord has begun is not played'],
    ['slow', 'strum', 'backbeat', [6, 8, 8, 12], 'a chord with a rhythm of its own (Beats 1 & 3) keeps it'],
  ];
  for (const [song, cr, own, want, what] of cases) {
    const got = await count(SONGS[song], cr, own);
    check(eq(got, want), what + ' [' + song + ']', got.join(',') + ' want ' + want.join(','));
  }

  // The same pattern has one name wherever it is offered.
  const names = await page.evaluate(() => {
    const picker = CR_NOTES && Object.keys(CR_NOTES).filter(k => COMP_PATTERNS[k]).map(k => k + '=' + COMP_PATTERNS[k].label).join(',');
    const row = SB_COMP_MAIN.map(o => o[0] + '=' + o[1]).join(',');
    return { picker, row, main: SB_COMP_MAIN.map(o => o[0] + '=' + (COMP_PATTERNS[o[0]] || {}).label).join(',') };
  });
  check(names.row === names.main, 'the chord editor\'s Rhythm row and the Studio picker call each built-in the same thing', names.row + ' | ' + names.main);

  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
