/* Starter patterns (4.9.9.9.9.9.6d): switching Drums, Bass or Mel on over an empty part
   writes that part's starter (4/4 beat, funk bass, pop hook); a part with something in it
   is never touched; the starter is chosen in Settings and can be turned off; the Live
   page's Styles widget rotates a part through the part's own list and switches it on.
   Run: node tests/starters/starters.test.js   Env: CHROMIUM, PLAYWRIGHT */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const o = {};
    const click = id => document.getElementById(id).click();
    const toasts = []; const st = window.showToast; window.showToast = function (m) { toasts.push(String(m)); return st && st.apply(this, arguments); };
    o.boot = { kit: _sqKitHasHits(), bass: _blHasNotes(), mel: _mlHasNotes() };

    // Bass and Melody: switched on over an empty part, the starter is written.
    click('ft-bas-btn'); o.bassOn = { has: _blHasNotes(), style: _blGenStyle(), enabled: blEnabled };
    click('ft-mel-btn'); o.melOn = { has: _mlHasNotes(), style: _mlGenStyle(), enabled: mlEnabled };
    // Switched off and on again: what is there is not rewritten.
    const g1 = JSON.stringify(PR_ENGINES.bl.cell(0)) + JSON.stringify(PR_ENGINES.ml.cell(0)) + JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7].map(i => PR_ENGINES.bl.cell(i)));
    PR_ENGINES.bl.toggle(3, 40);   // a hand-placed note, so a rewrite would be visible
    const hand = JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7].map(i => PR_ENGINES.bl.cell(i)));
    click('ft-bas-btn'); click('ft-bas-btn');
    o.bassKept = JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7].map(i => PR_ENGINES.bl.cell(i))) === hand;
    click('ft-bas-btn'); click('ft-mel-btn');   // both off for the rest

    // Drums: muted and on again with an empty kit writes the groove; with a kit in it, nothing.
    o.drumsBoot = { enabled: drumsEnabled, has: _sqKitHasHits() };
    click('ft-drum-btn'); click('ft-drum-btn');
    o.drums = { has: _sqKitHasHits(), groove: starterCurrent('drums') };
    const kit = JSON.stringify(window._sqCaptureState());
    click('ft-drum-btn'); click('ft-drum-btn');
    o.drumsKept = JSON.stringify(window._sqCaptureState()) === kit;

    // The toast names the part and the style.
    o.toasts = toasts.slice();

    // Settings: choose a different starter, and it is what loads (after the part is emptied).
    starterSetStyle('bass', 'jazz'); starterSetStyle('mel', 'riff'); starterSetStyle('drums', 'Bossa Nova');
    o.saved = JSON.parse(localStorage.getItem('modo-starters'));
    o.selects = { bass: document.getElementById('starter-bass').options.length, mel: document.getElementById('starter-mel').options.length, drums: document.getElementById('starter-drums').options.length };
    window.blClear(); window.mlClear();
    o.cleared = { bass: _blHasNotes(), mel: _mlHasNotes() };
    click('ft-bas-btn'); click('ft-mel-btn');
    o.custom = { bass: _blGenStyle(), mel: _mlGenStyle(), bassHas: _blHasNotes(), melHas: _mlHasNotes() };
    click('ft-bas-btn'); click('ft-mel-btn');

    // Off: nothing is written.
    toggleStarters(); window.blClear();
    click('ft-bas-btn'); o.off = { on: STARTERS.on, has: _blHasNotes() }; click('ft-bas-btn');
    toggleStarters();

    // The Live page's Styles widget.
    window.blClear(); window.mlClear();
    o.widgetIn = !!document.getElementById('st-widget');
    const node = starterWidgetNode();
    const row = p => node.querySelector('.st-row[data-part="' + p + '"]');
    starterWidgetSync();
    o.rowText = { bass: row('bass').querySelector('.st-name').textContent, off: row('bass').classList.contains('off') };
    const list = starterList('bass').map(x => x.id), at = list.indexOf(_blGenStyle());
    row('bass').querySelectorAll('.st-step')[1].click();      // next
    o.rotNext = { style: _blGenStyle(), expect: list[(at + 1) % list.length], enabled: blEnabled, has: _blHasNotes() };
    row('bass').querySelectorAll('.st-step')[0].click();      // previous: back where it was
    row('bass').querySelectorAll('.st-step')[0].click();      // and one more back
    o.rotPrev = { style: _blGenStyle(), expect: list[(at - 1 + list.length) % list.length] };
    row('mel').querySelectorAll('.st-step')[1].click();       // the arrow is next
    const ml = starterList('mel').map(x => x.id);
    o.melName = { style: _mlGenStyle(), enabled: mlEnabled };
    // Drums rotate through the groove table.
    const dl = starterList('drums').map(x => x.id), dAt = dl.indexOf(starterCurrent('drums'));
    row('drums').querySelectorAll('.st-step')[1].click();
    o.drumRot = { now: starterCurrent('drums'), expect: dl[(dAt + 1) % dl.length], label: row('drums').querySelector('.st-name').textContent };
    return o;
  });
  ok(!r.boot.kit && !r.boot.bass && !r.boot.mel, 'a fresh session is empty', JSON.stringify(r.boot));
  ok(r.bassOn.enabled && r.bassOn.has && r.bassOn.style === 'funk', 'Bass switched on over nothing: a funk line is written', JSON.stringify(r.bassOn));
  ok(r.melOn.enabled && r.melOn.has && r.melOn.style === 'hook', 'Mel switched on over nothing: a pop hook is written', JSON.stringify(r.melOn));
  ok(r.bassKept, 'Bass off and on again does not rewrite what is there (a hand-placed note survives)', '');
  ok(r.drumsBoot.enabled && !r.drumsBoot.has, 'Drums start on and empty', JSON.stringify(r.drumsBoot));
  ok(r.drums.has && r.drums.groove === '4/4 Basic', 'Drums off and on over an empty kit: 4/4 Basic is loaded', JSON.stringify(r.drums));
  ok(r.drumsKept, 'and with a kit in it, nothing is loaded', '');
  ok(r.toasts.some(t => /Bass: Funk/.test(t)) && r.toasts.some(t => /Melody: Pop Hook/.test(t)) && r.toasts.some(t => /Drums: 4\/4 Basic/.test(t)), 'each load says what it loaded', JSON.stringify(r.toasts));
  ok(r.saved && r.saved.bass === 'jazz' && r.saved.mel === 'riff' && r.saved.drums === 'Bossa Nova' && r.selects.bass >= 10 && r.selects.mel >= 10 && r.selects.drums >= 30, 'the starters are chosen in Settings and saved', JSON.stringify([r.saved, r.selects]));
  ok(!r.cleared.bass && !r.cleared.mel && r.custom.bass === 'jazz' && r.custom.mel === 'riff' && r.custom.bassHas && r.custom.melHas, 'a chosen starter is what loads', JSON.stringify([r.cleared, r.custom]));
  ok(r.off.on === false && r.off.has === false, 'with the switch off in Settings nothing is loaded', JSON.stringify(r.off));
  ok(r.rowText.bass.length > 0 && r.rowText.off === true, 'the Styles widget names the style and dims a part that is off', JSON.stringify(r.rowText));
  ok(r.rotNext.style === r.rotNext.expect && r.rotNext.enabled && r.rotNext.has, 'next style: the part goes to it, is switched on, and has the line', JSON.stringify(r.rotNext));
  ok(r.rotPrev.style === r.rotPrev.expect, 'previous style steps back through the list', JSON.stringify(r.rotPrev));
  ok(r.melName.style !== 'riff' && r.melName.enabled, 'the arrow beside the name is next', JSON.stringify(r.melName));
  ok(r.drumRot.now === r.drumRot.expect && r.drumRot.label === r.drumRot.expect, 'Drums rotate through the groove table', JSON.stringify(r.drumRot));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
