/* A stand-in AudioContext that writes down the graph it is given instead of
   playing it, so the native engine can play the same graph.

   Why this exists (docs/v5-architecture.md, "The graph interpreter"): the page
   builds every note as a small Web Audio graph — makeVoice alone is 900 lines
   of oscillators, gains and filters — and rewriting each voice in C++ by hand
   is a rewrite of the instrument. This records what the voice *builds* and
   sends that, so the voice code stays the single source of truth and the
   native side is one interpreter for a handful of node types.

   The output is one flat Float64Array ("program") rather than JSON, because
   the other end is the render host and a number array crosses the bridge
   without a parser. Layout, all doubles:

     [ MAGIC, sr, nNodes, nBufs ]
     nBufs   x [ nCh, len, ch0..., ch1... ]
     nNodes  x node record
     nEdges, nEdges x [ from, to, toParam (-1 = audio input) ]

   node record: [ type, ...intrinsics, ...params ]
     every param is  [ v0, nEvents, nEvents x [ kind, v, t, tc ] ]
     param order per type is PARAMS below and must match native/modsynth/graph.cpp.
     gain   : params gain
     osc    : wave (0 sine 1 square 2 saw 3 triangle 4 custom), if custom
              nPartials, re..., im...;  start, stop (-1 = unset);  params frequency detune
     biq    : filter type;  params frequency detune Q gain
     buf    : buffer index (-1 none), loop, loopStart, loopEnd, start, stop, offset;
              params playbackRate detune
     shp    : oversample (0 none 1 2x 2 4x), nCurve, curve...
     pan    : params pan
     del    : maxDelay;  params delayTime
     ext    : an endpoint that belongs to the host (the part bus, a send); id only

   Event kinds: 0 set, 1 linear ramp, 2 exponential ramp, 3 target (tc is the
   time constant). Times are the context's own, absolute; the caller subtracts
   its base. cancelScheduledValues is applied here, at record time, so the
   program never carries a cancel.

   Not recorded and said so in `unsupported`: setValueCurveAtTime,
   cancelAndHoldAtTime, disconnect, createConvolver, createDynamicsCompressor.
   A graph that uses one is not sent; it stays on Web Audio. */
