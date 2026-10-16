# 5.0 — architecture plan

The road from the web app to an App Store app, and the four pieces of work
that ride with it. **The product is the iPhone app.** The Vercel build keeps
deploying for as long as it is free to, but nothing is held back or
designed around it. Each section says what exists in `index.html` today,
what changes, and in what order. The order matters more than the details:
two of these pieces are already half-built, and two depend on decisions that
are cheaper to make before code than after.

| | piece | state |
|---|---|---|
| 1 | General chord model | **landed** — model, parser, playback reads exact notes, chord-sheet import (4.9.3) |
| 2 | MIDI Mapping Mode | designed below; builds on the CC-learn system already shipping |
| 3 | Native wrapper, audio, haptics | **iOS project committed** (`ios/`, Capacitor 8.5.2); native audio decided, plan below; `modEngine` door open: **chords** (4.9.9.6), the **live melody** (4.9.9.7), the **melody sequencer** (4.9.9.8), the **bass** (4.9.9.9), the **arp** (4.9.9.9.1), the **drum kit and Aux** (4.9.9.9.2), the **legacy Rhythm and the click** (4.9.9.9.3) through it; knobs steps 1–2 landed — `PARAMS`, the `state`/`param` messages (4.9.9.9.4), every voice reading its store (4.9.9.9.5), Mega patches (4.9.9.9.6), the mõdSynth panel (4.9.9.9.7); live controls and the sampler next |
| 4 | In-app purchase | designed below; `window.modBilling` already has the right shape |

**Versioning, as decided:** 5.0.0 is the native App Store release. Until then
every step ships as a 4.9.x increment (a fourth part where it helps, per the
numbering rule in CLAUDE.md).

---

## 1. The general chord model

### What was wrong

A slot is `{rootM, triadQ, type7, ext}`, and `getIntvs` builds its notes as
*triad + seventh + one `EXTS` key*. One key means one tension. A 13♭9 is two
(`13th` and `b9`), so it could only ever sound as one of them. Same for
7♯9♭13, 9♯11, 7♭9♯11 — anything with more than one alteration. The slot
also cannot name itself: a minor slot with `ext:'b9'` plays m7♭9 and draws
"Dm" + "b9".

### The model

```js
{ root: 0-11, ivs: [0, 4, 7, 10, 13, 21], bass: 0-11 | null }
```

`ivs` are semitones above the root, ascending and unique. They may pass the
octave (13 = ♭9, 21 = 13th), so a tension written as a 9th is voiced as one
rather than crushed against the root. A quality is just which numbers are in
the set; no symbol has to lose a note to fit.

All of it is in `index.html`, straight after `EXTS`, between the
`CHORD MODEL` banner and `END CHORD MODEL`:

| function | does |
|---|---|
| `parseChordSymbol(sym)` | any symbol → `{root, ivs, bass, sym}`, or `null` if any part of it is not understood |
| `chordFromSlot(slot)` | any slot → the model. Uses `slot.ivs` if the slot has them, otherwise reads it through `getIntvs` exactly as the engine does today |
| `chordEngineEvent(chord, rootM, opts)` | the model → the JSON message a sound engine receives (section 3) |
| `chordNotePc(name)` | `'F#'`, `'B♭'` → 0–11 |

### Why not Tonal.js

Tonal is a dictionary: it looks the quality up in a table of known chords.
A table has an edge — `C7b5b9#9b13` and `Calt` come back **empty**, and
`C7alt` comes back without its ♭9 or ♭13. That is the same failure the old
model had (a chord that quietly is not the chord you wrote), just moved.

So the parser reads a symbol the way a player does: a quality, a chord
number, then any number of alterations, adds and omits. Tonal is kept as the
**test oracle** instead of a dependency: `tests/chords/tonal-fixture.json`
holds every one of its 219 dictionary symbols with Tonal's notes, and the
parser agrees on 194 of them (184 exactly, 10 with the same notes in another
octave). The other 25 are listed in `tests/chords/parse.test.js` with a reason
each — Tonal is inconsistent with itself about ♭5 and ♭13, its `7alt` is not
the app's `alt`, and 7 named voicings (`Cquartal`, `Cphryg`…) are refused
rather than guessed. No runtime dependency, no bundle size, and the app stays
one file.

The parser is strict: a symbol it cannot read in full is refused, never
half-played.

### The dominant 11th (settled in 4.9.2.5)

A dominant 11 leaves out its major third: `C11` is `1 5 ♭7 9 11`. That is
how it is written and voiced nearly everywhere (and how Tonal reads it),
because the 11th is the 4th an octave up — with the third under it, the
chord is a sus chord and a major chord at once. The same notes are often
written **C9sus4** or **B♭/C**; all three are one chord. Until 4.9.2.5 the
quality menu kept the third, so the 11 you picked and the C11 you typed
differed. Now `EXTS['11th']` drops it on a dominant too. Minor 11ths and
maj7 11ths keep their thirds, as they do in common use.

### Migration, in steps that each ship on their own

1. **Done.** Model, parser, adapter and engine message, additive. Nothing
   calls them yet, so nothing sounds different.
2. **Done (4.9.3).** Every path that plays or draws a song slot reads
   `slotIvs(slot)`: the slot's own `ivs` if it has them, `getIntvs` exactly
   as before if not. Changing a slot's quality from the menu drops its `ivs`
   (`_slotForgetNotes`), so the menu always wins once used.
3. **Write `ivs` onto slots.** Chord-sheet import does this now (below). Still
   to do: a "type a chord" field in the chord builder:
   `parseChordSymbol` → `{rootM, ivs, label: sym, bassNote}`. The old fields
   are still filled in (nearest `triadQ`/`type7`) so the chord grid, colours,
   Nashville numbers and anything else that reads them keep working.
   Saved songs gain an optional field; old saves load unchanged.
4. **Spell from `ivs`.** `_slotExtSuffix` is the one place a chord's quality
   is spelled. It learns to name an interval set, so a slot whose `ext`
   cannot say what it is (the "Dm" + "b9" case) is named from its notes.
5. **Retire `EXTS`** as the source of truth: the quality menu writes `ivs`
   too, and `getIntvs` becomes a thin reader for old saves.

