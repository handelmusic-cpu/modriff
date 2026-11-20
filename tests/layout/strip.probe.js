/* Studio shows one module at a time (1.9.9.9r): the header is the module's name as a button, one tap opens a picker with all nine
   modules in three groups, a module opens on its first tab, Bass/Melody/Solo have their own tabs, and the bottom part switches
   toggle parts without changing the editor. Real touch (CDP) throughout.

   Run: node tests/layout/strip.probe.js   (serves the repo itself; env URL / CHROMIUM as for the other layout probes) */
'use strict';
const L=require('./lib.js');
const NINE=['Drums','Aux','Bass','Melody','Arp','Chords','Solo','Sampler','mõdFX'];
const GROUPS={'Write a pattern':['Drums','Aux','Bass','Melody','Arp'],'Play':['Chords','Solo','Sampler'],'Shape the sound':['mõdFX']};
(async()=>{const h=await L.start(),R=L.reporter();try{
 for(const vp of ['se375','p390','p430','phoneLand','ipad820','duoClosed']){
  const {page,ctx,errs}=await L.boot(h,vp,'studio'),cdp=await ctx.newCDPSession(page);
  const touch=async sel=>{const p=await page.evaluate(s=>{const e=document.querySelector(s);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}},sel);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);};
  const vis=sel=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'},sel);
  const chip=n=>page.evaluate(n=>[...document.querySelectorAll('#studio-strip .ss-chip')].filter(b=>b.dataset.page===n)[0].id,n);
  const openPick=async()=>{if(!await vis('#ss-pick'))await touch('#ss-cur');};
  const goto=async n=>{await openPick();await touch('#'+await chip(n));};
  const sel=()=>page.evaluate(()=>({k:studioSel(),cur:document.querySelector('#ss-cur .ss-cur-n').textContent,open:document.getElementById('studio-strip').classList.contains('ss-open')}));

  await L.goStudio(page,'Bass');
  // 1. A header, not nine permanent chips.
  const hd=await page.evaluate(()=>{const c=document.getElementById('ss-cur').getBoundingClientRect(),p=document.getElementById('ss-pick');
   return {name:document.querySelector('#ss-cur .ss-cur-n').textContent,h:c.height,w:c.width,pickShown:getComputedStyle(p).display!=='none',expanded:document.getElementById('ss-cur').getAttribute('aria-expanded')}});
  R.check(hd.name==='Bass'&&hd.h>=44&&hd.w>=44&&!hd.pickShown&&hd.expanded==='false',vp+': the header names the module (Bass) as a 44 pt button and the picker is closed',JSON.stringify(hd));
  // 2. One tap opens the picker: nine modules, three headings, every one a 44 pt target that fits.
  await touch('#ss-cur');
  const pk=await page.evaluate(()=>{const p=document.getElementById('ss-pick'),vw=innerWidth,
    groups=[...p.querySelectorAll('.ss-grp')].map(g=>[g.querySelector('.ss-gh').textContent,[...g.querySelectorAll('.ss-chip')].map(b=>b.dataset.page)]),
    chips=[...p.querySelectorAll('.ss-chip')].map(b=>{const r=b.getBoundingClientRect(),sp=b.querySelector('span');return {n:b.dataset.page,w:r.width,h:r.height,l:r.left,r:r.right,font:parseFloat(getComputedStyle(b).fontSize),clipped:sp.scrollWidth>sp.clientWidth+1}});
   return {groups,chips,vw,expanded:document.getElementById('ss-cur').getAttribute('aria-expanded'),shown:getComputedStyle(p).display!=='none'}});
  const okc=c=>c.w>=44&&c.h>=44&&c.font>=15&&!c.clipped&&c.l>=0&&c.r<=pk.vw;
  R.check(pk.shown&&pk.expanded==='true'&&JSON.stringify(Object.fromEntries(pk.groups))===JSON.stringify(GROUPS),vp+': one tap opens the picker with the three groups',JSON.stringify(pk.groups));
  R.check(pk.chips.length===9&&pk.chips.every(okc),vp+': all nine are visible 44 pt targets with 15 pt labels',JSON.stringify(pk.chips.filter(c=>!okc(c))));
  // 3. Tapping a module opens its editor and closes the picker; the header follows.
  for(const n of NINE){
   await goto(n);const s=await sel();
   R.check(s.cur===n&&!s.open&&await vis('#ss-cur'),vp+': '+n+' opens, the picker closes, the header says '+n,JSON.stringify(s));
  }
  // Aux is the drums' second layer: it changes neither part's on/off state.
  await goto('Drums');const on=await page.evaluate(()=>[window._sqLayerOn(0),window._sqLayerOn(1)]);
  await goto('Aux');const aux=await page.evaluate(()=>({sel:studioSel(),focus:window._sqFocusNow(),on:[window._sqLayerOn(0),window._sqLayerOn(1)],duplicate:!!document.getElementById('sq-layerRow')}));
  R.check(aux.sel==='aux'&&aux.focus===1&&JSON.stringify(aux.on)===JSON.stringify(on)&&!aux.duplicate,vp+': Aux opens its drum layer without changing either part on/off',JSON.stringify(aux));
  await goto('Drums');R.check(await page.evaluate(()=>studioSel()==='drums'&&window._sqFocusNow()===0),vp+': Drums opens the main kit again');
  // 4. Dismissal: outside tap and Escape.
  await touch('#ss-cur');R.check((await sel()).open,vp+': open again');
  await page.evaluate(()=>document.getElementById('studio-strip').classList.contains('ss-open')||ssPickOpen(true));await touch('.sq-status');   // the drum page's status line: outside the strip, does nothing
  R.check(!(await sel()).open,vp+': a tap outside closes the picker');
  await touch('#ss-cur');await page.keyboard.press('Escape');await page.waitForTimeout(150);R.check(!(await sel()).open,vp+': Escape closes the picker');

  // 5. Tabs. Bass and Melody: Pattern, Sound, Timing. Solo: Keys, Sound, Touch. None elsewhere.
  const tabs=()=>page.evaluate(()=>({names:[...document.querySelectorAll('#ss-tabs .ss-tab')].map(b=>b.textContent),pressed:[...document.querySelectorAll('#ss-tabs .ss-tab[aria-pressed="true"]')].map(b=>b.textContent).join(),shown:getComputedStyle(document.getElementById('ss-tabs')).display!=='none',h:[...document.querySelectorAll('#ss-tabs .ss-tab')].map(b=>Math.round(b.getBoundingClientRect().height))}));
  for(const [n,want,first] of [['Bass',['Pattern','Sound','Timing'],'Pattern'],['Melody',['Pattern','Sound','Timing'],'Pattern'],['Solo',['Keys','Sound','Touch'],'Keys']]){
   await goto(n);const t=await tabs();
   R.check(t.shown&&JSON.stringify(t.names)===JSON.stringify(want)&&t.pressed===first&&t.h.every(x=>x>=44),vp+': '+n+' has '+want.join(' / ')+', opens on '+first+', 44 pt tabs',JSON.stringify(t));
  }
  for(const n of ['Drums','Aux','Arp','Chords','Sampler','mõdFX']){await goto(n);R.check(!(await tabs()).shown,vp+': '+n+' has no tab row');}
  const S={bass:{line:'#pp-cell-bass-line',patch:'#pp-cell-bass-patch',roll:'#bm-bass-panel .pr-host',time:'#bm-bass-panel .bl-transport',tone:'#bm-bass-panel .msx-pcard'},
           melody:{line:'#pp-cell-melody-line',patch:'#pp-cell-melody-patch',roll:'#bm-melody-panel .pr-host',time:'#bm-melody-panel .bl-transport',tone:'#bm-melody-panel .msx-pcard'}};
  for(const [n,k] of [['Bass','bass'],['Melody','melody']]){
   const x=S[k];await goto(n);
   const st=async()=>({line:await vis(x.line),patch:await vis(x.patch),roll:await vis(x.roll),time:await vis(x.time),tone:await vis(x.tone),toolbar:await vis('#bm-'+k+'-panel .ac-toolbar'),more:await vis('#bm-'+k+'-panel .ac-more')});
   let v=await st();R.check(v.line&&v.roll&&v.toolbar&&!v.patch&&!v.time&&!v.tone&&!v.more,vp+': '+n+' Pattern shows the line style, the roll and its toolbar only',JSON.stringify(v));
   await touch('#ss-tab-sound');v=await st();R.check(v.patch&&v.tone&&!v.roll&&!v.toolbar&&!v.line&&!v.time,vp+': '+n+' Sound shows the voice and the synth card only',JSON.stringify(v));
   await touch('#ss-tab-timing');v=await st();R.check(v.time&&!v.roll&&!v.patch&&!v.tone&&!v.line,vp+': '+n+' Timing shows the timing card only',JSON.stringify(v));
   // Leave it on Timing, go elsewhere and back through the picker: a module opens on its first tab.
   await goto('Drums');await goto(n);R.check((await tabs()).pressed==='Pattern'&&await vis(x.roll),vp+': '+n+' opens on its roll again');
  }
  await goto('Solo');
  const sv=async()=>({keys:await vis('#st-card-mel-keys'),voice:await vis('#pp-bar-solo'),tone:await vis('#mel-tone-body'),touch:await vis('#st-card-mel-touch')});
  let v=await sv();R.check(v.keys&&!v.voice&&!v.tone&&!v.touch,vp+': Solo Keys shows playable keys only',JSON.stringify(v));
  await touch('#ss-tab-sound');v=await sv();R.check(v.voice&&v.tone&&!v.keys&&!v.touch,vp+': Solo Sound shows its voice and tone',JSON.stringify(v));
  await touch('#ss-tab-touch');v=await sv();R.check(v.touch&&!v.keys&&!v.voice&&!v.tone,vp+': Solo Touch shows Touch Mod',JSON.stringify(v));

  // 6. The bottom switches toggle parts and leave the editor, and its tab, where they are.
  await goto('Bass');await touch('#ss-tab-sound');
  const before=await page.evaluate(()=>({sel:studioSel(),drums:drumsEnabled,arp:document.getElementById('ft-arp-btn').classList.contains('off')}));
  await touch('#ft-drum-btn');await touch('#ft-arp-btn');
  const after=await page.evaluate(()=>({sel:studioSel(),drums:drumsEnabled,arp:document.getElementById('ft-arp-btn').classList.contains('off'),page:document.querySelector('.tab-page.active').id,tab:document.querySelector('#ss-tabs .ss-tab[aria-pressed="true"]').textContent,cur:document.querySelector('#ss-cur .ss-cur-n').textContent}));
  R.check(after.drums!==before.drums&&after.arp!==before.arp&&after.sel==='bass'&&after.tab==='Sound'&&after.cur==='Bass'&&after.page==='page-accomp',vp+': Drums and Arp toggled from the bottom, the Bass editor stays on Sound',JSON.stringify({before,after}));
  await touch('#ft-drum-btn');await touch('#ft-arp-btn');

  // 7. The interaction the layout is judged by: a groove playing, Bass, Sound, change the voice, Pattern gets the notes back.
  await goto('Bass');
  await page.evaluate(()=>{if(!isAnythingPlaying())ftPlayStop();});await page.waitForTimeout(600);
  await touch('#ss-tab-sound');
  const v0=await page.evaluate(()=>document.querySelector('#pp-bass-patch .pp-cur').textContent);
  // The voice picker is reachable by touch from the Sound tab (a tiered list), and the voice itself changes.
  await touch('#pp-bass-patch');
  // (the list is short in landscape and scrolls, so only a minimum height is asked)
  const popOpen=await page.evaluate(()=>{const e=document.getElementById('pp-bass-patch-pop'),r=e&&e.getBoundingClientRect();return !!e&&r.height>60&&e.classList.contains('open')});
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
  await page.evaluate(()=>setBlWave('electric'));await page.waitForTimeout(400);
  const v1=await page.evaluate(()=>document.querySelector('#pp-bass-patch .pp-cur').textContent);
  R.check(popOpen&&v1!==v0,vp+': while a groove plays, Bass > Sound opens the voice picker and the voice changes',JSON.stringify({v0,v1,popOpen}));
  // The picker's list closes on the first tap outside it (in landscape Escape did not reach it), so that tap goes to the tab already showing.
  await touch('#ss-tab-sound');
  await touch('#ss-tab-pattern');
  const back=await page.evaluate(()=>{const c=document.querySelector('#bm-bass-panel .pr-host .pr-wrap'),r=c&&c.getBoundingClientRect();return {roll:!!c&&r.width>100&&r.height>100,playing:isAnythingPlaying(),pressed:document.querySelector('#ss-tabs .ss-tab[aria-pressed="true"]').textContent}});
  R.check(back.roll&&back.playing&&back.pressed==='Pattern',vp+': Pattern returns to the roll, measured, and the groove kept playing',JSON.stringify(back));
  await page.evaluate(()=>{if(isAnythingPlaying())ftPlayStop();});

  // 8. Live draws none of it.
  await page.evaluate(()=>liveTab());await page.waitForTimeout(250);
  R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'),vp+': Live draws no Studio header');
  R.check(errs.length===0,vp+': no page errors',errs.join('|'));await ctx.close();
 }
 const {page,ctx}=await L.boot(h,'duoOpen','live');R.check(await page.evaluate(()=>getComputedStyle(document.getElementById('studio-strip')).display==='none'),'open Duo: Live draws no Studio header');await ctx.close();
}finally{await h.close()}R.done();})().catch(e=>{console.error(e);process.exitCode=1});
