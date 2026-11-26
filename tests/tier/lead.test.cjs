// npm run build; node tests/tier/lead.test.cjs
// The lock sheet: someone who owns nothing sees the whole set first and the single pack under it;
// someone who owns packs keeps the pack first with "Complete Your Studio" beneath; both buy buttons
// still start the right product. Billing is a mock (a fresh context stands for an install with no purchases).
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
  for(const [w,h] of [[390,844],[320,568]]){
   const ctx=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true});
   await ctx.addInitScript(()=>{
    window.__own=[]; window.__bought=[];
    const P=(price,value)=>({price,value});
    window.modBilling={provider:'ios',owned:()=>window.__own.slice(),refresh:()=>Promise.resolve(window.__own.slice()),
     products:()=>({fullstudio:P('$12.99',12.99),'fullstudio.from1':P('$10.99',10.99),from1:P('$10.99',10.99),from2:P('$6.99',6.99),from3plus:P('$3.99',3.99),
       sampler:P('$4.99',4.99),synth:P('$4.99',4.99),groove:P('$3.99',3.99),theory:P('$3.99',3.99),practice:P('$3.99',3.99),studio:P('$4.99',4.99),sounds:P('$1.99',1.99)}),
     purchase:(k)=>{window.__bought.push(k);return Promise.resolve(false);},restore:()=>Promise.resolve([])};
   });
   const page=await ctx.newPage(), errors=[], tag=`${w}x${h}`;
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.waitForFunction(()=>typeof proSheet==='function' && typeof _applyTier==='function');
   await page.evaluate(()=>{ const b=document.querySelector('#unlock-choices button'); if(b) b.click(); }); await page.waitForTimeout(900);
   const open=async(own)=>page.evaluate(async(own)=>{
    document.getElementById('_pro-sheet')?.remove(); window.__own=own; _applyTier(); await modBillingChanged();
    proSheet('Custom drum kits','groove');
    await new Promise(r=>setTimeout(r,150));
    const sheet=document.getElementById('_pro-sheet');
    const order=[...sheet.querySelectorAll('.pro-what, .pro-bundle, .pro-listhd, .pro-list')].map(e=>e.classList.contains('pro-bundle')?('bundle'+(e.classList.contains('pro-aside')?'-aside':'')):e.classList.contains('pro-listhd')?'listhd':e.classList.contains('pro-list')?'list':'what');
    const q=s=>sheet.querySelector(s);
    return {order, bundleBtn:q('.pro-bundle-btn')?.textContent||null, bname:q('.pro-bname')?.textContent||null,
      listhd:q('.pro-listhd')?.textContent||null, foot:[...sheet.querySelectorAll('.pro-foot button, .pro-foot a')].map(b=>b.textContent)};
   },own);

   // Owns nothing: the set leads, then "Or just this pack", then the pack's list; the pack's button stays in the foot.
   let r=await open([]);
   assert.deepEqual(r.order,['what','bundle','listhd','list'],tag+': fresh buyer order '+JSON.stringify(r.order));
   assert.equal(r.bname,'Full Studio'); assert.match(r.bundleBtn,/Full Studio — \$12\.99/); assert.equal(r.listhd,'Or just this pack');
   assert.ok(r.foot.some(t=>/^Unlock Groove Pack — \$3\.99$/.test(t)),tag+': pack button in the foot '+JSON.stringify(r.foot));

   // Both buttons are on screen without scrolling the foot away, and each starts its own product.
   const vis=await page.evaluate(()=>{const v=el=>{const x=el.getBoundingClientRect();return x.top>=0&&x.bottom<=innerHeight+1&&x.width>0;};
     return {bundle:v(document.querySelector('#_pro-sheet .pro-bundle-btn')), pack:v(document.querySelector('#_pro-sheet .pro-buy:not(.pro-rowbuy)'))};});
   assert.equal(vis.pack,true,tag+': pack button reachable in the foot');
   await page.locator('#_pro-sheet .pro-bundle-btn').scrollIntoViewIfNeeded();
   await page.locator('#_pro-sheet .pro-bundle-btn').tap(); await page.waitForTimeout(200);
   await page.locator('#_pro-sheet .pro-buy:not(.pro-rowbuy)').tap(); await page.waitForTimeout(200);
   assert.deepEqual(await page.evaluate(()=>window.__bought),['fullstudio','groove'],tag+': bundle and pack buttons start the right products');

   // Owns one pack: the pack stays first, the upgrade sits under it as before.
   r=await open(['sounds']);
   assert.deepEqual(r.order,['what','list','bundle-aside'],tag+': returning buyer order '+JSON.stringify(r.order));
   assert.equal(r.bname,'Complete Your Studio');

   // Owns everything: nothing to sell.
   r=await open(['sampler','synth','groove','theory','practice','studio','sounds']);
   assert.ok(!r.order.includes('bundle') && !r.order.includes('bundle-aside'),tag+': nothing to sell when all are owned '+JSON.stringify(r.order));

   // The store view is unchanged: the set first, then the seven packs.
   const store=await page.evaluate(async()=>{document.getElementById('_pro-sheet')?.remove(); window.__own=[]; _applyTier(); await modBillingChanged(); proSheet(); await new Promise(r=>setTimeout(r,150));
     const s=document.getElementById('_pro-sheet'); return {first:s.querySelector('.pro-bundle')?1:0, cards:s.querySelectorAll('.pro-card').length};});
   assert.deepEqual(store,{first:1,cards:7},tag+': store view');
   assert.deepEqual(errors,[],tag+': page errors');
   await ctx.close();
  }
  console.log('PASS lock sheet: set leads for a first purchase, pack leads when packs are owned, nothing when all owned, buy buttons start the right product');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
