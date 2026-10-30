/* The modules, in the real app: what each one unlocks, what the lock does, what the
   sheet and the store say, and what a purchase changes without a reload.

   The registry test (registry.test.js) holds the tables and the logic. This is
   the other half: that the page actually enforces them. It found, while the
   packs were being built, that the Aux layer's switch lives in the sequencer's
   own scope (so the first attempt to turn it off from outside threw inside a
   try/catch and did nothing), which no amount of reading the diff shows.

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
  const own = async keys => { await page.evaluate(k => { document.getElementById('_pro-sheet') && document.getElementById('_pro-sheet').remove(); setModOwned(k); }, keys); await page.waitForTimeout(250); };

  // ── 1. The browser build grants everything; nothing is locked
  const web = await page.evaluate(() => ({ provider: modBilling.provider, all: modHasAll(), locks: document.querySelectorAll('.tier-locked').length,
    bodyLocks: [...document.body.classList].filter(c => /^lock-/.test(c)).length }));
  check(web.provider === 'web' && web.all && web.locks === 0 && web.bodyLocks === 0, 'the web build holds every module and locks nothing', JSON.stringify(web));

  // ── 2. Free: the stand-ins, and what a fresh start plays
  await own([]);
  const free = await page.evaluate(() => ({
    chords: wave, bass: window._blCaptureState().wave, kit: window._sqDrumKit(), aux: window._sqLayerOn(1), mode: mode, voicing: voicing,
    stepsOk: freeAllowsSteps(window._sqSteps()), held: MODULE_ORDER.filter(modHas).length,
    bodyLocks: [...document.body.classList].filter(c => /^lock-/.test(c)).length,
    lockNames: [...new Set([...document.querySelectorAll('.tier-locked[data-mod]')].map(e => e.dataset.mod))].sort().join(','),
    unnamed: [...document.querySelectorAll('.tier-locked:not([data-mod])')].map(e => e.id || e.className.slice(0, 30)).slice(0, 6).join(' | '),
  }));
  check(free.held === 0 && free.bodyLocks === 7, 'free holds no module and every module class is on the body', JSON.stringify([free.held, free.bodyLocks]));
  check(free.chords === 'sawtooth', 'the chord voice is the free stand-in (Saw), not the Sounds Pack piano', free.chords);
  check(free.bass === 'upright' && free.kit === 'LIN' && free.mode === 'major' && free.voicing === 'close', 'bass, kit, scale and voicing are free ones', JSON.stringify(free));
  check(free.aux === false, 'the Aux channel is off', String(free.aux));
  check(free.stepsOk, 'the pattern length is one free allows', String(free.stepsOk));
  check(free.lockNames === 'groove,sampler,studio,synth,theory' || free.lockNames.split(',').length >= 4, 'locks name their modules', free.lockNames);
  check(free.unnamed === '', 'every lock on screen names the module that opens it', free.unnamed);

  // ── 3. Each module, alone: its own surfaces open, the others stay shut
  const surfaces = () => page.evaluate(() => {
    const L = sel => { const e = document.querySelector(sel); return e ? e.classList.contains('tier-locked') : null; };
    return {
      groove:  [L('#sq-machineRow [data-mach="909"]'), L('#sq-groove-presets [data-groove="Trap"]'), L('[data-blstyle="jazz"]'), L('[data-mlstyle="arpeggio"]')],
      theory:  [L('#bm-dorian'), L('#bm-hijaz'), L('[data-voicing="drop2"]')],
      sampler: [L('[data-wave="marimba"]'), L('[data-wave="pianoreal2"]')],
      synth:   [L('[data-wave="modsynth"]')],
      sounds:  [L('[data-wave="organ"]'), L('[data-wave="piano"]'), L('[data-wave="vibes"]')],
      studio:  [L('[data-stemtoggle]')],
    };
  });
  for (const m of ['groove', 'theory', 'sampler', 'synth', 'sounds', 'studio']) {
    await own([m]);
    const s = await surfaces();
    Object.keys(s).forEach(k => s[k].forEach((v, i) => {
      if (v === null) return;                      // not drawn in this build of the page
      check(v === (k !== m), m + ' alone: ' + k + ' surface #' + i + ' is ' + (k === m ? 'open' : 'locked'), String(v));
    }));
  }
  await own(['fullstudio']);
  const full = await surfaces();
  check(Object.keys(full).every(k => full[k].every(v => v === null || v === false)) && (await page.evaluate(() => document.querySelectorAll('.tier-locked').length)) === 0,
        'Full Studio opens every surface and leaves no lock on screen');

  // ── 4. The setters refuse what is not owned, and take what is
  await own([]);
  const setters = await page.evaluate(() => {
    const parts = {
      chords: [v => setWave(v), () => wave], melodyKeys: [v => setMelWave(v), () => melWave], arp: [v => setArpWave(v), () => arpWave],
      melodySeq: [v => window.setMlWave(v), () => window._mlCaptureState().wave], bass: [v => window.setBlWave(v), () => window._blCaptureState().wave],
    };
    const bad = [], noFree = [];
    Object.keys(parts).forEach(k => {
      const [set, get] = parts[k], start = get();
      ['modsynth', 'vibes', 'organ', 'pianoreal2', 'upright_real'].forEach(v => { try { set(v); } catch (e) {} if (get() === v) bad.push(k + ':' + v); set(start); });
      set('square'); if (get() !== 'square') noFree.push(k); set(start);
    });
    const before = { mode, voicing, kit: window._sqDrumKit() };
    setMode('hijaz'); setVoicing('drop2'); window._sqPickDrumKit('909');
    const after = { mode, voicing, kit: window._sqDrumKit() };
    return { bad, noFree, same: JSON.stringify(before) === JSON.stringify(after), after };
  });
  check(setters.bad.length === 0, 'free: no part takes a recorded voice, a Sounds Pack voice or mõdSynth', setters.bad.join(' '));
  check(setters.noFree.length === 0, 'free: every part still takes a free voice', setters.noFree.join(' '));
  check(setters.same, 'free: a Theory scale, a Theory voicing and a Groove kit are all refused', JSON.stringify(setters.after));
  await own(['theory', 'groove', 'sounds']);
  const took = await page.evaluate(() => { setMode('hijaz'); setVoicing('drop2'); window._sqPickDrumKit('909'); setWave('organ'); return { mode, voicing, kit: window._sqDrumKit(), wave }; });
  check(took.mode === 'hijaz' && took.voicing === 'drop2' && took.kit === '909' && took.wave === 'organ', 'owning Theory, Groove and Sounds: all four setters take it', JSON.stringify(took));
  await own([]);
  const back = await page.evaluate(() => ({ mode, voicing, kit: window._sqDrumKit(), wave }));
  check(back.mode === 'major' && back.voicing === 'close' && back.kit === 'LIN' && back.wave === 'sawtooth', 'dropping them all puts the free stand-ins back', JSON.stringify(back));

  // ── 5. A tap on a lock opens the sheet, named, with the module, its price and the bundle
  const PRICES = { sampler: 5.99, synth: 4.99, groove: 3.99, theory: 3.99, practice: 3.99, studio: 4.99, sounds: 1.99, fullstudio: 12.99, from1: 10.99, from2: 6.99, from3plus: 3.99 };
  await page.evaluate(p => {
    // A provider that behaves like the iOS one, with the store's answers and a purchase that lands.
    const pr = {}; Object.keys(p).forEach(k => { pr[k] = { price: '$' + p[k].toFixed(2), value: p[k] }; });
    window.__bought = [];
    window.modBilling = { provider: 'ios', _dev: null, owned() { return window.__bought.slice(); }, products() { return pr; },
      refresh() { return Promise.resolve(window.__bought.slice()); },
      purchase(k) { window.__bought.push(k); return Promise.resolve(true); }, restore() { return Promise.resolve(window.__bought.length > 0); } };
    modBillingChanged();
  }, PRICES);
  await page.waitForTimeout(400);
  const sheet = () => page.evaluate(() => { const s = document.getElementById('_pro-sheet'); if (!s) return null;
    return { hd: (s.querySelector('.pro-hd') || {}).textContent, what: (s.querySelector('.pro-what') || {}).textContent,
      buttons: [...s.querySelectorAll('button')].map(b => b.textContent), text: s.textContent, sheets: document.querySelectorAll('#_pro-sheet').length }; });
  await page.evaluate(() => document.querySelector('#sq-machineRow [data-mach="909"]').click()); await page.waitForTimeout(250);
  const a = await sheet();
  check(a && a.hd === 'Groove Pack' && /is part of the Groove Pack\.$/.test(a.what), 'tapping a locked kit opens the Groove Pack sheet, named', a && a.hd + ' / ' + a.what);
  check(a && a.buttons[0] === 'Unlock Groove Pack — $3.99', 'the primary button is the module at the store’s price', a && a.buttons[0]);
  check(a && a.buttons.some(b => b === 'Full Studio — $12.99') && /Unlock everything for \$12\.99\./.test(a.text), 'a new buyer is offered Full Studio at the full price', a && a.buttons.join(' | '));
  check(a && a.buttons.indexOf('Restore Purchases') > 0, 'Restore Purchases is on the sheet', a && a.buttons.join(' | '));
  await page.evaluate(() => document.querySelector('#sq-machineRow [data-mach="MOD"]').click()); await page.waitForTimeout(150);
  const a2 = await sheet();
  check(a2 && a2.sheets === 1, 'a second tap while it is open does not stack another', a2 && String(a2.sheets));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check(await page.evaluate(() => !document.getElementById('_pro-sheet')), 'Escape closes it');

  // ── 6. The wording tracks what the lock is: a voice names its own pack
  const names = await page.evaluate(async () => {
    const out = {};
    for (const w of ['organ', 'marimba', 'modsynth']) {
      document.getElementById('_pro-sheet') && document.getElementById('_pro-sheet').remove();
      document.querySelector('[data-wave="' + w + '"]').click(); await new Promise(x => setTimeout(x, 150));
      out[w] = document.querySelector('#_pro-sheet .pro-hd').textContent;
    }
    document.getElementById('_pro-sheet') && document.getElementById('_pro-sheet').remove();
    return out;
  });
  check(names.organ === 'Sounds Pack' && names.marimba === 'Sampler Engine' && names.modsynth === 'mõdSynth Engine', 'organ is the Sounds Pack, Marimba the Sampler Engine, mõdSynth its own', JSON.stringify(names));

  // ── 7. The bundle offer follows how many modules are owned, and the sheet says what is already held
  const offerFor = async keys => {
    await page.evaluate(k => { window.__bought.length = 0; k.forEach(x => window.__bought.push(x)); }, keys);
    await page.evaluate(() => modBillingChanged()); await page.waitForTimeout(250);
    await page.evaluate(() => proSheet('Custom samples', 'sampler')); await page.waitForTimeout(150);
    const s = await sheet(); await page.evaluate(() => document.getElementById('_pro-sheet').remove()); return s;
  };
  let o = await offerFor([]);
  check(o.buttons.includes('Full Studio — $12.99'), '0 owned: Full Studio $12.99');
  check(/Custom samples are part of the Sampler Engine\./.test(o.what), 'the brief’s own title, word for word', o.what);
  o = await offerFor(['sounds']);
  check(o.buttons.includes('Complete Your Studio — $10.99') && /You already own: Sounds Pack\./.test(o.text) && /Unlock everything for \$10\.99 more\./.test(o.text), '1 owned: Complete Your Studio $10.99, names what is owned', o.buttons.join(' | '));
  o = await offerFor(['sounds', 'studio']);
  check(o.buttons.includes('Complete Your Studio — $6.99'), '2 owned: $6.99');
  o = await offerFor(['sounds', 'studio', 'groove']);
  check(o.buttons.includes('Complete Your Studio — $3.99') && /You’ll get: .*every future pack\./.test(o.text), '3 owned: $3.99, and it lists what you get and every future pack', o.text.slice(0, 160));
  o = await offerFor(['sounds', 'studio', 'groove', 'theory', 'practice', 'synth']);
  check(o.buttons.includes('Complete Your Studio — $3.99') && o.buttons[0] === 'Unlock Sampler Engine — $5.99', '6 owned, only the $5.99 Sampler left: the $3.99 upgrade is cheaper, so it IS offered', o.buttons.join(' | '));
  o = await offerFor(['sampler', 'studio', 'groove', 'theory', 'practice', 'synth']);
  check(!o.buttons.some(b => /Complete Your Studio/.test(b)), 'owning all but Sounds ($1.99): the upgrade ($3.99) would cost more, so none is offered', o.buttons.join(' | '));
  o = await offerFor(['fullstudio']);
  check(o.buttons.includes('Restore Purchases') && !o.buttons.some(b => /Complete Your Studio|^Full Studio —/.test(b)) && /Owned/.test(o.text), 'owning Full Studio: no offer, and the module shows Owned', o.buttons.join(' | '));

  // ── 8. A purchase unlocks without a reload, closes the sheet, and says so
  await page.evaluate(() => { window.__bought.length = 0; modBillingChanged(); }); await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('[data-wave="organ"]').click()); await page.waitForTimeout(150);
  await page.evaluate(() => [...document.querySelectorAll('#_pro-sheet button')].find(b => /^Unlock Sounds Pack/.test(b.textContent)).click());
  await page.waitForTimeout(500);
  const bought = await page.evaluate(() => ({ sheet: !!document.getElementById('_pro-sheet'), owned: modBilling.owned(), organ: freeAllowsVoice('organ'),
    lockedOrgan: document.querySelector('[data-wave="organ"]').classList.contains('tier-locked'), marimba: freeAllowsVoice('marimba'),
    toast: (document.getElementById('_toast') || {}).textContent }));
  check(!bought.sheet && bought.owned.join() === 'sounds' && bought.organ && !bought.lockedOrgan && !bought.marimba, 'buying the Sounds Pack: organ opens, Marimba stays shut, sheet gone, no reload', JSON.stringify(bought));

  // ── 9. The store, from Settings: every pack, owned ones ticked, the offer on top
  const store = await page.evaluate(async () => {
    window.__bought.length = 0; window.__bought.push('sounds'); await modBillingChanged();
    document.getElementById('pro-upgrade').click(); await new Promise(x => setTimeout(x, 200));
    const s = document.getElementById('_pro-sheet');
    const cards = [...s.querySelectorAll('.pro-card')].map(c => ({ name: c.querySelector('.pro-cname').textContent, state: c.querySelector('.pro-cstate').textContent, bullets: c.querySelectorAll('li').length }));
    const r = { hd: s.querySelector('.pro-hd').textContent, cards, bundleFirst: s.querySelector('.pro-bundle') && s.querySelector('.pro-bundle').compareDocumentPosition(s.querySelector('.pro-card')) & Node.DOCUMENT_POSITION_FOLLOWING,
      bundle: s.querySelector('.pro-bname') && s.querySelector('.pro-bname').textContent, restore: [...s.querySelectorAll('button')].some(b => b.textContent === 'Restore Purchases') };
    s.remove(); return r;
  });
  check(store.cards.length === 7 && store.cards[0].name === 'Sounds Pack' && /Owned/.test(store.cards[0].state) && store.cards.slice(1).every(c => /^\$/.test(c.state)),
        'the store lists seven packs, the owned one ticked, the rest priced', JSON.stringify(store.cards.map(c => c.name + ':' + c.state)));
  check(store.bundle === 'Complete Your Studio' && !!store.bundleFirst, 'the bundle offer is at the top', store.bundle);
  check(store.cards.every(c => c.bullets >= 2) && store.restore, 'every card lists its contents, and Restore is there');
  check(await page.evaluate(() => document.getElementById('pro-state').textContent) === '1 of 7 packs', 'Settings says how many packs are owned');

  // ── 10. A setup made with owned packs opens without them: stand-ins play, the file keeps the originals, one banner names the packs
  await page.evaluate(async () => { window.__bought.length = 0; window.__bought.push('fullstudio'); await modBillingChanged(); });
  await page.evaluate(() => { document.getElementById('_pro-sheet') && document.getElementById('_pro-sheet').remove(); setWave('organ'); setArpWave('flute'); setMode('hijaz'); setVoicing('drop2'); window._sqPickDrumKit('909'); });
  const made = await page.evaluate(() => captureSetup('Everything', false));
  const kept = await page.evaluate(async st => {
    window.__bought.length = 0; await modBillingChanged();
    applySetup(st, { quiet: false }); await new Promise(x => setTimeout(x, 400));
    const live = { chords: wave, arp: arpWave, mode: mode, voicing: voicing, kit: window._sqDrumKit() };
    const again = captureSetup('Re-saved', false).settings;
    const banner = (document.getElementById('_toast') || {}).textContent || '';
    return { live, kept: { chords: again.wave, arp: again.arpWave, mode: again.mode, kit: again.sqMach, voicing: again.voicing }, banner };
  }, made);
  check(kept.live.chords === 'sawtooth' && kept.live.arp === 'sine' && kept.live.mode === 'major' && kept.live.voicing === 'close' && kept.live.kit === 'LIN',
        'free: the stand-ins play', JSON.stringify(kept.live));
  check(kept.kept.chords === 'organ' && kept.kept.arp === 'flute' && kept.kept.mode === 'hijaz' && kept.kept.kit === '909' && kept.kept.voicing === 'drop2',
        're-saving there writes the originals back', JSON.stringify(kept.kept));
  check(/from the Sounds Pack/.test(kept.banner) && /Theory Pack/.test(kept.banner) && /Groove Pack/.test(kept.banner) && /Sampler Engine/.test(kept.banner),
        'one banner names the packs it needs', kept.banner.slice(0, 220));

  // ── 11. iReal: one chart per import without the Practice Pack; the charts count against the slots; the pack lifts both
  const link = n => page.evaluate(n2 => {
    const mk = t => { const plain = 'T44C^7 |D-7 |E-7 |F^7 |G7 |A-7 |Bh7 |C^7 Z';
      return encodeURIComponent(t + '=Composer=Medium Swing=C=n=1r34LbKcu7' + _irealUnscramble(plain) + '=0=100=0'); };
    return 'irealb://' + Array.from({ length: n2 }, (_, i) => mk('Chart ' + i + '-' + Math.random().toString(36).slice(2, 6))).join('===') + '===My list';
  }, n);
  const imp = async (keys, n) => {
    await page.evaluate(k => { window.__bought.length = 0; k.forEach(x => window.__bought.push(x)); return modBillingChanged(); }, keys);
    await page.evaluate(() => { _irealSongs = []; localStorage.removeItem('modo-ireal-songs'); });
    const text = await link(n);
    return page.evaluate(t => ({ added: irealImportText(t), n: _irealList().length }), text);
  };
  let r = await imp([], 4);
  check(r.added === 1 && r.n === 1, 'free: a four-song playlist brings in one chart', JSON.stringify(r));
  r = await imp(['practice'], 4);
  check(r.added === 4 && r.n === 4, 'Practice Pack: the whole playlist', JSON.stringify(r));
  r = await imp(['studio'], 4);
  check(r.added === 1, 'Studio Pack alone: still one chart at a time', JSON.stringify(r));
  // slots: five songs fill them; free cannot add a chart past the room left
  await page.evaluate(async () => { window.__bought.length = 0; await modBillingChanged(); });
  const slots = await page.evaluate(async () => {
    _irealSongs = []; const songs5 = []; for (let i = 0; i < 3; i++) songs5.push({ id: 's' + i, name: 'S' + i });
    setlistData = songs5;
    const mk = t => encodeURIComponent(t + '=C=Medium Swing=C=n=1r34LbKcu7' + _irealUnscramble('T44C^7 |D-7 |E-7 |F^7 Z') + '=0=100=0');
    const out = [];
    for (let i = 0; i < 4; i++) { out.push(irealImportText('irealb://' + mk('Tune' + i) + '===L')); }
    const used = _slUsed(setlistData);
    return { out, charts: _irealList().length, used };
  });
  check(slots.out.join() === '1,1,0,0' && slots.charts === 2 && slots.used === 5, 'free: three songs leave room for two charts, then the slots are full', JSON.stringify(slots));

  check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
