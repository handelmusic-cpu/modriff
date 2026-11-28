/* The melody and bass generators in the real page (1.x).

   Driven through the page's own functions, as the Generate and Arrange buttons call them:
     - every style writes a line, and two presses of Generate in the same style write different lines;
     - the drum pattern reaches the generator: window._sqGroove reads the kit's kick and snare lanes by name;
     - the tempo slider reaches it (fewer sixteenths at 170 than at 80 over 40 presses);
     - Arrange over a four-chord chart writes one hook: every chord's line has the same rhythm, and its pitches follow the chord;
     - a regenerate that is not a Generate press (a key change) keeps the hook's rhythm; Generate starts a new one;
     - no page errors.

   Run: node tests/gen/page.test.js        Env: CHROMIUM, PLAYWRIGHT, ROOT (dist: the built page) */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = process.env.ROOT ? path.resolve(process.env.ROOT) : path.join(__dirname, '../..');   // ROOT=dist runs it on what ships
let failed = 0;
function ok(c, label, detail) { if (!c) failed++; console.log((c ? 'ok   ' : 'FAIL ') + label + (detail !== undefined ? '  (' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ')' : '')); }
(async () => {
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => { r.writeHead(e ? 404 : 200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(e ? '' : b); });
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const chrome = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    await page.waitForTimeout(1200);
    await page.getByText('Start', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    const out = await page.evaluate(() => {
      if(typeof setModTier === 'function') setModTier('pro');
      const r = {};
      const cells = part => (part === 'mel' ? window._mlCaptureState() : window._blCaptureState()).grid;
      const key = g => JSON.stringify(g.map(c => c && c.v ? [c.note, c.oct, c.len] : 0));
      const rhythm = g => g.map((c, i) => c && c.v ? i : -1).filter(i => i >= 0).join(',');
      lastChordRoot = 60; lastChordIntvs = [0,4,7]; root = 0; mode = 'major'; _lastChordKey = {root:0, mode:'major'};
      // ── every style, two presses ──
      r.styles = {};
      for(const [part, set, gen, btn] of [['mel', 'setMlGenStyle', 'mlGenerateAndArm', 'data-mlstyle'], ['bass', 'setBlGenStyle', 'blGenerateAndArm', 'data-blstyle']]){
        document.querySelectorAll('[' + btn + ']').forEach(b => {
          const st = b.getAttribute(btn);
          window[set](st); window[gen](); const a = key(cells(part)), n = cells(part).filter(c => c && c.v).length;
          window[gen](); const b2 = key(cells(part));
          window[gen](); const c3 = key(cells(part));
          r.styles[part + ' ' + st] = {n, differ: a !== b2 || b2 !== c3};
        });
      }
      // ── the groove ──
      window._sqApplyKitTemplate({mach:'808', steps:16, grid:{0:[1,0,0,1,0,0,1,0,0,0,1,1,0,0,0,0].map(v => ({v})), 1:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0].map(v => ({v}))}});
      if(typeof window._sqSetLayerOn === 'function') window._sqSetLayerOn(0, true);
      const g = window._sqGroove();
      r.groove = g ? {kick: g.kick.join(''), snare: g.snare.join('')} : null;
      // ── tempo ──
      const bpmEl = document.getElementById('bpm');
      const sixteenths = bpm => { bpmEl.value = bpm; let s = 0, n = 0; window.setMlGenStyle('funk'); for(let i = 0; i < 40; i++){ window.mlGenerateAndArm(); cells('mel').forEach((c, j) => { if(c && c.v){ n++; if(j % 2) s++; } }); } return s / n; };
      r.six80 = sixteenths(80); r.six170 = sixteenths(170); bpmEl.value = 110;
      // ── Arrange: one hook through the chart ──
      sections = [{name:'Verse', slots:[{rootM:60, ext:'', bars:1}, {rootM:65, ext:'', bars:1}, {rootM:57, ext:'m', bars:1}, {rootM:67, ext:'', bars:1}]}];
      window.setMlGenStyle('hook'); window.phraseClearLocks('mel', true); window.mlArrange();
      const locks = Object.values(PHRASE_LOCKS.mel);
      r.arranged = locks.length;
      r.arrRhythms = new Set(locks.map(l => rhythm(l.grid))).size;
      r.arrPitches = new Set(locks.map(l => key(l.grid))).size;
      // ── keep the hook through a key change; Generate starts a new one ──
      window.setBlGenStyle('funk'); window.blGenerateAndArm(); const r0 = rhythm(cells('bass'));
      root = 5; window.blGenerate(); const r1 = rhythm(cells('bass'));
      let fresh = 0; for(let i = 0; i < 10; i++){ window.blGenerateAndArm(); if(rhythm(cells('bass')) !== r0) fresh++; }
      r.keepHook = r0 === r1; r.fresh = fresh; root = 0;
      return r;
    });
    for(const [k, v] of Object.entries(out.styles)) ok(v.n > 0 && v.differ, k + ': writes a line, and Generate again writes another', v);
    ok(out.groove && out.groove.kick === '1001001000110000' && out.groove.snare === '0000100000001000', 'the kit\'s kick and snare lanes reach the generator', out.groove);
    ok(out.six170 < out.six80, 'the tempo reaches it: fewer sixteenths at 170 bpm than at 80', out.six80.toFixed(2) + ' -> ' + out.six170.toFixed(2));
    ok(out.arranged === 4 && out.arrRhythms === 1 && out.arrPitches >= 3, 'Arrange writes one hook through four chords: one rhythm, the notes fitted to each chord', {arranged: out.arranged, rhythms: out.arrRhythms, pitchLines: out.arrPitches});
    ok(out.keepHook, 'a key change keeps the bass\'s hook (its rhythm)');
    ok(out.fresh >= 8, 'Generate starts a new one', out.fresh + '/10 new rhythms');
    ok(!errors.length, 'no page errors', errors);
  } finally { await browser.close(); server.close(); }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
