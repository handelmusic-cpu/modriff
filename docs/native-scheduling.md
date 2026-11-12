# Native scheduling: the sequencers move to the engine

Design written at 6.9.4. The implementation log (spike findings, chord investigation, every slice and migration step with its measurements) is in `docs/archive/native-scheduling-log.md`: `grep -n` it, never read it through. The engine now schedules drums, bass, chord rhythm, songs, arp and melody through developer entries. Migration A supplies generated melody lines; B1 and B2 add per-pitch factory voices. Supported native-app runs now use one automatic native owner; unsupported configurations use the whole page band. The web page retains its JavaScript schedulers. See the current checkpoint at the end before beginning the cutover. It is the "then the clock" of step 7 in
`docs/v5-architecture.md`, and the reason is background play: every part already *plays* on the
native engine, but *when* a note plays is still decided by page JavaScript on a `setTimeout` chain, so
the music lasts only as long as the web view runs and the look-ahead reaches. Read the section
"Where background play stands (6.9.4)" there first.

**Decided by the owner (6.9.4)**
- Scheduling goes native: the sequencers have to run in the engine, and **the engine is the only scheduler
  (way B)**: no handover, no page schedulers once it is done.
- Randomness (probability steps, humanize, the random arp and melody modes) may differ from the page's.
- Now Playing (lock screen, Control Center) has **Pause and Play, and nothing else**: no skip, no seek.
  (Said first as "pause only", then clarified as "pause and play".) Recorded here so the slice that adds
  Now Playing does not add more.
- **All parts play in the background at release, if possible.** So background play is not switched on
  after slice 1 (drums); it is switched on when slices 1 to 4 are done. "If possible" is the spike's
  job: a voice that cannot be replayed exactly stays on the page path and cannot play in the
  background, and the spike's report names each one so the owner decides what to do about it.

## 1. The idea in one paragraph

The page stays the authority on **what a voice is** (its makeVoice graphs, kits, patches, faders,
effects) and on **what a pattern is** (the grids, the song, the chord charts). The engine becomes the
authority on **when**: it owns a frame-counted clock, holds a copy of the scores, expands them into
events, and starts voices itself by *replaying voice programs the page recorded once*. The page hands
over state; it does not feed notes. That is the only way to avoid porting makeVoice's ~900 lines and
every drum, bass, chord and melody voice to C++ (the way mõdSynth was ported), and it keeps the sound
exactly what it is today.

## 2. What exists today (facts from the code)

- **Messages are already semantic.** A drum step sends `{kind:'hit', part, kit, lane, vel, accent,
  pitch, dyn, at}`; a bass or melody note `{kind:'note', part, note, vel, dur, ...}`; a chord
  `{kind:'chord', root, notes, vel, dur}` (`sqHitTrack`, `modEngine.send`). Plain data a native
  sequencer can produce.
- **Each message becomes one recorded graph program** (graph path, `tests/graph/graphrec.js`): the page
  runs the real voice on a recorder instead of the context, and sends the program (`graphBegin`, base64
  doubles) with a timestamp. Times in a program are absolute context times; `GraphPool::begin(prog, len,
  timeBase, startFrame)` subtracts `timeBase`, so **a program replays at any time with no editing**.
- **The engine already holds future voices**: 96 sounding at once (`GraphPool::kMaxVoices`), a
  1,024-slot message queue, and mõdSynth Processors that take `on`/`off` with a time. There is no
  sequencer and no tempo clock in the engine (a `tempo` message exists, for tempo-synced mõdSynth patches and the effects rack only).
- **The page's schedulers** (all driven by `tickClock`, reading `getCtx().currentTime`): `_sqScheduler`
  (drum grid, and the *bar clock* the song loop, chord changes, pattern changes and arp restarts hang off),
  `_blScheduler` (bass), `_mlScheduler` (melody sequencer), `scheduleArp`, `scheduleChordRhythm`,
  `scheduleRhythm`, `scheduleMetronome`, `_psScheduler` (pads), then `tickSongLoop` / `_advanceLoopSlot`
  for sections and endings. They share `_blChordWin` / `window._blOnChord` (the one chord timeline bass and
  melody follow) and `_sqSwingOffset`.

## 3. Measured: a voice program is nearly a constant

Run in the real page (Chromium, an `OfflineAudioContext`, seeded `Math.random`, the stand-in plugin of
`tests/graph/page.test.js`), recording the program for one message and changing one field at a time.
Numbers are doubles in the program that differ.

