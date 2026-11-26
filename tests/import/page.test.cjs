// npm run build; node tests/import/page.test.cjs
// Pasting a web page address lists the chart links on it to pick from. The fixtures are shaped like a real
// forum thread: song links, a duplicate, a playlist link, older-format links, a "next page" link, and a post
// that tries to run a script. A fresh context stands for an install with no purchases.
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../../dist');
(async()=>{
 const fixtures = {}, hits = [];
 const server = http.createServer((q,r)=>{
  const u = q.url.split('?')[0]; hits.push(u);
  if(fixtures[u]){ r.writeHead(200,{'Content-Type':'text/html'}); return r.end(fixtures[u]); }
  const file=path.join(root,decodeURIComponent(u==='/'?'/index.html':u));
  fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'});r.end(b);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{})});
 try{
  for(const [w,h] of [[390,844],[320,568]]){
   const full = w===390;
   const ctx=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true});
   await ctx.addInitScript(()=>{
    window.__own=[];
    window.modBilling={provider:'ios',owned:()=>window.__own.slice(),refresh:()=>Promise.resolve(window.__own.slice()),products:()=>({}),purchase:()=>Promise.resolve(false),restore:()=>Promise.resolve([])};
   });
   const page=await ctx.newPage(), errors=[], tag=`${w}x${h}`;
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(origin+'/');
   await page.waitForFunction(()=>typeof irealOpenPage==='function' && typeof libOpenSheet==='function');
   await page.evaluate(()=>{ const b=document.querySelector('#unlock-choices button'); if(b) b.click(); }); await page.waitForTimeout(900);
   await page.evaluate(()=>{ window.__toasts=[]; const o=showToast; showToast=function(t,x){ window.__toasts.push(String(t)); return o(t,x); }; });

   // Links in the real shape: fields joined by raw "=", the title and music percent-encoded.
   const L = await page.evaluate(()=>{
    const song=(t,c,s)=>'irealb://'+encodeURIComponent(t)+'='+encodeURIComponent(c)+'='+encodeURIComponent(s)+'=C=n='+encodeURIComponent('1r34LbKcu7'+_irealUnscramble('T44C^7 |D-7 |E-7 |F^7 Z'))+'=0=100=0';
    const out={}; ['Alpha','Bravo','Charlie','Dance & Prance','Echo','Foxtrot','Golf'].forEach(t=>{ out[t]=song(t,'Composer '+t[0],'Medium Swing'); });
    const body=['PL One','PL Two','PL Three'].map(t=>song(t,'C','Bossa Nova').replace(/^irealb:\/\//,'')).join('===')+'===Practice List';
    out.playlist='irealb://'+body;
    return out;
   });
   const a=(l)=>`<a href="${l}">chart</a>`;
   fixtures['/fx/thread.html']=`<!doctype html><html><head><link rel="next" href="/fx/thread-2.html"></head><body>
     <script>window.__pwn=1</script><img src="${origin}/fx/tracker.gif" onerror="window.__pwn=2">
     <div class="bbWrapper">${a(L.Alpha)} ${a(L.Bravo)} ${a(L.Charlie)} ${a(L['Dance & Prance'])} ${a(L.Echo)} ${a(L.Alpha)}
     ${a(L.playlist)} <a href="irealbook://Old%20One=X=Y=C=n=1r34LbKcu7abc">old</a> <a href="irealbook://Old%20Two=X=Y=C=n=1r34LbKcu7def">old</a>
     <a href="mailto:x@y.z">mail</a> <p>irealb://Truncated%20Tune=Comp…</p></div></body></html>`;
   fixtures['/fx/thread-2.html']=`<html><body>${a(L.Foxtrot)} ${a(L.Golf)} ${a(L.Alpha)}</body></html>`;
   fixtures['/fx/plain.html']=`<html><body><p>${L.Alpha}</p><p>${L.Bravo} and a cut one irealb://Cut%20Tune=Comp…</p></body></html>`;
   fixtures['/fx/none.html']=`<html><body><p>No charts here, only chat.</p></body></html>`;
   fixtures['/fx/old.html']=`<html><body><a href="irealbook://Old%20One=X=Y=C=n=1r34LbKcu7abc">old</a></body></html>`;
   const openPicker=async(p)=>{ await page.evaluate(u=>{ document.getElementById('_chart-picker')?.remove(); irealOpenPage(u); },origin+p); await page.waitForSelector('#_chart-picker .chp-row',{timeout:8000}); };
   const rowsText=()=>page.evaluate(()=>[...document.querySelectorAll('#_chart-picker .chp-t')].map(e=>e.textContent));
   const toasts=()=>page.evaluate(()=>window.__toasts.join(' | '));

   // 1. The library's import box takes the address; the list shows each chart once, in order, with the skipped count.
   await page.evaluate(()=>libOpenSheet('ireal'));
   await page.locator('.lib-import-in').fill(origin+'/fx/thread.html');
   await page.locator('.lib-import-btn').first().tap();
   await page.waitForSelector('#_chart-picker .chp-row',{timeout:8000});
   const t1=await rowsText();
   assert.deepEqual(t1,['Alpha','Bravo','Charlie','Dance & Prance','Echo','Practice List'],tag+': rows (deduped, playlist as one row, truncated text and old format left out) '+JSON.stringify(t1));
   const sub=await page.locator('#_chart-picker .chp-sub').textContent();
   assert.match(sub,/6 charts · 2 in an older format skipped/,tag+': '+sub);
   assert.equal(await page.evaluate(()=>window.__pwn),undefined,tag+': the page\'s script did not run');
   assert.ok(!hits.includes('/fx/tracker.gif'),tag+': nothing the page points at was fetched');
   const lay=await page.evaluate(()=>{const b=document.querySelector('#_chart-picker .chp-box').getBoundingClientRect(),f=document.querySelector('#_chart-picker .chp-go').getBoundingClientRect();return {top:b.top,bottom:b.bottom,l:b.left,r:b.right,goB:f.bottom,goH:f.height,vw:innerWidth,vh:innerHeight};});
   assert.ok(lay.top>=0 && lay.bottom<=lay.vh+1 && lay.l>=0 && lay.r<=lay.vw && lay.goB<=lay.vh && lay.goH>=44,tag+': sheet on screen, Import reachable '+JSON.stringify(lay));
   const txt=await page.locator('#_chart-picker').innerText();
   assert.ok(!/ireal/i.test(txt),tag+': no other company\'s name in the list'); assert.ok(!/\p{Extended_Pictographic}/u.test(txt),tag+': no emoji');

   // 2. Free: one at a time (radio), said up front, with the way to the pack; Import starts disabled.
   assert.equal(await page.locator('#_chart-picker .chp-row input[type=radio]').count(),6,tag+': radios');
   assert.match(await page.locator('#_chart-picker .chp-tools').innerText(),/one chart at a time/);
   assert.equal(await page.locator('#_chart-picker .chp-go').isDisabled(),true,tag+': Import disabled with nothing picked');
   await page.locator('#_chart-picker .chp-row').nth(1).tap(); await page.locator('#_chart-picker .chp-row').nth(2).tap();
   assert.equal(await page.locator('#_chart-picker .chp-row input:checked').count(),1,tag+': picking a second replaces the first');
   assert.equal(await page.locator('#_chart-picker .chp-go').textContent(),'Import 1 chart');
   await page.locator('#_chart-picker .chp-go').tap(); await page.waitForTimeout(300);
   const after=await page.evaluate(()=>({open:!!document.getElementById('_chart-picker'), titles:_irealList().map(s=>s.title)}));
   assert.deepEqual(after,{open:false,titles:['Charlie']},tag+': the picked chart is imported, the list closes');
   assert.match(await toasts(),/Imported 1 song/,tag+': toast');

   if(full){
    // 3. Filter, Escape.
    await openPicker('/fx/thread.html');
    await page.locator('#_chart-picker .chp-find').fill('dance');
    assert.deepEqual(await rowsText(),['Dance & Prance'],tag+': filter');
    await page.locator('#_chart-picker .chp-find').fill('zzz');
    assert.match(await page.locator('#_chart-picker .chp-empty').textContent(),/No chart matches/);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#_chart-picker').count(),0,tag+': Escape closes');

    // 4. Practice Pack: tick any number, Select all, Next page appends; a playlist row counts all its charts.
    await page.evaluate(async()=>{ _irealSongs=[]; localStorage.removeItem('modo-ireal-songs'); window.__own=['practice']; _applyTier(); await modBillingChanged(); });
    await openPicker('/fx/thread.html');
    assert.equal(await page.locator('#_chart-picker .chp-row input[type=checkbox]').count(),6,tag+': checkboxes with the pack');
    await page.locator('#_chart-picker .chp-sec').tap();
    await page.waitForFunction(()=>document.querySelectorAll('#_chart-picker .chp-row').length===8,null,{timeout:8000});
    assert.deepEqual(await rowsText(),['Alpha','Bravo','Charlie','Dance & Prance','Echo','Practice List','Foxtrot','Golf'],tag+': next page appended, duplicate not repeated');
    assert.equal(await page.locator('#_chart-picker .chp-sec').count(),0,tag+': no Next page on the last page');
    await page.locator('#_chart-picker .chp-tools .chp-link').tap();
    assert.equal(await page.locator('#_chart-picker .chp-go').textContent(),'Import 10 charts',tag+': 7 songs and a 3-chart playlist');
    await page.locator('#_chart-picker .chp-go').tap(); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>_irealList().length),10,tag+': all ten are in the library');

    // 5. A page that shows addresses as text, and the three ways a page can have nothing for us.
    await openPicker('/fx/plain.html');
    assert.deepEqual(await rowsText(),['Alpha','Bravo'],tag+': text addresses found, the cut one left out');
    await page.keyboard.press('Escape');
    for(const [p,re] of [['/fx/none.html',/No chord charts found on that page/],['/fx/old.html',/older format/],['/fx/missing.html',/cannot be read from a browser/]]){
     await page.evaluate(()=>{ window.__toasts.length=0; });
     const ok=await page.evaluate(u=>irealOpenPage(u),origin+p);
     assert.equal(ok,false,tag+': '+p); assert.match(await toasts(),re,tag+': '+p);
    }
    assert.equal(await page.evaluate(()=>irealOpenPage('not an address')),false);

    // 6. In the app the request goes through the native HTTP plugin; addresses are tidied first.
    await page.evaluate(async(u)=>{ window.__nat=[]; const html=await (await fetch(u)).text();
      window._inNativeApp=()=>true; window._pageFetchNative=async(x)=>{ window.__nat.push(x); return html; }; },origin+'/fx/thread.html');
    await page.evaluate(()=>irealOpenPage('http://forums.example.test/threads/x'));
    await page.waitForSelector('#_chart-picker .chp-row'); await page.keyboard.press('Escape');
    await page.evaluate(()=>irealOpenPage('forums.example.test/threads/y'));
    await page.waitForSelector('#_chart-picker .chp-row'); await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>window.__nat),['https://forums.example.test/threads/x','https://forums.example.test/threads/y'],tag+': http is read as https; a bare host gets https');
    assert.equal(await page.evaluate(()=>[irealPageUrl('ftp://x.y/z'),irealPageUrl('two words'),irealPageUrl('')].join('|')),'||',tag+': not addresses');

    // 7. A wrapper that already holds the links (a share sheet) opens the same list.
    const n=await page.evaluate(l=>modriffImportLinks([l.Alpha,l.Alpha,l.Bravo,'irealb://cut…','nope'],'shared'),L);
    assert.equal(n,2,tag+': links handed in: two valid, once each');
    assert.equal(await page.locator('#_chart-picker .chp-row').count(),2);
   }
   assert.deepEqual(errors,[],tag+': page errors');
   await ctx.close();
  }
  console.log('PASS chart page import: list, dedupe, skipped count, free one-at-a-time, pack multi-select, next page, filter, text addresses, native route, no script run');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
