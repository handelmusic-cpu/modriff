/* mõdSynth patches in every voice selector (6.7b).

     - a free install never fetches the synth library and its selectors have no patch lists;
     - an owner's popover pickers (Chords, Melody, Arp, Melody Seq; Chords has two) and the Voices panel's dropdowns (every host, Bass
       included) list the patches in groups: Saved, Modern by category, Classic by category;
     - choosing a patch from a popover picker puts the part on mõdSynth with that patch, closes the popover, and the
       trigger names it; choosing one from a Voices dropdown does the same for Bass;
     - every list follows: the dropdowns in the other hosts and the popover's own list show the patch; moving the part
       to another voice clears the popover's list;
     - a Saved patch shows up under Saved the moment it is saved and goes when it is deleted.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/voicepatches/probe.js
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
  const boot = async (tier) => {
    await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.goto(URL); await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
    await page.evaluate(t => { setModTier(t); setViewMode('advanced'); switchTab('perform'); }, tier); await page.waitForTimeout(500);
  };

  // Free: nothing fetched, nothing listed.
  await boot('free');
  await page.evaluate(() => vpPatchesEnsure()); await page.waitForTimeout(1200);
  const free = await page.evaluate(() => ({ lib: !!(window.MS && MS.FACTORY_PATCHES), listed: [...document.querySelectorAll('.vp-patch-sel')].filter(s => s.options.length > 1).length,
    sels: [...document.querySelectorAll('.voice-sel')].filter(s => s._msxDone).length }));
  check(!free.lib && free.listed === 0 && free.sels === 0, 'free: the synth library is not fetched and no selector lists patches', JSON.stringify(free));

  // Owner.
  await boot('pro');
  await page.evaluate(() => vpPatchesEnsure()); await page.waitForFunction(() => window.MS && MS.FACTORY_PATCHES && MS.MODERN_PATCHES, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const own = await page.evaluate(() => ({
    pops: [...document.querySelectorAll('.vp-patch-sel')].map(s => s.dataset.part + ':' + (s.options.length - 1)),
    groups: [...document.querySelector('.vp-patch-sel').querySelectorAll('optgroup')].map(g => g.label),
    sels: [...document.querySelectorAll('.voice-sel')].filter(s => s._msxPart).map(s => s.id + ':' + (s._msxDone ? 1 : 0)),
    n: msxModern().length + msxClassic().length }));
  check(own.pops.length >= 4 && own.pops.every(x => +x.split(':')[1] === own.n), 'owner: each popover picker lists every patch', own.pops.join(' ') + ' of ' + own.n);
  check(own.groups.some(g => /^Modern · /.test(g)) && own.groups.some(g => /^Classic · /.test(g)), 'owner: groups are Modern and Classic by category', own.groups.slice(0, 3).join(' | '));
  check(own.sels.length >= 8 && own.sels.every(x => x.endsWith(':1')), 'owner: the Voices panel dropdowns have them too', own.sels.length + ' dropdowns');
  const bassSel = own.sels.find(x => /vsel-bass/.test(x));
  check(!!bassSel, 'the Bass dropdown is one of them', bassSel);

  // Pick from the Chords popover.
  const pickName = await page.evaluate(() => msxModern()[3].name);
  const chordBefore = await page.evaluate(() => wave);
  await page.evaluate(() => { const w = document.getElementById('sndpick-bw-voices'); w.querySelector('.snd-pick-btn').click(); });
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => document.getElementById('sndpop-bw-voices').classList.contains('open'));
  await page.evaluate(n => { const s = document.querySelector('#sndpop-bw-voices .vp-patch-sel'); s.value = 'L|' + n; s.dispatchEvent(new Event('change', { bubbles: true })); }, pickName);
  await page.waitForTimeout(700);
  const c = await page.evaluate(() => ({ wave, patch: MSX.state.chord && MSX.state.chord.patch, open: document.getElementById('sndpop-bw-voices').classList.contains('open'),
    trig: document.querySelector('#sndpick-bw-voices .snd-pick-cur').textContent, popSel: document.querySelector('#sndpop-bw-voices .vp-patch-sel').value,
    panel: document.getElementById('vsel-chord-mix') ? document.getElementById('vsel-chord-mix').value : null }));
  check(opened && chordBefore !== 'modsynth', 'the Chords picker opened on another voice', chordBefore);
  check(c.wave === 'modsynth' && c.patch === pickName, 'picking a patch from the popover puts Chords on mõdSynth with it', JSON.stringify([c.wave, c.patch]));
  check(!c.open, 'and closes the popover');
  check(c.trig === 'mõdSynth · ' + pickName, 'the trigger names the patch', c.trig);
  check(c.popSel === 'L|' + pickName, "the popover's list shows it", c.popSel);
  check(c.panel === 'msx:L|' + pickName, 'the Voices dropdown in the Sound tab shows it', c.panel);

  // Pick from a Voices dropdown, for Bass.
  const bassName = await page.evaluate(() => msxClassic()[5].name);
  const b = await page.evaluate(n => { const s = document.getElementById('vsel-bass-mix'); s.value = 'msx:L|' + n; s.dispatchEvent(new Event('change', { bubbles: true })); return true; }, bassName);
  await page.waitForTimeout(700);
  const bs = await page.evaluate(() => ({ voice: window._blCaptureState().wave, patch: MSX.state.bass && MSX.state.bass.patch, others: ['vsel-bass', 'vsel-bass-acb', 'vsel-bass-dock'].map(id => { const e = document.getElementById(id); return e ? e.value : '-'; }) }));
  check(bs.voice === 'modsynth' && bs.patch === bassName, 'picking a patch from the Bass dropdown puts Bass on mõdSynth with it', JSON.stringify([bs.voice, bs.patch]));
  check(bs.others.every(v => v === '-' || v === 'msx:L|' + bassName), "the Bass dropdowns in the other hosts follow", JSON.stringify(bs.others));

  // Moving the part away clears the popover's list.
  await page.evaluate(() => setWave('sine')); await page.waitForTimeout(300);
  const away = await page.evaluate(() => ({ pop: document.querySelector('#sndpop-bw-voices .vp-patch-sel').value, dd: document.getElementById('vsel-chord-mix').value }));
  check(away.pop === '' && away.dd === 'sine', 'moving Chords to Sine clears the patch list and the dropdown shows Sine', JSON.stringify(away));

  // Saved patches.
  await page.evaluate(() => { MSX_USER.push({ name: 'Probe Patch', values: {}, motion: [], cat: 'Keys' }); msxUserSave(); }); await page.waitForTimeout(500);
  const sv = await page.evaluate(() => ({ pop: [...document.querySelector('.vp-patch-sel').querySelectorAll('optgroup')].map(g => g.label)[0], dd: [...document.getElementById('vsel-chord-mix').querySelectorAll('optgroup')].map(g => g.label).filter(l => /Saved/.test(l)).length }));
  check(sv.pop === 'Saved' && sv.dd === 1, 'a saved patch appears under Saved in the popover and the dropdown', JSON.stringify(sv));
  await page.evaluate(() => { msxUserDelete('Probe Patch'); }); await page.waitForTimeout(500);
  const gone = await page.evaluate(() => [...document.querySelector('.vp-patch-sel').querySelectorAll('optgroup')].map(g => g.label).indexOf('Saved'));
  check(gone === -1, 'and goes when it is deleted', gone);

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
