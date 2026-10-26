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

     [ MAGIC, sr, nNodes, 0 ]
     nNodes  x node record
     nEdges, nEdges x [ from, to, toParam (-1 = audio input) ]

   node record: [ type, ...intrinsics, ...params ]
     every param is  [ v0, nEvents, nEvents x [ kind, v, t, tc ] ]
     param order per type is PARAMS below and must match native/modsynth/graph.cpp.
     gain   : params gain
     osc    : wave (0 sine 1 square 2 saw 3 triangle 4 custom), if custom
              nPartials, re..., im...;  start, stop (-1e9 = unset);  params frequency detune
     biq    : filter type;  params frequency detune Q gain
     buf    : buffer id (-1 none), loop, loopStart, loopEnd, start, stop, offset;
              params playbackRate detune
     shp    : oversample (0 none 1 2x 2 4x), nCurve, curve...
     pan    : params pan
     del    : maxDelay;  params delayTime
     ext    : an endpoint that belongs to the host (a part's bus, a send); its
              code: the host's part slot (0..7) or a send (100 and up)

   Event kinds: 0 set, 1 linear ramp, 2 exponential ramp, 3 target (tc is the
   time constant). Times are the context's own, absolute; the caller subtracts
   its base. cancelScheduledValues is applied here, at record time, so the
   program never carries a cancel.

   BUFFERS. A recorded sample is not in the program: it is named by a number,
   and its audio crosses once, ahead of the first graph that uses it
   (Rec.takeNewBuffers() hands the ones not yet announced, as
   {id, sampleRate, channels:[Float32Array...]}). The host keeps them in a
   store and a graph refers to them by id; a graph that names an id the host
   does not have is refused, and the page sends the audio again. The ids come
   from a registry on the page (a WeakMap on the AudioBuffer), so one decoded
   clip is one id for as long as it lives.

   LIVE EDITS. A held note is changed after it has been sent: a release, a
   choke, a glide, a source's stop(). program() marks the graph as sent; from
   then every such call is still applied to the recorder's own timeline (so a
   later read of `.value` is the honest current value) and also written down as
   an increment, which takeIncrements() hands over as a Float64Array of
   [ node, param (-1 = the node itself), op, v, t, tc ] records:
     op 0 set, 1 linear ramp, 2 exponential ramp, 3 target, 4 cancel (t),
        5 cancelAndHold (t), 6 stop (t), 7 start (t)
   Both ends run the same timeline algorithm, so `.value` read here agrees with
   what the native side will do with the edit.

   Not recorded and said so in `unsupported`: setValueCurveAtTime, disconnect,
   createConvolver, createDynamicsCompressor.
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
// "No start() / no stop()" in a program. Not -1: times are relative to the
// note, so a start just before its origin is a small negative number.
const UNSET = -1e9;

// One id per decoded buffer, for the life of the buffer; and which ids the host
// has been told about. Shared by every recorder on the page.
const bufIds = new WeakMap();
let nextBufId = 1;
const announced = new Set();
function bufId(b){ let id = bufIds.get(b); if(id == null){ id = nextBufId++; bufIds.set(b, id); } return id; }

