/* Slice 10: every tutorial step still points at something on screen, and every Find entry still goes somewhere.

   For each step of each tutorial (TUT_LIST), as a Pro install: run its `go`, then look for its `el`; the element must exist and have a
   box (a step whose control is gone is skipped silently by the tour, which is how a tutorial rots). For each Find entry (FIND_ITEMS):
   its `go` must run without throwing. Run at 430 x 932, Studio and Live.

   Run: node tests/layout/tutorials.probe.js */
'use strict';
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  const { page, errs } = await L.boot(h, 'p430', 'studio');
  const steps = await page.evaluate(() => TUT_LIST.map(t => ({ id: t.id, n: t.steps.length })));
  const bad = [];
  for (const t of steps) {
    for (let i = 0; i < t.n; i++) {
      const r = await page.evaluate(async ({ id, i }) => {
        const T = TUT_LIST.filter(x => x.id === id)[0], s = T.steps[i];
        try { if (s.go) s.go(); } catch (e) { return { err: String(e) }; }
        await new Promise(r => setTimeout(r, 450));
        let e = null; try { e = typeof s.el === 'function' ? s.el() : document.querySelector(s.el); } catch (x) { return { err: 'el ' + x }; }
        if (!e) return { missing: true, t: s.t };
        const b = e.getBoundingClientRect();
        return { t: s.t, ok: b.width > 0 && b.height > 0 };
      }, { id: t.id, i });
      if (r.err || r.missing || !r.ok) bad.push(t.id + ' #' + (i + 1) + ' ' + (r.t || '') + (r.err ? ' ' + r.err : ''));
    }
  }
  R.check(bad.length === 0, 'every tutorial step finds its element on screen', bad.join('; '));

  const names = await page.evaluate(() => (FIND_INDEX).map((f, i) => i + ':' + f.name));
  const fails = [];
  for (let i = 0; i < names.length; i++) {
    const r = await page.evaluate(async i => {
      const f = FIND_INDEX[i]; try { if (f.go) await f.go(); } catch (e) { return String(e); }
      await new Promise(r => setTimeout(r, 120));
      try { closeFind && closeFind(); } catch (e) {} return '';
    }, i);
    if (r) fails.push(names[i] + ' ' + r);
  }
  R.check(names.length > 40 && fails.length === 0, 'every Find entry runs (' + names.length + ' entries)', fails.join('; '));
  R.check(errs.length === 0, 'no page errors', errs.join(' | ').slice(0, 300));
  await h.close(); R.done();
})();
