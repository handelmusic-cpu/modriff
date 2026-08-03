#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — Max for Live device builder
   ───────────────────────────────────────────────────────────────────────────
   Generates the Live device from the same parameter schema the web app uses,
   so the two can't drift: js/params.js is the single source for names, ranges,
   curves, defaults and enum orderings on both sides.

   Emits into m4l/:
     MoodSynthVoice.gendsp   the per-voice DSP (gen~ codebox)
     MoodSynthFX.gendsp      the master effects DSP
     MoodSynthVoice.maxpat   the poly~ voice wrapper
     MoodSynth.maxpat        the device patcher
     MoodSynth.amxd          the same patcher in Live's device container
     patches.json            the factory bank, translated for the device
     modsynth.js             the device's patch loader / macro resolver

   Run: node tools/build-m4l.js
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'm4l');
const MS = require(path.join(ROOT, 'js', 'params.js'));
require(path.join(ROOT, 'js', 'patches.js'));
require(path.join(ROOT, 'js', 'patches-extra.js'));

const APPVERSION = { major: 8, minor: 5, revision: 0, architecture: 'x64', modernui: 1 };

/* ── Which parameters Live sees ───────────────────────────────────────────────
   Exposing all ~230 would make an unusable device panel and a Live automation
   list nobody can navigate. These are the ones worth a knob and a lane; every
   other parameter still travels with the patch. */
const EXPOSED = [
  'macro.1', 'macro.2', 'macro.3', 'macro.4', 'macro.5', 'macro.6', 'macro.7', 'macro.8',
  'osc1.shape', 'osc1.pw', 'osc1.level', 'osc1.oct', 'osc1.semi', 'osc1.fine', 'osc1.uni', 'osc1.detune',
  'osc2.on', 'osc2.shape', 'osc2.pw', 'osc2.level', 'osc2.oct', 'osc2.semi', 'osc2.fine',
  'osc2.uni', 'osc2.detune', 'osc2.sync',
  'mix.fm', 'mix.ring', 'mix.sub', 'mix.noise',
  'flt1.model', 'flt1.cutoff', 'flt1.res', 'flt1.drive', 'flt1.keytrack', 'flt1.env', 'flt1.vel',
  'flt2.model', 'flt2.cutoff', 'flt2.res',
  'env1.a', 'env1.d', 'env1.s', 'env1.r',
  'env2.a', 'env2.d', 'env2.s', 'env2.r',
  'lfo1.shape', 'lfo1.rate', 'lfo1.depth',
  'lfo2.shape', 'lfo2.rate', 'lfo2.depth',
  'voice.glide', 'voice.bendUp', 'voice.bendDown', 'voice.drift', 'voice.velAmt', 'voice.transpose',
  'fx.drive.on', 'fx.drive.amount', 'fx.drive.tone',
  'fx.chorus.on', 'fx.chorus.rate', 'fx.chorus.depth', 'fx.chorus.mix',
  'fx.delay.on', 'fx.delay.div', 'fx.delay.fb', 'fx.delay.mix', 'fx.delay.pong',
  'fx.reverb.on', 'fx.reverb.size', 'fx.reverb.damp', 'fx.reverb.mix',
  'master.vol',
];

/** gen~ parameter names can't contain a dot. */
const gname = id => id.replace(/\./g, '_');

/* ── Patcher helpers ──────────────────────────────────────────────────────── */
class Patcher {
  constructor(opts) {
    this.opts = opts || {};
    this.boxes = [];
    this.lines = [];
    this.n = 0;
  }

  add(spec) {
    const id = 'obj-' + (++this.n);
    const box = Object.assign({ id, patching_rect: [0, 0, 100, 22] }, spec);
    this.boxes.push({ box });
    return box;
  }

  obj(text, x, y, extra) {
    return this.add(Object.assign({
      maxclass: 'newobj', text,
      numinlets: 1, numoutlets: 1, outlettype: [''],
      patching_rect: [x, y, Math.max(60, text.length * 7 + 12), 22],
    }, extra));
  }

  msg(text, x, y, extra) {
    return this.add(Object.assign({
      maxclass: 'message', text,
      numinlets: 2, numoutlets: 1, outlettype: [''],
      patching_rect: [x, y, Math.max(40, text.length * 7 + 12), 22],
    }, extra));
  }

  comment(text, x, y, w) {
    return this.add({
      maxclass: 'comment', text,
      numinlets: 1, numoutlets: 0,
      patching_rect: [x, y, w || Math.max(80, text.length * 7), 20],
    });
  }

  connect(from, outlet, to, inlet) {
    this.lines.push({ patchline: { destination: [to.id, inlet | 0], source: [from.id, outlet | 0] } });
  }

