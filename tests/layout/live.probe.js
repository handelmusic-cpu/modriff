/* Slice 8: Live.

   - Chords are two rows of four split pads, 96 pt tall, each half at least 44 pt, and an eighth pad brings in the More row;
   - the melody keys are 128 pt tall (they were 380 until 1.9.7);
   - every widget has one three-dot button (44 pt) and no old fold caret or "All controls" button;
   - Chords, Solo, Sampler and mõdFX (and the four grids when added) have a caret (44 pt) that opens a panel of the widget's most
     used controls directly under it: the instrument stays on screen, every control is 44 pt, a control repaints from the real one
     it clicks, the panel ends in a link to the widget's Studio page, and it stays open across a remount;
   - the three dots open that widget's sheet: its settings are the real elements (the rhythm bar, Touch Mod, the sampler's rows,
     mõdFX's axes), the instrument is hidden, the sheet is a short one (about half the screen, the page above it still showing),
     Done closes it and the page has not moved;
   - the sheet ends in "Arrange this widget": on a free install the rows are locked (a tap opens the pack sheet and changes nothing),
     Back to the standard layout is not; with the pack they move the widget;
   - the Mixer widget is the Mix tab's rows (a level, M and S per channel, and the master), not the old strips.

   Run: node tests/layout/live.probe.js */
