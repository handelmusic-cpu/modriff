// npm run build; node tests/learn/ending.test.cjs
// The first walkthrough ends on three ways to keep what was made (record, send, save), and a replay
// from More does not (it needs the "Restore my setup" toast). Fresh context = a first install.
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../../dist');
(async()=>{
 const server = http.createServer((q,r)=>{
  const file=path.join(root,decodeURIComponent(q.url.split('?')[0]==='/'?'/index.html':q.url.split('?')[0]));
  fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'});r.end(b);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{})});
 const titles=['Start the beat','Play some chords','Play a tune','Now both together'];
 // Through the four steps with Show me (the touch gates are covered by walkthrough.cjs).
 const toEnd=async(page)=>{
  for(const t of titles){
   await page.waitForFunction(x=>document.querySelector('.tour-title')?.textContent===x,t);
   await page.waitForTimeout(400);
   await page.locator('#_ob-show').tap();
  }
  await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='You’re playing');
  await page.waitForTimeout(200);
 };
 try{
  for(const [w,h] of [[390,844],[320,568]]){
   const ctx=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true});
   const page=await ctx.newPage(), errors=[], tag=`${w}x${h}`;
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.evaluate(()=>{ window.__toasts=[]; const orig=showToast; showToast=function(t,o){ window.__toasts.push(String(t)); return orig(t,o); }; });
   await page.getByRole('button',{name:'One-minute walkthrough',exact:true}).tap();
   await toEnd(page);

   // The card: three actions and Keep playing, all inside the card, all a real tap target, card on screen.
   const lay=await page.evaluate(()=>{
    const c=document.querySelector('.tour-card').getBoundingClientRect();
    const acts=[...document.querySelectorAll('.tour-act')].map(b=>{const r=b.getBoundingClientRect();return {t:b.querySelector('b').textContent,h:r.height,top:r.top,bottom:r.bottom,l:r.left,r:r.right}});
    const keep=document.getElementById('_ob-done').getBoundingClientRect();
    return {c:{top:c.top,bottom:c.bottom,l:c.left,r:c.right},acts,keepH:keep.height,keepBottom:keep.bottom};
   });
   assert.deepEqual(lay.acts.map(a=>a.t),['Record it','Send it to a friend','Save this setup'],tag+': three actions');
   assert.ok(lay.acts.every(a=>a.h>=44 && a.top>=lay.c.top && a.bottom<=lay.c.bottom && a.l>=lay.c.l && a.r<=lay.c.r),tag+': actions sit inside the card at 44pt+');
   assert.ok(lay.c.top>=0 && lay.c.bottom<=h && lay.keepBottom<=lay.c.bottom,tag+': card and Keep playing on screen');

   // Save this setup: one more saved setup, a toast, the tour closed.
   const before=await page.evaluate(()=>loadSetupsData().length);
   await page.locator('#_ob-save').tap();
   await page.waitForTimeout(300);
   const saved=await page.evaluate(()=>({n:loadSetupsData().length, tour:!!document.getElementById('_onboard-wrap'), toast:window.__toasts.join(' | ')}));
   assert.equal(saved.n,before+1,tag+': Save this setup adds a setup'); assert.equal(saved.tour,false,tag+': tour closed after save');
   assert.match(saved.toast,/Setup saved/,tag+': toast says it saved');

   // Send it to a friend: in the app (stubbed) the iPhone share sheet gets the whole-rig link on the public page.
   await page.evaluate(()=>{ window.__shared=[]; window._shareNative=()=>true;
     Object.defineProperty(navigator,'share',{configurable:true,value:d=>{window.__shared.push(d.url);return Promise.resolve();}});
     playOnboardingDemo(); });
   await toEnd(page);
   await page.locator('#_ob-send').tap();
   await page.waitForFunction(()=>window.__shared.length>=1,null,{timeout:5000});
   const sent=await page.evaluate(()=>({urls:window.__shared, tour:!!document.getElementById('_onboard-wrap')}));
   assert.equal(sent.urls.length,1,tag+': share sheet opened once');
   assert.ok(sent.urls[0].startsWith('https://modriff.com/play/#setup='),tag+': link: '+sent.urls[0].slice(0,50));
   assert.equal(sent.tour,false,tag+': tour closed after send');

   // Record it: a take starts, with a toast telling them what to do next.
   await page.evaluate(()=>{ window._shareNative=()=>false; playOnboardingDemo(); });
   await toEnd(page);
   await page.locator('#_ob-rec').tap();
   await page.waitForTimeout(500);
   const rec=await page.evaluate(()=>({on:_isRecording===true, tour:!!document.getElementById('_onboard-wrap'), toast:window.__toasts.join(' | ')}));
   assert.equal(rec.on,true,tag+': Record it starts a take'); assert.equal(rec.tour,false,tag+': tour closed after record');
   assert.match(rec.toast,/Recording/,tag+': toast tells them to play then stop');
   await page.evaluate(()=>_stopRecording()); await page.waitForTimeout(600);

   // A replay from More keeps its single button (its own "Restore my setup" toast must survive).
   await page.evaluate(()=>showTour());
   await toEnd(page);
   assert.equal(await page.locator('.tour-act').count(),0,tag+': replay has no actions');
   assert.equal(await page.locator('#_ob-done').count(),1,tag+': replay keeps Keep playing');
   await page.locator('#_ob-done').tap();

   assert.deepEqual(errors,[],tag+': page errors');
   if(process.env.EVIDENCE){ /* screenshot of the ending for review */ }
   await ctx.close();
  }
  console.log('PASS walkthrough ending: record, send (share sheet, public link), save, replay unchanged, at 390x844 and 320x568');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
