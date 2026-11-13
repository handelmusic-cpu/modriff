// Exercise the shipped Settings surface at phone and Mac widths, with bridge replies.
const {chromium} = require(process.env.PLAYWRIGHT || '/private/tmp/modriff-browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
(async () => {
 const root = path.resolve(__dirname, '../../dist');
 const server = http.createServer((req,res) => {
  const file=path.join(root,decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file,(err,body)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(err?'missing':body);});
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 let browser;
 try {
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  for(const width of [390,1200]) {
   const page=await browser.newPage({viewport:{width,height:844}});
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.waitForFunction(()=>typeof window.modOutputPaint==='function');
   assert.equal(await page.locator('#audio-output-settings').evaluate(e=>e.hidden),true);
   await page.evaluate(()=>unlockAudio('blank'));
   await page.waitForFunction(()=>document.getElementById('audio-unlock').style.display==='none');
   const results=await page.evaluate(async()=>{
    const out=[], check=(ok,name)=>out.push({ok:!!ok,name});
    let state={mode:'devices',selected:'usb-1',current:'Studio interface',devices:[{id:'usb-1',name:'Studio interface'},{id:'usb-2',name:'Second interface <b>literal</b>'}]};
    const calls=[];
    MODOUTPUT.plugin={audioOutputs:async()=>state,selectAudioOutput:async({id})=>{calls.push(id);state={...state,selected:id,current:id==='usb-2'?'Second interface':'System speakers'};return state;},openAudioOutputPicker:async()=>{calls.push('picker');}};
    await modOutputRefresh();openSettings();if(!ssOpen.global)toggleSS('global');
    const sel=document.getElementById('audio-output-device');
    check(!sel.hidden && sel.value==='usb-1' && sel.options.length===3,'two interfaces plus system default');
    check(sel.options[2].text==='Second interface <b>literal</b>' && !sel.querySelector('b'),'device names are literal text');
    sel.value='usb-2';sel.dispatchEvent(new Event('change'));
    await new Promise(r=>setTimeout(r,0));
    check(calls[0]==='usb-2' && sel.value==='usb-2' && !sel.disabled,'selection reaches bridge');
    check(document.getElementById('audio-output-current').textContent==='Current output: Second interface','current output updated');
    MODOUTPUT.plugin.selectAudioOutput=async()=>{throw new Error('Interface disconnected');};
    await modOutputSelect('usb-1');
    check(sel.value==='usb-2' && !sel.disabled && document.getElementById('audio-output-current').textContent.includes('Interface disconnected'),'failure restores selection and shows error');
    state={...state,devices:[],current:'System speakers'};await modOutputRefresh();
    check(sel.options.length===2 && sel.value==='usb-2' && sel.options[1].text.includes('unavailable'),'unplugged preference and fallback shown');
    state={mode:'system',current:'Wireless headphones'};await modOutputRefresh();await modOutputChoose();
    check(sel.hidden && !document.getElementById('audio-output-choose').hidden && calls.includes('picker'),'phone opens native picker');
    check(document.getElementById('audio-output-current').getAttribute('role')==='status' && sel.getAttribute('aria-label'),'status and select accessible');
    const host=document.getElementById('audio-output-settings');
    check(host.getBoundingClientRect().right<=innerWidth && document.documentElement.scrollWidth<=innerWidth,'output controls fit window');
    return out;
   });
   for(const row of results){console.log(`${row.ok?'PASS':'FAIL'} ${width}: ${row.name}`);assert(row.ok,row.name);}
   if(width===1200) await page.evaluate(()=>modOutputPaint({mode:'devices',selected:'usb-1',current:'Studio interface',devices:[{id:'usb-1',name:'Studio interface'},{id:'usb-2',name:'Second interface'}]}));
   await page.locator('#audio-output-settings').scrollIntoViewIfNeeded();
   assert(await page.locator(width===1200?'#audio-output-device':'#audio-output-choose').isVisible());
   await page.screenshot({path:`/private/tmp/modriff-output-settings-${width}.png`,fullPage:false});
   await page.close();
  }
 } finally {if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