### Importing chord sheets (4.9.3)

File → **Import a chord sheet…** takes pasted text (or a text file) and
builds the chart: sections from `[Verse]`-style headers, chords in order,
`(x3)` repeats on a line, `[Chorus] (x2)` as a section's play count, the key
guessed from the chords, every chord one bar. ChordPro (`[G]lyrics`,
`{soc}`) works too. A line counts as chords only when every word on it parses,
so lyrics are never misread; lines that look like chords but don't parse are
listed in the preview. `tests/chords/sheet.test.js` runs it on two real
Ultimate Guitar exports, as text recognition reads them — misreads like
"Cc" for C and "BC" for B C are corrected on lines that already hold a clean
chord.

Three kinds of input, three readers:

| input | example | reader |
|---|---|---|
| text | pasted from a website, a `.txt`, ChordPro | `parseChordSheet` — **shipped** |
| a picture of a chord sheet | UG's PDF export, a photo of a songbook page | the phone's text recognition (Apple Vision, `VNRecognizeTextRequest`, on device, free) → the same parser. Needs the iOS app: a small Capacitor plugin returning the page's lines top to bottom |
| a lead sheet | Real Book page: chords over a staff, superscript qualities, 1st/2nd endings | text recognition is not enough — it cannot see bars, endings or which chord sits where on the staff, and it mangles stacked superscripts. This needs a vision model reading the page into a structured chart (sections, bars, chords per bar, endings), with every chord it returns validated by `parseChordSymbol` before it is used. Network and a per-page cost; a candidate for an add-on |

The parser already reads lead-sheet spelling (`DMI`, `GMI7`, `EMI7(♭5)`,
`B♭9`) and sections lettered `[A]` `[B]` `[C]`.

---

## 2. MIDI Mapping Mode

### What exists

Shipping now, around `index.html:32700`:

- `MIDI_CC_DESTS` — a table of mappable destinations: sliders (by element
  id), the mõdFX pad axes, mixer channels, mõdSynth parameters.
- `midiCCRoutes` — `{cc: destKey}`, saved under `modo-midi-cc`.
- Learn is two-step: pick a destination from a dropdown, then move a knob.
  The first CC that *moves* wins (a controller streaming resting values on
  connect cannot claim it).
- `_midiCCApply` drives a slider by setting it and dispatching its `input`
  event, so a mapping needs no per-parameter code.

That apply path is right and stays. What changes is how a target is chosen,
what a binding can hold, and what can be mapped.

### The mode

A **Map** toggle in the transport sheet. While it is on:

1. Every mappable control on screen gets an outline and a small badge with
   its current binding, if any. Playing, scrolling and switching tabs still
   work — you map the page you are looking at.
2. Tap a control → it is **armed** (pulsing outline). Taps on it do not
   change its value while armed.
3. Move a knob, press a pad or a key on any connected device → bound. The
   badge updates, a toast names the binding, the control disarms.
4. Tap an armed control again, or press Esc, to disarm. Long-press a bound
   control (or tap its badge) to clear its binding.
5. Map off → outlines go, bindings are live.

Incoming MIDI is intercepted *before* the normal router while something is
armed, so the key you press to bind does not also play a chord.

### Targets: one attribute, not one table

Today a destination has to be listed in `midiCCDests()` before it can be
mapped. With a mode that maps "whatever you tap", the list would have to
cover every control on screen. Instead, mappable elements say so:

```html
<input type="range" id="rev-mix" data-map="slider:rev-mix">
<button data-map="toggle:layer-drums">Drums</button>
<div   data-map="fx:xy">…</div>
```

`data-map` is `kind:key`. The kinds are the existing four (`slider`, `fx`,
`mix`, `ms`) plus `toggle` (layer switches, Hold, Song) and `trigger`
(chord pads, section next/prev, Capture). `MIDI_CC_DESTS` stays as the
catalogue for the existing dropdown and for labels, and becomes derived from
the attributes instead of the other way round.

mõdSynth parameters are already normalised 0–1 for MIDI in
`modsynth/params.js` (its header says so); its panel's knobs get `data-map="ms:<param id>"`
from the same schema, so every one of them is mappable with no list to keep.

### A binding

```js
{
  src:  { type: 'cc' | 'note' | 'pb' | 'at', ch: 0-15 | null, num: 0-127, port: id | null },
  dst:  'slider:rev-mix',            // the data-map string
  mode: 'abs' | 'rel' | 'toggle' | 'momentary',
  min: 0, max: 1,                    // range within the target, for "this knob sweeps the bottom half"
  takeover: 'jump' | 'pickup'
}
```

- **`ch` and `port`** — today CC 74 on channel 1 and CC 74 on channel 2 are
  the same mapping. A controller with banks sends both.
- **`mode`** — set from what was moved during learn: a CC → `abs`; a note
  or a CC that only ever sent 0/127 → `toggle` on a toggle target,
  `momentary` on a trigger; an endless encoder's 63/65 pattern → `rel`.
- **`takeover: 'pickup'`** — a hardware knob at 20% does not yank a value at
  80% the moment it is touched; it waits until it passes the current value.
  The default for faders, which is where jumps are audible.

### Storage

New key `modo-midi-map` (an array of bindings). On first load, if it does not
exist and `modo-midi-cc` does, each `{cc: destKey}` becomes a binding with
`ch: null, mode: 'abs'` — read-old-write-new, per CLAUDE.md. `modo-midi-cc`
is left in place, not renamed or deleted, so a rollback to 4.x still finds it.
Setups (`modo-setups`) may carry a map, so a controller layout travels with the
sound it was built for.

### Feedback out

When MIDI out is connected (`_moPort`), a bound toggle sends its state back
as the same note/CC, so a controller with LEDs shows what is on. Optional,
off by default, one line per apply.

---

## 3. Native wrapper, audio engine, haptics

### The seam already exists

`index.html` has a platform layer (`window.modStore`, `window.modPlatform`,
`window.modBilling`) whose contract is: a wrapper defines these *before* the
app script runs, and the web versions only fill in what it left out.
Capacitor fits that exactly. Everything below adds to that layer rather than
reaching into the app.

### Audio: native, decided

The app is going to the App Store and the complaint is the processor
overloading on older phones, so the sound moves to native code.

