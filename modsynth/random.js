/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — the random patch roller
   ───────────────────────────────────────────────────────────────────────────
   The dice used to pick a different factory patch. This rolls the parameters
   themselves, which is a different and much harder problem: there are 262 of
   them, and a uniform draw across all 262 is noise essentially every time.

   WHY UNIFORM FAILS, CONCRETELY

   Three separate reasons, each enough on its own:

     1. The knobs are not independent. A 4 ms attack with a 6 s release is not
        a sound anybody dialled in; a 20 s amp release on a polyphonic chord
        part is a permanent chord; a filter envelope of +0.9 under a cutoff
        already at 18 kHz does nothing at all. Character lives in the
        *relationships*, so the roll has to pick a character first and then
        roll inside it. That is what CHARS below is.

     2. Most declared ranges are far wider than the useful range, because the
        range exists to let a hand-built patch reach the extreme on purpose.
        `flt1.cutoff` is 20 Hz…20 kHz: below ~120 Hz the voice is gone, and a
        linear draw lands above 10 kHz half the time. `env1.a` reaches 12 s —
        a note that never arrives. `fx.delay.fb` reaches 0.95, which is a
        runaway. So the roller works in NORMALISED space (MS.fromNorm), where
        each parameter's own declared curve does the shaping, and then clamps
        to a sub-band of that. One number, 0.7 on cutoff, means "2.5 kHz"
        because params.js says the curve is exponential — the schema is doing
        the work, not a table of Hz values copied here.

     3. Most parameters should simply be at their default most of the time. A
        patch where every one of 262 values has moved is a patch with no
        shape: the ear hears a few decisions, not 262. So the roller starts
        from MS.paramDefaults() and writes only what it deliberately rolls.
        That also means a parameter appended to params.js tomorrow is safe by
        construction — it keeps its default until somebody puts it in a
        character here on purpose.

   THE THREE CLASSES

   Every parameter is in exactly one of these, and the class is the reasoning:

     FREE — any value in the declared range is a legitimate sound, so roll it
     flat. Oscillator wave, shape, pulse width, pan, unison detune/width/
     blend, LFO shape and skew, noise type, drive type, motion mode.

     SUB-RANGED — the declared range is right for a hand-built patch and wrong
     for a dice roll, so the character names a band inside it. Filter cutoff
     and resonance, every envelope segment, LFO rate, FM amount, delay and
     phaser feedback, reverb decay, crush bits. The ceilings in CAPS below are
     the ones that are about damage rather than taste: self-oscillation,
     runaway feedback, a release longer than the music.

     HELD — left at the default, always, with the reason:
       voice.poly, voice.hq      the phone caps polyphony anyway (_msxCap in
                                 index.html), and oversampling is a CPU
                                 decision, not a sound.
       voice.bendUp/Down,        tuning and MIDI response. A roll that detunes
       voice.transpose,          the instrument 40 cents or transposes it a
       voice.tune                tritone is not a new sound, it is a wrong note.
       osc*.keytrack             anything under 1 stops the oscillator
                                 following the keyboard — a drone, not a patch.
       osc1.oct/semi             osc 1 IS the note you played. Oscillators 2
                                 and 3 may take an octave or a fifth, from a
                                 pool, because that is a voicing; an arbitrary
                                 +3 semitones is a chord nobody asked for.
       mix.subOct                −1 is the sub. −2 under a chord is mud.
       master.vol, master.limit  level is calibrated by the app (MSX_CAL), and
       fx.width                  the limiter is the only thing between a roll
                                 and a loud mistake.
       fx.eq.*, fx.comp.*        mastering, not character. A random EQ curve is
                                 just a worse version of the same sound.
       voice.velAmt/velCurve,    velocity response. Most of mõdRïff plays its
       env*.vel, flt*.vel        parts at a steady velocity, so rolling this
                                 makes the patch inconsistent, not different.
       arp.*                     mõdRïff runs its own arpeggiator per part and
                                 never the synth's — which is why msxClassic()
                                 drops the factory Arp patches too.

   WHAT COMES BACK
     MS.rollPatch({part}) → { values, motion, label }
   `values` is a COMPLETE map (every id in MS.PARAMS), so a caller can write
   it over any base patch and get exactly this sound and nothing of the base.
   `motion` is the two 16-step lanes. `label` names the character that won, so
   the panel can say "Random · Pad" rather than just "Random".
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const R = Math.random;
  const pick    = a => a[Math.floor(R() * a.length)];
  const chance  = p => R() < p;
  const rnd     = (a, b) => a + R() * (b - a);
  /* Two draws averaged: still the whole band, but the middle far more often
     than the edges. Used where both ends are legal and the middle is what a
     person would have chosen — detune, widths, mix amounts. */
  const bell    = (a, b) => a + ((R() + R()) / 2) * (b - a);
  const band    = b => rnd(b[0], b[1]);

  /* ── Hard ceilings ────────────────────────────────────────────────────────
     Not taste — these are the values that make a roll unusable rather than
     unlucky. Everything here is well inside what params.js allows, because
     params.js has to let a hand-built patch reach the extreme deliberately. */
  const CAPS = {
    'flt1.res': 0.62,         // a ladder at 1.0 self-oscillates; a diode screams (lowered again below)
    'flt2.res': 0.5,
    'flt1.drive': 0.5,
    'flt2.drive': 0.4,
    'mix.drive': 0.45,
    'osc1.fb': 0.35,          // phase feedback: a little is warmth, all of it is noise
    'osc2.fb': 0.35,
    'osc3.fb': 0.35,
    'mix.fm': 0.62,
    'mix.fm3a': 0.5,
    'mix.fm3b': 0.55,
    'mix.ring': 0.34,         // ring mod removes the fundamental; past this the note is gone
    'env1.a': 1.2,            // seconds. A note that arrives later than this is a mistake
    'env1.r': 4.0,            // on a poly part a long release is a chord that never stops
    'fx.delay.fb': 0.55,      // declared 0.95 = runaway
    'fx.phaser.fb': 0.6,
    'fx.reverb.decay': 6.0,   // declared 12 s is a wash, not a room
    'fx.grit.amount': 0.7,
    'fx.drive.amount': 0.65,
  };
  /* The diode filter is the one model that is genuinely painful near the top
     of its own resonance range, so it gets its own lower ceiling. */
  const RES_BY_MODEL = { diode: 0.42, comb: 0.3, formant: 0.45 };

  /* ── Writing into the value map ───────────────────────────────────────────
     Everything goes through the schema: `n` rolls in normalised space so the
     declared curve shapes the draw, `raw` is for the handful of parameters
     already stated in units a person reads (semitones, cents, −1…1), and both
     clamp and quantise exactly as the engine would. */
  function Roll(v) { this.v = v; }
  Roll.prototype.has = function (id) { return !!MS.PARAM[id]; };
  Roll.prototype.put = function (id, x) {
    const p = MS.PARAM[id]; if (!p) return;
    if (p.type === 'enum' || p.type === 'bool') { this.v[id] = x; return; }
    if (CAPS[id] != null) x = Math.min(x, CAPS[id]);
    if (p.step) x = Math.round(x / p.step) * p.step;
    this.v[id] = MS.clamp(x, p.min, p.max);
  };
  /* A band in 0…1 of the parameter's own curve. One number means the same
     musical thing on every parameter, which is the whole point. */
  Roll.prototype.n = function (id, lo, hi) {
    const p = MS.PARAM[id]; if (!p) return;
    this.put(id, MS.fromNorm(p, hi == null ? lo : rnd(lo, hi)));
  };
  Roll.prototype.nb = function (id, lo, hi) {      // same, centre-weighted
    const p = MS.PARAM[id]; if (!p) return;
    this.put(id, MS.fromNorm(p, hi == null ? lo : bell(lo, hi)));
  };
  Roll.prototype.raw = function (id, lo, hi) { this.put(id, hi == null ? lo : rnd(lo, hi)); };
  Roll.prototype.on  = function (id, p) { if (this.has(id)) this.v[id] = chance(p) ? 1 : 0; };
  Roll.prototype.set = function (id, x) { if (this.has(id)) this.v[id] = x; };
  /* An enum from a pool, intersected with the options that actually exist —
     so a wave removed from params.js becomes a narrower pool, not a crash. */
  Roll.prototype.opt = function (id, pool) {
    const p = MS.PARAM[id]; if (!p || p.type !== 'enum') return;
    const ok = (pool || []).filter(k => k in p.optIndex);
    this.v[id] = ok.length ? pick(ok) : p.def;
  };

  /* ── Pitch pools ──────────────────────────────────────────────────────────
     Oscillator 2 and 3 may sit an octave away, a fifth away, or in unison.
     Unison is weighted heavily because unison-with-detune is what makes a
     synth sound like two oscillators rather than two notes. Nothing else is
     in the pool: an arbitrary interval is a chord the player did not ask for,
     and it fights every chord the app puts under it. */
  const SEMI_POOL = [0, 0, 0, 0, 0, 7, 7, 12, -12, 5];
  const OCT_POOL  = [0, 0, 0, -1, 1];

  /* ── Wave families ───────────────────────────────────────────────────────*/
  const W_ANALOG  = ['classic', 'pulse', 'supersaw', 'vintage', 'czsaw', 'sync'];
  const W_ORGANIC = ['harmonic', 'reed', 'string', 'hollow', 'formant', 'vocal'];
  const W_METAL   = ['bell', 'glass', 'metal', 'digital', 'czres'];
  const W_DIRTY   = ['growl', 'fold', 'noise', 'chip', 'czpulse'];

  /* The waves whose energy is all in the upper partials. Measured: a 'bell'
     or 'metal' table under a 216 Hz low-pass renders 40 dB below the same
     roll with a 'classic' saw, because the filter is removing the entire
     sound rather than the top of it. The audit couples the two. */
  const W_BRIGHT = ['bell', 'glass', 'metal', 'digital', 'czres', 'formant', 'vocal', 'chip', 'noise'];

  const FLT_CLEAN = ['ladder4', 'ladder2', 'svfLP', 'svfLP'];
  const FLT_WIDE  = ['ladder4', 'ladder2', 'svfLP', 'svfBP', 'svfPeak', 'diode'];
  /* The one model that does not pass the note: a band-pass passes a WINDOW,
     so its cutoff belongs on the harmonics rather than above them. Measured
     against a 262 Hz saw: svfBP at 300 Hz is louder than svfLP, at 6 kHz it
     is 13 dB down, and over a 41 Hz bass note a roll landed 50 dB down — the
     quietest rolls in the whole set were every one of them this. Peak and
     notch are in neither list: peak is a boost over the full band and notch
     removes one narrow strip, and both measured within 5 dB of bypass. */
  const FLT_BAND  = ['svfBP'];
  /* The lowest note each part plays, near enough: the cutoff floor below
     which the filter is a mute rather than a tone control. */
  const PART_LOW = { bass: 41, chord: 131, mel: 196, melgen: 147, arp: 196 };

  /* Measured output level of each filter model, as a multiplier that brings
     it back to the middle of the set. A saw at 262 Hz through each model at
     three cutoffs, 0.3 resonance, no filter envelope: the ladders and the
     diode sit 4–5 dB under svfPeak and the comb, which is enough that
     "this roll is quiet" and "this roll picked a ladder" were the same
     sentence. Taken out of the level budget below rather than left to the
     limiter, which only ever takes level away. */
  const FLT_GAIN = {
    bypass: 0.98, ladder4: 1.66, ladder2: 1.51, svfLP: 0.87, svfHP: 1.0,
    svfBP: 1.56, svfNotch: 1.0, svfPeak: 0.65, diode: 1.66, comb: 0.54, formant: 0.78,
  };

  /* ══════════════════════════ CHARACTERS ══════════════════════════════════
     Each one is a coherent instrument, not a region of parameter space: the
     bands below are what that instrument's knobs look like when somebody has
     built it on purpose. `parts` is how often the character comes up for each
     mõdSynth part — the bass part should not often roll a pad, and the chord
     part should not often roll a mono bass — and 0 means never.

     Band conventions:
       cut/res/a/d/r/e2*   normalised 0…1 (the parameter's own curve)
       s/fenv              real units, because they are already 0…1 / −1…1
       det                 cents, uni  a pool of unison voice counts
       osc2/osc3/*P        probabilities
   ═══════════════════════════════════════════════════════════════════════════ */
  const CHARS = [
    { id: 'keys', label: 'Keys',
      parts: { chord: 6, mel: 3, melgen: 3, arp: 2, bass: 0 },
      waves: W_ANALOG.concat(W_ORGANIC), modes: ['poly'],
      models: FLT_CLEAN, cut: [.6, .86], res: [0, .3], fenv: [.02, .35],
      a: [.03, .10], d: [.30, .50], s: [.25, .60], r: [.20, .40],
      e2a: [.02, .09], e2d: [.25, .50],
      uni: [1, 1, 2, 2, 3], det: [8, 26],
      osc2: .65, osc3: .12, subP: .30, noiseP: .10, pluckP: .18, fmP: .12,
      lfoP: .45, motP: .10, routes: [0, 1, 1, 2, 2, 3],
      fx: { chorus: .45, delay: .30, reverb: .60, drive: .30, phaser: .12, crush: .05, ott: .22, grit: .10 } },

    { id: 'pad', label: 'Pad',
      parts: { chord: 5, mel: 2, melgen: 1, arp: 1, bass: 0 },
      waves: W_ANALOG.concat(W_ORGANIC, ['supersaw', 'supersaw']), modes: ['poly'],
      models: FLT_CLEAN, cut: [.48, .76], res: [0, .35], fenv: [-.2, .4],
      a: [.18, .33], d: [.40, .60], s: [.60, .92], r: [.34, .52],
      e2a: [.12, .30], e2d: [.40, .62],
      uni: [2, 3, 3, 4, 4], det: [14, 44],
      osc2: .8, osc3: .25, subP: .25, noiseP: .25, pluckP: .05, fmP: .08,
      lfoP: .75, motP: .18, routes: [1, 1, 2, 2, 3, 3],
      fx: { chorus: .7, delay: .35, reverb: .85, drive: .2, phaser: .3, crush: .04, ott: .2, grit: .08 } },

    { id: 'pluck', label: 'Plucked',
      parts: { chord: 4, mel: 4, melgen: 6, arp: 7, bass: 1 },
      waves: W_ANALOG.concat(W_METAL, ['string', 'reed']), modes: ['poly'],
      models: FLT_WIDE, cut: [.55, .82], res: [.05, .5], fenv: [.25, .78],
      a: [.02, .07], d: [.20, .36], s: [0, .14], r: [.14, .30],
      e2a: [.015, .05], e2d: [.16, .34],
      uni: [1, 1, 1, 2, 2], det: [6, 22],
      osc2: .55, osc3: .12, subP: .25, noiseP: .12, pluckP: .45, fmP: .2,
      lfoP: .2, motP: .12, routes: [0, 0, 1, 1, 2, 2],
      fx: { chorus: .3, delay: .5, reverb: .55, drive: .35, phaser: .1, crush: .1, ott: .3, grit: .18 } },

    { id: 'bass', label: 'Bass',
      parts: { chord: 0, mel: 1, melgen: 2, arp: 2, bass: 9 },
      waves: W_ANALOG.concat(W_DIRTY, ['classic', 'classic']), modes: ['mono', 'mono', 'legato', 'unison'],
      models: ['ladder4', 'ladder4', 'ladder2', 'diode', 'svfLP'],
      cut: [.33, .62], res: [.08, .5], fenv: [.2, .8],
      a: [.02, .06], d: [.20, .42], s: [.08, .6], r: [.12, .26],
      e2a: [.01, .05], e2d: [.18, .40],
      uni: [1, 1, 2, 2, 4], det: [8, 30],
      osc2: .6, osc3: .15, subP: .75, noiseP: .06, pluckP: .12, fmP: .18,
      lfoP: .15, motP: .1, routes: [0, 0, 1, 1, 2],
      fx: { chorus: .12, delay: .12, reverb: .18, drive: .5, phaser: .08, crush: .12, ott: .45, grit: .35 } },

    { id: 'lead', label: 'Lead',
      parts: { chord: 1, mel: 7, melgen: 4, arp: 3, bass: 2 },
      waves: W_ANALOG.concat(W_ORGANIC, W_DIRTY), modes: ['mono', 'legato', 'legato', 'unison'],
      models: FLT_WIDE, cut: [.58, .88], res: [.05, .45], fenv: [.05, .55],
      a: [.04, .14], d: [.30, .50], s: [.45, .88], r: [.18, .36],
      e2a: [.02, .10], e2d: [.26, .50],
      uni: [1, 2, 2, 3, 4], det: [8, 32],
      osc2: .7, osc3: .18, subP: .3, noiseP: .08, pluckP: .08, fmP: .18,
      lfoP: .6, motP: .1, routes: [1, 1, 2, 2, 3],
      fx: { chorus: .35, delay: .6, reverb: .55, drive: .4, phaser: .15, crush: .07, ott: .25, grit: .2 } },

    { id: 'bell', label: 'Bell',
      parts: { chord: 3, mel: 3, melgen: 4, arp: 5, bass: 1 },
      waves: W_METAL.concat(['harmonic', 'formant', 'digital']), modes: ['poly'],
      models: ['svfLP', 'svfLP', 'ladder2', 'bypass', 'svfPeak'],
      cut: [.74, 1], res: [0, .3], fenv: [.05, .5],
      a: [.02, .06], d: [.34, .56], s: [0, .22], r: [.2, .40],
      e2a: [.015, .06], e2d: [.3, .55],
      uni: [1, 1, 1, 2], det: [4, 16],
      osc2: .85, osc3: .45, subP: .12, noiseP: .06, pluckP: .18, fmP: .8,
      lfoP: .3, motP: .1, routes: [0, 1, 1, 2, 2],
      fx: { chorus: .4, delay: .55, reverb: .7, drive: .18, phaser: .1, crush: .08, ott: .18, grit: .08 } },

    { id: 'texture', label: 'Texture',
      parts: { chord: 2, mel: 2, melgen: 2, arp: 2, bass: 1 },
      waves: W_DIRTY.concat(W_METAL, W_ORGANIC), modes: ['poly', 'poly', 'mono'],
      models: FLT_WIDE.concat(['comb', 'formant', 'svfNotch']),
      cut: [.4, .9], res: [.05, .55], fenv: [-.5, .6],
      a: [.08, .30], d: [.34, .60], s: [.3, .85], r: [.3, .52],
      e2a: [.04, .25], e2d: [.3, .6],
      uni: [1, 2, 3, 4], det: [10, 50],
      osc2: .7, osc3: .35, subP: .3, noiseP: .6, pluckP: .2, fmP: .35,
      lfoP: .85, motP: .55, routes: [2, 2, 3, 3, 4],
      fx: { chorus: .45, delay: .6, reverb: .7, drive: .35, phaser: .35, crush: .3, ott: .3, grit: .25 } },
  ];

  /* The part biases above as a bag, so the draw itself stays a flat pick. */
  function charFor(part) {
    const bag = [];
    CHARS.forEach(c => {
      const w = (c.parts && c.parts[part] != null) ? c.parts[part] : 3;
      for (let i = 0; i < w; i++) bag.push(c);
    });
    return bag.length ? pick(bag) : CHARS[0];
  }

  /* ── Modulation routes ────────────────────────────────────────────────────
     A curated list, because this is where a uniform roll does the most damage:
     the matrix can point anything at anything, and most of those pairings are
     either inaudible or a siren. Amounts are in the destination's own scale
     (from dsp.js, as the Modern bank's header states: pitch 1.0 = 24 st,
     cutoff 1.0 = 8 octaves, detune 1.0 = 100 cents, amp 1.0 = +100 %,
     rate 1.0 = ×16), which is why the pitch routes look so small — 0.02 on
     `pitch` is half a semitone, and that is already a wide vibrato.

     `w` is weight, `u` forces unipolar (a bipolar tremolo is twice as loud on
     the way up as a patch expects), `need` asks for the source to be set up
     first — an LFO, the motion lane — and is handled by the caller. */
  const ROUTES = [
    { src: 'lfo1', dst: 'osc1.fine', amt: [.03, .14], w: 6, need: 'lfo' },      // vibrato, 3…14 cents
    { src: 'lfo1', dst: 'flt1.cutoff', amt: [.05, .3], w: 7, need: 'lfo' },     // 0.4…2.4 octaves
    { src: 'lfo1', dst: 'osc1.shape', amt: [.1, .5], w: 5, need: 'lfo' },
    { src: 'lfo1', dst: 'osc1.pw', amt: [.1, .45], w: 4, need: 'lfo' },
    { src: 'lfo1', dst: 'amp', amt: [.1, .35], w: 3, u: 1, need: 'lfo' },       // tremolo
    { src: 'lfo2', dst: 'pan', amt: [.2, .6], w: 3, need: 'lfo2' },
    { src: 'lfo2', dst: 'flt2.cutoff', amt: [.08, .35], w: 2, need: 'lfo2' },
    { src: 'lfo2', dst: 'osc2.fine', amt: [.04, .2], w: 3, need: 'lfo2' },
    { src: 'env3', dst: 'osc1.shape', amt: [-.6, .6], w: 5 },
    { src: 'env3', dst: 'mix.fm', amt: [.15, .5], w: 3 },
    { src: 'env3', dst: 'osc2.fine', amt: [-.3, .3], w: 3 },
    { src: 'env3', dst: 'flt2.cutoff', amt: [.1, .5], w: 3 },
    { src: 'env2', dst: 'mix.ring', amt: [.1, .3], w: 1 },
    /* Per-note variation. Tiny amounts, and the single most "played by hands"
       thing in the list: two notes of the same chord are never identical. */
    { src: 'rand', dst: 'osc1.fine', amt: [.02, .09], w: 6 },
    { src: 'rand', dst: 'flt1.cutoff', amt: [.03, .14], w: 5 },
    { src: 'rand2', dst: 'pan', amt: [.1, .45], w: 4 },
    { src: 'rand', dst: 'amp', amt: [.04, .14], w: 3, u: 1 },
    { src: 'chaos', dst: 'osc1.fine', amt: [.02, .1], w: 4 },
    { src: 'chaos', dst: 'flt1.cutoff', amt: [.05, .22], w: 4 },
    { src: 'chaos', dst: 'osc1.shape', amt: [.1, .4], w: 3 },
    { src: 'keytrack', dst: 'flt2.cutoff', amt: [.1, .4], w: 2 },
    { src: 'unison', dst: 'pan', amt: [.3, .9], w: 3 },
    { src: 'unison', dst: 'osc1.fine', amt: [.05, .2], w: 2 },
    { src: 'mot1', dst: 'flt1.cutoff', amt: [.1, .45], w: 6, need: 'mot1' },
    { src: 'mot1', dst: 'osc1.shape', amt: [.15, .6], w: 4, need: 'mot1' },
    { src: 'mot1', dst: 'amp', amt: [.15, .5], w: 3, u: 1, need: 'mot1' },
    { src: 'mot1', dst: 'osc1.fine', amt: [.04, .16], w: 2, need: 'mot1' },
  ];

  /* ── Motion lane shapes ───────────────────────────────────────────────────
     A lane of sixteen random steps is the one place where actual randomness
     sounds intentional, because the sequence repeats — the ear hears a riff,
     not noise. The other shapes give it somewhere to go. */
  const LANES = {
    steps:  () => Array.from({ length: 16 }, () => +(R() * 2 - 1).toFixed(3)),
    ramp:   () => Array.from({ length: 16 }, (_, i) => +(i / 15 * 2 - 1).toFixed(3)),
    fall:   () => Array.from({ length: 16 }, (_, i) => +(1 - i / 15 * 2).toFixed(3)),
    pulse:  () => Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 1 : -0.6)),
    octave: () => Array.from({ length: 16 }, (_, i) => (i % 2 ? 1 : 0)),
    /* Stepped but with repeats, so it has a figure rather than a shimmer. */
    riff:   () => { const n = pick([2, 3, 4]), f = Array.from({ length: n }, () => +(R() * 2 - 1).toFixed(3));
                    return Array.from({ length: 16 }, (_, i) => f[i % n]); },
  };
  const LANE_DIVS = ['1_16', '1_16', '1_8', '1_8', '1_4', '1_8t', '1_16t'];

  /* LFO divisions worth syncing to. The very long ones (8 bars) are a hand
     decision — on a dice roll they read as "nothing is moving". */
  const LFO_DIVS = ['1_1', '1_2', '1_4', '1_4', '1_8', '1_8', '1_4d', '1_8t', '1_16'];
  const DELAY_DIVS = ['1_8', '1_8', '1_16', '1_4', '1_8t', '1_4d'];

  /* ═══════════════════════════ THE ROLL ═══════════════════════════════════*/
  function rollPatch(opts) {
    opts = opts || {};
    const part = opts.part || 'chord';
    const C = opts.character ? (CHARS.find(c => c.id === opts.character) || charFor(part)) : charFor(part);
    const v = MS.paramDefaults();
    const r = new Roll(v);
    const motion = [null, null];

    /* ── Voice ──────────────────────────────────────────────────────────── */
    r.opt('voice.mode', C.modes);
    /* Glide belongs to a mono voice and nowhere else: on a poly part it slurs
       every chord change into the next. */
    const mono = v['voice.mode'] !== 'poly';
    if (mono && chance(.5)) { r.n('voice.glide', .08, .3); r.on('voice.glideAuto', .5); }
    r.nb('voice.drift', .08, .5);        // analog drift: always a little, never none
    if (chance(.4)) r.nb('voice.spread', .1, .5);

    /* ── Oscillators ─────────────────────────────────────────────────────── */
    const uni1 = pick(C.uni);
    r.set('osc1.on', 1);
    r.opt('osc1.wave', C.waves);
    r.n('osc1.shape', .05, .95);
    r.nb('osc1.pw', .2, .8);
    r.set('osc1.uni', uni1);
    if (uni1 > 1) { r.raw('osc1.detune', band(C.det)); r.nb('osc1.width', .35, 1); r.nb('osc1.blend', .5, .95); }
    if (chance(.25)) r.n('osc1.fb', .05, .5);
    r.raw('osc1.pan', -0.25, 0.25);

    const osc2 = chance(C.osc2);
    if (osc2) {
      r.set('osc2.on', 1);
      r.opt('osc2.wave', C.waves);
      r.n('osc2.shape', .05, .95);
      r.nb('osc2.pw', .2, .8);
      r.set('osc2.oct', pick(OCT_POOL));
      r.set('osc2.semi', pick(SEMI_POOL));
      /* A few cents off osc 1 is the beating that makes two oscillators one
         instrument. More than ~20 is out of tune rather than wide. */
      r.raw('osc2.fine', -18, 18);
      const u2 = pick(C.uni);
      r.set('osc2.uni', u2);
      if (u2 > 1) { r.raw('osc2.detune', band(C.det)); r.nb('osc2.width', .35, 1); }
      r.raw('osc2.pan', -0.35, 0.35);
      if (chance(.2)) r.n('osc2.fb', .05, .5);
      /* Hard sync is a single unmistakable sound and wants the shape movement
         that makes it sweep, so it comes with a shape route below. */
      r.on('osc2.sync', .12);
    }

    /* Osc 3 exists for FM. On its own it is a third of the same oscillator,
       which is rarely what makes a roll interesting, so it mostly arrives as
       an operator — see the FM block. */
    const fm = chance(C.fmP);
    const osc3 = chance(C.osc3) || (fm && chance(.5));
    if (osc3) {
      r.set('osc3.on', 1);
      r.opt('osc3.wave', fm ? ['classic', 'harmonic', 'bell', 'digital', 'glass', 'formant'] : C.waves);
      r.n('osc3.shape', .05, .95);
      r.set('osc3.oct', pick(OCT_POOL));
      r.set('osc3.semi', pick(SEMI_POOL));
      r.raw('osc3.fine', -12, 12);
      /* As an operator its level is not what you hear, so it stays low unless
         it is being heard in its own right. */
      r.n('osc3.level', fm ? .0 : .25, fm ? .12 : .6);
    }

    /* ── FM ───────────────────────────────────────────────────────────────
       FM is only musical when the modulator is at a whole-number ratio to the
       carrier; off-ratio it is the inharmonic clang that gives random patches
       their reputation. osc2.ratio locks it, so FM always sets it. */
    if (fm && osc2) {
      r.set('osc2.ratio', 1);
      r.n('mix.fm', .15, .85);
      /* The DX stack: 3 → 2 → 1 is the bell and electric-piano algorithm. */
      if (osc3 && chance(.6)) r.n('mix.fm3b', .15, .8);
      if (osc3 && chance(.35)) r.n('mix.fm3a', .1, .6);
    } else if (fm && osc3) {
      r.n('mix.fm3a', .15, .7);
    }
    if (chance(.1)) r.n('mix.ring', .2, .9);

    /* ── The other sources ────────────────────────────────────────────────*/
    if (chance(C.subP)) {
      r.n('mix.sub', .3, .9);
      r.opt('mix.subWave', ['sine', 'sine', 'tri', 'square', 'saw']);
    }
    if (chance(C.noiseP)) {
      r.n('mix.noise', .08, C.id === 'texture' ? .7 : .4);
      r.opt('mix.noiseType', ['white', 'pink', 'pink', 'blue', 'crackle']);
      r.nb('mix.noiseFlt', .25, 1);
    }
    if (chance(C.pluckP)) {
      r.n('mix.pluck', .25, .8);
      r.nb('pluck.decay', .25, .85);
      r.nb('pluck.tone', .25, .9);
      r.set('pluck.oct', pick([0, 0, -1, 1]));
    }
    if (chance(.4)) { r.n('mix.drive', .1, .9); r.opt('mix.driveType', ['soft', 'soft', 'asym', 'fold', 'rect']); }

    /* ── Filters ──────────────────────────────────────────────────────────*/
    const m1 = pick(C.models);
    r.set('flt1.model', m1);
    r.n('flt1.cutoff', C.cut[0], C.cut[1]);
    const resCap = Math.min(CAPS['flt1.res'], RES_BY_MODEL[m1] != null ? RES_BY_MODEL[m1] : 1);
    r.put('flt1.res', Math.min(band(C.res), resCap));
    r.n('flt1.drive', .05, .9);
    r.raw('flt1.env', band(C.fenv));
    /* Key tracking keeps a filtered patch even across the keyboard. Negative
       tracking is a real choice but a strange default, so it is rare. */
    r.raw('flt1.keytrack', chance(.8) ? rnd(0, .8) : rnd(-.5, 0));
    if (chance(.3)) r.nb('flt.spread', .15, .7);
    /* Filter 2 earns its place when it is doing a job: a high-pass cleaning
       the bottom off a bright patch, or a second pole in series. Rolled in
       parallel with a band-pass it mostly just makes the patch quieter. */
    if (chance(.3)) {
      const m2 = pick(['svfHP', 'svfHP', 'ladder2', 'svfBP', 'svfLP']);
      r.set('flt2.model', m2);
      r.n('flt2.cutoff', m2 === 'svfHP' ? .08 : .5, m2 === 'svfHP' ? .4 : .9);
      r.put('flt2.res', Math.min(rnd(0, .4), RES_BY_MODEL[m2] != null ? RES_BY_MODEL[m2] : 1));
      r.opt('flt.route', ['serial', 'serial', 'parallel']);
      if (v['flt.route'] !== 'serial') r.nb('flt.blend', .3, .7);
    }

    /* ── Envelopes ────────────────────────────────────────────────────────
       Amp first, then the filter envelope shaped to match it: a filter decay
       much longer than the amp decay is a sweep nobody hears. */
    r.n('env1.a', C.a[0], C.a[1]);
    r.n('env1.d', C.d[0], C.d[1]);
    r.raw('env1.s', band(C.s));
    r.n('env1.r', C.r[0], C.r[1]);
    r.raw('env1.curve', -0.6, 0.6);
    if (chance(.18)) r.n('env1.h', .05, .25);

    r.n('env2.a', C.e2a[0], C.e2a[1]);
    r.n('env2.d', C.e2d[0], C.e2d[1]);
    r.raw('env2.s', rnd(0, .6));
    r.n('env2.r', .14, .4);
    r.raw('env2.curve', -0.7, 0.7);

    /* Env 3 is the free one — it only does anything if the matrix points it
       somewhere, so it can take a wider shape than the two that are wired. */
    r.n('env3.a', .02, .35);
    r.n('env3.d', .2, .6);
    r.raw('env3.s', rnd(0, .8));
    r.n('env3.r', .15, .45);
    r.on('env3.loop', .18);

    /* ── LFOs ─────────────────────────────────────────────────────────────
       An LFO that nothing listens to is silent, so these are set up here and
       the matrix below decides whether they are heard. Sync or free: synced
       movement locks to the song, free movement is the slow drift that makes
       a pad breathe. */
    const lfo1 = chance(C.lfoP);
    if (lfo1) {
      r.opt('lfo1.shape', ['sine', 'sine', 'tri', 'saw', 'ramp', 'square', 'sh', 'smooth', 'exp', 'trap']);
      if (chance(.5)) { r.set('lfo1.sync', 1); r.opt('lfo1.div', LFO_DIVS); }
      else r.n('lfo1.rate', .25, .72);      // ≈0.35…8 Hz on the declared exp curve
      r.nb('lfo1.depth', .5, 1);
      r.nb('lfo1.phase', 0, 1);
      if (chance(.4)) r.n('lfo1.delay', .08, .3);
      if (chance(.4)) r.n('lfo1.fade', .1, .4);
      if (chance(.3)) r.nb('lfo1.smooth', .2, .8);
      r.opt('lfo1.mode', ['poly', 'poly', 'mono', 'free']);
      r.nb('lfo1.pw', .25, .75);
    }
    const lfo2 = lfo1 && chance(.4);
    if (lfo2) {
      r.opt('lfo2.shape', ['sine', 'tri', 'smooth', 'sh', 'saw']);
      if (chance(.4)) { r.set('lfo2.sync', 1); r.opt('lfo2.div', LFO_DIVS); }
      else r.n('lfo2.rate', .1, .6);        // slower than LFO 1 by habit
      r.nb('lfo2.depth', .5, 1);
      r.nb('lfo2.phase', 0, 1);
      r.opt('lfo2.mode', ['poly', 'mono', 'free']);
    }

    /* ── Motion lanes ─────────────────────────────────────────────────────*/
    const mot1 = chance(C.motP);
    if (mot1) {
      r.set('mot1.on', 1);
      r.set('mot1.steps', pick([8, 16, 16, 4, 12]));
      r.set('mot1.sync', 1);
      r.opt('mot1.div', LANE_DIVS);
      r.opt('mot1.mode', ['loop', 'loop', 'loop', 'pong', 'random']);
      r.nb('mot1.depth', .6, 1);
      if (chance(.4)) r.nb('mot1.slew', .15, .7);
      motion[0] = LANES[pick(['steps', 'riff', 'riff', 'ramp', 'fall', 'pulse', 'octave'])]();
    }

    /* ── Mod matrix ───────────────────────────────────────────────────────*/
    const have = { lfo: lfo1, lfo2: lfo2, mot1: mot1 };
    const bag = [];
    /* The matrix's own option lists are the authority on what can be wired —
       a source or destination renamed in params.js drops its route here
       rather than writing a value the engine cannot read. */
    const SRC = MS.PARAM['mtx1.src'].optIndex, DST = MS.PARAM['mtx1.dst'].optIndex;
    ROUTES.forEach(rt => {
      if (!(rt.src in SRC) || !(rt.dst in DST)) return;
      if (rt.need && !have[rt.need]) return;
      if (/^osc2\./.test(rt.dst) && !osc2) return;
      if (/^mix\.fm/.test(rt.dst) && !fm) return;
      if (rt.dst === 'flt2.cutoff' && v['flt2.model'] === 'bypass') return;
      if (rt.dst === 'mix.ring' && !(+v['mix.ring'] > 0)) return;
      if (rt.src === 'unison' && !(uni1 > 1)) return;
      for (let i = 0; i < rt.w; i++) bag.push(rt);
    });
    /* Hard sync without something sweeping the shape is one static buzz. */
    const forced = [];
    if (v['osc2.sync'] && osc2 && ('osc2.fine' in DST)) {
      forced.push({ src: lfo1 ? 'lfo1' : 'env3', dst: 'osc2.fine', amt: [.3, .9] });
    }
    const want = pick(C.routes) + forced.length;
    const used = forced.slice();
    let guard = 0;
    while (used.length < Math.min(want, MS.MATRIX_SLOTS) && bag.length && guard++ < 60) {
      const rt = pick(bag);
      if (used.some(u => u.src === rt.src && u.dst === rt.dst)) continue;
      used.push(rt);
    }
    used.forEach((rt, i) => {
      const n = 'mtx' + (i + 1) + '.';
      r.set(n + 'src', rt.src);
      r.set(n + 'dst', rt.dst);
      r.raw(n + 'amt', band(rt.amt) * (rt.u ? 1 : (chance(.25) ? -1 : 1)));
      r.set(n + 'uni', rt.u ? 1 : 0);
    });

    /* ── Macros ───────────────────────────────────────────────────────────
       Left at zero. A macro is a route somebody wired on purpose, and a macro
       at a random position is a patch that does not match its own knobs —
       the panel would show four dials that mean nothing. */

    /* ── FX ───────────────────────────────────────────────────────────────
       Each one is a decision about the sound, not a wash over it: the mix
       amounts stay in the range where you still hear the instrument. */
    const F = C.fx;
    if (chance(F.drive)) {
      r.set('fx.drive.on', 1);
      r.opt('fx.drive.type', MS.DRIVE_TYPES ? MS.DRIVE_TYPES.map(d => d[0]) : ['tube']);
      r.n('fx.drive.amount', .15, .8);
      r.nb('fx.drive.tone', .2, .85);
      r.nb('fx.drive.mix', .55, 1);
    }
    if (chance(F.grit)) {
      r.set('fx.grit.on', 1);
      r.n('fx.grit.amount', .2, .85);
      r.nb('fx.grit.tone', .3, .9);
      r.nb('fx.grit.mix', .5, 1);
    }
    if (chance(F.ott)) {
      r.set('fx.ott.on', 1);
      r.nb('fx.ott.depth', .2, .75);
      r.nb('fx.ott.time', .15, .6);
      r.nb('fx.ott.upward', .3, .8);
    }
    if (chance(F.crush)) {
      r.set('fx.crush.on', 1);
      r.raw('fx.crush.bits', 4, 11);
      r.nb('fx.crush.rate', .25, 1);
      r.nb('fx.crush.mix', .3, .85);
    }
    if (chance(F.chorus)) {
      r.set('fx.chorus.on', 1);
      r.n('fx.chorus.rate', .15, .65);
      r.nb('fx.chorus.depth', .2, .8);
      r.nb('fx.chorus.spread', .4, 1);
      r.set('fx.chorus.voices', pick([2, 2, 3, 4]));
      r.nb('fx.chorus.mix', .2, .65);
    }
    if (chance(F.phaser)) {
      r.set('fx.phaser.on', 1);
      r.n('fx.phaser.rate', .1, .5);
      r.nb('fx.phaser.depth', .35, .9);
      r.n('fx.phaser.fb', .2, .9);
      r.set('fx.phaser.stages', pick([4, 6, 6, 8, 12]));
      r.nb('fx.phaser.mix', .25, .7);
    }
    if (chance(F.delay)) {
      r.set('fx.delay.on', 1);
      /* Synced, nearly always: a free-running delay against a sequencer is
         the one FX choice that can make a whole roll unusable. */
      if (chance(.9)) { r.set('fx.delay.sync', 1); r.opt('fx.delay.div', DELAY_DIVS); }
      else { r.set('fx.delay.sync', 0); r.n('fx.delay.time', .2, .7); }
      r.n('fx.delay.fb', .15, .8);
      r.nb('fx.delay.pong', 0, 1);
      r.nb('fx.delay.tone', .25, .8);
      r.nb('fx.delay.mix', .1, .45);
    }
    if (chance(F.reverb)) {
      r.set('fx.reverb.on', 1);
      r.nb('fx.reverb.size', .25, .9);
      r.n('fx.reverb.decay', .15, .8);
      r.nb('fx.reverb.damp', .2, .8);
      r.n('fx.reverb.pre', 0, .5);
      r.nb('fx.reverb.width', .6, 1);
      r.nb('fx.reverb.mix', .12, .45);
    }

    levels(v, C);
    audit(v, part);
    return { values: v, motion: motion, label: C.label, character: C.id };
  }

  /* ── Level matching ───────────────────────────────────────────────────────
     Six sources each rolled to 0.8 is six times the signal of one, and the
     app's calibration (MSX_CAL) is measured against patches that sum to about
     one. Without this the dice is also a volume control, which is how a roll
     gets blamed for sounding bad when it is only sounding loud. The shares
     are kept — the balance between the sources is part of the sound — and the
     sum is scaled to land where a factory patch lands. */
  function levels(v, C) {
    const src = ['osc1.level', 'osc2.level', 'osc3.level', 'mix.sub', 'mix.noise', 'mix.pluck'];
    /* Osc 1 is the patch; give it a definite share before anything is scaled. */
    v['osc1.level'] = rnd(.6, .9);
    if (v['osc2.on']) v['osc2.level'] = rnd(.3, .8);
    let sum = 0;
    src.forEach(id => { if (MS.PARAM[id]) sum += +v[id] || 0; });
    /* Noise and the pluck burst are transients and read quieter than their
       number suggests, so they only count partly toward the budget. */
    sum -= 0.45 * ((+v['mix.noise'] || 0) + (+v['mix.pluck'] || 0));
    const target = rnd(.95, 1.15) * (FLT_GAIN[v['flt1.model']] || 1);
    if (sum > 0.05) {
      const k = target / sum;
      src.forEach(id => { const p = MS.PARAM[id]; if (p) v[id] = MS.clamp((+v[id] || 0) * k, p.min, p.max); });
    }
    /* Drive adds level of its own; the three stages together can easily be
       +10 dB before the limiter sees it. */
    const dirt = (+v['mix.drive'] || 0) + (+v['flt1.drive'] || 0)
               + (v['fx.drive.on'] ? +v['fx.drive.amount'] || 0 : 0)
               + (v['fx.grit.on'] ? +v['fx.grit.amount'] || 0 : 0);
    if (dirt > 1.1) {
      const k = 1 / (1 + (dirt - 1.1) * 0.7);
      ['osc1.level', 'osc2.level', 'osc3.level', 'mix.sub'].forEach(id => {
        const p = MS.PARAM[id]; if (p) v[id] = MS.clamp((+v[id] || 0) * k, p.min, p.max);
      });
    }
  }

  /* ── The audit ────────────────────────────────────────────────────────────
     Last pass, and the one that earns its keep: every rule here is a way a
     roll comes back SILENT or STUCK, which is far worse than a roll that
     comes back ugly. Ugly is a dice roll; silent is a broken button. */
  function audit(v, part) {
    const C = (id, lo, hi) => { const p = MS.PARAM[id]; if (p) v[id] = MS.clamp(+v[id], lo == null ? p.min : lo, hi == null ? p.max : hi); };

    /* Something has to be making sound, and it has to be oscillator 1 — the
       only source guaranteed to follow the note. */
    v['osc1.on'] = 1;
    if (!(+v['osc1.level'] > 0.25)) v['osc1.level'] = rnd(.5, .8);

    /* An amp envelope that never opens, or never closes. */
    C('env1.a', 0.0005, CAPS['env1.a']);
    C('env1.r', 0.01, CAPS['env1.r']);
    /* Sustain at zero is a pluck, which is fine — as long as the decay is
       long enough to hear. Below ~120 ms with no sustain the note is a click. */
    if (+v['env1.s'] < 0.04 && +v['env1.d'] < 0.12) v['env1.d'] = rnd(.18, .6);
    /* And a long attack into a short decay is a note that arrives after it
       has already gone. */
    if (+v['env1.a'] > +v['env1.d'] * 1.5 && +v['env1.s'] < 0.2) v['env1.a'] = +v['env1.d'] * 0.4;

    /* ── The filter has to pass the oscillator ───────────────────────────
       Three couplings, all of them found by rendering rolls and measuring the
       quietest ones rather than by reading the diff. Each is the same bug:
       the filter was rolled without reference to what is going into it, so it
       removed the sound instead of shaping it. They run in this order, and
       the band-pass rule runs LAST on purpose — it is the narrowest claim
       about where the cutoff has to be, and the two floors below it would
       otherwise push the window straight back off the harmonics.

       (a) A wave made of upper partials needs the cutoff above them. */
    if (W_BRIGHT.indexOf(v['osc1.wave']) >= 0 || W_BRIGHT.indexOf(v['osc2.wave']) >= 0) {
      const lo = MS.fromNorm(MS.PARAM['flt1.cutoff'], 0.66);   // ≈1.8 kHz
      if (+v['flt1.cutoff'] < lo && +v['flt1.env'] < 0.3) v['flt1.cutoff'] = rnd(lo, lo * 4);
    }
    /* (b) And no part's filter sits below the lowest note that part plays. */
    const low = (PART_LOW[part] || 131) * 1.6;
    if (+v['flt1.cutoff'] < low && +v['flt1.env'] < 0.3) v['flt1.cutoff'] = rnd(low, low * 6);
    /* (c) A band-pass passes a window: put the window on the harmonics, give
           it enough resonance to have gain there, and make it track the
           keyboard so it stays there as the part moves. */
    if (FLT_BAND.indexOf(v['flt1.model']) >= 0) {
      const lo = (PART_LOW[part] || 131) * 1.5, p = MS.PARAM['flt1.cutoff'];
      if (+v['flt1.cutoff'] < lo || +v['flt1.cutoff'] > lo * 7) v['flt1.cutoff'] = lo * Math.pow(7, R());
      if (+v['flt1.res'] < 0.22) v['flt1.res'] = rnd(.25, .45);
      if (+v['flt1.keytrack'] < 0.35) v['flt1.keytrack'] = rnd(.45, .9);
      /* And a big filter envelope sweeps the window straight off them. */
      if (Math.abs(+v['flt1.env']) > 0.35) v['flt1.env'] = rnd(-.3, .3);
      v['flt1.cutoff'] = MS.clamp(+v['flt1.cutoff'], p.min, p.max);
    }

    /* A closed filter with no envelope and nothing modulating it is silence
       with a patch name on it. */
    const opens = (+v['flt1.env'] > 0.15) || hasDestFor(v, 'flt1.cutoff');
    if (!opens && +v['flt1.cutoff'] < 150) v['flt1.cutoff'] = rnd(400, 2500);
    else if (+v['flt1.cutoff'] < 60) v['flt1.cutoff'] = rnd(90, 400);

    /* Resonance into drive into a ladder is the self-oscillation case. */
    if (+v['flt1.res'] > 0.45 && +v['flt1.drive'] > 0.35) v['flt1.drive'] = rnd(.1, .3);

    /* Ring mod with nothing to ring against is just a gate. */
    if (+v['mix.ring'] > 0 && !v['osc2.on']) v['mix.ring'] = 0;
    /* FM with no modulator is a silent knob; worse, mix.fm at full with the
       modulator muted reads as "the FM is broken". */
    if (!v['osc2.on']) v['mix.fm'] = 0;
    if (!v['osc3.on']) { v['mix.fm3a'] = 0; v['mix.fm3b'] = 0; }

    /* The limiter and the calibrated output level are not the dice's to roll. */
    v['master.limit'] = 1;
    v['master.vol'] = MS.PARAM['master.vol'].def;
    v['fx.width'] = MS.PARAM['fx.width'].def;
  }

  function hasDestFor(v, dst) {
    for (let i = 1; i <= MS.MATRIX_SLOTS; i++) {
      if (v['mtx' + i + '.dst'] === dst && v['mtx' + i + '.src'] !== 'none' && Math.abs(+v['mtx' + i + '.amt']) > 0.05) return true;
    }
    return false;
  }

  MS.rollPatch = rollPatch;
  MS.ROLL_CHARACTERS = CHARS.map(c => [c.id, c.label]);

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
