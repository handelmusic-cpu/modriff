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

## Slice 2, part five (6.9.9.9.4): the chord comp's voice

The chord is composed in the engine from a bank of one-note chords (`window._nsBank.buildChordNote`, one entry per pitch; `chordcomp.h`): each note's
program with the sub silenced, its tone's level times the note's factor, its times moved by the strum offset, its panner set, plus the sub from the
root's program with the tone silenced. `chordplay.h` stops the chord before with the edits the bank holds (hold, 22 ms fade, stop the sources),
leaving alone the sources it silenced (a stop sent to them would revive them: the first version was 2x too loud). The prober also learned lengths and
velocities that are piecewise lines (`_fitLen`), a filter that sits on its ceiling at the reference level, and kinks (the piano).
Measured: `tests/seq/chordbank.test.js` 960 of 960 chords exact (sine, triangle, sawtooth, square, piano, pad; Strum on/off, Width on/off, 1 to 6
notes, slash chord, inversion; worst 143.8 dB); `tests/seq/chordline.test.js` six-chord runs with the stop of the chord before, eight runs, all
exact (worst 100 ms 148 dB). Bass 504 of 504 still bit-identical. Not done: the chord comp's scheduler (rhythm patterns, `rhyStrike`), voicing, the
host thread, the page's developer entry, sampled voices, glide. The version is a fifth part (6.9.9.9.4) because main had already moved there.

## Slice 2, part six (6.9.9.9.5): the chord comp on the host thread, and `_nsChord`

**What was chosen, and why.** The chord rhythm's scheduler (`chordcore.h`, a port of `scheduleChordRhythm`) is a third sequencer on the thread the drums
and bass use, with the chord player of part five and the same bank, pool and lock. A rhythm is a loop of sixteenths with hits at positions that can sit
between sixteenths, each with a strength; each pass fires the hits of its sixteenth at the step's time plus the hit's offset plus the swing (the
rhythm's own, else the Feel's). The chord comes from the page already voiced: smartVoiceLead and Vary are the page's, and the engine plays the voicing
it is given, once. Like the drums and bass it starts on the drums' downbeat when they run.

**Measured.** `make -C native/modsynth chordtool && node tests/seq/chordrhythm.test.js`: the page's scheduler runs on a clock of its own and the
engine runs the same score; hit lists identical (when to 1e-5 of a frame, level, length, chord) for the built-in strum rhythm, with the Feel swing
on the eighths, a drawn rhythm with soft, plain and accented hits and its own swing, and a drawn 12-step rhythm with a slash chord and the Feel swing
on the sixteenths. Without the swing in the engine it fails (3). `seqhosttest` (the host with its thread, no page): the chord rhythm steps on its own,
shares the drums' downbeat, composes three voices from the bank for each hit (2 hits, 6 voices, 0 missed, 0 refused), the second chord stops the first
(3 stops), no late edit; stop stops it. `chordbank.test.js` runs `_nsChord.start()` against a stand-in plugin: the pitches (and the sub's) recorded,
the rhythm sent once, started with the voice's code on the drums' downbeat; refused with Native sound off, and for a gated rhythm. The 960-chord and
eight-run tests of part five and everything else still pass; `xcodebuild` builds.

**Not done, said plainly.** A gated hit and so a ratchet (the page holds the chord and lets it go at the end of the hit's length: a sustained program and
a release edit), refused with its reason; the song's own comping through chord windows and the tap that starts a rhythm (the page skips a re-strike within
60 ms of the finger); the page's per-hit re-voicing (Vary); sampled chord voices; glide; Pure tuning. Not heard on device: checklist 22.

## Slice 2, part seven (6.9.9.9.6): gated hits and ratchets in the chord rhythm

