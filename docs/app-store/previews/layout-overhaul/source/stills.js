(async function(){
 var wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2200);var pl=modNativePlugin();
 var log=(event,extra={})=>pl.fileAppend({name:'studio-still.jsonl',folder:'LayoutCapture',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 try{
  await log('boot');localStorage.setItem('modo-tour-ch1','1');setModTier('pro');unlockAudio('roll');await wait(9000);
  window._sqSetMach('MOD');var groove=RHYTHMS.findIndex(r=>/funk/i.test(r.name));if(groove>=0)sqLoadGroove(groove);setDrumsEnabled(true);if(!isAnythingPlaying())startEverything();studioShow('drums');await wait(800);
  await log('ready',{version:MODRIFF_VERSION,viewport:[innerWidth,innerHeight],parts:[...document.querySelectorAll('.ss-chip span')].map(e=>e.textContent),font:getComputedStyle(document.querySelector('.ss-chip')).fontSize,duplicate:!!document.getElementById('sq-layerRow')});
 }catch(e){await log('error',{message:String(e),stack:e.stack});}
})();
