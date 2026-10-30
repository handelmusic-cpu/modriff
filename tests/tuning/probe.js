/* Pure tuning (Equal / Pure): that the chord's thirds and fifths really stop beating.

   Two measurements, on the real chord path (modEngine -> _webChordOn -> makeVoice):

   1. The oscillators themselves. Every oscillator a C major / C minor chord builds
      is caught as it is created and its final .detune read at the end, so the cents
      each chord tone was moved are counted rather than assumed. Equal must move
      nothing; Pure must move the third and fifth by the table's amounts.
   2. The sound. The chord part's bus is tapped and each pair of near-coincident
      partials is demodulated to baseband: the envelope of |x(t) * e^-j2*pi*fc*t|,
      low-passed, is the beating. In equal temperament a C major triad's 4th
      partial of E and 5th partial of C are 10.4 Hz apart; pure, they are one tone
      and the envelope is flat.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tuning/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/levels/measure.js). */
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

// Runs in the page. Plays one sustained chord and returns the oscillators it built
// and the raw samples of the chord bus.
async function playOnce([mode, notes, root]) {
  setTuningMode(mode);
  const ctx = getCtx(); await ctx.resume();
  const bus = _ensureAllPartBuses(ctx).chord;
  const E = window.modEngine;
  stopAll();
  await new Promise(r => setTimeout(r, 400));

  const built = [];
  const proto = OscillatorNode.prototype, orig = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function () { const o = orig.apply(this, arguments); built.push(o); return o; };

  const sp = ctx.createScriptProcessor(4096, 2, 2); const chunks = [], stamps = []; let on = false;
  sp.onaudioprocess = e => { if (on) { chunks.push(Float32Array.from(e.inputBuffer.getChannelData(0))); stamps.push(e.playbackTime); } };
  const z = ctx.createGain(); z.gain.value = 0;
  bus.connect(sp); sp.connect(z); z.connect(ctx.destination);

  on = true;
  E.send({ v: 1, kind: 'chord', part: 'chord', id: 7000 + Math.floor(Math.random() * 1e5), root, notes, bass: null, vel: 1, at: null, dur: null });
  await new Promise(r => setTimeout(r, 3200));
  on = false;
  const out = built.map(o => ({ f: o.frequency.value, d: o.detune.value }));
  BaseAudioContext.prototype.createOscillator = orig;
  bus.disconnect(sp); try { sp.disconnect(); z.disconnect(); } catch (e) {}
  stopAll();
  const n = chunks.reduce((s, c) => s + c.length, 0), all = new Float32Array(n);
  let k = 0; chunks.forEach(c => { all.set(c, k); k += c.length; });
  // A block the page was too busy to take splices the waveform, and a splice
  // reads as amplitude modulation. Count blocks whose start is not exactly one
  // block after the last, so a bad capture is told apart from a bad result.
  let gaps = 0; for (let i = 1; i < stamps.length; i++) if (Math.abs(stamps[i] - stamps[i - 1] - 4096 / ctx.sampleRate) > 0.5 / ctx.sampleRate) gaps++;
  return { osc: out, sr: ctx.sampleRate, samples: Array.from(all), gaps };
}

