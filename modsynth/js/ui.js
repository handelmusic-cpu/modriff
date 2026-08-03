/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — control surface
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
    if (cls) n.className = cls;
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
      node.title = (opts.label || this.p.label) + '  ·  drag to change, double-click to reset, right-click to MIDI-learn';

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
      let dragging = false, startY = 0, startT = 0, moved = false;

      const down = e => {
        if (e.button === 2) return;
        dragging = true; moved = false;
        startY = (e.touches ? e.touches[0].clientY : e.clientY);
        startT = MS.toNorm(this.p, this.ui.engine.get(this.id));
        node.classList.add('active');
        e.preventDefault();
      };
      const move = e => {
        if (!dragging) return;
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const dy = startY - y;
        if (Math.abs(dy) > 2) moved = true;
        // 170 px of travel covers the full range; Shift stretches that to
        // 850 px, which is what makes a 12 ms attack settable by hand.
        const span = e.shiftKey ? 850 : 170;
        this.ui.setNorm(this.id, MS.clamp(startT + dy / span, 0, 1));
        e.preventDefault();
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        node.classList.remove('active');
      };

      node.addEventListener('mousedown', down);
      node.addEventListener('touchstart', down, { passive: false });
      doc.addEventListener('mousemove', move);
      doc.addEventListener('touchmove', move, { passive: false });
      doc.addEventListener('mouseup', up);
      doc.addEventListener('touchend', up);

      node.addEventListener('dblclick', () => {
        this.ui.set(this.id, this.p.def);
      });
      node.addEventListener('wheel', e => {
        const t = MS.toNorm(this.p, this.ui.engine.get(this.id));
        this.ui.setNorm(this.id, MS.clamp(t - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02), 0, 1));
        e.preventDefault();
      }, { passive: false });
      node.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.ui.startLearn(this.id);
      });
      // Long-press is the touch equivalent of right-click.
      let holdTimer = null;
      node.addEventListener('touchstart', () => {
        holdTimer = setTimeout(() => { if (!moved) this.ui.startLearn(this.id); }, 650);
      }, { passive: true });
      node.addEventListener('touchend', () => clearTimeout(holdTimer));
      node.addEventListener('touchmove', () => clearTimeout(holdTimer), { passive: true });
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

    startLearn(paramId) {
      if (!this.midi || !this.midi.access) {
        this.app.toast('Connect a MIDI controller first — then right-click any knob to learn it.');
        return;
      }
      this.clearLearn();
      this.learnTarget = paramId;
      this.midi.learn(paramId);
      const list = this.controls.get(paramId);
      if (list) list.forEach(c => c.node.classList.add('learning'));
      this.app.toast('Move a knob or fader on your controller to map it to ' + (MS.PARAM[paramId] || {}).label + '…');
    }

    clearLearn() {
      if (!this.learnTarget) return;
      const list = this.controls.get(this.learnTarget);
      if (list) list.forEach(c => c.node.classList.remove('learning'));
      this.learnTarget = null;
      if (this.midi) this.midi.cancelLearn();
    }

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
      sel.addEventListener('contextmenu', e => { e.preventDefault(); this.startLearn(paramId); });
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
      node.addEventListener('contextmenu', e => { e.preventDefault(); this.startLearn(paramId); });
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

    buildArpPage(host) {
      const rack = el('div', 'rack');

      const arp = this.panel('Arpeggiator', 'perf', { width: 420 });
      arp.head.appendChild(this.toggle('arp.on', 'On'));
      arp.appendChild(this.row(this.select('arp.pattern', { wide: true }), this.select('arp.div'),
        this.select('arp.vel')));
      arp.appendChild(this.knobs('arp.oct', 'arp.gate', 'arp.swing', 'arp.ratchet', 'arp.chance'));
      arp.appendChild(this.row(this.toggle('arp.latch', 'Latch')));
      arp.appendChild(el('div', 'hint',
        'Latch keeps the pattern running after you let go; the next chord you play replaces it.'));
      rack.appendChild(arp);

      const drums = this.panel('Drum Machine', 'fx');
      drums.style.flexBasis = '100%';
      const dr = this.app.drums;

      const onSw = el('label', 'sw');
      onSw.appendChild(el('span', 'sw-box'));
      onSw.appendChild(el('span', null, 'On'));
      onSw.classList.toggle('on', dr.on);
      onSw.addEventListener('click', () => {
        dr.on = !dr.on;
        onSw.classList.toggle('on', dr.on);
        this.app.markDirty();
      });
      drums.head.appendChild(onSw);

      const ctl = this.row();
      const stepsSel = el('select', 'sel');
      [4, 8, 12, 16, 24, 32].forEach(n => { const o = el('option', null, n + ' steps'); o.value = n; stepsSel.appendChild(o); });
      stepsSel.value = dr.steps;
      stepsSel.addEventListener('change', () => { dr.steps = +stepsSel.value; this.buildDrumGrid(); this.app.markDirty(); });

      const divSel = el('select', 'sel');
      MS.DIVS.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; divSel.appendChild(o); });
      divSel.value = dr.div;
      divSel.addEventListener('change', () => { dr.div = divSel.value; this.app.markDirty(); });

      const swing = el('input');
      swing.type = 'range'; swing.min = 0; swing.max = 0.7; swing.step = 0.01; swing.value = dr.swing;
      swing.addEventListener('input', () => { dr.swing = +swing.value; this.app.markDirty(); });

      const vol = el('input');
      vol.type = 'range'; vol.min = 0; vol.max = 1.4; vol.step = 0.01; vol.value = dr.volume;
      vol.addEventListener('input', () => { dr.setVolume(+vol.value); this.app.markDirty(); });

      const clr = el('button', 'btn', 'Clear');
      clr.addEventListener('click', () => { dr.clear(); this.buildDrumGrid(); this.app.markDirty(); });

      ctl.appendChild(stepsSel); ctl.appendChild(divSel);
      ctl.appendChild(el('span', 'row-label', 'Swing')); ctl.appendChild(swing);
      ctl.appendChild(el('span', 'row-label', 'Level')); ctl.appendChild(vol);
      ctl.appendChild(clr);
      drums.appendChild(ctl);

      this._drumHost = el('div', 'drum-grid');
      drums.appendChild(this._drumHost);
      drums.appendChild(el('div', 'hint',
        'Click a step to place a hit, click again to accent it, once more to clear. ' +
        'Click a part name to audition it.'));
      rack.appendChild(drums);

      host.appendChild(rack);
      this.buildDrumGrid();
    }

    buildDrumGrid() {
      const host = this._drumHost;
      if (!host) return;
      host.innerHTML = '';
      const dr = this.app.drums;
      this._dSteps = [];
      MS.DRUM_PARTS.forEach(part => {
        const row = el('div', 'drum-row');
        const name = el('div', 'drum-name', part.label);
        name.addEventListener('click', () => {
          if (this.engine.ctx) dr.trigger(part.id, this.engine.ctx.currentTime + 0.01, 0.9);
        });
        row.appendChild(name);
        const cells = [];
        for (let i = 0; i < dr.steps; i++) {
          const c = el('div', 'dstep');
          const paint = () => {
            const v = dr.pattern[part.id][i];
            c.classList.toggle('on', v > 0);
            c.classList.toggle('accent', v > 0.9);
          };
          c.addEventListener('click', () => {
            // Off → hit → accent → off.
            const v = dr.pattern[part.id][i];
            dr.setStep(part.id, i, v === 0 ? 0.75 : v <= 0.8 ? 1 : 0);
            paint();
            this.app.markDirty();
          });
          paint();
          row.appendChild(c);
          cells.push(c);
        }
        this._dSteps.push(cells);
        host.appendChild(row);
      });
    }

    highlightDrumStep(idx) {
      if (!this._dSteps) return;
      this._dSteps.forEach(cells => {
        cells.forEach((c, i) => c.classList.toggle('playing', i === idx));
      });
    }

    buildMidiPage(host) {
      const rack = el('div', 'rack');

      const ports = this.panel('MIDI Input', 'perf', { width: 380 });
      this._portHost = el('div', 'list');
      ports.appendChild(this._portHost);
      const chRow = this.row('Channel');
      const chSel = el('select', 'sel');
      const omni = el('option', null, 'Omni'); omni.value = '0'; chSel.appendChild(omni);
      for (let c = 1; c <= 16; c++) { const o = el('option', null, String(c)); o.value = c; chSel.appendChild(o); }
      chSel.addEventListener('change', () => { if (this.midi) this.midi.channel = +chSel.value; });
      chRow.appendChild(chSel);
      ports.appendChild(chRow);
      ports.appendChild(el('div', 'hint',
        'If one keyboard shows up twice, every note you play arrives twice — turn the duplicate off here.'));
      rack.appendChild(ports);

      const maps = this.panel('Controller Map', 'perf');
      maps.style.flexBasis = '420px';
      this._mapHost = el('div', 'list');
      maps.appendChild(this._mapHost);
      const tools = this.row();
      const reset = el('button', 'btn', 'Reset to defaults');
      reset.addEventListener('click', () => { if (this.midi) { this.midi.resetMap(); this.refreshMidi(); this.refreshAll(); } });
      tools.appendChild(reset);
      maps.appendChild(tools);
      maps.appendChild(el('div', 'hint',
        'Right-click any knob (or long-press on a touchscreen), then move a control on your ' +
        'hardware to bind it. <b>CC 1 is the mod wheel</b>, CC 64 the sustain pedal and pitch bend ' +
        'has its own message — those three are always connected and can never be re-mapped away.'));
      rack.appendChild(maps);

      const help = this.panel('Playing', 'perf', { width: 380 });
      help.appendChild(el('div', 'hint',
        'Computer keyboard: <kbd>A</kbd>–<kbd>J</kbd> are the white keys, <kbd>W</kbd> <kbd>E</kbd> ' +
        '<kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd> the black ones. <kbd>Z</kbd>/<kbd>X</kbd> shift octave, ' +
        '<kbd>C</kbd>/<kbd>V</kbd> change velocity.<br><br>' +
        'The two strips left of the on-screen keyboard are pitch bend and the mod wheel. ' +
        'Bend springs back to centre when you let go; the wheel stays where you leave it.'));
      rack.appendChild(help);

      host.appendChild(rack);
      this.refreshMidi();
    }

    refreshMidi() {
      if (!this._portHost || !this.midi) return;
      this._portHost.innerHTML = '';
      if (!this.midi.available) {
        this._portHost.appendChild(el('div', 'hint',
          'This browser has no Web MIDI support. Chrome, Edge and Opera do; Safari and Firefox need it enabled.'));
      } else if (!this.midi.inputs.length) {
        this._portHost.appendChild(el('div', 'hint', 'No MIDI inputs found. Connect a controller and it will appear here.'));
      } else {
        this.midi.inputs.forEach(inp => {
          const item = el('div', 'list-item');
          const sw = el('label', 'sw');
          sw.appendChild(el('span', 'sw-box'));
          sw.classList.toggle('on', this.midi.enabled.has(inp.id));
          sw.addEventListener('click', () => {
            const on = !this.midi.enabled.has(inp.id);
            this.midi.enable(inp.id, on);
            sw.classList.toggle('on', on);
          });
          item.appendChild(sw);
          item.appendChild(el('span', 'p', inp.name || 'Unnamed port'));
          this._portHost.appendChild(item);
        });
      }

      this._mapHost.innerHTML = '';
      const list = this.midi.mappings();
      if (!list.length) {
        this._mapHost.appendChild(el('div', 'hint', 'Nothing mapped yet.'));
      }
      list.forEach(({ cc, param }) => {
        const p = MS.PARAM[param];
        const item = el('div', 'list-item');
        item.appendChild(el('span', 'cc', 'CC ' + cc));
        item.appendChild(el('span', 'p', p ? (p.group.toUpperCase() + ' · ' + p.label) : param));
        const x = el('button', 'btn', '✕');
        x.title = 'Unmap';
        x.addEventListener('click', () => { this.midi.unmap(param); this.refreshMidi(); this.refresh(param); });
        item.appendChild(x);
        this._mapHost.appendChild(item);
      });
    }

    /* ── Macro bar ────────────────────────────────────────────────────────── */
    buildMacros(host) {
      this._macroRouteEls = [];
      for (let m = 1; m <= MS.MACRO_COUNT; m++) {
        const slot = el('div', 'macro-slot');
        const k = new Knob(this, 'macro.' + m, { big: true, label: '' });
        // The knob's own label is replaced by an editable macro name.
        k.node.querySelector('.klabel').remove();
        slot.appendChild(k.node);
        const name = el('input', 'macro-name');
        name.value = this.engine.macroNames[m - 1] || ('Macro ' + m);
        name.addEventListener('change', () => {
          this.engine.macroNames[m - 1] = name.value || ('Macro ' + m);
          this.app.markDirty();
        });
        name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
        slot.appendChild(name);
        const routes = el('div', 'macro-routes', '');
        slot.appendChild(routes);
        this._macroRouteEls.push({ routes, name });
        host.appendChild(slot);
      }
      this.refreshMacroRoutes();
    }

    refreshMacroRoutes() {
      if (!this._macroRouteEls) return;
      this._macroRouteEls.forEach((o, i) => {
        o.name.value = this.engine.macroNames[i] || ('Macro ' + (i + 1));
        const routes = MS.Macros.routes(this.engine, i + 1);
        o.routes.textContent = routes.length
          ? routes.map(r => {
              const d = MS.MOD_DESTS.find(x => x[0] === r.dst);
              return (d ? d[1] : r.dst);
            }).slice(0, 3).join(' · ') + (routes.length > 3 ? ' +' + (routes.length - 3) : '')
          : '—';
        o.routes.title = routes.length
          ? routes.map(r => {
              const d = MS.MOD_DESTS.find(x => x[0] === r.dst);
              return (d ? d[1] : r.dst) + '  ' + (r.amt > 0 ? '+' : '') + r.amt.toFixed(2);
            }).join('\n')
          : 'Not routed yet — add rows in the Mod page with source Macro ' + (i + 1) + '.';
      });
    }

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

    /* ── Patch browser ────────────────────────────────────────────────────── */
    buildBrowser(catHost, listHost) {
      this._catHost = catHost;
      this._listHost = listHost;
      this.refreshBrowser();
    }

    refreshBrowser() {
      if (!this._catHost) return;
      const lib = this.lib;

      this._catHost.innerHTML = '';
      const cats = [{ name: 'All', count: lib.all().length }]
        .concat(lib.categories().sort((a, b) => a.name.localeCompare(b.name)));
      cats.forEach(c => {
        const node = el('div', 'cat');
        node.appendChild(el('span', null, c.name));
        node.appendChild(el('span', 'n', String(c.count)));
        node.classList.toggle('on', this.browserFilter.category === c.name);
        node.addEventListener('click', () => {
          this.browserFilter.category = c.name;
          this.refreshBrowser();
        });
        this._catHost.appendChild(node);
      });

      this._listHost.innerHTML = '';
      const results = lib.search(this.browserFilter.q, {
        category: this.browserFilter.category,
        favourites: this.browserFilter.favourites,
      });
      if (!results.length) {
        this._listHost.appendChild(el('div', 'empty', 'Nothing matches that.'));
        return;
      }
      results.forEach(p => {
        const item = el('div', 'patch-item');
        item.classList.toggle('on', !!(lib.current && lib.current.id === p.id));
        const top = el('div', 'n');
        top.textContent = (lib.favourites.has(p.id) ? '★ ' : '') + p.name;
        if (lib.favourites.has(p.id)) top.classList.add('fav');
        item.appendChild(top);
        const sub = el('div', 't', p.tags.slice(0, 4).join(' · ') || p.category);
        item.appendChild(sub);
        if (p.source === 'user') item.appendChild(el('div', 'badge', 'YOURS'));
        item.addEventListener('click', () => this.app.loadPatch(p));
        item.addEventListener('dblclick', () => { this.app.loadPatch(p); this.app.closeBrowser(); });
        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          lib.toggleFavourite(p.id);
          this.refreshBrowser();
        });
        item.title = p.name + '\n' + p.category + '\n' + p.tags.join(', ') +
          '\n\nRight-click to ' + (lib.favourites.has(p.id) ? 'remove from' : 'add to') + ' favourites.';
        this._listHost.appendChild(item);
      });
    }
  }

  MS.UI = UI;
  MS.Knob = Knob;
  MS.el = el;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
