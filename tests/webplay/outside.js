// The chords from outside the key are the Theory Pack's: on the free web page every Modal
// and Secondary Dominant pad, catalog row and the song builder's Borrowed grid is locked,
// and a tap opens the sheet instead of sounding. Run against dist-web (port 8778) and dist
// (8779, where nothing is flagged and everything stays open).
const { chromium } = require('playwright');
(async () => {
  let bad = 0;
  const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
  const b = await chromium.launch();
  for (const [url, free] of [['http://127.0.0.1:8778/play/', true], ['http://127.0.0.1:8779/', false]]) {
    const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    await p.goto(url); await p.waitForTimeout(1500);
    await p.click(`button[onclick="unlockAudio('blank')"]`).catch(() => {}); await p.waitForTimeout(1800);
    const r = await p.evaluate(() => {
      const n = (sel) => document.querySelectorAll(sel).length;
      return {
        bor: n('#chords-borrowed > .chord-split'), borL: n('#chords-borrowed > .chord-split.tier-locked'),
        sec: n('#chords-secdom > .chord-split'), secL: n('#chords-secdom > .chord-split.tier-locked'),
        dia: n('#chords-diatonic > *'), diaL: n('#chords-diatonic .tier-locked'),
        cpI: n('#cppop-borrowed .cp-item, #cppop-secdom .cp-item'), cpL: n('#cppop-borrowed .cp-item.tier-locked, #cppop-secdom .cp-item.tier-locked'),
        sbB: document.getElementById('sb-exp-borrowed').classList.contains('tier-locked'),
        sbP: n('#sb-borrowed-body > .cpick-split'), sbPL: n('#sb-borrowed-body > .cpick-split.tier-locked'),
      };
    });
    console.log(url, JSON.stringify(r));
    check(r.bor > 0 && r.sec > 0 && r.dia === 7, 'shelves are built');
    check(r.diaL === 0, 'the key\'s own seven are never locked');
    if (free) {
      check(r.borL === r.bor && r.secL === r.sec, 'every Modal and Secondary pad locked');
      check(r.cpI > 0 && r.cpL === r.cpI, 'catalog rows locked');
      check(r.sbB && r.sbPL === r.sbP, 'song builder Borrowed locked');
      // a tap opens the sheet and plays nothing
            await p.locator('#chords-borrowed > .chord-split').first().click({ force: true });
      await p.waitForTimeout(400);
      check(await p.evaluate(() => !!document.getElementById('_pro-sheet')), 'a tap opens the pack sheet');
      // ticking is refused
      const ok = await p.evaluate(() => { const c = cpSources().borrowed[0]; cpToggle(c); return cpChosen().length; });
      check(ok === 0, 'cpToggle on a borrowed chord adds nothing (' + ok + ')');
    } else {
      check(r.borL === 0 && r.secL === 0 && r.cpL === 0 && !r.sbB && r.sbPL === 0, 'nothing locked in the app build');
    }
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
