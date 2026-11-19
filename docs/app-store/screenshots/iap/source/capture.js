// Capture-only automation appended to a disposable Debug Simulator bundle. Never included by the app build.
(async function(){
 var wait=ms=>new Promise(r=>setTimeout(r,ms)),pl=modNativePlugin();
 var log=(event,extra={})=>pl.fileAppend({name:'iap.jsonl',folder:'LayoutCapture',first:event==='boot',data:btoa(unescape(encodeURIComponent(JSON.stringify({event,time:Date.now(),...extra})+'\n')))});
 try{
  await log('boot');localStorage.setItem('modo-tour-ch1','1');setModTier('pro');unlockAudio('roll');await wait(9000);stopEverything();liveTab();
  // App Store Connect launch prices, docs/app-store.md. This changes only this disposable capture bundle's provider.
  var prices={sampler:5.99,synth:4.99,groove:3.99,theory:3.99,practice:3.99,studio:4.99,sounds:1.99,fullstudio:12.99,from1:10.99,from2:6.99,from3plus:3.99};
  modBilling.products=()=>Object.fromEntries(Object.entries(prices).map(([key,value])=>[key,{price:'$'+value.toFixed(2),value}]));
  var cases=STORE_ORDER.map(k=>({key:k,module:k,owned:[]})).concat([
   {key:'fullstudio',owned:[]},{key:'fullstudio.from1',owned:['groove']},
   {key:'fullstudio.from2',owned:['groove','sounds']},{key:'fullstudio.from3plus',owned:['groove','sounds','studio']}
  ]);
  for(var c of cases){
   var old=document.getElementById('_pro-sheet');if(old){var close=[...old.querySelectorAll('button')].find(b=>/^(Not now|Close)$/.test(b.textContent));if(close)close.click();}
   setModOwned(c.owned);proSheet('',c.module||null);await wait(1300);
   var box=document.querySelector('#_pro-sheet .pro-box');box.scrollTop=0;
   await log('ready',{file:'Handel.modRiff.'+c.key+'.png',owned:c.owned,text:box.innerText,viewport:[innerWidth,innerHeight],version:MODRIFF_VERSION});await wait(5500);
  }
  await log('done');
 }catch(e){await log('error',{message:String(e),stack:e.stack});}
})();
