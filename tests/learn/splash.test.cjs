// npm run build; node tests/learn/splash.test.cjs
// A first visit leads with the walkthrough; Start and Random stay, quieter. The markup order
// (Start, Random, Learn) is load-bearing: many tests click the first button in #unlock-choices.
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
 try{
  for(const [w,h] of [[390,844],[320,568],[844,390],[1024,1366]]){
   const ctx=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:w<900});
   const page=await ctx.newPage(), errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.waitForSelector('#unlock-choices button');
   const m=await page.evaluate(()=>{
    const bs=[...document.querySelectorAll('#unlock-choices button')];
    const r=b=>{const x=b.getBoundingClientRect();return {t:b.textContent.trim(),aria:b.getAttribute('aria-label'),top:x.top,left:x.left,w:x.width,h:x.height,right:x.right}};
    return {first:document.getElementById('unlock-choices').classList.contains('first-visit'), bs:bs.map(r), vw:innerWidth};
   });
   const tag=`${w}x${h}`;
   assert.equal(m.first,true,tag+': first-visit class');
   assert.deepEqual(m.bs.map(b=>b.t.split('\n')[0].replace(/one-minute walkthrough$/,'')),['Start','Random','Learn'],tag+': markup order');
   const [start,random,learn]=m.bs;
   assert.ok(learn.top<start.top && learn.top<random.top,tag+': Learn is above Start and Random');
   assert.ok(learn.w>=start.w*1.8,tag+': Learn is wider than Start ('+learn.w+' vs '+start.w+')');
   assert.ok(learn.h>=52,tag+': Learn tall enough '+learn.h);
   assert.ok(start.h>=44 && random.h>=44,tag+': quiet buttons keep a 44pt target '+start.h);
   assert.ok(m.bs.every(b=>b.left>=0 && b.right<=m.vw),tag+': nothing off screen');
   assert.equal(learn.aria,'One-minute walkthrough',tag+': aria-label unchanged');
   if(w===390){
    // The first button is still Start (tests rely on it), and Learn still opens the walkthrough.
    await page.getByRole('button',{name:'One-minute walkthrough',exact:true}).tap();
    await page.waitForSelector('.tour-card');
    assert.equal(await page.locator('.tour-title').textContent(),'Start the beat');
    // Not a first visit: three equal buttons as before, no lifted row.
    await page.evaluate(()=>{ window.tourChapterDone=()=>true; buildUnlockChoices(); });
    const after=await page.evaluate(()=>({first:document.getElementById('unlock-choices').classList.contains('first-visit'),
      lead:document.querySelectorAll('#unlock-choices .unlock-lead').length, n:document.querySelectorAll('#unlock-choices button').length}));
    assert.deepEqual(after,{first:false,lead:0,n:2},'returning visitor: Start and Random only, nothing lifted');
   }
   assert.deepEqual(errors,[],tag+': page errors');
   await ctx.close();
  }
  console.log('PASS splash: Learn leads on a first visit at 4 sizes, markup order kept, returning visitors unchanged');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
