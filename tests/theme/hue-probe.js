// Browser-side probe for Monotone: which rendered colours still carry a hue.
// Load it into the running page (the page is served from the repo root):
//   eval(await (await fetch('/tests/theme/hue-probe.js')).text());
//   await __scenes();            // visits Live, Studio, Song, Sound, Settings; fills window.__agg
//   __report()                   // [selector prop colour [scenes]] for everything that is not neutral or the orange
// A colour counts as "hued" when its chroma (max-min of r,g,b) is at least 18/255, which is the point where a grey
// next to it starts to look tinted, and it is not the accent orange (hue 6-30). Elements outside the viewport, hidden
// ones and zero-width borders are skipped, so the sweep sees what the person sees on that screen.
window.__sweep = function(){
 const out = {};
 function parse(c){ let m = c.match(/color\(srgb ([^)]+)\)/); if(m){ const p = m[1].split(/[ \/]+/).map(parseFloat); return {r:p[0]*255, g:p[1]*255, b:p[2]*255, a:p.length > 3 ? p[3] : 1}; } m = c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p = m[1].split(/[ ,\/]+/).map(parseFloat); return {r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1}; }
 function hueOf(c){ const r = c.r/255, g = c.g/255, b = c.b/255, mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn; let h = 0; if(d){ if(mx === r) h = ((g-b)/d + (g < b ? 6 : 0)); else if(mx === g) h = (b-r)/d + 2; else h = (r-g)/d + 4; h *= 60; } return h; }
 const props = ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor','fill','stroke'];
 document.querySelectorAll('body *').forEach(el => {
  const r = el.getBoundingClientRect(); if(r.width < 1 || r.height < 1) return;
  if(!(r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) return;
  const cs = getComputedStyle(el); if(cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
  props.forEach(p => {
   if(p.startsWith('border') && (cs[p.replace('Color','Style')] === 'none' || parseFloat(cs[p.replace('Color','Width')]) === 0)) return;
   if(p === 'outlineColor' && cs.outlineStyle === 'none') return;
   if(p === 'color' && !(el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))) return;
   const c = parse(cs[p]); if(!c || c.a < 0.15) return;
   const chroma = Math.max(c.r,c.g,c.b) - Math.min(c.r,c.g,c.b);
   if(chroma < 18) return;
   const h = hueOf(c), orange = h >= 6 && h <= 30;
   const key = el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0,3).join('.') : '') + (el.id ? '#' + el.id : '') + ' ' + p;
   const o = out[key] || (out[key] = {n:0, col:cs[p], orange}); o.n++;
  });
 });
 return out;
};
window.__scenes = async function(){
 const sc = [
  ['live-chords', () => { liveTab(); setPerformMode('chords'); }],
  ['live-melody', () => { setPerformMode('melody'); }],
  ['live-pads', () => { setPerformMode('pads'); }],
  ['live-fx', () => { setPerformMode('fx'); }],
  ['studio-drums', () => { studioTab(); switchTab('accomp'); setAccompMode('drums'); }],
  ['studio-bass', () => { setAccompMode('bass'); }],
  ['studio-melody', () => { setAccompMode('melody'); }],
  ['studio-arp', () => { setAccompMode('arp'); }],
  ['song-build', () => { switchTab('songs'); setSongsMode('build'); }],
  ['song-perform', () => { setSongsMode('perform'); }],
  ['song-library', () => { setSongsMode('library'); }],
  ['sound-mixer', () => { switchTab('mix'); setMixMode('mixer'); }],
  ['sound-voices', () => { setMixMode('voices'); }],
  ['sound-synth', () => { setMixMode('synth'); }],
  ['settings-ui', () => { openSettings(); setSettingsPane('ui'); }],
  ['settings-sounds', () => { setSettingsPane('sounds'); }],
  ['settings-midi', () => { setSettingsPane('midi'); }],
 ];
 const agg = {};
 for(const [name, fn] of sc){
  try{ fn(); }catch(e){ agg['ERR ' + name] = {n:1, col:String(e), scenes:[name]}; }
  await new Promise(r => setTimeout(r, 450));
  const o = window.__sweep();
  for(const [k, v] of Object.entries(o)){ if(v.orange) continue; const a = agg[k] || (agg[k] = {n:0, col:v.col, scenes:[]}); a.n += v.n; a.scenes.push(name); }
 }
 window.__agg = agg;
 return Object.keys(agg).length;
};
window.__report = function(){
 return Object.entries(window.__agg).map(([k, v]) => k + ' ' + v.col + ' [' + v.scenes.join(',') + ']');
};
'probe loaded'
// Contrast sweep: text against the first opaque background behind it. Flags anything under 3:1 (large or muted text
// passes at 3:1; body text should clear 4.5:1 and the token test holds the tokens to that).
window.__contrast = function(min){
 min = min || 3;
 function parse(c){ let m = c.match(/color\(srgb ([^)]+)\)/); if(m){ const p = m[1].split(/[ \/]+/).map(parseFloat); return {r:p[0]*255, g:p[1]*255, b:p[2]*255, a:p.length > 3 ? p[3] : 1}; } m = c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p = m[1].split(/[ ,\/]+/).map(parseFloat); return {r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1}; }
 function lum(c){ const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }; return .2126*f(c.r) + .7152*f(c.g) + .0722*f(c.b); }
 function bgOf(el){ let a = el; const stack = []; while(a && a.nodeType === 1){ const c = parse(getComputedStyle(a).backgroundColor); if(c && c.a > 0) stack.push(c); if(c && c.a >= .98) break; a = a.parentElement; }
  let base = {r:255,g:255,b:255}; if(!stack.length || stack[stack.length-1].a < .98) base = parse(getComputedStyle(document.body).backgroundColor) || base; if(base.a === 0) base = {r:16,g:17,b:19};
  for(let i = stack.length - 1; i >= 0; i--){ const s = stack[i]; base = {r:s.r*s.a + base.r*(1-s.a), g:s.g*s.a + base.g*(1-s.a), b:s.b*s.a + base.b*(1-s.a)}; } return base; }
 const out = {};
 document.querySelectorAll('body *').forEach(el => {
  if(![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
  if(el.closest('.tier-locked')) return;                      // locked controls are dimmed on purpose
  const r = el.getBoundingClientRect(); if(r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) return;
  const cs = getComputedStyle(el); if(cs.visibility === 'hidden' || +cs.opacity === 0) return;
  if(parseFloat(cs.fontSize) === 0) return;                   // a glyph drawn in CSS (the play triangle) has no text to measure
  const fg = parse(cs.color); if(!fg) return; const bg = bgOf(el);
  const fgm = {r:fg.r*fg.a + bg.r*(1-fg.a), g:fg.g*fg.a + bg.g*(1-fg.a), b:fg.b*fg.a + bg.b*(1-fg.a)};
  const l1 = lum(fgm), l2 = lum(bg), ratio = (Math.max(l1,l2) + .05) / (Math.min(l1,l2) + .05);
  if(ratio < min){ const key = el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0,3).join('.') : '') + (el.id ? '#'+el.id : '') + ' "' + el.textContent.trim().slice(0,16) + '"'; out[key] = Math.round(ratio*100)/100; }
 });
 return out;
};

