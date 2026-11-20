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
  } finally { await h.close(); }
  R.done();
})().catch(e => { console.error(e); process.exitCode = 1; });
