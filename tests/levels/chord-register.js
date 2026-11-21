/* Chord register and bus peak audit.

   Plays every diatonic chord of every key, in every voicing, through the
   app's own pad path (_triggerChordImmediate), and reports the pitch of the
   highest sounding note per voicing — the "chords going up into the upper
   register" complaint. Spread used to stack its octave on top of voice
   leading's and reached D#6 (see spreadFit). Needs the repo served and Chrome:
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/levels/chord-register.js
   Env: URL, CHROME (default macOS Chrome), VOICE (default vibes), MAXTOP (MIDI
   note, default 84 = C6; exit 1 if any chord tops it), EXTS (comma list). */
'use strict';
const { chromium } = require('playwright-core');
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const VOICE = process.env.VOICE || 'vibes';
const MAXTOP = +process.env.MAXTOP || 84;
const EXTS = (process.env.EXTS || 'triad,7th,9th').split(',');
const VOICINGS = ['close', 'open', 'drop2', 'drop3', 'rnb', 'neosoul'];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.on('pageerror', e => console.error('pageerror', e.message));
  await page.goto(URL);
  await page.waitForTimeout(1500);
  try { await page.click('.unlock-btn >> text=Start', { timeout: 3000 }); } catch (e) {}
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async ([voice, exts, voicings]) => {
    const ctx = getCtx(); await ctx.resume();
    window.modEngine.send({ v: 1, kind: 'param', part: 'chord', name: 'voice', value: voice });
    try { preloadSampleInstrument(voice); } catch (e) {}
    const t0 = performance.now();
    while (performance.now() - t0 < 30000 && typeof SAMPLE_STATE !== 'undefined' && SAMPLE_STATE[voice] && SAMPLE_STATE[voice] !== 'ready')
      await new Promise(r => setTimeout(r, 200));
    const res = { byVoicing: {}, worst: [] };
    const md = MODES.major;
    for (const vo of voicings) {
      window.voiceVary = false; voicing = vo;
      let top = 0, sum = 0, n = 0, over = 0, worst = null;
      for (let key = 0; key < 12; key++) {
        root = key; octShift = 0;
        for (const ext of exts) {
          for (let d = 0; d < md.steps.length; d++) {
            _prevVoices = []; _styledPrevTop = null; _jazzPrev = null;
            try { _gtrPrev = null; } catch (e) {}
            const rm = rootMidi() + md.steps[d];
            _triggerChordImmediate(rm, md.triadQ[d], md.seventh[d], md.func[d], 0, ext, false);
            const m = (window._lastVoiced || {}).midi || [];
            const t = Math.max.apply(null, m);
            sum += t; n++; if (t > top) top = t;
            if (t > 84) over++;
            if (!worst || t > worst.top) worst = { top: t, key, ext, deg: d, midi: m.slice() };
          }
        }
      }
      res.byVoicing[vo] = { meanTop: +(sum / n).toFixed(1), maxTop: top, over84: over, of: n, worst };
    }
    stopAll();
    return res;
  }, [VOICE, EXTS, VOICINGS]);

  let bad = 0;
  console.log(`voice ${VOICE}: highest sounding note per voicing (MIDI; 72=C5, 84=C6, 88=E6)`);
  for (const v of VOICINGS) {
    const r = out.byVoicing[v];
    if (r.maxTop > MAXTOP) bad++;
    console.log(`  ${v.padEnd(8)} mean top ${String(r.meanTop).padStart(5)}  max top ${String(r.maxTop).padStart(3)}  above C6 ${r.over84}/${r.of}   worst: key ${r.worst.key} ${r.worst.ext} deg ${r.worst.deg} [${r.worst.midi.join(' ')}]`);
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