  toJSON() {
    return {
      patcher: Object.assign({
        fileversion: 1,
        appversion: APPVERSION,
        classnamespace: 'box',
        rect: [60, 90, 1000, 680],
        bglocked: 0,
        openinpresentation: this.opts.presentation ? 1 : 0,
        default_fontsize: 12.0,
        default_fontface: 0,
        default_fontname: 'Arial',
        gridonopen: 1,
        gridsize: [15.0, 15.0],
        gridsnaponopen: 1,
        objectsnaponopen: 1,
        statusbarvisible: 2,
        toolbarvisible: 1,
        lefttoolbarpinned: 0,
        toptoolbarpinned: 0,
        righttoolbarpinned: 0,
        bottomtoolbarpinned: 0,
        toolbars_unpinned_last_save: 0,
        tallnewobj: 0,
        boxanimatetime: 200,
        enablehscroll: 1,
        enablevscroll: 1,
        devicewidth: 0.0,
        description: '',
        digest: '',
        tags: '',
        style: '',
        subpatcher_template: '',
        assistshowspatchername: 0,
        boxes: this.boxes,
        lines: this.lines,
        dependency_cache: [],
        autosave: 0,
      }, this.opts.patcher || {}),
    };
  }
}

/** A gen~ patcher: one codebox feeding the outputs. */
function gendsp(code, nOut) {
  const p = new Patcher({
    patcher: { classnamespace: 'dsp.gen', rect: [50, 90, 900, 700] },
  });
  const cb = p.add({
    maxclass: 'codebox',
    numinlets: 1,
    numoutlets: nOut,
    outlettype: new Array(nOut).fill(''),
    patching_rect: [40, 40, 780, 520],
    fontface: 0,
    fontname: 'Menlo',
    fontsize: 11.0,
    code,
  });
  for (let i = 0; i < nOut; i++) {
    const o = p.obj('out ' + (i + 1), 40 + i * 90, 600, { numinlets: 1, numoutlets: 0, outlettype: [] });
    p.connect(cb, i, o, 0);
  }
  return p.toJSON();
}

/* ── Master FX, in gen~ ───────────────────────────────────────────────────── */
const FX_CODE = `// ════════════════════════════════════════════════════════════════════════════
// MōdSynth — master effects for the Live device
// Drive → chorus → ping-pong delay → reverb → output, matching the order and
// the parameter names of js/fx.js. The delay reads its time in seconds from
// the device patcher, which computes it from Live's transport, so a synced
// delay stays locked when the tempo changes.
// ════════════════════════════════════════════════════════════════════════════
Param fx_drive_on(0);
Param fx_drive_amount(0.3, min=0, max=1);
Param fx_drive_tone(0.5, min=0, max=1);
Param fx_chorus_on(0);
Param fx_chorus_rate(0.6, min=0.02, max=8);
Param fx_chorus_depth(0.4, min=0, max=1);
Param fx_chorus_mix(0.4, min=0, max=1);
Param fx_delay_on(0);
Param fx_delay_time(0.35, min=0.005, max=4);
Param fx_delay_fb(0.35, min=0, max=0.95);
Param fx_delay_pong(0, min=0, max=1);
Param fx_delay_mix(0.25, min=0, max=1);
Param fx_reverb_on(0);
Param fx_reverb_size(0.55, min=0, max=1);
Param fx_reverb_damp(0.4, min=0, max=1);
Param fx_reverb_mix(0.25, min=0, max=1);
Param master_vol(0.8, min=0, max=1.4);

History chL(0), chR(0);
History dTone1(0), dTone2(0);
History rv1(0), rv2(0), rv3(0), rv4(0), rv5(0), rv6(0), rv7(0), rv8(0);

l = in1;
r = in2;

// ── Drive: one saturation with gain compensation, so pushing the control
//    changes the tone rather than just the level. ──
dg = 1 + fx_drive_amount * fx_drive_amount * 24;
dl = tanh(l * dg) / (1 + fx_drive_amount * 1.4);
dr = tanh(r * dg) / (1 + fx_drive_amount * 1.4);
tone = 300 * pow(60, fx_drive_tone);
tc = clamp(1 - exp(-twopi * tone / samplerate), 0, 1);
dTone1 = dTone1 + (dl - dTone1) * tc;
dTone2 = dTone2 + (dr - dTone2) * tc;
l = fx_drive_on > 0.5 ? dTone1 : l;
r = fx_drive_on > 0.5 ? dTone2 : r;

// ── Chorus: two delay lines in quadrature, panned apart. ──
lfoA = cycle(fx_chorus_rate);
lfoB = cycle(fx_chorus_rate * 1.13, 0.25);
dmA = 0.012 + lfoA * fx_chorus_depth * 0.006;
dmB = 0.018 + lfoB * fx_chorus_depth * 0.006;
cA = delay(l, clamp(dmA * samplerate, 1, 4000), 4800);
cB = delay(r, clamp(dmB * samplerate, 1, 4000), 4800);
cmix = fx_chorus_on > 0.5 ? fx_chorus_mix : 0;
l = l * (1 - cmix * 0.5) + cA * cmix;
r = r * (1 - cmix * 0.5) + cB * cmix;

// ── Ping-pong delay. Straight and crossed feedback are complementary, so the
//    total loop gain stays at 'fb' however far the ping-pong control goes. ──
dsamp = clamp(fx_delay_time * samplerate, 8, 190000);
dlyL = delay(chL, dsamp, 192000);
dlyR = delay(chR, dsamp * 1.0007, 192000);
fbAmt = clamp(fx_delay_fb, 0, 0.95);
pong = clamp(fx_delay_pong, 0, 1);
chL = l + dlyL * fbAmt * (1 - pong) + dlyR * fbAmt * pong;
chR = r + dlyR * fbAmt * (1 - pong) + dlyL * fbAmt * pong;
dmix = fx_delay_on > 0.5 ? fx_delay_mix : 0;
l = l + dlyL * dmix;
r = r + dlyR * dmix;

// ── Reverb: a four-comb, two-allpass Schroeder network per side. Small, but
//    dense enough to sit a pad in a room. ──
mono = (l + r) * 0.5;
sz = 0.55 + fx_reverb_size * 0.42;
damp = clamp(fx_reverb_damp, 0, 0.95);
c1 = delay(rv1, 1557 * sz, 4096);
c2 = delay(rv2, 1617 * sz, 4096);
c3 = delay(rv3, 1491 * sz, 4096);
c4 = delay(rv4, 1422 * sz, 4096);
rv1 = mono + c1 * (0.84 - damp * 0.3);
rv2 = mono + c2 * (0.84 - damp * 0.3);
rv3 = mono + c3 * (0.84 - damp * 0.3);
rv4 = mono + c4 * (0.84 - damp * 0.3);
combs = (c1 + c2 + c3 + c4) * 0.25;
a1 = delay(rv5, 225, 1024);
rv5 = combs + a1 * 0.5;
ap1 = a1 - combs * 0.5;
a2 = delay(rv6, 341, 1024);
rv6 = ap1 + a2 * 0.5;
ap2 = a2 - ap1 * 0.5;
a3 = delay(rv7, 441, 2048);
rv7 = combs + a3 * 0.5;
ap3 = a3 - combs * 0.5;
a4 = delay(rv8, 556, 2048);
rv8 = ap3 + a4 * 0.5;
ap4 = a4 - ap3 * 0.5;
rmix = fx_reverb_on > 0.5 ? fx_reverb_mix : 0;
l = l + ap2 * rmix * 1.4;
r = r + ap4 * rmix * 1.4;

out1 = clamp(l * master_vol, -1.6, 1.6);
out2 = clamp(r * master_vol, -1.6, 1.6);
`;

