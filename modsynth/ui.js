/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — control surface, as it lives inside mõdRïff (Mix › mõdSynth)
   ───────────────────────────────────────────────────────────────────────────
   Ported from the standalone app's js/ui.js, keeping its knobs, panels and
   pages. What changed for the host, and why:
     - Every structural class is prefixed mu- (el() does it). mõdRïff has its
       own .panel, .row, .btn, .sel and .tab, and the two sets of rules fought
       over the same elements. State classes (on, active, live) stay bare.
     - A knob turns with a SIDEWAYS drag on touch. The standalone was a fixed
       window, so a vertical drag was free; here the page scrolls, and a rack
       of knobs that each swallowed vertical drags could not be scrolled past.
       The first few pixels decide: across turns the knob, up/down scrolls.
       A mouse still drags vertically, as it did.
     - No MIDI learn, arp, drums or patch browser: mõdRïff has its own, and
       the synth's own arp would fight the part's.
   ───────────────────────────────────────────────────────────────────────────
   Original notes:
   ───────────────────────────────────────────────────────────────────────────
   Builds the whole front panel from the parameter schema. No control is
   hand-written: `knob('flt1.cutoff')` reads the range, curve, unit and default
   straight from js/params.js, so a new parameter appears on the panel, in the
   patch format, in MIDI learn and in the Live device from one declaration.

   Every control is a MIDI-learn target. Right-click (or long-press) any knob
   and the next controller you move is bound to it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const doc = root.document;

  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls.split(' ').map(c => 'mu-' + c).join(' ');
    if (txt != null) n.textContent = txt;
    return n;
  };

  const KNOB_ARC = 270;            // degrees of travel
  const KNOB_START = 135;          // where the arc begins, clockwise from 12 o'clock

  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function arcPath(cx, cy, r, from, to) {
    const [x0, y0] = polar(cx, cy, r, from);
    const [x1, y1] = polar(cx, cy, r, to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  /* ── Knob ─────────────────────────────────────────────────────────────────
     One draggable control bound to one parameter. Vertical drag changes the
     value; Shift is fine, double-click resets to the schema default, and
     bipolar parameters draw their arc outward from the centre so "no
     modulation" reads as an empty ring rather than a half-full one. */
  class Knob {
    constructor(ui, paramId, opts) {
      opts = opts || {};
      this.ui = ui;
      this.id = paramId;
      this.p = MS.PARAM[paramId];
      if (!this.p) throw new Error('unknown parameter: ' + paramId);
      this.bipolar = opts.bipolar !== undefined ? opts.bipolar : (this.p.min < 0 && this.p.max > 0);

      const node = el('div', 'knob' + (opts.big ? ' big' : ''));
      node.dataset.param = paramId;
      node.title = (opts.label || this.p.label) + '  ·  drag to change (sideways on touch), double-click to reset';

      const NS = 'http://www.w3.org/2000/svg';
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 40 40');
      const track = doc.createElementNS(NS, 'path');
      track.setAttribute('class', 'kt');
      track.setAttribute('d', arcPath(20, 20, 15, KNOB_START, KNOB_START + KNOB_ARC));
      const arc = doc.createElementNS(NS, 'path');
      arc.setAttribute('class', 'ka');
      const cap = doc.createElementNS(NS, 'circle');
      cap.setAttribute('class', 'kc');
      cap.setAttribute('cx', 20); cap.setAttribute('cy', 20); cap.setAttribute('r', 9.5);
      const ptr = doc.createElementNS(NS, 'line');
      ptr.setAttribute('class', 'kp');
      svg.appendChild(track); svg.appendChild(arc); svg.appendChild(cap); svg.appendChild(ptr);

      const label = el('div', 'klabel', opts.label || this.p.label);
      const val = el('div', 'kval', '');
      node.appendChild(svg); node.appendChild(label); node.appendChild(val);

      this.node = node; this.arc = arc; this.ptr = ptr; this.val = val;
      this._bindDrag();
      this.refresh();
      ui.register(this);
    }

    _bindDrag() {
      const node = this.node;
      node.style.touchAction = 'pan-y';
      let dragging = false, startX = 0, startY = 0, startT = 0, mode = null;

      // Mouse: vertical drag, as in the standalone.
      const down = e => {
        if (e.button !== 0) return;
        dragging = true;
        startY = e.clientY;
        startT = MS.toNorm(this.p, this.ui.engine.get(this.id));
        node.classList.add('active');
        e.preventDefault();
      };
      const move = e => {
        if (!dragging) return;
        // 170 px of travel covers the full range; Shift stretches that to
        // 850 px, which is what makes a 12 ms attack settable by hand.
        const span = e.shiftKey ? 850 : 170;
        this.ui.setNorm(this.id, MS.clamp(startT + (startY - e.clientY) / span, 0, 1));
        e.preventDefault();
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        node.classList.remove('active');
      };
      node.addEventListener('mousedown', down);
      doc.addEventListener('mousemove', move);
      doc.addEventListener('mouseup', up);

      // Touch: decided by the first 6 px. Across turns the knob (right is
      // up), so the page keeps its vertical scroll — touch-action: pan-y
      // leaves vertical pans to the browser and hands us the sideways ones.
      node.addEventListener('touchstart', e => {
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY; mode = null;
        startT = MS.toNorm(this.p, this.ui.engine.get(this.id));
      }, { passive: true });
      node.addEventListener('touchmove', e => {
        const t = e.touches[0];
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (mode === null) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          mode = Math.abs(dx) > Math.abs(dy) ? 'turn' : 'scroll';
          if (mode === 'turn') node.classList.add('active');
        }
        if (mode !== 'turn') return;
        if (e.cancelable) e.preventDefault();
        this.ui.setNorm(this.id, MS.clamp(startT + dx / 200, 0, 1));
      }, { passive: false });
      const tend = () => { mode = null; node.classList.remove('active'); };
      node.addEventListener('touchend', tend);
      node.addEventListener('touchcancel', tend);

      node.addEventListener('dblclick', () => {
        this.ui.set(this.id, this.p.def);
      });
      node.addEventListener('wheel', e => {
        const t = MS.toNorm(this.p, this.ui.engine.get(this.id));
        this.ui.setNorm(this.id, MS.clamp(t - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02), 0, 1));
        e.preventDefault();
      }, { passive: false });
    }

    refresh() {
      const raw = this.ui.engine.get(this.id);
      const t = MS.toNorm(this.p, raw);
      const angle = KNOB_START + t * KNOB_ARC;
      const from = this.bipolar ? KNOB_START + KNOB_ARC / 2 : KNOB_START;
      // A zero-length arc renders as a dot, so hide it instead.
      if (Math.abs(angle - from) < 0.6) this.arc.setAttribute('d', '');
      else this.arc.setAttribute('d', arcPath(20, 20, 15, Math.min(from, angle), Math.max(from, angle)));
      const [x1, y1] = polar(20, 20, 4.5, angle);
      const [x2, y2] = polar(20, 20, 9, angle);
      this.ptr.setAttribute('x1', x1.toFixed(2)); this.ptr.setAttribute('y1', y1.toFixed(2));
      this.ptr.setAttribute('x2', x2.toFixed(2)); this.ptr.setAttribute('y2', y2.toFixed(2));
      this.val.textContent = MS.formatParam(this.p, raw);
      const cc = this.ui.midi ? this.ui.midi.ccFor(this.id) : null;
      this.node.classList.toggle('mapped', cc != null);
      if (cc != null) this.node.dataset.cc = 'CC' + cc;
    }
  }

  /* ── The panel builder ──────────────────────────────────────────────────── */
  class UI {
    constructor(app) {
      this.app = app;
      this.engine = app.engine;
      this.midi = app.midi;
      this.lib = app.lib;
      this.controls = new Map();       // paramId → [control, …]
      this.learnTarget = null;
      this.browserFilter = { q: '', category: 'All', favourites: false };
      this._keyEls = new Map();
    }

    register(ctrl) {
      const list = this.controls.get(ctrl.id) || [];
      list.push(ctrl);
      this.controls.set(ctrl.id, list);
    }

    /** Single point through which the panel writes parameters, so every other
        view of the same parameter updates without anyone wiring listeners. */
    set(id, value) {
      this.engine.set(id, value);
      this.refresh(id);
      this.app.markDirty();
    }

    setNorm(id, t) {
      this.engine.setNorm(id, t);
      this.refresh(id);
      this.app.markDirty();
    }

    refresh(id) {
      const list = this.controls.get(id);
      if (list) list.forEach(c => c.refresh());
      if (id && id.startsWith('macro.')) this.refreshMacroRoutes();
    }

    refreshAll() {
      // Arp and FX controls are ordinary registered controls, so they come
      // along with the sweep — only the hand-built views need their own pass.
      this.controls.forEach(list => list.forEach(c => c.refresh()));
      this.refreshMatrix();
      this.refreshMacroRoutes();
      this.refreshMotion();
    }

    startLearn() {}
    clearLearn() {}

    /* ── Small builders ───────────────────────────────────────────────────── */

    knob(paramId, opts) { return new Knob(this, paramId, opts).node; }

    /** A dropdown bound to an enum parameter. */
    select(paramId, opts) {
      opts = opts || {};
      const p = MS.PARAM[paramId];
      const sel = el('select', 'sel' + (opts.wide ? ' wide' : ''));
      sel.title = p.label;
      p.options.forEach(([v, label]) => {
        const o = el('option', null, label);
        o.value = v;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => this.set(paramId, sel.value));
      const ctrl = { id: paramId, node: sel, refresh: () => { sel.value = this.engine.get(paramId); } };
      ctrl.refresh();
      this.register(ctrl);
      if (opts.label) {
        const wrap = el('label', 'sw');
        wrap.appendChild(el('span', null, opts.label));
        wrap.appendChild(sel);
        return wrap;
      }
      return sel;
    }

    /** A toggle bound to a boolean parameter. */
    toggle(paramId, label) {
      const p = MS.PARAM[paramId];
      const node = el('label', 'sw');
      const box = el('span', 'sw-box');
      node.appendChild(box);
      node.appendChild(el('span', null, label || p.label));
      node.addEventListener('click', () => this.set(paramId, this.engine.get(paramId) ? 0 : 1));
      const ctrl = {
        id: paramId, node,
        refresh: () => node.classList.toggle('on', !!this.engine.get(paramId)),
      };
      ctrl.refresh();
      this.register(ctrl);
      return node;
    }

    panel(title, accent, opts) {
      const p = el('div', 'panel');
      if (accent) p.dataset.accent = accent;
      const head = el('div', 'panel-head');
      head.appendChild(el('span', 'dot'));
      head.appendChild(el('span', null, title));
      head.appendChild(el('span', 'spacer'));
      p.appendChild(head);
      p.head = head;
      if (opts && opts.width) {
        // Panels may grow to fill a row, but only so far — without a cap the
        // last panel on a row stretches across the whole window and its knobs
        // end up marooned at one end.
        p.style.flexBasis = opts.width + 'px';
        p.style.maxWidth = Math.round(opts.width * 1.45) + 'px';
      }
      return p;
    }

    row(...kids) {
      const r = el('div', 'row');
      kids.forEach(k => { if (k) r.appendChild(typeof k === 'string' ? el('span', 'row-label', k) : k); });
      return r;
    }

    knobs(...ids) {
      const g = el('div', 'knobs');
      ids.forEach(id => {
        if (!id) return;
        g.appendChild(typeof id === 'string' ? this.knob(id) : id);
      });
      return g;
    }

    /* ── Pages ────────────────────────────────────────────────────────────── */

    buildSynthPage(host) {
      const rack = el('div', 'rack');

      [1, 2].forEach(n => {
        const g = 'osc' + n;
        const p = this.panel('Oscillator ' + n, 'osc', { width: 300 });
        p.head.appendChild(this.toggle(g + '.on', 'On'));
        p.appendChild(this.row(this.select(g + '.wave', { wide: true }),
          n === 2 ? this.toggle('osc2.sync', 'Sync') : null,
          n === 2 ? this.toggle('osc2.ratio', 'Ratio') : null));
        p.appendChild(this.knobs(g + '.shape', g + '.pw', g + '.level', g + '.pan'));
        p.appendChild(this.knobs(g + '.oct', g + '.semi', g + '.fine', g + '.keytrack'));
        p.appendChild(this.knobs(g + '.uni', g + '.detune', g + '.width', g + '.blend'));
        p.appendChild(this.row(this.knob(g + '.phase'), this.toggle(g + '.free', 'Free Phase')));
        rack.appendChild(p);
      });

      const mix = this.panel('Mix & Sources', 'osc', { width: 280 });
      mix.appendChild(this.knobs('mix.fm', 'mix.ring', 'mix.sub', 'mix.noise'));
      mix.appendChild(this.row('Sub', this.select('mix.subWave'), this.knob('mix.subOct')));
      mix.appendChild(this.row('Noise', this.select('mix.noiseType'), this.knob('mix.noiseFlt')));
      rack.appendChild(mix);

      [1, 2].forEach(n => {
        const g = 'flt' + n;
        const p = this.panel('Filter ' + n, 'flt', { width: 300 });
        p.appendChild(this.row(this.select(g + '.model', { wide: true })));
        p.appendChild(this.knobs(g + '.cutoff', g + '.res', g + '.drive'));
        p.appendChild(this.knobs(g + '.env', g + '.keytrack', g + '.vel'));
        if (n === 2) p.appendChild(this.row('Route', this.select('flt.route'), this.knob('flt.blend')));
        rack.appendChild(p);
      });

      [['env1', 'Env 1 · Amp'], ['env2', 'Env 2 · Filter'], ['env3', 'Env 3 · Mod']].forEach(([g, title]) => {
        const p = this.panel(title, 'mod', { width: 300 });
        if (g === 'env3') p.head.appendChild(this.toggle('env3.loop', 'Loop'));
        p.appendChild(this.knobs(g + '.a', g + '.h', g + '.d', g + '.s', g + '.r'));
        p.appendChild(this.knobs(g + '.curve', g + '.vel'));
        p.appendChild(this.envDisplay(g));
        rack.appendChild(p);
      });

      const voice = this.panel('Voice', 'perf', { width: 320 });
      voice.appendChild(this.row(this.select('voice.mode'), this.knob('voice.poly'), this.knob('voice.glide')));
      voice.appendChild(this.row(this.toggle('voice.glideAuto', 'Glide on legato only')));
      voice.appendChild(this.knobs('voice.bendUp', 'voice.bendDown', 'voice.transpose', 'voice.tune'));
      voice.appendChild(this.knobs('voice.drift', 'voice.velAmt', 'voice.velCurve', 'voice.spread'));
      rack.appendChild(voice);

      host.appendChild(rack);
    }

    /** A live ADSR curve, drawn from the same numbers the DSP uses. */
    envDisplay(g) {
      const cv = el('canvas');
      cv.width = 260; cv.height = 46;
      cv.style.width = '100%'; cv.style.height = '46px';
      cv.style.display = 'block'; cv.style.marginTop = '4px';
      cv.style.background = '#05060c';
      cv.style.border = '1px solid var(--border)';
      cv.style.borderRadius = '4px';
      const draw = () => {
        const c = cv.getContext('2d');
        const W = cv.width, H = cv.height, pad = 3;
        c.clearRect(0, 0, W, H);
        const e = k => this.engine.get(g + '.' + k);
        const a = e('a'), h = e('h'), d = e('d'), s = e('s'), r = e('r'), curve = e('curve');
        const total = Math.max(0.05, a + h + d + Math.min(2, r) + 0.35);
        const x = t => pad + (t / total) * (W - pad * 2);
        const y = v => H - pad - v * (H - pad * 2);
        const bend = (t, k) => (k === 0 ? t : t * (1 + k) / (1 + k * t));
        c.beginPath();
        c.moveTo(x(0), y(0));
        const steps = 40;
        for (let i = 1; i <= steps; i++) c.lineTo(x(a * i / steps), y(bend(i / steps, -curve * 0.85)));
        c.lineTo(x(a + h), y(1));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          c.lineTo(x(a + h + d * t), y(1 - (1 - s) * bend(t, 3 + curve * 2.5)));
        }
        const sustainEnd = a + h + d + 0.35;
        c.lineTo(x(sustainEnd), y(s));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          c.lineTo(x(sustainEnd + Math.min(2, r) * t), y(s * (1 - bend(t, 3 + curve * 2.5))));
        }
        c.strokeStyle = '#b98cff';
        c.lineWidth = 1.5;
        c.stroke();
        c.lineTo(x(total), y(0));
        c.lineTo(x(0), y(0));
        c.fillStyle = 'rgba(185,140,255,.13)';
        c.fill();
      };
      draw();
      ['a', 'h', 'd', 's', 'r', 'curve'].forEach(k => this.register({ id: g + '.' + k, node: cv, refresh: draw }));
      return cv;
    }

    buildModPage(host) {
      const rack = el('div', 'rack');

      [1, 2, 3].forEach(n => {
        const g = 'lfo' + n;
        const p = this.panel('LFO ' + n, 'mod', { width: 320 });
        p.appendChild(this.row(this.select(g + '.shape'), this.select(g + '.mode'),
          this.toggle(g + '.sync', 'Sync')));
        p.appendChild(this.row('Rate', this.knob(g + '.rate'), this.select(g + '.div'), this.knob(g + '.depth')));
        p.appendChild(this.knobs(g + '.phase', g + '.pw', g + '.smooth', g + '.delay', g + '.fade'));
        rack.appendChild(p);
      });

      [1, 2].forEach(n => {
        const g = 'mot' + n;
        const p = this.panel('Motion ' + n, 'mod', { width: 420 });
        p.head.appendChild(this.toggle(g + '.on', 'On'));
        p.appendChild(this.row(this.select(g + '.mode'), this.select(g + '.div'),
          this.toggle(g + '.sync', 'Sync'), this.knob(g + '.rate')));
        p.appendChild(this.knobs(g + '.steps', g + '.slew', g + '.depth'));
        p.appendChild(this.motionGrid(n - 1));
        const tools = this.row();
        [['Ramp', i => i / 15 * 2 - 1], ['Saw', i => 1 - i / 15 * 2],
         ['Random', () => Math.random() * 2 - 1], ['Alt', i => (i % 2 ? -1 : 1)],
         ['Clear', () => 0]].forEach(([name, fn]) => {
          const b = el('button', 'btn', name);
          b.addEventListener('click', () => {
            const arr = new Float32Array(MS.MOTION_STEPS);
            for (let i = 0; i < MS.MOTION_STEPS; i++) arr[i] = fn(i);
            this.engine.setMotion(n - 1, arr);
            this.refreshMotion();
            this.app.markDirty();
          });
          tools.appendChild(b);
        });
        p.appendChild(tools);
        rack.appendChild(p);
      });

      const mx = this.panel('Modulation Matrix', 'mod');
      mx.style.flexBasis = '100%';
      const table = el('table', 'matrix');
      const thead = el('thead');
      const hr = el('tr');
      ['', 'Source', 'Destination', 'Amount', ''].forEach(h => hr.appendChild(el('th', null, h)));
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = el('tbody');
      this._mxRows = [];
      for (let i = 0; i < MS.MATRIX_SLOTS; i++) {
        const tr = el('tr');
        tr.appendChild(el('td', 'slot-n', String(i + 1)));

        const srcSel = el('select', 'sel');
        MS.MOD_SOURCES.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; srcSel.appendChild(o); });
        const dstSel = el('select', 'sel');
        MS.MOD_DESTS.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; dstSel.appendChild(o); });

        const amtWrap = el('div', 'mx-amt');
        const amt = el('input');
        amt.type = 'range'; amt.min = -1; amt.max = 1; amt.step = 0.01;
        const amtV = el('span', 'v', '0.00');
        amtWrap.appendChild(amt); amtWrap.appendChild(amtV);

        const uni = el('button', 'btn', '±');
        uni.title = 'Bipolar (±) or unipolar (0…+) — unipolar is what you want for a macro that should only ever add.';

        const write = () => {
          const rows = this.engine.matrix.slice();
          while (rows.length < MS.MATRIX_SLOTS) rows.push({ src: 'none', dst: 'none', amt: 0, uni: 0 });
          rows[i] = { src: srcSel.value, dst: dstSel.value, amt: +amt.value, uni: uni.classList.contains('on') ? 1 : 0 };
          this.engine.setMatrix(rows);
          this.refreshMatrix();
          this.refreshMacroRoutes();
          this.app.markDirty();
        };
        srcSel.addEventListener('change', write);
        dstSel.addEventListener('change', write);
        amt.addEventListener('input', () => { amtV.textContent = (+amt.value).toFixed(2); write(); });
        uni.addEventListener('click', () => { uni.classList.toggle('on'); write(); });

        const td = c => { const t = el('td'); t.appendChild(c); return t; };
        tr.appendChild(td(srcSel)); tr.appendChild(td(dstSel));
        tr.appendChild(td(amtWrap)); tr.appendChild(td(uni));
        tbody.appendChild(tr);
        this._mxRows.push({ tr, srcSel, dstSel, amt, amtV, uni });
      }
      table.appendChild(tbody);
      mx.appendChild(table);
      mx.appendChild(el('div', 'hint',
        'Each row wires one source to one destination. Macros appear as sources m1–m8 — ' +
        'point several rows at the same macro and one knob moves the whole sound.'));
      rack.appendChild(mx);
      host.appendChild(rack);
      this.refreshMatrix();
    }

    motionGrid(lane) {
      const wrap = el('div', 'steps');
      const steps = [];
      for (let i = 0; i < MS.MOTION_STEPS; i++) {
        const s = el('div', 'step');
        const fill = el('div', 'step-fill');
        s.appendChild(fill);
        let drag = false;
        const apply = e => {
          const r = s.getBoundingClientRect();
          const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
          const v = MS.clamp(1 - (y / r.height) * 2, -1, 1);
          this.engine.setMotionStep(lane, i, v);
          this.refreshMotion();
          this.app.markDirty();
        };
        s.addEventListener('mousedown', e => { drag = true; apply(e); e.preventDefault(); });
        s.addEventListener('mousemove', e => { if (drag || e.buttons === 1) apply(e); });
        s.addEventListener('touchstart', e => { drag = true; apply(e); e.preventDefault(); }, { passive: false });
        s.addEventListener('touchmove', e => { if (drag) apply(e); e.preventDefault(); }, { passive: false });
        doc.addEventListener('mouseup', () => { drag = false; });
        doc.addEventListener('touchend', () => { drag = false; });
        wrap.appendChild(s);
        steps.push({ s, fill });
      }
      this._motion = this._motion || [[], []];
      this._motion[lane] = steps;
      return wrap;
    }

    refreshMotion() {
      if (!this._motion) return;
      this._motion.forEach((steps, lane) => {
        steps.forEach((st, i) => {
          const v = this.engine.motion[lane][i];
          // Bars grow up or down from the centre line, so the sign is visible.
          st.fill.style.display = Math.abs(v) < 0.005 ? 'none' : 'block';
          if (v >= 0) { st.fill.style.bottom = '50%'; st.fill.style.top = ''; st.fill.style.height = (v * 50) + '%'; }
          else { st.fill.style.top = '50%'; st.fill.style.bottom = ''; st.fill.style.height = (-v * 50) + '%'; }
        });
      });
    }

    refreshMatrix() {
      if (!this._mxRows) return;
      this._mxRows.forEach((r, i) => {
        const row = this.engine.matrix[i] || { src: 'none', dst: 'none', amt: 0, uni: 0 };
        r.srcSel.value = row.src || 'none';
        r.dstSel.value = row.dst || 'none';
        r.amt.value = row.amt || 0;
        r.amtV.textContent = (+(row.amt || 0)).toFixed(2);
        r.uni.classList.toggle('on', !!row.uni);
        r.tr.classList.toggle('live', row.src !== 'none' && row.dst !== 'none' && !!row.amt);
      });
    }

    buildFxPage(host) {
      const rack = el('div', 'rack');

      const drive = this.panel('Drive', 'fx', { width: 260 });
      drive.head.appendChild(this.toggle('fx.drive.on', 'On'));
      drive.appendChild(this.row(this.select('fx.drive.type', { wide: true })));
      drive.appendChild(this.knobs('fx.drive.amount', 'fx.drive.tone', 'fx.drive.mix'));
      rack.appendChild(drive);

      const crush = this.panel('Bit Crush', 'fx', { width: 220 });
      crush.head.appendChild(this.toggle('fx.crush.on', 'On'));
      crush.appendChild(this.knobs('fx.crush.bits', 'fx.crush.rate', 'fx.crush.mix'));
      rack.appendChild(crush);

      const chorus = this.panel('Chorus', 'fx', { width: 300 });
      chorus.head.appendChild(this.toggle('fx.chorus.on', 'On'));
      chorus.appendChild(this.knobs('fx.chorus.rate', 'fx.chorus.depth', 'fx.chorus.spread',
        'fx.chorus.voices', 'fx.chorus.mix'));
      rack.appendChild(chorus);

      const phaser = this.panel('Phaser', 'fx', { width: 300 });
      phaser.head.appendChild(this.toggle('fx.phaser.on', 'On'));
      phaser.appendChild(this.knobs('fx.phaser.rate', 'fx.phaser.depth', 'fx.phaser.fb',
        'fx.phaser.stages', 'fx.phaser.mix'));
      rack.appendChild(phaser);

      const delay = this.panel('Delay', 'fx', { width: 340 });
      delay.head.appendChild(this.toggle('fx.delay.on', 'On'));
      delay.appendChild(this.row(this.toggle('fx.delay.sync', 'Sync'), this.select('fx.delay.div')));
      delay.appendChild(this.knobs('fx.delay.time', 'fx.delay.fb', 'fx.delay.pong',
        'fx.delay.tone', 'fx.delay.mix'));
      rack.appendChild(delay);

      const rev = this.panel('Reverb', 'fx', { width: 340 });
      rev.head.appendChild(this.toggle('fx.reverb.on', 'On'));
      rev.appendChild(this.knobs('fx.reverb.size', 'fx.reverb.decay', 'fx.reverb.damp',
        'fx.reverb.pre', 'fx.reverb.width', 'fx.reverb.mix'));
      rack.appendChild(rev);

      const eq = this.panel('EQ', 'fx', { width: 340 });
      eq.appendChild(this.knobs('fx.eq.low', 'fx.eq.lowF', 'fx.eq.mid', 'fx.eq.midF',
        'fx.eq.midQ', 'fx.eq.high', 'fx.eq.highF'));
      rack.appendChild(eq);

      const comp = this.panel('Compressor', 'fx', { width: 320 });
      comp.head.appendChild(this.toggle('fx.comp.on', 'On'));
      comp.appendChild(this.knobs('fx.comp.thresh', 'fx.comp.ratio', 'fx.comp.attack',
        'fx.comp.release', 'fx.comp.makeup'));
      rack.appendChild(comp);

      const out = this.panel('Output', 'fx', { width: 240 });
      out.appendChild(this.knobs('fx.width', 'master.vol'));
      out.appendChild(this.row(this.toggle('master.limit', 'Limiter')));
      rack.appendChild(out);

      host.appendChild(rack);
    }

    /* The host draws its own macro bar; it hears about route changes here. */
    refreshMacroRoutes() { if (this.app.macroRoutes) this.app.macroRoutes(); }

    /** One panel serves every part: point it at another part's values. */
    setEngine(engine) { this.engine = engine; this.refreshAll(); }

    /* ── On-screen keyboard ───────────────────────────────────────────────── */
    buildKeyboard(host, lowNote, highNote) {
      host.innerHTML = '';
      this._keyEls.clear();
      const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
      const whites = [];
      for (let n = lowNote; n <= highNote; n++) if (!isBlack(n)) whites.push(n);
      const w = 100 / whites.length;

      let wi = 0;
      for (let n = lowNote; n <= highNote; n++) {
        if (isBlack(n)) continue;
        const k = el('div', 'key white');
        k.style.left = (wi * w) + '%';
        k.style.width = w + '%';
        if (n % 12 === 0) k.appendChild(el('div', 'key-c', 'C' + (Math.floor(n / 12) - 1)));
        this._bindKey(k, n);
        host.appendChild(k);
        this._keyEls.set(n, k);
        wi++;
      }
      wi = 0;
      for (let n = lowNote; n <= highNote; n++) {
        if (isBlack(n)) {
          const k = el('div', 'key black');
          k.style.left = (wi * w - w * 0.3) + '%';
          k.style.width = (w * 0.6) + '%';
          this._bindKey(k, n);
          host.appendChild(k);
          this._keyEls.set(n, k);
        } else wi++;
      }
    }

    _bindKey(node, note) {
      const down = e => {
        // Velocity from where down the key you hit it — a real expressive
        // control on a touchscreen, and free on a mouse.
        const r = node.getBoundingClientRect();
        const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        const vel = MS.clamp(0.35 + (y / r.height) * 0.65, 0.1, 1);
        this.app.noteOn(note, vel, 'screen');
        node._held = true;
        e.preventDefault();
      };
      const up = e => {
        if (!node._held) return;
        node._held = false;
        this.app.noteOff(note, 'screen');
        if (e) e.preventDefault();
      };
      node.addEventListener('mousedown', down);
      node.addEventListener('touchstart', down, { passive: false });
      node.addEventListener('mouseup', up);
      node.addEventListener('mouseleave', up);
      node.addEventListener('touchend', up);
      node.addEventListener('touchcancel', up);
      node.addEventListener('mouseenter', e => { if (e.buttons === 1) down(e); });
    }

    setKeyLit(note, on) {
      const k = this._keyEls.get(note);
      if (k) k.classList.toggle('on', on);
    }

    clearKeys() { this._keyEls.forEach(k => k.classList.remove('on')); }

  }

  MS.UI = UI;
  MS.Knob = Knob;
  MS.el = el;
})(typeof self !== 'undefined' ? self : this);
