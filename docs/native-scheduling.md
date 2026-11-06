# Native scheduling: the sequencers move to the engine

Design, written at 6.9.4, with the slice-0 spike's results (section 5). Slice 1 is half built (6.9.7: the clock and the drum-grid expander, in C++, held to the page; section "Slice 1, first half" at the end). The engine does not schedule anything yet. It is the "then the clock" of step 7 in
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

**Recommendation: B, gated on a proof, with A as the fallback.** The proof is below; it passed.

**The composition proof (6.9.4, passed).** `tests/graph/chordcompose.inpage.js`, run through `tests/graph/replay.test.js`
as the spike was. For six chords (three triads at different pitches and registers, two four-note chords, one five-note
chord, so both level factors and the `sqrt(4/n)` scaling) it records the page's own chord and each note alone as a
one-note chord, parses both into nodes, and patches each one-note program into its place: its note's level slots times the
chord's level factor, its note's time slots moved by the strum offset less the strum lead, its panner set, and the sub
silenced on every note but the lowest. Played together through the engine's pool against the page's chord: **6 of 6
exact, worst 140.6 dB**, and slot by slot every composed note and sub equals the page's own numbers (no slot differs).
What it took to get there, because the first two attempts did not:
- The patched pan is `panPos * the mõdFX Width setting` (`voiceFx`), 0.4 here, not ±1; the slot comparison named it in
  one run (the only slot that differed was the pan, -0.4 against -1).
- Random draws must match. The first attempt nulled at 8 dB because a note recorded alone draws a different detune and
  phase from the stream than the same note inside the chord. With the draw fixed the programs are identical. The engine
  redraws those slots itself, which the owner accepted.

So option B is chosen: the engine's chord is a bank of one-note programs (one per pitch, at most 88) plus a recipe of
four formulas of the note count (level `1.0` / `0.78` / `0.62` for the top note, times `sqrt(4/n)` above four; pan
`(i/(n-1)*2-1)` times Width; strum offset `i*spread/(n-1)` with the roll started `0.4*spread` early when the chord is
on the grid; the sub under the lowest note only), and the existing velocity, duration and start-time patches. The whole
chord part of "all parts in the background" is therefore met on paper; what is not yet built is the engine side of it.

Not covered, said plainly: a slash bass (the sub goes under the bass note), strum off, glide on, Pure tuning, mõdFX
filters on (the Width panner is covered, the filter chain is not), the other chord voices (the sampled ones), and the
chord's choke of the previous chord (an engine scheduler job).

**Next step: slice 1 (the native clock and the drum grid) is half built (6.9.7, the section below); the chord work follows it
(slice 2) and now has its design settled.**


## Slice 1, first half (6.9.7): the clock and the drum-grid expander

**What was chosen, and why.** Slice 1 is a clock, an expander, a voice bank, chokes and a mirror. The first four
of those only mean anything if the expander makes the *right events*, and everything after it (the bank, the host
thread, the pool) can be tested against a known-good event list instead of against ears. So the first piece is the
part a Mac can fully prove: a pure C++ sequencer core with no iOS and no audio in it, and the test that holds it
to the page. The voice bank and the host come second, on top of something already measured.

