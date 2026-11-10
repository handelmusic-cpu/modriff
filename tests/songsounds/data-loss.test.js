/* Song persistence regressions: setlist replacement must detach the open editor;
   failed writes must leave edits dirty and retryable; Keep your sounds must
   restore Aux notes/on-off without replacing the player's kit or lane controls.
   Run: CHROMIUM=/path/to/chromium node tests/songsounds/data-loss.test.js
   URL optionally points at a served dist/index.html to check the shipped page. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')); }
const root = path.resolve(__dirname, '../..');
const check = (value, label) => { assert.ok(value, label); console.log('PASS ' + label); };

(async () => {
  let server, browser;
  try {
    let url = process.env.URL;
    if (!url) {
      server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
        fs.readFile(file, (err, data) => {
          res.writeHead(err ? 404 : 200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
          res.end(err ? '' : data);
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      url = 'http://127.0.0.1:' + server.address().port + '/index.html';
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM || undefined,
      channel: process.env.CHROMIUM ? undefined : 'chrome',
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => typeof window._sqCaptureState === 'function');
    await page.evaluate(() => {
      document.querySelector('#unlock-choices button')?.click();
      setModTier('pro');
      window.testSong = (id, title, chord = 'C') => ({ id, title, root: 0, mode: 'major',
        sections: [{ name: 'Verse', follow: 'repeat', plays: 1, slots: [slotFromChordSymbol(chord)] }] });
      window.failWrites = () => {
        const setter = modStore.setItem;
        modStore.setItem = function(k, v) {
          if (k === 'prism-sl') throw new DOMException('Storage full', 'QuotaExceededError');
          return setter.call(this, k, v);
        };
        window.restoreWrites = () => { modStore.setItem = setter; };
      };
    });
    const importList = async songs => {
      await page.locator('#sl-import').setInputFiles({ name: 'setlist.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(songs)) });
    };

    const imported = await page.evaluate(() => {
      const a = testSong(201, 'Original A'); saveSLData([a]); setlistData = loadSLData(); loadSong(a, 0);
      return testSong(202, 'Imported B', 'G');
    });
    await importList([imported]);
    await page.waitForFunction(() => loadSLData()[0]?.id === 202);
    const afterImport = await page.evaluate(() => {
      const detached = curSetlistIdx === -1 && document.getElementById('chart-title').value === 'Original A';
      saveToSetlist();
      return { detached, songs: loadSLData(), current: curSetlistIdx };
    });
    check(afterImport.detached, 'import detaches the open chart without replacing its edits');
    assert.deepEqual(afterImport.songs[0], imported);
    check(afterImport.songs.length === 2 && afterImport.songs[1].title === 'Original A' && afterImport.current === 1,
      'Save after import adds the old chart and preserves the imported song');

    const failedUpdate = await page.evaluate(() => {
      const disk = modStore.getItem('prism-sl'), memory = JSON.stringify(setlistData), index = curSetlistIdx;
      sections[0].slots[0].rootM += 2;
      const dirtyBefore = songIsDirty(); failWrites();
      try { saveToSetlist(); } finally { restoreWrites(); }
      const failed = { dirtyBefore, dirty: songIsDirty(), disk: disk === modStore.getItem('prism-sl'),
        memory: memory === JSON.stringify(setlistData), index: index === curSetlistIdx,
        notice: document.getElementById('_toast')?.textContent || '' };
      saveToSetlist();
      return { failed, retry: !songIsDirty() && loadSLData()[index].sections[0].slots[0].rootM === sections[0].slots[0].rootM };
    });
    check(Object.entries(failedUpdate.failed).every(([k, v]) => k === 'notice' ? /Could not save/.test(v) : v),
      'failed update keeps the disk, saved list, selection and dirty edits, and shows an error');
    check(failedUpdate.retry, 'retry saves the edited chord and only then clears its dirty status');

    const failedAdd = await page.evaluate(() => {
      curSetlistIdx = -1; document.getElementById('chart-title').value = 'New draft';
      sections[0].slots[0].rootM += 1;
      const disk = modStore.getItem('prism-sl'), memory = JSON.stringify(setlistData);
      failWrites(); try { saveToSetlist(); } finally { restoreWrites(); }
      const failed = curSetlistIdx === -1 && songIsDirty() && disk === modStore.getItem('prism-sl') && memory === JSON.stringify(setlistData);
      saveToSetlist();
      return { failed, retry: loadSLData().filter(s => s.title === 'New draft').length === 1 && !songIsDirty() };
    });
    check(failedAdd.failed && failedAdd.retry, 'failed new-song save leaves no phantom row; retry adds exactly one song');

    const beforeFailedImport = await page.evaluate(() => {
      window.importBefore = { disk: modStore.getItem('prism-sl'), memory: JSON.stringify(setlistData), index: curSetlistIdx };
      failWrites(); return testSong(203, 'Rejected import');
    });
    await importList([beforeFailedImport]);
    await page.waitForFunction(() => /Could not import/.test(document.getElementById('_toast')?.textContent || ''));
    check(await page.evaluate(() => {
      restoreWrites();
      return importBefore.disk === modStore.getItem('prism-sl') && importBefore.memory === JSON.stringify(setlistData) && importBefore.index === curSetlistIdx;
    }), 'failed import preserves the saved list and the editor association');

    const aux = await page.evaluate(() => {
      const copy = x => JSON.parse(JSON.stringify(x));
      const st = copy(_sqCaptureState()); st.mach = '808';
      st.aux = { mach: 'PERC', on: true, grid: { 0: [{ v: 1, vel: 93, p: 0, rat: 1, prob: 1 }] }, vols: { 0: 0.35 }, pitches: { 0: 3 } };
      _sqRestoreState(st);
      const song = testSong(301, 'Aux rhythm'); song.soundsMode = 'keep'; song.savedRhythm = copy(_sqCaptureState());
      // Change both kits and their lane controls, and load while Aux is focused.
      const current = copy(_sqCaptureState()); current.mach = '909';
      current.aux = { mach: 'LATIN', on: false, grid: {}, vols: { 0: 0.61 }, pitches: { 0: -2 } };
      _sqRestoreState(current); _sqSetFocus(1);
      loadSong(song, -1);
      const kept = copy(_sqCaptureState());
      // The same rhythm must recall its stored kit and controls when asked to.
      song.soundsMode = 'recall'; song.sounds = { partial: true };
      loadSong(song, -1);
      const recalled = copy(_sqCaptureState());
      // Songs from before Aux existed still restore the empty, muted layer.
      const legacy = copy(song.savedRhythm); delete legacy.aux;
      _sqRestoreState(legacy);
      const old = copy(_sqCaptureState());
      return { kept, recalled, old, saved: song.savedRhythm };
    });
    check(aux.kept.mach === '909' && aux.kept.aux.mach === 'LATIN' && aux.kept.aux.vols[0] === 0.61 && aux.kept.aux.pitches[0] === -2,
      'Keep your sounds preserves both kits and Aux lane controls even when Aux was focused');
    assert.deepEqual(aux.kept.aux.grid, aux.saved.aux.grid);
    check(aux.kept.aux.on, 'Keep your sounds restores the saved Aux notes and enabled state');
    assert.deepEqual(aux.recalled.aux, aux.saved.aux);
    check(aux.recalled.mach === '808', 'Recall restores the saved main kit and the entire Aux layer');
    check(!aux.old.aux.on && Object.keys(aux.old.aux.grid).length === 0, 'legacy rhythm without Aux still restores an empty muted layer');
    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('All song data-loss regressions passed.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