**What was chosen, and why.** A gated hit (a hit with a length in steps; every ratchet's re-strikes but the last are gated, the last takes the cell's
own length) is the chord held with no decay, then let go of at the end of the gate: the page plays it as `playChord(..., sustain)` (`dur` null: no
decay envelope, and with Strum on the settle ramp to 0.7 of the level) followed by `_releaseChordAt(id, atTime + lenSec)` (`_webChordReleaseAt`: for
every voice hold the gain at the later of that moment and its start plus the attack plus 20 ms, fall to nothing over the Release knob, stop the
sources a little after). So the held chord is a second recording of each pitch in the bank (`buildChordNote(voice, pitch, true)`, bank part 4, same
fitted slots as the decaying one but with no length slots), which also holds the release as edits: the page's own release is run once on the
recording, under the recorder's clock, at three moments and two levels (they must agree, as the stop of the chord before does), and the entry stores
its records with times relative to the moment of release plus `relMin`, the earliest it may act after the voice's start (read off the release sent
before the attack ends). `chordplay.h` sends each voice its own release after beginning it, at `max(onset + gate, voice start + relMin)` (the strum
puts the voices at different starts, the sub at the chord's own); the edits aimed at the half a voice silenced are left out as for the stop
(`cutWithout`). `chordcore.h` marks a hit held when its length is above 0. `_crNativeScore` no longer refuses a gated hit; `_nsChord.prepare` records
the held chord of each pitch when the rhythm has gated hits and the plain one when it has plain ones (a ratchet needs both).

**Measured.** `tests/seq/chordline.test.js` now also plays six chords held for 0.02 to 0.9 s (shorter than the attack, a gate, past the next chord,
which then cuts it) through the page and through the engine's player and nulls them: sine, sawtooth, piano and pad, Strum off and on with Width,
29 voices and 25 releases each, 157.9 to 163.9 dB (the decaying runs are unchanged at 156 to 163). It fails without the release (to -0.6 to 19 dB) and
without the attack's minimum (to -29 to 19 dB). `tests/seq/chordrhythm.test.js` has a drawn rhythm with holds, ratchets of 2, 3 and 4 and a held
ratchet: 72 hits (54 held) identical to the page's, and when the page lets go of each one, to 1e-5 of a frame (a gate 1% long fails it). The host test
has a gated first hit: 3 releases for every held chord and none late. The 960 chords of `chordbank.test.js`, the bass and drum tests and the host
tests are unchanged; `xcodebuild` builds.

**Not done.** The song's comping and the tap (slice 4); the page's re-voicing per hit (Vary); sampled chord voices; glide; Pure tuning. A hit whose gate
runs into the next hit is cut by it, as on the page (the stop of the chord before). Not heard on device: checklist 22.4.

## Slice 2, part eight (6.9.9.9.7): locked phrases in the bass line

**What a lock is.** The player can freeze the bass line they hear over one chord (`PHRASE_LOCKS.bass[phraseKey(slot)]`: its cells, its steps and the
root it was written over). While that chord sounds (Follow on, not a rest) the lock replaces the bar: the grid scheduler indexes it from the chord's own
downbeat, `round((t - window.t) / step) mod steps`, so a chord longer than the phrase repeats it; it is moved by the capo (`phraseFold` by the
difference of the chord's root and the lock's, one octave at most, into the register 33 to 52) and is not re-rooted like the bar is. The walking line
asks the lock a beat at a time instead: the four sixteenths of the locked bar that fall inside the beat, none of them past the end of the chord, the
walk's own note and the two-feel skip both skipped (the phrase carries its own rhythm), and the walk's state (its previous note, its beat counter)
left alone.

**How the engine has it.** The lock rides with the chart: `ChordTimeline::fromDoubles` now reads, after the windows, `nLocks` and per lock its steps,
its root and its cells (nine doubles each, the grid's), and each window carries the index of its lock (`-1` for none). The page decides which window
has one with its own `_blLockFor`, so none with Follow off and none on a rest, and the engine only has to look the index up. `basscore.h` does the rest
in `fireStep` and `runWalk`. The chord-window format changed (the lock index and the table are not optional), so `_nsBass.sync` sends `[0, 0]` for no
chart and the host test's raw windows carry both. `_blNativeScore` no longer refuses a locked phrase.

**Measured.** `tests/seq/basslock.test.js`: the page's scheduler, with locks stored against some of a song's chords, runs on a clock of its own, and
`basstool` runs the same score and windows: 11 cases (grid and walking line; locks written at the sounding pitch and 2 to 10 semitones off; 4, 5, 6, 8,
12, 16, 24 and 32 steps; swing on the eighths and sixteenths; rate 2; slash chords, a rest, chords that start off the beat and are committed late;
Follow off) give 765 notes identical to the page's in time (to 1e-5 of a frame), pitch, length, level, accent, slide and the note slid from; each case
is also run without its locks to show they change the line (and Follow off does not). It fails without the capo shift (9 of the 11 cases), with the
lock indexed from the bar and not the chord (2), and without the walk's end-of-chord check (2). The host test takes a window with a lock and refuses one
that names a lock the table does not have, and a table cut short.

**Not done.** A line written ahead for the next chord (`_blPregen`, still refused with its reason); Pure tuning's cents; a lock edited while it plays
(the chart is sent when `start` is called); the page's melody locks (not in the engine at all). Not heard on device: checklist 19.6.

## Slice 2, part nine (6.9.9.9.9.1): lines written ahead

**What the page does.** With Follow off and Sync on, the page writes each chord's bass line while the chord before it sounds (`_blPregen`) and holds it,
as `_blPendingGrid`, for the first step of that chord (`_blPendingAt`); a plain regenerate while the pattern plays (`blGenerate`) is held for the top of
the loop; `_blLand` puts a waiting line in at once. The scheduler takes a held line over at the top of a step when `blNextT >= _blPendingAt - 2 ms`,
and at every wrap (`_blApplyPending`) unless its moment is still ahead of the clock; a line is replaced by a later one, and a plain regenerate clears
the moment the earlier one was held for.

**What the engine does.** The generator, its dice and its timers stay the page's: the engine is handed the line and the moment, and swaps it in.
`BassPending` (`basscore.h`) is the cells and either a moment in frames or none; `BassSequencer::setPending` holds one (a later one replaces it), the
grid scheduler swaps it in at the top of the first step at or after the moment (less the same 2 ms) and at every wrap unless the moment is ahead of the
render clock and has not been reached, and the walking line's step clock takes it at the wrap too. The page sends `window._blNativePending(sr, origin)`
beside the score (the score's own part that the generator changes at once, the grid's root and tones, still goes with the score, as it did); `[0]`
clears. Host: `seqSetBassPending`, `seqBassPending` in the plugin; frames are from the line's start, placed on the clock when it arrives and again at
the start. `_nsBass.sync` sends it. `_blNativeScore` no longer refuses a waiting line.

**Measured.** `tests/seq/basspending.test.js`: the page's scheduler on a clock of its own, with the player's events between two ticks (a line written a
chord ahead three times in a row, a plain regenerate, a regenerate that replaces a line held for a chord, with Follow on and the chart, a moment already
behind the clock, `_blLand`, a line written four chords ahead and held through the wraps, and a 12-step line at rate 2 with swing, slash chords and a
rest), against `basstool` handed the same ticks with the score and pending line the page would send at each event: 8 cases, 477 notes identical in time
(1e-5 of a frame), pitch, length, level, accent, slide and glide source. It fails with the pending line ignored (all 8), without the swap at the chord's
start (3), with every held line landing at the first wrap (5) and with the swap 0.1 s late (2). The walking and lock tests are unchanged (the tick format
gained a score and a pending slot); the host test takes a pending line, clears it, and refuses a short or empty one.

**Not done.** The guard for a scheduler that has fallen behind the clock (a held moment already passed when the wrap comes) is in, but no test reaches it:
the page clamps the notes of a starved scheduler to the clock, the engine does not, so the two lists differ for another reason. The page's timers that
decide when to write a line (`_syncRegenAt`, `_syncPregenNext`, the song loop) are slice 4; for now a person calls `_nsBass.sync()` after a line is
written. Pure tuning's cents. Not heard on device: checklist 19.7.

## Slice 4 plan: the song loop in the engine (written after 6.9.9.9.9.1; nothing built yet)

**What the page's song loop is today** (found by reading, `index.html`): `startSongLoop` picks the section and chord to start on (a held place, the chart's
cue, a tapped chord) and waits for a bar line or starts at once; `_playLoopSlot` plays one chord (`playChartSlot2`: the live capo, `smartVoiceLead` and Vary,
`stopAll`, `playChord`/`playSlashChord`, `setArpChord`, the logic highlight, a regenerate of the bass and melody), publishes the chord's window to the bass and
melody (`_blOnChord`), and schedules the chord's own comp hits (`_scheduleCompHits`, built-in and drawn rhythms, from the slot's `comp`); `tickSongLoop` counts
the bar lines the clock announces (the drums' wrap, or the click) and calls `_advanceLoopSlot`, while a slot of beats or eighths advances on its own
`setTimeout`; `_advanceLoopSlot` walks the section, counts passes (`secPlays`), applies a queued Next/Prev, leaves a section, closes a chorus for the practice
trainer, and hands an armed ending to `_runEnding`. Around it: tempo moves (the trainer's jump each chorus, a ritardando as a stream of `_setBpmGliss`),
endings (cold, finish, fade, tag, ritard), a live key change (`transposeSong`, the capo), edits to the chart while it plays, and the page's timers that decide
when the bass and melody write a line for the next chord (`_syncRegenAt`, `_syncPregenNext`). About 2,000 lines, a third of them endings and the trainer.

**What the engine already has, and what it lacks.** Has: a clock in frames, the drums' bar line, the chord timeline (`ChordTimeline`) the bass reads, the chord
rhythm and the held/decaying chord voice, locks, lines written ahead. Lacks: (1) a tempo that can move while it runs (every sequencer steps by one constant
`stepFrames()`; the trainer's jump, a ritardando and a tempo change in the song all need a tempo map); (2) the song itself (sections, chords, passes, queues);
(3) the page's voicing (`smartVoiceLead`, Vary) as the engine's; (4) the song's comping; (5) a way to tell the page "write the next chord's line now", since the
generators stay JS; (6) the mirror the page draws the highlight from.

**The pieces, in the order I would build them, each verified against the page the way slice 2 was** (the page's code on a clock of its own against a C++ tool,
lists identical; mutation checks that the test can fail; audio nulls where sound is composed; the host thread; a developer entry; a checklist line):
1. *A tempo map. Done (6.9.9.9.9.2), see the end of this file.* The sequencers step by a tempo that is a function of the frame (piecewise: a jump, or a ramp). Test: the page's `_setBpmGliss` and the
   trainer's jump against the engine's step times, drums, bass and chord rhythm together. Everything else needs it, and it is useful alone.
2. *Song stepping. Done (6.9.9.9.9.4), see the end of this file.* `SongScore` (sections, chords with their lengths in bars, beats and eighths, rests, `follow`, passes, the capo) and a `SongSequencer` that
   starts where the page would, advances on the bar lines of the drums' clock (and on its own clock for sub-bar chords), counts passes, leaves sections, applies a
   queued Next/Prev at the end of the pass, and emits the chord windows the bass already reads (so the page stops calling `_blOnChord`). Test: the page's
   `startSongLoop` / `tickSongLoop` / `_advanceLoopSlot` on a fake clock, with bar lines announced the way the drums announce them; the lists of (time, section,
   chord, window) identical for loops, repeats, endings-free songs, sub-bar chords, snap modes, aligned and waiting starts.
3. *The chord of a slot. Done (6.9.9.9.9.7), see the end of this file.* A port of `smartVoiceLead` (deterministic, with its state) and the slot's chord event into `ChordPlayer` (the voice exists since
   6.9.9.9.4), `stopAll` on a rest, `ring`. Vary's dice are the engine's (not the page's: the owner accepted that, 6.9.4). Test: voicings identical over
   a progression, and the 960-chord null test fed from the song.
4. *The song's comping. Done (6.9.9.9.9.9), see the end of this file.* `_scheduleCompHits` as the chord rhythm of `chordcore.h` restarted at each chord and bounded by the slot (built-ins and drawn
   rhythms, swing, the no-re-strike-of-the-first-hit rule, gated hits already done). Test: hit lists per slot against the page.
5. *Asking the page for a line. Done (6.9.9.9.9.9.1), see the end of this file.* The engine publishes "the chord that follows is X, it starts at T" a chord ahead (what `_syncPregenNext` computes today) and
   the page answers with `_blNativePending` (6.9.9.9.9.1). Test: the page's reply path with a stand-in plugin; the timing margin measured.
6. *Mirror.* Section, chord, pass and bar published to the page for the highlight and the section buttons; `_moveToSection`, hold and stop as commands.
   Test: the mirror against what the page's highlight shows on the same run.
7. *Endings and the practice trainer.* Cold and finish (a landing chord and a band hit on the downbeat), fade (a master ramp), tag (repeat the last two chords),
   ritard (a ramp in the tempo map), the trainer's loop `a..b`, speed-up and next-key per chorus. These are the last and the most separable: if the owner
   prefers, they stay page-driven (the page sends the commands at the wrap) and are simply not available while the app is away.
Slice 3 (the arp and the melody generator) sits beside this: both follow the chord stream, so piece 2 should come before them, not after.

**Decisions that are the owner's.**
- While the app is in the background there is no page to run the generators, so a Follow-off line that is rewritten for every chord stops being rewritten
  (the last line keeps playing); Follow on, locks and everything else carry on. Accept this for v1, or port the generator (large)?
- Endings and the trainer in the engine for v1 (piece 7), or page-driven and off in the background?
- A chart edited while it plays: the page sends the changed song; the engine takes it at the next chord boundary (my proposal), or at the end of the pass?

**Not in scope** (4.3 and the earlier decision): the song editor, MIDI out/in and external clock stay on the page.

## Slice 4, piece 1 (6.9.9.9.9.2): the tempo map

**What was built, and why.** `native/modsynth/tempomap.h`. Until now each sequencer held its own constant tempo and added one step length to its clock per
step, so a tempo the engine would move by itself (the trainer's jump at the end of a chorus, a ritardando, a tempo written in the song) had no single
place to live, and three accumulators reading a changing tempo at different moments would walk apart. The tempo is now a piecewise function of the frame:
a jump is a new segment, a ramp is a segment whose tempo changes linearly in time and then holds. A step is "the span of 0.25 beats (times the rate) that
starts here" asked of the map, so the drums, the bass at any rate and the chord rhythm stay on the same grid through a change, wherever each of them
happens to read it. Beats are the integral of tempo, a quadratic in the frame inside a segment, and `frameAt` is its stable root.

The ramp is linear in time because the page's ritardando is: it steps the tempo so that its square falls linearly with the beats (`_runEnding`,
'ritard'), and bpm squared linear in beats is bpm linear in time. For a stretch of constant tempo `span` is exactly the old expression, bit for bit,
so nothing changes until a tempo moves. A sequencer with no map keeps its own constant tempo (the tools and tests that never set one).

**Host.** One `TempoMap` shared by the three sequencers. Every tempo call the page makes (`seqSetTempo`, `seqBassSetTempo`, `seqChordSetTempo`, and the
tempo given at each start) is a jump at the render clock, and the same tempo again is not a new segment; `seqTempoRampTo:overMs:` (plugin
`seqTempoRamp`, page `_nsDrum.tempoRamp(bpm, ms)`) starts a ramp from the tempo now; `seqMirror` says the tempo at the clock as `tempo`. The walking line's
beat is the tempo at the moment it is scheduled (a ramp moves it a little inside one call).

**Measured.** `make -C native/modsynth tempotest && native/modsynth/tempotest`: a constant stretch is the old step length exactly (140 of 140 cases);
frames and beats are each other's inverse to 1e-10 frames through two jumps and two ramps, and beats agree with a numerical integral of the tempo; through
a ramp bpm squared is linear in the beats and bpm is linear in time; a step across a jump is exactly a quarter note; with a constant map the drums, the
bass and the chord rhythm step to the very same frames as without one (1244 of 1244); through a jump, a ritardando (120 to 66) and another jump, 440
steps of the drums, the bass at twice the speed and the chord rhythm are on one grid (worst 6.6e-8 frames) and every step is the map's own quarter beat.
Against the page: `tests/seq/chordrhythm.test.js` now changes `#bpm` while the page's scheduler runs (120, 90, 150 with swing; 100, 160, 70 with held
hits and ratchets) and gives the engine a jump at the first step the page scheduled after each change: 66 hits identical in time to 1e-5 of a frame, level,
length and hold (the jumps ignored fails both). The host test ramps 60 to 120 over 1.2 s: the steps close in monotonically from 12000 to 6000 frames,
the mirror says 60 then 120, no late edit. All the earlier drum, bass and chord tests are unchanged.

**Not done.** The page does not call the ramp (nothing in the app moves the tempo through the engine yet; the song loop will). A ramp is exact in the
engine, not the page's integer-rounded steps twice a beat, so the two ritardandi differ by those roundings. Not heard on device: checklist 23.

## Slice 4, piece 2 (6.9.9.9.9.4): song stepping

**What was built.** `native/modsynth/songcore.h` (+ `.cpp`): `SongScore` (sections of chords: bars, beats, eighths, rest, root, slash bass, tones, phrase lock; passes
and the follow flag per section; the meter's bar, swung Chart 8ths, snap, the capo) and `SongSequencer`, a port of the page's stepping: `_playLoopSlot` (a chord
starts: its window for the bass, `_blOnChord`, with `_songPeekNextSlot`'s next chord), `tickSongLoop` (the drums' bar lines counted against a chord's bars),
the timer path (a chord of beats or eighths, a chord with no drums to count, or snap off, ends one length after it began) and `_advanceLoopSlot` (the next chord;
at the end of a pass a queued Next/Prev, or the pass counted and the section left after its plays). It emits what the page hands the bass for each chord, a
`ChordWindow` (start, nominal end, rest, root, slash bass, next root, tones, lock) with where in the song it is, and the host pushes it into the bass sequencer's
timeline: the page stops calling `_blOnChord`. A chord's length is in beats on the tempo map (piece 1), so it follows a ritardando; the page measures it in
milliseconds at the tempo of the moment it starts (the same at a constant tempo).

**Two quirks of the page are kept, one is not.** The peek at the end of a section reads the section's old `follow` flag, not its pass count, so `nextPc` there can name
a chord the loop will not go to; the engine does the same, because the bass aims its approach note at it. A chord that began mid-bar (after chords of beats) is back on the
bar grid at the first line the drums announce, as a whole-bar chord counts lines after its own start. Not kept: with snap off and the drums playing, the page
advances twice a chord (its timer and the drums' lines both advance it: measured, a bar-long chord lasting half a second); the engine ends a chord by time there.
That is a page bug, left alone here, to be gone with the cutover.

**Page and host.** `window._songNativeScore()` exports the song (and refuses, with its reason, a practice loop, the trainer and an armed ending); a chord's lock is
found the way the bass finds it (`_blLockFor`, now also on `window`). Host: `seqSetSong`, `seqSongStartWithLeadMs:` (on the drums' next bar line when they run),
`seqSongStop`, `seqSongMove:`, `seqSongSetCapo:`, a `song` block in the mirror; the plugin and `window._nsSong` (`start(section, slot)`, `stop`, `move(1)`, `capo(n)`,
`mirror`). The song runs after the drums and before the bass on the host thread, which is how the bar lines reach it in the same pass. `songcore.cpp` is in the Xcode project.

**Measured.** `tests/seq/songstep.test.js` runs the page's own `startSongLoop`, `_playLoopSlot`, `tickSongLoop` and `_advanceLoopSlot` on a fake clock (its timers run
when the fake time reaches them, the drums are a stand-in announcing a bar line when it falls inside the look-ahead, Next/Prev and a key change arrive between
ticks) and `songtool` on the same song and ticks: 6 cases, 231 chords identical, each in start and window end (1e-5 of a frame), rest, root, slash bass, next root, tones,
lock and place in the song: whole-bar chords across two sections with passes and the peek quirk; chords of bars, beats, eighths, a bar and two beats, rests and a slash chord
with the drums; no drums with swung eighths; a queued Next and Prev around an empty section and a section that holds; starting at section 1 chord 2 with two key changes;
phrase locks. It fails with the peek reading plays instead of the flag, with a queued move ignored by the peek, with the chord's own start line counted, with a pass too many,
with swung eighths straight, without the capo on the root and without the locks. The host test steps a two-section song with the drums, takes a queued Next at the end
of the pass, gives the bass its windows and stops.

**Not done.** The chord itself (piece 3) and its comping (4): the engine steps the song and the bass follows it, but the chords still sound from the page. A chord tapped by
hand (a jump), the practice loop and trainer, the endings (piece 7). Marks the page ignores because its two clocks fire in the other order, within 0.12 s after a timed chord
ends, are counted by the engine. Not heard on device: checklist 24.

## Slice 4, piece 3 (6.9.9.9.9.7): the chord of a slot

**What was built.** The engine sounds the chords it steps. `native/modsynth/voicing.h` is a line-for-line port of how the page voices a chord: `smartVoiceLead`
(the voice leading, with its memory of the last chord), `chordVoicing` (the voicing the player chose: Close, Spread, Drop 2, Drop 3, Soul/R&B, Neo-soul, and Vary's
lap through them with its per-chord counts), `styledVoicing` and `jazzVoicing` (which ask the key's own tones: the mode's steps from the key, which moves with the capo),
`voiceIntervals` and `chordEngineEvent` (the notes, a slash chord's bass directly under the lowest tone). `songvoice.h` is `_playChartSlot2` + `playChord`: a rest
stops the chord that sounds (`stopAll`); any other chord is shifted by the live capo, voice-led (a slash chord's bass is the floor), voiced (the slot may carry its own
voicing), turned into notes and struck once, held or decaying: the comp "sustain" holds it flat for the whole slot, "as played" holds it and lets go of it `ring` beats
later (the Release knob) or, with no ring, into the next chord, every other style lets it decay by the Decay knob (cut by the Length buttons, and to 0.7 s with Strum
on and no length; the beat is the tempo map's at the chord's moment). With Wet/dry at the top it is the held pedal under the arp (the page's other branch). Chords
off: only the stop. The voice leading starts empty with the song, as the page's does after a key change. The song score carries all of this (a chord's voicing, hold and
ring; the song's voicing, Vary, VoiceLead, mode, knobs; the chord voice's kit) and `SongVoiceCfg.on` says whether the engine plays the chords or only steps.

**Chord player.** `ChordPlayer::stopAt(onset)` is `stopAll(atTime)` (a rest, Chords off, stopping the song); a negative `holdSec` is a held chord never let go of (the next
stop ends it); and a chord the bank cannot make still stops the one before, as the page does (it used to return first and leave two chords sounding).

**Page and host.** `window._songNativeScore({chords:true})` adds the above and refuses, with its reason in `chordWhy`, what the engine cannot sound yet: a sampled chord
voice (the guitar voices among them: their grips are not ported), a mõdSynth chord voice, chord glide, Pure tuning. `window._songChordPitches()` is the bank's
share: the recording of a chord is one pitch at a time and what a voicing picks depends on the chord before it, so it is a superset (every octave of every pitch class the
song uses, C1 to G6; with a styled voicing or Vary every pitch class, since they add tones the chart does not name; the sub's pitch; the held recording too when any chord
holds). `_nsSong.start()` records them (it reports `bank`), sends the score and starts; `_nsSong.chords = false` leaves the chords to the page; `_nsSong.capo(n)`
tops the bank up first. Host: the song's emit calls the voicer and the chord player (the same one the chord rhythm uses), the mirror's `song` block gains `voiced`, `rests`,
`voices`, `stops`, `releases`, `misses`, `refused`; starting the song resets the voice leading and points the player at the song's voice; stopping it stops the chord.
`voicing.h` and `songvoice.h` are in the Xcode project.

**Measured.** `tests/seq/songstep.test.js` now also runs the page's real `playChartSlot2` for every chord of the real loop and keeps its messages for the chord part
(stop, chord, release); the engine's action for the same chord (`songtool` prints it) must be the same: the notes with the slash bass first, the sub's note, the level,
the moment (1e-5 of a frame), decay (the length to 1e-12) or hold, and a release at exactly `ring` beats on. 36 cases (the 6 stepping ones and 30 voicing ones),
1,716 chords struck and 98 stops: Close; Spread with Strum on; Drop 2; Drop 3; Soul; Neo-soul in C minor, D dorian and G major; Vary on from Close, Drop 2 and Soul over 200 to 260
seconds (every type, then the next shape); VoiceLead off; As played with a ring, held on and tapped; chords with a voicing of their own in a Close song; two key changes
during Neo-soul; the pedal; Chords off; the song moved up and down by 3, 5, 7, 9, 12 and 24 semitones; a song with half-diminished, diminished and augmented chords,
major triads off the key, a chord twice running and slash chords with a high bass; and 7 songs of 48 to 120 random chords. Mutation checks (28, each by changing the port
and rebuilding the tool; 23 are caught): the test fails with the pull toward the centre changed, ties going to the last candidate, the first-chord shifts cut short, the half-diminished
ninth missing, the drop on the wrong voice, Vary's history one long, Vary's fresh flag gone (here and in the voicer), the lap length wrong, the slash bass not under the lowest
tone, Spread's seventh, the capo not moving the key, the 0.7 s cap, the ring in the wrong beat, the floor of a slash chord, the sub's note, the dominant's seventh and the
jazz ranking weights. Not caught, and why: a slash bass an octave off in the pedal branch (the bass is brought under the lowest tone whatever its octave: the same
chord), the top of the styled register at exactly 84 (the centre pull never chooses a placement that high), two octave shifts of equal cost in the styled register,
a span of exactly two octaves in the voice leading, and the level (`velScale(0)` is 1 for ever). The jazz weights were first missed by the hand-picked songs and are caught by
the seven random ones. `songvoice` through the host: `seqhosttest` plays a two-section song with a ring, a rest and a slash chord with no page and the
bank's chords: every chord voiced or a rest, 3 voices a triad, none missing, the rest and the next chord stop what rings, the ring lets go of its voices, stopping the song
stops the chord. The audio follows from the page's messages: `tests/seq/chordline.test.js` takes `SONG=drop2` (or `rnb`, `neosoul`, `open`) and builds its chord list
from the page's own `playChartSlot2` over six chords with two slash chords, then nulls the engine's chords against the page's recorded ones: 154 to 160 dB, Strum on and off,
decaying and held, worst 100 ms 147 to 152 dB, except one 100 ms window in the release tail of a held slash chord with a bass at MIDI 35 (a sub at 23): 65.7 dB there. The
same figure comes from the engine as it was before this piece, so it is the composer and not this change; the level in that window is far below the chord's.

**Not done.** The song's comping (piece 4): a chord struck by a rhythm is struck once, at its start; the rhythm's re-strikes and the page's per-hit re-voicing are not here.
The arp's chord (slice 3), glide, Pure tuning and sampled chord voices (refused with their reasons), a chord tapped by hand, the key change adding pitches the bank does not hold
(`_nsSong.capo` tops it up; a capo the page sends later counts misses, and the miss leaves a gap, not a wrong chord). The chord voice's recording is per pitch, 40 to 70 recordings for a
song (plain, and held when any chord holds): `_nsSong.start()` takes that long the first time. Not heard on device: checklist 25.

## Slice 4, piece 4 (6.9.9.9.9.9): the song's comping

**What was built.** The re-strikes of a chord's rhythm, after its first strike, now come from the engine. `SongVoicer` (`songvoice.h`) plans them when a chord starts (a port of
`_scheduleCompHits`) and plays them as they fall due (`flush`; the page's `_drainCompPending` and `_compRestrike`). A built-in rhythm lists its hits in eighths of a bar: every
bar of the slot, none that is the first strike, none past the end of a short bar, none within 10 ms of the slot's end. A drawn one is a loop of `steps` sixteenths from the
chord's start with a strength and a gate on each hit, ratchets between the sixteenths, its own swing or else the Feel's (on the eighths or the sixteenths, as the player set
it); its gate is held and let go of at the end of its length. Each hit is the chord struck again: voice-led from where it is (the same voicing, since its own is the nearest
and Vary only moves on a new chord), the live capo read when the hit plays, at the hit's level, decaying or gated; with Wet/dry at the top only a slash chord's bass is
struck again. A hit with Chords off only stops. Hits of the chord before are played before the next chord starts and the ones that would fall at or after it are dropped
(`_clearCompTimers`). The tempo map gives the positions, so a hit follows a ritardando; the page measures them in seconds at the tempo of the chord's start.

**Page and host.** The song score (`window._songNativeScore({chords:true})`, format 3) carries the table of rhythms the song uses (a built-in's hit positions, a drawn one's
loop, strengths, gates and swing), each chord's index into it, and the Feel's swing and which note value it falls on; `_songChordPitches` adds the held recording when a
rhythm has a gated hit. Host: the song's emit plays the previous chord's due hits, then the new chord, and after the song's run the hits due before the look-ahead; the mirror's
`song` block counts `hits`. Nothing else changed in the dev entry: `_nsSong.start()` now plays the comping too.

**Measured.** `tests/seq/songstep.test.js` runs the page's own `_scheduleCompHits` and `_compRestrike` inside its real loop, keeps every chord message it sends, and holds the
engine's hits to them one by one, in time order: notes (slash bass first), sub, level, moment (1e-5 of a frame), decay or hold, release at exactly the gate. 22 comp
cases and 5,256 hits (1,446 gated): every beat, Bossa, Gallop with Beats 1 and 3 and Clave and Push chord by chord, Eighths with Strum on and Length 2 beats, with Drop 2 and with Vary from Close and from
Drop 3 (a hit keeps its chord's grip), drawn rhythms with accents, ratchets and gates, of twelve sixteenths, with a swing of its own, following the Feel at 20 and at 45 (and
on the sixteenths), a triplet grid rhythm, a ratchet on a swung step followed by a hit on the next (their order swaps), drawn and built-in rhythms chord by chord with as played
and a hold between, 90 BPM with Length 1 beat, 3/4 bars, the pedal, Chords off, two key changes during Soul, no drums, 50 random chords with a rhythm from the list on each; chords
of two bars, one, half, beats and eighths, rests and slash chords. Mutation checks (19 changes to the port, each rebuilt): the test fails with the first position struck twice, a short
bar's late positions played, the bars counted down not up, the slot's last 10 ms not cut, the swing's own value ignored, the swing on the wrong note value, a gate half as long, a gate
ignored, a hit's level ignored, the pedal struck for every chord and not the slash ones, hits out of time order, the chord before's hits kept when the next starts, a position moved
by 0.0001 beat, and the voice leading not run for a hit; 15 caught. Not caught: the 10 ms cut, a hit exactly at the look-ahead, the loop's own 10 ms margin, and a slash bass an octave
off in a hit (the bass is brought under the lowest tone whatever its octave): none changes anything the page's songs reach. The host test plays a song whose chord has the rhythm
"every beat": three hits after its first strike, voiced from the bank with none missing.

**A page habit not kept.** The page drains the waiting hits at the END of its tick, after the drums have announced a bar line, so a hit that falls in the last tick before a chord
change is thrown away with the rest when the chord changes, and a hit at the very moment of the change is played or not by rounding. The engine plays every hit before the next chord
and none at or after it; the test holds the page to that (it plays the hits due before a chord starts as it starts) and leaves out of both lists a hit on the very frame a chord
starts. A hit lost in the last tick is audible only as a missing re-strike a few milliseconds before a chord change.

**Not done.** The arp's chord (slice 3), a chord tapped by hand, glide, Pure tuning, sampled voices, the practice loop and trainer, endings (piece 7). A chord whose rhythm
changes while it plays (the chart edited) keeps the hits it was planned with until the next chord. The hits are planned with the tempo of the moment the chord starts, as the page
does, except that a ramp in the tempo map moves them. Not heard on device: checklist 26.

## Slice 4, piece 5 (6.9.9.9.9.9.1): the engine asks the page for a line

**What was built.** The generators (the bass line's, with its dice) stay in the page, so while the engine plays the song it asks. Each time it starts a chord the host's mirror
(`song.ask`, with the top-level `sampleRate`) holds `[count, section, chord, pass, start, end, next section, next chord, key change]`, in frames: which chord sounds, its window
and where the song goes next (`SongSequencer::nextPlace`, the same peek the bass's next-root is made from). `window._songAnswer(ask, bassFirst, sr, pre)` is what the page's loop
does when it starts a chord (`_syncRegenAt`, `_syncPregenNext`), with the same generator, rules and order: with Bass+Mel Sync on and the bass on Follow off (Follow transposes the line
itself from the windows the engine makes; Free and a chord with nothing written ahead are the others) it (1) writes the line for the NEXT chord, unless that is a rest, over what will
sound (the live key change, a slash chord's bass leading), and holds it for the moment this chord ends (`_blPregenFor`, the page's `_blPregen` for a player that is not its own scheduler:
it borrows `blPlaying` for the call so the line goes to the pending buffer and the grid on screen and its pins are left alone); and (2) writes the line for THIS chord when nothing wrote it
ahead (the first of a run, or the peek was wrong: a queued move taken at the end of a pass), lands it, and returns the bass's score. The waiting line goes to the engine as
`seqBassPending` (6.9.9.9.9.1) with its moment counted from the bass line's first frame, and the page's own copy is dropped (`_blNativePendingTake`). The melody's line is slice 3.
`_nsSong.start()` now polls the mirror every 40 ms and answers (`answering: false` to leave the bass on its one line; `watch(on)`); stopping the song stops the polling.

**Measured.** `tests/seq/songask.test.js` runs `songtool` on a song and the bar lines the drums would announce (it prints the ask for every chord) and, for each ask, the page's own
two steps on the same state with the same dice (`Math.random` is seeded per chord): `_syncPregenNext` for the next chord's line and the line `_syncRegenAt` lands for a chord nothing
wrote ahead, against `_songAnswer`: the waiting line cell for cell and the frame it is held for, the bass score's grid. 6 songs: bar chords across two sections with passes, a rest and a slash
chord (29 asks, 24 lines written ahead, 5 for the chord itself); chords of half a bar and beats (28 asks); a queued Next whose peek says one place and the loop goes another (36 asks,
15 lines for the chord itself); Follow on and Free (nothing asked, 21 asks each); a key change of 3 (26 asks). Identical in every one. Mutation checks (12, in the page's answer): the moment
taken from the chord's start, no key change, always rewriting the chord's own line, no slash bass, a rest written for, the wrong place remembered, the Follow gate and the Sync gate gone, the
next chord taken from the current section, no landing, the borrowed `blPlaying` gone, the page's copy kept: all caught. Time: an answer takes 0.5 to 2 ms (measured in Chrome); the ask is in
the mirror a look-ahead (0.15 s) before the chord sounds and the poll is 40 ms, so the line is in the engine's hands 2.1 s before the next chord of a bar at 120 BPM and 0.71 s before the
next chord of a one-beat chord at 100 BPM; a chord shorter than about 0.2 s would not leave time (the page's own writing has the same limit). The host test (no page) checks the mirror's ask
for a two-section song and its sample rate.

**Not done, said plainly.** The melody's line (slice 3). In the background there is no page to answer, so a Follow-off line stops being rewritten and the last one goes on (the owner's
decision of 6.9.4, pending in the plan's list). A chart edited while the song plays answers over the page's new chart while the engine steps its old one. The melody's pregeneration,
`_syncLastChordToKey` after a key change by hand, and the chord tapped by hand are the page's. Not heard on device: checklist 27.

