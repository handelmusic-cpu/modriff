/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — factory patch banks, part two
   ───────────────────────────────────────────────────────────────────────────
   Adds to the same library as js/patches.js through MS.definePatch, split
   only so neither file becomes unreadable. Same rules apply: sparse values,
   families derived from a shared base, and four working macros on every
   sound (filled in automatically when a patch doesn't wire its own).

   Load order matters — js/patches.js must run first.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = root.MS;
  if (!MS || !MS.definePatch) throw new Error('patches-extra.js: load js/patches.js first');
  const p = MS.definePatch;
  const ext = MS.patchExtend;
  const MOT = MS.MOTION_SHAPES;

  /* ═══════════════════════════════════════════════════════════════════════
     BRASS
     ═══════════════════════════════════════════════════════════════════════ */
  const brass = {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 10,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.level': 0.6, 'osc2.fine': -9,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.25, 'flt1.env': 0.8, 'flt1.keytrack': 0.35,
    'env1.a': 0.035, 'env1.d': 0.9, 'env1.s': 0.75, 'env1.r': 0.35,
    'env2.a': 0.05, 'env2.d': 0.6, 'env2.s': 0.45, 'env2.r': 0.35,
    'voice.drift': 0.24, 'voice.velAmt': 0.55, 'flt1.vel': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.22,
  };
  p('Brass Section', 'Brass', 'brass,section,ensemble', ext(brass, { 'osc1.uni': 4, 'osc1.detune': 17 }));
  p('Solo Trumpet', 'Brass', 'brass,solo,lead', ext(brass, {
    'osc1.uni': 1, 'osc2.on': 0, 'voice.mode': 'legato', 'voice.glide': 0.04,
    'mix.noise': 0.05, 'flt1.cutoff': 1300, 'lfo1.delay': 0.4, 'lfo1.fade': 0.3, 'lfo1.rate': 5.4,
  }), [['lfo1', 'pitch', 0.016], ['mw', 'lfo1.depth', 1], ['at', 'flt1.cutoff', 0.35]]);
  p('French Horn', 'Brass', 'brass,horn,soft', ext(brass, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'flt1.cutoff': 700, 'flt1.env': 0.55,
    'env1.a': 0.09, 'env2.a': 0.11, 'fx.reverb.mix': 0.32,
  }));
  p('Trombone', 'Brass', 'brass,low,slide', ext(brass, {
    'osc1.oct': -1, 'voice.mode': 'legato', 'voice.glide': 0.09, 'flt1.cutoff': 620,
  }));
  p('Tuba', 'Brass', 'brass,low,bass', ext(brass, {
    'osc1.oct': -2, 'osc2.oct': -2, 'mix.sub': 0.4, 'flt1.cutoff': 400,
    'env1.a': 0.05, 'voice.mode': 'mono',
  }));
  p('Synth Brass 1', 'Brass', 'brass,synth,poly', ext(brass, {
    'osc2.wave': 'pulse', 'osc2.pw': 0.4, 'flt1.cutoff': 1100, 'flt1.res': 0.32,
  }));
  p('Synth Brass 2', 'Brass', 'brass,synth,bright', ext(brass, {
    'osc1.uni': 3, 'osc1.detune': 14, 'flt1.cutoff': 1500, 'flt1.env': 0.7, 'flt1.res': 0.4,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.25,
  }));
  p('Stab Brass', 'Brass', 'brass,stab,short', ext(brass, {
    'env1.a': 0.008, 'env1.d': 0.3, 'env1.s': 0, 'env1.r': 0.25,
    'env2.a': 0.006, 'env2.d': 0.2, 'env2.s': 0, 'flt1.env': 0.9,
  }));
  p('Fanfare', 'Brass', 'brass,bright,big', ext(brass, {
    'osc1.uni': 5, 'osc1.detune': 20, 'osc2.semi': 7, 'flt1.cutoff': 1600,
    'fx.reverb.mix': 0.34, 'fx.reverb.size': 0.8,
  }));
  p('Muted Brass', 'Brass', 'brass,muted,thin', ext(brass, {
    'flt1.model': 'svfBP', 'flt1.cutoff': 1300, 'flt1.res': 0.5, 'flt1.env': 0.5,
    'flt2.model': 'svfHP', 'flt2.cutoff': 420,
  }));
  p('Brass Pad', 'Brass', 'brass,pad,sustained', ext(brass, {
    'env1.a': 0.6, 'env1.d': 2, 'env1.s': 0.9, 'env1.r': 1.6,
    'env2.a': 0.5, 'osc1.uni': 4, 'osc1.detune': 18, 'fx.reverb.mix': 0.35,
  }));
  p('Rip Brass', 'Brass', 'brass,rip,expressive', ext(brass, {
    'env3.a': 0.001, 'env3.d': 0.13, 'env3.s': 0, 'voice.mode': 'legato', 'voice.glide': 0.03,
  }), [['env3', 'pitch', -0.09], ['at', 'flt1.cutoff', 0.4]]);

  /* ═══════════════════════════════════════════════════════════════════════
     STRINGS
     ═══════════════════════════════════════════════════════════════════════ */
  const strings = {
    'osc1.wave': 'string', 'osc1.shape': 0.3, 'osc1.uni': 5, 'osc1.detune': 15, 'osc1.width': 0.95,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3600, 'flt1.res': 0.08, 'flt1.env': 0.2,
    'flt2.model': 'svfHP', 'flt2.cutoff': 180,
    'env1.a': 0.2, 'env1.d': 1.6, 'env1.s': 0.9, 'env1.r': 0.9,
    'env2.a': 0.18, 'env2.d': 1.2, 'env2.s': 0.6,
    'voice.drift': 0.3, 'lfo1.rate': 5.2, 'lfo1.delay': 0.5, 'lfo1.fade': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32, 'fx.reverb.size': 0.75,
  };
  const strVib = [['lfo1', 'pitch', 0.012], ['mw', 'lfo1.depth', 1]];
  p('Full Strings', 'Strings', 'strings,ensemble,lush', strings, strVib);
  p('Chamber Strings', 'Strings', 'strings,small,intimate', ext(strings, {
    'osc1.uni': 3, 'osc1.detune': 10, 'fx.reverb.mix': 0.26,
  }), strVib);
  p('Solo Violin', 'Strings', 'strings,solo,expressive', ext(strings, {
    'osc1.uni': 1, 'voice.mode': 'legato', 'voice.glide': 0.05, 'flt1.cutoff': 4200,
    'env1.a': 0.11, 'mix.noise': 0.05, 'mix.noiseFlt': 0.85,
  }), [['lfo1', 'pitch', 0.02], ['mw', 'lfo1.depth', 1], ['at', 'flt1.cutoff', 0.3]]);
  p('Cello', 'Strings', 'strings,low,solo', ext(strings, {
    'osc1.uni': 1, 'osc1.oct': -1, 'voice.mode': 'legato', 'voice.glide': 0.06,
    'flt1.cutoff': 2000, 'env1.a': 0.14,
  }), strVib);
  p('Pizzicato', 'Strings', 'strings,pizz,pluck,short', ext(strings, {
    'env1.a': 0.001, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.25,
    'env2.a': 0.001, 'env2.d': 0.1, 'env2.s': 0, 'flt1.env': 0.6, 'flt1.cutoff': 1400,
    'osc1.uni': 2, 'mix.noise': 0.15, 'fx.reverb.mix': 0.24,
  }));
  p('Tremolo Strings', 'Strings', 'strings,tremolo,tension', ext(strings, {
    'lfo2.rate': 9, 'lfo2.shape': 'tri', 'lfo2.mode': 'free',
  }), [['lfo2', 'amp', 0.45]].concat(strVib));
  p('Staccato Strings', 'Strings', 'strings,short,rhythmic', ext(strings, {
    'env1.a': 0.008, 'env1.d': 0.28, 'env1.s': 0, 'env1.r': 0.18, 'flt1.env': 0.4,
  }));
  p('String Swell', 'Strings', 'strings,swell,cinematic', ext(strings, {
    'env1.a': 1.8, 'env1.d': 2.5, 'env1.r': 2, 'env2.a': 1.6, 'flt1.env': 0.5, 'flt1.cutoff': 1200,
    'fx.reverb.mix': 0.42, 'fx.reverb.size': 0.9,
  }));
  p('Octave Strings', 'Strings', 'strings,octaves,wide', ext(strings, {
    'osc2.on': 1, 'osc2.wave': 'string', 'osc2.shape': 0.4, 'osc2.oct': -1, 'osc2.level': 0.55,
    'osc2.uni': 3, 'osc2.detune': 12,
  }), strVib);
  p('Dark Strings', 'Strings', 'strings,dark,brooding', ext(strings, {
    'flt1.cutoff': 1500, 'osc1.shape': 0.7, 'osc1.oct': -1, 'fx.reverb.mix': 0.38,
  }), strVib);
  p('Harp', 'Strings', 'strings,harp,pluck', {
    'osc1.wave': 'string', 'osc1.shape': 0.15, 'osc1.uni': 2, 'osc1.detune': 5,
    'flt1.model': 'comb', 'flt1.cutoff': 500, 'flt1.res': 0.55, 'mix.noise': 0.25,
    'env1.a': 0.001, 'env1.d': 1.8, 'env1.s': 0, 'env1.r': 1.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.34,
  });
  p('Cinematic Strings', 'Strings', 'strings,epic,cinematic,wide', ext(strings, {
    'osc1.uni': 7, 'osc1.detune': 22, 'osc1.width': 1,
    'osc2.on': 1, 'osc2.wave': 'string', 'osc2.oct': -1, 'osc2.level': 0.5, 'osc2.uni': 4, 'osc2.detune': 18,
    'env1.a': 0.45, 'env1.r': 1.8, 'fx.reverb.mix': 0.45, 'fx.reverb.size': 0.95, 'fx.width': 1.35,
  }), strVib);

  /* ═══════════════════════════════════════════════════════════════════════
     ORGAN
     ═══════════════════════════════════════════════════════════════════════ */
  const organ = {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.4, 'osc1.level': 0.85,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000, 'flt1.env': 0,
    'env1.a': 0.004, 'env1.d': 0.06, 'env1.s': 1, 'env1.r': 0.06,
    'voice.drift': 0.08, 'voice.velAmt': 0.15,
  };
  p('Jazz Organ', 'Organ', 'organ,jazz,warm', ext(organ, {
    'osc1.shape': 0.2, 'fx.chorus.on': 1, 'fx.chorus.rate': 5.8, 'fx.chorus.depth': 0.35, 'fx.chorus.mix': 0.4,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  }));
  p('Gospel Organ', 'Organ', 'organ,gospel,full', ext(organ, {
    'osc1.shape': 0.75, 'fx.drive.on': 1, 'fx.drive.type': 'tube', 'fx.drive.amount': 0.3,
    'fx.chorus.on': 1, 'fx.chorus.rate': 6.4, 'fx.chorus.mix': 0.45,
  }));
  p('Church Organ', 'Organ', 'organ,church,pipe', ext(organ, {
    'osc1.shape': 0.95,
    'osc2.on': 1, 'osc2.wave': 'harmonic', 'osc2.shape': 0.2, 'osc2.oct': 1, 'osc2.level': 0.45,
    'env1.a': 0.05, 'env1.r': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.5, 'fx.reverb.size': 1, 'fx.reverb.decay': 6,
  }));
  p('Farfisa', 'Organ', 'organ,combo,reedy,vintage', ext(organ, {
    'osc1.wave': 'reed', 'osc1.shape': 0.3, 'flt2.model': 'svfHP', 'flt2.cutoff': 300,
    'fx.chorus.on': 1, 'fx.chorus.rate': 6, 'fx.chorus.mix': 0.3,
  }));
  p('Vox Continental', 'Organ', 'organ,combo,vintage', ext(organ, {
    'osc1.shape': 0.6, 'flt1.cutoff': 5000, 'flt2.model': 'svfHP', 'flt2.cutoff': 240,
  }));
  p('Pipe Flute', 'Organ', 'organ,flute,soft', ext(organ, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'mix.noise': 0.07, 'mix.noiseFlt': 0.5,
    'env1.a': 0.04, 'flt1.cutoff': 3400, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.34,
  }));
  p('Reed Organ', 'Organ', 'organ,reed,harmonium', ext(organ, {
    'osc1.wave': 'reed', 'osc1.shape': 0.5, 'osc1.uni': 2, 'osc1.detune': 8,
    'env1.a': 0.06, 'env1.r': 0.15, 'voice.drift': 0.3,
  }));
  p('Rotary Fast', 'Organ', 'organ,rotary,leslie', ext(organ, {
    'osc1.shape': 0.66, 'lfo1.rate': 6.6, 'lfo1.mode': 'free', 'lfo2.rate': 6.9, 'lfo2.mode': 'free',
    'fx.chorus.on': 1, 'fx.chorus.rate': 6.6, 'fx.chorus.depth': 0.6, 'fx.chorus.mix': 0.5,
  }), [['lfo1', 'pan', 0.6], ['lfo2', 'pitch', 0.006], ['m2', 'lfo1.rate', 0.8]]);
  p('Rotary Slow', 'Organ', 'organ,rotary,leslie,slow', ext(organ, {
    'osc1.shape': 0.66, 'lfo1.rate': 0.8, 'lfo1.mode': 'free',
    'fx.chorus.on': 1, 'fx.chorus.rate': 0.9, 'fx.chorus.depth': 0.5, 'fx.chorus.mix': 0.45,
  }), [['lfo1', 'pan', 0.5], ['m2', 'lfo1.rate', 0.9]]);
  p('Dirty Organ', 'Organ', 'organ,distorted,rock', ext(organ, {
    'osc1.shape': 1, 'flt1.model': 'ladder2', 'flt1.drive': 0.6,
    'fx.drive.on': 1, 'fx.drive.type': 'diode', 'fx.drive.amount': 0.55, 'fx.drive.tone': 0.4,
  }));

  /* ═══════════════════════════════════════════════════════════════════════
     AMBIENT
     ═══════════════════════════════════════════════════════════════════════ */
  const amb = {
    'osc1.wave': 'glass', 'osc1.shape': 0.35, 'osc1.uni': 4, 'osc1.detune': 20, 'osc1.width': 1,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3000, 'flt1.res': 0.15,
    'env1.a': 1.6, 'env1.d': 3, 'env1.s': 0.85, 'env1.r': 3.5,
    'env2.a': 1.2, 'env2.d': 2.4, 'env2.s': 0.6,
    'lfo1.rate': 0.08, 'lfo2.rate': 0.05,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.48, 'fx.reverb.size': 0.95, 'fx.reverb.decay': 5,
    'fx.delay.on': 1, 'fx.delay.div': '1_2d', 'fx.delay.mix': 0.26, 'fx.delay.fb': 0.5, 'fx.delay.pong': 0.7,
  };
  p('Deep Space', 'Ambient', 'ambient,pad,slow,huge', amb, [['lfo1', 'flt1.cutoff', 0.3], ['lfo2', 'pan', 0.4]]);
  p('Ice Field', 'Ambient', 'ambient,cold,shimmer', ext(amb, {
    'osc1.oct': 1, 'flt1.cutoff': 6000, 'flt2.model': 'svfHP', 'flt2.cutoff': 500, 'fx.width': 1.4,
  }), [['lfo1', 'osc1.shape', 0.4]]);
  p('Warm Fog', 'Ambient', 'ambient,warm,soft,dark', ext(amb, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'flt1.cutoff': 1000, 'fx.reverb.mix': 0.5,
  }));
  p('Distant Choir', 'Ambient', 'ambient,choir,vocal,far', ext(amb, {
    'osc1.wave': 'vocal', 'osc1.shape': 0.4, 'flt1.cutoff': 2200,
    'fx.reverb.mix': 0.58, 'fx.reverb.size': 1,
  }), [['lfo1', 'osc1.shape', 0.35]]);
  p('Granular Cloud', 'Ambient', 'ambient,texture,granular,motion', ext(amb, {
    'osc1.wave': 'noise', 'osc1.shape': 0.4, 'osc1.uni': 6, 'osc1.detune': 45,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1400, 'flt1.res': 0.5,
    'mot1.on': 1, 'mot1.div': '1_8', 'mot1.slew': 0.5, 'mot2.on': 1, 'mot2.div': '1_4', 'mot2.slew': 0.7,
  }), [['mot1', 'flt1.cutoff', 0.55], ['mot2', 'pan', 0.6], ['lfo1', 'osc1.shape', 0.3]],
    null, [MOT.chaos, MOT.rise]);
  p('Sleep Drone', 'Ambient', 'ambient,drone,minimal', ext(amb, {
    'osc1.wave': 'classic', 'osc1.shape': 0.1, 'osc1.uni': 3, 'osc1.detune': 8,
    'mix.sub': 0.4, 'flt1.cutoff': 800, 'env1.a': 3, 'env1.r': 5,
    'fx.delay.mix': 0.18,
  }));
  p('Shimmer Pad', 'Ambient', 'ambient,shimmer,bright,octave', ext(amb, {
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.shape': 0.5, 'osc2.oct': 2, 'osc2.level': 0.3, 'osc2.uni': 2,
    'fx.reverb.mix': 0.55,
  }), [['lfo1', 'osc2.level', 0.3]]);
  p('Rain Texture', 'Ambient', 'ambient,noise,texture,rain', ext(amb, {
    'osc1.level': 0.2, 'mix.noise': 0.6, 'mix.noiseType': 'crackle', 'mix.noiseFlt': 0.7,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2600, 'flt1.res': 0.3,
    'env1.a': 0.6, 'env1.s': 0.9,
  }), [['lfo1', 'flt1.cutoff', 0.4], ['lfo2', 'mix.noise', 0.25]]);
  p('Underwater', 'Ambient', 'ambient,dark,filtered,wobble', ext(amb, {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'flt1.model': 'ladder4', 'flt1.cutoff': 500, 'flt1.res': 0.4,
    'lfo1.rate': 0.35, 'fx.reverb.mix': 0.45,
  }), [['lfo1', 'flt1.cutoff', 0.45], ['lfo2', 'pitch', 0.014]]);
  p('Bowed Metal', 'Ambient', 'ambient,metal,drone,eerie', ext(amb, {
    'osc1.wave': 'bell', 'osc1.shape': 0.7, 'osc1.uni': 3, 'osc1.detune': 26,
    'flt1.model': 'comb', 'flt1.cutoff': 600, 'flt1.res': 0.7,
    'env1.a': 2.4, 'fx.reverb.mix': 0.5,
  }), [['lfo1', 'flt1.cutoff', 0.35]]);
  p('Solar Wind', 'Ambient', 'ambient,evolving,wide,motion', ext(amb, {
    'osc1.wave': 'formant', 'osc1.shape': 0.3, 'osc1.uni': 5, 'osc1.detune': 30,
    'lfo1.rate': 0.04, 'lfo2.rate': 0.03, 'flt1.model': 'svfBP', 'flt1.cutoff': 1100, 'flt1.res': 0.4,
  }), [['lfo1', 'osc1.shape', 0.6], ['lfo2', 'flt1.cutoff', 0.5], ['lfo1', 'pan', 0.5]]);
  p('Memory Tape', 'Ambient', 'ambient,lofi,tape,warm', ext(amb, {
    'osc1.wave': 'string', 'osc1.shape': 0.5, 'voice.drift': 0.7,
    'flt1.cutoff': 1800, 'fx.eq.high': -5, 'fx.eq.low': 3,
    'fx.crush.on': 1, 'fx.crush.bits': 11, 'fx.crush.mix': 0.3,
  }), [['lfo1', 'pitch', 0.03]]);
  p('Low Hum', 'Ambient', 'ambient,drone,low,dark', ext(amb, {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.oct': -2, 'mix.sub': 0.7,
    'flt1.cutoff': 400, 'env1.a': 2, 'env1.r': 4, 'fx.reverb.mix': 0.4, 'fx.delay.mix': 0.12,
  }));
  p('Prayer Bell', 'Ambient', 'ambient,bell,long,meditative', {
    'osc1.wave': 'bell', 'osc1.shape': 0.85, 'osc1.uni': 3, 'osc1.detune': 7,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000,
    'env1.a': 0.002, 'env1.d': 10, 'env1.s': 0, 'env1.r': 8,
    'lfo1.rate': 0.9, 'lfo1.mode': 'free',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.55, 'fx.reverb.size': 1, 'fx.reverb.decay': 8,
  }, [['lfo1', 'amp', 0.18]]);

  /* ═══════════════════════════════════════════════════════════════════════
     PERCUSSION — tuned and untuned, playable from the keyboard
     ═══════════════════════════════════════════════════════════════════════ */
  p('Synth Kick', 'Perc', 'perc,kick,drum', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.level': 0.95, 'voice.mode': 'mono',
    'flt1.model': 'svfLP', 'flt1.cutoff': 400,
    'env1.a': 0.001, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.1,
    'env3.a': 0.001, 'env3.d': 0.04, 'env3.s': 0,
    'fx.comp.on': 1, 'fx.comp.thresh': -12, 'fx.comp.ratio': 8,
  }, [['env3', 'pitch', 0.5]]);
  p('Synth Snare', 'Perc', 'perc,snare,drum', {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'osc1.level': 0.4,
    'mix.noise': 0.75, 'mix.noiseType': 'white', 'mix.noiseFlt': 0.85,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1800, 'flt1.res': 0.4,
    'env1.a': 0.001, 'env1.d': 0.18, 'env1.s': 0, 'env1.r': 0.1,
    'env3.a': 0.001, 'env3.d': 0.05, 'env3.s': 0,
  }, [['env3', 'pitch', 0.2]]);
  p('Synth Hat', 'Perc', 'perc,hat,drum,short', {
    'osc1.wave': 'noise', 'osc1.shape': 0.8, 'osc1.level': 0.4,
    'mix.noise': 0.7, 'mix.noiseType': 'blue',
    'flt1.model': 'svfHP', 'flt1.cutoff': 7000, 'flt1.res': 0.3,
    'env1.a': 0.001, 'env1.d': 0.05, 'env1.s': 0, 'env1.r': 0.04,
  });
  p('Synth Tom', 'Perc', 'perc,tom,drum', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'mix.noise': 0.12,
    'flt1.model': 'svfLP', 'flt1.cutoff': 1200,
    'env1.a': 0.001, 'env1.d': 0.4, 'env1.s': 0, 'env1.r': 0.2,
    'env3.a': 0.001, 'env3.d': 0.12, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  }, [['env3', 'pitch', 0.28]]);
  p('Rim Click', 'Perc', 'perc,rim,click,short', {
    'osc1.wave': 'classic', 'osc1.shape': 1, 'osc1.level': 0.7, 'mix.noise': 0.4,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2200, 'flt1.res': 0.72,
    'env1.a': 0.0005, 'env1.d': 0.05, 'env1.s': 0, 'env1.r': 0.04,
  });
  p('Cowbell', 'Perc', 'perc,cowbell,metal', {
    'osc1.wave': 'classic', 'osc1.shape': 1, 'osc1.level': 0.7,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 1, 'osc2.semi': 8, 'osc2.level': 0.6,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2600, 'flt1.res': 0.5,
    'env1.a': 0.001, 'env1.d': 0.25, 'env1.s': 0, 'env1.r': 0.15,
  });
  p('Woodblock', 'Perc', 'perc,wood,click', {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'mix.noise': 0.3,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1600, 'flt1.res': 0.6, 'flt1.keytrack': 1,
    'env1.a': 0.0005, 'env1.d': 0.09, 'env1.s': 0, 'env1.r': 0.06,
  });
  p('Steel Drum', 'Perc', 'perc,steel,tuned,world', {
    'osc1.wave': 'bell', 'osc1.shape': 0.25, 'osc1.uni': 2, 'osc1.detune': 7,
    'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 12, 'osc2.level': 0, 'mix.fm': 0.28,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1800, 'flt1.res': 0.25,
    'env1.a': 0.001, 'env1.d': 0.9, 'env1.s': 0, 'env1.r': 0.6,
    'env3.a': 0.001, 'env3.d': 0.12, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['env3', 'mix.fm', 0.5]]);
  p('Timpani', 'Perc', 'perc,timpani,orchestral', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.oct': -1, 'mix.noise': 0.18, 'mix.noiseFlt': 0.3,
    'flt1.model': 'svfLP', 'flt1.cutoff': 700,
    'env1.a': 0.002, 'env1.d': 1.6, 'env1.s': 0, 'env1.r': 1,
    'env3.a': 0.001, 'env3.d': 0.2, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.reverb.size': 0.85,
  }, [['env3', 'pitch', 0.2]]);
  p('Gong', 'Perc', 'perc,gong,metal,long', {
    'osc1.wave': 'bell', 'osc1.shape': 0.9, 'osc1.uni': 4, 'osc1.detune': 34,
    'osc2.on': 1, 'osc2.wave': 'noise', 'osc2.shape': 0.6, 'osc2.level': 0.3,
    'mix.ring': 0.3,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4000, 'flt1.env': 0.4,
    'env1.a': 0.004, 'env1.d': 7, 'env1.s': 0, 'env1.r': 5,
    'env2.a': 0.002, 'env2.d': 3, 'env2.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.45, 'fx.reverb.size': 0.95,
  });

  /* ═══════════════════════════════════════════════════════════════════════
     WORLD
     ═══════════════════════════════════════════════════════════════════════ */
  p('Sitar', 'World', 'world,sitar,drone,indian', {
    'osc1.wave': 'string', 'osc1.shape': 0.85, 'osc1.uni': 3, 'osc1.detune': 14,
    'flt1.model': 'comb', 'flt1.cutoff': 380, 'flt1.res': 0.75, 'mix.noise': 0.3,
    'env1.a': 0.001, 'env1.d': 1.6, 'env1.s': 0.1, 'env1.r': 1,
    'voice.mode': 'legato', 'voice.glide': 0.04,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'pitch', 0.02], ['mw', 'lfo1.depth', 1]]);
  p('Shakuhachi', 'World', 'world,flute,breath,japanese', {
    'osc1.wave': 'reed', 'osc1.shape': 0.25, 'mix.noise': 0.28, 'mix.noiseFlt': 0.6,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1400, 'flt1.res': 0.3, 'flt1.keytrack': 0.8,
    'env1.a': 0.06, 'env1.d': 0.8, 'env1.s': 0.7, 'env1.r': 0.3,
    'voice.mode': 'legato', 'voice.glide': 0.05,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.34,
  }, [['lfo1', 'pitch', 0.024], ['at', 'mix.noise', 0.4], ['mw', 'lfo1.depth', 1]]);
  p('Gamelan', 'World', 'world,metal,tuned,indonesian', {
    'osc1.wave': 'bell', 'osc1.shape': 0.4, 'osc1.uni': 2, 'osc1.detune': 12,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2400, 'flt1.res': 0.3,
    'env1.a': 0.001, 'env1.d': 1.4, 'env1.s': 0, 'env1.r': 0.9,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32,
  });
  p('Duduk', 'World', 'world,reed,armenian,soulful', {
    'osc1.wave': 'reed', 'osc1.shape': 0.65, 'osc1.uni': 2, 'osc1.detune': 6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1300, 'flt1.res': 0.2,
    'env1.a': 0.08, 'env1.d': 0.9, 'env1.s': 0.8, 'env1.r': 0.35,
    'voice.mode': 'legato', 'voice.glide': 0.07, 'voice.drift': 0.35,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32,
  }, [['lfo1', 'pitch', 0.026], ['mw', 'lfo1.depth', 1]]);
  p('Kora', 'World', 'world,harp,african,pluck', {
    'osc1.wave': 'string', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 6,
    'flt1.model': 'comb', 'flt1.cutoff': 460, 'flt1.res': 0.6, 'mix.noise': 0.3,
    'env1.a': 0.001, 'env1.d': 1.3, 'env1.s': 0, 'env1.r': 0.8,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Erhu', 'World', 'world,bowed,chinese,solo', {
    'osc1.wave': 'string', 'osc1.shape': 0.55, 'mix.noise': 0.06,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1500, 'flt1.res': 0.35, 'flt1.keytrack': 0.9,
    'env1.a': 0.11, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 0.4,
    'voice.mode': 'legato', 'voice.glide': 0.08,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'pitch', 0.03], ['mw', 'lfo1.depth', 1]]);
  p('Bagpipe', 'World', 'world,reed,drone,scottish', {
    'osc1.wave': 'reed', 'osc1.shape': 0.15, 'osc1.uni': 3, 'osc1.detune': 16,
    'osc2.on': 1, 'osc2.wave': 'reed', 'osc2.shape': 0.2, 'osc2.oct': -1, 'osc2.level': 0.5, 'osc2.keytrack': 0,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2200, 'flt1.res': 0.3,
    'env1.a': 0.02, 'env1.d': 0.4, 'env1.s': 0.95, 'env1.r': 0.1,
    'voice.mode': 'legato', 'voice.drift': 0.4,
  });
  p('Balafon', 'World', 'world,mallet,wood,african', {
    'osc1.wave': 'classic', 'osc1.shape': 0.1, 'osc1.uni': 2, 'osc1.detune': 9,
    'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 19, 'osc2.level': 0, 'mix.fm': 0.24,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1200, 'flt1.res': 0.3, 'flt1.keytrack': 0.9,
    'env1.a': 0.001, 'env1.d': 0.6, 'env1.s': 0, 'env1.r': 0.4,
    'env3.a': 0.001, 'env3.d': 0.08, 'env3.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  }, [['env3', 'mix.fm', 0.5]]);
  p('Didgeridoo', 'World', 'world,drone,low,australian', {
    'osc1.wave': 'formant', 'osc1.shape': 0.3, 'osc1.oct': -2,
    'flt1.model': 'formant', 'flt1.cutoff': 340, 'flt1.res': 0.65,
    'env1.a': 0.05, 'env1.d': 0.6, 'env1.s': 0.9, 'env1.r': 0.3,
    'lfo1.rate': 6.5, 'voice.mode': 'mono',
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'flt1.cutoff', 0.25], ['mw', 'flt1.cutoff', 0.7], ['at', 'lfo1.depth', 0.6]]);
  p('Tabla Tone', 'World', 'world,perc,indian,tuned', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'mix.noise': 0.2, 'mix.noiseFlt': 0.55,
    'flt1.model': 'svfBP', 'flt1.cutoff': 900, 'flt1.res': 0.5, 'flt1.keytrack': 1,
    'env1.a': 0.001, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.2,
    'env3.a': 0.001, 'env3.d': 0.07, 'env3.s': 0,
  }, [['env3', 'pitch', 0.22]]);

  /* ═══════════════════════════════════════════════════════════════════════
     More BASS, LEAD, KEYS, PLUCK, MODERN
     ═══════════════════════════════════════════════════════════════════════ */
  p('Formant Bass', 'Bass', 'bass,formant,vocal', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'mix.sub': 0.6,
    'flt1.model': 'formant', 'flt1.cutoff': 380, 'flt1.res': 0.6,
    'env1.a': 0.004, 'env1.d': 0.6, 'env1.s': 0.6, 'env1.r': 0.2,
    'voice.mode': 'mono', 'lfo1.rate': 2.4, 'lfo1.shape': 'tri',
    'fx.drive.on': 1, 'fx.drive.amount': 0.3,
  }, [['lfo1', 'flt1.cutoff', 0.5], ['mw', 'flt1.cutoff', 0.8]],
    ['Vowel', 'Wobble', 'Grit', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Sine Sub', 'Bass', 'bass,sine,clean,sub', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.uni': 1, 'flt1.model': 'bypass',
    'env1.a': 0.004, 'env1.d': 1.2, 'env1.s': 0.7, 'env1.r': 0.2,
    'voice.mode': 'mono', 'voice.glide': 0.03, 'voice.drift': 0,
    'fx.comp.on': 1, 'fx.comp.thresh': -16, 'fx.comp.ratio': 6,
  });
  p('Hybrid Bass', 'Bass', 'bass,layered,modern', {
    'osc1.wave': 'growl', 'osc1.shape': 0.2, 'osc1.uni': 2, 'osc1.detune': 26,
    'osc2.on': 1, 'osc2.wave': 'classic', 'osc2.shape': 0, 'osc2.oct': -1, 'osc2.level': 0.7,
    'mix.sub': 0.4,
    'flt1.model': 'ladder4', 'flt1.cutoff': 800, 'flt1.res': 0.35, 'flt1.env': 0.55, 'flt1.drive': 0.4,
    'flt2.model': 'svfHP', 'flt2.cutoff': 45,
    'env1.a': 0.003, 'env1.d': 0.7, 'env1.s': 0.6, 'env1.r': 0.2,
    'voice.mode': 'mono', 'fx.comp.on': 1, 'fx.comp.thresh': -18, 'fx.comp.ratio': 6,
  });
  p('Fingered Bass', 'Bass', 'bass,acoustic,fingered', {
    'osc1.wave': 'string', 'osc1.shape': 0.25, 'osc1.uni': 2, 'osc1.detune': 5,
    'mix.noise': 0.18, 'mix.noiseFlt': 0.75, 'mix.sub': 0.35,
    'flt1.model': 'ladder4', 'flt1.cutoff': 800, 'flt1.res': 0.3, 'flt1.env': 0.6, 'flt1.vel': 0.4,
    'env1.a': 0.002, 'env1.d': 0.9, 'env1.s': 0.25, 'env1.r': 0.3,
    'env2.a': 0.001, 'env2.d': 0.2, 'env2.s': 0.05,
    'voice.mode': 'mono', 'voice.velAmt': 0.7,
  });
  p('Trance Bass', 'Bass', 'bass,trance,offbeat,punchy', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 10,
    'mix.sub': 0.55,
    'flt1.model': 'ladder4', 'flt1.cutoff': 500, 'flt1.res': 0.4, 'flt1.env': 0.7,
    'flt2.model': 'svfHP', 'flt2.cutoff': 55,
    'env1.a': 0.002, 'env1.d': 0.2, 'env1.s': 0.1, 'env1.r': 0.1,
    'env2.a': 0.001, 'env2.d': 0.12, 'env2.s': 0,
    'voice.mode': 'mono', 'fx.comp.on': 1, 'fx.comp.thresh': -18, 'fx.comp.ratio': 6,
  });
  p('Chorus Lead', 'Lead', 'lead,chorus,80s', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 11,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3000, 'flt1.res': 0.2, 'flt1.env': 0.35,
    'env1.a': 0.006, 'env1.d': 0.7, 'env1.s': 0.8, 'env1.r': 0.4,
    'voice.mode': 'mono', 'voice.glide': 0.02,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.5, 'fx.chorus.voices': 3,
    'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.22,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.25,
  }, [['lfo1', 'pitch', 0.016], ['mw', 'lfo1.depth', 1]]);
  p('Phase Lead', 'Lead', 'lead,phaser,sweep', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 4, 'osc1.detune': 18,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000,
    'env1.a': 0.006, 'env1.d': 0.8, 'env1.s': 0.8, 'env1.r': 0.4,
    'fx.phaser.on': 1, 'fx.phaser.rate': 0.35, 'fx.phaser.depth': 0.7, 'fx.phaser.fb': 0.55, 'fx.phaser.mix': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }, [['m2', 'fx.phaser.rate', 0.8]], ['Brightness', 'Phase Rate', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Talk Lead', 'Lead', 'lead,formant,talk,wah', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'formant', 'flt1.cutoff': 600, 'flt1.res': 0.6,
    'env1.a': 0.005, 'env1.d': 0.7, 'env1.s': 0.8, 'env1.r': 0.3,
    'voice.mode': 'mono', 'voice.glide': 0.03,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.25,
  }, [['mw', 'flt1.cutoff', 0.9], ['at', 'flt1.res', 0.3]],
    ['Vowel', 'Vibrato', 'Resonance', 'Space', 'Drive', 'Width', 'Tone', 'Chaos']);
  p('Unison Stack Lead', 'Lead', 'lead,unison,huge,mono', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0.1, 'osc1.uni': 8, 'osc1.detune': 30, 'osc1.width': 1,
    'osc2.on': 1, 'osc2.wave': 'supersaw', 'osc2.shape': 0.2, 'osc2.oct': -1, 'osc2.uni': 4,
    'osc2.detune': 20, 'osc2.level': 0.5,
    'flt1.model': 'svfLP', 'flt1.cutoff': 7000, 'flt1.res': 0.12,
    'env1.a': 0.008, 'env1.d': 0.9, 'env1.s': 0.85, 'env1.r': 0.4,
    'voice.mode': 'unison', 'voice.poly': 3, 'voice.spread': 0.4, 'voice.glide': 0.02,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24, 'fx.width': 1.35,
  });
  p('Grand Pad Keys', 'Keys', 'keys,pad,hybrid', {
    'osc1.wave': 'classic', 'osc1.shape': 0.2, 'osc1.uni': 3, 'osc1.detune': 10,
    'osc2.on': 1, 'osc2.wave': 'glass', 'osc2.shape': 0.3, 'osc2.level': 0.35, 'osc2.oct': 1,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3000, 'flt1.env': 0.3,
    'env1.a': 0.004, 'env1.d': 2.2, 'env1.s': 0.35, 'env1.r': 1.2,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.25, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.32,
  }, [['vel', 'osc2.level', 0.4]]);
  p('Bell Keys', 'Keys', 'keys,bell,bright,layer', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc1.level': 0.6,
    'osc2.on': 1, 'osc2.wave': 'bell', 'osc2.shape': 0.4, 'osc2.oct': 1, 'osc2.level': 0.55,
    'flt1.model': 'svfLP', 'flt1.cutoff': 6000,
    'env1.a': 0.001, 'env1.d': 1.6, 'env1.s': 0.1, 'env1.r': 0.9,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.32, 'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.16,
  });
  p('Lo-Fi Keys', 'Keys', 'keys,lofi,tape,warm', {
    'osc1.wave': 'classic', 'osc1.shape': 0.25, 'osc1.uni': 2, 'osc1.detune': 12,
    'flt1.model': 'svfLP', 'flt1.cutoff': 2200, 'flt1.env': 0.3,
    'env1.a': 0.003, 'env1.d': 1.4, 'env1.s': 0.25, 'env1.r': 0.7,
    'voice.drift': 0.65,
    'fx.crush.on': 1, 'fx.crush.bits': 10, 'fx.crush.rate': 0.7, 'fx.crush.mix': 0.4,
    'fx.eq.high': -5, 'fx.eq.low': 3, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['lfo1', 'pitch', 0.03]]);
  p('Rhodes Bell', 'Keys', 'keys,rhodes,fm,bell', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 14,
    'osc2.level': 0, 'mix.fm': 0.32,
    'flt1.model': 'svfLP', 'flt1.cutoff': 9000,
    'env1.a': 0.001, 'env1.d': 2.2, 'env1.s': 0.14, 'env1.r': 0.8,
    'env3.a': 0.001, 'env3.d': 0.6, 'env3.s': 0.05,
    'voice.velAmt': 0.7,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.3, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.24,
  }, [['env3', 'mix.fm', 0.5], ['vel', 'mix.fm', 0.45]]);
  p('Celeste', 'Keys', 'keys,bell,delicate,high', {
    'osc1.wave': 'bell', 'osc1.shape': 0.3, 'osc1.oct': 1, 'osc1.uni': 2, 'osc1.detune': 4,
    'flt1.model': 'svfLP', 'flt1.cutoff': 8000,
    'env1.a': 0.001, 'env1.d': 1.2, 'env1.s': 0, 'env1.r': 0.8,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35,
  });
  p('Analog Pluck', 'Pluck', 'pluck,analog,warm', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 2, 'osc1.detune': 10,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1300, 'flt1.res': 0.4, 'flt1.env': 0.7,
    'env1.a': 0.001, 'env1.d': 0.4, 'env1.s': 0, 'env1.r': 0.3,
    'env2.a': 0.001, 'env2.d': 0.16, 'env2.s': 0,
    'voice.drift': 0.3, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  });
  p('Sine Pluck', 'Pluck', 'pluck,sine,clean,soft', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'flt1.model': 'bypass',
    'env1.a': 0.001, 'env1.d': 0.5, 'env1.s': 0, 'env1.r': 0.4,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.24, 'fx.delay.pong': 0.7,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.34,
  });
  p('Formant Pluck', 'Pluck', 'pluck,formant,vocal', {
    'osc1.wave': 'vocal', 'osc1.shape': 0.35, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'formant', 'flt1.cutoff': 700, 'flt1.res': 0.55,
    'env1.a': 0.001, 'env1.d': 0.45, 'env1.s': 0, 'env1.r': 0.35,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.2, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  }, [['env3', 'flt1.cutoff', 0.4], ['mw', 'flt1.cutoff', 0.7]]);
  p('Noise Pluck', 'Pluck', 'pluck,noise,percussive', {
    'osc1.level': 0.35, 'mix.noise': 0.7, 'mix.noiseType': 'white', 'mix.noiseFlt': 0.9,
    'flt1.model': 'comb', 'flt1.cutoff': 440, 'flt1.res': 0.78,
    'env1.a': 0.0008, 'env1.d': 0.6, 'env1.s': 0, 'env1.r': 0.45,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Sync Pluck', 'Pluck', 'pluck,sync,zap', {
    'osc1.wave': 'classic', 'osc1.shape': 0.667, 'osc1.level': 0.4,
    'osc2.on': 1, 'osc2.wave': 'sync', 'osc2.shape': 0.4, 'osc2.sync': 1, 'osc2.semi': 12, 'osc2.level': 0.8,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000, 'flt1.env': 0.4,
    'env1.a': 0.001, 'env1.d': 0.35, 'env1.s': 0, 'env1.r': 0.25,
    'env3.a': 0.001, 'env3.d': 0.2, 'env3.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.2, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['env3', 'osc2.fine', 0.4]]);
  p('Garage Stab', 'Modern', 'stab,garage,uk,chord', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 3, 'osc1.detune': 14,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1100, 'flt1.res': 0.4, 'flt1.env': 0.7,
    'flt2.model': 'svfHP', 'flt2.cutoff': 220,
    'env1.a': 0.002, 'env1.d': 0.22, 'env1.s': 0, 'env1.r': 0.18,
    'env2.a': 0.001, 'env2.d': 0.13, 'env2.s': 0,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.24, 'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.14,
  });
  p('Amen Bass', 'Modern', 'bass,dnb,jungle,fat', {
    'osc1.wave': 'classic', 'osc1.shape': 0.34, 'mix.sub': 0.85,
    'flt1.model': 'ladder4', 'flt1.cutoff': 300, 'flt1.res': 0.15, 'flt1.drive': 0.35,
    'env1.a': 0.003, 'env1.d': 1.6, 'env1.s': 0.65, 'env1.r': 0.25,
    'voice.mode': 'mono', 'voice.glide': 0.02,
    'fx.comp.on': 1, 'fx.comp.thresh': -16, 'fx.comp.ratio': 7,
  });
  p('Hardstyle Lead', 'Modern', 'lead,hardstyle,distorted,huge', {
    'osc1.wave': 'supersaw', 'osc1.shape': 0, 'osc1.uni': 7, 'osc1.detune': 28,
    'osc2.on': 1, 'osc2.wave': 'vintage', 'osc2.shape': 0.05, 'osc2.oct': -1, 'osc2.level': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 3000, 'flt1.res': 0.25, 'flt1.drive': 0.5,
    'flt2.model': 'svfHP', 'flt2.cutoff': 200,
    'env1.a': 0.004, 'env1.d': 0.6, 'env1.s': 0.8, 'env1.r': 0.25,
    'fx.drive.on': 1, 'fx.drive.type': 'hard', 'fx.drive.amount': 0.5, 'fx.drive.tone': 0.6,
    'fx.comp.on': 1, 'fx.comp.thresh': -14, 'fx.comp.ratio': 8, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.2,
  });
  p('Psy Bass', 'Modern', 'bass,psytrance,rolling', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'mix.sub': 0.6,
    'flt1.model': 'ladder4', 'flt1.cutoff': 420, 'flt1.res': 0.2, 'flt1.env': 0.5,
    'flt2.model': 'svfHP', 'flt2.cutoff': 40,
    'env1.a': 0.002, 'env1.d': 0.13, 'env1.s': 0, 'env1.r': 0.06,
    'env2.a': 0.001, 'env2.d': 0.09, 'env2.s': 0,
    'voice.mode': 'mono', 'voice.poly': 1,
  });
  p('Dub Chord', 'Modern', 'chord,dub,reggae,skank', {
    'osc1.wave': 'harmonic', 'osc1.shape': 0.35, 'osc1.uni': 2, 'osc1.detune': 10,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1300, 'flt1.res': 0.3, 'flt1.env': 0.4,
    'env1.a': 0.002, 'env1.d': 0.2, 'env1.s': 0, 'env1.r': 0.16,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.fb': 0.65, 'fx.delay.mix': 0.35,
    'fx.delay.pong': 0.6, 'fx.delay.tone': 0.3,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Lo-Fi Chord', 'Modern', 'chord,lofi,warm,dusty', {
    'osc1.wave': 'classic', 'osc1.shape': 0.3, 'osc1.uni': 3, 'osc1.detune': 16,
    'flt1.model': 'svfLP', 'flt1.cutoff': 1900, 'flt1.env': 0.25,
    'env1.a': 0.01, 'env1.d': 1.4, 'env1.s': 0.5, 'env1.r': 0.8,
    'voice.drift': 0.6,
    'fx.crush.on': 1, 'fx.crush.bits': 10, 'fx.crush.rate': 0.6, 'fx.crush.mix': 0.35,
    'fx.eq.high': -4, 'fx.eq.low': 2.5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['lfo1', 'pitch', 0.026]]);
  p('Modular Bleep', 'Modern', 'perc,bleep,modular,short', {
    'osc1.wave': 'classic', 'osc1.shape': 0, 'osc2.on': 1, 'osc2.ratio': 1, 'osc2.semi': 7,
    'osc2.level': 0, 'mix.fm': 0.4,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2000, 'flt1.res': 0.45,
    'env1.a': 0.001, 'env1.d': 0.16, 'env1.s': 0, 'env1.r': 0.12,
    'env3.a': 0.001, 'env3.d': 0.06, 'env3.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.fb': 0.5, 'fx.delay.mix': 0.28, 'fx.delay.pong': 0.8,
  }, [['env3', 'pitch', 0.3], ['env3', 'mix.fm', 0.4]]);
  p('Vapor Lead', 'Modern', 'lead,vaporwave,slow,dreamy', {
    'osc1.wave': 'vintage', 'osc1.shape': 0.05, 'osc1.uni': 3, 'osc1.detune': 20,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2200, 'flt1.res': 0.2,
    'env1.a': 0.06, 'env1.d': 1.4, 'env1.s': 0.7, 'env1.r': 0.9,
    'voice.mode': 'legato', 'voice.glide': 0.09, 'voice.drift': 0.5,
    'fx.chorus.on': 1, 'fx.chorus.mix': 0.45, 'fx.chorus.rate': 0.4,
    'fx.delay.on': 1, 'fx.delay.div': '1_4', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'fx.reverb.size': 0.9,
  }, [['lfo1', 'pitch', 0.022]]);
  p('Phonk Bell', 'Modern', 'lead,phonk,bell,dark', {
    'osc1.wave': 'bell', 'osc1.shape': 0.35, 'osc1.uni': 2, 'osc1.detune': 9,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2600, 'flt1.res': 0.25, 'flt1.env': 0.4,
    'env1.a': 0.001, 'env1.d': 1, 'env1.s': 0.12, 'env1.r': 0.7,
    'voice.mode': 'legato', 'voice.glide': 0.07,
    'fx.drive.on': 1, 'fx.drive.type': 'tape', 'fx.drive.amount': 0.3,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.35, 'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22,
  });
  p('Bit Bass', 'Modern', 'bass,lofi,crush,8bit', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.5, 'mix.sub': 0.5, 'voice.drift': 0,
    'flt1.model': 'ladder4', 'flt1.cutoff': 900, 'flt1.res': 0.3, 'flt1.env': 0.5,
    'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0.4, 'env1.r': 0.1,
    'voice.mode': 'mono',
    'fx.crush.on': 1, 'fx.crush.bits': 7, 'fx.crush.rate': 0.5, 'fx.crush.mix': 0.8,
  });

  /* ═══════════════════════════════════════════════════════════════════════
     More MOTION and ARP
     ═══════════════════════════════════════════════════════════════════════ */
  p('Shape Sequence', 'Motion', 'motion,wavetable,sequence', {
    'osc1.wave': 'digital', 'osc1.shape': 0.2, 'osc1.uni': 3, 'osc1.detune': 12,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000, 'flt1.res': 0.2,
    'env1.a': 0.005, 'env1.d': 1, 'env1.s': 0.85, 'env1.r': 0.4,
    'mot1.on': 1, 'mot1.div': '1_8', 'mot1.slew': 0.08,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  }, [['mot1', 'osc1.shape', 0.8]], ['Brightness', 'Wave Sweep', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'],
    [MOT.stair, MOT.rise]);
  p('Ping-Pong Motion', 'Motion', 'motion,pingpong,stereo', {
    'osc1.wave': 'glass', 'osc1.shape': 0.3, 'osc1.uni': 2, 'osc1.detune': 10,
    'flt1.model': 'svfBP', 'flt1.cutoff': 1800, 'flt1.res': 0.45,
    'env1.a': 0.002, 'env1.d': 0.5, 'env1.s': 0.3, 'env1.r': 0.4,
    'mot1.on': 1, 'mot1.div': '1_16', 'mot1.mode': 'pong', 'mot2.on': 1, 'mot2.div': '1_8', 'mot2.mode': 'pong',
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.pong': 1, 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.45,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['mot1', 'pitch', 0.3], ['mot2', 'pan', 0.8]], null, [MOT.arp, MOT.trip]);
  p('Random Motion', 'Motion', 'motion,random,generative', {
    'osc1.wave': 'bell', 'osc1.shape': 0.4, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'svfBP', 'flt1.cutoff': 2200, 'flt1.res': 0.5,
    'env1.a': 0.001, 'env1.d': 0.6, 'env1.s': 0.2, 'env1.r': 0.5,
    'mot1.on': 1, 'mot1.div': '1_8', 'mot1.mode': 'random',
    'mot2.on': 1, 'mot2.div': '1_16', 'mot2.mode': 'random', 'mot2.slew': 0.2,
    'fx.delay.on': 1, 'fx.delay.div': '1_8t', 'fx.delay.mix': 0.3, 'fx.delay.fb': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.34,
  }, [['mot1', 'pitch', 0.25], ['mot2', 'flt1.cutoff', 0.6]], null, [MOT.arp, MOT.chaos]);
  p('Slow Morph', 'Motion', 'motion,slow,evolving,pad', {
    'osc1.wave': 'formant', 'osc1.shape': 0.1, 'osc1.uni': 4, 'osc1.detune': 20,
    'flt1.model': 'formant', 'flt1.cutoff': 500, 'flt1.res': 0.5,
    'env1.a': 1.4, 'env1.d': 2.5, 'env1.s': 0.9, 'env1.r': 2.5,
    'mot1.on': 1, 'mot1.div': '1_1', 'mot1.slew': 0.9, 'mot2.on': 1, 'mot2.div': '2n_1', 'mot2.slew': 0.95,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.45, 'fx.reverb.size': 0.9,
  }, [['mot1', 'flt1.cutoff', 0.7], ['mot2', 'osc1.shape', 0.7]], null, [MOT.rise, MOT.stair]);
  p('Poly Rhythm', 'Motion', 'motion,polyrhythm,complex', {
    'osc1.wave': 'pulse', 'osc1.pw': 0.4, 'osc1.uni': 2, 'osc1.detune': 8,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1600, 'flt1.res': 0.4,
    'env1.a': 0.002, 'env1.d': 0.4, 'env1.s': 0.5, 'env1.r': 0.3,
    'mot1.on': 1, 'mot1.div': '1_8t', 'mot1.steps': 12, 'mot2.on': 1, 'mot2.div': '1_16', 'mot2.steps': 10,
    'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.24,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  }, [['mot1', 'flt1.cutoff', 0.6], ['mot2', 'amp', 0.4], ['mot2', 'osc1.pw', 0.3]],
    null, [MOT.stab, MOT.gate]);
  p('Pinky Arp', 'Arp', 'arp,pinky,pattern', {
    'arp.on': 1, 'arp.pattern': 'pinky', 'arp.div': '1_16', 'arp.oct': 1, 'arp.gate': 0.5,
    'osc1.wave': 'pulse', 'osc1.pw': 0.35, 'mix.sub': 0.3,
    'flt1.model': 'ladder4', 'flt1.cutoff': 1800, 'flt1.res': 0.35, 'flt1.env': 0.55,
    'env1.a': 0.001, 'env1.d': 0.25, 'env1.s': 0, 'env1.r': 0.2,
    'env2.a': 0.001, 'env2.d': 0.15, 'env2.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.mix': 0.22, 'fx.delay.pong': 0.6,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.26,
  });
  p('Diverge Arp', 'Arp', 'arp,diverge,pattern', {
    'arp.on': 1, 'arp.pattern': 'diverge', 'arp.div': '1_16', 'arp.oct': 2, 'arp.gate': 0.45,
    'osc1.wave': 'glass', 'osc1.shape': 0.35,
    'flt1.model': 'svfLP', 'flt1.cutoff': 4000, 'flt1.env': 0.4,
    'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0, 'env1.r': 0.25,
    'fx.delay.on': 1, 'fx.delay.div': '1_16', 'fx.delay.mix': 0.26, 'fx.delay.pong': 0.8,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3,
  });
  p('Slow Arp Pad', 'Arp', 'arp,slow,pad,dreamy', {
    'arp.on': 1, 'arp.pattern': 'updown', 'arp.div': '1_4', 'arp.oct': 2, 'arp.gate': 1.4,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.3, 'osc1.uni': 4, 'osc1.detune': 18,
    'flt1.model': 'svfLP', 'flt1.cutoff': 3000, 'flt1.res': 0.15,
    'env1.a': 0.15, 'env1.d': 1.2, 'env1.s': 0.6, 'env1.r': 1,
    'fx.delay.on': 1, 'fx.delay.div': '1_4d', 'fx.delay.mix': 0.28, 'fx.delay.fb': 0.5,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.38, 'fx.reverb.size': 0.85,
  });
  p('Gated Arp', 'Arp', 'arp,gate,motion,rhythmic', {
    'arp.on': 1, 'arp.pattern': 'up', 'arp.div': '1_16', 'arp.oct': 2, 'arp.gate': 0.9,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.2, 'osc1.uni': 5, 'osc1.detune': 20,
    'flt1.model': 'svfLP', 'flt1.cutoff': 5000,
    'env1.a': 0.004, 'env1.d': 0.6, 'env1.s': 0.7, 'env1.r': 0.2,
    'mot1.on': 1, 'mot1.div': '1_32', 'mot1.slew': 0.02,
    'fx.delay.on': 1, 'fx.delay.div': '1_8', 'fx.delay.mix': 0.2,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.28,
  }, [['mot1', 'amp', 0.8, 1]], null, [MOT.gate, MOT.pump]);
  p('Detuned Arp', 'Arp', 'arp,detuned,wide', {
    'arp.on': 1, 'arp.pattern': 'updown', 'arp.div': '1_16', 'arp.oct': 3, 'arp.gate': 0.4,
    'osc1.wave': 'supersaw', 'osc1.shape': 0.15, 'osc1.uni': 7, 'osc1.detune': 30, 'osc1.width': 1,
    'flt1.model': 'ladder4', 'flt1.cutoff': 2600, 'flt1.res': 0.28, 'flt1.env': 0.5,
    'env1.a': 0.001, 'env1.d': 0.28, 'env1.s': 0, 'env1.r': 0.24,
    'env2.a': 0.001, 'env2.d': 0.16, 'env2.s': 0,
    'fx.delay.on': 1, 'fx.delay.div': '1_8d', 'fx.delay.pong': 0.8, 'fx.delay.mix': 0.26,
    'fx.reverb.on': 1, 'fx.reverb.mix': 0.3, 'fx.width': 1.3,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
