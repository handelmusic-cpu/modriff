/* The bottom part row (Drums, Bass, Melody, Arp, Chords) is on every page, whichever way you got there. It used to be hidden
   (visibility) on Song and Mix when the page was reached from Studio, but not from Live: the row followed the view mode that
   Song and Mix merely inherit, so the same tab drew differently depending on the previous one. */
'use strict';
const L=require('./lib.js');
(async()=>{const h=await L.start(),R=L.reporter();try{
 const row=page=>page.evaluate(()=>{const r=document.querySelector('.perf-bar .ft-parts'),c=getComputedStyle(r),b=r.getBoundingClientRect();
  const btns=[...r.querySelectorAll('.ft-btn')].filter(x=>{const q=x.getBoundingClientRect();return q.width>0&&q.height>0});
  return {shown:c.display!=='none'&&c.visibility!=='hidden'&&b.height>0&&b.bottom<=innerHeight+1&&b.top>=0,btns:btns.length,mode:document.body.classList.contains('mode-basic')?'live':'studio'}});
 for(const vp of ['se375','p390','ipad820']){
  const {page,ctx,errs}=await L.boot(h,vp,'studio');
  const go=async(w)=>{await page.evaluate(w=>{ if(w==='live') liveTab(); else if(w==='studio'){ setViewMode('advanced'); switchTab('perform'); } else if(w==='songs') switchTab('songs'); else if(w==='mix') switchTab('mix'); },w);await page.waitForTimeout(450);};
  for(const [from,to] of [['studio','songs'],['studio','mix'],['live','songs'],['live','mix'],['studio','live']]){
   await go(from);await go(to);const r=await row(page);
   R.check(r.shown&&r.btns>=4,vp+': '+from+' -> '+to+': the part row is showing',JSON.stringify(r));
  }
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));await ctx.close();
 }
 // Studio > Bass and Melody: the Generate / Clear row is above the Generate | Arrange | Play in switch (1.9.9.9j).
 {const {page,ctx}=await L.boot(h,'p390','studio');
  for(const n of ['Bass','Mel Seq']){await L.goStudio(page,n);
   const t=await page.evaluate(()=>{const q=s=>{const e=[...document.querySelectorAll('.tab-page.active '+s)].find(x=>x.getBoundingClientRect().height>0);return e?Math.round(e.getBoundingClientRect().top):null};return {gen:q('[data-acrow="gen"]'),mode:q('[data-acrow="mode"]')}});
   R.check(t.gen!==null&&t.mode!==null&&t.gen<t.mode,n+': Generate / Clear row is above the Generate | Arrange | Play in switch',JSON.stringify(t));}
  await ctx.close();}
}finally{await h.close()}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
