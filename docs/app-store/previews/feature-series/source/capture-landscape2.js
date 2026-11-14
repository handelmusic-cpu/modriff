(async function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);const pl=modNativePlugin();let epoch=0;
 const log=(event,extra={})=>pl.fileAppend({name:'landscape2-log.jsonl',folder:'PromoSeries',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),t:epoch?(performance.now()-epoch)/1000:0,...extra})+'\n')))});
 const shot=async(name,fn,hold=4500)=>{try{await fn();await wait(400);await log('shot',{name,viewport:[innerWidth,innerHeight],orientation:screen.orientation.type,text:document.body.innerText.slice(-5000)});await wait(hold);}catch(e){await log('shot-error',{name,message:String(e)});}};
 const chord=d=>{const md=MODES[mode];lastTriggeredDegree=d;applyLogicHighlights(d);_triggerChordImmediate(rootMidi()+md.steps[d],md.triadQ[d],md.seventh[d],md.func[d],.6,'9th',true);};
 try{
  await log('boot');setModTier('pro');unlockAudio('blank');await wait(3000);await msxLoadLib();onBpmInput(124);setMeter(4,4);root=0;setMode('major');stopEverything();
  for(const[p,k]of[['chord','keys'],['bass','bass'],['mel','lead'],['melgen','arp']])MSX.state[p]={patch:PROMO_SCORE.channels[k].patch,vals:PROMO_SCORE.channels[k].values};
  setWave('modsynth');setBlWave('modsynth');setMelWave('modsynth');if(window.setMlWave)window.setMlWave('modsynth');modParamsFlush();
  window._sqSetMach('MOD');sqLoadGroove(RHYTHMS.findIndex(r=>/funk/i.test(r.name)));setDrumsEnabled(true);if(!blEnabled)ftBassClick();if(typeof mlEnabled!=='undefined'&&!mlEnabled)ftMelClick();chord(1);if(window.blGenerate)window.blGenerate();if(window.mlGenerate)window.mlGenerate();startEverything();
  const slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(500);slate.remove();epoch=performance.now();await log('begin');
  const roll=(part)=>{studioTab();switchTab('accomp');setAccompMode(part);const id={drums:'ac-drums-panel',bass:'bm-bass-panel',melody:'bm-melody-panel'}[part];document.querySelector('#'+id+' [data-acrow=roll]')?.scrollIntoView({block:'start'});};
  await shot('roll-drums',async()=>{roll('drums');});
  await shot('roll-bass',async()=>{roll('bass');setTimeout(()=>chord(4),1800);});
  await shot('roll-melody',async()=>{roll('melody');setTimeout(()=>chord(0),1500);});
  stopEverything();studioTab();switchTab('perform');setPerformMode('pads');psShow();psSetBank(0);smpOpenSlot(psKey(0,0));
  const raw=Uint8Array.from(atob(PROMO_SAMPLE),c=>c.charCodeAt(0));smpImportFiles([new File([raw],'In Motion loop.wav',{type:'audio/wav'})]);
  for(let n=0;n<100&&!SMP_LIB.find(x=>x.name==='In Motion loop');n++)await wait(100);
  const clip=SMP_LIB.find(x=>x.name==='In Motion loop');if(!clip)throw Error('Sample import failed');smpAttach(psKey(0,0),clip.id);smpOpenSlot(psKey(0,0));await log('sampler-import',{clip:{name:clip.name,duration:clip.dur,frames:SMP_BUF[clip.id].length}});
  await shot('sampler-wave',async()=>{smpOpenSlot(psKey(0,0));});
  await shot('sampler-loop-tune',async()=>{smpEdit('trim');smpEdit('loop');smpEdit('tune',7);});
  await shot('sampler-reverse-warp',async()=>{const s=psSlot(psKey(0,0),true);s.ps.rev=true;s.ps.warp=true;s.ps.sync=true;modParamsFlush();smpRenderAll();psWarpPrime();});
  await shot('sampler-slice',async()=>{smpEdit('tune',0);smpSliceToPads(8);await log('slice-proof',{slots:Array.from({length:8},(_,i)=>{const s=SMP_SLOTS[psKey(0,i)];return {pad:i+1,start:s.start,end:s.end,id:s.id};})});});
  smpClose();
  await shot('sampler-pads',async()=>{studioTab();switchTab('perform');setPerformMode('pads');psShow();document.querySelector('.ps-grid')?.scrollIntoView({block:'start'});for(let i=0;i<16;i++)setTimeout(()=>{psPress(i%8);setTimeout(()=>psRelease(i%8),180);},i*240);});
  await shot('sampler-pattern',async()=>{psRecToggle();for(let i=0;i<16;i++)setTimeout(()=>{psPress(i%8);setTimeout(()=>psRelease(i%8),150);},i*240);});
  try{psRecStop();}catch(e){};try{psStopAll();}catch(e){};stopEverything();
  MSX_UI.audition=false;
  const rack=(page)=>{MSX_UI.page=page;msxOpenFor('chord');msxRackPage();document.querySelector('.mu-tabs')?.scrollIntoView({block:'start'});};
  await shot('synth-overview',async()=>{msxPickPatch('chord','Future Pluck');msxOpenFor('chord');});
  await shot('synth-osc',async()=>{rack('synth');[...document.querySelectorAll('.mu-page.on h2,.mu-page.on h3')].find(e=>/Oscillator 1/.test(e.textContent))?.scrollIntoView({block:'start'});setTimeout(()=>msxSetParam('chord','filter1.cut',1700),1200);});
  await shot('synth-filter',async()=>{const hs=[...document.querySelectorAll('.mu-page.on .panel h2,.mu-page.on .mu-title,.mu-page.on h2,.mu-page.on h3')];const el=hs.find(e=>/filter/i.test(e.textContent));if(el)el.scrollIntoView({block:'start'});await log('rack-headings',{headings:hs.map(e=>e.textContent)});});
  await shot('synth-mod',async()=>{rack('mod');});
  await shot('synth-matrix',async()=>{document.querySelector('.mu-page.on .matrix')?.scrollIntoView({block:'start'});});
  await shot('synth-fx',async()=>{rack('fx');});
  await shot('synth-macros',async()=>{msxPickPatch('chord','Glacier');msxOpenFor('chord');MSX_UI.page='synth';msxRackPage();document.querySelector('.mu-macros')?.scrollIntoView({block:'start'});});
  await log('done');
 }catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
