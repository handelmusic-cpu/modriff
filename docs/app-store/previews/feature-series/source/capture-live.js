(async function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);const pl=modNativePlugin();
 const log=(event,extra={})=>pl.fileAppend({name:'live-log.jsonl',folder:'PromoSeries',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 window.addEventListener('error',e=>log('error',{message:String(e.message)}));
 try{
  await log('boot');setModTier('pro');unlockAudio('blank');await wait(3000);await msxLoadLib();onBpmInput(124);
  for(const[part,key]of[['chord','keys'],['bass','bass'],['mel','lead'],['arp','arp']]){const c=PROMO_SCORE.channels[key];MSX.state[part]={patch:c.patch,vals:c.values};}
  setWave('modsynth');setBlWave('modsynth');setMelWave('modsynth');setArpWave('modsynth');msxSaveState();modParamsFlush();
  liveTab();LV_XOFF={chords:true,melody:true};LV_OPEN={fx:false};lvSet(['chords','melody','fx']);
  window._sqSetMach('MOD');let ix=RHYTHMS.findIndex(r=>/funk/i.test(r.name));sqLoadGroove(ix>=0?ix:RHYTHMS.findIndex(r=>r.name==='4/4 Basic'));setDrumsEnabled(true);
  const bassStyle=starterList('bass').find(x=>/funk|groove/i.test(x.label));if(bassStyle)starterApply('bass',bassStyle);if(!blEnabled)ftBassClick();
  fxTargets=['chord','mel'];fxSetAxis('x','lpsweep');fxSetAxis('y','delay');fxSetMix('chord',.50);fxSetMix('mel',.40);fxSetPos(1,0);fxEngage(false);
  document.getElementById('chart-title').value='In Motion — Live';if(!exportStems)toggleStemExport();bounceMidi=true;
  _deliverFiles=async function(files,opts){
   const folder=opts&&opts.folder||'PromoSeries/Exports';
   for(const f of files){if(!f.blob)continue;const a=new Uint8Array(await f.blob.arrayBuffer());for(let pos=0;pos<a.length;pos+=48000)await pl.fileAppend({name:f.name,folder,data:modPlatform.b64Of(a.subarray(pos,Math.min(a.length,pos+48000))),first:pos===0});}
   await log('files',{folder,files:files.map(f=>({name:f.name,native:!!f.native,bytes:f.blob&&f.blob.size}))});
  };
  toggleRecording();await wait(2500);
  const slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(500);slate.remove();
  const zero=performance.now();await log('begin',{recordStarted:_recT0,viewport:[innerWidth,innerHeight],parts:PARTS.map(p=>({id:p.id,color:p.color})),modeCount:Object.keys(MODES).length,liveRects:[...document.querySelectorAll('#lv-slots>.lv-slot')].map(e=>({mod:e.dataset.mod,rect:e.getBoundingClientRect().toJSON()}))});
  const at=(sec,fn)=>setTimeout(async()=>{try{await fn();}catch(e){await log('action-error',{sec,message:String(e)})}},Math.max(0,sec*1000-(performance.now()-zero)));
  const beat=60/124,bar=4*beat;startEverything();
  const seq=[1,4,0,5,3,2,1,4];
  for(let b=0;b<25;b++)at(b*bar,()=>{const deg=seq[b%8],md=MODES[mode];lastTriggeredDegree=deg;applyLogicHighlights(deg);_triggerChordImmediate(rootMidi()+md.steps[deg],md.triadQ[deg],md.seventh[deg],md.func[deg],.65,'9th',true);});
  for(let lap=0;lap<2;lap++)for(const n of PROMO_SCORE.channels.lead.notes){const t=n.t+lap*PROMO_SCORE.duration;if(t>46.5)continue;at(t,()=>{playMelNote(n.n,.65,true,.5);setTimeout(()=>releaseMelNote(n.n),n.d*1000);});}
  at(7.7,async()=>{fxEngage(true);await log('fx-on');});
  const fxTimer=setInterval(()=>{const t=(performance.now()-zero)/1000;if(t>=7.7&&t<22){const u=(t-7.7)/14.3;fxSetPos(.72+.24*Math.cos(u*Math.PI*3),.08+.20*Math.sin(u*Math.PI)**2);}},50);
  at(11.6,()=>{if(drumsEnabled)ftDrumClick();});at(15.48,()=>{if(!drumsEnabled)ftDrumClick();});
  at(22,async()=>{fxSetPos(1,0);fxRelease();clearInterval(fxTimer);await log('fx-off');});
  at(27.1,async()=>{await log('film-end',{meters:await pl.meters({}),fx:[fxPadX,fxPadY],midi:_midiRecOn});});
  at(48,async()=>{await log('take-end',{recording:_isRecording});toggleRecording();});
  at(62,async()=>{await log('done',{recording:_isRecording});});
 }catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
