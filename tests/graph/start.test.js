/* modGraphStart: how the app turns the graph path on, against a stand-in for the
   native plugin. Nothing calls it yet; this is the part of the page the host's
   Swift will meet first, so it is held here.

   - An older host (no graph methods) changes nothing.
   - A newer one is probed, each part is given its slot, a strip and mõdFX, the
     strip's level is 1 for a part played as graphs (its voices scale themselves
     by the fader already) and the usual one for a part on a mõdSynth patch.
   (A hit reaching the plugin as graphBegin is page.test.js's.)

   Run: node tests/graph/start.test.js   Env: CHROMIUM, PLAYWRIGHT */
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

// A stand-in for the ModEngine plugin: every call is recorded and resolves.
function stubScript(withGraph) {
  return `
    window.__calls = [];
    const rec = (name) => (o) => { window.__calls.push([name, JSON.parse(JSON.stringify(o || {}))]); return Promise.resolve({ sampleRate: 48000 }); };
    const methods = ['start','stop','ensurePart','post','stats','meters','shareFile','fileAppend','shareFiles','fileDelete','wavFinish','pcmAdd','captureStart','captureRead','captureStop'];
    ${withGraph ? "methods.push('graphProbe','graphBuf','graphBegin','graphEdit');" : ''}
    const P = {}; methods.forEach(m => P[m] = rec(m));
    window.Capacitor = { isNativePlatform: () => true, Plugins: { ModEngine: P } };
  `;
}

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

  for (const withGraph of [false, true]) {
    const page = await browser.newPage();
    await page.addInitScript(stubScript(withGraph));
    await page.goto(url); await page.waitForTimeout(1500);
    const r = await page.evaluate(async withGraph => {
      const out = {};
      out.started = await modGraphStart(['drum', 'bass']);
      out.on = MODGRAPH.on;
      out.attached = Object.keys(MODNAT.attached);
      out.graphFlags = { drum: !!(MODNAT.attached.drum && MODNAT.attached.drum.graph), bass: !!(MODNAT.attached.bass && MODNAT.attached.bass.graph) };
      out.onGraph = { drum: _mgOnGraph('drum'), bass: _mgOnGraph('bass') };
      if (withGraph) {
        // a flush of the strip queue, then what was posted for the drum strip
        await new Promise(r => setTimeout(r, 200));
        out.ensure = window.__calls.filter(c => c[0] === 'ensurePart').map(c => c[1]);
        out.probes = window.__calls.filter(c => c[0] === 'graphProbe').length;
        out.strip = MODNAT.strip;
        // A mõdSynth engine built on a part that is played as graphs has no Processor on
        // the host: it must stay on its worklet (not be unplugged and forwarded), while
        // the chord, which has one, is still handed over.
        const fake = () => { const e = { ready: true, unplugged: 0, values: [], fx: { input: {} }, node: { port: { postMessage() {} }, disconnect() { e.unplugged++; } },
                              setAll() {}, pushMatrix() {}, pushMotion() {} }; return e; };
        const eb = fake(), ec = fake();
        _modNativeSync('bass', eb); _modNativeSync('chord', ec);
        await new Promise(r => setTimeout(r, 200));
        out.bassMsxUnplugged = eb.unplugged; out.bassMsxAttached = !!MODNAT.attached.bass.port;
        out.chordMsxUnplugged = ec.unplugged;
        // a bass part on a mõdSynth patch is the Processor's, and keeps the calibrated level
        window._webParams['bass.voice'] = 'modsynth';
        out.bassOnGraphWhenModsynth = _mgOnGraph('bass');
        window._webParams['bass.voice'] = 'upright';
      }
      return out;
    }, withGraph);
    if (!withGraph) {
      ok(r.started === false, 'an older host: modGraphStart resolves false');
      ok(r.on === false && !r.attached.includes('drum') && !r.attached.includes('bass'), 'and changes nothing', JSON.stringify(r));
    } else {
      ok(r.started === true, 'a newer host: modGraphStart resolves true');
      ok(r.on === true && r.probes === 1, 'the path is on, after one probe', JSON.stringify({ on: r.on, probes: r.probes }));
      ok(r.graphFlags.drum && r.graphFlags.bass && r.onGraph.drum && r.onGraph.bass, 'both parts are marked as graph parts');
      ok(r.ensure.some(e => e.part === 5 && e.graph === true) && r.ensure.some(e => e.part === 3 && e.graph === true), 'ensurePart was asked for each part by its slot, as a graph part', JSON.stringify(r.ensure));
      ok(r.bassMsxUnplugged === 0 && !r.bassMsxAttached, 'a mõdSynth engine on a graph part stays on its worklet (not unplugged)', JSON.stringify({ u: r.bassMsxUnplugged, a: r.bassMsxAttached }));
      ok(r.chordMsxUnplugged > 0, 'and the chord, which has a Processor, is still handed to the host', String(r.chordMsxUnplugged));
      ok(r.strip.drum === 1 && r.strip.bass === 1, 'the host strip level for a graph part is 1 (the voices scale themselves)', JSON.stringify(r.strip));
      ok(r.bassOnGraphWhenModsynth === false, 'a part on a mõdSynth patch is not a graph part');
    }
    await page.close();
  }
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all within expectation');
  process.exit(fail ? 1 : 0);
})();
