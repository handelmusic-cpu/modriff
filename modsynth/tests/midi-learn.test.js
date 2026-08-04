/* MIDI Learn end-to-end: arm a control on screen, "move a knob", check it bound
   and that it actually drives the parameter. Web MIDI can't be granted headlessly,
   so the test calls handle() with real MIDI byte arrays — the same entry point
   a controller reaches.

   Run: node modsynth/tests/midi-learn.test.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8795;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

let pass = 0, fail = 0;
const ok = (c, label, d) => {
  if (c) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (d ? '  → ' + d : '')); }
};

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const IGNORE = /posthog|fonts\.googleapis|fonts\.gstatic|ERR_TUNNEL|Failed to load resource/;
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#splash-go');
  await page.click('#splash-go');

  // Wait for the app to start and audio engine to be ready
  await page.waitForFunction(() => window.modsynth && window.modsynth.started, null, { timeout: 15000 });
  await page.waitForTimeout(600);

  /* ── Basic learn binding ────────────────────────────────────────────────── */
  const basic = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app) return { error: 'No modsynth' };
    if (!app.ui) return { error: 'No ui on app', hasEngine: !!app.engine, hasMidi: !!app.midi };
    if (!app.midi) return { error: 'No midi on app' };

    // Mock MIDI access for headless test (we'll call handle() directly anyway)
    if (!app.midi.access) app.midi.access = {};

    const targetParam = 'flt1.cutoff';
    app.ui.startLearn(targetParam);
    const learning = !!app.ui.learnTarget;

    // Simulate a CC message (CC 30, value 127)
    app.midi.handle([0xb0, 30, 127]);

    const bound = app.midi.map[30];
    app.ui.clearLearn();

    return { learning, bound, targetParam };
  });
  if (basic.error) {
    ok(false, 'startLearn sets learning state', basic.error);
    ok(false, 'CC binding works', basic.error);
  } else {
    ok(basic.learning, 'startLearn sets learning state');
    ok(basic.bound === basic.targetParam, 'CC binding works', `${basic.bound} vs ${basic.targetParam}`);
  }

  /* ── CC actually drives the parameter ───────────────────────────────────── */
  const drive = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app.midi.access) app.midi.access = {};
    const param = 'flt1.res';

    // Learn CC 31 to resonance
    app.ui.startLearn(param);
    app.midi.handle([0xb0, 31, 0]);
    app.ui.clearLearn();

    // Now drive it with CC values
    app.midi.handle([0xb0, 31, 0]);
    const low = +app.engine.getNorm(param);

    app.midi.handle([0xb0, 31, 127]);
    const high = +app.engine.getNorm(param);

    app.midi.handle([0xb0, 31, 64]);
    const mid = +app.engine.getNorm(param);

    return { low, mid, high, low_is_min: low < 0.1, high_is_max: high > 0.9 };
  });
  ok(drive.low_is_min, 'CC 0 lands on the minimum', String(drive.low));
  ok(drive.high_is_max, 'CC 127 lands on the maximum', String(drive.high));
  ok(drive.mid > drive.low && drive.mid < drive.high, 'CC 64 lands in between', String(drive.mid));

  /* ── Pickup mode prevents jumps ───────────────────────────────────────────── */
  const pickup = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app.midi.access) app.midi.access = {};
    const param = 'lfo1.rate';

    // Set a parameter to a known value and disable pickup
    app.engine.setNorm(param, 0.3);
    app.midi.pickup = false;
    app.midi._pickupCaught.clear();

    // Learn a new CC to the parameter
    app.ui.startLearn(param);
    app.midi.handle([0xb0, 32, 100]);  // High value, far from 0.3
    app.ui.clearLearn();

    // After learning, we need to send the CC again for it to apply
    app.midi.handle([0xb0, 32, 100]);
    // Without pickup, it should jump immediately
    let withoutPickup = +app.engine.getNorm(param);

    // Reset and test with pickup on
    app.engine.setNorm(param, 0.3);
    app.midi.togglePickup();

    // Sending a far value should be ignored
    app.midi.handle([0xb0, 32, 100]);
    let ignored = +app.engine.getNorm(param);

    // Sweep down through 0.3 (should cross it around CC value 38)
    app.midi.handle([0xb0, 32, 0]);
    app.midi.handle([0xb0, 32, 50]);
    let caught = +app.engine.getNorm(param);

    app.midi.togglePickup();  // Reset pickup

    return {
      withoutPickup: withoutPickup > 0.7,
      ignored: Math.abs(ignored - 0.3) < 0.05,
      caught: caught < 0.6 && caught > 0.3
    };
  });
  ok(pickup.withoutPickup, 'Without pickup, CC immediately changes the parameter');
  ok(pickup.ignored, 'Pickup mode ignores a knob far from the current value');
  ok(pickup.caught, 'Pickup mode takes over once the knob crosses the value');

  /* ── One knob per parameter, one parameter per knob ───────────────────────── */
  const relearn = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app.midi.access) app.midi.access = {};
    const param = 'master.vol';

    // First learn CC 40
    app.ui.startLearn(param);
    app.midi.handle([0xb0, 40, 64]);
    app.ui.clearLearn();

    // Now re-learn to a different CC
    app.ui.startLearn(param);
    app.midi.handle([0xb0, 50, 64]);
    app.ui.clearLearn();

    return { cc40: app.midi.map[40], cc50: app.midi.map[50] };
  });
  ok(relearn.cc40 === undefined, 'Old CC assignment is dropped on re-learn', String(relearn.cc40));
  ok(relearn.cc50 === 'master.vol', 'New CC assignment took', String(relearn.cc50));

  /* ── Learned mappings persist across reload ──────────────────────────────── */
  const mappings = await page.evaluate(() => {
    return window.modsynth.midi.map;
  });

  await page.reload();
  await page.waitForSelector('#splash-go');
  await page.click('#splash-go');
  await page.waitForFunction(() => window.modsynth && window.modsynth.started, null, { timeout: 15000 });
  await page.waitForTimeout(600);

  const persisted = await page.evaluate(() => {
    return window.modsynth.midi.map;
  });

  ok(JSON.stringify(persisted) === JSON.stringify(mappings), 'Mappings survive reload',
     Object.keys(persisted).length + ' mappings');

  /* ── Pickup is reset when loading a patch ──────────────────────────────── */
  const pickupReset = await page.evaluate(() => {
    const app = window.modsynth;
    app.midi.togglePickup();
    app.midi._pickupCaught.add(60);  // Mark a CC as caught

    const caughtBefore = app.midi._pickupCaught.size;
    app.loadPatch(app.lib.current);
    const caughtAfter = app.midi._pickupCaught.size;

    return { on: app.midi.pickup, before: caughtBefore, after: caughtAfter };
  });
  ok(pickupReset.on, 'Pickup is still enabled');
  ok(pickupReset.before > 0 && pickupReset.after === 0, 'Pickup caught set is cleared on patch load');

  /* ── Macros can be learned ──────────────────────────────────────────────── */
  const macroLearn = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app.midi.access) app.midi.access = {};
    app.ui.startLearn('macro.1');
    app.midi.handle([0xb0, 51, 64]);
    app.ui.clearLearn();

    // Drive the macro
    app.midi.handle([0xb0, 51, 0]);
    const low = +app.engine.getNorm('macro.1');

    app.midi.handle([0xb0, 51, 127]);
    const high = +app.engine.getNorm('macro.1');

    return { bound: app.midi.map[51], low_close_zero: low < 0.1, high_close_one: high > 0.9 };
  });
  ok(macroLearn.bound === 'macro.1', 'Macros can be learned', String(macroLearn.bound));
  ok(macroLearn.low_close_zero, 'Macro responds to CC 0');
  ok(macroLearn.high_close_one, 'Macro responds to CC 127');

  /* ── Reserved CCs can't be learned ──────────────────────────────────────── */
  const reserved = await page.evaluate(() => {
    const app = window.modsynth;
    if (!app.midi.access) app.midi.access = {};
    // CC 1 is reserved (mod wheel)
    app.ui.startLearn('lfo1.depth');
    app.midi.handle([0xb0, 1, 64]);
    app.ui.clearLearn();

    return app.midi.map[1];
  });
  ok(reserved !== 'lfo1.depth', 'Reserved CCs cannot be learned');

  ok(errors.length === 0, 'No page errors', errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
