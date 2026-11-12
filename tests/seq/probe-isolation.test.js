/* Automatic bank preparation preserves live manual voices and their registries. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.join(__dirname, '../..');
let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : ': ' + JSON.stringify(detail))); }
(async () => {
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.PAGE_PATH || '/index.html'));
    await page.waitForTimeout(1200);
    await page.getByText('Start', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    const out = await page.evaluate(async () => {
      clearTimeout(clockTimer);const ctx=getCtx();
      const P={graphBuf:async()=>({ok:true}),graphBegin:async()=>({handle:1}),graphEdit:async()=>({ok:true})};
      modGraphEnable(P,['drum','auxperc','bass','chord','mel','melgen','arp']);_ensureAllPartBuses(ctx);
      wave='sine';window.modParamsSync=()=>{};Object.assign(window._webParams,{'chord.voice':'sine','bass.voice':'sine','chord.attack':.025,'chord.release':.3,'chord.reverb':0,'chord.sub':false,'mix.chord':1,'mix.bass':1,'fx.trim':1,'fx.width':0,'master.tune':440});
      const me=window._nsBank;me.isolated=false;const base=await me.buildChordNote('sine',60,false);
      const mach=window._sqMachines()['808'],hat=mach.tracks.findIndex(t=>t.n==='Op Hat');
      await me.record({kind:'hit',part:'drum',id:1,kit:'808',lane:hat,vel:.8,accent:false,pitch:0,dyn:1,at:.048});
      const hats=window._chokeCount('hat'),touches=[];
      const param={cancelScheduledValues:()=>touches.push('cancel'),setValueAtTime:()=>touches.push('set'),linearRampToValueAtTime:()=>touches.push('ramp'),value:1};
      const live={gain:{gain:param},oscs:[{stop:()=>touches.push('stop')}]};activeOscs=[live];
      const kill=[{sentinel:true}];_voiceKillReg=kill;_chordDampKey='live-room';
      const liveBass={freq:123,slide:true,gain:{sentinel:true},end:999,voice:[{sentinel:true}]},old=window._blProbeSwap(liveBass);
      me.isolated=true;const chord=await me.buildChordNote('sine',60,false);const bass=await me.buildBass('sine');me.isolated=false;
      const afterBass=window._blProbeSwap(old),afterHats=window._chokeCount('hat');
      const untouched=activeOscs.length===1&&activeOscs[0]===live&&_voiceKillReg===kill&&_chordDampKey==='live-room'&&touches.length===0;
      activeOscs=[];_voiceKillReg=[];_chordDampKey=null;
      let same=false;if(base.ok&&chord.ok){const a=Array.from(base.entry),b=Array.from(chord.entry);a[4]=b[4]=0;same=JSON.stringify(a)===JSON.stringify(b);}
      return {base:base.ok,chord:chord.ok,bass:bass.ok,why:[base.why,chord.why,bass.why],untouched,touches,hats,afterHats,same,bassState:{freq:afterBass.freq,slide:afterBass.slide,end:afterBass.end,gain:afterBass.gain===liveBass.gain,voice:afterBass.voice===liveBass.voice}};
    });
    ok(out.base&&out.chord&&out.bass,'the production chord and bass bank builders work with isolated live state',out);
    ok(out.same,'isolating a bank probe preserves its graph program and parameter maps',out);
    ok(out.untouched&&out.hats>0&&out.afterHats===out.hats,'preparation preserves the live chord, choke registrations, kill registry and room state',out);
    ok(out.bassState.freq===123&&out.bassState.slide&&out.bassState.end===999&&out.bassState.gain&&out.bassState.voice,'preparation restores the live bass overlap/slide state',out.bassState);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
