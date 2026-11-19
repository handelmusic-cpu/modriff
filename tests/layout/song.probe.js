const L=require(process.cwd()+'/tests/layout/lib.js');
(async()=>{const h=await L.start(),R=L.reporter();try{
 for(const vp of ['se375','p390','p430','ipad820']){
  const {page,ctx,errs}=await L.boot(h,vp,'studio');
  await page.evaluate(()=>{
   const built=songFromChordSheet(parseChordSheet('[Verse]\nDbmaj9/Ab G7b13/B F#m7b5/C E7#9/G#\n[Chorus]\nCmaj7 Dm9 G13 C6/9\n'),{len:1});
   sections=built.song.sections;document.getElementById('chart-title').value='A very long song title — midnight changes and an unbrokenwordthatmustwrap';
   switchTab('songs');setSongsMode('perform');songsPerformViewSet('tiles');renderSongsPerformView();
  });
  const a=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.songs-section-block .songs-chord-btn')];
   return {count:els.length,bad:els.filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().height<44).map(e=>e.textContent),over:document.documentElement.scrollWidth-innerWidth,cols:getComputedStyle(document.querySelector('.songs-chord-row')).gridTemplateColumns};
  });
  R.check(a.count===8&&a.bad.length===0&&a.over<=1,vp+': all altered and slash chords fit readable tiles',JSON.stringify(a));
  await page.evaluate(()=>{songsPerformViewSet('chart');renderChordChart();});
  const b=await page.evaluate(()=>{const t=document.getElementById('chart-song-title'),r=t.getBoundingClientRect(),head=t.previousElementSibling.getBoundingClientRect();return {visible:r.height>0,under:r.top>=head.bottom,fit:t.scrollWidth<=t.clientWidth+1,over:document.documentElement.scrollWidth-innerWidth,text:t.textContent};});
  R.check(b.visible&&b.under&&b.fit&&b.over<=1,vp+': long chart title wraps below the heading',JSON.stringify(b));
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));await ctx.close();
 }
}finally{await h.close();}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
