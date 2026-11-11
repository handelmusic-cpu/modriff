/* Drive shipped UI, count pattern saves, parse real MIDI tracks and decode the bounced WAV.
   PLAYWRIGHT=/path/to/playwright node tests/launch/navigation-export.test.cjs */
const {chromium}=require(process.env.PLAYWRIGHT || 'playwright');
const fs=require('fs'), http=require('http'), path=require('path'), assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((q,r)=>{ const f=path.join(root,decodeURIComponent(q.url.split('?')[0])); fs.readFile(f,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':f.endsWith('.html')?'text/html':'application/octet-stream'});r.end(e?'':b);}); });
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/dist/index.html`);
 await page.getByText('Start',{exact:true}).first().click();
 await page.waitForTimeout(1500);
 await page.evaluate(()=>{setModTier('pro');_tabGo('live');});
 const state=()=>page.evaluate(()=>({root,mode,tab:TAB_ORDER.find(t=>document.getElementById('tab-'+t).classList.contains('active'))}));
 let a=await state(); await page.locator('#tab-live').focus(); await page.keyboard.press('ArrowRight'); let b=await state();
 assert.equal(b.root,(a.root+1)%12);assert.equal(b.mode,a.mode);assert.equal(b.tab,'live');
 await page.keyboard.press('ArrowDown');let c=await state();assert.notEqual(c.mode,b.mode);assert.equal(c.root,b.root);
 await page.keyboard.press('Tab');assert.equal((await state()).tab,'studio');
 await page.keyboard.press('Shift+Tab');assert.equal((await state()).tab,'live');console.log('PASS focused tab arrows change key/scale; Tab and Shift+Tab cycle sections');
 const result=await page.evaluate(async()=>{
  window.setBlGenStyle('funk');window.blGenerate();ftBassClick();startEverything();
  const before=rhyBankList('bass').length;
  // Real name dialog, including Enter submission, while the transport runs.
  for(let i=0;i<25;i++){
   starterSaveOpen();
   [...document.querySelectorAll('.modal-overlay.visible .ll-act')].find(b=>b.firstChild.textContent==='Bass').click();
   const inp=document.querySelector('.modal-overlay.visible input.rhy-name');inp.value='Bass test '+i;
   inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   await new Promise(r=>setTimeout(r,70));
  }
  const saved=rhyBankList('bass').length-before;
  const persisted=JSON.parse(modStore.getItem(RHY_BANK_KEY)).filter(e=>e.kind==='bass').length;
  const realWrite=modStore.setItem;
  modStore.setItem=function(k,v){if(k===RHY_BANK_KEY)throw new Error('disk full');return realWrite.call(this,k,v);};
  starterSaveOpen();[...document.querySelectorAll('.modal-overlay.visible .ll-act')].find(b=>b.firstChild.textContent==='Bass').click();
  const retryInput=document.querySelector('.modal-overlay.visible input.rhy-name');retryInput.value='Retry this bass';
  const retryButton=document.querySelector('.modal-overlay.visible .rhy-primary');retryButton.click();
  const failureSafe=rhyBankList('bass').length===before+25 && retryInput.isConnected && retryInput.value==='Retry this bass' && !retryButton.disabled;
  modStore.setItem=realWrite;retryButton.click();retryButton.click();
  const retryOnce=rhyBankList('bass').length===before+26 && !retryInput.isConnected;
  // Queue a kit and groove via the same setters used by the lists.
  const kits=Object.keys(window._sqMachines()); const kit=kits.find(k=>k!==window._sqDrumKit());
  PP_SPECS['live-drums-kit'].items().flatMap(s=>s.list).find(i=>i.label===window._sqKitLabel(kit)).pick();
  const gi=RHYTHMS.findIndex((r,i)=>i!==sqCurGroove);sqLoadGroove(gi);partPickSync();
  await new Promise(r=>setTimeout(r,50));
  const queuedName=document.querySelector('.st-row[data-part=drums] .st-name').textContent;
  const feedback=!!document.querySelector('.st-row[data-part=drums] .st-name.gen-queued');
  const voice=document.querySelector('.st-row[data-part=drums] .st-vname');
  const voiceFeedback=voice.textContent===window._sqKitLabel(kit) && voice.classList.contains('gen-queued');
  stopEverything();
  _startMidiRecording();const t=getCtx().currentTime;
  window._midiRecLogDrum('Kick',t,.8,false,'drum');window._midiRecLogDrum('Clap',t,.8,false,'auxperc');
  const midi=_stopMidiRecording();const bytes=new Uint8Array(await midi.blob.arrayBuffer());
  // Parse MTrk chunks and their names, rather than matching exporter source.
  const dv=new DataView(bytes.buffer),tracks=[];let off=14;
  while(off<bytes.length){const len=dv.getUint32(off+4);const tr=bytes.slice(off+8,off+8+len);let name='';for(let i=0;i<tr.length-3;i++)if(tr[i]===255&&tr[i+1]===3){name=String.fromCharCode(...tr.slice(i+3,i+3+tr[i+2]));break;}tracks.push({name,ons:[...tr].filter(x=>x===0x99).length});off+=8+len;}
  return {saved,persisted,failureSafe,retryOnce,queuedName,wantName:RHYTHMS[gi].name,feedback,voiceFeedback,tracks};
 });
 assert.equal(result.saved,25);assert.ok(result.persisted>=25);console.log('PASS 25 bass patterns saved via dialog during playback and persisted');
 assert.ok(result.failureSafe&&result.retryOnce);console.log('PASS storage failure preserves bank and typed name; retry commits exactly once');
 assert.equal(result.queuedName,result.wantName);assert.ok(result.feedback&&result.voiceFeedback);console.log('PASS queued feel and voice immediately name selection and show pending indicators');
 assert.ok(result.tracks.find(t=>t.name==='Drums'&&t.ons));assert.ok(result.tracks.find(t=>t.name==='Aux'&&t.ons));console.log('PASS MIDI has separate Drums and Aux tracks with channel-10 note events');
 const wav=await page.evaluate(async()=>{
  window._exportName=async()=> 'Tail test';
  window.__take=null;window._deliverFiles=async files=>{window.__take=files;};
  exportStems=true;_startRecording();
  const ctx=getCtx(), osc=ctx.createOscillator(), gain=ctx.createGain();osc.frequency.value=220;
  gain.gain.setValueAtTime(.15,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.00001,ctx.currentTime+3);
  osc.connect(gain);gain.connect(_partDest(ctx,'chord'));osc.start();osc.stop(ctx.currentTime+3.1);
  await new Promise(r=>setTimeout(r,400));_stopRecording();
  const finishing=_recFinishing;const takeId=_recTake;toggleRecording();const guarded=_recTake===takeId;
  const start=Date.now();while(!window.__take&&Date.now()-start<18000)await new Promise(r=>setTimeout(r,100));
  const files=window.__take;if(!files)throw Error('bounce delivery timed out');
  const blob=files.find(f=>/\.wav$/.test(f.name)).blob;const buffer=await blob.arrayBuffer();const audio=await ctx.decodeAudioData(buffer);
  const data=audio.getChannelData(0),sr=audio.sampleRate;let liveAfterStop=0,latePeak=0;
  for(let i=Math.round(sr*1.4);i<Math.min(data.length,sr*2.4);i++)if(Math.abs(data[i])>.0005)liveAfterStop++;
  for(let i=Math.round(sr*7);i<data.length;i++)latePeak=Math.max(latePeak,Math.abs(data[i]));
  return {duration:audio.duration,liveAfterStop,latePeak,finishing,guarded,files:files.map(f=>f.name)};
 });
 assert.ok(wav.duration>=8);assert.ok(wav.liveAfterStop>1000);assert.ok(wav.finishing&&wav.guarded);assert.ok(wav.latePeak<.001);console.log('PASS WAV tail and guarded finish:',JSON.stringify(wav));
 assert.deepEqual(errors,[]);console.log('PASS no uncaught page errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
