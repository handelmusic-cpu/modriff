/* Tempo by hand is the Groove Pack's (FREE_LIMITS.tempoStops, tapTempo), measured on the page.

   Free: the slider, the nudges, the arrow keys and a drag land on the six stops; tap tempo counts four taps
   and says it is the pack's, leaving the tempo where it was; Random roll lands on a stop. What ARRIVES is
   never moved (a load, _setBpm, the demo), and Ableton Link on lifts the limit entirely (its licence: free
   for everyone, outside every pack). With the Groove Pack the whole dial and tap tempo work.

   Run (repo served, Chromium available):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/tempo.test.js
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
const STOPS = [70, 88, 100, 110, 128, 150];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('modo-dev-tier', 'free'); });
  await page.goto(URL); await page.waitForTimeout(1500);
  await page.click(`button[onclick="unlockAudio('blank')"]`); await page.waitForTimeout(1500);
  const bpm = () => page.evaluate(() => Math.round(_bpmNow()));
  const set = (v) => page.evaluate((x) => { onBpmInput(x); }, v);
  const hand = (v, d) => page.evaluate(([x, dd]) => { bpmByHand(x, dd); return Math.round(_bpmNow()); }, [v, d]);

  await page.evaluate(() => { setModOwned([]); });
  check(await page.evaluate(() => !modHas('groove') && freeTempoLocked()), 'free: tempo by hand is locked');

  // The note says so in the popover before anyone moves the slider.
  const note = await page.evaluate(() => { const n = document.getElementById('ft-bpm-note'); return n && { hidden: n.hidden, text: n.textContent }; });
  check(note && !note.hidden && /70, 88, 100, 110, 128, 150/.test(note.text) && /Groove Pack/.test(note.text), 'free: the tempo popover names the six stops and the pack', JSON.stringify(note));

  // Slider and drag: nearest stop.
  await set(100);
  const near = [];
  for (const v of [60, 79, 80, 99, 104, 105, 118, 119, 140, 220]) { near.push(await hand(v)); }
  // 60, 79, 80, 99, 104, 105, 118, 119, 140, 220: a tie (79, 105, 119) goes to the lower stop.
  check(near.join() === '70,70,88,100,100,100,110,110,150,150', 'free: the slider lands on the nearest stop, a tie on the lower one', near.join());
  check(near.every(v => STOPS.includes(v)), 'free: every value it landed on is a stop');

  // The real slider element, as a finger moves it.
  await page.evaluate(() => { const sl = document.getElementById('ft-bpm-sl'); sl.value = 113; sl.dispatchEvent(new Event('input', { bubbles: true })); });
  check(STOPS.includes(await bpm()) && (await bpm()) === 110, 'free: the popover slider element snaps (113 -> 110)', String(await bpm()));
  check(await page.evaluate(() => +document.getElementById('ft-bpm-sl').value) === 110, 'free: and the thumb sits on the stop');

  // Nudges step stop to stop and stay at the ends.
  await set(100);
  const up = []; for (let i = 0; i < 5; i++) { await page.evaluate(() => nudgeBpm(1)); up.push(await bpm()); }
  check(up.join() === '110,128,150,150,150', 'free: + steps up the stops and stops at the top', up.join());
  const dn = []; for (let i = 0; i < 7; i++) { await page.evaluate(() => nudgeBpm(-1)); dn.push(await bpm()); }
  check(dn.join() === '128,110,100,88,70,70,70', 'free: - steps down and stops at the bottom', dn.join());
  await set(113); await page.evaluate(() => nudgeBpm(1));
  check(await bpm() === 128, 'free: a nudge from a tempo between stops goes to the next stop above (113 -> 128)', String(await bpm()));

  // The toast: said once.
  await page.evaluate(() => { window.__said = []; const o = window.majorToast; window.majorToast = function (m) { window.__said.push(String(m)); return o.apply(this, arguments); }; _tempoToldFree = false; });
  await set(100); await hand(113); await hand(104); await hand(119);
  const said = await page.evaluate(() => window.__said.filter(m => /six stops/.test(m)));
  check(said.length === 1, 'free: the "six stops" note is said once, not on every move', String(said.length));

  // Tap tempo: four taps at 500 ms (120 bpm) say it is the pack's and move nothing.
  await set(100); await page.evaluate(() => { window.__said = []; _tapTimes = []; });
  for (let i = 0; i < 5; i++) { await page.evaluate(() => tapTempo()); await page.waitForTimeout(500); }
  const tapSaid = await page.evaluate(() => window.__said.filter(m => /Tap tempo/.test(m)));
  check((await bpm()) === 100 && tapSaid.length >= 1, 'free: four taps leave the tempo and name the Groove Pack', JSON.stringify([await bpm(), tapSaid.slice(0, 1)]));

  // What arrives is never moved.
  await page.evaluate(() => _setBpm(113)); check(await bpm() === 113, 'free: _setBpm (loads, Keep, the trainer) keeps 113', String(await bpm()));
  await page.evaluate(() => onBpmInput(97)); check(await bpm() === 97, 'free: a tempo that arrives through onBpmInput keeps 97', String(await bpm()));

  // Random roll lands on a stop.
  const rolls = [];
  for (let i = 0; i < 12; i++) { await page.evaluate(() => startDemoJourney(false)); await page.waitForTimeout(350); rolls.push(await bpm()); }
  check(rolls.every(v => STOPS.includes(v)), 'free: twelve Random rolls all land on a stop', rolls.join());

  // Ableton Link on: no limit, and the note goes.
  await page.evaluate(() => { _link.on = true; freeTempoSync(); });
  const linkV = await hand(113);
  check(linkV === 113 && await page.evaluate(() => !freeTempoLocked() && document.getElementById('ft-bpm-note').hidden), 'Link on: any tempo, and the note is gone', String(linkV));
  await page.evaluate(() => { _link.on = false; freeTempoSync(); });
  check(await hand(113) === 110, 'Link off again: back to the stops');

  // The Groove Pack: everything.
  await page.evaluate(() => setModOwned(['groove']));
  check(await page.evaluate(() => !freeTempoLocked() && document.getElementById('ft-bpm-note').hidden), 'Groove Pack: unlocked and the note is gone');
  check(await hand(113) === 113 && await hand(61) === 61, 'Groove Pack: any tempo from the slider');
  await page.evaluate(() => nudgeBpm(1)); check(await bpm() === 62, 'Groove Pack: a nudge is 1 bpm', String(await bpm()));
  await set(100); await page.evaluate(() => { _tapTimes = []; });
  for (let i = 0; i < 5; i++) { await page.evaluate(() => tapTempo()); await page.waitForTimeout(500); }
  const tapped = await bpm();
  check(tapped >= 115 && tapped <= 125, 'Groove Pack: four taps at 500 ms set about 120', String(tapped));

  check(errs.length === 0, 'nothing thrown', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
