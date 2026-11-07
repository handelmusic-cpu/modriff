/* The Voice | Pattern widget and the tiered sound browser (6.9.9.9.1, 6.9.9.9.2).

     - on Drums, Bass, Melody Seq and Arp the Voice (Kit) half is the LEFT half of one frame and the pattern is the right;
     - the browser opens on tiers, in the order Samples, mõdSynth, Free voices, for a free install and for an owner;
     - free: Samples is listed (its rows locked), mõdSynth is a locked tier that opens the Pro sheet on a tap;
     - owner: mõdSynth is a list of sound types (Bass first on the Bass page), each type holds both banks, a pick puts the
       part on that patch, closes the list and the trigger names the patch and where it lives;
     - a sample pick goes through the part's own setter (Upright 1 on Bass);
     - the Play page's Chords picker uses the same browser and a pick there reaches the voice;
     - the Voices dropdowns list Samples first.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/soundbrowser/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const boot = async (tier, view) => {
    await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(([t, v]) => { setModTier(t); setViewMode(v || 'advanced'); switchTab('accomp'); }, [tier, view]); await page.waitForTimeout(600);
  };
  const part = async (k) => { await page.evaluate(k => document.getElementById('ac-' + k + '-btn').click(), k); await page.waitForTimeout(700); };
  const pop = (id) => page.evaluate(id => { const p = document.getElementById(id); return { open: p.classList.contains('open'), text: p.innerText.replace(/\n+/g, ' | ') }; }, id);
  const rowsOf = (id) => page.evaluate(id => [...document.querySelectorAll('#' + id + ' .pb-row .pb-name, #' + id + ' .pb-nav .pb-title')].map(e => e.textContent.trim()), id);
  const clickIn = (id, cls, label) => page.evaluate(([id, cls, label]) => {
    const r = [...document.querySelectorAll('#' + id + ' ' + cls)].find(x => cls === '.pb-nav' ? x.innerText.includes(label) : x.innerText.trim().startsWith(label));
    if (r) r.click(); return !!r;
  }, [id, cls, label]);

  // ── Free ──
  await boot('free');
  for (const [k, id] of [['drums', 'pp-bar-drums'], ['bass', 'pp-bar-bass'], ['mel', 'pp-bar-melody'], ['arp', 'pp-bar-arp']]) {
    await part(k);
    const r = await page.evaluate(id => { const b = document.getElementById(id); const c = [...b.querySelectorAll('.pp-cell')].map(x => ({ cap: x.querySelector('.pp-cap').textContent, x: x.getBoundingClientRect().left })); return { n: c.length, order: c.sort((a, b) => a.x - b.x).map(x => x.cap), framed: parseFloat(getComputedStyle(b).borderTopWidth) > 0 }; }, id);
    const want = k === 'drums' ? 'Kit' : 'Voice';
    check(r.n === 2 && r.order[0] === want && r.order[1] !== want && r.framed, k + ': one frame, ' + want + ' on the left, the pattern on the right', JSON.stringify(r.order));
  }
  await part('bass');
  await page.evaluate(() => document.getElementById('pp-bass-patch').click()); await page.waitForTimeout(400);
  let rows = await rowsOf('pp-bass-patch-pop');
  check(rows.join('|') === 'Samples|mõdSynth 🔒|Free voices' || rows.join('|') === 'Samples|mõdSynth|Free voices' || rows.length === 3 && rows[0] === 'Samples' && /^mõdSynth/.test(rows[1]) && rows[2] === 'Free voices', 'free: tiers are Samples, mõdSynth, Free voices', rows.join(' | '));
  const sub = (await page.evaluate(() => [...document.querySelectorAll('#pp-bass-patch-pop .pb-tier')].map(r => r.innerText.replace(/\n+/g, ' / '))));
  check(/Sampler Engine/.test(sub[0]) || /recorded/.test(sub[0]), 'free: the Samples row says what it is', sub[0]);
  await clickIn('pp-bass-patch-pop', '.pb-row', 'Samples'); await page.waitForTimeout(300);
  const lk = await page.evaluate(() => [...document.querySelectorAll('#pp-bass-patch-pop .cp-item')].map(b => ({ t: b.textContent, l: b.classList.contains('locked') })));
  check(lk.length >= 10 && lk.filter(x => x.l).length >= 5, 'free: Samples lists the instruments and locks the ones a free install does not have', lk.filter(x => x.l).length + ' of ' + lk.length);
  await clickIn('pp-bass-patch-pop', '.pb-nav', 'Sounds'); await page.waitForTimeout(200);
  await clickIn('pp-bass-patch-pop', '.pb-row', 'mõdSynth'); await page.waitForTimeout(500);
  const ps = await page.evaluate(() => ({ sheet: !!document.getElementById('_pro-sheet'), open: document.getElementById('pp-bass-patch-pop').classList.contains('open') }));
  check(ps.sheet && !ps.open, 'free: a tap on the locked mõdSynth tier opens the Pro sheet and shuts the list', JSON.stringify(ps));

  // ── Owner ──
  await boot('pro');
  await part('bass');
  await page.evaluate(() => document.getElementById('pp-bass-patch').click()); await page.waitForTimeout(1800);
  rows = await rowsOf('pp-bass-patch-pop');
  check(rows.join('|') === 'Samples|mõdSynth|Free voices', 'owner: tiers are Samples, mõdSynth, Free voices', rows.join(' | '));
  const tsub = await page.evaluate(() => [...document.querySelectorAll('#pp-bass-patch-pop .pb-tier .pb-sub')].map(e => e.textContent));
  check(/patches/.test(tsub[1]) && !/patchs/.test(tsub[1]) && /recorded instruments/.test(tsub[0]), 'owner: counts read right', tsub.join(' | '));
  await clickIn('pp-bass-patch-pop', '.pb-row', 'mõdSynth'); await page.waitForTimeout(300);
  rows = await rowsOf('pp-bass-patch-pop');
  check(rows[0] === 'Sounds' ? false : rows[0] === 'mõdSynth' && rows[1] === 'Bass' && rows.length > 8, 'owner: mõdSynth is a list of sound types, Bass first on the Bass page', rows.slice(0, 6).join(' | ') + ' (' + rows.length + ')');
  await clickIn('pp-bass-patch-pop', '.pb-row', 'Bass'); await page.waitForTimeout(300);
  const both = await page.evaluate(() => [...document.querySelectorAll('#pp-bass-patch-pop .cp-sect')].map(e => e.textContent));
  check(both.join('|') === 'Modern|Classic', 'owner: a type holds the Modern bank and the Classic library', both.join('|'));
  await clickIn('pp-bass-patch-pop', '.cp-item', 'Reese Grit'); await page.waitForTimeout(1200);
  let st = await page.evaluate(() => ({ wave: window._blCaptureState().wave, cur: document.querySelector('#pp-bass-patch .pp-cur').textContent, note: document.querySelector('#pp-bass-patch .pp-note').textContent, open: document.getElementById('pp-bass-patch-pop').classList.contains('open'), patch: vpPatchCurrent('bass') }));
  check(st.wave === 'modsynth' && /Reese Grit/.test(st.patch) && !st.open, 'owner: picking a patch puts the part on it and shuts the list', JSON.stringify(st));
  check(st.cur === 'Reese Grit' && /mõdSynth/.test(st.note) && /Bass/.test(st.note), 'owner: the Voice half names the patch and where it lives', st.cur + ' / ' + st.note);
  // A sample, through the part's own setter.
  await page.evaluate(() => document.getElementById('pp-bass-patch').click()); await page.waitForTimeout(400);
  await clickIn('pp-bass-patch-pop', '.pb-row', 'Samples'); await page.waitForTimeout(300);
  const fams = await page.evaluate(() => [...document.querySelectorAll('#pp-bass-patch-pop .cp-sect')].map(e => e.textContent));
  check(fams[0] === 'Keys' && fams.indexOf('Basses') > 0, 'owner: Samples are grouped by family', fams.join('|'));
  await clickIn('pp-bass-patch-pop', '.cp-item', 'Upright 1'); await page.waitForTimeout(800);
  st = await page.evaluate(() => ({ wave: window._blCaptureState().wave, note: document.querySelector('#pp-bass-patch .pp-note').textContent }));
  check(st.wave === 'upright_real' && /^Samples/.test(st.note), 'owner: picking a sample sets the voice', JSON.stringify(st));
  // The Melody Seq's own part order: Lead before Bass.
  await part('mel');
  await page.evaluate(() => document.getElementById('pp-melody-patch').click()); await page.waitForTimeout(400);
  await clickIn('pp-melody-patch-pop', '.pb-row', 'mõdSynth'); await page.waitForTimeout(300);
  rows = await rowsOf('pp-melody-patch-pop');
  check(rows[1] === 'Lead', 'owner: the Melody Seq opens its types on Lead', rows.slice(0, 4).join(' | '));
  await page.evaluate(() => ppClose());

  // ── The Play page's Chords picker ──
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(700);
  const opened = await page.evaluate(() => { const b = document.querySelector('#sndpick-bw-voices .snd-pick-btn'); b.click(); const pop = document.getElementById('sndpop-bw-voices'); return { open: pop.classList.contains('open'), pb: pop.classList.contains('pb-on') }; });
  await page.waitForTimeout(600);
  check(opened.open && opened.pb, 'Play: the Chords picker opens the sound browser', JSON.stringify(opened));
  rows = await rowsOf('sndpop-bw-voices');
  check(rows.join('|') === 'Samples|mõdSynth|Free voices', 'Play: tiers in the same order', rows.join(' | '));
  await clickIn('sndpop-bw-voices', '.pb-row', 'Samples'); await page.waitForTimeout(300);
  await clickIn('sndpop-bw-voices', '.cp-item', 'Vibes'); await page.waitForTimeout(600);
  st = await page.evaluate(() => ({ wave: wave, open: document.getElementById('sndpop-bw-voices').classList.contains('open'), lbl: document.querySelector('#sndpick-bw-voices .snd-pick-cur').textContent }));
  check(st.wave === 'vibes' && !st.open && /Vibes/.test(st.lbl), 'Play: a pick reaches the chord voice, shuts the list and the trigger follows', JSON.stringify(st));

  // ── The Live Styles rows (6.9.9.9.3): Voice | Pattern in one frame ──
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(900);
  const rowsInfo = await page.evaluate(() => [...document.querySelectorAll('#st-widget .st-row')].map(r => {
    const v = r.querySelector('.st-vname').getBoundingClientRect(), n = r.querySelector('.st-name').getBoundingClientRect();
    return { part: r.dataset.part, voiceLeft: v.right <= n.left + 1, vsteps: r.querySelectorAll('.st-vstep').length, steps: r.querySelectorAll('.st-step').length, voice: r.querySelector('.st-vname').textContent };
  }));
  check(rowsInfo.map(r => r.part).join() === 'drums,aux,bass,mel' && rowsInfo.every(r => r.voiceLeft && r.vsteps === 2 && r.steps === 2), 'Live Styles: every row is Voice on the left, Pattern on the right, a caret either side of each', JSON.stringify(rowsInfo.map(r => r.part + ':' + r.voiceLeft)));
  const cols = await page.evaluate(() => [...document.querySelectorAll('#st-widget .st-cols span')].map(e => e.textContent).join('|'));
  check(cols === '|Voice|Pattern', 'Live Styles: the columns are captioned', cols);
  const pad = await page.evaluate(() => [...document.querySelectorAll('#st-widget .st-vstep, #st-widget .st-step')].map(b => { const r = b.getBoundingClientRect(), a = getComputedStyle(b, '::before'); return Math.round(r.width + parseFloat(a.left || 0) * -1 + parseFloat(a.right || 0) * -1); }));
  check(pad.length === 16 && pad.every(w => w >= 44), 'Live Styles: every caret is 44 pt wide to touch', pad.join());
  // Bass voice list: the browser, anchored to the row.
  await page.evaluate(() => document.querySelector('#st-widget .st-row[data-part="bass"] .st-vname').click()); await page.waitForTimeout(500);
  rows = await rowsOf('pp-bass-patch-pop');
  const anch = await page.evaluate(() => { const p = document.getElementById('pp-bass-patch-pop').getBoundingClientRect(), a = document.querySelector('#st-widget .st-row[data-part="bass"] .st-vname').getBoundingClientRect(); return { open: document.getElementById('pp-bass-patch-pop').classList.contains('open'), under: Math.abs(p.top - (a.bottom + 4)) < 3 || p.bottom <= a.top }; });
  check(anch.open && anch.under && rows.join('|') === 'Samples|mõdSynth|Free voices', 'Live Styles: the Bass voice name opens the sound browser under the row', JSON.stringify(anch) + ' ' + rows.join('|'));
  await clickIn('pp-bass-patch-pop', '.pb-row', 'mõdSynth'); await page.waitForTimeout(300);
  await clickIn('pp-bass-patch-pop', '.pb-row', 'Bass'); await page.waitForTimeout(300);
  await clickIn('pp-bass-patch-pop', '.cp-item', 'Deep Sub'); await page.waitForTimeout(1200);
  let v1 = await page.evaluate(() => ({ name: document.querySelector('#st-widget .st-row[data-part="bass"] .st-vname').textContent, open: document.getElementById('pp-bass-patch-pop').classList.contains('open') }));
  check(/Deep Sub/.test(v1.name) && !v1.open, 'Live Styles: a pick shuts the list and the row names it', JSON.stringify(v1));
  // The caret steps inside the same type, and the name follows.
  await page.evaluate(() => document.querySelectorAll('#st-widget .st-row[data-part="bass"] .st-vstep')[1].click()); await page.waitForTimeout(1200);
  const v2 = await page.evaluate(() => ({ name: document.querySelector('#st-widget .st-row[data-part="bass"] .st-vname').textContent, patch: vpPatchCurrent('bass') }));
  const inBass = await page.evaluate(n => { const m = pbModel('bass'); return !!(m.cur && m.cur.cat.label === 'Bass'); }, v2.name);
  check(v2.name !== v1.name && inBass && /^L\|/.test(v2.patch), 'Live Styles: the next caret goes to the next Bass patch', v1.name + ' > ' + v2.name);
  await page.evaluate(() => document.querySelectorAll('#st-widget .st-row[data-part="bass"] .st-vstep')[0].click()); await page.waitForTimeout(1200);
  const v3 = await page.evaluate(() => document.querySelector('#st-widget .st-row[data-part="bass"] .st-vname').textContent);
  check(v3 === v1.name, 'and the previous caret comes back', v3);
  // Kits: Drums and Aux are each their own list and their own caret.
  const k0 = await page.evaluate(() => ({ d: window._sqDrumKit(), a: window._sqAuxKit() }));
  await page.evaluate(() => document.querySelectorAll('#st-widget .st-row[data-part="drums"] .st-vstep')[1].click()); await page.waitForTimeout(600);
  const k1 = await page.evaluate(() => ({ d: window._sqDrumKit(), a: window._sqAuxKit(), n: document.querySelector('#st-widget .st-row[data-part="drums"] .st-vname').textContent }));
  check(k1.d !== k0.d && k1.a === k0.a, 'Live Styles: the Drums caret changes the drum kit and leaves the Aux kit', JSON.stringify([k0, k1]));
  await page.evaluate(() => document.querySelector('#st-widget .st-row[data-part="aux"] .st-vname').click()); await page.waitForTimeout(400);
  const auxList = await page.evaluate(() => { const p = document.getElementById('pp-live-aux-kit-pop'); return { open: p.classList.contains('open'), first: p.querySelector('.cp-sect') && p.querySelector('.cp-sect').textContent }; });
  check(auxList.open && auxList.first === 'Percussion & world', 'Live Styles: the Aux voice opens the kit list on Percussion & world', JSON.stringify(auxList));
  await clickIn('pp-live-aux-kit-pop', '.cp-item', 'Latin'); await page.waitForTimeout(600);
  const k2 = await page.evaluate(() => ({ d: window._sqDrumKit(), a: window._sqAuxKit(), n: document.querySelector('#st-widget .st-row[data-part="aux"] .st-vname').textContent }));
  check(k2.a === 'LATIN' && k2.d === k1.d && /Latin/.test(k2.n), 'Live Styles: picking an Aux kit sets the Aux kit only, and the row names it', JSON.stringify(k2));
  await page.evaluate(() => ppClose());

  // ── The Voices dropdowns ──
  const og = await page.evaluate(() => [...document.querySelectorAll('#vsel-chord optgroup')].map(g => g.label).filter(l => !/^mõdSynth · /.test(l)));
  check(og.join('|') === 'Samples|mõdSynth|Free voices', 'Voices dropdown: Samples first', og.join('|'));

  // Shut lists take no room on the page: 6.9.9.9.2 left every part page's Voice list displayed under the content.
  const shown = await page.evaluate(() => [...document.querySelectorAll('.pp-pop, .snd-pick-pop')].filter(p => !p.classList.contains('open') && getComputedStyle(p).display !== 'none').map(p => p.id));
  check(shown.length === 0, 'every shut list is display:none', shown.join(','));
  const pbOnPop = await page.evaluate(() => document.querySelectorAll('.pp-pop.pb-root, .snd-pick-pop.pb-root').length);
  check(pbOnPop === 0, 'the browser is drawn inside a list, not as the list');

  check(errs.length === 0, 'no page errors', errs.join(' ; ').slice(0, 300));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