**What overloading actually is.** Audio is made in small chunks — 128
samples, about 3 milliseconds each — and every chunk has to be finished
before the speaker needs it. When the phone cannot finish in time you hear a
click, a crackle or a dropout. Today all of the synthesis is JavaScript
running inside the web view: the mõdSynth in an AudioWorklet
(`modsynth/dsp.js`, ~7,500 lines across `modsynth/`), and the built-in
voices, drums, mõdFX and master as Web Audio node graphs built in
`index.html` (about 50 oscillator, 45 filter, 20 sample-player, 13
waveshaper, 8 delay and 4 reverb creation sites). On an older phone that is
the part that does not finish in time. The same arithmetic in compiled C++,
with the CPU's vector instructions and no garbage collector to pause it, is
typically several times cheaper, and it runs at the highest priority iOS
gives anything.

**Engine choice: C++ DSP, hosted by AVAudioEngine. Not JUCE.**

- The DSP core is plain C++ with no Apple dependency. That matters twice:
  it is the fastest option, and it compiles and runs **on Linux**, so it can
  be tested here, sample by sample, against the JavaScript engine it
  replaces (below).
- A small Swift layer owns `AVAudioSession` (silent switch, phone calls,
  headphones, Bluetooth), runs the C++ in an `AVAudioSourceNode` /
  `AUAudioUnit` render callback, and talks to the web view through a
  Capacitor plugin.
- JUCE would also work, but it is built to own a whole app's UI and build
  system, which this app does not need, and its free tier is capped by
  revenue. Nothing here needs what it adds over AVAudioEngine. Revisit only
  if an AUv3 plugin for other DAWs becomes a goal.

**The UI stays in the web view.** Capacitor still hosts `index.html`; only
the sound leaves it. That keeps 50,000 lines of interface working while the
engine underneath is replaced.

**Proving each piece before it ships: null tests.** `tests/modsynth/`
already renders the mõdSynth offline in node. The C++ port renders the same
patch, the same notes, the same sample rate, and the two outputs are
compared sample by sample. A port that matches to within float rounding
sounds identical, by measurement rather than by ear — which is how every
one of the 302 factory patches can be checked, not a handful.

**The order:**

1. **One door for all sound (web).** Every voice goes through
   `modEngine.send(msg)` — today's Web Audio code behind it, unchanged.
   Pure refactor; nothing sounds different. Without it, there is no single
   place to swap the engine. **Chords (4.9.9.6), live melody (4.9.9.7),
   melody sequencer (4.9.9.8), bass (4.9.9.9), arp (4.9.9.9.1), drum kit
   and Aux (4.9.9.9.2), legacy Rhythm and click (4.9.9.9.3): done** — see
   "The door, as built" below. Every note, hit and click goes through the
   door now. The sampler pads and the knobs are the rest, and both need a
   decision first: "Proposed: knobs and samples" below.
2. **mõdSynth DSP in C++.** `modsynth/params.js` stays the single source of
   the parameter list; a generated header gives C++ the same indices. Null
   tested against `dsp.js`, patch by patch. All of this happens and is
   verified here, before any phone is involved.
3. **The iOS shell.** Capacitor project, the Swift audio host, the
   `modEngine` plugin. This step needs a Mac with Xcode to build and a phone
   to run — the code is written here, the build is yours.
4. **Parts move over one at a time:** chords first (least timing-critical),
   then melody, bass, arp, then the drums and the sampled instruments
   (`samples/`, 11 MB, decoded natively instead of in the web view).
   mõdFX, reverb and the master bus move with the last of them.
5. **The clock moves native.** The sequencer and arp currently schedule
   from JS timers with a lookahead. Once the sound is native, a hiccup on the
   web view's thread can still make a note late; moving the transport into
   the native engine (JS sends it the patterns, not the notes) ends that.
   Last, because it is the largest change to how the app works.

The web build keeps its Web Audio engine behind the same `modEngine` door
and keeps deploying, but it is not tested on old hardware or optimised
further.

### The message, wherever the engine is

Whatever ends up native, the app talks to it in one message shape, and the
first one exists now — `chordEngineEvent`:

```json
{ "v": 1, "kind": "chord", "id": 17, "part": "chord", "root": 60,
  "notes": [60, 64, 67, 70, 73, 81], "bass": 52,
  "vel": 0.8, "at": 12.345, "dur": null }
```

- Plain integers and seconds. Voicing, inversions, the slash bass and the
  chord's spelling are all settled in JS, so the engine is told *which notes*
  and never has to understand a 13♭9 — and cannot spell it differently from
  the chord on screen.
- `at` is on the engine's clock; `null` is "as soon as you can" (a live
  tap). `dur` is how long the chord rings after its attack; `null` is held
  until a release naming the same `id`.
- `root` is the chord's root as a MIDI note. Once a chord is inverted no
  note says which one is the root, and the Sub sits an octave under it.
- `notes` are in the order they are struck, which is **not always
  ascending**: smart voice leading drops a tone under the root (E minor
  arrives as `[64, 67, 59]`). The strum runs through them in that order and
  a doubled note is a doubled voice, so the engine plays them as given.
- `bass` is a slash or pedal note, voiced in the octave directly under the
  lowest chord tone, in the chord's own sound — not a separate instrument.
- `v` is the message version. A wrapper refuses a `v` it does not know.

The next steps make every voice go through one function:

```js
window.modEngine = window.modEngine || {
  send(msg) {},      // chord | note | release | param | transport
  now() {},          // the engine's clock, seconds
  provider: 'web'    // | 'native'
};
```

The web provider wraps today's Web Audio calls (`playChord`,
`playSlashChord`, the melody and bass voices). Once every sound goes through
`send`, the native provider takes over one part at a time, in the order
above.

### The door, as built (4.9.9.6 chords → 4.9.9.9.3 legacy Rhythm and click)

`window.modEngine` is in the platform layer next to `modStore` and
`modPlatform`, with the same contract: a wrapper defines it before the app
script runs, and the web versions fill in only what it left out. Besides
`send`, `now` and `provider` it has `web(msg)` — the Web Audio engine,
always there — so a native provider that owns only the chord part passes
everything else back to it.

The chord part (`part: 'chord'`):

