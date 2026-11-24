// Separate placement layouts preserve the focal content inside Apple's very different safe areas.
// Run from any directory: node docs/app-store/creative-assets/render.mjs
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..');
// Export the actual splash artwork: recreating the name with a font loses the wave, knobs and envelope.
const app=await readFile(path.join(root,'index.html'),'utf8');
const logo=app.match(/<button\b[^>]*\bid="unlock-logo"[^>]*>(<svg\b[\s\S]*?<\/svg>)/)?.[1];
const palette=app.match(/\.unlock-logo\s*\{([\s\S]*?)\}/)?.[1];
if(!logo||!palette)throw Error('Splash logo or palette not found');
const colors=Object.fromEntries([...palette.matchAll(/(--wm-[\w]+):([^;]+);/g)].map(m=>[m[1],m[2]]));
colors['--wm-bg']='#080a14';
// The app uses overflow:visible: the final f extends past its viewBox. Standalone images need that canvas padding.
const exported=logo.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replace('viewBox="-40 -830 3812 1390"','viewBox="-40 -830 3919 1390"').replace(/var\((--wm-[\w]+)\)/g,(_,key)=>{if(!colors[key])throw Error('Missing logo color '+key);return colors[key];});
await writeFile(path.join(out,'splash-logo.svg'),exported+'\n');
const server=createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(path.join(os.tmpdir(),'modriff-creative-'));
const chrome=spawn(process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
let ws;
try{
  const endpoint=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error('Chrome debugging endpoint timeout')),20000);
    chrome.stderr.on('data',d=>{log+=d;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    chrome.once('error',e=>{clearTimeout(timer);reject(e);});
    chrome.once('exit',code=>{clearTimeout(timer);reject(Error('Chrome exited '+code+' '+log.slice(-1500)));});
  });
  const targets=await(await fetch(new URL('/json/list',endpoint.replace('ws:','http:')))).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send('Page.enable');
  for(const [placement,height,safe]of [['header',1646,[1097,493,1646,661]],['search',2560,[836,765,2168,1030]]]){
    await send('Emulation.setDeviceMetricsOverride',{width:3840,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/docs/app-store/creative-assets/artwork.html?placement=${placement}`});
    let ready=false;
    for(let i=0;i<100;i++){
      ready=await ev(`location.search==='?placement=${placement}'&&!!document.querySelector('.wordmark')`);
      if(ready)break;await new Promise(r=>setTimeout(r,50));
    }
    if(!ready)throw Error('Artwork did not load');
    await ev('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))');
    const fit=await ev(`(() => {
      const [left, top, width, height] = ${JSON.stringify(safe)};
      return [...document.querySelectorAll('.wordmark, .line, .interface')].map(element => {
        // Check the rendered headline too, since nowrap text can overflow its box.
        const contents = document.createRange();
        contents.selectNodeContents(element);
        const bounds = element.matches('.line') ? contents.getBoundingClientRect() : element.getBoundingClientRect();
        return {
          element: element.className,
          clearance: Math.floor(Math.min(bounds.left - left, bounds.top - top,
            left + width - bounds.right, top + height - bounds.bottom))
        };
      });
    })()`);
    if(fit.some(f=>f.clearance<0))throw Error('Outside safe area: '+JSON.stringify(fit));
    const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:3840,height,scale:1}});
    await writeFile(path.join(out,`modriff-${placement}.png`),Buffer.from(shot.data,'base64'));
    console.log(placement,`3840 x ${height}`,JSON.stringify(fit));
  }
}finally{ws?.close();chrome.kill();server.close();await new Promise(r=>setTimeout(r,500));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
