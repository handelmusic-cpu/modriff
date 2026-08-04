/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — application
   ───────────────────────────────────────────────────────────────────────────
   Wires the engine, the sequencer, MIDI and the control surface together, and
   owns the handful of things that are genuinely app-level: which patch is
   loaded, whether the transport is running, and where a note came from.

   Note routing goes through app.noteOn/noteOff rather than straight to the
   engine, because the arpeggiator has to be able to intercept: when the arp
   is on, held keys feed the pattern instead of sounding directly.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const doc = root.document;

  class App {
    constructor() {
      this.engine = new MS.Engine({ dspUrl: 'js/dsp.js' });
      this.lib = new MS.PatchLib(this.engine);
      this.lib.addFactory(MS.FACTORY_PATCHES);
      this.lib.drumsProvider = () => (this.drums ? this.drums.toJSON() : null);
      this.midi = new MS.Midi(this.engine);
      this.midi.app = this;
      this.transport = null;
      this.arp = null;
      this.drums = null;
      this.ui = null;
      this.started = false;
      this._toastTimer = null;
      this._scopeRaf = null;
    }

    /* ── Startup ────────────────────────────────────────────────────────── */

    async start() {
      const splash = doc.getElementById('splash');
      const err = doc.getElementById('splash-err');
      try {
        await this.engine.init();
      } catch (e) {
        err.textContent = 'Audio could not start: ' + e.message +
          '\n\nMōdSynth needs AudioWorklet. If you opened this file directly and it failed, ' +
          'serve the folder over http (for example: npx serve) or use the single-file build.';
        err.style.whiteSpace = 'pre-wrap';
        return;
      }

      this.transport = new MS.Transport(this.engine);
      this.arp = new MS.Arp(this.engine, this.transport);
      this.drums = new MS.Drums(this.engine, this.transport);
      this.drums.onStep = idx => this.ui && this.ui.highlightDrumStep(idx);
      this.arp.onNote = (note, time) => this._flashKey(note, time);

      this.ui = new MS.UI(this);
      this.buildInterface();

      this.midi.onLearn = (param, cc) => {
        this.ui.clearLearn();
        this.ui.refresh(param);
        this.ui.refreshMidi();
        this.toast('Mapped CC ' + cc + ' → ' + (MS.PARAM[param] || {}).label);
      };
      this.midi.onPorts = () => this.ui.refreshMidi();
      this.midi.onCC = param => this.ui.refresh(param);
      this.midi.onActivity = (kind, v) => this._midiActivity(kind, v);
      this.midi.onProgram = n => {
        const list = this.lib.all();
        if (list[n]) this.loadPatch(list[n]);
      };
      this.midi.init().then(r => {
        if (r.ok) this.ui.refreshMidi();
      });

      this.keys = new MS.ComputerKeyboard(this);
      this.keys.attach(root);
      this.keys.onChange = k => {
        doc.getElementById('kb-info').textContent = 'Oct ' + k.octave + ' · Vel ' + Math.round(k.velocity * 100);
      };

      this.engine.onMeter = () => this._meter();

      // Open on something that shows the instrument off rather than a default sine.
      const opener = this.lib.byId('f:modern/trance-saw') || this.lib.all()[0];
      if (opener) this.loadPatch(opener);

      splash.style.display = 'none';
      this.started = true;
      this._startScope();
      root.addEventListener('blur', () => { this.keys.allUp(); });
    }

    /* ── Interface ──────────────────────────────────────────────────────── */

    buildInterface() {
      const ui = this.ui;
      ui.buildSynthPage(doc.getElementById('page-synth'));
      ui.buildModPage(doc.getElementById('page-mod'));
      ui.buildFxPage(doc.getElementById('page-fx'));
      ui.buildArpPage(doc.getElementById('page-arp'));
      ui.buildMidiPage(doc.getElementById('page-midi'));
      ui.buildMacros(doc.getElementById('macro-bar'));
      ui.buildKeyboard(doc.getElementById('keyboard'), 36, 84);
      ui.buildBrowser(doc.getElementById('cat-list'), doc.getElementById('patch-list'));

      doc.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          doc.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === tab));
          doc.querySelectorAll('.page').forEach(pg => pg.classList.toggle('on', pg.id === 'page-' + tab.dataset.page));
        });
      });

      const on = (id, ev, fn) => { const n = doc.getElementById(id); if (n) n.addEventListener(ev, fn); };

      on('btn-browse', 'click', () => this.openBrowser());
      on('btn-close-browser', 'click', () => this.closeBrowser());
      on('overlay', 'click', e => { if (e.target.id === 'overlay') this.closeBrowser(); });
      on('btn-prev', 'click', () => this.step(-1));
      on('btn-next', 'click', () => this.step(1));
      on('btn-save', 'click', () => this.savePatch());
      on('btn-dice', 'click', () => this.randomise());
      on('btn-panic', 'click', () => { this.engine.panic(); this.arp.clear(); this.ui.clearKeys(); });
      on('btn-play', 'click', () => this.toggleTransport());
      on('btn-init', 'click', () => this.initPatch());
      on('btn-export', 'click', () => this.exportPatches());
      on('btn-import', 'click', () => doc.getElementById('import-file').click());
      on('btn-delete', 'click', () => this.deletePatch());
      on('btn-fav', 'click', () => {
        if (!this.lib.current) return;
        const now = this.lib.toggleFavourite(this.lib.current.id);
        this.ui.refreshBrowser();
        this.toast(now ? 'Added to favourites' : 'Removed from favourites');
      });

      on('search', 'input', e => { this.ui.browserFilter.q = e.target.value; this.ui.refreshBrowser(); });
      on('btn-fav-filter', 'click', e => {
        this.ui.browserFilter.favourites = !this.ui.browserFilter.favourites;
        e.target.classList.toggle('on', this.ui.browserFilter.favourites);
        this.ui.refreshBrowser();
      });

      on('import-file', 'change', e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            const n = this.lib.importJSON(r.result);
            this.ui.refreshBrowser();
            this.toast('Imported ' + n + ' patch' + (n === 1 ? '' : 'es'));
          } catch (err) {
            this.toast(err.message);
          }
        };
        r.readAsText(f);
        e.target.value = '';
      });

      const bpm = doc.getElementById('bpm');
      bpm.value = this.engine.bpm;
      bpm.addEventListener('change', () => this.engine.setTempo(+bpm.value));

      this._bindWheels();
      this.transport.onStepUI = () => {};
      this.lib.onChange = () => this.ui.refreshBrowser();

      doc.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape') { this.closeBrowser(); this.ui.clearLearn(); }
        if (e.key === ' ') { this.toggleTransport(); e.preventDefault(); }
        if (e.key === 'ArrowRight' && e.shiftKey) this.step(1);
        if (e.key === 'ArrowLeft' && e.shiftKey) this.step(-1);
      });
    }

    /** Pitch-bend and mod-wheel strips. Bend springs back, the wheel doesn't. */
    _bindWheels() {
      const setup = (id, opts) => {
        const node = doc.getElementById(id);
        const fill = node.querySelector('.wheel-fill');
        const cap = node.querySelector('.wheel-cap');
        let dragging = false;
        const paint = v => {
          const t = opts.bipolar ? (v + 1) / 2 : v;
          fill.style.height = (t * 100) + '%';
          cap.style.bottom = 'calc(' + (t * 100) + '% - 4px)';
        };
        const apply = e => {
          const r = node.getBoundingClientRect();
          const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
          let t = MS.clamp(1 - y / r.height, 0, 1);
          const v = opts.bipolar ? t * 2 - 1 : t;
          opts.set(v);
          paint(v);
        };
        const down = e => { dragging = true; apply(e); e.preventDefault(); };
        const move = e => { if (dragging) { apply(e); e.preventDefault(); } };
        const up = () => {
          if (!dragging) return;
          dragging = false;
          if (opts.spring) { opts.set(0); paint(0); }
        };
        node.addEventListener('mousedown', down);
        node.addEventListener('touchstart', down, { passive: false });
        doc.addEventListener('mousemove', move);
        doc.addEventListener('touchmove', move, { passive: false });
        doc.addEventListener('mouseup', up);
        doc.addEventListener('touchend', up);
        paint(opts.bipolar ? 0 : 0);
        return paint;
      };
      this._paintBend = setup('wheel-bend', {
        bipolar: true, spring: true, set: v => this.engine.setBend(v),
      });
      this._paintMod = setup('wheel-mod', {
        bipolar: false, spring: false, set: v => this.engine.setModWheel(v),
      });
    }

    _midiActivity(kind, v) {
      if (kind === 'bend' && this._paintBend) this._paintBend(v);
      if (kind === 'mw' && this._paintMod) this._paintMod(v);
    }

    /* ── Notes ──────────────────────────────────────────────────────────── */

    noteOn(note, vel, source) {
      if (this.engine.get('arp.on')) {
        this.arp.noteOn(note, vel);
        this.ui.setKeyLit(note, true);
        return;
      }
      this.engine.noteOn(note, vel);
      this.ui.setKeyLit(note, true);
    }

    noteOff(note, source) {
      if (this.engine.get('arp.on')) {
        this.arp.noteOff(note);
        this.ui.setKeyLit(note, false);
        return;
      }
      this.engine.noteOff(note);
      this.ui.setKeyLit(note, false);
    }

    _flashKey(note, time) {
      // The arp schedules ahead of the clock, so light the key when it sounds.
      const delay = Math.max(0, (time - this.engine.ctx.currentTime) * 1000);
      setTimeout(() => {
        this.ui.setKeyLit(note, true);
        setTimeout(() => this.ui.setKeyLit(note, false), 90);
      }, delay);
    }

    /* ── Patches ────────────────────────────────────────────────────────── */

    loadPatch(patch) {
      this.lib.load(patch);
      if (patch.drums && this.drums) this.drums.fromJSON(patch.drums);
      if (this.midi) this.midi.resetPickup();
      this.ui.refreshAll();
      this.ui.refreshBrowser();
      this.ui.buildDrumGrid();
      this._paintPatchName();
      // Arp and drums follow the patch, so a sequenced sound starts moving.
      if ((this.engine.get('arp.on') || this.drums.on) && !this.transport.playing) this.transport.start();
    }

    step(dir) {
      const list = this.ui.browserFilter.q || this.ui.browserFilter.category !== 'All'
        ? this.lib.search(this.ui.browserFilter.q, { category: this.ui.browserFilter.category })
        : this.lib.all();
      if (!list.length) return;
      let i = this.lib.current ? list.findIndex(p => p.id === this.lib.current.id) : -1;
      i = (i + dir + list.length) % list.length;
      this.loadPatch(list[i]);
    }

    initPatch() {
      const values = MS.paramDefaults();
      values['osc1.on'] = 1;
      this.engine.setAll(values);
      this.engine.syncMatrixFromParams();
      this.engine.macroNames = MS.MACRO_DEFAULT_NAMES.slice();
      for (let l = 0; l < 2; l++) this.engine.setMotion(l, new Float32Array(MS.MOTION_STEPS));
      this.lib.current = null;
      this.lib.dirty = false;
      this.ui.refreshAll();
      this._paintPatchName();
      this.toast('Initialised — one saw, one filter, nothing else.');
    }

    savePatch() {
      const suggested = this.lib.current ? this.lib.current.name : 'My Patch';
      const name = root.prompt('Save patch as:', this.lib.dirty && this.lib.current ? suggested + ' 2' : suggested);
      if (!name) return;
      const cat = root.prompt('Category:', this.lib.current ? this.lib.current.category : 'User') || 'User';
      const patch = this.lib.save(name, cat, this.lib.current ? this.lib.current.tags : []);
      this.ui.refreshBrowser();
      this._paintPatchName();
      this.toast('Saved “' + patch.name + '”');
    }

    deletePatch() {
      const cur = this.lib.current;
      if (!cur) return this.toast('Nothing loaded.');
      if (cur.source === 'factory') return this.toast('Factory patches can’t be deleted — save your own version instead.');
      if (!root.confirm('Delete “' + cur.name + '”? This cannot be undone.')) return;
      this.lib.remove(cur.id);
      this.ui.refreshBrowser();
      this._paintPatchName();
      this.toast('Deleted.');
    }

    exportPatches() {
      const json = this.lib.exportJSON();
      const count = this.lib.user.length;
      if (!count) return this.toast('You haven’t saved any patches yet.');
      const blob = new Blob([json], { type: 'application/json' });
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'modsynth-patches.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.toast('Exported ' + count + ' patch' + (count === 1 ? '' : 'es'));
    }

    randomise() {
      this.lib.randomise({ amount: 1 });
      this.ui.refreshAll();
      this._paintPatchName();
      this.toast('Rolled a new sound. Hit save if you like it.');
    }

    markDirty() {
      if (!this.lib.dirty) {
        this.lib.dirty = true;
        this._paintPatchName();
      }
    }

    _paintPatchName() {
      const cur = this.lib.current;
      doc.getElementById('patch-name').textContent = cur ? cur.name : 'Init';
      doc.getElementById('patch-cat').textContent = cur ? cur.category : 'unsaved';
      doc.getElementById('patch-dirty').textContent = this.lib.dirty ? '●' : '';
      const fav = doc.getElementById('btn-fav');
      if (fav) fav.classList.toggle('on', !!(cur && this.lib.favourites.has(cur.id)));
    }

    /* ── Transport ──────────────────────────────────────────────────────── */

    toggleTransport() {
      this.transport.toggle();
      const b = doc.getElementById('btn-play');
      b.classList.toggle('on', this.transport.playing);
      b.textContent = this.transport.playing ? '■' : '▶';
      if (!this.transport.playing) this.ui.highlightDrumStep(-1);
    }

    /* ── Meters and scope ───────────────────────────────────────────────── */

    _meter() {
      const vu = doc.getElementById('vu-fill');
      if (vu) vu.style.width = Math.min(100, this.engine.peak * 110) + '%';
      const v = doc.getElementById('voice-count');
      if (v) v.textContent = String(this.engine.voiceCount).padStart(2, '0');
    }

    _startScope() {
      const scope = doc.getElementById('scope');
      const spec = doc.getElementById('spectrum');
      if (!scope) return;
      const sc = scope.getContext('2d');
      const sp = spec.getContext('2d');
      const wave = new Uint8Array(1024);
      const bins = new Uint8Array(256);
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      [scope, spec].forEach(c => {
        c.width = c.clientWidth * dpr;
        c.height = c.clientHeight * dpr;
      });

      const tick = () => {
        this._scopeRaf = requestAnimationFrame(tick);
        if (doc.hidden) return;

        this.engine.getWaveform(wave);
        const W = scope.width, H = scope.height;
        sc.clearRect(0, 0, W, H);
        sc.strokeStyle = 'rgba(88,230,255,.9)';
        sc.lineWidth = 1.4 * dpr;
        sc.beginPath();
        // Lock the trace to the first upward zero crossing so a steady note
        // stands still instead of scrolling.
        let start = 0;
        for (let i = 1; i < wave.length / 2; i++) {
          if (wave[i - 1] < 128 && wave[i] >= 128) { start = i; break; }
        }
        const n = Math.min(512, wave.length - start);
        for (let i = 0; i < n; i++) {
          const y = H / 2 - ((wave[start + i] - 128) / 128) * (H / 2 - 2);
          const x = (i / n) * W;
          if (i === 0) sc.moveTo(x, y); else sc.lineTo(x, y);
        }
        sc.stroke();

        this.engine.getSpectrum(bins);
        const SW = spec.width, SH = spec.height;
        sp.clearRect(0, 0, SW, SH);
        const bw = SW / 64;
        for (let i = 0; i < 64; i++) {
          // Log-ish bin spacing so the bass end isn't crushed into one bar.
          const idx = Math.floor(Math.pow(i / 64, 1.7) * 200) + 1;
          const v = bins[Math.min(idx, bins.length - 1)] / 255;
          const h = v * SH;
          sp.fillStyle = `hsl(${190 + v * 90}, 90%, ${35 + v * 30}%)`;
          sp.fillRect(i * bw, SH - h, bw - 1 * dpr, h);
        }
      };
      tick();
    }

    /* ── Browser & toast ────────────────────────────────────────────────── */

    openBrowser() {
      doc.getElementById('overlay').classList.add('on');
      this.ui.refreshBrowser();
      const s = doc.getElementById('search');
      s.focus(); s.select();
    }

    closeBrowser() { doc.getElementById('overlay').classList.remove('on'); }

    toast(msg) {
      const t = doc.getElementById('toast');
      t.textContent = msg;
      t.classList.add('on');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
    }
  }

  MS.App = App;

  doc.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    root.modsynth = app;
    doc.getElementById('splash-go').addEventListener('click', () => app.start());
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
