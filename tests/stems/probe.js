/* Stem-recording probe: drives the real recorder (toggleRecording /
   toggleStemExport) through the ways a take can go wrong and prints what was
   delivered, so "stems didn't record after Bounce" is a count, not a guess.

   Scenarios
     A  Stems armed, then Bounce, then Stop            -> mix + stems
     B  Bounce, Stems armed mid-take, then Stop        -> was a silent mix-only file
     C  A fake native chord part (bus disconnected)    -> chord stem is silent; must say why
     D  _startStemTaps throws                          -> must not leave a half-started take
     E  Stems armed, nothing sounds                    -> "Nothing captured" path must dispose taps
     G  The master tap throws                          -> rolls back to idle (no live MIDI recorder)
     H  A stand-in native host (N5): a click at a known wall-clock instant, and a
        web click scheduled for the same instant. Both must land at the same place
        in the mix, and the native chord must get its own stem.
     F  Stems armed, then disarmed mid-take            -> mix only, taps disposed

   Run (repo served, Chrome or Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/stems/probe.js                 # all scenarios
     node tests/stems/probe.js A,B             # some
   Env: URL, CHROMIUM (default /opt/pw-browsers/chromium; on a Mac,
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
   PLAYWRIGHT (path to playwright / playwright-core if not installed). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const WHICH = (process.argv[2] || 'A,B,C,D,E,F,G,H').split(',');

async function fresh(browser) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.waitForTimeout(1500);
  await page.click('.unlock-btn >> text=Random');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__files = []; window.__toasts = [];
    window._deliverFiles = async function (list) {
      for (const f of list || []) {
        const e = { name: f.name, size: f.blob.size };
        if (/\.wav$/.test(f.name)) {
          // Where the sound starts (s) and its peak: a stem armed mid-take must
          // be silent up to the moment it was armed, not shifted to the start.
          const u = new Uint8Array(await f.blob.arrayBuffer()), dv = new DataView(u.buffer);
          let o = 12; while (o < u.length && String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]) !== 'data') o += 8 + dv.getUint32(o + 4, true) + (dv.getUint32(o + 4, true) & 1);
          const sr = dv.getUint32(24, true); let first = -1, pk = 0;
          for (let i = o + 8, n = 0; i + 1 < u.length; i += 4, n++) { const a = Math.abs(dv.getInt16(i, true)) / 32768; if (a > pk) pk = a; if (first < 0 && a > 0.0005) first = n; }
          e.firstSoundS = first < 0 ? null : +(first / sr).toFixed(2); e.peak = +pk.toFixed(3);
          // Where the first strong positive and strong negative sample sit (ms):
          // scenario H puts a web click (+) and a native click (-) at one instant.
          let pos = -1, neg = -1;
          for (let i = o + 8, n = 0; i + 1 < u.length; i += 4, n++) { const a = dv.getInt16(i, true) / 32768; if (pos < 0 && a > 0.2) pos = n; if (neg < 0 && a < -0.2) neg = n; }
          e.posMs = pos < 0 ? null : +(pos / sr * 1000).toFixed(2); e.negMs = neg < 0 ? null : +(neg / sr * 1000).toFixed(2); e.frames = dv.getUint32(o + 4, true) / 4;
        }
        window.__files.push(e);
      }
    };
    const st = window.showToast;
    window.showToast = function (m, o) { window.__toasts.push(String(m)); return st.apply(this, arguments); };
  });
  page.__errs = errs;
  return page;
}
const state = page => page.evaluate(() => ({
  exportStems, stemTaps: _stemTaps.length, isRecording: _isRecording,
  recKind: _recTap ? _recTap.kind : null,
  btnRed: !!(document.getElementById('ft-bounce-btn') || {}).classList && !document.getElementById('ft-bounce-btn').classList.contains('off'),
  midiOn: _midiRecOn,
}));
// Random starts a drums-only band in a headless page, which would make every
// stem scenario a one-stem scenario. Switch the arp on and stab a chord every
// beat so there are three parts with something to put in their files (bass and
// melody stay silent in a headless page; they are not what this probes).
const play = page => page.evaluate(() => {
  blEnabled = true; mlEnabled = true; arpOn = true;
  if (!isAnythingPlaying()) ftPlayStop();
  if (!window.__stab) window.__stab = setInterval(() => { try { playChord(55, [0, 4, 7, 11]); } catch (e) {} }, 600);
  return isAnythingPlaying();
});
const sleep = (page, ms) => page.waitForTimeout(ms);
async function stopAndCollect(page) {
  await page.evaluate(() => toggleRecording());
  await sleep(page, 900);
  return page.evaluate(() => ({ files: window.__files.map(f => f.name.replace(/^.* - /, '…') + ' ' + f.size + (f.firstSoundS !== undefined ? ' first=' + f.firstSoundS + 's peak=' + f.peak + ' pos=' + f.posMs + 'ms neg=' + f.negMs + 'ms' : '')), toasts: window.__toasts }));
}
function report(tag, o) { console.log('\n== ' + tag + '\n' + JSON.stringify(o, null, 1)); }

const SCEN = {
  async A(page) {
    await play(page); await sleep(page, 600);
    await page.evaluate(() => toggleStemExport());
    await page.evaluate(() => toggleRecording());
    await sleep(page, 2500);
    const mid = await state(page);
    return { mid, end: await stopAndCollect(page), after: await state(page) };
  },
  async B(page) {
    await play(page); await sleep(page, 600);
    await page.evaluate(() => toggleRecording());
    await sleep(page, 1200);
    await page.evaluate(() => toggleStemExport());      // armed during the take
    const armed = await state(page);
    await sleep(page, 1500);
    return { armed, end: await stopAndCollect(page), after: await state(page) };
  },
  async C(page) {
    // What the native engine does to the chord part: the web worklet's audio is
    // unplugged, so the chord bus carries nothing while the host plays it.
    await page.evaluate(() => {
      MODNAT.attached.chord = { port: { postMessage() {} }, orig() {}, eng: {} };
      // The host plays the chord, so the web worklet that feeds the chord bus is
      // unplugged and the bus carries nothing: silence the bus the stem taps.
      _partDest(getCtx(), 'chord').gain.value = 0;
    });
    return SCEN.A(page);
  },
  async D(page) {
    await play(page); await sleep(page, 600);
    await page.evaluate(() => { toggleStemExport(); window.__orig = _ensureAllPartBuses; window._ensureAllPartBuses = () => { throw new Error('boom'); }; });
    let thrown = null;
    await page.evaluate(() => { try { toggleRecording(); } catch (e) { return String(e); } }).then(r => { thrown = r; });
    const s = await state(page);
    await page.evaluate(() => { window._ensureAllPartBuses = window.__orig; });
    return { thrown, state: s, toasts: await page.evaluate(() => window.__toasts) };
  },
  async F(page) {
    await play(page); await sleep(page, 600);
    await page.evaluate(() => { toggleStemExport(); toggleRecording(); });
    await sleep(page, 1000);
    await page.evaluate(() => toggleStemExport());
    const disarmed = await state(page);
    await sleep(page, 800);
    return { disarmed, end: await stopAndCollect(page) };
  },
  async G(page) {
    await play(page); await sleep(page, 400);
    await page.evaluate(() => { window.__mk = _makePcmTap; window._makePcmTap = () => { throw new Error('tap'); }; toggleRecording(); });
    const s = await state(page);
    await page.evaluate(() => { window._makePcmTap = window.__mk; });
    return { state: s, toasts: await page.evaluate(() => window.__toasts) };
  },
  async H(page) {
    // The host, stood in for. It counts frames from its own zero and stamps its
    // latest block with the wall clock, like the real one; its chord plays a quiet
    // tone throughout and one negative click at an instant fixed in wall time.
    await page.evaluate(() => {
      const ctx = getCtx(), sr = ctx.sampleRate;
      const T0 = performance.timeOrigin + performance.now() - 5000;      // host frame 0 was 5 s ago
      const wall = () => performance.timeOrigin + performance.now();
      const frameAt = w => Math.round((w - T0) * sr / 1000);
      let clickFrame = 0, last = 0, armed = false; window.__capCalls = [];
      window.__armHost = () => { clickFrame = frameAt(window.__clickWall); };
      const b64 = f32 => { const u = new Uint8Array(f32.buffer); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
      const stream = (id, f0, n) => {
        const d = new Float32Array(2 * n);
        for (let i = 0; i < n; i++) {
          const f = f0 + i; let v = 0.05 * Math.sin(2 * Math.PI * 440 * f / sr);
          if (f >= clickFrame && f < clickFrame + 8) v = -0.5;
          d[i] = v; d[n + i] = v;
        }
        return { id, frame0: f0, frames: n, lost: 0, data: b64(d) };
      };
      MODNAT.started = true; MODNAT.attached.chord = { port: { postMessage() {} }, orig() {}, eng: {} };
      _partDest(ctx, 'chord').gain.value = 0;
      MODNAT.plugin = {
        post: async () => ({ queued: 0 }), meters: async () => ({ rms: [0, 0, 0, 0, 0, 0, 0, 0] }),
        captureStart: async o => { window.__capCalls.push(o.mask); if (!armed) { armed = true; last = frameAt(wall()); } return { mask: o.mask, sampleRate: sr }; },
        captureRead: async () => {
          const upTo = frameAt(wall()) - 200, n = Math.max(0, upTo - last);
          const streams = [];
          if (armed && n > 0) { streams.push(stream(0, last, n)); if (window.__capCalls.some(m => m & 2)) streams.push(stream(1, last, n)); last += n; }
          return { streams, originMs: T0 + (Math.random() - 0.5) * 2, drainMs: 0, sampleRate: sr };   // the host's running estimate, a little noisy
        },
        captureStop: async () => { armed = false; },
      };
    });
    // The probe's own best reading of how the AudioContext and the wall clock
    // sit (the largest ctx-minus-wall seen over a second), so the web click is
    // placed as exactly as a click can be. The recorder is judged against that.
    await page.evaluate(() => new Promise(res => {
      const ctx = getCtx(); let q = -Infinity; const t0 = performance.now();
      const iv = setInterval(() => {
        q = Math.max(q, ctx.currentTime * ctx.sampleRate - (performance.timeOrigin + performance.now()) * ctx.sampleRate / 1000);
        if (performance.now() - t0 > 1200) { clearInterval(iv); window.__q = q; res(); }
      }, 4);
    }));
    await page.evaluate(() => {
      // Both clicks come due 1.8 s from the start of the take, in wall time.
      window.__clickWall = performance.timeOrigin + performance.now() + 1800;
    });
    await page.evaluate(() => { window.__armHost(); });
    await page.evaluate(() => toggleStemExport());
    await page.evaluate(() => toggleRecording());
    await page.evaluate(() => {
      const ctx = getCtx();
      const buf = ctx.createBuffer(1, 8, ctx.sampleRate); buf.getChannelData(0).fill(0.5);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(window._masterOut);
      src.start((window.__q + window.__clickWall * ctx.sampleRate / 1000) / ctx.sampleRate);
    });
    await sleep(page, 2600);
    const calls = await page.evaluate(() => window.__capCalls.slice());
    return { captureStartMasks: calls, end: await stopAndCollect(page) };
  },
  async E(page) {
    await page.evaluate(() => { toggleStemExport(); toggleRecording(); });
    await sleep(page, 800);
    const nodes = await page.evaluate(() => _stemTaps.length);
    const end = await stopAndCollect(page);
    return { tapsWhileRecording: nodes, end, tapsAfter: await state(page) };
  },
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  for (const k of WHICH) {
    const page = await fresh(browser);
    try { report(k, await SCEN[k](page)); }
    catch (e) { console.log('\n== ' + k + ' FAILED: ' + e.message); }
    if (page.__errs.length) console.log('page errors:', page.__errs);
    await page.close();
  }
  await browser.close();
})();
