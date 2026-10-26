# The graph path, host half: a brief for the session on the Mac

> **Status (v4.9.9.9.9.9.5c, branch `claude/graph-host`):** sections 1 and 2 are done: checks run on the
> Mac (the sampler path found a loop-wrap bug, fixed), the host half written and built for the simulator
> and the phone, buses 9 and 10 as wet-only returns (see "The host half is written" in
> `docs/v5-architecture.md`). Section 3 (listening on the phone) is the open part.

Branch `claude/native-voices` (v4.9.9.9.9.9.5b). The page can play a part through
recorded Web Audio graphs and the C++ side that plays them is written and
measured on Linux against Chromium. What is missing is the iOS host that calls it.
Nothing in this branch has been compiled by Xcode. Read `docs/v5-architecture.md`,
"The graph interpreter", first; this is only the checklist.

## 1. Check it on the Mac before changing anything

```sh
git fetch && git checkout claude/native-voices && npm install
make -C native/modsynth graphpooltest graphrender graphmix
native/modsynth/graphpooltest                    # 25 checks, 0 failed
node tests/graph/inline.test.js                  # the page's copy of graphrec.js
node tests/graph/start.test.js                   # needs Chromium; CHROMIUM=... on a Mac
sh tests/graph/page-all.sh                       # 16 paths; needs Chromium and Playwright
```
Report any difference from Linux (the interpreter is built `-ffp-contract=off`
like the rest). The page tests compare against the browser's own render, and
WebKit's is not Blink's: a path that is clearly worse than the numbers in the
doc is worth saying.

## 2. The host: `ios/App/App/ModEngine/ModEngineHost.mm` and `ModEngine.swift`

Add to the target: `native/modsynth/graph.cpp`, `graphpool.cpp` (and their
headers), with `-ffp-contract=off` like the other sources.

1. `ModEngineHost` owns a `modsynth::GraphPool _graphs`.
2. Plugin methods (`ModEngine.swift`'s `pluginMethods` and an `@objc func` each,
   forwarding to the host), all arriving on the control thread in the order the
   page sent them:
   - `graphProbe`: resolves, does nothing. The page asks once before it turns the
     path on, so an older binary (which has no such method) falls back.
   - `graphBuf {id, sampleRate, channels: [base64 Float32]}`:
     `_graphs.buffers().put(id, sr, nch, len, ch0, ch1)`.
   - `graphBegin {gid, program: base64 Float64, base, ts}`: decode, then
     `_graphs.begin(prog, n, 0.0, startFrame)`. The program's times are seconds
     from the moment the page opened the voice. `ts` is that moment on the wall
     clock (`Date.now()`, ms), so `startFrame` is the engine frame at wall-clock
     `ts`, worked out the way `mm.at` is for every other message (see the
     `_curOff` / `_clkOrigin` handling in `renderInto:`). It is a few ms in the
     past on arrival; the pool catches a late voice up (to one second). `begin`
     returns -2 for a clip it does not hold: reply with `_graphs.unknownBuffer()`
     so the page can send that clip again (the page side of that retry is not
     written yet, see section 4).
   - `graphEdit {gid, increments: base64 Float64}`: `_graphs.edit(handle, inc, n)`.
     Keep `gid` to handle in a table only the control thread touches; drop it when
     `edit` returns false.
3. `ensurePart {part, warm, graph: true}` for a part with no Processor: create its
   strip and mõdFX (as attach does now) but no engine and no rack, and its capture
   ring, so the mixer meter, mõdFX and Bounce/stems work on it. `warmUp` the pool
   too (render a few blocks of a silent graph) so the first note does not pay for
   first-touch memory.
4. `renderInto:`. Before the part loop, zero `GraphPool::kBuses` (11) pairs of
   scratch buffers and call `_graphs.render(blockFrame, frames, busL, busR, touched)`.
   In the loop a part runs if it has a Processor **or** `touched[part]`: a
   Processor part adds its bus after its rack, a graph-only part starts from
   silence; strip, mõdFX, meter, pan, capture are unchanged.
5. The three buses that are not parts:
   - 8: straight into the master with no strip (the click, the legacy Rhythm);
     the way the chord's direct path enters.
   - 9: the chord's room send into the effects rack's reverb of part 0.
   - 10: the shared room send into the master bus room (`_roomL`/`_roomR`).
   Their level is already in the graph. Until 9 and 10 are routed the reverb on
   those voices is silent, so do them before the page turns the path on.

Keep Swift/Objective-C++ changes small and say what you compiled and what you ran.

## 3. Check it on a phone

Nothing calls `modGraphStart` yet, so from the web inspector (Safari, Develop menu)
on a Debug build:

```js
await modGraphStart(['drum'])        // true on the new binary, false (and nothing changes) on an old one
```
then play a pattern with drums. Expect the drums to sound the same as before
(listen to the kit, the closed hat choking the open one) and the Mixer's Drums
fader, mute, solo and pan to work. `Settings > General > Copy diagnostics` and the
`modGraph` counters (`MODGRAPH.sent`, `.fellBack`, `.why`) say what happened.
Then the other parts one by one: `['bass']`, `['chord']` (with the chord reverb up:
needs bus 9), `['mel']`, `['arp']`, `['melgen']`, `['auxperc']`, `['sampler']`.
The click and the Rhythm need bus 8.

## 4. What the page still needs (small; do it after step 3 works)

- Retry on -2: when the host says a clip is missing, send it again and retry the
  graph. `Rec.forgetBuffers()` forgets what was announced.
- Call `modGraphStart(parts)` from the app once the host answers the probe, behind
  a setting while it is new.
- `MODNAT.PART` and mõdSynth on parts other than the chord.
- Then the flip: on for every part, delete the web path.

## Rules (CLAUDE.md applies)

No model names in commits; keep the `Claude-Session` and `Co-authored-by` trailers;
`./check.sh` after every edit of `index.html`; the version label bumps with a
letter (`4.9.9.9.9.9.5c`) in `#ft-ver`, `#unlock-ver` and `MODRIFF_VERSION`.
Commit per logical change on a branch from `claude/native-voices`, open one PR
for the batch and merge it with a merge commit once it is verified on the phone.
