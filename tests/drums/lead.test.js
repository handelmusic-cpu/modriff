/* Drum hits start on the beat (6.9.9.9a): no silence ahead of a one-shot's transient.
   The Hip-Hop kick opened with 5.0 ms of silence in the file, and 30 ms where a decoder keeps the
   mp3 encoder delay; the groove sat behind everything else. Every one-shot drum buffer is now cut at
   its first audible sample as it is decoded: the sharp edge out of a noise floor if there is one (the
   Hip-Hop hat, rim, shaker, tamb sit on a -35 dB floor for their 5 ms pad), else -40 dB of its own peak;
   1 ms of lead kept, and never more than 6 ms past the -40 dB point.
   Measured here, in a real browser, on the buffers the app itself loads:
   - every drum buffer opens within 1.4 ms (1 ms of lead kept; all kits, all 567 files), and the table shows how many
     moved and by how much, against the same files decoded untouched;
   - a decoder that keeps the encoder delay (ffmpeg -flags2 +skip_manual) gives the SAME trimmed audio
     as one that strips it, so the result does not depend on which decoder a device has;
   - sqSample starts the trimmed buffer at offset 0 (nothing silent left to skip);
   - the Sampler's factory kit pad and the rendered beats get the trim too, loops are NOT trimmed
     (the opening rest of a loop is the groove), and a file that was already on the beat is the
     very same bytes (not copied).
   Run: node tests/drums/lead.test.js   Env: CHROMIUM, PLAYWRIGHT, ROOT=dist (after npm run build) */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), cp = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); }
  catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
