import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),work=process.env.MODRIFF_PROMO_WORK||'/private/tmp/modriff-high-impact';fs.mkdirSync(work,{recursive:true});
const ctx={};vm.createContext(ctx);for(const file of ['params','patches','patches-extra','patches-modern'])vm.runInContext(fs.readFileSync(`modsynth/${file}.js`,'utf8'),ctx);
const MS=ctx.MS,bpm=124,beat=60/bpm,bar=beat*4,duration=14*bar;
const banks=[...MS.FACTORY_PATCHES,...MS.MODERN_PATCHES],src=Object.fromEntries(MS.MOD_SOURCES.map((s,i)=>[s[0],i])),dst=Object.fromEntries(MS.MOD_DESTS.map((s,i)=>[s[0],i]));
const channels={};
function track(id,patch,over={},matrix){const p=typeof patch==='string'?banks.find(x=>x.name===patch):patch;if(!p)throw Error(patch);channels[id]={patch:p.name,values:{...MS.paramDefaults(),...p.values,'voice.poly':8,'voice.drift':.06,'mix.noise':0,'fx.grit.on':0,'crush.on':0,'fx.ott.on':0,'master.vol':.65,...over},matrix:matrix||p.matrix||[],motion:p.motion||[],notes:[]};return channels[id];}
track('keys','Neo Tine',{'env1.a':.006,'env1.r':.26,'fx.reverb.mix':.14,'fx.chorus.mix':.24,'macro.1':.11,'macro.2':.13,'macro.3':.85});
track('bass','Pluck Sub',{'voice.mode':'mono','voice.poly':1,'env1.a':.008,'env1.r':.09,'fx.drive.amount':.12,'mix.sub':.4,'macro.1':.13});
track('lead','Glass Pluck',{'env1.a':.005,'env1.r':.22,'fx.reverb.mix':.18,'fx.reverb.decay':1.8,'fx.delay.mix':.10,'fx.delay.div':'1_8d','fx.delay.fb':.22,'macro.1':.08});
track('arp','Future Pluck',{'env1.a':.006,'env1.r':.10,'osc1.uni':3,'osc1.detune':17,'flt1.cutoff':1100,'fx.reverb.mix':.12,'fx.delay.mix':.08,'macro.1':.13});
track('pad','Glacier',{'env1.a':.22,'env1.r':.75,'fx.reverb.mix':.25,'fx.reverb.decay':2.2,'osc1.uni':3});
const base={'osc1.on':1,'osc1.wave':'classic','osc1.shape':0,'osc1.level':1,'osc2.on':0,'osc3.on':0,'mix.sub':0,'mix.noise':0,'flt1.model':'bypass','env1.a':.003,'env1.d':.2,'env1.s':0,'env1.r':.04,'voice.poly':8,'fx.reverb.on':0,'fx.delay.on':0,'fx.chorus.on':0,'fx.drive.on':0,'master.vol':.7};
track('kick',{name:'Studio kick',values:base},{'env1.d':.30,'env2.a':.001,'env2.d':.04,'env2.s':0,'env2.r':.01},[['env2','pitch',.92,1]]);
track('snare',{name:'Studio snare',values:base},{'osc1.level':.28,'mix.noise':.78,'mix.noiseFlt':6000,'flt1.model':'svfHP','flt1.cutoff':550,'env1.d':.14,'env1.r':.06,'fx.reverb.on':1,'fx.reverb.mix':.07,'fx.reverb.decay':.6},[]);
track('hat',{name:'Air hat',values:base},{'osc1.on':0,'mix.noise':.65,'mix.noiseFlt':14000,'flt1.model':'svfHP','flt1.cutoff':7200,'env1.a':.002,'env1.d':.045,'env1.r':.018,'fx.width':.8},[]);
track('clap',{name:'Wide clap',values:base},{'osc1.on':0,'mix.noise':.65,'flt1.model':'svfHP','flt1.cutoff':1600,'env1.a':.002,'env1.d':.055,'env1.r':.04,'fx.reverb.on':1,'fx.reverb.mix':.11,'fx.reverb.decay':.8},[]);
let nid=1;function note(part,t,n,d,v=.7){if(t<duration-.6)channels[part].notes.push({t,n,d,v,id:nid++});}
const prog=[{name:'Dm9',root:38,voicing:[53,57,60,64],lead:[77,76,72,69]}, {name:'G13',root:31,voicing:[53,57,59,64],lead:[74,76,77,81]}, {name:'Cmaj9',root:36,voicing:[52,55,59,62],lead:[79,76,74,71]}, {name:'Am9',root:33,voicing:[55,59,60,64],lead:[76,79,83,81]}, {name:'Fmaj9',root:29,voicing:[52,55,57,60],lead:[81,79,76,72]}, {name:'Em7',root:40,voicing:[55,59,62,64],lead:[79,78,76,74]}, {name:'Dm9',root:38,voicing:[53,57,60,64],lead:[77,76,72,69]}, {name:'G13',root:31,voicing:[53,57,59,64],lead:[74,77,76,71]}];
const chords=[];
for(let b=0;b<14;b++){
 const c=b===13?prog[2]:b===12?prog[4]:prog[b%8],t=b*bar;chords.push({t,name:c.name,notes:c.voicing});
 const breakdown=b===6||b===7,ending=b===13;
 // Rootless ninth voicings, short off-beat comping, then a sustained final resolution.
 const comps=ending?[[0,3.1,.8]]:breakdown?[[0,1.7,.7],[2.5,.7,.55]]:[[0,.65,.8],[1.5,.5,.58],[2.75,.65,.72]];
 for(const [at,len,vel]of comps)c.voicing.forEach((n,i)=>note('keys',t+at*beat+i*.006,n,len*beat,vel-i*.035));
 const bass=ending?[[0,0,1.5,.8]]:[[0,0,.6,.86],[.75,0,.3,.64],[1.5,7,.35,.73],[2.25,12,.36,.65],[3,0,.4,.84],[3.5,7,.22,.6],[3.75,b%2?11:10,.2,.52]];
 for(const [at,offset,len,v]of bass)note('bass',t+at*beat,c.root+offset,len*beat,v);
 const m=c.lead;
 const hook=ending?[[0,76,1.6,.7],[1.5,72,1.5,.6]]:b%2===0?[[0,m[0],.65,.8],[.75,m[1],.45,.62],[1.5,m[2],.55,.76],[2.25,m[1],.3,.62],[2.75,m[3],.4,.7],[3.5,m[2],.35,.72]]:[[.25,m[0],.45,.72],[1,m[1],.65,.79],[1.75,m[2],.35,.6],[2.5,m[3],.55,.78],[3.25,m[1],.3,.6],[3.75,m[2],.24,.55]];
 if(!breakdown||b===7)for(const [at,n,len,v]of hook)note('lead',t+at*beat,n+(b>=8&&b<12?0:0),len*beat,v);
 if((b>=4&&b<=5)||(b>=8&&b<=12))for(let i=0;i<8;i++)note('arp',t+(i*.5+.25)*beat,c.voicing[(i*3)%4]+12,.18*beat,.4+(i%3)*.06);
 if(b===0||breakdown||b===8||ending)c.voicing.forEach((n,i)=>note('pad',t+i*.01,n-12,(ending?2:3.7)*beat,.50));
 const kicks=ending?[0]:breakdown?(b===6?[0]:[0,2]):[0,1,2,3];
 for(const k of kicks)note('kick',t+k*beat,31,.35,.87+(k===0?.08:0));
 if(!ending&&!breakdown){for(const k of [1,3]){note('snare',t+k*beat+.006,50,.13,.64);for(const dt of [0,.013,.027])note('clap',t+k*beat+dt,60,.07,.26);}if(b%4===3)for(const k of [3.25,3.5,3.75])note('snare',t+k*beat,50,.08,.2+(k-3)*.3);}
 if(!ending)for(let k=0;k<8;k++)note('hat',t+(k*.5+.01+(k%2?.018:0))*beat,78,.032,(k%2?.43:.23)+(b>=8?.03:0));
 if(b===7)for(let k=0;k<8;k++)note('snare',t+(2+k*.25)*beat,50,.055,.16+k*.045);
}
const score={title:'In Motion',bpm,beat,bar,duration,engine:'mõdSynth native Processor + FxRack; rendered offline',chords,channels};fs.writeFileSync(`${work}/score.json`,JSON.stringify(score,null,2));
const hostIds=[...fs.readFileSync('native/modsynth/params_gen.h','utf8').split('HOST_FX[HOST_FX_COUNT] = {')[1].matchAll(/\{"([^"]+)"/g)].map(x=>x[1]);
for(const [id,ch]of Object.entries(channels)){
 let cmds=[`tempo ${bpm}`];for(const p of MS.DSP_PARAMS)cmds.push(`p ${p.id} ${MS.toNumber(p,ch.values[p.id])}`);
 for(const key of hostIds){const p=MS.PARAM[key];if(p)cmds.push(`fx ${key} ${MS.toNumber(p,ch.values[key])}`);}
 cmds.push('matrix '+ch.matrix.length+ch.matrix.map(r=>' '+[src[r[0]]||0,dst[r[1]]||0,r[2],r[3]?1:0,src[r[4]]||0].join(' ')).join(''));
 for(let i=0;i<ch.motion.length;i++)cmds.push(`motion ${i} ${ch.motion[i].length} ${ch.motion[i].join(' ')}`);
 for(const n of ch.notes)cmds.push(`note ${Math.round(n.t*48000)} ${n.n} ${n.v} ${Math.round(n.d*48000)} ${n.id}`);
 cmds.push(`frames ${Math.ceil(duration*48000)}`);fs.writeFileSync(`${work}/${id}.score`,cmds.join('\n')+'\n');
 const fd=fs.openSync(`${work}/${id}.f32`,'w');let r=spawnSync(process.env.MODRIFF_PROMO_RENDERER||'/private/tmp/modriff-music-render',[],{input:cmds.join('\n')+'\n',stdio:['pipe',fd,'inherit']});fs.closeSync(fd);if(r.status!==0)throw Error(id);console.log('Rendered',id,ch.patch,ch.notes.length);
}
console.log('Score',duration,bpm);
