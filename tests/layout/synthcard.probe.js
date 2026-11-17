/* Slice 4: mõdSynth on each part's own page.

   - Chords, Melody, Bass, Mel Seq and Arp each carry one mõdSynth card, drawn, fitting the screen, every control at least 44 pt;
   - on mõdSynth the card names the patch; ‹ › step it; Random rolls it; the caret folds it (and the fold is remembered);
   - off mõdSynth the card offers "Play ... on mõdSynth" and that switches the part;
   - Edit synth opens the editor layer (patch card, eight macros, Synth/Mod/FX pages) and Back closes it, leaving the page where it was;
   - a free build shows the Studio Pack note instead of controls.

   Run: node tests/layout/synthcard.probe.js */
'use strict';
const L = require('./lib.js');
const PARTS = [['Chords', 'chord'], ['Melody', 'mel'], ['Bass', 'bass'], ['Mel Seq', 'melgen'], ['Arp', 'arp']];

(async () => {
  const h = await L.start(), R = L.reporter();
  for (const vp of ['p430', 'p390', 'se375']) {
    const { page, errs } = await L.boot(h, vp, 'studio');
    await page.evaluate(() => msxLoadLib()); await page.waitForTimeout(300);
    for (const [name, key] of PARTS) {
      await L.goStudio(page, name);
      const off = await page.evaluate(k => { const c = document.querySelector('.msx-pcard[data-msxpart="' + k + '"]'); const r = c.getBoundingClientRect(); return { n: document.querySelectorAll('.msx-pcard[data-msxpart="' + k + '"]').length, shown: r.height > 0, w: Math.round(r.width), vw: innerWidth, go: !!c.querySelector('.msx-pc-edit') && /Play/.test(c.querySelector('.msx-pc-edit').textContent) }; }, key);
      R.check(off.n === 1 && off.shown && off.w <= off.vw, vp + ' ' + name + ': one mõdSynth card, drawn and fitting', JSON.stringify(off));
      if (off.go) {
        await page.evaluate(k => { document.querySelector('.msx-pcard[data-msxpart="' + k + '"] .msx-pc-edit').click(); }, key);
        await page.waitForTimeout(900);
      }
      const on = await page.evaluate(k => ({ on: _msxOnIt(k), name: (document.querySelector('.msx-pcard[data-msxpart="' + k + '"] .msx-pc-name') || {}).textContent }), key);
      R.check(on.on && !!on.name, vp + ' ' + name + ': Play on mõdSynth switches the part and the card names the patch', JSON.stringify(on));
      await page.waitForTimeout(500);
      const cardInk = await page.evaluate(k => { const c = document.querySelector('.msx-pcard[data-msxpart="' + k + '"] canvas.msx-wt'); if (!c || !c.width) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; }, key);
      R.check(cardInk > 300, vp + ' ' + name + ': the card draws the wavetable', cardInk + ' px');
      const small = await page.evaluate(k => [].slice.call(document.querySelectorAll('.msx-pcard[data-msxpart="' + k + '"] button')).filter(b => { const r = b.getBoundingClientRect(); return r.height > 0 && (r.width < 43.5 || r.height < 43.5); }).map(b => b.textContent + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)), key);
      R.check(small.length === 0, vp + ' ' + name + ': every card control is at least 44 pt', small.join('; '));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      R.check(over <= 1, vp + ' ' + name + ': no sideways overflow', over + ' pt');
    }
    if (vp === 'p430') {
      await L.goStudio(page, 'Bass');
      const sel = '.msx-pcard[data-msxpart="bass"] ';
      const n0 = await page.evaluate(s => document.querySelector(s + '.msx-pc-name').textContent, sel);
      await page.click(sel + '.msx-pc-next'); await page.waitForTimeout(500);
      const n1 = await page.evaluate(s => document.querySelector(s + '.msx-pc-name').textContent, sel);
      R.check(n1 !== n0 && n1 === (await page.evaluate(() => MSX.state.bass.patch)), '› steps the patch (' + n0 + ' to ' + n1 + ')');
      await page.click(sel + '.msx-pc-prev'); await page.waitForTimeout(500);
      R.check((await page.evaluate(s => document.querySelector(s + '.msx-pc-name').textContent, sel)) === n0, '‹ steps back');
      await page.click(sel + '.msx-pc-btn:not(.msx-pc-prev):not(.msx-pc-next):not(.msx-pc-caret):not(.msx-pc-name)'); await page.waitForTimeout(500);
      const rolled = await page.evaluate(s => ({ name: document.querySelector(s + '.msx-pc-name').textContent, st: MSX.state.bass.name }), sel);
      R.check(rolled.st === 'Random' || /Random/i.test(rolled.name) || rolled.name !== n0, 'the first button rolls a new sound', JSON.stringify(rolled));
      // Fold.
      await page.click(sel + '.msx-pc-caret'); await page.waitForTimeout(300);
      const folded = await page.evaluate(s => ({ body: document.querySelector(s + '.msx-pc-body').getBoundingClientRect().height, saved: JSON.parse(localStorage.getItem('modo-msx-ui')).fold }), sel);
      R.check(folded.body === 0 && folded.saved && folded.saved.bass === true, 'the caret folds the card and the fold is saved', JSON.stringify(folded));
      await page.click(sel + '.msx-pc-caret'); await page.waitForTimeout(300);
      // Editor.
      const pre = await page.evaluate(() => scrollY);
      await page.click(sel + '.msx-pc-edit'); await page.waitForTimeout(1200);
      const ed = await page.evaluate(() => { const o = document.getElementById('synth-ed'); return { open: o.classList.contains('open'), macros: o.querySelectorAll('.mu-macro-slot').length, shown: [].slice.call(o.querySelectorAll('.mu-macro-slot')).filter(e => e.getBoundingClientRect().height > 0).length, tabs: o.querySelectorAll('.mu-tab').length, patch: !!o.querySelector('.msx-patch'), chips: o.querySelectorAll('.msx-part').length, title: document.getElementById('synth-ed-title').textContent }; });
      R.check(ed.open && ed.patch && ed.tabs === 7 && ed.chips === 0 && ed.macros === 8 && ed.shown === 8, 'Edit synth opens the editor layer (patch card, all eight macros shown, Osc/FM/Filter/Env/LFO/Matrix/FX, no part chips)', JSON.stringify(ed));
      const small = await page.evaluate(() => [].slice.call(document.querySelectorAll('#synth-ed .se-back')).map(b => Math.round(b.getBoundingClientRect().height)));
      R.check(small.every(x => x >= 44), 'Back is at least 44 pt', small.join());
      // The wavetable view: drawn (ink on the canvas), named for the oscillator, and it follows the Shape knob and the chips.
      const ink = sel => page.evaluate(s => { const c = document.querySelector(s); if (!c || !c.width) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; }, sel);
      await page.evaluate(() => document.querySelector('#synth-ed .mu-tab[data-page="osc"]').click()); await page.waitForTimeout(700);
      const big = '#synth-ed canvas.msx-wt.big';
      const inkA = await ink(big), labA = await page.evaluate(s => document.querySelector(s).getAttribute('aria-label'), big);
      R.check(inkA > 500 && /oscillator 1/.test(labA), 'the editor draws the wavetable of Osc 1', inkA + ' px; ' + labA);
      await page.evaluate(() => { msxSetParam('bass', 'osc1.shape', 0.9); }); await page.waitForTimeout(400);
      const labB = await page.evaluate(s => document.querySelector(s).getAttribute('aria-label'), big);
      R.check(labB !== labA && /morph 90 percent/.test(labB), 'turning Shape redraws it', labB);
      await page.evaluate(() => [].slice.call(document.querySelectorAll('#synth-ed .mu-subtab')).filter(b => b.dataset.title === 'Oscillator 2')[0].click()); await page.waitForTimeout(400);
      R.check(/oscillator 2/.test(await page.evaluate(s => document.querySelector(s).getAttribute('aria-label'), big)), 'the Osc 2 chip shows oscillator 2');
      await page.evaluate(() => { msxSetParam('bass', 'osc2.wave', 'pulse'); msxSetParam('bass', 'osc2.pw', 0.25); }); await page.waitForTimeout(400);
      R.check(/Pulse, pulse width 25 percent/.test(await page.evaluate(s => document.querySelector(s).getAttribute('aria-label'), big)) && (await ink(big)) > 300, 'a Pulse wave draws as pulse width');
      await page.evaluate(() => [].slice.call(document.querySelectorAll('#synth-ed .mu-subtab')).filter(b => b.dataset.title === 'Oscillator 1')[0].click());
      // The seven pages: each shows panels, nothing overflows, every tab and chip is at least 44 pt, and together they build every control once.
      for (const tab of ['osc', 'fm', 'filter', 'env', 'lfo', 'matrix', 'fx']) {
        await page.evaluate(k => document.querySelector('#synth-ed .mu-tab[data-page="' + k + '"]').click(), tab); await page.waitForTimeout(500);
        const pg = await page.evaluate(k => { const p = MSX.rack.pages[k].page, vis = [].slice.call(p.querySelectorAll('.mu-panel')).filter(e => e.getBoundingClientRect().height > 0);
          const small = [].slice.call(document.querySelectorAll('#synth-ed .mu-tab, #synth-ed .mu-subtab')).filter(b => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height < 43.5).length;
          return { on: p.classList.contains('on'), panels: vis.map(e => e.dataset.title), small, over: document.getElementById('synth-ed-body').scrollWidth - document.getElementById('synth-ed-body').clientWidth }; }, tab);
        R.check(pg.on && pg.panels.length > 0 && pg.small === 0 && pg.over <= 1, 'editor page ' + tab + ': drawn, tabs and chips at least 44 pt, no sideways overflow', JSON.stringify(pg));
        if (tab === 'osc') R.check(pg.panels.length === 1 && pg.panels[0] === 'Oscillator 1', 'Osc shows one panel at a time (Oscillator 1 first)', pg.panels.join());
      }
      await page.evaluate(() => document.querySelector('#synth-ed .mu-tab[data-page="osc"]').click());
      await page.evaluate(() => [].slice.call(document.querySelectorAll('#synth-ed .mu-subtab')).filter(b => b.dataset.title === 'Voice')[0].click()); await page.waitForTimeout(300);
      R.check(await page.evaluate(() => [].slice.call(document.querySelectorAll('#synth-ed .mu-page.on .mu-rack > .mu-panel')).filter(e => e.getBoundingClientRect().height > 0).map(e => e.dataset.title).join() === 'Voice'), 'the Voice chip shows the Voice panel');
      const nIds = await page.evaluate(() => MSX.rack.ui.controls.size);
      R.check(nIds === 237, 'the seven pages build the same 237 controls the three did', String(nIds));
      await page.click('#synth-ed .se-back'); await page.waitForTimeout(400);
      const back = await page.evaluate(() => ({ open: document.getElementById('synth-ed').classList.contains('open'), y: scrollY }));
      R.check(!back.open && back.y === pre, 'Back closes the editor and the page has not moved', JSON.stringify(back) + ' was ' + pre);
      // Mix > mõdSynth still draws.
      await L.goMix(page, 'mõdSynth');
      const mix = await page.evaluate(() => ({ chips: document.querySelectorAll('#mix-synth-pane .msx-part').length, patch: !!document.querySelector('#mix-synth-pane .msx-patch') }));
      R.check(mix.chips === 5 && mix.patch, 'Mix > mõdSynth still draws its part chips and patch card', JSON.stringify(mix));
      // Free build.
      await page.evaluate(() => setModTier('free')); await page.waitForTimeout(500);
      await L.goStudio(page, 'Arp');
      const free = await page.evaluate(() => { const c = document.querySelector('.msx-pcard[data-msxpart="arp"]'); return { note: /mõdSynth Engine/.test(c.textContent), btns: c.querySelectorAll('.msx-pc-body button').length }; });
      R.check(free.note && free.btns === 0, 'a free build shows the pack note and no controls', JSON.stringify(free));
    }
    R.check(errs.length === 0, vp + ': no page errors', errs.join(' | ').slice(0, 200));
  }
  await h.close(); R.done();
})();
