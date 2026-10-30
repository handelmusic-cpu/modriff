/* The practice trainer: Speed up (and, as they land, Next key and Loop bars).

   Driven on the real song player, counted rather than read. The page plays a
   two-bar chart (Verse: C, Chorus: G) with the real ▶ Play Song path, and a
   sampler logs (time, chorus, tempo, section, slot) every time any of them
   changes.

   What it holds:
     - a chorus is counted when the LAST section finishes, not each section;
     - the tempo steps at that bar line: the sample where it changes is the
       first chord of the chart, not somewhere in the middle of a bar;
     - Stop puts the tempo back, unless the player moved it by hand;
     - a tempo that has reached the ceiling stays there.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/practice/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/song/probe.js). */
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

  // A chart the trainer can be counted on: two sections of one bar each.
  const setup = (opts) => page.evaluate((o) => {
    setModTier('pro');
    const slot = (rootM, label) => ({ rootM, bars: 1, beats: 0, eighths: 0, label, isRest: false, triadQ: 0, func: 'tonic', numeral: 'I' });
    sections.length = 0;
    sections.push({ name: 'Verse',  follow: 'next', plays: 1, slots: [slot(48, 'C')] });
    sections.push({ name: 'Chorus', follow: 'next', plays: o.lastPlays === undefined ? 1 : o.lastPlays, slots: [slot(55, 'G')] });
    songCurrentSection = -1; songCurrentSlot = -1;
    _setBpm(o.bpm);
    prac.ramp.on = false; prac.key.on = false;
    if (o.ramp) Object.assign(prac.ramp, o.ramp, { on: true });
    if (o.key) Object.assign(prac.key, o.key, { on: true });
    pracSync();
    window._log = [];
    let last = '';
    window._logTimer = setInterval(() => {
      const row = [Math.round(performance.now()), _pracRun.chorus, Math.round(_bpmNow()), songCurrentSection, songCurrentSlot,
                   ((root % 12) + 12) % 12, sections[0].slots[0].rootM, sections[0].slots[0].label];
      const key = row.slice(1).join(',');
      if (key !== last) { last = key; window._log.push(row); }
    }, 15);
    renderSongsPerformView();
    toggleSongAutoAdvance();
    return songLoopActive;
  }, opts);
  const stop = () => page.evaluate(() => { toggleSongAutoAdvance(); clearInterval(window._logTimer); return { bpm: Math.round(_bpmNow()), chorus: _pracRun.chorus, active: songLoopActive }; });

  // ── 1. Speed up: +5 BPM every chorus, to 215, from 200. A bar at 200 is 1.2 s.
  check(await setup({ bpm: 200, ramp: { step: 5, every: 1, max: 215 } }), 'the song is playing');
  await page.waitForTimeout(13000);
  const st = await page.evaluate(() => ({ chorus: _pracRun.chorus, bpm: Math.round(_bpmNow()), status: document.getElementById('prac-status').textContent }));
  const log = await page.evaluate(() => window._log);
  const stopped = await stop();
  const bpmSteps = [];
  log.forEach((r, i) => { if (i && r[2] !== log[i - 1][2]) bpmSteps.push({ bpm: r[2], sec: r[3], slot: r[4], chorus: r[1], prevSec: log[i - 1][3] }); });
  console.log('     tempo steps: ' + JSON.stringify(bpmSteps));
  check(st.chorus >= 4, 'several choruses were counted in 13 s of a 2.4 s chorus', st.chorus);
  check(bpmSteps.length === 3 && bpmSteps.map(b => b.bpm).join() === '205,210,215', 'it stepped 205, 210, 215 and no further', bpmSteps.map(b => b.bpm).join());
  check(st.bpm === 215, 'at the ceiling it stays', st.bpm);
  check(bpmSteps.every(b => b.sec === 0 && b.slot === 0 && b.prevSec === 1), 'each step lands as the Chorus hands over to the Verse (a bar line, not mid-bar)', JSON.stringify(bpmSteps.map(b => [b.prevSec, b.sec, b.slot])));
  check(/Chorus/.test(st.status) && /215/.test(st.status), 'the status line says where it is', st.status);
  check(stopped.bpm === 200, 'Stop puts the tempo back to where play started', stopped.bpm);
  check(!stopped.active, 'and the song stopped');

  // ── 2. Every 2 choruses.
  await page.evaluate(() => { _setBpm(200); });
  await setup({ bpm: 200, ramp: { step: 10, every: 2, max: 220 } });
  await page.waitForTimeout(11500);
  const log2 = await page.evaluate(() => window._log);
  const s2 = await stop();
  const steps2 = []; log2.forEach((r, i) => { if (i && r[2] !== log2[i - 1][2]) steps2.push({ bpm: r[2], chorus: r[1] }); });
  console.log('     tempo steps: ' + JSON.stringify(steps2));
  check(steps2.length >= 1 && steps2[0].chorus === 2 && steps2[0].bpm === 210, 'first step comes after the second chorus', JSON.stringify(steps2[0]));
  check(steps2.every(s => s.chorus % 2 === 0), 'and only on even choruses', steps2.map(s => s.chorus).join());

  // ── 3. A tempo moved by hand is the player's: Stop leaves it.
  await setup({ bpm: 200, ramp: { step: 5, every: 1, max: 215 } });
  await page.waitForTimeout(4200);
  await page.evaluate(() => { _setBpm(150); });
  const s3 = await stop();
  check(s3.bpm === 150, 'a tempo moved by hand is not put back', s3.bpm);

  // ── 4. A chart with a single section counts every pass.
  await page.evaluate(() => { _setBpm(200); });
  await page.evaluate(() => { stopEverything(); });
  await setup({ bpm: 200, ramp: { step: 5, every: 1, max: 215 } });
  await page.evaluate(() => { sections.length = 1; });
  await page.waitForTimeout(5200);
  const c4 = await page.evaluate(() => ({ chorus: _pracRun.chorus, bpm: Math.round(_bpmNow()) }));
  await stop();
  check(c4.chorus >= 3 && c4.bpm > 200, 'a one-section chart counts every pass', JSON.stringify(c4));

  // ── 5. Off means off.
  await page.evaluate(() => { _setBpm(200); stopEverything(); });
  await setup({ bpm: 200, ramp: { step: 5, every: 1, max: 215 } });
  await page.evaluate(() => { prac.ramp.on = false; pracSync(); });
  await page.waitForTimeout(6000);
  const off = await page.evaluate(() => Math.round(_bpmNow()));
  await stop();
  check(off === 200, 'with Speed up off the tempo does not move', off);

  // ── 6. The control: a tap toggles, the settings show, the numbers clamp and persist.
  const ui = await page.evaluate(() => {
    prac.ramp.on = false; pracSync();
    const b = document.getElementById('prac-ramp-btn'), set = document.getElementById('prac-ramp-set');
    const before = { on: prac.ramp.on, hidden: set.hidden };
    b.click();
    const after = { on: prac.ramp.on, hidden: set.hidden, pressed: b.getAttribute('aria-pressed') };
    pracSet('ramp', 'step', '999'); pracSet('ramp', 'every', 'abc'); pracSet('ramp', 'max', '10');
    return { before, after, step: prac.ramp.step, every: prac.ramp.every, max: prac.ramp.max, saved: JSON.parse(modStore.getItem('modo-practice')) };
  });
  check(!ui.before.on && ui.before.hidden && ui.after.on && !ui.after.hidden && ui.after.pressed === 'true', 'the Speed up button toggles and shows its settings', JSON.stringify(ui));
  check(ui.step === 20 && ui.max === 40 && ui.every === 1, 'out-of-range numbers clamp, junk is ignored', ui.step + ' ' + ui.every + ' ' + ui.max);
  check(ui.saved.ramp.step === 20 && ui.saved.ramp.max === 40, 'and the settings are kept', JSON.stringify(ui.saved));

  // ── 7. Next key by fifths: every key once, in the right order, then it stays.
  //    A bar at 220 BPM is 1.09 s, so twelve keys are about 26 s.
  await page.evaluate(() => { stopEverything(); });
  await setup({ bpm: 220, key: { every: 1, by: 7 } });
  await page.waitForTimeout(27500);
  const log7 = await page.evaluate(() => window._log);
  const mid7 = await page.evaluate(() => ({ root, rootM: sections[0].slots[0].rootM, second: sections[1].slots[0].rootM, label: sections[0].slots[0].label, keys: _pracRun.keysDone, status: document.getElementById('prac-status').textContent }));
  const end7 = await stop();
  const keys7 = []; log7.forEach(r => { if (!keys7.length || keys7[keys7.length - 1].pc !== r[5]) keys7.push({ pc: r[5], rootM: r[6], label: r[7] }); });
  console.log('     keys: ' + keys7.map(k => k.label + '(' + k.rootM + ')').join(' '));
  check(keys7.map(k => k.pc).join() === '0,7,2,9,4,11,6,1,8,3,10,5', 'a fifth at a time visits all twelve keys in order', keys7.map(k => k.pc).join());
  check(keys7.every(k => k.rootM >= 43 && k.rootM <= 54), 'and the chords stay within a tritone of where they started (no climbing)', keys7.map(k => k.rootM).join());
  check(mid7.keys === 11 && mid7.root === 5, 'then it stays in the twelfth key', JSON.stringify(mid7));
  check(/Key F \(12 of 12\)/.test(mid7.status), 'the status line says Key F (12 of 12)', mid7.status);
  const back7 = await page.evaluate(() => ({ root, a: sections[0].slots[0].rootM, la: sections[0].slots[0].label, b: sections[1].slots[0].rootM, lb: sections[1].slots[0].label }));
  check(back7.root === 0 && back7.a === 48 && back7.la === 'C' && back7.b === 55 && back7.lb === 'G', 'Stop puts the chart back exactly as it was (key, notes, names)', JSON.stringify(back7));

  // ── 8. By fourths, every 2 choruses.
  await setup({ bpm: 220, key: { every: 2, by: 5 } });
  await page.waitForTimeout(11500);
  const log8 = await page.evaluate(() => window._log);
  await stop();
  const keys8 = []; log8.forEach(r => { if (!keys8.length || keys8[keys8.length - 1].pc !== r[5]) keys8.push({ pc: r[5], chorus: r[1] }); });
  check(keys8.length >= 2 && keys8[1].pc === 5 && keys8[1].chorus === 2, 'a fourth, after the second chorus', JSON.stringify(keys8));

  // ── 9. A transpose of the player's own is theirs: Stop does not undo it.
  await setup({ bpm: 220, key: { every: 1, by: 1 } });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { transposeSong(2); });
  const r9 = await page.evaluate(() => root);
  await stop();
  const e9 = await page.evaluate(() => root);
  check(e9 === r9, 'a key the player moved by hand is left alone on Stop', r9 + ' -> ' + e9);
  await page.evaluate((r) => { transposeSong(-r); }, r9);

  // ── 10. Both together, off together.
  await setup({ bpm: 200, ramp: { step: 5, every: 1, max: 215 }, key: { every: 1, by: 7 } });
  await page.waitForTimeout(7000);
  const both = await page.evaluate(() => ({ bpm: Math.round(_bpmNow()), root }));
  const bs = await stop();
  const bend = await page.evaluate(() => ({ bpm: Math.round(_bpmNow()), root }));
  check(both.bpm > 200 && both.root !== 0 && bend.bpm === 200 && bend.root === 0, 'speed and key together, and both come back', JSON.stringify([both, bend]));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
