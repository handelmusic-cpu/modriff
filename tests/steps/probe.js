/* Step probability, roll velocity and the Euclidean fill.

   Counted on the real paths:
     - the drum grid: _sqFireLayer called over many passes of a row whose steps
       have a 50 % chance, beside a row with none; sqPlayCell is the counter;
     - the bass and melody sequencers: the real transport, counting the note
       messages the engine receives, with and without a chance on every step, and
       the level of the messages with and without a velocity on every step;
     - the Euclidean pattern: the property (k hits, gaps differing by at most
       one) over every n to 32 and k to n, the two named rhythms, and the row
       actions with their Undo;
     - that a step with no `pr` and no `vel` is exactly what it was.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/steps/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/song/probe.js). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { setModTier('pro'); });

  // ── 1. The gate itself.
  const g = await page.evaluate(() => {
    let a = 0, b = 0, c = 0, d = 0; const N = 20000;
    for (let i = 0; i < N; i++) { if (_stepProb({ pr: 30 })) a++; if (_stepProb({})) b++; if (_stepProb({ pr: 100 })) c++; if (_stepProb(null)) d++; }
    return { a: a / N, b: b / N, c: c / N, d: d / N, v: [_stepVel({}), _stepVel({ vel: 50 }), _stepVel({ vel: 100 }), _stepVel(null)] };
  });
  check(Math.abs(g.a - 0.3) < 0.02, 'a 30 % step sounds about 30 % of the time', g.a.toFixed(3));
  check(g.b === 1 && g.c === 1 && g.d === 1, 'no chance, 100 %, and no cell at all: always');
  check(g.v.join() === '1,0.5,1,1', 'roll velocity: absent and 100 are full, 50 is half', g.v.join());

  // ── 2. The drum grid on the real transport: a half-chance row beside an ordinary one.
  //     Hits are counted as the engine receives them (kind 'hit', by lane).
  const play = (ms, keepBass) => page.evaluate(async ([ms]) => {
    stopEverything(); await new Promise(r => setTimeout(r, 300));
    _setBpm(220);
    const msgs = []; const orig = window.modEngine.send;
    window.modEngine.send = function (m) { if (m && (m.kind === 'hit' || m.kind === 'note')) msgs.push({ kind: m.kind, part: m.part, lane: m.lane, vel: m.vel }); return orig.apply(this, arguments); };
    startEverything();
    await new Promise(r => setTimeout(r, ms));
    stopEverything();
    window.modEngine.send = orig;
    return msgs;
  }, [ms]);
  const setDrums = (src) => page.evaluate((src) => {
    const st = window._sqCaptureState();
    (new Function('st', src))(st);
    window._sqRestoreState(st);
    const lanes = Object.keys(st.grid);
    return { lanes, steps: st.steps };
  }, src);
  // Row 0 gets a 50 % chance on all its steps, row 1 plain, the rest empty.
  const info = await setDrums(`
    const ks = Object.keys(st.grid);
    ks.forEach((k, i) => { st.grid[k] = st.grid[k].map(() => ({ v: (i < 2 ? 1 : 0), r: 1, orn: 0, vel: 100 })); });
    st.grid[ks[0]].forEach(c => { c.pr = 50; });`);
  const dm = await play(9000);
  const hitsBy = {}; dm.filter(m => m.kind === 'hit').forEach(m => { hitsBy[m.lane] = (hitsBy[m.lane] || 0) + 1; });
  const lanesSeen = Object.keys(hitsBy);
  const plain = hitsBy[lanesSeen.find(l => String(l) === String(info.lanes[1]))] || 0;
  const half = hitsBy[lanesSeen.find(l => String(l) === String(info.lanes[0]))] || 0;
  console.log('     drum hits by lane: ' + JSON.stringify(hitsBy) + '  (row 0 has a 50 % chance)');
  check(plain >= 60, 'a plain row plays every step on the real transport', plain);
  check(half > plain * 0.3 && half < plain * 0.7, 'a 50 % row plays about half as many', (half / plain).toFixed(2));

  // ── 3. Euclid.
  const eu = await page.evaluate(() => {
    const bad = [];
    for (let n = 2; n <= 32; n++) for (let k = 1; k <= n; k++) {
      const p = _sqEuclidPattern(n, k), hits = p.reduce((a, b) => a + b, 0);
      const idx = []; p.forEach((v, i) => { if (v) idx.push(i); });
      const gaps = idx.map((x, i) => ((idx[(i + 1) % idx.length] - x) + n) % n || n);
      const spread = Math.max(...gaps) - Math.min(...gaps);
      if (hits !== k || spread > 1) bad.push(n + ':' + k);
    }
    return { bad, e38: _sqEuclidPattern(8, 3).join(''), e58: _sqEuclidPattern(8, 5).join('') };
  });
  check(eu.bad.length === 0, 'every n to 32 and k to n: k hits, evenly spread (gaps differ by at most one)', eu.bad.join(' '));
  check(eu.e38 === '10010010', '3 in 8 is x..x..x. (the tresillo)', eu.e38);
  check(eu.e58 === '10101101', '5 in 8 is x.x.xx.x', eu.e58);

  const row = await page.evaluate(() => {
    const st0 = window._sqCaptureState(), k = Object.keys(st0.grid)[2], ti = +k;
    const n = st0.steps;
    st0.grid[k] = st0.grid[k].map((c, s) => ({ v: s === 1 ? 2 : 0, r: 1, orn: 0, vel: 100 }));
    window._sqRestoreState(st0);
    const rowOf = () => window._sqCaptureState().grid[k].slice(0, n).map(c => c.v).join('');
    const before = rowOf();
    window._sqEuclidRow(ti, 5);
    const after = rowOf();
    document.querySelector('#_toast ._toast-btn').click();
    return { before, after, undone: rowOf(), n };
  });
  check(row.after.split('').filter(v => v === '1').length === 5 && row.after.length === row.n, 'Euclid 5 puts five hits on the row', row.after);
  check(row.undone === row.before, 'and Undo puts the row back as it was', row.undone);

  const rot = await page.evaluate(() => {
    const st0 = window._sqCaptureState(), k = Object.keys(st0.grid)[2], ti = +k, n = st0.steps;
    st0.grid[k] = st0.grid[k].map((c, s) => ({ v: [0, 4, 5].indexOf(s) >= 0 ? 1 : 0, r: 1, orn: 0, vel: s === 4 ? 60 : 100 }));
    window._sqRestoreState(st0);
    const cells = () => window._sqCaptureState().grid[k].slice(0, n);
    window._sqRotateRow(ti, 1);
    const later = cells().map((c, i) => c.v ? i : -1).filter(i => i >= 0).join();
    const velMoved = cells()[5].vel;
    window._sqRotateRow(ti, -1); window._sqRotateRow(ti, -1);
    const earlier = cells().map((c, i) => c.v ? i : -1).filter(i => i >= 0).join();
    return { later, velMoved, earlier, n };
  });
  check(rot.later === '1,5,6' && rot.velMoved === 60, 'Rotate → moves 0,4,5 to 1,5,6 and takes each step\'s velocity with it', rot.later + ' vel ' + rot.velMoved);
  check(rot.earlier === [3, 4, rot.n - 1].join(), 'and ← twice wraps round the start', rot.earlier);

  // ── 4. The bass and melody sequencers, on the real transport.
  const runLine = async (part, mutate, ms) => page.evaluate(async ([part, mutateSrc, ms]) => {
    stopEverything(); await new Promise(r => setTimeout(r, 300));
    _setBpm(220);
    const cap = part === 'bass' ? window._blCaptureState : window._mlCaptureState, res = part === 'bass' ? window._blRestoreState : window._mlRestoreState;
    const st = cap(); st.steps = 16;
    st.grid = []; for (let i = 0; i < 16; i++) st.grid.push({ v: 1, note: (i % 7), oct: 2, len: 1, accent: false, slide: false, usr: 1 });
    (new Function('st', mutateSrc))(st);
    res(st);
    const msgs = []; const orig = window.modEngine.send;
    window.modEngine.send = function (m) { if (m && m.kind === 'note' && m.part === (part === 'bass' ? 'bass' : 'melgen')) msgs.push({ vel: m.vel }); return orig.apply(this, arguments); };
    if (part === 'bass') window.blPlay(); else window.mlPlay();
    await new Promise(r => setTimeout(r, ms));
    stopEverything();
    window.modEngine.send = orig;
    return msgs;
  }, [part, mutate, ms]);
  const avg = a => a.reduce((x, y) => x + y.vel, 0) / (a.length || 1);

  for (const part of ['bass', 'melody']) {
    const base = await runLine(part, '', 9000);
    const half = await runLine(part, 'st.grid.forEach(c => { c.pr = 50; });', 9000);
    const soft = await runLine(part, 'st.grid.forEach(c => { c.vel = 50; });', 9000);
    console.log('     ' + part + ': notes plain ' + base.length + ', 50% ' + half.length + ', velocity-50 ' + soft.length + '; mean vel ' + avg(base).toFixed(3) + ' vs ' + avg(soft).toFixed(3));
    check(base.length >= 60, part + ': the line plays on the real transport', base.length);
    check(half.length > base.length * 0.3 && half.length < base.length * 0.7, part + ': a 50 % chance on every step plays about half the notes', (half.length / base.length).toFixed(2));
    check(soft.length === base.length || Math.abs(soft.length - base.length) <= 3, part + ': velocity does not change which notes play', soft.length + ' vs ' + base.length);
    check(Math.abs(avg(soft) / avg(base) - 0.5) < 0.06, part + ': velocity 50 plays the notes at half the level', (avg(soft) / avg(base)).toFixed(3));
  }

  // ── 5. A step with neither field is what it always was, and the inspector writes only what it must.
  const insp = await page.evaluate(() => {
    const cfg = PR_ENGINES.bl;
    const st = window._blCaptureState(); st.steps = 16;
    st.grid = []; for (let i = 0; i < 16; i++) st.grid.push({ v: 0, note: 0, oct: 2, len: 1, accent: false, slide: false });
    st.grid[3] = { v: 1, note: 0, oct: 2, len: 1, accent: false, slide: false, usr: 1 };
    window._blRestoreState(st);
    const c = cfg.cell(3);
    PR_SEL.bl = 3; prSyncInsp('bl');
    const host = document.getElementById('bl-pr-insp');
    const sl = host.querySelector('input.pr-insp-vel');
    sl.value = '40'; sl.dispatchEvent(new Event('input'));
    const withVel = c.vel;
    sl.value = '100'; sl.dispatchEvent(new Event('input'));
    const afterFull = ('vel' in c);
    // Prob: the buttons step by ten, and at 100 the field is gone.
    const btns = [...host.querySelectorAll('button')], lessB = btns.find(b => b.title === 'Plays less often'), moreB = btns.find(b => b.title === 'Plays more often');
    lessB.click(); lessB.click(); lessB.click();
    const p70 = c.pr;
    moreB.click(); moreB.click(); moreB.click();
    return { has: !!sl, withVel, afterFull, p70, prGone: !('pr' in c), shown: host.textContent.replace(/\s+/g, ' ') };
  });
  check(insp.has && insp.withVel === 40 && insp.afterFull === false, 'the roll inspector writes vel when set and removes it at 100', JSON.stringify(insp));
  check(insp.p70 === 70 && insp.prGone, 'its Prob buttons step by ten, and back at 100 the field is removed', insp.p70);

  // The same through the Phrase lock: a recalled line keeps its levels and chances.
  const lock = await page.evaluate(() => {
    const st = window._blCaptureState(); st.grid[3] = Object.assign({}, st.grid[3], { vel: 55, pr: 35 });
    window._blRestoreState(st);
    const back = window._blCaptureState().grid[3];
    return { vel: back.vel, pr: back.pr };
  });
  check(lock.vel === 55 && lock.pr === 35, 'a saved and restored bass line keeps its levels and chances', JSON.stringify(lock));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
