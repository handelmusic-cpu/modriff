/* "Hear it" in the Groove Pack sheet (6.9.9.9.6).

   On a free install: open the sheet from a locked kit, press Hear it, and count what the
   drum engine is sent (kit, lane, time) and which kit and groove each part of the demo was.
   The first part must be the tapped kit. After Stop (and after the demo runs out) the song
   must be as it was: the whole captured setup, the tempo, the drum kit, the groove, and
   whether it was playing. With the song playing it is paused for the demo and running after.
   During a take Hear it is off, and a take that starts while it plays ends it.

   Run (repo served, Chromium available; see CLAUDE.md):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/tier/hearit.test.js
   Env: URL, CHROMIUM, PLAYWRIGHT. Takes about a minute (the demo is played to its end once). */
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

async function open(browser, viewport, mac) {
  const ctx = await browser.newContext({ viewport, hasTouch: !mac, isMobile: !mac });
  const page = await ctx.newPage();
  page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
  await page.goto(URL); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('modo-dev-tier', 'free'); });
  await page.goto(URL); await page.waitForTimeout(1500);
  if (await page.$('.unlock-btn >> text=Random')) await page.click('.unlock-btn >> text=Random');
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (isAnythingPlaying()) ftPlayStop();
    window.__hits = [];
    const send = window.modEngine.send;
    window.modEngine.send = function (m) { if (m && m.kind === 'hit' && m.part === 'drum') window.__hits.push({ kit: m.kit, lane: m.lane, at: m.at }); return send.apply(this, arguments); };
    window.__state = () => JSON.stringify({ setup: _capSettings(), bpm: document.getElementById('bpm').value, kit: window._sqDrumKit(), groove: sqCurGroove, playing: isAnythingPlaying() });
  });
  return page;
}
const sheetBtn = (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('#_pro-sheet button')].find(x => x.textContent.trim() === t); if (!b) return null; return { disabled: b.disabled }; }, text);
const press = (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('#_pro-sheet button')].find(x => x.textContent.trim() === t); b.click(); }, text);
const openFromKit = (page, kit) => page.evaluate(k => document.querySelector('#sq-machineRow .sq-mbtn[data-mach="' + k + '"]').click(), kit);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });

  console.log('\n== iPhone width');
  let page = await open(browser, { width: 390, height: 844 });
  const before = await page.evaluate(() => window.__state());
  await openFromKit(page, 'ROCK');
  check(!!(await sheetBtn(page, 'Hear it')), 'the sheet for a locked kit has a Hear it button');
  const text = await page.evaluate(() => document.querySelector('#_pro-sheet .pro-what').textContent);
  console.log('   sheet says: ' + text);
  await press(page, 'Hear it');
  await page.waitForTimeout(2200);
  check(!!(await sheetBtn(page, 'Stop')), 'the button becomes Stop');
  const mid = await page.evaluate(() => ({ log: _packDemoLog.slice(), hits: window.__hits.length, playing: isAnythingPlaying(), kits: [...new Set(window.__hits.map(h => h.kit))] }));
  check(mid.hits > 5, 'the demo sends hits to the drum engine', mid.hits);
  check(mid.log[0] && mid.log[0].kit === 'ROCK', 'the demo starts with the tapped kit', JSON.stringify(mid.log));
  check(mid.kits.length === 1 && mid.kits[0] === 'ROCK', 'and only that kit has sounded so far', mid.kits.join(','));
  await press(page, 'Stop');
  const nStop = await page.evaluate(() => window.__hits.length);
  await page.waitForTimeout(800);
  const nLater = await page.evaluate(() => window.__hits.length);
  check(nLater === nStop, 'Stop ends it: no more hits are sent', nStop + ' then ' + nLater);
  check(!!(await sheetBtn(page, 'Hear it')), 'the button is Hear it again');
  const after = await page.evaluate(() => window.__state());
  check(after === before, 'after Stop the song is as it was (setup, tempo, kit, groove, transport)', before === after ? '' : 'differs');
  console.log('   before: ' + JSON.stringify(JSON.parse(before), (k, v) => k === 'setup' ? '…' + before.length : v));

  // Run to the end: every part in order.
  await page.evaluate(() => { window.__hits.length = 0; });
  await press(page, 'Hear it');
  await page.waitForTimeout(19000);
  const full = await page.evaluate(() => ({ log: _packDemoLog.slice(), running: !!_packDemo, kits: window.__hits.map(h => h.kit).filter((k, i, a) => i === 0 || a[i - 1] !== k) }));
  console.log('   played: ' + full.log.map(p => p.kit + ' / ' + p.groove + ' @' + p.bpm).join('  >  '));
  check(!full.running, 'it ends by itself');
  check(full.log.length === 4 && full.log[0].kit === 'ROCK' && full.log.some(p => p.groove === 'Afro 6/8'), 'four parts, the tapped one first, a world groove among them', full.log.length);
  check(full.kits.length >= 4, 'at least four kit changes are in what the engine received', full.kits.join(' > '));
  check(!!(await sheetBtn(page, 'Hear it')), 'the button is Hear it when it has run out');
  check((await page.evaluate(() => window.__state())) === before, 'after it ends the song is as it was');
  // Opened from a locked groove: that groove first.
  await press(page, 'Not now');
  await page.evaluate(() => document.querySelector('#sq-groove-presets > [data-groove="Samba"]').click());
  await press(page, 'Hear it'); await page.waitForTimeout(800);
  const g = await page.evaluate(() => _packDemoLog.slice());
  check(g[0] && g[0].groove === 'Samba', 'from a locked groove, that groove plays first', JSON.stringify(g[0]));
  await press(page, 'Not now');
  const gone = await page.evaluate(() => ({ running: !!_packDemo }));
  check(!gone.running, 'closing the sheet stops it');
  check((await page.evaluate(() => window.__state())) === before, 'and the song is as it was');

  console.log('\n== the song is playing');
  await page.evaluate(() => ftPlayStop());
  await page.waitForTimeout(1200);
  const playBefore = await page.evaluate(() => ({ playing: isAnythingPlaying(), bpm: document.getElementById('bpm').value, kit: window._sqDrumKit(), groove: sqCurGroove }));
  await openFromKit(page, 'JAZZ'); await press(page, 'Hear it'); await page.waitForTimeout(1500);
  const during = await page.evaluate(() => isAnythingPlaying());
  check(playBefore.playing && !during, 'the transport is paused while the demo plays', 'was ' + playBefore.playing + ', during ' + during);
  await press(page, 'Stop'); await page.waitForTimeout(800);
  const playAfter = await page.evaluate(() => ({ playing: isAnythingPlaying(), bpm: document.getElementById('bpm').value, kit: window._sqDrumKit(), groove: sqCurGroove }));
  check(JSON.stringify(playAfter) === JSON.stringify(playBefore), 'and it is running again with the same tempo, kit and groove', JSON.stringify(playAfter));
  await press(page, 'Not now'); await page.evaluate(() => ftPlayStop());

  console.log('\n== a take');
  await page.evaluate(() => {
    const ctx = getCtx(), o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 220; g.gain.value = 0.05; o.connect(g); g.connect(window._masterOut); o.start();
    window.__peaks = null;
    window._deliverFiles = async function (list) {
      const f = list.find(x => /\.wav$/.test(x.name)), u = new Uint8Array(await f.blob.arrayBuffer()), dv = new DataView(u.buffer), sr = dv.getUint32(24, true);
      let off = 12; while (String.fromCharCode(u[off], u[off + 1], u[off + 2], u[off + 3]) !== 'data') off += 8 + dv.getUint32(off + 4, true);
      const n = (u.length - off - 8) / 4; let pk = 0, pk1 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(dv.getInt16(off + 8 + i * 4, true)) / 32768; if (a > pk) pk = a; if (i > sr && a > pk1) pk1 = a; }
      window.__peaks = { all: pk, afterFirstSecond: pk1, s: n / sr };
    };
  });
  await page.evaluate(() => toggleRecording());
  await page.waitForTimeout(500);
  await openFromKit(page, 'ROCK');
  const dis = await sheetBtn(page, 'Hear it');
  check(dis && dis.disabled, 'during a take Hear it is off');
  const h0 = await page.evaluate(() => window.__hits.length);
  await press(page, 'Hear it'); await page.waitForTimeout(1500);
  const h1 = await page.evaluate(() => window.__hits.length);
  check(h1 === h0, 'pressing it sends no hits', h1 - h0);
  await press(page, 'Not now');
  await page.waitForTimeout(500);
  await page.evaluate(() => toggleRecording());
  for (let i = 0; i < 30 && !(await page.evaluate(() => window.__peaks)); i++) await page.waitForTimeout(300);
  const pk = await page.evaluate(() => window.__peaks);
  check(pk && pk.all < 0.07, 'the take holds the tone and no drums: peak is the tone\'s', pk && pk.all.toFixed(3));
  // A take that starts while the demo plays ends the demo.
  await openFromKit(page, 'ROCK'); await press(page, 'Hear it'); await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__peaks = null; toggleRecording(); });
  const runningAfterRec = await page.evaluate(() => !!_packDemo);
  check(!runningAfterRec, 'a take that starts ends the demo');
  const h2 = await page.evaluate(() => window.__hits.length);
  await page.waitForTimeout(1500);
  check((await page.evaluate(() => window.__hits.length)) === h2, 'and it sends nothing more', '');
  await page.evaluate(() => { toggleRecording(); });
  await press(page, 'Not now');
  await page.waitForTimeout(1500);
  check(page.__errs.length === 0, 'no page errors', page.__errs.join(' | '));
  await page.close();

  console.log('\n== Mac Catalyst (centred dialog)');
  page = await open(browser, { width: 1280, height: 800 }, true);
  await page.evaluate(() => document.documentElement.classList.add('mac-app'));
  await openFromKit(page, 'ROCK');
  const geo = await page.evaluate(() => { const b = document.querySelector('#_pro-sheet .pro-box').getBoundingClientRect(), h = [...document.querySelectorAll('#_pro-sheet button')].find(x => x.textContent.trim() === 'Hear it').getBoundingClientRect(); return { cx: Math.round(b.x + b.width / 2), vw: innerWidth, hearIn: h.top >= b.top && h.bottom <= b.bottom && h.right <= b.right }; });
  check(Math.abs(geo.cx - geo.vw / 2) < 2 && geo.hearIn, 'the dialog is centred and Hear it is inside it', JSON.stringify(geo));
  await press(page, 'Hear it'); await page.waitForTimeout(1500);
  check((await page.evaluate(() => _packDemoLog[0] && _packDemoLog[0].kit)) === 'ROCK', 'it plays there too');
  await press(page, 'Stop');
  await page.close();

  await browser.close();
  console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
