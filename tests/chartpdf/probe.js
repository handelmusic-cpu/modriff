/* Chord shapes name their notes (1.9.9.9.5) and Print / Save PDF builds a real PDF and hands it to modPlatform.saveFile.
   Run: node tests/chartpdf/probe.js   (env URL / CHROMIUM as for the other layout probes) */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('../layout/lib.js');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const h = await L.start(), R = L.reporter();
  try {
    const { page, errs } = await L.boot(h, 'p390', 'live');
    await page.evaluate(() => { switchTab('songs'); setSongsMode('build'); const p = document.getElementById('chart-chord-picker');
      [1, 4, 0, 5, 3, 2, 6, 1, 4].forEach(i => p.children[i].querySelector('.cpick-tri').click()); });
    await page.waitForTimeout(300);
    for (const inst of ['guitar', 'ukulele', 'piano']) {
      const r = await page.evaluate(async inst => {
        chartInst = inst; const bytes = await _chartPdfBytes();
        let b = ''; for (let i = 0; i < Math.min(bytes.length, 8); i++) b += String.fromCharCode(bytes[i]);
        let tail = ''; for (let i = bytes.length - 6; i < bytes.length; i++) tail += String.fromCharCode(bytes[i]);
        let all = ''; for (let i = 0; i < bytes.length; i += 1) all += String.fromCharCode(bytes[i]);
        const count = +(/\/Count (\d+)/.exec(all) || [0, 0])[1];
        const sx = +(/startxref\n(\d+)/.exec(all) || [0, -1])[1];
        // every xref offset must point at "N 0 obj"
        const m = /xref\n0 (\d+)\n/.exec(all.slice(sx)); let okOffs = 0, n = m ? +m[1] : 0;
        const lines = all.slice(sx).split('\n').slice(3, 3 + n - 1);
        lines.forEach((ln, i) => { const o = +ln.slice(0, 10); if (all.startsWith((i + 1) + ' 0 obj', o)) okOffs++; });
        return { head: b, tail, len: bytes.length, count, sx, n, okOffs, b64: btoa(all.length < 4e6 ? all : '') };
      }, inst);
      R.check(r.head.startsWith('%PDF-1.4') && r.tail.includes('%%EOF'), inst + ': PDF header and trailer', JSON.stringify([r.head, r.tail]));
      R.check(r.count >= 1 && r.len > 20000, inst + ': ' + r.count + ' page(s), ' + r.len + ' bytes');
      R.check(r.okOffs === r.n - 1, inst + ': every xref offset points at its object', r.okOffs + '/' + (r.n - 1));
      if (r.b64) fs.writeFileSync(path.join(OUT, 'chart-' + inst + '.pdf'), Buffer.from(r.b64, 'base64'));
    }
    // print goes to saveFile with a .pdf name and a PDF blob
    const sv = await page.evaluate(async () => {
      chartInst = 'guitar'; let got = null; const orig = modPlatform.saveFile;
      modPlatform.saveFile = async (name, blob) => { got = { name, type: blob.type, size: blob.size }; };
      await printChordChart(); modPlatform.saveFile = orig; return got;
    });
    R.check(sv && /\.pdf$/.test(sv.name) && sv.type === 'application/pdf' && sv.size > 20000, 'printChordChart hands a PDF blob to saveFile', JSON.stringify(sv));
    const pr = await page.evaluate(async () => { let called = null; const o = window.open; window.open = (...a) => { called = a; return null; };
      let sv = null; const orig = modPlatform.saveFile; modPlatform.saveFile = async (n) => { sv = n; }; chartInst = 'guitar'; printChart(); await new Promise(r => setTimeout(r, 2500));
      modPlatform.saveFile = orig; window.open = o; return { opened: !!called, saved: sv }; });
    R.check(!pr.opened && !!pr.saved, 'printChart no longer opens a pop-up; it saves', JSON.stringify(pr));
    // diagrams: plain dots, note names on piano, no R/B marks
    const d = await page.evaluate(() => {
      const fb = _svgFretboard('guitar', [-1, 3, 2, 0, 1, 0]); const pn = _svgPiano([0, 4, 7], 0, 0); const pp = _svgPianoPrint([0, 4, 7], 0, 0);
      const txt = s => (s.match(/<text[^>]*>([^<]*)<\/text>/g) || []).map(t => t.replace(/<[^>]+>/g, ''));
      return { fb: txt(fb), pn: txt(pn), pp: txt(pp) };
    });
    R.check(!d.fb.includes('R') && !d.pn.includes('R') && !d.pn.includes('B') && !d.pp.includes('R') && !d.pp.includes('B'), 'no R / B marks in the diagrams', JSON.stringify(d));
    R.check(['C', 'E', 'G'].every(n => d.pn.includes(n)) && ['C', 'E', 'G'].every(n => d.pp.includes(n)), 'piano keys name their notes', JSON.stringify(d.pn));
    R.check(d.fb.filter(t => /^\d+$/.test(t)).length <= 1, 'guitar diagram has at most one fret number', JSON.stringify(d.fb));
    // minor keeps its lowercase m
    const css = await page.evaluate(() => ['.cqual', '.btn-sev .sl-qual', '#chroma-quality-row .tb'].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).textTransform : 'absent'; }));
    R.check(css.every(c => c === 'none' || c === 'absent'), 'quality labels are not uppercased', JSON.stringify(css));
    R.check(errs.length === 0, 'no page errors', JSON.stringify(errs.slice(0, 3)));
    await page.close();
  } finally { await h.close(); }
  process.exit(R.done());
})();
