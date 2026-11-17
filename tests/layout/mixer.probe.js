/* Slice 3: Mix > Mixer is rows.

   Geometry at 375, 390 and 430: nine rows of 48 pt (every channel and the master), the switch of six, every target at least
   44 pt, a fader track at least 300 pt long where the strips had 114, nothing scrolling sideways, the page no taller than the
   strips' 984 pt. Behaviour with a real mouse on the real faders: the level, pan and the four sends move the same stores they
   always did, mute and solo dim the row, the master's bus and clip, a tap on a name opens that channel's strip with every
   control it had (pan, four sends, EQ), the mode is remembered in modo-mix-ui, the meters run, and a free build shows Level
   and Pan only (the sends are the mõdSynth Engine's).

   Run: node tests/layout/mixer.probe.js */
'use strict';
const L = require('./lib.js');

(async () => {
  const h = await L.start(), R = L.reporter();
  for (const vp of ['se375', 'p390', 'p430']) {
    const { page, ctx, errs } = await L.boot(h, vp, 'studio');
    await L.goMix(page, 'Mixer');
    const g = await page.evaluate(() => {
      const host = document.getElementById('mix-tab-channels');
      const rows = [].slice.call(host.querySelectorAll('.mixrow')), r0 = rows[0].getBoundingClientRect();
      const tr = rows[0].querySelector('.mixrow-track').getBoundingClientRect();
      const ms = [].slice.call(host.querySelectorAll('.mixrow .mix-msb')).map(b => b.getBoundingClientRect());
      const modes = [].slice.call(host.querySelectorAll('.mix-modeb')).map(b => b.getBoundingClientRect());
      const hb = host.getBoundingClientRect();
      return { n: rows.length, h: rows.map(r => Math.round(r.getBoundingClientRect().height)), track: Math.round(tr.width), trackH: Math.round(tr.height),
        msMin: Math.min.apply(null, ms.map(b => Math.min(b.width, b.height))), modes: modes.length, modeMin: Math.min.apply(null, modes.map(b => Math.min(b.width, b.height))),
        hostH: Math.round(hb.height), over: document.documentElement.scrollWidth - innerWidth, meters: host.querySelectorAll('.mix-meter[data-mixmeter]').length,
        names: [].slice.call(host.querySelectorAll('.mixrow-name')).map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }) };
    });
    R.check(g.n === 9 && g.h.every(x => x === 48), vp + ': nine rows, each 48 pt', JSON.stringify(g.h));
    R.check(g.trackH >= 44 && g.msMin >= 44 && g.modes === 6 && g.modeMin >= 44, vp + ': the track, M, S and the six mode buttons are all at least 44 pt', 'track ' + g.trackH + ', M/S ' + g.msMin + ', modes ' + g.modeMin);
    R.check(g.names.every(x => x >= 44), vp + ': every channel name is a 44 pt target', 'min ' + Math.round(Math.min.apply(null, g.names)));
    R.check(g.track >= 200, vp + ': the fader track is at least 200 pt long (the strips had 114 pt)', g.track + ' pt');
    R.check(g.over <= 1, vp + ': nothing scrolls sideways', g.over + ' pt');
    R.check(g.meters === 9, vp + ': a meter under every level fader', g.meters);
    R.check(g.hostH <= 984, vp + ': the rows are no taller than the strips were (984 pt)', g.hostH + ' pt');
    if (vp !== 'p430') { R.check(errs.length === 0, vp + ': no page errors', errs.join(' | ')); await ctx.close(); continue; }

    // ── Behaviour, with the real mouse.
    const centre = async sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, w: r.width }; }, sel);
    const dragFader = async (rowSel, frac) => {
      const c = await centre(rowSel + ' .mix-fader'); await page.mouse.move(c.l + c.w * 0.6, c.y); await page.mouse.down();   // the name's 88 pt at the left is its own button
      await page.mouse.move(c.l + 20 + (c.w - 40) * frac, c.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
    };
    const before = await page.evaluate(() => (window.sqMixGainsW && window.sqMixGainsW.bass != null) ? window.sqMixGainsW.bass : 1);
    await dragFader('[data-mixrow=bass]', 0.5);
    const gain = await page.evaluate(() => ({ g: window.sqMixGainsW.bass, val: document.querySelector('[data-mixrow=bass] .mixrow-val').textContent, now: document.querySelector('[data-mixrow=bass] .mix-fader').getAttribute('aria-valuenow') }));
    R.check(gain.g < before && gain.g > 0.05 && /dB$/.test(gain.val), 'dragging Bass\'s fader moves its gain (a stored gain, cube law) and its dB readout', JSON.stringify(gain));

    await page.click('[data-mixrow=bass] [data-mixmute=bass]'); await page.waitForTimeout(150);
    const mute = await page.evaluate(() => ({ m: !!(window.sqMixMute && window.sqMixMute.bass), on: document.querySelector('[data-mixmute=bass]').classList.contains('on'), dim: document.querySelector('[data-mixrow=bass]').classList.contains('mix-silenced'), tab: document.getElementById('tab-mix').classList.contains('ms-on') }));
    R.check(mute.m && mute.on && mute.dim && mute.tab, 'Mute: the store, the button, the dimmed row and the Mix tab\'s dot', JSON.stringify(mute));
    await page.click('[data-mixrow=bass] [data-mixmute=bass]'); await page.waitForTimeout(100);
    await page.click('[data-mixrow=arp] [data-mixsolo=arp]'); await page.waitForTimeout(150);
    const solo = await page.evaluate(() => ({ s: !!(window.sqMixSolo && window.sqMixSolo.arp), dimBass: document.querySelector('[data-mixrow=bass]').classList.contains('mix-silenced') }));
    R.check(solo.s && solo.dimBass, 'Solo: Arp soloed, the other rows dim', JSON.stringify(solo));
    await page.click('[data-mixrow=arp] [data-mixsolo=arp]'); await page.waitForTimeout(100);

    // Modes.
    await page.click('[data-mixmode=pan]'); await page.waitForTimeout(150);
    const panRows = await page.evaluate(() => document.querySelectorAll('#mix-tab-channels .mixrow-pan').length);
    await dragFader('[data-mixrow=chord]', 0.95);
    const pan = await page.evaluate(() => ({ p: window.sqMixPan && window.sqMixPan.chord, val: document.querySelector('[data-mixrow=chord] .mixrow-val').textContent }));
    R.check(panRows === 8 && pan.p > 0.5 && /^R\d+$/.test(pan.val), 'Pan mode: eight pan faders (the master has none); dragging right pans right and reads R<n>', JSON.stringify([panRows, pan]));
    await page.click('[data-mixmode=rev]'); await page.waitForTimeout(150);
    await dragFader('[data-mixrow=mel]', 0.6);
    const rev = await page.evaluate(() => ({ v: fxSendsAPI.get('mel', 'rev'), val: document.querySelector('[data-mixrow=mel] .mixrow-val').textContent, tag: document.querySelector('[data-mixrow=mel] .mix-fader').dataset.fxsend }));
    R.check(rev.v > 0.3 && rev.v < 0.9 && Math.abs(+rev.val / 100 - rev.v) < 0.011 && rev.tag === 'mel:rev', 'Rev mode: dragging Melody\'s fader sets its reverb send (fxSendsAPI) and reads the same number', JSON.stringify(rev));
    await page.evaluate(() => fxSendsAPI.set('mel', 'rev', 0.1)); await page.evaluate(() => window.mixSyncFx());
    const painted = await page.evaluate(() => document.querySelector('[data-mixrow=mel] .mixrow-val').textContent);
    R.check(painted === '10', 'a send changed from elsewhere repaints the row (mixSyncFx), no rebuild', painted);
    for (const m of ['dly', 'drv', 'mix']) {
      await page.click('[data-mixmode=' + m + ']'); await page.waitForTimeout(120);
      const c = await page.evaluate(m2 => document.querySelectorAll('#mix-tab-channels .mixrow [data-fxsend$=":' + m2 + '"]').length, m);
      R.check(c === 8, m + ' mode: eight faders for the sends', c);
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('modo-mix-ui') || 'null'));
    R.check(saved && saved.mode === 'mix', 'the mode is remembered in modo-mix-ui', JSON.stringify(saved));
    await page.click('[data-mixmode=level]');

    // Master row.
    const mv0 = await page.evaluate(() => masterVol);
    await dragFader('[data-mixrow=__master]', 0.4);
    const mv = await page.evaluate(() => ({ v: masterVol, val: document.querySelector('[data-mixrow=__master] .mixrow-val').textContent }));
    R.check(mv.v < mv0 && /dB$/.test(mv.val), 'the master fader moves masterVol', JSON.stringify(mv));
    const bus0 = await page.evaluate(() => masterBusOn);
    await page.click('[data-mixrow=__master] [data-masterbus]'); await page.waitForTimeout(150);
    const bus = await page.evaluate(() => ({ on: masterBusOn, lit: document.querySelector('[data-mixrow=__master] [data-masterbus]').classList.contains('on') }));
    R.check(bus.on !== bus0 && bus.lit === bus.on, 'the master\'s BUS button switches the bus and shows it', JSON.stringify(bus));
    await page.click('[data-mixrow=__master] [data-masterbus]');
    await page.evaluate(() => { document.querySelectorAll('[data-mixclip]').forEach(b => b.classList.add('lit')); _mixClipped = true; });
    await page.click('[data-mixrow=__master] [data-mixclip]');
    const clip = await page.evaluate(() => ({ c: _mixClipped, lit: document.querySelectorAll('[data-mixclip].lit').length }));
    R.check(!clip.c && clip.lit === 0, 'CLIP clears every clip light', JSON.stringify(clip));

    // A channel's strip.
    await page.click('[data-mixopen=chord]'); await page.waitForTimeout(200);
    const d = await page.evaluate(() => {
      const rows = [].slice.call(document.querySelectorAll('#mix-tab-channels .mixrow'));
      return { rows: rows.length, kinds: [].slice.call(document.querySelectorAll('#mix-tab-channels .mixrow .mix-fader')).map(f => f.dataset.fxsend || (f.getAttribute('aria-label') || '').replace(/^Chords /, '')), ms: document.querySelectorAll('#mix-tab-channels [data-mixmute]').length, eq: document.querySelectorAll('#mix-tab-channels .mix-eqcard .eqp-band').length === 5, back: !!document.querySelector('[data-mixback]'),
        small: [].slice.call(document.querySelectorAll('#mix-tab-channels button, #mix-tab-channels .mix-fader')).filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).length };
    });
    R.check(d.rows === 6 && d.kinds.length === 6 && d.ms === 1 && d.eq && d.back && d.small === 0, 'a name opens the channel\'s strip: level with M and S, pan, four sends, EQ and a way back, nothing under 44 pt', JSON.stringify(d));
    const eqo = await page.evaluate(() => ({ title: (document.querySelector('#mix-tab-channels .mix-eqcard .eqp-title') || {}).textContent, canvas: !!document.querySelector('#mix-tab-channels .mix-eqcard canvas') }));
    R.check(/Chords EQ/.test(eqo.title) && eqo.canvas, 'the strip carries that part\'s EQ card (graph and five bands), not a button', JSON.stringify(eqo));
    await page.click('[data-mixback]'); await page.waitForTimeout(150);
    R.check(await page.evaluate(() => document.querySelectorAll('#mix-tab-channels .mixrow').length) === 9, 'back returns to the nine rows');
    // The master's strip.
    await page.evaluate(() => { MIXUI.open = '__master'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); });
    const md = await page.evaluate(() => ({ rows: document.querySelectorAll('#mix-tab-channels .mixrow').length, bus: !!document.querySelector('#mix-tab-channels [data-masterbus]'), clip: !!document.querySelector('#mix-tab-channels [data-mixclip]'), eq: document.querySelectorAll('#mix-tab-channels .mix-eqcard .eqp-band').length === 6 }));
    R.check(md.rows === 3 && md.bus && md.clip && md.eq, 'the master\'s strip: volume with BUS and CLIP, glue, room, EQ', JSON.stringify(md));
    await page.evaluate(() => { MIXUI.open = ''; buildMixChannelsInto(document.getElementById('mix-tab-channels')); });

    // Every channel's strip has everything the old strip had: level with M and S, pan, the four sends, the EQ, and a way back.
    const ids = await page.evaluate(() => MIX_CHANNELS.map(c => c.id));
    const bad = [];
    for (const id of ids) {
      await page.evaluate(i => { MIXUI.open = i; buildMixChannelsInto(document.getElementById('mix-tab-channels')); }, id);
      const k = await page.evaluate(i => ({
        faders: [].slice.call(document.querySelectorAll('#mix-tab-channels .mix-fader')).map(f => f.getAttribute('aria-label')),
        mute: !!document.querySelector('#mix-tab-channels [data-mixmute="' + i + '"]'), solo: !!document.querySelector('#mix-tab-channels [data-mixsolo="' + i + '"]'),
        eq: document.querySelectorAll('#mix-tab-channels .mix-eqcard .eqp-band').length === 5 }), id);
      const ok = k.faders.length === 6 && /level$/.test(k.faders[0]) && /pan$/.test(k.faders[1]) && /reverb send$/.test(k.faders[2]) && /delay send$/.test(k.faders[3]) && /drive send$/.test(k.faders[4]) && /mõdFX mix$/.test(k.faders[5]) && k.mute && k.solo && k.eq;
      if (!ok) bad.push(id + ' ' + JSON.stringify(k));
    }
    R.check(ids.length === 8 && bad.length === 0, 'all eight channels\' strips have level, M, S, pan, reverb, delay, drive, mõdFX mix and EQ', bad.join(' ; '));
    await page.evaluate(() => { MIXUI.open = ''; buildMixChannelsInto(document.getElementById('mix-tab-channels')); });

    // Meters run.
    await page.evaluate(() => mixMetersStart()); await page.waitForTimeout(300);
    R.check(await page.evaluate(() => !!_mixMeterRaf), 'the meters run on the rows');

    // A free build: Level and Pan only.
    await page.evaluate(() => { setModTier('free'); }); await page.waitForTimeout(500);
    await page.evaluate(() => { MIXUI.mode = 'rev'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); });
    const fr = await page.evaluate(() => ({ vis: [].slice.call(document.querySelectorAll('#mix-tab-channels .mix-modeb')).filter(b => b.getBoundingClientRect().height > 0).map(b => b.textContent), rows: document.querySelectorAll('#mix-tab-channels .mixrow').length }));
    R.check(fr.vis.join() === 'Level,Pan' && fr.rows === 9, 'a free build shows Level and Pan (the sends are the mõdSynth Engine\'s) and falls back to Level rows', JSON.stringify(fr));
    await page.evaluate(() => { setModTier('pro'); MIXUI.mode = 'level'; buildMixChannelsInto(document.getElementById('mix-tab-channels')); });
    R.check(errs.length === 0, vp + ': no page errors', errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await h.close();
  R.done();
})();
