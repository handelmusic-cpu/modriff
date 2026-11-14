/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — the Macro Osc patches (native engine only)
   ───────────────────────────────────────────────────────────────────────────
   One patch per synthesis model, each a sound that sits in a melody or bass part
   as it is. The source is the C++ macro oscillator (native/macroosc), which the
   web worklet does not have, so this file is only loaded where the native engine
   is (index.html, MSX_FILES) and sets MS.macroOscAvailable, which is what shows
   the Macro Osc row in the synth editor. The free web page never loads it.

   Not in the null test (tests/modsynth/null.test.js): that compares the JS and C++
   engines on the patches both can play. tests/modsynth/macro.test.js checks these.

   Harmonics, Timbre and Morph mean different things per model (Filtered Analog:
   detune, filter, shape; FM Pair: ratio, depth, feedback; Plucked String: inharmonicity,
   brightness, decay). The first line of each patch says which it leans on.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const BANK = (MS.MODERN_PATCHES = MS.MODERN_PATCHES || []);

  const BASE = {
    'osc1.on': 0, 'mix.mosc': 1,
    'flt1.model': 'ladder4', 'flt1.cutoff': 14000, 'flt1.res': 0.08, 'flt1.drive': 0.1,
    'voice.drift': 0.1, 'master.limit': 1,
  };
  const MONO = { 'voice.mode': 'mono', 'voice.poly': 1 };
  const LEGATO = { 'voice.mode': 'legato', 'voice.poly': 1, 'voice.glideAuto': 1 };

  function p(name, tags, values, matrix, macros) {
    BANK.push({
      name, category: 'Macro Osc', bank: 'modern',
      tags: String(tags).split(/\s*,\s*/).filter(Boolean),
      author: 'mõdRïff',
      values: Object.assign({}, BASE, values),
      matrix: matrix || [],
      macros: macros || null,
      motion: null,
    });
  }

  p('Filtered Lead', 'lead, analog, mono', Object.assign({}, LEGATO, {
    'voice.glide': 0.05,
    'mosc.model': 'filtered', 'mosc.harmonics': 0.35, 'mosc.timbre': 0.55, 'mosc.morph': 0.3, 'mosc.env': 0.25,
    'env1.a': 0.01, 'env1.d': 0.4, 'env1.s': 0.75, 'env1.r': 0.25,
    'env2.a': 0.005, 'env2.d': 0.5, 'env2.s': 0.3, 'env2.r': 0.3,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.18,
  }), [['m1', 'mosc.timbre', 0.4], ['m4', 'fx.reverb.mix', 0.5]], ['Open', 'Dirty', 'Widen', 'Space']);

  p('Bend Bass', 'bass, phase, mono', Object.assign({}, MONO, {
    'mosc.model': 'bend', 'mosc.harmonics': 0.3, 'mosc.timbre': 0.35, 'mosc.morph': 0.25, 'mosc.env': 0.45,
    'flt1.cutoff': 3200,
    'env1.a': 0.003, 'env1.d': 0.5, 'env1.s': 0.8, 'env1.r': 0.12,
    'env2.a': 0.003, 'env2.d': 0.25, 'env2.s': 0.1, 'env2.r': 0.15,
  }), [['m1', 'flt1.cutoff', 0.4], ['m2', 'flt1.drive', 0.5]], ['Open', 'Grit', 'Width', 'Space']);

  p('Shaper Bass', 'bass, shaper, mono, grit', Object.assign({}, MONO, {
    'mosc.model': 'shaper', 'mosc.harmonics': 0.25, 'mosc.timbre': 0.45, 'mosc.morph': 0.4, 'mosc.env': 0.4,
    'flt1.cutoff': 2600, 'flt1.drive': 0.35,
    'env1.a': 0.002, 'env1.d': 0.45, 'env1.s': 0.7, 'env1.r': 0.1,
    'env2.a': 0.002, 'env2.d': 0.2, 'env2.s': 0.05, 'env2.r': 0.12,
  }), [['m1', 'flt1.cutoff', 0.4], ['m2', 'mosc.morph', 0.45]], ['Open', 'Fold', 'Width', 'Space']);

  p('Ensemble Pad', 'pad, strings, wide', {
    'mosc.model': 'ensemble', 'mosc.harmonics': 0.5, 'mosc.timbre': 0.5, 'mosc.morph': 0.5,
    'env1.a': 0.6, 'env1.d': 1.2, 'env1.s': 0.85, 'env1.r': 1.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.size': 0.7,
  }, [['m1', 'flt1.cutoff', 0.5], ['m3', 'mosc.timbre', 0.4]], ['Open', 'Colour', 'Tone', 'Space']);

  p('Chip Arp', 'arp, chip, pluck', {
    'mosc.model': 'chip', 'mosc.harmonics': 0.3, 'mosc.timbre': 0.5, 'mosc.morph': 0.5,
    'env1.a': 0.002, 'env1.d': 0.28, 'env1.s': 0, 'env1.r': 0.08,
  }, [['m1', 'flt1.cutoff', 0.4]], ['Open', 'Dirty', 'Width', 'Space']);

  p('Analog Stab', 'stab, analog, chord', {
    'mosc.model': 'analog', 'mosc.harmonics': 0.4, 'mosc.timbre': 0.4, 'mosc.morph': 0.6, 'mosc.env': 0.35,
    'flt1.cutoff': 5200,
    'env1.a': 0.004, 'env1.d': 0.45, 'env1.s': 0.2, 'env1.r': 0.3,
    'env2.a': 0.003, 'env2.d': 0.3, 'env2.s': 0, 'env2.r': 0.25,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.25,
  }, [['m1', 'flt1.cutoff', 0.45]], ['Open', 'Dirty', 'Width', 'Space']);

  p('FM Pair Keys', 'keys, fm, bell', {
    'mosc.model': 'fm', 'mosc.harmonics': 0.35, 'mosc.timbre': 0.4, 'mosc.morph': 0.2, 'mosc.env': 0.4,
    'env1.a': 0.003, 'env1.d': 1.2, 'env1.s': 0.1, 'env1.r': 0.6,
    'env2.a': 0.003, 'env2.d': 0.5, 'env2.s': 0, 'env2.r': 0.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  }, [['m1', 'flt1.cutoff', 0.4], ['m3', 'mosc.timbre', 0.4]], ['Open', 'Dirty', 'Bright', 'Space']);

  p('Grain Pad', 'pad, grain, texture', {
    'mosc.model': 'grain', 'mosc.harmonics': 0.45, 'mosc.timbre': 0.5, 'mosc.morph': 0.45,
    'env1.a': 0.4, 'env1.d': 1, 'env1.s': 0.8, 'env1.r': 1.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['m1', 'flt1.cutoff', 0.5], ['m3', 'mosc.morph', 0.4]], ['Open', 'Dirty', 'Colour', 'Space']);

  p('Additive Organ', 'organ, additive, keys', {
    'mosc.model': 'additive', 'mosc.harmonics': 0.6, 'mosc.timbre': 0.55, 'mosc.morph': 0.4,
    'env1.a': 0.01, 'env1.d': 0.2, 'env1.s': 0.9, 'env1.r': 0.15,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.2,
  }, [['m1', 'flt1.cutoff', 0.4], ['m3', 'mosc.timbre', 0.4]], ['Open', 'Dirty', 'Bright', 'Space']);

  p('Swarm Pad', 'pad, swarm, wide, shimmer', {
    'mosc.model': 'swarm', 'mosc.harmonics': 0.4, 'mosc.timbre': 0.35, 'mosc.morph': 0.5,
    'env1.a': 0.5, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 1.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32, 'fx.reverb.size': 0.75,
  }, [['m1', 'flt1.cutoff', 0.5], ['m3', 'mosc.timbre', 0.5]], ['Open', 'Dirty', 'Spread', 'Space']);

  p('Plucked String', 'pluck, string, acoustic', {
    'mosc.model': 'string', 'mosc.harmonics': 0.3, 'mosc.timbre': 0.55, 'mosc.morph': 0.6,
    'env1.a': 0.001, 'env1.d': 2, 'env1.s': 0.9, 'env1.r': 1.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  }, [['m1', 'flt1.cutoff', 0.4], ['m3', 'mosc.timbre', 0.4]], ['Open', 'Dirty', 'Bright', 'Space']);

  p('Modal Bar', 'bar, mallet, bell', {
    'mosc.model': 'modal', 'mosc.harmonics': 0.35, 'mosc.timbre': 0.5, 'mosc.morph': 0.55,
    'env1.a': 0.001, 'env1.d': 2.2, 'env1.s': 0.9, 'env1.r': 1.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  }, [['m1', 'flt1.cutoff', 0.4], ['m3', 'mosc.timbre', 0.4]], ['Open', 'Dirty', 'Bright', 'Space']);

  // One gain per patch, applied by the app after the engine (patches-levels.js explains why it is not master.vol).
  // Measured by tests/modsynth/macro.test.js against the app's default chord patch (Stab Keys), through the C++ engine.
  const TRIM = {
    'Filtered Lead': 1.13, 'Bend Bass': 0.63, 'Shaper Bass': 0.55, 'Ensemble Pad': 0.93, 'Chip Arp': 1.19, 'Analog Stab': 0.85,
    'FM Pair Keys': 0.55, 'Grain Pad': 0.53, 'Additive Organ': 0.51, 'Swarm Pad': 1.13, 'Plucked String': 0.56, 'Modal Bar': 0.59,
  };
  MS.PATCH_TRIM = MS.PATCH_TRIM || {};
  Object.keys(TRIM).forEach(k => { MS.PATCH_TRIM[k] = TRIM[k]; });

  MS.macroOscAvailable = true;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
