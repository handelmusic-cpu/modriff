/* Slicing a clip across the pads (sampler editor: ✂ Slice onto pads).

   Counted on the real pad path. A clip with eight hits at known times, quiet
   ones among them, is put on pad A1, and the slicer is asked for the hits and
   for equal parts. What is held:
     - the hits it finds are the eight that were put there, within 8 ms, and
       none that were not;
     - the pads' windows tile the clip: each ends where the next begins, the
       first starts at the handle and the last ends at the handle;
     - striking each pad sends the engine a clip message for exactly its window;
     - Undo puts back what the pads held, including a pad that held nothing;
     - the last pad, a free build and a drum lane are all turned away without
       touching anything;
     - a real drum loop from the app's own library gives a plausible set of hits.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/slice/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/song/probe.js). */
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

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);
  // The splash is what makes an audio context: Start blank.
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(1200);

  // A clip with hits at known times: decaying noise bursts, some of them quiet.
  const HITS = [0.10, 0.40, 0.70, 1.00, 1.30, 1.60, 1.90, 2.20], AMP = [1, 0.5, 0.8, 0.4, 1, 0.6, 0.9, 0.5];
  const made = await page.evaluate(async ([hits, amp]) => {
    setModTier('pro');
    const ctx = getCtx(); await ctx.resume();
    const sr = ctx.sampleRate, n = Math.round(2.6 * sr), L = new Float32Array(n);
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    for (let i = 0; i < n; i++) L[i] = rnd() * 0.002;
    hits.forEach((t, h) => { const s0 = Math.round(t * sr); for (let i = 0; i < 0.25 * sr && s0 + i < n; i++) L[s0 + i] += rnd() * amp[h] * Math.exp(-i / (0.06 * sr)); });
    const buf = ctx.createBuffer(2, n, sr); buf.copyToChannel(L, 0); buf.copyToChannel(L, 1);
    const bytes = await _floatsToWavBlob(L, L, sr, null).arrayBuffer();
    const clip = smpAddClip({ name: 'Test loop', src: 'rec' }, buf, bytes, 'audio/wav');
    PS.bank = 0;
    window._clipId = clip.id; window._dur = n / sr;
    return { id: clip.id, dur: n / sr };
  }, [HITS, AMP]);

  const open = (k) => page.evaluate(([clip, key, start, end]) => {
    smpAttach(key, clip); const s = SMP_SLOTS[key]; if (start != null) { s.start = start; s.end = end; }
    smpOpenSlot(key);
    return { start: s.start, end: s.end };
  }, [made.id, k, null, null]);
  const win = await open('p:A:0');
  console.log('     window ' + win.start.toFixed(4) + ' - ' + win.end.toFixed(4) + ' of ' + made.dur.toFixed(2) + ' s');

  // ── 1. The hits.
  const before = await page.evaluate(() => { const o = {}; for (let i = 1; i < 16; i++) o[i] = SMP_SLOTS['p:A:' + i] ? SMP_SLOTS['p:A:' + i].id : null; return o; });
  const rowShown = await page.evaluate(() => document.getElementById('smp-slice-row').style.display);
  check(rowShown !== 'none', 'a pad shows the Slice row', rowShown);
  await page.evaluate(() => smpSliceToPads('auto'));
  const cuts = await page.evaluate(() => { const o = []; for (let i = 0; i < 16; i++) { const s = SMP_SLOTS['p:A:' + i]; if (s && s.label && /Test loop · /.test(s.label)) o.push({ i, id: s.id, a: s.start, b: s.end, label: s.label, mode: s.ps.mode, keyf: s.ps.keyf }); } return o; });
  const found = cuts.map(c => c.a * made.dur);
  console.log('     slice starts (s): ' + found.map(x => x.toFixed(3)).join(' '));
  check(cuts.length === 8, 'eight slices for eight hits', cuts.length);
  const wantStarts = [null].concat(HITS.slice(1));   // the first slice starts at the handle, the rest at the hits
  const errMs = found.slice(1).map((f, k) => Math.abs(f - HITS[k + 1]) * 1000);
  check(cuts.length === 8 && Math.max(...errMs) <= 8, 'each hit is found within 8 ms', errMs.map(e => e.toFixed(1)).join(' '));
  check(cuts.length && cuts[0].a === win.start, 'the first slice starts at the handle', cuts[0] && cuts[0].a);
  check(cuts.every((c, k) => k === 0 || Math.abs(c.a - cuts[k - 1].b) < 1e-9) && Math.abs(cuts[cuts.length - 1].b - win.end) < 1e-9, 'the pieces tile the window with no gap or overlap');
  check(cuts.every(c => c.id === made.id), 'every pad holds the same clip (nothing was copied)');
  check(cuts.every((c, k) => c.i === k && c.label === 'Test loop · ' + (k + 1)), 'on pads A1 to A8, labelled Test loop · 1 to 8', cuts.map(c => c.label).join(', '));
  check(cuts.every(c => c.mode === 'oneshot' && c.keyf === false), 'as one-shots that do not follow the key');

  // ── 2. Striking a pad plays exactly its window.
  const sent = await page.evaluate(() => {
    const msgs = []; const orig = window.modEngine.send;
    window.modEngine.send = function (m) { if (m && m.kind === 'clip') msgs.push({ asset: m.asset, from: m.from, to: m.to }); return orig.apply(this, arguments); };
    const ctx = getCtx();
    for (let k = 0; k < 8; k++) psStart('p:A:' + k, ctx.currentTime + 0.01);
    window.modEngine.send = orig;
    const slots = []; for (let k = 0; k < 8; k++) slots.push({ a: SMP_SLOTS['p:A:' + k].start, b: SMP_SLOTS['p:A:' + k].end });
    return { msgs, slots };
  });
  check(sent.msgs.length === 8 && sent.msgs.every((m, k) => Math.abs(m.from - sent.slots[k].a) < 1e-9 && Math.abs(m.to - sent.slots[k].b) < 1e-9), 'striking pads A1 to A8 sends each its own from/to', sent.msgs.length + ' messages');

  // ── 3. Equal parts, and what Undo puts back. Pad A3 held another clip; A5 held nothing.
  await page.evaluate(([clip]) => {
    for (let k = 0; k < 16; k++) delete SMP_SLOTS['p:A:' + k];
    smpAttach('p:A:2', clip); SMP_SLOTS['p:A:2'].label = 'Mine'; SMP_SLOTS['p:A:2'].gain = 0.5;
  }, [made.id]);
  await open('p:A:0');
  const win3 = await page.evaluate(() => ({ a: SMP_SLOTS['p:A:0'].start, b: SMP_SLOTS['p:A:0'].end }));
  await page.evaluate(() => smpSliceToPads(4));
  const four = await page.evaluate(() => [0, 1, 2, 3, 4].map(k => { const s = SMP_SLOTS['p:A:' + k]; return s && s.id ? { a: s.start, b: s.end, label: s.label } : null; }));
  const q = (win3.b - win3.a) / 4;
  check(four.slice(0, 4).every((s, k) => s && Math.abs(s.a - (win3.a + q * k)) < 1e-9 && Math.abs(s.b - (win3.a + q * (k + 1))) < 1e-9) && four[4] === null, 'four equal parts on four pads, and not a fifth');
  check(four[2] && four[2].label === 'Test loop · 3', 'A pad that held something is replaced', four[2] && four[2].label);
  await page.evaluate(() => { document.querySelector('#_toast ._toast-btn').click(); });
  const undone = await page.evaluate(() => ({ a2: SMP_SLOTS['p:A:2'] && SMP_SLOTS['p:A:2'].label, g: SMP_SLOTS['p:A:2'] && SMP_SLOTS['p:A:2'].gain, a1: SMP_SLOTS['p:A:1'], a3: SMP_SLOTS['p:A:3'] }));
  check(undone.a2 === 'Mine' && undone.g === 0.5, 'Undo puts back the pad that held something', JSON.stringify([undone.a2, undone.g]));
  check(!undone.a1 && !undone.a3, 'and empties the ones that were empty', JSON.stringify([!!undone.a1, !!undone.a3]));

  // ── 4. Turned away, nothing touched.
  await page.evaluate(() => { for (let k = 0; k < 16; k++) delete SMP_SLOTS['p:A:' + k]; });
  await open('p:A:15');
  const snap = () => page.evaluate(() => JSON.stringify(Object.keys(SMP_SLOTS).filter(k => k.indexOf('p:A:') === 0).sort()));
  const s0 = await snap();
  await page.evaluate(() => smpSliceToPads('auto'));
  check((await snap()) === s0, 'the last pad has no room: nothing changes');
  await open('p:A:0');
  await page.evaluate(() => { setModTier('free'); });
  const s1 = await snap();
  await page.evaluate(() => smpSliceToPads(4));
  check((await snap()) === s1, 'a free build is sent to the Sampler Engine and nothing changes');
  await page.evaluate(() => { setModTier('pro'); smpOpenSlot('d:LIN:0'); });
  const rowDrum = await page.evaluate(() => document.getElementById('smp-slice-row').style.display);
  check(rowDrum === 'none', 'a drum lane does not show the Slice row', rowDrum);
  const s2 = await snap();
  await page.evaluate(() => smpSliceToPads(4));
  check((await snap()) === s2, 'and asking anyway changes nothing');

  // ── 5. A clip with no hits in it: told so, not cut at random.
  const quiet = await page.evaluate(async () => {
    const ctx = getCtx(), sr = ctx.sampleRate, n = Math.round(2 * sr), L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sr);
    const buf = ctx.createBuffer(2, n, sr); buf.copyToChannel(L, 0); buf.copyToChannel(L, 1);
    const bytes = await _floatsToWavBlob(L, L, sr, null).arrayBuffer();
    const c = smpAddClip({ name: 'Drone', src: 'rec' }, buf, bytes, 'audio/wav');
    smpAttach('p:B:0', c.id); SMP_SLOTS['p:B:0'].start = 0; SMP_SLOTS['p:B:0'].end = 1;
    smpOpenSlot('p:B:0');
    smpSliceToPads('auto');
    return Object.keys(SMP_SLOTS).filter(k => k.indexOf('p:B:') === 0 && SMP_SLOTS[k].id).length;
  });
  check(quiet === 1, 'a steady tone has no hits: still one pad, no slicing', quiet);

  // ── 6. A real drum loop from the app's own library.
  const real = await page.evaluate(async () => {
    const ctx = getCtx();
    const bytes = await (await fetch('samples/loops/world/drumset.mp3')).arrayBuffer();
    const buf = await ctx.decodeAudioData(bytes);
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const wav = await _floatsToWavBlob(L, R, buf.sampleRate, null).arrayBuffer();
    const c = smpAddClip({ name: 'Drumset', src: 'rec' }, buf, wav, 'audio/wav');
    smpAttach('p:C:0', c.id); SMP_SLOTS['p:C:0'].start = 0; SMP_SLOTS['p:C:0'].end = 1;
    const hits = smpFindOnsets(c.id, 0, 1, 15);
    return { dur: buf.duration, hits: hits.map(h => +(h * buf.duration).toFixed(3)) };
  });
  console.log('     drumset.mp3 (' + real.dur.toFixed(2) + ' s): hits at ' + real.hits.join(' '));
  check(real.hits.length >= 4 && real.hits.length <= 15, 'a real drum loop gives a plausible number of hits', real.hits.length);
  check(real.hits.every((h, k) => k === 0 || h - real.hits[k - 1] >= 0.04), 'none closer than 40 ms');
  // The loop is two bars of sixteenths, so a real hit sits on a multiple of dur/32.
  const grid = real.dur / 32, off = real.hits.map(h => Math.abs(h / grid - Math.round(h / grid)) * grid * 1000);
  console.log('     distance from the sixteenth-note grid (ms): ' + off.map(o => o.toFixed(0)).join(' '));
  check(off.filter(o => o <= 12).length >= real.hits.length - 1, 'and the hits it finds sit on the loop\'s sixteenth-note grid (within 12 ms)', off.filter(o => o > 12).length + ' off');

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
