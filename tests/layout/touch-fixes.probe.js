/* Regressions for the undersized Bounce, Undo and chord-fold controls.
   Measure their boxes and tap near their edges through CDP: a declared size alone does not prove it is hittable. */
'use strict';
const L = require('./lib.js');
(async () => {
  const h = await L.start(), R = L.reporter();
  try {
    for (const width of [360, 375, 390, 430]) {
      const { page, ctx, errs } = await L.boot(h, { width, height: 932 }, 'live');
      const cdp = await ctx.newCDPSession(page);
      const tap = async p => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [p] });
        await page.waitForTimeout(120);
      };
      await page.evaluate(() => {
        window.__recordTaps = 0;
        // Count the actual control's handler without starting a recording in this target test.
        document.getElementById('ft-rec-ring').onclick = () => { window.__recordTaps++; };
      });
      const ring = await page.evaluate(() => {
        const e = document.getElementById('ft-rec-ring'), r = e.getBoundingClientRect();
        const p = getComputedStyle(e, '::before'), w = parseFloat(p.width), hh = parseFloat(p.height);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const points = [{ x: cx - w / 2 + 2, y: cy }, { x: cx + w / 2 - 2, y: cy },
          { x: cx, y: cy - hh / 2 + 2 }, { x: cx, y: cy + hh / 2 - 2 }];
        return { w, h: hh, points, hits: points.map(p => { const t = document.elementFromPoint(p.x, p.y); return t === e || e.contains(t); }) };
      });
      R.check(ring.w >= 44 && ring.h >= 44 && ring.hits.every(Boolean), width + ': Bounce has a real 44 pt target', JSON.stringify(ring));
      for (const p of ring.points) await tap(p);
      R.check(await page.evaluate(() => window.__recordTaps) === 4, width + ': all four padded edges activate Bounce');
      for (const mode of ['dark', 'light']) for (const way of ['colour', 'mono']) {
        await page.evaluate(([mode, way]) => {
          document.body.classList.toggle('light-mode', mode === 'light');
          document.documentElement.dataset.way = way;
          window.__undoTaps = 0;
          showToast('Removed', { actionLabel: 'Undo', onAction() { window.__undoTaps++; } });
        }, [mode, way]);
        await page.waitForTimeout(550);
        const undo = await page.evaluate(() => {
          const e = document.querySelector('#_toast ._toast-btn'), r = e.getBoundingClientRect();
          return { w: r.width, h: r.height, x: r.left + r.width / 2, y: r.bottom - 3 };
        });
        R.check(undo.w >= 44 && undo.h >= 44, width + ' ' + mode + '/' + way + ': Undo target is 44 pt', JSON.stringify(undo));
        await tap({ x: undo.x, y: undo.y });
        R.check(await page.evaluate(() => window.__undoTaps) === 1, width + ' ' + mode + '/' + way + ': Undo works at lower edge');
      }
      await page.evaluate(() => {
        document.getElementById('_toast')?.remove();
        const host = document.createElement('div'); host.id = '__foldTest';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg);overflow:auto;padding:16px';
        document.body.appendChild(host);
        const slot = slotFromChordSymbol('Am7', 0, 'major', 9); slot.bars = 1;
        sbBuildChordEditor(host, slot, 0, [slot], () => {});
      });
      const folds = await page.locator('#__foldTest .ci-fold-lbl').count();
      for (let i = 0; i < folds; i++) {
        const label = page.locator('#__foldTest .ci-fold-lbl').nth(i);
        await label.scrollIntoViewIfNeeded();
        const info = await label.evaluate(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left + r.width / 2, y: r.bottom - 3, expanded: e.getAttribute('aria-expanded') }; });
        R.check(info.w >= 44 && info.h >= 44, width + ': chord fold ' + i + ' is 44 pt', JSON.stringify(info));
        await tap({ x: info.x, y: info.y });
        R.check(await label.getAttribute('aria-expanded') !== info.expanded, width + ': chord fold ' + i + ' toggles at lower edge');
      }
      R.check(errs.length === 0, width + ': no page errors', errs.join(' | '));
      await ctx.close();
    }
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exit(1); });
