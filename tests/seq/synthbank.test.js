/* Processor descriptors and actual msxVoice/Engine messages, compared with the
   native players. The DSP itself remains covered by the existing null tests. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.join(__dirname, '../..'); let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); }
(async () => {
  const srv = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const base = 'http://127.0.0.1:' + srv.address().port;
    await page.goto(base + (process.env.PAGE_PATH || '/index.html'));
    await page.waitForTimeout(1000); await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1000);
    await page.addScriptTag({ url: base + '/modsynth/params.js' }); await page.addScriptTag({ url: base + '/modsynth/engine.js' });
    const cases = [2,5,6].map(part => ({ part, notes: [
      { at: 48000.25, note: 60, dur: 0.2, vel: 0.7 },
      { at: 52800.75, note: 64, dur: 0.012, vel: 0.1, accent: true, from: 60, slide: true },
      { at: 60000.25, note: 67, dur: 0.4, vel: 1, accent: true },
      { at: 72000.75, note: 48, dur: 0.15, vel: 0.4, from: 67 },
      { at: 86400.25, note: 72, dur: 0.1, vel: 0.2, ...(part === 5 ? { note:-1, tones:[48,60,64,67] } : {}) }
    ] }));
    cases.push({part:3, notes:[
      {at:48000.25,note:60,tones:[60,64,67],dur:0.2,vel:0.8},
      {at:52800.75,note:60,tones:[52,60,64,67],dur:0.1,vel:0.3,accent:true,slide:true,from:0.012},
      {at:72000.25,note:62,tones:[62,66,69],dur:1,vel:1,accent:true,slide:true,from:-1},
      {at:96000.75,note:48,tones:[48,55,60,64,67],dur:0.4,vel:0.5,from:-1}
    ]});
    const out = await page.evaluate(async cases => {
      clearTimeout(clockTimer); const sr = 48000, backing = audioCtx;
      // Keep the already-built part buses on their real context while freezing
      // the scheduling clock. Only the silent msxVoice handles are constructed.
      const ctx = new Proxy(backing, {get:(t,p) => p === 'currentTime' ? 0 : p === 'sampleRate' ? sr : typeof t[p] === 'function' ? t[p].bind(t) : t[p]});
      window.getCtx = () => ctx; audioCtx = ctx; MODGRAPH.on = false;
      const sink = ctx.createGain(); sink.connect(ctx.destination); window.masterDest = () => sink;
      _ensureAllPartBuses(ctx);
      const events = [];
      for (const c of cases) {
        const part = {2:'bass',3:'chord',5:'arp',6:'melgen'}[c.part], trace = [];
        const eng = Object.create(MS.Engine.prototype);
        eng.ready = true; eng.ctx = ctx; eng.asleep = false;
        eng.node = { port: { postMessage: m => trace.push({ kind:m.t === 'on' ? 'N' : m.t === 'off' ? 'R' : 'C', at:m.at, id:m.id, note:m.note, vel:m.vel || 0 }) } };
        MSX.eng[part] = eng; MSX.trim[part] = ctx.createGain();
        window._webParams[part + '.voice'] = 'modsynth'; window._webParams['mix.' + part] = 1;
        for (const n of c.notes) {
          const m = { v:1, kind: n.tones ? 'chord' : 'note', part, id:1, note:n.note, at:n.at / sr, dur:n.dur,
            vel:n.vel, accent:!!n.accent, slide:!!n.slide, from:n.from == null ? null : n.from, tune:0, level:0.55, pan:-0.75,
            glideFrom:n.from == null ? null : n.from, glideTime:0.08, notes:n.tones, tunes:n.tones && n.tones.map(() => 0) };
          if(c.part === 3) {
            Object.assign(window._webParams, {'chord.sub':false,'chord.attack':0.025,'chord.strum':!!n.accent,'chord.strumSpread':0.12});
            m.root = n.note; m.bass = null; m.dur = n.slide ? null : n.dur;
          }
          window._webEngineSend ? window._webEngineSend(m) : window.modEngine.web(m);
          if(c.part === 3 && n.slide && n.from >= 0) window.modEngine.web({v:1,kind:'release',part:'chord',at:(n.at / sr) + n.from});
        }
        events.push(trace);
      }
      // Prepare through production ensure* methods, while standing in for just
      // the asynchronous worklet/host attachment at this browser boundary.
      const entries = [], calls = [], dec = b => Array.from(new Float64Array(Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer));
      let accept = true;
      const P = { seqScore: () => Promise.resolve({ok:true}), seqBank: o => { entries.push(dec(o.entry)); return Promise.resolve({ok:accept}); } };
      const starts = [];
      for (const name of ['seqBassScore','seqBassChords','seqBassPending','seqArpScore','seqArpNotes','seqMelScore','seqMelChords','seqMelPending']) P[name] = async () => ({ok:true});
      for (const name of ['seqBassStart','seqArpStart','seqMelStart']) P[name] = async o => { starts.push({name,kit:o.kit}); return {ok:true}; };
      window.modNativePlugin = () => P;
      window.modNativeStart = async () => true;
      window.msxEnsure = async part => { calls.push('ensure:' + part); return {ready:true}; };
      window._modNativeEnsureProc = async part => { calls.push('processor:' + part); return true; };
      window._modNativeAttach = part => calls.push('attach:' + part);
      window.msxApply = part => calls.push('patch:' + part);
      window._modNativeStripSync = part => calls.push('strip:' + part);
      window._modNativeFlush = () => calls.push('flush');
      MODGRAPH.on = true; MODGRAPH.parts = {bass:true,melgen:true,arp:true,chord:true};
      window._nsBank.have = {}; window._nsBank.bad = {};
      const prepared = [await window._nsBank.ensureBass(), await window._nsBank.ensureArp(), await window._nsBank.ensureMel(), await window._nsBank.ensureChord([])];
      const nEntries = entries.length;
      const started = [await window._nsBass.start(250), await window._nsArp.start(250), await window._nsMel.start(250)];
      const kept = await window._nsBank.ensureMel();
      delete window._nsBank.have['processor:melgen']; accept = false;
      const oldHost = await window._nsBank.ensureMel();
      window._modNativeEnsureProc = async () => false;
      const noProcessor = await window._nsBank.ensureBass();
      return {events, starts, started, entries:entries.slice(0,nEntries), calls, prepared, kept, oldHost, noProcessor,
        scores:[window._blNativeScore(),window._arpNativeScore(),window._mlNativeScore()], kit:[window._nsKitCode('bass:modsynth'),window._nsKitCode('arp:modsynth'),window._nsKitCode('mel:modsynth'),window._nsKitCode('chord:modsynth')]};
    }, cases);
    const flat = [cases.length];
    for (const c of cases) { flat.push(c.part, c.notes.length); for (const n of c.notes) flat.push(n.at,n.note,n.dur*48000,n.vel,n.accent?1:0,n.slide?1:0,n.from==null?-1:n.from,(n.tones||[]).length,...(n.tones||[])); }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modriff-synth-')), file = path.join(tmp, 'cases.f64');
    fs.writeFileSync(file, Buffer.from(Float64Array.from(flat).buffer));
    const run = spawnSync(process.env.SYNTHSEQTEST || path.join(root,'native/modsynth/synthseqtest'), [file], {encoding:'utf8'});
    ok(run.status === 0, 'the native players accept Processor descriptors', run.stderr);
    const native = []; let n = -1;
    for (const line of run.stdout.split('\n')) { if (line.startsWith('CASE ')) { n++; native[n] = []; } else if (/^[NRC] /.test(line)) { const f = line.split(' '); native[n].push({kind:f[0],at:+f[1],id:+f[2],note:+f[3],vel:+f[4]}); } }
    const normalize = trace => { const ids = new Map(); return trace.map(e => { if (!ids.has(e.id)) ids.set(e.id,ids.size+1); return {...e,id:ids.get(e.id)}; }); };
    cases.forEach((c,i) => ok(JSON.stringify(normalize(native[i]||[])) === JSON.stringify(normalize(out.events[i])) && out.events[i].length >= 10,
      'part ' + c.part + ': every note and release matches real msxVoice/Engine messages (' + out.events[i].length + ' messages)', {native:normalize(native[i]||[]),page:normalize(out.events[i])}));
    ok(out.prepared.every(r => r.built === 1 && r.failed.length === 0) && out.entries.length === 4 && out.entries.every((e,i) => e[0] === 2 && e[1] === [2,5,6,3][i] && e[2] === out.kit[i] && e[3] === -1), 'all four preparation paths publish a Processor descriptor', out);
    ok(out.started.every(s => s.ok) && out.starts.length === 3 && out.starts.every((s,i) => s.kit === out.kit[i]), 'developer start entries choose the Processor-backed bank codes', out.starts);
    ok(out.scores.every(s => s.ok), 'the scores accept the three supported patch parts', out.scores.map(s=>s.why));
    ok(out.kept.kept === 1 && out.calls.includes('attach:melgen') && out.calls.includes('patch:melgen'), 'cached descriptors keep the live patch-control and strip path', out);
    ok(out.oldHost.failed.length === 1 && out.noProcessor.failed.length === 1, 'older binaries and an unready Processor fail preparation explicitly', out);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); srv.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
