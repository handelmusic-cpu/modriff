(async function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);const pl=modNativePlugin();let epoch=0;
 const log=(event,extra={})=>pl.fileAppend({name:'portrait-log.jsonl',folder:'PromoSeries',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),t:epoch?(performance.now()-epoch)/1000:0,...extra})+'\n')))});
 const until=async(fn,ms=12000)=>{const stop=Date.now()+ms;while(!fn()){if(Date.now()>stop)throw Error('Timed out');await wait(150);}};
 const clear=()=>{try{cpClose();sndPickClose();_bpmPopOpen(false);if(_libSheet)_libSheet.close();closeStage();smpClose();}catch(e){}};
 const shot=async(name,fn,hold=4300)=>{try{clear();await fn();await wait(350);await log('shot',{name,viewport:[innerWidth,innerHeight],text:document.body.innerText.slice(-10000)});await wait(hold);}catch(e){await log('shot-error',{name,message:String(e),stack:e.stack});}};
 const key=(r,m)=>{root=r;setMode(m);renderChords();mhApply(root);};
 const chord=d=>{const md=MODES[mode];lastTriggeredDegree=d;applyLogicHighlights(d);return _triggerChordImmediate(rootMidi()+md.steps[d],md.triadQ[d],md.seventh[d],md.func[d],.6,'9th',true);};
 try{
  await log('boot');setModTier('pro');unlockAudio('blank');await wait(2800);await msxLoadLib();onBpmInput(124);
  for(const[p,k]of[['chord','keys'],['bass','bass'],['mel','lead']]){MSX.state[p]={patch:PROMO_SCORE.channels[k].patch,vals:PROMO_SCORE.channels[k].values};}
  setWave('modsynth');setBlWave('modsynth');setMelWave('modsynth');modParamsFlush();
  liveTab();LV_XOFF={chords:true,melody:true};lvSet(['chords','melody','fx']);
  let slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(500);slate.remove();epoch=performance.now();await log('begin',{modes:Object.entries(MODES).map(([id,v])=>({id,label:v.label})),progressions:_progPresetsFor('major').length});
  await shot('theory-keys',async()=>{key(0,'major');chord(0);ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);setTimeout(()=>{root=7;renderChords();mhApply(root);},1600);});
  await shot('theory-scales',async()=>{const id=Object.keys(MODES).find(k=>/dorian/i.test(MODES[k].label));key(2,id);ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);setTimeout(()=>{const p=document.querySelector('#mode-pick .chordpick-pop');if(p)p.scrollTop=180;},800);});
  await shot('theory-harmonic',async()=>{const id=Object.keys(MODES).find(k=>/harmonic minor/i.test(MODES[k].label));key(9,id);chord(0);ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);});
  await shot('theory-meters',async()=>{key(0,'major');setMeter(5,4);_bpmPopOpen(true);setTimeout(()=>setMeter(7,8),1600);});
  await shot('theory-logic',async()=>{setMeter(4,4);key(0,'major');if(!logicModeOn)toggleLogicMode();chord(1);setTimeout(()=>chord(4),1400);setTimeout(()=>chord(0),2800);await log('logic-count',{traditional:document.querySelectorAll('.logic-suggest').length,alternative:document.querySelectorAll('.logic-spicy').length});});
  await shot('theory-common',async()=>{libOpenSheet('common');await wait(350);document.querySelector('.lib-play')?.click();});
  await shot('theory-numbers',async()=>{key(2,'dorian');if(!nashMode)toggleNash();chord(0);setTimeout(()=>{root=7;renderChords();mhApply(root);chord(0);},1800);});
  await shot('theory-learn',async()=>{if(nashMode)toggleNash();openTutorials();});
  await shot('theory-guide',async()=>{document.querySelectorAll('.ss-overlay,.modal-overlay,.ll-overlay,.smp-overlay').forEach(e=>{const b=[...e.querySelectorAll('button')].find(b=>/close|cancel/i.test(b.textContent));if(b)b.click();});openGuide();});
  // A complete original song: all sections remain editable, then run in Perform and Stage.
  const text='[Verse]\nDm9 G13 Cmaj9 Am9\n[Chorus]\nFmaj9 G13 Cmaj9 Am9\n[Bridge]\nEm7 Am9 Dm9 G13\n';
  const built=songFromChordSheet(parseChordSheet(text),{len:1});root=0;mode='major';sections=built.song.sections.map((s,i)=>({...s,follow:i===2?'repeat':'next',plays:1}));saveSLData([]);curSetlistIdx=-1;setlistData=[];document.getElementById('chart-title').value='In Motion';buildSectionTabs();renderChartSeq();saveToSetlist();
  await shot('song-build',async()=>{switchTab('songs');setSongsMode('build');buildViewSet('timeline');});
  await shot('song-perform',async()=>{setSongsMode('perform');globalSongMode=true;setDrumsEnabled(true);if(!blEnabled)ftBassClick();if(!isAnythingPlaying())startEverything();else startSongLoop();});
  await shot('song-timeline',async()=>{songsPerformViewSet('timeline');});
  await shot('song-practice',async()=>{songsPerformViewSet('tiles');pracToggle('ramp');pracToggle('key');pracToggle('loop');const buttons=document.querySelectorAll('#songs-full-chart .songs-chord-btn');buttons[0]?.click();buttons[1]?.click();});
  await shot('song-stage',async()=>{openStage();});
  await shot('song-playlist-before',async()=>{stopEverything();libOpenSheet('ireal');});
  await shot('song-playlist-import',async()=>{libOpenSheet('ireal');const input=document.querySelector('.lib-import input[type=file]')||document.querySelector('.lib-sheet input[type=file]');if(!input)throw Error('Playlist input missing');const data=new DataTransfer();data.items.add(new File([PROMO_PLAYLIST],'Studio Set.html',{type:'text/html'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await until(()=>_irealList().length>=3);await log('playlist-proof',{titles:_irealList().map(s=>s.title),count:_irealList().length});});
  await shot('song-pdf-import',async()=>{openChordSheetImport();const inp=document.querySelector('.csi-input');const bytes=Uint8Array.from(atob(PROMO_PDF),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'In Motion.pdf',{type:'application/pdf'}));inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));await until(()=>!document.querySelector('.csi-go').disabled,20000);await log('pdf-proof',{preview:document.querySelector('.csi-preview').innerText,text:document.querySelector('.csi-text').value});});
  await shot('song-pdf-result',async()=>{const go=document.querySelector('.csi-go');if(!go)throw Error('PDF result missing');go.click();await wait(300);document.getElementById('chart-title').value='In Motion — PDF';saveToSetlist();switchTab('songs');setSongsMode('perform');await log('pdf-song',{sections:sections.map(s=>({name:s.name,chords:s.slots.map(x=>x.label)}))});});
  await shot('export-bounce',async()=>{liveTab();lvSet(['chords','melody','fx','rec']);if(!exportStems)toggleStemExport();bounceMidi=true;syncFixedTransport();document.getElementById('rec-w')?.scrollIntoView({block:'center'});});
  await shot('export-midi',async()=>{toggleFtMore();});
  await log('done');
 }catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
