/* Appearance: the four token sets (Colour/Monotone x Dark/Light), read straight out of index.html.

   What this holds:
     - body text on the page and on every surface at least 4.5:1, muted text at least 3:1, the accent on the page at least
       3:1 and the ink printed on an orange fill at least 4.5:1 (Monotone; in Colour the accent follows the key's hue, so
       only the base tokens are held);
     - the neutral a part wears in Monotone (--part-ink) is the same colour in the CSS and in MONO_PART_INK, and reads at 4.5:1;
     - every colour in the Monotone tokens is a grey or the one orange: nothing else carries a hue;
     - the safety net (the stylesheet monochromator) turns a purple into a grey of the same lightness, a record red into the
       accent, and leaves a neutral alone;
     - the stored key is new and the page reads it before first paint.

   The rendered half (count the hues among the part chips; sweep every screen for a colour that still has one) needs a
   browser and is tests/theme/hue-probe.js, run on the served page.

   Run: node tests/theme/monotone.test.cjs */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

let fails = 0;
const check = (ok, what, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (got !== undefined && got !== '' ? '  (' + got + ')' : '')); if (!ok) fails++; };

// ── colour maths ─────────────────────────────────────────────────────────────────────────────
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const chroma = h => { const c = hex(h); return Math.max(...c) - Math.min(...c); };
const hue = h => { const [r, g, b] = hex(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return x * 60; };

// ── token blocks ─────────────────────────────────────────────────────────────────────────────
const block = (src, open) => { const i = src.indexOf(open); if (i < 0) throw new Error('no block ' + open); const j = src.indexOf('{', i), k = src.indexOf('\n}', j); return src.slice(j + 1, k); };
const tokens = txt => { const o = {}; txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--([\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { o[k] = v.trim(); return m; }); return o; };
const monoCss = html.slice(html.indexOf('<style id="monotone-css">'), html.indexOf('</style>', html.indexOf('<style id="monotone-css">')));
const colourDark = tokens(block(html, '\n:root {'));
const colourLight = Object.assign({}, colourDark, tokens(block(html, '\nbody.light-mode {')));
const monoDark = tokens(block(monoCss, 'html[data-way=mono] {'));
const monoLight = Object.assign({}, monoDark, tokens(block(monoCss, 'html[data-way=mono] body.light-mode {')));
const sets = { 'Colour Dark': colourDark, 'Colour Light': colourLight, 'Monotone Dark': monoDark, 'Monotone Light': monoLight };

for (const [name, t] of Object.entries(sets)) {
  const mono = /Monotone/.test(name);
  for (const surf of ['bg', 'surf', 'surf2']) check(ratio(t.text, t[surf]) >= 4.5, name + ': text on ' + surf + ' >= 4.5:1', ratio(t.text, t[surf]).toFixed(2));
  for (const surf of ['bg', 'surf']) check(ratio(t.muted, t[surf]) >= 3, name + ': muted on ' + surf + ' >= 3:1', ratio(t.muted, t[surf]).toFixed(2));
  if (!mono) continue;
  check(ratio(t.text, t['play-surf']) >= 4.5, name + ': text on the play surface >= 4.5:1', ratio(t.text, t['play-surf']).toFixed(2));
  for (const surf of ['bg', 'surf']) check(ratio(t.accent, t[surf]) >= 3, name + ': accent on ' + surf + ' >= 3:1', ratio(t.accent, t[surf]).toFixed(2));
  check(ratio(t['accent-ink'], t.accent) >= 4.5, name + ': accent-ink on accent >= 4.5:1', ratio(t['accent-ink'], t.accent).toFixed(2));
  for (const surf of ['bg', 'surf']) check(ratio(t['part-ink'], t[surf]) >= 4.5, name + ': part-ink on ' + surf + ' >= 4.5:1', ratio(t['part-ink'], t[surf]).toFixed(2));
  // the one orange, and nothing else with a hue
  const bad = [];
  for (const [k, v] of Object.entries(t)) {
    const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) continue;
    if (chroma(v) >= 18 && v.toLowerCase() !== t.accent.toLowerCase()) bad.push(k + '=' + v);
  }
  check(bad.length === 0, name + ': every colour token is a grey or the accent', bad.join(' '));
  const h = hue(t.accent); check(h >= 6 && h <= 30, name + ': the accent is orange', h.toFixed(0) + ' deg');
}
// the two Monotone sets define the same names, so a token added to one cannot be forgotten in the other
const kd = Object.keys(monoDark).filter(k => !/^(mono-h|mono-s)$/.test(k)).sort(), kl = Object.keys(monoLight).filter(k => !/^(sq-)/.test(k)).sort();
check(kd.every(k => k in monoLight), 'Monotone Light defines every token Monotone Dark does', kd.filter(k => !(k in tokens(block(monoCss, 'html[data-way=mono] body.light-mode {')))).join(' '));

// ── --part-ink agrees with the JS constant ──────────────────────────────────────────────────
const m = html.match(/var MONO_PART_INK = \{dark:'(#[0-9a-f]{6})', light:'(#[0-9a-f]{6})'\}/i);
check(!!m, 'MONO_PART_INK is in the page');
if (m) {
  check(m[1].toLowerCase() === monoDark['part-ink'].toLowerCase(), 'MONO_PART_INK.dark === --part-ink (dark)', m[1] + ' / ' + monoDark['part-ink']);
  check(m[2].toLowerCase() === monoLight['part-ink'].toLowerCase(), 'MONO_PART_INK.light === --part-ink (light)', m[2] + ' / ' + monoLight['part-ink']);
}

// ── the safety net ────────────────────────────────────────────────────────────────────────────
const s0 = html.indexOf("<script>\n'use strict';\n// ── The Monotone safety net"), s1 = html.indexOf('</script>', s0);
const code = html.slice(s0 + '<script>'.length, s1);
const win = {};
const ctx = vm.createContext({ window: win, document: { documentElement: { getAttribute: () => 'colour' }, styleSheets: [], getElementById: () => null } });
vm.runInContext(code, ctx);
check(typeof win.monoConv === 'function', 'the monochromator exposes monoConv');
if (typeof win.monoConv === 'function') {
  const c = win.monoConv;
  const purple = c('#9b6dff'); check(/^hsla\(var\(--mono-h\), var\(--mono-s\), 50\.\d%, 1\)$/.test(purple), 'a purple becomes a grey of the same lightness', purple);
  check(c('#e5384f') === 'var(--accent)', 'a record red becomes the accent', c('#e5384f'));
  check(/^color-mix\(in srgb, var\(--accent\) 18%, transparent\)$/.test(c('rgba(229,56,79,.18)')), 'a translucent record red keeps its strength', c('rgba(229,56,79,.18)'));
  check(c('#101010') === '#101010', 'a neutral is left alone');
  check(c('hsl(0, 0%, 60%)') === 'hsl(0, 0%, 60%)', 'a grey in hsl() is left alone');
  const hs = c('hsl(220, 60%, 50%)'); check(/^hsla\(var\(--mono-h\)/.test(hs), 'a blue in hsl() becomes a grey', hs);
  // lightness is kept: white text on the purple was 3.9:1 and the grey it becomes must not fall below that
  const y = +purple.match(/, ([\d.]+)%,/)[1] / 100; const g = Math.round(y * 255);
  check(ratio('#ffffff', '#' + [g, g, g].map(v => v.toString(16).padStart(2, '0')).join('')) >= ratio('#ffffff', '#9b6dff') - .01, 'white text keeps its contrast on the grey', '');
}

// ── storage and boot ──────────────────────────────────────────────────────────────────────────
check(/getItem\('modo-colourway'\)/.test(html) && /setItem\('modo-colourway'/.test(html), "the colourway lives under the new key 'modo-colourway'");
const head = html.slice(0, html.indexOf('</head>'));
check(/data-way/.test(head.slice(0, head.indexOf('<style'))), 'data-way is set in the first script, before any style is parsed');
check(/catch\(e\)\{ document\.documentElement\.setAttribute\('data-way', 'colour'\); \}/.test(head), 'a storage failure falls back to Colour');

process.exit(fails ? 1 : 0);
