/* The free web build (npm run build:web, served at modriff.com/play), measured.

   What it proves, on the real built page rather than on the source:
     - the build leaves out samples/ entirely, puts the app under /play/, gives the
       manifest an id of its own, and carries nothing from Vercel (the site is GitHub Pages);
     - the page holds NO pack, and nothing a visitor can do (a console call, a
       leftover modo-dev-tier key) changes that;
     - across Start, Random, every tab and four seconds of playback, not one request
       goes to samples/, and the page throws nothing;
     - it still makes sound (a tap on everything that reaches the speakers);
     - a locked thing opens the sheet that points at the app, with no price and no
       way to buy, and the Sampler is a lock tile, not pads that play nothing.

   Run (the page is served from dist-web/, or from the root of a modriff-site checkout that
   has play/ in it, so URL = http://127.0.0.1:8778/play/ either way):
     npm run build:web
     (cd dist-web && python3 -m http.server 8778 --bind 127.0.0.1 &)
     node tests/webplay/probe.js
   Env: URL (default http://127.0.0.1:8778/play/), CHROMIUM, PLAYWRIGHT. */
'use strict';
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8778/play/';
const DIST = path.join(__dirname, '../../dist-web');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

// ── The built files
check(!fs.existsSync(path.join(DIST, 'play/samples')), 'no samples/ folder in the build');
check(fs.existsSync(path.join(DIST, 'play/index.html')) && fs.existsSync(path.join(DIST, 'play/sw.js')), 'the app and its service worker are under /play/');
const man = JSON.parse(fs.readFileSync(path.join(DIST, 'play/manifest.webmanifest'), 'utf8'));
check(man.id === '/play/' && man.start_url === './' && man.scope === './', 'the manifest has its own id and stays relative', JSON.stringify([man.id, man.start_url, man.scope]));
const html = fs.readFileSync(path.join(DIST, 'play/index.html'), 'utf8');
check(html.indexOf('window.__modFreeWeb=true') > 0 && html.indexOf('window.__modFreeWeb=true') < html.indexOf('MODRIFF_VERSION'), 'the free flag is set before the app script');
check((html.match(/content="\/play\/og-card-3\.png"/g) || []).length === 2 && !/content="\/og-card-3\.png"/.test(html), 'the share card points at /play/');
check(!fs.existsSync(path.join(DIST, 'index.html')), 'nothing at dist-web/ but play/ (the site owns the root)');
check(!/_vercel|window\.va\b|window\.si\b/.test(html), 'no Vercel analytics or reference in the web page');
const appBuild = fs.existsSync(path.join(__dirname, '../../dist/index.html')) ? fs.readFileSync(path.join(__dirname, '../../dist/index.html'), 'utf8') : null;
if (appBuild) check(appBuild.indexOf('window.__modFreeWeb=true') < 0, 'the app build (dist/) is not flagged');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
    // A tap on everything that reaches the speakers, so "it makes sound" is a number.
    await ctx.addInitScript(() => {
      window.__peak = 0;
      const c = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (t) {
        try {
          if (t instanceof AudioDestinationNode && !this.__tapped) {
            this.__tapped = true;
            const an = this.context.createAnalyser(); an.fftSize = 1024; c.call(this, an);
            const buf = new Float32Array(1024);
            setInterval(() => { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) window.__peak = Math.max(window.__peak, Math.abs(buf[i])); }, 40);
          }
        } catch (e) {}
        return c.apply(this, arguments);
      };
    });
    const page = await ctx.newPage();
    const st = { samples: new Set(), errs: [] };
    page.on('request', r => { if (/\/samples\//.test(r.url())) st.samples.add(r.url().replace(/.*\/play\//, '')); });
    page.on('pageerror', e => st.errs.push(String(e).slice(0, 200)));
    return { page, st, ctx };
  };

  for (const mode of ['blank', 'roll']) {
    const { page, st, ctx } = await newPage();
    await page.goto(URL); await page.waitForTimeout(1200);
    await page.click(`button[onclick="unlockAudio('${mode}')"]`); await page.waitForTimeout(2200);
    const held = await page.evaluate(() => {
      const voices = [wave, window._blCaptureState().wave, arpWave, melWave];
      return { provider: modBilling.provider, held: MODULE_ORDER.filter(modHas).length, full: _modFull, voices,
        // voiceModule is null only for a voice that is neither recorded nor a pack's.
        recorded: voices.filter(w => voiceModule(w) !== null), kit: window._sqDrumKit(), kitOk: freeAllowsKit(window._sqDrumKit()) };
    });
    check(held.provider === 'web' && held.held === 0 && !held.full, mode + ': holds no pack', JSON.stringify([held.provider, held.held, held.full]));
    check(held.recorded.length === 0 && held.kitOk, mode + ': every voice is synthesized and the kit is a free one', JSON.stringify([held.voices, held.kit]));
    for (const t of ['tab-live', 'tab-studio', 'tab-songs', 'tab-mix', 'tab-live']) { await page.click('#' + t).catch(() => {}); await page.waitForTimeout(400); }
    await page.evaluate(() => { window.__peak = 0; if (!isAnythingPlaying()) ftPlayStop(); });
    await page.waitForTimeout(4000);
    const play = await page.evaluate(() => ({ playing: isAnythingPlaying(), peak: window.__peak }));
    // Start is an empty page, so it runs and is silent; Random has a band.
    check(play.playing && (mode === 'blank' || play.peak > 0.02), mode + ': it plays' + (mode === 'roll' ? ' and the speakers get signal' : ''), JSON.stringify(play));
    if (mode === 'roll') {
      // Twenty more rolls: a pick that landed on a recorded voice or a locked kit would show as a request or a voice id.
      let bad = [];
      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => startDemoJourney(false)); await page.waitForTimeout(500);
        const v = await page.evaluate(() => [wave, window._blCaptureState().wave, arpWave, melWave].filter(w => voiceModule(w) !== null).concat(freeAllowsKit(window._sqDrumKit()) ? [] : ['kit:' + window._sqDrumKit()]));
        bad = bad.concat(v);
      }
      check(bad.length === 0, 'roll x20: every pick is a free synthesized voice and a free kit', bad.join(','));
    }
    await page.evaluate(() => { if (isAnythingPlaying()) ftPlayStop(); });
    check(st.samples.size === 0, mode + ': not one request to samples/', [...st.samples].slice(0, 3).join(' '));
    check(st.errs.length === 0, mode + ': nothing thrown', st.errs.join(' | '));
    await ctx.close();
  }

  // ── Nothing a visitor does unlocks it
  {
    const { page, st, ctx } = await newPage();
    await page.goto(URL);
    await page.evaluate(() => { localStorage.setItem('modo-dev-tier', 'pro'); });
    await page.reload(); await page.waitForTimeout(1500);
    await page.evaluate(() => { try { setModOwned(['fullstudio']); } catch (e) {} setModTier('pro'); });
    const r = await page.evaluate(() => ({ held: MODULE_ORDER.filter(modHas).length, owned: modBilling.owned().length, bought: null }));
    const bought = await page.evaluate(() => modBilling.purchase('fullstudio'));
    check(r.held === 0 && r.owned === 0 && bought === false, 'a stored dev key, setModOwned and a purchase call change nothing', JSON.stringify([r, bought]));

    // ── A locked thing points at the app
    await page.evaluate(() => { freeBlocked('Custom samples', 'sampler'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => proSheet('Custom samples', 'sampler'));
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => {
      const s = document.getElementById('_pro-sheet'); if (!s) return null;
      const a = s.querySelector('a[data-web-store]');
      return { text: s.textContent, href: a && a.href, buyButtons: s.querySelectorAll('.pro-buy:not(a)').length, price: /[$€£]\s?\d/.test(s.textContent), restore: /Restore/.test(s.textContent) };
    });
    check(sheet && sheet.href && /^https:\/\/(apps\.apple\.com|modriff\.com)/.test(sheet.href), 'the sheet links to the app', sheet && sheet.href);
    check(sheet && sheet.buyButtons === 0 && !sheet.price && !sheet.restore, 'the sheet has no buy button, no price and no Restore', JSON.stringify(sheet && [sheet.buyButtons, sheet.price, sheet.restore]));
    check(sheet && /Sampler Engine/.test(sheet.text) && /free to download/.test(sheet.text), 'it names the pack and says the app is free to download');
    await page.evaluate(() => document.getElementById('_pro-sheet').remove());

    // ── The Sampler is a lock tile, and the sub-nav entry is gone
    await page.click('button[onclick="unlockAudio(\'blank\')"]').catch(() => {}); await page.waitForTimeout(1500);
    const pads = await page.evaluate(() => ({
      tile: !!document.querySelector('.lv-locked[data-mod="pads"]'),
      navHidden: getComputedStyle(document.getElementById('pf-pads-btn')).display === 'none',
      allowed: lvAllowed('pads') }));
    check(!pads.allowed && pads.navHidden, 'the Sampler widget is not allowed and its sub-nav button is hidden', JSON.stringify(pads));
    check(st.samples.size === 0, 'opening the sheets asked for no samples', [...st.samples].slice(0, 3).join(' '));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
