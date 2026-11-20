/* Two readable Studio rows, independent Drums/Aux entry points, and the strip living in the page flow (scrolls away, no bar). */
'use strict';
const L=require('./lib.js');
(async()=>{const h=await L.start(),R=L.reporter();try{
 for(const vp of ['se375','p390','p430','phoneLand','ipad820','duoClosed']){
  const {page,ctx,errs}=await L.boot(h,vp,'studio'),cdp=await ctx.newCDPSession(page);
  const touch=async(sel,down=0)=>{const p=await page.evaluate(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}},sel);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});if(down)for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+down*i/6}]});await page.waitForTimeout(25);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);};
  for(const name of ['Chords','Mel Seq']){
   await L.goStudio(page,name);const g=await page.evaluate(()=>{
    const el=document.getElementById('studio-strip'),chips=[...el.querySelectorAll('.ss-chip')].map(b=>{const r=b.getBoundingClientRect(),sp=b.querySelector('span');return {w:r.width,h:r.height,top:Math.round(r.top),font:parseFloat(getComputedStyle(b).fontSize),clipped:sp.scrollWidth>sp.clientWidth+1,margin:(r.width-sp.getBoundingClientRect().width)/2}});
    return {chips,rows:new Set(chips.map(c=>c.top)).size,right:el.getBoundingClientRect().right,vw:innerWidth};
   });
   R.check(g.chips.length===9&&g.rows===2,vp+' '+name+': nine parts in two rows',JSON.stringify({parts:g.chips.length,rows:g.rows}));
   R.check(g.chips.every(c=>c.w>=44&&c.h>=44&&c.font>=15&&!c.clipped&&c.margin>=3)&&g.right<=g.vw,vp+' '+name+': 15 pt labels fit 44 pt targets',JSON.stringify(g.chips));
  }
  await L.goStudio(page,'Drums');const on=await page.evaluate(()=>[window._sqLayerOn(0),window._sqLayerOn(1)]);
  await touch('#ss-aux');const aux=await page.evaluate(()=>({sel:studioSel(),focus:window._sqFocusNow(),title:document.getElementById('ac-part-title').textContent,cap:document.querySelector('#pp-cell-kit .pp-cap')?.textContent,on:[window._sqLayerOn(0),window._sqLayerOn(1)],duplicate:!!document.getElementById('sq-layerRow')}));
  R.check(aux.sel==='aux'&&aux.focus===1&&aux.title==='Aux'&&/Aux kit/i.test(aux.cap)&&!aux.duplicate&&JSON.stringify(aux.on)===JSON.stringify(on),vp+': Aux opens its drum layer without changing either part on/off state; no Kit/Aux row',JSON.stringify(aux));
  await touch('#ss-drums');R.check(await page.evaluate(()=>studioSel()==='drums'&&window._sqFocusNow()===0&&document.getElementById('ac-part-title').textContent==='Drums'),vp+': Drums opens the main kit again');
  // The strip is the first thing in the page's own flow: at the top it shows, scrolled down it is gone with the content and
  // leaves no bar behind (it used to be sticky and fold into a 44 pt handle over the content).
  for(const name of ['Chords','Drums']){
   await L.goStudio(page,name);await page.waitForTimeout(400);
   const probe=()=>page.evaluate(()=>{const pg=document.querySelector('.tab-page.active'),el=document.getElementById('studio-strip'),r=el.getBoundingClientRect(),cs=getComputedStyle(el),
     inset=parseFloat(getComputedStyle(document.body).paddingTop)||0,y=Math.max(inset,0)+6,hit=document.elementFromPoint(innerWidth/2,y);
     return {top:pg.scrollTop,max:pg.scrollHeight-pg.clientHeight,pos:cs.position,stripTop:Math.round(r.top),stripBottom:Math.round(r.bottom),h:Math.round(r.height),
      chips:[...el.querySelectorAll('.ss-chip')].filter(b=>b.getBoundingClientRect().height>0).length,pull:!!document.getElementById('studio-pull'),
      hitInStrip:!!(hit&&hit.closest('#studio-strip')),hitTag:hit?(hit.id||hit.className||hit.tagName):'',nav:document.body.classList.contains('studio-nav-hide'),
      pageTop:Math.round(pg.getBoundingClientRect().top)}});
   await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop=0);await page.waitForTimeout(300);const t=await probe();
   R.check(t.pos!=='sticky'&&t.pos!=='fixed'&&t.chips===9&&t.stripTop>=t.pageTop-1&&t.stripBottom>t.pageTop&&!t.pull,vp+' '+name+': at the top the strip shows, in the page flow',JSON.stringify(t));
   await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop=Math.min(400,document.querySelector('.tab-page.active').scrollHeight));await page.waitForTimeout(600);const d=await probe();
   if(d.max>t.h+40)R.check(d.top>t.h&&d.stripBottom<=d.pageTop+1&&!d.hitInStrip&&!d.nav&&d.chips===9,vp+' '+name+': scrolled down the strip is gone with the content and no bar is left behind',JSON.stringify(d));
   else R.check(true,vp+' '+name+': page too short to scroll past the strip here',JSON.stringify({max:d.max,h:t.h}));
   await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop=0);await page.waitForTimeout(300);
   R.check((await probe()).stripTop>=t.pageTop-1,vp+' '+name+': back at the top the strip is back');
  }
  if(vp==='p430')await page.screenshot({path:'/private/tmp/modriff-studio-two-rows.png'});
  await page.evaluate(()=>liveTab());await page.waitForTimeout(250);R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'),vp+': Live draws no Studio selector');
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));await ctx.close();
 }
 const {page,ctx}=await L.boot(h,'duoOpen','live');R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'),'open Duo: Live draws no Studio selector');await ctx.close();
}finally{await h.close()}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
