/* A kit picked for Aux while playing must land on Aux, even if the page moves to the Kit before the loop top.
   Run: node tests/seq/auxkit.probe.js   (LIB=<path to tests/layout/lib.js> to run it against another checkout) */
'use strict';
const L = require(process.env.LIB || '../layout/lib.js');
(async () => {
  const h = await L.start(); const { page } = await L.boot(h, 'p390', 'studio');
  const st = () => page.evaluate(() => ({ drum: _sqDrumKit(), aux: _sqAuxKit(), pendDrum: _sqPendingKit(0), pendAux: _sqPendingKit(1), playing: _sqPlaying() }));
  await page.evaluate(() => { ftDrumClick(); ftAuxClick(); });
  await page.click('#ft-play, .ft-play, [onclick*="togglePlay"]').catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => { studioShow('aux'); _sqPickAuxKit('SAMBA'); studioShow('drums'); });
  const queued = await st();
  await page.waitForTimeout(5000);
  const end = await st();
  console.log(JSON.stringify({ queued, end }));
  const ok = queued.playing && queued.pendAux === 'SAMBA' && queued.pendDrum === null && end.drum === queued.drum && end.aux === 'SAMBA';
  // A pick for either layer leaves the page's focus where it was: on Live the Drum grid widget is the Kit, always.
  const { page: lp } = await L.boot(h, 'p390', 'live');
  const live = await lp.evaluate(() => { lvSet(['chords','drums','aux','styles']); const o = { f0: _sqFocusNow() };
    _sqPickAuxKit('SAMBA'); o.afterAux = _sqFocusNow(); o.aux = _sqAuxKit(); _sqPickDrumKit('ROCK'); o.afterKit = _sqFocusNow(); o.kit = _sqDrumKit(); return o; });
  console.log(JSON.stringify(live));
  const ok2 = ok && live.f0 === 0 && live.afterAux === 0 && live.afterKit === 0 && live.aux === 'SAMBA' && live.kit === 'ROCK';
  console.log(ok2 ? 'PASS' : 'FAIL'); await h.close(); process.exit(ok2 ? 0 : 1);
})();
