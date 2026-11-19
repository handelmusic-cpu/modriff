/* Two readable Studio rows, independent Drums/Aux entry points, and Live-style scroll hiding. */
'use strict';
const L=require('./lib.js');
(async()=>{const h=await L.start(),R=L.reporter();try{
 for(const vp of ['se375','p390','p430','ipad820','duoClosed']){
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
  await L.goStudio(page,'Chords');await page.waitForTimeout(600);
  await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop=260);await page.waitForTimeout(600);
  const hidden=await page.evaluate(()=>({hide:document.body.classList.contains('studio-nav-hide'),chips:[...document.querySelectorAll('.ss-chip')].filter(b=>b.getBoundingClientRect().height>0).length,pull:document.getElementById('studio-pull').getBoundingClientRect().height}));
  R.check(hidden.hide&&hidden.chips===0&&hidden.pull>=44,vp+': scrolling folds the rows into a 44 pt restore handle',JSON.stringify(hidden));
  await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop-=15);await page.waitForTimeout(250);
  R.check(await page.evaluate(()=>document.body.classList.contains('studio-nav-hide')),vp+': a small reverse scroll leaves the selector folded');
  await touch('#studio-pull');R.check(await page.evaluate(()=>!document.body.classList.contains('studio-nav-hide')),vp+': touching the handle restores both rows');
  await page.waitForTimeout(600);await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop+=150);await page.waitForTimeout(600);
  const before=await page.evaluate(()=>({sel:studioSel(),play:isAnythingPlaying()}));await touch('#studio-pull',65);
  const after=await page.evaluate(()=>({sel:studioSel(),play:isAnythingPlaying(),hidden:document.body.classList.contains('studio-nav-hide')}));
  R.check(!after.hidden&&before.sel===after.sel&&before.play===after.play,vp+': pulling down restores the selector without selecting a part or pressing Play',JSON.stringify(after));
  await page.waitForTimeout(600);await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop+=150);await page.waitForTimeout(600);await page.evaluate(()=>document.querySelector('.tab-page.active').scrollTop=0);await page.waitForTimeout(600);
  R.check(await page.evaluate(()=>!document.body.classList.contains('studio-nav-hide')),vp+': returning to the top restores both rows');
  if(vp==='p430')await page.screenshot({path:'/private/tmp/modriff-studio-two-rows.png'});
  await page.evaluate(()=>liveTab());await page.waitForTimeout(250);R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'&&!document.body.classList.contains('studio-nav-hide')),vp+': Live draws no Studio selector and clears its hidden state');
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));await ctx.close();
 }
 const {page,ctx}=await L.boot(h,'duoOpen','live');R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'),'open Duo: Live draws no Studio selector');await ctx.close();
}finally{await h.close()}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
