/* Run after npm run build. Exercises the shipped picker and actual decoded
   recordings rather than source strings. Native bank null tests live in tests/seq.
   PLAYWRIGHT can name an installed Playwright module; CHROMIUM a browser. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
let chromium;
try { ({chromium} = require('playwright')); }
catch (_) { ({chromium} = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.resolve(__dirname, '../..');
const ids = {grand:'pianogrand', upright:'pianoupright', old:'pianoold', ukulele:'ukulele', epfm:'epfm', epbright:'epbright'};
const reports = Object.keys(ids).filter(k=>fs.existsSync(path.join(root,'build/recorded-'+k+'.json')))
  .map(k=>({...JSON.parse(fs.readFileSync(path.join(root,'build/recorded-'+k+'.json'))),voice:ids[k]}));
(async()=>{
 const server=http.createServer((q,r)=>{
  const file=path.join(root,'dist',decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'content-type':file.endsWith('.html')?'text/html':'application/octet-stream'});r.end(e?'':b);});
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:430,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.getByText('Start',{exact:true}).first().click();await page.waitForTimeout(1200);
  await page.evaluate(()=>setModTier('pro'));
  for(const report of reports){
   const result=await page.evaluate(async({voice,label,samples})=>{
    preloadSampleInstrument(voice);
    const until=Date.now()+20000;
    while(SAMPLE_STATE[voice]==='loading'&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
    const buffers=SAMPLE_BUFFERS[voice]||{};
    const selected={};
    for(const part of ['chord','mel','arp','bass','melgen']){
     const sel=pbSelectFor(part),opt=sel&&Array.from(sel.options).find(o=>o.value===voice);
     if(!opt){selected[part]='missing';continue;}
     pbPick({sel,value:voice,locked:opt.disabled},{});
     selected[part]={value:sel.value,param:_wp(part+'.voice'),label:opt.dataset.l||opt.textContent};
    }
    const sr=48000,ctx=new OfflineAudioContext(2,sr*3,sr),gain=ctx.createGain();
    gain.gain.value=WAVE_GAIN[voice];gain.connect(ctx.destination);
    const nodes=makeVoice(ctx,60,gain,.02,1,voice,'chord');
    const rendered=await ctx.startRendering();
    let power=0,peak=0,finite=true;
    for(const x of rendered.getChannelData(0)){finite=finite&&Number.isFinite(x);power+=x*x;peak=Math.max(peak,Math.abs(x));}
    return {state:SAMPLE_STATE[voice],loaded:Object.keys(buffers).length,wanted:samples.length,
     missing:samples.filter(s=>!buffers[s.note]).map(s=>s.note),selected,finite,peak,rms:Math.sqrt(power/rendered.length),
     recorded:!!(nodes[0]&&nodes[0].buffer)};
   },report);
   assert.equal(result.state,'ready',report.voice+' loaded');
   assert.deepEqual(result.missing,[],report.voice+' every mapped recording decodes');
   assert.equal(result.loaded,result.wanted);
   for(const [part,value] of Object.entries(result.selected)){
    assert.equal(value.value,report.voice,part+' picker');assert.equal(value.param,report.voice,part+' engine selection');
    assert.match(value.label,new RegExp(report.label));
   }
   assert.ok(result.recorded&&result.finite&&result.rms>.001&&result.peak<1,JSON.stringify(result));
   console.log(report.label+': '+result.loaded+' recordings decoded; five part pickers; actual sample render RMS '+result.rms.toFixed(4)+', peak '+result.peak.toFixed(4));
  }
  const legacy=await page.evaluate(()=>{setWave('pianoreal');return {voice:wave,dir:SAMPLE_LIBS.pianoreal2.dir};});
  assert.deepEqual(legacy,{voice:'pianoreal2',dir:'samples/piano2'});
  assert.deepEqual(errors,[]);
  console.log('Legacy piano selection preserved; no page errors.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
