/* iCloud sync engine, against a fake CloudKit and simulated devices.
   Run: node tests/sync/engine.test.js

   Everything the engine decides is in here: what counts as changed, the two-device
   rules (a remote change, a remote delete, a conflicting push), failure and retry,
   what is left alone. The last case is a fuzz: three devices doing random things
   with a clock that only goes forward, synced round-robin, which must end with
   every device holding the same thing. */
'use strict';
const { E, pageCollections, fakeCloud, device } = require('./load');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const same = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, msg + '\n    want ' + w + '\n    got  ' + g);
};
const SL = 'prism-sl', SU = 'modo-setups', MS = 'modo-msx-user';
const ids = (d, k) => d.list(k).map(x => x.id).sort((a, b) => a - b);
const run = async () => {

// 1. A song made on one device arrives on the other, once, and a second pass is quiet.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One', sections: [1, 2] }, { id: 2, title: 'Two' }]);
  const r1 = await A.eng.sync();
  ok(r1.up === 2, 'two songs go up (' + r1.up + ')');
  ok(A.applied.length === 0, 'the device\'s own songs coming back from the server are not applied as changes (' + A.applied + ')');
  await B.eng.sync();
  same(B.list(SL).map(x => x.title).sort(), ['One', 'Two'], 'both arrive on the other device');
  same(B.list(SL)[0].sections, [1, 2], 'with their contents');
  ok(B.applied.indexOf('sl') >= 0, 'the page is told the setlist changed');
  B.applied.length = 0; A.applied.length = 0;
  const r2 = await B.eng.sync(), r3 = await A.eng.sync();
  ok(r2.up === 0 && r3.up === 0, 'nothing to send the second time');
  ok(B.applied.length === 0 && A.applied.length === 0, 'and nothing reloaded: a device\'s own writes coming back are not applied again (' + A.applied + '|' + B.applied + ')');
}

// 2. Edits on both devices, to different songs, both survive.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }]);
  await A.eng.sync(); await B.eng.sync();
  clock.t = 2000;
  B.put(SL, B.list(SL).map(x => x.id === 1 ? Object.assign({}, x, { title: 'One (B)' }) : x));
  A.put(SL, A.list(SL).map(x => x.id === 2 ? Object.assign({}, x, { title: 'Two (A)' }) : x));
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync(); await B.eng.sync();
  const t = d => d.list(SL).map(x => x.title).sort();
  same(t(A), ['One (B)', 'Two (A)'], 'A has both edits');
  same(t(B), ['One (B)', 'Two (A)'], 'B has both edits');
}

// 3. A delete is a delete: it propagates, and nothing brings the song back.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }]);
  await A.eng.sync(); await B.eng.sync();
  clock.t = 2000;
  A.put(SL, A.list(SL).filter(x => x.id !== 1));
  await A.eng.sync(); await B.eng.sync();
  same(ids(B, SL), [2], 'the delete reaches the other device');
  await B.eng.sync(); await A.eng.sync(); await B.eng.sync();
  same(ids(A, SL), [2], 'A is still without it');
  same(ids(B, SL), [2], 'and B');
  ok(cloud.recs.size === 1, 'the server holds one record (' + cloud.recs.size + ')');
}

// 4. The same song edited on both: the later edit wins, on both devices, either way round.
for (const bLater of [true, false]) {
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'Base' }]);
  await A.eng.sync(); await B.eng.sync();
  clock.t = 2000; A.put(SL, [{ id: 1, title: 'A edit' }]);
  clock.t = bLater ? 3000 : 1500; B.put(SL, [{ id: 1, title: 'B edit' }]);
  // A diffs at 2000, B at 1500 or 3000: the stamps are the clocks at the diff.
  clock.t = 2000; await A.eng.diff && A.eng.diff();
  clock.t = bLater ? 3000 : 1500; B.eng.diff();
  clock.t = 4000;
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync(); await B.eng.sync();
  const want = bLater ? 'B edit' : 'A edit';
  same([A.list(SL)[0].title, B.list(SL)[0].title], [want, want], 'conflict: ' + (bLater ? 'B' : 'A') + ' edited last, ' + want + ' wins everywhere');
}

// 5. An unsent edit against a remote delete: the edit is kept and goes back up.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One' }]);
  await A.eng.sync(); await B.eng.sync();
  clock.t = 2000; A.put(SL, []); await A.eng.sync();                  // A deletes it
  clock.t = 3000; B.put(SL, [{ id: 1, title: 'One, edited on B' }]);  // B edits it meanwhile
  await B.eng.sync(); await A.eng.sync(); await B.eng.sync();
  same(B.list(SL).map(x => x.title), ['One, edited on B'], 'B keeps the song it edited after A deleted it');
  same(A.list(SL).map(x => x.title), ['One, edited on B'], 'and it comes back on A');
}

