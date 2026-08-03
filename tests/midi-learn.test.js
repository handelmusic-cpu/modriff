/* MIDI Learn end-to-end: arm a control on screen, "move a knob", check it bound
   and that it actually drives the control. Web MIDI can't be granted headlessly,
   so the test calls onMidiMsg with real MIDI byte arrays — the same entry point
   a controller reaches.

   Run: node tests/midi-learn.test.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8794;
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

/** A control-change message, as bytes. */
const CC = (cc, v) => ({ data: [0xb0, cc, v] });

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const IGNORE = /posthog|fonts\.googleapis|fonts\.gstatic|ERR_TUNNEL|Failed to load resource/;
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => typeof window.mlHandleCC === 'function', null, { timeout: 15000 });
  // Get past the unlock screen so the panels are on-screen and measurable.
  await page.evaluate(() => {
    if (typeof unlockAudio === 'function') unlockAudio(false);
    if (typeof setViewMode === 'function') setViewMode('advanced');
    if (typeof switchTab === 'function') switchTab('perform');
  });
  await page.waitForTimeout(600);

  /* ── The core loop: arm, move a knob, bound ─────────────────────────────── */
  const learn = await page.evaluate(async () => {
    toggleMidiLearn();
    const armed = document.body.classList.contains('midi-learn');
    const targets = mlTargets().length;
    const slider = document.getElementById('fx-cutoff');
    slider.click();                                   // tap to arm
    const isArmed = slider.classList.contains('ml-armed');
    onMidiMsg({ data: [0xb0, 74, 100] });             // move a knob
    const bound = midiLearn.map[74];
    toggleMidiLearn();
    return { armed, targets, isArmed, bound, banner: !!document.getElementById('ml-banner') };
  });
  ok(learn.armed, 'learn mode turns on');
  ok(learn.targets > 60, 'the whole app is mappable, not just the visible tab', learn.targets + ' targets');
  ok(learn.banner, 'the on-screen banner appears');
  ok(learn.isArmed, 'tapping a control arms it');
  ok(learn.bound === '#fx-cutoff', 'moving a knob binds it', String(learn.bound));

  /* ── Does the CC actually move the control, and fire its handler? ───────── */
  const drive = await page.evaluate(() => {
    const el = document.getElementById('fx-cutoff');
    let fired = 0;
    el.addEventListener('input', () => fired++);
    onMidiMsg({ data: [0xb0, 74, 0] });
    const low = +el.value;
    onMidiMsg({ data: [0xb0, 74, 127] });
    const high = +el.value;
    onMidiMsg({ data: [0xb0, 74, 64] });
    const mid = +el.value;
    return { low, mid, high, fired, min: +el.min, max: +el.max };
  });
  ok(drive.low === drive.min, 'CC 0 lands on the minimum', `${drive.low} vs ${drive.min}`);
  ok(drive.high === drive.max, 'CC 127 lands on the maximum', `${drive.high} vs ${drive.max}`);
  ok(drive.mid > drive.low && drive.mid < drive.high, 'CC 64 lands in between', String(drive.mid));
  ok(drive.fired === 3, "the control's own input handler runs", drive.fired + ' events');

  /* ── Toggle groups sweep across their choices ───────────────────────────── */
  const group = await page.evaluate(() => {
    const tg = document.getElementById('ext-toggle');
    toggleMidiLearn();
    tg.click();
    onMidiMsg({ data: [0xb0, 20, 0] });
    toggleMidiLearn();
    const labelOf = () => tg.querySelector('.tb.active')?.textContent;
    onMidiMsg({ data: [0xb0, 20, 0] });
    const first = labelOf();
    onMidiMsg({ data: [0xb0, 20, 127] });
    const last = labelOf();
    return { first, last, bound: midiLearn.map[20] };
  });
  ok(group.bound, 'a toggle group can be assigned', String(group.bound));
  ok(group.first !== group.last, 'a knob sweeps through the group', `${group.first} → ${group.last}`);

  /* ── One knob per control, one control per knob ─────────────────────────── */
  const relearn = await page.evaluate(() => {
    toggleMidiLearn();
    document.getElementById('fx-cutoff').click();
    onMidiMsg({ data: [0xb0, 30, 64] });             // re-learn to a different CC
    toggleMidiLearn();
    return { cc74: midiLearn.map[74], cc30: midiLearn.map[30] };
  });
  ok(relearn.cc74 === undefined, 'the old assignment is dropped on re-learn', String(relearn.cc74));
  ok(relearn.cc30 === '#fx-cutoff', 'the new assignment took', String(relearn.cc30));

  /* ── Learned mappings override the built-in CC 1 default ────────────────── */
  const override = await page.evaluate(() => {
    const decay = document.getElementById('decay');
    onMidiMsg({ data: [0xb0, 1, 127] });             // built-in default still works
    const viaDefault = +decay.value;
    toggleMidiLearn();
    document.getElementById('fx-reso').click();
    onMidiMsg({ data: [0xb0, 1, 64] });              // learn CC 1 to something else
    toggleMidiLearn();
    const before = +decay.value;
    onMidiMsg({ data: [0xb0, 1, 10] });
    return { viaDefault, decayUnchanged: +decay.value === before, reso: +document.getElementById('fx-reso').value };
  });
  ok(override.viaDefault > 7, 'the built-in CC 1 default still works unmapped', String(override.viaDefault));
  ok(override.decayUnchanged, 'learning CC 1 stops it also moving decay');
  ok(override.reso < 0.2, 'CC 1 now drives what it was assigned to', String(override.reso));

  /* ── Assignments survive a reload ───────────────────────────────────────── */
  await page.reload();
  await page.waitForFunction(() => typeof window.mlHandleCC === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    if (typeof unlockAudio === 'function') unlockAudio(false);
    if (typeof setViewMode === 'function') setViewMode('advanced');
    if (typeof switchTab === 'function') switchTab('perform');
  });
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(() => {
    const el = document.getElementById('fx-cutoff');
    onMidiMsg({ data: [0xb0, 30, 127] });
    return {
      map30: midiLearn.map[30],
      value: +el.value,
      max: +el.max,
      tagged: el.classList.contains('ml-mapped'),
      listed: document.querySelectorAll('#midi-map-list .ml-row').length,
    };
  });
  ok(persisted.map30 === '#fx-cutoff', 'assignments survive a reload', String(persisted.map30));
  ok(persisted.value === persisted.max, 'and still drive the control after reload');
  ok(persisted.tagged, 'mapped controls are tagged with their CC');
  ok(persisted.listed >= 2, 'the assignment list is populated', persisted.listed + ' rows');

  /* ── Pickup mode ────────────────────────────────────────────────────────── */
  const pickup = await page.evaluate(() => {
    const el = document.getElementById('fx-cutoff');
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    toggleMidiPickup();                               // on
    onMidiMsg({ data: [0xb0, 30, 127] });             // far from current — should be ignored
    const ignored = +el.value === +el.min;
    onMidiMsg({ data: [0xb0, 30, 0] });               // sweep down through the value
    onMidiMsg({ data: [0xb0, 30, 90] });              // now it has been caught
    const caught = +el.value > +el.min;
    toggleMidiPickup();                               // back off
    return { ignored, caught };
  });
  ok(pickup.ignored, "pickup ignores a knob that hasn't reached the value");
  ok(pickup.caught, 'pickup takes over once the knob passes through');

  /* ── Clearing ───────────────────────────────────────────────────────────── */
  const cleared = await page.evaluate(() => {
    window.confirm = () => true;
    clearMidiMap();
    return { n: Object.keys(midiLearn.map).length, tagged: document.querySelectorAll('.ml-mapped').length };
  });
  ok(cleared.n === 0 && cleared.tagged === 0, 'Clear All removes every assignment');

  /* ── Notes must still work while learning ───────────────────────────────── */
  const notes = await page.evaluate(() => {
    let threw = null;
    try {
      toggleMidiLearn();
      onMidiMsg({ data: [0x90, 60, 100] });
      onMidiMsg({ data: [0x80, 60, 0] });
      toggleMidiLearn();
    } catch (e) { threw = e.message; }
    return threw;
  });
  ok(notes === null, 'playing notes while learning does not throw', notes);

  ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
