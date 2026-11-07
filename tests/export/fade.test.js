/* Free audio export (6.9.9.9.4): 30 s, the last 2 s faded out, on BOTH paths.

   web   the in-memory path (a browser): fullL.slice(0,cap) then _fadeOutTail.
   sink  the app's streamed path: _finishSinkMix, then the host's pcmFade. The host is
         stood in for by a small file store that does what ModEngine.swift's fileAppend,
         wavFinish, pcmAdd and pcmFade do (same curve, same byte offsets). The Swift
         itself is not run here: only the page's half, and the arithmetic it asks for.

   Each is measured in the file that was delivered: length in frames (= 30 x sample
   rate when cut), the peak of the last 50 ms (about 0) against the peak of the 50 ms
   that ended 3 s before the end (not 0), and the last sample. A take under 30 s must
   come out whole, with no fade: its last 50 ms is as loud as the 50 ms 3 s before.
   The Studio Pack (modo-dev-tier=pro) must keep the whole take.

   Run (repo served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/export/fade.test.js            # all
     node tests/export/fade.test.js web,sink   # some
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
    // What ModEngine.swift's pcmFade does: a raised cosine over `frames` frames from byte `offset`, 0 on the last.
    pcmFade: async o => {
      const f = fs[o.name], dv = new DataView(f.buffer), n = Math.min(o.frames, Math.floor((f.length - o.offset) / 4));
      for (let i = 0; i < n; i++) {
        const g = 0.5 * (1 + Math.cos(Math.PI * (i + 1) / o.frames));
        for (let c = 0; c < 2; c++) { const p = o.offset + i * 4 + c * 2, v = dv.getInt16(p, true) * g; dv.setInt16(p, Math.sign(v) * Math.round(Math.abs(v)), true); }
      }
    },
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
    // Free, over the cap.
    let page = await fresh(browser, 'free');
    let r = await take(page, 34, sink);
    let o = r.out; console.log(JSON.stringify(o));
    check(o && o.sink === sink, 'went down the ' + path + ' path');
    check(o && o.frames === 30 * o.sr, 'free, 34 s take: file is 30 x sample rate frames', o && o.frames + ' vs ' + 30 * o.sr);
    check(o && o.last50 < 0.005, 'the last 50 ms is about 0', o && o.last50.toFixed(5));
    check(o && o.at3s > 0.1, '3 s before the end is not 0', o && o.at3s.toFixed(3));
    check(o && o.lastSample === 0, 'the final sample is exactly 0', o && o.lastSample);
    check(r.toasts.some(t => /first 30 seconds of audio/.test(t)), 'the toast says "the first 30 seconds of audio"', r.toasts.filter(t => /Free saves/.test(t)).join(' | '));
    check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));
    await page.close();
    // Free, under the cap: untouched.
    page = await fresh(browser, 'free');
    r = await take(page, 8, sink); o = r.out; console.log(JSON.stringify(o));
    check(o && o.frames < 30 * o.sr && o.frames > 6 * o.sr, 'free, 8 s take: whole, not cut to 30 s', o && (o.frames / o.sr).toFixed(2) + ' s');
    check(o && o.last50 > 0.1 && Math.abs(o.last50 - o.at3s) < 0.05, 'no fade: the last 50 ms is as loud as 3 s before', o && o.last50.toFixed(3) + ' vs ' + o.at3s.toFixed(3));
    check(!r.toasts.some(t => /Free saves/.test(t)), 'no "Free saves" message', '');
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
