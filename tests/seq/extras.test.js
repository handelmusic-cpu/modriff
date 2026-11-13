/* Whole-band native scheduler ownership through the actual public transport. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), os=require('os');
const {spawnSync}=require('child_process');
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
    await page.addScriptTag({path:path.join(__dirname,'sampler-fixture.inpage.js')});
    const out=await page.evaluate(async()=>{
      clearTimeout(clockTimer);stopEverything();await window._nativeTransport.stop();
      audioCtx=new OfflineAudioContext(2,48000*8,48000);const sink=audioCtx.createGain();sink.connect(audioCtx.destination);masterDest=()=>sink;window._masterComp=null;
      const B=window._nsBank,X=window._nsExtras,ctx=getCtx(),sr=ctx.sampleRate,bufs=new Map(),calls=[],entries=[],fresh=[];
      const P={seqScore:async()=>({ok:true}),graphBuf:async b=>{bufs.set(b.id,b);return {ok:true};},graphBegin:async()=>({handle:1}),graphEdit:async()=>({ok:true}),seqExtras:async o=>{calls.push(Array.from(new Float64Array(Uint8Array.from(atob(o.score),c=>c.charCodeAt(0)).buffer)));return {ok:true};},seqDrumQueue:async()=>({ok:true}),seqBank:async()=>({ok:true})};
      window.modNativePlugin=()=>P;modGraphEnable(P,['drum','auxperc','bass','chord','mel','melgen','arp','sampler','click']);_ensureAllPartBuses(ctx);
      window._nativeSamplerFixture(true);B.isolated=true;
      async function checkVoice(msg){
       const r=await X.record(msg);entries.push(r.bank);
       for(const onset of [48000,48031,48127]){const rec=await B.record(Object.assign({},msg,{at:(onset-1e-6)/sr}));fresh.push({part:r.bank[1],kit:r.bank[2],lane:r.bank[3],onset,prog:rec&&Array.from(rec.prog)});}
      }
      await checkVoice({kind:'hit',part:'click',id:1,accent:true});await checkVoice({kind:'hit',part:'click',id:1,accent:false});
      for(let lane=0;lane<3;lane++)await checkVoice({kind:'hit',part:'drum',id:1,kit:'rhythm/'+drumKit,lane,vel:1,accent:false,pitch:0,dyn:null});
      SMP_SLOTS['p:A:0']=Object.assign({},SMP_SLOTS['v:bass'],{ps:{mode:'gate'}});
      for(const mode of ['gate','loop'])for(const rev of [false,true]){
       SMP_SLOTS['p:A:0'].ps={mode,rev};modParamsSync();const p=await X.pad('p:A:0');await checkVoice(p.message);
      }
      SMP_SLOTS['p:A:0'].ps={mode:'gate',warp:true,sync:true};modParamsSync();const warped=await X.pad('p:A:0');await checkVoice(warped.message);
      PS_PATS[0]={bars:1,ev:[{s:0,k:'p:A:0',on:true},{s:2,k:'p:A:0',on:false},{s:8,k:'p:A:0',on:true}]};PS_PATS[1]={bars:2,ev:[{s:1.5,k:'p:A:0',on:true}]};PS.pat=0;PS.patNext=1;PS.patOn=true;metronomeOn=true;rhythmOn=true;
      const oldPlaying=window._sqPlaying;window._sqPlaying=()=>true;X.sig=null;const result=await X.sync();window._sqPlaying=oldPlaying;
      const sigs=[];for(const part of ['bass','chord','arp','melgen']){const fn={bass:'signatureBass',chord:'signatureChord',arp:'signatureArp',melgen:'signatureMel'}[part];window._webParams[part+'.voice']='sampler';const a=B[fn]();SMP_SLOTS['v:'+part].fine++;modParamsSync();const b=B[fn]();sigs.push(a!==b);}
      const before=smpNativeSignature('bass'),buf=SMP_BUF['native-sampler-fixture'];smpBufSet('native-sampler-fixture',buf);const replaced=before!==smpNativeSignature('bass');smpBufDrop('native-sampler-fixture');const dropped=!(await B.buildBass('sampler',48)).ok;
      sections=[{name:'A',slots:[{rootM:60,ivs:[0,4,7],bars:1,label:'C'}]}];root=0;_songBaseRoot=0;songLoopActive=true;prac.key.on=true;prac.ramp.on=true;_pracReset();window._nsSong.driving=true;
      const original=JSON.stringify(window._songNativeScore({chords:true}).score);window._songMirror.seen=0;
      window._songMirror.apply({sampleRate:48000,frame:48000,tempo:124,song:{running:true,chorus:2,keyShift:-5,keysDone:2,pending:0,ask:[1,0,0,0,48000,144000,0,0,-5]}});
      const normalized=JSON.stringify(window._songNativeScore({chords:true}).score)===original;
      const trainer=normalized&&root===7&&sections[0].slots[0].rootM===55&&_pracRun.keyShift===-5&&_pracRun.keysDone===2&&+document.getElementById('bpm').value===124;
      window._nsSong.driving=false;window._songMirror.live=false;songLoopActive=false;prac.key.on=prac.ramp.on=false;
      B.isolated=false;return {trainer,sr,entries,fresh,bufs:Array.from(bufs.values()),result,extras:calls[calls.length-1],sigs,replaced,dropped};
    });
    ok(out.trainer,'native practice mirroring changes the display without double-transposing the next score',out.trainer);
    ok(out.result.ok&&out.extras.length>50,'click, rhythm and queued pad patterns prepare together',out.result);
    ok(out.sigs.every(Boolean)&&out.replaced&&out.dropped,'slot edits and same-ID replacement invalidate banks; missing buffers refuse readiness',out);
    ok(out.fresh.every(x=>x.prog),'every extra voice records a fresh reference');
    const data=[out.bufs.length];
    // Buffer offsets in Node Buffers are pooled: use an explicit byte copy.
    data.length=1;for(const b of out.bufs){const ch=b.channels.map(s=>{const raw=Buffer.from(s,'base64');return Array.from(new Float32Array(Uint8Array.from(raw).buffer));});data.push(b.id,b.sampleRate,ch.length,ch[0].length);for(const c of ch)for(const x of c)data.push(x);}
    data.push(out.entries.length);for(const e of out.entries)data.push(e.length,...e);data.push(out.fresh.length);for(const f of out.fresh)data.push(f.part,f.kit,f.lane,1,0,0,f.onset,f.prog.length,...f.prog);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-extras-')),file=path.join(dir,'cases.f64');fs.writeFileSync(file,Buffer.from(Float64Array.from(data).buffer));
    const run=spawnSync(path.join(root,'native/modsynth/banktest'),[file],{encoding:'utf8'});ok(run.status===0,'native bank renders the actual extra voices',run.stderr);
    const rows=run.stdout.trim().split('\n').map(x=>x.split(' '));const depths=rows.map(r=>+r[1]);ok(rows.length===out.fresh.length&&depths.every(d=>d>=90),'all '+rows.length+' extra voice renders match the page (worst '+Math.min(...depths).toFixed(1)+' dB)',run.stdout);
    fs.writeFileSync(path.join(dir,'extras.f64'),Buffer.from(Float64Array.from(out.extras).buffer));console.log('fixture '+dir);
    ok(errors.length===0,'the page threw no errors',errors);
  }finally{await browser.close();server.close();}
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