function Rec(opts){
  opts = opts || {};
  const self = this;
  this.sampleRate = opts.sampleRate || 48000;
  // `currentTime` is the page's real clock when there is one (the voice code
  // reads it for "now"), a settable number otherwise. `base` is what the program
  // subtracts from every time: the moment the note's graph was opened.
  this._time = opts.time || 0;
  this._timeSource = opts.timeSource || null;
  Object.defineProperty(this, 'currentTime', { get(){ return self._timeSource ? self._timeSource() : self._time; }, set(v){ self._time = v; } });
  this.base = opts.base != null ? opts.base : this.currentTime;
  // How the page's own shared nodes (a part's bus, a send) are named to the
  // host: resolve(realNode) returns a code, {code, gain} to put a fixed gain in
  // front of it, or null when it is not one the host knows. A null is counted
  // in `unresolved` and the connection is dropped.
  this._resolve = opts.resolve || null;
  this.onEdit = opts.onEdit || null;     // called once when edits start to pile up
  this._dirty = false;
  this._realCtx = opts.realCtx || null;  // buffers are made by it, so they stay real
  this.unresolved = {};
  this._sinks = {};
  this.nodes = [];
  this.edges = [];
  this.bufs = [];           // AudioBuffer stand-ins, by identity
  this.unsupported = {};
  this.sent = false;
  this.inc = [];
  const nope = what => { self.unsupported[what] = (self.unsupported[what]||0) + 1; };
  this._nope = nope;
  const touch = () => { if(self.onEdit && !self._dirty){ self._dirty = true; self.onEdit(self); } };

  const OP = { set:0, lin:1, exp:2, tgt:3, cancel:4, hold:5, stop:6, start:7 };
  class Param {
    constructor(node, name, v0){
      this.node = node; this.name = name; this.v0 = v0; this.ev = [];
      this.defaultValue = v0;
    }
    _pi(){ return PARAMS[this.node.kind].indexOf(this.name); }
    _emit(op, v, t, tc){ if(self.sent){ self.inc.push(this.node.id, this._pi(), op, v, t, tc); touch(); } }
    // The timeline's value at time t, by the same rules native/modsynth/graph.cpp
    // uses (set, ramps run from the previous event, a target decays from the
    // value it left).
    valueAt(t){
      const ev = this.ev;
      let k = 0; while(k < ev.length && ev[k].t <= t) k++;
      if(k === 0) return this.v0;
      const e = ev[k-1], n = k < ev.length ? ev[k] : null;
      const startOf = i => {
        if(ev[i].kind !== KIND.tgt) return ev[i].v;
        if(i === 0) return this.v0;
        const p = ev[i-1];
        if(p.kind !== KIND.tgt) return p.v;
        return p.v + (startOf(i-1) - p.v) * (p.tc <= 0 ? 0 : Math.exp(-(ev[i].t - p.t) / p.tc));
      };
      if(n && (n.kind === KIND.lin || n.kind === KIND.exp)){
        const base = e.kind === KIND.tgt ? startOf(k-1) : e.v, span = n.t - e.t;
        if(span <= 0) return n.v;
        const x = (t - e.t) / span;
        if(n.kind === KIND.lin) return base + (n.v - base) * x;
        if(base === 0 || (base < 0) !== (n.v < 0) || n.v === 0) return base;
        return base * Math.pow(n.v / base, x);
      }
      if(e.kind === KIND.tgt){
        if(e.tc <= 0) return e.v;
        return e.v + (startOf(k-1) - e.v) * Math.exp(-(t - e.t) / e.tc);
      }
      return e.v;
    }
    get value(){ return this.valueAt(self.currentTime); }
    set value(v){
      // The attribute is setValueAtTime(v, currentTime) in effect; before any
      // event it is also just the starting value.
      if(!this.ev.length) this.v0 = v;
      this._push(KIND.set, v, self.currentTime, 0);
      this._emit(OP.set, v, self.currentTime, 0);
    }
    _push(kind, v, t, tc){
      // Insert after every event at or before t, the way the spec orders ties.
      let i = this.ev.length;
      while(i > 0 && this.ev[i-1].t > t) i--;
      this.ev.splice(i, 0, { kind, v, t, tc });
    }
    _anchor(){ // a ramp with nothing before it starts at "now", from the held value
      if(!this.ev.length){ this._push(KIND.set, this.v0, self.currentTime, 0); this._emit(OP.set, this.v0, self.currentTime, 0); }
    }
    setValueAtTime(v, t){ this._push(KIND.set, v, t, 0); this._emit(OP.set, v, t, 0); return this; }
    linearRampToValueAtTime(v, t){ this._anchor(); this._push(KIND.lin, v, t, 0); this._emit(OP.lin, v, t, 0); return this; }
    exponentialRampToValueAtTime(v, t){ this._anchor(); this._push(KIND.exp, v, t, 0); this._emit(OP.exp, v, t, 0); return this; }
    setTargetAtTime(v, t, tc){ this._push(KIND.tgt, v, t, tc); this._emit(OP.tgt, v, t, tc); return this; }
    cancelScheduledValues(t){ this.ev = this.ev.filter(e => e.t < t); this._emit(OP.cancel, 0, t, 0); return this; }
    // Drops everything after t and holds the value the timeline had reached at
    // t -- but only when something was in progress there: a ramp that ends
    // after t (it is cut short at t, see below), or a target still decaying. A param that is simply sitting at a
    // set value has nothing to hold, and the browser leaves it so; a release
    // ramp added afterwards then starts from that earlier set, not from t.
    // (That is what the app's own releases get from a browser, so it is what
    // is recorded. cancelScheduledValues alone lets a param fall back to its
    // last set value: a choke that way made a hat briefly louder.)
    cancelAndHoldAtTime(t){
      let k = 0; while(k < this.ev.length && this.ev[k].t <= t) k++;
      const e1 = k ? this.ev[k-1] : null, e2 = k < this.ev.length ? this.ev[k] : null;
      const ramp = e2 && (e2.kind === KIND.lin || e2.kind === KIND.exp);
      const tgt = e1 && e1.kind === KIND.tgt;
      const v = (ramp || tgt) ? this.valueAt(t) : 0;
      const kind = ramp ? e2.kind : KIND.set;
      this.ev = this.ev.filter(e => e.t <= t);
      // The ramp in progress is not dropped but cut short: the same kind of
      // ramp, ending at t on the value it had reached. Dropping it would leave
      // the param flat from the ramp's start to t.
      if(ramp || tgt) this._push(kind, v, t, 0);
      this._emit(OP.hold, 0, t, 0);
      return this;
    }
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
      else if(dst && dst.context === self) self.edges.push([this.id, dst.id, -1]);
      else {
        // One of the page's own nodes, outside this graph.
        const sink = self._sinkFor(dst);
        if(sink) self.edges.push([this.id, sink.id, -1]);
      }
      return dst;
    }
    // Taking a voice out of its graph is what the page does to clean up after
    // one has ended, and the host retires a finished voice by itself. Before
    // the program is sent it would be surgery, which a program cannot carry.
    disconnect(){ if(!self.sent) nope('disconnect'); }
    addEventListener(){}
    removeEventListener(){}
  }
  class Source extends Node {
    constructor(type, params){ super(type, params); this._start = UNSET; this._stop = UNSET; this.onended = null; }
    start(t, off){
      this._start = (t == null) ? self.currentTime : t; if(off != null) this._offset = off;
      if(self.sent){ self.inc.push(this.id, -1, OP.start, 0, this._start, 0); touch(); }
    }
    stop(t){
      this._stop = (t == null) ? self.currentTime : t;
      if(self.sent){ self.inc.push(this.id, -1, OP.stop, 0, this._stop, 0); touch(); }
    }
  }

  this.destination = this.createExt('destination', opts.destCode != null ? opts.destCode : 0);
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
    if(self._realCtx) return self._realCtx.createBuffer(nCh, len, sr);
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

