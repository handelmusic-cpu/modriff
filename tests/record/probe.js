/* The More tab, the record ring, the Record widget, Always bounce stems, and the grouped style lists (6.9.9.9.9.9.9).

   What it proves, by driving the real page:
     - the fifth tab says More (it said Settings, and people looked for Bounce under a preferences name);
     - Live's standard layout has the Record widget and no Voices widget;
     - the ring in the transport sits inside the screen and clear of Play and the rate chip at 375, 390 and 440 wide;
     - tapping the ring starts a take, the clock counts, the ring and the widget go solid, tapping again stops it and
       the clock goes back to 0:00;
     - Settings > Recording > Always bounce stems puts Stems on for the next take, and the setting is kept;
     - a style row's Pattern list opens in groups (Drums by family, Bass by Genre and Shape), and a pick still loads it.

   Run (repo served; Chrome available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/record/probe.js
   Env: URL, CHROMIUM (default: the installed Chrome), PLAYWRIGHT (path to playwright-core). */
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
  const boot = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(1500);
    await page.click('.unlock-btn >> text=Random'); await page.waitForTimeout(2000);
    await page.evaluate(() => { setModTier('pro'); setViewMode('basic'); switchTab('perform');
      window.__files = []; window._deliverFiles = async function (list) { (list || []).forEach(f => window.__files.push(f.name)); }; });
    await page.waitForTimeout(800);
    return page;
  };

  // A take ends some time after Stop (the last block flushes, the files are written): wait for it, not for a guess.
  const idleWait = async (page) => { await page.waitForFunction(() => !_isRecording, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(300); };

  // ── Layout: the ring fits at every width
  for (const w of [375, 390, 440]) {
    const page = await boot(w);
    const r = await page.evaluate(() => {
      const rc = id => { const e = document.querySelector(id); const q = e && e.getBoundingClientRect(); return q && q.width ? { l: q.left, r: q.right, t: q.top, b: q.bottom } : null; };
      return { ring: rc('#ft-rec-ring'), play: rc('#ft-playstop-btn'), rate: rc('.ft-rate'), w: innerWidth, sw: document.documentElement.scrollWidth };
    });
    const clear = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t || b.b <= a.t;
    check(r.ring && r.ring.l >= 0 && r.ring.r <= r.w && r.sw <= r.w, `${w}: the ring is on the screen and the page does not scroll sideways`, JSON.stringify(r.ring) + ' sw ' + r.sw);
    check(r.ring && r.play && r.rate && clear(r.ring, r.play) && clear(r.ring, r.rate), `${w}: the ring is clear of Play and the rate chip`);
    check(r.ring && (r.ring.r - r.ring.l) >= 30, `${w}: the ring is a thumb's size`, r.ring && (r.ring.r - r.ring.l));
    // A loaded song puts the song's strip under the transport (<= 430) or beside it: the ring must still be clear.
    await page.evaluate(() => { document.getElementById('ft-song-btn').style.display = ''; document.getElementById('ft-sect-prev').style.display = ''; document.getElementById('ft-sect-next').style.display = ''; window._ftRateClamp && window._ftRateClamp(); });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => {
      const rc = id => { const e = document.querySelector(id); const q = e && e.getBoundingClientRect(); return q && q.width ? { l: q.left, r: q.right, t: q.top, b: q.bottom } : null; };
      const keyMode = document.querySelector('#ft-key-mode-short'), kp = keyMode && keyMode.parentElement;
      return { ring: rc('#ft-rec-ring'), rate: rc('.ft-rate'), grp: rc('.ft-song-grp'), w: innerWidth, sw: document.documentElement.scrollWidth,
               clipped: !!(keyMode && kp && keyMode.getBoundingClientRect().right > kp.getBoundingClientRect().right + 1) };
    });
    check(s.ring && s.rate && s.grp && clear(s.ring, s.rate) && clear(s.ring, s.grp) && s.grp.r <= s.w + 0.5 && s.sw <= s.w, `${w}: with a song loaded the ring is clear of the chip and the song strip, and nothing runs off the screen`, JSON.stringify(s));
    check(!s.clipped, `${w}: with a song loaded the key's mode name is not cut off`);
    await page.context().close();
  }

  // ── The tab, the layout, the take
  const page = await boot(430);
  const tab = await page.evaluate(() => ({ lbl: document.querySelector('#tab-more .tm-lbl').textContent, aria: document.getElementById('tab-more').getAttribute('aria-label') }));
  check(tab.lbl === 'More' && /settings/i.test(tab.aria), 'the fifth tab says More and still names what is in it', JSON.stringify(tab));
  const lay = await page.evaluate(() => ({ slots: LV.slots.slice(), rec: !!document.querySelector('#lv-slots #rec-w'), voices: !!document.querySelector('#lv-slots #voices-grid-live'), std: LV_STD.slice() }));
  check(lay.slots.includes('rec') && !lay.slots.includes('voices') && lay.rec && !lay.voices, 'Live has the Record widget and no Voices widget', JSON.stringify(lay.slots));
  check(lay.std.indexOf('rec') === lay.std.length - 2 && lay.std[lay.std.length - 1] === 'endings', 'the Record widget sits above Endings, which stay last', lay.std.join(','));

  // Random loads a band; it has to be playing, or a take has nothing to capture and ends as "Nothing captured".
  await page.evaluate(() => { ftPlayStop(); }); await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('rec-w').scrollIntoView({ block: 'center' }); });
  const idle = await page.evaluate(() => ({ ring: document.getElementById('ft-rec-ring').classList.contains('on'), w: document.getElementById('rec-w').classList.contains('on'), clock: document.querySelector('#rec-w [data-recclock]').textContent, stems: document.querySelector('#rec-w [data-stemtoggle]').textContent }));
  check(!idle.ring && !idle.w && idle.clock === '0:00' && /Stems: OFF/.test(idle.stems), 'idle: a ring, not solid; the clock reads 0:00; Stems is off', JSON.stringify(idle));
  await page.evaluate(() => { document.getElementById('ft-rec-ring').click(); }); await page.waitForTimeout(2300);
  const run = await page.evaluate(() => ({ rec: _isRecording, ring: document.getElementById('ft-rec-ring').classList.contains('on'), w: document.getElementById('rec-w').classList.contains('on'),
    wring: document.querySelector('#rec-w [data-recring]').classList.contains('on'), clock: document.querySelector('#rec-w [data-recclock]').textContent, pressed: document.getElementById('ft-rec-ring').getAttribute('aria-pressed'),
    tile: document.getElementById('ft-bounce-btn').textContent.trim() }));
  check(run.rec && run.ring && run.w && run.wring && run.pressed === 'true', 'recording: the ring and the widget are solid', JSON.stringify(run));
  check(/^0:0[1-3]$/.test(run.clock), 'recording: the clock counts', run.clock);
  check(/Stop/.test(run.tile), "recording: the More sheet's Bounce tile says Stop (same recorder)", run.tile);
  await page.evaluate(() => { document.querySelector('#rec-w [data-recring]').click(); }); await idleWait(page);
  const done = await page.evaluate(() => ({ rec: _isRecording, ring: document.getElementById('ft-rec-ring').classList.contains('on'), clock: document.querySelector('#rec-w [data-recclock]').textContent, files: window.__files.slice() }));
  check(!done.rec && !done.ring && done.clock === '0:00', 'stopped (from the widget): back to a ring and 0:00', JSON.stringify(done));
  check(done.files.some(n => /\.wav$/.test(n)) && done.files.some(n => /\.mid$/.test(n)), 'the take wrote a .wav and a .mid', done.files.join(', '));
  check(!done.files.some(n => /stem/i.test(n)), 'with Always off the take is the mix only', done.files.join(', '));

  // ── Always bounce stems
  await page.evaluate(() => { toggleAlwaysStems(); });
  const al = await page.evaluate(() => ({ always: alwaysStems, stems: exportStems, stored: modStore.getItem('modo-stems-always'), btn: document.getElementById('always-stems-btn').textContent, prev: document.getElementById('ss-recording-preview').textContent, chip: document.querySelector('#rec-w [data-stemtoggle]').textContent }));
  check(al.always && al.stems && al.stored === '1' && /ON/.test(al.btn) && /ON/.test(al.chip), 'Always bounce stems on: Stems comes on, the setting is kept, the buttons say so', JSON.stringify(al));
  await page.evaluate(() => { toggleStemExport(); });
  check(await page.evaluate(() => exportStems), 'with Always on, switching Stems off before a take is refused (it would come back on as the take starts)');
  await page.evaluate(() => { window.__files = []; document.getElementById('ft-rec-ring').click(); }); await page.waitForTimeout(2200);
  const withStems = await page.evaluate(() => ({ rec: _isRecording, taps: _stemTaps.length, stems: exportStems }));
  await page.evaluate(() => { document.getElementById('ft-rec-ring').click(); }); await idleWait(page);
  const files = await page.evaluate(() => window.__files.slice());
  check(withStems.rec && withStems.taps > 0, 'the next take started with stem taps running', JSON.stringify(withStems));
  check(files.filter(n => /\.wav$/.test(n)).length > 1, 'the take wrote the mix and at least one stem', files.join(', '));
  await page.evaluate(() => { toggleAlwaysStems(); toggleStemExport(); });
  const off = await page.evaluate(() => ({ always: alwaysStems, stems: exportStems, stored: modStore.getItem('modo-stems-always') }));
  check(!off.always && !off.stems && off.stored === '0', 'Always off again: Stems can be switched off, and the setting is kept off', JSON.stringify(off));

  // ── Grouped style lists
  await page.evaluate(() => { switchTab('perform'); });
  const group = async (part) => {
    await page.evaluate(p => { const b = document.querySelector('#st-widget .st-row[data-part="' + p + '"] .st-name'); b.scrollIntoView({ block: 'center' }); b.click(); }, part);
    await page.waitForTimeout(500);
    return page.evaluate(p => { const pop = document.getElementById('pp-live-' + p + '-style-pop'); return pop && pop.classList.contains('open') ? { sects: [...pop.querySelectorAll('.cp-sect')].map(e => e.textContent), items: pop.querySelectorAll('.cp-item').length } : null; }, part);
  };
  const dr = await group('drums');
  check(dr && dr.sects.includes('Rock & Pop') && dr.sects.includes('Jazz') && dr.sects.length >= 4, 'Drums: the list opens in groups', dr && dr.sects.join(' | '));
  check(dr && dr.items >= 15, 'Drums: every groove is still in it', dr && dr.items);
  await page.evaluate(() => { [...document.querySelectorAll('#pp-live-drums-style-pop .cp-item')].find(b => /Bossa Nova/.test(b.textContent)).click(); });
  // A groove picked while the beat runs lands at the next bar.
  await page.waitForFunction(() => starterCurrent('drums') === 'Bossa Nova', null, { timeout: 8000 }).catch(() => {});
  check(await page.evaluate(() => starterCurrent('drums') === 'Bossa Nova' && drumsEnabled), 'Drums: a pick loads the groove and switches the part on');
  const ba = await group('bass');
  check(ba && ba.sects.includes('Genre') && ba.sects.includes('Shape'), 'Bass: Genre and Shape', ba && ba.sects.join(' | '));
  await page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); ppClose(); });
  const ax = await group('aux');
  check(ax && ax.sects.length >= 3 && ax.items >= 10, 'Aux: grouped by the kit each line is written for', ax && ax.sects.slice(0, 5).join(' | ') + ' (' + ax.items + ' items)');
  await page.evaluate(() => { ppClose(); });
  const ch = await group('chord');
  check(ch && ch.sects.includes('Plain') && ch.sects.includes('Rhythmic'), 'Chords: Plain and Rhythmic', ch && ch.sects.join(' | '));
  await page.evaluate(() => { ppClose(); });

  check(page.__errs.length === 0, 'no page errors', page.__errs.slice(0, 2).join(' / '));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
