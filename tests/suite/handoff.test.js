/* The mõd suite handoff (v2.0g): "Open in mõdScore" sends the chart's chords to mõdScore in
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

   Run (repo or dist/ served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/suite/handoff.test.js
   Env: URL, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
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

  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
