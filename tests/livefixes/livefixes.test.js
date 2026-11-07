/* 6.9.9.9.9: the Melody Glide switch, the Chords row of the Live Styles widget, and the drum step editor.
   Run: node tests/livefixes/livefixes.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + JSON.stringify(detail))); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
(async () => {
  const srv = await serve(), url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (vp, touch) => {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: !!touch, isMobile: !!touch });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
    await page.goto(url); await page.waitForTimeout(2200);
    await page.evaluate(() => { const u = document.getElementById('audio-unlock'); if (u) u.remove(); });
    return page;
  };

  // ── Melody Glide: the button shows the state it will have, in Poly as in Mono ──
  let page = await open({ width: 390, height: 844 });
  const g = await page.evaluate(() => {
    const b = document.getElementById('mel-glide-btn'), cls = () => b.classList.contains('on');
    const o = {}; o.start = [melGlideOn, cls()];
    b.click(); o.off = [melGlideOn, cls()];
    b.click(); o.on = [melGlideOn, cls()];
    setMelMono(false); o.poly = [melGlideOn, cls(), melMono];
    b.click(); o.polyTap = [melGlideOn, cls(), melMono, melAuto];
    return o;
  });
  ok(g.start[0] && g.start[1], 'Glide starts on and lit', g.start);
  ok(!g.off[0] && !g.off[1], 'a tap turns it off and the button goes dark', g.off);
  ok(g.on[0] && g.on[1], 'and back on', g.on);
  ok(g.polyTap[0] && g.polyTap[1] && g.polyTap[2] === true && g.polyTap[3] === true, 'in Poly a tap on the dark Glide turns it on and returns to Auto (it used to flip a hidden flag)', g.polyTap);

  // ── Chords row on the Live Styles widget ──
  const c = await page.evaluate(() => {
    const row = () => document.querySelector('#st-widget .st-row[data-part="chord"]');
    const o = {}; const r = row(); o.has = !!r;
    if (!r) return o;
    o.voice = r.querySelector('.st-vname').textContent; o.pat0 = r.querySelector('.st-name').textContent; o.on0 = CR.on;
    r.querySelectorAll('.st-step')[1].click();
    o.pat1 = r.querySelector('.st-name').textContent; o.on1 = CR.on; o.key1 = CR.key; o.bar1 = document.getElementById('cr-name').textContent;
    r.querySelectorAll('.st-step')[0].click();
    o.pat2 = r.querySelector('.st-name').textContent; o.on2 = CR.on;
    const v0 = document.getElementById('vsel-chord').value;
    r.querySelectorAll('.st-vstep')[1].click();
    o.v = [v0, document.getElementById('vsel-chord').value, r.querySelector('.st-vname').textContent];
    r.querySelector('.st-vname').click(); o.pop = !!document.querySelector('#pp-chord-patch-pop.open');
    return o;
  });
  ok(c.has, 'the Styles widget has a Chords row', c);
  ok(c.pat0 === 'Off' && !c.on0, 'Pattern reads Off while the Rhythm bar is off', c);
  ok(c.on1 && c.pat1 !== 'Off' && c.pat1 === c.bar1, 'next pattern arms a rhythm, and the Rhythm bar names the same one', c);
  ok(c.pat2 === 'Off' && !c.on2, 'previous steps back to Off', c);
  ok(c.v && c.v[0] !== c.v[1] && c.v[2], 'next voice changes the chord voice and the row names it', c.v);
  ok(c.pop, 'the voice name opens the sound browser', c);
  await page.close();

  // ── Drum step editor: on screen when a step is placed, sideways and upright ──
  for (const [name, vp] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }]]) {
    page = await open(vp, true);
    await page.evaluate(() => partOpen('drums')); await page.waitForTimeout(700);
    const pos = await page.evaluate(() => {
      const st = [...document.querySelectorAll('#ac-drums-panel .sq-step')].filter(e => e.offsetParent !== null);
      const e = st[80]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.waitForTimeout(300);
    await page.touchscreen.tap(pos.x, pos.y); await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const i = document.getElementById('sq-insp').getBoundingClientRect();
      const bars = [...document.querySelectorAll('.top-stack,.perf-bar,.tab-bar')].map(e => e.getBoundingClientRect()).filter(r => r.top > innerHeight / 2).sort((a, b) => a.top - b.top);
      return { open: document.getElementById('sq-insp').classList.contains('open'), top: Math.round(i.top), bottom: Math.round(i.bottom), bar: Math.round(bars[0].top), sel: window._sqHasSel() };
    });
    ok(m.open && m.sel && m.top >= 0 && m.bottom <= m.bar + 1, name + ': one tap on an empty step places it and its editor is fully on screen', m);
    await page.close();
  }
  ok(errs.length === 0, 'no page errors', errs);
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