(function(root){
'use strict';

const MAGIC = 0x6d6f6467; // 'modg'
const T = { gain:1, osc:2, biq:3, buf:4, shp:5, pan:6, del:7, ext:8 };
const PARAMS = {
  gain:['gain'], osc:['frequency','detune'], biq:['frequency','detune','Q','gain'],
  buf:['playbackRate','detune'], shp:[], pan:['pan'], del:['delayTime'], ext:[]
};
const WAVE = { sine:0, square:1, sawtooth:2, triangle:3 };
const BIQ = { lowpass:0, highpass:1, bandpass:2, lowshelf:3, highshelf:4, peaking:5, notch:6, allpass:7 };
const OVS = { none:0, '2x':1, '4x':2 };
const KIND = { set:0, lin:1, exp:2, tgt:3 };

function Rec(opts){
  opts = opts || {};
  const self = this;
  this.sampleRate = opts.sampleRate || 48000;
  this.currentTime = opts.time || 0;
  this.nodes = [];
  this.edges = [];
  this.bufs = [];           // AudioBuffer stand-ins, by identity
  this.unsupported = {};
  const nope = what => { self.unsupported[what] = (self.unsupported[what]||0) + 1; };
  this._nope = nope;

  class Param {
    constructor(node, name, v0){
      this.node = node; this.name = name; this.v0 = v0; this.ev = [];
      this.defaultValue = v0;
    }
    _cur(){ // the value a ramp with no earlier event starts from
      return this.ev.length ? this.ev[this.ev.length-1].v : this.v0;
    }
    get value(){ return this._cur(); }
    set value(v){
      // The attribute is setValueAtTime(v, currentTime) in effect; before any
      // event it is also just the starting value.
      if(!this.ev.length) this.v0 = v;
      this._push(KIND.set, v, self.currentTime, 0);
    }
    _push(kind, v, t, tc){
      // Insert after every event at or before t, the way the spec orders ties.
      let i = this.ev.length;
      while(i > 0 && this.ev[i-1].t > t) i--;
      this.ev.splice(i, 0, { kind, v, t, tc });
    }
    _anchor(){ // a ramp with nothing before it starts at "now", from the held value
      if(!this.ev.length) this._push(KIND.set, this.v0, self.currentTime, 0);
    }
    setValueAtTime(v, t){ this._push(KIND.set, v, t, 0); return this; }
    linearRampToValueAtTime(v, t){ this._anchor(); this._push(KIND.lin, v, t, 0); return this; }
    exponentialRampToValueAtTime(v, t){ this._anchor(); this._push(KIND.exp, v, t, 0); return this; }
    setTargetAtTime(v, t, tc){ this._push(KIND.tgt, v, t, tc); return this; }
    cancelScheduledValues(t){ this.ev = this.ev.filter(e => e.t < t); return this; }
    cancelAndHoldAtTime(){ nope('cancelAndHoldAtTime'); return this; }
    setValueCurveAtTime(){ nope('setValueCurveAtTime'); return this; }
    // An audio-rate connection into this param is recorded by connect().
  }

  class Node {
    constructor(type, params){
      this.kind = type; this.id = self.nodes.length; self.nodes.push(this);
      this.context = self;
      this.params = {};
      const names = PARAMS[type];
      names.forEach((n, i) => { this.params[n] = new Param(this, n, params[i]); this[n] = this.params[n]; });
      this.numberOfInputs = 1; this.numberOfOutputs = 1;
    }
    connect(dst){
      if(dst instanceof Param) self.edges.push([this.id, dst.node.id, PARAMS[dst.node.kind].indexOf(dst.name)]);
      else self.edges.push([this.id, dst.id, -1]);
      return dst;
    }
    disconnect(){ nope('disconnect'); }
    addEventListener(){}
    removeEventListener(){}
  }
  class Source extends Node {
    constructor(type, params){ super(type, params); this._start = -1; this._stop = -1; this.onended = null; }
    start(t, off){ this._start = (t == null) ? self.currentTime : t; if(off != null) this._offset = off; }
    stop(t){ this._stop = (t == null) ? self.currentTime : t; }
  }

  this.destination = this.createExt('destination');
  this.listener = {};

  this.createGain = () => new Node('gain', [1]);
  this.createOscillator = () => {
    const o = new Source('osc', [440, 0]);
    o.wave = 0; o.wavetable = null;
    Object.defineProperty(o, 'type', {
      get(){ return o._typeName || 'sine'; },
      set(v){ o._typeName = v; o.wave = (v === 'custom') ? 4 : WAVE[v]; o.wavetable = null; }
    });
    o.setPeriodicWave = pw => { o.wave = 4; o.wavetable = pw; o._typeName = 'custom'; };
    return o;
  };
  this.createPeriodicWave = (re, im) => ({ re: Array.from(re), im: Array.from(im) });
  this.createBiquadFilter = () => {
    const b = new Node('biq', [350, 0, 1, 0]);
    b.ftype = 0;
    Object.defineProperty(b, 'type', {
      get(){ return b._typeName || 'lowpass'; },
      set(v){ b._typeName = v; b.ftype = BIQ[v]; }
    });
    return b;
  };
  this.createBufferSource = () => {
    const s = new Source('buf', [1, 0]);
    s.buffer = null; s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    return s;
  };
  this.createBuffer = (nCh, len, sr) => {
    const chans = []; for(let c = 0; c < nCh; c++) chans.push(new Float32Array(len));
    return { numberOfChannels: nCh, length: len, sampleRate: sr, duration: len/sr,
             getChannelData: c => chans[c], _chans: chans };
  };
  this.createWaveShaper = () => {
    const w = new Node('shp', []);
    w.curve = null; w.oversample = 'none';
    return w;
  };
  this.createStereoPanner = () => new Node('pan', [0]);
  this.createDelay = (max) => { const d = new Node('del', [0]); d.maxDelay = max == null ? 1 : max; return d; };
  this.createConvolver = () => { nope('createConvolver'); return new Node('gain', [1]); };
  this.createDynamicsCompressor = () => { nope('createDynamicsCompressor'); return new Node('gain', [1]); };
  this.createAnalyser = () => { nope('createAnalyser'); return new Node('gain', [1]); };
}

// An endpoint that is the host's, not the graph's: a part bus, a reverb send.
// `name` is how the host knows it. Param edges into one are not meaningful.
Rec.prototype.createExt = function(name){
  const self = this;
  const n = { kind: 'ext', id: this.nodes.length, name, context: this, params: {},
    connect(){ throw new Error('an ext endpoint is a destination only'); } };
  this.nodes.push(n);
  return n;
};

Rec.prototype.program = function(){
  const out = [];
  const nodes = this.nodes;
  // buffers, deduplicated by identity
  const bufIdx = new Map(); const bufs = [];
  nodes.forEach(n => { if(n.kind === 'buf' && n.buffer && !bufIdx.has(n.buffer)){ bufIdx.set(n.buffer, bufs.length); bufs.push(n.buffer); } });
  out.push(MAGIC, this.sampleRate, nodes.length, bufs.length);
  bufs.forEach(b => {
    out.push(b.numberOfChannels, b.length);
    for(let c = 0; c < b.numberOfChannels; c++){ const d = b.getChannelData(c); for(let i = 0; i < d.length; i++) out.push(d[i]); }
  });
  const pushParam = p => { out.push(p.v0, p.ev.length); p.ev.forEach(e => out.push(e.kind, e.v, e.t, e.tc)); };
  nodes.forEach(n => {
    if(n.kind === 'ext'){ out.push(T.ext, n.id); return; }
    out.push(T[n.kind]);
    if(n.kind === 'osc'){
      out.push(n.wave);
      if(n.wave === 4){
        const w = n.wavetable || { re: [0], im: [0] };
        out.push(w.re.length); w.re.forEach(v => out.push(v)); w.im.forEach(v => out.push(v));
      }
      out.push(n._start, n._stop);
    } else if(n.kind === 'biq'){
      out.push(n.ftype);
    } else if(n.kind === 'buf'){
      out.push(n.buffer ? bufIdx.get(n.buffer) : -1, n.loop ? 1 : 0, n.loopStart, n.loopEnd, n._start, n._stop, n._offset || 0);
    } else if(n.kind === 'shp'){
      const c = n.curve ? Array.from(n.curve) : [];
      out.push(OVS[n.oversample] || 0, c.length); c.forEach(v => out.push(v));
    } else if(n.kind === 'del'){
      out.push(n.maxDelay);
    }
    PARAMS[n.kind].forEach(k => pushParam(n.params[k]));
  });
  out.push(this.edges.length);
  this.edges.forEach(e => out.push(e[0], e[1], e[2]));
  return Float64Array.from(out);
};

Rec.PARAMS = PARAMS; Rec.T = T; Rec.MAGIC = MAGIC;
root.GraphRec = Rec;
if(typeof module !== 'undefined') module.exports = Rec;
})(typeof window !== 'undefined' ? window : globalThis);
