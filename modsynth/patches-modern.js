/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — the Modern bank (written for mõdRïff, 4.7.0)
   ───────────────────────────────────────────────────────────────────────────
   The factory banks are polite: of 302 patches, 30 use the drive, 8 the
   crusher, 20 FM and 19 a motion lane, and every macro starts at zero — two
   clean oscillators into a gentle filter. Played against modern records they
   read as presets. This bank is the other way round: grit, density and
   movement are the starting point, and the four macros are wired to the moves
   a producer actually reaches for (open it, dirty it, widen it, make it move).

   What they share, and why:
     - OTT on most patches (fx.ott, added to the rack for this bank). It is
       the single biggest difference between a modern preset and a vintage one.
     - Saturation somewhere in every patch — filter drive, the FX drive, or a
       fold — so nothing is a pure textbook waveform.
     - Macros named for what they do, each one a large move. A macro that
       barely changes the sound is a bug here, and a test (tests/modsynth)
       measures each one.
     - Levels are calibrated after the fact by master.vol (cal in each patch),
       so stepping through the bank does not jump in loudness.

   Matrix rows are [source, destination, amount, unipolar]. Scales, from
   dsp.js: pitch 1.0 = 24 st, cutoff 1.0 = 8 octaves, detune 1.0 = 100 ct,
   amp 1.0 = +100 %, lfo/env rate 1.0 = ×16.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const BANK = [];

  // What nearly every patch in the bank starts from.
  const BASE = {
    'voice.drift': 0.18,
    'flt1.drive': 0.25,
    'fx.ott.on': 1, 'fx.ott.depth': 0.4, 'fx.ott.time': 0.3, 'fx.ott.upward': 0.55,
    'master.limit': 1,
  };
  const MONO = { 'voice.mode': 'mono', 'voice.poly': 1 };
  const LEGATO = { 'voice.mode': 'legato', 'voice.poly': 1, 'voice.glideAuto': 1 };

  function p(name, category, tags, values, matrix, macros, motion) {
    BANK.push({
      name, category, bank: 'modern',
      tags: String(tags).split(/\s*,\s*/).filter(Boolean),
      author: 'mõdRïff',
      values: Object.assign({}, BASE, values),
      matrix: matrix || [],
      macros: macros || null,
      motion: motion || null,
    });
  }
  // A 16-step motion lane from a function of the step index.
  const lane = fn => Array.from({ length: 16 }, (_, i) => Math.max(-1, Math.min(1, fn(i))));

  /* ════════════════════════════════ BASS ════════════════════════════════ */

  p('Reese Grit', 'Bass', 'reese, dnb, dark, detuned', Object.assign({}, MONO, {
    'voice.glide': 0.04,
    'osc1.wave': 'classic', 'osc1.shape': 0.66, 'osc1.uni': 4, 'osc1.detune': 22, 'osc1.width': 0.5, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.66, 'osc2.fine': 14, 'osc2.uni': 2, 'osc2.detune': 30, 'osc2.level': 0.6,
    'mix.sub': 0.55, 'mix.subWave': 'sine',
    'flt1.model': 'ladder4', 'flt1.cutoff': 700, 'flt1.res': 0.22, 'flt1.drive': 0.5,
    'lfo1.shape': 'sine', 'lfo1.sync': 1, 'lfo1.div': '1_2', 'lfo1.depth': 0,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.4, 'fx.drive.tone': 0.45,
    'fx.ott.depth': 0.5, 'fx.width': 0.6,
    'env1.a': 0.003, 'env1.d': 0.6, 'env1.s': 0.9, 'env1.r': 0.12,
  }), [
    ['m1', 'flt1.cutoff', 0.45], ['m2', 'fx.drive.amount', 0.55], ['m2', 'flt1.drive', 0.45],
    ['m3', 'osc1.detune', 0.5], ['m3', 'osc2.detune', 0.6],
    ['lfo1', 'flt1.cutoff', 0.22], ['m4', 'lfo1.depth', 1, 1],
  ], ['Open', 'Grit', 'Width', 'Movement']);

  p('Wobble 1/8', 'Bass', 'dubstep, wobble, lfo, growl', Object.assign({}, MONO, {
    'osc1.wave': 'growl', 'osc1.shape': 0.35, 'osc1.uni': 2, 'osc1.detune': 12, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.66, 'osc2.oct': -1, 'osc2.level': 0.45,
    'mix.sub': 0.45,
    'flt1.model': 'diode', 'flt1.cutoff': 380, 'flt1.res': 0.45, 'flt1.drive': 0.55,
    'lfo1.shape': 'sine', 'lfo1.sync': 1, 'lfo1.div': '1_8', 'lfo1.depth': 0.35,
    'fx.drive.on': 1, 'fx.drive.type': 'fold', 'fx.drive.amount': 0.25,
    'fx.crush.on': 1, 'fx.crush.bits': 7, 'fx.crush.rate': 0.45, 'fx.crush.mix': 0,
    'fx.ott.depth': 0.55,
  }), [
    ['lfo1', 'flt1.cutoff', 0.42], ['lfo1', 'osc1.shape', 0.25],
    ['m1', 'lfo1.depth', 0.65], ['m1', 'flt1.res', 0.25],
    ['m2', 'fx.drive.amount', 0.6], ['m3', 'osc1.shape', 0.6], ['m4', 'fx.crush.mix', 0.85, 1],
  ], ['Wub', 'Fold', 'Talk', 'Crush']);

  p('808 Distorted', 'Bass', '808, trap, sub, distorted', Object.assign({}, MONO, {
    'voice.glide': 0.07, 'voice.glideAuto': 1,
    'osc1.wave': 'classic', 'osc1.shape': 0.0, 'osc1.level': 1,
    'flt1.model': 'ladder2', 'flt1.cutoff': 2600, 'flt1.res': 0.05, 'flt1.drive': 0.35,
    'env1.a': 0.001, 'env1.d': 1.6, 'env1.s': 0.0, 'env1.r': 0.35, 'env1.curve': 0.3,
    'env3.a': 0.0, 'env3.d': 0.07, 'env3.s': 0,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.5, 'fx.drive.tone': 0.4,
    'fx.crush.on': 1, 'fx.crush.bits': 9, 'fx.crush.rate': 0.6, 'fx.crush.mix': 0,
    'fx.ott.depth': 0.3, 'fx.width': 0,
  }), [
    ['env3', 'pitch', 0.12, 1],
    ['m1', 'fx.drive.amount', 0.5], ['m2', 'flt1.cutoff', -0.35], ['m3', 'mix.sub', 0.6],
    ['m4', 'fx.crush.mix', 0.7, 1],
  ], ['Distort', 'Dark', 'Sub', 'Crush']);

  p('Neuro Growl', 'Bass', 'neuro, dnb, growl, fm, motion', Object.assign({}, MONO, {
    'osc1.wave': 'growl', 'osc1.shape': 0.5, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'fold', 'osc2.shape': 0.3, 'osc2.oct': -1, 'osc2.level': 0.6,
    'mix.fm': 0.25, 'mix.sub': 0.35,
    'flt1.model': 'comb', 'flt1.cutoff': 900, 'flt1.res': 0.5, 'flt1.drive': 0.4,
    'flt2.model': 'ladder4', 'flt2.cutoff': 3200, 'flt2.res': 0.2,
    'mot1.on': 1, 'mot1.sync': 1, 'mot1.div': '1_16', 'mot1.slew': 0.35, 'mot1.depth': 0.8,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.35, 'fx.drive.tone': 0.55,
    'fx.ott.depth': 0.6,
  }), [
    ['mot1', 'osc1.shape', 0.45], ['mot1', 'flt1.cutoff', 0.35],
    ['m1', 'flt1.cutoff', 0.45], ['m1', 'osc1.shape', 0.3], ['m2', 'mix.fm', 0.6], ['m3', 'flt1.res', 0.4], ['m3', 'fx.drive.amount', 0.4],
    ['m4', 'flt2.cutoff', -0.45],
  ], ['Talk', 'FM', 'Bite', 'Dark'], [lane(i => [0.8, -0.4, 0.2, -0.9, 0.6, -0.2, 0.9, -0.6][i % 8])]);

  p('Acid Squelch', 'Bass', 'acid, 303, squelch, house', Object.assign({}, MONO, {
    'voice.glide': 0.05, 'voice.glideAuto': 1,
    'osc1.wave': 'classic', 'osc1.shape': 0.66, 'osc1.level': 0.9,
    'flt1.model': 'diode', 'flt1.cutoff': 320, 'flt1.res': 0.72, 'flt1.drive': 0.45, 'flt1.env': 0.55, 'flt1.vel': 0.4,
    'env2.a': 0.001, 'env2.d': 0.18, 'env2.s': 0, 'env2.r': 0.1,
    'env1.a': 0.002, 'env1.d': 0.3, 'env1.s': 0.7, 'env1.r': 0.06,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.5,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.0, 'fx.delay.fb': 0.4, 'fx.delay.pong': 0.6,
    'fx.ott.depth': 0.3,
  }), [
    ['m1', 'flt1.cutoff', 0.5], ['m2', 'flt1.res', 0.25], ['m2', 'flt1.drive', 0.45], ['m2', 'fx.drive.amount', 0.35],
    ['m3', 'env2.d', 1], ['m4', 'fx.delay.mix', 0.4, 1],
  ], ['Cutoff', 'Squelch', 'Decay', 'Echo']);

  p('Fold Bass', 'Bass', 'wavefold, gritty, modern', Object.assign({}, MONO, {
    'osc1.wave': 'classic', 'osc1.shape': 0.0, 'osc1.level': 1,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.33, 'osc2.oct': 1, 'osc2.level': 0.25,
    'flt1.model': 'ladder4', 'flt1.cutoff': 4200, 'flt1.res': 0.1,
    'env1.a': 0.002, 'env1.d': 0.5, 'env1.s': 0.8, 'env1.r': 0.1,
    'fx.drive.on': 1, 'fx.drive.type': 'fold', 'fx.drive.amount': 0.35, 'fx.drive.tone': 0.5,
    'lfo1.shape': 'tri', 'lfo1.sync': 1, 'lfo1.div': '1_4', 'lfo1.depth': 0,
    'fx.ott.depth': 0.45, 'fx.width': 0.3,
  }), [
    ['env2', 'fx.drive.amount', 0.3], ['m1', 'fx.drive.amount', 0.6], ['m2', 'flt1.cutoff', -0.4],
    ['m3', 'osc2.level', 0.6], ['lfo1', 'fx.drive.amount', 0.35], ['m4', 'lfo1.depth', 1, 1],
  ], ['Fold', 'Dark', 'Edge', 'Movement'], null);

  p('Pluck Sub', 'Bass', 'sub, pluck, deep house, tight', Object.assign({}, MONO, {
    'osc1.wave': 'classic', 'osc1.shape': 0.33, 'osc1.level': 1, 'mix.sub': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 260, 'flt1.res': 0.3, 'flt1.env': 0.45,
    'env2.a': 0.001, 'env2.d': 0.16, 'env2.s': 0,
    'env1.a': 0.002, 'env1.d': 0.45, 'env1.s': 0.25, 'env1.r': 0.08,
    'fx.drive.on': 1, 'fx.drive.type': 'soft', 'fx.drive.amount': 0.3, 'fx.width': 0,
  }), [
    ['m1', 'flt1.cutoff', 0.45], ['m2', 'fx.drive.amount', 0.5], ['m3', 'env2.d', 1], ['m4', 'mix.sub', -0.5],
  ], ['Open', 'Warm', 'Length', 'Less Sub']);

  /* ════════════════════════════════ LEAD ════════════════════════════════ */

  p('Hyper Lead', 'Lead', 'supersaw, trance, big, wide', Object.assign({}, LEGATO, {
    'voice.glide': 0.06,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.6, 'osc1.uni': 4, 'osc1.detune': 30, 'osc1.width': 0.9, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.oct': 1, 'osc2.pw': 0.35, 'osc2.level': 0.3,
    'flt1.model': 'ladder2', 'flt1.cutoff': 5200, 'flt1.res': 0.12,
    'lfo1.shape': 'sine', 'lfo1.rate': 5.2, 'lfo1.delay': 0.35, 'lfo1.fade': 0.4, 'lfo1.depth': 0,
    'fx.drive.on': 1, 'fx.drive.type': 'soft', 'fx.drive.amount': 0.25,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.18, 'fx.delay.fb': 0.35, 'fx.delay.pong': 0.7,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.16, 'fx.reverb.decay': 2.6,
    'fx.ott.depth': 0.5,
  }), [
    ['m1', 'flt1.cutoff', 0.4], ['m2', 'osc1.detune', 0.5], ['m3', 'fx.reverb.mix', 0.4], ['m3', 'fx.delay.mix', 0.3],
    ['lfo1', 'pitch', 0.012], ['m4', 'lfo1.depth', 1, 1], ['m4', 'fx.drive.amount', 0.35],
  ], ['Bright', 'Detune', 'Space', 'Scream']);

  p('Crush Lead', 'Lead', 'chiptune, bitcrush, square, retro-modern', Object.assign({}, LEGATO, {
    'voice.glide': 0.04,
    'osc1.wave': 'pulse', 'osc1.pw': 0.25, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.5, 'osc2.oct': -1, 'osc2.level': 0.35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000,
    'fx.crush.on': 1, 'fx.crush.bits': 5, 'fx.crush.rate': 0.35, 'fx.crush.mix': 0.15,
    'lfo1.rate': 0.8, 'lfo1.depth': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_16d', 'fx.delay.mix': 0.15, 'fx.delay.fb': 0.3,
    'fx.ott.depth': 0.35,
  }), [
    ['m1', 'fx.crush.mix', 0.85], ['m2', 'osc1.pw', 0.4], ['lfo1', 'osc1.pw', 0.35], ['m3', 'lfo1.depth', 1, 1],
    ['m4', 'fx.delay.mix', 0.4],
  ], ['Crush', 'Width', 'PWM', 'Echo']);

  p('Sync Scream', 'Lead', 'hard sync, aggressive, rock synth', Object.assign({}, LEGATO, {
    'voice.glide': 0.05,
    'osc1.wave': 'sync', 'osc1.shape': 0.3, 'osc1.level': 0.85, 'osc1.uni': 2, 'osc1.detune': 10,
    'flt1.model': 'ladder4', 'flt1.cutoff': 4800, 'flt1.res': 0.2, 'flt1.drive': 0.5,
    'env3.a': 0.0, 'env3.d': 0.45, 'env3.s': 0.2,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.3, 'fx.drive.tone': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.12,
    'fx.ott.depth': 0.45,
  }), [
    ['env3', 'osc1.shape', 0.5], ['m1', 'osc1.shape', 0.6], ['m2', 'fx.drive.amount', 0.55],
    ['m3', 'flt1.cutoff', 0.35], ['m4', 'fx.reverb.mix', 0.45],
  ], ['Sync', 'Drive', 'Bright', 'Space']);

  p('Vox Chop', 'Lead', 'vocal, formant, chop, future bass', Object.assign({}, LEGATO, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 12, 'osc1.level': 0.85,
    'flt1.model': 'formant', 'flt1.cutoff': 1400, 'flt1.res': 0.5,
    'mot1.on': 1, 'mot1.sync': 1, 'mot1.div': '1_8', 'mot1.slew': 0.2,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.25,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.05,
    'fx.ott.depth': 0.55,
  }), [
    ['mot1', 'osc1.shape', 0.35], ['mot1', 'flt1.cutoff', 0.3],
    ['m1', 'flt1.cutoff', 0.5], ['m1', 'osc1.shape', 0.3], ['m2', 'fx.drive.amount', 0.6], ['m3', 'fx.chorus.mix', 0.5], ['m4', 'fx.reverb.mix', 0.4],
  ], ['Vowel', 'Grit', 'Choir', 'Space'], [lane(i => [-0.8, 0.6, -0.2, 0.9, -0.5, 0.3, 0.8, -0.9][i % 8])]);

  p('Glide Fifths', 'Lead', 'fifths, glide, synthwave, lead', Object.assign({}, LEGATO, {
    'voice.glide': 0.12,
    'osc1.wave': 'classic', 'osc1.shape': 0.66, 'osc1.uni': 2, 'osc1.detune': 14, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.66, 'osc2.semi': 7, 'osc2.level': 0.45,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2600, 'flt1.res': 0.3, 'flt1.drive': 0.4, 'flt1.env': 0.25,
    'env2.d': 0.6, 'env2.s': 0.3,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.35,
    'fx.delay.on': 1, 'fx.delay.div': '1_4d', 'fx.delay.mix': 0.15,
    'fx.ott.depth': 0.35,
  }), [
    ['m1', 'flt1.cutoff', 0.45], ['m2', 'osc2.level', -0.45], ['m3', 'fx.drive.amount', 0.5], ['m4', 'fx.delay.mix', 0.35],
  ], ['Open', 'Unison', 'Drive', 'Echo']);

  /* ════════════════════════════════ PLUCK ═══════════════════════════════ */

  p('Future Pluck', 'Pluck', 'future bass, pluck, supersaw, wide', {
    'voice.poly': 8,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.55, 'osc1.uni': 4, 'osc1.detune': 26, 'osc1.width': 1, 'osc1.level': 0.8,
    'flt1.model': 'ladder4', 'flt1.cutoff': 600, 'flt1.res': 0.2, 'flt1.env': 0.6,
    'env2.a': 0.001, 'env2.d': 0.22, 'env2.s': 0,
    'env1.a': 0.001, 'env1.d': 0.45, 'env1.s': 0.0, 'env1.r': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.16, 'fx.delay.pong': 0.8,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.22, 'fx.reverb.decay': 2.2,
    'fx.ott.depth': 0.55,
  }, [
    ['m1', 'flt1.cutoff', 0.4], ['m2', 'env2.d', 1], ['m3', 'fx.reverb.mix', 0.4], ['m4', 'osc1.detune', 0.5],
  ], ['Bright', 'Length', 'Space', 'Detune']);

  p('Glass Pluck', 'Pluck', 'fm, glass, bell, clean', {
    'voice.poly': 8,
    'osc1.wave': 'glass', 'osc1.shape': 0.4, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.oct': 1, 'osc2.level': 0.35,
    'mix.fm': 0.22,
    'flt1.model': 'svfLP', 'flt1.cutoff': 6500,
    'env1.a': 0.001, 'env1.d': 0.7, 'env1.s': 0.0, 'env1.r': 0.5,
    'env3.d': 0.25, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28, 'fx.reverb.decay': 3.2,
    'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.12,
    'fx.ott.depth': 0.3,
  }, [
    ['env3', 'mix.fm', 0.35], ['m1', 'mix.fm', 0.5], ['m1', 'mix.ring', 0.45], ['m2', 'flt1.cutoff', -0.45], ['m3', 'fx.reverb.mix', 0.45],
    ['m4', 'osc2.level', 0.5],
  ], ['Metal', 'Soft', 'Space', 'Bell']);

  p('Lo-fi Pluck', 'Pluck', 'lofi, dusty, tape, crush', {
    'voice.poly': 8, 'voice.drift': 0.35,
    'osc1.wave': 'classic', 'osc1.shape': 0.33, 'osc1.level': 0.85,
    'mix.noise': 0.06, 'mix.noiseType': 'crackle',
    'flt1.model': 'ladder2', 'flt1.cutoff': 1800, 'flt1.res': 0.15, 'flt1.env': 0.3,
    'env2.d': 0.25, 'env2.s': 0,
    'env1.a': 0.002, 'env1.d': 0.6, 'env1.s': 0, 'env1.r': 0.3,
    'lfo1.shape': 'smooth', 'lfo1.rate': 0.7, 'lfo1.mode': 'free',
    'fx.crush.on': 1, 'fx.crush.bits': 8, 'fx.crush.rate': 0.3, 'fx.crush.mix': 0.2,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.3, 'fx.chorus.rate': 0.35,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.35,
    'fx.eq.high': -6, 'fx.eq.low': -3,
    'fx.ott.depth': 0.25,
  }, [
    ['lfo1', 'pitch', 0.006], ['m1', 'lfo1.depth', 0.6], ['m2', 'fx.crush.mix', 0.8], ['m3', 'flt1.cutoff', -0.35],
    ['m4', 'mix.noise', 0.25],
  ], ['Wobble', 'Crush', 'Dust', 'Vinyl']);

  /* ════════════════════════════════ KEYS ════════════════════════════════ */

  p('Dusty Keys', 'Keys', 'electric piano, lofi, warm, tape', {
    'voice.poly': 8, 'voice.drift': 0.3,
    'osc1.wave': 'bell', 'osc1.shape': 0.2, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.0, 'osc2.level': 0.6,
    'mix.fm': 0.08,
    'flt1.model': 'ladder2', 'flt1.cutoff': 3200, 'flt1.vel': 0.4,
    'env1.a': 0.002, 'env1.d': 1.8, 'env1.s': 0.15, 'env1.r': 0.35,
    'lfo1.shape': 'sine', 'lfo1.rate': 4.5, 'lfo1.mode': 'free',
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.3,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.25,
    'mix.noise': 0.03, 'mix.noiseType': 'crackle',
    'fx.eq.high': -4,
    'fx.ott.depth': 0.3,
  }, [
    ['lfo1', 'amp', -0.25], ['m1', 'lfo1.depth', -1], ['m2', 'mix.fm', 0.35], ['m3', 'fx.drive.amount', 0.5],
    ['m4', 'mix.noise', 0.2],
  ], ['Still', 'Bark', 'Tape', 'Dust']);

  p('Neo Rhodes', 'Keys', 'rhodes, neo soul, tremolo, smooth', {
    'voice.poly': 8,
    'osc1.wave': 'harmonic', 'osc1.shape': 0.25, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.oct': 1, 'osc2.level': 0.18,
    'flt1.model': 'ladder2', 'flt1.cutoff': 2400, 'flt1.vel': 0.5,
    'env1.a': 0.002, 'env1.d': 2.2, 'env1.s': 0.25, 'env1.r': 0.4,
    'lfo1.shape': 'sine', 'lfo1.sync': 1, 'lfo1.div': '1_8', 'lfo1.mode': 'free',
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.2,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.25,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.15,
    'fx.ott.depth': 0.25,
  }, [
    ['m1', 'flt1.cutoff', 0.5], ['m1', 'osc1.shape', 0.4], ['m2', 'osc2.level', 0.5], ['lfo1', 'amp', -0.35], ['m3', 'lfo1.depth', -1],
    ['m4', 'fx.drive.amount', 0.5],
  ], ['Bright', 'Tine', 'No Trem', 'Bark']);

  p('Organ Grit', 'Keys', 'organ, drive, gospel, house', {
    'voice.poly': 8,
    'osc1.wave': 'harmonic', 'osc1.shape': 0.7, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'harmonic', 'osc2.shape': 0.4, 'osc2.oct': 1, 'osc2.level': 0.3,
    'flt1.model': 'bypass',
    'env1.a': 0.004, 'env1.d': 0.1, 'env1.s': 1, 'env1.r': 0.06,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.45,
    'fx.chorus.on': 1, 'fx.chorus.rate': 5.5, 'fx.chorus.depth': 0.3, 'fx.chorus.mix': 0.35,
    'fx.ott.depth': 0.3,
  }, [
    ['m1', 'osc1.shape', 0.3], ['m2', 'fx.drive.amount', 0.5], ['m3', 'fx.chorus.mix', 0.5], ['m4', 'osc2.level', 0.5],
  ], ['Drawbar', 'Drive', 'Leslie', 'Top']);

  p('Stab Keys', 'Keys', 'house, stab, chord, piano-ish', {
    'voice.poly': 8,
    'osc1.wave': 'classic', 'osc1.shape': 0.66, 'osc1.uni': 2, 'osc1.detune': 10, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'harmonic', 'osc2.shape': 0.5, 'osc2.level': 0.45,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.25, 'flt1.env': 0.5,
    'env2.d': 0.28, 'env2.s': 0.1,
    'env1.a': 0.002, 'env1.d': 0.5, 'env1.s': 0.2, 'env1.r': 0.25,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2, 'fx.reverb.decay': 1.8,
    'fx.ott.depth': 0.5,
  }, [
    ['m1', 'flt1.cutoff', 0.45], ['m2', 'env2.d', 1], ['m3', 'fx.reverb.mix', 0.4], ['m4', 'osc1.detune', 0.5],
  ], ['Open', 'Length', 'Space', 'Detune']);

  /* ════════════════════════════════ PAD ═════════════════════════════════ */

  p('Halo Pad', 'Pad', 'ambient, wide, shimmer, evolving', {
    'voice.poly': 8,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.5, 'osc1.uni': 4, 'osc1.detune': 22, 'osc1.width': 1, 'osc1.level': 0.6,
    'osc2.on': 1, 'osc2.wave': 'glass', 'osc2.oct': 1, 'osc2.level': 0.35,
    'flt1.model': 'ladder2', 'flt1.cutoff': 2800, 'flt1.res': 0.1,
    'env1.a': 0.9, 'env1.d': 2, 'env1.s': 0.85, 'env1.r': 2.5,
    'lfo2.shape': 'smooth', 'lfo2.rate': 0.12, 'lfo2.mode': 'free',
    'fx.phaser.on': 1, 'fx.phaser.rate': 0.12, 'fx.phaser.mix': 0.3,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.42, 'fx.reverb.decay': 6, 'fx.reverb.size': 0.85,
    'fx.ott.depth': 0.35,
  }, [
    ['lfo2', 'flt1.cutoff', 0.2], ['lfo2', 'osc2.level', 0.25],
    ['m1', 'flt1.cutoff', 0.4], ['m2', 'osc2.level', 0.5], ['m3', 'fx.reverb.mix', 0.4], ['m4', 'lfo2.depth', -1],
  ], ['Bright', 'Shimmer', 'Wash', 'Still']);

  p('Dark Motion Pad', 'Pad', 'dark, cinematic, motion, filter', {
    'voice.poly': 8,
    'osc1.wave': 'vintage', 'osc1.shape': 0.6, 'osc1.uni': 3, 'osc1.detune': 18, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.9, 'osc2.oct': -1, 'osc2.level': 0.35,
    'flt1.model': 'ladder4', 'flt1.cutoff': 700, 'flt1.res': 0.35, 'flt1.drive': 0.45,
    'env1.a': 0.6, 'env1.d': 2, 'env1.s': 0.9, 'env1.r': 2,
    'mot1.on': 1, 'mot1.sync': 1, 'mot1.div': '1_8', 'mot1.slew': 0.6, 'mot1.mode': 'random',
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_4d', 'fx.delay.mix': 0.2, 'fx.delay.fb': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.decay': 4,
    'fx.ott.depth': 0.45,
  }, [
    ['mot1', 'flt1.cutoff', 0.35], ['m1', 'flt1.cutoff', 0.45], ['m2', 'flt1.res', 0.35],
    ['m3', 'fx.drive.amount', 0.5], ['m4', 'fx.delay.mix', 0.4],
  ], ['Open', 'Resonate', 'Grit', 'Echo'], [lane(i => Math.sin(i * 1.7) * 0.9)]);

  p('Granular Air', 'Pad', 'air, texture, vocal, breathy', {
    'voice.poly': 8,
    'osc1.wave': 'vocal', 'osc1.shape': 0.5, 'osc1.uni': 3, 'osc1.detune': 16, 'osc1.level': 0.6,
    'mix.noise': 0.3, 'mix.noiseType': 'pink', 'mix.noiseFlt': 0.6,
    'flt1.model': 'formant', 'flt1.cutoff': 1100, 'flt1.res': 0.4,
    'env1.a': 1.2, 'env1.d': 2, 'env1.s': 0.8, 'env1.r': 3,
    'lfo1.shape': 'smooth', 'lfo1.rate': 0.25, 'lfo1.mode': 'free',
    'lfo3.shape': 'sh', 'lfo3.sync': 1, 'lfo3.div': '1_16', 'lfo3.depth': 0,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28, 'fx.reverb.decay': 7, 'fx.reverb.size': 0.9,
    'fx.ott.depth': 0.5,
  }, [
    ['lfo1', 'osc1.shape', 0.35], ['lfo3', 'flt1.cutoff', 0.6], ['m1', 'osc1.shape', 0.7], ['m1', 'flt1.cutoff', 0.35], ['m2', 'mix.noise', 0.6],
    ['m3', 'lfo3.depth', 1, 1], ['m4', 'fx.reverb.mix', 0.45],
  ], ['Vowel', 'Breath', 'Shimmer', 'Space']);

  p('Wide Strings', 'Pad', 'strings, ensemble, cinematic, wide', {
    'voice.poly': 8,
    'osc1.wave': 'string', 'osc1.shape': 0.5, 'osc1.uni': 4, 'osc1.detune': 18, 'osc1.width': 1, 'osc1.level': 0.75,
    'flt1.model': 'ladder2', 'flt1.cutoff': 3000, 'flt1.vel': 0.3,
    'env1.a': 0.35, 'env1.d': 1, 'env1.s': 0.9, 'env1.r': 1.2,
    'fx.chorus.on': 1, 'fx.chorus.voices': 3, 'fx.chorus.mix': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.decay': 3.5,
    'fx.ott.depth': 0.3,
  }, [
    ['m1', 'flt1.cutoff', 0.4], ['m2', 'osc1.detune', 0.5], ['m3', 'fx.reverb.mix', 0.4], ['m4', 'env1.r', 0.5],
  ], ['Bright', 'Ensemble', 'Hall', 'Release']);

  /* ═══════════════════════════════ CHORD ════════════════════════════════ */

  p('Pump Chord', 'Chord', 'future bass, pump, sidechain, supersaw', {
    'voice.poly': 8,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.6, 'osc1.uni': 4, 'osc1.detune': 32, 'osc1.width': 1, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.66, 'osc2.oct': 1, 'osc2.level': 0.25,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3800, 'flt1.res': 0.15,
    'env1.a': 0.01, 'env1.d': 1, 'env1.s': 0.9, 'env1.r': 0.4,
    'lfo1.shape': 'saw', 'lfo1.sync': 1, 'lfo1.div': '1_4', 'lfo1.mode': 'mono', 'lfo1.depth': 1,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
    // OTT comes after the voice, so a fast one fills the pump's dips straight
    // back in (measured: the pump's level swing halved). Slow and lighter here.
    'fx.ott.depth': 0.3, 'fx.ott.time': 0.85, 'fx.ott.upward': 0.3,
  }, [
    ['lfo1', 'amp', -0.95, 1], ['m1', 'lfo1.depth', -1], ['m2', 'flt1.cutoff', 0.4], ['m3', 'osc1.detune', 0.5],
    ['m4', 'fx.reverb.mix', 0.45],
  ], ['No Pump', 'Bright', 'Detune', 'Space']);

  p('Detroit Chord', 'Chord', 'dub techno, chord, delay, deep', {
    'voice.poly': 8,
    'osc1.wave': 'pulse', 'osc1.pw': 0.4, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.66, 'osc2.level': 0.45,
    'flt1.model': 'ladder4', 'flt1.cutoff': 700, 'flt1.res': 0.35, 'flt1.env': 0.35,
    'env2.d': 0.3, 'env2.s': 0,
    'env1.a': 0.003, 'env1.d': 0.5, 'env1.s': 0.1, 'env1.r': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.32, 'fx.delay.fb': 0.55, 'fx.delay.tone': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.25, 'fx.reverb.decay': 3,
    'fx.ott.depth': 0.3,
  }, [
    ['m1', 'flt1.cutoff', 0.45], ['m2', 'fx.delay.mix', 0.35], ['m3', 'flt1.res', 0.35], ['m4', 'env2.d', 1],
  ], ['Open', 'Dub', 'Resonance', 'Length']);

  p('Gritty Stab', 'Chord', 'stab, distorted, hard, techno', {
    'voice.poly': 8,
    'osc1.wave': 'digital', 'osc1.shape': 0.5, 'osc1.uni': 2, 'osc1.detune': 16, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'fold', 'osc2.shape': 0.4, 'osc2.level': 0.4,
    'mix.ring': 0.15,
    'flt1.model': 'diode', 'flt1.cutoff': 1200, 'flt1.res': 0.35, 'flt1.env': 0.4, 'flt1.drive': 0.6,
    'env2.d': 0.2, 'env2.s': 0,
    'env1.a': 0.001, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.2,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.15,
    'fx.ott.depth': 0.55,
  }, [
    ['m1', 'flt1.cutoff', 0.4], ['m2', 'mix.ring', 0.5], ['m3', 'fx.drive.amount', 0.5], ['m4', 'env2.d', 1],
  ], ['Open', 'Metal', 'Distort', 'Length']);

  /* ═══════════════════ NEW SOURCES (Batch 1: PD, feedback, pluck) ═══════ */

  p('CZ Bass', 'Bass', 'phase distortion, cz, punchy, 80s-modern', Object.assign({}, MONO, {
    'osc1.wave': 'czres', 'osc1.shape': 0.35, 'osc1.level': 0.9,
    'osc2.on': 1, 'osc2.wave': 'czsaw', 'osc2.shape': 0.5, 'osc2.oct': -1, 'osc2.level': 0.5,
    'flt1.model': 'ladder2', 'flt1.cutoff': 2400, 'flt1.res': 0.1,
    'env3.a': 0, 'env3.d': 0.25, 'env3.s': 0.15,
    'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0.6, 'env1.r': 0.08,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.3,
    'fx.ott.depth': 0.45,
  }), [
    ['env3', 'osc1.shape', 0.5], ['m1', 'osc1.shape', 0.55], ['m2', 'osc2.shape', 0.5],
    ['m3', 'fx.drive.amount', 0.5], ['m4', 'mix.sub', 0.6],
  ], ['Reso', 'Edge', 'Drive', 'Sub']);

  p('Feedback Grit', 'Bass', 'fm, feedback, gritty, aggressive', Object.assign({}, MONO, {
    'osc1.wave': 'classic', 'osc1.shape': 0.0, 'osc1.fb': 0.35, 'osc1.level': 0.85,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.0, 'osc2.semi': 12, 'osc2.level': 0, 'osc2.fb': 0.2,
    'osc2.ratio': 1, 'mix.fm': 0.25, 'mix.sub': 0.5,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3000, 'flt1.res': 0.15, 'flt1.drive': 0.4,
    'env3.d': 0.3, 'env3.s': 0.2,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.25,
    'fx.ott.depth': 0.5,
  }), [
    ['env3', 'mix.fm', 0.35], ['m1', 'mix.fm', 0.5], ['m2', 'flt1.cutoff', -0.4], ['m3', 'fx.drive.amount', 0.5],
    ['m4', 'mix.sub', -0.5],
  ], ['FM', 'Dark', 'Drive', 'Less Sub']);

  p('Steel String', 'Pluck', 'karplus, string, guitar, pluck', {
    'voice.poly': 8,
    'osc1.on': 0, 'mix.pluck': 0.9, 'pluck.decay': 0.6, 'pluck.tone': 0.75,
    'flt1.model': 'svfLP', 'flt1.cutoff': 9000,
    'env1.a': 0.001, 'env1.d': 3, 'env1.s': 1, 'env1.r': 0.5,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.18,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2, 'fx.reverb.decay': 2,
    'fx.ott.depth': 0.25,
  }, [
    ['m1', 'flt1.cutoff', -0.45], ['m2', 'fx.chorus.mix', 0.5], ['m3', 'fx.reverb.mix', 0.4], ['m4', 'osc1.level', 0.4],
  ], ['Mute', 'Chorus', 'Space', 'Body']);

  p('Kalimba Pluck', 'Pluck', 'karplus, kalimba, mallet, lofi', {
    'voice.poly': 8, 'voice.drift': 0.2,
    'osc1.wave': 'classic', 'osc1.shape': 0.0, 'osc1.level': 0.35,
    'mix.pluck': 0.8, 'pluck.decay': 0.35, 'pluck.tone': 0.35, 'pluck.oct': 1,
    'flt1.model': 'ladder2', 'flt1.cutoff': 3500,
    'env1.a': 0.001, 'env1.d': 0.9, 'env1.s': 0, 'env1.r': 0.6,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.15,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
    'fx.crush.on': 1, 'fx.crush.bits': 9, 'fx.crush.rate': 0.5, 'fx.crush.mix': 0,
    'fx.ott.depth': 0.3,
  }, [
    ['m1', 'osc1.level', 0.5], ['m2', 'fx.delay.mix', 0.35], ['m3', 'fx.crush.mix', 0.7, 1], ['m4', 'flt1.cutoff', 0.4],
  ], ['Tine', 'Echo', 'Lo-fi', 'Bright']);

  p('Chip Lead', 'Lead', 'chiptune, console, 8-bit, square', Object.assign({}, LEGATO, {
    'voice.glide': 0.03,
    'osc1.wave': 'chip', 'osc1.shape': 0.66, 'osc1.level': 0.8,
    'osc2.on': 1, 'osc2.wave': 'chip', 'osc2.shape': 0.0, 'osc2.oct': -1, 'osc2.level': 0.3,
    'flt1.model': 'bypass',
    'lfo1.shape': 'square', 'lfo1.sync': 1, 'lfo1.div': '1_32', 'lfo1.depth': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.15, 'fx.delay.pong': 1,
    'fx.ott.depth': 0.3,
  }), [
    ['lfo1', 'pitch', 0.25, 1], ['m1', 'lfo1.depth', 1, 1], ['m2', 'osc1.shape', 0.34], ['m3', 'fx.delay.mix', 0.35],
    ['m4', 'osc2.level', 0.5],
  ], ['Arp Trill', 'Duty', 'Echo', 'Bass']);

  p('Metal Bell', 'Keys', 'metal, bell, fm, glassy', {
    'voice.poly': 8,
    'osc1.wave': 'metal', 'osc1.shape': 0.3, 'osc1.level': 0.65,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0, 'osc2.oct': 1, 'osc2.level': 0.3, 'osc2.fb': 0.15,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000,
    'env1.a': 0.001, 'env1.d': 2.4, 'env1.s': 0, 'env1.r': 1.2,
    'env3.d': 0.6, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.decay': 3.5,
    'fx.ott.depth': 0.25,
  }, [
    ['env3', 'osc1.shape', 0.45], ['m1', 'osc1.shape', 0.6], ['m2', 'osc2.level', 0.5], ['m3', 'fx.reverb.mix', 0.45],
    ['m4', 'flt1.cutoff', -0.45],
  ], ['Clang', 'Sine', 'Space', 'Soft']);

  /* ════════════════════════════════ FX-ish ══════════════════════════════ */

  p('Riser Noise', 'Texture', 'riser, noise, sweep, transition', {
    'voice.poly': 4,
    'osc1.wave': 'noise', 'osc1.level': 0.7,
    'mix.noise': 0.4, 'mix.noiseType': 'white',
    'flt1.model': 'svfBP', 'flt1.cutoff': 400, 'flt1.res': 0.55,
    'env1.a': 0.02, 'env1.d': 2, 'env1.s': 1, 'env1.r': 1.5,
    'env3.a': 4, 'env3.d': 1, 'env3.s': 1,
    'fx.phaser.on': 1, 'fx.phaser.mix': 0.4, 'fx.phaser.rate': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'fx.reverb.decay': 5,
    'fx.ott.depth': 0.5,
  }, [
    ['env3', 'flt1.cutoff', 0.6], ['m1', 'flt1.cutoff', 0.4], ['m2', 'flt1.res', 0.35], ['m3', 'fx.phaser.rate', 0.5],
    ['m4', 'fx.reverb.mix', 0.45],
  ], ['Sweep', 'Whistle', 'Swirl', 'Space']);

  p('Metal Perc', 'Texture', 'fm, metallic, percussive, ring', {
    'voice.poly': 8,
    'osc1.wave': 'bell', 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0.0, 'osc2.semi': 7, 'osc2.fine': 35, 'osc2.level': 0.4,
    'mix.ring': 0.45, 'mix.fm': 0.3,
    'flt1.model': 'svfHP', 'flt1.cutoff': 300,
    'env1.a': 0.001, 'env1.d': 0.22, 'env1.s': 0, 'env1.r': 0.15,
    'fx.drive.on': 1, 'fx.drive.type': 'diode', 'fx.drive.amount': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.15, 'fx.delay.pong': 1,
    'fx.ott.depth': 0.5,
  }, [
    ['m1', 'mix.ring', 0.5], ['m2', 'mix.fm', 0.6], ['m3', 'fx.drive.amount', 0.5], ['m4', 'fx.delay.mix', 0.4],
  ], ['Ring', 'FM', 'Crunch', 'Echo']);

  // Output level per patch, measured (loudest 50 ms of a held chord, or a
  // note for bass and leads) and set so every patch peaks near -20 dBFS at the
  // rack's output. Without it the bank spanned 12 dB, from Acid Squelch to
  // Organ Grit. Re-measure after changing a patch: tests/modsynth can't hear.
  const CAL = {
    'Reese Grit': 0.67,
    'Wobble 1/8': 1.2,
    '808 Distorted': 0.42,
    'Neuro Growl': 0.39,
    'Acid Squelch': 1.4,
    'Fold Bass': 0.77,
    'Pluck Sub': 1.0,
    'Hyper Lead': 0.75,
    'Crush Lead': 0.9,
    'Sync Scream': 0.49,
    'Vox Chop': 0.95,
    'Glide Fifths': 0.93,
    'Future Pluck': 1.05,
    'Glass Pluck': 0.87,
    'Lo-fi Pluck': 0.46,
    'Dusty Keys': 0.42,
    'Neo Rhodes': 0.37,
    'Organ Grit': 0.36,
    'Stab Keys': 0.91,
    'Halo Pad': 0.57,
    'Dark Motion Pad': 0.63,
    'Granular Air': 0.68,
    'Wide Strings': 1.07,
    'Pump Chord': 0.72,
    'Detroit Chord': 0.76,
    'Gritty Stab': 0.43,
    'Riser Noise': 1.18,
    'Metal Perc': 0.85,
    'CZ Bass': 1.0,
    'Feedback Grit': 0.46,
    'Steel String': 0.53,
    'Kalimba Pluck': 0.84,
    'Chip Lead': 1.1,
    'Metal Bell': 0.63
  };
  BANK.forEach(p => { if (CAL[p.name] != null) p.values['master.vol'] = CAL[p.name]; });

  MS.MODERN_PATCHES = BANK;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
