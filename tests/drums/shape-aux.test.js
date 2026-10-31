/* Shape on the Aux layer, and the reduced Shape of a recorded drum (4.9.9.9.9.9.9g).

   - Aux has its own Shapes: sqShapes['aux:<kit>'], apart from the kit's, even on the same kit.
   - The Shape sheet follows the layer being edited, and so does its lane button.
   - A shaped Aux hit (part 'auxperc') is built with the Aux layer's Shape and lands on a
     different node than a shaped kit hit does (the Aux bus, not the kit's).
   - Reset on one layer leaves the other alone.
   - A recorded drum's sheet offers Level, Tune, Tone, Drive and Pan, and no Decay, Sweep
     or Body; a synthesised one on the same layer still offers them.
   Run: node tests/drums/shape-aux.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(b); } });
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

  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const o = {};
    const rowsOf = () => [...document.querySelectorAll('.sq-shape-row .sq-shape-l')].map(e => e.textContent);
    const setRow = (label, v) => {
      const row = [...document.querySelectorAll('.sq-shape-row')].find(x => x.querySelector('.sq-shape-l').textContent === label);
      const rg = row.querySelector('input'); rg.value = v; rg.dispatchEvent(new Event('input')); rg.dispatchEvent(new Event('change'));
    };
    const readout = label => [...document.querySelectorAll('.sq-shape-row')].find(x => x.querySelector('.sq-shape-l').textContent === label).querySelector('.sq-shape-v').textContent;
    const closeSheet = () => { const c = document.querySelector('.ll-cancel'); if (c) c.click(); };
    const reset = () => { [...document.querySelectorAll('.sq-shape-act .ll-act')].find(b => /Reset/.test(b.textContent)).click(); };

    // Kit layer on the 808, Aux layer on the 606: two layers, two kits.
    window._sqPickDrumKit('808'); await wait(300);
    window._sqPickAuxKit('606'); await wait(400);
    o.auxKit = window._sqAuxKit();

    // The lane's Shape button appears on the Aux layer now.
    o.auxButtons = document.querySelectorAll('.sq-shape-btn').length;

    // Shape the Aux 606 kick: pan left, decay long.
    window.sqShapeSheet(0); await wait(900);
    o.auxRows = rowsOf();
    setRow('Pan', -0.5); setRow('Decay', 2);
    await wait(200);
    const S = window._sqParams().shapes;
    o.keys = Object.keys(S);
    o.auxShape = S['aux:606'] && S['aux:606'][0] ? { n: S['aux:606'][0].n, d: S['aux:606'][0].d } : null;
    o.kitKeyTouched = !!(S['606'] && S['606'][0]) || !!(S['808'] && S['808'][0]);
    closeSheet(); await wait(200);

    // The kit layer's 808 kick is unshaped, and its sheet reads Centre.
    window._sqSetFocus(0); await wait(400);
    window.sqShapeSheet(0); await wait(900);
    o.kitPanReadout = readout('Pan'); o.kitRows = rowsOf();
    closeSheet(); await wait(200);

    // The engine: count panners and see where each one goes. A shaped Aux hit
    // builds one (Pan was set); an unshaped kit hit does not.
    const ctx = getCtx();
    // Each panner is tagged with the hit that built it, so the hits the sheet's
    // "Hear it" sends in between are not counted as ours.
    const made = []; let tag = '';
    const origPan = ctx.createStereoPanner.bind(ctx);
    ctx.createStereoPanner = function () { const p = origPan(); const c = p.connect.bind(p); const mine = tag; p.connect = function (d) { made.push({ tag: mine, d, pan: p.pan.value }); return c.apply(null, arguments); }; return p; };
    const hit = (t, part, kit, lane) => { tag = t; window._webDrumHit({ v: 1, kind: 'hit', part, id: Math.random(), kit, lane, vel: .8, accent: false, pitch: 0, dyn: null, at: ctx.currentTime + 0.05 }); tag = ''; };
    const count = t => made.filter(m => m.tag === t).length;
    hit('aux1', 'auxperc', '606', 0);
    o.panAux1 = count('aux1');
    hit('plain', 'drum', '808', 0);
    o.panKitPlain = count('plain');
    // Now shape the SAME 606 on the kit layer's key and play it as a kit hit: the
    // panner it builds has to feed a different node from the Aux one.
    S['606'] = { 0: { d: 1, t: 0, x: 0, s: 1, b: 0, n: 0.5 } };
    // The engine reads its own copy of the Shapes (_wp('drum.shapes')), which the page
    // syncs when it next sends a hit (modSend). A direct write to sqShapes needs one:
    // "Hear it" in the open sheet is a real hit through modSend.
    window._sqSetFocus(1); await wait(300);
    window.sqShapeSheet(0); await wait(700);
    [...document.querySelectorAll('.sq-shape-act .ll-act')].find(b => /Hear it/.test(b.textContent)).click(); await wait(400);
    closeSheet(); await wait(200);
    hit('kit606', 'drum', '606', 0);
    o.panKitShaped = count('kit606');
    const da = made.find(m => m.tag === 'aux1'), dk = made.find(m => m.tag === 'kit606');
    o.destsExist = !!(da && dk && da.d && dk.d);
    o.sameDest = !!(da && dk && da.d === dk.d);
    // The Aux hit does not take the kit's shape and the kit's does not take Aux's:
    // a second Aux hit still builds exactly one panner.
    hit('aux2', 'auxperc', '606', 0);
    o.panAux2 = count('aux2');
    const val = t => { const m = made.find(x => x.tag === t); return m ? Math.round(m.pan * 100) / 100 : null; };
    o.pans = { aux1: val('aux1'), kit606: val('kit606'), aux2: val('aux2') };
    delete S['606'];

    // Reset on the Aux layer leaves the kit layer alone.
    S['808'] = { 0: { d: 1, t: 0, x: 0, s: 1, b: 0, n: 0.3 } };
    window._sqSetFocus(1); await wait(400);
    window.sqShapeSheet(0); await wait(900);
    reset(); await wait(300); closeSheet(); await wait(200);
    o.auxAfterReset = !!(S['aux:606'] && S['aux:606'][0]);
    o.kitAfterAuxReset = S['808'] && S['808'][0] ? S['808'][0].n : null;
    delete S['808'];

    // A recorded Aux kit gets the reduced set; a synthesised lane keeps its own.
    window._sqPickAuxKit('TABLA'); await wait(600);
    window.sqShapeSheet(0); await wait(900);
    o.recRows = rowsOf(); closeSheet(); await wait(200);
    window._sqPickAuxKit('PERC'); await wait(600);
    window.sqShapeSheet(1); await wait(900);   // Tamb: a synthesised drum with body
    o.percRows = rowsOf(); closeSheet();
    return o;
  });

  console.log(JSON.stringify(r));
  ok(r.auxKit === '606', 'Aux layer is on the 606', r.auxKit);
  ok(r.auxButtons > 0, 'the lane Shape buttons show on the Aux layer', r.auxButtons);
  ok(r.auxRows.indexOf('Pan') >= 0 && r.auxRows.indexOf('Decay') >= 0, 'the Aux sheet has Decay and Pan', r.auxRows);
  ok(r.auxShape && r.auxShape.n === -0.5 && r.auxShape.d === 2, "the Shape is stored under 'aux:606'", JSON.stringify(r.auxShape));
  ok(!r.kitKeyTouched, "nothing is written under the kit layer's keys", JSON.stringify(r.keys));
  ok(r.kitPanReadout === 'Centre', "the kit layer's drum reads Centre while Aux's is panned", r.kitPanReadout);
  ok(r.panAux1 === 1, 'a shaped Aux hit builds a panner', r.panAux1);
  ok(r.panKitPlain === 0, 'an unshaped kit hit builds none', r.panKitPlain);
  ok(r.panKitShaped === 1 && r.destsExist && !r.sameDest, 'a shaped kit hit builds one that feeds a different node from the Aux one', JSON.stringify({ n: r.panKitShaped, same: r.sameDest, exist: r.destsExist }));
  ok(r.panAux2 === 1, "a second Aux hit builds one panner too", r.panAux2);
  ok(r.pans.aux1 === -0.5 && r.pans.kit606 === 0.5 && r.pans.aux2 === -0.5, "each hit takes its own layer's pan: Aux -0.5, kit +0.5, Aux again -0.5 (not the kit's)", JSON.stringify(r.pans));
  ok(r.auxAfterReset === false, 'Reset clears the Aux drum', r.auxAfterReset);
  ok(r.kitAfterAuxReset === 0.3, "Reset on Aux leaves the kit layer's drum alone", r.kitAfterAuxReset);
  const REDUCED = ['Level', 'Tune', 'Tone', 'Drive', 'Pan'];
  ok(JSON.stringify(r.recRows) === JSON.stringify(REDUCED), 'a recorded drum is offered Level, Tune, Tone, Drive and Pan only', JSON.stringify(r.recRows));
  ok(r.percRows.indexOf('Decay') >= 0 && r.percRows.indexOf('Body') >= 0, 'a synthesised drum on the same layer keeps Decay and Body', JSON.stringify(r.percRows));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
