/* Studio on a wide window (docs/superpowers/specs/2026-11-20-studio-wide-layout-design.md): on the Mac app and the desktop web
   page the roll or grid is on top and the rest is in two columns, with no tabs. A phone keeps its single column and its tabs.

   Run (repo served; CLAUDE.md):  python3 -m http.server 8777 --bind 127.0.0.1 &  node tests/studio-wide/wide.test.js
   Env: URL, CHROME (default macOS Chrome), ONLY (a comma list of: bass, aux, arp, header, phone) */
'use strict';
const { chromium } = require('playwright-core');
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };
const want = k => !ONLY || ONLY.includes(k);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async (w, h, touch) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!touch, isMobile: !!touch });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(1200);
    try { await page.click('.unlock-btn >> text=Start', { timeout: 3000 }); } catch (e) {}
    await page.waitForTimeout(1200);
    await page.evaluate(() => { try { switchTab('studio'); } catch (e) {} });
    return { page, errs };
  };
  // [left, top, right, bottom] of the first visible match, or null.
  const box = (page, sel) => page.evaluate(s => { const e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }, sel);
  const show = (page, k) => page.evaluate(async k => { studioShow(k); await new Promise(r => setTimeout(r, 700)); }, k);

  if (want('bass')) {
    const { page, errs } = await open(1500, 900);
    for (const [k, host, roll] of [['bass', '#bm-bass-panel .bl-page-wrap', '#st-card-bass-roll'], ['melseq', '#bm-melody-panel .bl-page-wrap', '#st-card-melgen-roll']]) {
      await show(page, k);
      const r = await box(page, roll), tone = await box(page, host + ' > [data-acrow=tone]'), tim = await box(page, host + ' > [data-acrow=timing]');
      check(r && tone && tim, k + ': roll, Sound and Timing are all showing at once', JSON.stringify({ r: !!r, tone: !!tone, tim: !!tim }));
      if (r && tone && tim) {
        check(r[3] <= Math.min(tone[1], tim[1]) + 1, k + ': the roll is above Sound and Timing', JSON.stringify({ rollBottom: r[3], tone: tone[1], tim: tim[1] }));
        check(tim[0] >= tone[2] - 1 || tone[0] >= tim[2] - 1, k + ': Sound and Timing are side by side', JSON.stringify({ tone, tim }));
      }
    }
    check(errs.length === 0, 'bass/melody: the page threw nothing', errs.join(' | '));
    await page.context().close();
  }

  if (want('arp')) {
    const { page, errs } = await open(1500, 900);
    for (const [k, host, flow] of [['arp', '#bm-arp-panel', '#arp-strip-body'], ['smp', '#pf-pads-panel', '#ps-panel'], ['fx', '#pf-fx-panel', '#modfx-panel']]) {
      await show(page, k);
      const r = await page.evaluate(([host, flow]) => {
        const f = document.querySelector(flow), cs = getComputedStyle(f);
        // every card header must sit with its own body: same column (same left) and the body right under it.
        const pairs = [...f.children].filter(c => c.classList.contains('st-fold-h') && c.getClientRects().length).map(h => {
          const b = h.nextElementSibling; if (!b || !b.getClientRects().length) return { ok: true };
          const hr = h.getBoundingClientRect(), br = b.getBoundingClientRect();
          return { ok: Math.abs(hr.left - br.left) < 4 && br.top - hr.bottom < 40 && br.top >= hr.bottom - 2, id: b.id || b.className };
        });
        const w = document.querySelector(host).getBoundingClientRect().width;
        return { cols: cs.columnCount, bad: pairs.filter(x => !x.ok).map(x => x.id), pairs: pairs.length, w: Math.round(w), pageH: document.querySelector('.tab-page.active').scrollHeight };
      }, [host, flow]);
      check(r.cols === '2', k + ': its cards flow in two columns', JSON.stringify(r));
      check(r.bad.length === 0, k + ': no card header is parted from its body by a column', r.bad.join(','));
      check(r.w >= 1000, k + ': the page is as wide as the window allows', r.w);
      check(r.pageH < 1500, k + ': it is shorter than the long single column it replaces (arp 1520, sampler 1817, mõdFX 1332 before)', r.pageH);
    }
    check(errs.length === 0, 'arp/sampler/modfx: the page threw nothing', errs.join(' | '));
    await page.context().close();
  }

  if (want('aux')) {
    const { page, errs } = await open(1500, 900);
    for (const k of ['drums', 'aux']) {
      await show(page, k);
      const grid = await box(page, '#st-card-drums-grid'), tim = await box(page, '#st-card-drums-time'), pat = await box(page, '#st-card-drums-patterns');
      check(grid && tim && pat, k + ': the grid, Timing and Patterns are showing', JSON.stringify({ grid: !!grid, tim: !!tim, pat: !!pat }));
      if (grid && tim && pat) {
        check(grid[3] <= Math.min(tim[1], pat[1]) + 1, k + ': the grid is above Timing and Patterns', JSON.stringify({ gridBottom: grid[3], tim: tim[1], pat: pat[1] }));
        check(tim[0] >= pat[2] - 1 || pat[0] >= tim[2] - 1, k + ': Timing and Patterns are in two columns', JSON.stringify({ tim, pat }));
      }
      const h = await page.evaluate(() => document.querySelector('.tab-page.active').scrollHeight);
      check(h < 1250, k + ': shorter than the single column it replaces (1349 before)', h);
    }
    check(errs.length === 0, 'drums/aux: the page threw nothing', errs.join(' | '));
    await page.context().close();
  }

  if (want('header')) {
    const { page, errs } = await open(1500, 900);
    await show(page, 'bass');
    const r = await page.evaluate(() => { const g = getComputedStyle(document.getElementById('ss-pick')), c = document.getElementById('ss-cur'); return { tracks: g.gridTemplateColumns.split(' ').length, curShown: !!c.getClientRects().length }; });
    check(r.tracks === 9 && !r.curShown, "header: the web page shows the Mac's row of nine module chips, not the picker button", JSON.stringify(r));
    await page.context().close();
    const n = await open(700, 800);
    await show(n.page, 'bass');
    const q = await n.page.evaluate(() => ({ curShown: !!document.getElementById('ss-cur').getClientRects().length }));
    check(q.curShown, "header: a 700 px browser window keeps the phone's picker button", JSON.stringify(q));
    await n.page.context().close();
    check(errs.length === 0, 'header: the page threw nothing', errs.join(' | '));
  }
  if (want('phone')) {
    const { page } = await open(390, 844, true);
    await show(page, 'bass');
    check(await box(page, '#bm-bass-panel .bl-page-wrap > [data-acrow=timing]') === null, 'phone: Timing is still behind its tab on the Pattern page');
    await page.context().close();
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
