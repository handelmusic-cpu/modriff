/* A line generated while the engine plays the part reaches the engine, and the roll (1.x).

   With the engine playing (window._nativeTransport 'native'), the page's own schedulers sleep, and they are what swapped a line
   written mid-play (_mlPendingGrid / _blPendingGrid) in at the top of the loop. So Generate during play did nothing you could hear
   or see until Stop. Driven on the real page with a fake engine plugin, as tests/seq/transport.test.js does:
     - Generate while playing sends the new line as the engine's waiting line (seqMelPending / seqBassPending, [1, 0, ...]: no
       moment, so it lands at the engine's wrap) and the roll keeps showing what sounds;
     - the roll takes the new line when the mirrored step comes back round, not before;
     - a line written ahead by the engine's song answer (_mlPregen) is not sent twice.

   Run: node tests/gen/handoff.test.js        Env: CHROMIUM, PLAYWRIGHT, ROOT (dist: the built page) */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = process.env.ROOT ? path.resolve(process.env.ROOT) : path.join(__dirname, '../..');   // ROOT=dist runs it on what ships
let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); }
(async () => {
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const chrome = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    await page.waitForTimeout(1200);
    await page.getByText('Start', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    const out = await page.evaluate(async () => {
      clearTimeout(clockTimer); const sleep = ms => new Promise(r => setTimeout(r, ms)), me = window._nativeTransport;
      const calls = [];
      window._sqScheduler = () => {}; window._blScheduler = () => {}; window._mlScheduler = () => {}; window.scheduleArp = () => {};
      window._inNativeApp = () => true;
      MODGRAPH.on = true; MODGRAPH.parts = {drum:true, auxperc:true, bass:true, melgen:true, arp:true, chord:true};
      window.modParamsSync = () => {}; Object.assign(window._webParams, {'bass.voice':'sine','melgen.voice':'sine','arp.voice':'sine','chord.voice':'sine'});
      globalSongMode = false; metronomeOn = false; rhythmOn = false; PS.patOn = false; CR.run = false; prac.key.on = prac.ramp.on = false;
      blEnabled = true; mlEnabled = true; arpOn = false; arpSounding = false;
      const m = {sampleRate:48000, frame:0, nextFrame:24000, nextStep:0, running:false, transport:{owned:false, token:0},
                 bass:{running:false, nextFrame:24000, nextStep:0}, arp:{running:false}, mel:{running:false, nextFrame:24000, nextStep:0}, song:{running:false, ending:{phase:0}}};
      const dec = b => Array.from(new Float64Array(Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer));
      const P = {seqVoices: async () => ({ok:true}), seqBank: async () => ({ok:true}), graphBuf: async () => ({ok:true}), seqDrumQueue: async () => ({ok:true}),
                 seqMirror: async () => JSON.parse(JSON.stringify(m)), setBackgroundPlay: async () => {}, seqObserverRoutes: async () => ({ok:true}),
                 seqObserve: async () => ({ok:true, cursor:0, latest:0, clockReady:false, events:''})};
      for(const name of ['seqIntonation','seqScore','seqBassScore','seqBassChords','seqBassPending','seqMelChords','seqMelScore','seqMelPending','seqArpScore','seqArpNotes','seqArpArm','seqMelArm','seqTempo','seqBassTempo','seqMelTempo'])
        P[name] = async o => { calls.push([name, o]); return {ok:true}; };
      P.seqTransportStart = async o => { m.transport = {owned:true, token:o.token}; m.running = m.bass.running = m.mel.running = true; return {ok:true}; };
      P.seqTransportStop = async o => { m.transport = {owned:false, token:o.token}; m.running = m.bass.running = m.mel.running = false; return {ok:true}; };
      P.graphKillAll = async () => ({ok:true});
      window.modNativePlugin = () => P;
      const ready = () => Promise.resolve({ok:true, built:0, kept:0, failed:[]});
      window._nsBank.ensure = window._nsBank.ensureBass = window._nsBank.ensureMel = window._nsBank.ensureArp = ready;
      window._nsArp.prepare = window._nsMel.prepare = ready; window._nsArp.notes = ready; window._nsMel.chords = ready;
      // Something on both rolls, then play.
      window.mlGenerate(); window.blGenerate();
      startEverything(); await sleep(400);
      const r = {state: me.state, mlPlaying: window._mlPlaying(), blPlaying: window._blPlaying()};
      const key = g => JSON.stringify(g.map(c => c && c.v ? [c.note, c.oct, c.len] : 0));
      const grid = part => key(part === 'mel' ? window._mlCaptureState().grid : window._blCaptureState().grid);
      // ── melody ──
      const melBefore = grid('mel');
      m.mel.nextStep = 9; await me.poll();
      const nPend0 = calls.filter(c => c[0] === 'seqMelPending').length;
      if(window.PhraseGen) window.PhraseGen.forget('mel'); window.mlGenerate();
      await sleep(30);
      const pend = calls.filter(c => c[0] === 'seqMelPending');
      r.melSent = pend.length === nPend0 + 1;
      const d = r.melSent ? dec(pend.at(-1)[1].pending) : [];
      r.melPendingHead = d.slice(0, 4);
      r.melHeldOnRoll = grid('mel') === melBefore;
      m.mel.nextStep = 13; await me.poll();
      r.melStillHeld = grid('mel') === melBefore;
      m.mel.nextStep = 2; await me.poll();
      const melAfter = grid('mel');
      r.melLanded = melAfter !== melBefore;
      // The cells the engine was sent are the cells on the roll now.
      const sentCells = []; for(let i = 0, k = 4; i < d[3]; i++){ const v = d[k], note = d[k+1], oct = d[k+2], len = d[k+3]; k += 8; const nx = d[k]; k += 1 + nx * 2; sentCells.push(v ? [note, oct, len] : 0); }
      r.melSameAsSent = JSON.stringify(sentCells) === melAfter;
      // A written-ahead line (the song answer's) is not handed over again.
      const nPend1 = calls.filter(c => c[0] === 'seqMelPending').length;
      window._mlPregen(62, [0,3,7], null); await sleep(20);
      r.pregenNotSent = calls.filter(c => c[0] === 'seqMelPending').length === nPend1;
      window._mlLand();
      // ── bass ──
      const bassBefore = grid('bass');
      m.bass.nextStep = 7; await me.poll();
      const nB = calls.filter(c => c[0] === 'seqBassPending').length;
      if(window.PhraseGen) window.PhraseGen.forget('bass'); window.blGenerate(); await sleep(30);
      const bp = calls.filter(c => c[0] === 'seqBassPending');
      r.bassSent = bp.length === nB + 1;
      r.bassPendingHead = r.bassSent ? dec(bp.at(-1)[1].pending).slice(0, 4) : [];
      r.bassHeld = grid('bass') === bassBefore;
      m.bass.nextStep = 1; await me.poll();
      r.bassLanded = grid('bass') !== bassBefore;
      stopEverything(); await sleep(100);
      return r;
    });
    ok(out.state === 'native' && out.mlPlaying && out.blPlaying, 'the engine owns the band, melody and bass playing', out);
    ok(out.melSent, 'Generate while playing sends the melody line to the engine', out);
    ok(out.melPendingHead[0] === 1 && out.melPendingHead[1] === 0, 'as a waiting line with no moment (lands at the wrap)', out.melPendingHead);
    ok(out.melHeldOnRoll && out.melStillHeld, 'the roll keeps the sounding line until the engine wraps', out);
    ok(out.melLanded && out.melSameAsSent, 'the roll takes the new line when the step comes back round, the same cells the engine got', out);
    ok(out.pregenNotSent, 'a line written ahead for the song answer is not sent twice', out);
    ok(out.bassSent && out.bassPendingHead[0] === 1 && out.bassPendingHead[1] === 0, 'the bass: sent to the engine as a waiting line', out);
    ok(out.bassHeld && out.bassLanded, 'the bass: held, then landed at the wrap', out);
    ok(!errors.length, 'no page errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
