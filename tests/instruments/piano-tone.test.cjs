/* Run after npm run build. Compare the actual recordings through the part's
   voice chain with a direct sample render; saved synth Tone settings must not
   darken Grand/Upright/Old. Keep deliberate stereo placement and synth tone. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((q,r)=>{const file=path.join(root,'dist',decodeURIComponent(q.url.split('?')[0]));fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'content-type':file.endsWith('.html')?'text/html':'application/octet-stream'});r.end(e?'':b);});}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.getByText('Start',{exact:true}).first().click();await page.waitForTimeout(1200);
  const result=await page.evaluate(async()=>{
   setModTier('pro');
   const voices=['pianogrand','pianoupright','pianoold'];
   for(const voice of [...voices,'pianoreal2']){preloadSampleInstrument(voice);const until=Date.now()+20000;while(SAMPLE_STATE[voice]==='loading'&&Date.now()<until)await new Promise(r=>setTimeout(r,20));if(SAMPLE_STATE[voice]!=='ready')throw Error(voice+' not loaded');}
   const sr=48000,rows=[];
   async function render(voice,part,midi,chain,tone,width=0,pan=0){
    const ctx=new OfflineAudioContext(2,sr,sr),g=ctx.createGain();let filters=0;
    const biquad=ctx.createBiquadFilter.bind(ctx);ctx.createBiquadFilter=()=>{filters++;return biquad();};
    window._partBuses={[part]:ctx.destination};
    Object.assign(window._webParams,{[part+'.voice']:voice,'fx.cutoff':tone,'fx.env':.7,'fx.reso':.4,'fx.width':width,'fx.drift':0});
    g.gain.value=.25;
    const fx=chain?voiceFx(ctx,.01,.8,.8,pan,part):{head:ctx.destination};g.connect(fx.head);
    makeVoice(ctx,midi,g,.01,.8,voice,part);
    const audio=await ctx.startRendering();return {audio,filters};
   }
   const rms=d=>Math.sqrt(d.reduce((q,x)=>q+x*x,0)/d.length);
   for(const voice of voices)for(const part of ['chord','mel','arp'])for(const midi of [48,60,72]){
    const direct=await render(voice,part,midi,false,1),raw=direct.audio.getChannelData(0);
    for(const tone of [.88,.4]){
     const through=await render(voice,part,midi,true,tone),d=through.audio.getChannelData(0);let err=0,peak=0,finite=true;
     for(let i=0;i<d.length;i++){err+=(d[i]-raw[i])**2;peak=Math.max(peak,Math.abs(d[i]));finite=finite&&Number.isFinite(d[i]);}
     rows.push({voice,part,midi,tone,filters:through.filters,rms:rms(d),peak,finite,error:Math.sqrt(err/d.length)});
    }
   }
   const stereo=await render('pianogrand','chord',60,true,.4,1,1);
   const synthRaw=await render('square','chord',84,false,1),synthTone=await render('square','chord',84,true,.1);
   const legacy=await render('pianoreal2','chord',60,true,.4);
   return {rows,stereo:{filters:stereo.filters,left:rms(stereo.audio.getChannelData(0)),right:rms(stereo.audio.getChannelData(1))},
    synth:{filters:synthTone.filters,ratio:rms(synthTone.audio.getChannelData(0))/rms(synthRaw.audio.getChannelData(0))},legacyFilters:legacy.filters};
  });
  for(const row of result.rows){assert.equal(row.filters,0,JSON.stringify(row));assert.ok(row.finite&&row.rms>.001&&row.peak<1,JSON.stringify(row));assert.ok(row.error<1e-7,JSON.stringify(row));}
  assert.equal(result.stereo.filters,0);assert.ok(result.stereo.right>.001&&result.stereo.left<1e-7,JSON.stringify(result.stereo));
  assert.equal(result.synth.filters,1);assert.ok(result.synth.ratio<.5,JSON.stringify(result.synth));assert.equal(result.legacyFilters,1);
  assert.deepEqual(errors,[]);
  console.log(result.rows.length+' piano renders match the direct recording within 1e-7 RMS; no low-pass at default or lowered Tone.');
  console.log('Width remains stereo; synth Tone attenuates '+(20*Math.log10(result.synth.ratio)).toFixed(1)+' dB; Room retains its previous filter path.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