// One call: both modes, every scene, hue + contrast, summarised (borders collapsed, element ids dropped).
window.__full = async function(){
 const out = {};
 // A hidden pane does not advance transitions, so a theme switch would be measured halfway: switch them off for the run.
 if(!document.getElementById('probe-notrans')){ const st = document.createElement('style'); st.id = 'probe-notrans'; st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(st); }
 for(const mode of ['dark','light']){
  setTheme(mode); await new Promise(r => setTimeout(r, 800));
  await __scenes();
  const hue = {}; __report().forEach(r => { const k = r.replace(/ \[.*\]$/,'').replace(/border(Top|Right|Bottom|Left)Color/,'border').replace(/#[\w-]+(?= )/,''); hue[k] = 1; });
  const c = {};
  for(const [n, f] of [['live', () => { liveTab(); setPerformMode('chords'); }], ['melody', () => setPerformMode('melody')], ['bass', () => { switchTab('accomp'); setAccompMode('bass'); }], ['drums', () => setAccompMode('drums')], ['arp', () => setAccompMode('arp')], ['song', () => { switchTab('songs'); setSongsMode('build'); }], ['mix', () => { switchTab('mix'); setMixMode('mixer'); }], ['set', () => { openSettings(); setSettingsPane('ui'); }]]){
   f(); await new Promise(r => setTimeout(r, 500)); Object.assign(c, __contrast(3));
  }
  out[mode] = {hue: Object.keys(hue), contrast: c};
 }
 return out;
};
// Which rules set a property on an element, in cascade order (last wins unless a specificity or !important says otherwise).
window.__why = function(el, prop){
 const hits = [];
 const scan = function(list, ctx){ for(const r of list){
  if(r.type === 1){ try{ if(el.matches(r.selectorText) && r.style.getPropertyValue(prop)) hits.push(ctx + r.selectorText.slice(0,100) + ' { ' + prop + ': ' + r.style.getPropertyValue(prop).slice(0,70) + (r.style.getPropertyPriority(prop) ? ' !important' : '') + ' }'); }catch(e){} }
  else if(r.cssRules) scan(r.cssRules, ctx + '@ ');
 } };
 for(const sh of document.styleSheets){ try{ scan(sh.cssRules, ''); }catch(e){} }
 return hits;
};
// The part chips: every element that carries a part colour (--pc on the transport switches, the Studio part tabs, the voice
// rows and chips) resolved to an rgb string. `pc` counts the different --pc values (Colour: one per part; Monotone: one),
// `chromatic` the ones that have a hue (Monotone: none). A mixer label has no --pc: its text colour is counted as well.
window.__partHues = function(){
 const probe = document.createElement('span'); probe.style.display = 'none'; document.body.appendChild(probe);
 const pc = {}, all = {};
 document.querySelectorAll('.ft-btn.arp.pc, .subnav-btn.pc, .voice-row, .mix-lbl, .lv-syn-part, .msx-part, .smp-chip, .st-part').forEach(el => {
  const v = getComputedStyle(el).getPropertyValue('--pc').trim();
  let c = '';
  if(v){ probe.style.color = ''; probe.style.color = v; c = getComputedStyle(probe).color; if(c) pc[c] = 1; }
  else if(el.classList.contains('mix-lbl')) c = getComputedStyle(el).color;
  if(c) all[c] = 1;
 });
 probe.remove();
 const chromatic = Object.keys(all).filter(c => { const n = c.match(/[\d.]+/g).map(Number); return Math.max(n[0], n[1], n[2]) - Math.min(n[0], n[1], n[2]) >= 18; });
 return {pc: Object.keys(pc).length, chromatic: chromatic.length};
};
// Regression for Colour: a fingerprint of every visible element's colours on each scene. Run it on the page and on the
// same page from before the change (served from the same origin) and diff the two arrays; Colour must not move.
window.__fp = async function(modes){
 const out = {};
 const st = document.createElement('style'); st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(st);
 const scenes = [['live', () => { liveTab(); setPerformMode('chords'); }], ['melody', () => setPerformMode('melody')], ['drums', () => { switchTab('accomp'); setAccompMode('drums'); }], ['bass', () => setAccompMode('bass')], ['song', () => { switchTab('songs'); setSongsMode('build'); }], ['mixer', () => { switchTab('mix'); setMixMode('mixer'); }], ['settings', () => { openSettings(); setSettingsPane('ui'); }]];
 for(const mode of modes){
  setTheme(mode); await new Promise(r => setTimeout(r, 400));
  for(const [n, f] of scenes){
   f(); await new Promise(r => setTimeout(r, 450));
   const rows = [];
   document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect(); if(r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) return;
    const cs = getComputedStyle(el); if(cs.display === 'none' || cs.visibility === 'hidden') return;
    rows.push((el.id || el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(/\s+/).slice(0,2).join('.') : '')) + '|' + cs.color + '|' + cs.backgroundColor + '|' + cs.borderTopColor + '|' + cs.boxShadow.slice(0,40));
   });
   out[mode + ':' + n] = rows;
  }
 }
 st.remove();
 return out;
};
