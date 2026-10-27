/* Regenerates modsynth/patches-levels.js: one gain per mõdSynth patch.

   What the table is for: stepping through the library should sound like the same
   loudness, and no patch should jump out when it is the part you are playing.

   What it measures (4.9.9.9.9.9.5w; before it was flat RMS on one chord):
   - K-weighted loudness (ITU-R BS.1770: the shelf and the high-pass, no gate),
     not RMS. A bright, transient patch (a pluck, a bell, a stab) read as loud
     as a pad at the same RMS and was heard as much louder: matched on a
     four-note chord it sat a median 3 dB over the library once it was played as
     a line, and peaked 3 to 5 dB higher.
   - Two phrases for a polyphonic patch: the audit's four-note chord on the chord
     part and a line in the Melody Seq's register on the melody part (both parts'
     buses are unity, so nothing but the patch is in the number). The patch's
     deviation from the app's own voices is the lower of the two, in dB: a pluck
     that is only loud as a line is cut to the line (its chord reading looks fine
     and the mean of the two let it through), and a pad that is quiet as a line
     but right as a chord is left alone. A mono or
     bass patch gets the audit's low line on the bass part, against the
     dedicated bass voices, as before.
   - A peak ceiling at the bus (-12 dBFS for the unity parts, -6 for the bass).
     The old rule (-3 dBFS) never bound: the peakiest patches sat at -7 to -11.

   The part offsets (MSX_BUS_CAL and the two bus gains) are NOT in this table and
   not touched by it: a part's mõdSynth sits at the level of that part's own
   built-in voices, and that is what the faders were set against.

   Run (the repo served, Chromium):
     python3 -m http.server 8777 --bind 127.0.0.1 &
     node tests/levels/trims.js refs  refs.json            # the app's own voices
     node tests/levels/trims.js shard 0/4 s0.json          # a quarter of the library (x4, in parallel)
     node tests/levels/trims.js write refs.json s0.json s1.json s2.json s3.json
     node tests/levels/trims.js check refs.json s0.json ... # after, the same, against the table now on disk
   Takes about 6 s a patch; the shards run side by side. `write` also lists
   every patch whose trim moved more than 2 dB. Env: URL, CHROMIUM. */
'use strict';
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); }

const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const TABLE = path.join(__dirname, '..', '..', 'modsynth', 'patches-levels.js');
const CHORD_VOICES = ['sine', 'sawtooth', 'square', 'piano', 'rhodes', 'organ', 'pad', 'supersaw'];
const BASS_VOICES = ['electric', 'upright', 'upright_real', 'upright2', 'bass_picked', 'bass_motown', 'bass_hofner', 'sawtooth', 'acid303', 'square', 'triangle', 'sine'];
const NOISY = ['supersaw', 'pad'];
const CEIL_DB = { chord: -12, line: -12, bass: -6 };