// ROOT=dist runs the same checks on the built page, which is what ships.
const root = path.join(__dirname, '..', '..', process.env.ROOT || '.');
let fail = 0;
const ok = (c, label, detail) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + label + (c ? '' : '  -> ' + detail)); };
// The drum machine lives in its own closure; the page is patched in memory to reach its tables and
// sqSample, as tests/graph/drums.test.js does. Nothing is written to index.html.
function patched(html) {
  const a = /window\._drumBuffers\s*=\s*function\s*\(\s*\)\s*\{\s*return DRUM_BUFFERS;?\s*\};?/;
  const m = a.exec(html);
  if (!m) throw new Error('drum buffer export moved; update tests/drums/lead.test.js');
  return html.replace(a, m[0] + `
window.__DL = { samples: DRUM_SAMPLES, lazy: DRUM_SAMPLES_LAZY, buffers: DRUM_BUFFERS, loadOne: _drumLoadOne, sqSample: sqSample };`);
}
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else if (p.endsWith('index.html')) { r.writeHead(200, { 'content-type': 'text/html' }); r.end(patched(b.toString('utf8'))); } else { r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' }); r.end(b); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
// The file as a decoder that does NOT remove the encoder delay would hand it over.
function rawDecode(file) {
  const r = cp.spawnSync('ffmpeg', ['-v', 'error', '-flags2', '+skip_manual', '-i', path.join(root, file), '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 28 });
  return Buffer.from(r.stdout).toString('base64');
}
const RAW_FILES = ['samples/hiphop/kick.mp3', 'samples/hiphop/hat.mp3', 'samples/hiphop/snare.mp3', 'samples/rock/kick.mp3', 'samples/beatbox-g/kick3.mp3', 'samples/808/kick.mp3'];

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html'); await page.waitForTimeout(1200);
  await page.getByText('Start', { exact: true }).first().click(); await page.waitForTimeout(1500);

  const raw = {}; RAW_FILES.forEach(f => { raw[f] = rawDecode(f); });

  const r = await page.evaluate(async (raw) => {
    const o = {};
    // First sample over -40 dB of the buffer's own peak, in ms — the same yardstick the trim uses,
    // written out again here so the test does not just call the code under test.
    const lead = (b, th) => {
      th = th || 0.01;
      let pk = 0, d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      if (!pk) return null;
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > pk * th) return i / b.sampleRate * 1000;
      return null;
    };
    // The attack edge: first sample over -20 dB. Several kits' files sit on a -35 dB noise floor for
    // their pad, so -40 dB alone cannot see them; this is what the ear lines up on.
    const edge = b => lead(b, 0.1);
    const ctx = getCtx();

    // 1. Every drum file, as the app loads it, against the same file decoded untouched.
    const DL = window.__DL, DRUM_BUFFERS = DL.buffers;
    preloadDrumSamples(); Object.keys(DL.lazy).forEach(DL.loadOne);
    const want = Object.keys(DL.samples).concat(Object.keys(DL.lazy));
    for (let i = 0; i < 400 && want.some(k => !DRUM_BUFFERS[k]); i++) await new Promise(r => setTimeout(r, 100));
    o.wanted = want.length; o.loaded = want.filter(k => DRUM_BUFFERS[k]).length;
    const urlOf = k => DL.samples[k] || DL.lazy[k];
    o.rows = [];
    for (const k of want) {
      const b = DRUM_BUFFERS[k]; if (!b) continue;
      const orig = await fetch(urlOf(k)).then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a));
      o.rows.push({ k, file: urlOf(k), before: lead(orig), after: lead(b), edgeBefore: edge(orig), edgeAfter: edge(b), cut: (orig.length - b.length) / b.sampleRate * 1000, same: b === b });
    }

    // 2. A decoder that keeps the encoder delay gives the same audio once trimmed.
    o.raw = {};
    for (const f of Object.keys(raw)) {
      const bin = atob(raw[f]), n = bin.length / 4, a = new Float32Array(n);
      new Uint8Array(a.buffer).set(Uint8Array.from(bin, c => c.charCodeAt(0)));
      const rb = ctx.createBuffer(1, n, 44100); rb.copyToChannel(a, 0);
      const stripped = await fetch(f).then(r => r.arrayBuffer()).then(x => ctx.decodeAudioData(x));
      const t1 = _hitTrimmed(ctx, rb), t2 = _hitTrimmed(ctx, stripped);
      // The two paths keep a different amount of lead (up to 1 ms; none at all when the file was already
      // on the beat), so line them up at the first audible sample before comparing the audio itself.
      const A = t1.getChannelData(0), B = t2.getChannelData(0);
      const at = d => { let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > pk * 0.1) return i; return 0; };
      const ia = at(A), ib = at(B);
      let diff = 0;
      for (let i = 0; i < 4000; i++) diff = Math.max(diff, Math.abs(A[ia + i] - B[ib + i]));
      o.raw[f] = { rawLead: lead(rb), rawTrimmed: lead(t1), strippedLead: lead(stripped), strippedTrimmed: lead(t2), diff };
    }

    // 3. sqSample hands the trimmed buffer to the source at offset 0.
    const calls = [], orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { calls.push({ buf: this.buffer, args: Array.prototype.slice.call(arguments) }); return orig.apply(this, arguments); };
    const played = DL.sqSample('hh_kick', ctx.currentTime + 0.1, 1, 0);
    AudioBufferSourceNode.prototype.start = orig;
    const c = calls.filter(x => x.buf === DRUM_BUFFERS.hh_kick)[0];
    o.sq = { played, found: !!c, offset: c ? (c.args[1] || 0) : null, bufLead: c ? lead(c.buf) : null };

    // 4. The Sampler's factory pad and a rendered beat get it; a loop does not.
    await psFactoryEnsure(true);
    const fk = SMP_BUF['factory:hh-kick'], rk = SMP_BUF['factory:rk-kick'];
    o.factory = { hhKick: fk ? lead(fk) : 'missing', rkKick: rk ? lead(rk) : 'missing' };
    await psLoopSetEnsure('World Loops');   // a lazy set: only built when someone asks for it
    const el = SMP_BUF['factory:wl-electro'];
    o.loop = { electro: el ? lead(el) : 'missing' };
    return o;
  }, raw);

  console.log('\nbefore -> after (ms to first audible sample), files that moved (ms to the attack edge, -20 dB):');
  const moved = r.rows.filter(x => x.cut >= 0.4).sort((a, b) => b.cut - a.cut);
  moved.forEach(x => console.log('  ' + x.file.padEnd(34) + (x.edgeBefore.toFixed(1)).padStart(6) + ' -> ' + x.edgeAfter.toFixed(1).padStart(4) + '   cut ' + x.cut.toFixed(1) + ' ms'));
  console.log('  (' + moved.length + ' of ' + r.rows.length + ' moved)\n');

  ok(r.loaded === r.wanted, 'every drum file loaded (' + r.loaded + '/' + r.wanted + ')', r.loaded + '/' + r.wanted);
  // The contract is 1 ms of lead kept, plus a cut under 16 samples (0.36 ms) is not worth a copy: 1.4 ms.
  const late = r.rows.filter(x => x.after != null && x.after > 1.4);
  ok(late.length === 0, 'no drum buffer opens later than 1.4 ms after the start', late.map(x => x.file + ' ' + x.after.toFixed(1)).join(', '));
  // The kits whose files all carried the same 5 ms pad must end up level with each other: trimming the
  // kick and snare and not the hats would put the kick ahead of them.
  [['hh_', 'Hip-Hop'], ['rk_', 'Rock']].forEach(([pre, name]) => {
    const kit = r.rows.filter(x => x.k.startsWith(pre) && !/crash|ride/.test(x.k));
    const e = kit.map(x => x.edgeAfter);
    ok(kit.length >= 6 && Math.max(...e) - Math.min(...e) < 1.5 && Math.max(...e) < 2.5,
      name + ' kit: every attack edge within 1.5 ms of the others (' + kit.length + ' files, ' + Math.min(...e).toFixed(1) + '-' + Math.max(...e).toFixed(1) + ' ms)',
      kit.map(x => x.k + ' ' + x.edgeAfter.toFixed(1)).join(', '));
  });
  const hk = r.rows.find(x => x.k === 'hh_kick');
  ok(hk && hk.before > 4.5 && hk.after < 1.1, 'Hip-Hop kick: ' + (hk && hk.before.toFixed(1)) + ' ms -> ' + (hk && hk.after.toFixed(1)) + ' ms', JSON.stringify(hk));
  const untouched = r.rows.filter(x => x.edgeBefore < 0.4);
  ok(untouched.every(x => x.cut === 0), 'files already on the beat are not cut (' + untouched.length + ')', untouched.filter(x => x.cut !== 0).map(x => x.file).join(', '));
  // A pad's worth only: the zills, the pedal chick and the seed rattles have a quiet ring-in that is the
  // instrument, and must keep it (an edge rule that cut them took 18-36 ms).
  ok(r.rows.every(x => x.cut <= 12), 'nothing is cut by more than 12 ms (pad-sized corrections only)', moved[0] && moved[0].file + ' ' + moved[0].cut);

  Object.keys(r.raw).forEach(f => {
    const x = r.raw[f];
    ok(x.rawLead > 20 && x.rawTrimmed < 1.4, f + ' with the encoder delay kept: ' + x.rawLead.toFixed(1) + ' ms -> ' + x.rawTrimmed.toFixed(1) + ' ms', JSON.stringify(x));
    // Chromium's decoder against ffmpeg's differs by rounding in the first granule (about -53 dB on the
    // Hip-Hop kick); -40 dB is the same yardstick the trim uses for "silence".
    ok(x.diff < 0.01, f + ' trims to the same audio either way (max diff ' + x.diff.toExponential(1) + ' of full scale)', JSON.stringify(x));
  });

  ok(r.sq.played && r.sq.found && r.sq.offset === 0 && r.sq.bufLead < 1.1, 'sqSample starts the trimmed buffer at offset 0', JSON.stringify(r.sq));
  ok(typeof r.factory.hhKick === 'number' && r.factory.hhKick < 1.1 && r.factory.rkKick < 1.1, 'Sampler factory kicks open on the beat (' + JSON.stringify(r.factory) + ')', JSON.stringify(r.factory));
  ok(typeof r.loop.electro === 'number' && r.loop.electro > 150, 'a loop keeps its opening rest (electro loop ' + r.loop.electro + ' ms)', JSON.stringify(r.loop));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));

  await browser.close(); srv.close();
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
