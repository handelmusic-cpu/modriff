const L=require(process.cwd()+'/tests/layout/lib.js');
(async()=>{const h=await L.start(),R=L.reporter();try{
 for(const vp of ['se375','p430','ipad820']){
  const {page,ctx,errs}=await L.boot(h,vp,'studio');const cdp=await ctx.newCDPSession(page);
  let total=0;
  for(const name of L.STUDIO){await L.goStudio(page,name);
   const cards=await page.evaluate(()=>[...document.querySelectorAll('.tab-page.active .st-card-h')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({key:e.dataset.k,body:e.getAttribute('aria-controls'),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));
   R.check(cards.length>0&&cards.every(c=>c.w>=44&&c.h>=44),vp+' '+name+': section carets meet 44 pt',cards.map(x=>x.key).join(','));
   const old=(await page.evaluate(L.SCAN)).filter(c=>!/^#(ss-|studio-pull)/.test(c.key));let bad=[];
   for(const c of cards){
    const sel='.st-card-h[data-k="'+c.key+'"]';
    const tap=async()=>{await page.evaluate(s=>document.querySelector(s).scrollIntoView({block:'center'}),sel);await page.waitForTimeout(100);const p=await page.evaluate(s=>{let r=document.querySelector(s).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}},sel);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(60);};
    await tap();const shut=await page.evaluate(id=>{let b=document.getElementById(id);return b.getBoundingClientRect().height===0&&b._stFold.getAttribute('aria-expanded')==='false'},c.body);
    await tap();const open=await page.evaluate(id=>{let b=document.getElementById(id);return b.getBoundingClientRect().height>0&&b._stFold.getAttribute('aria-expanded')==='true'},c.body);
    if(!shut||!open)bad.push(c.key+':'+shut+'/'+open);total++;
   }
   const after=(await page.evaluate(L.SCAN)).filter(c=>!/^#(ss-|studio-pull)/.test(c.key));R.check(bad.length===0&&old.length===after.length,vp+' '+name+': real touch closes/opens every card and restores controls',JSON.stringify({bad,before:old.length,after:after.length}));
   R.check(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,vp+' '+name+': no horizontal overflow');
   if(vp==='p430'&&name==='Bass')await page.screenshot({path:'/private/tmp/modriff-studio-cards.png'});
  }
  await L.goStudio(page,'mõdFX');await page.evaluate(()=>document.querySelector('.st-card-h[data-k="fx-pad"]').click());
  await L.goStudio(page,'Bass');await L.goStudio(page,'mõdFX');
  R.check(await page.evaluate(()=>document.querySelector('.st-card-h[data-k="fx-pad"]').getAttribute('aria-expanded')==='false'),vp+': a rebuilt FX page retains the folded card in this session');
  await L.goStudio(page,'Sampler');await page.evaluate(()=>{document.querySelector('.st-card-h[data-k="sampler-play"]').click();_findGo({tab:'perform',sub:()=>setPerformMode('pads'),el:'ps-loadbtn'});});await page.waitForTimeout(200);
  R.check(await page.evaluate(()=>document.querySelector('.st-card-h[data-k="sampler-play"]').getAttribute('aria-expanded')==='true'),vp+': Find reveals a control inside a closed card');
  await page.evaluate(()=>{document.querySelectorAll('.st-card-h.open').forEach(b=>b.click());liveTab();});await page.waitForTimeout(300);
  const live=await page.evaluate(()=>({heads:[...document.querySelectorAll('.st-card-h')].filter(e=>e.getBoundingClientRect().height>0).length,pads:document.getElementById('chords-diatonic').getBoundingClientRect().height,keys:document.querySelector('.mel-keys-host').getBoundingClientRect().height,over:document.documentElement.scrollWidth-innerWidth}));
  R.check(live.heads===0&&live.pads>0&&live.keys>0&&live.over<=1,vp+': folded Studio cards leave Live pads and keys visible',JSON.stringify(live));
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));console.log('Measured '+total+' card touch cycles at '+vp);await ctx.close();
 }
}finally{await h.close();}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
