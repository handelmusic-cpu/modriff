// Capture real app-rendered reference panels from an isolated, released-page snapshot.
// Fresh browser storage prevents promo fixtures from touching the owner's songs.
const {chromium}=require(process.env.PLAYWRIGHT || 'playwright');
const fs=require('fs'),http=require('http'),cp=require('child_process'),path=require('path');
const root=path.resolve(__dirname,'../../../../..');
const work=process.env.MODRIFF_AUDIENCE_WORK;
if(!work)throw Error('Set MODRIFF_AUDIENCE_WORK');
(async()=>{
 fs.mkdirSync(work,{recursive:true});
 const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const html=cp.execFileSync('git',['show',commit+':index.html'],{cwd:root,maxBuffer:16000000});
 const server=http.createServer((q,r)=>{
  const pathname=decodeURIComponent(q.url.split('?')[0]);
  if(pathname==='/'||pathname==='/index.html'){r.setHeader('Content-Type','text/html');return r.end(html)}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){r.statusCode=403;return r.end()}
  fs.readFile(file,(e,b)=>{r.statusCode=e?404:200;r.end(b)});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{})});
 const errors=[],proof={commit,context:'isolated desktop Chromium, actual app reference panels',clips:{}};
 try{
  const p=await browser.newPage({viewport:{width:540,height:1000},deviceScaleFactor:2});
  p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForTimeout(500);
  await p.evaluate(()=>{setModTier('pro');unlockAudio('blank')});await p.waitForTimeout(1600);
  proof.scales=await p.evaluate(()=>Object.entries(MODES).map(([id,v])=>({id,label:v.label})));
  await p.evaluate(()=>{stopEverything();studioTab();setPerformMode('chords');setFingeringVisible(true,{silent:true});for(const id of ['chord-diagram-panel','fingering-panel']){const el=document.getElementById(id);if(el.classList.contains('folded'))togglePanelFold(id);}});
  const capture=async(name,selector,states,apply)=>{
   const dir=path.join(work,name);fs.mkdirSync(dir,{recursive:true});const log=[];
   for(let i=0;i<states.length;i++){
    await apply(states[i]);const el=p.locator(selector);await el.scrollIntoViewIfNeeded();await p.waitForTimeout(140);
    for(let j=0;j<9;j++)await el.screenshot({path:path.join(dir,String(i*9+j).padStart(4,'0')+'.png'),animations:'disabled'});
    log.push(await el.innerText());
   }
   proof.clips[name]={selector,states,frames:states.length*9,fps:9,panelText:log};
   await p.screenshot({path:path.join(work,name+'-context.png')});console.log('CAPTURE',name,log.map(x=>x.replace(/\s+/g,' ').slice(0,130)));
  };
  const chord=async(inst,state)=>p.evaluate(({inst,state})=>{
   setPerformMode('chords');setChordDiagramInst(inst);root=state.key||0;setMode('major');renderChords();
   const md=MODES.major,d=state.d;lastTriggeredDegree=d;
   _triggerChordImmediate(rootMidi()+md.steps[d],md.triadQ[d],md.seventh[d],md.func[d],.6,state.ext||'triad',true);
   renderChordDiagram();
  },{inst,state});
  await capture('piano-forms','#chord-diagram-panel',[{d:0},{d:3},{d:5},{d:4}],s=>chord('piano',s));
  await capture('guitar-forms','#chord-diagram-panel',[{d:0},{d:3},{d:5},{d:4}],s=>chord('guitar',s));
  await capture('jazz-forms','#chord-diagram-panel',[{d:1,ext:'7th'},{d:4,ext:'7th'},{d:0,ext:'7th'},{d:1,ext:'7th',key:5}],s=>chord('piano',s));
  for(const inst of ['guitar','flute','trumpet','alto']){
   await p.evaluate(()=>setPerformMode('melody'));
   await capture(inst+'-fingering','#fingering-panel',[60,62,64,67],n=>p.evaluate(({inst,n})=>{setFingerInst(inst);renderFingering(n)},{inst,n}));
  }
  proof.errors=errors;
  fs.writeFileSync(path.join(work,'capture-proof.json'),JSON.stringify(proof,null,2));
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();server.close()}
})();
