# Native scheduling: the sequencers move to the engine

Design, written at 6.9.4, with the slice-0 spike's results (section 5). Slice 1 is half built (6.9.7: the clock and the drum-grid expander, in C++, held to the page; section "Slice 1, first half" at the end). The engine does not schedule anything yet. It is the "then the clock" of step 7 in
`docs/architecture-plan.md`, and the reason is background play: every part already *plays* on the
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
2. **Bass and chords following the song.** *Part one done (6.9.9.3): the chord timeline and the bass line's event list, see the end of this file.* The chord timeline in the engine (the thing `_blChordWin` is
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

## Slice 1, second half, part one (6.9.8): the host thread and the step mirror

**Built.** `ModEngineHost` owns a `HostSeq`: a `DrumSequencer`, its score and counters behind a lock, and a thread of its
own (`modriff.sequencer`, user-interactive QoS) that every 4 ms reads the render thread's frame counter, expands the
score up to 100 ms ahead of it (`run(frames + 4800)`), and records each fired step in a ring. It is not the render
callback and not the page: it does not allocate in the way `GraphPool::begin` will need, and it does not stop when iOS
throttles the web view. It stands still when the render clock does (a stopped or suspended engine fires nothing) and is
joined when the host goes away. Methods on the host and the plugin: `seqScore` (the flat score, base64 float64s),
`seqStart` (bpm, rate, lead in ms, seed: the downbeat lands `lead` after the call on the engine's own clock), `seqStop`,
`seqTempo`, `seqMirror`. `seqMirror` answers `{running, step, bar, frame, steps, events, late, firstFrame, nextFrame}`;
`step` and `bar` are the last step whose moment the render clock has reached (the playhead, within the output latency),
not the one the thread has expanded to. `late` counts steps the thread reached after their moment. Nothing sounds: the
events are counted, and a test can keep them (`seqRecord`, `seqTakeEvents`). The page's entry is `window._nsDrum`
(`start`, `stop`, `sync`, `tempo`, `mirror`), a developer function with no button, which is this slice's "developer
switch": nothing calls it, so nothing changes for anyone. `seqcore.cpp` is in the Xcode project (it was not before).

**Measured.** `make -C native/modsynth seqhosttest && native/modsynth/seqhosttest`: the real `ModEngineHost.mm` with a
render loop paced like the callback (240 frames every 5 ms) and no page anywhere. 3 s of render clock at 120 BPM: 24
steps fired (24 expected from the clock), none late; the playhead step equals the one the render clock says; 30
events recorded are identical (frame, lane, velocity, accent, bar) to the core run alone from the same first frame;
after `seqTempo(60)` steps are 12,000 frames apart; with the render clock stopped for 550 ms no step fires; after
`seqStop` none; the host and its thread go away cleanly. The page half is checked with a stub plugin (the score reaches
the plugin byte for byte, `start` carries `#bpm` and the rate, an app without the methods answers "no engine").
`xcodebuild` (iphonesimulator, generic) builds. The other host tests (`hosttest`, `graphhosttest`, `warmtest`) pass;
their Makefile recipes now include `seqcore.cpp`, and `hosttest` and `warmtest` the graph files they had been missing.

**Not measured.** The simulator with the web view throttled and the phone: the thread is plain native code and the
Mac test shows it needs nothing from the page, but iOS suspending the web view is only seen on a device (checklist 18.2).
Still to build: the voice bank that makes the events sound (next), then chokes, then the null test.

## Slice 1, second half, part two (6.9.9): the drum voice bank

**Built.**
- `native/modsynth/voicebank.h` + `.cpp`: `DrumBank`, entries keyed by (part, kit, lane). An entry is the reference program the
  page recorded, plus the map of which numbers follow velocity, accent and pitch (value = reference + b * (x - x0), where x is
  the velocity, 0 or 1, and 2^(semitones/12) or the semitones for the few slots that follow the note number), which follow the
  start time (slope 1), and which slots two parameters multiply. `patch()` makes the voice for one hit: the program patched,
  begun on the engine's 128-frame grid a lead (2304 frames) before the onset, the few frames the grid cannot reach (0 to 127)
  added to the time slots. A hit that is already late is begun at the next grid line with the onset moved inside the program.
- `ModEngineHost`: the sequencer thread now plays what it expands. Each event is looked up in the bank, patched and begun in
  the pool (`GraphPool::begin` under the host's graph lock) 150 ms before it is due (the look-ahead went from 100 to 150 ms:
  a drag sounds 60 ms before its step and a humanized hit 14 ms, and the 48 ms lead must still fit before the onset). An
  event with no voice in the bank is a counted miss (`seqMirror` names the last one), a velocity of nothing is silent as on
  the page, a begin the pool refuses is counted. `seqBank` on the plugin takes an entry, or empties the bank.
- The page's half, `window._nsBank` in `index.html`: records each lane the score plays with the page's own recorder
  (`MODGRAPH.capture`: the voice is recorded and handed back, nothing reaches the host, not even the edits it makes later),
  probes it as the spike did, and builds the entry. It refuses, with the reason, a lane whose program changes size with a
  parameter, which edits itself after it starts, which picks its recording by `dyn` (a layered kit), whose slots fit nothing
  or whose time slots do not move one for one with the start time. `signature()` is what a recording has baked in (the Drums
  or Aux fader and the lane's Shape); `ensure()` records again and re-sends any lane whose signature changed. Kit numbers in the
  score and the bank are one session-stable table (`_nsKitCodes`). `window._nsDrum.start()` now empties the host's bank, records
  and sends the lanes, sends the score and starts; it needs Native sound on.

**Found on the way (and fixed).**
1. *Pitch is nothing special.* Every slot pitch moves in the kicks and hats is exactly linear in 2^(semitones/12) across -12 to +12
   (measured on four lanes). The spike's pitch validation tested the point it had fitted from, so it could not have shown otherwise.
2. *A reference recorded at a large time does not replay.* The first version recorded the reference at the context's time
   (about 1 s) and re-based it by subtracting that time in the pool: 12 of 276 hits were within 90 dB, the rest 12 to 60 dB. The
   programs were numerically the same; the cause was the interpreter's start rule. It starts a source at the first whole frame at
   or after its start time with no allowance (matching the browser), so a time that is meant to be a whole frame and comes out a
   hair above one (1.1 s is 52800.00000000001 frames) starts a frame late, and a kick's frequency sweep, which does not get the
   sub-frame start, then differs by a frame of its sweep (about 40 dB). Which way it falls depends on the digits of the sum,
   so the page's own voice at some onsets and not others has it too.
3. *The fix is two things.* (a) The recorder's clock reads zero during a bank recording and the note is recorded at 0.048 s, as the
   spike did: the program holds small numbers, the onset a lead in, and a replay shifts only a few frames (no long running
   clock to subtract). (b) `patch()` moves every time a millionth of a frame early, so a time meant to be a whole frame is never
   rounded up; the test records the page's fresh voice at the same nominal frame (a millionth early) so both mean "the voice
   at frame F". With those, every case is exact (below).
4. *The two "noise" drum voices were the recording clock.* 808 lane 6 and 909 lane 3 differed run to run in the spike's control,
   which blamed a time-derived noise offset without proof; recorded on the zero clock they replay exactly like the others, so
   the page's "not time-invariant" recordings were the large absolute time, not the voice.

**Measured.** `make -C native/modsynth banktest && node tests/seq/bank.test.js`: the real page records the 15 lanes of the
808 kit, the 909 kit and the Aux Perc kit with the production prober; for 19 hits per lane (each parameter alone, the onset
at every kind of phase of the grid, 6 random combinations of velocity, accent, pitch -7 to 5 incl. fractional, and onset) the
page records the voice fresh, `banktest` patches the bank's entry with the engine's C++ and begins it as the host does, and the
two are played through a GraphPool each and nulled: **437 of 437 hits exact** (256 bit-identical, the rest 170 dB or deeper). The
fader is part of the signature: moving the Drums fader makes the 8 kit lanes record again. `_nsDrum.start()` is exercised
end to end against a stand-in plugin (15 lanes sent, the score sent, the sequencer started; with Native sound off it says so).
`native/modsynth/seqhosttest` (the host with its thread, no page): with a bank of two synthetic voices on the drum bus, the
events become pool voices (17 hits, 0 refused, none late), sound (peak 0.62), and with no bank every event is a counted miss. The
event-list test (`tests/seq/drumgrid.test.js`) still passes with the new kit codes. `xcodebuild` builds.

**Not done / not covered, said plainly.**
- *One lane is refused:* Aux Perc lane 6, the Triangle, whose program changes size above some pitch (it was refused on `pitch 3`),
  so no single reference covers it. It is named in the test. Options for the owner/engineer: a second reference at a higher pitch band
  (the bank is keyed per lane and could be keyed per pitch band), or leave the Triangle off until the cutover.
- *The other kits.* The prober ran on the 808, the 909 and Aux Perc. The Linn, Acoustic, IDM, Jazz (layered, picks its recording by
  `dyn`, and uses recorded cymbals), mõdKit and the rest are not run through it; the prober decides per lane and names what it
  refuses, but nobody has looked at what it says for those. A lane with a user sample dropped on it is not detected (the sample
  voice is not in the signature).
- *Chokes:* built in 6.9.9.1, next section.
- *Random slots.* Replay freezes each voice's random detunes and phases (the recording is seeded): every strike of a lane is the
  same as the reference. The owner accepted that randomness may differ; a few cents and a phase on a handful of voices.
- *A full-score null.* Built at 6.9.9.2 (part four below), up to the pool: the host's strips and master are not in it.

**Next:** chokes (below), the full-score check (below), then slice 2 (bass and chords on the chord timeline).

### Slice 1, second half, part three (6.9.9.1): chokes

**What was chosen, and why.** The page's choke is three calls on nodes a hat voice registered when it was built: hold the gain
where the envelope has got to (`cancelAndHoldAtTime`), fall to nothing with a 4 ms time constant, and stop the source 72 ms later;
a voice that would have ended by itself before the choke is left alone, and the group is emptied. The engine does the same
through the pool's `edit`, and does not port any of it: the recorder already writes down what those calls do to a sent voice as
edit records, so the page runs its own `_chokeGroup` on the reference voice once per registered node and the bank entry carries
what the recorder wrote. Chosen over writing the three calls in C++ because the recorder and the interpreter already agree on
holds, and a change to the page's choke (a longer tail, a new ramp) is then a
re-record, not a second change in C++.

**How it works.**
- *Page* (`window._nsBank`): `record(msg, chokeAt, perVoice)` runs the real `_chokeGroup` on the voice it recorded. Per voice
  (`perVoice`) it runs it once for each registration alone and keeps that registration's edit records, with their times as seconds
  after the choke; the entry gets, after the mul list, `count, (until, nOps, ops...)`: `until` is when the voice ends by itself,
  seconds after its onset. A lane in no group gets `0`. A group other than `hat` refuses the lane (there is none).
- *Engine* (`voicebank.h`, `ChokeGroup`): the sequencer thread keeps, per group, the voices it has begun that registered
  (handle, where the voice began, when it ends). A hit that `chokes` calls `cut(frame)` first, before its own voice is added, or it
  would choke its own tail (the page cuts first too): for each voice not yet over by that frame it sends the entry's edit records
  with their times put on the choke's frame (a millionth of a frame early, like every other time in a voice) through
  `GraphPool::edit`, then empties the group. A choking hit cuts even if the bank has no voice for it (the page's choke does not
  depend on how the closing hat sounds), but not a silent one (the page returns before the choke when the level is 0).
  `seqMirror` gains `cuts` and `cutEdits`.

**Measured.** `bank.test.js` now also checks the four hat lanes of the 808 and 909 (closed and open): the page records the open
hat fresh and runs its own `_chokeGroup` at four distances after the onset, `banktest` patches the bank's entry, cuts it with
`ChokeGroup::cut` and the two are nulled: **16 of 16 exact, all bit-identical**. In 8 of them the voice had already ended and
neither side cut anything (the edit list is empty on the page and the engine sends none: the `until` rule agrees); in the other 8
the page sent 3 edits and the engine cut 1 voice, and 200 ms later the tail is under a fifth of the uncut voice's for the early chokes
(a small remainder is a layer of the open hat that the page does not register in the group, so its own choke leaves it too).
`seqhosttest` runs the host with its thread and no page: an open voice that rings 2 s and a closing hit half a second later in the
same group; without the choke the open voice is still sounding after the closing hit (peak 0.42), with it the host has cut it
(0.02, -26 dB, and the closing hit alone leaves 0.011 through the strip and bus), 1 cut and 1 edit counted, nothing refused, no late
step, no late edit. `hosttest`, `graphhosttest`, `warmtest`, `tests/seq/drumgrid.test.js` and `xcodebuild` pass.

**Not covered.** A closing hat with a user sample on it (the sample voice is not banked at all yet). A hat in a kit not yet run
through the prober (the Linn, Acoustic, IDM and so on: they may register nodes the 808 and 909 do not; the prober would still
record whatever the page registers, and refuse a group other than `hat`). Not heard on device: the cut itself on a phone (18.6).

### Slice 1, second half, part four (6.9.9.2): the whole score, and soft hits

**What was chosen, and why.** The pieces were each held (events to the page, a patched voice to the page's, a cut to the page's),
but nothing played a whole bar. The check that closes slice 1 does, and does it with the host's own code: `HostSeq::play` moved into
`seqplay.h` as `DrumPlayer` (bank lookup, the hat group's cut, patch, `GraphPool::begin`), which the host thread and the new
`native/modsynth/scoretest.cpp` both run. `scoretest` is the host thread's loop without the host: a `DrumSequencer` expanding a
lookahead ahead of a render clock that advances a block (128 frames) at a time, a `DrumPlayer` beginning voices in a pool, the pool
rendering. The other side is the page: `tests/seq/score.test.js` sets up a pattern in the real page, lets the production prober
record its lanes, asks `seqtool` for the engine's events, and records each of those hits fresh at the engine's own frame, in order,
with the page's choke registry live, so the page's own closing hats shut its own open hats. Both go through a pool each and are nulled.
Stopped short of the host's strips and master chain, which sit downstream of the pool and are the same code for both sides.

**Measured.** `make -C native/modsynth scoretest seqtool && node tests/seq/score.test.js`: three bars (swing 25 at 120 BPM, no swing at
100, swing 50 at 140; 35, 38 and 44 hits: velocity, accent, tuned cells, a ratchet, an ornament, an open hat shut by a closed one three
times, the Aux Perc layer) null at **147.7, 147.4 and 145.7 dB**, no hit missed the bank, none was refused or began late, 3 cuts each.
(Not bit-identical because the two pools add their voices in a different order; the worst 100 ms window is 143 dB or deeper.) With
the engine's choke edits removed the same bars null at 53 and 57 dB and the test fails, so it can tell.

**Found on the way, fixed.**
1. *A page voice has output before its onset.* The first version began the page's voices at frame 0 and the bars nulled at 15 dB: the
   808 kick has a waveshaper, and a waveshaper turns silence into a small constant, so a voice sounds that constant from the moment
   it is begun, not from its onset. In the engine that is the 48 ms lead; begun at frame 0 it was the whole bar. The page side is
   now begun where the engine begins its own voice. (The per-hit test never saw it: it compares from the onset.)
2. *Soft hits are not on the velocity line.* The whole-bar test, at a hit of velocity 0.288 on the Aux Perc cowbell, was 37 dB, and
   the per-hit test, which had not gone below 0.3, was then taught to: the voice clamps its levels (`max(0.0002, ...)`), so below
   about 0.4 the line the fit found from 0.45, 0.7 and 0.9 goes under the floor and the voice does not. The prober now records two
   soft velocities (0.15 and 0.05), finds the slots that clamp and what to (they all clamp to the same constants), refuses a slot
   that leaves the line any other way, and the entry carries the floors; `patch()` holds the value at them. 808 lane 7 had the same
   at 0.05. Per-hit test: **529 of 529 exact** (359 bit-identical), up from 437 with the soft hits added.

**Not covered.** The host's strips and master in the null. Probability and humanize (the engine draws its own; statistics in
`drumgrid.test.js`). A pattern of more than about 90 hits in the bar (the page side keeps them all in one pool). The Triangle and the
other kits and user samples, as before. Not heard on device: 18.3 to 18.7 as before.

## Slice 2, part one (6.9.9.3): the chord timeline and the bass line's events

**What was chosen, and why.** Slice 2 is the bass, the chord comp and the chord timeline both follow. It is too big for one step, so it
goes the way slice 1 did: the part that decides *when and what* first, held to the page by event lists; the voices after. This step is
the bass line's sequencer and the chord timeline it reads (`native/modsynth/basscore.h`), in C++ with no iOS and no audio, held to
the page's real `window._blScheduler`. The bass comes before the chords because its decisions (re-rooting a written line onto the chord
sounding, the slide memory, swing and the length cap) are all in the scheduler, whereas the chord comp's hard part is the voice
(composing a chord from per-note voices, see "The chord investigation") and belongs with the voice work. The chord timeline is built
first because it is what the bass, the melody and the chord comp all hang on (`_blChordWin`); the engine has the same two lookups
(`windowAt`, `windowFor`) and, when the song loop moves in (slice 4), the song will write it directly. Until then the page sends the
windows it commits (`window._blNativeChords`).

**What is in it.** `ChordTimeline` (the page's `_blChordWin`, with `_blWindowAt`'s "the chord that started last" and 2 ms of slack, and
`_blWindowFor`'s "carry the last chord forward, but not a rest"); `BassSequencer`, the grid branch of `_blScheduler` on a frame clock:
swing (the drums' own, 8ths or 16ths), Follow with `_followRemapPc` (a note's role in the chord it was written over becomes the same
role in the chord sounding, the root onto a slash bass, passing notes pulled into the key), `_followRange` and `_followNearIn` (the
register it stays in), a pinned step (`fix`), a rest in the chart (nothing sounds and a slide survives it), the step's length and the
cap that keeps a pushed step off the next downbeat, probability, humanize, and the slide memory `blPlayNote` keeps (`from`, ended by
a gap, a missed probability and the wrap). The feel formulas (`_stepProb`, `_humanT`, `_humanV` and the drift) moved out of the drum
sequencer into `Feel` in `seqcore.h`, so the two draw them one way; `drumgrid.test.js` still passes.
The page exports the line (`window._blNativeScore`, `_blNativeChords`; `_blClock` and `_blSetClock` for tests).

**Measured.** `make -C native/modsynth basstool && node tests/seq/bassgrid.test.js`: the page's scheduler runs in the real page on a
clock of its own, with the chord windows a song would have committed, and every note it sends is kept; `basstool` runs the same score
and windows; the two lists are the same on every one of eight cases, in every field (when to 1e-5 of a frame, which note, how long, how
loud, accent, slide, the note it glides from): follow over I-vi-IV-V; swing 40 on the eighths in a minor key; swing 60 on the sixteenths
at rate 2; slash chords and a rest; a 12-step line over chords that change every beat; a dense 32-step line; Follow off; and a line of
slides across a rest. The lines are half chord tones, so the role mapping and the slash bass are exercised, not only the passing-note
fallback. Probability (30 and 75), humanize (timing inside 14 ms, spread and level against the page) and "the bass left tight" are held
on statistics. Five hand-made breakages of the C++ (the slash bass, the length cap, the role index, the pinned step, the slide across
a rest) each fail the test. `xcodebuild` builds.

**Found on the way.** The test's own mistakes, three of them, each of which made it pass without testing: the swing was set on a
variable that is not the page's (swing 0 on every case); the chord windows were built on the previous case's clock and the page
dropped the early ones (`_blOnChord` drops windows behind the clock); and a random grid has almost no notes that are the line's own
root, so a slash chord was never asked. The mutation check (above) is what found them.

**Not done, said plainly** (the score refuses the first three, and `_blNativeScore` says which):
- *The walking line* (Jazz style with Follow on): a different scheduler with its own randomness (`_blWalkNote`), snapped to the drums'
  bar line. Next in this slice.
- *Locked phrases* (a line frozen per chord, indexed from the chord's downbeat) and *a line written ahead for the next chord*
  (`_blPregen`, swapped in at the wrap): the engine takes a new score when it arrives, so a swap lands at the next step, not the wrap.
- *Pure tuning's cents* (`tune`) and *`_midiRecLogBass`* (recording the bass to MIDI).
- *The bass voice*: nothing in the bank yet. The spike found the bass replays exactly, with pitch and duration as slots; the bank for it
  (a voice per note, `from` for the glide, the monophonic cut of the previous note) is the next piece.
- *The chord comp* and its choke of the previous chord; the *melody* uses the same timeline (slice 3).
- *The host*: nothing runs this on the host thread yet. Not heard on device: nothing is audible; the only app change is exports no one calls.

## Slice 2, part two (6.9.9.7): the bass voice bank, the cut of the note before, and a whole line against the page

**What was chosen, and why.** The bass line's events (part one) needed voices. The spike had found the bass replays exactly with pitch and
duration as slots, so the engine's bass is a bank like the drums': the page records each voice once (`window._nsBank.buildBass`), maps
which numbers in the program follow the quantities a note has, and the engine patches a program for any note (`BankEntry::patch`, the
same code as the drums, with two more quantities). The bass is part 2 of the same bank; a voice is four entries, because the note's own
`slide` (it runs into the next: a longer tail) and `from` (it starts gliding from the last note: a frequency ramp) are independent and
each changes the program. `BassPlayer` (`bassplay.h`, the host thread's code once the host runs it) picks the entry, patches it, begins
it in the pool, and cuts the note before it.

**What the probe finds, beyond the drums' (velocity, accent, pitch, start time, soft-hit floors).**
- *The length.* Every envelope time is `a + b * dur` held at one end (a plucked voice's `min(0.09, dur * 0.35)`), fitted from eight
  lengths (30 ms to 3.2 s) as a line, a line held from above or a line held from below; a slot that is none of these refuses the voice.
- *The glide:* the note it comes from, linear in frequency or in the note number, as pitch is.
- *The ends of the roll.* The plucked (Electric) voice's noise burst plays at `freq / 70` held to 0.6 to 2.4, so its rate follows the
  note in the middle of the roll and is flat at both ends. The first version banked it from the notes 30 and 52 and was 38 to 60 dB off
  at 28, 55, 64, 67, 72 and 76. The probe now checks the notes beyond the two it fitted on, finds the bounds, and the entry carries them.
- *The cut.* A bass is monophonic: a note that starts inside the tail of the one before fades it over 15 ms. The page does that with
  `cancelScheduledValues`, a `setValueAtTime` of the gain's current value and a ramp, and the probe reads exactly those edits from the
  recorder (the second note's voice code writes them onto the first note's recorder; `_mgFlush` now keeps them in a captured recording
  instead of dropping them). They are **not** replayed as they are, for two reasons in the page's code. `cancelScheduledValues` removes
  the ramps ahead of the cut, so what a note does before the cut depends on whether the edit arrives before the note begins (the
  page schedules ahead, so it usually does) or after (the engine learns of the next note up to a lookahead before it sounds, so a long
  note is already playing): the same edit gives two notes. And a note that has not begun when the page calls reads a gain of 1, the
  node's default, so the page's fade starts from 1, not from the note's level. The engine's cut is what the code's comment says it
  means, "cut whatever is still sounding right at the new note's onset": hold the gain at the onset (`cancelAndHold`, which the
  interpreter and the recorder agree on and a late edit cannot change the past of) and fade it over the same 15 ms. The template the
  page records is converted to that, per voice, record for record.

**Measured.**
- `make -C native/modsynth banktest && node tests/seq/bassbank.test.js`: the seven synthesized voices (Sub, Tri, Sqr, Acid, Acid 303,
  Electric, Upright) in their four variants, **504 of 504 notes bit-identical** to the page's fresh voice: notes 28 to 76, levels 0.04 to
  0.7, accents, lengths 30 ms to 6 s, glides from other notes, onsets at every phase of the grid. A sampled voice is refused with its
  reason; the voice's signature (the voice, its level, the filter, the fader) changes when one of them does.
- `make -C native/modsynth bassscoretest basstool && node tests/seq/bassline.test.js`: five lines (Electric over I-vi-IV-V with swing 25;
  Acid over slash chords and a rest with slides; Sub in 12 steps with swung sixteenths; Upright with Follow off and long notes; Triangle at
  rate 2) run through the engine's own sequencer and player a block at a time, against the same notes recorded fresh by the page in order
  with its own cuts, each note begun where the engine begins its own: **all five exact** (three bit-identical, two at 164 and 174 dB; 12 to
  25 notes cut short in each line, the engine cutting the same ones). With the engine's cut removed they fail (11 cases), with the slide
  variant ignored (6), with the tails swapped (4). The page-side reference for the cut is the page's own edits with exactly the change
  above; the unchanged ones, with the same engine, are 13 to 39 dB off in the three lines that have long notes (and exact in the other two).
- The other tests (`bank`, `score`, `drumgrid`, `bassgrid`, `seqhosttest`), `check.sh`, `npm run build` and `xcodebuild` pass.

**A finding in the page, not fixed here.** With the page's cut as it is, a line's peak is 0.40; with the hold-and-fade, 0.18, in the same
line. The page's fade starts from a gain of 1 when the previous note's gain has not begun at the time of the call, which is the common case
for a staccato line (a note at one step has a tail of 0.92 steps and 60 ms, so most notes are cut by the next). That is a possible level bump
of up to 12 dB for 15 ms at the onset of most bass notes, under the new note's attack. This is read from the recorder (whose `.value` is the
gain at the capture clock) and the code, not heard: in the browser `.value` is the value at the time of the call, and which it is depends
on when the page schedules relative to the previous note. Worth listening for on the phone with a staccato line (checklist 19.1).

**Not done, said plainly.**
- (The host did not run the bass at 6.9.9.7; it does from 6.9.9.8, next section.)
- The sampled voices (they name a recording per note), locks, Pure tuning's cents (`tune`). (The walking line: 6.9.9.9, below.)
- A voice that sits on a mõdSynth patch (`_blStopMsx`).
- The chord comp, and its choke of the previous chord.

## Slice 2, part three (6.9.9.8): the bass on the host thread, and a developer entry

**What was chosen, and why.** The bass is another sequencer on the thread the drums already use (`modriff.sequencer`), sharing the bank (it is
part 2 of it), the pool and the begin/edit paths, so there is one place that holds a voice's handle and one lock. `HostSeq` holds a
`BassSequencer` and a `BassPlayer` beside the drum `DrumSequencer` and `DrumPlayer`; each tick expands both a lookahead ahead of the render
clock. The bass has its own clock (it starts at its own step 0, as the page's bass starts at its own bar line), but `alignToDrums` starts it
on the drums' next downbeat when they run, which is how the two share a bar line from a single "go". The chord timeline reaches the host as
frames from the line's start; the host puts the start where its clock has it (`ChordTimeline::fromDoubles` takes an offset), so the page
need not know the engine's frame count.

**What is there.** `seqSetBassScore`, `seqSetBassChords`, `seqBassStart` (tempo, rate, lead, align, the voice's bank code), `seqBassStop`,
`seqBassSetTempo`, the Swift plugin methods, and `bass` in `seqMirror` (running, nextStep, steps, notes, hits, misses, refused, cuts,
lateStarts, windows). The page: `window._nsBass` (`prepare`, `sync`, `start`, `stop`, `tempo`, `mirror`), beside `_nsDrum`; `start` records
the voice into the bank (`ensureBass`), refuses a line the engine cannot play yet and says why, sends the line and the chart as it stands,
and starts. Nothing in the app calls it.

**Measured.** `native/modsynth/seqhosttest` (the host with its thread, no page): with a synthetic bass voice in the bank (the four variants)
and a line of a note every step two steps long, the bass steps on its own (13 steps), shares the drums' downbeat (same first frame), begins
13 notes from the bank (0 missed, 0 refused, none late, no late edit), each note after the first cuts the one before (12 cuts), holds the
two-window chart and sounds (peak 0.6); `seqBassStop` stops it; a bass score or chart that does not parse is refused and no score is no
start. `bassbank.test.js` now also runs `_nsBass.start()` against a stand-in plugin: 4 entries sent, line and chart sent once, started on
the drums' downbeat with the voice's bank code; with Native sound off it says so; a walking line is refused with the reason. `hosttest`,
`graphhosttest`, `warmtest`, the drum/bass tests, `check.sh`, `npm run build` and `xcodebuild` pass. What is *not* measured here is the
bass through the host's strips and master (the null is at the pool, bassline.test.js).

**Not done.** The chart is the windows the song has committed when `start` is called, from the first one; it does not follow a song as it
plays on (that is slice 4, the song loop). Tempo changes need `_nsBass.tempo()`. The drums' and the bass's clocks are two clocks that start
together, not one. Sampled bass voices, the walking line, locks, `tune`. The chord comp. Not heard on device: checklist 19.2 to 19.4.

## Slice 2, part four (6.9.9.9): the walking line

**What was chosen, and why.** Jazz style with Follow on makes the page's bass scheduler a different scheduler: quarter notes on the chart's own
clock, one note a beat, whatever the grid says. It is in the engine as the second branch of `BassSequencer::run`, taken when there is a chart
to follow and the style is Jazz, as the page takes it. Same decisions as the page's, in frames: the walk's clock re-anchors to each new chord's
downbeat and is snapped UP onto the drums' bar line while they run (never back: a rewind would re-fire notes already committed); a beat whose
moment passed while it waited for its chord is skipped, never played late; the two-feel plays half notes on beats 1 and 3; each note is
`_blWalkNote`'s: beat 1 the chord's root (the slash bass if there is one, in the octave nearest the last note), the beat before a change a
half step or a fifth from the next root, the beats between a step through chord and scale tones weighted towards the target. The walk runs
on `now` (the render clock) as well as the horizon, which is why `run` takes both, and the drums' next bar line
(`DrumSequencer::nextBarFrame`, the port of `window._sqNextBar`), which the host reads right after the drums have run each tick.

**The random picks.** The last-beat approach and the middle beats pick with `Math.random` in the page; the engine uses its own generator,
which the owner accepted. To still hold the walk *note for note*, the test gives the engine a random tape: the draws the page made inside its
scheduler, in order, are the engine's draws (`BassSequencer::setRandomTape`). Same decisions, same draws, same notes. In production the tape is
empty.

**Measured.** `make -C native/modsynth basstool && node tests/seq/basswalk.test.js`: the page's real scheduler runs on a clock of its own,
called once per tick as its clock calls it (the walk depends on *when*), with the chord windows the song had committed at each tick and the
drums' bar line as the page reads it; the engine runs the same ticks. **Eight cases identical note for note** (when to 1e-5 of a frame, which
note, how long, how loud, accent): four to the bar over I-vi-IV-V with no drums; the same with a drum grid three steps off the chart; two-feel
over ii-V-I with slash chords and a rest; chords changing every beat or two with drums; odd chord lengths at rate 2; a song that commits each
chord just before it starts (so the walk waits for it and skips the beats that pass); chords that start a little after a beat, with drums,
committed late; joining a song part-way through a chord in the two-feel with drums on. Without the tape (the engine's own draws), the same
cases keep their timing, length, level and accent exactly, their downbeats are the same pitch class, and every note is inside the walk's
33..52. A walking line through the voice: Electric over slash chords and a rest, the engine's sequencer and player against the page's voices
(`bassline.test.js`), bit-identical. `seqhosttest`: the host walks (3 notes in 1.5 s at 120 BPM where the grid plays 12). Breaking the skip of
a passed beat, the length of the two-feel's note, the step limit of the approach and the weights of the middle beats each fail the test.
`xcodebuild` builds.

**What the test does not reach, said plainly.** Four guards in the walk's re-anchoring are ported and not exercised by any case (changing
them does not change a list): the pause of half a beat after a note before a chord tapped just after it can re-anchor (`_blWalkLastT`), the
0.02 beat of slack in the snap, the reset of a walk left behind by more than a beat, and the rule that a new window only pulls the walk back by
less than half a beat. They matter for a hand-played chord and a song that stops and starts, which is the song loop (slice 4).

**Not done.** Locked phrases (a line frozen per chord; the page's walk plays the lock's four sixteenths in the beat), which the score
still refuses; `tune`; the chord comp; the song loop. The walk's state is not reset when the chart is replaced while it plays (the page
resets it on a hand-played chord). Not heard on device: checklist 19.5.
