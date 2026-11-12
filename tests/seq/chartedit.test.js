/* Chart revision guards on the production native song observer. */
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
      clearTimeout(clockTimer); const interval=window.setInterval, clear=window.clearInterval;
      let tick;window.setInterval=fn=>{tick=fn;return 123;};window.clearInterval=()=>{};
      window._songMirror.apply=()=>{};
      const calls=[],answers=[];let release;
      const P={seqSong:async()=>({ok:true}),seqMirror:async()=>mirror};
      P.seqBassScore=async o=>calls.push(['bassScore',o.revision]);P.seqBassPending=async o=>calls.push(['bassPending',o.revision]);
      P.seqMelScore=o=>{calls.push(['melScore',o.revision]);return o.revision===3?new Promise(r=>release=r):Promise.resolve();};
      P.seqMelPending=async o=>calls.push(['melPending',o.revision]);window.modNativePlugin=()=>P;
      window._songAnswer=(ask,b,sr,pre,m,mp)=>{answers.push({revision:ask[9],pre,mp});return {score:[1],pending:[1],pre:{old:true},mel:{score:[1],pending:[1],pre:{old:true}}};};
      let mirror={sampleRate:48000,bass:{},mel:{},song:{running:true,revision:3,editPending:true,ask:[1,0,0,0,0,96000,0,1,0,3]}};
      const me=window._nsSong;me.answering=true;me.watch(true);
      tick();await Promise.resolve();const pending=answers.length===0;
      mirror.song.editPending=false;tick();await Promise.resolve();await Promise.resolve();
      mirror.song.revision=4;mirror.song.ask=[2,0,0,0,96000,192000,0,1,0,4];tick();await Promise.resolve();await Promise.resolve();
      release();await Promise.resolve();await Promise.resolve();
      me.syncing=1;mirror.song.ask[0]=3;tick();await Promise.resolve();const preparing=answers.length===2;
      me.syncing=0;me.watch(false);window.setInterval=interval;window.clearInterval=clear;
      return {pending,preparing,answers,calls};
    });
    ok(out.pending && out.preparing,'chart preparation and a pending bar edit suspend generated-line answers',out);
    ok(out.answers.length===2 && out.answers.every(a=>a.pre===null && a.mp===null),'a new revision clears both generated-line caches',out.answers);
    ok(out.calls.filter(c=>c[1]===3).length===4 && out.calls.filter(c=>c[1]===4).length===4,'all score and pending replies carry their originating revision, including a late melody reply',out.calls);
    ok(errors.length === 0, 'the real page throws no errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' FAILED' : 'all passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
