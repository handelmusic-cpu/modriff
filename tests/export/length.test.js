/* Free audio export (7.3): the mixed-down .wav is the whole take, on BOTH paths, with
   no fade. Until 7.3 free cut it at 30 s and faded the last 2 s; this checks that is gone.

   web   the in-memory path (a browser): _floatsToWavBlob on the whole take.
   sink  the app's streamed path: _finishSinkMix. The host is stood in for by a small
         file store that does what ModEngine.swift's fileAppend, wavFinish and pcmAdd do.
         Its pcmFade is kept and counted: the page must no longer call it.

   Each is measured in the file that was delivered: length in frames (more than 32 x
   sample rate for a 34 s take), the peak of the last 50 ms against the peak of the 50 ms
   that ended 3 s before the end (as loud: no fade). Free stems still open the Studio
   Pack sheet. The Studio Pack (modo-dev-tier=pro) gets the same whole take.

   Run (repo or dist/ served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/export/length.test.js            # all
     node tests/export/length.test.js web,sink   # some
   Env: URL, CHROMIUM, PLAYWRIGHT. The long takes run in real time (about 2 minutes). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const WHICH = (process.argv[2] || 'web,sink').split(',');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

async function fresh(browser, tier) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => localStorage.clear());
  await page.evaluate(t => localStorage.setItem('modo-dev-tier', t), tier);
  await page.goto(URL); await page.waitForTimeout(1500);
  await page.click('.unlock-btn >> text=Random'); await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__out = null; window.__toasts = [];
    const st = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); return st.apply(this, arguments); };
    const mt = window.majorToast; window.majorToast = function (m) { window.__toasts.push(String(m)); return mt.apply(this, arguments); };
    // A steady tone into the master, so "how loud is the end" has one answer.
    const ctx = getCtx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 220; g.gain.value = 0.3; o.connect(g); g.connect(window._masterOut); o.start();
  });
  return page;
}
// What the page measures about a delivered .wav (bytes in an array).
const measureSrc = `(u8) => {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), sr = dv.getUint32(24, true);
  let o = 12; while (o < u8.length && String.fromCharCode(u8[o], u8[o+1], u8[o+2], u8[o+3]) !== 'data') o += 8 + dv.getUint32(o+4, true) + (dv.getUint32(o+4, true) & 1);
  const n = dv.getUint32(o+4, true) / 4, at = i => dv.getInt16(o + 8 + i * 4, true) / 32768;
  const peak = (a, b) => { let p = 0; for (let i = Math.max(0, a); i < Math.min(n, b); i++) p = Math.max(p, Math.abs(at(i))); return p; };
  const w = Math.round(sr * 0.05);
  return { sr, frames: n, last50: peak(n - w, n), at3s: peak(n - 3 * sr - w, n - 3 * sr), lastSample: at(n - 1), prevSample: at(n - 2) };
}`;

// The stand-in host for the streamed path.
const installHost = () => {
  const fs = {}, cat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
  const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  window.__fs = fs;
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  MODNAT.stream = true;
  MODNAT.plugin = {
    fileAppend: async o => { fs[o.name] = o.first || !fs[o.name] ? dec(o.data) : cat(fs[o.name], dec(o.data)); return {}; },
    fileDelete: async o => { (o.names || []).forEach(n => delete fs[n]); },
    wavFinish: async o => {
      const src = fs[o.pcm] || new Uint8Array(0), h = dec(o.header), out = new Uint8Array(h.length + o.dataBytes);
      out.set(h); let at = h.length + Math.min(o.leadBytes || 0, o.dataBytes);
      const body = src.subarray(o.skipBytes || 0, (o.skipBytes || 0) + (h.length + o.dataBytes - at));
      out.set(body, at); fs[o.name] = out; delete fs[o.pcm]; return { bytes: o.dataBytes };
    },
    pcmAdd: async o => {
      const f = fs[o.name], add = dec(o.data), dv = new DataView(f.buffer), av = new DataView(add.buffer, add.byteOffset, add.byteLength);
      for (let i = 0; i + 1 < add.length && o.offset + i + 1 < f.length; i += 2)
        dv.setInt16(o.offset + i, Math.max(-32768, Math.min(32767, dv.getInt16(o.offset + i, true) + av.getInt16(i, true))), true);
    },
    // ModEngine.swift still has pcmFade; free used to call it. Counted, so a call is caught.
    pcmFade: async () => { window.__fades = (window.__fades || 0) + 1; },
    shareFiles: async () => ({}), captureStart: async () => ({}), captureStop: async () => ({}), captureRead: async () => ({ streams: [] }),
  };
};

async function take(page, seconds, sink) {
  if (sink) await page.evaluate(installHost);
  // What gets delivered: the blob (web) or the host's file (sink), measured where it lands.
  await page.evaluate(m => {
    const measure = eval(m);
    window._deliverFiles = async function (list, opts) {
      const f = (list || []).find(x => /\.wav$/.test(x.name));
      const u8 = f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : window.__fs[Object.keys(window.__fs).find(k => k.endsWith('.wav'))];
      window.__out = Object.assign({ sink: !f.blob }, measure(u8));
      if (opts && opts.onSaved) opts.onSaved();   // the app says its message once the files are written
    };
  }, measureSrc);
  await page.evaluate(() => toggleRecording());
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => toggleRecording());
  for (let i = 0; i < 60 && !(await page.evaluate(() => window.__out)); i++) await page.waitForTimeout(500);
  return page.evaluate(() => ({ out: window.__out, toasts: window.__toasts }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  for (const path of WHICH) {
    const sink = path === 'sink';
    console.log('\n== ' + path + ' path');
    // Free, past the old 30 s line: the whole take, no fade.
    let page = await fresh(browser, 'free');
    let r = await take(page, 34, sink);
    let o = r.out; console.log(JSON.stringify(o));
    check(o && o.sink === sink, 'went down the ' + path + ' path');
    check(o && o.frames > 32 * o.sr, 'free, 34 s take: the whole take, not 30 s', o && (o.frames / o.sr).toFixed(2) + ' s');
    check(o && o.last50 > 0.1 && Math.abs(o.last50 - o.at3s) < 0.05, 'free: no fade, the last 50 ms is as loud as 3 s before', o && o.last50.toFixed(3) + ' vs ' + o.at3s.toFixed(3));
    check((await page.evaluate(() => window.__fades || 0)) === 0, 'free: the host is never asked to fade');
    check(!r.toasts.some(t => /seconds of audio/.test(t)), 'no "seconds of audio" message', r.toasts.filter(t => /Free saves/.test(t)).join(' | '));
    // Stems stay the Studio Pack's: the switch is locked and a tap opens its sheet.
    const st = await page.evaluate(async () => {
      const b = document.querySelector('[data-stemtoggle]'); if (!b) return { none: true };
      const locked = b.classList.contains('tier-locked'); b.click(); await new Promise(x => setTimeout(x, 400));
      const sh = document.getElementById('_pro-sheet');
      return { locked, sheet: !!sh, text: sh ? sh.textContent.slice(0, 120) : '', stemsOn: !!exportStems };
    });
    check(!st.none && st.locked && st.sheet && /Studio Pack/.test(st.text) && !st.stemsOn, 'free: stems are locked and open the Studio Pack sheet', JSON.stringify(st));
    check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));
    await page.close();
    // Studio Pack: the whole take, no fade.
    page = await fresh(browser, 'pro');
    r = await take(page, 34, sink); o = r.out; console.log(JSON.stringify(o));
    check(o && o.frames > 32 * o.sr, 'pro, 34 s take: the whole take', o && (o.frames / o.sr).toFixed(2) + ' s');
    check(o && o.last50 > 0.1, 'pro: no fade at the end', o && o.last50.toFixed(3));
    await page.close();
  }
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
