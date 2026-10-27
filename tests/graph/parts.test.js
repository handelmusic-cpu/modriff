/* Every part's mõdSynth is played by the host (4.9.9.9.9.9.5t), against a stand-in
   for the native plugin. Until then only the chord's was; bass, melody, Melody Seq
   and arp stayed on their worklets in a native-sound session.

   - A part's slot in MODNAT.PART is its slot in MODGRAPH.CODE: a part played as
     graphs and the same part on a patch share one strip in the host.
   - Each part's engine asks the host for a Processor in that slot (the chord's at
     start, the rest when their engine is first built), and its notes are posted to
     that slot, not to the chord's.
   - The host's strip carries the web bus's fixed gain (bass 0.36, Melody Seq 0.6),
     which the worklet's trim went through on the web.
   - A host that refuses the Processor leaves the worklet plugged in.
   - A part set to a voice the web plays is not the host's: the meter reads the web
     bus. Flipping a graph part between a patch and a graph voice moves the strip
     level between the calibrated one and 1, and notes go to the right place.

   Run: node tests/graph/parts.test.js   Env: CHROMIUM, PLAYWRIGHT */
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
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
const stub = refuse => `
  const L = window.__log = { ensure: [], posts: [], graph: 0 };
  const ok = v => Promise.resolve(v || {});
  window.Capacitor = { isNativePlatform: () => true, Plugins: { ModEngine: {
    start: () => ok({ sampleRate: 48000 }),
    ensurePart: o => { L.ensure.push(o); return ${refuse} && o.part !== 0 && !o.graph ? Promise.reject(new Error('no')) : ok({ part: o.part }); },
    post: o => { o.msgs.forEach(m => L.posts.push(m)); return ok({ queued: o.msgs.length }); },
    stats: () => ok({}), meters: () => ok({ rms: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), fileDelete: () => ok(), graphProbe: () => ok({ graph: true }),
    graphBuf: () => ok(), graphBegin: () => { L.graph++; return ok({ handle: 1 }); }, graphEdit: () => ok({}),
  } } };`;
