/* "Nothing is lost": every control Studio had when the layout overhaul began is still on its page, or has a recorded new home.

   tests/layout/controls.json is a snapshot of the visible interactive controls of each Studio page at 430 x 932 in the build
   before the overhaul (a control is its id, or "tag.class|label" when it has none; only keys that were the same on two fresh
   boots are kept, so a label that changes with state, like a step count, never makes the test flaky).
   tests/layout/homes.json is the ledger: when a slice moves a control, it adds  "old key": "new key"  (the new key is looked for
   on the page named in "page", default the same page). A control that is deliberately gone needs "gone": "reason the owner
   agreed", never a silent deletion.

   Run: node tests/layout/inventory.probe.js           (checks)
        node tests/layout/inventory.probe.js --write   (re-snapshot: only before the overhaul's first slice, or with the owner) */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const SNAP = path.join(__dirname, 'controls.json'), HOMES = path.join(__dirname, 'homes.json');
const WRITE = process.argv.includes('--write');

async function sweep(h) {
  const { page, ctx } = await L.boot(h, 'p430', 'studio');
  const out = {};
  for (const name of L.STUDIO) {
    await L.goStudio(page, name);
    out[name] = (await page.evaluate(L.SCAN)).map(c => c.key);
  }
  await ctx.close();
  return out;
}

(async () => {
  const h = await L.start(), R = L.reporter();
  if (WRITE) {
    const a = await sweep(h), b = await sweep(h), snap = {};
    Object.keys(a).forEach(n => { snap[n] = a[n].filter(k => b[n].includes(k)).filter((k, i, arr) => arr.indexOf(k) === i); });
    fs.writeFileSync(SNAP, JSON.stringify(snap, null, 1) + '\n');
    if (!fs.existsSync(HOMES)) fs.writeFileSync(HOMES, '{}\n');
    Object.keys(snap).forEach(n => console.log(n.padEnd(10), snap[n].length, 'controls'));
    await h.close(); return;
  }
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')), homes = fs.existsSync(HOMES) ? JSON.parse(fs.readFileSync(HOMES, 'utf8')) : {};
  const now = await sweep(h);
  let lost = 0, total = 0;
  Object.keys(snap).forEach(name => snap[name].forEach(k => {
    total++;
    if (now[name].includes(k)) return;
    const mv = homes[name + '::' + k] || homes[k];
    if (mv && mv.gone) return;                                           // agreed removal, with a reason
    if (mv && mv.to) { const pg = mv.page || name; if (now[pg] && now[pg].includes(mv.to)) return; }
    lost++; R.check(false, name + ': ' + k + ' is not on its page and has no recorded home');
  }));
  R.check(lost === 0, 'every one of ' + total + ' controls is on its page or has a recorded home', lost ? lost + ' missing' : '');
  await h.close();
  R.done();
})();
