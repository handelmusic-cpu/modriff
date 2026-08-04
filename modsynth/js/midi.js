/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — MIDI, mapping and macros
   ───────────────────────────────────────────────────────────────────────────
   Web MIDI input, CC learn against any parameter, and the macro system.

   The wheels are first-class rather than "just another CC". The mod wheel and
   pitch bend go straight to the DSP as dedicated modulation sources: bend is
   applied to pitch with its own up/down ranges before anything else, and the
   wheel is a matrix source every patch can route wherever it likes. Neither
   is affected by MIDI learn, so mapping a controller can never accidentally
   steal them.

   A macro is one knob wired to as many matrix destinations as you want, each
   with its own signed depth. That's what makes a small move a big change:
   turning Macro 1 can open the filter, widen the detune, push the drive and
   pull the reverb back, all at once and all in proportion.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const MAP_KEY = 'modsynth.midi.map.v1';
  const PORTS_KEY = 'modsynth.midi.ports.v1';

  /* Sensible starting points so a controller does something useful before any
     learning happens. CC 21–28 is the most common bank of eight assignable
     encoders; 71/74 are the General MIDI resonance/brightness pair. */
  const DEFAULT_MAP = {
    21: 'macro.1', 22: 'macro.2', 23: 'macro.3', 24: 'macro.4',
    25: 'macro.5', 26: 'macro.6', 27: 'macro.7', 28: 'macro.8',
    74: 'flt1.cutoff', 71: 'flt1.res',
    73: 'env1.a', 72: 'env1.r', 75: 'env1.d', 79: 'env1.s',
    76: 'lfo1.rate', 77: 'lfo1.depth',
    91: 'fx.reverb.mix', 93: 'fx.chorus.mix', 94: 'fx.delay.mix',
    7: 'master.vol',
  };

  /* Controllers the engine consumes directly — never learnable, so a stray
     encoder sweep can't unbind the wheels. */
  const RESERVED_CC = new Set([1, 2, 4, 11, 64, 120, 121, 123]);

  class Midi {
    constructor(engine, opts) {
      opts = opts || {};
      this.engine = engine;
      this.access = null;
      this.inputs = [];
      this.outputs = [];
      this.enabled = new Set();          // input ids we listen to
      this.outputId = null;
      this.thru = false;
      this.channel = 0;                  // 0 = omni, else 1–16
      this.map = Object.assign({}, DEFAULT_MAP);
      this.learnTarget = null;
      this.onLearn = null;               // (paramId, cc) after a successful bind
      this.onPorts = null;               // ports changed
      this.onActivity = null;            // (kind, data) for the UI indicator
      this.lastCC = null;
      this._bendLsb = 0;
      this.pickup = false;               // pickup mode: prevent jumps on patch load
      this._pickupCaught = new Set();    // CCs that have crossed their threshold
      this._pickupPrev = {};             // cc → previous normalized value
      this._load();
    }

    _load() {
      try {
        const raw = localStorage.getItem(MAP_KEY);
        if (raw) this.map = JSON.parse(raw);
      } catch (e) { /* first run */ }
      try {
        const raw = localStorage.getItem(PORTS_KEY);
        if (raw) this._wanted = new Set(JSON.parse(raw));
      } catch (e) { this._wanted = null; }
    }

    _persist() {
      try {
        localStorage.setItem(MAP_KEY, JSON.stringify(this.map));
        localStorage.setItem(PORTS_KEY, JSON.stringify(Array.from(this.enabled)));
      } catch (e) { /* private mode */ }
    }

    get available() { return !!(root.navigator && root.navigator.requestMIDIAccess); }

    async init() {
      if (!this.available) return { ok: false, reason: 'This browser has no Web MIDI support.' };
      try {
        this.access = await root.navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        return { ok: false, reason: 'MIDI access was refused.' };
      }
      this.access.onstatechange = () => this._refresh();
      this._refresh();
      return { ok: true };
    }

    _refresh() {
      if (!this.access) return;
      this.inputs = Array.from(this.access.inputs.values());
      this.outputs = Array.from(this.access.outputs.values());
      this.inputs.forEach(inp => {
        // Default to listening to everything the first time round; after that
        // respect whatever the player last chose.
        const want = this._wanted ? this._wanted.has(inp.id) : true;
        if (want) this.enable(inp.id, true);
        else inp.onmidimessage = null;
      });
      this._wanted = null;
      if (this.onPorts) this.onPorts(this);
    }

    enable(id, on) {
      const inp = this.inputs.find(i => i.id === id);
      if (!inp) return;
      if (on) {
        this.enabled.add(id);
        inp.onmidimessage = ev => this.handle(ev.data);
      } else {
        this.enabled.delete(id);
        inp.onmidimessage = null;
      }
      this._persist();
    }

    setOutput(id) {
      this.outputId = id || null;
    }

    _send(bytes) {
      if (!this.outputId || !this.access) return;
      const out = this.outputs.find(o => o.id === this.outputId);
      if (out) { try { out.send(bytes); } catch (e) { /* port vanished */ } }
    }

    /** Handles one raw MIDI message. */
    handle(data) {
      if (!data || data.length < 1) return;
      const status = data[0];
      if (status >= 0xf0) return;                       // ignore system messages
      const cmd = status & 0xf0;
      const ch = (status & 0x0f) + 1;
      if (this.channel && ch !== this.channel) return;
      if (this.thru) this._send(data);

      const a = data[1] | 0, b = data[2] | 0;
      const eng = this.engine;

      switch (cmd) {
        case 0x90:
          if (b > 0) { this.noteOn(a, b / 127); break; }
          // Note-on with velocity 0 is a note-off; many controllers only send this.
          this.noteOff(a);
          break;
        case 0x80:
          this.noteOff(a);
          break;
        case 0xe0: {
          // 14-bit, centred at 8192.
          const v = ((b << 7) | a) - 8192;
          eng.setBend(v / (v < 0 ? 8192 : 8191));
          if (this.onActivity) this.onActivity('bend', v / 8192);
          break;
        }
        case 0xd0:                                       // channel aftertouch
          eng.setAftertouch(a / 127);
          if (this.onActivity) this.onActivity('at', a / 127);
          break;
        case 0xa0:                                       // poly aftertouch
          eng.setAftertouch(b / 127);
          break;
        case 0xc0:
          if (this.onProgram) this.onProgram(a);
          break;
        case 0xb0:
          this.controlChange(a, b);
          break;
        default:
          break;
      }
    }

    noteOn(note, vel) {
      const app = this.app;
      if (app && app.noteOn) app.noteOn(note, vel, 'midi');
      else this.engine.noteOn(note, vel);
      if (this.onActivity) this.onActivity('note', note);
    }

    noteOff(note) {
      const app = this.app;
      if (app && app.noteOff) app.noteOff(note, 'midi');
      else this.engine.noteOff(note);
    }

    controlChange(cc, value) {
      const eng = this.engine;
      const v = value / 127;
      this.lastCC = cc;

      // Learn first, but never over a reserved controller.
      if (this.learnTarget && !RESERVED_CC.has(cc)) {
        const target = this.learnTarget;
        this.learnTarget = null;
        Object.keys(this.map).forEach(k => { if (this.map[k] === target) delete this.map[k]; });
        this.map[cc] = target;
        this._persist();
        if (this.onLearn) this.onLearn(target, cc);
        return;
      }

      switch (cc) {
        case 1: eng.setModWheel(v); if (this.onActivity) this.onActivity('mw', v); return;
        case 2: eng.setCC(2, v); return;                 // breath
        case 4: eng.setCC(4, v); return;                 // foot
        case 11: eng.setCC(11, v); return;               // expression
        case 64: eng.setSustain(value >= 64); if (this.onActivity) this.onActivity('sustain', value >= 64); return;
        case 120:
        case 123: eng.allNotesOff(); return;
        case 121:
          eng.setModWheel(0); eng.setBend(0); eng.setAftertouch(0); eng.setSustain(false);
          return;
        default: break;
      }

      const target = this.map[cc];
      if (!target) return;

      // Pickup mode: prevent jumps by requiring the knob to cross the current value first.
      if (this.pickup && !this._pickupCaught.has(cc)) {
        const current = eng.getNorm(target);
        const prev = this._pickupPrev[cc];
        const crossed = prev !== undefined && ((prev <= current && v >= current) || (prev >= current && v <= current));
        this._pickupPrev[cc] = v;
        if (!crossed && Math.abs(v - current) > 0.02) return;  // consumed, but ignored
        this._pickupCaught.add(cc);
      }

      if (target.startsWith('macro.')) {
        eng.setMacro(+target.split('.')[1], v);
      } else {
        eng.setNorm(target, v);
      }
      if (this.onCC) this.onCC(target, v);
    }

    /* ── Learn ──────────────────────────────────────────────────────────── */

    learn(paramId) { this.learnTarget = paramId; }
    cancelLearn() { this.learnTarget = null; }

    unmap(paramId) {
      Object.keys(this.map).forEach(k => { if (this.map[k] === paramId) delete this.map[k]; });
      this._persist();
    }

    ccFor(paramId) {
      const k = Object.keys(this.map).find(c => this.map[c] === paramId);
      return k ? +k : null;
    }

    resetMap() {
      this.map = Object.assign({}, DEFAULT_MAP);
      this._persist();
    }

    togglePickup() {
      this.pickup = !this.pickup;
      this._pickupCaught.clear();
      this._pickupPrev = {};
    }

    resetPickup() {
      this._pickupCaught.clear();
      this._pickupPrev = {};
    }

    mappings() {
      return Object.keys(this.map)
        .map(cc => ({ cc: +cc, param: this.map[cc] }))
        .sort((a, b) => a.cc - b.cc);
    }
  }

  /* ── Macros ───────────────────────────────────────────────────────────────
     Thin helpers over the modulation matrix — a macro is nothing more than
     matrix rows whose source is m1…m8, which is why macros are automatable,
     savable and MIDI-mappable without any special cases. */
  const Macros = {
    /** Every destination macro `n` currently drives. */
    routes(engine, n) {
      const src = 'm' + n;
      const out = [];
      engine.matrix.forEach((r, i) => {
        if (r && r.src === src && r.dst !== 'none') out.push({ slot: i, dst: r.dst, amt: r.amt, uni: r.uni });
      });
      return out;
    },

    /** Adds a destination. Returns false when the matrix is full. */
    addRoute(engine, n, dst, amt, uni) {
      const rows = engine.matrix.slice();
      while (rows.length < MS.MATRIX_SLOTS) rows.push({ src: 'none', dst: 'none', amt: 0, uni: 0 });
      const free = rows.findIndex(r => !r || r.src === 'none' || r.dst === 'none' || !r.amt);
      if (free < 0) return false;
      rows[free] = { src: 'm' + n, dst, amt: amt === undefined ? 0.5 : amt, uni: uni === undefined ? 1 : uni };
      engine.setMatrix(rows);
      return true;
    },

    setRoute(engine, slot, patch) {
      const rows = engine.matrix.slice();
      while (rows.length < MS.MATRIX_SLOTS) rows.push({ src: 'none', dst: 'none', amt: 0, uni: 0 });
      rows[slot] = Object.assign({}, rows[slot], patch);
      engine.setMatrix(rows);
    },

    removeRoute(engine, slot) {
      const rows = engine.matrix.slice();
      if (!rows[slot]) return;
      rows[slot] = { src: 'none', dst: 'none', amt: 0, uni: 0 };
      engine.setMatrix(rows);
    },

    rename(engine, n, name) { engine.macroNames[n - 1] = name; },
  };

  /* ── Computer keyboard ────────────────────────────────────────────────────
     Two rows laid out like a piano, so the app is playable with no hardware
     at all. Octave shifts on Z/X, velocity on C/V. */
  const KEY_MAP = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
    k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
  };

  class ComputerKeyboard {
    constructor(app) {
      this.app = app;
      this.octave = 4;
      this.velocity = 0.85;
      this.down = new Map();
      this.enabled = true;
      this.onChange = null;
      this._keydown = e => this._onDown(e);
      this._keyup = e => this._onUp(e);
    }

    attach(target) {
      (target || root).addEventListener('keydown', this._keydown);
      (target || root).addEventListener('keyup', this._keyup);
      this._target = target || root;
    }

    detach() {
      if (!this._target) return;
      this._target.removeEventListener('keydown', this._keydown);
      this._target.removeEventListener('keyup', this._keyup);
    }

    _typing(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }

    _onDown(e) {
      if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey || this._typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { this.octave = Math.max(0, this.octave - 1); this._changed(); e.preventDefault(); return; }
      if (k === 'x') { this.octave = Math.min(8, this.octave + 1); this._changed(); e.preventDefault(); return; }
      if (k === 'c') { this.velocity = Math.max(0.1, this.velocity - 0.1); this._changed(); e.preventDefault(); return; }
      if (k === 'v') { this.velocity = Math.min(1, this.velocity + 0.1); this._changed(); e.preventDefault(); return; }
      if (!(k in KEY_MAP) || this.down.has(k)) return;
      const note = 12 * this.octave + KEY_MAP[k];
      if (note < 0 || note > 127) return;
      this.down.set(k, note);
      this.app.noteOn(note, this.velocity, 'keyboard');
      e.preventDefault();
    }

    _onUp(e) {
      if (this._typing(e)) return;
      const k = e.key.toLowerCase();
      if (!this.down.has(k)) return;
      const note = this.down.get(k);
      this.down.delete(k);
      this.app.noteOff(note, 'keyboard');
      e.preventDefault();
    }

    _changed() { if (this.onChange) this.onChange(this); }

    allUp() {
      this.down.forEach(note => this.app.noteOff(note, 'keyboard'));
      this.down.clear();
    }
  }

  MS.Midi = Midi;
  MS.Macros = Macros;
  MS.ComputerKeyboard = ComputerKeyboard;
  MS.MIDI_DEFAULT_MAP = DEFAULT_MAP;
  MS.MIDI_RESERVED_CC = RESERVED_CC;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