| kind | fields | sent by |
|---|---|---|
| `chord` | `id root notes bass vel at dur` | `playChord` / `playSlashChord` (every chord: pads, keys, MIDI, the song loop, comp re-strikes, endings) |
| `release` | `id at` | `releaseSustainedChord` (finger up, `at: null`) and `_releaseChordAt` (an As played slot's known release) |
| `stop` | `at` | `stopAll` — the ~22 ms choke, every caller including the Stop button |
| `param` `bend` | `value` (cents) | the pitch wheel and C/V, when the bend scope is "all" |

The live melody (`part: 'mel'` — the strip, the on-screen and typed keys,
MIDI in; not the melody sequencer, which is `melgen`):

| kind | fields | sent by |
|---|---|---|
| `note` | `id note vel at dur y` | `playMelNote` (through `melPlayIn` for every gesture, and the Roll modifier) |
| `release` | `id at` | `releaseMelNote`; `bendStopContinuous` for a glide |
| `glide` | `id note hz vel y` | the bend strip once a gesture moves like a glissando |
| `param` `y` / `hz` | `id value` | the finger moving on a held note (`melNoteSetY`) or a glide |
| `param` `bend` | `value` (cents) | the pitch wheel and C/V |
| `param` `accent` | `value` (true/false) | the Control-key accent |

A note's `y` is the touch's height on the strip, 0–1, for the Touch Mod. A
glide's `note` is the strip note it began nearest, which is all the engine
needs to place it in the stereo field; its pitch is `hz`, already tuned.

The melody sequencer (`part: 'melgen'`) and the kill:

| kind | fields | sent by |
|---|---|---|
| `note` | `id note vel accent at dur` | `mlPlayNote` — every step the sequencer schedules ahead, and the roll's previews |
| `stop` | `at` | `hardKillAll`, once each for `arp`, `bass`, `melgen` and `drum` |

A sequencer note always has its `at` and `dur`: it is scheduled a
look-ahead ahead of the clock and nothing releases it. `vel` is the step's
level after humanising and before the accent, which travels as its own
flag. MIDI out and the `.mid` recorder hear the note on the app's side, and
when an external synth is playing the lane with local sound off the note
is never sent at all — that is the app's routing decision, not the
engine's.

`hardKillAll` (endings and Stop clear what the generators have already
committed) is a `stop` per part now, so an engine that owns one part can
be told to silence just that part. The kill registry records which part
each gain belongs to and stays one bounded list, so a kill reaches exactly
the gains it did before. The kit and Aux share the drum engine but are two
parts with two channels, `drum` and `auxperc`, and are killed as two.

The bass (`part: 'bass'`):

| kind | fields | sent by |
|---|---|---|
| `note` | `id note vel accent slide from at dur` | `blPlayNote` — the sequencer, walking lines, the roll's previews, and keys played by hand (`_blLiveOn`) |
| `release` | `at` | `_blLiveOff`, when the last key held by hand comes up |

The bass is monophonic: every note cuts the one before, so a `release`
names no id — it lets go of the voice. `slide` says this note's tail runs
on into the next; `from` is the MIDI note it glides in from, or `null`.
Where it glides from is the app's memory (`_blPrevFreq`, `_blPrevMidi`),
not the engine's: the sequencer already resets it at the top of each loop,
and it has to move on even for a note an external synth played instead.

One behaviour change: on a sampled bass whose samples were still loading,
the stand-in voice used to be reached by calling `blPlayNote` again, which
logged every such note to MIDI out and the `.mid` recorder twice
(measured: 6 notes, 12 log calls on main; 6 now). The engine now calls its
own voice for the stand-in.

The arp (`part: 'arp'`):

| kind | fields | sent by |
|---|---|---|
| `note` | `id note vel level pan at dur` | `scheduleArpNote` — every step whose gate is open |
| `chord` | `id notes at dur` (`root`, `bass` null, `vel` 1) | `scheduleArpBlock` — the Block pattern |

Everything that makes it a pattern is the app's: the gate pattern and its
accents, humanising, the velocity shape, the bounce, the ping-pong pan, the
clamp to 5 ms ahead. `vel` is how hard the step is struck (it also opens
the filter); `level` is where it sits in the pattern's dynamic shape, a
plain scale. A Block `chord` is its notes struck 12 ms apart, as given. The
readout under the arp is scheduled on the app's side too, and only while
its fader is up, as before.

The drum kit and Aux (`part: 'drum'` and `'auxperc'`):

| kind | fields | sent by |
|---|---|---|
| `hit` | `id kit lane vel accent pitch dyn at` | `sqHitTrack` — the grid (with its ratchets and ornaments), keys and pads, ending hits, the Shape sheet's audition, note input |

`kit` is an `SQM` key and `lane` the track's index in it, so a hit names
its drum in plain data; every track that reaches `sqHitTrack` is one of
`SQM`'s (a hit on one that is not would be dropped with a warning — none
is today). `pitch` is in semitones; `dyn` is how hard this stroke is within
its step (a flam's grace note, a ratchet's tail), which a layered kit picks
its recording by. The Drums switch, the time clamp and MIDI out / the
`.mid` recorder are the app's. The fader, the choke groups, a lane's Shape
and a sample dropped on a lane are the engine's.

The legacy Rhythm patterns (the three-voice beat from before the drum
sequencer, `scheduleRhythm` → `scheduleDrum`) send the same `hit`, from a
kit family of their own: `kit: 'rhythm/808'` (or `909`, `brush`,
`classic`), lane 0 kick, 1 snare, 2 hihat. They do not run through the
drum sequencer's engine, so they are not gated on its bus. The metronome
is `{kind: 'hit', part: 'click', id, accent, at}`, accent on the bar line.

`modEngine.ready(part)` answers for one part: on the web the drums are not
ready until their bus is built (`sqInitFX`), and a hit before then has
always been dropped — MIDI log included — and still is.

