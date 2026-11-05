// Chord Hold: with Hold on (and the Theory Pack), a chord pad keeps sounding after the
// finger comes up. Drives the real pads with pointer events and measures the chord bus.
//   python3 -m http.server 8777 --bind 127.0.0.1   (from the repo root, or dist/)
//   node tests/hold/chord-hold.cjs [http://127.0.0.1:8777/index.html]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    unlockAudio(false); await sleep(1500);
    const ctx = getCtx(); if (ctx.state !== 'running') await ctx.resume();
    const pads = [...document.querySelectorAll('.btn-tri')];
    const A = pads[0], B = pads[1];
    const fire = (el, type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch' }));
    const tap = async (el, ms) => { fire(el, 'pointerdown'); await sleep(ms); fire(el, 'pointerup'); fire(el, 'pointerleave'); };
    // The chord bus is made by the first chord, so play one and tap it.
    await tap(A, 200); await sleep(1500);
    const an = ctx.createAnalyser(); an.fftSize = 2048; window._partBuses.chord.connect(an);
    const buf = new Float32Array(2048);
    const level = async () => { let s = 0; for (let i = 0; i < 20; i++) { an.getFloatTimeDomainData(buf); let q = 0; for (const v of buf) q += v * v; s += Math.sqrt(q / buf.length); await sleep(40); } return s / 20; };
    const out = { pads: pads.length };
    const flash = el => el.classList.contains('flash');

    // Pack owned, Hold on: the pad latches.
    _modFull = false; _modOwned = { theory: true }; holdMode = true;   // the web build reports Full Studio
    await tap(A, 200); await sleep(2500);
    out.latchedLevel = await level(); out.latchedLive = _chordLiveId != null; out.latchedFlash = flash(A); out.latchRec = !!_chordLatch;
    // Another pad replaces it.
    await tap(B, 200); await sleep(800);
    out.swapFlashA = flash(A); out.swapFlashB = flash(B); out.swapLatchIsB = !!(_chordLatch && _chordLatch.el === B);
    // Hold off: the chord goes.
    toggleHold(); await sleep(3500);
    out.offLevel = await level(); out.offLive = _chordLiveId; out.offFlashB = flash(B); out.offLatch = _chordLatch;
    // Panic while latched.
    toggleHold(); await tap(A, 200); await sleep(800);
    out.beforePanic = await level(); panicNotes(); await sleep(400);
    out.panicLevel = await level(); out.panicFlash = flash(A); out.panicLatch = _chordLatch; out.panicLive = _chordLiveId;
    // Something else taking over (a song chord, a typed one) clears the lit pad.
    await tap(A, 200); await sleep(500);
    const litBefore = flash(A);
    playChord(7, [0, 4, 7], false, 0, false); await sleep(300);   // no atTime: a live tap
    out.takeoverLit = litBefore; out.takeoverFlash = flash(A); out.takeoverLatch = _chordLatch;
    holdMode = false; await sleep(2500);
    // Hold off: a plain tap still releases.
    await tap(A, 300); await sleep(3500);
    out.plainLevel = await level(); out.plainFlash = flash(A); out.plainLatch = _chordLatch;
    // No pack, Hold on: nothing latches, and it says so.
    _modFull = false; _modOwned = {}; holdMode = true;
    await tap(A, 300); await sleep(3500);
    out.freeLevel = await level(); out.freeFlash = flash(A); out.freeLatch = _chordLatch;
    out.freeToast = (document.body.innerText.match(/Chord Hold[^\n]*/) || [null])[0];
    // Hold itself stays free: the melody strip still latches.
    const key = [...document.querySelectorAll('[id^="mel-"]')].find(e => /^mel-\d+$/.test(e.id));
    fire(key, 'pointerdown'); await sleep(200); fire(key, 'pointerup'); await sleep(300);
    out.melHeldNoPack = key.classList.contains('held') && Object.keys(_melLive).length > 0;
    holdMode = false; panicNotes();
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.pads >= 2, 'found chord pads');
  ok(r.latchedLive && r.latchedFlash && r.latchRec, 'Hold + pack: the pad latches after the finger is up (live id, lit, recorded)');
  ok(r.latchedLevel > 0.003, 'the latched chord is still sounding 2.5 s after release (' + r.latchedLevel.toFixed(4) + ')');
  ok(!r.swapFlashA && r.swapFlashB && r.swapLatchIsB, 'another pad takes the latch and puts the first one out');
  ok(r.offLevel < 0.0005 && r.offLive === null && !r.offFlashB && r.offLatch === null, 'Hold off lets the chord go and clears the pad (' + r.offLevel.toFixed(5) + ')');
  ok(r.beforePanic > 0.003 && r.panicLevel < 0.0005 && !r.panicFlash && r.panicLatch === null && r.panicLive === null, 'Panic ends a latched chord and clears its pad');
  ok(r.takeoverLit && !r.takeoverFlash && r.takeoverLatch === null, 'a chord from elsewhere clears the lit pad');
  ok(r.plainLevel < 0.0005 && !r.plainFlash && r.plainLatch === null, 'Hold off: a plain tap still releases');
  ok(r.freeLevel < 0.0005 && !r.freeFlash && r.freeLatch === null, 'no pack: Hold does not latch a pad');
  ok(/Chord Hold/.test(r.freeToast || ''), 'no pack: it names the pack (' + r.freeToast + ')');
  ok(r.melHeldNoPack, 'no pack: the melody strip is still held (Hold itself is free)');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
