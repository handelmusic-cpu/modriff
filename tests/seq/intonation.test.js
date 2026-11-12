/* Native intonation capability and control synchronization on the real page. */
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
      clearTimeout(clockTimer);
      const sent=[], decode=b=>Array.from(new Float64Array(Uint8Array.from(atob(b),x=>x.charCodeAt(0)).buffer));
      let P={seqScore:async()=>({ok:true}),seqBassScore:async()=>({ok:true})}; window.modNativePlugin=()=>P;
      window.tuningOn=()=>false; window._webParams['chord.glide']=false;
      const equal=await window._nsIntonation.sync();
      window.tuningOn=()=>true; const oldPure=await window._nsIntonation.sync();
      window.tuningOn=()=>false; window._webParams['chord.glide']=true;
      const oldGlide=await window._nsIntonation.sync();
      P.seqIntonation=async o=>{sent.push({...o,table:decode(o.table)});return {ok:true};};
      window._blPeekLast=()=>({rootPc:5,rest:false});
      window.tuningOn=()=>true; window._webParams['chord.glideTime']=0;
      await window._nsIntonation.sync();
      window.tuningOn=()=>false; window._webParams['chord.glide']=false;
      window._blPeekLast=()=>({rootPc:5,rest:true}); await window._nsIntonation.sync();
      P.seqIntonation=async()=>({ok:false,why:'host refused controls'});
      const refused=await window._nsBass.sync();
      return {equal,oldPure,oldGlide,sent,table:Array.from(TUNING_JI5),refused};
    });
    ok(out.equal.ok && !out.oldPure.ok && !out.oldGlide.ok,'older hosts allow Equal and refuse enabled Pure/glide',out);
    const a=out.sent[0],b=out.sent[1];
    ok(JSON.stringify(a.table)===JSON.stringify(out.table) && a.pure && a.glide && a.glideTime===0 && a.root===5,'the real table, authored root, Pure and zero-time glide reach the bridge',a);
    ok(!b.pure && !b.glide && b.root===-1,'turning controls off and a rest clear host intonation state',b);
    ok(!out.refused.ok && out.refused.why==='host refused controls','direct bass synchronization propagates host refusal',out.refused);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
