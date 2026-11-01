/* A song recalls its sounds, or keeps yours (6.0r).

   Driven on the real window:
     - a partial snapshot (captureSounds) applied over a changed rig puts the sounds back and changes nothing else:
       every key outside SONG_SOUND_KEYS (tempo, key, voicing, arp motion ...) reads the same before and after;
     - a new song is saved as "recall" with its sounds; loading it puts the voice, arp voice and envelope back, leaves
       tempo-class and arp-motion settings alone, shows "Sounds changed to match this song" and Undo puts the old ones back;
     - set to "keep", loading changes no sound; the sounds it holds are not lost by that;
     - a song from before the switch (no fields) keeps your sounds, and its saved perfSettings wave is not applied;
     - a song saved with +Rhythm brings its kit back only when it recalls;
     - turning the switch on for a song with no sounds saves the current ones with it, and says so;
     - the Library row has a 44 pt switch, and a touch on it flips the song and stays off the song's own tap (no load);
     - free build: a recalled Pro voice plays as a stand-in and a re-save keeps the original.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/songsounds/probe.js
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
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  await page.evaluate(() => { setModTier('pro'); });
  const cdp = await ctx.newCDPSession(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = ms => page.waitForTimeout(ms);

  // ── 1. A partial snapshot changes the sounds and nothing else.
  const part = await ev(() => {
    arpMotion = 'up'; setWave('pad'); setArpWave('triangle');
    const base = captureSounds();
    setWave('sawtooth'); setArpWave('square'); document.getElementById('attack').value = 0.4; arpMotion = 'swell'; setVoicing('open'); onBpmInput(133); setMode('dorian');
    const a = _capSettings(); delete a.armed;
    _applySettings(base);
    const b = _capSettings(); delete b.armed;
    const S = new Set(SONG_SOUND_KEYS), non = [], snd = [];
    Object.keys(a).forEach(k => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) (S.has(k) ? snd : non).push(k); });
    return { non, snd, arpMotion, wave, partial: base.partial === true, hasChart: 'sections' in base || 'mode' in base || 'bpm' in base };
  });
  check(part.non.length === 0, 'a partial snapshot changes nothing outside the sound keys', part.non.join());
  check(part.snd.includes('wave') && part.wave === 'pad', 'and puts the sounds back', part.snd.join());
  check(part.arpMotion === 'swell', 'arp motion is left alone (it reset to off before 6.0r)');
  check(part.partial && !part.hasChart, 'it is marked partial and carries no chart, key or tempo');

  // ── 2. A new song recalls; Undo puts the old sounds back.
  const rec = await ev(async () => {
    localStorage.removeItem('modo-setlist');
    sections = [{ name: 'Verse', follow: 'repeat', plays: 1, slots: ['C', 'Am', 'F', 'G'].map(c => Object.assign({ beats: 0, eighths: 0, isRest: false }, slotFromChordSymbol(c))) }];
    curSection = 0; document.getElementById('chart-title').value = 'Test A'; curSetlistIdx = -1;
    setWave('pad'); setArpWave('triangle'); document.getElementById('attack').value = 0.33; arpMotion = 'up';
    saveToSetlist();
    const s0 = loadSLData()[0];
    setWave('sawtooth'); setArpWave('square'); document.getElementById('attack').value = 0.05; arpMotion = 'swell';
    loadSong(loadSLData()[0], 0);
    await new Promise(r => setTimeout(r, 300));
    const after = { wave, arpWave, atk: +document.getElementById('attack').value, arpMotion, toast: document.getElementById('_toast').textContent };
    const btn = document.querySelector('#_toast ._toast-btn'); if (btn) btn.click();
    await new Promise(r => setTimeout(r, 300));
    return { mode: s0.soundsMode, has: !!s0.sounds, after, undone: { wave, arpWave, atk: +document.getElementById('attack').value } };
  });
  check(rec.mode === 'recall' && rec.has, 'a new song is saved set to recall, with its sounds');
  check(rec.after.wave === 'pad' && rec.after.arpWave === 'triangle' && rec.after.atk === 0.33, 'loading it puts its voice, arp voice and envelope back', JSON.stringify(rec.after));
  check(rec.after.arpMotion === 'swell', 'and does not touch how the arp moves');
  check(/Sounds changed to match this song/.test(rec.after.toast), 'it says so', rec.after.toast);
  check(rec.undone.wave === 'sawtooth' && rec.undone.arpWave === 'square' && rec.undone.atk === 0.05, 'Undo puts the sounds back as they were', JSON.stringify(rec.undone));

  // ── 3. Keep: loading changes no sound, and the held sounds survive.
  const keep = await ev(async () => {
    setSongSoundsMode(0, false);
    const held = !!loadSLData()[0].sounds;
    setWave('sawtooth'); setArpWave('square'); document.getElementById('attack').value = 0.05;
    loadSong(loadSLData()[0], 0); await new Promise(r => setTimeout(r, 300));
    return { held, wave, arpWave, atk: +document.getElementById('attack').value };
  });
  check(keep.held && keep.wave === 'sawtooth' && keep.arpWave === 'square' && keep.atk === 0.05, 'a song that keeps your sounds changes none, and still holds its own', JSON.stringify(keep));

  // ── 4. A song from before the switch keeps your sounds; its saved wave is not applied.
  const legacy = await ev(async () => {
    const list = loadSLData(), old = JSON.parse(JSON.stringify(list[0]));
    delete old.sounds; delete old.soundsMode; old.title = 'Legacy'; old.id = 111; old.perfSettings.wave = 'organ';
    list.push(old); saveSLData(list); setWave('sawtooth');
    loadSong(old, 1); await new Promise(r => setTimeout(r, 200));
    return { wave };
  });
  check(legacy.wave === 'sawtooth', 'a song with no switch field keeps your sounds (its saved wave is not applied)', legacy.wave);

  // ── 5. +Rhythm: the kit comes back only when the song recalls.
  const kit = await ev(async () => {
    songSaveRhythm = true; window._sqSetMach('909');
    document.getElementById('chart-title').value = 'Test B'; curSetlistIdx = -1; saveToSetlist();
    const bi = loadSLData().length - 1;
    window._sqSetMach('808'); loadSong(loadSLData()[bi], bi); await new Promise(r => setTimeout(r, 300));
    const recalled = window._sqMach();
    setSongSoundsMode(bi, false); window._sqSetMach('808'); loadSong(loadSLData()[bi], bi); await new Promise(r => setTimeout(r, 300));
    return { recalled, kept: window._sqMach(), bi };
  });
  check(kit.recalled === '909', 'a song that recalls brings its kit', kit.recalled);
  check(kit.kept === '808', 'a song that keeps your sounds leaves the kit', kit.kept);

  // ── 6. The Library switch.
  await ev(() => { switchTab('songs'); setSongsMode('library'); renderSetlistPerform(); });
  await wait(500);
  const sw = await ev(() => [...document.querySelectorAll('#lib-slot-setlist .sl-item .sl-snd')].map(b => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), text: b.textContent, on: b.getAttribute('aria-checked') }; }));
  check(sw.length >= 3 && sw.every(b => b.h >= 44), 'every song row has a switch, 44 pt high', JSON.stringify(sw.map(b => b.h)));
  check(sw[1].text === 'Keeps my sounds' && sw[1].on === 'false', 'a song from before the switch says it keeps your sounds', sw[1].text);
  const pt = await ev(() => { const b = document.querySelectorAll('#lib-slot-setlist .sl-item .sl-snd')[1]; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2, idx: curSetlistIdx }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(400);
  const flip = await ev(() => { const L = loadSLData()[1]; return { mode: L.soundsMode, has: !!L.sounds, idx: curSetlistIdx, toast: document.getElementById('_toast').textContent }; });
  check(flip.mode === 'recall' && flip.has, 'a touch on the switch turns it on and saves the current sounds with the song');
  check(flip.idx === pt.idx, 'and does not load the song', flip.idx + ' was ' + pt.idx);
  check(/recall the sounds you have now/.test(flip.toast), 'and says it saved the ones you have now', flip.toast);

  // ── 7. Free build: a Pro voice plays as a stand-in; a re-save keeps the original.
  const free = await ev(async () => {
    setModTier('free');
    const pw = ['piano', 'organ', 'rhodes', 'supersaw', 'pad', 'upright', 'violin', 'flute'].find(w => { try { return !freeAllowsVoice(w); } catch (e) { return false; } });
    setModTier('pro'); setWave(pw); document.getElementById('chart-title').value = 'Test P'; curSetlistIdx = -1; saveToSetlist();
    const pi = loadSLData().length - 1;
    setModTier('free'); setWave('sawtooth'); loadSong(loadSLData()[pi], pi); await new Promise(r => setTimeout(r, 400));
    const playing = wave; saveToSetlist();
    const kept = loadSLData()[pi].sounds.wave; setModTier('pro');
    return { pw, playing, kept };
  });
  check(free.pw && free.playing !== free.pw, 'free build: the Pro voice plays as a stand-in', free.pw + ' -> ' + free.playing);
  check(free.kept === free.pw, 'a re-save keeps the original', free.kept);

  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 200));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
