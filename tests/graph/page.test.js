/* The page's own path to the native host, end to end, without a host.

   The real page runs a pattern of hits through window.modEngine.send twice, on
   an OfflineAudioContext standing in for the page's context:
     reference  the web engine as it is, rendered by the browser;
     graph      the same messages with the graph path on and a stand-in plugin
                that records what the page sends the host (programs, clips,
                edits). native/modsynth/graphmix then plays those messages
                through the voice pool, as the host would, and writes the part's
                bus.
   The two are compared. What is being held is the wiring: the voice built on a
   recorder, the bus named to the host with its fixed gain, times made relative
   to the note, the choke that reaches a voice already sent as an edit, and the
   pool placing each voice at its frame.

   Run: make -C native/modsynth graphmix && node tests/graph/page.test.js [part]
   Env: CHROMIUM, PLAYWRIGHT. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-page-'));
const SR = 48000, SECONDS = 3.2;
// `part` or `part:voice`: a sampled voice is loaded first, as the app does.
const SPEC = (process.argv[2] || 'drum').split(':');
const PART = SPEC[0], VOICE = SPEC[1] || null;
const WEBPART = PART === 'glide' ? 'mel' : (PART === 'drumjazz' || PART === 'rhythm') ? 'drum' : PART;   // the part the messages name
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;   // keep these events (debugging)
// The buses the host would sum for this part: its own, and the two rooms it can send to.
const BUSES = p => [{ chord: 0, mel: 1, melgen: 2, bass: 3, arp: 4, drum: 5, auxperc: 6, sampler: 7, click: 8, glide: 1, drumjazz: 5, rhythm: 8 }[p], 9, 10].join(',');
const CODE = { chord: 0, mel: 1, melgen: 2, bass: 3, arp: 4, drum: 5, auxperc: 6, sampler: 7, click: 8, glide: 1, drumjazz: 5, rhythm: 8 }[PART];

// Each part's pattern: messages as modEngine takes them, at seconds from the start.
const PATTERNS = {
  drum: [
    [0.10, { kind: 'hit', part: 'drum', id: 1, kit: '808', lane: 0, vel: 0.9, accent: false, pitch: 0, dyn: null }],
    [0.35, { kind: 'hit', part: 'drum', id: 2, kit: '808', lane: 4, vel: 0.7, accent: false, pitch: 0, dyn: null }],
    [0.50, { kind: 'hit', part: 'drum', id: 3, kit: '808', lane: 1, vel: 0.9, accent: true, pitch: 0, dyn: null }],
    [0.75, { kind: 'hit', part: 'drum', id: 4, kit: '808', lane: 5, vel: 0.8, accent: false, pitch: 0, dyn: null }],   // open hat
    [1.00, { kind: 'hit', part: 'drum', id: 5, kit: '808', lane: 4, vel: 0.8, accent: false, pitch: 0, dyn: null }],   // closed hat: chokes it
    [1.20, { kind: 'hit', part: 'drum', id: 6, kit: '808', lane: 6, vel: 0.8, accent: false, pitch: 0, dyn: null }],
    [1.45, { kind: 'hit', part: 'drum', id: 7, kit: '808', lane: 2, vel: 0.8, accent: false, pitch: -2, dyn: null }],
    [1.70, { kind: 'hit', part: 'drum', id: 8, kit: '808', lane: 7, vel: 0.8, accent: false, pitch: 0, dyn: null }],
    [2.10, { kind: 'hit', part: 'drum', id: 9, kit: '909', lane: 0, vel: 1.0, accent: false, pitch: 0, dyn: null }],
    [2.10, { kind: 'hit', part: 'drum', id: 10, kit: '909', lane: 1, vel: 0.9, accent: false, pitch: 0, dyn: null }],
  ],
};

PATTERNS.auxperc = PATTERNS.drum.slice(0, 5).map(([t, m]) => [t, Object.assign({}, m, { part: 'auxperc' })]);
PATTERNS.bass = [[0.1, 36, 0.4], [0.6, 38, 0.4], [1.1, 41, 0.3], [1.5, 36, 0.8]].map(([t, n, d], i) =>
  [t, { kind: 'note', part: 'bass', id: i + 1, note: n, vel: 0.9, dur: d, slide: false, from: null }]);
PATTERNS.melgen = [[0.1, 64, 0.3], [0.5, 67, 0.3], [0.9, 71, 0.5], [1.5, 69, 0.6]].map(([t, n, d], i) =>
  [t, { kind: 'note', part: 'melgen', id: i + 1, note: n, vel: 0.8, dur: d, accent: i === 2 }]);
PATTERNS.arp = [[0.1, 60, 0.2], [0.35, 64, 0.2], [0.6, 67, 0.2], [0.85, 72, 0.3]].map(([t, n, d], i) =>
  [t, { kind: 'note', part: 'arp', id: i + 1, note: n, vel: 0.8, dur: d, level: 1, pan: i % 2 ? 0.3 : -0.3 }]);
PATTERNS.mel = [[0.1, 72, 0.6], [0.9, 76, 0.8]].map(([t, n, d], i) =>
  [t, { kind: 'note', part: 'mel', id: i + 1, note: n, vel: 0.8, dur: d, y: 0.2 }]);
PATTERNS.chord = [[0.1, 60, [60, 64, 67], 1.0], [1.3, 65, [65, 69, 72], 1.2]].map(([t, r, notes, d], i) =>
  [t, { kind: 'chord', part: 'chord', id: i + 1, root: r, notes, bass: null, vel: 0.8, dur: d }]);
PATTERNS.sampler = [
  [0.10, { kind: 'clip', part: 'sampler', id: 'c1', asset: 'a1', level: 0.7, rate: 1, from: 0, to: 1, loop: null }],
  [0.60, { kind: 'clip', part: 'sampler', id: 'c2', asset: 'a1', level: 0.6, rate: 1.5, from: 0.2, to: 0.4, loop: 'window' }],
  [1.30, { kind: 'release', part: 'sampler', id: 'c2', fade: 0.05 }],
  [1.50, { kind: 'clip', part: 'sampler', id: 'c3', asset: 'a1', level: 0.7, rate: 0.75, from: 0.1, to: 0.9, loop: null }],
];
PATTERNS.glide = [
  [0.10, { kind: 'glide', part: 'mel', id: 9, note: 69, hz: 440, vel: 0.8, y: 0.3 }],
  [0.30, { kind: 'param', part: 'mel', id: 9, name: 'hz', value: 493.9 }],
  [0.50, { kind: 'param', part: 'mel', id: 9, name: 'y', value: 0.7 }],
  [0.90, { kind: 'release', part: 'mel', id: 9 }],
];
PATTERNS.drumjazz = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10].map((lane, i) =>
  [0.10 + i * 0.28, { kind: 'hit', part: 'drum', id: i + 1, kit: 'JAZZ', lane, vel: 0.8, accent: false, pitch: 0, dyn: null }]);
PATTERNS.rhythm = [0, 1, 2, 2, 0, 1].map((lane, i) =>
  [0.10 + i * 0.3, { kind: 'hit', part: 'drum', id: i + 1, kit: 'rhythm/808', lane, vel: 0.8, accent: i === 1, pitch: 0, dyn: null }]);
PATTERNS.click = [[0.1, false], [0.6, true], [1.1, false]].map(([t, a], i) => [t, { kind: 'hit', part: 'click', id: i + 1, accent: a }]);

function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

async function pageRun(a) {
  const { mode, part, pattern, sr, seconds, voice } = a;
  let s = 24680 >>> 0;
  Math.random = function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const offline = new OfflineAudioContext(2, Math.round(sr * seconds), sr);
  audioCtx = offline;                                  // the page's own context, for this run
  const sink = offline.createGain(); sink.connect(offline.destination);
  masterDest = function () { return sink; };           // the master chain is not what is being compared
  // The two rooms a voice can send to are stand-ins that go straight to the
  // output, so what is compared includes the sends (with their levels).
  const room = offline.createGain(); room.connect(offline.destination);
  window._chordRevFeed = room; reverbNode = room;
  Object.assign(window._webParams, { 'chord.reverb': 0.4, 'mel.reverb': 0.5 });
  const events = [];
  if (mode === 'graph') {
    MODGRAPH.debug = true;
    modGraphEnable({
      graphBuf: m => events.push({ type: 1, frame: 0, gid: 0, payload: [m.id, m.sampleRate, m.channels.length, 0, m.channels.map(c => c) ] , b64: m.channels }),
      graphBegin: m => events.push({ type: 2, frame: Math.round(m.base * sr), gid: m.gid, b64: m.program }),
      graphEdit: m => events.push({ type: 3, frame: 0, gid: m.gid, b64: m.increments }),
    }, [part]);
  }
  if (part === 'drum' && a.drumSamples) {
    window.preloadDrumSamples();
    for (let i = 0; i < 300 && Object.keys(window._drumBuffers()).length < 7; i++) await new Promise(r => setTimeout(r, 100));
    if (Object.keys(window._drumBuffers()).length < 7) throw new Error('drum samples did not load');
  }
  if (voice) {
    // A recorded instrument: the page's own loader fetches and decodes it (on
    // the context standing in for the page's), and the part is set to play it.
    window._webParams[part + '.voice'] = voice;
    const key = SAMPLED_WAVES[voice] || (BASS_SAMPLED[voice] && BASS_SAMPLED[voice].lib);
    preloadSampleInstrument(key);
    for (let i = 0; i < 300 && SAMPLE_STATE[key] !== 'ready'; i++) await new Promise(r => setTimeout(r, 100));
    if (SAMPLE_STATE[key] !== 'ready') throw new Error('sampled voice ' + voice + ' did not load: ' + SAMPLE_STATE[key]);
  }
  if (part === 'sampler') {
    // A clip handed over once, as the sampler does (smpBufSet): a decaying tone
    // with some noise on it, from the seeded generator.
    const n = Math.round(sr * 1.5), buf = offline.createBuffer(2, n, sr);
    let q = 4242 >>> 0; const rnd = () => { q = (q + 0x6D2B79F5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.sin(2 * Math.PI * (220 + 40 * c) * i / sr) * Math.exp(-i / (0.5 * sr)) + (rnd() * 2 - 1) * 0.1) * 0.8; }
    window.modEngine.send({ v: 1, kind: 'asset', part: 'sampler', id: 'a1', rate: sr, channels: 2, frames: n, buffer: buf });
  }
  // Buses are built before the voices in both runs, so the random numbers the
  // voices draw (detune, phase) come in the same order in both.
  _ensureAllPartBuses(offline);
  { let q = 13579 >>> 0; Math.random = function () { q = (q + 0x6D2B79F5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  for (const [at, msg] of pattern) window.modEngine.send(Object.assign({ v: 1, at }, msg));
  await Promise.resolve(); await Promise.resolve();
  if (mode === 'graph') {
    return { events, last: MODGRAPH.last || null, stat: { sent: MODGRAPH.sent, fell: MODGRAPH.fellBack, why: MODGRAPH.why, edits: MODGRAPH.edits, empty: MODGRAPH.empty } };
  }
  const b = await offline.startRendering();
  const L = b.getChannelData(0), R = b.getChannelData(1), o = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { o[2 * i] = L[i]; o[2 * i + 1] = R[i]; }
  return { f32: Array.from(o) };
}

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const run = async mode => {
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'warning' && /modGraph|modEngine/.test(m.text())) errs.push(m.text()); });
    await page.goto(url); await page.waitForTimeout(1200);
    const r = await page.evaluate(pageRun, { mode, part: WEBPART, voice: VOICE, drumSamples: PART === 'drumjazz', pattern: process.env.EVENTS ? JSON.parse(process.env.EVENTS) : ONLY ? PATTERNS[PART].filter((_, i) => ONLY.includes(i)) : PATTERNS[PART], sr: SR, seconds: SECONDS });
    await page.close();
    r.errs = errs;
    return r;
  };
  const real = await run('real'), g = await run('graph');
  if (g.errs.length) console.log('page said:', g.errs.slice(0, 4));
  console.log('page sent', JSON.stringify(g.stat));
  if (g.last) console.log('last fallback:', JSON.stringify(g.last));
  // the script graphmix reads
  const out = [];
  let n = 0;
  const push = (type, frame, gid, payload) => { out.push(type, frame, gid, payload.length); for (let i = 0; i < payload.length; i++) out.push(payload[i]); n++; };
  for (const e of g.events) {
    if (e.type === 1) {
      const chans = e.b64.map(b => Array.from(new Float32Array(Buffer.from(b, 'base64').buffer.slice(0))));
      const payload = [e.payload[0], e.payload[1], chans.length, chans[0].length]; chans.forEach(c => c.forEach(v => payload.push(v)));
      push(1, 0, 0, payload);
    } else {
      const buf = Buffer.from(e.b64, 'base64');
      push(e.type, e.frame, e.gid, Array.from(new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))));
    }
  }
  const sf = path.join(tmp, 'script.f64'), of = path.join(tmp, 'out.f32');
  const script = new Float64Array(out.length + 1); script[0] = n; for (let i = 0; i < out.length; i++) script[i + 1] = out[i];
  fs.writeFileSync(sf, Buffer.from(script.buffer));
  execFileSync(path.join(root, 'native/modsynth/graphmix'), [sf, BUSES(PART), String(SECONDS), of]);
  const nat = new Float32Array(fs.readFileSync(of).buffer.slice(0)), ref = Float32Array.from(real.f32);
  let a = 0, e = 0, pk = 0, pn = 0;
  for (let i = 0; i < ref.length; i++) { a += ref[i] ** 2; e += (ref[i] - nat[i]) ** 2; pk = Math.max(pk, Math.abs(ref[i])); pn = Math.max(pn, Math.abs(nat[i])); }
  // level per 50 ms, to see where a miss is
  const W = SR * 0.05 * 2; let worst = 0, at = 0;
  for (let w = 0; w + W <= ref.length; w += W) {
    let x = 0, y = 0; for (let i = w; i < w + W; i++) { x += ref[i] ** 2; y += nat[i] ** 2; }
    // only windows that are audible: a tail at -80 dBFS is judged by the overall figure
    if (x / (W / 2) > 1e-5) { const d = Math.abs(10 * Math.log10((y + 1e-20) / x)); if (d > worst) { worst = d; at = w / 2 / SR; } }
  }
  if (process.env.DUMP) { fs.mkdirSync(process.env.DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.DUMP, 'ref.f32'), Buffer.from(ref.buffer)); fs.writeFileSync(path.join(process.env.DUMP, 'nat.f32'), Buffer.from(nat.buffer.slice(0))); }
  const snr = 10 * Math.log10(a / Math.max(e, 1e-30));
  console.log(`${PART}: ${g.stat.sent} voices, ${g.stat.edits} edits, peak ${pk.toFixed(3)} vs ${pn.toFixed(3)}, ${snr.toFixed(1)} dB, worst 50 ms window ${worst.toFixed(2)} dB at ${at.toFixed(2)} s`);
  const ok = pk > 0.01 && g.stat.fell === 0 && snr >= 60 && worst < 0.5;
  console.log(ok ? 'ok' : 'FAIL');
  await browser.close(); srv.close();
  process.exit(ok ? 0 : 1);
})();
