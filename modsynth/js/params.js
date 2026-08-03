/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — parameter schema
   ───────────────────────────────────────────────────────────────────────────
   One flat, ordered table describes every automatable value in the instrument.
   Everything else is derived from it:

     · the Float32Array the audio worklet reads (index === declaration order)
     · patch files (stored by id, so re-ordering never corrupts a saved sound)
     · MIDI learn / CC mapping        (normalised 0…1)
     · Max for Live parameter list    (exported by tools/export-m4l-params.js)
     · the control surface            (built from `group` + `label` + range)

   Two rules keep the rest of the codebase honest:
     1. Declaration order defines the worklet index. Append, never insert.
        (`tests/params.test.js` pins the count and the enum ordering.)
     2. Values are stored in *real* units — Hz, seconds, cents, semitones — so
        a patch file is readable. Normalisation to 0…1 happens only at the
        edges that need it (MIDI, Live, macros).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  /* ── Wavetable sets ────────────────────────────────────────────────────────
     Order must match WT_DEFS in js/dsp.js. tests/params.test.js asserts it.
     Each entry is a *set* of frames; `osc.shape` morphs between them, which is
     what makes one oscillator cover both a vintage saw and a digital sweep. */
  const WAVES = [
    ['classic',  'Classic'],    // sine → tri → saw → square: the analog spine
    ['pulse',    'Pulse'],      // true PWM, band-limited by construction
    ['supersaw', 'Super Saw'],  // saw with progressively softened corners
    ['harmonic', 'Harmonics'],  // additive comb — organ / drawbar territory
    ['formant',  'Formant'],    // vowel-ish resonant peaks, ah → ee → oo
    ['bell',     'Bell'],       // inharmonic metallic partials
    ['digital',  'Digital'],    // hard-edged FM-flavoured stacks
    ['vocal',    'Vocal'],      // breathy odd-harmonic morph
    ['reed',     'Reed'],       // narrow pulse family, clarinet → oboe
    ['string',   'String'],     // bowed spectrum, 1/n roll-off variants
    ['glass',    'Glass'],      // high partial shimmer
    ['growl',    'Growl'],      // phase-shifted saws, reese/neuro source
    ['fold',     'Wavefold'],   // sine driven through progressive folding
    ['noise',    'Noisy'],      // pseudo-random band-limited tables
    ['vintage',  'Vintage'],    // deliberately imperfect saw/square pair
    ['sync',     'Sync'],       // pre-shaped sync-sweep frames
  ];

  const SUB_WAVES   = [['sine', 'Sine'], ['tri', 'Tri'], ['square', 'Square'], ['saw', 'Saw']];
  const NOISE_TYPES = [['white', 'White'], ['pink', 'Pink'], ['blue', 'Blue'], ['crackle', 'Crackle']];

  const FILTER_MODELS = [
    ['bypass',   'Bypass'],
    ['ladder4',  'Ladder 24'],   // Moog-style 4-pole, ZDF, saturating
    ['ladder2',  'Ladder 12'],
    ['svfLP',    'SVF LP'],      // TPT state-variable, clean and fast
    ['svfHP',    'SVF HP'],
    ['svfBP',    'SVF BP'],
    ['svfNotch', 'SVF Notch'],
    ['svfPeak',  'SVF Peak'],
    ['diode',    'Diode 12'],    // MS-20-flavoured, screams at high res
    ['comb',     'Comb'],        // tuned delay — plucked/flute bodies
    ['formant',  'Formant'],     // three tracked vowel peaks
  ];

  const FILTER_ROUTES = [['serial', 'Serial'], ['parallel', 'Parallel'], ['split', 'Split']];

  const VOICE_MODES = [
    ['poly',   'Poly'],
    ['mono',   'Mono'],
    ['legato', 'Legato'],
    ['unison', 'Uni Mono'],
  ];

  const LFO_SHAPES = [
    ['sine', 'Sine'], ['tri', 'Tri'], ['saw', 'Saw'], ['ramp', 'Ramp'],
    ['square', 'Square'], ['pulse', 'Pulse'], ['sh', 'S&H'],
    ['smooth', 'Smooth'], ['exp', 'Exp'], ['trap', 'Trap'],
  ];

  const LFO_MODES = [['poly', 'Poly'], ['mono', 'Mono'], ['free', 'Free'], ['once', 'One-shot']];

  /* Tempo divisions, shared by LFOs, motion lanes, delay and the arp.
     Value is in whole notes (1 = a bar of 4/4) so the clock maths is one
     multiply regardless of who is asking. */
  const DIVS = [
    ['8n_1',  '8 bars', 8],   ['4n_1', '4 bars', 4],   ['2n_1', '2 bars', 2],
    ['1_1',   '1 bar',  1],   ['1_2d', '1/2.',  0.75], ['1_2',  '1/2',   0.5],
    ['1_2t',  '1/2T',   1 / 3], ['1_4d', '1/4.', 0.375], ['1_4', '1/4',  0.25],
    ['1_4t',  '1/4T',   1 / 6], ['1_8d', '1/8.', 0.1875], ['1_8', '1/8',  0.125],
    ['1_8t',  '1/8T',   1 / 12], ['1_16d', '1/16.', 0.09375], ['1_16', '1/16', 0.0625],
    ['1_16t', '1/16T',  1 / 24], ['1_32', '1/32', 0.03125], ['1_32t', '1/32T', 1 / 48],
    ['1_64',  '1/64',   0.015625],
  ];
  const DIV_BEATS = {};             // id → length in beats (quarter notes)
  DIVS.forEach(d => { DIV_BEATS[d[0]] = d[2] * 4; });

  const MOTION_MODES = [['loop', 'Loop'], ['pong', 'Ping-Pong'], ['random', 'Random'], ['once', 'One-shot']];

  const DRIVE_TYPES = [
    ['soft', 'Soft'], ['tape', 'Tape'], ['tube', 'Tube'],
    ['diode', 'Diode'], ['fold', 'Fold'], ['hard', 'Hard'],
  ];

  const ARP_PATTERNS = [
    ['up', 'Up'], ['down', 'Down'], ['updown', 'Up/Down'], ['downup', 'Down/Up'],
    ['upDownInc', 'Up-Down+'], ['converge', 'Converge'], ['diverge', 'Diverge'],
    ['random', 'Random'], ['randomWalk', 'Walk'], ['chord', 'Chord'],
    ['played', 'As Played'], ['thumb', 'Thumb'], ['pinky', 'Pinky'],
  ];

  const ARP_VEL = [['played', 'As Played'], ['fixed', 'Fixed'], ['accent', 'Accent'], ['ramp', 'Ramp'], ['random', 'Random']];

  /* ── Modulation sources & destinations ────────────────────────────────────
     Sources are read once per block per voice; destinations are applied as an
     offset in the destination's own units (see DEST_SCALE in dsp.js). */
  const MOD_SOURCES = [
    ['none', 'Off'],
    ['env1', 'Env 1 Amp'], ['env2', 'Env 2 Flt'], ['env3', 'Env 3 Mod'],
    ['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['lfo3', 'LFO 3'],
    ['mot1', 'Motion 1'], ['mot2', 'Motion 2'],
    ['vel', 'Velocity'], ['keytrack', 'Key Track'], ['note', 'Note #'],
    ['mw', 'Mod Wheel'], ['bend', 'Pitch Bend'], ['at', 'Aftertouch'],
    ['exp', 'Expression'], ['breath', 'Breath'], ['foot', 'Foot'],
    ['m1', 'Macro 1'], ['m2', 'Macro 2'], ['m3', 'Macro 3'], ['m4', 'Macro 4'],
    ['m5', 'Macro 5'], ['m6', 'Macro 6'], ['m7', 'Macro 7'], ['m8', 'Macro 8'],
    ['rand', 'Random'], ['rand2', 'Random 2'], ['unison', 'Unison Idx'],
    ['gate', 'Gate'], ['alt', 'Alternate'],
  ];

  /* Destination ids are parameter ids for anything the DSP can offset live.
     Kept as an explicit list so the matrix UI shows only what actually moves. */
  const MOD_DESTS = [
    ['none', 'Off'],
    ['pitch', 'Pitch (all)'],
    ['osc1.fine', 'Osc 1 Pitch'], ['osc2.fine', 'Osc 2 Pitch'],
    ['osc1.shape', 'Osc 1 Shape'], ['osc2.shape', 'Osc 2 Shape'],
    ['osc1.pw', 'Osc 1 PW'], ['osc2.pw', 'Osc 2 PW'],
    ['osc1.level', 'Osc 1 Level'], ['osc2.level', 'Osc 2 Level'],
    ['osc1.detune', 'Osc 1 Detune'], ['osc2.detune', 'Osc 2 Detune'],
    ['mix.fm', 'FM Amount'], ['mix.ring', 'Ring Mod'],
    ['mix.sub', 'Sub Level'], ['mix.noise', 'Noise Level'],
    ['flt1.cutoff', 'Filter 1 Cut'], ['flt1.res', 'Filter 1 Res'], ['flt1.drive', 'Filter 1 Drive'],
    ['flt2.cutoff', 'Filter 2 Cut'], ['flt2.res', 'Filter 2 Res'],
    ['flt.blend', 'Filter Blend'],
    ['amp', 'Amp'], ['pan', 'Pan'],
    ['lfo1.rate', 'LFO 1 Rate'], ['lfo2.rate', 'LFO 2 Rate'], ['lfo3.rate', 'LFO 3 Rate'],
    ['lfo1.depth', 'LFO 1 Depth'], ['lfo2.depth', 'LFO 2 Depth'], ['lfo3.depth', 'LFO 3 Depth'],
    ['env2.d', 'Env 2 Decay'], ['env1.r', 'Env 1 Release'],
    ['fx.drive.amount', 'FX Drive'], ['fx.delay.mix', 'Delay Mix'],
    ['fx.reverb.mix', 'Reverb Mix'], ['fx.chorus.mix', 'Chorus Mix'],
    ['fx.phaser.rate', 'Phaser Rate'], ['fx.crush.mix', 'Crush Mix'],
  ];

  const MATRIX_SLOTS = 16;
  const MACRO_COUNT = 8;
  const MOTION_STEPS = 16;

  /* ── Declaration helpers ──────────────────────────────────────────────────*/
  const PARAMS = [];
  const BY_ID = Object.create(null);

  function def(id, spec) {
    if (BY_ID[id]) throw new Error('duplicate parameter id: ' + id);
    const p = Object.assign(
      {
        id,
        index: PARAMS.length,
        group: id.split('.')[0],
        type: 'float',
        min: 0,
        max: 1,
        curve: 'lin',
        unit: '',
        target: 'dsp',       // 'dsp' → pushed to the worklet, 'host' → FX/arp/UI
        step: 0,
      },
      spec
    );
    if (p.type === 'enum') {
      p.min = 0;
      p.max = p.options.length - 1;
      p.step = 1;
      p.optIndex = Object.create(null);
      p.options.forEach((o, i) => { p.optIndex[o[0]] = i; });
      if (typeof p.def === 'string') p.defIndex = p.optIndex[p.def];
      else { p.defIndex = p.def | 0; p.def = p.options[p.defIndex][0]; }
    } else if (p.type === 'bool') {
      p.min = 0; p.max = 1; p.step = 1;
    }
    PARAMS.push(p);
    BY_ID[id] = p;
    return p;
  }

  const f = (id, label, min, max, dv, o) => def(id, Object.assign({ label, min, max, def: dv }, o));
  const i = (id, label, min, max, dv, o) => def(id, Object.assign({ label, min, max, def: dv, step: 1, type: 'int' }, o));
  const b = (id, label, dv, o) => def(id, Object.assign({ label, def: dv ? 1 : 0, type: 'bool' }, o));
  const e = (id, label, options, dv, o) => def(id, Object.assign({ label, options, def: dv, type: 'enum' }, o));

  /* Time curve: an exponential-ish map so the bottom of an envelope slider has
     the millisecond resolution that makes a pluck a pluck. */
  const TIME = { curve: 'pow', k: 3, unit: 's' };
  const FREQ = { curve: 'exp', unit: 'Hz' };

  /* ════════════════ VOICE ════════════════ */
  i('voice.poly',      'Polyphony',   1, 16, 8);
  e('voice.mode',      'Mode',        VOICE_MODES, 'poly');
  f('voice.glide',     'Glide',       0, 4, 0, TIME);
  b('voice.glideAuto', 'Glide Legato', 0);
  f('voice.bendUp',    'Bend Up',     0, 24, 2, { step: 1, unit: 'st' });
  f('voice.bendDown',  'Bend Down',   0, 24, 2, { step: 1, unit: 'st' });
  i('voice.transpose', 'Transpose',   -24, 24, 0, { unit: 'st' });
  f('voice.tune',      'Fine Tune',   -100, 100, 0, { unit: 'ct' });
  f('voice.drift',     'Analog Drift', 0, 1, 0.12);
  f('voice.velAmt',    'Vel → Amp',   0, 1, 0.6);
  f('voice.velCurve',  'Vel Curve',   -1, 1, 0);
  f('voice.spread',    'Voice Spread', 0, 1, 0);
  b('voice.hq',        'HQ Oversample', 0);

  /* ════════════════ OSCILLATORS ════════════════ */
  for (const n of [1, 2]) {
    const g = 'osc' + n;
    b(g + '.on',       'On',      n === 1 ? 1 : 0);
    e(g + '.wave',     'Wave',    WAVES, 'classic');
    f(g + '.shape',    'Shape',   0, 1, n === 1 ? 0.66 : 0.66);
    f(g + '.pw',       'Width',   0.02, 0.98, 0.5);
    i(g + '.oct',      'Octave',  -4, 4, 0);
    i(g + '.semi',     'Semi',    -24, 24, 0, { unit: 'st' });
    f(g + '.fine',     'Fine',    -100, 100, 0, { unit: 'ct' });
    f(g + '.level',    'Level',   0, 1, n === 1 ? 0.8 : 0);
    f(g + '.pan',      'Pan',     -1, 1, 0);
    i(g + '.uni',      'Unison',  1, 8, 1);
    f(g + '.detune',   'Detune',  0, 100, 18, { unit: 'ct' });
    f(g + '.width',    'Uni Width', 0, 1, 0.7);
    f(g + '.blend',    'Uni Blend', 0, 1, 0.75);
    f(g + '.phase',    'Phase',   0, 1, 0);
    b(g + '.free',     'Free Run', 1);
    f(g + '.keytrack', 'Key Track', 0, 1, 1);
  }
  b('osc2.sync',  'Hard Sync', 0);
  b('osc2.ratio', 'FM Ratio',  0);

  /* ════════════════ MIX / EXTRA SOURCES ════════════════ */
  f('mix.fm',        'FM 2→1',   0, 1, 0);
  f('mix.ring',      'Ring Mod', 0, 1, 0);
  f('mix.sub',       'Sub',      0, 1, 0);
  e('mix.subWave',   'Sub Wave', SUB_WAVES, 'sine');
  i('mix.subOct',    'Sub Oct',  -2, -1, -1);
  f('mix.noise',     'Noise',    0, 1, 0);
  e('mix.noiseType', 'Noise Type', NOISE_TYPES, 'white');
  f('mix.noiseFlt',  'Noise Tone', 0, 1, 1);

  /* ════════════════ FILTERS ════════════════ */
  for (const n of [1, 2]) {
    const g = 'flt' + n;
    e(g + '.model',    'Model',   FILTER_MODELS, n === 1 ? 'ladder4' : 'bypass');
    f(g + '.cutoff',   'Cutoff',  20, 20000, n === 1 ? 12000 : 20000, FREQ);
    f(g + '.res',      'Reso',    0, 1, 0.12);
    f(g + '.drive',    'Drive',   0, 1, 0.1);
    f(g + '.keytrack', 'Key Trk', -1, 1, 0);
    f(g + '.env',      'Env 2',   -1, 1, 0);
    f(g + '.vel',      'Vel',     0, 1, 0);
  }
  e('flt.route', 'Routing', FILTER_ROUTES, 'serial');
  f('flt.blend', 'Blend',   0, 1, 0.5);

  /* ════════════════ ENVELOPES ════════════════ */
  const ENV_DEFS = [
    ['env1', 'Amp', 0.005, 0.4, 0.85, 0.35],
    ['env2', 'Filter', 0.004, 0.5, 0.4, 0.3],
    ['env3', 'Mod', 0.01, 0.6, 0.5, 0.4],
  ];
  for (const [g, , a, d, s, r] of ENV_DEFS) {
    f(g + '.a',     'Attack',  0, 12, a, TIME);
    f(g + '.h',     'Hold',    0, 4, 0, TIME);
    f(g + '.d',     'Decay',   0.001, 20, d, TIME);
    f(g + '.s',     'Sustain', 0, 1, s);
    f(g + '.r',     'Release', 0.002, 20, r, TIME);
    f(g + '.curve', 'Curve',   -1, 1, 0);
    f(g + '.vel',   'Vel',     0, 1, g === 'env1' ? 0 : 0);
  }
  b('env3.loop', 'Env 3 Loop', 0);

  /* ════════════════ LFOs ════════════════ */
  for (const n of [1, 2, 3]) {
    const g = 'lfo' + n;
    e(g + '.shape',  'Shape',  LFO_SHAPES, 'sine');
    f(g + '.rate',   'Rate',   0.01, 40, n === 1 ? 5 : 0.5, FREQ);
    b(g + '.sync',   'Sync',   0);
    e(g + '.div',    'Div',    DIVS, '1_4');
    f(g + '.depth',  'Depth',  0, 1, 1);
    f(g + '.phase',  'Phase',  0, 1, 0);
    f(g + '.delay',  'Delay',  0, 8, 0, TIME);
    f(g + '.fade',   'Fade',   0, 8, 0, TIME);
    f(g + '.smooth', 'Smooth', 0, 1, 0);
    e(g + '.mode',   'Mode',   LFO_MODES, 'poly');
    f(g + '.pw',     'Skew',   0.02, 0.98, 0.5);
  }

  /* ════════════════ MOTION LANES ════════════════
     Step values live outside the param table (they're an array, not a scalar)
     and travel to the worklet as their own message — see engine.setMotion(). */
  for (const n of [1, 2]) {
    const g = 'mot' + n;
    b(g + '.on',    'On',     0);
    i(g + '.steps', 'Steps',  2, MOTION_STEPS, 16);
    e(g + '.div',   'Div',    DIVS, '1_16');
    f(g + '.rate',  'Rate',   0.05, 40, 4, FREQ);
    b(g + '.sync',  'Sync',   1);
    f(g + '.slew',  'Slew',   0, 1, 0);
    e(g + '.mode',  'Mode',   MOTION_MODES, 'loop');
    f(g + '.depth', 'Depth',  0, 1, 1);
  }

  /* ════════════════ MOD MATRIX ════════════════ */
  for (let s = 1; s <= MATRIX_SLOTS; s++) {
    e('mtx' + s + '.src', 'Source', MOD_SOURCES, 'none');
    e('mtx' + s + '.dst', 'Dest',   MOD_DESTS,   'none');
    f('mtx' + s + '.amt', 'Amount', -1, 1, 0);
    b('mtx' + s + '.uni', 'Unipolar', 0);
  }

  /* ════════════════ MACROS ════════════════
     Macros are ordinary mod sources; what makes them "big moves with little
     motion" is that one knob can drive up to MATRIX_SLOTS destinations at
     once, each with its own signed depth. */
  for (let m = 1; m <= MACRO_COUNT; m++) {
    f('macro.' + m, 'Macro ' + m, 0, 1, 0);
  }

  /* ════════════════ FX (host-side native nodes) ════════════════ */
  const H = { target: 'host' };
  b('fx.drive.on',      'Drive On', 0, H);
  e('fx.drive.type',    'Type', DRIVE_TYPES, 'tube', H);
  f('fx.drive.amount',  'Amount', 0, 1, 0.3, H);
  f('fx.drive.tone',    'Tone', 0, 1, 0.5, H);
  f('fx.drive.mix',     'Mix', 0, 1, 1, H);

  /* Bit/rate reduction lives in the synth worklet rather than the native FX
     chain: sample-and-hold has no Web Audio node, and the worklet's output
     stage is already the right place for it. */
  b('fx.crush.on',      'Crush On', 0);
  f('fx.crush.bits',    'Bits', 1, 16, 12, { step: 1 });
  f('fx.crush.rate',    'Rate', 0.02, 1, 1);
  f('fx.crush.mix',     'Mix', 0, 1, 1);

  b('fx.chorus.on',     'Chorus On', 0, H);
  f('fx.chorus.rate',   'Rate', 0.02, 8, 0.6, Object.assign({ curve: 'exp' }, H));
  f('fx.chorus.depth',  'Depth', 0, 1, 0.4, H);
  f('fx.chorus.spread', 'Spread', 0, 1, 0.7, H);
  i('fx.chorus.voices', 'Voices', 1, 4, 2, H);
  f('fx.chorus.mix',    'Mix', 0, 1, 0.4, H);

  b('fx.phaser.on',     'Phaser On', 0, H);
  f('fx.phaser.rate',   'Rate', 0.02, 8, 0.3, Object.assign({ curve: 'exp' }, H));
  f('fx.phaser.depth',  'Depth', 0, 1, 0.6, H);
  f('fx.phaser.fb',     'Feedback', 0, 0.95, 0.4, H);
  i('fx.phaser.stages', 'Stages', 2, 12, 6, H);
  f('fx.phaser.mix',    'Mix', 0, 1, 0.5, H);

  b('fx.delay.on',      'Delay On', 0, H);
  b('fx.delay.sync',    'Sync', 1, H);
  e('fx.delay.div',     'Div', DIVS, '1_8', H);
  f('fx.delay.time',    'Time', 0.01, 2, 0.35, Object.assign({ curve: 'exp', unit: 's' }, H));
  f('fx.delay.fb',      'Feedback', 0, 0.95, 0.35, H);
  f('fx.delay.pong',    'Ping-Pong', 0, 1, 0, H);
  f('fx.delay.tone',    'Tone', 0, 1, 0.5, H);
  f('fx.delay.mix',     'Mix', 0, 1, 0.25, H);

  b('fx.reverb.on',     'Reverb On', 0, H);
  f('fx.reverb.size',   'Size', 0, 1, 0.55, H);
  f('fx.reverb.decay',  'Decay', 0.2, 12, 2.4, Object.assign({ curve: 'exp', unit: 's' }, H));
  f('fx.reverb.damp',   'Damping', 0, 1, 0.4, H);
  f('fx.reverb.pre',    'Pre-Delay', 0, 0.25, 0.01, Object.assign({ unit: 's' }, H));
  f('fx.reverb.width',  'Width', 0, 1, 1, H);
  f('fx.reverb.mix',    'Mix', 0, 1, 0.25, H);

  f('fx.eq.low',   'Low',   -18, 18, 0, Object.assign({ unit: 'dB' }, H));
  f('fx.eq.lowF',  'Low F', 40, 800, 180, Object.assign({ curve: 'exp', unit: 'Hz' }, H));
  f('fx.eq.mid',   'Mid',   -18, 18, 0, Object.assign({ unit: 'dB' }, H));
  f('fx.eq.midF',  'Mid F', 200, 6000, 1200, Object.assign({ curve: 'exp', unit: 'Hz' }, H));
  f('fx.eq.midQ',  'Mid Q', 0.2, 8, 1, H);
  f('fx.eq.high',  'High',  -18, 18, 0, Object.assign({ unit: 'dB' }, H));
  f('fx.eq.highF', 'High F', 1500, 16000, 6000, Object.assign({ curve: 'exp', unit: 'Hz' }, H));

  b('fx.comp.on',      'Comp On', 0, H);
  f('fx.comp.thresh',  'Threshold', -60, 0, -18, Object.assign({ unit: 'dB' }, H));
  f('fx.comp.ratio',   'Ratio', 1, 20, 4, H);
  f('fx.comp.attack',  'Attack', 0.0005, 0.2, 0.005, Object.assign({ curve: 'exp', unit: 's' }, H));
  f('fx.comp.release', 'Release', 0.01, 1.5, 0.18, Object.assign({ curve: 'exp', unit: 's' }, H));
  f('fx.comp.makeup',  'Makeup', 0, 18, 0, Object.assign({ unit: 'dB' }, H));

  f('fx.width',   'Stereo Width', 0, 2, 1, H);
  f('master.vol', 'Volume', 0, 1.4, 0.8, H);
  b('master.limit', 'Limiter', 1, H);

  /* ════════════════ ARPEGGIATOR ════════════════ */
  b('arp.on',      'Arp On', 0, H);
  e('arp.pattern', 'Pattern', ARP_PATTERNS, 'up', H);
  i('arp.oct',     'Octaves', 1, 4, 1, H);
  e('arp.div',     'Rate', DIVS, '1_16', H);
  f('arp.gate',    'Gate', 0.05, 2, 0.6, H);
  f('arp.swing',   'Swing', 0, 0.75, 0, H);
  b('arp.latch',   'Latch', 0, H);
  e('arp.vel',     'Velocity', ARP_VEL, 'played', H);
  i('arp.ratchet', 'Ratchet', 1, 4, 1, H);
  f('arp.chance',  'Chance', 0, 1, 1, H);

  /* ════════════════ Derived tables ════════════════ */
  const DSP_PARAMS  = PARAMS.filter(p => p.target === 'dsp');
  const HOST_PARAMS = PARAMS.filter(p => p.target === 'host');

  /* Worklet-side indices are dense over the dsp subset so the audio thread
     never carries the FX params it can't use. */
  DSP_PARAMS.forEach((p, n) => { p.dspIndex = n; });

  const GROUPS = [];
  const groupSeen = Object.create(null);
  PARAMS.forEach(p => {
    if (!groupSeen[p.group]) { groupSeen[p.group] = 1; GROUPS.push(p.group); }
  });

  /* ── Value conversion ──────────────────────────────────────────────────── */

  /** Raw (real units) → normalised 0…1, honouring the parameter's curve. */
  function toNorm(p, v) {
    if (typeof p === 'string') p = BY_ID[p];
    if (!p) return 0;
    if (p.type === 'enum') {
      const idx = typeof v === 'string' ? (p.optIndex[v] ?? 0) : v | 0;
      return p.max ? idx / p.max : 0;
    }
    if (p.type === 'bool') return v ? 1 : 0;
    const { min, max } = p;
    if (max === min) return 0;
    if (p.curve === 'exp') {
      const lo = Math.max(1e-6, min);
      return Math.log(clamp(v, lo, max) / lo) / Math.log(max / lo);
    }
    if (p.curve === 'pow') {
      const t = (clamp(v, min, max) - min) / (max - min);
      return Math.pow(t, 1 / (p.k || 3));
    }
    return (clamp(v, min, max) - min) / (max - min);
  }

  /** Normalised 0…1 → raw. Enums/bools/ints land on legal values. */
  function fromNorm(p, t) {
    if (typeof p === 'string') p = BY_ID[p];
    if (!p) return 0;
    t = clamp(t, 0, 1);
    if (p.type === 'enum') return p.options[Math.round(t * p.max)][0];
    if (p.type === 'bool') return t >= 0.5 ? 1 : 0;
    const { min, max } = p;
    let v;
    if (p.curve === 'exp') {
      const lo = Math.max(1e-6, min);
      v = lo * Math.pow(max / lo, t);
    } else if (p.curve === 'pow') {
      v = min + (max - min) * Math.pow(t, p.k || 3);
    } else {
      v = min + (max - min) * t;
    }
    if (p.step) v = Math.round(v / p.step) * p.step;
    return clamp(v, min, max);
  }

  /** Numeric form of a value, which is what both the worklet and Live want. */
  function toNumber(p, v) {
    if (typeof p === 'string') p = BY_ID[p];
    if (!p) return 0;
    if (p.type === 'enum') return typeof v === 'string' ? (p.optIndex[v] ?? p.defIndex) : v | 0;
    if (p.type === 'bool') return v ? 1 : 0;
    return +v;
  }

  /** Human-readable display string for the panel. */
  function format(p, v) {
    if (typeof p === 'string') p = BY_ID[p];
    if (!p) return '';
    if (p.type === 'enum') {
      const idx = typeof v === 'string' ? (p.optIndex[v] ?? 0) : v | 0;
      return (p.options[idx] || ['', '?'])[1];
    }
    if (p.type === 'bool') return v ? 'On' : 'Off';
    const n = +v;
    if (p.unit === 's') {
      if (n < 0.001) return '0 ms';
      return n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(n < 10 ? 2 : 1) + ' s';
    }
    if (p.unit === 'Hz') {
      if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2) + ' kHz';
      return n.toFixed(n < 10 ? 2 : 0) + ' Hz';
    }
    if (p.unit === 'dB') return (n > 0 ? '+' : '') + n.toFixed(1) + ' dB';
    if (p.unit === 'ct') return (n > 0 ? '+' : '') + Math.round(n) + '¢';
    if (p.unit === 'st') return (n > 0 ? '+' : '') + Math.round(n) + ' st';
    if (p.step === 1) return String(Math.round(n));
    if (p.min === -1 && p.max === 1) return (n > 0 ? '+' : '') + n.toFixed(2);
    if (p.min === 0 && p.max === 1) return Math.round(n * 100) + '%';
    return n.toFixed(2);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** A fresh patch: every parameter at its declared default. */
  function defaults() {
    const o = Object.create(null);
    PARAMS.forEach(p => { o[p.id] = p.def; });
    return o;
  }

  MS.PARAMS = PARAMS;
  MS.PARAM = BY_ID;
  MS.DSP_PARAMS = DSP_PARAMS;
  MS.HOST_PARAMS = HOST_PARAMS;
  MS.GROUPS = GROUPS;
  MS.paramDefaults = defaults;
  MS.toNorm = toNorm;
  MS.fromNorm = fromNorm;
  MS.toNumber = toNumber;
  MS.formatParam = format;
  MS.clamp = clamp;

  MS.WAVES = WAVES;
  MS.SUB_WAVES = SUB_WAVES;
  MS.NOISE_TYPES = NOISE_TYPES;
  MS.FILTER_MODELS = FILTER_MODELS;
  MS.FILTER_ROUTES = FILTER_ROUTES;
  MS.VOICE_MODES = VOICE_MODES;
  MS.LFO_SHAPES = LFO_SHAPES;
  MS.LFO_MODES = LFO_MODES;
  MS.DIVS = DIVS;
  MS.DIV_BEATS = DIV_BEATS;
  MS.MOTION_MODES = MOTION_MODES;
  MS.DRIVE_TYPES = DRIVE_TYPES;
  MS.ARP_PATTERNS = ARP_PATTERNS;
  MS.ARP_VEL = ARP_VEL;
  MS.MOD_SOURCES = MOD_SOURCES;
  MS.MOD_DESTS = MOD_DESTS;
  MS.MATRIX_SLOTS = MATRIX_SLOTS;
  MS.MACRO_COUNT = MACRO_COUNT;
  MS.MOTION_STEPS = MOTION_STEPS;

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