What moved to the app's side of the door, because it decides *what*
plays rather than how it sounds: the voicing (`chordVoicing`, Vary), the
slash bass, how long a chord rings (Length, Strum's shorter decay), pad
pressure → `vel`, and which chord is live. That last one was a generation
counter bumped inside the Web Audio code (`_sustainId`); it is now
`_chordLiveId`, and the app only sends a `release` for the chord actually
sounding, so an engine never has to judge whether a release is stale.
Capture's held-time hook (`_capOnRelease`) fires on that side too.

The melody works the same way: which notes are down is `_melLive` (pitch →
note id) and `_melGlideId` on the app's side, and Hold, Stop, Roll and
Accent ask that rather than the engine's `activeMelOscs`. One behaviour
change comes with it, on purpose: a note the engine was told not to sound
— the Mel fader at zero, or a lane playing an external synth with local
sound off — now still counts as down, so Hold-off and Stop release it.
Before, they asked the Web Audio voices, found none, and never sent the
external synth its note-off (measured: on main, Hold-off and Stop release
nothing in that case; now they release both notes).

The MIDI-out and MIDI-record layer (around `index.html:40000`) wraps
`playChord`, `stopAll`, `playMelNote`, `releaseMelNote` and others by
reassigning them. So the engine side never calls those public functions —
an engine calling `stopAll` would fire the wrapper a second time — and
those wrappers go on seeing exactly the calls they always did.

What stayed behind it (`_webChordOn`, `_webChordStop`,
`_webChordRelease`, `_webChordReleaseAt`): attack and release knobs, the
voice, the mixer channel, the strum spread, the Sub, the reverb pair,
glide. A native engine needs these as `param` messages before it can own
the chord part; today they are read from the sliders.

Verified, for each part, by recording every Web Audio call it makes. Chords: 925,171
of them across 2,688 gestures (7 voices × 6 voicings × strum on/off, with
and without glide, Vary, Length and the Sub; taps, scheduled hits, slash
chords, held and released pads, stale releases, stops, endings, song
slots) — with the audio clock frozen and `Math.random` seeded. Before and
after are identical, call for call, in the source and in `dist/`. A real
touch run on the pads sees each hold arrive as a `chord` with `dur: null`
and its lift as a `release` with the same id, and no chord voice built
outside `send`. Live melody: 21,215 calls over 480 gestures (6 voices,
Touch Mod on and off; taps, holds, retriggers, play-in, touch height,
accent, roll, the wheel in both scopes over a held chord, Hold latch,
Stop, and the strip in both modes driven through its own handlers —
snapped notes, wobble, glissandi, Hold, mode switches mid-gesture),
identical before and after in the source and `dist/`; the chord trace was
re-run on this build and is still identical. Real touch on the strip:
notes, releases, a glide and its `hz`/`y` moves all arrive as messages,
and no melody voice is built outside `send` (4 were, on main). Melody
sequencer: 3,810 calls over 179 gestures — the real sequencer started and
ticked on the frozen clock across 7 voices, the roll's previews, kills now
and scheduled, a kill with the bass running too, and the lane silenced for
an external synth. 177 identical; the 2 kills with several parts' notes in
flight make exactly the same calls, grouped by part instead of interleaved
(all at the same instant, so nothing audible moves). Playing in real time,
the sequencer builds its 7 voices inside `send`; on main all 7 were
outside it.

The probe answers `AudioParam.value` reads from the last value written or
scheduled. A real read comes from the audio thread, which the frozen clock
does not freeze, so it varied with wall time — that is what made a kill
look different between builds before it was taken out.

Bass: 9,731 calls over 272 gestures — the real sequencer across 11 voices
(the synth basses, acid, plucked, sampled while loading, and the shared
palette), the roll's previews, keys played by hand (held, legato over a
held key, letting the top go so it slides back, a quick tap), kills, and
the lane silenced for an external synth. All 272 identical, in the source
and `dist/`; the other three parts' traces were re-run and are unchanged.
Playing in real time, every bass voice is built inside `send`. What is
still built outside it during playback is the sample loader preparing
buffers (`_sampleShape`, on an OfflineAudioContext), not sound.

Arp: 76,116 calls over 1,075 gestures — the real arp scheduler on the
frozen clock across 7 voices × 9 patterns (Block included) × 4 gate
patterns, with every velocity shape, kills, a step scheduled in the past,
and the lane silenced for an external synth. All identical to 6 decimals,
source and `dist/`. At full precision 28 values differ in the last bit of
a double, because the step's gain is now multiplied as vel × level rather
than factor by factor; all 28 are the same once stored as the 32-bit float
an AudioParam holds, so the graph receives identical numbers. Every other
part's trace was re-run against this build's main and is identical. In
real time the arp's 50 voices are all built inside `send`; on main all 50
were outside it.

Drums: 41,678 calls over 2,124 gestures — three grooves on every kit
through the real scheduler, the Aux layer on, kills now and scheduled,
every lane of every kit struck by hand (plain, accented and pitched, on
Aux, with a stroke strength, scheduled in the past), the choke groups,
keys, an ending's hits, the Drums switch off (Aux still plays), and the
lane silenced for an external synth. 2,123 identical; the kill makes the
same calls grouped by part, at one instant. Every other part's trace was
re-run on this build against main: identical, source and `dist/`. Playing
in real time, all 197 drum voices are built inside `send`; on main all 197
were outside it.

Legacy Rhythm and click: 61 gestures (every legacy kit and drum, the
Drums switch off, the pattern scheduler on three patterns, the click
across bars), identical; every other part re-run on this build,
identical, source and `dist/`. In real time all 18 of their voices are
built inside `send`; on main all 18 were outside it.

Still reaching past the door, now that every note, hit and click goes
through it (and, since 4.9.9.9.7, every mõdSynth edit):

- **The sampler pads and clips** (`psStart`, `psStop`, `psFade`, the
  Sampler channel). Not one more message: the app decides what a tap does
  by reading the engine's live voices (`PS_LIVE`, 17 places), and a clip
  plays a buffer the user recorded or loaded — plus time-stretched and
  reversed renders of it — which a native engine would first have to be
  given. See the proposal below.
- **Bus preparation** called from app code (`sqInitFX`, `sqEnsureNoise`,
  `mlMG`, `blMG` before a preview, `fxInsertAll` when the mõdFX panel or a
  synth filter first appears, `buildReverb` before a recording). They build
  buses rather than sound, but they are Web Audio reached from outside the
  engine.

