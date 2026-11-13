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
  // ── Landscape: the tab row folds away on a scroll down and comes back on a scroll up or the pull tab ──
  page = await open({ width: 844, height: 390 }, true);
  await page.evaluate(() => partOpen('drums')); await page.waitForTimeout(700);
  const nav = () => page.evaluate(() => ({ hide: document.body.classList.contains('land-nav-hide'), top: getComputedStyle(document.getElementById('top-stack')).display, h: Math.round(document.getElementById('page-accomp').getBoundingClientRect().height) }));
  const n0 = await nav();
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(250); }
  await page.waitForTimeout(700);
  const n1 = await nav();
  ok(!n0.hide && n1.hide && n1.top === 'none' && n1.h > n0.h + 40, 'landscape: scrolling down folds the tab row away and the page gets its room', [n0, n1]);
  await page.evaluate(() => document.getElementById('nav-pull').click()); await page.waitForTimeout(400);
  const n2 = await nav();
  ok(!n2.hide && n2.top !== 'none' && n2.h === n0.h, 'the pull tab brings it back', n2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(250); }
  await page.waitForTimeout(700);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -40); await page.waitForTimeout(250); }
  await page.waitForTimeout(500);
  ok(!(await nav()).hide, 'a scroll up brings it back', await nav());
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  ok(!(await nav()).hide, 'upright the bars are never folded', await nav());
  await page.close();
  // ── Studio: the Chords | Melody | Sampler | FX row is in the page, not the bar above the transport ──
  page = await open({ width: 390, height: 844 });
  const sr = await page.evaluate(() => {
    studioTab(); setPerformMode('chords');
    const sn = document.getElementById('pf-subnav'), dock = document.getElementById('subnav-dock');
    const o = { inDock: dock.contains(sn), shown: sn.offsetParent !== null, pos: getComputedStyle(sn).position, dockH: dock.getBoundingClientRect().height };
    document.getElementById('pf-pads-btn').click(); o.pads = document.getElementById('pf-pads-panel').style.display !== 'none';
    document.getElementById('pf-fx-btn').click(); return o;
  });
  ok(!sr.inDock && sr.shown && sr.pos === 'relative' && sr.dockH === 0 && sr.pads, 'Studio: the instrument row is in the page (not sticky, not docked) and still switches', sr);
  // Its gradient (.subnav::before) must stay inside the row: once it covered the whole page and took every touch, so nothing scrolled.
  const cover = await page.evaluate(() => { setPerformMode('chords'); const e = document.elementFromPoint(195, 520); return e && (e.id || e.className).toString().slice(0, 30); });
  ok(cover !== 'pf-subnav', 'Studio: a touch in the middle of the page reaches the page, not the instrument row', cover);
  await page.close();

  // ── Live: All controls opens what Basic hides, and it starts shut ──
  page = await open({ width: 430, height: 932 });
  const lv = await page.evaluate(() => {
    const shown = q => { const e = document.querySelector(q); return !!(e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'); };
    const probes = { chords: ['#crh', '#oct-disp', '#var-head'], melody: ['#tmod-dests'], pads: ['#ps-trim', '#ps-moderow', '#ps-deck'], fx: ['#fx-targets'] };
    const o = { before: {}, after: {} }; LV_OPEN = { pads: true, fx: true }; lvMount();
    for (const m in probes) o.before[m] = probes[m].map(shown);
    for (const m in probes) { const b = document.querySelector('.lv-more[data-mod="' + m + '"]'); if (b) b.click(); }
    for (const m in probes) o.after[m] = probes[m].map(shown);
    o.saved = modStore.getItem('modo-live-adv');
    return o;
  });
  const flat = a => [].concat(...Object.values(a));
  ok(flat(lv.before).every(x => !x), 'Live: every Studio-only control is hidden until All controls is pressed', lv.before);
  ok(flat(lv.after).every(x => x), 'Live: All controls shows the Rhythm builder, chord octave, variants, Touch Mod, sample editor and mõdFX routing', lv.after);
  ok(/"chords":1/.test(lv.saved || ''), 'and the choice is kept', lv.saved);
  // mõdFX with All controls on: the part chips and Mix sit under the pad, a folded caret hides them (and its All-controls
  // button) whatever was chosen, and opening it again brings the choice back.
  const fx = await page.evaluate(() => {
    const slot = () => document.querySelector('.lv-slot[data-mod="fx"]');
    const shown = q => { const e = slot().querySelector(q); return !!(e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0); };
    const top = q => slot().querySelector(q).getBoundingClientRect().top;
    const o = { open: shown('#fx-targets') && shown('.fx-mixes'), belowPad: top('#fx-targets') > top('.fx-padwrap') && top('.fx-mixes') > top('#fx-targets') };
    const caret = () => slot().querySelector('.lv-xt[data-mod="fx"]');
    caret().click();
    o.foldedTargets = shown('#fx-targets'); o.foldedMixes = shown('.fx-mixes'); o.foldedMore = shown('.lv-more'); o.foldedPad = shown('.fx-padwrap');
    o.kept = /"fx":1/.test(modStore.getItem('modo-live-adv') || '');
    caret().click();
    o.back = shown('#fx-targets') && shown('.fx-mixes') && shown('.lv-more');
    return o;
  });
  ok(fx.open && fx.belowPad, 'mõdFX: with All controls on, the part chips and Mix are below the pad', fx);
  ok(!fx.foldedTargets && !fx.foldedMixes && !fx.foldedMore && fx.foldedPad && fx.kept, 'mõdFX: folded, the chips, Mix and All-controls button are hidden (the pad stays) and the choice is kept', fx);
  ok(fx.back, 'mõdFX: opening the caret again brings them back', fx);
  // Sound > Voices names each part's voice the way the Live rows do: a name that opens the list, and ‹ › that step.
  const vp = await page.evaluate(() => {
    switchTab('mix'); setMixMode('voices');
    const row = k => document.querySelector('#voices-grid-mix .voice-row[data-part="' + k + '"]');
    const o = { rows: document.querySelectorAll('#voices-grid-mix .voice-row .vp-name').length, selHidden: getComputedStyle(row('chord').querySelector('select')).display === 'none' };
    const sel = document.getElementById('vsel-chord-mix'), before = sel.value, name0 = row('chord').querySelector('.vp-name').textContent;
    row('chord').querySelectorAll('.vp-step')[1].click();
    o.stepped = sel.value !== before && row('chord').querySelector('.vp-name').textContent !== name0;
    row('chord').querySelectorAll('.vp-step')[0].click();
    o.back = sel.value === before;
    row('chord').querySelector('.vp-name').click();
    o.list = !!document.querySelector('.pp-pop.open .pb-root');
    return o;
  });
  ok(vp.rows === 7 && vp.selHidden && vp.stepped && vp.back && vp.list, 'Sound > Voices: seven ‹ name › pickers, the select hidden, the carets step and the name opens the sound browser', vp);
  await page.close();
  ok(errs.length === 0, 'no page errors', errs);
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