// The graph's own name for one of the page's real nodes: an ext endpoint, with
// a fixed gain in front when the node is a bus that carries one. Made once per
// (code, gain), so a hundred voices into one bus share one endpoint.
Rec.prototype._sinkFor = function(real){
  const r = this._resolve ? this._resolve(real) : null;
  if(r == null){
    const k = (real && real.constructor && real.constructor.name) || typeof real;
    this.unresolved[k] = (this.unresolved[k] || 0) + 1;
    return null;
  }
  const code = typeof r === 'number' ? r : r.code;
  const g = (typeof r === 'object' && r.gain != null && r.gain !== 1) ? r.gain : null;
  const key = code + ':' + g;
  if(this._sinks[key]) return this._sinks[key];
  const ext = this.createExt('code' + code, code);
  let head = ext;
  if(g != null){
    const gn = this.createGain(); gn.gain.value = g; gn.connect(ext); head = gn;
  }
  this._sinks[key] = head;
  return head;
};

// An endpoint that is the host's, not the graph's: a part bus, a reverb send.
// `name` is how the host knows it. Param edges into one are not meaningful.
Rec.prototype.createExt = function(name, code){
  const self = this;
  const n = { kind: 'ext', id: this.nodes.length, name, code: code == null ? 0 : code, context: this, params: {},
    connect(){ throw new Error('an ext endpoint is a destination only'); } };
  this.nodes.push(n);
  return n;
};

Rec.prototype.program = function(base){
  const B = base != null ? base : this.base;
  const out = [];
  const nodes = this.nodes;
  out.push(MAGIC, this.sampleRate, nodes.length, 0);
  const pushParam = p => { out.push(p.v0, p.ev.length); p.ev.forEach(e => out.push(e.kind, e.v, e.t - B, e.tc)); };
  const rel = t => (t > UNSET / 2 ? t - B : t);
  nodes.forEach(n => {
    if(n.kind === 'ext'){ out.push(T.ext, n.code); return; }
    out.push(T[n.kind]);
    if(n.kind === 'osc'){
      out.push(n.wave);
      if(n.wave === 4){
        const w = n.wavetable || { re: [0], im: [0] };
        out.push(w.re.length); w.re.forEach(v => out.push(v)); w.im.forEach(v => out.push(v));
      }
      out.push(rel(n._start), rel(n._stop));
    } else if(n.kind === 'biq'){
      out.push(n.ftype);
    } else if(n.kind === 'buf'){
      out.push(n.buffer ? bufId(n.buffer) : -1, n.loop ? 1 : 0, n.loopStart, n.loopEnd, rel(n._start), rel(n._stop), n._offset || 0);
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
  this.sent = true;
  return Float64Array.from(out);
};

// Edits made since the program (or the last call), as 6-number records.
// Buffers this recorder's graph uses that the host has not been sent yet. Call
// it before sending the program, send what it returns first, and a buffer then
// goes over once however many notes play it.
Rec.prototype.takeNewBuffers = function(){
  const out = [];
  this.nodes.forEach(n => {
    if(n.kind !== 'buf' || !n.buffer) return;
    const id = bufId(n.buffer);
    if(announced.has(id)) return;
    announced.add(id);
    const chans = []; for(let c = 0; c < n.buffer.numberOfChannels; c++) chans.push(Float32Array.from(n.buffer.getChannelData(c)));
    out.push({ id, sampleRate: n.buffer.sampleRate, channels: chans });
  });
  return out;
};
// The host lost its store (a new engine): every buffer has to be sent again.
Rec.forgetBuffers = function(){ announced.clear(); };

Rec.prototype.takeIncrements = function(base){
  const B = base != null ? base : this.base;
  const a = Float64Array.from(this.inc);
  for(let i = 4; i < a.length; i += 6) a[i] -= B;
  this.inc = []; this._dirty = false; return a;
};

Rec.PARAMS = PARAMS; Rec.T = T; Rec.MAGIC = MAGIC;
root.GraphRec = Rec;
if(typeof module !== 'undefined') module.exports = Rec;
})(typeof window !== 'undefined' ? window : globalThis);
