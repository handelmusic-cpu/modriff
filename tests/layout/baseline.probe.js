/* Page heights and small targets, per Studio page and viewport: the numbers every layout slice is measured against.

   Run: node tests/layout/baseline.probe.js            (checks against tests/layout/baseline.json)
        node tests/layout/baseline.probe.js --write    (records today's numbers)
   A slice may change a page's height or its count of controls under 44 pt on purpose: it re-records the baseline in the same
   commit and says why in the message. What it may not do is make either worse by accident, so the check fails when a page
   grows by more than SLACK points or gains a small control. */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const FILE = path.join(__dirname, 'baseline.json');
const WRITE = process.argv.includes('--write');
const SLACK = 8;
const VPS = ['p430', 'p390', 'se375'];

(async () => {
  const h = await L.start(), R = L.reporter();
  const now = {};
  for (const vp of VPS) {
    const { page, ctx, errs } = await L.boot(h, vp, 'studio');
    now[vp] = {};
    for (const name of L.STUDIO) {
      await L.goStudio(page, name);
      const items = await page.evaluate(L.SCAN);
      const small = items.filter(L.isSmall).filter(c => !L.KNOWN_SMALL.some(rx => rx.test(c.key)));
      const bottom = await page.evaluate(L.PAGE_BOTTOM);
      now[vp][name] = { bottom, controls: items.length, small: small.length };
    }
    const live = await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); return 1; });
    await page.waitForTimeout(500);
    const li = await page.evaluate(L.SCAN);
    now[vp].Live = { bottom: await page.evaluate(L.PAGE_BOTTOM), controls: li.length, small: li.filter(L.isSmall).length };
    R.check(errs.length === 0, 'no page errors at ' + vp, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await h.close();
  if (WRITE) { fs.writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n'); console.log('wrote ' + path.relative(L.ROOT, FILE)); }
  console.log('\npage            ' + VPS.map(v => v.padEnd(22)).join(''));
  Object.keys(now.p430).forEach(n => console.log(n.padEnd(16) + VPS.map(v => ('h' + now[v][n].bottom + ' c' + now[v][n].controls + ' s' + now[v][n].small).padEnd(22)).join('')));
  if (!WRITE) {
    if (!fs.existsSync(FILE)) { R.check(false, 'baseline.json exists (run with --write)'); R.done(); return; }
    const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    VPS.forEach(vp => Object.keys(now[vp]).forEach(n => {
      const a = now[vp][n], b = base[vp] && base[vp][n]; if (!b) return;
      R.check(a.bottom <= b.bottom + SLACK, vp + ' ' + n + ' is no taller than the baseline', a.bottom + ' vs ' + b.bottom);
      R.check(a.small <= b.small, vp + ' ' + n + ' has no new control under 44 pt', a.small + ' vs ' + b.small);
    }));
  }
  R.done();
})();
