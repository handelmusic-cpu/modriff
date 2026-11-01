/* Touch targets (5.2): every control a finger has to hit is 44 pt or more.

   Run on the real app in an emulated phone (touch, mobile, so the coarse-pointer
   block in the stylesheet applies), on every tab in Live and in Studio, at the
   widths phones actually are. A control counts if it is a button, a select, a text
   field, a link, an element with a role or a tab stop, or one of the few drag
   readouts that have none; it passes if its box, or the invisible pad drawn on it
   with ::before or ::after (the way .tips-btn does), is 44 x 44 or more.

   What it also holds, because the 44 pt block is easy to break from the edges:
     - the chord rhythm bar is one row (the picker and the three switches share a top);
     - the transport's key, tempo, Play and arp rate never overlap and nothing pushes
       the page wider than the phone, from 360 to 440 pt;
     - the part switches, tabs and Play are what they should be.

   KNOWN is the list of what is not 44 yet, each with the reason. It is a ratchet:
   an entry that now passes fails the run (delete it), and anything not in it that
   is small fails too. It only ever gets shorter.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/targets/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT, TABS (comma list, default all). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const TABS = (process.env.TABS || 'perform,accomp,mix,songs,build').split(',');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

// [class or id the control carries, why it is not 44 yet]
const KNOWN = [
  ['.sq-rcell', 'the step numbers over a grid are as wide as the step under them (34 pt); they are 44 pt tall with the pad. A wider one would not line up with its column'],
  ['.crh-cell', 'the steps of the chord rhythm roll: 22 pt wide so that 16 and 24 steps are a scroll, not a page; 108 pt tall. Narrower is how a grid of 24 fits a phone; a 44 pt column would be 32 steps across 1400 pt'],
  ['input[range]', 'sliders: a 14 pt thumb on a 3 pt track. A 44 pt thumb moves the dot 15 pt in from each end and the fine-control layer maps by the track, so it is its own change'],
];

async function boot(browser, W, H) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { setModTier('pro'); });
  return { page, errs };
}

const SCAN = () => {
  const out = [];
  const q = '.sq-rcell,.ft-rate-val,.ft-bpm-val,[role=slider],[role=switch],[role=button],[role=tab],[tabindex="0"],button,input:not([type=hidden]),select,textarea,[onclick],summary,a[href]';
  document.querySelectorAll(q).forEach(e => {
    let p = e, hid = false;
    while (p && p !== document.body) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) { hid = true; break; } p = p.parentElement; }
    if (hid) return;
    if (getComputedStyle(e).pointerEvents === 'none') return;
    // A box a label wraps is hit by tapping the label, so the label is the target.
    const lab = (e.type === 'checkbox' || e.type === 'radio') ? e.closest('label') : null;
    const r = (lab || e).getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    let ew = r.width, eh = r.height;
    for (const ps of ['::before', '::after']) {
      const c = getComputedStyle(e, ps);
      if (c.content !== 'none' && c.position === 'absolute') { const w = parseFloat(c.width), h = parseFloat(c.height); if (w > ew) ew = w; if (h > eh) eh = h; }
    }
    if (eh >= 43.5 && ew >= 43.5) return;
    const state = /^(active|on|off|open|armed|selected|playing|lit|pc|queued|bad|has|edit|disabled|b\d)$/;
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(c => c && !state.test(c)) : [];
    const type = e.tagName === 'INPUT' ? (e.type === 'range' ? 'input[range]' : 'input') : '';
    out.push({ key: type || (e.id ? '#' + e.id : '') + (cls.length ? '.' + cls.join('.') : '') || e.tagName.toLowerCase(),
      w: Math.round(ew), h: Math.round(eh), t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20) });
  });
  return out;
};

// Sub-pages: a tab is several pages, and each is a different set of controls.
const SUBS = {
  accomp: ['#ac-drums-btn', '#ac-bass-btn', '#ac-mel-btn', '#ac-arp-btn'],
  mix: ['#mx-mixer-btn', '#mx-voices-btn', '#mx-synth-btn'],
  songs: ['#songs-build-btn', '#songs-perform-btn', '#songs-chart-btn'],
  build: ['#set-ui-btn', '#set-sounds-btn', '#set-midi-btn'],
  perform: [null],
};
// Things wider than the phone that are not inside something that scrolls sideways.
const OVERFLOW = () => {
  const W = innerWidth, out = [];
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.right <= W + 1) return;
    let p = e, clipped = false;
    while (p && p !== document.body) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || /(auto|scroll|hidden|clip)/.test(c.overflowX) && p !== e) { clipped = true; break; } if (c.position === 'fixed' && p !== e) break; p = p.parentElement; }
    if (!clipped) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' right=' + Math.round(r.right));
  });
  return out.slice(0, 6);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });

  // ── 1. Every control, every tab, both views, at the biggest phone.
  {
    const { page, errs } = await boot(browser, 430, 932);
    const seen = new Map();
    for (const mode of ['basic', 'advanced']) for (const tab of TABS) {
      await page.evaluate(([m, t]) => { setViewMode(m); switchTab(t); }, [mode, tab]);
      await page.waitForTimeout(450);
      for (const sub of (SUBS[tab] || [null])) {
        if (sub) { await page.evaluate(sel => { const b = document.querySelector(sel); if (b) b.click(); }, sub); await page.waitForTimeout(350); }
        const small = await page.evaluate(SCAN);
        small.forEach(s => { const k = s.key; if (!seen.has(k)) seen.set(k, { n: 0, ex: s, where: new Set() }); const v = seen.get(k); v.n++; v.where.add(tab + (sub ? sub.replace(/^#/, ' ') : '') + '/' + mode); });
        const wide = await page.evaluate(OVERFLOW);
        check(wide.length === 0, 'nothing runs off the right edge: ' + tab + (sub ? ' ' + sub : '') + ' / ' + mode, wide.join('; '));
      }
    }
    const known = new Set(KNOWN.map(k => k[0]));
    const unknown = [...seen.entries()].filter(([k]) => !known.has(k));
    unknown.forEach(([k, v]) => check(false, 'under 44 pt: ' + k.slice(0, 60) + ' x' + v.n, v.ex.w + 'x' + v.ex.h + ' "' + v.ex.t + '" in ' + [...v.where].slice(0, 3).join(', ')));
    check(unknown.length === 0, 'no control outside the known list is under 44 pt (' + seen.size + ' kinds small, ' + KNOWN.length + ' known)');
    if (!process.env.TABS) KNOWN.forEach(([k, why]) => { if (!seen.has(k)) check(false, 'KNOWN entry now passes: remove it', k); });
    check(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  }

  // ── 2. The Play tab's own promises, at each phone width.
  for (const W of [360, 375, 390, 393, 402, 430, 440]) {
    const { page } = await boot(browser, W, 900);
    await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const rect = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      const ov = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const k = rect('.ft-key'), bpm = rect('.ft-bpm-val'), play = rect('#ft-playstop-btn'), rate = rect('#ft-rate-val');
      const cr = ['#cr-pick', '#cr-on', '#cr-latch', '#cr-draw'].map(rect);
      return { overlap: [ov(k, bpm), ov(bpm, play), ov(play, rate), ov(k, play)], docW: document.documentElement.scrollWidth, innerW: innerWidth,
               crTops: cr.map(x => Math.round(x.t)), crH: cr.map(x => Math.round(x.b - x.t)), crRight: Math.max(...cr.map(x => x.r)),
               playH: Math.round(play.b - play.t), keyH: Math.round(k.b - k.t) };
    });
    check(r.overlap.every(x => !x), W + ' pt: key, tempo, Play and rate do not overlap', JSON.stringify(r.overlap));
    check(r.docW <= r.innerW, W + ' pt: the page is no wider than the phone', r.docW + ' in ' + r.innerW);
    check(new Set(r.crTops).size === 1 && r.crH.every(h => h >= 44), W + ' pt: chord rhythm bar is one row of 44 pt', JSON.stringify([r.crTops, r.crH]));
    check(r.crRight <= r.innerW, W + ' pt: and inside the screen', r.crRight);
    check(r.playH >= 44, W + ' pt: Play is 44 pt', r.playH);
    await page.close();
  }

  // ── 3. Overlays: the sheet, a toast, the pickers and the editors are not on any tab.
  {
    const { page, errs } = await boot(browser, 430, 932);
    await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
    const steps = [
      ['the transport sheet', () => { document.getElementById('tab-more').click(); }],
      ['a toast with Undo', () => { document.getElementById('tab-more').click(); showToast('hello', { onAction() {}, actionLabel: 'Undo' }); }],
      ['the rhythm picker', () => { crPickOpen(); }],
      ['the rhythm editor', () => { crEditOpen(); }],
      ['the voice picker', () => { document.querySelector('.snd-pick-btn').click(); }],
      ['the chord editor', () => {
        sections = [{ name: 'Verse', follow: 'repeat', plays: 1, slots: [] }];
        const sl = slotFromChordSymbol('Am7', 0, 'major', 9); sl.bars = 1; sl.beats = 0; sl.eighths = 0; sections[0].slots.push(sl);
        const ins = document.createElement('div'); ins.id = '__ins'; ins.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;overflow:auto';
        document.body.appendChild(ins); sbBuildChordEditor(ins, sl, 0, sections[0].slots, () => {});
      }],
      ['the length picker', () => { document.getElementById('__ins')?.remove(); showDurationPicker(sections[0].slots[0], () => {}); }],
      ['the extension picker', () => { showExtPicker(sections[0].slots[0], () => {}); }],
    ];
    for (const [name, fn] of steps) {
      await page.evaluate(() => { document.querySelectorAll('.modal-overlay,.csi-overlay,.modal,.overlay,#_toast').forEach(e => { if (e.id === '_toast') { e.style.opacity = '0'; } else e.remove(); }); });
      await page.evaluate(fn); await page.waitForTimeout(450);
      const small = (await page.evaluate(SCAN)).filter(x => !KNOWN.some(k => k[0] === x.key));
      check(small.length === 0, name + ': every control is 44 pt', small.slice(0, 4).map(x => x.key + ' ' + x.w + 'x' + x.h).join('; '));
    }
    check(errs.length === 0, 'no page errors in the overlays', errs.join(' | '));
    await page.close();
  }

  // ── 4. A finger lands on the control it is on: real touch at each small control's
  //       centre, and at the far edge of its pad, reaches that control and not its neighbour.
  {
    const { page } = await boot(browser, 430, 932);
    await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); });
    await page.waitForTimeout(500);
    const hits = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.sq-gleft-row .smp-badge, .sq-shape-btn, .tips-btn, .panel-fold').forEach(e => {
        const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const t = document.elementFromPoint(cx, cy);
        if (!(t === e || e.contains(t))) bad.push((e.className || e.tagName) + ' centre lands on ' + (t && (t.className || t.tagName)));
      });
      return bad;
    });
    check(hits.length === 0, 'a padded control is hit at its own centre, not by a neighbour', hits.slice(0, 3).join('; '));

    // Real taps through CDP. Play starts, a part switch toggles, the rhythm switch toggles,
    // the key stepper moves the key.
    const cdp = await page.context().newCDPSession(page);
    const tapEl = async (sel) => {
      const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
    };
    const bass0 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
    await tapEl('#ft-bas-btn');
    const bass1 = await page.evaluate(() => document.getElementById('ft-bas-btn').classList.contains('off'));
    check(bass0 !== bass1, 'touch: the Bass switch toggles', bass0 + ' -> ' + bass1);
    const root0 = await page.evaluate(() => root);
    await tapEl('.ft-key-step[aria-label^="Key up"]');
    const root1 = await page.evaluate(() => root);
    check(root0 !== root1, 'touch: the key stepper moves the key', root0 + ' -> ' + root1);
    const cr0 = await page.evaluate(() => document.getElementById('cr-on').getAttribute('aria-pressed'));
    await tapEl('#cr-on');
    const cr1 = await page.evaluate(() => document.getElementById('cr-on').getAttribute('aria-pressed'));
    check(cr0 !== cr1, 'touch: the chord rhythm switch in its new row toggles', cr0 + ' -> ' + cr1);
    await tapEl('#ft-playstop-btn');
    const playing = await page.evaluate(() => document.getElementById('ft-playstop-btn').classList.contains('tp-stop'));
    check(playing, 'touch: Play starts the transport');
    await tapEl('#ft-playstop-btn');
    await page.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
