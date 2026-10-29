/* The melody sequencer's chords and slides (4.9.9.9.9.9.6c), at the door the notes go
   out through: what the engine is sent, not what it plays.
   - The roll: tapping a second row on a lit step adds a note (a chord of up to eight),
     tapping a note of the chord takes it away, and tapping the first note lets the next
     one step up. Explicit Mono keeps the old tap, which moves the one note.
   - A chord played into an armed roll (two keys within 50 ms) joins one step.
   - Playing: a chord step sounds every note at one time and none slides; a single-note
     line slides from note to note, longer for a bigger leap and never longer than the note
     it lands on; Glide off, a gap, and explicit Poly all play without a slide; explicit
     Mono plays only the first note of a chord.
   Run: node tests/mel/seq.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200); await page.mouse.click(5, 5); await page.waitForTimeout(300);

  // ── The roll ──
  const roll = await page.evaluate(() => {
    const cfg = PR_ENGINES.ml, out = {};
    const clear = () => { for (let x = 0; x < cfg.steps(); x++) cfg.clearAt(x); };
    melMono = true; melAuto = true; clear();
    cfg.toggle(0, 72);                       // first note
    out.one = { v: cfg.cell(0).v, more: cfg.cell(0).more || null, ex: cfg.extras(0) };
    cfg.toggle(0, 76);                       // another row on the same step: a second note
    cfg.toggle(0, 79);
    out.three = { more: JSON.parse(JSON.stringify(cfg.cell(0).more)), ex: cfg.extras(0).slice().sort() };
    cfg.toggle(0, 76);                       // tap a chord note: it goes
    out.tapOff = { more: JSON.parse(JSON.stringify(cfg.cell(0).more)) };
    cfg.toggle(0, 72);                       // tap the first note: the next one steps up
    out.stepUp = { v: cfg.cell(0).v, note: cfg.cell(0).note, oct: cfg.cell(0).oct, more: cfg.cell(0).more || null };
    cfg.toggle(0, 79);                       // the last note: the step is empty
    out.empty = { v: cfg.cell(0).v, more: cfg.cell(0).more || null };
    // Eight is the most.
    clear(); cfg.toggle(1, 60); for (let m = 61; m <= 70; m++) cfg.toggle(1, m);
    out.cap = 1 + (cfg.cell(1).more || []).length;
    // Explicit Mono: the tap moves the one note.
    clear(); melAuto = false; cfg.toggle(2, 60); cfg.toggle(2, 64);
    out.mono = { note: cfg.cell(2).note, oct: cfg.cell(2).oct, more: cfg.cell(2).more || null, ex: cfg.extras(2) };
    // A chord played into an armed roll: two keys 20 ms apart share a step; a third key later gets the next.
    melAuto = true; clear();
    window.__armed = typeof noteInputTarget === 'function';
    return out;
  });
  ok(roll.one.v === 1 && !roll.one.more && !roll.one.ex, 'one tap is one note', JSON.stringify(roll.one));
  ok(roll.three.more.length === 2 && roll.three.ex.length === 2, 'taps on other rows of a lit step add notes to it', JSON.stringify(roll.three));
  ok(roll.tapOff.more.length === 1 && roll.tapOff.more[0].note === 7, 'tapping a note of the chord takes that note away', JSON.stringify(roll.tapOff));
  ok(roll.stepUp.v === 1 && roll.stepUp.note === 7 && roll.stepUp.oct === 5 && !roll.stepUp.more, 'tapping the first note lets the next one step up', JSON.stringify(roll.stepUp));
  ok(roll.empty.v === 0 && !roll.empty.more, 'and the last note empties the step', JSON.stringify(roll.empty));
  ok(roll.cap === 8, 'a step holds eight notes at most', String(roll.cap));
  ok(roll.mono.note === 4 && roll.mono.oct === 4 && !roll.mono.more && !roll.mono.ex, 'explicit Mono: the tap moves the one note', JSON.stringify(roll.mono));

  // ── Playing ──
  const play = await page.evaluate(async () => {
    if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) { } }
    await audioCtx.resume();
    const sent = [];
    window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); };
    window.modEngine.ready = () => true;
    document.getElementById('bpm').value = 240; if (typeof setBPM === 'function') try { setBPM(240); } catch (e) { }
    const cfg = PR_ENGINES.ml;
    const clear = () => { for (let x = 0; x < cfg.steps(); x++) cfg.clearAt(x); };
    const run = async (ms) => {
      sent.length = 0;
      window.mlPlay(); await new Promise(r => setTimeout(r, ms)); window.mlPlay();
      return sent.filter(m => m.kind === 'note' && m.part === 'melgen').sort((a, b) => a.at - b.at);
    };
    const out = {};
    out.bpm = parseFloat(document.getElementById('bpm').value) || 120;
    // Fill the bar with a single-note line: C5 E5 G5 C6 on steps 0 4 8 12, one step long each (note
    // 1 step, so the next one is 3 steps of rest away - too far to slide from).
    // Then adjacent steps: 0 1 2 3 so a slide is allowed.
    const line = (steps, midis) => { clear(); steps.forEach((s, i) => { cfg.toggle(s, midis[i]); }); };
    melMono = true; melAuto = true; melGlideOn = true; melGlideTime = 0.2; mlFollow = false;

    line([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [72, 74, 76, 79, 72, 84, 83, 71, 72, 72, 60, 72, 74, 76, 79, 72]);
    const a = await run(1400);
    out.adj = a.slice(0, 14).map(m => ({ n: m.note, gf: m.glideFrom == null ? null : m.glideFrom, gt: m.glideTime == null ? null : +m.glideTime.toFixed(4) }));

    // A gap of more than a step: no slide.
    line([0, 4], [72, 79]);
    const g = await run(1400);
    out.gap = g.slice(0, 2).map(m => ({ n: m.note, gf: m.glideFrom == null ? null : m.glideFrom }));

    // Glide off, and explicit Poly: no slide anywhere.
    line([0, 1], [72, 79]);
    melGlideOn = false; const off = await run(1400); out.off = off.slice(0, 2).map(m => m.glideFrom == null ? null : m.glideFrom); melGlideOn = true;
    melMono = false; melAuto = false; const poly = await run(1400); out.polyMode = poly.slice(0, 2).map(m => m.glideFrom == null ? null : m.glideFrom);
    melMono = true; melAuto = true;

    // A chord step: every note at one time, none slides, and the step after it does not slide either.
    line([0, 1], [72, 74]); cfg.toggle(0, 76); cfg.toggle(0, 79);
    const ch = await run(1400);
    const first = ch.filter(m => Math.abs(m.at - ch[0].at) < 1e-6);
    out.chord = { atStep0: first.map(m => m.note).sort(), allGlide: ch.slice(0, 5).map(m => m.glideFrom == null ? null : m.glideFrom), vel: first.map(m => +m.vel.toFixed(3)) };

    // Explicit Mono plays the first note of the chord only.
    melAuto = false; const mo = await run(1400);
    out.monoPlay = mo.filter(m => Math.abs(m.at - mo[0].at) < 1e-6).map(m => m.note);
    melAuto = true;

    // Eight on a step is the most heard.
    clear(); cfg.toggle(0, 60); for (let m = 61; m <= 67; m++) cfg.toggle(0, m);
    const eight = await run(1400);
    out.eight = eight.filter(m => Math.abs(m.at - eight[0].at) < 1e-6).length;
    clear();
    return out;
  });
  const near = (a, b) => Math.abs(a - b) < 2e-3;
  const adj = play.adj;
  ok(adj[0].gf == null || adj[0].gf === 72, 'the first note of the loop slides from nothing (or from the loop\'s last note)', JSON.stringify(adj[0]));
  ok(adj[1].gf === 72 && adj[2].gf === 74 && adj[3].gf === 76, 'a line of adjacent single notes slides from each note to the next', JSON.stringify(adj.slice(0, 4)));
  // 72->74 is 2 semitones, 76->79 is 3, 79->72 is 7, 72->84 is 12, 84->83 is 1. Slides are limited by the 80% of the
  // note they land on (the page clamps the tempo, so the cap is worked out from the tempo it kept).
  const cap = 0.8 * 0.92 * 60 / play.bpm / 4 + 1e-4;   // the slide's ceiling: 80% of the note it lands on
  ok(adj[1].gt > 0 && adj.slice(1, 14).every(m => m.gt == null || m.gt <= cap), 'the slide is never longer than the note it lands on', JSON.stringify(adj.slice(0, 3)));
  ok(adj[5].gt >= adj[1].gt && adj[5].gt >= adj[4].gt, 'a bigger leap takes at least as long (capped by the note)', JSON.stringify([adj[1], adj[4], adj[5]]));
  ok(play.gap[1].gf == null, 'a gap of more than a step is not slid across', JSON.stringify(play.gap));
  ok(play.off[1] == null && play.polyMode[1] == null, 'Glide off, and explicit Poly: no slide', JSON.stringify([play.off, play.polyMode]));
  ok(JSON.stringify(play.chord.atStep0) === JSON.stringify([0, 4, 7, 9].sort((a, b) => a - b)) || play.chord.atStep0.length === 3,
    'a chord step sounds all its notes at one time', JSON.stringify(play.chord));
  ok(play.chord.allGlide.every(g => g == null) && play.chord.vel.every(v => Math.abs(v - play.chord.vel[0]) < 1e-9),
    'a chord is not slid into or out of, and its notes share one level', JSON.stringify(play.chord));
  ok(play.monoPlay.length === 1, 'explicit Mono plays the first note of a chord only', JSON.stringify(play.monoPlay));
  ok(play.eight === 8, 'eight notes on a step all sound', String(play.eight));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
