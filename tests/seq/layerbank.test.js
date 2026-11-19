/* A recorded kit's lanes in the engine's drum bank (voicebank.h findVariant, seqplay.h; docs/native-scheduling.md).

   A recorded lane is not one voice: the page's sqLayerTrack plays one of several recordings by how hard the stroke is (layers) and
   alternates a layer's takes. The bank holds one entry per take of each layer; the engine picks. Before this, any such lane was
   refused ("layered: picks its recording by stroke strength"), so a kit marked with a diamond (Batá, Rock, Studio, Hand Drums...)
   took the whole band back to the page, which iOS pauses on leaving the app: no background play.

   Held here, in the real page on an OfflineAudioContext with a stand-in plugin (tests/seq/bank.test.js does the same for the synthesized kits):
    1. the lanes of Batá (one layer of two takes; its okónkolo stops after length / rate, a line in 1 / frequency: basis 2) and Rock (four
       layers of two takes) bank without a refusal, and every entry the engine patches for a hit at a velocity, accent and pitch nulls the
       page's fresh recording of that same take (banktest, the engine's own C++);
    2. a lane whose recordings have not arrived is refused without being remembered as refused (it is built when they have);
    3. the layer the engine picks for a stroke is the one the page's _drumLayerFor picks, for every strength, accent and layer count, and the
       takes alternate (varianttest, through DrumPlayer::play).

   Run: make -C native/modsynth banktest varianttest && node tests/seq/layerbank.test.js        Env: CHROMIUM, PLAYWRIGHT, PASS_DB (90) */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
for (const t of ['banktest', 'varianttest']) if (!fs.existsSync(path.join(root, 'native', 'modsynth', t))) { console.error('build it first: make -C native/modsynth banktest varianttest'); process.exit(2); }

