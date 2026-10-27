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
    const gl = []; page.on('console', m => { if (m.text().startsWith('GCHECK')) gl.push(m.text()); });
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
        // The mixer's meter for each: the host's while it plays the part, the web bus's when
        // the part is on a patch (the worklet is the web's).
        if(!getCtx()) audioCtx = new AudioContext();
        _ensureAllPartBuses(getCtx());
        window._webParams['bass.voice'] = 'upright';
        out.meterHost = _mixAnalyserFor('bass') === MODNAT.meterTap.bass;
        window._webParams['bass.voice'] = 'modsynth';
        { const an = _mixAnalyserFor('bass'); out.meterWebOnPatch = an !== MODNAT.meterTap.bass && !!an; }
        // The master meter adds the host master's RMS (slot 8 of meters) to the web master's.
        masterDest(getCtx());
        MODNAT.plugin.meters = () => Promise.resolve({ rms: [0, 0, 0, 0, 0, 0, 0, 0, 0.3] });
        { const m = _mixMasterAnalyserGet(), b = new Float32Array(256); m.getFloatTimeDomainData(b);
          await new Promise(r => setTimeout(r, 150)); m.getFloatTimeDomainData(b);
          out.masterMeter = { host: typeof m.web !== 'undefined', rms: Math.round(_mixLevel(m) * 1000) / 1000 }; }
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
      ok(r.masterMeter.host && Math.abs(r.masterMeter.rms - 0.3) < 0.02, 'the master meter includes the host master', JSON.stringify(r.masterMeter));
      ok(r.meterHost && r.meterWebOnPatch, 'the mixer meter reads the host for a graph part and the web bus for one on a patch', JSON.stringify([r.meterHost, r.meterWebOnPatch]));
    }
    // The Settings switch: the app starts the path itself, no console.
    {
      const t = await page.evaluate(async () => {
        const o = {};
        toggleGraphPath(); await new Promise(r => setTimeout(r, 600));
        o.saved = localStorage.getItem('modo-graph-path');
        o.on = MODGRAPH.on; o.parts = Object.keys(MODGRAPH.parts).sort(); o.failed = !!MODGRAPH.failed;
        o.btn = document.querySelector('[data-graphpath]').textContent;
        await new Promise(r => _graphStatusText(t => { o.status = t; r(); }));
        toggleGraphPath(); await new Promise(r => setTimeout(r, 100));
        o.savedOff = localStorage.getItem('modo-graph-path'); o.btnOff = document.querySelector('[data-graphpath]').textContent;
        await new Promise(r => _graphStatusText(t => { o.statusOff = t; r(); }));
        return o;
      });
      if (withGraph) {
        ok(t.saved === '1' && t.on && t.btn === 'Native sound: ON', 'the Settings switch turns the path on and keeps the choice', JSON.stringify(t));
        ok(['arp','auxperc','bass','chord','click','drum','mel','melgen','sampler'].join() === t.parts.join(), 'every part, the click included, is played as graphs', JSON.stringify(t.parts));
        ok(/^Nothing played yet\. 0 notes sent/.test(t.status), 'the status line reads the counters', t.status);
        ok(t.savedOff === '0' && t.btnOff === 'Native sound: OFF' && /off after you restart/.test(t.statusOff), 'switching it off says it waits for a restart', JSON.stringify(t));
      } else {
        ok(t.failed && !t.on && /^Not available in this build/.test(t.status), 'an older host: the switch says it is not available and changes nothing', JSON.stringify(t));
      }
    }
    if (withGraph) {
      // gcheck: the phone check prints one verdict line (plus the one that says to play).
      await page.evaluate(() => { gcheck(['drum'], 1); });
      await page.waitForTimeout(1800);
      ok(gl.length === 2 && /^GCHECK running 1s/.test(gl[0]) && /^GCHECK FAIL drum 1s \| sent 0 .*nothing was sent/.test(gl[1]), 'gcheck prints two short lines and says when nothing was played', JSON.stringify(gl));
    }
    await page.close();
  }
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all within expectation');
  process.exit(fail ? 1 : 0);
})();
