/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — factory patch banks
   ───────────────────────────────────────────────────────────────────────────
   Patches are sparse: each lists only what differs from the schema defaults
   (js/params.js). Families share a base object and derive variants from it,
   which is both how real preset libraries are built and the only way a few
   hundred sounds stay readable.

   Every patch gets four working macros. If a patch doesn't wire its own,
   `autoMacros` fills them in from what the patch actually uses — a formant
   filter gets a vowel sweep on Macro 3, an FM patch gets index, a unison
   stack gets detune. That is what makes one knob a big move rather than a
   nudge, which is the whole point of a macro.

   Quick reference for the values that appear most:
     osc*.wave    classic pulse supersaw harmonic formant bell digital vocal
                  reed string glass growl fold noise vintage sync
     osc*.shape   morphs the four frames of the chosen wave.
                  For `classic`: 0 sine · ⅓ triangle · ⅔ saw · 1 square
     flt*.model   ladder4 ladder2 svfLP svfHP svfBP svfNotch svfPeak
                  diode comb formant bypass
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const BANK = [];

  const ext = (base, over) => Object.assign({}, base, over);

  /** Declares a patch. `matrix` rows are [source, destination, amount, unipolar]. */
  function p(name, category, tags, values, matrix, macros, motion) {
    BANK.push({
      name, category,
      tags: String(tags).split(/\s*,\s*/).filter(Boolean),
      author: 'MōdSynth',
      values,
      matrix: autoMacros(values, matrix || []),
      macros: macros || null,
      motion: motion || null,
    });
  }

  /* Fills unused matrix slots with macro routings that suit the patch, so
     every sound arrives with four knobs that genuinely change it. */
  function autoMacros(v, matrix) {
    const rows = matrix.slice();
    const usedSrc = new Set(rows.map(r => r[0]));
    const free = () => rows.length < MS.MATRIX_SLOTS;
    const add = (s, d, a, u) => { if (free()) rows.push([s, d, a, u || 0]); };

    // 1 — the filter. Always the first knob a player reaches for, so it has to
    // be a real move: the amount is scaled by how much headroom the patch's
    // cutoff actually has, and a filter that's already wide open closes
    // instead of straining upward against Nyquist and doing nothing.
    if (!usedSrc.has('m1') && free()) {
      const model = v['flt1.model'] || MS.PARAM['flt1.model'].def;
      const cut = v['flt1.cutoff'] === undefined ? MS.PARAM['flt1.cutoff'].def : v['flt1.cutoff'];
      if (model === 'bypass') add('m1', 'osc1.shape', 0.5);
      else if (model === 'svfHP') add('m1', 'flt1.cutoff', -0.55);   // on a high-pass, down is brighter
      else {
        const headroomOctaves = Math.log2(20000 / Math.max(40, cut));
        add('m1', 'flt1.cutoff', headroomOctaves > 1.5 ? Math.min(0.6, headroomOctaves / 8) : -0.55);
      }
    }
    // 2 — movement: whichever modulator the patch already leans on.
    if (!usedSrc.has('m2') && free()) {
      if (v['mot1.on']) add('m2', 'flt1.res', 0.45);
      else if ((v['osc1.uni'] || 1) > 2) add('m2', 'osc1.detune', 0.6);
      else if (v['lfo1.depth'] !== undefined || v['lfo1.rate'] !== undefined) add('m2', 'lfo1.depth', 0.8);
      else add('m2', 'osc1.detune', 0.5);
    }
    // 3 — texture: the timbral control that means the most for this engine.
    if (!usedSrc.has('m3') && free()) {
      if (v['mix.fm']) add('m3', 'mix.fm', 0.55);
      else if (v['flt1.model'] === 'formant') add('m3', 'flt1.cutoff', 0.9);
      else if (v['osc1.wave'] === 'pulse') add('m3', 'osc1.pw', 0.4);
      else if (v['mix.ring']) add('m3', 'mix.ring', 0.6);
      else add('m3', 'osc1.shape', 0.45);
    }
    // 4 — space.
    if (!usedSrc.has('m4') && free()) add('m4', 'fx.reverb.mix', 0.55);
    if (!usedSrc.has('m4') && free()) add('m4', 'fx.delay.mix', 0.35);
    return rows;
  }

  /* Motion shapes reused by the sequenced patches. */
  const MOT = {
    stab:   [1, -1, 0.4, -1, 1, -0.6, 0.2, -1, 0.8, -1, 0.5, -0.8, 1, -1, 0.3, -1],
    rise:   [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75],
    pump:   [1, 0.2, -0.4, -0.9, 1, 0.2, -0.4, -0.9, 1, 0.2, -0.4, -0.9, 1, 0.2, -0.4, -0.9],
    trip:   [1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1],
    gate:   [1, 1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, 1, 1, -1, -1],
    arp:    [0, 0.42, 0.75, 0.42, 1, 0.42, 0.75, 0.42, 0, -0.42, -0.75, -0.42, -1, -0.42, -0.75, -0.42],
    stair:  [-1, -1, -0.33, -0.33, 0.33, 0.33, 1, 1, 0.33, 0.33, -0.33, -0.33, -1, -1, -0.6, -0.6],
    chaos:  [0.8, -0.3, 0.55, -0.95, 0.1, 0.7, -0.65, 0.35, -0.85, 0.95, -0.15, 0.45, -0.5, 0.25, -0.75, 0.6],
  };

  /* ═══════════════════════════════════════════════════════════════════════
     VINTAGE — the machines subtractive synthesis was invented on
     ═══════════════════════════════════════════════════════════════════════ */

  const mini = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.8, 'osc1.uni': 2, 'osc1.detune': 7,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.level': 0.65, 'osc2.fine': -7,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1500, 'flt1.res': 0.3, 'flt1.drive': 0.35, 'flt1.env': 0.5,
    'flt1.keytrack': 0.35,
    'env1.a': 0.004, 'env1.d': 0.6, 'env1.s': 0.75, 'env1.r': 0.25,
    'env2.a': 0.002, 'env2.d': 0.4, 'env2.s': 0.25, 'env2.r': 0.3,
    'voice.drift': 0.28, 'master.vol': 0.85,
  };
  p('Mini Lead', 'Vintage', 'lead,mono,classic,moog', ext(mini, {
    'voice.mode': 'mono', 'voice.glide': 0.045, 'mix.sub': 0.35,
    'flt1.cutoff': 2400, 'flt1.res': 0.42, 'osc2.semi': 7,
  }), [['lfo1', 'pitch', 0.02], ['mw', 'lfo1.depth', 1]]);
  p('Mini Bass', 'Vintage', 'bass,mono,fat,moog', ext(mini, {
    'voice.mode': 'mono', 'voice.glide': 0.03, 'osc2.oct': -1, 'mix.sub': 0.7,
    'flt1.cutoff': 620, 'flt1.res': 0.35, 'flt1.env': 0.62, 'flt1.drive': 0.5,
    'env1.d': 0.35, 'env1.s': 0.6, 'env2.d': 0.22, 'env2.s': 0.1,
  }));
  p('Fat Mini', 'Vintage', 'bass,unison,huge,moog', ext(mini, {
    'voice.mode': 'unison', 'voice.poly': 4, 'voice.spread': 0.5,
    'osc1.uni': 3, 'osc1.detune': 13, 'mix.sub': 0.8,
    'flt1.cutoff': 900, 'flt1.drive': 0.6, 'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.3,
  }));
  p('Mini Flute', 'Vintage', 'lead,soft,mono,moog', ext(mini, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'osc2.on': 0, 'voice.mode': 'legato', 'voice.glide': 0.06,
    'flt1.cutoff': 1100, 'flt1.res': 0.12, 'flt1.env': 0.2, 'mix.noise': 0.07,
    'env1.a': 0.09, 'env1.r': 0.18, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  }));
  p('Mini Brass', 'Vintage', 'brass,lead,classic,moog', ext(mini, {
    'flt1.cutoff': 700, 'flt1.env': 0.78, 'flt1.res': 0.28,
    'env2.a': 0.055, 'env2.d': 0.5, 'env2.s': 0.45,
    'env1.a': 0.03, 'osc2.fine': -12, 'mix.sub': 0.3,
  }));

  const prophet = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.75, 'osc1.uni': 2, 'osc1.detune': 8,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.42, 'osc2.level': 0.55, 'osc2.fine': 6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2200, 'flt1.res': 0.22, 'flt1.env': 0.45, 'flt1.keytrack': 0.3,
    'env1.a': 0.02, 'env1.d': 0.9, 'env1.s': 0.7, 'env1.r': 0.5,
    'env2.a': 0.01, 'env2.d': 0.7, 'env2.s': 0.3, 'env2.r': 0.5,
    'voice.drift': 0.22,
  };
  p('Prophet Brass', 'Vintage', 'brass,poly,classic,prophet', ext(prophet, {
    'flt1.cutoff': 900, 'flt1.env': 0.8, 'env2.a': 0.04, 'env2.d': 0.6, 'env2.s': 0.5, 'env1.a': 0.025,
  }));
  p('Prophet Strings', 'Vintage', 'strings,pad,poly,prophet', ext(prophet, {
    'osc1.uni': 4, 'osc1.detune': 16, 'osc1.width': 0.9,
    'env1.a': 0.35, 'env1.d': 1.5, 'env1.s': 0.85, 'env1.r': 1.2,
    'flt1.cutoff': 3200, 'flt1.res': 0.1,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.4, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.size': 0.7,
  }), [['lfo1', 'flt1.cutoff', 0.12], ['lfo1', 'pitch', 0.006]]);
  p('Prophet Pad', 'Vintage', 'pad,warm,poly,prophet', ext(prophet, {
    'osc1.uni': 3, 'osc1.detune': 12, 'osc2.pw': 0.3,
    'env1.a': 0.8, 'env1.d': 2, 'env1.s': 0.9, 'env1.r': 2,
    'flt1.cutoff': 1700, 'lfo1.rate': 0.22, 'lfo2.rate': 0.14,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.reverb.size': 0.8,
  }), [['lfo1', 'osc2.pw', 0.28], ['lfo2', 'flt1.cutoff', 0.14]]);
  p('P5 Sync Lead', 'Vintage', 'lead,sync,aggressive,prophet', ext(prophet, {
    'osc2.sync': 1, 'osc2.semi': 5, 'osc2.level': 0.85, 'osc1.level': 0.4,
    'voice.mode': 'mono', 'flt1.cutoff': 3400, 'flt1.res': 0.2,
    'env1.a': 0.006, 'env1.s': 0.8,
  }), [['env3', 'osc2.fine', 0.35], ['mw', 'osc2.fine', 0.4], ['m3', 'osc2.fine', 0.6]]);
  p('P5 Poly Stab', 'Vintage', 'stab,poly,short,prophet', ext(prophet, {
    'env1.a': 0.002, 'env1.d': 0.22, 'env1.s': 0, 'env1.r': 0.2,
    'env2.a': 0.001, 'env2.d': 0.14, 'env2.s': 0, 'flt1.env': 0.85, 'flt1.cutoff': 500, 'flt1.res': 0.45,
  }));

  const jupiter = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 3, 'osc1.detune': 14, 'osc1.width': 0.85,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.level': 0.6, 'osc2.fine': -11, 'osc2.uni': 2,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3400, 'flt1.res': 0.15, 'flt1.env': 0.35, 'flt1.keytrack': 0.4,
    'env1.a': 0.3, 'env1.d': 1.6, 'env1.s': 0.85, 'env1.r': 1.1,
    'env2.a': 0.15, 'env2.d': 1.2, 'env2.s': 0.5, 'env2.r': 0.9,
    'voice.drift': 0.3, 'fx.chorus.on': 1, 'fx.chorus.mix': 0.42, 'fx.chorus.rate': 0.5,
  };
  p('Jupiter Strings', 'Vintage', 'strings,pad,lush,roland', ext(jupiter, {
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32, 'fx.reverb.size': 0.75,
  }), [['lfo1', 'pitch', 0.008], ['lfo2', 'flt1.cutoff', 0.1]]);
  p('Jupiter Brass', 'Vintage', 'brass,poly,roland', ext(jupiter, {
    'env1.a': 0.04, 'env1.d': 0.8, 'env1.s': 0.75, 'env1.r': 0.4,
    'env2.a': 0.06, 'env2.d': 0.5, 'env2.s': 0.4, 'flt1.cutoff': 1100, 'flt1.env': 0.75,
  }));
  p('Jupiter Pad', 'Vintage', 'pad,wide,warm,roland', ext(jupiter, {
    'osc1.uni': 5, 'osc1.detune': 22, 'env1.a': 1.2, 'env1.r': 2.4,
    'flt1.cutoff': 2200, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.42, 'fx.reverb.size': 0.9,
  }), [['lfo2', 'flt1.cutoff', 0.16], ['lfo2', 'pan', 0.25]]);
  p('JP Bell Pad', 'Vintage', 'pad,bell,shimmer,roland', ext(jupiter, {
    'osc2.wave': 'bell', 'osc2.shape': 0.35, 'osc2.oct': 1, 'osc2.level': 0.42,
    'flt1.cutoff': 5200, 'env1.a': 0.5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.4,
  }));

  const juno = {
    'osc1.wave': 'pulse', 'osc1.pw': 0.5, 'osc1.level': 0.8,
    'mix.sub': 0.45, 'mix.subWave': 'square',
    'flt1.model': 'ladder4', 'flt1.cutoff': 2600, 'flt1.res': 0.16, 'flt1.env': 0.4, 'flt1.keytrack': 0.35,
    'env1.a': 0.01, 'env1.d': 1, 'env1.s': 0.8, 'env1.r': 0.5,
    'env2.a': 0.005, 'env2.d': 0.6, 'env2.s': 0.35, 'env2.r': 0.4,
    'lfo1.rate': 0.4, 'voice.drift': 0.2,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.5, 'fx.chorus.rate': 0.7, 'fx.chorus.depth': 0.45,
  };
  p('Juno Chorus Pad', 'Vintage', 'pad,chorus,classic,roland', ext(juno, {
    'env1.a': 0.55, 'env1.r': 1.6, 'flt1.cutoff': 1900,
  }), [['lfo1', 'osc1.pw', 0.3]]);
  p('Juno Bass', 'Vintage', 'bass,punchy,roland', ext(juno, {
    'voice.mode': 'mono', 'mix.sub': 0.8, 'flt1.cutoff': 560, 'flt1.env': 0.6, 'flt1.res': 0.28,
    'env1.d': 0.3, 'env1.s': 0.55, 'env2.d': 0.2, 'env2.s': 0.05, 'fx.chorus.mix': 0.18,
  }));
  p('Juno Organ', 'Vintage', 'organ,keys,roland', ext(juno, {
    'osc1.pw': 0.5, 'mix.sub': 0.6, 'flt1.cutoff': 5200, 'flt1.env': 0,
    'env1.a': 0.003, 'env1.d': 0.05, 'env1.s': 1, 'env1.r': 0.06, 'flt1.keytrack': 0.6,
  }));
  p('Juno Stab', 'Vintage', 'stab,house,short,roland', ext(juno, {
    'env1.a': 0.002, 'env1.d': 0.24, 'env1.s': 0, 'env1.r': 0.22,
    'env2.d': 0.16, 'env2.s': 0, 'flt1.cutoff': 700, 'flt1.env': 0.8, 'flt1.res': 0.4,
  }));
  p('Juno Strings', 'Vintage', 'strings,pad,roland', ext(juno, {
    'osc1.pw': 0.36, 'env1.a': 0.42, 'env1.r': 1.3, 'flt1.cutoff': 3200, 'fx.chorus.mix': 0.6,
  }), [['lfo1', 'osc1.pw', 0.35]]);

  const ob = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 9,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.45, 'osc2.level': 0.6, 'osc2.fine': 8,
    'flt1.model': 'svfLP', 'flt1.cutoff': 2400, 'flt1.res': 0.3, 'flt1.env': 0.5, 'flt1.keytrack': 0.35,
    'env1.a': 0.03, 'env1.d': 1, 'env1.s': 0.78, 'env1.r': 0.6,
    'env2.a': 0.02, 'env2.d': 0.7, 'env2.s': 0.35, 'voice.drift': 0.25,
  };
  p('OB Brass', 'Vintage', 'brass,poly,oberheim', ext(ob, { 'flt1.cutoff': 1000, 'flt1.env': 0.82, 'env2.a': 0.05 }));
  p('OB Pad', 'Vintage', 'pad,wide,oberheim', ext(ob, {
    'osc1.uni': 4, 'osc1.detune': 18, 'env1.a': 0.9, 'env1.r': 2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.chorus.on': 1, 'fx.chorus.mix': 0.3,
  }));
  p('Matrix Sweep', 'Vintage', 'pad,sweep,motion,oberheim', ext(ob, {
    'flt1.res': 0.55, 'flt1.cutoff': 700, 'lfo1.rate': 0.16, 'lfo1.shape': 'tri',
    'env1.a': 0.6, 'env1.r': 1.8, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }), [['lfo1', 'flt1.cutoff', 0.55], ['m2', 'lfo1.rate', 0.6]]);

  const odyssey = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.75,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.28, 'osc2.level': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1800, 'flt1.res': 0.45, 'flt1.env': 0.55,
    'env1.a': 0.004, 'env1.d': 0.5, 'env1.s': 0.7, 'env1.r': 0.25,
    'env2.a': 0.002, 'env2.d': 0.35, 'env2.s': 0.2, 'voice.mode': 'mono', 'voice.drift': 0.3,
  };
  p('Odyssey Lead', 'Vintage', 'lead,mono,arp,duophonic', ext(odyssey, { 'voice.glide': 0.03 }));
  p('Odyssey Sync', 'Vintage', 'lead,sync,screaming', ext(odyssey, {
    'osc2.sync': 1, 'osc2.semi': 7, 'osc2.level': 0.9, 'osc1.level': 0.3, 'flt1.cutoff': 3800,
    'env3.loop': 1,
  }), [['env3', 'osc2.fine', 0.5]]);
  p('Odyssey S&H', 'Vintage', 'lead,random,motion', ext(odyssey, {
    'lfo1.shape': 'sh', 'lfo1.rate': 9, 'flt1.res': 0.6, 'flt1.cutoff': 900,
  }), [['lfo1', 'flt1.cutoff', 0.6], ['mw', 'lfo1.depth', 1]]);

  const cs80 = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 11,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.4, 'osc2.level': 0.6, 'osc2.fine': -9,
    'flt1.model': 'ladder2', 'flt1.cutoff': 2000, 'flt1.res': 0.2, 'flt1.env': 0.5,
    'flt2.model': 'svfHP', 'flt2.cutoff': 130,
    'env1.a': 0.06, 'env1.d': 1.4, 'env1.s': 0.8, 'env1.r': 0.9,
    'env2.a': 0.04, 'env2.d': 0.9, 'env2.s': 0.45,
    'voice.drift': 0.35, 'voice.velAmt': 0.7,
  };
  p('CS Brass', 'Vintage', 'brass,expressive,yamaha', ext(cs80, { 'flt1.cutoff': 1100, 'flt1.env': 0.8, 'flt1.vel': 0.5 }),
    [['at', 'flt1.cutoff', 0.4], ['at', 'lfo1.depth', 0.6]]);
  p('CS Strings', 'Vintage', 'strings,pad,expressive,yamaha', ext(cs80, {
    'osc1.uni': 4, 'osc1.detune': 17, 'env1.a': 0.5, 'env1.r': 1.6,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.35, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }));
  p('CS Ring Lead', 'Vintage', 'lead,ring,metallic,yamaha', ext(cs80, {
    'mix.ring': 0.45, 'osc2.semi': 7, 'voice.mode': 'legato', 'voice.glide': 0.05, 'flt1.cutoff': 3000,
  }), [['at', 'mix.ring', 0.5]]);

  const ms20 = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.8,
    'flt1.model': 'diode', 'flt1.cutoff': 700, 'flt1.res': 0.62, 'flt1.drive': 0.5, 'flt1.env': 0.7,
    'env1.a': 0.003, 'env1.d': 0.3, 'env1.s': 0.4, 'env1.r': 0.2,
    'env2.a': 0.001, 'env2.d': 0.25, 'env2.s': 0.05,
    'voice.mode': 'mono', 'voice.drift': 0.34,
  };
  p('MS Acid', 'Vintage', 'bass,acid,squelch,korg', ext(ms20, { 'voice.glide': 0.035, 'flt1.res': 0.72 }),
    [['env2', 'flt1.cutoff', 0.5], ['m1', 'flt1.res', 0.35]]);
  p('MS Screamer', 'Vintage', 'lead,harsh,korg', ext(ms20, {
    'flt1.cutoff': 1800, 'flt1.res': 0.85, 'flt1.drive': 0.75, 'mix.noise': 0.12,
    'fx.drive.on': 1, 'fx.drive.type': 'diode', 'fx.drive.amount': 0.4,
  }));
  p('MS Percussion', 'Vintage', 'perc,pluck,korg', ext(ms20, {
    'env1.d': 0.11, 'env1.s': 0, 'env1.r': 0.1, 'env2.d': 0.07, 'flt1.res': 0.8, 'mix.noise': 0.3,
  }));

  const sh101 = {
    'osc1.wave': 'pulse', 'osc1.pw': 0.38, 'osc1.level': 0.85,
    'mix.sub': 0.7, 'mix.subWave': 'square',
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.4, 'flt1.env': 0.6, 'flt1.keytrack': 0.3,
    'env1.a': 0.003, 'env1.d': 0.3, 'env1.s': 0.4, 'env1.r': 0.18,
    'env2.a': 0.001, 'env2.d': 0.22, 'env2.s': 0.05,
    'voice.mode': 'mono', 'voice.drift': 0.24,
  };
  p('101 Bass', 'Vintage', 'bass,mono,punchy,roland', sh101);
  p('101 Arp', 'Vintage', 'arp,bass,sequence,roland', ext(sh101, {
    'arp.on': 1, 'arp.pattern': 'up', 'arp.div': '1_16', 'arp.oct': 2, 'arp.gate': 0.45,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.2, 'fx.delay.fb': 0.35,
  }));
  p('101 Squelch', 'Vintage', 'bass,acid,resonant,roland', ext(sh101, {
    'flt1.res': 0.78, 'flt1.env': 0.85, 'flt1.drive': 0.5, 'voice.glide': 0.04,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.32,
  }));

  p('Solina Ensemble', 'Vintage', 'strings,ensemble,pad', {
    'osc1.wave': 'string', 'osc1.shape': 0.2, 'osc1.uni': 6, 'osc1.detune': 12, 'osc1.width': 1,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4200, 'flt1.res': 0.05,
    'flt2.model': 'svfHP', 'flt2.cutoff': 220,
    'env1.a': 0.22, 'env1.d': 1.5, 'env1.s': 0.9, 'env1.r': 0.9,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.62, 'fx.chorus.voices': 3, 'fx.chorus.rate': 0.9, 'fx.chorus.depth': 0.55,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  });
  p('Mellotron Flutes', 'Vintage', 'tape,flute,pad,lofi', {
    'osc1.wave': 'reed', 'osc1.shape': 0.55, 'osc1.uni': 2, 'osc1.detune': 6,
    'mix.noise': 0.06, 'mix.noiseType': 'pink', 'mix.noiseFlt': 0.35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3000, 'flt1.res': 0.08,
    'env1.a': 0.09, 'env1.d': 1.2, 'env1.s': 0.85, 'env1.r': 0.6,
    'voice.drift': 0.45, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
    'fx.eq.high': -3, 'fx.eq.low': 2,
  }, [['lfo1', 'pitch', 0.02], ['lfo2', 'flt1.cutoff', 0.08]]);
  p('Mellotron Strings', 'Vintage', 'tape,strings,pad,lofi', {
    'osc1.wave': 'string', 'osc1.shape': 0.65, 'osc1.uni': 3, 'osc1.detune': 15,
    'mix.noise': 0.05, 'mix.noiseType': 'pink',
    'flt1.model': 'svfLP', 'flt1.cutoff': 2600,
    'env1.a': 0.16, 'env1.d': 1.6, 'env1.s': 0.82, 'env1.r': 0.8,
    'voice.drift': 0.5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.34, 'fx.eq.high': -4,
  }, [['lfo1', 'pitch', 0.024]]);
  p('Clavinet', 'Vintage', 'keys,funk,pluck', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.16, 'osc1.level': 0.85,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1900, 'flt1.res': 0.35, 'flt1.env': 0.4, 'flt1.keytrack': 0.7,
    'flt2.model': 'svfHP', 'flt2.cutoff': 320,
    'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0.12, 'env1.r': 0.12,
    'env2.a': 0.001, 'env2.d': 0.16, 'env2.s': 0,
    'voice.velAmt': 0.8, 'flt1.vel': 0.45,
  });
  p('Drawbar Organ', 'Vintage', 'organ,keys,harmonic', {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.66, 'osc1.level': 0.85,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000, 'flt1.env': 0,
    'env1.a': 0.004, 'env1.d': 0.05, 'env1.s': 1, 'env1.r': 0.05,
    'voice.drift': 0.06, 'fx.chorus.on': 1, 'fx.chorus.rate': 5.6, 'fx.chorus.depth': 0.3, 'fx.chorus.mix': 0.35,
  }, [['m3', 'osc1.shape', 1]], ['Brightness', 'Vibrato', 'Drawbars', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Perc Organ', 'Vintage', 'organ,keys,percussive', {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.33,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0, 'osc2.oct': 2, 'osc2.level': 0.5,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000,
    'env1.a': 0.002, 'env1.d': 0.06, 'env1.s': 0.95, 'env1.r': 0.06,
    'env3.a': 0.001, 'env3.d': 0.18, 'env3.s': 0,
  }, [['env3', 'osc2.level', 0.9]]);
  p('Rock Organ', 'Vintage', 'organ,dirty,keys', {
    'osc1.wave': 'harmonic', 'osc1.shape': 1, 'osc1.level': 0.9,
    'flt1.model': 'ladder2', 'flt1.cutoff': 5000, 'flt1.drive': 0.5,
    'env1.a': 0.003, 'env1.d': 0.05, 'env1.s': 1, 'env1.r': 0.05,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.45,
    'fx.chorus.on': 1, 'fx.chorus.rate': 6.2, 'fx.chorus.mix': 0.4,
  });
  p('PPG Wave', 'Vintage', 'wavetable,digital,pad,ppg', {
    'osc1.wave': 'digital', 'osc1.shape': 0.3, 'osc1.uni': 2, 'osc1.detune': 9,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2800, 'flt1.res': 0.2, 'flt1.env': 0.4,
    'env1.a': 0.1, 'env1.d': 1.2, 'env1.s': 0.75, 'env1.r': 0.8,
    'lfo2.rate': 0.18, 'fx.chorus.on': 1, 'fx.chorus.mix': 0.3,
  }, [['lfo2', 'osc1.shape', 0.4], ['m3', 'osc1.shape', 0.7]]);
  p('Polymoog Vox', 'Vintage', 'strings,vox,pad', {
    'osc1.wave': 'vocal', 'osc1.shape': 0.2, 'osc1.uni': 4, 'osc1.detune': 13,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3600, 'flt2.model': 'svfHP', 'flt2.cutoff': 200,
    'env1.a': 0.18, 'env1.d': 1.4, 'env1.s': 0.88, 'env1.r': 0.9,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Vocoder Choir', 'Vintage', 'vocal,choir,pad,formant', {
    'osc1.wave': 'vocal', 'osc1.shape': 0.45, 'osc1.uni': 3, 'osc1.detune': 11,
    'flt1.model': 'formant', 'flt1.cutoff': 900, 'flt1.res': 0.5,
    'env1.a': 0.25, 'env1.d': 1.2, 'env1.s': 0.85, 'env1.r': 1,
    'lfo1.rate': 0.3, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'fx.reverb.size': 0.85,
  }, [['lfo1', 'flt1.cutoff', 0.3], ['mw', 'flt1.cutoff', 0.6]]);
  p('Tape Choir', 'Vintage', 'choir,pad,lofi', {
    'osc1.wave': 'formant', 'osc1.shape': 0.15, 'osc1.uni': 4, 'osc1.detune': 18,
    'mix.noise': 0.05, 'mix.noiseType': 'pink',
    'flt1.model': 'svfLP', 'flt1.cutoff': 2400,
    'env1.a': 0.4, 'env1.d': 1.6, 'env1.s': 0.85, 'env1.r': 1.4,
    'voice.drift': 0.42, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.42, 'fx.reverb.size': 0.85,
  });
  p('String Machine', 'Vintage', 'strings,ensemble,divide-down', {
    'osc1.wave': 'string', 'osc1.shape': 0.4, 'osc1.uni': 7, 'osc1.detune': 9, 'osc1.width': 1, 'osc1.blend': 0.9,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4800, 'flt2.model': 'svfHP', 'flt2.cutoff': 260,
    'env1.a': 0.12, 'env1.d': 1.4, 'env1.s': 0.92, 'env1.r': 0.7,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.7, 'fx.chorus.voices': 4,
  });
  p('Vintage Sub Bass', 'Vintage', 'bass,sub,deep', {
    'osc1.wave': 'classic', 'osc1.shape': 0.33, 'osc1.level': 0.7,
    'mix.sub': 0.9, 'mix.subWave': 'sine',
    'flt1.model': 'ladder4', 'flt1.cutoff': 320, 'flt1.res': 0.1, 'flt1.env': 0.3,
    'env1.a': 0.006, 'env1.d': 0.5, 'env1.s': 0.7, 'env1.r': 0.25,
    'voice.mode': 'mono', 'voice.glide': 0.02, 'fx.comp.on': 1, 'fx.comp.thresh': -20, 'fx.comp.ratio': 5,
  });
  p('Pulse Width Pad', 'Vintage', 'pad,pwm,classic', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.5, 'osc1.uni': 3, 'osc1.detune': 12,
    'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.5, 'osc2.fine': -8, 'osc2.level': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2400, 'flt1.res': 0.12,
    'env1.a': 0.5, 'env1.d': 1.6, 'env1.s': 0.88, 'env1.r': 1.4,
    'lfo1.rate': 0.24, 'lfo2.rate': 0.19,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'osc1.pw', 0.38], ['lfo2', 'osc2.pw', -0.34]]);
  p('Analog Sync Brass', 'Vintage', 'brass,sync,poly', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05,
    'osc2.on': 1, 'osc2.wave': 'sync', 'osc2.shape': 0.4, 'osc2.sync': 1, 'osc2.semi': 12, 'osc2.level': 0.65,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.env': 0.75, 'flt1.res': 0.25,
    'env1.a': 0.03, 'env1.d': 0.8, 'env1.s': 0.7, 'env1.r': 0.4,
    'env2.a': 0.05, 'env2.d': 0.6, 'env2.s': 0.4,
  }, [['env3', 'osc2.fine', 0.28]]);

  /* ═══════════════════════════════════════════════════════════════════════
     MODERN — supersaws, reeses and everything that came after the DAW
     ═══════════════════════════════════════════════════════════════════════ */

  const superSaw = {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.1, 'osc1.uni': 7, 'osc1.detune': 26, 'osc1.width': 1, 'osc1.blend': 0.8,
    'osc2.on': 1, 'osc2.wave': 'supersaw', 'osc2.shape': 0.2, 'osc2.uni': 5, 'osc2.detune': 20,
    'osc2.oct': -1, 'osc2.level': 0.5, 'osc2.width': 0.8,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000, 'flt1.res': 0.1, 'flt1.env': 0.25,
    'flt2.model': 'svfHP', 'flt2.cutoff': 130,
    'env1.a': 0.02, 'env1.d': 1.2, 'env1.s': 0.85, 'env1.r': 0.5,
    'env2.a': 0.01, 'env2.d': 0.8, 'env2.s': 0.5,
    'voice.drift': 0.14, 'fx.width': 1.25,
  };
  p('Trance Saw', 'Modern', 'lead,supersaw,trance,wide', ext(superSaw, {
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22, 'fx.delay.fb': 0.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }));
  p('Anthem Lead', 'Modern', 'lead,supersaw,big,festival', ext(superSaw, {
    'osc1.detune': 34, 'osc2.oct': 0, 'osc2.level': 0.55, 'flt1.cutoff': 9000,
    'fx.drive.on': 1, 'fx.drive.type': 'soft', 'fx.drive.amount': 0.25,
    'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28, 'voice.mode': 'legato', 'voice.glide': 0.02,
  }));
  p('Big Room Stack', 'Modern', 'lead,supersaw,huge,edm', ext(superSaw, {
    'osc1.uni': 8, 'osc1.detune': 40, 'osc2.uni': 8, 'osc2.detune': 34, 'osc2.oct': 0, 'osc2.fine': 12,
    'flt2.cutoff': 200, 'fx.comp.on': 1, 'fx.comp.thresh': -16, 'fx.comp.ratio': 6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.width': 1.4,
  }));
  p('Festival Pluck', 'Modern', 'pluck,supersaw,edm', ext(superSaw, {
    'env1.a': 0.002, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.3,
    'env2.a': 0.001, 'env2.d': 0.22, 'env2.s': 0, 'flt1.env': 0.7, 'flt1.cutoff': 1400, 'flt1.res': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.26, 'fx.delay.pong': 0.7,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }));
  p('Future Chord', 'Modern', 'chord,supersaw,future-bass,wide', ext(superSaw, {
    'osc1.detune': 30, 'env1.a': 0.008, 'env1.d': 1.6, 'env1.s': 0.7, 'env1.r': 0.6,
    'lfo1.rate': 5.5, 'lfo1.shape': 'tri', 'fx.chorus.on': 1, 'fx.chorus.mix': 0.3,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }), [['lfo1', 'pitch', 0.012], ['mw', 'lfo1.depth', 1], ['m2', 'osc1.detune', 0.7]]);
  p('Hoover', 'Modern', 'lead,hoover,rave,aggressive', {
    'osc1.wave': 'growl', 'osc1.shape': 0.45, 'osc1.uni': 7, 'osc1.detune': 42, 'osc1.width': 0.9,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.semi': -12, 'osc2.level': 0.55, 'osc2.uni': 3, 'osc2.detune': 24,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1600, 'flt1.res': 0.4, 'flt1.env': 0.5, 'flt1.drive': 0.4,
    'env1.a': 0.01, 'env1.d': 0.9, 'env1.s': 0.8, 'env1.r': 0.35,
    'env2.a': 0.02, 'env2.d': 0.6, 'env2.s': 0.4,
    'lfo1.rate': 0.9, 'lfo1.shape': 'tri',
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.35,
    'voice.mode': 'mono', 'voice.glide': 0.03,
  }, [['lfo1', 'pitch', 0.05], ['env3', 'pitch', -0.06], ['mw', 'flt1.cutoff', 0.5]]);
  p('Rave Stab', 'Modern', 'stab,rave,short,aggressive', {
    'osc1.wave': 'growl', 'osc1.shape': 0.3, 'osc1.uni': 5, 'osc1.detune': 30,
    'flt1.model': 'ladder4', 'flt1.cutoff': 800, 'flt1.res': 0.5, 'flt1.env': 0.85,
    'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0, 'env1.r': 0.25,
    'env2.a': 0.001, 'env2.d': 0.18, 'env2.s': 0,
    'fx.drive.on': 1, 'fx.drive.amount': 0.35, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  });

  const reese = {
    'osc1.wave': 'growl', 'osc1.shape': 0.25, 'osc1.uni': 2, 'osc1.detune': 42, 'osc1.width': 0.4,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.fine': -18, 'osc2.level': 0.7,
    'mix.sub': 0.55,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.3, 'flt1.drive': 0.45,
    'env1.a': 0.006, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 0.2,
    'voice.mode': 'mono', 'voice.glide': 0.02,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.35,
    'fx.comp.on': 1, 'fx.comp.thresh': -18, 'fx.comp.ratio': 6,
  };
  p('Reese Bass', 'Modern', 'bass,reese,dnb,wide', reese, [['lfo1', 'osc2.fine', 0.05]]);
  p('Neuro Bass', 'Modern', 'bass,neuro,dnb,motion', ext(reese, {
    'flt1.model': 'svfBP', 'flt1.cutoff': 500, 'flt1.res': 0.6,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.05,
    'fx.drive.type': 'fold', 'fx.drive.amount': 0.5,
  }), [['mot1', 'flt1.cutoff', 0.75], ['mot1', 'osc1.shape', 0.4]], null, [MOT.chaos, MOT.stab]);
  p('Growler', 'Modern', 'bass,growl,dirty', ext(reese, {
    'osc1.shape': 0.7, 'flt1.model': 'diode', 'flt1.res': 0.55, 'flt1.drive': 0.65,
    'lfo1.rate': 3.4, 'lfo1.shape': 'tri',
  }), [['lfo1', 'flt1.cutoff', 0.5], ['mw', 'lfo1.rate', 0.6]]);
  p('Wobble Bass', 'Modern', 'bass,wobble,dubstep,motion', ext(reese, {
    'flt1.cutoff': 420, 'flt1.res': 0.72, 'flt1.drive': 0.6,
    'lfo1.rate': 3, 'lfo1.sync': 1, 'lfo1.div': '1_8', 'lfo1.shape': 'sine', 'lfo1.mode': 'free',
  }), [['lfo1', 'flt1.cutoff', 0.85], ['m2', 'lfo1.rate', 0.9]],
    ['Brightness', 'Wobble Rate', 'Grit', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Talking Bass', 'Modern', 'bass,formant,vocal,dubstep', ext(reese, {
    'flt1.model': 'formant', 'flt1.cutoff': 500, 'flt1.res': 0.6,
    'lfo1.rate': 1.6, 'lfo1.shape': 'tri', 'lfo1.sync': 1, 'lfo1.div': '1_4',
  }), [['lfo1', 'flt1.cutoff', 0.7], ['mw', 'flt1.cutoff', 0.8]],
    ['Vowel', 'Wobble', 'Grit', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Screech Bass', 'Modern', 'bass,screech,dubstep,harsh', ext(reese, {
    'osc1.wave': 'fold', 'osc1.shape': 0.6, 'mix.fm': 0.3, 'osc2.ratio': 1, 'osc2.semi': 12,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1200, 'flt1.res': 0.75,
    'fx.drive.type': 'diode', 'fx.drive.amount': 0.55,
  }), [['lfo1', 'mix.fm', 0.4], ['mw', 'flt1.cutoff', 0.6]]);
  p('Metal Bass', 'Modern', 'bass,ring,metallic,dubstep', ext(reese, {
    'mix.ring': 0.55, 'osc2.semi': 7, 'osc2.wave': 'bell', 'osc2.shape': 0.4,
    'flt1.model': 'comb', 'flt1.cutoff': 320, 'flt1.res': 0.55,
  }));
  p('808 Sub', 'Modern', 'bass,808,trap,sub', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.level': 0.9,
    'mix.sub': 0.5, 'mix.subWave': 'sine',
    'flt1.model': 'svfLP', 'flt1.cutoff': 200, 'flt1.res': 0,
    'env1.a': 0.002, 'env1.d': 2.4, 'env1.s': 0.15, 'env1.r': 0.5,
    'env3.a': 0.001, 'env3.d': 0.07, 'env3.s': 0,
    'voice.mode': 'mono', 'voice.glide': 0.045, 'voice.poly': 1,
    'fx.comp.on': 1, 'fx.comp.thresh': -14, 'fx.comp.ratio': 8, 'fx.comp.makeup': 3,
  }, [['env3', 'pitch', 0.2]]);
  p('Distorted 808', 'Modern', 'bass,808,trap,dirty', {
    'osc1.wave': 'classic', 'osc1.shape': 0.33, 'mix.sub': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 420, 'flt1.drive': 0.6,
    'env1.a': 0.002, 'env1.d': 2, 'env1.s': 0.2, 'env1.r': 0.4,
    'env3.a': 0.001, 'env3.d': 0.06, 'env3.s': 0,
    'voice.mode': 'mono', 'voice.glide': 0.05,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.5,
    'fx.comp.on': 1, 'fx.comp.thresh': -16, 'fx.comp.ratio': 8,
  }, [['env3', 'pitch', 0.22]]);
  p('House Organ Stab', 'Modern', 'stab,house,organ,chord', {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.3, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1400, 'flt1.res': 0.35, 'flt1.env': 0.6,
    'env1.a': 0.002, 'env1.d': 0.28, 'env1.s': 0.1, 'env1.r': 0.2,
    'env2.a': 0.001, 'env2.d': 0.18, 'env2.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.22, 'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.15,
  });
  p('Filter House', 'Modern', 'chord,house,filter,motion', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 4, 'osc1.detune': 18,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.42,
    'env1.a': 0.006, 'env1.d': 0.8, 'env1.s': 0.7, 'env1.r': 0.3,
    'lfo1.rate': 0.5, 'lfo1.sync': 1, 'lfo1.div': '2n_1', 'lfo1.mode': 'free', 'lfo1.shape': 'tri',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  }, [['lfo1', 'flt1.cutoff', 0.6]]);
  p('Techno Rumble', 'Modern', 'bass,techno,rumble,dark', {
    'osc1.wave': 'classic', 'osc1.shape': 0.33, 'mix.sub': 0.85, 'mix.noise': 0.06, 'mix.noiseType': 'pink',
    'flt1.model': 'ladder4', 'flt1.cutoff': 180, 'flt1.res': 0.2, 'flt1.drive': 0.4,
    'env1.a': 0.01, 'env1.d': 1.6, 'env1.s': 0.5, 'env1.r': 0.8,
    'voice.mode': 'mono', 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.reverb.size': 0.85,
    'fx.comp.on': 1, 'fx.comp.thresh': -20, 'fx.comp.ratio': 6,
  });
  p('Acid Line', 'Modern', 'bass,acid,303,resonant', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.9,
    'flt1.model': 'diode', 'flt1.cutoff': 480, 'flt1.res': 0.78, 'flt1.env': 0.85, 'flt1.drive': 0.5,
    'env1.a': 0.002, 'env1.d': 0.4, 'env1.s': 0.3, 'env1.r': 0.12,
    'env2.a': 0.001, 'env2.d': 0.3, 'env2.s': 0,
    'voice.mode': 'mono', 'voice.glide': 0.04, 'voice.glideAuto': 1,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.35,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.14, 'fx.delay.fb': 0.3,
  }, [['m1', 'flt1.cutoff', 0.8], ['m2', 'flt1.res', 0.3], ['m3', 'flt1.drive', 0.5]],
    ['Cutoff', 'Resonance', 'Drive', 'Space', 'Delay', 'Width', 'Tone', 'Chaos']);
  p('Techno Zap', 'Modern', 'perc,zap,techno,short', {
    'osc1.wave': 'digital', 'osc1.shape': 0.6, 'mix.fm': 0.5, 'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 19,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1800, 'flt1.res': 0.5,
    'env1.a': 0.001, 'env1.d': 0.12, 'env1.s': 0, 'env1.r': 0.1,
    'env3.a': 0.001, 'env3.d': 0.05, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['env3', 'pitch', 0.4], ['env3', 'mix.fm', 0.5]]);
  p('Hyperpop Lead', 'Modern', 'lead,bright,detuned,hyperpop', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0, 'osc1.uni': 6, 'osc1.detune': 32,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.shape': 0.3, 'osc2.oct': 1, 'osc2.level': 0.35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 9000, 'flt1.res': 0.15,
    'env1.a': 0.002, 'env1.d': 0.6, 'env1.s': 0.6, 'env1.r': 0.3,
    'fx.crush.on': 1, 'fx.crush.bits': 10, 'fx.crush.mix': 0.3,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.25,
  });
  p('Drill Bell', 'Modern', 'lead,bell,drill,dark', {
    'osc1.wave': 'bell', 'osc1.shape': 0.45, 'osc1.uni': 2, 'osc1.detune': 6,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4000, 'flt1.env': 0.3,
    'env1.a': 0.002, 'env1.d': 0.9, 'env1.s': 0.1, 'env1.r': 0.6,
    'voice.mode': 'legato', 'voice.glide': 0.06,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.2,
  });
  p('Wide Saw Chord', 'Modern', 'chord,wide,poly', ext(superSaw, {
    'osc1.uni': 6, 'osc1.detune': 24, 'osc2.oct': 0, 'osc2.semi': 7, 'osc2.level': 0.4,
    'env1.a': 0.05, 'env1.d': 1.4, 'env1.s': 0.8, 'env1.r': 0.9,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.35, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }));
  p('Sidechain Pad', 'Modern', 'pad,pump,edm,motion', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.15, 'osc1.uni': 6, 'osc1.detune': 22,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000,
    'env1.a': 0.4, 'env1.d': 1.4, 'env1.s': 0.9, 'env1.r': 1.2,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.35, 'mot1.steps': 16,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32,
  }, [['mot1', 'amp', 0.55]], ['Brightness', 'Pump Depth', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'],
    [MOT.pump, MOT.rise]);

  /* ═══════════════════════════════════════════════════════════════════════
     ANALOG — imperfect, drifting, hands-on
     ═══════════════════════════════════════════════════════════════════════ */

  const analog = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 10,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2000, 'flt1.res': 0.2, 'flt1.env': 0.45, 'flt1.drive': 0.25,
    'env1.a': 0.02, 'env1.d': 0.9, 'env1.s': 0.75, 'env1.r': 0.5,
    'env2.a': 0.01, 'env2.d': 0.6, 'env2.s': 0.3,
    'voice.drift': 0.45,
  };
  p('Drift Pad', 'Analog', 'pad,drift,warm', ext(analog, {
    'osc1.uni': 4, 'osc1.detune': 16, 'env1.a': 0.9, 'env1.r': 2.2, 'flt1.cutoff': 1600,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.36, 'fx.reverb.size': 0.85,
  }), [['lfo2', 'flt1.cutoff', 0.16], ['lfo1', 'pitch', 0.01]]);
  p('Warm Keys', 'Analog', 'keys,warm,soft', ext(analog, {
    'osc1.wave': 'classic', 'osc1.shape': 0.4, 'env1.a': 0.004, 'env1.d': 0.9, 'env1.s': 0.4, 'env1.r': 0.5,
    'flt1.cutoff': 1900, 'flt1.keytrack': 0.5, 'fx.chorus.on': 1, 'fx.chorus.mix': 0.25,
  }));
  p('Sloppy Saw', 'Analog', 'lead,dirty,drift', ext(analog, {
    'voice.drift': 0.85, 'osc1.uni': 3, 'osc1.detune': 22, 'flt1.drive': 0.45,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.3,
  }));
  p('Analog Brass Section', 'Analog', 'brass,section,warm', ext(analog, {
    'osc1.uni': 3, 'osc1.detune': 14, 'osc2.on': 1, 'osc2.wave': 'pulse', 'osc2.pw': 0.35, 'osc2.level': 0.55,
    'flt1.cutoff': 950, 'flt1.env': 0.8, 'env2.a': 0.06, 'env2.d': 0.5, 'env2.s': 0.45,
    'env1.a': 0.04, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  }));
  p('Rubber Bass', 'Analog', 'bass,rubber,bouncy', ext(analog, {
    'osc1.wave': 'pulse', 'osc1.pw': 0.3, 'mix.sub': 0.6, 'voice.mode': 'mono',
    'flt1.cutoff': 600, 'flt1.res': 0.5, 'flt1.env': 0.7,
    'env1.d': 0.3, 'env1.s': 0.4, 'env1.r': 0.15, 'env2.d': 0.16, 'env2.s': 0,
  }));
  p('Vintage Comp Lead', 'Analog', 'lead,compressed,smooth', ext(analog, {
    'voice.mode': 'legato', 'voice.glide': 0.05, 'flt1.cutoff': 2600,
    'fx.comp.on': 1, 'fx.comp.thresh': -22, 'fx.comp.ratio': 6, 'fx.comp.makeup': 5,
    'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.2, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }), [['at', 'lfo1.depth', 0.8], ['lfo1', 'pitch', 0.02]]);
  p('Sample & Hold Pad', 'Analog', 'pad,random,motion', ext(analog, {
    'osc1.uni': 3, 'osc1.detune': 14, 'env1.a': 0.7, 'env1.r': 1.8,
    'lfo2.shape': 'sh', 'lfo2.rate': 4, 'lfo2.smooth': 0.15, 'flt1.res': 0.35, 'flt1.cutoff': 1400,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.2,
  }), [['lfo2', 'flt1.cutoff', 0.45], ['lfo2', 'pan', 0.3]]);
  p('Detuned Organ', 'Analog', 'organ,detuned,warm', ext(analog, {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.4, 'osc1.uni': 3, 'osc1.detune': 14,
    'env1.a': 0.005, 'env1.d': 0.1, 'env1.s': 1, 'env1.r': 0.08, 'flt1.cutoff': 4500, 'flt1.env': 0,
  }));
  p('Analog Choir', 'Analog', 'choir,pad,vocal', ext(analog, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.35, 'osc1.uni': 4, 'osc1.detune': 18,
    'env1.a': 0.5, 'env1.d': 1.6, 'env1.s': 0.88, 'env1.r': 1.6,
    'flt1.cutoff': 2400, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.42, 'fx.reverb.size': 0.9,
  }), [['lfo1', 'osc1.shape', 0.15], ['lfo2', 'pitch', 0.01]]);
  p('Fat Unison Lead', 'Analog', 'lead,unison,huge', ext(analog, {
    'voice.mode': 'unison', 'voice.poly': 6, 'voice.spread': 0.6, 'voice.glide': 0.02,
    'osc1.uni': 3, 'osc1.detune': 16, 'flt1.cutoff': 3000, 'flt1.res': 0.25,
    'fx.drive.on': 1, 'fx.drive.amount': 0.25,
  }));

  /* ═══════════════════════════════════════════════════════════════════════
     DIGITAL / FM
     ═══════════════════════════════════════════════════════════════════════ */

  const fmBase = {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.level': 0.85,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0, 'osc2.level': 0, 'osc2.ratio': 1,
    'mix.fm': 0.4,
    'flt1.model': 'svfLP', 'flt1.cutoff': 12000, 'flt1.res': 0,
    'env1.a': 0.002, 'env1.d': 1.2, 'env1.s': 0.3, 'env1.r': 0.5,
    'env3.a': 0.001, 'env3.d': 0.7, 'env3.s': 0.1, 'env3.r': 0.4,
    'voice.velAmt': 0.7,
  };
  p('DX Electric Piano', 'Digital', 'keys,fm,epiano,classic', ext(fmBase, {
    'osc2.semi': 12, 'mix.fm': 0.36, 'env1.d': 1.8, 'env1.s': 0.18, 'env1.r': 0.6,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.3, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  }), [['env3', 'mix.fm', 0.5], ['vel', 'mix.fm', 0.35]]);
  p('DX Bells', 'Digital', 'bell,fm,bright', ext(fmBase, {
    'osc2.semi': 19, 'mix.fm': 0.5, 'env1.d': 2.4, 'env1.s': 0.05, 'env1.r': 1.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.reverb.size': 0.8,
  }), [['env3', 'mix.fm', 0.6]]);
  p('DX Marimba', 'Digital', 'mallet,fm,perc', ext(fmBase, {
    'osc2.semi': 24, 'mix.fm': 0.3, 'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0, 'env1.r': 0.35,
    'env3.d': 0.1, 'env3.s': 0,
  }), [['env3', 'mix.fm', 0.55]]);
  p('DX Bass', 'Digital', 'bass,fm,punchy', ext(fmBase, {
    'osc2.semi': 12, 'mix.fm': 0.42, 'voice.mode': 'mono',
    'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0.35, 'env1.r': 0.15,
    'env3.d': 0.09, 'env3.s': 0, 'mix.sub': 0.35,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2200,
  }), [['env3', 'mix.fm', 0.6]]);
  p('DX Brass', 'Digital', 'brass,fm,bright', ext(fmBase, {
    'osc2.semi': 0, 'mix.fm': 0.35, 'env1.a': 0.03, 'env1.d': 0.7, 'env1.s': 0.7, 'env1.r': 0.3,
    'env3.a': 0.04, 'env3.d': 0.5, 'env3.s': 0.4,
  }), [['env3', 'mix.fm', 0.45], ['at', 'mix.fm', 0.3]]);
  p('Glass Keys', 'Digital', 'keys,glass,fm,bright', ext(fmBase, {
    'osc1.wave': 'glass', 'osc1.shape': 0.3, 'osc2.semi': 12, 'mix.fm': 0.22,
    'env1.d': 1.6, 'env1.s': 0.2, 'env1.r': 0.9,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.34, 'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.16,
  }));
  p('Tubular Bells', 'Digital', 'bell,tubular,long', {
    'osc1.wave': 'bell', 'osc1.shape': 0.75, 'osc1.uni': 2, 'osc1.detune': 4,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.shape': 0.3, 'osc2.oct': 1, 'osc2.level': 0.35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000,
    'env1.a': 0.001, 'env1.d': 6, 'env1.s': 0, 'env1.r': 4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.42, 'fx.reverb.size': 0.9, 'fx.reverb.decay': 5,
  });
  p('Digital Sweep', 'Digital', 'pad,wavetable,motion', {
    'osc1.wave': 'digital', 'osc1.shape': 0, 'osc1.uni': 3, 'osc1.detune': 12,
    'flt1.model': 'svfLP', 'flt1.cutoff': 6000, 'flt1.res': 0.2,
    'env1.a': 0.4, 'env1.d': 1.6, 'env1.s': 0.8, 'env1.r': 1.4,
    'lfo1.rate': 0.14, 'lfo1.shape': 'tri',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35,
  }, [['lfo1', 'osc1.shape', 0.9], ['m3', 'osc1.shape', 0.8]],
    ['Brightness', 'Sweep Rate', 'Wave Position', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Bit Lead', 'Digital', 'lead,lofi,crush,chiptune', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.25, 'osc1.level': 0.9,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000,
    'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0.6, 'env1.r': 0.1,
    'voice.mode': 'mono', 'voice.drift': 0,
    'fx.crush.on': 1, 'fx.crush.bits': 6, 'fx.crush.rate': 0.4, 'fx.crush.mix': 1,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.2,
  }, [['lfo1', 'osc1.pw', 0.3], ['m3', 'fx.crush.mix', 0.6]]);
  p('Chiptune Arp', 'Digital', 'arp,chiptune,lofi,8bit', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.5, 'voice.drift': 0,
    'flt1.model': 'bypass',
    'env1.a': 0.001, 'env1.d': 0.08, 'env1.s': 0.5, 'env1.r': 0.03,
    'arp.on': 1, 'arp.div': '1_16', 'arp.pattern': 'up', 'arp.oct': 2, 'arp.gate': 0.5,
    'fx.crush.on': 1, 'fx.crush.bits': 5, 'fx.crush.mix': 1,
  }, [['lfo1', 'osc1.pw', 0.35]]);
  p('Ring Pluck', 'Digital', 'pluck,ring,metallic', {
    'osc1.wave': 'classic', 'osc1.shape': 0,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0, 'osc2.semi': 7, 'osc2.level': 0.5,
    'mix.ring': 0.8,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2400, 'flt1.res': 0.3,
    'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0, 'env1.r': 0.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32, 'fx.delay.on': 1, 'fx.delay.div': '1_8t', 'fx.delay.mix': 0.2,
  });
  p('Additive Drone', 'Digital', 'drone,additive,ambient', {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.9, 'osc1.uni': 4, 'osc1.detune': 8,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000, 'flt1.res': 0.15,
    'env1.a': 2, 'env1.d': 3, 'env1.s': 0.9, 'env1.r': 3,
    'lfo1.rate': 0.07, 'lfo2.rate': 0.05,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.5, 'fx.reverb.size': 0.95, 'fx.reverb.decay': 7,
  }, [['lfo1', 'osc1.shape', 0.35], ['lfo2', 'flt1.cutoff', 0.25]]);
  p('Formant Morph', 'Digital', 'vocal,formant,motion', {
    'osc1.wave': 'formant', 'osc1.shape': 0, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'formant', 'flt1.cutoff': 600, 'flt1.res': 0.55,
    'env1.a': 0.1, 'env1.d': 1.2, 'env1.s': 0.85, 'env1.r': 0.8,
    'lfo1.rate': 0.4, 'lfo1.shape': 'tri',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'osc1.shape', 0.6], ['lfo1', 'flt1.cutoff', 0.5], ['mw', 'flt1.cutoff', 0.8]],
    ['Vowel', 'Morph Rate', 'Wave Vowel', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Wavefold Lead', 'Digital', 'lead,fold,west-coast', {
    'osc1.wave': 'fold', 'osc1.shape': 0.35, 'osc1.level': 0.85,
    'flt1.model': 'svfLP', 'flt1.cutoff': 6000, 'flt1.res': 0.2,
    'env1.a': 0.004, 'env1.d': 0.8, 'env1.s': 0.7, 'env1.r': 0.3,
    'env3.a': 0.005, 'env3.d': 0.5, 'env3.s': 0.3,
    'voice.mode': 'legato', 'voice.glide': 0.03,
  }, [['env3', 'osc1.shape', 0.5], ['mw', 'osc1.shape', 0.6], ['m3', 'osc1.shape', 0.8]]);
  p('Glitch Texture', 'Digital', 'fx,glitch,texture,motion', {
    'osc1.wave': 'noise', 'osc1.shape': 0.4, 'osc1.uni': 2,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1200, 'flt1.res': 0.65,
    'env1.a': 0.001, 'env1.d': 0.9, 'env1.s': 0.5, 'env1.r': 0.4,
    'mot1.on': 1, 'mot1.div': '1_32', 'mot2.on': 1, 'mot2.div': '1_16',
    'fx.crush.on': 1, 'fx.crush.bits': 8, 'fx.crush.rate': 0.5, 'fx.crush.mix': 0.6,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.5,
  }, [['mot1', 'flt1.cutoff', 0.8], ['mot2', 'amp', 0.5], ['mot2', 'pan', 0.6]],
    null, [MOT.chaos, MOT.gate]);

  /* ═══════════════════════════════════════════════════════════════════════
     PADS
     ═══════════════════════════════════════════════════════════════════════ */

  const padBase = {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.3, 'osc1.uni': 4, 'osc1.detune': 16, 'osc1.width': 0.9,
    'flt1.model': 'svfLP', 'flt1.cutoff': 2600, 'flt1.res': 0.12, 'flt1.env': 0.25,
    'env1.a': 0.8, 'env1.d': 2, 'env1.s': 0.88, 'env1.r': 2,
    'env2.a': 0.6, 'env2.d': 1.6, 'env2.s': 0.6, 'env2.r': 1.6,
    'lfo1.rate': 0.2, 'lfo2.rate': 0.13,
    'voice.drift': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.36, 'fx.reverb.size': 0.8,
  };
  p('Glacier', 'Pad', 'pad,cold,wide,ambient', ext(padBase, {
    'osc1.wave': 'glass', 'osc1.shape': 0.4, 'flt1.cutoff': 4200,
    'fx.reverb.mix': 0.45, 'fx.reverb.size': 0.95, 'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.22,
  }), [['lfo2', 'flt1.cutoff', 0.2], ['lfo1', 'pan', 0.3]]);
  p('Velvet', 'Pad', 'pad,soft,warm', ext(padBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0.4, 'flt1.cutoff': 1400, 'fx.chorus.on': 1, 'fx.chorus.mix': 0.35,
  }));
  p('Cathedral', 'Pad', 'pad,choir,huge,ambient', ext(padBase, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.3, 'osc1.uni': 5, 'osc1.detune': 20,
    'env1.a': 1.6, 'env1.r': 3.5, 'fx.reverb.mix': 0.55, 'fx.reverb.size': 1, 'fx.reverb.decay': 6,
  }), [['lfo1', 'osc1.shape', 0.2]]);
  p('Nebula', 'Pad', 'pad,ambient,evolving,motion', ext(padBase, {
    'osc1.wave': 'digital', 'osc1.shape': 0.2,
    'osc2.on': 1, 'osc2.wave': 'glass', 'osc2.shape': 0.5, 'osc2.oct': 1, 'osc2.level': 0.4, 'osc2.uni': 3, 'osc2.detune': 14,
    'lfo1.rate': 0.07, 'lfo2.rate': 0.05, 'env1.a': 1.8, 'env1.r': 3,
    'fx.reverb.mix': 0.5, 'fx.reverb.size': 0.95, 'fx.delay.on': 1, 'fx.delay.div': '1_2', 'fx.delay.mix': 0.25, 'fx.delay.fb': 0.5,
  }), [['lfo1', 'osc1.shape', 0.5], ['lfo2', 'osc2.shape', 0.45], ['lfo1', 'pan', 0.35]]);
  p('Halogen', 'Pad', 'pad,bright,shimmer', ext(padBase, {
    'osc1.wave': 'glass', 'osc1.shape': 0.6, 'flt1.cutoff': 6500,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.oct': 1, 'osc2.level': 0.3,
    'fx.reverb.mix': 0.42,
  }));
  p('Undertow', 'Pad', 'pad,dark,low,ominous', ext(padBase, {
    'osc1.wave': 'growl', 'osc1.shape': 0.2, 'osc1.oct': -1, 'flt1.cutoff': 700, 'flt1.res': 0.3,
    'mix.sub': 0.4, 'fx.reverb.mix': 0.4, 'fx.drive.on': 1, 'fx.drive.amount': 0.2,
  }), [['lfo2', 'flt1.cutoff', 0.28]]);
  p('Aurora', 'Pad', 'pad,shimmer,motion,ambient', ext(padBase, {
    'osc1.wave': 'string', 'osc1.shape': 0.5, 'osc1.uni': 6, 'osc1.detune': 24,
    'lfo1.rate': 0.11, 'lfo1.shape': 'sine',
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.4, 'fx.reverb.mix': 0.48, 'fx.reverb.size': 0.92,
  }), [['lfo1', 'flt1.cutoff', 0.35], ['lfo2', 'pan', 0.4]]);
  p('Slow Bloom', 'Pad', 'pad,swell,slow', ext(padBase, {
    'env1.a': 3, 'env1.d': 4, 'env1.r': 4, 'env2.a': 2.5, 'flt1.env': 0.6, 'flt1.cutoff': 700,
    'fx.reverb.mix': 0.45,
  }));
  p('Fifth Pad', 'Pad', 'pad,fifths,wide', ext(padBase, {
    'osc2.on': 1, 'osc2.wave': 'supersaw', 'osc2.shape': 0.3, 'osc2.semi': 7, 'osc2.level': 0.5,
    'osc2.uni': 3, 'osc2.detune': 14,
  }));
  p('Octave Pad', 'Pad', 'pad,octaves,full', ext(padBase, {
    'osc2.on': 1, 'osc2.wave': 'supersaw', 'osc2.oct': -1, 'osc2.level': 0.55, 'osc2.uni': 3,
    'mix.sub': 0.25,
  }));
  p('Breath Pad', 'Pad', 'pad,noise,airy', ext(padBase, {
    'mix.noise': 0.22, 'mix.noiseType': 'pink', 'mix.noiseFlt': 0.6,
    'flt1.cutoff': 3200, 'fx.reverb.mix': 0.42,
  }), [['lfo1', 'mix.noise', 0.3]]);
  p('Comb Pad', 'Pad', 'pad,comb,metallic,motion', ext(padBase, {
    'flt1.model': 'comb', 'flt1.cutoff': 340, 'flt1.res': 0.6, 'lfo1.rate': 0.16,
    'fx.reverb.mix': 0.4,
  }), [['lfo1', 'flt1.cutoff', 0.4]]);
  p('Whale Song', 'Pad', 'pad,ambient,slow,evolving', ext(padBase, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.6, 'env1.a': 2.4, 'env1.r': 4,
    'lfo1.rate': 0.06, 'voice.mode': 'legato', 'voice.glide': 0.6,
    'fx.reverb.mix': 0.55, 'fx.reverb.size': 1, 'fx.delay.on': 1, 'fx.delay.div': '1_2d', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.55,
  }), [['lfo1', 'pitch', 0.03], ['lfo1', 'osc1.shape', 0.4]]);
  p('Tape Pad', 'Pad', 'pad,lofi,warm,wobble', ext(padBase, {
    'voice.drift': 0.6, 'flt1.cutoff': 1800, 'lfo1.rate': 0.9, 'lfo1.shape': 'smooth',
    'fx.eq.high': -4, 'fx.eq.low': 2, 'fx.reverb.mix': 0.34,
  }), [['lfo1', 'pitch', 0.025]]);
  p('Reso Pad', 'Pad', 'pad,resonant,sweep', ext(padBase, {
    'flt1.model': 'ladder4', 'flt1.res': 0.6, 'flt1.cutoff': 800, 'flt1.env': 0.6,
    'env2.a': 1.4, 'env2.d': 2.5, 'env2.s': 0.4,
  }), [['lfo2', 'flt1.cutoff', 0.3]]);
  p('Air Pad', 'Pad', 'pad,thin,high,ambient', ext(padBase, {
    'osc1.oct': 1, 'flt2.model': 'svfHP', 'flt2.cutoff': 700, 'flt1.cutoff': 8000,
    'fx.reverb.mix': 0.5, 'fx.width': 1.4,
  }));

  /* ═══════════════════════════════════════════════════════════════════════
     BASS
     ═══════════════════════════════════════════════════════════════════════ */

  const bassBase = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.level': 0.85,
    'mix.sub': 0.55,
    'flt1.model': 'ladder4', 'flt1.cutoff': 700, 'flt1.res': 0.3, 'flt1.env': 0.6, 'flt1.keytrack': 0.25,
    'env1.a': 0.003, 'env1.d': 0.4, 'env1.s': 0.5, 'env1.r': 0.15,
    'env2.a': 0.001, 'env2.d': 0.24, 'env2.s': 0.05,
    'voice.mode': 'mono', 'voice.poly': 1, 'voice.velAmt': 0.5,
  };
  p('Deep Sub', 'Bass', 'bass,sub,clean', ext(bassBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'mix.sub': 0.85, 'flt1.cutoff': 260, 'flt1.env': 0.2,
  }));
  p('Punch Bass', 'Bass', 'bass,punchy,tight', ext(bassBase, { 'env1.d': 0.22, 'env1.s': 0.35, 'flt1.env': 0.75 }));
  p('Growl Bass', 'Bass', 'bass,growl,dirty', ext(bassBase, {
    'osc1.wave': 'growl', 'osc1.shape': 0.35, 'flt1.drive': 0.6, 'flt1.res': 0.45,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.4,
  }));
  p('Pluck Bass', 'Bass', 'bass,pluck,short', ext(bassBase, {
    'env1.d': 0.16, 'env1.s': 0, 'env1.r': 0.12, 'env2.d': 0.1, 'flt1.res': 0.5,
  }));
  p('FM Sub Bass', 'Bass', 'bass,fm,deep', ext(bassBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 12,
    'osc2.level': 0, 'mix.fm': 0.28, 'flt1.cutoff': 900,
  }), [['env3', 'mix.fm', 0.4]]);
  p('Saw Bass', 'Bass', 'bass,saw,classic', ext(bassBase, { 'osc1.wave': 'classic', 'osc1.shape': 0.667 }));
  p('Square Bass', 'Bass', 'bass,square,hollow', ext(bassBase, { 'osc1.wave': 'classic', 'osc1.shape': 1, 'mix.sub': 0.7 }));
  p('Wide Bass', 'Bass', 'bass,wide,poly', ext(bassBase, {
    'voice.mode': 'poly', 'voice.poly': 4, 'osc1.uni': 3, 'osc1.detune': 12, 'osc1.width': 0.5,
    'flt1.cutoff': 900,
  }));
  p('Rezo Bass', 'Bass', 'bass,resonant,squelch', ext(bassBase, {
    'flt1.res': 0.72, 'flt1.env': 0.8, 'flt1.cutoff': 400, 'voice.glide': 0.03,
  }));
  p('Comb Bass', 'Bass', 'bass,comb,plucked', ext(bassBase, {
    'flt1.model': 'comb', 'flt1.cutoff': 160, 'flt1.res': 0.7, 'mix.noise': 0.3,
    'env1.d': 0.5, 'env1.s': 0.1,
  }));
  p('Organ Bass', 'Bass', 'bass,organ,smooth', ext(bassBase, {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.2, 'env1.a': 0.005, 'env1.d': 0.1, 'env1.s': 0.9, 'env1.r': 0.08,
    'flt1.env': 0.2, 'flt1.cutoff': 1200,
  }));
  p('Bowed Bass', 'Bass', 'bass,bowed,legato', ext(bassBase, {
    'osc1.wave': 'string', 'osc1.shape': 0.3, 'voice.mode': 'legato', 'voice.glide': 0.06,
    'env1.a': 0.12, 'env1.s': 0.8, 'env1.r': 0.3, 'flt1.env': 0.3, 'flt1.cutoff': 1100,
  }));
  p('Dirty DX Bass', 'Bass', 'bass,fm,dirty,aggressive', ext(bassBase, {
    'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 7, 'osc2.level': 0, 'mix.fm': 0.55,
    'flt1.drive': 0.7, 'fx.drive.on': 1, 'fx.drive.type': 'diode', 'fx.drive.amount': 0.45,
  }), [['env3', 'mix.fm', 0.5]]);
  p('Moog Octave Bass', 'Bass', 'bass,octave,fat', ext(bassBase, {
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.oct': -1, 'osc2.level': 0.75,
    'flt1.cutoff': 620, 'flt1.drive': 0.4, 'voice.drift': 0.3,
  }));
  p('Slap Bass', 'Bass', 'bass,slap,funk,perc', ext(bassBase, {
    'mix.noise': 0.35, 'mix.noiseFlt': 0.9, 'flt1.res': 0.55, 'flt1.env': 0.85,
    'env1.d': 0.28, 'env1.s': 0.2, 'env2.d': 0.06, 'flt1.vel': 0.6, 'voice.velAmt': 0.8,
  }));
  p('Distort Bass', 'Bass', 'bass,distorted,heavy', ext(bassBase, {
    'osc1.uni': 2, 'osc1.detune': 14, 'flt1.drive': 0.8,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.55, 'fx.drive.tone': 0.35,
    'fx.comp.on': 1, 'fx.comp.thresh': -18, 'fx.comp.ratio': 8,
  }));

  /* ═══════════════════════════════════════════════════════════════════════
     LEADS
     ═══════════════════════════════════════════════════════════════════════ */

  const leadBase = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 9,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2800, 'flt1.res': 0.25, 'flt1.env': 0.4, 'flt1.keytrack': 0.4,
    'env1.a': 0.005, 'env1.d': 0.6, 'env1.s': 0.8, 'env1.r': 0.25,
    'env2.a': 0.003, 'env2.d': 0.4, 'env2.s': 0.4,
    'voice.mode': 'mono', 'voice.glide': 0.03, 'voice.drift': 0.2,
    'lfo1.rate': 5.2, 'lfo1.delay': 0.35, 'lfo1.fade': 0.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  };
  const vib = [['lfo1', 'pitch', 0.018], ['mw', 'lfo1.depth', 1]];
  p('Singing Lead', 'Lead', 'lead,mono,expressive,vibrato', leadBase, vib);
  p('Soft Lead', 'Lead', 'lead,soft,round', ext(leadBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'flt1.cutoff': 1600, 'env1.a': 0.05,
  }), vib);
  p('Bright Lead', 'Lead', 'lead,bright,cutting', ext(leadBase, {
    'flt1.cutoff': 6000, 'flt1.res': 0.2, 'osc1.uni': 3, 'osc1.detune': 14,
  }), vib);
  p('Sync Lead', 'Lead', 'lead,sync,aggressive', ext(leadBase, {
    'osc2.on': 1, 'osc2.wave': 'sync', 'osc2.shape': 0.3, 'osc2.sync': 1, 'osc2.semi': 7, 'osc2.level': 0.8,
    'osc1.level': 0.4, 'flt1.cutoff': 4000,
  }), [['env3', 'osc2.fine', 0.4], ['mw', 'osc2.fine', 0.5]]);
  p('Square Lead', 'Lead', 'lead,square,hollow', ext(leadBase, {
    'osc1.wave': 'classic', 'osc1.shape': 1, 'mix.sub': 0.3,
  }), vib);
  p('PWM Lead', 'Lead', 'lead,pwm,moving', ext(leadBase, {
    'osc1.wave': 'pulse', 'osc1.pw': 0.4, 'lfo2.rate': 0.6,
  }), [['lfo2', 'osc1.pw', 0.35]].concat(vib));
  p('Whistle Lead', 'Lead', 'lead,sine,pure,whistle', ext(leadBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.uni': 1, 'flt1.model': 'bypass',
    'env1.a': 0.03, 'env1.r': 0.2, 'fx.reverb.mix': 0.3, 'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.2,
  }), vib);
  p('Flute Lead', 'Lead', 'lead,flute,breath', ext(leadBase, {
    'osc1.wave': 'reed', 'osc1.shape': 0.15, 'mix.noise': 0.12, 'mix.noiseFlt': 0.55,
    'env1.a': 0.07, 'flt1.cutoff': 2200, 'voice.mode': 'legato', 'voice.glide': 0.05,
  }), [['lfo1', 'pitch', 0.014], ['at', 'mix.noise', 0.4], ['mw', 'lfo1.depth', 1]]);
  p('Reed Lead', 'Lead', 'lead,reed,woody', ext(leadBase, {
    'osc1.wave': 'reed', 'osc1.shape': 0.6, 'flt1.cutoff': 2400, 'flt1.res': 0.3,
  }), vib);
  p('Trumpet Lead', 'Lead', 'lead,brass,trumpet', ext(leadBase, {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'flt1.cutoff': 1200, 'flt1.env': 0.8,
    'env2.a': 0.04, 'env2.d': 0.35, 'env2.s': 0.55, 'env1.a': 0.03,
    'mix.noise': 0.05,
  }), [['at', 'flt1.cutoff', 0.35]].concat(vib));
  p('Fifth Lead', 'Lead', 'lead,fifths,big', ext(leadBase, {
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.semi': 7, 'osc2.level': 0.6,
  }), vib);
  p('Octave Lead', 'Lead', 'lead,octaves,thick', ext(leadBase, {
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.oct': 1, 'osc2.level': 0.45,
    'mix.sub': 0.3,
  }), vib);
  p('Detuned Lead', 'Lead', 'lead,detuned,wide', ext(leadBase, {
    'osc1.uni': 5, 'osc1.detune': 24, 'osc1.width': 0.8, 'voice.mode': 'poly', 'voice.poly': 4,
  }));
  p('Screaming Lead', 'Lead', 'lead,harsh,distorted', ext(leadBase, {
    'flt1.model': 'diode', 'flt1.res': 0.7, 'flt1.drive': 0.7, 'flt1.cutoff': 2200,
    'fx.drive.on': 1, 'fx.drive.type': 'diode', 'fx.drive.amount': 0.5,
  }), vib);
  p('Glass Lead', 'Lead', 'lead,glass,bright,digital', ext(leadBase, {
    'osc1.wave': 'glass', 'osc1.shape': 0.4, 'flt1.cutoff': 7000,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.25, 'fx.reverb.mix': 0.3,
  }), vib);
  p('Portamento Lead', 'Lead', 'lead,glide,smooth', ext(leadBase, {
    'voice.mode': 'legato', 'voice.glide': 0.14, 'voice.glideAuto': 1,
  }), vib);
  p('Vocal Lead', 'Lead', 'lead,vocal,formant', ext(leadBase, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.3, 'flt1.model': 'formant', 'flt1.cutoff': 700, 'flt1.res': 0.5,
  }), [['mw', 'flt1.cutoff', 0.8], ['lfo1', 'pitch', 0.016]],
    ['Vowel', 'Vibrato', 'Wave Vowel', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);

  /* ═══════════════════════════════════════════════════════════════════════
     KEYS & PLUCKS
     ═══════════════════════════════════════════════════════════════════════ */

  p('Soft E-Piano', 'Keys', 'keys,epiano,soft', ext(fmBase, {
    'osc2.semi': 12, 'mix.fm': 0.24, 'env1.d': 2, 'env1.s': 0.15, 'env1.r': 0.7,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.28, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  }), [['vel', 'mix.fm', 0.4], ['env3', 'mix.fm', 0.35]]);
  p('Bright E-Piano', 'Keys', 'keys,epiano,bright', ext(fmBase, {
    'osc2.semi': 19, 'mix.fm': 0.4, 'env1.d': 1.6, 'env1.s': 0.12, 'env1.r': 0.5,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.35, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }), [['vel', 'mix.fm', 0.5], ['env3', 'mix.fm', 0.4]]);
  p('Wurly', 'Keys', 'keys,wurlitzer,vintage', ext(fmBase, {
    'osc1.wave': 'classic', 'osc1.shape': 0.2, 'osc2.semi': 12, 'mix.fm': 0.3,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3200, 'env1.d': 1.4, 'env1.s': 0.18, 'env1.r': 0.5,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.25,
    'fx.chorus.on': 1, 'fx.chorus.rate': 5, 'fx.chorus.depth': 0.3, 'fx.chorus.mix': 0.3,
  }), [['vel', 'mix.fm', 0.45]]);
  p('Toy Piano', 'Keys', 'keys,toy,bell,lofi', {
    'osc1.wave': 'bell', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2200, 'flt1.res': 0.25,
    'env1.a': 0.001, 'env1.d': 0.8, 'env1.s': 0, 'env1.r': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.eq.high': -2,
  });
  p('Music Box', 'Keys', 'keys,bell,delicate', {
    'osc1.wave': 'bell', 'osc1.shape': 0.55, 'osc1.oct': 1,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000,
    'env1.a': 0.001, 'env1.d': 1.6, 'env1.s': 0, 'env1.r': 1.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'fx.reverb.size': 0.8,
  });
  p('Kalimba', 'Keys', 'mallet,pluck,perc', {
    'osc1.wave': 'classic', 'osc1.shape': 0.1, 'osc1.uni': 2, 'osc1.detune': 5,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1400, 'flt1.res': 0.35, 'flt1.keytrack': 0.8,
    'mix.noise': 0.2, 'mix.noiseFlt': 0.8,
    'env1.a': 0.001, 'env1.d': 0.7, 'env1.s': 0, 'env1.r': 0.45,
    'env2.a': 0.001, 'env2.d': 0.06, 'env2.s': 0, 'flt1.env': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  });
  p('Marimba', 'Keys', 'mallet,wood,perc', ext(fmBase, {
    'osc2.semi': 24, 'mix.fm': 0.22, 'env1.a': 0.001, 'env1.d': 0.55, 'env1.s': 0, 'env1.r': 0.4,
    'env3.d': 0.08, 'env3.s': 0, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.25,
  }), [['env3', 'mix.fm', 0.5]]);
  p('Vibraphone', 'Keys', 'mallet,vibes,tremolo', ext(fmBase, {
    'osc2.semi': 12, 'mix.fm': 0.18, 'env1.a': 0.002, 'env1.d': 2.4, 'env1.s': 0, 'env1.r': 1.6,
    'lfo1.rate': 5.4, 'lfo1.mode': 'free',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }), [['lfo1', 'amp', 0.3], ['env3', 'mix.fm', 0.3]]);
  p('Harpsichord', 'Keys', 'keys,pluck,baroque', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.22, 'osc1.uni': 2, 'osc1.detune': 6,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2600, 'flt1.res': 0.3, 'flt1.keytrack': 0.7,
    'env1.a': 0.001, 'env1.d': 0.9, 'env1.s': 0, 'env1.r': 0.25,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24, 'voice.velAmt': 0.3,
  });
  p('Nylon Pluck', 'Pluck', 'pluck,guitar,soft', {
    'osc1.wave': 'string', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 6,
    'flt1.model': 'comb', 'flt1.cutoff': 420, 'flt1.res': 0.62,
    'mix.noise': 0.35, 'mix.noiseFlt': 0.75,
    'env1.a': 0.001, 'env1.d': 0.8, 'env1.s': 0, 'env1.r': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  });
  p('Steel Pluck', 'Pluck', 'pluck,bright,metal', {
    'osc1.wave': 'glass', 'osc1.shape': 0.3,
    'flt1.model': 'svfBP', 'flt1.cutoff': 3000, 'flt1.res': 0.4, 'flt1.env': 0.5,
    'env1.a': 0.001, 'env1.d': 0.45, 'env1.s': 0, 'env1.r': 0.35,
    'env2.a': 0.001, 'env2.d': 0.1, 'env2.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Wide Pluck', 'Pluck', 'pluck,wide,stereo', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 6, 'osc1.detune': 22, 'osc1.width': 1,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1600, 'flt1.res': 0.3, 'flt1.env': 0.65,
    'env1.a': 0.001, 'env1.d': 0.4, 'env1.s': 0, 'env1.r': 0.35,
    'env2.a': 0.001, 'env2.d': 0.2, 'env2.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.pong': 0.8, 'fx.delay.mix': 0.25,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.width': 1.3,
  });
  p('Dark Pluck', 'Pluck', 'pluck,dark,short', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'mix.sub': 0.4,
    'flt1.model': 'ladder4', 'flt1.cutoff': 700, 'flt1.res': 0.45, 'flt1.env': 0.6,
    'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0, 'env1.r': 0.25,
    'env2.a': 0.001, 'env2.d': 0.14, 'env2.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  });
  p('Bell Pluck', 'Pluck', 'pluck,bell,fm', ext(fmBase, {
    'osc2.semi': 19, 'mix.fm': 0.42, 'env1.a': 0.001, 'env1.d': 0.7, 'env1.s': 0, 'env1.r': 0.5,
    'env3.d': 0.14, 'env3.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.2, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }), [['env3', 'mix.fm', 0.6]]);
  p('Koto', 'Pluck', 'pluck,eastern,string', {
    'osc1.wave': 'string', 'osc1.shape': 0.75, 'osc1.uni': 2, 'osc1.detune': 9,
    'flt1.model': 'comb', 'flt1.cutoff': 300, 'flt1.res': 0.7, 'mix.noise': 0.4,
    'env1.a': 0.001, 'env1.d': 1.1, 'env1.s': 0, 'env1.r': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });

  /* ═══════════════════════════════════════════════════════════════════════
     MOTION — patches built around the step lanes
     ═══════════════════════════════════════════════════════════════════════ */

  p('Step Filter', 'Motion', 'motion,sequence,filter,rhythmic', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 4, 'osc1.detune': 18,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.5,
    'env1.a': 0.01, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 0.4,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.steps': 16, 'mot1.slew': 0.02,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }, [['mot1', 'flt1.cutoff', 0.8]], ['Brightness', 'Step Depth', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'],
    [MOT.stab, MOT.rise]);
  p('Trance Gate', 'Motion', 'motion,gate,rhythmic,pad', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.15, 'osc1.uni': 6, 'osc1.detune': 24,
    'flt1.model': 'svfLP', 'flt1.cutoff': 6000,
    'env1.a': 0.3, 'env1.d': 1.4, 'env1.s': 0.9, 'env1.r': 0.8,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.015, 'mot1.steps': 16,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.18,
  }, [['mot1', 'amp', 0.9, 1]], ['Brightness', 'Gate Depth', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'],
    [MOT.gate, MOT.pump]);
  p('Pitch Steps', 'Motion', 'motion,sequence,pitch,arp', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.35, 'mix.sub': 0.4,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1800, 'flt1.res': 0.35, 'flt1.env': 0.4,
    'env1.a': 0.001, 'env1.d': 0.2, 'env1.s': 0.4, 'env1.r': 0.1,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.steps': 16, 'mot1.slew': 0,
    'voice.mode': 'mono',
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.24, 'fx.delay.fb': 0.4,
  }, [['mot1', 'pitch', 0.5]], ['Brightness', 'Step Range', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'],
    [MOT.arp, MOT.stair]);
  p('Dual Motion', 'Motion', 'motion,complex,evolving', {
    'osc1.wave': 'digital', 'osc1.shape': 0.3, 'osc1.uni': 3, 'osc1.detune': 14,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1200, 'flt1.res': 0.55,
    'env1.a': 0.02, 'env1.d': 1.2, 'env1.s': 0.8, 'env1.r': 0.6,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot2.on': 1, 'mot2.div': '1_8t', 'mot2.slew': 0.25,
    'fx.delay.on': 1, 'fx.delay.div': '1_8t', 'fx.delay.mix': 0.24,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['mot1', 'flt1.cutoff', 0.7], ['mot2', 'osc1.shape', 0.6], ['mot2', 'pan', 0.5]],
    null, [MOT.chaos, MOT.trip]);
  p('Rhythmic Pan', 'Motion', 'motion,pan,stereo,rhythmic', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.25, 'osc1.uni': 4, 'osc1.detune': 18,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4000,
    'env1.a': 0.02, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 0.5,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.1,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28, 'fx.width': 1.3,
  }, [['mot1', 'pan', 0.9]], null, [MOT.trip, MOT.gate]);
  p('Wobble Motion', 'Motion', 'motion,bass,wobble,dubstep', {
    'osc1.wave': 'growl', 'osc1.shape': 0.3, 'osc1.uni': 2, 'osc1.detune': 34,
    'mix.sub': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 400, 'flt1.res': 0.7, 'flt1.drive': 0.5,
    'env1.a': 0.005, 'env1.d': 1, 'env1.s': 0.9, 'env1.r': 0.2,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.3,
    'voice.mode': 'mono',
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.4,
  }, [['mot1', 'flt1.cutoff', 0.9]], null, [MOT.pump, MOT.chaos]);
  p('Stutter Amp', 'Motion', 'motion,stutter,glitch', {
    'osc1.wave': 'classic', 'osc1.shape': 0.667, 'osc1.uni': 3, 'osc1.detune': 14,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3000, 'flt1.res': 0.2,
    'env1.a': 0.01, 'env1.d': 1, 'env1.s': 0.9, 'env1.r': 0.3,
    'mot1.on': 1, 'mot1.div': '1_32', 'mot1.slew': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.24, 'fx.delay.fb': 0.45,
  }, [['mot1', 'amp', 0.9, 1]], null, [MOT.gate, MOT.chaos]);
  p('Evolving Texture', 'Motion', 'motion,ambient,evolving,slow', {
    'osc1.wave': 'noise', 'osc1.shape': 0.3, 'osc1.uni': 3, 'osc1.detune': 20,
    'osc2.on': 1, 'osc2.wave': 'glass', 'osc2.shape': 0.4, 'osc2.level': 0.4, 'osc2.oct': 1,
    'flt1.model': 'svfBP', 'flt1.cutoff': 900, 'flt1.res': 0.5,
    'env1.a': 1.6, 'env1.d': 3, 'env1.s': 0.85, 'env1.r': 3,
    'mot1.on': 1, 'mot1.div': '1_1', 'mot1.slew': 0.8, 'mot2.on': 1, 'mot2.div': '2n_1', 'mot2.slew': 0.9,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.5, 'fx.reverb.size': 0.95,
    'fx.delay.on': 1, 'fx.delay.div': '1_2d', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.55,
  }, [['mot1', 'flt1.cutoff', 0.6], ['mot2', 'osc2.shape', 0.7], ['mot1', 'pan', 0.4]],
    null, [MOT.rise, MOT.chaos]);

  /* ═══════════════════════════════════════════════════════════════════════
     ARPS
     ═══════════════════════════════════════════════════════════════════════ */

  const arpBase = {
    'arp.on': 1, 'arp.div': '1_16', 'arp.pattern': 'up', 'arp.oct': 2, 'arp.gate': 0.5,
    'env1.a': 0.001, 'env1.d': 0.25, 'env1.s': 0, 'env1.r': 0.2,
    'env2.a': 0.001, 'env2.d': 0.15, 'env2.s': 0,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1800, 'flt1.res': 0.35, 'flt1.env': 0.55,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22, 'fx.delay.fb': 0.4, 'fx.delay.pong': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  };
  p('Classic Arp', 'Arp', 'arp,up,classic', ext(arpBase, {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'mix.sub': 0.4,
  }));
  p('Up-Down Arp', 'Arp', 'arp,updown', ext(arpBase, {
    'arp.pattern': 'updown', 'osc1.wave': 'pulse', 'osc1.pw': 0.35,
  }));
  p('Octave Runner', 'Arp', 'arp,fast,octaves', ext(arpBase, {
    'arp.div': '1_32', 'arp.oct': 3, 'arp.gate': 0.4,
    'osc1.wave': 'classic', 'osc1.shape': 0.667, 'flt1.cutoff': 3000,
  }));
  p('Triplet Arp', 'Arp', 'arp,triplet,swing', ext(arpBase, {
    'arp.div': '1_8t', 'arp.swing': 0.15, 'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 3, 'osc1.detune': 14,
  }));
  p('Ratchet Arp', 'Arp', 'arp,ratchet,rhythmic', ext(arpBase, {
    'arp.ratchet': 3, 'arp.div': '1_8', 'arp.gate': 0.7,
    'osc1.wave': 'growl', 'osc1.shape': 0.3, 'flt1.res': 0.5,
  }));
  p('Random Arp', 'Arp', 'arp,random,generative', ext(arpBase, {
    'arp.pattern': 'random', 'arp.chance': 0.8, 'arp.vel': 'random',
    'osc1.wave': 'bell', 'osc1.shape': 0.4, 'flt1.cutoff': 4000,
  }));
  p('Chord Arp', 'Arp', 'arp,chord,stab', ext(arpBase, {
    'arp.pattern': 'chord', 'arp.div': '1_8', 'arp.gate': 0.45,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 5, 'osc1.detune': 20,
  }));
  p('Bass Arp', 'Arp', 'arp,bass,low', ext(arpBase, {
    'arp.oct': 1, 'arp.gate': 0.6, 'osc1.wave': 'vintage', 'osc1.shape': 0.05,
    'mix.sub': 0.7, 'flt1.cutoff': 800, 'voice.mode': 'mono',
    'fx.delay.mix': 0.12, 'fx.reverb.mix': 0.14,
  }));
  p('Bell Arp', 'Arp', 'arp,bell,sparkle', ext(arpBase, {
    'osc1.wave': 'bell', 'osc1.shape': 0.6, 'osc1.oct': 1, 'flt1.cutoff': 6000,
    'env1.d': 0.6, 'env1.r': 0.5, 'arp.gate': 0.3,
    'fx.delay.mix': 0.3, 'fx.reverb.mix': 0.35,
  }));
  p('Acid Arp', 'Arp', 'arp,acid,303', ext(arpBase, {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05,
    'flt1.model': 'diode', 'flt1.cutoff': 500, 'flt1.res': 0.78, 'flt1.env': 0.85, 'flt1.drive': 0.5,
    'arp.gate': 0.45, 'voice.mode': 'mono', 'voice.glide': 0.02,
    'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.35,
  }));
  p('Converge Arp', 'Arp', 'arp,converge,pattern', ext(arpBase, {
    'arp.pattern': 'converge', 'arp.oct': 2, 'osc1.wave': 'glass', 'osc1.shape': 0.3,
  }));
  p('Thumb Arp', 'Arp', 'arp,thumb,bass-note', ext(arpBase, {
    'arp.pattern': 'thumb', 'osc1.wave': 'pulse', 'osc1.pw': 0.4, 'mix.sub': 0.35,
  }));
  p('Swung Arp', 'Arp', 'arp,swing,groove', ext(arpBase, {
    'arp.swing': 0.4, 'arp.vel': 'accent', 'osc1.wave': 'vintage', 'osc1.shape': 0.05,
  }));
  p('Latched Arp', 'Arp', 'arp,latch,hands-free', ext(arpBase, {
    'arp.latch': 1, 'arp.pattern': 'updown', 'arp.oct': 3,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.25, 'osc1.uni': 4, 'osc1.detune': 18,
  }));
  p('Motion Arp', 'Arp', 'arp,motion,filtered', ext(arpBase, {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 4, 'osc1.detune': 16,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.slew': 0.05, 'flt1.cutoff': 1000, 'flt1.res': 0.5,
  }, [['mot1', 'flt1.cutoff', 0.7]]), null, null);

  /* ═══════════════════════════════════════════════════════════════════════
     FX & ATMOSPHERES
     ═══════════════════════════════════════════════════════════════════════ */

  p('Riser', 'FX', 'fx,riser,transition', {
    'osc1.wave': 'noise', 'osc1.shape': 0.5, 'osc1.uni': 5, 'osc1.detune': 40,
    'flt1.model': 'svfBP', 'flt1.cutoff': 400, 'flt1.res': 0.6,
    'env1.a': 0.05, 'env1.d': 8, 'env1.s': 1, 'env1.r': 0.4,
    'env2.a': 6, 'env2.d': 2, 'env2.s': 1, 'flt1.env': 0.9,
    'lfo1.rate': 6, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.4,
  }, [['env2', 'pitch', 0.3], ['lfo1', 'pitch', 0.02], ['env2', 'lfo1.rate', 0.5]]);
  p('Downlifter', 'FX', 'fx,fall,transition', {
    'osc1.wave': 'noise', 'osc1.shape': 0.3, 'osc1.uni': 4, 'osc1.detune': 35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000, 'flt1.res': 0.4,
    'env1.a': 0.002, 'env1.d': 4, 'env1.s': 0, 'env1.r': 1,
    'env3.a': 0.001, 'env3.d': 3, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.4,
  }, [['env3', 'pitch', -0.5], ['env3', 'flt1.cutoff', 0.6]]);
  p('Impact', 'FX', 'fx,hit,impact', {
    'osc1.wave': 'noise', 'osc1.shape': 0.1, 'osc1.oct': -2, 'osc1.uni': 3,
    'mix.sub': 0.7,
    'flt1.model': 'ladder4', 'flt1.cutoff': 600, 'flt1.res': 0.3, 'flt1.drive': 0.6,
    'env1.a': 0.001, 'env1.d': 2.5, 'env1.s': 0, 'env1.r': 1.6,
    'env3.a': 0.001, 'env3.d': 0.4, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.45, 'fx.reverb.size': 0.9,
  }, [['env3', 'pitch', -0.35], ['env3', 'flt1.cutoff', 0.6]]);
  p('Alien Drone', 'FX', 'fx,drone,ambient,dark', {
    'osc1.wave': 'formant', 'osc1.shape': 0.2, 'osc1.uni': 3, 'osc1.detune': 22,
    'osc2.on': 1, 'osc2.wave': 'growl', 'osc2.shape': 0.4, 'osc2.semi': -5, 'osc2.level': 0.5,
    'mix.ring': 0.25,
    'flt1.model': 'formant', 'flt1.cutoff': 400, 'flt1.res': 0.7,
    'env1.a': 1.5, 'env1.d': 3, 'env1.s': 0.9, 'env1.r': 3,
    'lfo1.rate': 0.09, 'lfo2.rate': 0.13,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.55, 'fx.reverb.size': 1,
    'fx.delay.on': 1, 'fx.delay.div': '1_2', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.6,
  }, [['lfo1', 'flt1.cutoff', 0.5], ['lfo2', 'mix.ring', 0.4], ['lfo1', 'pan', 0.4]]);
  p('Siren', 'FX', 'fx,siren,alarm', {
    'osc1.wave': 'classic', 'osc1.shape': 0.667, 'osc1.uni': 2, 'osc1.detune': 12,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3000, 'flt1.res': 0.4,
    'env1.a': 0.05, 'env1.d': 1, 'env1.s': 1, 'env1.r': 0.4,
    'lfo1.rate': 0.5, 'lfo1.shape': 'tri', 'lfo1.mode': 'free',
    'voice.mode': 'mono',
  }, [['lfo1', 'pitch', 0.35], ['m2', 'lfo1.rate', 0.8]]);
  p('Static Wash', 'FX', 'fx,noise,texture,ambient', {
    'osc1.wave': 'noise', 'osc1.shape': 0.6, 'osc1.uni': 6, 'osc1.detune': 50, 'osc1.width': 1,
    'mix.noise': 0.3, 'mix.noiseType': 'pink',
    'flt1.model': 'svfBP', 'flt1.cutoff': 1400, 'flt1.res': 0.4,
    'env1.a': 2, 'env1.d': 3, 'env1.s': 0.85, 'env1.r': 2.5,
    'lfo1.rate': 0.08, 'lfo2.rate': 0.05,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.5, 'fx.reverb.size': 0.95,
  }, [['lfo1', 'flt1.cutoff', 0.5], ['lfo2', 'pan', 0.5]]);
  p('Metallic Scrape', 'FX', 'fx,metal,ring,harsh', {
    'osc1.wave': 'bell', 'osc1.shape': 0.8, 'osc1.uni': 3, 'osc1.detune': 30,
    'osc2.on': 1, 'osc2.wave': 'glass', 'osc2.shape': 0.7, 'osc2.semi': 6, 'osc2.level': 0.5,
    'mix.ring': 0.7,
    'flt1.model': 'comb', 'flt1.cutoff': 700, 'flt1.res': 0.75,
    'env1.a': 0.01, 'env1.d': 2, 'env1.s': 0.4, 'env1.r': 1.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.45,
  }, [['lfo1', 'flt1.cutoff', 0.4]]);
  p('Sub Drop', 'FX', 'fx,drop,sub,transition', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'mix.sub': 0.8,
    'flt1.model': 'svfLP', 'flt1.cutoff': 300,
    'env1.a': 0.002, 'env1.d': 3, 'env1.s': 0, 'env1.r': 1,
    'env3.a': 0.001, 'env3.d': 2.6, 'env3.s': 0,
    'voice.mode': 'mono', 'fx.comp.on': 1, 'fx.comp.thresh': -14, 'fx.comp.ratio': 8,
  }, [['env3', 'pitch', -0.7]]);
  p('Reverse Swell', 'FX', 'fx,reverse,swell,ambient', {
    'osc1.wave': 'glass', 'osc1.shape': 0.4, 'osc1.uni': 4, 'osc1.detune': 24,
    'flt1.model': 'svfLP', 'flt1.cutoff': 1000, 'flt1.env': 0.8,
    'env1.a': 2.2, 'env1.d': 0.12, 'env1.s': 0, 'env1.r': 0.4,
    'env2.a': 2, 'env2.d': 0.2, 'env2.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.5, 'fx.reverb.size': 0.9,
  });

  /* Registers the bank with the app. js/patches-extra.js adds to the same
     bank through these, so the two files stay one library. */
  MS.FACTORY_PATCHES = BANK;
  MS.MOTION_SHAPES = MOT;
  MS.definePatch = p;
  MS.patchExtend = ext;

  /** Random but musical matrix rows, used by the dice button. */
  MS.randomMatrix = function () {
    const srcs = ['lfo1', 'lfo2', 'env3', 'vel', 'mw', 'at', 'keytrack', 'rand'];
    const dsts = ['flt1.cutoff', 'osc1.shape', 'osc1.pw', 'pitch', 'mix.fm', 'pan',
                  'osc1.detune', 'flt1.res', 'amp', 'mix.ring'];
    const rows = [];
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const src = srcs[(Math.random() * srcs.length) | 0];
      const dst = dsts[(Math.random() * dsts.length) | 0];
      let amt = (Math.random() * 0.7 + 0.1) * (Math.random() < 0.3 ? -1 : 1);
      if (dst === 'pitch') amt *= 0.08;               // a semitone or two, not an octave
      if (dst === 'amp') amt = Math.abs(amt) * 0.4;
      rows.push([src, dst, amt, 0]);
    }
    // Always leave the four standard macros wired.
    rows.push(['m1', 'flt1.cutoff', 0.6]);
    rows.push(['m2', 'osc1.detune', 0.5]);
    rows.push(['m3', 'osc1.shape', 0.45]);
    rows.push(['m4', 'fx.reverb.mix', 0.5]);
    return rows;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
