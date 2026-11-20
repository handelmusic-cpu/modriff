/* Song > Build, the chord editor and the page around it (1.9.9.9t): lengths in words and the eighth nudge, the editor's order and its
   quiet band, Add a chord under the timeline, the weight of each part, and the eighth snap on the timeline.
   Run: node tests/songbuild/build.probe.js   (serves the repo itself; env URL / CHROMIUM as for the other layout probes) */
'use strict';
const L = require('../layout/lib.js');

// Boot at a phone width on Song > Build with three chords (C, Dm, G) in the first section; G is selected.
async function openBuild(h, vp, pre) {
  const { page, ctx, errs } = await L.boot(h, vp, 'live');
  if (pre) await page.evaluate(pre);
  await page.evaluate(() => {
    switchTab('songs'); setSongsMode('build');
    const p = document.getElementById('chart-chord-picker');
    [0, 1, 4].forEach(i => p.children[i].querySelector('.cpick-tri').click());
  });
  await page.waitForTimeout(500);
  return { page, ctx, errs };
}
const slotOf = page => page.evaluate(() => { const s = sections[curSection].slots[chartSeqIdx]; return [s.bars || 0, s.beats || 0, s.eighths || 0]; });
const read = page => page.evaluate(() => (document.querySelector('#chart-inspector .ci-nudge-read')||{}).textContent);
const click = (page, sel, i) => page.evaluate(([s, n]) => { const e = document.querySelectorAll(s)[n || 0]; if (e) e.click(); }, [sel, i || 0]);
const overflowing = (page, root) => page.evaluate(r => [...document.querySelectorAll(r + ' button')]
  .filter(b => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map(b => (b.textContent || '').trim().slice(0, 20) + ' ' + b.scrollWidth + '>' + b.clientWidth), root || '#songs-build-panel');

(async () => {
  const h = await L.start(), R = L.reporter();
  try {
    // ── Task 2: the Length row and the eighth nudge ───────────────────────────
    for (const vp of ['se375', 'p390', 'p430']) {
      const { page, ctx, errs } = await openBuild(h, vp);
      const lenTops = await page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-row.ci-len .ci-seg > button')]
        .filter(b => !b.classList.contains('ci-more') && !b.classList.contains('ci-fine')).map(b => Math.round(b.getBoundingClientRect().top)));
      R.check(lenTops.length === 6 && new Set(lenTops).size === 1, vp + ': the six Length buttons share one line', lenTops.join(','));
      R.check(await read(page) === '1 bar', vp + ': the readout says the length in words', await read(page));
      await click(page, '#chart-inspector .ci-nudge button', 1); await click(page, '#chart-inspector .ci-nudge button', 1);
      R.check(await read(page) === '1 bar + 1 beat', vp + ': +1/8 twice reads "1 bar + 1 beat"', await read(page));
      await click(page, '#chart-inspector .ci-row.ci-len .ci-seg > button', 0);
      R.check(JSON.stringify(await slotOf(page)) === '[0,0,1]', vp + ': the half-beat button stores one eighth', JSON.stringify(await slotOf(page)));
      for (let i = 0; i < 5; i++) await click(page, '#chart-inspector .ci-nudge button', 0);
      R.check(await read(page) === '½ beat' && JSON.stringify(await slotOf(page)) === '[0,0,1]', vp + ': -1/8 from one eighth stays at one eighth', await read(page));
      await click(page, '#chart-inspector .ci-row.ci-len .ci-seg > button', 2);
      R.check(JSON.stringify(await slotOf(page)) === '[0,2,0]' && await read(page) === '2 beats', vp + ': 2 beats stores [0,2,0]', JSON.stringify(await slotOf(page)));
      const ov = await overflowing(page, '#chart-inspector .ci-row.ci-len');
      R.check(ov.length === 0, vp + ': no text in the Length row overflows its button', ov.join(' | '));
      R.check(errs.length === 0, vp + ': no page errors', errs.join('|'));
      await ctx.close();
    }

    // ── Task 3: the editor's order, the quiet band, shut by default ───────────
    const labels = page => page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-body > .ci-row > .ci-lbl')].map(l => l.textContent));
    const sums = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#chart-inspector .ci-body > .ci-row.ci-rshut')]
      .map(r => [r.querySelector('.ci-lbl').textContent, r.querySelector('.ci-sum').textContent])));
    const shutRows = page => page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-body > .ci-row.ci-rshut > .ci-lbl')].map(l => l.textContent));
    const ORDER = ['Chord', 'Length', 'Type', 'Words', 'Rhythm', 'Voicing', 'Bass', 'Plays'];
    const QUIET = ['Words', 'Rhythm', 'Voicing', 'Bass', 'Plays'];
    for (const vp of ['se375', 'p390', 'p430']) {
      const { page, ctx, errs } = await openBuild(h, vp);
      R.check(JSON.stringify(await labels(page)) === JSON.stringify(ORDER), vp + ': rows run Chord, Length, Type, then the quiet band', (await labels(page)).join(','));
      R.check(JSON.stringify(await shutRows(page)) === JSON.stringify(QUIET), vp + ': on first launch the five quiet rows start shut', (await shutRows(page)).join(','));
      const sm = await sums(page);
      R.check(sm.Words === 'none' && sm.Rhythm === 'Once a bar' && sm.Voicing === 'Default' && sm.Bass === 'Root \u25be' && sm.Plays === 'Chord', vp + ': a shut row says what it is set to', JSON.stringify(sm));
      const h1 = await page.evaluate(() => Math.round(document.getElementById('chart-inspector').getBoundingClientRect().height));
      R.check(h1 < 520, vp + ': the editor is under 520 pt tall with the quiet rows shut', h1);
      const typeTops = await page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-row.ci-onerow .ci-seg > button')].filter(b => !b.classList.contains('ci-more')).map(b => Math.round(b.getBoundingClientRect().top)));
      R.check(typeTops.length === 6 && new Set(typeTops).size === 1, vp + ': Type is one line', typeTops.join(','));
      let ov = await overflowing(page);
      R.check(ov.length === 0, vp + ': nothing on the Build page overflows its button', ov.join(' | '));
      // Open Rhythm by its label; the choice is remembered and Words stays shut.
      await page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-lbl')].filter(l => l.textContent === 'Rhythm')[0].click());
      const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('modo-ci-fold')).rows);
      R.check(rows.Rhythm === undefined && rows.Words === 1, vp + ': opening Rhythm is remembered, Words stays shut', JSON.stringify(rows));
      // Open every quiet row: still no overflow.
      await page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-row.ci-rshut > .ci-lbl')].forEach(l => l.click()));
      ov = await overflowing(page, '#chart-inspector');
      R.check(ov.length === 0, vp + ': with every row open nothing in the editor overflows', ov.join(' | '));
      R.check(errs.length === 0, vp + ': no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      // Review focus 4: a returning user keeps their rows; unreadable storage is a first launch.
      let { page, ctx } = await openBuild(h, 'se375', () => localStorage.setItem('modo-ci-fold', '{"rows":{"Voicing":1}}'));
      R.check(JSON.stringify(await shutRows(page)) === '["Voicing"]', 'a stored fold is kept as it was, not widened to the five', (await shutRows(page)).join(','));
      await ctx.close();
      ({ page, ctx } = await openBuild(h, 'se375', () => localStorage.setItem('modo-ci-fold', 'not json')));
      R.check(JSON.stringify(await shutRows(page)) === JSON.stringify(QUIET), 'unreadable stored fold is treated as a first launch', (await shutRows(page)).join(','));
      await ctx.close();
      // Review focus 6: a rest has no Length row and does not throw; the quick card keeps its own order.
      let r = await openBuild(h, 'se375');
      await r.page.evaluate(() => { sections[curSection].slots[chartSeqIdx].isRest = true; renderChartSeq(); });
      await r.page.waitForTimeout(300);
      const rl = await labels(r.page);
      R.check(!rl.includes('Length') && rl.includes('Plays') && r.errs.length === 0, 'a rest chord: no Length row, Plays is there, no page errors', rl.join(',') + ' | ' + r.errs.join('|'));
      await r.ctx.close();
      r = await openBuild(h, 'se375');
      const q = await r.page.evaluate(() => { qcOpen(curSection, 0, document.getElementById('chart-timeline')); return [...document.querySelectorAll('.qc-card .ci-body > .ci-row > .ci-lbl')].map(l => l.textContent); });
      R.check(JSON.stringify(q) === '["Length","Rhythm","Type","Voicing"]' && r.errs.length === 0, 'the quick card keeps Length, Rhythm, Type, Voicing', q.join(',') + ' | ' + r.errs.join('|'));
      await r.ctx.close();
    }

    // ── Task 4: Add a chord sits under the timeline, above the editor ─────────
    const geo = page => page.evaluate(() => {
      const r = id => { const e = document.querySelector(id); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, shown: b.height > 0 }; };
      return { inCard: !!document.querySelector('.sb-seccard #chart-chord-picker'), tl: r('#chart-timeline'), seq: r('#chart-sequence'), pick: r('#chart-chord-picker'),
        ins: r('#chart-inspector'), plays: r('#sec-plays-bar'), panel: r('#tl-panel') };
    });
    for (const vp of ['se375', 'p430']) {
      const { page, ctx, errs } = await openBuild(h, vp);
      let g = await geo(page);
      R.check(g.inCard, vp + ': the picker is inside the section card');
      R.check(g.tl.shown && g.pick.top >= g.tl.bottom - 1 && g.pick.bottom <= g.ins.top + 1, vp + ': timeline, then picker, then editor (line fold shut)', JSON.stringify([g.tl.bottom, g.pick.top, g.ins.top].map(Math.round)));
      await page.evaluate(() => sbLinesToggle()); await page.waitForTimeout(200);
      g = await geo(page);
      R.check(g.plays.shown && g.plays.bottom <= g.pick.top + 1 && g.pick.bottom <= g.ins.top + 1, vp + ': with the line fold open its rows stay above the picker, and the picker above the editor', JSON.stringify([g.plays.bottom, g.pick.top, g.ins.top].map(Math.round)));
      await page.evaluate(() => buildViewSet('strip')); await page.waitForTimeout(250);
      g = await geo(page);
      R.check(g.seq.shown && g.pick.top >= g.seq.bottom - 1 && g.pick.bottom <= g.ins.top + 1, vp + ': in Tiles view: strip, then picker, then editor', JSON.stringify([g.seq.bottom, g.pick.top, g.ins.top].map(Math.round)));
      const n0 = await page.evaluate(() => sections[curSection].slots.length);
      await page.evaluate(() => document.querySelectorAll('#chart-chord-picker .cpick-tri')[2].click());
      R.check(await page.evaluate(() => sections[curSection].slots.length) === n0 + 1, vp + ': tapping a picker tile adds a chord');
      await page.evaluate(() => document.getElementById('sb-exp-borrowed').click());
      await page.evaluate(() => document.getElementById('sb-exp-chroma').click());
      R.check(await page.evaluate(() => getComputedStyle(document.getElementById('sb-borrowed-body')).display !== 'none' && getComputedStyle(document.getElementById('chromatic-body')).display !== 'none'),
        vp + ': Borrowed and Any root still open their bodies');
      R.check(errs.length === 0, vp + ': no page errors', errs.join('|'));
      await ctx.close();
    }

    // ── Task 5: three levels of weight, tokens only, Build only ───────────────
    const resolved = (page, css) => page.evaluate(c => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;background:' + c; document.body.appendChild(d);
      const v = getComputedStyle(d).backgroundColor; d.remove(); return v; }, css);
    for (const mode of ['dark', 'light']) {
      const { page, ctx, errs } = await openBuild(h, 'p430', mode === 'light' ? () => document.body.classList.add('light-mode') : null);
      if (mode === 'light') await page.evaluate(() => document.body.classList.add('light-mode'));
      const t = mode + ': ';
      const card = await page.evaluate(() => getComputedStyle(document.querySelector('.sb-seccard')).backgroundColor);
      R.check(card === await resolved(page, 'var(--play-surf)'), t + 'the progression and picker card is the bright surface (--play-surf)', card);
      const glow = await page.evaluate(() => { const tile = document.querySelector('#chart-chord-picker .cpick-split'); tile.classList.add('logic-suggest');
        const c = getComputedStyle(tile); return { shadow: c.boxShadow, filter: c.filter }; });
      R.check(/inset/.test(glow.shadow) && !/\b14px\b/.test(glow.shadow) && glow.filter === 'none', t + 'a suggested chord is an underline, not a glow', JSON.stringify(glow));
      const tab = await page.evaluate(() => { const e = document.querySelector('.sec-tab.active'); return e ? getComputedStyle(e).backgroundColor : null; });
      R.check(tab !== null && tab !== await resolved(page, 'var(--py)'), t + 'the selected section tab is tinted, not a solid yellow slab', tab);
      await page.evaluate(() => [...document.querySelectorAll('#chart-inspector .ci-lbl')].filter(l => l.textContent === 'Rhythm')[0].click());
      const sel = await page.evaluate(() => getComputedStyle(document.querySelector('#chart-inspector .ci-row.ci-quiet .ci-seg button.on')).backgroundColor);
      R.check(sel === await resolved(page, 'var(--border2)') && sel !== await resolved(page, 'var(--accent)'), t + 'a selected second-step option is grey, not the accent', sel);
      R.check(errs.length === 0, t + 'no page errors', errs.join('|'));
      await ctx.close();
    }
    {
      // Live shares .logic-suggest and is not to change.
      const { page, ctx } = await L.boot(h, 'p430', 'live');
      const live = await page.evaluate(() => { const e = document.querySelector('#lv-slots .chord-split, #lv-slots .chord-out'); if (!e) return null; e.classList.add('logic-suggest'); return getComputedStyle(e).boxShadow; });
      R.check(live !== null && !/inset/.test(live), 'Live: a suggested chord is drawn as before (no Build underline)', String(live));
      await ctx.close();
    }
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exitCode = 1; });
