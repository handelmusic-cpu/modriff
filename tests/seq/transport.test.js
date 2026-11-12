/* Whole-band native scheduler ownership through the actual public transport. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.join(__dirname, '../..');
let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); }
(async () => {
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.PAGE_PATH || '/index.html'));
    await page.waitForTimeout(1200);
    await page.getByText('Start', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    const out = await page.evaluate(async () => {
      clearTimeout(clockTimer);const sleep=ms=>new Promise(r=>setTimeout(r,ms)),me=window._nativeTransport;
      const web=!me.enabled(),calls=[],counts={drum:0,bass:0,mel:0,arp:0};
      window._sqScheduler=()=>counts.drum++;window._blScheduler=()=>counts.bass++;window._mlScheduler=()=>counts.mel++;window.scheduleArp=()=>counts.arp++;
      window._inNativeApp=()=>true;localStorage.removeItem('modo-bgtest');
      MODGRAPH.on=true;MODGRAPH.parts={drum:true,auxperc:true,bass:true,melgen:true,arp:true,chord:true};
      window.modParamsSync=()=>{};Object.assign(window._webParams,{'bass.voice':'sine','melgen.voice':'sine','arp.voice':'sine','chord.voice':'sine'});
      globalSongMode=false;metronomeOn=false;rhythmOn=false;PS.patOn=false;CR.run=false;prac.key.on=prac.ramp.on=false;
      blEnabled=true;mlEnabled=true;arpOn=true;arpSounding=false;
      const m={sampleRate:48000,frame:0,nextFrame:24000,nextStep:0,running:false,transport:{owned:false,token:0},bass:{running:false,nextFrame:24000,nextStep:0},arp:{running:false},mel:{running:false,nextFrame:24000,nextStep:0},song:{running:false,ending:{phase:0}}};
      const P={seqMirror:async()=>JSON.parse(JSON.stringify(m)),setBackgroundPlay:async o=>calls.push(['background',o.on]),seqObserverRoutes:async()=>({ok:true}),seqObserve:async()=>({ok:true,cursor:0,latest:0,clockReady:false,events:''})};
      for(const name of ['seqIntonation','seqScore','seqBassScore','seqBassChords','seqBassPending','seqMelChords','seqMelScore','seqMelPending','seqArpScore','seqArpNotes','seqArpArm','seqMelArm','seqTempo','seqBassTempo','seqMelTempo'])P[name]=async o=>{calls.push([name,o]);return {ok:true};};
      P.seqTransportStart=async o=>{calls.push(['start',Array.from(new Float64Array(Uint8Array.from(atob(o.options),c=>c.charCodeAt(0)).buffer)),o.token]);m.transport={owned:true,token:o.token};m.running=m.bass.running=m.arp.running=m.mel.running=true;return {ok:true};};
      P.seqTransportStop=async o=>{calls.push(['stop',o.token]);m.transport={owned:false,token:o.token};m.running=m.bass.running=m.arp.running=m.mel.running=false;return {ok:true};};
      window.modNativePlugin=()=>P;
      const ready=()=>Promise.resolve({ok:true,built:0,kept:0,failed:[]});
      window._nsBank.ensure=window._nsBank.ensureBass=window._nsBank.ensureMel=window._nsBank.ensureArp=ready;
      window._nsArp.prepare=window._nsMel.prepare=ready;
      window._nsArp.notes=ready;window._nsMel.chords=ready;
      startEverything();await sleep(350);const native={state:me.state,counts:{...counts},starts:calls.filter(c=>c[0]==='start'),bg:_bgKeepPlaying(),last:me.last};
      tickClock();const suppressed=Object.values(counts).every(x=>x===0);
      stopEverything();await sleep(100);const stopped=me.state==='page'&&!m.transport.owned;
      // Cancelling while bank preparation is pending must prevent any native
      // claim, even if that asynchronous work completes after the Stop.
      let release;window._nsBank.ensure=()=>new Promise(r=>release=r);
      let before=calls.filter(c=>c[0]==='start').length;
      startEverything();await sleep(50);stopEverything();await sleep(30);release({ok:true,failed:[]});await sleep(100);
      const cancelled=calls.filter(c=>c[0]==='start').length===before && me.state==='page';
      window._nsBank.ensure=ready;
      const realStart=P.seqTransportStart;let finishStart;
      P.seqTransportStart=async o=>{const r=await realStart(o);return new Promise(resolve=>finishStart=()=>resolve(r));};
      startEverything();await sleep(70);stopEverything();await sleep(40);finishStart();await sleep(80);
      const lateResponse=me.state==='page'&&!m.transport.owned&&!_bgKeepPlaying();P.seqTransportStart=realStart;
      before=calls.filter(c=>c[0]==='start').length;
      // A refused preparation resumes the entire page band and cannot grant
      // background permission. No native start is issued for that run.
      window._nsBank.ensure=async()=>({ok:false,why:'unsupported fixture'});
      Object.keys(counts).forEach(k=>counts[k]=0);startEverything();await sleep(250);
      const fallback={state:me.state,last:me.last,pageNotes:Object.values(counts).reduce((a,b)=>a+b,0),starts:calls.filter(c=>c[0]==='start').length,bg:_bgKeepPlaying()};
      stopEverything();await sleep(100);if(window._nsEvents.timer)clearInterval(window._nsEvents.timer);
      return {web,native,suppressed,stopped,cancelled,lateResponse,fallback,before,calls};
    });
    ok(out.web,'the ordinary web page never claims native scheduling',out);
    ok(out.native.state==='native' && out.native.starts.length===1 && out.native.starts[0][1].slice(5,8).every(x=>x===1),'one native claim starts the enabled bass, arp and melody with the drum clock',out.native);
    ok(out.suppressed && out.native.bg,'native ownership suppresses every page scheduler and grants background permission',out.native);
    ok(out.stopped && out.cancelled && out.lateResponse,'Stop clears ownership and cancels a delayed preparation before it can start',out);
    ok(out.fallback.state==='page' && out.fallback.pageNotes>0 && out.fallback.starts===out.before && !out.fallback.bg,'failed readiness resumes the whole page band without a native start or background grant',out.fallback);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