The knobs are through (4.9.9.9.4–4.9.9.9.8): every one is a `param`, and
the live ones are applied the moment they move — see step 4 below.

### Knobs and samples (agreed; steps 1–2 landed in 4.9.9.9.4–4.9.9.9.5)

**What the engine side reads today.** Seven sliders by element id
(`attack`, `decay`, `rev-mix`, `mel-attack`, `mel-decay`, `mel-rev`,
`bpm`), about seventeen pieces of app state (each part's voice — `wave`,
`melWave`, `mlWave`, `blWave`, `arpWave` — the Sub, Strum, the mõdFX
macro `fxCutoff`/`fxEnv`/`fxReso`/`fxWidth`/`fxTrim`, `blCutoff`, `blVol`,
`masterTune`), and behind those the voice builder (`makeVoice`, each
part's mõdSynth patch, the sample libraries), the mixer (`_cmx`), mõdFX,
the reverbs and the master bus. A native engine sees none of that.

**The rule for what goes where.** Two kinds of value, and every knob is
one or the other:

1. *Decided per note* — the app's, and already in the note: which notes,
   how hard, when, how long, the arp's pan, the bass's slide.
2. *Standing state of the instrument* — the engine's, sent as `param`
   whenever it changes, and as a whole snapshot when the engine starts or
   a setup, song or patch loads:

   ```json
   { "v": 1, "kind": "param", "part": "chord", "name": "attack", "value": 0.025 }
   { "v": 1, "kind": "state", "params": { "chord.attack": 0.025, "chord.voice": "pianoreal", "mix.bass.gain": 0.8, … } }
   ```

   The test for which kind: would a native engine sound wrong if it kept
   the last value it was told? Attack, voice, a fader, the reverb — no, so
   they are state. A note's velocity — yes, so it travels with the note.

**One table, like PARTS.** A `PARAMS` table names every parameter once
(`part.name`, range, default, where the web value lives today — an element
id or a getter). It is the single source of truth for three things that
would otherwise drift: the snapshot, the `param` messages, and MIDI
Mapping Mode (section 2), whose `data-map` targets are the same knobs.
Sending is one listener on the elements the table names, not a call in
every `oninput`.

**In steps that each ship on their own, verified by the same traces:**

1. **Done (4.9.9.9.4).** The table, the snapshot and the `param`
   messages. The web engine still reads the sliders, so nothing changes.

   As built, it differs from the sketch in one way, for the better: there
   is no listener per knob. Every message goes through the app's door,
   `modSend`, which first compares each `PARAMS` entry with what it last
   sent and sends whatever changed (the whole set, as `state`, before the
   first message of the session). So an engine always holds the state a
   note is meant to be played with, the same values the web voices read off
   the sliders at that instant, with no hook in any of the forty places a
   knob is set. Live controls a note does not wait for (a fader moving
   under a held chord) still need a listener; they come with step 4.

   `PARAMS` holds 45 entries: per part — chord attack, release, reverb,
   strum and spread, voice, Sub (on, sampled, level, wave), glide; melody
   attack, release, reverb, voice, Vel Sense (the glide's trim), the Touch
   Mod (on, destination, depth, rate, axis); the sequencer's, bass's and
   arp's voices; the bass's level, cutoff and resonance; the drum lanes'
   Shapes — and the mõdFX macro (cutoff, reso, env, drive, width, drift,
   trim), tuning, and each part's mixer level. The arp has no attack or
   reverb of its own and plays with the chord's, so it reads `chord.attack`
   and `chord.reverb`. State inside a closure (the bass's, the sequencer's
   voice, the drum Shapes) is read through a getter the closure exports
   (`window._blParams`, `_mlParams`, `_sqParams`).

   Verified: every trace identical to main, source and `dist/`. Across
   every scenario, at each of 7,775 messages the engine played, its store
   held exactly what the app held for all 45 entries (0 mismatches); every
   slider the engine side reads (measured by trapping `getElementById`
   inside `send`: the eight it reads) is in the table; params are sent only
   when something changed (in the chord run: 13 voice switches, 167 Strum
   toggles, 1 glide); and an object edited in place (a drum Shape, nested)
   is seen as a change and stored as a copy.

   What `PARAMS` does not hold yet: the globals cannot be trapped the way
   sliders can, and the voice builder (`makeVoice`) reaches far — each
   part's mõdSynth patch, the voice designer's settings, the sampled
   instruments' tables. Step 3 takes those, with its own measurement.
2. **Done (4.9.9.9.5), every part at once.** The web voices read their
   store (`_wp('chord.attack')`, `_wp('mix.bass')`…) instead of the sliders,
   flags and `_cmx`. Where a helper reads several values (`voiceFx`, the
   Touch Mod, the bass voice, the sequencer's voice), it takes local copies
   under the app's names so the body below is unchanged. The sampled bass's
   stand-in voice is now an argument (`_webBassVoice(msg, standIn)`) instead
   of swapping the global `blWave` around a recursive call.

   Traces matching is not enough here, because during a trace the store and
   the app hold equal values. So the proof is a **scramble**: while each
   engine call runs, every slider and flag `PARAMS` covers (the eight
   sliders, 22 globals, every mixer level, the bass's resonance, the drum
   Shapes) is set to a different value and restored after. A voice that
   still read the app would play differently. On the first run it caught
   one — held chords read `strumMode` directly to settle after the hit —
   and with that fixed, all eight scenarios are identical to main under the
   scramble (7,775 scrambled engine calls), in the source and `dist/`, as
   well as plain. Three bass controls and the sequencer's voice live in
   closures the probe cannot set from outside; a source scan of every
   engine-side function finds no remaining direct read of any `PARAMS`
   global, only the local copies.

   One behaviour change, a fix: the drum engine looked a lane's Shape up in
   the *focused* kit (`sqMach`), so while the Aux layer was focused a
   drum-layer hit could not find its lane and played unshaped. The engine
   now uses the kit the hit names. Measured: a shaped hit built 14 nodes
   with the drums focused and 9 with Aux focused on main; 14 both ways now.
3. Voices and patches: `chord.voice` is a voice name; a mõdSynth patch is
   one `param` whose value is the patch object, the shape
   `modsynth/params.js` already defines.

   **First half done (4.9.9.9.6).** Following `makeVoice` and its callees
   found four reads outside `PARAMS`: each part's **Mega** patch
   (`modSynthPatches` — the built-in synth that plays the `modsynth` voice
   while the mõdSynth worklet loads, or where it cannot run), and in
   `msxVoice` the tuning and the mixer level, which the scramble could not
   have caught because no trace plays the worklet. All are in the store
   now (`<part>.megaPatch`, compared by value). The fourth, `root` in the
   sampler's key voice, goes with the sampler. Verified: a new trace
   plays the Mega voice on every part across every factory preset, with
   patches edited between notes — identical to main plain and under the
   scramble (which now swaps each part's patch for another preset while the
   engine runs), source and `dist/`. As a control, the same scramble
   applied to main does change its output, so the test bites. Every other
   scenario re-run, plain and scrambled: identical.

   **Second half done (4.9.9.9.7): the mõdSynth panel.** Its knobs,
   motion lanes, mod matrix, patch picks, setup recall, Hear, its
   on-screen keyboard and the warm-up all reached the worklet engine
   directly. Now:

   - Each part's mõdSynth state is a `PARAMS` entry, `<part>.msx` — the
     same small object that is saved under `modo-msx`: the patch's name,
     the edits on top of it, the motion lanes. The engine resolves it
     against the patch library it carries itself (`modsynth/patches*.js`),
     so a native engine needs only the same files. Tempo is
     `transport.bpm`.
   - The panel **flushes** (`modParamsFlush`) instead of waiting for the
     next note, because a knob shapes a note that is already sounding. A
     batch (a whole matrix) flushes once at its end.
   - The engine applies a **change of patch whole** and **anything else as
     what changed** (`_webMsxState`): the knob that moved, the matrix
     rebuilt once if any row moved, a macro, a motion lane. It remembers
     what it applied (`MSX.applied`); nothing else writes an engine's
     values (the load governor sends its caps separately).
   - The panel's own sounds carry `voice: 'modsynth'` — they play the
     part's mõdSynth whatever voice the part is set to: Hear is a `chord`,
     a key is a `note` and its `release`, the warm-up is
     `{kind: 'prepare', part, voice: 'modsynth'}`.
   - Motion edits stay at full precision while the session runs (they are
     what the engine plays) and are rounded to three places only when
     saved, as they always were on disk.

   Verified at the boundary that becomes C++ — every message each part's
   worklet receives (`node.port.postMessage`) and each engine's values,
   matrix and motion — by driving the panel through 25 steps (patch picks,
   a knob of every type, one past its cap, a macro, a matrix row, a whole
   matrix, a motion step and a whole lane, the same value twice, a repick,
   a setup recall, Hear, the panel keyboard held and tapped), on main and
   on this build: the engines' state is identical after every step; Hear
   and the keyboard send identical notes; the saved `modo-msx` is
   byte-for-byte identical. The branch sends 142 worklet messages where
   main sent 312 — main re-sent unchanged values, wrote a whole matrix
   field by field rebuilding it 25 times, and re-applied every part whole
   on a recall. Every graph trace re-run: identical, source and `dist/`.

   One fix: a key tapped on the panel before its engine had finished
   loading started its note after the release had already gone, so it
   hung. Measured on main: `on 60` and no `off`; now nothing starts.
4. **Done (4.9.9.9.8): the live controls.** Measured first, by trapping
   every write to the audio graph (a parameter, a connection, a node, a
   curve, a worklet message) made outside the engine — outside `send`, or
   a timer or callback the engine started — while a probe moved every
   slider, select and toggle in the page, every mõdFX send and mix, the
   pad through all 24 patches, Hold, Clear, the synth filters, mute and
   solo, the master bus and the drive. On main: 53,821 such writes, from
   six places — the mõdFX chains (`fxApplyChannel`, from fifteen app
   functions), mute and solo gating the part buses (`_mixGateBuses`), the
   master drive (`applyDrive`), the master bus (`applyMasterBus`), the old
   drum-bus effects' reset on every tempo change (`sqApplyFX`), and the
   chord reverb rebuilt when its size is let go. On this build: none.

   Now each is state the app sends and the engine applies on arrival
   (`_webLiveParam`), not at the next note:

   | param | what | the engine does |
   |---|---|---|
   | `fx.modfx` | the whole mõdFX state: every part's sends, mix and synth filter, the pad (axes, targets, engaged, position, filter character, whether the let-go was a lift) and the release | re-applies exactly the chains the app used to: the targets for a pad move, the part for a send, all for anything else |
   | `master.on` `.vol` `.comp` `.rev` | the master bus | sets the bus |
   | `fx.drive` | the master drive | redraws the curve |
   | `mix.muteSolo` | mute and solo, together | gates each part's bus, so a held note obeys |
   | `mix.<part>` | each fader | stored; the web engine applies it per note, as it always has, and a native one can ride a held note |
   | `chord.reverbSize` | as last committed | rebuilds the reverb |
   | `<part>.voice` | (already a param) | re-applies the part's chain, which decides whether its synth filter runs |

   mõdFX is one param, not one per field, because a gesture often moves
   several fields at once (Clear resets the sends and lets go of the pad).
   Applied one field at a time, the chains would pass through a state that
   never existed, the new sends under the old pad, and a branch could be
   built or plugged in because of it. Mute and solo are one param for the
   same reason. The release tail after a lift is the engine's own now: it
   starts when the pad goes from engaged to not, with a lift's tail asked
   for, and ends on its own timer. The app says only whether that let-go
   was a lift (`tail`), so Clear, Escape and Hold-off stay as instant as
   they were. The store is filled before the first bus is built
   (`unlockAudio` flushes first), and anything built before it has arrived
   falls back to the app's own defaults (`_wpd`).

   Verified with a new scenario, 243 steps of mõdFX, mute and solo, the
   master bus, the drive, the reverb size and the tempo, with the chains'
   own timers (branch gates, idle checks, the hear poll, the release tail)
   run on the frozen clock. The traces are not equal line for line: main
   re-applied whole chains and re-gated every bus where nothing had
   changed (every pad move re-gated all eight buses at their current
   level). So the check is audible equivalence. Every parameter's
   automation is replayed (set, target, ramps, cancel) and the two builds'
   value curves are compared at every event and along every glide; the
   connection graph is compared after every step; and so are every node's
   curve, type and buffer. Result: all 960 parameters identical, the graph
   identical after all 243 steps, every curve identical. The two
   exceptions are dead nodes, the old drum bus's delay and distortion
   (connected to nothing that sounds), which are now parked once when they
   are built instead of on the sequencer's first start.

   The scramble covers these too. During every engine call and every
   engine timer, the app's mõdFX state, master, drive, mute and solo, the
   reverb-size and tempo sliders were all set to something else (809
   scrambled calls), and the output was identical. As a control, the same
   scramble on a copy with one engine read put back on the app (the pad's
   position) changed 102 parameters.

**Samples.** The bundled instruments (`samples/`) are files in the app, so
a native engine loads them itself, by name; nothing crosses the bridge.
User clips are different: they live in the page (IndexedDB) and have to be
handed over once, as an asset:

```json
{ "v": 1, "kind": "asset", "id": "smp_…", "type": "sample", "rate": 48000, "channels": 2, "data": "<base64 or a native file id>" }
```

after which a pad strike is `{kind: 'clip', part: 'sampler', id, asset,
start, end, loop, rate, at}`, with `release`/`stop` by id. Time-stretch and
reverse renders become the engine's job (the app sends tempo, pitch and
direction and the engine renders), and the app keeps its own record of
which pads are live from the messages it sent — a one-shot's end is known
from the clip's length — instead of reading `PS_LIVE`.

**Decided (owner, after 4.9.9.9.3):**

- *User samples live in native storage* on the phone, saved once and
  referred to by id — not handed across the bridge on every launch. Same
  reason `modStore` exists: iOS can clear a web view's storage, and these
  are people's own recordings.
- *The web build follows the same path*: its engine reads the same param
  store, so there is one engine contract and the traces keep proving it. It
  matters less than it sounds, because the web build is not the product
  (below).

### Haptics

Add one method to `modPlatform`, call it from the touch handlers, and let
the wrapper decide what it means:

```js
modPlatform.haptic(kind)   // 'pad' | 'kaoss' | 'bounce' | 'tick'
```

| kind | iOS | fired from |
|---|---|---|
| `pad` | `UIImpactFeedbackGenerator(.heavy)` | chord / drum pad `pointerdown` |
| `kaoss` | `UIImpactFeedbackGenerator(.light)` | mõdFX pad touch, throttled |
| `bounce` | `UINotificationFeedbackGenerator(.success)` | Bounce finished writing |
| `tick` | `UISelectionFeedbackGenerator` | detents on knobs, picker steps |

Two corrections to the brief:

- **"Success" is not an impact style.** It belongs to
  `UINotificationFeedbackGenerator`, a different generator. `@capacitor/haptics`
  exposes both (`Haptics.impact({style: Heavy})`, `Haptics.notification({type: Success})`).
- **Mac.** Capacitor targets iOS and Android, not macOS. A Mac build is either
  the iPad app running on Apple silicon or Mac Catalyst. In both, the
  `UIFeedbackGenerator` family does nothing on a trackpad, and
  `NSHapticFeedbackManager` is AppKit, so it needs a small AppKit bundle the
  Catalyst app loads. It only works on Force Touch trackpads, and only for
  alignment and level-change patterns, not impacts. Worth doing for `tick`;
  not a pad-hit feel.

Fire haptics on `pointerdown`, alongside the sound, never after it. Call
`prepare()` on the generator when a finger lands on the grid, so the first
hit is not late. The web fallback is `navigator.vibrate` where it exists
(Android Chrome; iOS Safari has none) and nothing otherwise.

---

## 4. In-app purchase: "add-on everything"

`window.modBilling` is already the right shape (`isPro`, `refresh`,
`purchase`, `restore`, `provider`), and `FREE_LIMITS` already lists what
free lacks. What changes is that **Pro is one boolean** and "add-on
everything" is many products:

```js
modBilling.has(productId)      // sync, from a cache, like isPro today
modBilling.products()          // [{id, title, price}] for the store sheet
modBilling.purchase(productId)
```

`FREE_LIMITS` keys map to product ids (`modfx` → `com.modriff.modfx`,
`samples` → a sound pack, `freeModes` → a scale pack…), and `modAllows(f)`
asks `has()` for the product that unlocks `f`. Keep a bundle product
("everything") that `has()` treats as owning all of them; an à-la-carte store
without one turns into a pricing complaint.

Native side: StoreKit 2 through a Capacitor plugin (RevenueCat's, or
`cordova-plugin-purchase`) behind the same `modBilling` contract. App Review
requires a visible **Restore Purchases** control (already in the contract,
guideline 3.1.1) and no link out to a web checkout. The web build keeps
granting everything, as it does today.

**The web build after the App Store release (owner's direction, not yet
built):** the web Web Audio path goes away once the app ships. The Vercel
build may stay up as the free version, with no way to upgrade from it —
the App Store is the only place to buy. That replaces "the web build keeps
granting everything" above once it is built; until then the web build is
unchanged.

---

## Where to start

1. **`modEngine.send`** — every voice through one function on the web
   engine. Every part is through (4.9.9.6–4.9.9.9.3), and every knob,
   live controls included (4.9.9.9.4–4.9.9.9.8); the sampler pads remain,
   proposed below. The precondition for native audio, so it goes first now that
   native is decided. Also what MIDI out of every part and stems need.
2. **mõdSynth DSP in C++, null tested** — the largest single piece of the
   native engine, and fully verifiable without a phone.
3. **Chord model steps 2–3** — the `getIntvs` call sites, then the "type a
   chord" field. Independent of audio; fits between the bigger steps.
4. **MIDI Mapping Mode** — independent; can run alongside any of the above.
5. **iOS shell** — the Capacitor project is in `ios/` (4.9.3), with the
   app icon and `.playback` audio (sound with the silent switch on). Still to
   come: the Swift audio host, haptics, IAP, text recognition for picture
   imports. Every build needs a Mac with Xcode: `npm install`, then
   `npm run ios` (builds `dist/`, syncs it into the project, opens Xcode).
6. **Remaining parts native, then the clock** — ships as 5.0.0.
