/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — transport, arpeggiator and drum machine
   ───────────────────────────────────────────────────────────────────────────
   One lookahead clock drives everything rhythmic. It wakes on a timer, works
   out which 16th notes fall inside the next LOOKAHEAD seconds, and hands them
   to the arp and the drums with an exact AudioContext timestamp. Nothing
   rhythmic is ever triggered "now" from a timer callback — the timer only
   decides *what* happens, the audio clock decides *when*.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const TICK_MS = 25;          // how often the scheduler wakes
  const LOOKAHEAD = 0.12;      // seconds of events queued ahead of the clock
  const PPQ = 4;               // scheduler resolution: 16th notes

  class Transport {
    constructor(engine) {
      this.engine = engine;
      this.playing = false;
      this.step = 0;            // 16th-note counter since start
      this.nextTime = 0;
      this.timer = null;
      this.listeners = [];
      this.onStepUI = null;     // called (step) for the playhead, at UI rate
      this._uiStep = -1;
    }

    get bpm() { return this.engine.bpm; }

    /** cb(step, time, stepDur) — step counts 16th notes since start. */
    subscribe(cb) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(x => x !== cb); }; }

    start() {
      if (this.playing || !this.engine.ctx) return;
      this.playing = true;
      this.step = 0;
      this.nextTime = this.engine.ctx.currentTime + 0.06;
      // Re-anchor the worklet's beat clock so synced LFOs and motion lanes
      // start from the top of the bar rather than wherever they had drifted.
      this.engine.setTempo(this.engine.bpm, 0);
      this.timer = setInterval(() => this._tick(), TICK_MS);
      this._tick();
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      this.listeners.forEach(l => { if (l.stop) l.stop(); });
      this.engine.allNotesOff();
    }

    toggle() { if (this.playing) this.stop(); else this.start(); }

    stepDur() { return 60 / this.engine.bpm / PPQ; }

    _tick() {
      const ctx = this.engine.ctx;
      if (!ctx) return;
      const until = ctx.currentTime + LOOKAHEAD;
      let guard = 0;
      while (this.nextTime < until && guard++ < 128) {
        const dur = this.stepDur();
        for (let i = 0; i < this.listeners.length; i++) {
          try { this.listeners[i](this.step, this.nextTime, dur); } catch (e) { console.error(e); }
        }
        this.step++;
        this.nextTime += dur;
      }
      if (this.onStepUI) {
        // Report the step the listener is actually hearing, not the one being
        // queued a lookahead into the future.
        const heard = Math.max(0, this.step - Math.ceil(LOOKAHEAD / this.stepDur()));
        if (heard !== this._uiStep) { this._uiStep = heard; this.onStepUI(heard); }
      }
    }
  }

  /* ── Arpeggiator ──────────────────────────────────────────────────────────
     Holds its own copy of what's down, because in latch mode the pattern must
     outlive the keys. */
  class Arp {
    constructor(engine, transport) {
      this.engine = engine;
      this.transport = transport;
      this.held = [];               // [{note, vel}] in the order played
      this.latched = [];
      this.pos = 0;
      this.dir = 1;
      this.walk = 0;
      this.lastStep = -1;
      this.sounding = [];           // notes we still owe a note-off
      this.onNote = null;           // (note, time) for the UI keyboard
      transport.subscribe((step, time, dur) => this._step(step, time, dur));
    }

    get on() { return !!this.engine.get('arp.on'); }

    noteOn(note, vel) {
      if (this.engine.get('arp.latch') && this.held.length === 0 && this.latched.length) {
        // First key of a new phrase clears the latched chord.
        this.latched = [];
      }
      this.held = this.held.filter(n => n.note !== note);
      this.held.push({ note, vel });
      if (this.engine.get('arp.latch')) {
        this.latched = this.latched.filter(n => n.note !== note);
        this.latched.push({ note, vel });
      }
    }

    noteOff(note) {
      this.held = this.held.filter(n => n.note !== note);
    }

    clear() { this.held = []; this.latched = []; }

    /** The notes the pattern is currently working from. */
    source() {
      const latch = this.engine.get('arp.latch');
      const src = latch && this.latched.length ? this.latched : this.held;
      return src;
    }

    /** Builds the full note list for the current pattern and octave range. */
    sequence() {
      const src = this.source();
      if (!src.length) return [];
      const pattern = this.engine.get('arp.pattern');
      const octs = Math.max(1, this.engine.get('arp.oct') | 0);
      const byPitch = src.slice().sort((a, b) => a.note - b.note);
      const base = pattern === 'played' ? src.slice() : byPitch;

      let seq = [];
      const stack = arr => {
        const out = [];
        for (let o = 0; o < octs; o++) arr.forEach(n => out.push({ note: n.note + o * 12, vel: n.vel }));
        return out;
      };

      switch (pattern) {
        case 'down':
          seq = stack(byPitch.slice().reverse());
          break;
        case 'updown': {
          const u = stack(byPitch);
          seq = u.concat(u.slice(1, -1).reverse());
          break;
        }
        case 'downup': {
          const d = stack(byPitch.slice().reverse());
          seq = d.concat(d.slice(1, -1).reverse());
          break;
        }
        case 'upDownInc': {
          const u = stack(byPitch);
          seq = u.concat(u.slice().reverse());     // repeats the turning notes
          break;
        }
        case 'converge': {
          const a = stack(byPitch);
          seq = [];
          let lo = 0, hi = a.length - 1;
          while (lo <= hi) { seq.push(a[lo++]); if (lo <= hi) seq.push(a[hi--]); }
          break;
        }
        case 'diverge': {
          const a = stack(byPitch);
          const mid = Math.floor(a.length / 2);
          seq = [];
          for (let i = 0; i < a.length; i++) {
            const idx = mid + (i % 2 ? Math.ceil(i / 2) : -Math.ceil(i / 2));
            if (idx >= 0 && idx < a.length) seq.push(a[idx]);
          }
          break;
        }
        case 'thumb': {
          // Lowest note alternating with each of the others.
          const a = stack(byPitch);
          seq = [];
          for (let i = 1; i < a.length; i++) { seq.push(a[0]); seq.push(a[i]); }
          if (!seq.length) seq = a;
          break;
        }
        case 'pinky': {
          const a = stack(byPitch);
          const top = a[a.length - 1];
          seq = [];
          for (let i = 0; i < a.length - 1; i++) { seq.push(a[i]); seq.push(top); }
          if (!seq.length) seq = a;
          break;
        }
        case 'chord':
        case 'random':
        case 'randomWalk':
        case 'played':
        case 'up':
        default:
          seq = stack(base);
          break;
      }
      return seq;
    }

    _step(step, time, dur) {
      if (!this.on) {
        if (this.sounding.length) this._flush(time);
        return;
      }
      const eng = this.engine;
      const divBeats = MS.DIV_BEATS[eng.get('arp.div')] || 0.25;
      const stepsPerNote = Math.max(1, Math.round(divBeats * 4));   // in 16ths
      if (step % stepsPerNote !== 0) return;

      const seq = this.sequence();
      if (!seq.length) { this._flush(time); this.pos = 0; return; }

      const noteDur = dur * stepsPerNote;
      // Swing pushes every other note of the arp's own grid, not the 16th grid.
      const swing = eng.get('arp.swing') || 0;
      const isOff = ((step / stepsPerNote) | 0) % 2 === 1;
      const at = time + (isOff ? swing * noteDur * 0.5 : 0);

      if (Math.random() > (eng.get('arp.chance') ?? 1)) return;

      const pattern = eng.get('arp.pattern');
      let picks;
      if (pattern === 'chord') {
        picks = seq;
      } else if (pattern === 'random') {
        picks = [seq[(Math.random() * seq.length) | 0]];
      } else if (pattern === 'randomWalk') {
        this.walk = MS.clamp(this.walk + (Math.random() < 0.5 ? -1 : 1), 0, seq.length - 1);
        picks = [seq[this.walk]];
      } else {
        if (this.pos >= seq.length) this.pos = 0;
        picks = [seq[this.pos]];
        this.pos = (this.pos + 1) % seq.length;
      }

      const ratchet = Math.max(1, eng.get('arp.ratchet') | 0);
      const gate = eng.get('arp.gate') ?? 0.6;
      const sub = noteDur / ratchet;

      for (let r = 0; r < ratchet; r++) {
        const t = at + r * sub;
        const len = Math.max(0.01, sub * MS.clamp(gate, 0.05, 2));
        picks.forEach(p => {
          if (!p) return;
          const vel = this._velocity(p, step / stepsPerNote, r, ratchet);
          this._fire(p.note, vel, t, len);
        });
      }
    }

    _velocity(p, idx, r, ratchet) {
      const mode = this.engine.get('arp.vel');
      switch (mode) {
        case 'fixed': return 0.8;
        case 'accent': return idx % 4 === 0 ? 1 : 0.55;
        case 'ramp': return ratchet > 1 ? 0.4 + 0.6 * (r / Math.max(1, ratchet - 1)) : 0.45 + 0.5 * ((idx % 8) / 7);
        case 'random': return 0.45 + Math.random() * 0.55;
        default: return p.vel;
      }
    }

    _fire(note, vel, time, len) {
      const eng = this.engine;
      const sr = eng.ctx ? eng.ctx.sampleRate : 48000;
      const onFrame = Math.round(time * sr);
      const offFrame = Math.round((time + len) * sr);
      eng.node.port.postMessage({ t: 'on', note, vel, id: -1, at: onFrame });
      eng.node.port.postMessage({ t: 'off', note, at: offFrame });
      if (this.onNote) this.onNote(note, time, len);
    }

    _flush(time) {
      this.sounding = [];
      this.engine.allNotesOff();
    }

    stop() { this.pos = 0; this.dir = 1; this.sounding = []; }
  }

  /* ── Drum machine ─────────────────────────────────────────────────────────
     Nine synthesised parts. No samples: everything is oscillators, noise and
     envelopes, which keeps the whole instrument a single self-contained file
     and makes every part tunable rather than fixed. */
  const DRUM_PARTS = [
    { id: 'kick',  label: 'Kick',   tune: 52,  decay: 0.42, tone: 0.5, level: 0.9, pan: 0 },
    { id: 'snare', label: 'Snare',  tune: 190, decay: 0.20, tone: 0.5, level: 0.7, pan: 0 },
    { id: 'clap',  label: 'Clap',   tune: 1100, decay: 0.24, tone: 0.5, level: 0.6, pan: 0.15 },
    { id: 'hat',   label: 'Hat',    tune: 8000, decay: 0.055, tone: 0.5, level: 0.45, pan: -0.2 },
    { id: 'ohat',  label: 'Open Hat', tune: 7600, decay: 0.34, tone: 0.5, level: 0.4, pan: -0.2 },
    { id: 'tomL',  label: 'Low Tom', tune: 110, decay: 0.35, tone: 0.5, level: 0.6, pan: -0.35 },
    { id: 'tomH',  label: 'Hi Tom', tune: 220, decay: 0.28, tone: 0.5, level: 0.6, pan: 0.35 },
    { id: 'rim',   label: 'Rim',    tune: 1700, decay: 0.06, tone: 0.5, level: 0.5, pan: 0.3 },
    { id: 'ride',  label: 'Ride',   tune: 5200, decay: 0.9, tone: 0.5, level: 0.35, pan: 0.25 },
  ];
  const DRUM_STEPS = 32;

  class Drums {
    constructor(engine, transport) {
      this.engine = engine;
      this.transport = transport;
      this.on = false;
      this.steps = 16;
      this.div = '1_16';
      this.swing = 0;
      this.volume = 0.8;
      this.kit = {};
      DRUM_PARTS.forEach(p => { this.kit[p.id] = { tune: p.tune, decay: p.decay, tone: p.tone, level: p.level, pan: p.pan }; });
      // pattern[partId] = Float32Array(DRUM_STEPS) of velocities, 0 = off
      this.pattern = {};
      DRUM_PARTS.forEach(p => { this.pattern[p.id] = new Float32Array(DRUM_STEPS); });
      this.onStep = null;
      this.noiseBuf = null;
      transport.subscribe((step, time, dur) => this._step(step, time, dur));
    }

    _bus() {
      const eng = this.engine;
      if (!eng.ctx) return null;
      if (!this.bus) {
        this.bus = eng.ctx.createGain();
        this.bus.gain.value = this.volume;
        // Drums join the chain after the modulation and time effects but
        // before the bus compressor, so they glue with the synth without
        // getting smeared by its reverb tail.
        this.bus.connect(eng.fx.compIn);
        this.bus.connect(eng.fx.compBypass);
        this.revSend = eng.ctx.createGain();
        this.revSend.gain.value = 0;
        this.bus.connect(this.revSend);
        this.revSend.connect(eng.fx.revPre);
      }
      return this.bus;
    }

    _noise() {
      const ctx = this.engine.ctx;
      if (this.noiseBuf) return this.noiseBuf;
      const len = Math.floor(ctx.sampleRate * 1.2);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 0x1234567;
      for (let i = 0; i < len; i++) {
        s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0;
        d[i] = s / 2147483648;
      }
      this.noiseBuf = b;
      return b;
    }

    setStep(part, i, vel) {
      if (!this.pattern[part]) return;
      this.pattern[part][i] = MS.clamp(vel, 0, 1);
    }

    toggleStep(part, i) {
      const cur = this.pattern[part][i];
      this.pattern[part][i] = cur > 0 ? 0 : 0.85;
      return this.pattern[part][i];
    }

    clear() { DRUM_PARTS.forEach(p => this.pattern[p.id].fill(0)); }

    setVolume(v) {
      this.volume = MS.clamp(v, 0, 1.5);
      if (this.bus) this.bus.gain.setTargetAtTime(this.volume, this.engine.ctx.currentTime, 0.01);
    }

    setReverbSend(v) {
      if (this._bus()) this.revSend.gain.setTargetAtTime(MS.clamp(v, 0, 1), this.engine.ctx.currentTime, 0.01);
    }

    _step(step, time, dur) {
      if (!this.on) return;
      const divBeats = MS.DIV_BEATS[this.div] || 0.25;
      const per = Math.max(1, Math.round(divBeats * 4));
      if (step % per !== 0) return;
      const idx = ((step / per) | 0) % this.steps;
      const at = time + (idx % 2 ? this.swing * dur * per * 0.5 : 0);
      DRUM_PARTS.forEach(p => {
        const v = this.pattern[p.id][idx];
        if (v > 0) this.trigger(p.id, at, v);
      });
      if (this.onStep) this.onStep(idx, at);
    }

    /** Fires one drum voice at an exact AudioContext time. */
    trigger(part, time, vel) {
      const eng = this.engine;
      const ctx = eng.ctx;
      const bus = this._bus();
      if (!ctx || !bus) return;
      const k = this.kit[part];
      if (!k) return;
      const t = Math.max(time, ctx.currentTime);
      const amp = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = k.pan; amp.connect(pan); pan.connect(bus); }
      else amp.connect(bus);
      const g = k.level * vel;
      const dec = k.decay;
      const stop = t + dec + 0.05;

      const env = (node, peak, attack, decay) => {
        node.gain.setValueAtTime(0.0001, t);
        node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      };

      const noiseSrc = (dur, filterType, freq, q) => {
        const s = ctx.createBufferSource();
        s.buffer = this._noise();
        s.loop = true;
        s.playbackRate.value = 1 + (k.tone - 0.5) * 0.8;
        const f = ctx.createBiquadFilter();
        f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
        s.connect(f);
        s.start(t); s.stop(t + dur + 0.02);
        return f;
      };

      switch (part) {
        case 'kick': {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(k.tune * 3.2, t);
          o.frequency.exponentialRampToValueAtTime(k.tune, t + 0.055);
          const og = ctx.createGain();
          env(og, g, 0.002, dec);
          o.connect(og); og.connect(amp);
          o.start(t); o.stop(stop);
          // Click layer for definition on small speakers.
          const cl = noiseSrc(0.02, 'highpass', 1200 + k.tone * 3000);
          const cg = ctx.createGain();
          env(cg, g * 0.45 * k.tone, 0.001, 0.018);
          cl.connect(cg); cg.connect(amp);
          break;
        }
        case 'snare': {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(k.tune, t);
          o.frequency.exponentialRampToValueAtTime(k.tune * 0.65, t + dec * 0.6);
          const og = ctx.createGain();
          env(og, g * 0.5, 0.001, dec * 0.7);
          o.connect(og); og.connect(amp);
          o.start(t); o.stop(stop);
          const n = noiseSrc(dec, 'bandpass', 1400 + k.tone * 2600, 0.7);
          const ng = ctx.createGain();
          env(ng, g * 0.9, 0.001, dec);
          n.connect(ng); ng.connect(amp);
          break;
        }
        case 'clap': {
          // Four short bursts a few milliseconds apart is what makes a clap
          // read as a clap rather than a noise blip.
          for (let i = 0; i < 4; i++) {
            const off = i * 0.011;
            const n = ctx.createBufferSource();
            n.buffer = this._noise();
            n.loop = true;
            const f = ctx.createBiquadFilter();
            f.type = 'bandpass'; f.frequency.value = k.tune; f.Q.value = 1.4;
            const ng = ctx.createGain();
            const d = i === 3 ? dec : 0.016;
            ng.gain.setValueAtTime(0.0001, t + off);
            ng.gain.exponentialRampToValueAtTime(Math.max(0.0002, g * (i === 3 ? 1 : 0.7)), t + off + 0.001);
            ng.gain.exponentialRampToValueAtTime(0.0001, t + off + d);
            n.connect(f); f.connect(ng); ng.connect(amp);
            n.start(t + off); n.stop(t + off + d + 0.02);
          }
          break;
        }
        case 'hat':
        case 'ohat': {
          // Six detuned squares through a highpass — the classic 808 recipe.
          const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
          const mix = ctx.createGain();
          ratios.forEach(r => {
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.value = k.tune / 8 * r * (0.6 + k.tone * 0.8);
            o.connect(mix);
            o.start(t); o.stop(stop);
          });
          mix.gain.value = 0.16;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass'; hp.frequency.value = k.tune * 0.75;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = k.tune; bp.Q.value = 0.8;
          const ng = ctx.createGain();
          env(ng, g, 0.001, dec);
          mix.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(amp);
          break;
        }
        case 'tomL':
        case 'tomH': {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(k.tune * 1.9, t);
          o.frequency.exponentialRampToValueAtTime(k.tune, t + dec * 0.5);
          const og = ctx.createGain();
          env(og, g, 0.002, dec);
          o.connect(og); og.connect(amp);
          o.start(t); o.stop(stop);
          const n = noiseSrc(0.03, 'bandpass', k.tune * 4, 1);
          const ng = ctx.createGain();
          env(ng, g * 0.2 * k.tone, 0.001, 0.03);
          n.connect(ng); ng.connect(amp);
          break;
        }
        case 'rim': {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = k.tune;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = k.tune; bp.Q.value = 6;
          const og = ctx.createGain();
          env(og, g, 0.0005, dec);
          o.connect(bp); bp.connect(og); og.connect(amp);
          o.start(t); o.stop(stop);
          break;
        }
        default: {                                   // ride / crash
          const mix = ctx.createGain();
          mix.gain.value = 0.12;
          [1, 1.41, 1.93, 2.61, 3.37, 4.29].forEach(r => {
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.value = k.tune / 10 * r;
            o.connect(mix);
            o.start(t); o.stop(stop);
          });
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = k.tune; bp.Q.value = 0.5;
          const ng = ctx.createGain();
          env(ng, g, 0.002, dec);
          mix.connect(bp); bp.connect(ng); ng.connect(amp);
          break;
        }
      }
    }

    toJSON() {
      const pat = {};
      DRUM_PARTS.forEach(p => { pat[p.id] = Array.from(this.pattern[p.id]); });
      return {
        on: this.on, steps: this.steps, div: this.div, swing: this.swing,
        volume: this.volume, kit: JSON.parse(JSON.stringify(this.kit)), pattern: pat,
      };
    }

    fromJSON(o) {
      if (!o) return;
      this.on = !!o.on;
      this.steps = MS.clamp(o.steps | 0 || 16, 1, DRUM_STEPS);
      this.div = o.div || '1_16';
      this.swing = o.swing || 0;
      this.setVolume(o.volume ?? 0.8);
      if (o.kit) Object.keys(o.kit).forEach(k => { if (this.kit[k]) Object.assign(this.kit[k], o.kit[k]); });
      if (o.pattern) {
        DRUM_PARTS.forEach(p => {
          this.pattern[p.id].fill(0);
          const src = o.pattern[p.id];
          if (src) for (let i = 0; i < Math.min(src.length, DRUM_STEPS); i++) this.pattern[p.id][i] = src[i];
        });
      }
    }
  }

  MS.Transport = Transport;
  MS.Arp = Arp;
  MS.Drums = Drums;
  MS.DRUM_PARTS = DRUM_PARTS;
  MS.DRUM_STEPS = DRUM_STEPS;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
