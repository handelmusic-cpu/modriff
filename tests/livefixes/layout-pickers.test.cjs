/* Run after npm run build. A real touch must reach a body-mounted sound menu
   above either Live controls sheet; CSS visibility alone missed this bug. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((q,r)=>{const file=path.join(root,'dist',decodeURIComponent(q.url.split('?')[0]));fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'content-type':file.endsWith('.html')?'text/html':'application/octet-stream'});r.end(e?'':b);});}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:430,height:932},hasTouch:true,isMobile:true,serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.getByText('Start',{exact:true}).first().tap();await page.waitForTimeout(1200);
  await page.evaluate(()=>{setModTier('pro');setViewMode('advanced');switchTab('perform');cpAddVariant(cpSources().diatonic[0],'maj9',null);});
  for(const [width,height] of [[390,844],[430,932],[844,430],[1280,900],[1600,1000]]){
   await page.setViewportSize({width,height});
   const rows=await page.evaluate(()=>{const ids=['chords-diatonic','chords-modal-wrap','chords-dom-wrap','chords-user-wrap'];const bar=document.getElementById('cr-bar').getBoundingClientRect();return ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect();return {id,bottom:r.bottom,barTop:bar.top,visible:r.height>0};});});
   for(const row of rows){assert.ok(row.visible,JSON.stringify(row));assert.ok(row.bottom<=row.barTop,JSON.stringify({width,...row}));}
   console.log(width+'px: rhythm below all four chord rows');
  }
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>{setViewMode('basic');switchTab('perform');});
  for(const [widget,host,part] of [['melody','melvoice-settings','mel'],['chords','bw-voices','chord']]){
   await page.locator('.lv-slot[data-mod="'+widget+'"] .lv-cb').tap();
   const trigger=page.locator('#sndpick-'+host+' .snd-pick-btn'),pop=page.locator('#sndpop-'+host);
   await trigger.tap();
   await assert.doesNotReject(()=>pop.locator('.pb-tier').filter({has:page.locator('.pb-name', {hasText:/^Samples$/})}).tap({timeout:3000}),widget+' menu receives touch above sheet');
   await pop.getByText('Keys',{exact:true}).tap();await pop.getByRole('option',{name:/^Grand/}).tap();
   assert.equal(await page.evaluate(p=>_wp(p+'.voice'),part),'pianogrand');
   assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   await page.evaluate(()=>vpPatchesEnsure());
   await trigger.tap();await pop.locator('.pb-tier').filter({hasText:'mõdSynth'}).tap();
   await pop.locator('.pb-row').filter({has:page.locator('.pb-name',{hasText:/^Keys$/})}).tap();
   const patch=pop.locator('.pb-root [role=option]').first(),name=await patch.textContent();await patch.tap();
   await page.waitForFunction(({part,name})=>MSX.state[part]&&MSX.state[part].patch===name,{part,name});
   assert.equal(await page.evaluate(p=>_wp(p+'.voice'),part),'modsynth');
   assert.ok((await trigger.textContent()).includes(name));
   await trigger.tap();await page.keyboard.press('Escape');
   assert.equal(await pop.evaluate(el=>el.classList.contains('open')),false,'Escape closes detached menu with sheet');
   assert.equal(await page.locator('.lv-slot.lv-sheet').count(),0);
   console.log(widget+': touch selects Grand and a synth patch; label updates; Escape clears sheet and menu');
  }
  // Dismissing the picker alone leaves the controls available.
  await page.locator('.lv-slot[data-mod="melody"] .lv-cb').tap();
  await page.locator('#sndpick-melvoice-settings .snd-pick-btn').tap();
  // The sheet is about half the screen now (1.9.9.9h), so the open menu lies over most of its title: tap the part of the title it leaves free.
  await page.locator('.lv-sh-t').tap({position:{x:4,y:10}});
  assert.equal(await page.locator('#sndpop-melvoice-settings').evaluate(el=>el.classList.contains('open')),false);
  await page.locator('.lv-sh-done').tap();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
