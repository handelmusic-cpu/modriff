/* Slice 7: the EQ is five bands on a strip (six on the master) in a card in the channel's strip, and the whole EQ is the Studio Pack's.

   - the card is drawn (graph with ink), has HPF, LO, MID, HI, LPF (the master adds MID 2), every control at least 44 pt, no sideways overflow;
   - dragging a dot on the graph moves that band's gain and frequency; a slider and the filter's On / slope buttons write the same fields;
   - Set EQ back to flat clears the strip's entry;
   - on a free build the card is shown locked: tapping it opens the pack sheet and changes nothing, the saved EQ still reads back (and
     still shapes the response), and Set EQ back to flat still works; the pack releases it again.

   Run: node tests/layout/eq.probe.js */
'use strict';
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  for (const vp of ['p430', 'p390', 'se375']) {
    const { page, errs } = await L.boot(h, vp, 'studio');
    await L.goMix(page, 'Mixer');
    await page.evaluate(() => { MIXUI.open = 'bass'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); }); await page.waitForTimeout(500);
    const sel = '#mix-tab-channels .mix-eqcard';
    await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); await page.waitForTimeout(300);
    const info = await page.evaluate(s => {
      const c = document.querySelector(s), cv = c.querySelector('canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) ink++;
      const small = [].slice.call(c.querySelectorAll('button, input')).filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map(e => (e.textContent || e.type) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
      return { bands: [].slice.call(c.querySelectorAll('.eqp-band')).map(b => b.textContent), ink, small, over: document.documentElement.scrollWidth - innerWidth, w: Math.round(c.getBoundingClientRect().width) };
    }, sel);
    R.check(info.bands.join() === 'HPF,LO,MID,HI,LPF' && info.ink > 800, vp + ': Bass EQ card has the five bands and draws the graph', JSON.stringify({ bands: info.bands, ink: info.ink }));
    R.check(info.small.length === 0 && info.over <= 1, vp + ': every EQ control is at least 44 pt and nothing overflows sideways', info.small.join('; ') + ' over ' + info.over);

    if (vp === 'p430') {
      // Drag the MID dot up and to the right.
      const box = await page.evaluate(s => { const cv = document.querySelector(s + ' canvas'); const r = cv.getBoundingClientRect(); const P = EQ_PANELS.filter(p => p.el === document.querySelector(s))[0]; const d = P.dots.filter(x => x.k === 'mid')[0]; return { x: r.left + d.x, y: r.top + d.y, w: r.width, h: r.height }; }, sel);
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y - 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
      const m = await page.evaluate(() => mixEqGet('bass'));
      R.check(m.mid > 2 && m.midHz > 1300, 'dragging the MID dot moved its gain and frequency', JSON.stringify({ mid: m.mid, midHz: Math.round(m.midHz) }));
      // The slider writes the same field.
      await page.evaluate(s => { const i = document.querySelector(s + ' .eqp-row input'); i.value = '-4'; i.dispatchEvent(new Event('input', { bubbles: true })); }, sel);
      R.check((await page.evaluate(() => mixEqGet('bass').mid)) === -4, 'the Gain slider sets MID');
      // HPF: switch on, 24 dB.
      await page.evaluate(s => [].slice.call(document.querySelectorAll(s + ' .eqp-band')).filter(b => b.textContent === 'HPF')[0].click(), sel);
      await page.evaluate(s => document.querySelector(s + ' .eqp-on').click(), sel);
      await page.evaluate(s => document.querySelector(s + ' [data-slope="24"]').click(), sel);
      const hp = await page.evaluate(() => mixEqGet('bass'));
      R.check(hp.hpfOn === 1 && hp.hpfSlope === 24, 'HPF On and 24 dB write the filter fields', JSON.stringify({ on: hp.hpfOn, slope: hp.hpfSlope }));
      const resp = await page.evaluate(() => Math.round(eqResponseDb(mixEqGet('bass'), 30) * 10) / 10);
      R.check(resp < -6, 'the curve shows the filter (response at 30 Hz)', resp + ' dB');
      // Master has six bands.
      await page.evaluate(() => { MIXUI.open = '__master'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); }); await page.waitForTimeout(300);
      R.check((await page.evaluate(s => [].slice.call(document.querySelectorAll(s + ' .eqp-band')).map(b => b.textContent).join(), sel)) === 'HPF,LO,MID 1,MID 2,HI,LPF', 'the master card has six bands');
      await page.evaluate(() => { MIXUI.open = 'bass'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); }); await page.waitForTimeout(300);

      // A free build: locked, still sounding, still clearable.
      const before = await page.evaluate(() => JSON.stringify(mixEqGet('bass')));
      await page.evaluate(() => setModTier('free')); await page.waitForTimeout(500);
      const lk = await page.evaluate(s => { const c = document.querySelector(s); return { locked: !c.querySelector('.eqp-lock').hidden, cls: c.querySelector('.eqp-main').classList.contains('tier-locked'), text: c.querySelector('.eqp-lock').textContent, flat: getComputedStyle(c.querySelector('.eqp-flat')).display !== 'none' }; }, sel);
      R.check(lk.locked && lk.cls && /Studio Pack/.test(lk.text) && /keeps playing/.test(lk.text) && lk.flat, 'a free build shows the card locked, says the saved EQ keeps playing, offers flat', JSON.stringify(lk));
      await page.evaluate(s => document.querySelector(s + ' .eqp-cv').scrollIntoView({ block: 'center' }), sel); await page.waitForTimeout(200);
      const cvb = await page.evaluate(s => { const r = document.querySelector(s + ' .eqp-cv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      await page.mouse.click(cvb.x, cvb.y); await page.waitForTimeout(500);
      const sheet = await page.evaluate(() => !!document.getElementById('_pro-sheet'));
      R.check(sheet, 'tapping the locked card opens the pack sheet');
      await page.evaluate(() => { const s = document.getElementById('_pro-sheet'); if (s) { const b = s.querySelector('button'); } });
      R.check((await page.evaluate(() => JSON.stringify(mixEqGet('bass')))) === before, 'and changes nothing: the saved EQ is as it was');
      R.check(await page.evaluate(() => Math.round(eqResponseDb(mixEqGet('bass'), 30)) < -6), 'the saved EQ still shapes the response (the audio path is not gated)');
      await page.evaluate(() => { const s = document.getElementById('_pro-sheet'); if (s) s.remove(); document.body.style.overflow = ''; });
      await page.evaluate(s => document.querySelector(s + ' .eqp-flat').click(), sel); await page.waitForTimeout(200);
      R.check(await page.evaluate(() => !(window.sqMixEq && window.sqMixEq.bass)), 'Set EQ back to flat works on a free build');
      await page.evaluate(() => setModTier('pro')); await page.waitForTimeout(500);
      R.check(await page.evaluate(s => document.querySelector(s + ' .eqp-lock').hidden && !document.querySelector(s + ' .eqp-main').classList.contains('tier-locked'), sel), 'the pack releases it');
    }
    R.check(errs.length === 0, vp + ': no page errors', errs.join(' | ').slice(0, 200));
  }
  await h.close(); R.done();
})();
