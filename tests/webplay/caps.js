/* The two limits only the free web page has (WEB_LIMITS in index.html), measured on the
   built pages: a Bounce stops itself and saves a .wav of that length, and a song
   holds WEB_LIMITS.sections sections. The app build (dist/) must have neither.

   Run:
     npm run build:web && npm run build
     (cd dist-web && python3 -m http.server 8778 --bind 127.0.0.1 &)
     (cd dist && python3 -m http.server 8779 --bind 127.0.0.1 &)
     node tests/webplay/caps.js
   Env: WEB (default http://127.0.0.1:8778/play/), APP (default http://127.0.0.1:8779/), CHROMIUM, PLAYWRIGHT. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }
}
const WEB = process.env.WEB || 'http://127.0.0.1:8778/play/';
const APP = process.env.APP || 'http://127.0.0.1:8779/';
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

// Seconds in a .wav (PCM or float): the bytes after the header over the byte rate.
const wavSeconds = (buf) => {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return -1;
  const byteRate = buf.readUInt32LE(28);
  let p = 12, data = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), n = buf.readUInt32LE(p + 4);
    if (id === 'data') { data = Math.min(n, buf.length - p - 8); break; }
    p += 8 + n + (n & 1);
  }
  return data / byteRate;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const open = async (url) => {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const st = { errs: [], wavs: [] };
    page.on('pageerror', e => st.errs.push(String(e).slice(0, 200)));
    // A take is two files (.wav and .mid), which a browser gets as one zip: open it and read the .wav's length.
    page.on('download', async d => {
      const name = d.suggestedFilename();
      const p = await d.path().catch(() => null);
      if (!p) return;
      const fs = require('fs'), cp = require('child_process');
      if (/\.wav$/i.test(name)) { st.wavs.push({ name, sec: wavSeconds(fs.readFileSync(p)), at: Date.now() }); return; }
      if (!/\.zip$/i.test(name)) return;
      const list = cp.spawnSync('unzip', ['-Z1', p], { encoding: 'utf8' }).stdout.split('\n').filter(f => /\.wav$/i.test(f));
      for (const f of list) {
        const buf = cp.spawnSync('unzip', ['-p', p, f], { maxBuffer: 1 << 28 }).stdout;
        st.wavs.push({ name: f, sec: wavSeconds(buf), at: Date.now() });
      }
    });
    await page.goto(url); await page.waitForTimeout(1200);
    await page.click(`button[onclick="unlockAudio('roll')"]`); await page.waitForTimeout(2200);
    return { page, st, ctx };
  };

  // ── The web page
  {
    const { page, st, ctx } = await open(WEB);
    const k = await page.evaluate(() => ({ capped: webCapped(), lim: WEB_LIMITS }));
    check(k.capped && k.lim.bounceSeconds === 30 && k.lim.sections === 2, 'web: capped, 30 seconds and 2 sections', JSON.stringify(k));

    // Sections: a song of one takes one more, then says no. The roll may have made several; start from one.
    await page.evaluate(() => { sections = [{ name: 'Section 1', slots: [], plays: 0, follow: 'repeat' }]; curSection = 0; buildSectionTabs(); });
    const sec = await page.evaluate(() => {
      const said = [], orig = window.majorToast;
      window.majorToast = function (m) { said.push(String(m)); return orig.apply(this, arguments); };
      const out = [];
      for (let i = 0; i < 4; i++) { sectionAdd(); out.push(sections.length); }
      window.majorToast = orig;
      return { out, toast: said.join(' | ') };
    });
    check(sec.out.join() === '2,2,2,2', 'web: + Section stops at two and stays there', sec.out.join());
    check(/web version holds 2 sections/.test(sec.toast), 'web: the toast says why', sec.toast.slice(0, 90));
    // The other doors: record into a section and capture-back are refused too, and add nothing.
    const doors = await page.evaluate(() => { const n = sections.length; try { startSongRecord(); } catch (e) {} try { captureBack(); } catch (e) {} return [n, sections.length, songRecActive === true]; });
    check(doors[0] === 2 && doors[1] === 2 && !doors[2], 'web: Song record and capture-back add no third section', JSON.stringify(doors));
    // A load is never refused: a setup with five sections arrives whole and plays.
    const loaded = await page.evaluate(() => {
      sections = [1, 2, 3, 4, 5].map(i => ({ name: 'S' + i, slots: [], plays: 0, follow: 'repeat' })); buildSectionTabs();
      const room = webSectionRoom(); sectionAdd();
      return [sections.length, room];
    });
    check(loaded[0] === 5 && loaded[1] === 0, 'web: a song that arrives with five keeps five, and adds none', JSON.stringify(loaded));
    // The library's Add takes what fits and says how many it left out.
    const lib = await page.evaluate(() => {
      sections = [{ name: 'A', slots: [], plays: 0, follow: 'repeat' }]; curSection = 0; buildSectionTabs();
      const chord = { label: 'C', isRest: false, beats: 4, eighths: 0 };
      const item = { kind: 'song', name: 'Three', srcRoot: root, srcMode: mode, song: { root, mode, sections: [1, 2, 3].map(i => ({ name: 'L' + i, slots: [Object.assign({}, chord)] })) } };
      let ok = true; try { sbLoadItem(item, true, 'add'); } catch (e) { ok = String(e); }
      return { ok, n: sections.length, names: sections.map(s => s.name).join() };
    });
    check(lib.ok === true && lib.n === 2, 'web: library Add of three sections into one adds exactly one', JSON.stringify(lib));

    // Bounce: shorten the cap to 4 s so the run is quick; the cap's path is the same.
    await page.evaluate(() => { WEB_LIMITS.bounceSeconds = 4; if (!isAnythingPlaying()) ftPlayStop(); });
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.evaluate(() => toggleRecording());
    await page.waitForTimeout(800);
    const on = await page.evaluate(() => _isRecording);
    // 4 s cap, then the recorder's own tail (REC_TAIL_MS) so reverb rings out, then the write.
    // An uncapped take would still be recording at 20 s and be 20 s long.
    await page.waitForTimeout(5500);
    const mid = await page.evaluate(() => ({ rec: _isRecording, fin: _recFinishing }));
    await page.waitForFunction(() => !_isRecording && !_recFinishing, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const tail = await page.evaluate(() => REC_TAIL_MS / 1000);
    check(on === true, 'web: Bounce starts');
    check(mid.fin === true, 'web: at 6 s the take has stopped itself and is finishing', JSON.stringify(mid));
    check(st.wavs.length >= 1, 'web: a .wav was saved', st.wavs.map(w => w.name + ' ' + w.sec.toFixed(2) + 's').join(' | '));
    const took = (Date.now() - t0) / 1000;
    if (st.wavs[0]) check(st.wavs[0].sec > 3.2 && st.wavs[0].sec <= 4 + tail + 1, 'web: the file is the cap plus the recorder\'s tail (4 s + up to ' + tail + ' s), not the ' + took.toFixed(0) + ' s that passed', st.wavs[0].sec.toFixed(2) + 's');

    // A take stopped by hand must not leave a timer that cuts the next one short.
    st.wavs.length = 0;
    await page.evaluate(() => { WEB_LIMITS.bounceSeconds = 3; toggleRecording(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => toggleRecording());              // stopped by hand at ~1 s
    await page.waitForFunction(() => !_isRecording && !_recFinishing, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => { WEB_LIMITS.bounceSeconds = 30; toggleRecording(); });   // second take, long cap
    await page.waitForTimeout(4500);                           // past the first take's 3 s mark
    const still = await page.evaluate(() => _isRecording);
    check(still === true, 'web: a hand-stopped take leaves no timer that ends the next one', String(still));
    await page.evaluate(() => toggleRecording());
    await page.waitForTimeout(1500);
    check(st.errs.length === 0, 'web: nothing thrown', st.errs.join(' | '));
    await ctx.close();
  }

  // ── The app build: neither limit
  {
    const { page, st, ctx } = await open(APP);
    const r = await page.evaluate(() => {
      sections = [{ name: 'Section 1', slots: [], plays: 0, follow: 'repeat' }]; curSection = 0; buildSectionTabs();
      for (let i = 0; i < 5; i++) sectionAdd();
      return { capped: webCapped(), room: webSectionRoom(), n: sections.length };
    });
    check(!r.capped && r.room === Infinity && r.n === 6, 'app: not capped, six sections after five adds', JSON.stringify(r));
    await page.evaluate(() => { if (!isAnythingPlaying()) ftPlayStop(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { WEB_LIMITS.bounceSeconds = 2; toggleRecording(); });
    await page.waitForTimeout(4500);
    const rec = await page.evaluate(() => _isRecording);
    check(rec === true, 'app: Bounce keeps recording past what the web cap would be (2 s here)');
    await page.evaluate(() => toggleRecording());
    await page.waitForTimeout(1200);
    check(st.errs.length === 0, 'app: nothing thrown', st.errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