/* ── The poly~ voice wrapper ──────────────────────────────────────────────── */
function buildVoicePatcher() {
  const p = new Patcher({});

  p.comment('MōdSynth voice — one instance per poly~ slot. Generated by tools/build-m4l.js.', 20, 10, 620);

  const in1 = p.obj('in 1', 20, 50, { numinlets: 0, numoutlets: 1, outlettype: [''] });
  const noteRoute = p.obj('route midinote', 20, 90, { numinlets: 1, numoutlets: 2, outlettype: ['', ''] });
  const unpack = p.obj('unpack 0. 0.', 20, 130, { numinlets: 1, numoutlets: 2, outlettype: ['float', 'float'] });

  // Velocity first so the gate is set before the pitch that goes with it.
  const velScale = p.obj('/ 127.', 130, 170, { numinlets: 2, numoutlets: 1, outlettype: ['float'] });
  const gatePrep = p.obj('prepend gate', 130, 210);
  const pitchPrep = p.obj('prepend pitch', 20, 210);

  // Every parameter arrives as "<name> <value>" on one receive, which keeps
  // the patcher to a single wire instead of one per parameter.
  const paramRecv = p.obj('r #0_param', 300, 90, { numinlets: 0, numoutlets: 1, outlettype: [''] });

  const gen = p.obj('gen~ MoodSynthVoice', 20, 270, {
    numinlets: 1, numoutlets: 3, outlettype: ['signal', 'signal', 'signal'],
  });

  // Voice freeing: once the amp envelope is silent the slot goes back to the
  // pool. Without this poly~ would keep every voice busy forever.
  const thresh = p.obj('<~ 0.0002', 300, 320, { numinlets: 2, numoutlets: 1, outlettype: ['signal'] });
  const edge = p.obj('edge~', 300, 360, { numinlets: 1, numoutlets: 2, outlettype: ['bang', 'bang'] });
  const free = p.msg('0', 300, 400);
  const busy = p.msg('1', 350, 400);
  const thisPoly = p.obj('thispoly~', 300, 440, { numinlets: 1, numoutlets: 1, outlettype: ['signal'] });

  const out1 = p.obj('out~ 1', 20, 460, { numinlets: 1, numoutlets: 0, outlettype: [] });
  const out2 = p.obj('out~ 2', 110, 460, { numinlets: 1, numoutlets: 0, outlettype: [] });

  p.connect(in1, 0, noteRoute, 0);
  p.connect(noteRoute, 0, unpack, 0);
  p.connect(unpack, 1, velScale, 0);
  p.connect(velScale, 0, gatePrep, 0);
  p.connect(gatePrep, 0, gen, 0);
  p.connect(unpack, 0, pitchPrep, 0);
  p.connect(pitchPrep, 0, gen, 0);
  p.connect(velScale, 0, busy, 0);
  p.connect(busy, 0, thisPoly, 0);
  p.connect(paramRecv, 0, gen, 0);
  p.connect(gen, 0, out1, 0);
  p.connect(gen, 1, out2, 0);
  p.connect(gen, 2, thresh, 0);
  p.connect(thresh, 0, edge, 0);
  p.connect(edge, 0, free, 0);
  p.connect(free, 0, thisPoly, 0);

  return p.toJSON();
}

