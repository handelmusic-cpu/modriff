/* End-to-end check in a real browser: does the app boot, load the worklet,
   build the panel, make sound, and survive being driven?
   Run:  node tests/browser.test.js  (a static server must serve the folder) */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8791;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
           '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#splash-go');
  await page.click('#splash-go');

  // The worklet has to load and the wavetables have to build before anything sounds.
  await page.waitForFunction(() => window.modsynth && window.modsynth.started, null, { timeout: 15000 })
    .catch(() => {});
  if (errors.length) console.log('  ↳ errors during boot:\n     ' + errors.join('\n     '));

  const boot = await page.evaluate(() => ({
    started: !!(window.modsynth && window.modsynth.started),
    ready: !!(window.modsynth && window.modsynth.engine.ready),
    ctxState: window.modsynth && window.modsynth.engine.ctx ? window.modsynth.engine.ctx.state : 'none',
    loadMode: window.modsynth && window.modsynth.engine.loadMode,
    splashErr: document.getElementById('splash-err').textContent,
  }));
  ok(boot.started, 'app starts', JSON.stringify(boot));
  ok(boot.ready, 'audio engine ready', boot.splashErr);
  ok(boot.loadMode === 'blob', 'worklet loaded from a blob URL', boot.loadMode);

  const built = await page.evaluate(() => ({
    knobs: document.querySelectorAll('.knob').length,
    panels: document.querySelectorAll('.panel').length,
    keys: document.querySelectorAll('.key').length,
    macros: document.querySelectorAll('.macro-slot').length,
    matrixRows: document.querySelectorAll('.matrix tbody tr').length,
    drumRows: document.querySelectorAll('.drum-row').length,
    patchName: document.getElementById('patch-name').textContent,
  }));
  ok(built.knobs > 100, 'control surface built', built.knobs + ' knobs');
  ok(built.panels >= 20, 'panels built', built.panels + ' panels');
  ok(built.keys === 49, 'keyboard built', built.keys + ' keys');
  ok(built.macros === 8, 'eight macros', String(built.macros));
  ok(built.matrixRows === 16, 'matrix has 16 slots', String(built.matrixRows));
  ok(built.drumRows === 9, 'drum grid built', String(built.drumRows));
  ok(built.patchName && built.patchName !== 'Init', 'opens on a real patch', built.patchName);

  /* Does it actually make sound? Measure the analyser rather than trusting the graph. */
  const level = await page.evaluate(async () => {
    const app = window.modsynth;
    app.noteOn(60, 0.9); app.noteOn(64, 0.9); app.noteOn(67, 0.9);
    await new Promise(r => setTimeout(r, 400));
    const buf = new Uint8Array(1024);
    let peak = 0;
    for (let n = 0; n < 12; n++) {
      app.engine.getWaveform(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      await new Promise(r => setTimeout(r, 25));
    }
    app.engine.panic();
    return peak / 128;
  });
  ok(level > 0.05, 'produces audible output', 'peak ' + level.toFixed(3));

  /* Every tab renders without throwing. */
  for (const tab of ['mod', 'fx', 'arp', 'midi', 'synth']) {
    await page.click(`.tab[data-page="${tab}"]`);
    await page.waitForTimeout(60);
    const visible = await page.evaluate(t => {
      const pg = document.getElementById('page-' + t);
      return pg.classList.contains('on') && pg.children.length > 0;
    }, tab);
    ok(visible, 'tab renders: ' + tab);
  }

  /* Loading a patch changes parameters and keeps sounding. */
  const patchLoad = await page.evaluate(async () => {
    const app = window.modsynth;
    const before = app.engine.get('flt1.cutoff');
    const target = app.lib.all().find(p => p.name === 'Wobble Bass');
    app.loadPatch(target);
    await new Promise(r => setTimeout(r, 120));
    return {
      name: document.getElementById('patch-name').textContent,
      changed: app.engine.get('flt1.cutoff') !== before,
      knobMatches: (() => {
        const k = document.querySelector('.knob[data-param="flt1.cutoff"] .kval');
        return !!k && k.textContent.length > 0;
      })(),
    };
  });
  ok(patchLoad.name === 'Wobble Bass', 'patch loads', patchLoad.name);
  ok(patchLoad.changed, 'patch changes parameters');
  ok(patchLoad.knobMatches, 'knobs redraw on patch load');

  /* Sweep every factory patch through the live engine. This is the test that
     catches a patch that only breaks once the FX rack is attached. */
  const sweep = await page.evaluate(async () => {
    const app = window.modsynth;
    const bad = [];
    const all = app.lib.all();
    for (let i = 0; i < all.length; i++) {
      try { app.loadPatch(all[i]); } catch (e) { bad.push(all[i].name + ': ' + e.message); }
    }
    app.engine.panic();
    return { count: all.length, bad };
  });
  ok(sweep.bad.length === 0, `all ${sweep.count} patches load in the browser`, sweep.bad.slice(0, 5).join(' | '));

  /* Macros must move the sound. */
  const macro = await page.evaluate(async () => {
    const app = window.modsynth;
    app.loadPatch(app.lib.all().find(p => p.name === 'Prophet Pad'));
    app.engine.setMacro(1, 0);
    app.noteOn(48, 0.9);
    await new Promise(r => setTimeout(r, 300));
    const read = async () => {
      const buf = new Uint8Array(512);
      let sum = 0;
      for (let n = 0; n < 10; n++) {
        app.engine.getSpectrum(buf);
        for (let i = 40; i < 512; i++) sum += buf[i];
        await new Promise(r => setTimeout(r, 20));
      }
      return sum;
    };
    const closed = await read();
    app.engine.setMacro(1, 1);
    await new Promise(r => setTimeout(r, 250));
    const open = await read();
    app.engine.panic();
    return { closed, open };
  });
  ok(macro.open > macro.closed * 1.15, 'macro 1 opens the sound up',
     `closed=${macro.closed} open=${macro.open}`);

  /* Arp + drums + transport. */
  const seq = await page.evaluate(async () => {
    const app = window.modsynth;
    app.loadPatch(app.lib.all().find(p => p.name === 'Classic Arp'));
    app.drums.on = true;
    app.drums.pattern.kick[0] = 0.9;
    app.drums.pattern.kick[8] = 0.9;
    app.drums.pattern.hat[4] = 0.7;
    if (!app.transport.playing) app.toggleTransport();
    app.noteOn(48, 0.9); app.noteOn(52, 0.9); app.noteOn(55, 0.9);
    await new Promise(r => setTimeout(r, 1400));
    const buf = new Uint8Array(1024);
    let peak = 0;
    for (let n = 0; n < 20; n++) {
      app.engine.getWaveform(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      await new Promise(r => setTimeout(r, 25));
    }
    const step = app.transport.step;
    app.noteOff(48); app.noteOff(52); app.noteOff(55);
    app.toggleTransport();
    app.engine.panic();
    return { peak: peak / 128, step, playing: app.transport.playing };
  });
  ok(seq.step > 4, 'transport advances', 'step ' + seq.step);
  ok(seq.peak > 0.03, 'arpeggiator and drums sound', 'peak ' + seq.peak.toFixed(3));

  /* Save / export / import round-trip through localStorage. */
  const store = await page.evaluate(() => {
    const app = window.modsynth;
    app.engine.set('flt1.cutoff', 777);
    app.engine.set('osc1.wave', 'growl');
    const saved = app.lib.save('E2E Test Patch', 'User', ['test']);
    const json = app.lib.exportJSON([saved.id]);
    app.lib.remove(saved.id);
    const n = app.lib.importJSON(json);
    const back = app.lib.all().find(p => p.name === 'E2E Test Patch');
    app.lib.load(back);
    const result = {
      imported: n,
      cutoff: Math.round(app.engine.get('flt1.cutoff')),
      wave: app.engine.get('osc1.wave'),
    };
    if (back) app.lib.remove(back.id);
    return result;
  });
  ok(store.imported === 1, 'patch exports and imports', JSON.stringify(store));
  ok(store.cutoff === 777 && store.wave === 'growl', 'saved values survive the round trip', JSON.stringify(store));

  /* Dice must always land on something that makes a noise. */
  const dice = await page.evaluate(async () => {
    const app = window.modsynth;
    let silent = 0;
    for (let i = 0; i < 12; i++) {
      app.randomise();
      app.noteOn(52, 0.9);
      await new Promise(r => setTimeout(r, 260));
      const buf = new Uint8Array(1024);
      let peak = 0;
      for (let n = 0; n < 6; n++) {
        app.engine.getWaveform(buf);
        for (let j = 0; j < buf.length; j++) peak = Math.max(peak, Math.abs(buf[j] - 128));
        await new Promise(r => setTimeout(r, 20));
      }
      if (peak / 128 < 0.01) silent++;
      app.engine.panic();
    }
    return silent;
  });
  ok(dice <= 1, 'random patches make sound', dice + '/12 silent');

  ok(errors.length === 0, 'no console or page errors', errors.slice(0, 4).join(' | '));

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