'use strict';
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  for (const vp of ['p430', 'p390', 'se375']) {
    const { page, errs } = await L.boot(h, vp, 'live');
    const g = await page.evaluate(() => {
      const d = document.getElementById('chords-diatonic'), kids = [].slice.call(d.children), r = e => e.getBoundingClientRect();
      const tops = [...new Set(kids.map(k => Math.round(r(k).top)))];
      const halves = [].slice.call(d.querySelectorAll('.btn-sev, .btn-tri')).map(e => Math.round(r(e).height));
      return { n: kids.length, rows: tops.length, h: Math.round(r(kids[0]).height), w: Math.round(r(kids[0]).width), minHalf: Math.min.apply(null, halves), more: !!document.getElementById('live-more-pad'), over: document.documentElement.scrollWidth - innerWidth,
        key: Math.round(r(document.querySelector('#lv-slots .mel-btn')).height) };
    });
    R.check(g.n === 8 && g.rows === 2 && g.h === 96 && g.w >= 44 && g.minHalf >= 44 && g.more, vp + ': chords are two rows of four split pads, 96 pt, halves at least 44, with the eighth More pad', JSON.stringify(g));
    R.check(g.key === 128 && g.over <= 1, vp + ': melody keys 128 pt tall (shortened in 1.9.7), no sideways overflow', g.key + ' / over ' + g.over);

    const hd = await page.evaluate(() => [].slice.call(document.querySelectorAll('#lv-slots .lv-slot')).map(s => { const b = s.querySelectorAll('.lv-cb'); const r = b[0] ? b[0].getBoundingClientRect() : { width: 0, height: 0 };
      return { m: s.dataset.mod, dots: b.length, w: Math.round(r.width), h: Math.round(r.height), more: !!s.querySelector('.lv-more'), xt: !!s.querySelector('.lv-xt') }; }));
    R.check(hd.length === 7 && hd.every(x => x.dots === 1 && x.w >= 44 && x.h >= 44 && !x.more && !x.xt), vp + ': each of the seven widgets has one three-dot button of at least 44 pt and no old fold caret', JSON.stringify(hd.filter(x => !(x.dots === 1 && x.w >= 44 && x.h >= 44 && !x.more && !x.xt))));
    const qt = await page.evaluate(() => [].slice.call(document.querySelectorAll('#lv-slots .lv-slot')).map(s => { const b = s.querySelector('.lv-qt'), r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; return { m: s.dataset.mod, has: !!b, w: Math.round(r.width), h: Math.round(r.height) }; }));
    R.check(qt.every(x => ['chords', 'melody', 'pads', 'fx'].indexOf(x.m) >= 0 ? (x.has && x.w >= 44 && x.h >= 44) : !x.has), vp + ': Chords, Solo, Sampler and mõdFX have a caret of at least 44 pt; Styles, Record and Endings (nothing more to show) have none', JSON.stringify(qt));

    // The caret panel, under the instrument.
    for (const m of ['chords', 'melody', 'pads', 'fx']) {
      await page.evaluate(k => document.querySelector('#lv-slots .lv-slot[data-mod=' + k + '] .lv-qt').click(), m); await page.waitForTimeout(350);
      const o = await page.evaluate(k => {
        const sl = document.querySelector('#lv-slots .lv-slot[data-mod=' + k + ']'), q = sl.querySelector(':scope > .lv-quick'), r = e => e.getBoundingClientRect();
        const surf = { chords: '#chords-diatonic', melody: '.mel-keys-host', pads: '#ps-grid', fx: '.fx-padwrap' }[k], se = sl.querySelector(surf), qb = q ? r(q) : null, sb = se ? r(se) : null;
        const ctl = q ? [].slice.call(q.querySelectorAll('button')).filter(b => !b.hidden && r(b).height > 0) : [];
        return { open: !!q && sl.querySelector('.lv-qt').getAttribute('aria-expanded') === 'true', below: !!(qb && sb && qb.top >= sb.bottom - 1 && sb.height > 40), surfaceShown: !!sb && getComputedStyle(se).display !== 'none',
          n: ctl.length, small: ctl.filter(b => r(b).height < 43.5 || r(b).width < 43.5).map(b => b.textContent), studio: !!q && !!q.querySelector('.lv-q-studio'), inView: !!qb && qb.left >= -1 && qb.right <= innerWidth + 1, over: document.documentElement.scrollWidth - innerWidth };
      }, m);
      R.check(o.open && o.below && o.surfaceShown && o.n >= 3 && o.small.length === 0 && o.studio && o.inView && o.over <= 1, vp + ' ' + m + ': the caret opens a panel under the instrument, 44 pt controls, a Studio link', JSON.stringify(o));
    }
    // A proxy clicks the real control and repaints from it.
    const px = await page.evaluate(async () => {
      const sl = document.querySelector('#lv-slots .lv-slot[data-mod=chords]'), q = sl.querySelector('.lv-quick'), real = document.getElementById('pf-sub-chip');
      const b = [].slice.call(q.querySelectorAll('.lv-q-b')).filter(x => x.textContent === 'Sub')[0], w = () => new Promise(r => setTimeout(r, 150));
      const a0 = real.classList.contains('active'); b.click(); await w(); const a1 = real.classList.contains('active'), p1 = b.classList.contains('active'); b.click(); await w();
      const o1 = document.getElementById('oct-disp').textContent; const oct = [].slice.call(q.querySelectorAll('.lv-q-b')).filter(x => x.textContent === 'Oct+')[0]; oct.click(); await w();
      const shown = q.querySelector('.lv-q-val').textContent, o2 = document.getElementById('oct-disp').textContent; [].slice.call(q.querySelectorAll('.lv-q-b')).filter(x => x.textContent === 'Oct\u2212')[0].click(); await w();
      return { flipped: a0 !== a1, mirrored: p1 === a1, back: real.classList.contains('active') === a0, octMoved: o1 !== o2, valueFollows: shown === o2, octBack: document.getElementById('oct-disp').textContent === o1 };
    });
    R.check(Object.values(px).every(Boolean), vp + ': the panel\'s Sub and Oct buttons drive the real controls and repaint from them', JSON.stringify(px));
    // Open stays open across a remount; the sheet takes the panel away and gives it back on Done.
    await page.evaluate(() => lvMount()); await page.waitForTimeout(300);
    const rm = await page.evaluate(() => ['chords', 'melody', 'pads', 'fx'].map(k => !!document.querySelector('#lv-slots .lv-slot[data-mod=' + k + '] > .lv-quick')));
    R.check(rm.every(Boolean), vp + ': the open panels are still open after a remount', JSON.stringify(rm));
    await page.evaluate(() => document.querySelector('#lv-slots .lv-slot[data-mod=chords] .lv-cb').click()); await page.waitForTimeout(350);
    const sh = await page.evaluate(() => { const sl = document.querySelector('#lv-slots .lv-slot[data-mod=chords]'), r = sl.getBoundingClientRect(); return { gone: !sl.querySelector(':scope > .lv-quick'), h: Math.round(r.height), top: Math.round(r.top), vh: innerHeight }; });
    R.check(sh.gone && sh.h <= Math.max(0.52 * sh.vh, 300) + 1 && sh.top >= sh.vh * 0.4, vp + ': the three-dot sheet is a short one (' + sh.h + ' of ' + sh.vh + ' pt) and takes the panel away while it is up', JSON.stringify(sh));
    await page.evaluate(() => document.querySelector('.lv-sh-done').click()); await page.waitForTimeout(300);
    R.check(await page.evaluate(() => !!document.querySelector('#lv-slots .lv-slot[data-mod=chords] > .lv-quick')), vp + ': Done brings the open panel back');
    if (vp === 'p430') {
      // The Studio link lands on the widget's own Studio page.
      for (const [m, want] of [['chords', 'chords'], ['melody', 'melody'], ['pads', 'smp'], ['fx', 'fx']]) {
        await page.evaluate(k => { setViewMode('basic'); switchTab('perform'); }, m); await page.waitForTimeout(400);
        await page.evaluate(k => { const sl = document.querySelector('#lv-slots .lv-slot[data-mod=' + k + ']'); sl.querySelector('.lv-q-studio').click(); }, m); await page.waitForTimeout(500);
        const st = await page.evaluate(() => ({ sel: studioSel(), studio: !document.body.classList.contains('mode-basic') }));
        R.check(st.sel === want && st.studio, 'the ' + m + ' panel\'s link opens Studio on ' + want, JSON.stringify(st));
      }
      await page.evaluate(() => { setViewMode('basic'); switchTab('perform'); }); await page.waitForTimeout(500);
    }
    await page.evaluate(() => { ['chords', 'melody', 'pads', 'fx'].forEach(k => { const b = document.querySelector('#lv-slots .lv-slot[data-mod=' + k + '] .lv-qt'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); }); }); await page.waitForTimeout(250);

    if (vp === 'p430') {
      await page.locator('#live-more-pad').tap();
      await page.locator('#live-more-menu button[value="modal"]').tap();
      R.check(await page.evaluate(() => chordMoreGet() === 'modal'), 'the eighth position opens a picker for the More chords shelf');
    }

    // Every widget's sheet.
    const sel = { chords: '#cr-bar', melody: '#touchmod-bar', pads: '#ps-panel .ps-row', fx: '.fx-axes' };
    for (const m of ['chords', 'melody', 'styles', 'pads', 'fx', 'rec', 'endings']) {
      const y0 = await page.evaluate(() => document.getElementById('page-perform').scrollTop);
      await page.evaluate(k => document.querySelector('#lv-slots .lv-slot[data-mod=' + k + '] .lv-cb').click(), m); await page.waitForTimeout(450);
      const o = await page.evaluate(({ k, s }) => {
        const sl = document.querySelector('#lv-slots .lv-slot[data-mod=' + k + ']'), r = sl.getBoundingClientRect(), vis = e => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none';
        const done = sl.querySelector('.lv-sh-done'), dr = done.getBoundingClientRect();
        return { sheet: sl.classList.contains('lv-sheet'), fits: r.top >= innerHeight * 0.4 && r.bottom <= innerHeight + 1 && r.width <= innerWidth + 1, bar: dr.height >= 43.5 && dr.width >= 43.5, arr: !!sl.querySelector('.lv-arr'), body: document.body.classList.contains('lv-sheet-on'),
          settings: s ? vis(document.querySelector(s)) : true, surfaceHidden: k === 'chords' ? !vis(document.getElementById('chords-diatonic')) : k === 'melody' ? !vis(document.querySelector('.mel-keys-host')) : true,
          small: [].slice.call(sl.querySelectorAll('.lv-arr button, .lv-sh-done')).filter(b => { const q = b.getBoundingClientRect(); return q.height > 0 && q.height < 43.5; }).length, over: document.documentElement.scrollWidth - innerWidth };
      }, { k: m, s: sel[m] || null });
      R.check(o.sheet && o.fits && o.bar && o.arr && o.body && o.settings && o.surfaceHidden && o.small === 0 && o.over <= 1, vp + ' ' + m + ': the sheet opens, fits, shows the real settings, hides the instrument, 44 pt controls', JSON.stringify(o));
      await page.evaluate(() => document.querySelector('.lv-sh-done').click()); await page.waitForTimeout(300);
      const c = await page.evaluate(() => ({ none: !document.querySelector('.lv-sheet') && !document.querySelector('.lv-sh-hold') && !document.getElementById('lv-sheet-bg') && !document.body.classList.contains('lv-sheet-on'), y: document.getElementById('page-perform').scrollTop }));
      R.check(c.none && c.y === y0, vp + ' ' + m + ': Done closes it and the page has not moved', JSON.stringify(c) + ' was ' + y0);
    }

    if (vp === 'p430') {
      // Arrange: free is locked, pro moves.
      await page.evaluate(() => setModTier('free')); await page.waitForTimeout(400);
      const before = await page.evaluate(() => LV.slots.join());
      await page.evaluate(() => document.querySelector('#lv-slots .lv-slot[data-mod=melody] .lv-cb').click()); await page.waitForTimeout(400);
      const lk = await page.evaluate(() => ({ tag: !!document.querySelector('.lv-arr-tag'), locked: [].slice.call(document.querySelectorAll('.lv-arr-b')).filter(b => b.classList.contains('tier-locked')).map(b => b.textContent), std: [].slice.call(document.querySelectorAll('.lv-arr-b')).filter(b => /standard/.test(b.textContent) && !b.classList.contains('tier-locked')).length }));
      R.check(lk.tag && lk.locked.length >= 3 && lk.std === 1, 'a free install sees the rows locked with the Studio Pack tag, and Back to the standard layout open', JSON.stringify(lk));
      await page.evaluate(() => { const b = [].slice.call(document.querySelectorAll('.lv-arr-b.tier-locked'))[0]; b.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(200);
      const bb = await page.evaluate(() => { const r = [].slice.call(document.querySelectorAll('.lv-arr-b.tier-locked'))[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(bb.x, bb.y); await page.waitForTimeout(500);
      R.check((await page.evaluate(() => !!document.getElementById('_pro-sheet') && LV.slots.join())) === before, 'a tap on a locked row opens the pack sheet and changes nothing', before);
      await page.evaluate(() => { const s = document.getElementById('_pro-sheet'); if (s) s.remove(); lvSheetClose(); setModTier('pro'); }); await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('#lv-slots .lv-slot[data-mod=melody] .lv-cb').click()); await page.waitForTimeout(400);
      await page.evaluate(() => [].slice.call(document.querySelectorAll('.lv-arr-b')).filter(b => b.textContent === 'Move up')[0].click()); await page.waitForTimeout(500);
      const mv = await page.evaluate(() => ({ slots: LV.slots.join(), open: !!document.querySelector('.lv-sheet') }));
      R.check(mv.slots.indexOf('melody,chords') === 0 && !mv.open, 'with the pack, Move up moves the widget and the sheet closes', JSON.stringify(mv));
      await page.evaluate(() => lvSet(LV_STD));
      await page.evaluate(() => document.querySelector('#lv-slots .lv-slot[data-mod=chords] .lv-cb').click()); await page.waitForTimeout(300);
      await page.evaluate(() => [].slice.call(document.querySelectorAll('.lv-arr-b')).filter(b => /^Swap/.test(b.textContent))[0].click()); await page.waitForTimeout(200);
      R.check(await page.evaluate(() => document.querySelectorAll('.lv-arr-swap .lv-arr-b').length) >= 6, 'Swap with… lists the other widgets');
      await page.evaluate(() => lvSheetClose());

      // The Mixer widget is rows.
      await page.evaluate(() => lvSet(['chords', 'mixer'])); await page.waitForTimeout(700);
      const mx = await page.evaluate(() => { const h = document.getElementById('lv-mixer-host'); return { rows: h.querySelectorAll('.mixrow').length, strips: h.querySelectorAll('.mix-strip').length, ms: h.querySelectorAll('[data-mixmute]').length,
        small: [].slice.call(h.querySelectorAll('button, .mix-fader')).filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).length }; });
      R.check(mx.rows === 9 && mx.strips === 0 && mx.ms === 8 && mx.small === 0, 'the Mixer widget is the Mix tab\'s rows: eight channels and the master, a mute and a solo each, nothing under 44 pt', JSON.stringify(mx));
    }
    R.check(errs.length === 0, vp + ': no page errors', errs.join(' | ').slice(0, 200));
  }
  await h.close(); R.done();
})();
