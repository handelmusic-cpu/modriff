// Run after npm run build. Exercises the shipped page, including real clicks,
// independent scrolling, the expanded chord editor and Live/Studio remounting.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dist');
(async () => {
 const server = http.createServer((q,r) => {
  const file = path.join(root, decodeURIComponent(q.url.split('?')[0] === '/' ? '/index.html' : q.url.split('?')[0]));
  fs.readFile(file, (e,b) => { r.writeHead(e ? 404 : 200, {'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'}); r.end(e?'':b); });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM ? {executablePath:process.env.CHROMIUM} : {})});
 try {
  const page = await browser.newPage({viewport:{width:1460,height:810}});
  await page.addInitScript(()=>{ window.__modMacApp=true; localStorage.setItem('modo-view-mode','basic'); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.unlock-btn').first().click();
  await page.waitForTimeout(700);
  const measure = () => page.evaluate(()=>{
   const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}};
   const lanes=[...document.querySelectorAll('.mac-live-lane')];
   return {lanes:lanes.map(box),styles:box(document.querySelector('.lv-slot[data-mod="styles"]')),
    slots:[...document.querySelectorAll('#lv-slots .lv-slot')].map(e=>e.dataset.mod),
    transport:box(document.querySelector('#perf-bar')),board:box(document.querySelector('#lv-slots')),
    pageOverflow:document.documentElement.scrollWidth>innerWidth,
    pads:[...document.querySelectorAll('#lv-slots .ps-pad')].filter(e=>e.offsetHeight).map(e=>e.offsetHeight)};
  });
  let m = await measure();
  assert.equal(m.lanes.length,2); assert(m.board.w > 1460*.9);
  assert(m.lanes[1].x > m.lanes[0].x+m.lanes[0].w);
  assert(m.lanes.every(l=>l.bottom <= m.transport.y+1));
  assert(m.pads.every(h=>h===104)); assert(!m.pageOverflow);
  const before=m.styles;
  await page.locator('.lv-more[data-mod="chords"]').click();
  m=await measure(); assert.deepEqual(m.styles,before);
  assert.equal(await page.locator('#chords-main').evaluate(e=>getComputedStyle(e).display),'block');
  const scrolling=await page.evaluate(()=>{
   const a=document.querySelector('.mac-live-lane'), b=a.nextElementSibling;
   a.scrollTop=160; return {a:a.scrollTop,b:b.scrollTop,overflow:a.scrollHeight>a.clientHeight};
  });
  assert(scrolling.overflow && scrolling.a>0 && scrolling.b===0);
  await page.evaluate(()=>setViewMode('advanced'));
  assert.equal(await page.locator('#lv-slots .lv-slot').count(),0);
  await page.evaluate(()=>setViewMode('basic'));
  assert.equal(await page.locator('#lv-slots .lv-slot').count(),7);
  assert.equal(await page.locator('#pf-chords-panel').count(),1);
  await page.locator('.lv-more[data-mod="chords"]').click();
  await page.evaluate(()=>document.querySelector('.mac-live-lane').scrollTop=0);
  await page.locator('#chords-diatonic .btn-tri').first().click();
  console.log('ok desktop: 2 lanes; band stays put with chord editor open; independent scroll; 7 widgets survive Studio round trip; chord click');
  for(const width of [1000,1280,1920,820]) {
   await page.setViewportSize({width,height:810}); m=await measure(); assert(!m.pageOverflow,`horizontal overflow at ${width}`);
   if(width>=1000) assert(m.lanes.every(l=>l.bottom<=m.transport.y+1));
  }
  await page.setViewportSize({width:1460,height:810});
  if(process.env.SCREENSHOT) await page.screenshot({path:process.env.SCREENSHOT});
  const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await phone.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await phone.locator('.mac-live-lane').count(),0);
  assert.equal(await phone.locator('#lv-slots > .lv-slot').count(),7);
  assert(await phone.locator('#lv-slots').evaluate(e=>e.offsetWidth<=390));
  console.log('ok resize: 820, 1000, 1280, 1920px; iPhone keeps the original single column');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