| message | program size | same message twice | velocity | pitch | duration | start time |
|---|---|---|---|---|---|---|
| drum hit, 808 lanes 0-7 | 82 to 356 | identical | 1 to 5 numbers, one common ratio (0.5 / 0.9 = 0.5556 exactly) | 2 numbers (lane 2, -2 semitones) | n/a | 11 numbers: all the absolute times |
| accent (kick) | 356 | | the same 3 numbers, ratio 1.3636 | | | |
| bass note | 165 | | 3 numbers, ratio 0.5556 | 5 numbers, ratio 1.1225 (= 2^(2/12)) | 4 numbers (envelope end times) | |
| melody note | 117 | | | 2 numbers | 3 numbers | |
| arp note | 80 | | | 1 number | | |
| chord (3 notes, one voice) | 1,057 | | 51 numbers | | 86 numbers, plus one edit when held longer | |

What it says:
- A voice is **deterministic** and **small** (under 9 KB even for a chord). A bank of them is cheap.
- **Velocity is a gain scale** on a few slots; **pitch is a frequency scale** on a few slots; **start
  time costs nothing** (`timeBase`). Duration touches envelope times (and, for a held chord, an edit).
- So the engine does not need the voice code. It needs the programs and a *parameter map* saying which
  slots scale with velocity, which with pitch, which are envelope times.

What this does **not** show yet (the spike in section 6 must): that a program patched this way is
*audibly identical* to a freshly recorded one (the 1.1225 ratio is exact for a pitch step, but a filter
cutoff that tracks pitch or a velocity-dependent filter would show up as slots that do not scale
uniformly), and what a layered kit does (`dyn` picks a recording by stroke strength: that is a different
program, not a scaled one, so it is part of the key).

## 4. Design

### 4.1 Parts of the thing

1. **Native clock** (in `ModEngineHost`, counted in frames, the one source of time). Tempo (with ramps and
   tap tempo as the page sets them), meter, swing, rate multiplier, bar and step counters. Exposes
   "frame of the next step N". No wall clock is involved, which also removes the bridge jitter that the page
   stamps (`ts`) and the `atRel` correction have to fight today.
2. **Score store.** For each part, the data its page scheduler reads, copied over once and again on every
   edit as a compact message: the drum grids per layer (cells: velocity 0/1/2, probability, ratchet, flam,
   coverage), per-lane gain and pitch, kit, step count; bass, melody, arp and chord-comp patterns; the song
   (sections, slots, chords, repeats, endings). The page remains the editor; the store is a mirror.
3. **Voice bank.** Programs the page recorded, keyed by what makes a *different* voice (part, voice or
   patch, kit and lane, `dyn`, layered-kit choice), each with its **parameter map** (velocity slots, pitch
   slots, envelope slots), found by the page by probing: record the voice at a reference and at a second
   value of each parameter, read off which slots changed and by what, check the guess against a third
   value, and refuse (keep that voice on the page path) if any slot does not obey. A bank entry is
   invalidated, and re-recorded by the page, when anything the voice reads changes (the fader, a drum
   Shape, a patch, mõdFX that is baked in); a generation counter on the bank says which are current.
4. **Expander.** On each step of the clock, read the score, apply swing, humanize and probability (a
   native RNG), and for each event take the bank program, patch its slots, and call the pool's `begin` at the
   event's frame. Choke groups (open hat by closed hat) and releases are the engine's too, as edits it
   already understands (`graphEdit` increments).
5. **Hand-back to the page.** The page needs to draw the playhead and follow the song. The engine
   publishes a small mirror (bar, step, section, chord) the page polls or receives; the page stops being the
   clock but keeps being the display. The one thing that flows the other way is a *change*: edits,
   pattern or section queues, tempo, which the page forwards as it does today.

### 4.2 Roll-out: the engine is the only scheduler (owner's decision)

The owner chose way B: the engine becomes the only scheduler and the page schedulers are deleted. The
alternative that was considered, the engine continuing only while the app is away with a handover at each
end, is not built: it would mean two schedulers that must agree and a handover protocol that is thrown away.

What that changes in practice: a half-native state cannot ship, because the drum grid is the bar clock the
song, chord changes and arp hang off. So slices 1 to 4 are built and verified without being switched on (behind
a developer switch like Native sound, compared against the page's own scheduler on the same score), and the
cutover (slice 5) switches every part at once and deletes the page schedulers. Background play turns on
with the cutover; before it, nothing changes for anyone.

### 4.3 What stays on the page whatever happens
Voice building, editing UIs, the song editor, MIDI in/record, MIDI out and external MIDI clock, anything
that needs the DOM, the sampler's microphone. Background MIDI out and external clock are not background
v1; say so, don't half-do them.

## 5. Slices

0. **Spike: is replay exact? Done (6.9.4), see "What the spike found" below.** `tests/graph/replay.inpage.js`
   (in the page) and `native/modsynth/replaytest.cpp` (the pool), driven by `tests/graph/replay.test.js`.
1. **Clock + drum grid, behind a developer switch.** *First half done (6.9.7): the clock and the expander, verified against the page. Second half (voice bank, host thread, mirror) next, see the end of this file.* Native clock; score store and expander for the drum
   grid (both layers, swing, humanize, probability, ratchets and flams, chokes); voice bank for drum lanes
   (replay as the spike found it: begun on the 128-frame grid, a lead before the onset, velocity, accent and
   pitch slots patched, the time slots moved); mirror of bar and step for the display. Verified by running the same drum score in the page (offline) and in the
   host test and comparing the **event list** exactly (frame, lane, velocity) and the audio by null test;
   on the Mac simulator the clock and expander keep running with the page throttled; on the phone, the
   `docs/phone-test-checklist.md` section 18.
2. **Bass and chords following the song.** *Part one done (6.9.9.3): the chord timeline and the bass line's event list, see the end of this file.* The chord timeline in the engine (the thing `_blChordWin` is
   today), bass pattern and chord-comp rhythm on it, pitch and duration slots.
