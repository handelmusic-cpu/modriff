/* Patterns and kits are independent (6.9.9.9.9.9.9.9.9.4), through voice roles (SQ_ROLES).
   - A kit swap moves the hits by role, not lane number: the same beat on the 909, Studio, Rock, Acoustic and Jazz kits is the
     same kick, backbeat and time, and swapping away and back is exact until the layer is edited.
   - Either layer takes any pattern on its own kit: a percussion kit on Drums plays the pattern's percussion line, a drum kit on
     Aux plays its beat, and picking a pattern never changes a kit or touches the other layer (when the bar length holds).
   - Drums and Aux offer the same patterns, grouped by family, with no kit in the name.
   Run: node tests/drums/roles.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const o = {}, M = window._sqMachines(), st = () => window._sqCaptureState();
    // Hits on a layer, counted by what the lane does: low, backbeat, time, or the role itself where it is none of those.
    // A kit with no clap plays a clap on its snare, a kit with no hat plays the time on its shaker, so the roles can differ
    // from kit to kit while the groove does not.
    const KLASS = { kick: 'low', lo: 'low', back: 'back', clap: 'back', rim: 'back', time: 'time', time2: 'time', ride: 'time', foot: 'time', open: 'time' };
    const roles = i => {
      const s = st(), L = i ? s.aux : { mach: s.mach, grid: s.grid }, by = {};
      Object.keys(L.grid).forEach(k => {
        const n = (L.grid[k] || []).slice(0, s.steps).filter(c => c && c.v > 0).length, t = M[L.mach].tracks[k];
        if (n && t) { const ro = sqRoleOf(L.mach, t.s), c = KLASS[ro] || ro; by[c] = (by[c] || 0) + n; }
      });
      return JSON.stringify(by);
    };
    const kits = () => window._sqDrumKit() + '/' + window._sqAuxKit();

    // 1. The same beat on every drum kit is the same roles.
    window._sqPickDrumKit('808'); window._sqLoadPattern(0, 'Techno');
    const base = roles(0); o.base = base; o.sameRoles = {};
    ['909', 'STUDIO', 'ROCK', 'ACU', '606', 'LIN', '808'].forEach(k => { window._sqPickDrumKit(k); o.sameRoles[k] = roles(0) === base; });
    // The jazz kit keeps its time on the ride; the roles are the same all the same.
    window._sqPickDrumKit('JAZZ'); o.jazz = roles(0) === base;
    // Away and back is exact.
    window._sqPickDrumKit('808'); window._sqLoadPattern(0, 'Drum & Bass');
    const sig = JSON.stringify(st().grid);
    window._sqPickDrumKit('TABLA'); window._sqPickDrumKit('HAND'); window._sqPickDrumKit('808');
    o.roundTrip = JSON.stringify(st().grid) === sig;

    // 2. A percussion kit on Drums plays the line; a drum kit on Aux plays the beat; kits stay as they are.
    window._sqPickDrumKit('TABLA'); window._sqPickAuxKit('ROCK'); window._sqSetFocus(0);
    const k0 = kits();
    window._sqLoadPattern(0, 'Teental'); o.tablaDrums = roles(0); o.drumsPat = window._sqLayerPat(0);
    window._sqLoadPattern(1, '4/4 Rock'); o.rockAux = roles(1); o.auxPat = window._sqLayerPat(1);
    o.kitsKept = kits() === k0; o.drumsUntouched = o.drumsPat === 'Teental' && /low/.test(o.tablaDrums) && /hi/.test(o.tablaDrums);
    o.auxBeat = /low/.test(o.rockAux) && /back/.test(o.rockAux) && /time/.test(o.rockAux);

    // 3. Edited, a layer is Custom, and the swap is from what is there.
    const g = st().aux.grid; Object.keys(g).forEach(k => { if (g[k][3]) g[k][3].v = 1; });
    window._sqRestoreState(Object.assign({}, st(), { aux: Object.assign({}, st().aux, { grid: g }) }));
    o.custom = window._sqLayerPat(1) === null || window._sqLayerPat(1) === undefined;

    // 4. A pattern whose bar is another length takes the bar, and what does not fit is cleared, said aloud.
    window._sqPickAuxKit('PERC'); window._sqSetFocus(0); window._sqLoadPattern(0, '4/4 Basic'); window._sqLoadPattern(1, 'Bossa Nova');
    window._sqLoadPattern(1, 'Afro 6/8'); o.len = st().steps; o.drumsCleared = roles(0) === '{}';

    // 5. One list.
    const d = starterList('drums').map(x => x.id), a = starterList('aux').map(x => x.id);
    o.oneList = JSON.stringify(d) === JSON.stringify(a) && d.every(x => x.indexOf('|') < 0) && d.length >= 50;
    o.fams = starterGroups('aux').map(s => s.sect);
    return o;
  });
  ok(Object.values(r.sameRoles).every(Boolean) && r.jazz, 'the same beat on the 808, 909, Studio, Rock, Acoustic, 606, Linn and Jazz kits is the same kick, backbeat and time', JSON.stringify(r));
  ok(r.roundTrip, 'swapping kits away and back leaves the grid exactly as it was', '');
  ok(r.kitsKept && r.drumsUntouched, 'a pattern on Aux leaves the Drums layer and both kits alone; a percussion kit on Drums plays the line', JSON.stringify(r));
  ok(r.auxBeat, 'a drum kit on Aux plays the pattern\'s beat', r.rockAux);
  ok(r.custom, 'an edited layer no longer claims to be the pattern', '');
  ok(r.len === 12 && r.drumsCleared, 'a 12-step line takes the bar and clears the 16-step layer that cannot fit it', JSON.stringify([r.len, r.drumsCleared]));
  ok(r.oneList && r.fams[0] !== undefined, 'Drums and Aux offer one list of patterns, with no kit in a name', JSON.stringify(r.fams));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
