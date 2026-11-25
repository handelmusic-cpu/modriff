/* Bounce and Keep from the keyboard, and a bounce that ends when the sound has died away.

   - Alt+E starts a Bounce and, pressed again, stops it; the take is written once the master output has been silent
     for 0.8 s, not after a fixed 8 s (a plain drum pattern with the reverb at its default is quiet well inside 4 s).
   - A take whose sound never dies (a held tone into the master) still ends, at the 8 s ceiling.
   - Alt+K keeps the chords just played as a new Song section, with nothing armed first, and does nothing but say so
     when there is nothing to keep.

   Run: node tests/record/keys-tail.probe.js   (serves the repo itself; see tests/layout/lib.js) */
'use strict';
const L = require('../layout/lib.js');
(async () => {
  const h = await L.start(), R = L.reporter();
  const { page, errs } = await L.boot(h, 'p430', 'studio');
  const key = (code) => page.evaluate((c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, altKey: true, bubbles: true, cancelable: true })), code);

  // Where the take is written (_finishRecording) is the end of the tail; what comes after it is the save sheet, which
  // a headless page never answers, so the flags are put back by hand between takes.
  await page.evaluate(() => { const o = _finishRecording; window.__finAt = 0; _finishRecording = function (m) { window.__finAt = Date.now(); return o(m); }; });
  const reset = () => page.evaluate(() => { window.__finAt = 0; _isRecording = false; _recFinishing = false; _updateRecBtn(); if (document.activeElement) document.activeElement.blur(); });

  // Keep: nothing yet, then some chords.
  await page.evaluate(() => { setPerformMode('chords'); });
  const secBefore = await page.evaluate(() => sections.length);
  await key('KeyK');
  R.check(await page.evaluate(() => sections.length) === secBefore, 'Alt+K with nothing played keeps nothing');
  await page.evaluate(() => startEverything());
  await page.waitForTimeout(600);
  await page.evaluate(() => studioShow('chords'));
  await page.waitForTimeout(500);
  const pads = await page.$$('#chords-diatonic .btn-tri');
  for (let i = 0; i < 3 && i < pads.length; i++) { await pads[i].click(); await page.waitForTimeout(350); }
  await key('KeyK');
  await page.waitForTimeout(400);
  R.check(await page.evaluate(() => sections.length) === secBefore + 1, 'Alt+K keeps the chords just played as a section', await page.evaluate(() => sections.length));
  await page.evaluate(() => stopEverything());
  await page.waitForTimeout(300);

  // Bounce: start with Alt+E, play, stop with Alt+E, time the tail.
  await page.evaluate(() => startEverything());
  await page.waitForTimeout(500);
  await key('KeyE');
  await page.waitForTimeout(300);
  R.check(await page.evaluate(() => _isRecording === true), 'Alt+E starts a Bounce');
  await page.waitForTimeout(2500);
  const t0 = Date.now();
  await key('KeyE');
  await page.waitForFunction(() => window.__finAt, null, { timeout: 15000 });
  const tail = (await page.evaluate(() => window.__finAt)) - t0;
  await reset();
  R.check(tail < 4500, 'the take ends when the output is silent, well before the 8 s ceiling', tail + ' ms');
  R.check(tail >= 250, 'but not before the minimum', tail + ' ms');

  // A sound that never ends runs to the ceiling. (The first take is still being written in the background; let it
  // finish before the next one starts, or its last step switches the new take off.)
  await page.waitForTimeout(4000);
  await reset();
  await page.evaluate(() => {
    const c = getCtx(), o = c.createOscillator(), g = c.createGain();
    g.gain.value = 0.2; o.connect(g); g.connect(window._masterOut || window._masterLimiter); o.start(); window._testOsc = o;
  });
  await page.evaluate(() => startEverything());
  await page.waitForTimeout(400);
  await key('KeyE');
  await page.waitForTimeout(1200);
  R.check(await page.evaluate(() => _isRecording === true), 'Alt+E starts a second Bounce, with the held tone running',
    await page.evaluate(() => [_isRecording, _recFinishing, isAnythingPlaying(), [...document.querySelectorAll('[class*=toast]')].map(e => e.textContent.trim()).filter(Boolean).join('/')].join(' ')));
  const t1 = Date.now();
  await key('KeyE');
  await page.waitForFunction(() => window.__finAt, null, { timeout: 15000 });
  const held = (await page.evaluate(() => window.__finAt)) - t1;
  await reset();
  R.check(held >= 7500 && held < 10500, 'a tail that never dies ends at the 8 s ceiling', held + ' ms');
  await page.evaluate(() => { try { window._testOsc.stop(); } catch (e) {} });

  R.check(errs.length === 0, 'no page errors', errs.join('; '));
  await h.close();
  R.done && R.done();
})();