/* ── The device ───────────────────────────────────────────────────────────── */
function buildDevicePatcher() {
  const p = new Patcher({
    presentation: true,
    patcher: { rect: [60, 90, 1240, 900], devicewidth: 1000.0 },
  });

  p.comment('MŌDSYNTH — generated by tools/build-m4l.js from js/params.js. Do not hand-edit; rebuild instead.', 16, 8, 780);

  /* MIDI in → poly~ */
  const thisDevice = p.obj('live.thisdevice', 16, 40, { numinlets: 1, numoutlets: 3, outlettype: ['bang', '', ''] });
  const midiin = p.obj('midiin', 16, 80, { numinlets: 1, numoutlets: 1, outlettype: [''] });
  const midiparse = p.obj('midiparse', 16, 120, {
    numinlets: 1, numoutlets: 8,
    outlettype: ['', '', '', 'int', 'int', 'int', 'int', 'int'],
  });

  const poly = p.obj('poly~ MoodSynthVoice 16', 16, 320, {
    numinlets: 1, numoutlets: 3, outlettype: ['signal', 'signal', ''],
  });
  // Notes pass through [sustain] so the pedal holds them, then become
  // `midinote` messages, which is how poly~ allocates and frees its voices.
  const sustain = p.obj('sustain', 16, 160, { numinlets: 2, numoutlets: 1, outlettype: [''] });
  const midinotePrep = p.obj('prepend midinote', 16, 200);
  const targetMsg = p.msg('target 0', 210, 200);

  p.connect(thisDevice, 0, targetMsg, 0);
  p.connect(midiin, 0, midiparse, 0);
  p.connect(midiparse, 0, sustain, 0);
  p.connect(sustain, 0, midinotePrep, 0);
  p.connect(midinotePrep, 0, poly, 0);
  p.connect(targetMsg, 0, poly, 0);

  /* Pitch bend, mod wheel, aftertouch and sustain. These are the performance
     controls, so they go straight into the voices rather than through the
     parameter list where automation could fight the player's hands. */
  const bendScale = p.obj('scale 0 16383 -1. 1.', 330, 160, { numinlets: 6, numoutlets: 1, outlettype: [''] });
  const bendPrep = p.obj('prepend bend', 330, 200);
  const sendParam = p.obj('s #0_param', 330, 280, { numinlets: 1, numoutlets: 0, outlettype: [] });
  p.connect(midiparse, 5, bendScale, 0);
  p.connect(bendScale, 0, bendPrep, 0);
  p.connect(bendPrep, 0, sendParam, 0);

  const ctlUnpack = p.obj('unpack 0 0', 560, 160, { numinlets: 1, numoutlets: 2, outlettype: ['int', 'int'] });
  const ccRoute = p.obj('route 1 64 2 4 11', 560, 200, {
    numinlets: 1, numoutlets: 6, outlettype: ['', '', '', '', '', ''],
  });
  const swapCC = p.obj('swap', 560, 120, { numinlets: 2, numoutlets: 2, outlettype: ['', ''] });
  p.connect(midiparse, 2, ctlUnpack, 0);
  // midiparse gives [value, controller]; the router wants the controller first.
  p.connect(ctlUnpack, 0, swapCC, 1);
  p.connect(ctlUnpack, 1, swapCC, 0);
  const ccPack = p.obj('pack 0 0', 560, 145, { numinlets: 2, numoutlets: 1, outlettype: [''] });
  p.connect(swapCC, 0, ccPack, 0);
  p.connect(swapCC, 1, ccPack, 1);
  p.connect(ccPack, 0, ccRoute, 0);

  const mwScale = p.obj('/ 127.', 560, 240, { numinlets: 2, numoutlets: 1, outlettype: ['float'] });
  const mwPrep = p.obj('prepend modwheel', 560, 275);
  p.connect(ccRoute, 0, mwScale, 0);
  p.connect(mwScale, 0, mwPrep, 0);
  p.connect(mwPrep, 0, sendParam, 0);

  const sustainGate = p.obj('>= 64', 700, 205, { numinlets: 2, numoutlets: 1, outlettype: ['int'] });
  p.connect(ccRoute, 1, sustainGate, 0);
  p.connect(sustainGate, 0, sustain, 1);

  const atScale = p.obj('/ 127.', 860, 160, { numinlets: 2, numoutlets: 1, outlettype: ['float'] });
  const atPrep = p.obj('prepend aftertouch', 860, 200);
  p.connect(midiparse, 4, atScale, 0);
  p.connect(atScale, 0, atPrep, 0);
  p.connect(atPrep, 0, sendParam, 0);

  /* Audio out through the FX. */
  const fx = p.obj('gen~ MoodSynthFX', 16, 380, {
    numinlets: 2, numoutlets: 2, outlettype: ['signal', 'signal'],
  });
  const plugout = p.obj('plugout~', 16, 430, { numinlets: 2, numoutlets: 0, outlettype: [] });
  p.connect(poly, 0, fx, 0);
  p.connect(poly, 1, fx, 1);
  p.connect(fx, 0, plugout, 0);
  p.connect(fx, 1, plugout, 1);

  /* Tempo for the synced delay. [live.observer] on the live_set's tempo is the
     documented way to get it and, unlike reading a transport signal, it
     updates the moment the tempo changes rather than at the next snapshot. */
  const pathBang = p.obj('t b', 210, 340);
  const pathMsg = p.msg('path live_set', 210, 375);
  const livePath = p.obj('live.path', 210, 410, { numinlets: 1, numoutlets: 3, outlettype: ['', '', ''] });
  const tempoObs = p.obj('live.observer @property tempo', 210, 445, {
    numinlets: 1, numoutlets: 2, outlettype: ['', ''],
  });
  const delayCalc = p.obj('js modsynth.js', 210, 500, {
    numinlets: 1, numoutlets: 2, outlettype: ['', ''],
  });
  p.connect(thisDevice, 0, pathBang, 0);
  p.connect(pathBang, 0, pathMsg, 0);
  p.connect(pathMsg, 0, livePath, 0);
  p.connect(livePath, 0, tempoObs, 0);
  p.connect(tempoObs, 0, delayCalc, 0);

  /* The patch loader. [dict] holds the bank; the js resolves a patch into the
     flat parameter messages the voices and the FX understand, including
     collapsing the modulation matrix into the device's fixed routings. */
  const dict = p.obj('dict MoodSynthPatches @embed 0', 460, 380, {
    numinlets: 2, numoutlets: 4, outlettype: ['dictionary', '', '', ''],
  });
  const readMsg = p.msg('read patches.json', 460, 340);
  // Reading is asynchronous, so the bank is banged out a moment later rather
  // than assuming it landed before the device finished loading.
  const bankDelay = p.obj('delay 400', 620, 340, { numinlets: 2, numoutlets: 1, outlettype: ['bang'] });
  p.connect(thisDevice, 0, readMsg, 0);
  p.connect(thisDevice, 0, bankDelay, 0);
  p.connect(readMsg, 0, dict, 0);
  p.connect(bankDelay, 0, dict, 0);
  p.connect(dict, 0, delayCalc, 0);
  p.connect(delayCalc, 0, sendParam, 0);

  const fxSend = p.obj('s #0_fx', 210, 520, { numinlets: 1, numoutlets: 0, outlettype: [] });
  const fxRecv = p.obj('r #0_fx', 16, 340, { numinlets: 0, numoutlets: 1, outlettype: [''] });
  p.connect(delayCalc, 1, fxSend, 0);
  p.connect(fxRecv, 0, fx, 0);

  /* Patch browser: a menu of every factory patch. */
  const patchMenu = p.add({
    maxclass: 'live.menu',
    varname: 'patch_select',
    parameter_enable: 1,
    numinlets: 1, numoutlets: 2, outlettype: ['', ''],
    patching_rect: [460, 290, 160, 15],
    presentation: 1,
    presentation_rect: [16, 8, 190, 15],
    saved_attribute_attributes: {
      valueof: {
        parameter_longname: 'Patch',
        parameter_shortname: 'Patch',
        parameter_type: 2,
        parameter_enum: MS.FACTORY_PATCHES.map(x => x.name),
        parameter_initial: [0],
        parameter_initial_enable: 1,
      },
    },
  });
  const patchPrep = p.obj('prepend patch', 460, 315);
  p.connect(patchMenu, 0, patchPrep, 0);
  p.connect(patchPrep, 0, delayCalc, 0);

  /* ── Exposed parameters ──────────────────────────────────────────────────
     One live.* object per exposed parameter, each prepending its own name onto
     the shared parameter bus. Macros are drawn large and first because they're
     the controls a player actually reaches for mid-take. */
  let px = 16, py = 40;          // presentation grid
  let gx = 16, gy = 560;         // patching grid
  const COLS = 12;
  let col = 0;

  EXPOSED.forEach(id => {
    const par = MS.PARAM[id];
    if (!par) throw new Error('EXPOSED lists an unknown parameter: ' + id);
    const isMacro = id.startsWith('macro.');
    const shortName = isMacro ? 'M' + id.split('.')[1] : par.label;
    const longName = gname(id);

    let maxclass, w, h, attrs;
    if (par.type === 'enum') {
      maxclass = 'live.menu';
      w = 76; h = 15;
      attrs = {
        parameter_type: 2,
        parameter_enum: par.options.map(o => o[1]),
        parameter_initial: [par.defIndex],
      };
    } else if (par.type === 'bool') {
      maxclass = 'live.toggle';
      w = 15; h = 15;
      attrs = {
        parameter_type: 2,
        parameter_enum: ['Off', 'On'],
        parameter_initial: [par.def ? 1 : 0],
      };
    } else {
      maxclass = 'live.dial';
      w = isMacro ? 48 : 40;
      h = isMacro ? 52 : 46;
      attrs = {
        parameter_type: 0,
        parameter_mmin: par.min,
        parameter_mmax: par.max,
        parameter_initial: [par.def],
        // Live's curve maps onto ours: exponential and power parameters both
        // want the low end stretched out, which is `parameter_exponent`.
        parameter_exponent: par.curve === 'exp' ? 3.0 : par.curve === 'pow' ? (par.k || 3) : 1.0,
        parameter_unitstyle: par.unit === 'Hz' ? 1 : par.unit === 'dB' ? 2 : par.unit === 's' ? 3 : 0,
      };
    }

    const box = p.add({
      maxclass,
      varname: longName,
      parameter_enable: 1,
      numinlets: 1,
      numoutlets: 2,
      outlettype: ['', ''],
      patching_rect: [gx, gy, w, h],
      presentation: 1,
      presentation_rect: [px, py, w, h],
      saved_attribute_attributes: {
        valueof: Object.assign({
          parameter_longname: longName,
          parameter_shortname: shortName.slice(0, 15),
          parameter_initial_enable: 1,
        }, attrs),
      },
    });

    const prep = p.obj('prepend ' + longName, gx, gy + h + 4, { patching_rect: [gx, gy + h + 4, 120, 22] });
    p.connect(box, 0, prep, 0);
    // FX parameters go to the effects gen~; everything else to the voices.
    p.connect(prep, 0, id.startsWith('fx.') || id.startsWith('master.') ? fxSend : sendParam, 0);

    gx += 130;
    if (gx > 1100) { gx = 16; gy += 90; }
    px += w + 8;
    if (++col >= COLS) { col = 0; px = 16; py += h + 22; }
  });

  return p.toJSON();
}

