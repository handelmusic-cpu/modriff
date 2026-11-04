/* Voices in Find (6.7a): every voice is a result, the recorded instruments rank first, and choosing one sets it.

     - "piano": the recorded Piano comes before the synth Piano and the Electric Piano;
     - "sax", "organ", "vibes", "guitar" find their voice (they found nothing, or the wrong thing, before);
     - the plain waves rank below every other voice for a query that matches them all by keyword ("plain wave");
     - a generic word ("voice", "sound", "bass", "chords") is not taken over by voices: the controls those words are
       after stay on top;
     - "piano chords" puts the voice for Chords first, and "sax melody" finds Melody and not Chords;
     - choosing "Tenor Sax" for Chords puts tenorsax on the Chords part.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/findvoices/probe.js
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

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.goto(URL); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(500);
  const find = (q) => page.evaluate(q => { openFind(); document.getElementById('find-input').value = q; return _findMatches().map(e => e.name + ' | ' + e.where); }, q);
  const idx = (r, name) => r.findIndex(x => x.startsWith(name + ' |'));

  let r = await find('piano');
  check(idx(r, 'Piano ◆') === 0, 'piano: the recorded Piano is the first result', r.slice(0, 3).join(' / '));
  check(idx(r, 'Piano ◆') < idx(r, 'Piano (synth)') && idx(r, 'Piano ◆') < idx(r, 'Electric Piano'), 'piano: recorded before the synth Piano and the Electric Piano');
  for (const [q, name] of [['sax', 'Tenor Sax ◆'], ['organ', 'Organ'], ['vibes', 'Vibes ◆'], ['guitar', 'Jazz Gtr ◆'], ['trumpet', 'Mute Tpt ◆']]) {
    r = await find(q);
    check(idx(r, name) >= 0 && idx(r, name) < 5, q + ': finds ' + name, r.slice(0, 3).join(' / '));
  }
  const bo = await page.evaluate(() => ['sine', 'sawtooth', 'piano', 'modsynth', 'tenorsax'].map(_findVoiceBoost));
  check(bo[0] < 0 && bo[1] < 0 && bo[0] < bo[2] && bo[2] < bo[3] && bo[3] < bo[4], 'ranking: plain waves < synth voices < mõdSynth < recorded instruments', JSON.stringify(bo));

  for (const [q, want] of [['bass', 'Bass sequencer'], ['chords', 'Sub under the chords'], ['voice', 'Voice leading'], ['sound', 'Voices — change']]) {
    r = await find(q);
    // At most one voice may sit among the first three (a voice that is NAMED the word, "Violin Bass"); the controls the word is after follow it.
    check(r.slice(0, 3).some(x => x.startsWith(want)) && r.slice(0, 3).filter(x => /Voices ›/.test(x)).length <= 1, q + ': the controls it is after stay on top', r.slice(0, 3).join(' / '));
  }
  r = await find('piano chords');
  check(r[0] === 'Piano ◆ | Voices › Chords', 'piano chords: the recorded Piano for Chords is first', r[0]);
  r = await find('sax melody');
  check(r[0].startsWith('Tenor Sax ◆ | Voices › Melody') && !r.some(x => x === 'Tenor Sax ◆ | Voices › Chords'), 'sax melody: Melody, not Chords', r.slice(0, 3).join(' / '));

  // Choosing one sets it.
  const before = await page.evaluate(() => wave);
  await page.evaluate(() => { openFind(); document.getElementById('find-input').value = 'tenor sax chords'; const l = _findMatches(); runFind(l.findIndex(e => e.voice && /Chords/.test(e.where))); });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => wave);
  check(before !== 'tenorsax' && after === 'tenorsax', 'choosing Tenor Sax for Chords sets the Chords voice', before + ' -> ' + after);

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