// Beating at fc: demodulate to baseband, low-pass with an 80 ms Hann window, take
// the envelope over the steady part of the note, and report its depth (max-min
// over max+min) and how many times per second it crosses its own mean. Hann, not
// a box: the neighbouring harmonics of a sawtooth sit only a couple of hundred Hz
// away, and a box window's sidelobes let them in as a ripple that looks like
// beating (the first version of this read 37 Hz of "beat" that way).
function beating(x, sr, fc) {
  const t0 = Math.round(0.8 * sr), t1 = Math.min(x.length, Math.round(2.6 * sr)), W = Math.round(0.08 * sr), H = Math.round(0.002 * sr);
  const win = new Float64Array(W); let wsum = 0;
  for (let j = 0; j < W; j++) { win[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (j + 0.5) / W); wsum += win[j]; }
  const env = [];
  for (let i = t0; i + W < t1; i += H) {
    let a = 0, b = 0;
    for (let j = 0; j < W; j++) { const ph = 2 * Math.PI * fc * (i + j) / sr; a += win[j] * x[i + j] * Math.cos(ph); b -= win[j] * x[i + j] * Math.sin(ph); }
    env.push(Math.hypot(a, b) / wsum);
  }
  const mx = Math.max(...env), mn = Math.min(...env), mean = env.reduce((s, v) => s + v, 0) / env.length;
  let cross = 0; for (let i = 1; i < env.length; i++) if ((env[i - 1] - mean) * (env[i] - mean) < 0) cross++;
  const secs = env.length * H / sr;
  return { depth: (mx - mn) / (mx + mn), rate: cross / 2 / secs, level: mean };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(1500);
  await page.click('.unlock-btn >> text=Start');
  await page.waitForTimeout(1500);

  // A plain sawtooth, no strum, no glide, no drift, no random detune: the only
  // pitch differences left are the tuning's own.
  await page.evaluate(() => {
    Math.random = () => 0.5;
    const E = window.modEngine;
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'voice', value: 'sawtooth' });
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'strum', value: false });
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'glide', value: false });
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'sub', value: false });
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'reverb', value: 0 });
    E.send({ v: 1, kind: 'param', part: 'fx', name: 'drift', value: 0 });
  });

  const cents = (o, midi) => 1200 * Math.log2(o.f / (440 * Math.pow(2, (midi - 69) / 12))) + o.d;
  const maj = [60, 64, 67], min = [60, 63, 67];
  const R = {};
  for (const [name, notes] of [['maj', maj], ['min', min]]) {
    for (const mode of ['equal', 'pure']) {
      // Re-take a capture that dropped blocks (never one that merely failed a check).
      let r, tries = 0;
      do { r = await page.evaluate(playOnce, [mode, notes, 60]); tries++; } while (r.gaps > 0 && tries < 10);
      r.tries = tries; R[name + '-' + mode] = r;
      if (tries > 1) console.log(`  (${name}-${mode}: ${tries - 1} capture(s) dropped blocks and were taken again)`);
    }
  }

  // ── 1. The oscillators, counted
  const offsets = (r, notes) => notes.map(m => {
    const o = r.osc.filter(x => Math.abs(1200 * Math.log2(x.f / (440 * Math.pow(2, (m - 69) / 12)))) < 1);
    return o.length ? +cents(o[0], m).toFixed(2) : null;
  });
  const near = (a, b) => a.every((v, i) => v !== null && Math.abs(v - b[i]) < 0.05);
  let o;
  o = offsets(R['maj-equal'], maj); check(near(o, [0, 0, 0]), 'equal, C major: nothing moved', o.join(', '));
  o = offsets(R['maj-pure'], maj);  check(near(o, [0, -13.69, 1.96]), 'pure, C major: root 0, third -13.69, fifth +1.96', o.join(', '));
  o = offsets(R['min-equal'], min); check(near(o, [0, 0, 0]), 'equal, C minor: nothing moved', o.join(', '));
  o = offsets(R['min-pure'], min);  check(near(o, [0, 15.64, 1.96]), 'pure, C minor: root 0, third +15.64, fifth +1.96', o.join(', '));
  check(R['maj-pure'].osc.length === R['maj-equal'].osc.length, 'the same number of oscillators either way',
    R['maj-equal'].osc.length + ' / ' + R['maj-pure'].osc.length);

  // ── 2. The sound
  // C major: E's 4th partial against C's 5th (~1313 Hz), G's 2nd against C's 3rd (~784 Hz).
  // C minor: Eb's 5th against G's 4th (~1568 Hz is both... use C's 6th vs Eb's 5th at ~1570).
  check(['maj-equal', 'maj-pure'].every(k => R[k].gaps === 0), 'the two captures measured have no dropped blocks',
    ['maj-equal', 'maj-pure'].map(k => R[k].gaps).join(', '));
  const sr = R['maj-equal'].sr;
  const B = (k, fc) => beating(R[k].samples, sr, fc);
  const third = { eq: B('maj-equal', 1313.3), pu: B('maj-pure', 1308.1) };
  console.log(`  third band (C5 ~1308 / E4x4 ~1318): equal depth ${third.eq.depth.toFixed(2)} at ${third.eq.rate.toFixed(1)} Hz;  pure depth ${third.pu.depth.toFixed(2)} at ${third.pu.rate.toFixed(1)} Hz`);
  check(third.eq.depth > 0.4, 'equal: the major third beats (depth > 0.4)', third.eq.depth.toFixed(2));
  check(Math.abs(third.eq.rate - 10.4) < 1.5, 'equal: it beats at about 10.4 Hz', third.eq.rate.toFixed(1) + ' Hz');
  check(third.pu.depth < 0.1, 'pure: the major third does not beat (depth < 0.1)', third.pu.depth.toFixed(2));
  check(third.pu.depth < third.eq.depth / 5, 'pure: at least 5x less beating than equal', (third.eq.depth / Math.max(third.pu.depth, 1e-6)).toFixed(0) + 'x');

  const fifth = { eq: B('maj-equal', 784.4), pu: B('maj-pure', 784.0) };
  console.log(`  fifth band (C3x3 ~785 / G2x2 ~784): equal depth ${fifth.eq.depth.toFixed(2)} at ${fifth.eq.rate.toFixed(2)} Hz;  pure depth ${fifth.pu.depth.toFixed(2)} at ${fifth.pu.rate.toFixed(2)} Hz`);
  check(fifth.pu.depth < fifth.eq.depth, 'pure: the fifth beats less than equal', fifth.pu.depth.toFixed(2) + ' < ' + fifth.eq.depth.toFixed(2));

  // ── 3. Glide: tuning goes in before the glide reads .detune, so the glide
  // settles on the tuned pitch rather than sliding the tuning away (or past it).
  // C major then F major with the glide on; a second after the F lands, each
  // voice must be back at its own tuning offset.
  const gl = await page.evaluate(async () => {
    setTuningMode('pure');
    const E = window.modEngine, ctx = getCtx(); await ctx.resume();
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'glide', value: true });
    E.send({ v: 1, kind: 'param', part: 'chord', name: 'glideTime', value: 0.15 });
    stopAll(); await new Promise(r => setTimeout(r, 400));
    const built = [], orig = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function () { const o = orig.apply(this, arguments); built.push(o); return o; };
    E.send({ v: 1, kind: 'chord', part: 'chord', id: 8001, root: 60, notes: [60, 64, 67], bass: null, vel: 1, at: null, dur: null });
    await new Promise(r => setTimeout(r, 600));
    built.length = 0;
    E.send({ v: 1, kind: 'chord', part: 'chord', id: 8002, root: 65, notes: [65, 69, 72], bass: null, vel: 1, at: null, dur: null });
    await new Promise(r => setTimeout(r, 120));
    const mid = built.map(o => o.detune.value);
    await new Promise(r => setTimeout(r, 1100));
    const end = built.map(o => ({ f: o.frequency.value, d: o.detune.value }));
    BaseAudioContext.prototype.createOscillator = orig;
    stopAll(); E.send({ v: 1, kind: 'param', part: 'chord', name: 'glide', value: false });
    return { mid, end };
  });
  const settle = [0, -13.69, 1.96], got = gl.end.map(x => +x.d.toFixed(2));
  check(gl.end.length === 3 && got.every((v, i) => Math.abs(v - settle[i]) < 0.05), 'glide on: F major settles on 0 / -13.69 / +1.96', got.join(', '));
  check(gl.mid.some(v => Math.abs(v) > 50), 'glide on: it was still sliding 120 ms in (the glide did run)', gl.mid.map(v => v.toFixed(0)).join(', '));

  // ── 4. The switch itself
  await page.evaluate(() => setTuningMode('pure'));
  await page.reload(); await page.waitForTimeout(1500);
  const saved = await page.evaluate(() => ({ mode: tuningMode, lit: document.getElementById('tuning-pure').classList.contains('active'),
    stored: localStorage.getItem('modo-tuning'), prev: document.getElementById('ss-tune-preview').textContent }));
  check(saved.mode === 'pure' && saved.lit && saved.stored === 'pure', 'pure survives a reload and lights its button', JSON.stringify(saved));
  await page.evaluate(() => setTuningMode('equal'));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