/* ── Patch bank, translated for the device ────────────────────────────────────
   The device's fixed routings can't express an arbitrary matrix, so each
   patch's rows are collapsed here: per-voice sources map onto the mod_* depths
   the gen~ voice declares, and global sources (macros, wheels) are recorded so
   the device's JavaScript can fold them into the off_* offsets at runtime. */
const MOD_MAP = {
  'lfo1|pitch': 'mod_lfo1_pitch',
  'lfo1|flt1.cutoff': 'mod_lfo1_cutoff',
  'lfo1|osc1.pw': 'mod_lfo1_pw',
  'lfo1|osc2.pw': 'mod_lfo1_pw',
  'lfo1|amp': 'mod_lfo1_amp',
  'lfo1|osc1.shape': 'mod_lfo1_shape',
  'lfo2|pitch': 'mod_lfo2_pitch',
  'lfo2|flt1.cutoff': 'mod_lfo2_cutoff',
  'lfo2|osc1.shape': 'mod_lfo2_shape',
  'lfo2|osc2.shape': 'mod_lfo2_shape',
  'lfo2|pan': 'mod_lfo2_pan',
  'env3|pitch': 'mod_env2_pitch',
  'env3|osc1.shape': 'mod_env2_shape',
  'env3|mix.fm': 'mod_env2_fm',
  'env2|pitch': 'mod_env2_pitch',
  'env2|mix.fm': 'mod_env2_fm',
  'mw|lfo1.depth': 'mod_mw_lfo1depth',
  'mw|flt1.cutoff': 'mod_mw_cutoff',
  'at|flt1.cutoff': 'mod_at_cutoff',
  'at|lfo1.depth': 'mod_at_lfo1depth',
};

