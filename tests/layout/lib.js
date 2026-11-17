/* Shared helpers for the layout tests (tests/layout/*).

   Self-contained: serves the repo from a random local port (so it never collides with a server somebody else left on
   8777, which may be serving another checkout) and drives the installed Chrome through playwright-core.
   Env: CHROMIUM = path to a Chromium/Chrome binary (default: the installed Chrome channel), URL = a page to test instead
   of serving the repo. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright')); }

const ROOT = path.join(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/index.html' }));
  });
}

/* The phones and the other shapes the layout has to hold: width x height in CSS points. */
const VIEWPORTS = {
  se375: { width: 375, height: 667 }, p390: { width: 390, height: 844 }, p430: { width: 430, height: 932 },
  ipad820: { width: 820, height: 1180 }, duoOpen: { width: 951, height: 669 }, duoClosed: { width: 466, height: 678 },
};

async function start(opts) {
  opts = opts || {};
  const s = process.env.URL ? { srv: null, url: process.env.URL } : await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const close = async () => { await browser.close(); if (s.srv) s.srv.close(); };
  return { browser, url: s.url, close };
}

/* A fresh page at a viewport, booted past the unlock screen, everything unlocked (the packs do not change where a control
   sits; a locked control is still drawn), in Studio or Live. */
async function boot(h, vp, view) {
  const v = typeof vp === 'string' ? VIEWPORTS[vp] : vp;
  const ctx = await h.browser.newContext({ viewport: v, hasTouch: true, isMobile: v.width < 700 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(h.url); await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(h.url); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(700);
  await page.evaluate(v2 => { setModTier('pro'); setViewMode(v2 === 'live' ? 'basic' : 'advanced'); switchTab('perform'); }, view || 'studio');
  await page.waitForTimeout(500);
  return { page, ctx, errs };
}

/* The pages of Studio, by the name the owner sees. `go` uses the strip when it exists and the older part-switch route when
   it does not, so the same tests ran before and after slice 1. */
const STUDIO = ['Drums', 'Bass', 'Melody', 'Mel Seq', 'Arp', 'Chords', 'Sampler', 'mõdFX'];
async function goStudio(page, name) {
  await page.evaluate(n => {
    var strip = document.getElementById('studio-strip');
    if (strip) { var b = [].slice.call(strip.querySelectorAll('[data-page]')).filter(function (e) { return e.dataset.page === n; })[0]; if (b) { b.click(); return; } }
    if (typeof setViewMode === 'function' && document.body.classList.contains('mode-basic')) setViewMode('advanced');
    var m = { 'Drums': ['accomp', 'drums'], 'Bass': ['accomp', 'bass'], 'Mel Seq': ['accomp', 'melody'], 'Arp': ['accomp', 'arp'],
      'Chords': ['perform', 'chords'], 'Melody': ['perform', 'melody'], 'Sampler': ['perform', 'pads'], 'mõdFX': ['perform', 'fx'] }[n];
    switchTab(m[0]); if (m[0] === 'accomp') setAccompMode(m[1]); else setPerformMode(m[1]);
  }, name);
  await page.waitForTimeout(450);
}

/* Every visible interactive element on the page that is showing, with its box and a stable key. A control with an id is its
   id; one without is "tag.firstclass|label" (the label is its aria-label, title or text, trimmed). */
const SCAN = () => {
  const out = [];
  const pg = document.querySelector('.tab-page.active'); if (!pg) return out;
  const vis = e => {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let p = e; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') return false; }
    return true;
  };
  pg.querySelectorAll('button,input,select,textarea,[role=button],[role=slider],[role=tab],canvas[role],.tb,[onclick]').forEach(e => {
    if (!vis(e) || e.closest('.sheetbg,[hidden]')) return;
    const r = e.getBoundingClientRect();
    const label = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const cls = (typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '') || '';
    // A sampler pad's label carries the sample's name, which arrives when the kit has loaded: its key is the pad's number only.
    const kl = cls === 'ps-pad' ? label.split(' — ')[0] : label;
    out.push({ key: e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + cls + '|' + kl, id: e.id || '', label,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, top: Math.round(r.top + scrollY), tag: e.tagName.toLowerCase() });
  });
  return out;
};

/* The measure that answers "no control under 44 pt": a control is small if either side is under 44 (a hair of tolerance for
   rounding). The known exceptions are the steppers the app has always had; they are listed, not hidden. */
const MIN = 43.5;
const KNOWN_SMALL = [/^\.?st-v?step/, /^button\.st-v?step/];
function isSmall(c) { return (c.w < MIN || c.h < MIN); }

/* The height of the page that is showing: the bottom of its lowest visible child, in page points. */
const PAGE_BOTTOM = () => {
  const pg = document.querySelector('.tab-page.active'); let b = 0;
  [].slice.call(pg.children).forEach(k => {
    const r = k.getBoundingClientRect(), c = getComputedStyle(k);
    if (r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden') b = Math.max(b, r.bottom + scrollY);
  });
  return Math.round(b);
};

function reporter() {
  let fails = 0;
  const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };
  return { check, done: () => { console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0); }, get fails() { return fails; } };
}

module.exports = { start, boot, goStudio, STUDIO, SCAN, PAGE_BOTTOM, VIEWPORTS, isSmall, KNOWN_SMALL, reporter, ROOT };