**Built.**
- `native/modsynth/seqcore.h` + `seqcore.cpp`: `DrumSequencer`, a frame-counted clock (tempo, rate multiplier, swing
  by `_sqSwingOffset`'s formula, step and bar counters, bar lines) and the drum-grid expander: both layers, per-lane
  fader and tune, velocity 0/1/2 and the cell's velocity percent, the step's own pitch, accent, probability, the
  tuplet cover (`_sqIsCovered`), flams and drags, ratchets and tuplets (`r` hits over `rs` steps), humanize
  (timing, drift, velocity, per-part off), the Drums switch (it silences the Kit layer, not the Aux layer), and the
  choke group of each lane carried on the event. It turns a `DrumScore` into `DrumEvent`s: (frame, part, kit, lane,
  velocity, accent, pitch, dyn, choke group, step, bar), and passes bar lines to the caller. Nothing allocates once a
  score is set, and `run()` takes its sink as a template argument so the host can write into its own ring. The
  randomness is a native generator (xoshiro256**), not the page's `Math.random`.
- `DrumScore::fromDoubles`: the flat array of doubles the score travels as (the same shape as the voice programs the
  page already sends), and in `index.html` the page's half, `window._sqNativeScore()` (plus `window._humanState()`):
  the grids, faders, tunes, kit table, humanize settings and meter, read from the same variables `_sqScheduler`
  reads. Nothing calls it but the test. Version 6.9.7 is for these two small functions; nothing else in the app moved.
- `native/modsynth/seqtool` (`make -C native/modsynth seqtool`): runs the core on scores from a file and prints the events.
- `tests/seq/drumgrid.test.js`: the proof (below). `make -C native/modsynth seqtool && node tests/seq/drumgrid.test.js`
  (Playwright and Chromium or Chrome; `CHROMIUM` and `PLAYWRIGHT` as the other tests).

**Measured (6.9.7).** The real page runs `window._sqScheduler` on a fake clock advanced by hand, `modEngine` stubbed
to record the `{kind:'hit'}` messages it sends (so what is compared is what the page asks the engine for, before
the voice). The page's own export of the score goes to the C++ core. Then:
- *Event lists, exactly.* 19 deterministic scores, 16,595 events in all, each compared in order. Part, kit, lane,
  velocity, accent, pitch and `dyn` are identical doubles; the time is within 3.5e-9 of a frame (the page counts
  seconds, the core frames, and they agree to the last bit that matters); the whole frame the host would start the
  voice on is the same for every event. The scores cover: 120 and odd tempos (93, 61 BPM: step lengths that are not
  whole frames), swing on eighths and sixteenths, the rate multiplier at 2 and 0.5, 12, 14, 16, 32 and 64 steps, 4/4,
  7/8 and compound 6/8, tuplet cover on and off, a dense score of ratchets, tuplets, flams, drags, step pitches and
  cell velocities, the Drums switch off (Aux still plays), either layer off, and tempo changes mid-play (one and two,
  landing between steps as the page's do). Bar lines (the page's `_barAnnouncedT`) match the same way, including the
  64-step pattern that announces every 16 steps.
- *Randomised features, statistically*, 2,400 steps each. Probability 30 and 75: the native hit rates are within 4
  sigma of the expected count (page 701 and 1815, native 740 and 1813 of 720 and 1800 expected). Humanize at 1.0 and 0.4:
  the timing spread (sd 343 vs the page's 354 frames at 1.0; 138 vs 142 at 0.4), the bounds (+/-14 ms scaled), the
  velocity mean, spread and floor, and accents being humanized less, all match the page's. Drift alone: stays inside
  +/-18 ms and centred; it differs from the page's by at most 1.8 ms, because the page reads its clock when it
  schedules and the core reads the step's own time (a look-ahead later, on a sine with a 9.7 s period). Humanize
  switched off for the Aux part: its hits stay exactly on the grid on both.
- *The test bites.* Swing written with the wrong factor turned 5 of the event-list cases red; with the tuplet-cover
  chain check removed and `dyn` fixed at 1 on top (tried stacked, by hand) 19 failed.

**Found on the way (matters for the second half).**
- **The expander cannot run in the render callback.** `GraphPool::begin()` parses the program into a slot's
  `Graph` (`Graph::load` resizes vectors: it allocates), and its comment says control thread. So the sequencer
  runs on a native thread of its own, not in `renderInto`: it wakes every few milliseconds, reads the host's frame
  counter, runs the core up to a horizon a little past the replay lead (about 100 ms: the 48 ms lead plus a cushion),
  and calls `begin` with future frames. That thread is the engine's, so it keeps running when iOS stops the web view.
  The clock stays "frames of the render counter": the thread only decides how far ahead to expand.
- The page's `#bpm` field rounds what it is given to whole BPM (a fractional value written to it reads back as an
  integer). The tempo the page schedules with is that field's value, so the native tempo is whole BPM too (the test reads it back).
- Not in the core yet, deliberately: the pattern queue and the kit/groove swap at the wrap (`sqFlushPending`), the
  chain of patterns, song-driven changes. They are slice 4's; the core already announces the wrap and the bar line.

**Not done in this half, and the plan for the second half.** Each is a piece with its own test; none is switched on.
1. *Host thread.* `ModEngineHost`: a `DrumSequencer` and a `DrumScore` behind a lock, a native thread (or a
   `DispatchSource` timer on a high-priority queue) that runs the core to `frames + horizon` and hands events to the
   bank. Plugin calls to set the score (a base64 array of doubles, like `graphBegin`), start with a first frame, stop,
   tempo and rate. A mirror (bar, step, running, late-step count) in atomics that the page polls for its display.
   Verified on the Mac with a host test that runs with no page: the step counter advances, and keeps advancing while
   nothing calls the host (the simulator then shows the same with the web view throttled).
2. *Voice bank for the drum lanes.* The page records each lane's voice once at a reference (kit, lane, `dyn` choice,
   plus what is baked into it: fader, Shape, mõdFX) and probes it as the spike did, sending the program and its
   parameter map (velocity, accent and pitch slots, time slots) with a generation. The thread looks an event up by
   (part, kit, lane, dyn), patches the slots (velocity/accent/pitch, onset by moving the time slots 1:1), starts the
   program on the 128-frame grid with the 2304-frame lead, and counts a hit or a miss. A miss (no program yet) is a
   counted silence, not a crash.
3. *Chokes.* A hit with `chokes` set sends the group's still-sounding voices an `edit` (the closed hat to the open hat),
   which the pool already understands; the thread keeps the group's handles.
4. *Verification of the sound.* The same score through the page offline and through bank + pool in a host test, and the
   rendered buses nulled (the way `tests/graph` does for voices). Phone: the checklist section 18.

The developer switch (a Settings entry like Native sound, off by default) lands with the host thread, because until
there is something to switch there is nothing to put behind it.