/* Destinations the device can offset from a macro. */
const OFFSET_DEST = {
  'flt1.cutoff': 'off_cutoff', 'flt1.res': 'off_res', 'osc1.detune': 'off_detune',
  'osc2.detune': 'off_detune', 'osc1.shape': 'off_shape', 'osc2.shape': 'off_shape',
  'osc1.pw': 'off_pw', 'osc2.pw': 'off_pw', 'mix.fm': 'off_fm',
  'pitch': 'off_pitch', 'amp': 'off_amp',
};

function buildPatchBank() {
  const bank = {};
  MS.FACTORY_PATCHES.forEach(src => {
    const params = {};
    Object.keys(src.values).forEach(id => {
      const par = MS.PARAM[id];
      if (!par) return;
      params[gname(id)] = MS.toNumber(par, src.values[id]);
    });
    // `pulse` is a wavetable set in the web app but a switch in gen~.
    ['osc1', 'osc2'].forEach(o => {
      const w = src.values[o + '.wave'];
      if (w !== undefined) params[gname(o + '.pulse')] = w === 'pulse' ? 1 : 0;
    });

    const mods = {};
    const macros = [];
    (src.matrix || []).forEach(row => {
      const [s, d, a] = Array.isArray(row) ? row : [row.src, row.dst, row.amt];
      if (!s || s === 'none' || !d || d === 'none' || !a) return;
      const key = MOD_MAP[s + '|' + d];
      if (key) { mods[key] = (mods[key] || 0) + a; return; }
      if (/^m[1-8]$/.test(s) && OFFSET_DEST[d]) {
        macros.push({ macro: +s.slice(1), offset: OFFSET_DEST[d], amt: a });
        return;
      }
      if (s === 'mw' && OFFSET_DEST[d]) macros.push({ macro: 0, offset: OFFSET_DEST[d], amt: a });
    });

    bank[src.name] = {
      name: src.name,
      category: src.category,
      tags: src.tags,
      params,
      mods,
      macros,
      macroNames: src.macros || MS.MACRO_DEFAULT_NAMES,
      fx: {},
    };
  });
  return bank;
}

