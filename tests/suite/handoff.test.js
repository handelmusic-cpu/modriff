/* The mõd suite handoff (v2.0g, v2.0h, v2.3): "Open in mõdScore" sends the chart's chords to mõdScore in
   the link fragment (modriff.com/score/#mod=1&kind=midi&data=…, format in
   modriff-site/suite/mod-suite.js), and the chart's .mid carries a key signature so notation
   spells the chords in the song's key.

   keysig   _midiKeySig for the major/minor keys and a spread of modes, against what a
            musician would write (D Dorian: no sharps or flats; E Hijaz: like A minor; C whole
            tone: C's own, not five flats).
   link     the URL openChartInScore opens: https://modriff.com/score/ with a #mod=1 fragment
            whose data decodes to exactly the bytes the .mid download saves, which include
            the FF 59 key signature event; it opens in a new tab.
   cap      free sends the same capped chart the free .mid has; the Studio Pack the whole song.
   bounce   a real Bounce (ring, play, ring): the finished toast offers Open in mõdScore, and
            tapping it opens modriff.com/score/ with the take moved to start on a bar line, every
            drum hit on a sixteenth; the .mid that is saved is still the take as recorded.
   incoming modriff.com/play/#mod=1&kind=midi&from=score…: the splash offers Open, and Open
            puts the notes in the melody roll on the right steps, Follow off, at the sender's
            tempo (onBpmInput used to be called with no value there, which reset it to 130).

   Run (repo or dist/ served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/suite/handoff.test.js            # all
     node tests/suite/handoff.test.js bounce     # some
   Env: URL, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const WHICH = (process.argv[2] || 'keysig,link,cap,bounce,incoming').split(',');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

async function page(browser, tier) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((tier) => {
    // A fixed opening song: seedOpeningProgression picks its key and chords with Math.random.
    let s = 42; Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    try { if (tier) localStorage.setItem('modo-dev-tier', tier); } catch (e) {}
  }, tier);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  return { p, ctx, errs };
}

// Captures what the .mid download saves and what the handoff opens, for the current chart.
const CAPTURE = async () => {
  let saved = null, opened = null;
  modPlatform.saveFile = (n, blob) => { saved = blob; };
  window._exportName = () => Promise.resolve('x');
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { opened = { href: this.href, target: this.target, rel: this.rel }; };
  exportMidi(); openChartInScore();
  HTMLAnchorElement.prototype.click = click;
  await new Promise((r) => setTimeout(r, 400));
  const file = Array.from(new Uint8Array(await saved.arrayBuffer()));
  const u = new window.URL(opened.href);
  const q = new URLSearchParams(u.hash.slice(1));
  const b = atob(q.get('data').replace(/-/g, '+').replace(/_/g, '/'));
  const sent = Array.from(b, (c) => c.charCodeAt(0));
  return { file, sent, base: u.origin + u.pathname, mod: q.get('mod'), kind: q.get('kind'), from: q.get('from'),
           title: q.get('title'), target: opened.target, rel: opened.rel, ks: _midiKeySig(), root, mode };
};

(async () => {
  const browser = await chromium.launch();

  if (WHICH.includes('keysig'))
  // ---- keysig
  {
    const { p, ctx, errs } = await page(browser, 'pro');
    const want = [[0, 'major', 0, 0], [9, 'minor', 0, 1], [2, 'dorian', 0, 0], [4, 'minor', 1, 1], [8, 'major', -4, 0],
                  [3, 'minor', -6, 1], [10, 'major', -2, 0], [7, 'mixolydian', 0, 0], [5, 'lydian', 0, 0],
                  [9, 'harmonic_minor', 0, 1], [9, 'minor_pent', 0, 1], [0, 'major_pent', 0, 0], [4, 'hijaz', 0, 0],
                  [0, 'whole_tone', 0, 0]];
    const got = await p.evaluate((want) => want.map(([r, m]) => { root = r; mode = m; const k = _midiKeySig(); return [k.sf, k.mi]; }), want);
    want.forEach(([r, m, sf, mi], i) => check(got[i][0] === sf && got[i][1] === mi, `keysig ${r} ${m}`, `sf ${got[i][0]} mi ${got[i][1]}, want ${sf} ${mi}`));
    check(errs.length === 0, 'keysig: no page errors', errs.join('; '));
    await ctx.close();
  }

  if (WHICH.includes('link'))
  // ---- link (Studio Pack: whole song)
    {
    const { p, ctx, errs } = await page(browser, 'pro');
    const r = await p.evaluate(async (CAP) => { seedOpeningProgression(); return await (eval('(' + CAP + ')'))(); }, CAPTURE.toString());
    check(r.base === 'https://modriff.com/score/', 'link: opens modriff.com/score/', r.base);
    check(r.mod === '1' && r.kind === 'midi' && r.from === 'play', 'link: mod=1, kind=midi, from=play', `${r.mod} ${r.kind} ${r.from}`);
    check(!!r.title && r.title === (r.title || '').trim(), 'link: carries the chart title', r.title);
    check(r.target === '_blank' && /noopener/.test(r.rel), 'link: new tab, noopener', `${r.target} ${r.rel}`);
    check(JSON.stringify(r.sent) === JSON.stringify(r.file), 'link: data is exactly the .mid the download saves', `${r.sent.length} vs ${r.file.length} bytes`);
    const at = r.file.findIndex((b, i) => b === 0xff && r.file[i + 1] === 0x59 && r.file[i + 2] === 2);
    const sf = at < 0 ? null : (r.file[at + 3] << 24 >> 24);
    check(at > 0 && sf === r.ks.sf && r.file[at + 4] === r.ks.mi, 'link: .mid has the key signature', `root ${r.root} ${r.mode}: sf ${sf} mi ${at < 0 ? '-' : r.file[at + 4]}`);
    check(errs.length === 0, 'link: no page errors', errs.join('; '));
    await ctx.close();
  }

  if (WHICH.includes('cap'))
  // ---- cap (free): the same long chart, uncapped and then with the full export not owned
  {
    const { p, ctx, errs } = await page(browser, 'pro');
    const r = await p.evaluate(async (CAP) => {
      seedOpeningProgression();
      // Long enough that the free cap must cut it.
      sections.forEach((s) => { s.slots = s.slots.concat(s.slots, s.slots, s.slots); });
      const cap = eval('(' + CAP + ')');
      const whole = await cap();
      const own = window.modAllows;
      window.modAllows = (f) => f !== 'fullMidiExport' && own(f);
      const free = await cap();
      window.modAllows = own;
      return { whole: whole.file.length, free: free.file.length, same: JSON.stringify(free.sent) === JSON.stringify(free.file) };
    }, CAPTURE.toString());
    check(r.same, 'cap: free link sends the same capped .mid the download saves', `${r.free} bytes`);
    check(r.free < r.whole, 'cap: free is cut, the Studio Pack sends the whole song', `${r.free} < ${r.whole} bytes`);
    check(errs.length === 0, 'cap: no page errors', errs.join('; '));
    await ctx.close();
  }

  // ---- bounce: the real recorder, then the toast's action
  if (WHICH.includes('bounce')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForTimeout(1500);
    await p.click('.unlock-btn >> text=Random'); await p.waitForTimeout(2000);
    await p.evaluate(() => {
      setModTier('pro'); switchTab('perform');
      window._deliverFiles = async function (list) { (list || []).forEach((f) => { if (/\.mid$/.test(f.name)) f.blob.arrayBuffer().then((b) => { window.__savedTake = Array.from(new Uint8Array(b)); }); }); };
      const mt = majorToast; window.__toasts = [];
      majorToast = function (msg, opts) { window.__toasts.push({ msg, opts }); return mt(msg, opts); };
    });
    await p.click('#ft-rec-ring'); await p.waitForTimeout(300);
    await p.evaluate(() => ftPlayStop()); await p.waitForTimeout(4000);
    await p.evaluate(() => ftPlayStop()); await p.click('#ft-rec-ring');
    // "Recording…" is a major toast too: wait for the one that says the take is written.
    await p.waitForFunction(() => window.__toasts.some((t) => /^(Mix|Saved to)/.test(t.msg)), null, { timeout: 30000 }).catch(() => {});
    // The toast comes just before the files are handed over; wait for the saved .mid too.
    await p.waitForFunction(() => !!window.__savedTake, null, { timeout: 10000 }).catch(() => {});
    const r = await p.evaluate(async () => {
      const t = window.__toasts.filter((x) => /^(Mix|Saved to)/.test(x.msg)).pop();
      if (!t || !t.opts || !t.opts.onAction) return { label: t && t.opts && t.opts.actionLabel, msg: t && t.msg };
      let opened = null; const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { opened = { href: this.href, target: this.target }; };
      t.opts.onAction(); HTMLAnchorElement.prototype.click = click;
      const u = new window.URL(opened.href), q = new URLSearchParams(u.hash.slice(1));
      const b = atob(q.get('data').replace(/-/g, '+').replace(/_/g, '/'));
      const sent = Array.from(b, (c) => c.charCodeAt(0));
      const shift = _recBarShiftMs();
      const aligned = _buildMidiRecording({ shiftMs: shift }), saved = _buildMidiRecording();
      // Every drum hit's tick in what was sent (a sixteenth is 120 ticks at 480 a quarter).
      const ticks = []; let pos = 14;
      while (pos < sent.length - 8) {
        if (String.fromCharCode(...sent.slice(pos, pos + 4)) !== 'MTrk') break;
        const len = (sent[pos + 4] << 24) | (sent[pos + 5] << 16) | (sent[pos + 6] << 8) | sent[pos + 7];
        let p = pos + 8, end = p + len, tick = 0, run = 0;
        while (p < end) {
          let d = 0, b; do { b = sent[p++]; d = (d << 7) | (b & 127); } while (b & 128); tick += d;
          let st = sent[p]; if (st & 128) { p++; if (st < 0xf0) run = st; } else st = run;
          if (st === 0xff) { p++; let l = 0; do { b = sent[p++]; l = (l << 7) | (b & 127); } while (b & 128); p += l; continue; }
          const hi = st & 0xf0; if (hi === 0xc0 || hi === 0xd0) { p += 1; continue; }
          const v1 = sent[p++], v2 = sent[p++]; if (hi === 0x90 && v2 > 0 && (st & 15) === 9) ticks.push(tick);
        }
        pos = end;
      }
      const off = ticks.map((t) => Math.min(t % 120, 120 - (t % 120)));
      return { label: t.opts.actionLabel, msg: t.msg, base: u.origin + u.pathname, target: opened.target, kind: q.get('kind'),
               sentLen: sent.length, shift: Math.round(shift),
               same: !!aligned && JSON.stringify(sent) === JSON.stringify(Array.from(aligned.bytes)),
               savedUnshifted: !!saved && JSON.stringify(Array.from(saved.bytes)) === JSON.stringify(Array.from(window.__savedTake || [])),
               drumHits: ticks.length, worstOff: off.length ? Math.max(...off) : null,
               tracks: sent.length > 12 ? (sent[10] << 8 | sent[11]) : 0 };
    });
    check(r.label === 'Open in mõdScore', 'bounce: the finished toast offers Open in mõdScore', r.msg);
    check(r.base === 'https://modriff.com/score/' && r.target === '_blank' && r.kind === 'midi', 'bounce: it opens modriff.com/score/ in a new tab with MIDI', `${r.base} ${r.target} ${r.kind}`);
    check(r.same && r.tracks >= 2, 'bounce: it sends the take, moved to start on a bar line', `${r.sentLen} bytes, ${r.tracks} tracks, shifted ${r.shift} ms`);
    check(r.drumHits > 0 && r.worstOff <= 10, 'bounce: every drum hit lands on a sixteenth in what is sent', `${r.drumHits} hits, worst ${r.worstOff} ticks off`);
    check(r.savedUnshifted, 'bounce: the .mid that is saved is the take as recorded, not shifted');
    check(errs.length === 0, 'bounce: no page errors', errs.join('; '));
    await ctx.close();
  }

  // ---- incoming: a part from mõdScore lands in the melody roll
  if (WHICH.includes('incoming')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(1500);
    // C D E G A G E C in eighths at 96 bpm, as a one-track file (what mõdScore sends for a part).
    const hash = await p.evaluate(() => {
      const notes = [60, 62, 64, 67, 69, 67, 64, 60], ev = [];
      const vlq = (n) => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
      const trk = [0, 0xff, 0x51, 3, 0x09, 0x89, 0x68];             // 625000 us = 96 bpm
      notes.forEach((m) => { trk.push(0, 0x90, m, 90); trk.push(...vlq(240), 0x80, m, 0); });
      trk.push(0, 0xff, 0x2f, 0);
      const L = trk.length;
      const u8 = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, (L >> 8) & 255, L & 255].concat(trk);
      const data = btoa(String.fromCharCode.apply(null, u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return 'mod=1&kind=midi&from=score&title=' + encodeURIComponent('Tune: Treble') + '&data=' + data;
    });
    // A fresh tab, as the sender opens one: changing only the fragment of an open page does not reload it.
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(URL.replace(/#.*/, '') + '#' + hash); await p2.waitForTimeout(3000);
    const note = await p2.evaluate(() => document.body.innerText.includes('mõdScore sent “Tune: Treble”'));
    check(note, 'incoming: the splash says what mõdScore sent');
    await p2.locator('[aria-label^="Open “"]').first().click(); await p.waitForTimeout(2500);
    const r = await p2.evaluate(() => {
      const st = window._mlCaptureState();
      return { on: st.grid.map((c, i) => c.v ? i + ':' + (c.oct * 12 + 12 + c.note) + 'x' + c.len : null).filter(Boolean).join(' '),
               follow: st.follow, bpm: document.getElementById('bpm').value, hash: location.hash,
               toast: document.body.innerText.includes('is in the melody roll') };
    });
    check(r.on === '0:60x2 2:62x2 4:64x2 6:67x2 8:69x2 10:67x2 12:64x2 14:60x2', 'incoming: eight eighth notes on their steps', r.on);
    check(r.follow === false, 'incoming: Follow is off, so it plays as written');
    check(r.bpm === '96', "incoming: the sender's tempo", r.bpm);
    check(r.toast && r.hash === '', 'incoming: says where it went, and the link is cleared', r.hash);
    check(errs.length === 0, 'incoming: no page errors', errs.join('; '));
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