3. **Arp and melody sequencer / melgen.** Randomness here (melgen, arp random modes) is native-RNG;
   not bit-identical to the page by design (owner to accept).
4. **Song loop in the engine.** Sections, repeats, endings, pattern queues at the wrap, tempo changes.
   The bar clock the page's song logic hangs off becomes the engine's.
5. **Cutover.** Every part to the engine at once, background play on, the page schedulers deleted; the page is
   UI and editor. Needs 1 to 4 verified on the Mac; the phone checks are listed for the owner and do not gate it.

## 6. How each slice is verified (CLAUDE.md: measure, don't read)
- **Event lists, not ears:** a score run through the page's scheduler on an offline context and through the
  native expander must produce the same list of (frame, part, voice key, velocity, pitch, duration). Randomised
  features compare statistics, not lists.
- **Audio:** null test of the rendered buses, as `tests/graph` does for voices.
- **Simulator:** engine keeps stepping with the page throttled (logs the step counter); it cannot show
  iOS suspending the web view.
- **Phone (listed in the checklist; not a gate):** leave the app mid-song and listen; the music must
  continue on the beat, with no burst or gap at the handover in either direction. A `native.sched` block in
  Copy diagnostics (steps fired, late steps, bank hits and misses, handovers) says what happened.

## 7. Risks and open questions for the owner
- **Randomness.** Probability steps, humanize, melgen and arp random modes: native RNG gives a different
  but equally valid sequence. The owner accepted this (6.9.4).
- **Voices that will not parameterise.** The spike named them (chord, two noise drums); "all parts in the
  background" is not met until the chord is solved, see below.
- **Everything baked into a program** (fader, Shapes, effects): the bank must be invalidated on change.
  Missing an invalidation plays a stale voice. The generation counter and a test per setting are the
  mitigation; it is the main correctness risk of the whole design.
- **Pool and queue limits** are real: a dense bar's voices are held until they start only if they are begun
  early. The expander begins a voice at most one clock quantum before it is due, so the 96-voice pool is a
  limit on polyphony, not on look-ahead.
- **Background MIDI** (out, external clock, record) is out of scope for v1.
- **Battery**: the engine runs the whole time; a native clock at 5 ms blocks costs what it costs today
  (load 3 to 17%). A larger buffer in the background is an option (`setBuffer`).
- **Still open for the owner:** which part goes first after the drum grid is the engineer's call; what the
  chord needs (below) may be the owner's, because it could change how the chord is built.

## Current migration checkpoint

- **A:** generated lines, both Follow settings and last-line repetition are implemented.
- **B1/B2:** factory instruments are banked per pitch. Custom sampler instruments still use whole-band page fallback.
- **B3/B4/B5:** all four patch parts, the chord's separate sub, Pure tuning, chord glide and live hand-chord forwarding are implemented.
- **C:** retained fractional-frame note/cut events feed foreground MIDI and Bounce MIDI, with cursors, native recording-clock mapping and explicit overflow reporting. Background MIDI out/external clock remain outside v1.
- **D:** live chart revisions apply at the next uncommitted bar. Commands/pass/trainer state and old/new locks survive; stale generated-line replies are rejected by revision.
- **E:** public Play prepares and claims one native owner by default when Native sound is on and the configuration is supported. Page schedulers/song timers are suppressed for that run. Five clocks share a first bar; monotonic tokens cancel stale starts/stops. Native mirrors drive displays. Host/bank identities invalidate stale caches. Probes preserve live manual voices. Background permission requires a completed native claim; there is no foreground/background scheduler handover.
- **Whole-band fallback:** custom sampler voices, sampler patterns, metronome/simple rhythm, standalone chord rhythm, queued/chained drum patterns and practice key/tempo automation currently use the page. Chart-position jumps also return the run to the page. Loading/refused banks and older/unavailable hosts use the same fallback. These runs pause on leaving and do not claim background support.
- **Verification:** Mac event/audio comparisons, real-page ownership/race/fallback tests, the full host suite and iOS Simulator build pass. Not heard on device: checklist 45–49. Those checks are a to-do, not a gate. Handoff: `docs/native-audio-handoff.md`.
