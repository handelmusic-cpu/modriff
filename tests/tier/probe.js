/* Voices on free: the defaults are synth voices, no recorded voice and no mõdSynth
   can be chosen by any route, and every picker shows them locked.

   Piano 1 and Upright 1 were free (4.9.9.4 to 4.9.9.9.9.8.9g) and the owner took
   them back out, defaulting chords to Piano (synth) and bass to Upright. Taking
   a voice off the free list is only as good as the places that enforce it, and
   this probe found that only the bass setter did: chords, melody keys, arp and
   Melody Seq took a Pro voice from anything but a tap, the Melody Seq buttons
   were never locked, and the Bass and Melody Seq Patch dropdowns dropped every
   locked voice instead of showing it locked.

   Run (repo served; Chrome or Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT (as tests/toast/probe.js). */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(1800);

  // ── 1. A fresh start plays synth voices, which are free
  const d = await page.evaluate(() => ({
    chords: wave, bass: window._blCaptureState().wave, melody: melWave, arp: arpWave, seq: window._mlCaptureState().wave,
    chordBtn: (document.querySelector('[data-wave].active') || {}).textContent,
    bassBtn: (document.querySelector('.bl-mopt.active') || {}).id,
    allFree: (setModTier('free'), [wave, melWave, arpWave, window._blCaptureState().wave, window._mlCaptureState().wave].every(w => freeAllowsVoice(w))),
  }));
  check(d.chords === 'piano' && d.chordBtn === 'Piano (synth)', 'chords start on Piano (synth)', d.chords + ' / ' + d.chordBtn);
  check(d.bass === 'upright' && d.bassBtn === 'blw-up', 'bass starts on Upright, the synth one', d.bass + ' / ' + d.bassBtn);
  check(d.allFree, 'every default voice is free', JSON.stringify(d));

  // ── 2. On free, no setter takes a Pro voice, and each takes a synth one
  const setters = await page.evaluate(() => {
    setModTier('free');
    const parts = {
      chords: [v => setWave(v), () => wave], melodyKeys: [v => setMelWave(v), () => melWave], arp: [v => setArpWave(v), () => arpWave],
      melodySeq: [v => window.setMlWave(v), () => window._mlCaptureState().wave], bass: [v => window.setBlWave(v), () => window._blCaptureState().wave],
    };
    const bad = [], noSynth = [];
    Object.keys(parts).forEach(k => {
      const [set, get] = parts[k], start = get();
      ['modsynth', 'vibes', 'pianoreal2', 'upright_real', 'upright2'].forEach(v => { try { set(v); } catch (e) {} if (get() === v) bad.push(k + ':' + v); set(start); });
      set('square'); if (get() !== 'square') noSynth.push(k); set(start);
    });
    return { bad, noSynth };
  });
  check(setters.bad.length === 0, 'no part takes a recorded voice or mõdSynth on free', setters.bad.join(' '));
  check(setters.noSynth.length === 0, 'and every part still takes a synth voice', setters.noSynth.join(' '));

  // ── 3. Every picker lists mõdSynth: locked on free, open on Pro
  const surfaces = () => page.evaluate(async () => {
    const r = {};
    ['data-wave', 'data-melwave', 'data-arpwave', 'data-mlwave'].forEach(a => {
      const b = [...document.querySelectorAll('[' + a + '="modsynth"]')];
      r[a] = { n: b.length, locked: b.filter(x => x.classList.contains('tier-locked')).length };
    });
    const sels = [...document.querySelectorAll('select.voice-sel')].filter(s => [...s.options].some(o => o.value === 'modsynth'));
    r.selects = { n: sels.length, locked: sels.filter(s => [...s.options].find(o => o.value === 'modsynth').disabled).length };
    const pops = [...document.querySelectorAll('.snd-pick')].map(w => [...w._pop.querySelectorAll('button')].filter(b => /^mõdSynth/i.test(b.textContent.trim())));
    r.popovers = { n: pops.filter(a => a.length).length, of: pops.length, locked: pops.filter(a => a.length && a[0].classList.contains('tier-locked')).length };
    r.patch = {};
    for (const id of ['pp-bass-patch', 'pp-melody-patch']) {
      document.getElementById(id).click(); await new Promise(x => setTimeout(x, 250));
      const items = [...document.querySelectorAll('.pp-pop.open .cp-item')];
      const ms = items.find(i => /^mõdSynth/i.test(i.textContent.trim()));
      r.patch[id] = { has: !!ms, locked: !!(ms && ms.classList.contains('locked')), anyLocked: items.filter(i => i.classList.contains('locked')).length };
      ppClose();
    }
    return r;
  });
  await page.evaluate(() => setModTier('free')); await page.waitForTimeout(300);
  const f = await surfaces();
  check(['data-wave', 'data-melwave', 'data-arpwave', 'data-mlwave'].every(a => f[a].n > 0 && f[a].locked === f[a].n), 'free: mõdSynth is locked on every voice button, Melody Seq included', JSON.stringify(f['data-mlwave']));
  check(f.selects.n > 0 && f.selects.locked === f.selects.n, 'free: mõdSynth is listed, disabled, in every voice dropdown', JSON.stringify(f.selects));
  check(f.popovers.n === f.popovers.of && f.popovers.locked === f.popovers.n, 'free: every Voice popover lists it locked', JSON.stringify(f.popovers));
  check(f.patch['pp-bass-patch'].has && f.patch['pp-bass-patch'].locked, 'free: the Bass Patch dropdown lists it locked', JSON.stringify(f.patch['pp-bass-patch']));
  check(f.patch['pp-melody-patch'].has && f.patch['pp-melody-patch'].locked, 'free: the Melody Seq Patch dropdown lists it locked', JSON.stringify(f.patch['pp-melody-patch']));
  await page.evaluate(() => setModTier('pro')); await page.waitForTimeout(300);
  const p = await surfaces();
  check(['data-wave', 'data-melwave', 'data-arpwave', 'data-mlwave'].every(a => p[a].locked === 0) && p.selects.locked === 0 && p.popovers.locked === 0
        && !p.patch['pp-bass-patch'].anyLocked && !p.patch['pp-melody-patch'].anyLocked, 'pro: nothing is locked anywhere', JSON.stringify(p.patch));

  // ── 4. Tapping a locked voice in the Patch dropdown opens the sheet and changes nothing
  const tap = await page.evaluate(async () => {
    setModTier('free'); await new Promise(x => setTimeout(x, 300));
    const before = window._mlCaptureState().wave;
    document.getElementById('pp-melody-patch').click(); await new Promise(x => setTimeout(x, 250));
    [...document.querySelectorAll('.pp-pop.open .cp-item')].find(i => /^mõdSynth/i.test(i.textContent.trim())).click();
    await new Promise(x => setTimeout(x, 250));
    const sh = document.getElementById('_pro-sheet');
    return { sheet: sh && sh.querySelector('.pro-what').textContent, before, after: window._mlCaptureState().wave };
  });
  check(/mõdSynth is part of mõdRïff Pro/.test(tap.sheet || ''), 'tapping it opens the Pro sheet, named', tap.sheet);
  check(tap.before === tap.after, 'and the Melody Seq voice does not change', tap.before + ' -> ' + tap.after);

  // ── 5. A Pro setup with recorded voices comes back to synth ones on free, and keeps the originals
  const keep = await page.evaluate(async () => {
    setModTier('pro'); document.getElementById('_pro-sheet') && document.getElementById('_pro-sheet').remove();
    setWave('pianoreal2'); setArpWave('flute'); setMelWave('vibes'); window.setMlWave('tenorsax'); window.setBlWave('upright2');
    const st = captureSetup('Recorded rig', false);
    setModTier('free'); await new Promise(x => setTimeout(x, 200));
    applySetup(st, { quiet: true }); await new Promise(x => setTimeout(x, 300));
    const live = { chords: wave, arp: arpWave, mel: melWave, seq: window._mlCaptureState().wave, bass: window._blCaptureState().wave };
    const again = captureSetup('Re-saved', false).settings;
    return { live, kept: { chords: again.wave, arp: again.arpWave, mel: again.melWave, seq: again.melgenWave, bass: again.blWave } };
  });
  check(Object.values(keep.live).every(w => ['piano','sine','triangle','upright','electric','square','sawtooth','rhodes','organ','pad','supersaw'].includes(w)), 'on free every part is on a synth voice again', JSON.stringify(keep.live));
  check(keep.kept.chords === 'pianoreal2' && keep.kept.arp === 'flute' && keep.kept.mel === 'vibes' && keep.kept.seq === 'tenorsax' && keep.kept.bass === 'upright2',
        're-saving there keeps all five recorded voices', JSON.stringify(keep.kept));

  check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
