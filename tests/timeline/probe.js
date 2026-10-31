/* Perform > Timeline (5.7): the song as lines of words with each chord as wide as it lasts.

   Driven on the real window, on the three real sheets in tests/chords/sheets (two of
   them OCR'd off a photo, one text out of a PDF) and on a hand-written one with words
   cut at known columns, so the numbers mean something:
     - a switch (Tiles | Timeline), kept in modo-perform-view, and the tiles come back;
     - one column per chord, in slot order inside its section block, so the playing
       highlight (which indexes by section and chord) lands on the right one;
     - a column's width is proportional to the chord's beats, and a card is a whole number
       of bars wide; no card runs off the right edge at any phone width;
     - the line breaks are where slot.ln says (and every four bars for a chord-only song);
     - words show under their chord and the full words are in the button's accessible name;
     - the sounding chord is lit, the Loop picker outlines the chords inside the loop, and
       a real touch on a column cues that chord, exactly as a tile does;
     - the tiles are what they were (counts equal, nothing from the timeline left behind).

   Run (repo served; Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/timeline/probe.js
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
const SHEETS = fs.readdirSync(path.join(__dirname, '../chords/sheets')).map(f => [f, fs.readFileSync(path.join(__dirname, '../chords/sheets', f), 'utf8')]);
SHEETS.push(['written', '[Verse]\nC       G       Am      F\nAmazing grace how sweet the sound\nC       G\nThat saved a wretch like me\n[Chorus]\nAm F C G\n']);
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
  await page.evaluate(() => { setModTier('pro'); setViewMode('advanced'); switchTab('songs'); setSongsMode('perform'); }); await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };

  for (const [name, text] of SHEETS) {
    // Load the sheet as the song, as Make the song does.
    const made = await page.evaluate((text) => {
      const r = songFromChordSheet(parseChordSheet(text), { len: 'lines', lineBars: 2 });
      sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
      root = r.song.root; mode = r.song.mode;
      songsPerformViewSet('tiles');
      const tiles = document.querySelectorAll('#songs-full-chart .songs-chord-btn').length;
      songsPerformViewSet('timeline');
      return { tiles, slots: sections.reduce((a, s) => a + s.slots.length, 0), lyr: sections.reduce((a, s) => a + s.slots.filter(x => x.lyr).length, 0), ln: sections.reduce((a, s) => a + s.slots.filter(x => x.ln).length, 0) };
    }, text);
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => {
      const chart = document.getElementById('songs-full-chart'); const cw = chart.getBoundingClientRect();
      const cols = [...chart.querySelectorAll('.tl-col')];
      const blocks = [...chart.querySelectorAll('.songs-section-block')];
      let order = true, prop = 0, worst = 0, over = 0, minW = 1e9, barsOK = true, cards = 0;
      blocks.forEach((b, si) => {
        const cs = [...b.querySelectorAll('.tl-col')];
        cs.forEach((c, i) => { if (+c.dataset.si !== si || +c.dataset.ci !== i) order = false; });
        b.querySelectorAll('.tl-card').forEach(card => {
          cards++;
          const row = card.querySelector('.tl-row'); const rr = row.getBoundingClientRect();
          if (rr.right > cw.right + 1) over++;
          const cc = [...row.querySelectorAll('.tl-col')];
          const total = cc.reduce((a, c) => a + parseFloat(c.style.flexGrow), 0);
          cc.forEach(c => { const w = c.getBoundingClientRect().width; minW = Math.min(minW, w); const want = (rr.width - 2 * (cc.length - 1)) * parseFloat(c.style.flexGrow) / total; worst = Math.max(worst, Math.abs(w - want)); prop++; });
          const bars = parseInt(card.querySelector('.tl-meta').textContent, 10);
          if (![1, 2, 4, 8].includes(bars)) barsOK = false;
        });
      });
      const words = cols.filter(c => c.querySelector('.tl-words').textContent.trim()).length;
      const named = cols.filter(c => /words: /.test(c.getAttribute('aria-label') || '')).length;
      return { cols: cols.length, order, worst: Math.round(worst * 10) / 10, over, minW: Math.round(minW), barsOK, cards, words, named, tilesLeft: chart.querySelectorAll('.songs-chord-btn').length, docW: document.documentElement.scrollWidth };
    });
    check(g.cols === made.slots && g.cols === made.tiles, name + ': one column per chord, as many as the tiles', JSON.stringify([g.cols, made.slots, made.tiles]));
    check(g.order, name + ': columns are in slot order inside each section block');
    check(g.worst <= 1.5, name + ': each width is proportional to its beats (worst error ' + g.worst + ' px)');
    check(g.over === 0 && g.docW <= 430 && g.barsOK, name + ': no card runs off the edge, and each is 1, 2, 4 or 8 bars', JSON.stringify([g.over, g.docW, g.barsOK]));
    check(g.words === made.lyr && g.named === g.words, name + ': words show under their chord and are in its name (' + g.words + ' of ' + g.cols + ' chords)', JSON.stringify([g.words, made.lyr, g.named]));
    if (made.ln) check(g.cards >= made.ln, name + ': a new card at each line start (' + made.ln + ' starts, ' + g.cards + ' cards)', g.cards);
    console.log('     ' + name + ': ' + g.cols + ' chords on ' + g.cards + ' cards, narrowest column ' + g.minW + ' pt');
  }

  // ── The written sheet in detail: Amazing grace, six chords on two lines.
  await page.evaluate((text) => {
    const r = songFromChordSheet(parseChordSheet(text), { len: 'lines', lineBars: 2 });
    sections = r.song.sections.map(s => ({ name: s.name, follow: 'repeat', plays: 1, slots: s.slots.map(x => ({ beats: 0, eighths: 0, isRest: false, ...x })) }));
    songsPerformViewSet('timeline');
  }, SHEETS[SHEETS.length - 1][1]);
  const w = await page.evaluate(() => [...document.querySelectorAll('#songs-full-chart .songs-section-block')][0] && [...document.querySelectorAll('#songs-full-chart .songs-section-block')][0].querySelectorAll('.tl-card').length);
  check(w === 2, 'the Verse is two cards, one per line of words', w);
  const wordsTxt = await page.evaluate(() => [...document.querySelectorAll('#songs-full-chart .songs-section-block')][0].querySelector('.tl-card .tl-col:nth-child(2) .tl-words').textContent);
  check(/\S/.test(wordsTxt), 'the second chord has words under it', JSON.stringify(wordsTxt));

  // ── The switch and its memory.
  const sw = await page.evaluate(() => ({ stored: localStorage.getItem('modo-perform-view'), tl: document.getElementById('pv-timeline').classList.contains('active'), tiles: document.getElementById('pv-tiles').classList.contains('active') }));
  check(sw.stored === 'timeline' && sw.tl && !sw.tiles, 'the switch shows Timeline and keeps it', JSON.stringify(sw));
  await tap('#pv-tiles');
  const back = await page.evaluate(() => ({ tl: document.querySelectorAll('#songs-full-chart .tl-col').length, tiles: document.querySelectorAll('#songs-full-chart .songs-chord-btn').length, stored: localStorage.getItem('modo-perform-view') }));
  check(back.tl === 0 && back.tiles > 0 && back.stored === 'tiles', 'a touch on Tiles brings the tiles back and leaves no timeline behind', JSON.stringify(back));
  await tap('#pv-timeline');

  // ── Playing, the Loop picker, a tap.
  await page.evaluate(() => { songLoopActive = true; _highlightLoopSlot(0, 2); });
  const lit = await page.evaluate(() => [...document.querySelectorAll('#songs-full-chart .tl-col.active')].map(c => c.dataset.si + ':' + c.dataset.ci));
  check(lit.length === 1 && lit[0] === '0:2', 'the sounding chord is lit', JSON.stringify(lit));
  await page.evaluate(() => { songLoopActive = false; applySongPlayingHighlights(false); pracLoopSet('arm'); pracLoopTap(0, 1); pracLoopTap(0, 3); });
  const looped = await page.evaluate(() => [...document.querySelectorAll('#songs-full-chart .tl-col.prac-in')].map(c => c.dataset.ci).join());
  check(looped === '1,2,3', 'the Loop picker outlines the chords inside the loop', looped);
  await page.evaluate(() => { pracLoopSet('off'); });
  await tap('#songs-full-chart .tl-col[data-si="0"][data-ci="1"]');
  const cued = await page.evaluate(() => [songCurrentSection, songCurrentSlot]);
  check(cued[0] === 0 && cued[1] === 1, 'a real touch on a column cues that chord', JSON.stringify(cued));

  // ── Phone widths.
  for (const W of [360, 390, 430]) {
    await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const c = document.getElementById('songs-full-chart').getBoundingClientRect(); return { over: [...document.querySelectorAll('#songs-full-chart .tl-row')].filter(x => x.getBoundingClientRect().right > c.right + 1).length, docW: document.documentElement.scrollWidth, min: Math.round(Math.min(...[...document.querySelectorAll('#songs-full-chart .tl-col')].map(x => x.getBoundingClientRect().width))) }; });
    check(r.over === 0 && r.docW <= W, W + ' pt: nothing runs off the edge (narrowest column ' + r.min + ' pt)', JSON.stringify(r));
  }

  check(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
