// npm run build; PLAYWRIGHT=/path/to/playwright node tests/learn/walkthrough.cjs
// A fresh context represents an iOS install with no purchases. Never seed a tier.
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../../dist');
const out = process.env.EVIDENCE;
(async()=>{
 const server = http.createServer((q,r)=>{
  const file=path.join(root,decodeURIComponent(q.url.split('?')[0]==='/'?'/index.html':q.url.split('?')[0]));
  fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'});r.end(b||'');});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{})});
 try{
  for(const [width,height] of [[390,844],[440,956],[1024,1366]]){
   const ctx=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
   await ctx.addInitScript(()=>{
    window.modBilling={provider:'ios',owned:()=>[],products:()=>({}),refresh:()=>Promise.resolve([])};
   });
   const page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.evaluate(()=>{
    window.__learnToasts=[];
    const original=showToast;
    showToast=function(t,o){window.__learnToasts.push(t);return original(t,o);};
   });
   await page.getByRole('button',{name:'One-minute walkthrough',exact:true}).tap();
   const title=page.locator('.tour-title');
   const titles=['Start the beat','Play some chords','Play a tune','Now both together'];
   const measure=()=>page.evaluate(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};
    const card=box(document.querySelector('.tour-card'));
    const targets=[...document.querySelectorAll('.tour-ring')].filter(e=>e.style.display!=='none').map(box);
    const overlap=targets.filter(t=>card.left<t.right&&card.right>t.left&&card.top<t.bottom&&card.bottom>t.top).length;
    return {card,targets,overlap,toasts:window.__learnToasts.slice(),owned:modBilling.owned(),tier:localStorage.getItem('modo-dev-tier'),groove:RHYTHMS[sqCurGroove].name};
   });
   for(let i=0;i<4;i++){
    await page.waitForFunction(t=>document.querySelector('.tour-title')?.textContent===t,titles[i]);
    await page.waitForTimeout(800);
    const m=await measure();
    assert.equal(m.tier,null);assert.deepEqual(m.owned,[]);assert.deepEqual(m.toasts,[]);
    assert.equal(m.groove,'4/4 Basic');assert.equal(m.targets.length,i===3?2:1);
    assert.equal(m.overlap,0,`${width}: ${titles[i]} covers a target`);
    assert(m.card.top>=16&&m.card.bottom<=height-15);
    if(out)await page.screenshot({path:path.join(out,`${width}-step-${i+1}.png`)});
    await page.locator('#_ob-show').tap();
   }
   await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='You’re playing');
   await page.locator('#_ob-done').tap();
   const scroll=()=>page.evaluate(()=>({page:document.getElementById('page-perform').scrollTop,window:scrollY,tour:!!document.getElementById('_onboard-wrap')}));
   await page.waitForTimeout(600);assert.deepEqual(await scroll(),{page:0,window:0,tour:false});
   if(out)await page.screenshot({path:path.join(out,`${width}-after-keep.png`)});
   // Close during the delay after Show me: the pending advance must not scroll again.
   await page.evaluate(()=>showTour());await page.locator('#_ob-show').tap();await page.locator('#_ob-exit').tap();
   await page.waitForTimeout(1000);assert.deepEqual(await scroll(),{page:0,window:0,tour:false});
   await page.evaluate(()=>toggleFtMore());
   const find=page.locator('#ft-find-btn');await find.scrollIntoViewIfNeeded();
   assert.equal(await find.innerText(),'Find');await find.tap();
   assert(await page.locator('#find-input').isVisible());
   await page.evaluate(()=>{closeFind();const m=document.getElementById('ft-more-menu');if(m.classList.contains('open'))toggleFtMore();});
   await page.locator('.lv-slot .lv-cb').first().tap();
   assert.match(await page.locator('#_pro-sheet .pro-what').innerText(),/Rearranging the layout/);
   await page.evaluate(()=>{document.getElementById('_pro-sheet').remove();libOpenSheet('ireal');});
   assert.equal(await page.locator('.lib-tabs button.on').innerText(),'Chord charts');
   assert.equal(await page.locator('.lib-import-in').getAttribute('aria-label'),'Chord chart link');
   assert(!/iReal/.test(await page.locator('.lib-sheet').innerText()));
   // Real browser touch must pass through the dim layer's holes and satisfy
   // the gates by count; Show me alone cannot establish that the keys work.
   await page.evaluate(()=>{_libSheet.close();if(isAnythingPlaying())ftPlayStop();showTour();});
   await page.waitForTimeout(300);
   await page.locator('#ft-playstop-btn').tap();
   await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='Play some chords');
   await page.waitForTimeout(700);
   for(let n=0;n<3;n++){
    if(n===2)assert.equal(await title.innerText(),'Play some chords');
    await page.locator('#chords-diatonic .btn-tri').nth(n).tap();
   }
   await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='Play a tune');
   await page.waitForTimeout(700);
   for(let n=0;n<5;n++){
    if(n===4)assert.equal(await title.innerText(),'Play a tune');
    await page.locator('#melody-keys > *').nth(n).tap();
   }
   await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='Now both together');
   await page.waitForTimeout(700);
   await page.locator('#chords-diatonic .btn-tri').first().tap();
   for(let n=0;n<3;n++)await page.locator('#melody-keys > *').nth(n).tap();
   await page.waitForFunction(()=>document.querySelector('.tour-title')?.textContent==='You’re playing');
   await page.locator('#_ob-done').tap();
   await page.waitForTimeout(500);assert.deepEqual(await scroll(),{page:0,window:0,tour:false});
   assert.deepEqual(errors,[]);
   console.log(`ok ${width}x${height}: free groove; 4 cards clear targets; Keep playing and early exit reset scroll; Find label opens search; counted touch gates pass`);
   await ctx.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
