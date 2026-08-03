/* ═══════════════════════════════════════════════════════════════════════════
   MōdSynth — patch library
   ───────────────────────────────────────────────────────────────────────────
   Stores, searches, loads and writes patches. Factory banks live in
   js/patches.js; anything the player saves lands in localStorage alongside
   them and behaves identically from then on.

   A patch is deliberately sparse: it records only the parameters that differ
   from the schema defaults. That keeps files small and readable, and means a
   patch written today still loads correctly after new parameters are added —
   the new ones simply take their defaults.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const STORE_KEY = 'modsynth.user.patches.v1';
  const FAV_KEY = 'modsynth.favourites.v1';
  const FORMAT = 1;

  const MACRO_DEFAULT_NAMES = ['Filter', 'Motion', 'Texture', 'Space', 'Drive', 'Width', 'Tone', 'Chaos'];

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /** Normalises whatever shape a patch arrives in into the canonical form. */
  function normalise(p, source) {
    const out = {
      id: p.id || (source === 'factory' ? 'f:' : 'u:') + slug(p.category || 'misc') + '/' + slug(p.name || 'untitled'),
      name: p.name || 'Untitled',
      category: p.category || 'Misc',
      tags: Array.isArray(p.tags) ? p.tags.slice() : String(p.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      author: p.author || 'MōdSynth',
      source: source || p.source || 'user',
      values: Object.assign(Object.create(null), p.values || {}),
      matrix: (p.matrix || []).map(r =>
        Array.isArray(r) ? { src: r[0], dst: r[1], amt: r[2], uni: r[3] ? 1 : 0 }
                         : { src: r.src, dst: r.dst, amt: r.amt, uni: r.uni ? 1 : 0 }),
      macros: (p.macros || MACRO_DEFAULT_NAMES).slice(0, MS.MACRO_COUNT),
      motion: p.motion ? p.motion.map(a => Float32Array.from(a)) : null,
      drums: p.drums || null,
      notes: p.notes || '',
    };
    while (out.macros.length < MS.MACRO_COUNT) out.macros.push(MACRO_DEFAULT_NAMES[out.macros.length]);
    return out;
  }

  class PatchLib {
    constructor(engine) {
      this.engine = engine;
      this.factory = [];
      this.user = [];
      this.favourites = new Set();
      this.current = null;
      this.dirty = false;
      this.onChange = null;
      this._load();
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) this.user = JSON.parse(raw).map(p => normalise(p, 'user'));
      } catch (e) { this.user = []; }
      try {
        const raw = localStorage.getItem(FAV_KEY);
        if (raw) this.favourites = new Set(JSON.parse(raw));
      } catch (e) { /* first run */ }
    }

    _persist() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.user.map(p => this.serialise(p))));
        localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(this.favourites)));
      } catch (e) {
        console.warn('MōdSynth: could not save patches —', e.message);
      }
      if (this.onChange) this.onChange();
    }

    /** Registers the factory banks. Called once at startup. */
    addFactory(list) {
      list.forEach(p => this.factory.push(normalise(p, 'factory')));
      if (this.onChange) this.onChange();
    }

    all() { return this.factory.concat(this.user); }

    byId(id) { return this.all().find(p => p.id === id) || null; }

    categories() {
      const seen = new Map();
      this.all().forEach(p => seen.set(p.category, (seen.get(p.category) || 0) + 1));
      return Array.from(seen.entries()).map(([name, count]) => ({ name, count }));
    }

    tags() {
      const seen = new Map();
      this.all().forEach(p => p.tags.forEach(t => seen.set(t, (seen.get(t) || 0) + 1)));
      return Array.from(seen.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    }

    /** Free-text search across name, category and tags. */
    search(query, opts) {
      opts = opts || {};
      let list = this.all();
      if (opts.category && opts.category !== 'All') list = list.filter(p => p.category === opts.category);
      if (opts.tag) list = list.filter(p => p.tags.includes(opts.tag));
      if (opts.favourites) list = list.filter(p => this.favourites.has(p.id));
      if (opts.source) list = list.filter(p => p.source === opts.source);
      const q = String(query || '').trim().toLowerCase();
      if (!q) return list;
      const terms = q.split(/\s+/);
      return list.filter(p => {
        const hay = (p.name + ' ' + p.category + ' ' + p.tags.join(' ') + ' ' + p.author).toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }

    /* ── Loading ────────────────────────────────────────────────────────── */

    load(patch) {
      if (typeof patch === 'string') patch = this.byId(patch);
      if (!patch) return null;
      const eng = this.engine;
      const values = MS.paramDefaults();
      Object.keys(patch.values).forEach(k => {
        if (MS.PARAM[k]) values[k] = patch.values[k];
      });

      // Matrix rows are stored separately for readability, but they are
      // ordinary parameters underneath — write them back so a saved patch and
      // a live edit are the same thing.
      for (let i = 0; i < MS.MATRIX_SLOTS; i++) {
        const r = patch.matrix[i];
        values['mtx' + (i + 1) + '.src'] = r ? r.src : 'none';
        values['mtx' + (i + 1) + '.dst'] = r ? r.dst : 'none';
        values['mtx' + (i + 1) + '.amt'] = r ? r.amt : 0;
        values['mtx' + (i + 1) + '.uni'] = r && r.uni ? 1 : 0;
      }

      eng.setAll(values);
      eng.syncMatrixFromParams();
      eng.macroNames = patch.macros.slice();
      for (let lane = 0; lane < 2; lane++) {
        const src = patch.motion && patch.motion[lane];
        const arr = new Float32Array(MS.MOTION_STEPS);
        if (src) for (let i = 0; i < Math.min(src.length, MS.MOTION_STEPS); i++) arr[i] = src[i];
        eng.setMotion(lane, arr);
      }
      for (let m = 1; m <= MS.MACRO_COUNT; m++) eng.setMacro(m, values['macro.' + m] || 0);

      this.current = patch;
      this.dirty = false;
      if (this.onChange) this.onChange();
      return patch;
    }

    /** Builds a patch object from the engine's live state. */
    capture(name, category, tags) {
      const eng = this.engine;
      const values = Object.create(null);
      MS.PARAMS.forEach(p => {
        // Matrix slots round-trip through `matrix`, so leave them out here.
        if (p.id.startsWith('mtx')) return;
        const v = eng.values[p.id];
        if (v !== p.def) values[p.id] = v;
      });
      return normalise({
        name: name || 'Untitled',
        category: category || (this.current ? this.current.category : 'User'),
        tags: tags || (this.current ? this.current.tags : []),
        author: 'You',
        values,
        matrix: eng.matrix.filter(r => r.src !== 'none' && r.dst !== 'none' && r.amt),
        macros: eng.macroNames.slice(),
        motion: [Array.from(eng.motion[0]), Array.from(eng.motion[1])],
        drums: this.drumsProvider ? this.drumsProvider() : null,
      }, 'user');
    }

    /** Serialises for storage/export — Float32Arrays become plain arrays. */
    serialise(p) {
      return {
        format: FORMAT,
        id: p.id, name: p.name, category: p.category, tags: p.tags,
        author: p.author, notes: p.notes,
        values: p.values,
        matrix: p.matrix.map(r => [r.src, r.dst, r.amt, r.uni || 0]),
        macros: p.macros,
        motion: p.motion ? p.motion.map(a => Array.from(a)) : null,
        drums: p.drums,
      };
    }

    /* ── Writing ────────────────────────────────────────────────────────── */

    save(name, category, tags) {
      const patch = this.capture(name, category, tags);
      // Overwriting your own patch of the same name is the expected result of
      // hitting Save twice; overwriting a factory patch never is.
      const existing = this.user.findIndex(p => p.id === patch.id);
      if (existing >= 0) this.user[existing] = patch;
      else this.user.push(patch);
      this.current = patch;
      this.dirty = false;
      this._persist();
      return patch;
    }

    /** Saves under a name that doesn't collide with anything already stored. */
    saveAsCopy(baseName) {
      let n = 2;
      let name = baseName || (this.current ? this.current.name : 'Untitled');
      const taken = new Set(this.all().map(p => p.name.toLowerCase()));
      let candidate = name;
      while (taken.has(candidate.toLowerCase())) candidate = name + ' ' + n++;
      return this.save(candidate, this.current ? this.current.category : 'User',
                       this.current ? this.current.tags : []);
    }

    remove(id) {
      const p = this.byId(id);
      if (!p || p.source === 'factory') return false;
      this.user = this.user.filter(x => x.id !== id);
      this.favourites.delete(id);
      if (this.current && this.current.id === id) this.current = null;
      this._persist();
      return true;
    }

    rename(id, name) {
      const p = this.byId(id);
      if (!p || p.source === 'factory') return false;
      p.name = name;
      p.id = 'u:' + slug(p.category) + '/' + slug(name);
      this._persist();
      return true;
    }

    setTags(id, tags) {
      const p = this.byId(id);
      if (!p || p.source === 'factory') return false;
      p.tags = tags;
      this._persist();
      return true;
    }

    toggleFavourite(id) {
      if (this.favourites.has(id)) this.favourites.delete(id);
      else this.favourites.add(id);
      this._persist();
      return this.favourites.has(id);
    }

    /* ── Interchange ────────────────────────────────────────────────────── */

    exportJSON(ids) {
      const list = ids ? ids.map(i => this.byId(i)).filter(Boolean) : this.user;
      return JSON.stringify({
        format: FORMAT,
        app: 'MōdSynth',
        exported: new Date().toISOString(),
        patches: list.map(p => this.serialise(p)),
      }, null, 1);
    }

    /** Accepts a bank or a single patch. Returns how many were added. */
    importJSON(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
      const list = Array.isArray(data) ? data : data.patches ? data.patches : [data];
      if (!list.length) throw new Error('No patches found in that file.');
      let added = 0;
      const taken = new Set(this.all().map(p => p.id));
      list.forEach(raw => {
        if (!raw || typeof raw !== 'object' || !raw.values) return;
        const p = normalise(raw, 'user');
        while (taken.has(p.id)) p.id += '-2';
        taken.add(p.id);
        this.user.push(p);
        added++;
      });
      if (added) this._persist();
      return added;
    }

    /* ── Generation ─────────────────────────────────────────────────────── */

    /** Blends two patches. Numeric parameters interpolate; enums and switches
        snap at the halfway point, because there is no meaningful value between
        "ladder" and "comb". */
    morph(a, b, t) {
      if (typeof a === 'string') a = this.byId(a);
      if (typeof b === 'string') b = this.byId(b);
      if (!a || !b) return;
      const va = MS.paramDefaults(), vb = MS.paramDefaults();
      Object.assign(va, a.values); Object.assign(vb, b.values);
      const out = MS.paramDefaults();
      MS.PARAMS.forEach(p => {
        if (p.type === 'enum' || p.type === 'bool') out[p.id] = t < 0.5 ? va[p.id] : vb[p.id];
        else out[p.id] = va[p.id] + (vb[p.id] - va[p.id]) * t;
      });
      const src = t < 0.5 ? a : b;
      for (let i = 0; i < MS.MATRIX_SLOTS; i++) {
        const r = src.matrix[i];
        out['mtx' + (i + 1) + '.src'] = r ? r.src : 'none';
        out['mtx' + (i + 1) + '.dst'] = r ? r.dst : 'none';
        out['mtx' + (i + 1) + '.amt'] = r ? r.amt : 0;
        out['mtx' + (i + 1) + '.uni'] = r && r.uni ? 1 : 0;
      }
      this.engine.setAll(out);
      this.engine.syncMatrixFromParams();
      this.current = null;
      this.dirty = true;
      if (this.onChange) this.onChange();
    }

    /** A random patch that is still a *patch* — the ranges are hand-picked per
        parameter so the dice reliably land on something playable rather than
        on silence or noise. */
    randomise(opts) {
      opts = opts || {};
      const amount = opts.amount ?? 1;
      const R = (lo, hi) => lo + Math.random() * (hi - lo);
      const pick = arr => arr[(Math.random() * arr.length) | 0];
      const v = MS.paramDefaults();

      const waves = MS.WAVES.map(w => w[0]);
      v['osc1.wave'] = pick(waves);
      v['osc1.shape'] = R(0, 1);
      v['osc1.pw'] = R(0.15, 0.85);
      v['osc1.uni'] = pick([1, 1, 2, 3, 4, 5, 7]);
      v['osc1.detune'] = R(4, 45);
      v['osc1.width'] = R(0.3, 1);
      v['osc1.level'] = R(0.6, 0.9);

      const twoOsc = Math.random() < 0.65;
      v['osc2.on'] = twoOsc ? 1 : 0;
      if (twoOsc) {
        v['osc2.wave'] = pick(waves);
        v['osc2.shape'] = R(0, 1);
        v['osc2.level'] = R(0.3, 0.8);
        v['osc2.semi'] = pick([-24, -12, -12, -5, 0, 0, 3, 4, 5, 7, 12, 12, 19]);
        v['osc2.fine'] = R(-14, 14);
        v['osc2.uni'] = pick([1, 1, 2, 3, 4]);
        v['osc2.detune'] = R(4, 40);
        if (Math.random() < 0.22) { v['mix.fm'] = R(0.15, 0.7); v['osc2.ratio'] = 1; }
        if (Math.random() < 0.14) v['osc2.sync'] = 1;
        if (Math.random() < 0.14) v['mix.ring'] = R(0.2, 0.7);
      }
      if (Math.random() < 0.5) v['mix.sub'] = R(0.2, 0.85);
      if (Math.random() < 0.35) { v['mix.noise'] = R(0.05, 0.4); v['mix.noiseType'] = pick(['white', 'pink', 'blue', 'crackle']); }

      v['flt1.model'] = pick(['ladder4', 'ladder4', 'ladder2', 'svfLP', 'svfLP', 'svfBP', 'svfHP', 'diode', 'comb', 'formant']);
      v['flt1.cutoff'] = R(180, 9000);
      v['flt1.res'] = R(0, 0.75);
      v['flt1.drive'] = R(0, 0.6);
      v['flt1.env'] = R(-0.4, 0.9);
      v['flt1.keytrack'] = R(0, 0.6);
      if (Math.random() < 0.3) {
        v['flt2.model'] = pick(['svfHP', 'svfLP', 'svfPeak', 'ladder2']);
        v['flt2.cutoff'] = R(80, 4000);
        v['flt2.res'] = R(0, 0.5);
        v['flt.route'] = pick(['serial', 'parallel']);
      }

      const pluck = Math.random() < 0.35;
      v['env1.a'] = pluck ? R(0.001, 0.01) : R(0.005, 1.4);
      v['env1.d'] = R(0.08, 2.5);
      v['env1.s'] = pluck ? R(0, 0.25) : R(0.35, 0.95);
      v['env1.r'] = R(0.06, 2.2);
      v['env2.a'] = R(0.001, 0.4);
      v['env2.d'] = R(0.04, 1.6);
      v['env2.s'] = R(0, 0.7);
      v['env2.r'] = R(0.05, 1.2);

      v['lfo1.shape'] = pick(MS.LFO_SHAPES.map(s => s[0]));
      v['lfo1.rate'] = R(0.1, 8);
      v['lfo2.shape'] = pick(MS.LFO_SHAPES.map(s => s[0]));
      v['lfo2.rate'] = R(0.05, 4);
      v['voice.drift'] = R(0.03, 0.4);
      v['voice.mode'] = pick(['poly', 'poly', 'poly', 'mono', 'legato', 'unison']);
      if (v['voice.mode'] !== 'poly') v['voice.glide'] = Math.random() < 0.5 ? R(0.01, 0.3) : 0;

      v['fx.chorus.on'] = Math.random() < 0.5 ? 1 : 0;
      v['fx.chorus.mix'] = R(0.2, 0.6);
      v['fx.delay.on'] = Math.random() < 0.55 ? 1 : 0;
      v['fx.delay.div'] = pick(['1_8', '1_8d', '1_16', '1_4', '1_8t']);
      v['fx.delay.fb'] = R(0.15, 0.6);
      v['fx.delay.mix'] = R(0.1, 0.35);
      v['fx.reverb.on'] = Math.random() < 0.7 ? 1 : 0;
      v['fx.reverb.size'] = R(0.25, 0.9);
      v['fx.reverb.mix'] = R(0.08, 0.4);
      v['fx.drive.on'] = Math.random() < 0.4 ? 1 : 0;
      v['fx.drive.type'] = pick(MS.DRIVE_TYPES.map(d => d[0]));
      v['fx.drive.amount'] = R(0.1, 0.6);

      // Blend toward the current sound when the dice are turned down.
      if (amount < 1) {
        const cur = this.engine.values;
        MS.PARAMS.forEach(p => {
          if (p.type === 'enum' || p.type === 'bool') { if (Math.random() > amount) v[p.id] = cur[p.id]; }
          else v[p.id] = cur[p.id] + (v[p.id] - cur[p.id]) * amount;
        });
      }

      const matrix = MS.randomMatrix ? MS.randomMatrix() : [];
      for (let i = 0; i < MS.MATRIX_SLOTS; i++) {
        const r = matrix[i];
        v['mtx' + (i + 1) + '.src'] = r ? r[0] : 'none';
        v['mtx' + (i + 1) + '.dst'] = r ? r[1] : 'none';
        v['mtx' + (i + 1) + '.amt'] = r ? r[2] : 0;
        v['mtx' + (i + 1) + '.uni'] = r && r[3] ? 1 : 0;
      }

      this.engine.setAll(v);
      this.engine.syncMatrixFromParams();
      this.engine.macroNames = MACRO_DEFAULT_NAMES.slice();
      this.current = null;
      this.dirty = true;
      if (this.onChange) this.onChange();
      return v;
    }
  }

  MS.PatchLib = PatchLib;
  MS.MACRO_DEFAULT_NAMES = MACRO_DEFAULT_NAMES;
  MS.patchSlug = slug;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
