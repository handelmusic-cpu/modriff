/* The chord composition proof (docs/native-scheduling.md, "The chord investigation"). Runs inside the real page.

   Question: can the engine play a chord by composing it from one-note programs, with nothing the page has not
   already recorded? A chord is a sub oscillator and one independent block per note; the notes share only three
   formulas of the note count n (level, pan, strum offset). So for each chord this
     1. records the page's own n-note chord (the truth),
     2. records each note alone as a one-note chord (a sub and that note's block), parses both into nodes,
     3. finds, per one-note program, which slots are the level (move with velocity), which are times (move 1:1 with
        the start time), and which nodes are the sub (the smaller of the two connected components that are not
        endpoints), and
     4. patches each one-note program into its place in the chord: its tone's level slots times the chord's level
        factor, its tone's time slots moved by the strum offset (less the strum lead), the pan set if the voice has
        a panner, and the sub silenced on every note but the lowest (its oscillator is made to stop where it starts),
     5. plays the n patched programs together and the page's chord, and nulls them (native/modsynth/replaytest).
   window.__chordCompose() resolves { names, b64, fits, seconds, buffers, bufferConflicts } for replay.test.js. */
window.__chordCompose = async function () {
  const sr = 48000, SECS = 4;
  const offline = new OfflineAudioContext(2, sr * SECS, sr);
  audioCtx = offline;
  const sink = offline.createGain(); sink.connect(offline.destination); masterDest = () => sink;
  const room = offline.createGain(); room.connect(offline.destination); window._chordRevFeed = room; reverbNode = room;
  Object.assign(window._webParams, { 'chord.reverb': 0.4 });
  let events = [];
  const BUFS = new Map();
  const decf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  MODGRAPH.debug = true;
  modGraphEnable({
    graphBuf: m => { const f = m.channels.map(decf); BUFS.set(m.id, { sr: m.sampleRate, ch: f, len: f[0].length }); },
    graphBegin: m => events.push({ prog: m.program }),
    graphEdit: m => events.push({ edit: m.increments }),
  }, ['chord']);
  _ensureAllPartBuses(offline);
  // Every random draw is the same number (0.5): the page's chord draws a note's detune and phase from one stream, so
  // a note recorded alone would otherwise draw different values than the same note inside the chord, and the
  // proof would measure the random numbers and not the composition. The engine will redraw them anyway.
  const seed = () => { Math.random = function () { return 0.5; }; };
  const dec = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float64Array(u.buffer); };
  const rec = async msg => { events = []; seed(); window.modEngine.send(Object.assign({ v: 1 }, msg)); await Promise.resolve(); await Promise.resolve(); return events.filter(e => e.prog).map(e => dec(e.prog))[0]; };

  // ---- the program format (tests/graph/graphrec.js) ----
  const T = { gain: 1, osc: 2, biq: 3, buf: 4, shp: 5, pan: 6, del: 7, ext: 8 };
  const parse = P => {
    let i = 4; const nodes = [], nN = P[2];
    const param = () => { const s = i; i += 2 + 4 * P[i + 1]; return [s, i]; };
    for (let k = 0; k < nN; k++) {
      const n = { type: P[i], start: i, params: [] }; i++;
      if (n.type === T.ext) { n.code = P[i++]; }
      else {
        if (n.type === T.osc) { const w = P[i++]; if (w === 4) { const c = P[i++]; i += 2 * c; } n.timeAt = i; i += 2; n.params.push(param(), param()); }
        else if (n.type === T.biq) { i++; for (let q = 0; q < 4; q++) n.params.push(param()); }
        else if (n.type === T.buf) { n.timeAt = i + 4; i += 7; n.params.push(param(), param()); }
        else if (n.type === T.shp) { i++; const c = P[i++]; i += c; }
        else if (n.type === T.del) { i++; n.params.push(param()); }
        else n.params.push(param());   // gain, pan
      }
      n.end = i; nodes.push(n);
    }
    const nE = P[i++]; const edges = []; for (let e = 0; e < nE; e++) { edges.push([P[i], P[i + 1], P[i + 2]]); i += 3; }
    return { nodes, edges, end: i };
  };
  // connected components over the non-endpoint nodes
  const components = G => {
    const par = G.nodes.map((_, i) => i); const find = a => (par[a] === a ? a : (par[a] = find(par[a])));
    for (const [a, b] of G.edges) if (G.nodes[a].type !== T.ext && G.nodes[b].type !== T.ext) par[find(a)] = find(b);
    const comp = new Map(); G.nodes.forEach((n, i) => { if (n.type === T.ext) return; const r = find(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
    return [...comp.values()].sort((a, b) => a.length - b.length);
  };
  const owner = (G, comps) => { const m = new Array(G.end).fill(-1); comps.forEach((c, ci) => c.forEach(ni => { for (let s = G.nodes[ni].start; s < G.nodes[ni].end; s++) m[s] = ci; })); return m; };

  const AT = 2304 / sr, VEL = 0.8, DUR = 1.0;
  const chordMsg = (ns, o) => Object.assign({ kind: 'chord', part: 'chord', id: 1, root: ns[0], notes: ns, bass: null, vel: VEL, dur: DUR, at: AT }, o);
  await rec(chordMsg([60]));      // warm-up: the first recording of a voice draws the random stream differently
  const names = [], flat = [], report = {};
  const pushSide = (voices) => { flat.push(voices.length); for (const v of voices) { flat.push(0, 0, v.length); for (const x of v) flat.push(x); } flat.push(0); };
  const levelFactor = (i, n) => (i === 0 ? 1.0 : i === n - 1 ? 0.62 : 0.78) * (n > 4 ? Math.sqrt(4 / n) : 1);

  const chords = [[60, 64, 67], [62, 66, 69], [48, 55, 64], [60, 64, 67, 71], [55, 60, 64, 67, 71], [60, 63, 67, 70]];
  const strumOn = _wp('chord.strum'), spread = _wp('chord.strumSpread') || 0;
  report.strum = { on: !!strumOn, spread };
  for (const ns of chords) {
    const n = ns.length;
    const truth = await rec(chordMsg(ns));
    const offs = strumOffsets(n), lead = offs.length > 1 ? offs[offs.length - 1] * 0.4 : 0;
    const voices = [], info = [];
    for (let i = 0; i < n; i++) {
      const p = ns[i];
      const Q = await rec(chordMsg([p]));
      const Qv = await rec(chordMsg([p], { vel: VEL / 2 }));
      const Qt = await rec(chordMsg([p], { at: AT + 0.02 }));
      const G = parse(Q), comps = components(G), own = owner(G, comps);
      const sub = 0, tone = comps.length - 1;
      const q = Float64Array.from(Q);
      let lv = 0, tm = 0;
      for (let s = 0; s < Q.length; s++) {
        if (own[s] === tone) {
          if (Q[s] !== 0 && Math.abs(Qv[s] / Q[s] - 0.5) < 1e-9) { q[s] = Q[s] * levelFactor(i, n); lv++; }
          else if (Math.abs(Qt[s] - Q[s] - 0.02) < 1e-9) { q[s] = Q[s] + (offs[i] - lead); tm++; }
        }
      }
      // a panner in the tone's chain (voiceFx makes one while the mõdFX Width is on): set its pan
      let pans = 0;
      for (const ni of comps[tone]) if (G.nodes[ni].type === T.pan) { q[G.nodes[ni].params[0][0]] = Math.max(-1, Math.min(1, (n > 1 ? (i / (n - 1)) * 2 - 1 : 0) * _wp('fx.width'))); pans++; }   // voiceFx: panPos * the macro's Width
      // silence the sub on every note but the lowest
      let subOsc = null;
      for (const ni of comps[sub]) if (G.nodes[ni].type === T.osc) subOsc = G.nodes[ni];
      if (i > 0 && subOsc) q[subOsc.timeAt + 1] = q[subOsc.timeAt];
      voices.push(q);
      info.push({ note: p, comps: comps.map(c => c.length), level: lv, time: tm, pan: pans, subOsc: !!subOsc });
    }
    // Where the composed numbers differ from the page's own: truth's connected components in creation order (sub,
    // then one per note) against each patched one-note program's (sub, tone), slot by slot.
    {
      const GT = parse(truth), cT = components(GT).sort((a, b) => Math.min(...a) - Math.min(...b));
      const cmpNodes = (GA, ca, A, GB, cb, B) => {
        const out = [];
        const la = ca.slice().sort((x, y) => x - y), lb = cb.slice().sort((x, y) => x - y);
        if (la.length !== lb.length) return [['node count', la.length, lb.length]];
        la.forEach((na, k) => { const a = GA.nodes[na], b = GB.nodes[lb[k]]; if (a.end - a.start !== b.end - b.start) { out.push(['len', a.type, b.type]); return; } for (let j = 0; j < a.end - a.start; j++) { const x = A[a.start + j], y = B[b.start + j]; if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x))) out.push([k, a.type, j, +x.toPrecision(7), +y.toPrecision(7)]); } });
        return out;
      };
      const diffs = [];
      for (let i = 0; i < n; i++) {
        const G1 = parse(voices[i]), c1 = components(G1).sort((a, b) => Math.min(...a) - Math.min(...b));
        // components in creation order: sub is first in the one-note program and in the chord
        const toneT = cT[1 + i], toneQ = c1[1];
        diffs.push({ note: ns[i], toneVsTruth: cmpNodes(GT, toneT, truth, G1, toneQ, voices[i]).slice(0, 12) });
      }
      diffs.push({ sub: cmpNodes(GT, cT[0], truth, parse(voices[0]), components(parse(voices[0])).sort((a, b) => Math.min(...a) - Math.min(...b))[0], voices[0]).slice(0, 8) });
      report['diff ' + ns.join(' ')] = diffs;
    }
    names.push({ label: 'chord composed from one-note programs: ' + ns.join(' '), voices: voices.length, freshEdits: 0, numbersMatch: null, sameShape: true });
    flat.push(0, 0);   // compareFrom, shift
    pushSide([truth]); pushSide(voices);
    report['chord ' + ns.join(' ')] = info;
  }
  const head = [BUFS.size];
  for (const [id, b] of BUFS) { head.push(id, b.sr, b.ch.length, b.len); for (const c of b.ch) for (let i = 0; i < b.len; i++) head.push(c[i]); }
  head.push(names.length);
  const out = new Float64Array(head.length + flat.length); out.set(head, 0);
  for (let i = 0; i < flat.length; i++) out[head.length + i] = flat[i];
  const u = new Uint8Array(out.buffer); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return { names, b64: btoa(s), fits: {}, seconds: SECS, buffers: BUFS.size, bufferConflicts: [], report };
};