// 6. Preferences (a whole value): last writer wins, on both.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.store.setItem('modo-keyhue', '{"mode":"fifths","start":3}');
  await A.eng.sync(); await B.eng.sync();
  same(B.store.getItem('modo-keyhue'), '{"mode":"fifths","start":3}', 'a preference arrives');
  ok(B.applied.indexOf('keyhue') >= 0, 'and the page is told');
  clock.t = 2000; B.store.setItem('modo-keyhue', '{"mode":"chromatic","start":0}');
  await B.eng.sync(); await A.eng.sync();
  same(A.store.getItem('modo-keyhue'), '{"mode":"chromatic","start":0}', 'a later change to it goes the other way');
  ok(cloud.recs.size === 1, 'one record for it');
}

// 7. What is left alone: the demo song, a damaged value, items with no id, ASCII record names.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 9, title: 'Demo', isDemo: true }, { id: 1, title: 'Real' }, { title: 'no id' }]);
  A.store.setItem(SU, '{not json');
  A.put(MS, [{ name: 'Glass pad ✦ 日本語', vals: { cut: 0.4 } }]);
  await A.eng.sync(); await B.eng.sync();
  same(B.list(SL).map(x => x.title), ['Real'], 'the demo song and an item with no id stay home');
  ok(A.store.getItem(SU) === '{not json', 'a damaged value is not touched');
  same(B.list(MS).map(x => x.name), ['Glass pad ✦ 日本語'], 'a patch with a name in any script travels');
  ok([...cloud.recs.keys()].every(k => /^[a-z]+:[0-9a-f]{16}$/.test(k)), 'every record name is plain ASCII: ' + [...cloud.recs.keys()].join(' '));
}

// 8. A failed push keeps what is waiting; the next pass sends it.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One' }]);
  cloud.failNext = 1;
  let threw = false; try { await A.eng.sync(); } catch (e) { threw = true; }
  ok(threw, 'a network failure is reported');
  ok(A.eng.pending() === 1, 'the song is still waiting (' + A.eng.pending() + ')');
  await A.eng.sync(); await B.eng.sync();
  same(B.list(SL).map(x => x.title), ['One'], 'and goes up on the next pass');
  ok(A.eng.pending() === 0, 'nothing waiting after');
}

// 9. A pass asked for while one is running is not lost.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SL, [{ id: 1, title: 'One' }]);
  const p1 = A.eng.sync();
  A.put(SL, [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }]);       // an edit mid-sync
  const p2 = A.eng.sync();
  await Promise.all([p1, p2]); await B.eng.sync();
  same(ids(B, SL), [1, 2], 'a change made while syncing still goes up');
}

// 10. A first sync on a device that already has things, against a server that has others: the union.
{
  const cloud = fakeCloud(), clock = { t: 1000 }, A = device(cloud, clock), B = device(cloud, clock);
  A.put(SU, [{ id: 'a1', name: 'Setup A' }]); B.put(SU, [{ id: 'b1', name: 'Setup B' }]);
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
  same(A.list(SU).map(x => x.id).sort(), ['a1', 'b1'], 'A has both setups');
  same(B.list(SU).map(x => x.id).sort(), ['a1', 'b1'], 'B has both setups');
}

// 11. Fuzz: three devices, random edits and deletes, a clock that only moves forward.
{
  let seed = 424242; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 40; round++) {
    const cloud = fakeCloud(), clock = { t: 1000 }, D = [device(cloud, clock), device(cloud, clock), device(cloud, clock)];
    let nextId = 1;
    for (let step = 0; step < 60; step++) {
      clock.t += 1 + rnd(5);
      const d = D[rnd(3)], act = rnd(10), cur = d.list(SL);
      if (act < 3) { cur.push({ id: nextId++, title: 't' + step }); d.put(SL, cur); }
      else if (act < 5 && cur.length) { const i = rnd(cur.length); cur[i] = Object.assign({}, cur[i], { title: 'e' + step }); d.put(SL, cur); }
      else if (act < 6 && cur.length) { cur.splice(rnd(cur.length), 1); d.put(SL, cur); }
      else { try { await d.eng.sync(); } catch (e) {} }
    }
    clock.t += 10;
    for (let k = 0; k < 4; k++) for (const d of D) { clock.t += 1; await d.eng.sync(); }
    const view = d => JSON.stringify(d.list(SL).map(x => [x.id, x.title]).sort((a, b) => a[0] - b[0]));
    ok(view(D[0]) === view(D[1]) && view(D[1]) === view(D[2]), 'fuzz round ' + round + ': three devices agree\n    ' + view(D[0]) + '\n    ' + view(D[1]) + '\n    ' + view(D[2]));
    if (fail) break;
  }
}

console.log(fail ? `FAILED — ${pass} passed, ${fail} failed` : `ok — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
};
run().catch(e => { console.log(e.stack || e); process.exit(1); });
