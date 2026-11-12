/* Retained native musical events feed real page MIDI lanes, recording time and routing. */
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
      clearTimeout(clockTimer); let wall=1000000; const realNow=Date.now; Date.now=()=>wall;
      const ctx={currentTime:20,sampleRate:48000}; window.getCtx=()=>ctx;
      const sent=[], b64=d=>_mgB64(Float64Array.from(d)), me=window._nsEvents;
      window.moNoteOn=(lane,note,vel)=>{sent.push(['on',lane,note,vel]);return true;};
      window.moNoteOff=(lane,note)=>{sent.push(['off',lane,note]);return true;};
      window.moAllOff=()=>sent.push(['panic']);
      me.cursor=0;me.pending=new Map();me.offset=null;
      _midiRecOn=true; _midiRecNotes=[];_midiRecWallStart=wall;_midiRecNativeCut=false;
      const response=(events,cursor,lost=0)=>({ok:true,clockReady:true,clockOffsetMs:1000000,sampleRate:48000,frame:0,events:b64(events),cursor,latest:cursor,lost});
      const first=response([
        1,1,0,36,95,4800,7680,
        2,1,2,48,80,4800.25,20000,
        3,1,6,64,85,4800.75,18000,
        4,1,6,67,85,4800.75,18000,
        5,1,5,72,90,4800,17000,
        6,1,3,60,100,4800,900000,
        7,1,3,64,100,4800,900000
      ],7);
      // Simulate a frozen AudioContext and a late poll after all short notes
      // sounded. Native frame time must still place all seven in the take.
      wall+=500; me.consume(first); const notes=_midiRecNotes.map(n=>({...n}));
      me.consume(first); const retried=_midiRecNotes.length;
      me.consume(response([8,2,3,0,0,12000,12000],8));
      const held=_midiRecNotes.filter(n=>n.lane==='chord').map(n=>n.tOff);
      // A queued future on is cancelled by a cut before its onset.
      wall=1000600;me.consume(response([9,1,5,75,90,30960,36000],9));
      me.consume(response([10,2,5,0,0,30000,30000],10));
      await new Promise(r=>setTimeout(r,80)); const cancelled=!sent.some(x=>x[0]==='on'&&x[2]===75);
      me.consume(response([],10,9)); const loss=_midiRecNativeCut && me.lost===9 && me.last.why.includes('overflow');
      // Route masks come from the existing MIDI lane/local policy and the
      // production GM table, including distinct kit and Aux mappings.
      let routes;
      window.modNativePlugin=()=>({seqScore:async()=>({ok:true}),seqObserverRoutes:async o=>{routes=o;return {ok:true};}});
      window.moSilences=lane=>lane==='bass'||lane==='melgen';me.routesSig='';await me.routes();
      const map=Array.from(new Float64Array(Uint8Array.from(atob(routes.routes),x=>x.charCodeAt(0)).buffer));
      me.pending.forEach(n=>me.cancel(n));me.pending.clear();_midiRecOn=false;Date.now=realNow;
      return {notes,retried,held,cancelled,loss,mask:routes.localMask,mapCount:map.length/3,sent};
    });
    ok(out.notes.length===7 && out.retried===7,'delayed and repeated reads retain all seven notes once',out);
    ok(out.notes[1].tOn===100.00520833337214 && out.notes[2].tOn===100.015625,'fractional engine frames map to recording time while AudioContext is frozen',out.notes);
    ok(out.held.length===2 && out.held.every(t=>t===250),'a retained chord cut closes both held MIDI notes at its native frame',out.held);
    ok(out.cancelled,'a cut cancels a queued MIDI note before its onset',out.sent);
    ok(out.loss,'overflow marks the take incomplete and remains visible',out);
    ok(out.mask===(127 & ~(1<<2) & ~(1<<6)) && out.mapCount>100,'external-only mask and real drum/Aux GM routes reach the host',out);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
