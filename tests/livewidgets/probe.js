/* The Live page's pack widgets (6.9): Voices, Mixer, mõdSynth, and the Bass / Melody rolls, gated on Live only.

   Free install:
     - the Bass and Melody roll widgets are lock tiles where they sit, naming their pack, and a tap says why;
     - the Mixer and mõdSynth widgets cannot be added (lvPick refuses, naming their pack);
     - the same instruments on their Studio pages are untouched (the Bass roll is there and not locked).
   Owner:
     - Voices: seven rows; choosing a voice in one sets the part;
     - Mixer: a strip per part, mute works, a fader moves the part's level, its meters run on Live and stop on Studio;
     - mõdSynth: a chip per part; a part not on mõdSynth offers "Play ... on mõdSynth"; once on it the patch list and the macros
       the patch routes appear; a macro slider writes macro.N of the part's state; picking a patch changes it;
     - Styles: while Bass has a line waiting for the loop, the Styles row's name carries the queued fill, and clears.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/livewidgets/probe.js
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
  const boot = async (tier, slots) => {
    await page.goto(URL); await page.evaluate(s => { localStorage.clear(); if (s) localStorage.setItem('modo-live-slots', JSON.stringify(s)); }, slots || null); await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(t => { setModTier(t); setViewMode('basic'); switchTab('perform'); }, tier); await page.waitForTimeout(700);
  };
  const toastShown = () => page.evaluate(() => { const t = document.getElementById('_toast'); return t && parseFloat(getComputedStyle(t).opacity) > 0.5 ? t.textContent : ''; });

  // ── The standard layout has no rolls (6.9.9.9.3), for a free install and for an owner
  await boot('free');
  const std = await page.evaluate(() => [...document.querySelectorAll('#lv-slots > .lv-slot')].map(s => s.dataset.mod));
  check(std.join() === 'chords,melody,styles,pads,fx,endings', 'the standard Live layout has no drum, aux, bass or melody rolls', std.join());

  // ── Free, with the rolls added (a layout somebody saved)
  await boot('free', ['chords', 'melody', 'styles', 'pads', 'fx', 'bass', 'melseq', 'drums', 'aux', 'endings']);
  const f = await page.evaluate(() => ({ slots: [...document.querySelectorAll('#lv-slots > .lv-slot')].map(s => s.dataset.mod + (s.classList.contains('lv-locked') ? ':locked' : '')),
    packs: [...document.querySelectorAll('.lv-lock-tile .lv-lock-p')].map(e => e.textContent) }));
  check(f.slots.includes('bass:locked') && f.slots.includes('melseq:locked'), 'free: the Bass and Melody roll widgets are lock tiles', f.slots.join(' '));
  check(f.packs.length === 2 && f.packs.every(p => /Groove/.test(p)), 'and name their pack', f.packs.join(' | '));
  check(!f.slots.some(s => /^(mixer|synth|voices)/.test(s)), 'free: the standard Live layout has none of the new widgets');
  check(f.slots.includes('drums') && f.slots.includes('aux') && f.slots.includes('chords') && f.slots.includes('styles'), 'free: everything else on Live is as before (Chords, Styles, Drums, Aux ...)');
  await page.evaluate(() => { document.querySelector('.lv-lock-tile').click(); }); await page.waitForTimeout(300);
  const t1 = await toastShown();
  check(/Bass grid|Groove Pack/.test(t1), 'tapping a lock tile says which pack it is', t1);
  await page.evaluate(() => { const t = document.getElementById('_toast'); t.style.opacity = '0'; _freeToastAt = 0; });
  const refuse = await page.evaluate(() => { const before = LV.slots.join(); lvPick(LV.slots.length, 'mixer'); return { same: before === LV.slots.join() }; });
  await page.waitForTimeout(300);
  const t2 = await toastShown();
  check(refuse.same && /Mixer/.test(t2) && /Studio/.test(t2), 'free: the Mixer widget cannot be added; the refusal names the Studio Pack', t2);
  await page.evaluate(() => { const t = document.getElementById('_toast'); t.style.opacity = '0'; _freeToastAt = 0; });
  await page.evaluate(() => lvPick(LV.slots.length, 'synth')); await page.waitForTimeout(300);
  const t3 = await toastShown();
  check(/mõdSynth/.test(t3), 'free: the mõdSynth widget cannot be added either', t3);
  // The same instruments elsewhere are untouched.
  await page.evaluate(() => { setViewMode('advanced'); switchTab('accomp'); setAccompMode('bass'); }); await page.waitForTimeout(500);
  const studio = await page.evaluate(() => { const h = document.querySelector('#bm-bass-panel .pr-host'); return { has: !!h, shown: !!h && h.getClientRects().length > 0, locked: !!(h && h.closest('.tier-locked')) }; });
  check(studio.has && studio.shown && !studio.locked, "free: the Bass roll on Studio's Bass page is there and not locked", JSON.stringify(studio));
  await page.evaluate(() => { switchTab('mix'); setMixMode('mixer'); }); await page.waitForTimeout(500);
  const mixTab = await page.evaluate(() => document.querySelectorAll('#mix-tab-channels .mix-strip').length);
  check(mixTab >= 8, "free: the Sound tab's mixer is untouched", mixTab + ' strips');

  // ── Owner
  await boot('pro');
  await page.evaluate(() => { lvSet(LV_STD.concat(['voices', 'mixer', 'synth'])); }); await page.waitForTimeout(1500);
  const o = await page.evaluate(() => ({ locked: document.querySelectorAll('.lv-locked').length, voices: document.querySelectorAll('#lv-slots #voices-grid-live .voice-row').length,
    strips: document.querySelectorAll('#lv-slots #lv-mixer-host .mix-strip:not(.mix-master)').length, chips: document.querySelectorAll('#lv-slots .lv-syn-part').length }));
  check(o.locked === 0, 'owner: no lock tiles', o.locked);
  check(o.voices >= 7, 'owner: the Voices widget has its rows', o.voices);
  check(o.strips >= 8, 'owner: the Mixer widget has a strip per part', o.strips);
  check(o.chips === 5, 'owner: the mõdSynth widget has a chip per part', o.chips);

  // Voices
  const v0 = await page.evaluate(() => wave);
  await page.evaluate(() => { const s = document.querySelector('#lv-slots #vsel-chord-live'); s.value = 'organ'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  const v1 = await page.evaluate(() => ({ wave, mirror: document.getElementById('vsel-chord-mix').value }));
  check(v0 !== 'organ' && v1.wave === 'organ' && v1.mirror === 'organ', 'Voices: choosing a voice on Live sets the part, and the Sound tab follows', v0 + ' -> ' + JSON.stringify(v1));

  // Mixer
  await page.evaluate(() => { document.querySelector('#lv-mixer-host [data-mixmute="chord"]').click(); });
  const mu = await page.evaluate(() => ({ m: !!sqMixMute.chord, on: document.querySelector('#lv-mixer-host [data-mixmute="chord"]').classList.contains('on') }));
  check(mu.m && mu.on, 'Mixer: mute works from Live', JSON.stringify(mu));
  await page.evaluate(() => { document.querySelector('#lv-mixer-host [data-mixmute="chord"]').click(); });
  const g0 = await page.evaluate(() => (sqMixGainsW.bass == null ? 1 : sqMixGainsW.bass));
  await page.evaluate(() => { const f = document.querySelector('#lv-mixer-host [data-mixmute="bass"]').closest('.mix-strip').querySelector('[role=slider]'); f.focus(); for (let i = 0; i < 5; i++) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  const g1 = await page.evaluate(() => sqMixGainsW.bass);
  check(g1 < g0, "Mixer: a fader moves the part's level", g0.toFixed(3) + ' -> ' + g1.toFixed(3));
  const run1 = await page.evaluate(() => !!_mixMeterRaf);
  await page.evaluate(() => { setViewMode('advanced'); switchTab('perform'); }); await page.waitForTimeout(500);
  const run2 = await page.evaluate(() => !!_mixMeterRaf);
  check(run1 === true && run2 === false, 'Mixer: its meters run while it is on Live and stop when it is not', run1 + ' -> ' + run2);
  await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(700);

  // mõdSynth
  await page.waitForFunction(() => window.MS && MS.PARAM, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => vpPatchesEnsure()); await page.waitForTimeout(2500);
  await page.evaluate(() => { document.querySelector('#lv-slots .lv-slot[data-mod=synth]'); lvSynthRender(); });
  const s0 = await page.evaluate(() => ({ go: (document.querySelector('.lv-syn-go') || {}).textContent, patchSel: !!document.querySelector('.lv-syn-patch') }));
  check(/Play Chords on mõdSynth/.test(s0.go || '') && !s0.patchSel, 'mõdSynth: a part not on mõdSynth offers to be put on it', s0.go);
  await page.evaluate(() => { document.querySelector('.lv-syn-go').click(); }); await page.waitForTimeout(1500);
  const s1 = await page.evaluate(() => ({ wave, sel: !!document.querySelector('.lv-syn-patch'), macros: document.querySelectorAll('.lv-syn-macro').length, onChip: !!document.querySelector('.lv-syn-part.sel.on') }));
  check(s1.wave === 'modsynth' && s1.sel && s1.macros > 0 && s1.onChip, 'mõdSynth: once on it, the patch list and the macros the patch routes appear', JSON.stringify(s1));
  const m0 = await page.evaluate(() => { const r = document.querySelector('.lv-syn-macro input'); const before = (MSX.state.chord.vals || {})['macro.1']; r.value = 900; r.dispatchEvent(new Event('input', { bubbles: true })); return { before, after: JSON.stringify(MSX.state.chord.vals || {}) }; });
  check(/macro\.\d/.test(m0.after), 'mõdSynth: a macro slider writes macro.N into the part state', m0.after.slice(0, 80));
  const newPatch = await page.evaluate(() => msxModern().find(p => p.name !== MSX.state.chord.patch && p.name !== (msxValuesFor('chord').patch || {}).name).name);
  await page.evaluate(n => { const s = document.querySelector('.lv-syn-patch'); s.value = 'L|' + n; s.dispatchEvent(new Event('change', { bubbles: true })); }, newPatch);
  await page.waitForTimeout(1200);
  const pp = await page.evaluate(() => ({ patch: MSX.state.chord.patch, shown: document.querySelector('.lv-syn-patch').value }));
  check(pp.patch === newPatch && pp.shown === 'L|' + newPatch, 'mõdSynth: choosing a patch changes the part and the list follows', JSON.stringify(pp));

  // Styles: the queued fill reaches the Live row.
  await page.evaluate(() => _genQueuePaint('bl', 0.4));
  const q1 = await page.evaluate(() => { const e = document.querySelector('.st-row[data-part="bass"] .st-name'); return { q: e.classList.contains('gen-queued'), v: e.style.getPropertyValue('--q') }; });
  await page.evaluate(() => _genQueuePaint('bl', null, true));
  const q2 = await page.evaluate(() => document.querySelector('.st-row[data-part="bass"] .st-name').classList.contains('gen-queued'));
  check(q1.q && q1.v === '0.400' && !q2, "Styles: a Bass line waiting for the loop fills the Styles row's name, and it clears when the line lands", JSON.stringify([q1, q2]));

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
