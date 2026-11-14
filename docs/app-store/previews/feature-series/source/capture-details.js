(async function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);const pl=modNativePlugin();let epoch=0;
 const log=(event,x={})=>pl.fileAppend({name:'details-log.jsonl',folder:'PromoSeries',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),t:epoch?(performance.now()-epoch)/1000:0,...x})+'\n')))});
 const shot=async(name,fn)=>{try{cpClose();await fn();await wait(350);await log('shot',{name,viewport:[innerWidth,innerHeight],text:document.body.innerText.slice(-6000)});await wait(4400);}catch(e){await log('error',{name,message:String(e)});}};
 try{await log('boot');setModTier('pro');unlockAudio('blank');await wait(2800);stopEverything();liveTab();LV_XOFF={chords:true,melody:true};lvSet(['chords','melody','fx']);
 const slate=document.createElement('div');slate.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(slate);await wait(500);slate.remove();epoch=performance.now();await log('begin');
 await shot('scales-world',async()=>{root=2;setMode('dorian');ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);const pop=document.getElementById('mode-pick-pop');[...pop.querySelectorAll('.cp-fold')].forEach(b=>{if(/asian|indian|arabic|western/i.test(b.textContent)&&b.getAttribute('aria-expanded')==='false')b.click();});setTimeout(()=>{pop.scrollTop=pop.scrollHeight;},700);});
 await shot('scales-harmonic',async()=>{root=9;setMode('harmonic_minor');ftKeyModeOpen(document.getElementById('ft-key-mode-short').parentElement);});
 await shot('lesson-chords',async()=>{runTutorial('chords');});
 if(_tutClose)_tutClose();
 await shot('education-diagram',async()=>{switchTab('perform');setPerformMode('chords');setFingeringVisible(true);setFingerInst('piano');root=0;setMode('major');const md=MODES[mode];_triggerChordImmediate(rootMidi()+md.steps[0],md.triadQ[0],md.seventh[0],md.func[0],.6,'9th',true);document.querySelector('#fingering-panel,#fingering-wrap,.fingering-wrap')?.scrollIntoView({block:'center'});});
 await shot('pdf-timeline',async()=>{const built=songFromChordSheet(parseChordSheet('[Verse]\nDm9 G13 Cmaj9 Am9\n[Chorus]\nFmaj9 G13 Cmaj9 Cmaj9\n[Bridge]\nEm7 Am9 Dm9 G13'),{len:1});root=0;setMode('major');sections=built.song.sections;document.getElementById('chart-title').value='In Motion — PDF';buildSectionTabs();renderChartSeq();switchTab('songs');setSongsMode('build');buildViewSet('timeline');});
 await shot('recording-options',async()=>{openSettings();setSettingsPane('sound');if(!alwaysStems)toggleAlwaysStems();bounceMidi=true;_bounceMidiSync();const b=document.getElementById('ss-recording-body');if(getComputedStyle(b).display==='none')toggleSS('recording');document.getElementById('ss-recording')?.scrollIntoView({block:'start'});});
 await log('done');}catch(e){await log('caught',{message:String(e),stack:e.stack});}
})();
