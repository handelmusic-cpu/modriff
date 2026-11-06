# Native scheduling: the sequencers move to the engine

Design, written at 6.9.4, with the slice-0 spike's results (section 5). The engine-side scheduler itself is not built. It is the "then the clock" of step 7 in
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
1. **Clock + drum grid, behind a developer switch.** Native clock; score store and expander for the drum
   grid (both layers, swing, humanize, probability, ratchets and flams, chokes); voice bank for drum lanes
   (replay as the spike found it: begun on the 128-frame grid, a lead before the onset, velocity, accent and
   pitch slots patched, the time slots moved); mirror of bar and step for the display. Verified by running the same drum score in the page (offline) and in the
   host test and comparing the **event list** exactly (frame, lane, velocity) and the audio by null test;
   on the Mac simulator the clock and expander keep running with the page throttled; on the phone, the
   checklist below.
2. **Bass and chords following the song.** The chord timeline in the engine (the thing `_blChordWin` is
   today), bass pattern and chord-comp rhythm on it, pitch and duration slots.
3. **Arp and melody sequencer / melgen.** Randomness here (melgen, arp random modes) is native-RNG;
   not bit-identical to the page by design (owner to accept).
4. **Song loop in the engine.** Sections, repeats, endings, pattern queues at the wrap, tempo changes.
   The bar clock the page's song logic hangs off becomes the engine's.
5. **Cutover.** Every part to the engine at once, background play on, the page schedulers deleted; the page is
   UI and editor. Needs 1 to 4 clean on a phone first.

## 6. How each slice is verified (CLAUDE.md: measure, don't read)
- **Event lists, not ears:** a score run through the page's scheduler on an offline context and through the
  native expander must produce the same list of (frame, part, voice key, velocity, pitch, duration). Randomised
  features compare statistics, not lists.
- **Audio:** null test of the rendered buses, as `tests/graph` does for voices.
- **Simulator:** engine keeps stepping with the page throttled (logs the step counter); it cannot show
  iOS suspending the web view.
- **Phone, not heard on device until the owner has:** leave the app mid-song and listen; the music must
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

## What the spike found (6.9.4)

Method. For each voice the page's own recorder makes the program for a note (the graph path, an offline
context, seeded random). The spike records it again with one parameter changed at two more values, fits
`value = a + b*x` for every slot of the program on two of them and checks the third. It builds the program
for a different note by patching the reference with the fits, then plays the patched program and a freshly
recorded one through the engine's own voice pool and reports the null depth (dB; 999 = identical). 313
cases over every 808 and 909 lane, bass, the live melody, melgen, arp and a transposed chord. Re-run:
`make -C native/modsynth replaytest`, serve the repo, `node tests/graph/replay.test.js --serve`, and paste the
one-liner from its header into the served page (or run it with Playwright where that is installed).

Results (exact = bit-identical or 90 dB or deeper; close = 50 to 90 dB, an error under 0.3% of the signal,
a threshold chosen by the engineer and not a measure of hearing):

| voice | cases | exact | close | far |
|---|---|---|---|---|
| drums, 14 of 16 lanes | 140 | 133 | 7 | 0 |
| drums, 808 lane 6 and 909 lane 3 (noise voices) | 20 | 12 | 0 | 8, see below |
| bass | 10 | 10 | 0 | 0 |
| live melody | 8 | 8 | 0 | 0 |
| melgen | 10 | 8 | 2 | 0 |
| arp | 10 | 10 | 0 | 0 |
| chord (3 notes, one voice), fixed pitch: velocity, duration, start time | 9 | 9 | 0 | 0 |

What it means, in order of importance:

1. **Replay works for every single-note voice and every drum lane.** Velocity, accent and pitch are
   patched slots; a start time is a set of slots that each move 1:1 with it (9 to 22 per voice);
   duration is affine in the envelope slots. When two parameters move the same slot (vel and accent) it is
   multiplicative, found from one joint recording. Pitch needs two bases per voice: most slots are linear
   in frequency (2^(n/12)), a few (the live melody's pan) in the note number. A slot that fits neither is
   reported, and none did except in the chord.
2. **The interpreter depends on where the voice starts on the engine's 128-frame block grid.** The same
   program begun 64 frames off the grid is not a shifted copy of itself for 13 of 21 voices: nulls from
   -6 to 43 dB, the first few milliseconds of the attack differ. (The arp, melgen, live melody and four
   drum lanes are unaffected.) This is the interpreter evaluating automation per quantum, as Chrome does
   from its own grid; it already affects every voice the app plays today, since a voice begins wherever the
   wall clock puts it (and the host's blocks are 240 frames, not 128). The replay design therefore **begins
   every voice on the 128-frame grid and moves the note's onset inside the program** by patching the time
   slots, which is exact (above). That is also what Chrome does for a note at any time.
3. **A replayed voice is begun a lead before its onset.** A voice's output can start before its onset (a
   waveshaper's bias is a constant from the moment the voice begins, and filters settle on it). Recorded
   with 48 ms of lead (18 quanta) and replayed that lead before the onset frame, it matches the page's voice
   in every case above. Re-based by `timeBase` with no lead, the start-up step of that bias showed as 40 to 80 dB
   nulls on noise voices. The lead holds a pool slot for 48 ms, nothing more.
4. **The page's own recordings are not time-invariant.** The control rows record the same note at 1.304 s
   and at 0.048 s with no replay involved: 36 of 84 pairs differ by less than 50 dB. Two drum lanes (808
   lane 6, 909 lane 3, the noise ones) differ by 27 to 60 dB from run to run, which no replay can reproduce.
   Replay is as good as the thing it replays; whether those two voices need a fix in the page (a time-derived
   noise offset is the suspect, not proven) is for the next slice.
5. **The chord replays exactly at a fixed pitch; moving it in pitch is the open part.** The first spike run said
   the chord did not patch at all. The investigation (below) found that to be three separate causes, two of them
   mistakes in the test, and one real: a chord's program depends on its notes. Re-run with the test fixed, a triad
   is exact (9 of 9, worst 102 dB) for velocity, duration and start time.
6. **Edits.** A closed hat sends an edit to the open hat's voice, which is not in its own recording: the
   engine has to do chokes itself (it knows which voice is which), as a scheduler feature. Edits that belong
   to a voice's own recording (a held chord's release) were not replayed; duration is covered by the slots.

Not covered, said plainly: sampled and recorded voices (piano, violin, flute, kit samples), the other drum
kits, different chord shapes, a layered kit's `dyn`, parameters that change while a voice plays (glides,
mõdFX), and any hearing test. The numbers are measured; "close" is a judgment.

