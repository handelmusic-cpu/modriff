/* Stage and the playhead (5.8).

   Driven on the real window with real touch (CDP), on the Sun sheet (82 chords on 20
   lines), because scrolling needs a long song:
     - the way in is gated: without the Practice Pack the Stage button and the Timeline
       switch say Add-on and open the pack sheet instead, and a stored Timeline choice is
       not honoured; with it, Stage opens over everything, including the bars;
     - the footer is five 56 pt buttons; A+ and A- change the type and the choice is kept;
       the key buttons transpose the song and the chord names on the stage follow;
     - Play on the stage starts the song and its icon becomes a stop; a second touch stops;
     - when a chord starts, a playhead crosses its column in the chord's length (one CSS
       transition, nothing between chords), and the line holding it is scrolled to a
       third of the way down; the progress line grows with the line;
     - Sect > moves to the next section; Close, and the Escape key, put the page back with
       the stage emptied;
     - Perform's own timeline gets the playhead too.

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/stage/probe.js
   Env: URL, CHROMIUM, PLAYWRIGHT. */
'use strict';
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const SUN = fs.readFileSync(path.join(__dirname, '../chords/sheets/sun.ocr.txt'), 'utf8');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    channel: process.env.CHROMIUM ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('#unlock-choices button'); if (b) b.click(); }); await page.waitForTimeout(900);
  const load = () => page.evaluate((text) => {
    const r = songFromChordSheet(parseChordSheet(text), { len: 'lines', lineBars: 2 });
    sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
    root = r.song.root; mode = r.song.mode; document.getElementById('chart-title').value = 'Sun test';
  }, SUN);
  await page.evaluate(() => { setModTier('free'); setViewMode('advanced'); switchTab('songs'); setSongsMode('perform'); }); await load();
  await page.evaluate(() => { renderSongsPerformView(); }); await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const open = () => page.evaluate(() => document.getElementById('stage').classList.contains('open'));

  // ── 1. The gate.
  const locked = await page.evaluate(() => ({ stage: document.getElementById('pv-stage').classList.contains('pv-locked'), tl: document.getElementById('pv-timeline').classList.contains('pv-locked') }));
  check(locked.stage && locked.tl, 'free: both buttons say Add-on', JSON.stringify(locked));
  await tap('#pv-stage');
  check(!(await open()), 'free: Stage does not open');
  const toastTxt = await page.evaluate(() => { const t = document.getElementById('_toast'); return t ? t.textContent : ''; });
  check(/Stage/.test(toastTxt) && /Practice & Perform Pack/.test(toastTxt) && /See pack/.test(toastTxt), 'free: it says Stage is the Practice & Perform Pack\'s and offers the pack', JSON.stringify(toastTxt));
  await tap('#pv-timeline');
  const v1 = await page.evaluate(() => ({ view: songsPerformViewGet(), cols: document.querySelectorAll('#songs-full-chart .tl-col').length, sheet: !!document.querySelector('.modal-overlay.visible') }));
  check(v1.view === 'tiles' && v1.cols === 0, 'free: Timeline does not switch', JSON.stringify(v1));
  await page.evaluate(() => { localStorage.setItem('modo-perform-view', 'timeline'); _songsPerformView = null; renderSongsPerformView(); });
  check(await page.evaluate(() => document.querySelectorAll('#songs-full-chart .tl-col').length) === 0, 'free: a stored Timeline choice is not honoured');
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay.visible').forEach(m => m.classList.remove('visible')); const e = document.getElementById('_pro-sheet'); if (e) e.remove(); const t = document.getElementById('_toast'); if (t) { t.style.opacity = '0'; t.style.pointerEvents = 'none'; } });

  // ── 2. With the pack, Stage opens over everything.
  await page.evaluate(() => { setModTier('pro'); _songsPerformView = null; renderSongsPerformView(); }); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.getElementById('pv-stage').classList.contains('pv-locked')), 'pro: no Add-on tag');
  await tap('#pv-stage');
  check(await open(), 'pro: Stage opens');
  const over = await page.evaluate(() => {
    const st = document.getElementById('stage');
    const at = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && st.contains(e)) || ((window.__hit = (e && (e.id || e.className))) && false); };
    return { tabs: at(40, 910), transport: at(215, 840), top: at(30, 30), cols: st.querySelectorAll('.tl-col').length, hit: window.__hit, title: document.getElementById('stage-title').textContent, key: document.getElementById('stage-key').textContent };
  });
  check(over.tabs && over.transport && over.top, 'it covers the tab bar and the transport', JSON.stringify(over));
  check(over.cols === 82 && over.title.length > 0, 'the whole song is on it (82 chords) under its title', JSON.stringify([over.cols, over.title]));

  // ── 3. The footer, the type, the key.
  const foot = await page.evaluate(() => [...document.querySelectorAll('#stage .stage-foot button')].map(b => Math.round(b.getBoundingClientRect().height)));
  check(foot.length === 5 && foot.every(h => h >= 56), 'five footer buttons, 56 pt or more', JSON.stringify(foot));
  const x = await page.evaluate(() => { const b = document.querySelector('#stage .stage-x').getBoundingClientRect(); const k = [...document.querySelectorAll('#stage .stage-tr button')].map(e => Math.round(e.getBoundingClientRect().height)); return { x: [Math.round(b.width), Math.round(b.height)], k }; });
  check(x.x[0] >= 44 && x.x[1] >= 44 && x.k.every(h => h >= 44), 'Close and the key buttons are 44 pt', JSON.stringify(x));
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#stage .tl-name')).fontSize));
  await tap('#stage .stage-foot button:nth-child(2)');
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#stage .tl-name')).fontSize));
  await tap('#stage .stage-foot button:nth-child(1)'); await tap('#stage .stage-foot button:nth-child(1)');
  const fs2 = await page.evaluate(() => [parseFloat(getComputedStyle(document.querySelector('#stage .tl-name')).fontSize), localStorage.getItem('modo-stage-fs')]);
  check(fs1 > fs0 && fs2[0] < fs0, 'A+ grows the type and A- shrinks it', [fs0, fs1, fs2[0]].join(' -> '));
  check(fs2[1] === '18', 'and the size is kept (modo-stage-fs)', fs2[1]);
  const name0 = await page.evaluate(() => [document.querySelector('#stage .tl-name').textContent, root, document.getElementById('stage-key').textContent]);
  await tap('#stage .stage-tr button:last-child');
  const name1 = await page.evaluate(() => [document.querySelector('#stage .tl-name').textContent, root, document.getElementById('stage-key').textContent]);
  check(name1[1] === (name0[1] + 1) % 12 && name1[0] !== name0[0] && name1[2] !== name0[2], 'the key button transposes the song, and the stage follows', JSON.stringify([name0, name1]));
  await tap('#stage .stage-tr button:first-child');

  // ── 4. Play, by finger, and the playhead that comes with a real song.
  if (0) console.log('   at', JSON.stringify(await page.evaluate(() => { const r = document.getElementById('stage-play').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), e && (e.id || e.className || e.tagName)]; })));
  await tap('#stage-play');
  // The song starts on the next bar line, so it is not live the instant it is touched.
  for (let i = 0; i < 40 && !(await page.evaluate(() => songLoopActive)); i++) await page.waitForTimeout(150);
  if (0) console.log('   dbg', JSON.stringify(await page.evaluate(() => ({ gsm: globalSongMode, any: isAnythingPlaying(), wait: songWaitingForBar, toast: (document.getElementById('_toast')||{}).textContent, cur: [songCurrentSection, songCurrentSlot], held: _songHeldAt }))));
  const playing = await page.evaluate(() => ({ live: songLoopActive, stop: document.getElementById('stage-play').classList.contains('stop') }));
  check(playing.live && playing.stop, 'Play on the stage starts the song and the icon becomes a stop', JSON.stringify(playing));
  await tap('#stage-play'); await page.waitForTimeout(500);
  const stopped = await page.evaluate(() => ({ live: songLoopActive, stop: document.getElementById('stage-play').classList.contains('stop') }));
  check(!stopped.live && !stopped.stop, 'and a second touch stops it', JSON.stringify(stopped));
  await page.evaluate(() => { stopEverything(); }); await page.waitForTimeout(300);
  // ── 5. The playhead, the scroll and the progress line, driven by hand to the last chord.
  await page.evaluate(() => { songLoopActive = true; _highlightLoopSlot(0, 0); }); await page.waitForTimeout(150);
  const ph0 = await page.evaluate(() => { const p = document.querySelector('#stage-chart .tl-ph'); return p && getComputedStyle(p).transform; });
  await page.waitForTimeout(500);
  const ph1 = await page.evaluate(() => { const p = document.querySelector('#stage-chart .tl-ph'); return p && getComputedStyle(p).transform; });
  check(ph0 && ph1 && ph0 !== ph1, 'a playhead is on the sounding chord and it moves', ph0 + ' -> ' + ph1);
  check((await page.evaluate(() => document.querySelectorAll('.tl-ph').length)) <= 2, 'one per chart, not one per chord');
  const last = await page.evaluate(() => { const si = sections.length - 1; return [si, sections[si].slots.length - 1]; });
  await page.evaluate(([si, ci]) => { _highlightLoopSlot(si, ci); }, last); await page.waitForTimeout(1400);
  const sc = await page.evaluate(() => { const s = document.getElementById('stage-scroll'), a = document.querySelector('#stage-chart .tl-col.active'); const c = a.closest('.tl-card').getBoundingClientRect(), r = s.getBoundingClientRect(); return { fromTop: Math.round(c.top - r.top), third: Math.round(s.clientHeight / 3), scrolled: Math.round(s.scrollTop), max: Math.round(s.scrollHeight - s.clientHeight), prog: document.getElementById('stage-prog-i').style.width }; });
  check(Math.abs(sc.fromTop - sc.third) < 60 || sc.scrolled >= sc.max - 4, 'the playing line is a third of the way down (or the end is reached)', JSON.stringify(sc));
  check(parseInt(sc.prog, 10) >= 90, 'and the progress line is nearly full on the last line', sc.prog);
  await page.evaluate(() => { songLoopActive = false; applySongPlayingHighlights(false); songPlayheadClear(); stageSync(); });
  await page.evaluate(() => { stopEverything(); });

  const sec0 = await page.evaluate(() => songLoopSection);
  await tap('#stage .stage-foot button:nth-child(5)');
  const sec1 = await page.evaluate(() => songLoopSection);
  check(sec1 !== sec0, 'Sect > moves to the next section', sec0 + ' -> ' + sec1);
  await tap('#stage .stage-x');
  const closed = await page.evaluate(() => ({ open: document.getElementById('stage').classList.contains('open'), kids: document.getElementById('stage-chart').childElementCount, body: document.body.classList.contains('stage-open') }));
  check(!closed.open && closed.kids === 0 && !closed.body, 'Close puts the page back and empties the stage', JSON.stringify(closed));
  await tap('#pv-stage'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(!(await open()), 'the Escape key closes it too');

  // ── 6. Perform's own timeline gets the playhead.
  await page.evaluate(() => { songsPerformViewSet('timeline'); songLoopActive = true; _highlightLoopSlot(0, 1); }); await page.waitForTimeout(200);
  check((await page.evaluate(() => document.querySelectorAll('#songs-full-chart .tl-ph').length)) === 1, 'the Perform timeline has a playhead too');
  await page.evaluate(() => { songLoopActive = false; songPlayheadClear(); });

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