const PARTS = ['chord', 'mel', 'melgen', 'bass', 'arp'];

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async refuse => {
    const page = await browser.newPage();
    page.errs = []; page.on('pageerror', e => page.errs.push(String(e)));
    await page.addInitScript(stub(refuse));
    await page.goto(url); await page.waitForTimeout(1500);
    return page;
  };
  const build = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    unlockAudio('blank'); await sleep(800); getCtx();
    VOICE_PARTS.forEach(p => p.set('modsynth'));
    ${JSON.stringify(PARTS)}.forEach(p => modSend({ v: 1, kind: 'prepare', part: p, voice: 'modsynth' }));
    await sleep(3500);
  })()`;

  // ── the native app, every part on a patch ──
  {
    const page = await open(false);
    const r = await page.evaluate(async build => {
      await eval(build);
      const out = {};
      out.slots = { part: MODNAT.PART, code: MODGRAPH.CODE };
      out.attached = PARTS_OF(MODNAT.attached); function PARTS_OF(o) { return Object.keys(o).filter(k => o[k] && o[k].port).sort(); }
      out.ensure = window.__log.ensure;
      out.strips = {}; window.__log.posts.filter(m => m.t === 'strip' && m.i === 0).forEach(m => out.strips[m.part] = m.v);
      out.expect = {}; ['chord', 'mel', 'melgen', 'bass', 'arp'].forEach(p => { const mx = _wp('mix.' + p); out.expect[MODNAT.PART[p]] = _msxCal(p) * (mx == null ? 1 : mx) * _modNativeBusGain(p); });
      out.busGain = { bass: _modNativeBusGain('bass'), melgen: _modNativeBusGain('melgen'), mel: _modNativeBusGain('mel') };
      window.__log.posts.length = 0;
      const now = modEngine.now();
      modEngine.send({ v: 1, kind: 'note', part: 'bass', id: 11, note: 40, vel: 0.9, dur: 0.4, slide: false, from: null, at: now + 0.2 });
      modEngine.send({ v: 1, kind: 'note', part: 'melgen', id: 12, note: 67, vel: 0.8, dur: 0.3, accent: false, at: now + 0.2 });
      modEngine.send({ v: 1, kind: 'note', part: 'arp', id: 13, note: 64, vel: 0.8, dur: 0.2, level: 1, pan: 0, at: now + 0.2 });
      modEngine.send({ v: 1, kind: 'note', part: 'mel', id: 14, note: 72, vel: 0.8, dur: 0.4, y: 0.2, at: now + 0.2 });
      await new Promise(r => setTimeout(r, 600));
      out.noteOns = {}; window.__log.posts.filter(m => m.t === 'on').forEach(m => out.noteOns[m.part] = (out.noteOns[m.part] || 0) + 1);
      out.carries = {}; ['chord', 'mel', 'melgen', 'bass', 'arp'].forEach(p => out.carries[p] = _modNativeCarries(p));
      // Bass set to a web voice: still attached, no longer the host's.
      VOICE_PARTS.find(p => p.k === 'bass').set('electric');
      _ensureAllPartBuses(getCtx());
      out.bassOnWeb = { carries: _modNativeCarries('bass'), meterIsHost: _mixAnalyserFor('bass') === MODNAT.meterTap.bass };
      VOICE_PARTS.find(p => p.k === 'bass').set('modsynth');
      out.bassBack = { carries: _modNativeCarries('bass'), meterIsHost: _mixAnalyserFor('bass') === MODNAT.meterTap.bass };
      return out;
    }, build);
    ok(PARTS.every(p => r.slots.part[p] === r.slots.code[p]), 'MODNAT.PART and MODGRAPH.CODE name the same slots', JSON.stringify(r.slots));
    ok(JSON.stringify(r.attached) === JSON.stringify(PARTS.slice().sort()), 'all five engines are handed to the host', JSON.stringify(r.attached));
    ok(PARTS.every(p => r.ensure.some(e => e.part === r.slots.part[p] && e.warm && !e.graph)), 'each asked the host for a Processor in its own slot', JSON.stringify(r.ensure));
    ok(r.ensure.filter(e => e.part === 0).length === 1, 'and the chord\'s is asked for once (at start)', JSON.stringify(r.ensure));
    ok([0, 1, 2, 3, 4].every(c => Math.abs(r.strips[c] - r.expect[c]) < 1e-6), 'each strip is calibration x fader x the web bus\'s gain', JSON.stringify([r.strips, r.expect]));
    ok(Math.abs(r.busGain.bass - 0.36) < 1e-5 && Math.abs(r.busGain.melgen - 0.6) < 1e-5 && r.busGain.mel === 1, 'bass 0.36, Melody Seq 0.6, the rest unity', JSON.stringify(r.busGain));
    ok(r.noteOns[3] === 1 && r.noteOns[2] === 1 && r.noteOns[4] === 1 && r.noteOns[1] === 1 && r.noteOns[0] === undefined, 'a note on each part reaches that part\'s slot and no other', JSON.stringify(r.noteOns));
    ok(PARTS.every(p => r.carries[p]), 'every part reads as the host\'s while on a patch', JSON.stringify(r.carries));
    ok(!r.bassOnWeb.carries && !r.bassOnWeb.meterIsHost, 'a part set to a web voice reads the web bus', JSON.stringify(r.bassOnWeb));
    ok(r.bassBack.carries && r.bassBack.meterIsHost, 'and the host again on a patch', JSON.stringify(r.bassBack));
    ok(page.errs.length === 0, 'no page errors', page.errs.join('|'));
    await page.close();
  }

  // ── the host cannot build the Processor (an older binary) ──
  {
    const page = await open(true);
    const r = await page.evaluate(async build => {
      await eval(build);
      return { attached: Object.keys(MODNAT.attached).filter(k => MODNAT.attached[k] && MODNAT.attached[k].port), proc: Object.keys(MODNAT.proc).filter(k => MODNAT.proc[k]), bassCarries: _modNativeCarries('bass') };
    }, build);
    ok(r.attached.length === 1 && r.attached[0] === 'chord' && !r.bassCarries, 'a refused Processor leaves that worklet plugged in (the chord, built at start, is the only one)', JSON.stringify(r));
    await page.close();
  }

  // ── a graph part: the patch and the graph voices share one strip ──
  {
    const page = await open(false);
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      unlockAudio('blank'); await sleep(800); getCtx();
      out.started = await modGraphStart(['chord', 'mel', 'melgen', 'bass', 'arp', 'drum']);
      const bass = VOICE_PARTS.find(p => p.k === 'bass');
      const strips = () => window.__log.posts.filter(m => m.t === 'strip' && m.part === 3 && m.i === 0).map(m => +(+m.v).toFixed(4));
      bass.set('electric'); await sleep(200);
      modSend({ v: 1, kind: 'prepare', part: 'bass', voice: 'modsynth' });
      bass.set('modsynth'); await sleep(3000);
      out.attached = { proc: !!MODNAT.proc.bass, port: !!(MODNAT.attached.bass && MODNAT.attached.bass.port), graph: !!(MODNAT.attached.bass && MODNAT.attached.bass.graph) };
      const note = id => modEngine.send({ v: 1, kind: 'note', part: 'bass', id, note: 40, vel: 0.9, dur: 0.4, slide: false, from: null, at: modEngine.now() + 0.2 });
      const count = () => ({ graph: window.__log.graph, ons: window.__log.posts.filter(m => m.t === 'on' && m.part === 3).length });
      const reset = () => { window.__log.posts.length = 0; window.__log.graph = 0; };
      reset(); note(21); await sleep(500); out.onPatch = count(); const patchLevel = _msxCal('bass') * (_wp('mix.bass') == null ? 1 : _wp('mix.bass')) * _modNativeBusGain('bass');
      reset(); bass.set('electric'); await sleep(300); out.toWeb = { strip: strips(), onGraph: _mgOnGraph('bass') };
      note(22); await sleep(500); out.onGraphVoice = count();
      reset(); bass.set('modsynth'); await sleep(300); out.back = { strip: strips(), onGraph: _mgOnGraph('bass'), level: +patchLevel.toFixed(4) };
      return out;
    });
    ok(r.started && r.attached.proc && r.attached.port && r.attached.graph, 'a patch on a graph part gets a Processor and stays a graph part', JSON.stringify(r.attached));
    ok(r.onPatch.graph === 0 && r.onPatch.ons === 1, 'its note on a patch is the Processor\'s, not a graph voice', JSON.stringify(r.onPatch));
    ok(JSON.stringify(r.toWeb.strip) === '[1]' && r.toWeb.onGraph, 'set to a graph voice, the strip goes to 1 (the voice scales itself)', JSON.stringify(r.toWeb));
    ok(r.onGraphVoice.graph === 1 && r.onGraphVoice.ons === 0, 'and its note is a graph voice, not the Processor\'s', JSON.stringify(r.onGraphVoice));
    ok(r.back.strip.length === 1 && r.back.strip[0] === r.back.level && !r.back.onGraph, 'back on the patch the strip returns to the calibrated level', JSON.stringify(r.back));
    ok(page.errs.length === 0, 'no page errors', page.errs.join('|'));
    await page.close();
  }

  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all within expectation');
  process.exit(fail ? 1 : 0);
})();
