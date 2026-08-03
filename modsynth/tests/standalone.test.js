/* Verifies the single-file build actually runs from file:// — the whole
   reason it exists. Run: node tests/standalone.test.js */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.join(__dirname, '..', 'modsynth-standalone.html');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE);
  await page.click('#splash-go');
  await page.waitForFunction(() => window.modsynth && window.modsynth.started, null, { timeout: 20000 })
    .catch(() => {});

  const state = await page.evaluate(async () => {
    const app = window.modsynth;
    if (!app || !app.started) return { started: false, err: document.getElementById('splash-err').textContent };
    app.noteOn(60, 0.9); app.noteOn(64, 0.9);
    await new Promise(r => setTimeout(r, 400));
    const buf = new Uint8Array(1024);
    let peak = 0;
    for (let n = 0; n < 10; n++) {
      app.engine.getWaveform(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      await new Promise(r => setTimeout(r, 25));
    }
    app.engine.panic();
    return {
      started: true,
      loadMode: app.engine.loadMode,
      knobs: document.querySelectorAll('.knob').length,
      patches: app.lib.all().length,
      peak: peak / 128,
    };
  });

  let fail = 0;
  const ok = (c, label, d) => { if (c) console.log('  ok   ' + label); else { fail++; console.log('  FAIL ' + label + (d ? '  → ' + d : '')); } };

  ok(state.started, 'runs from file:// with no server', state.err);
  ok(state.loadMode === 'data' || state.loadMode === 'blob', 'worklet loaded from the embedded source', state.loadMode);
  ok(state.knobs > 100, 'panel built', state.knobs + ' knobs');
  ok(state.patches >= 300, 'full patch bank present', String(state.patches));
  ok(state.peak > 0.02, 'makes sound', 'peak ' + (state.peak || 0).toFixed(3));
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(fail ? `\n${fail} failed` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
