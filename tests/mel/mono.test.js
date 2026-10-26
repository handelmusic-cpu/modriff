/* The melody's Mono / Poly switch (playMelNote, releaseMelNote), at the door every
   key goes through: what the engine is sent, not what it plays.
   - Poly: keys stack, nothing is cut, nothing slides.
   - Mono: a new key cuts the one sounding (a short fade) and slides from it over the
     glide time; letting go of the newest while an older key is down brings the older
     back, sliding; a slide from silence (a note long finished) is not made.
   - A mõdSynth patch is left to its engine: every key goes through, nothing is cut
     here, and its engine is handed Legato and the Glide (_msxMelVoice).
   - The web voice slides on .detune and the switch lives in the setup snapshot.
   Run: node tests/mel/mono.test.js   Env: CHROMIUM, PLAYWRIGHT */
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
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200); await page.mouse.click(5, 5); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const sent = [];
    window.modSend = m => { sent.push(JSON.parse(JSON.stringify(m))); };
    window.modEngine.ready = () => true;
    // The mõdSynth library loads on demand; _msxMelVoice only asks which parameters exist.
    if (typeof MS === 'undefined') window.MS = { PARAM: { 'voice.mode': 1, 'voice.glide': 1, 'voice.glideAuto': 1 } };
    const reset = () => { sent.length = 0; Object.keys(_melLive).forEach(k => delete _melLive[k]); _melHeld = []; _melHeldInfo = {}; _melSounding = null; };
    const notes = () => sent.filter(m => m.kind === 'note' && m.part === 'mel');
    const rels = () => sent.filter(m => m.kind === 'release' && m.part === 'mel');
    const out = {};
    melWave = 'sine';

    // Poly: two keys, both sound, nothing is cut, nothing slides.
    melMono = false; reset();
    playMelNote(60, .8, true); playMelNote(64, .8, true);
    out.poly = { notes: notes().length, rels: rels().length, glide: notes().some(n => n.glideFrom != null) };

    // Mono: the second key cuts the first and slides from it.
    melMono = true; melGlideTime = 0.2; reset();
    playMelNote(60, .8, true); const id1 = notes()[0].id; playMelNote(64, .8, true);
    out.mono = { notes: notes().length, rels: rels().map(m => [m.id === id1, m.fade]), from: notes()[1].glideFrom, time: notes()[1].glideTime, first: notes()[0].glideFrom };

    // Letting go of the newest, with the older still down: the older comes back, sliding from it.
    sent.length = 0; releaseMelNote(64);
    out.back = { notes: notes().map(n => [n.note, n.glideFrom]), rels: rels().length, relFade: rels()[0] && rels()[0].fade };
    // Letting go of the last key is a plain release, no fade override.
    sent.length = 0; releaseMelNote(60);
    out.last = { notes: notes().length, rels: rels().map(m => m.fade) };

    // A slide from a note that finished long ago is not made.
    reset(); playMelNote(60, .8, true); _melSoundT = performance.now() - 5000; playMelNote(67, .8, true);
    out.stale = notes()[1].glideFrom;

    // Glide time 0: a hard switch, no slide.
    melGlideTime = 0; reset(); playMelNote(60, .8, true); playMelNote(65, .8, true);
    out.noGlide = notes()[1].glideFrom;
    melGlideTime = 0.2;

    // A mõdSynth patch: the page lets every key through and hands the engine Legato + Glide.
    melWave = 'modsynth'; reset();
    playMelNote(60, .8, true); playMelNote(64, .8, true);
    out.msx = { notes: notes().length, rels: rels().length, glide: notes().some(n => n.glideFrom != null) };
    window._webParams['mel.mono'] = true; window._webParams['mel.glideTime'] = 0.3;
    const v = {}; _msxMelVoice('mel', v); out.msxMono = v;
    window._webParams['mel.mono'] = false; const v2 = { 'voice.glide': 0.5 }; _msxMelVoice('mel', v2); out.msxPoly = v2;
    window._webParams['mel.mono'] = null; const v3 = {}; _msxMelVoice('mel', v3); out.msxUntouched = v3;
    const v4 = {}; window._webParams['mel.mono'] = true; _msxMelVoice('bass', v4); out.msxOtherPart = v4;
    melWave = 'sine';

    // The slide itself, on fake voices: a detune that starts away and ramps home.
    const ev = [];
    const nd = { detune: { value: 0, setValueAtTime: (x, t) => ev.push(['set', x, t]), linearRampToValueAtTime: (x, t) => ev.push(['ramp', x, t]) }, frequency: { value: 440 } };
    const lfo = { detune: { value: 0, setValueAtTime() { ev.push(['lfo']); }, linearRampToValueAtTime() {} }, frequency: { value: 5 } };
    _melGlideApply([nd, lfo], 4, 1, 0.2);
    out.glideEv = ev.slice();
    ev.length = 0; _melGlideApply([nd], 40, 1, 0.2); out.glideFar = ev.length;

    // The real web voice: it builds with a slide, and the short release takes it down.
    try {
      if (!audioCtx) { audioCtx = new AudioContext(); try { _ensureAllPartBuses(audioCtx); } catch (e) {} }
      const ctx = getCtx();
      Object.assign(window._webParams, { 'mel.voice': 'sine', 'mel.attack': .015, 'mel.release': .8, 'mel.reverb': 0, 'mix.mel': 1, 'fx.trim': 1 });
      const a = window.modEngine.ready; window.modEngine.ready = () => true;
      _webMelNoteOn({ v: 1, kind: 'note', part: 'mel', id: 901, note: 64, vel: .8, dur: null, y: 0, glideFrom: 60, glideTime: .2 });
      const slid = (activeMelOscs[64] ? activeMelOscs[64].oscs : []).some(o => o.detune && o._glideSeen !== 0);
      out.web = { built: !!activeMelOscs[64], ctx: !!ctx, slid };
      _webMelRelease(901, .025);
      out.webReleased = !activeMelOscs[64];
    } catch (e) { out.webErr = String(e && e.stack || e); }

    // Saved with the setup, and the controls follow.
    melMono = true; melGlideTime = 0.35; syncMelMonoUI();
    out.ui = { btn: document.getElementById('mel-mono-btn').textContent, sl: document.getElementById('mel-glide-time').value, dis: document.getElementById('mel-glide-time').disabled };
    setMelMono(false); out.uiPoly = { btn: document.getElementById('mel-mono-btn').textContent, dis: document.getElementById('mel-glide-time').disabled };
    return out;
  });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(r.poly.notes === 2 && r.poly.rels === 0 && !r.poly.glide, 'Poly: two keys sound, nothing is cut, nothing slides', JSON.stringify(r.poly));
  ok(r.mono.notes === 2 && r.mono.rels.length === 1 && r.mono.rels[0][0] && r.mono.rels[0][1] > 0 && r.mono.rels[0][1] < 0.1, 'Mono: the second key cuts the first with a short fade', JSON.stringify(r.mono.rels));
  ok(r.mono.from === 60 && near(r.mono.time, 0.2) && r.mono.first == null, 'and slides from it over the glide time (the first note slides from nothing)', JSON.stringify(r.mono));
  ok(r.back.notes.length === 1 && r.back.notes[0][0] === 60 && r.back.notes[0][1] === 64 && r.back.rels === 1 && r.back.relFade > 0, 'letting go of the newest brings the older key back, sliding from it', JSON.stringify(r.back));
  ok(r.last.notes === 0 && r.last.rels.length === 1 && r.last.rels[0] == null, 'letting go of the last key is a plain release', JSON.stringify(r.last));
  ok(r.stale == null, 'no slide from a note that finished seconds ago', String(r.stale));
  ok(r.noGlide == null, 'a glide time of 0 is a hard switch', String(r.noGlide));
  ok(r.msx.notes === 2 && r.msx.rels === 0 && !r.msx.glide, 'a mõdSynth patch: every key goes through and nothing is cut by the page', JSON.stringify(r.msx));
  ok(r.msxMono['voice.mode'] === 'legato' && near(r.msxMono['voice.glide'], 0.3) && r.msxMono['voice.glideAuto'] === 0, 'Mono hands its engine Legato and the Glide', JSON.stringify(r.msxMono));
  ok(r.msxPoly['voice.mode'] === 'poly' && r.msxPoly['voice.glide'] === 0.5, 'Poly hands it Poly and leaves the patch\'s glide', JSON.stringify(r.msxPoly));
  ok(Object.keys(r.msxUntouched).length === 0 && Object.keys(r.msxOtherPart).length === 0, 'untouched, and every other part, the patch is left as it was made', JSON.stringify([r.msxUntouched, r.msxOtherPart]));
  ok(r.glideEv.length === 2 && r.glideEv[0][0] === 'set' && r.glideEv[0][1] === 400 && r.glideEv[1][0] === 'ramp' && r.glideEv[1][1] === 0 && near(r.glideEv[1][2], 1.2), 'the voice starts 400 cents away and ramps home; an LFO is not slid', JSON.stringify(r.glideEv));
  ok(r.glideFar === 0, 'a slide of more than two octaves is not made', String(r.glideFar));
  ok(r.ui.btn === 'Mode: Mono' && r.ui.sl === '350' && !r.ui.dis && r.uiPoly.btn === 'Mode: Poly' && r.uiPoly.dis, 'the button and the glide slider follow the mode', JSON.stringify([r.ui, r.uiPoly]));
  ok(!r.webErr && r.web && r.web.built && r.webReleased, 'the real web voice builds when a slide is asked for, and the short release takes it down', r.webErr || JSON.stringify([r.web, r.webReleased]));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  // The strip's two-finger zoom: Mono only. In Poly the keys keep the default width and
  // a second finger reaches its key (a chord), instead of being read as a pinch.
  const z = await page.evaluate(() => {
    const wrap = document.querySelector('.mel-keys-wrap'), kk = document.getElementById('melody-keys');
    const key = kk.querySelector('button, .mel-key') || kk.firstElementChild;
    const kw = () => parseFloat(kk.style.getPropertyValue('--mel-kw'));
    const pe = (type, id, x) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: 10, bubbles: true, cancelable: true });
    const pinch = () => {
      let reached = 0; const spy = () => reached++;
      document.addEventListener('pointerdown', spy);
      key.dispatchEvent(pe('pointerdown', 11, 100)); key.dispatchEvent(pe('pointerdown', 12, 160));
      document.removeEventListener('pointerdown', spy);
      wrap.dispatchEvent(pe('pointermove', 12, 300));
      const w = kw();
      key.dispatchEvent(pe('pointerup', 12, 300)); key.dispatchEvent(pe('pointerup', 11, 100));
      return { w, reached };
    };
    const o = {};
    _melKw = null; melMono = false; melApplyKeyW(); o.auto = kw();
    _melKw = 70; melApplyKeyW(); o.polyWithSaved = kw();
    o.poly = pinch(); o.polyAfter = kw();
    setMelMono(true); o.monoSaved = kw();
    _melKw = null; melApplyKeyW(); o.mono = pinch();
    setMelMono(false); o.back = kw();
    _melKw = null; melApplyKeyW();
    return o;
  });
  ok(z.polyWithSaved === z.auto && z.polyAfter === z.auto, 'Poly keeps the default key width even with a saved zoom', JSON.stringify(z));
  ok(z.poly.w === z.auto && z.poly.reached === 2, 'Poly: two fingers are two key presses, not a pinch', JSON.stringify(z.poly));
  ok(z.monoSaved === 70, 'Mono brings the player\'s own width back', JSON.stringify(z));
  ok(z.mono.w > z.auto && z.mono.reached === 1, 'Mono: two fingers zoom the strip', JSON.stringify(z.mono));
  ok(z.back === z.auto, 'and back in Poly the width is the default again', JSON.stringify(z));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