const db = x => x > 0 ? 20 * Math.log10(x) : -99;
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// Runs in the page: one phrase on one part with a voice or a patch, the bus tapped,
// K-weighted loudness and peak out. `phrase` is chord, line or bass.
async function measure([phrase, voice, patch]) {
  const part = { chord: 'chord', line: 'mel', bass: 'bass' }[phrase];
  const ctx = getCtx(); await ctx.resume();
  const bus = _ensureAllPartBuses(ctx)[part], E = window.modEngine;
  let id = 1000 + Math.floor(Math.random() * 1e5);
  E.send({ v: 1, kind: 'param', part, name: 'voice', value: voice });
  if (patch) {
    E.send({ v: 1, kind: 'param', part, name: 'msx', value: { patch } });
    if (!await msxEnsure(part)) return null;
    msxApply(part);
  }
  stopAll();
  await new Promise(r => setTimeout(r, 600));
  // BS.1770 K-weighting: stage 1 the head shelf, stage 2 the RLB high-pass.
  const fs_ = ctx.sampleRate;
  const stage = (b, a) => ({ b, a, z: [[0, 0, 0, 0], [0, 0, 0, 0]] });
  const shelf = (() => { const G = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / fs_), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    return stage([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]); })();
  const rlb = (() => { const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / fs_), a0 = 1 + K / Q + K * K;
    return stage([1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]); })();
  const kf = (c, x) => { let v = x; for (const s of [shelf, rlb]) { const z = s.z[c], y = s.b[0] * v + s.b[1] * z[0] + s.b[2] * z[1] - s.a[1] * z[2] - s.a[2] * z[3]; z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y; v = y; } return v; };
  const sp = ctx.createScriptProcessor(1024, 2, 2); let kk = 0, n = 0, pk = 0, on = false;
  sp.onaudioprocess = e => {
    if (!on) return;
    for (let c = 0; c < 2; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = d[i]; const y = kf(c, x); kk += y * y; n++; const a = Math.abs(x); if (a > pk) pk = a; } }
  };
  const z = ctx.createGain(); z.gain.value = 0;
  bus.connect(sp); sp.connect(z); z.connect(ctx.destination);
  const T0 = ctx.currentTime + 0.15; on = true;
  if (phrase === 'chord') setTimeout(() => E.send({ v: 1, kind: 'chord', part: 'chord', id: ++id, root: 60, notes: [48, 55, 60, 64], bass: null, vel: 1, at: null, dur: 1.4 }), 150);
  else if (phrase === 'line') [72, 76, 79, 76, 72, 79, 76, 72].forEach((m, i) => E.send({ v: 1, kind: 'note', part: 'mel', id: ++id, note: m, vel: 0.9, at: T0 + i * 0.25, dur: 0.22 }));
  else [36, 43, 40, 43, 36, 43, 40, 43].forEach((m, i) => E.send({ v: 1, kind: 'note', part: 'bass', id: ++id, note: m, at: T0 + i * 0.3, dur: 0.28, vel: 1, accent: i % 4 === 0, slide: false, from: null }));
  await new Promise(r => setTimeout(r, phrase === 'bass' ? 2700 : phrase === 'line' ? 2500 : 2400));
  on = false; bus.disconnect(sp);
  try { sp.disconnect(); z.disconnect(); } catch (e) {}
  stopAll(); try { E.send({ v: 1, kind: 'stop', part }); } catch (e) {}
  return { k: Math.sqrt(kk / Math.max(1, n)), pk };
}

async function open() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  await page.goto(URL); await page.waitForTimeout(1500);
  await page.click('.unlock-btn >> text=Start'); await page.waitForTimeout(1500);
  await page.evaluate(async () => { await getCtx().resume(); await msxLoadLib(); });
  return { browser, page };
}

async function refs(out) {
  const { browser, page } = await open();
  const r = { chord: [], line: [], bass: [] };
  for (const [phrase, list] of [['chord', CHORD_VOICES], ['line', CHORD_VOICES], ['bass', BASS_VOICES]]) {
    for (const v of list) {
      const reps = NOISY.includes(v) ? 4 : 1, ks = [];
      for (let i = 0; i < reps; i++) ks.push((await page.evaluate(measure, [phrase, v, null])).k ** 2);
      r[phrase].push(db(Math.sqrt(mean(ks))));
    }
  }
  const ref = { chord: median(r.chord), line: median(r.line), bass: median(r.bass) };
  console.log('references (K-weighted dB):', JSON.stringify(ref));
  fs.writeFileSync(out, JSON.stringify(ref)); await browser.close();
}

async function shard(spec, out) {
  const [si, sn] = spec.split('/').map(Number);
  const { browser, page } = await open();
  const list = (await page.evaluate(() => msxAllPatches().map(x => ({ name: x.name, cat: x.category,
    bassy: !!(x.values['voice.mode'] && x.values['voice.mode'] !== 'poly') || /bass|sub|kick/.test((x.tags || []).join(' ') + String(x.category).toLowerCase()),
    trim: MS.PATCH_TRIM[x.name] == null ? null : MS.PATCH_TRIM[x.name] })))).filter((_, i) => i % sn === si);
  const res = [];
  for (const p of list) {
    const r = { name: p.name, cat: p.cat, bassy: p.bassy, trim: p.trim };
    if (p.bassy) r.bass = await page.evaluate(measure, ['bass', 'modsynth', p.name]);
    else { r.chord = await page.evaluate(measure, ['chord', 'modsynth', p.name]); r.line = await page.evaluate(measure, ['line', 'modsynth', p.name]); }
    res.push(r);
  }
  fs.writeFileSync(out, JSON.stringify(res)); await browser.close();
}

// K-weighting reads a dark, low patch (a pad, a string section) as quieter than flat RMS
// does, so measured against the app's voices the whole library would move up by a few
// dB and every patch that sits right in the mix now would be louder. The table is
// anchored instead: the median patch of each class (polyphonic, bass) does not move,
// and only the differences between patches change.
function anchors(all, ref) {
  const w = { poly: [], bass: [] };
  for (const r of all) w[r.bassy ? 'bass' : 'poly'].push(judge(r, ref).want);
  return { poly: median(w.poly), bass: median(w.bass) };
}

