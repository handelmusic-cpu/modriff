// Run against the shipping build: node tests/seq/independent-timing.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'), http=require('node:http'), path=require('node:path'), assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../../dist');
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0])); fs.readFile(file,(err,data)=>{res.statusCode=err?404:200; res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/octet-stream');res.end(err?'':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
 await page.waitForTimeout(1400);
 await page.evaluate(()=>{document.querySelector('#unlock-choices button')?.click();setModTier('pro');setViewMode('advanced');switchTab('accomp');});
 const state=()=>page.evaluate(()=>({lengths:_seqLens(),rates:[sqRateMul,blRateMul,mlRateMul],steps:stepCountLock,rate:stepRateLock}));
 const reset=()=>page.evaluate(()=>{stepCountLock=true;stepRateLock=true;setSeqStepCount('sq',16);setSeqRate('sq',1);});
 for(const [eng,mode,id] of [['sq','drums','sq-stepsDisp'],['bl','bass','bl-stepsdisp'],['ml','melody','ml-stepsdisp']]){
  await reset();await page.evaluate(m=>setAccompMode(m),mode);
  assert(await page.locator('#'+id).isVisible(),mode+' step count visible without opening tools');
  // Cancel leaves all parts and both locks untouched.
  await page.locator(`[data-seqeng="${eng}"][data-seqrate="0.5"]`).click();
  assert(await page.locator('#cfm-yes').isVisible());
  assert.deepEqual((await state()).rates,[1,1,1]);
  await page.locator('#cfm-no').click();assert((await state()).rate);
  // Confirm changes just this part and just the rate link.
  await page.locator(`[data-seqeng="${eng}"][data-seqrate="0.5"]`).click();
  await page.locator('#cfm-yes').click();
  let s=await state();assert.equal(s.rates[['sq','bl','ml'].indexOf(eng)],.5);assert.equal(s.rates.filter(v=>v===1).length,2);assert(s.steps&&!s.rate);
  await page.locator(`[data-seqeng="${eng}"][data-seqrate="2"]`).click();
  assert.equal(await page.locator('#cfm-yes').count(),0); // already free
  // A typed step count uses the same confirmation and preserves rate freedom.
  await page.locator('#'+id).click();const input=page.locator('input.step-edit-in');
  await input.fill('24');await input.press('Enter');
  assert(await page.locator('#cfm-yes').isVisible());assert.deepEqual((await state()).lengths,{sq:16,bl:16,ml:16});
  await page.locator('#cfm-no').click();assert((await state()).steps);
  await page.locator('#'+id).click();await input.fill('24');await input.press('Enter');await page.locator('#cfm-yes').click();
  s=await state();assert.equal(s.lengths[eng],24);assert.equal(Object.values(s.lengths).filter(v=>v===16).length,2);assert(!s.steps&&!s.rate);
  const plus=eng==='sq'?'#sq-stepsUp':`button[onclick="${eng}SetSteps(1)"]`;
  await page.locator(plus).click();assert.equal((await state()).lengths[eng],25);assert.equal(await page.locator('#cfm-yes').count(),0);
  console.log('PASS '+mode+': visible count; rate cancel/confirm/free edit; count cancel/confirm/+ edit; other parts unchanged');
 }
 const native=await page.evaluate(()=>{
  const calls=[],old=window._nsDrum.plugin;
  window._nsDrum.plugin=()=>Object.fromEntries(['seqTempo','seqBassTempo','seqMelTempo'].map(k=>[k,v=>{calls.push([k,v.rate]);return Promise.resolve();}]));
  stepRateLock=false;setSeqRate('bl',.5);setSeqRate('ml',2);setSeqRate('sq',1);stepRateLock=true;setSeqRate('sq',.5);
  window._nsDrum.plugin=old;return calls;
 });
 assert.deepEqual(native,[['seqBassTempo',.5],['seqMelTempo',2],['seqTempo',1],['seqTempo',.5],['seqBassTempo',.5],['seqMelTempo',.5]]);
 const labels=await page.locator('[data-seqeng="sq"]').evaluateAll(bs=>bs.map(b=>[b.dataset.seqrate,b.textContent]));
 assert.deepEqual(labels,[['2','½×'],['1','1×'],['0.5','2×']]);
 assert.deepEqual(errors,[]);
 console.log('PASS native tempo recipients and rate values; speed labels; no page errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
