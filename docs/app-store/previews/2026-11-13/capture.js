(async function(){
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 await pause(2500);
 const pl=modNativePlugin();
 async function log(event,extra={}){
  await pl.fileAppend({name:'film-log.jsonl',folder:'Promo',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 }
 window.addEventListener('error',e=>log('error',{message:String(e.message)}));
 window.addEventListener('unhandledrejection',e=>log('reject',{message:String(e.reason)}));
 try{
  await log('boot');
  localStorage.setItem('modo-tour-ch1','1');setModTier('pro');unlockAudio('blank');await pause(4000);
  liveTab();onBpmInput(100);setWave('rhodes');setMelWave('sine');setBlWave('electric');
  if(!holdMode)toggleHold();
  window._sqSetMach('MOD');
  const groove=RHYTHMS.findIndex(r=>r.name==='4/4 Basic');sqLoadGroove(groove);
  setDrumsEnabled(false);blEnabled=false;mlEnabled=false;
  document.getElementById('chart-title').value='First light';
  const parsed=songFromChordSheet(parseChordSheet('[First light]\nCmaj7 Am7 Fmaj7 G7\n'),{len:'lines',lineBars:4});
  sections=parsed.song.sections.map(s=>({name:s.name,follow:'repeat',plays:1,slots:s.slots.map(x=>({beats:0,eighths:0,isRest:false,...x}))}));
  buildSectionTabs();renderChartSeq();updateFtSongBtn();syncFixedTransport();
  // Files are already saved by the real recorder; skip the share sheet after filming.
  _deliverFiles=async function(files,opts){await log('saved',{names:files.map(f=>f.name),folder:opts&&opts.folder});};
  toggleRecording();await pause(2500);
  const slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);
  await pause(500);slate.remove();
  const epoch=performance.now();await log('begin',{audio:audioCtx.state,native:MODNAT.started,recording:_isRecording});
  const at=(sec,fn)=>setTimeout(async()=>{try{await fn();}catch(e){await log('action-error',{sec,message:String(e)})}},Math.max(0,sec*1000-(performance.now()-epoch)));
  function chord(degree){
   lastTriggeredDegree=degree;applyLogicHighlights(degree);
   const md=MODES[mode];return _triggerChordImmediate(rootMidi()+md.steps[degree],md.triadQ[degree],md.seventh[degree],md.func[degree],0.65,'7th',true);
  }
  const progression=[0,5,3,4,0,5,3,4,3,0];
  startEverything();
  for(let bar=0;bar<20;bar++)at(bar*2.4,()=>chord(progression[bar%10]));
  at(4.8,()=>ftDrumClick());at(9.6,()=>ftBassClick());at(14.4,()=>toggleArp());
  [72,76,79,76,74,72,71,72].forEach((n,i)=>at(19.2+i*.6,()=>{playMelNote(n,.65,true);setTimeout(()=>releaseMelNote(n),410)}));
  at(24,async()=>{studioTab();switchTab('accomp');setAccompMode('drums');await log('studio');});
  at(30,()=>setAccompMode('bass'));
  at(36,()=>{setAccompMode('melody');if(!mlEnabled)ftMelClick();});
  at(42,()=>setAccompMode('arp'));
  at(48,async()=>{switchTab('songs');setSongsMode('perform');if(!globalSongMode)toggleGlobalSongMode();await log('song');});
  at(60,async()=>{switchTab('mix');await log('sound');});
  at(72,async()=>{await log('end',{meters:await pl.meters({})});toggleRecording();});
  at(80,async()=>{await log('done',{recording:_isRecording});});
 }catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