/* ── The device's JavaScript ──────────────────────────────────────────────── */
const DEVICE_JS = `/* MōdSynth — Max for Live device logic.
   Generated by tools/build-m4l.js; rebuild rather than editing by hand.

   Three jobs:
     · turn a patch from patches.json into flat "<param> <value>" messages
     · fold the eight macros into the voice's off_* offsets, because gen~ has
       no dynamic routing and the matrix has to be resolved outside the DSP
     · turn Live's tempo into a delay time in seconds

   Outlet 0 → the voice parameter bus.  Outlet 1 → the effects parameter bus. */
autowatch = 1;
outlets = 2;
inlets = 1;

var VOICE = 0, FX = 1;
var bank = null;
var current = null;
var macroVals = [0, 0, 0, 0, 0, 0, 0, 0];
var modwheel = 0;
var tempo = 120;
var delayDiv = 0.125;          // in whole notes; 1 = one bar of 4/4

var DIV_BEATS = ${JSON.stringify(MS.DIV_BEATS)};
var DIV_IDS = ${JSON.stringify(MS.DIVS.map(d => d[0]))};

function dictionary(name) {
  // The [dict] object hands us its name; read the bank out of it once.
  var d = new Dict(name);
  try {
    bank = JSON.parse(d.stringify());
  } catch (e) {
    post("MōdSynth: could not read the patch bank — " + e.message + "\\n");
  }
}

function patch(indexOrName) {
  if (!bank) { post("MōdSynth: no patch bank loaded yet.\\n"); return; }
  var names = [];
  for (var k in bank) names.push(k);
  names.sort();
  var p = typeof indexOrName === "number" ? bank[names[indexOrName]] : bank[indexOrName];
  if (!p) { post("MōdSynth: no such patch: " + indexOrName + "\\n"); return; }
  current = p;
  applyPatch(p);
}

function applyPatch(p) {
  for (var k in p.params) send(k, p.params[k]);
  for (var m in p.mods) send(m, p.mods[m]);
  // Anything the patch doesn't set has to be returned to zero, or the last
  // patch's modulation leaks into this one.
  var allMods = ${JSON.stringify(Object.values(MOD_MAP).filter((v, i, a) => a.indexOf(v) === i))};
  for (var i = 0; i < allMods.length; i++) {
    if (!(allMods[i] in p.mods)) send(allMods[i], 0);
  }
  resolveMacros();
}

/** Sums every macro's contribution into the voice's off_* offsets. */
function resolveMacros() {
  var off = { off_cutoff: 0, off_res: 0, off_detune: 0, off_shape: 0,
              off_pw: 0, off_fm: 0, off_pitch: 0, off_amp: 0 };
  if (current && current.macros) {
    for (var i = 0; i < current.macros.length; i++) {
      var r = current.macros[i];
      var v = r.macro === 0 ? modwheel : macroVals[r.macro - 1];
      if (r.offset in off) off[r.offset] += v * r.amt;
    }
  }
  for (var k in off) send(k, off[k]);
}

function send(name, value) {
  var target = (name.indexOf("fx_") === 0 || name.indexOf("master_") === 0) ? FX : VOICE;
  outlet(target, name, value);
}

/* live.* objects prepend their own name, so anything that isn't a known
   command arrives here as "<name> <value>". */
function anything() {
  var name = messagename;
  var v = arguments.length ? arguments[0] : 0;
  if (name.indexOf("macro_") === 0) {
    var idx = parseInt(name.substring(6), 10) - 1;
    if (idx >= 0 && idx < 8) { macroVals[idx] = v; resolveMacros(); }
    return;
  }
  if (name === "modwheel") { modwheel = v; resolveMacros(); }
  if (name === "fx_delay_div") { delayDiv = DIV_BEATS[DIV_IDS[Math.round(v)]] / 4 || 0.125; updateDelay(); return; }
  send(name, v);
}

function msg_float(v) {
  // The only bare float is the tempo from [snapshot~].
  tempo = v > 0 ? v : 120;
  updateDelay();
}

function updateDelay() {
  var beats = delayDiv * 4;
  var seconds = beats * 60 / tempo;
  if (seconds < 0.005) seconds = 0.005;
  if (seconds > 4) seconds = 4;
  outlet(FX, "fx_delay_time", seconds);
}
`;

/* ── .amxd container ──────────────────────────────────────────────────────────
   Live's device file is the patcher JSON behind a small chunked header. Each
   chunk is a four-character id, a little-endian uint32 length, then the data.
   'ampf' declares the device type ('mmmm' MIDI, 'aaaa' audio, 'iiii' the
   instrument we want); 'ptch' carries the patcher. */
