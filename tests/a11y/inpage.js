/* Text size and names, measured in the real served page at phone width (375 pt). Load it and call
   window.__a11yprobe(); resolves [ok, what, detail] rows. Leaves the page at scale 1. */
window.__a11yprobe = async function(){
  const out = [], chk = (ok, what, d) => out.push([!!ok, what, d === undefined ? '' : String(d)]);
  const T = window._textScale, root = document.documentElement, px = () => parseFloat(getComputedStyle(root).fontSize);
  const tabs = ['perform','accomp','build','songs','mix','help'];
  const clipped = () => { const r = [];
    for(const el of document.querySelectorAll('button, .tb, span, div, label')){
      if(!el.getClientRects().length || el.children.length) continue;
      const t = el.textContent.trim(); if(!t || t === '?') continue;
      const b = el.getBoundingClientRect(); if(b.bottom < 0 || b.top > innerHeight) continue;
      if(el.scrollWidth > el.clientWidth + 1) r.push((el.id || String(el.className).slice(0,18))+':'+t.slice(0,14));
    } return r; };
  const sweep = async () => { const bad = {}; for(const t of tabs){ switchTab(t); await new Promise(r => setTimeout(r, 300)); const c = clipped(); if(c.length) bad[t] = c; } return bad; };
  try {
    T.apply(0); const base = px();
    chk(T.inApp() === false && T.sync() === 1, 'a browser keeps its own text size', T.now);
    chk(T.apply(17) === 1 && px() === base, 'the iOS default (17) changes nothing', px());
    chk(T.apply(14) === 0.9 && Math.abs(px() - base*0.9) < 0.01, 'small text shrinks, no further than 0.9', px());
    chk(T.apply(19) === 1.12 && root.classList.contains('text-big'), 'one step up is 1.12 and text-big', px());
    chk(T.apply(53) === 1.15 && Math.abs(px() - base*1.15) < 0.01, 'the largest setting stops at 1.15', px());
    const big = await sweep();
    chk(Object.keys(big).length === 0, 'at 1.15 no label is clipped on any of the six pages', JSON.stringify(big));
    T.apply(0);
    chk(px() === base && !root.classList.contains('text-big') && !root.style.getPropertyValue('--text-scale'), 'back to 1 leaves nothing behind');
    // names
    const name = el => (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('aria-labelledby') ? 'x' : '')
      || (el.id && document.querySelector('label[for="'+el.id+'"]') ? 'x' : '') || (el.closest('label') ? 'x' : '')
      || (/[A-Za-z0-9]/.test(el.textContent || '') ? 'x' : '') || (el.getAttribute('title') || '').trim()
      || (el.tagName === 'INPUT' && (el.placeholder || el.type === 'hidden' || el.type === 'file') ? 'x' : '');
    const all = [...document.querySelectorAll('button, [role=button], [role=slider], [role=switch], [role=tab], input, select, textarea, a[href]')];
    const un = all.filter(e => !name(e));
    chk(un.length === 0, 'every control has a name ('+all.length+' controls)', un.slice(0,6).map(e => e.id || e.dataset.kfor || e.className).join(','));
    const hdr = [...document.querySelectorAll('.ss-hdr')];
    chk(hdr.length > 0 && hdr.every(h => h.getAttribute('role') === 'button' && h.tabIndex === 0 && h.hasAttribute('aria-expanded')), 'settings section headers are buttons that say open or closed', hdr.length);
    const h0 = hdr[0], was = h0.getAttribute('aria-expanded'); h0.click();
    chk(h0.getAttribute('aria-expanded') !== was, 'and the state follows a tap', was+' -> '+h0.getAttribute('aria-expanded')); h0.click();
    const cv = [...document.querySelectorAll('canvas')].filter(c => !c.getAttribute('aria-label') && !c.getAttribute('aria-hidden') && !c.closest('[aria-hidden="true"], [role=slider]'));
    chk(cv.length === 0, 'no canvas is left for VoiceOver to land on unnamed', cv.map(c => c.id || c.className).join(','));
  } catch(e){ chk(false, 'threw', e && e.stack || e); }
  finally { T.apply(0); switchTab('perform'); }
  return out;
};
