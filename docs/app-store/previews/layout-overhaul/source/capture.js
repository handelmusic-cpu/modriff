// App preview capture only. The runner appends this to a disposable Debug Simulator bundle.
(async function(){
 var wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);
 var pl=modNativePlugin(),kind=window.LAYOUT_PREVIEW;
 var log=(event,extra={})=>pl.fileAppend({name:kind+'.jsonl',folder:'LayoutCapture',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 window.addEventListener('error',e=>log('error',{message:e.message}));
 var shot=async(name,fn)=>{try{await fn();await log('shot',{name,viewport:[innerWidth,innerHeight],page:document.querySelector('.tab-page.active')?.id});}catch(e){await log('error',{name,message:String(e),stack:e.stack});}};
 try{
  await log('boot');localStorage.setItem('modo-tour-ch1','1');setModTier('pro');unlockAudio('blank');await wait(8000);await msxLoadLib();
  var built=songFromChordSheet(parseChordSheet('[Verse]\nDm9 G13 Cmaj9 Am9\n[Chorus]\nFmaj9 G13 Cmaj9 Am9\n[Bridge]\nEm7 Am9 Dm9 G13\n'),{len:1});
  sections=built.song.sections.map(s=>({...s,follow:'next',plays:1}));root=0;setMode('major');onBpmInput(124);document.getElementById('chart-title').value='In Motion';buildSectionTabs();renderChartSeq();
  window._sqSetMach('MOD');var groove=RHYTHMS.findIndex(r=>/funk/i.test(r.name));if(groove>=0)sqLoadGroove(groove);setDrumsEnabled(true);
  var bass=starterList('bass').find(x=>/funk|groove/i.test(x.label));if(bass)starterApply('bass',bass);if(!blEnabled)ftBassClick();
  setWave('piano');setBlWave('saw');setMelWave('sine');setMlWave('modsynth');if(kind==='instruments')mlGenerateAndArm();await psFactoryEnsure();
  globalSongMode=true;startEverything();startSongLoop();
  _deliverFiles=async function(files){
   for(var f of files){if(!f.blob)continue;var a=new Uint8Array(await f.blob.arrayBuffer());for(var i=0;i<a.length;i+=48000)await pl.fileAppend({name:f.name,folder:'LayoutCapture/'+kind,data:modPlatform.b64Of(a.subarray(i,Math.min(a.length,i+48000))),first:i===0});}
   await log('files',{files:files.map(f=>({name:f.name,native:f.native,bytes:f.blob&&f.blob.size}))});
  };
  _exportName=async()=> 'In Motion - '+kind;
  if(exportStems)toggleStemExport();bounceMidi=true;toggleRecording();await wait(6000);
  if(kind==='live'){liveTab();lvSet(['chords','melody','fx']);}else if(kind==='instruments')studioShow('drums');else{switchTab('songs');setSongsMode('build');}
  var slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(1000);
  var zero=Date.now();slate.remove();await log('begin',{audioOffset:(zero-_recT0)/1000,viewport:[innerWidth,innerHeight],version:MODRIFF_VERSION});
  var at=(t,name,fn)=>setTimeout(()=>shot(name,fn),Math.max(0,t*1000-(Date.now()-zero)));
  if(kind==='live'){
   await shot('live-chords',()=>{});
   var noteTimer=setInterval(()=>{var n=60+[0,2,4,7,9][Math.floor((Date.now()-zero)/500)%5];playMelNote(n,.55,true,.35);setTimeout(()=>releaseMelNote(n),280);},500);
   at(5,'live-melody',()=>document.querySelector('.mel-keys-host').scrollIntoView({block:'center',behavior:'smooth'}));
   at(10,'key-and-scales',()=>{document.querySelector('.tab-page.active').scrollTop=0;ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);});
   at(15,'live-fx',()=>{document.querySelector('.chordpick-pop')?.parentElement?.classList.remove('open');cpClose();document.body.click();document.getElementById('modfx-panel').scrollIntoView({block:'center',behavior:'smooth'});fxTargets=['chord','mel'];fxSetAxis('x','lpsweep');fxSetAxis('y','delay');fxSetMix('chord',.4);fxSetMix('mel',.4);fxEngage(true);});
   var fxTimer=setInterval(()=>{var t=(Date.now()-zero)/1000;if(t>=15&&t<22)fxSetPos(.70+.25*Math.sin(t),.1+.1*Math.cos(t));},80);
   at(22,'mix-rows',()=>{fxSetPos(1,0);fxRelease();clearInterval(fxTimer);clearInterval(noteTimer);switchTab('mix');setMixMode('mixer');});
  }else if(kind==='instruments'){
   await shot('drum-grid',()=>{});
   at(1.5,'drum-grid-close',()=>document.querySelector('.sq-grid-wrap').scrollIntoView({block:'center',behavior:'smooth'}));
   at(3,'drum-edit',()=>{var e=document.querySelector('#sq-gInner .sq-grow .sq-step:nth-child(5)');if(!e)throw Error('Drum step missing');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));});
   at(6,'bass-roll',()=>{studioShow('bass');setTimeout(()=>document.getElementById('bl-pr').scrollIntoView({block:'center',behavior:'smooth'}),650);});
   at(12,'melody-sequencer',()=>{studioShow('melseq');setTimeout(()=>document.getElementById('ml-pr').scrollIntoView({block:'center',behavior:'smooth'}),650);});
   at(15,'synth-editor',()=>{MSX_UI.page='osc';msxOpenEditor('melgen');setTimeout(()=>document.querySelector('#synth-ed canvas.msx-wt.big').scrollIntoView({block:'center'}),200);});
   at(19,'synth-filter',()=>{document.querySelector('#synth-ed .mu-tab[data-page="filter"]').click();document.querySelector('#synth-ed .mu-tabs').scrollIntoView({block:'start'});});
   at(22,'sampler',()=>{msxCloseEditor();studioShow('smp');setTimeout(()=>document.getElementById('ps-grid').scrollIntoView({block:'center'}),650);});
   at(24,'sampler-pads',()=>{document.querySelector('#ps-grid .ps-pad')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));setTimeout(()=>document.querySelector('#ps-grid .ps-pad')?.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1})),250);});
  }else{
   await shot('song-builder',()=>{});
   at(6,'song-perform',()=>{setSongsMode('perform');songsPerformViewSet('tiles');});
   at(12,'song-timeline',()=>songsPerformViewSet('timeline'));
   at(17,'song-stage',()=>openStage());
   at(22,'guided-learning',()=>{closeStage();openTutorials();});
  }
  await wait(Math.max(0,27100-(Date.now()-zero)));await log('end',{recording:_isRecording,meters:await pl.meters({})});toggleRecording();
  for(var n=0;n<120 && _recFinishing;n++)await wait(250);
  await wait(1500);stopEverything();await log('done',{finishing:_recFinishing});
 }catch(e){await log('error',{message:String(e),stack:e.stack});}
})();