(async () => {
  const srv = await serve();
  const chrome = process.env.CHROMIUM || (fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const cases = [
    { vel: 0.9, accent: false, pitch: 0, onset: 2304 + 128 * 400 },
    { vel: 0.9, accent: false, pitch: 0, onset: 2304 + 128 * 400 + 77 },
    { vel: 0.5, accent: false, pitch: 0, onset: 2304 + 128 * 523 + 5 },
    { vel: 0.9, accent: true, pitch: 0, onset: 2304 + 128 * 611 + 100 },
    { vel: 0.9, accent: false, pitch: 4, onset: 2304 + 128 * 700 + 30 },
    { vel: 0.9, accent: false, pitch: -5, onset: 2304 + 128 * 800 },
    { vel: 0.65, accent: true, pitch: 5, onset: 72735 },
    { vel: 0.288, accent: false, pitch: -2, onset: 99200 },
    { vel: 0.15, accent: false, pitch: 3, onset: 99200 },
  ];
  const out = await page.evaluate(async (arg) => {
    const { cases, kits } = arg;
    const sr = 48000, offline = new OfflineAudioContext(2, sr * 8, sr);
    audioCtx = offline;
    const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
    const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
    const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
    const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Array.from(new Float32Array(u.buffer)); };
    const entries = [], BUFS = new Map();
    const stub = {
      graphBuf: m => { BUFS.set(m.id, { sr: m.sampleRate, ch: m.channels.map(decf) }); }, graphBegin() {}, graphEdit() {},
      seqScore: () => Promise.resolve({ ok: true }),
      seqBank: o => { if (o.clear) entries.length = 0; if (o.entry) entries.push(dec(o.entry)); return Promise.resolve({ ok: true }); },
      seqStart: () => Promise.resolve({ ok: true }), seqStop: () => Promise.resolve(), seqTempo: () => Promise.resolve(), seqMirror: () => Promise.resolve({}),
    };
    window.modNativePlugin = () => stub;
    modGraphEnable(stub, ['drum', 'auxperc', 'bass', 'chord', 'mel', 'melgen', 'arp']);
    _ensureAllPartBuses(offline);
    const setScore = kit => {
      const lanes = n => { const g = {}; for (let t = 0; t < n; t++) g[t] = Array.from({ length: 16 }, (_, s) => ({ v: s === 0 ? 1 : 0, r: 1, orn: 0, vel: 100 })); return g; };
      window._sqRestoreState({ steps: 16, swing: 0, mach: kit, grid: lanes(window._sqMachines()[kit].tracks.length), kitOn: true, aux: { mach: 'PERC', grid: {}, on: false } });
      window._sqEnsureGrid(); drumsEnabled = true;
    };
    const load = async (kit, dirs) => {   // the kit's recordings into the page's buffers, as sqPreloadKit would (untrimmed: the same buffer is used for both sides)
      const B = window._drumBuffers();
      for (const n of window._sqMachines()[kit].samples) {
        const pre = Object.keys(dirs).find(p => n.indexOf(p) === 0);
        const ab = await (await fetch('samples/' + dirs[pre] + '/' + n.slice(pre.length) + '.mp3')).arrayBuffer();
        B[n] = await offline.decodeAudioData(ab);
      }
    };
    const res = { kits: {}, held: [], fresh: [], layout: {} };
    // 2. nothing has arrived: refused, and not remembered
    setScore('BATA'); window._nsBank.have = {}; window._nsBank.bad = {};
    const early = await window._nsBank.ensure();
    res.early = { built: early.built, failed: early.failed.length, why: (early.failed[0] || {}).why, remembered: Object.keys(window._nsBank.bad).length };
    for (const [kit, dirs] of Object.entries(kits)) {
      await load(kit, dirs);
      setScore(kit); window._nsBank.have = {}; window._nsBank.bad = {};
      const from = entries.length;
      const rep = await window._nsBank.ensure();
      res.kits[kit] = { built: rep.built, failed: rep.failed.map(f => f.name + ': ' + f.why), entries: entries.length - from };
      res.layout[kit] = window._sqMachines()[kit].tracks.map(t => t.layout || null);
      entries.slice(from).forEach(e => res.held.push({ part: e[1], code: e[2], kit, id: e[3], d: Array.from(e) }));
    }
    for (const h of res.held) {
      const part = h.part ? 'auxperc' : 'drum', v = Math.floor(h.id / 64) - 1;
      const lane = h.id % 64, pick = h.id >= 64 ? { layer: Math.floor(v / 8), take: v % 8 } : null;
      for (const c of cases) {
        window.__sqPickMiss = false;
        const r = await window._nsBank.record({ kind: 'hit', part, id: 1, kit: h.kit, lane, vel: c.vel, accent: c.accent, pitch: c.pitch, dyn: null, at: (c.onset - 1e-6) / sr, pick });
        res.fresh.push({ part: h.part, code: h.code, id: h.id, vel: c.vel, accent: c.accent, pitch: c.pitch, onset: c.onset, prog: r ? Array.from(r.prog) : null, kit: h.kit });
      }
    }
    res.bufs = Array.from(BUFS, ([id, b]) => ({ id, sr: b.sr, ch: b.ch }));
    return res;
  }, { cases, kits: { BATA: { ba_: 'bata' }, ROCK: { rk2_: 'rock2' } } });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  await browser.close(); srv.close();
  ok(errs.length === 0, 'the page threw nothing', errs.join(' | '));

  ok(out.early.built === 0 && out.early.failed > 0 && /not loaded/.test(out.early.why || '') && out.early.remembered === 0,
    'lanes whose recordings have not arrived are refused for that reason and not remembered', JSON.stringify(out.early));
  for (const [kit, r] of Object.entries(out.kits)) {
    console.log('  ' + kit + ': ' + r.built + ' lanes banked as ' + r.entries + ' entries; layout ' + JSON.stringify(out.layout[kit]));
    ok(r.failed.length === 0 && r.built > 0, kit + ': every lane the score plays is banked', r.failed.join('; '));
  }
  ok(out.kits.BATA.entries === 11, 'Batá banks 11 entries (the six lanes\' takes)', out.kits.BATA.entries);
  ok(out.kits.ROCK.entries > out.kits.ROCK.built * 2 - 1, 'Rock banks one entry per take of each layer', out.kits.ROCK.entries + ' for ' + out.kits.ROCK.built + ' lanes');

  // ── 1. the engine's patch against the page's fresh recording of the same take ────────────────────
  const buf = [];
  buf.push(out.bufs.length); out.bufs.forEach(b => { buf.push(b.id, b.sr, b.ch.length, b.ch[0].length); b.ch.forEach(c => c.forEach(x => buf.push(x))); });
  buf.push(out.held.length);
  out.held.forEach(h => { buf.push(h.d.length); h.d.forEach(x => buf.push(x)); });
  const list = out.fresh.filter(c => c.prog);
  ok(list.length === out.fresh.length, 'every fresh recording made one voice', (out.fresh.length - list.length) + ' did not');
  buf.push(list.length);
  list.forEach(c => { buf.push(c.part, c.code, c.id, c.vel, c.accent ? 1 : 0, c.pitch, c.onset, c.prog.length); c.prog.forEach(x => buf.push(x)); });
  buf.push(0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layerbank-'));
  fs.writeFileSync(path.join(tmp, 'cases.f64'), Buffer.from(Float64Array.from(buf).buffer));
  const run = spawnSync(path.join(root, 'native', 'modsynth', 'banktest'), [path.join(tmp, 'cases.f64')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  const rows = run.stdout.trim().split('\n').map(l => l.split(' '));
  ok(rows.length === list.length, 'banktest answered every case', rows.length + ' of ' + list.length);
  let nOk = 0, worst = 1e9, miss = 0; const badRows = [];
  rows.forEach((r, i) => {
    const c = list[i];
    if (r[1] === 'miss' || /^refused/.test(r[1])) { miss++; badRows.push(r[1] + ' ' + c.kit + ' ' + c.id); return; }
    const depth = parseFloat(r[1]), peak = parseFloat(r[2]);
    worst = Math.min(worst, depth);
    if (depth >= PASS_DB && peak > 0) nOk++; else badRows.push(`${c.kit} entry ${c.id} vel ${c.vel} accent ${c.accent} pitch ${c.pitch}: ${depth} dB, peak ${peak}`);
  });
  badRows.slice(0, 12).forEach(b => console.log('     ' + b));
  ok(miss === 0, 'no hit missed the bank', miss);
  ok(nOk === list.length, nOk + ' of ' + list.length + ' patched takes null the page\'s fresh recording (worst ' + worst.toFixed(1) + ' dB), across velocity, accent and pitch', (list.length - nOk) + ' below ' + PASS_DB + ' dB');
  const pitched = out.held.filter(h => h.d.length > 20).length;
  ok(pitched > 0, 'entries reached the engine in the layout banktest reads', pitched);

  // ── 3. the layer and the take the engine picks ──────────────────────────────────────────────────
  const m = /function _drumLayerFor\(d, n\)\{[\s\S]*?\n\}/.exec(html);
  ok(!!m, 'the page\'s _drumLayerFor is found in index.html', '');
  const layerFor = new Function('return ' + m[0].replace('function _drumLayerFor', 'function'))();
  const rowsV = [];
  for (const layers of [1, 2, 3, 4, 5]) for (const takes of [1, 2, 3]) for (let dyn = 0; dyn <= 2.2001; dyn += 0.0125) for (const accent of [false, true]) {
    const d = dyn * (accent ? 1.25 : 1);
    rowsV.push(layers, takes, dyn, accent ? 1 : 0, layerFor(d, layers));
  }
  const v = [rowsV.length / 5].concat(rowsV);
  fs.writeFileSync(path.join(tmp, 'rows.f64'), Buffer.from(Float64Array.from(v).buffer));
  const vr = spawnSync(path.join(root, 'native', 'modsynth', 'varianttest'), [path.join(tmp, 'rows.f64')], { encoding: 'utf8' });
  if (vr.stderr) console.log(vr.stderr.trim().split('\n').map(l => '     ' + l).join('\n'));
  ok(vr.status === 0, 'the engine plays the page\'s layer for every strength, accent and layer count, and alternates the takes: ' + (vr.stdout || '').trim(), vr.status);

  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