// One patch: how far (dB) its loudness is from the app's voices, and the most its
// trim may rise before a peak passes the ceiling. Both read from a measurement
// taken with `trim` applied.
function judge(r, ref) {
  const devs = [], caps = [];
  for (const [ph, key] of r.bassy ? [['bass', 'bass']] : [['chord', 'chord'], ['line', 'line']]) {
    const m = r[key]; if (!m || !(m.k > 0)) continue;
    devs.push(ref[ph] - db(m.k));                       // dB to add to land on the reference
    caps.push(CEIL_DB[ph] - db(m.pk));                  // dB of headroom before the ceiling
  }
  return { want: Math.min(...devs), cap: Math.min(...caps), devs, caps };
}

function readAll(files) { return [].concat(...files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')))); }

function write(refFile, files) {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8')), all = readAll(files), out = {}, moved = [], anc = anchors(all, ref);
  console.log('anchors (the median patch\'s distance from the reference, left where it is): polyphonic ' + anc.poly.toFixed(1) + ' dB, bass ' + anc.bass.toFixed(1) + ' dB');
  for (const r of all) {
    const j = judge(r, ref), old = r.trim == null ? 1 : r.trim;
    const step = Math.min(j.want - anc[r.bassy ? 'bass' : 'poly'], j.cap);   // to its class's median, but never past the ceiling
    const t = +(old * Math.pow(10, step / 20)).toFixed(3);
    out[r.name] = t;
    const d = 20 * Math.log10(t / old);
    if (Math.abs(d) > 2) moved.push({ n: r.name, d, capped: j.cap < j.want });
  }
  const names = Object.keys(out).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const body = names.map(n => '    ' + JSON.stringify(n) + ': ' + out[n]).join(',\n');
  const src = fs.readFileSync(TABLE, 'utf8');
  const a = src.indexOf('MS.PATCH_TRIM = {'), b = src.indexOf('\n  };', a);
  if (a < 0 || b < 0) throw new Error('could not find the table in ' + TABLE);
  fs.writeFileSync(TABLE, src.slice(0, a) + 'MS.PATCH_TRIM = {\n' + body + src.slice(b));
  console.log(names.length + ' patches written; ' + moved.length + ' moved more than 2 dB (' + moved.filter(m => m.d < 0).length + ' down, ' + moved.filter(m => m.d > 0).length + ' up, ' + moved.filter(m => m.capped).length + ' held by the peak ceiling)');
  moved.sort((x, y) => x.d - y.d).forEach(m => console.log('  ' + m.n.padEnd(26) + (m.d >= 0 ? '+' : '') + m.d.toFixed(1) + ' dB' + (m.capped ? '  (peak ceiling)' : '')));
}

// A measurement taken with the table on disk: how far each patch still is.
function check(refFile, files) {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8')), all = readAll(files);
  const anc = anchors(all, ref);
  const rows = all.map(r => { const j = judge(r, ref); return { n: r.name, dev: -(j.want - anc[r.bassy ? 'bass' : 'poly']), over: -j.cap }; });
  const sd = x => Math.sqrt(mean(x.map(v => (v - mean(x)) ** 2)));
  console.log('loudness vs the app\'s voices, dB: sd ' + sd(rows.map(r => r.dev)).toFixed(2) + ', worst ' + Math.max(...rows.map(r => Math.abs(r.dev))).toFixed(1));
  const off = rows.filter(r => Math.abs(r.dev) > 2).sort((x, y) => Math.abs(y.dev) - Math.abs(x.dev));
  if (off.length) console.log(off.length + ' patches more than 2 dB from the others: ' + off.slice(0, 12).map(r => r.n + ' ' + (r.dev >= 0 ? '+' : '') + r.dev.toFixed(1)).join(', '));
  const over = rows.filter(r => r.over > 0.05);
  console.log(over.length + ' patches past a peak ceiling' + (over.length ? ': ' + over.slice(0, 12).map(r => r.n + ' +' + r.over.toFixed(1)).join(', ') : ''));
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'refs') await refs(a);
  else if (cmd === 'shard') await shard(a, b);
  else if (cmd === 'write') write(a, process.argv.slice(4));
  else if (cmd === 'check') check(a, process.argv.slice(4));
  else { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(2); }
})();
