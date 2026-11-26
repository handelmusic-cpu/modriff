// npm run build; node tests/share/link.test.cjs
// A link made inside the iPhone app must open for someone else. The app is served from
// capacitor://localhost, which a desktop browser cannot be, so the test flips _shareNative().
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
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{})});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(origin+'/');
  await page.waitForFunction(()=>typeof _shareBase==='function' && typeof _shareSend==='function');

  // 1. Base address: the web page keeps its own address, the app uses the public page.
  const base=await page.evaluate(()=>({web:_shareBase(), pageBase:location.href.split('#')[0],
    app:(window._shareNative=()=>true, _shareBase())}));
  assert.equal(base.web, base.pageBase, 'web: link stays on the page it was made on');
  assert.equal(base.app, 'https://modriff.com/play/', 'app: link points at the public page');

  // 2. A real song link built in app mode carries the public address and a decodable payload.
  const appUrl=await page.evaluate(()=>_shareUrl('song'));
  assert.ok(appUrl.startsWith('https://modriff.com/play/#prog='), 'song link: '+appUrl.slice(0,60));
  const appSetup=await page.evaluate(()=>_shareUrl('all'));
  assert.ok(appSetup.startsWith('https://modriff.com/play/#setup='), 'setup link: '+appSetup.slice(0,60));

  // 3. Share sheet in the app, copy elsewhere, and no copy after a cancelled sheet.
  const run=(native, shareImpl)=>page.evaluate(async([native, impl])=>{
    window._shareNative=()=>native;
    const calls={shared:[], copied:[]};
    window._shareCopy=(u)=>calls.copied.push(u);
    Object.defineProperty(navigator,'share',{configurable:true,value:(d)=>{
      calls.shared.push(d.url);
      return impl==='ok' ? Promise.resolve()
        : impl==='abort' ? Promise.reject(Object.assign(new Error('x'),{name:'AbortError'}))
        : Promise.reject(Object.assign(new Error('x'),{name:'NotAllowedError'}));
    }});
    _shareSend('https://example.test/#a','msg');
    await new Promise(r=>setTimeout(r,50));
    return calls;
  },[native, shareImpl]);
  let c=await run(true,'ok');      assert.deepEqual([c.shared.length,c.copied.length],[1,0],'app, sheet opens: shared once, no copy');
  c=await run(true,'abort');       assert.deepEqual([c.shared.length,c.copied.length],[1,0],'app, sheet cancelled: no copy');
  c=await run(true,'denied');      assert.deepEqual([c.shared.length,c.copied.length],[1,1],'app, sheet refused: falls back to copy');
  c=await run(false,'ok');         assert.deepEqual([c.shared.length,c.copied.length],[0,1],'web: copy, no sheet');

  // 4. The receiving side: the link made in the app opens on the web page and offers the song.
  const frag=appUrl.slice(appUrl.indexOf('#'));
  const rx=await ctx.newPage();
  rx.on('pageerror',e=>errors.push(String(e)));
  await rx.goto(origin+'/'+frag);
  await rx.waitForFunction(()=>/shared a song/.test(document.getElementById('unlock-note')?.textContent||''),null,{timeout:8000});
  const open=await rx.evaluate(()=>[...document.querySelectorAll('#unlock-choices button')].map(b=>b.textContent));
  assert.ok(open.some(t=>/^Open$/.test(t)), 'receiver offers Open: '+JSON.stringify(open));

  assert.deepEqual(errors,[], 'no page errors');
  console.log('PASS share links: base, share sheet vs copy, cancelled sheet, receiver opens an app-made link');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