## The chord investigation (6.9.4)

Asked: why did the chord not patch, and how should it be built for the engine. Read from `_webChordOn` and
measured in the page.

**How the page builds a chord.** One message becomes one voice made of independent parts: a **sub**
oscillator (under the lowest note), then for each note its own `makeVoice` with its own gain envelope, filter
chain and pan. The only things the notes share are three formulas of the number of notes `n`: a level factor
(`1.0` for the lowest, `0.78` for the middle ones, `0.62` for the top one, times `sqrt(4/n)` above four notes),
a pan (`i/(n-1)*2-1`, low note left to high note right) and a strum offset (`i * spread/(n-1)`, with the roll
started early so the weight lands on the beat), plus glide (off by default) and a choke of the previous chord.

**Measured.**
- *Size is additive.* Program length is exactly `44 + the sum of a block per note`, and a note's block depends only on
  its pitch (440 numbers at MIDI 48, 415 at 55, 390 at 60 and 64, 365 at 67 and 71, 340 at 76: fewer partials
  higher up). Checked on six pairs, a triad and a four-note chord: predicted every length exactly. So the chord is a
  sum of per-note blocks, as the code says.
- *Velocity.* The 40 "slots that did not obey" were not velocity. They are **random draws** (a partial's detune, a
  phase) that differ in the first recording of any voice in a page, because building its caches consumes random
  numbers; the spike's reference was that first recording. Recorded warm, velocity moves 11 slots, all affine
  (the sub's gain and three per note). The test now records once and throws it away.
- *Duration.* Every duration slot is `min(a + b*dur, cap)` (or `max`): linear until a per-slot limit, then
  constant (the voice's own length cap and the decay setting). Fitted from three recordings (two close durations
  and one long) it predicts 285 slot values at five unseen durations with no error above 1e-9. The test uses it
  (49 of the chord's 57 duration slots are clamped).
- *Each chord also emits an edit* (240 numbers: 40 increments) that chokes the previous chord. That is scheduler
  work for the engine, like the closed hat's choke, and was not replayed here.
- *Random slots exist in every voice.* Replay freezes them: every re-strike of a note would have the same detune
  and phase. The owner accepted that randomness may differ; it is a few cents and a phase, and the engine can
  redraw them once the slots are known (found by recording with two random seeds).

**Options for pitch.**
- **A. Whole-chord bank, keyed by the exact notes.** Works today (proven above), no page change. But the engine
  can then play only chords the page recorded in advance, which means the page must predict every voicing the
  engine will use. Voicing has state (voice leading from the last chord) and a random Vary mode, so the page
  cannot always predict it, and a chord not in the bank is silence. About 8.5 KB a chord, so size is not the
  problem; coverage is.
- **B. Compose a chord in the engine from per-note voices (recommended).** A bank of one voice per pitch (at most
  88, about 8 KB each with the sub), and the engine builds any chord from it: each note's voice with its level
  factor, pan and strum offset, and one sub under the lowest note. These are patches of the same kind the spike
  already proves (the level factor is the same gain slots velocity moves; the strum offset is the start-time
  slots; the pan is a panner slot; the sub is zeroed on all but one note through the same differencing used for
  `chord.subLevel`). Any chord, any voicing, live pad taps included, and it leaves voicing free to live in the
  engine or the page. Cost: it is not proven yet (see the gate), and the engine needs the three formulas above.
- **C. Change how the page builds the chord.** Not needed: B composes from what the page already records.

**Recommendation: B, gated on a proof, with A as the fallback.** The proof is one task at the start of the chord
work: compose a triad from three one-note programs by patching and null it against the page's own three-note
chord (pass: 90 dB or better, the bar used for every other voice). If it holds, B. If it does not, A, whose
pieces are already proven, and the cost is that the page must pre-record every voicing a song can produce before
the engine takes over. This is an engineering choice, not the owner's; it only needs the owner if A is the
outcome, because then a chord the page could not predict is a gap in background play.

Not done in the investigation, said plainly: the composition proof itself (an attempt to align the blocks of a
three-note program against one-note programs by hand failed because the program's header is not a fixed prefix
and needs the real parser), a chord at other qualities and a slash bass, strum off, glide on, and a sampled
chord voice.

**Next step: slice 1 (the native clock and the drum grid), and the chord proof in parallel.** Neither blocks the
other: the drum grid needs only what is proven, and the chord proof is a Mac-only test like the spike.
