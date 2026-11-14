(async function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);const pl=modNativePlugin();
 const log=(event,extra={})=>pl.fileAppend({name:'motion-log.jsonl',folder:'Promo',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 window.addEventListener('error',e=>log('error',{message:String(e.message)}));
 try{
  await log('boot');setModTier('pro');unlockAudio('blank');await wait(3500);await msxLoadLib();
  onBpmInput(124);liveTab();
  setWave('modsynth');setBlWave('modsynth');setMelWave('modsynth');setArpWave('modsynth');
  for(const [part,key]of [['chord','keys'],['bass','bass'],['mel','lead'],['arp','arp']]){
   const c=window.PROMO_SCORE.channels[key];MSX.state[part]={patch:c.patch,vals:c.values};
  }
  msxSaveState();modParamsFlush();
  window._sqSetMach('MOD');sqLoadGroove(RHYTHMS.findIndex(r=>r.name==='4/4 Basic'));
  const chart=window.PROMO_SCORE.chords.map(c=>c.name).join(' ');
  const parsed=songFromChordSheet(parseChordSheet('[In Motion]\n'+chart+'\n'),{len:1});
  root=0;mode='major';sections=parsed.song.sections.map(s=>({...s,name:'In Motion',follow:'repeat',plays:1}));
  saveSLData([]);setlistData=[];curSetlistIdx=-1;document.getElementById('chart-title').value='In Motion';buildSectionTabs();renderChartSeq();renderChords();saveToSetlist();
  setDrumsEnabled(true);if(!blEnabled)ftBassClick();chordsEnabled=true;globalSongMode=true;syncFixedTransport();
  await wait(1800);
  const slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(500);slate.remove();
  const start=performance.now();startEverything();const origin=window.modEngine.now()+.18;
  await log('begin',{native:MODNAT.started,audio:audioCtx.state,title:setlistData[curSetlistIdx].title,bpm:_bpmNow()});
  for(const n of window.PROMO_SCORE.channels.lead.notes){
   modSend({v:1,kind:'note',part:'mel',id:200000+n.id,note:n.n,vel:n.v,at:origin+n.t,dur:n.d,y:.5,tune:0});
   setTimeout(()=>{markMelKeyOn(n.n);setTimeout(()=>{markMelKeyOff(n.n);},n.d*1000);},n.t*1000+180);
  }
  const at=(sec,fn)=>setTimeout(async()=>{try{await fn();}catch(e){await log('action-error',{sec,message:String(e)})}},Math.max(0,sec*1000-(performance.now()-start)));
  const b=60/124*4;
  at(2*b,async()=>{studioTab();switchTab('accomp');setAccompMode('drums');await log('drums');});
  at(4*b,async()=>{setAccompMode('bass');await log('bass');});
  at(6*b,async()=>{liveTab();await log('melody');});
  at(8*b,async()=>{msxOpenFor('chord');await log('synth');});
  at(10*b,async()=>{switchTab('songs');setSongsMode('perform');await log('song');});
  at(12*b,async()=>{switchTab('mix');setMixMode('mixer');await log('mix');});
  at(14*b,async()=>{await log('end',{meters:await pl.meters({})});stopEverything();});
 }catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
