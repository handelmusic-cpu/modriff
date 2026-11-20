/* Appearance: the page and its layers are not near-black in Dark or near-white in Light, and each layer is a visible
   step from the last, in all four token sets (Colour/Monotone x Dark/Light), read straight out of index.html.

   Why it exists: Dark was #05060c / #090b17 / #0d0f1e (1.03:1 between layers: panels were holes in a black page) and Light
   was a page of relative luminance 0.86 with the cards lighter still. The owner called them "too dark" and "too light".
   The text and accent contrast floors live in monotone.test.cjs; this holds the shape of the layers.

   Run: node tests/theme/surfaces.test.cjs */
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined ? '  (' + got + ')' : '')); if (!ok) fails++; };
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const R = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const block = (src, open) => { const i = src.indexOf(open); if (i < 0) throw new Error('no block ' + open); const j = src.indexOf('{', i), k = src.indexOf('\n}', j); return src.slice(j + 1, k); };
const tokens = txt => { const o = {}; txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--([\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { o[k] = v.trim(); return m; }); return o; };
const mono = html.slice(html.indexOf('<style id="monotone-css">'), html.indexOf('</style>', html.indexOf('<style id="monotone-css">')));
const cd = tokens(block(html, '\n:root {')), cl = Object.assign({}, cd, tokens(block(html, '\nbody.light-mode {')));
const md = tokens(block(mono, 'html[data-way=mono] {')), ml = Object.assign({}, md, tokens(block(mono, 'html[data-way=mono] body.light-mode {')));
const sets = { 'Colour Dark': cd, 'Colour Light': cl, 'Mono Dark': md, 'Mono Light': ml };
for (const [name, t] of Object.entries(sets)) {
  const L = lum(hex(t.bg)), dark = /Dark/.test(name), r = (a, b) => R(t[a], t[b]);
  if (dark) check(L >= 0.010, name + ': the page is not near-black (luminance >= 0.010)', L.toFixed(3));
  else check(L <= 0.72, name + ': the page is not near-white (luminance <= 0.72)', L.toFixed(3));
  check(r('bg', 'surf') >= 1.09, name + ': a card is a visible step from the page (>= 1.09:1)', r('bg', 'surf').toFixed(2));
  check(r('surf', 'surf2') >= 1.08, name + ': a control is a visible step from its card (>= 1.08:1)', r('surf', 'surf2').toFixed(2));
  check(r('bg', 'play-surf') >= 1.2, name + ': a play surface reads against the page (>= 1.2:1)', r('bg', 'play-surf').toFixed(2));
  check(r('surf', 'border2') >= 1.8, name + ': a control edge reads on a card (>= 1.8:1)', r('surf', 'border2').toFixed(2));
  check(r('text', 'play-surf') >= 7, name + ': text on a play surface >= 7:1', r('text', 'play-surf').toFixed(2));
  check(r('muted', 'surf2') >= 4.5, name + ': muted text on a control >= 4.5:1', r('muted', 'surf2').toFixed(2));
}
process.exit(fails ? 1 : 0);
