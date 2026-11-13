/* Serve and drive dist/: permission/lifecycle counters, the real Settings
   button, keyboard input, persistence over reload and phone/Mac layout.
   npm run build && node tests/bgplay/probe.js */
'use strict';
const {chromium}=require(process.env.PLAYWRIGHT || '/private/tmp/modriff-browser-tools/node_modules/playwright');
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
(async()=>{
  const root=path.resolve(__dirname,'../../dist');
  const server=http.createServer((req,res)=>{
    const file=path.join(root,decodeURIComponent(req.url.split('?')[0])==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(file,(err,body)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(err?'missing':body);});
  }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  let browser;
  const check=(ok,name)=>{console.log(`${ok?'PASS':'FAIL'} ${name}`);assert(ok,name);};
  const nativeSettings=async page=>{
    await page.evaluate(async()=>{
      await unlockAudio('blank');
      window.Capacitor={isNativePlatform:()=>true};
      _syncBackgroundAudio();openSettings();if(!ssOpen.global)toggleSS('global');
    });
    await page.locator('#background-audio-toggle').scrollIntoViewIfNeeded();
  };
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
    for(const width of [390,1200]) {
      const page=await browser.newPage({viewport:{width,height:844},hasTouch:width===390,isMobile:width===390}), errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(()=>typeof window.toggleBackgroundAudio==='function');
      check(await page.locator('#background-audio-settings').evaluate(e=>e.hidden),`${width}: browser hides native background setting`);
      await page.addScriptTag({path:path.join(__dirname,'inpage.js')});
      for(const [ok,name,d] of await page.evaluate(()=>window.__bgprobe()))check(ok,`${width}: ${name}${d?' ('+d+')':''}`);
      await nativeSettings(page);
      const button=page.locator('#background-audio-toggle');
      check(await button.isVisible(),`${width}: native Settings exposes the toggle`);
      check(await button.getAttribute('aria-pressed')==='true',`${width}: new installs default ON`);
      if(width===390){
        const cdp=await page.context().newCDPSession(page), box=await button.boundingBox();
        const point={x:box.x+box.width/2,y:box.y+box.height/2};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[point]});
        await cdp.detach();
      }else await button.click();
      check(await button.getAttribute('aria-pressed')==='false' && await button.textContent()==='Background audio: OFF',`${width}: real click turns OFF`);
      check(await page.evaluate(()=>localStorage.getItem('modo-bgplay'))==='0',`${width}: OFF is saved`);
      await page.reload();await nativeSettings(page);
      check(await button.getAttribute('aria-pressed')==='false',`${width}: OFF survives reload`);
      await button.focus();await page.keyboard.press('Space');
      check(await button.getAttribute('aria-pressed')==='true' && await page.evaluate(()=>localStorage.getItem('modo-bgplay'))==='1',`${width}: keyboard turns ON and saves`);
      check(await page.evaluate(()=>!isAnythingPlaying()),`${width}: keyboard toggle does not start the band`);
      await page.reload();await nativeSettings(page);
      check(await button.getAttribute('aria-pressed')==='true',`${width}: ON survives reload`);
      check(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.height>=44 && r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth;}),`${width}: toggle fits and has a 44px touch target`);
      await page.screenshot({path:`/private/tmp/modriff-background-settings-${width}.png`});
      check(errors.length===0,`${width}: no script errors ${errors.join(' | ')}`);
      await page.close();
    }
  } finally {if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
