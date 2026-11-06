/* The native-scheduling spike (docs/native-scheduling.md, slice 0): is a replayed voice program the same
   sound as one the page records fresh?  The page half is replay.inpage.js; the host half is
   native/modsynth/replaytest (make -C native/modsynth replaytest).

   Three ways to run it (repo served on 8777 for the first two):
     node tests/graph/replay.test.js               Playwright + Chromium drive the page
     node tests/graph/replay.test.js --serve       listens on :8778 and waits for the page to POST its result:
                                                   in any browser on the served page, run
                                                   fetch('/tests/graph/replay.inpage.js').then(r=>r.text()).then(t=>{(0,eval)(t);
                                                   return __replaySpike()}).then(r=>fetch('http://127.0.0.1:8778/',{method:'POST',body:JSON.stringify(r)}))
     node tests/graph/replay.test.js --from DIR    re-run the host half on DIR/cases.f64 + DIR/cases.json
   Env: URL, CHROMIUM, PLAYWRIGHT, OUT (where cases.f64 / cases.json go; default a temp dir), PASS_DB (default 90).

   Pass for a case: the two are bit-identical or the null is at least PASS_DB. A case that fails is printed
   with what differs, because the point of the spike is to learn which voices cannot be replayed. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
const PASS_DB = parseFloat(process.env.PASS_DB || '90');          // exact: bit-identical or this deep
const CLOSE_DB = parseFloat(process.env.CLOSE_DB || '50');        // close: an error under 0.3% of the signal; a judgment, not a measurement of hearing
// Voices the spike found cannot be patched this way (see docs/native-scheduling.md); the test expects them to stay that way.
// 808 lane 6 and 909 lane 3 are noise voices whose own recordings differ with the absolute start time (the control
// row shows the same gap with no replay involved), so a replay cannot match a recording made at another time.
const KNOWN_DIFFERENT = ['drum 808 lane 6', 'drum 909 lane 3', 'chord (major triad, transposed)'];

function judge(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8')); console.log('buffers handed over: ' + meta.buffers + (meta.bufferConflicts && meta.bufferConflicts.length ? ', CONFLICTING IDS ' + meta.bufferConflicts.join() : ''));
  const bin = path.join(__dirname, '..', '..', 'native', 'modsynth', 'replaytest');
  if (!fs.existsSync(bin)) { console.error('build it first: make -C native/modsynth replaytest'); process.exit(2); }
  const r = spawnSync(bin, [path.join(dir, 'cases.f64'), String(meta.seconds)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  const rows = r.stdout.trim().split('\n').map(l => l.split(' '));
  let fails = 0, shown = 0;
  const byClass = {}, phase = {}, ctl = {};
  rows.forEach((row, i) => {
    const n = meta.names[i], depth = parseFloat(row[1]);
    const cls = n.label.split(': ')[0];
    if (n.phase) { (phase[cls] = depth); return; }
    if (n.control) { (ctl[cls] = Math.min(ctl[cls] === undefined ? 1e9 : ctl[cls], depth)); return; }
    const bestDepth = parseFloat(row[4]), bestOff = parseInt(row[5], 10);
    // exact, or exact to within a whole frame of onset (not counted as a pass: reported on its own)
    const near = !(depth >= PASS_DB) && bestDepth >= PASS_DB && bestOff !== 0;
    if (near) { (byClass[cls] = byClass[cls] || { n: 0, pass: 0, worst: 1e9, near: 0 }); byClass[cls].near = (byClass[cls].near || 0) + 1; }
    const ok = row[1] !== 'refused' && (depth >= PASS_DB || near);
    const b = byClass[cls] = byClass[cls] || { n: 0, pass: 0, worst: 1e9 };
    b.exact = (b.exact || 0) + (depth >= PASS_DB ? 1 : 0); b.close = (b.close || 0) + (depth < PASS_DB && depth >= CLOSE_DB ? 1 : 0); b.far = (b.far || 0) + (depth < CLOSE_DB ? 1 : 0);
    (byClass[cls] = byClass[cls] || { n: 0, pass: 0, worst: 1e9 });
    byClass[cls].n++; if (ok) byClass[cls].pass++; byClass[cls].worst = Math.min(byClass[cls].worst, depth);
    if (!ok) fails++;
    if (!ok && shown++ < 40) console.log('FAIL ' + n.label + '  null ' + row[1] + ' dB  peak ' + row[2] + '  maxdiff ' + row[3] + '  voices ' + n.voices + '  freshEdits ' + n.freshEdits + '  numbersMatch ' + n.numbersMatch + '  sameShape ' + n.sameShape);
  });
  console.log('\nper voice class (cases passed / cases, worst null in dB):');
  for (const [c, v] of Object.entries(byClass)) console.log('  ' + (v.far ? 'FAR  ' : v.close ? 'CLOSE' : 'EXACT') + ' ' + c.padEnd(34) + v.exact + ' exact (>= ' + PASS_DB + ' dB), ' + v.close + ' close (>= ' + CLOSE_DB + '), ' + v.far + ' far;  worst ' + v.worst.toFixed(1) + (v.near ? '   (' + v.near + ' exact only to within a frame of onset)' : ''));
  const pv = Object.values(phase).filter(x => isFinite(x));
  console.log('\nquantum phase (the same program begun 64 frames off the 128-frame grid, null depth in dB; the interpreter, not the replay): worst ' + Math.min(...pv).toFixed(1) + ', median ' + pv.sort((a, b) => a - b)[pv.length >> 1].toFixed(1) + ' over ' + pv.length + ' voices');
  const cv = Object.values(ctl);
  console.log('control (the page\'s own voice recorded at 1.304 s against recorded early, worst offset, dB; no replay involved): worst ' + Math.min(...cv).toFixed(1) + ', median ' + cv.sort((a, b) => a - b)[cv.length >> 1].toFixed(1) + ' over ' + cv.length + ' voices');
  console.log('\nslots found by differencing (per class: voices, program sizes, then per parameter slots fitted / slots that did not obey / edits seen):');
  for (const [c, f] of Object.entries(meta.fits)) {
    if (f.skipped) { console.log('  ' + c + ': ' + f.skipped); continue; }
    console.log('  ' + c + ': ' + f.voices + ' voice(s), sizes ' + f.len.join('/') + '; ' + Object.entries(f.params).map(([p, v]) => p + ' ' + v.slots + '/' + v.bad + (v.shape ? '' : ' SHAPE') + (v.lenBad ? ' LEN' : '') + (v.edits.some(e => e) ? ' edits' + JSON.stringify(v.edits) : '')).join(', ') + (f.time ? '; time slots ' + f.time.slots.join('/') + (f.time.bad ? ' (' + f.time.bad + ' did not obey)' : '') + (f.time.slopeOne ? ', each moves 1:1 with the start' : ', NOT all 1:1') : '') + (f.compose ? '; two-parameter slots: ' + f.compose.add + ' add, ' + f.compose.mul + ' multiply, ' + f.compose.bad + ' neither' : ''));
  }
  const unexpected = Object.entries(byClass).filter(([c, v]) => v.far && !KNOWN_DIFFERENT.includes(c)).map(([c]) => c);
  const fixed = KNOWN_DIFFERENT.filter(c => byClass[c] && !byClass[c].far);
  console.log('\n' + rows.length + ' cases. ' + (unexpected.length ? 'FAR from the fresh voice and not expected to be: ' + unexpected.join(', ') : 'Every voice not on the known-different list is within ' + CLOSE_DB + ' dB or better.') + (fixed.length ? ' Known-different voices that no longer are (update KNOWN_DIFFERENT): ' + fixed.join(', ') : ''));
  process.exit(unexpected.length || fixed.length ? 1 : 0);
}

function save(r, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cases.f64'), Buffer.from(r.b64, 'base64'));
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify({ names: r.names, fits: r.fits, seconds: r.seconds, buffers: r.buffers, bufferConflicts: r.bufferConflicts }));
}

const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'modriff-replay-'));
const i = process.argv.indexOf('--from');
if (i > 0) judge(process.argv[i + 1]);
else if (process.argv.includes('--serve')) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { res.end('ok'); save(JSON.parse(Buffer.concat(chunks).toString()), OUT); srv.close(); judge(OUT); });
  }).listen(8778, '127.0.0.1', () => console.log('waiting on :8778, writing to ' + OUT));
} else {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('playwright-core')); } catch (e2) { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } }
  (async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, channel: process.env.CHROMIUM ? undefined : 'chrome', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(process.env.URL || 'http://127.0.0.1:8777/index.html'); await page.waitForTimeout(1500);
    await page.addScriptTag({ path: path.join(__dirname, 'replay.inpage.js') });
    const r = await page.evaluate(() => window.__replaySpike());
    await browser.close();
    save(r, OUT); judge(OUT);
  })();
}