function buildAmxd(patcherJson) {
  const json = Buffer.from(JSON.stringify(patcherJson, null, 1) + '\n', 'utf8');

  const chunk = (id, payload) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 4, 'ascii');
    head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload]);
  };

  const meta = Buffer.from('iiii', 'ascii');                  // instrument device
  const ptch = chunk('ptch', json);
  return Buffer.concat([chunk('ampf', meta), ptch]);
}

/* ── Validation ───────────────────────────────────────────────────────────────
   None of this can be opened in Max from here, so everything that *can* be
   checked mechanically is: that the JSON parses, that every patchline points at
   an object that exists, and that no line indexes an inlet or outlet the target
   doesn't have. Those are the three mistakes that make Max refuse a file. */
function validate(name, patcherJson) {
  const errs = [];
  const pat = patcherJson.patcher;
  if (!pat) return [name + ': no patcher root'];
  const byId = new Map();
  pat.boxes.forEach(b => byId.set(b.box.id, b.box));
  if (byId.size !== pat.boxes.length) errs.push(name + ': duplicate object ids');

  (pat.lines || []).forEach((l, i) => {
    const { source, destination } = l.patchline;
    const s = byId.get(source[0]);
    const d = byId.get(destination[0]);
    if (!s) errs.push(`${name}: line ${i} comes from a missing object ${source[0]}`);
    if (!d) errs.push(`${name}: line ${i} goes to a missing object ${destination[0]}`);
    if (s && source[1] >= (s.numoutlets || 0)) {
      errs.push(`${name}: line ${i} uses outlet ${source[1]} of ${s.text || s.maxclass} which has ${s.numoutlets}`);
    }
    if (d && destination[1] >= (d.numinlets || 0)) {
      errs.push(`${name}: line ${i} uses inlet ${destination[1]} of ${d.text || d.maxclass} which has ${d.numinlets}`);
    }
  });

  pat.boxes.forEach(b => {
    const box = b.box;
    if (box.parameter_enable) {
      const v = box.saved_attribute_attributes && box.saved_attribute_attributes.valueof;
      if (!v || !v.parameter_longname) errs.push(`${name}: ${box.varname || box.id} is parameter-enabled but unnamed`);
      if (v && v.parameter_shortname && v.parameter_shortname.length > 15) {
        errs.push(`${name}: short name too long on ${v.parameter_longname}`);
      }
    }
  });

  const longNames = pat.boxes
    .map(b => b.box.saved_attribute_attributes && b.box.saved_attribute_attributes.valueof)
    .filter(v => v && v.parameter_longname)
    .map(v => v.parameter_longname);
  const dupes = longNames.filter((n, i) => longNames.indexOf(n) !== i);
  if (dupes.length) errs.push(`${name}: duplicate Live parameter names: ${Array.from(new Set(dupes)).join(', ')}`);

  return errs;
}

/* ── Build ────────────────────────────────────────────────────────────────── */
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'gen'), { recursive: true });

  const voiceCode = fs.readFileSync(path.join(OUT, 'gen', 'voice.gendsp.txt'), 'utf8');

  const files = [];
  const write = (rel, data) => {
    const full = path.join(OUT, rel);
    fs.writeFileSync(full, data);
    files.push([rel, Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)]);
  };

  const voiceGen = gendsp(voiceCode, 3);
  const fxGen = gendsp(FX_CODE, 2);
  const voicePat = buildVoicePatcher();
  const devicePat = buildDevicePatcher();

  const errs = []
    .concat(validate('MoodSynthVoice.gendsp', voiceGen))
    .concat(validate('MoodSynthFX.gendsp', fxGen))
    .concat(validate('MoodSynthVoice.maxpat', voicePat))
    .concat(validate('MoodSynth.maxpat', devicePat));

  if (errs.length) {
    console.error('Validation failed:\n  ' + errs.join('\n  '));
    process.exit(1);
  }

  write('MoodSynthVoice.gendsp', JSON.stringify(voiceGen, null, 1));
  write('MoodSynthFX.gendsp', JSON.stringify(fxGen, null, 1));
  write('MoodSynthVoice.maxpat', JSON.stringify(voicePat, null, 1));
  write('MoodSynth.maxpat', JSON.stringify(devicePat, null, 1));
  write('MoodSynth.amxd', buildAmxd(devicePat));
  write('patches.json', JSON.stringify(buildPatchBank(), null, 1));
  write('modsynth.js', DEVICE_JS);

  const exposedCount = EXPOSED.length;
  console.log('MōdSynth Max for Live device built:');
  files.forEach(([f, n]) => console.log('  ' + f.padEnd(26) + (n / 1024).toFixed(1) + ' KB'));
  console.log(`\n  ${exposedCount} parameters exposed to Live`);
  console.log(`  ${Object.keys(buildPatchBank()).length} patches in the bank`);
  console.log('  patcher JSON validated: object ids, patchlines, inlet/outlet ranges, parameter names');
}

if (require.main === module) main();
module.exports = { buildDevicePatcher, buildVoicePatcher, buildPatchBank, buildAmxd, validate, EXPOSED, gendsp, FX_CODE };
