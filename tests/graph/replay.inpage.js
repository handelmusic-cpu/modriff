/* The native-scheduling spike, page half (docs/native-scheduling.md, slice 0). Runs inside the real page.

   For each kind of voice it records the page's own program for a note (the graph path's recorder, on an
   OfflineAudioContext, with a stand-in plugin), then:
     1. records the same note with one parameter changed (velocity, pitch, duration, accent) at two more
        values, and for each slot of the program fits value = a + b * x on the first two and checks the
        third. A slot that does not obey is reported, not patched.
     2. builds the PREDICTED program for a different note by patching the reference with those fits.
     3. records the note fresh (the truth).
   It writes the pairs as a script for native/modsynth/replaytest, which plays both through the pool and
   reports how deep the null is. A replayed voice is the reference program with `timeBase` set to the time
   it was recorded at, started at the new frame; nothing else is touched but the fitted slots.

   window.__replaySpike() resolves { names, b64, fits }: names the cases in order, b64 the script (float64,
   little endian), fits what the differencing found per voice class. */
window.__replaySpike = async function () {
  const sr = 48000, SECS = 4;
  const offline = new OfflineAudioContext(2, sr * SECS, sr);
  audioCtx = offline;
  const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
  const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
  Object.assign(window._webParams, { 'chord.reverb': 0.4, 'mel.reverb': 0.5 });
  let events = [];
  const BUFS = new Map(), CONFLICT = [];
  const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  MODGRAPH.debug = true;
  modGraphEnable({
    graphBuf: m => { const f = m.channels.map(decf); const had = BUFS.get(m.id); if (had && (had.len !== f[0].length || had.ch[0][0] !== f[0][0])) CONFLICT.push(m.id); BUFS.set(m.id, { sr: m.sampleRate, ch: f, len: f[0].length }); },
    graphBegin: m => events.push({ prog: m.program, gid: m.gid }),
    graphEdit: m => events.push({ edit: m.increments, gid: m.gid }),
  }, ['drum', 'bass', 'chord', 'mel', 'melgen', 'arp']);
  _ensureAllPartBuses(offline);
  const seed = () => { let q = 13579 >>> 0; Math.random = function () { q = (q + 0x6D2B79F5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
  // One recording: the voices (programs) and edits the page sent for one message.
  const rec = async msg => {
    events = []; seed(); window.modEngine.send(Object.assign({ v: 1 }, msg));
    await Promise.resolve(); await Promise.resolve();
    const gids = events.filter(e => e.prog).map(e => e.gid);
    const all = events.filter(e => e.edit).map(e => ({ voice: gids.indexOf(e.gid), inc: dec(e.edit) }));
    // An edit for a voice that is not in this recording is the page choking an earlier one (a closed hat
    // cutting an open hat): that is the scheduler's job in the engine, counted here and not replayed.
    return { voices: events.filter(e => e.prog).map(e => dec(e.prog)), edits: all.filter(e => e.voice >= 0), foreignEdits: all.filter(e => e.voice < 0).length };
  };

  const names = [], fits = {};
  const flat = [];           // the float64 script
  const pushCase = (from, shift, A, aEdits, B, bEdits) => { flat.push(from, shift); pushSide(A, aEdits); pushSide(B, bEdits); };
  const pushSide = (voices, edits) => {
    flat.push(voices.length);
    for (const v of voices) { flat.push(v.timeBase, v.frame, v.prog.length); for (const x of v.prog) flat.push(x); }
    flat.push(edits.length);
    for (const e of edits) { flat.push(e.voice, e.inc.length); for (const x of e.inc) flat.push(x); }
  };
  const frameOf = at => Math.round(at * sr);

  // Fit value = a + b*x per slot from two recordings, and check it on a third.
  const fit = (P0, x0, P1, x1, P2, x2) => {
    const out = { slots: [], bad: [], lenOk: P0.length === P1.length && P0.length === P2.length };
    if (!out.lenOk) return out;
    for (let i = 0; i < P0.length; i++) {
      if (P0[i] === P1[i] && P0[i] === P2[i]) continue;
      const b = (P1[i] - P0[i]) / (x1 - x0), a = P0[i] - b * x0;
      const err = Math.abs(a + b * x2 - P2[i]);
      if (err <= 1e-9 * Math.max(1, Math.abs(P2[i]))) out.slots.push([i, b]); else out.bad.push(i);
    }
    return out;
  };

  // A voice class: base message, and parameters, each with three values, a function making the
  // message for a value, and x(value) the quantity a slot is linear in.
  // The reference is recorded with the lead the page itself gives a voice (it builds it a little before it sounds),
  // a whole number of quanta (18 x 128) that times the rate gives back exactly. A replayed voice is begun that
  // lead before its onset frame, so everything before the onset (a waveshaper's bias, filters settling on it) is
  // what the page's own voice does, and nothing is re-based. (Recorded with no lead and re-based by `timeBase`, the
  // voice differs by the start-up step of that bias: 40 to 80 dB nulls on noise voices.)
  const LEADF = 2304, AT0 = LEADF / sr;
  const classes = [];
  const drum = (kit, lane) => ({
    name: 'drum ' + kit + ' lane ' + lane,
    msg: o => Object.assign({ kind: 'hit', part: 'drum', id: 1, kit, lane, vel: 0.9, accent: false, pitch: 0, dyn: null, at: AT0 }, o),
    params: {
      vel: { vals: [0.9, 0.45, 0.7], set: v => ({ vel: v }), x: v => v },
      accent: { vals: [false, true, true], set: v => ({ accent: v }), x: v => (v ? 1 : 0), twoPoint: true },
      pitch: { vals: [0, -2, 3], set: v => ({ pitch: v }), x: v => Math.pow(2, v / 12), x2: v => v },
    },
    combo: { vel: 0.6, accent: true, pitch: 3 },
  });
  for (const kit of ['808', '909']) for (let l = 0; l < 8; l++) classes.push(drum(kit, l));
  const note = (part, n0, n1, n2, extra, durs) => ({
    name: part + ' note',
    msg: o => Object.assign({ kind: 'note', part, id: 1, note: n0, vel: 0.9, dur: durs[0], at: AT0 }, extra, o),
    params: {
      vel: { vals: [0.9, 0.45, 0.7], set: v => ({ vel: v }), x: v => v },
      pitch: { vals: [n0, n1, n2], set: v => ({ note: v }), x: v => Math.pow(2, v / 12), x2: v => v },
      dur: { vals: durs, set: v => ({ dur: v }), x: v => v },
    },
    combo: { vel: 0.6, pitch: n2, dur: durs[2] },
  });
  classes.push(note('bass', 36, 38, 43, { slide: false, from: null }, [0.4, 0.8, 0.6]));
  classes.push(note('mel', 72, 74, 79, { y: 0.2 }, [0.6, 1.2, 0.9]));
  classes.push(note('melgen', 64, 67, 71, { accent: false }, [0.3, 0.6, 0.45]));
  classes.push(note('arp', 60, 64, 67, { level: 1, pan: 0 }, [0.2, 0.4, 0.3]));
  // A chord is one voice made of a sub oscillator and one block per note, and a block's size depends on its pitch
  // (fewer partials higher up), so it is not transposed here: velocity and duration only.
  classes.push({
    name: 'chord (major triad, fixed pitch)',
    msg: o => Object.assign({ kind: 'chord', part: 'chord', id: 1, root: 60, notes: [60, 64, 67], bass: null, vel: 0.8, dur: 1.0, at: AT0 }, o),
    params: {
      vel: { vals: [0.8, 0.4, 0.6], set: v => ({ vel: v }), x: v => v },
      // Every slot that moves with duration is min(a + b*dur, cap) or max(...): found from a small pair and one long
      // probe, then right to 1e-9 at five unseen durations (285 slot values) in the investigation.
      dur: { vals: [0.3, 0.4, 2.4], test: 0.9, clamp: true, set: v => ({ dur: v }), x: v => v },
    },
    combo: { vel: 0.5, dur: 1.5 },
  });

  const ATS = 62592 / sr;   // 1.304 s: a whole number of quanta (489 x 128), and a time that times the rate gives back that frame exactly
  for (const C of classes) {
    // The first recording of a kind of voice builds caches that draw from the random stream, so its random detunes
    // and phases differ from every later recording's: record once and throw it away.
    await rec(C.msg({}));
    const ref = await rec(C.msg({}));
    if (!ref.voices.length) { fits[C.name] = { skipped: 'no voice' }; continue; }
    const f = { voices: ref.voices.length, len: ref.voices.map(v => v.length), params: {}, foreignEdits: ref.foreignEdits };
    const maps = {};
    const xb = (p, basis) => (basis ? p.x2 : p.x);
    const pnames = Object.keys(C.params).filter(pn => !C.params[pn].clamp);
    const clampModel = {};
    for (const pn of Object.keys(C.params)) {
      const p = C.params[pn]; if (!p.clamp) continue;
      const q = [await rec(C.msg(p.set(p.vals[0]))), await rec(C.msg(p.set(p.vals[1]))), await rec(C.msg(p.set(p.vals[2])))];
      const [x0, x1, x2] = p.vals; let n = 0, capped = 0;
      clampModel[pn] = ref.voices.map((P, k) => {
        const m = new Map();
        if (q.some(r => r.voices.length !== ref.voices.length || r.voices[k].length !== P.length)) return null;
        for (let i = 0; i < P.length; i++) {
          const y0 = q[0].voices[k][i], y1 = q[1].voices[k][i], y2 = q[2].voices[k][i];
          if (y0 === y1 && y0 === y2) continue;
          const b = (y1 - y0) / (x1 - x0), a = y0 - b * x0, lin = a + b * x2;
          const cap = Math.abs(y2 - lin) > 1e-9 * Math.max(1, Math.abs(lin)) ? y2 : null;
          m.set(i, { a, b, cap }); n++; if (cap !== null) capped++;
        }
        return m;
      });
      f.params[pn] = { shape: true, slots: n, bad: 0, lenBad: false, edits: [0, 0, 0], clamped: capped };
    }
    for (const pn of pnames) {
      const p = C.params[pn];
      const r1 = await rec(C.msg(p.set(p.vals[1]))), r2 = await rec(C.msg(p.set(p.vals[2])));
      const shape = r1.voices.length === ref.voices.length && r2.voices.length === ref.voices.length;
      const per = [];
      let slots = 0, bad = 0, lenBad = false;
      if (shape) {
        for (let k = 0; k < ref.voices.length; k++) {
          const ft = fit(ref.voices[k], p.x(p.vals[0]), r1.voices[k], p.x(p.vals[1]), r2.voices[k], p.x(p.vals[2]));
          if (!ft.lenOk) { lenBad = true; per.push(null); continue; }
          ft.slots = ft.slots.map(([i, b]) => [i, b, 0]);
          // A slot that is not linear in frequency may be linear in the note number (a pan or detune that follows pitch).
          if (p.x2 && ft.bad.length) {
            const f2 = fit(ref.voices[k], p.x2(p.vals[0]), r1.voices[k], p.x2(p.vals[1]), r2.voices[k], p.x2(p.vals[2]));
            const got = new Set(f2.slots.map(([i]) => i));
            for (const [i, b] of f2.slots) if (ft.bad.includes(i)) ft.slots.push([i, b, 1]);
            ft.bad = ft.bad.filter(i => !got.has(i));
          }
          per.push(ft); slots += ft.slots.length; bad += ft.bad.length;
        }
      }
      maps[pn] = { per, ok: shape && !lenBad && bad === 0 };
      f.params[pn] = { shape, slots, bad, lenBad, edits: [ref.edits.length, r1.edits.length, r2.edits.length] };
    }
    // When two parameters move the same slot, does it add or multiply? Found from one joint recording (every
    // parameter at its second value) and then used for every other combination.
    const joint = await rec(C.msg(Object.assign({}, ...pnames.map(pn => C.params[pn].set(C.params[pn].vals[1])))));
    const mode = ref.voices.map(() => new Map());
    f.compose = { add: 0, mul: 0, bad: 0 };
    if (joint.voices.length === ref.voices.length) {
      ref.voices.forEach((P, k) => {
        const touch = new Map();   // slot -> [[pn, a, b]]
        for (const pn of pnames) if (maps[pn].per[k]) for (const [i, b, bs] of maps[pn].per[k].slots) { if (!touch.has(i)) touch.set(i, []); touch.get(i).push([pn, P[i] - b * xb(C.params[pn], bs)(C.params[pn].vals[0]), b, bs]); }
        for (const [i, list] of touch) {
          if (list.length < 2) continue;
          let add = P[i], mul = P[i];
          for (const [pn, a, b, bs] of list) { const xf = xb(C.params[pn], bs), x1 = xf(C.params[pn].vals[1]), x0 = xf(C.params[pn].vals[0]); add += b * (x1 - x0); mul *= P[i] !== 0 ? (a + b * x1) / P[i] : 1; }
          const ok = v => Math.abs(v - joint.voices[k][i]) <= 1e-9 * Math.max(1, Math.abs(joint.voices[k][i]));
          const m = ok(add) ? 'add' : ok(mul) ? 'mul' : 'bad';
          mode[k].set(i, m); f.compose[m]++;
        }
      });
    }
    fits[C.name] = f;
    // The prediction: the reference with every parameter's fitted slots moved to the new values.
    const predict = (vals) => {
      return ref.voices.map((P, k) => {
        const q = Float64Array.from(P);
        const touch = new Map();
        for (const pn of pnames) {
          if (vals[pn] === undefined || !maps[pn].per[k]) continue;
          const p = C.params[pn];
          for (const [i, b, bs] of maps[pn].per[k].slots) { const xf = xb(p, bs), x0 = xf(p.vals[0]), x = xf(vals[pn]); if (!touch.has(i)) touch.set(i, []); touch.get(i).push([P[i] - b * x0, b, x0, x]); }
        }
        for (const [i, list] of touch) {
          if (list.length === 1 || mode[k].get(i) !== 'mul') { for (const [, b, x0, x] of list) q[i] += b * (x - x0); }
          else { let v = P[i]; for (const [a, b, , x] of list) v *= (a + b * x) / P[i]; q[i] = v; }
        }
        for (const pn of Object.keys(clampModel)) {
          if (vals[pn] === undefined || !clampModel[pn][k]) continue;
          for (const [i, { a, b, cap }] of clampModel[pn][k]) { const v = a + b * vals[pn]; q[i] = cap === null ? v : (b >= 0 ? Math.min(v, cap) : Math.max(v, cap)); }
        }
        return q;
      });
    };
    const list = [];
    const add = (label, vals, shiftAt) => list.push({ label: C.name + ': ' + label, vals, at: shiftAt == null ? AT0 : shiftAt });
    // single parameters at their validation value, time shift alone, and a combination, with and without a shift
    for (const [pn, p] of Object.entries(C.params)) { const tv = p.test !== undefined ? p.test : p.vals[2]; add(pn + ' = ' + tv, { [pn]: tv }, null); }
    add('start time ' + ATS, {}, ATS);
    add('all parameters together', C.combo, null);
    add('all together and start time ' + ATS, C.combo, ATS);
    for (const c of list) {
      const msg = C.msg(Object.assign({}, ...Object.entries(c.vals).map(([pn, v]) => C.params[pn].set(v)), { at: c.at }));
      const fresh = await rec(msg);
      const pv = predict(c.vals);
      // Some messages ignore `at` (the live melody plays when it arrives): then there is nothing to shift.
      if (c.at !== AT0 && (f.atIgnored || fresh.voices.length === ref.voices.length) && (f.atIgnored || fresh.voices.every((P, k) => P.length === ref.voices[k].length && P.every((x, i) => x === ref.voices[k][i])))) { f.atIgnored = true; continue; }
      // A is what the page sends today (program times include the start time, begun at frame 0). B is the
      // reference program replayed: begun its own lead before the new onset frame.
      // Edits are not replayed here: a fresh note that needed one is counted (freshEdits) and the gap shows.
      const A = fresh.voices.map(P => ({ timeBase: 0, frame: 0, prog: P }));
      const B = pv.map(P => ({ timeBase: 0, frame: frameOf(c.at) - LEADF, prog: P }));
      const same = fresh.voices.length === pv.length && pv.every((P, k) => fresh.voices[k].length === P.length);
      const numbersMatch = same && (c.at !== AT0 ? null : pv.every((P, k) => P.every((x, i) => Math.abs(x - fresh.voices[k][i]) <= 1e-9 * Math.max(1, Math.abs(x)))));
      names.push({ label: c.label, voices: fresh.voices.length, freshEdits: fresh.edits.length, numbersMatch, sameShape: same });
      pushCase(frameOf(c.at), 0, A, fresh.edits, B, []);
    }
    // Onset between grid lines. The interpreter renders in quanta counted from where the engine's block grid
    // puts the voice, and a voice begun off that grid has a different attack (see the phase case below). So a
    // replay is begun ON the grid and the note's onset is moved inside the program: the slots that are times
    // are found by recording the note at two other start times, as for any parameter, and moved by the offset.
    {
      const t1 = AT0 + 0.02, t2 = AT0 + 0.05;
      const q1 = await rec(C.msg({ at: t1 })), q2 = await rec(C.msg({ at: t2 }));
      const tslots = [];
      let tbad = 0;
      if (q1.voices.length === ref.voices.length && q2.voices.length === ref.voices.length) {
        for (let k = 0; k < ref.voices.length; k++) {
          const ft = fit(ref.voices[k], AT0, q1.voices[k], t1, q2.voices[k], t2);
          tslots.push(ft.lenOk ? ft.slots : null); tbad += ft.bad.length;
        }
      }
      f.time = { slots: tslots.map(x => x && x.length), bad: tbad, slopeOne: tslots.every(x => x && x.every(([, b]) => Math.abs(b - 1) < 1e-9)) };
      for (const off of [1, 37, 64, 127]) {
        const pv = ref.voices.map((P, k) => { const q = Float64Array.from(P); if (tslots[k]) for (const [i, b] of tslots[k]) q[i] += b * (off / sr); return q; });
        // (i) patched against fresh at the same small time, both begun at frame 0: is moving the time slots the same
        // as recording the note at that time?
        const small = await rec(C.msg({ at: AT0 + off / sr }));
        const numbers = small.voices.length === pv.length && pv.every((P, k) => small.voices[k].length === P.length && P.every((x, i) => Math.abs(x - small.voices[k][i]) <= 1e-12 * Math.max(1, Math.abs(x))));
        names.push({ label: C.name + ': onset ' + off + ' frames past the grid, slots moved, against recorded at that time', voices: small.voices.length, freshEdits: small.edits.length, numbersMatch: numbers, sameShape: small.voices.length === pv.length });
        pushCase(LEADF + off, 0, small.voices.map(P => ({ timeBase: 0, frame: 0, prog: P })), small.edits, pv.map(P => ({ timeBase: 0, frame: 0, prog: P })), []);
        // (ii) control, no patching at all: the page's own voice recorded at 1.304 s plus the offset, against the same voice
        // recorded at the small time and begun later. Any gap here is the page's own absolute-time rounding.
        const big = await rec(C.msg({ at: ATS + off / sr }));
        names.push({ label: C.name + ': control, recorded ' + off + ' frames past the grid at 1.304 s against recorded early', voices: big.voices.length, freshEdits: big.edits.length, numbersMatch: null, sameShape: big.voices.length === small.voices.length, control: true });
        pushCase(frameOf(ATS) + off, 0, big.voices.map(P => ({ timeBase: 0, frame: 0, prog: P })), big.edits, small.voices.map(P => ({ timeBase: 0, frame: frameOf(ATS) - LEADF, prog: P })), []);
      }
    }
    // Phase: the same reference program begun on a quantum boundary and 64 frames after one. The second is
    // advanced by 64 frames before the comparison, so what is measured is only what the quantum grid does.
    names.push({ label: C.name + ': begun mid-quantum (64 frames) against on the grid', voices: ref.voices.length, freshEdits: 0, numbersMatch: null, sameShape: true, phase: true });
    pushCase(128 * 100, 64, ref.voices.map(P => ({ timeBase: 0, frame: 128 * 100, prog: P })), [], ref.voices.map(P => ({ timeBase: 0, frame: 128 * 100 + 64, prog: P })), []);
  }
  const head = [BUFS.size];
  for (const [id, b] of BUFS) { head.push(id, b.sr, b.ch.length, b.len); for (const c of b.ch) for (let i = 0; i < b.len; i++) head.push(c[i]); }
  head.push(names.length);
  const out = new Float64Array(head.length + flat.length); out.set(head, 0);
  for (let i = 0; i < flat.length; i++) out[head.length + i] = flat[i];
  const u = new Uint8Array(out.buffer); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return { names, b64: btoa(s), fits, seconds: SECS, buffers: BUFS.size, bufferConflicts: CONFLICT };
};
