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
| 3 | Native wrapper, audio, haptics | **iOS project committed** (`ios/`, Capacitor 8.5.2); native audio decided, plan below; `modEngine` door open: **chords** (4.9.9.6), the **live melody** (4.9.9.7), the **melody sequencer** (4.9.9.8), the **bass** (4.9.9.9) and the **arp** (4.9.9.9.1) through it; drums next |
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
   melody sequencer (4.9.9.8), bass (4.9.9.9), arp (4.9.9.9.1): done** —
   see "The door, as built" below. The drums are the last part.
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

### The door, as built (4.9.9.6 chords → 4.9.9.9.1 arp)

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
the gains it did before; `drum` covers the kit and Aux, which share the
drum engine. The drums take this `stop` already, ahead of their hits.

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

Still reaching past the door: the drum hits themselves (the drum engine,
`sqHitTrack` and its kit voices), the last step.

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

---

## Where to start

1. **`modEngine.send`** — every voice through one function on the web
   engine. Chords, the live melody, the melody sequencer, the bass and the
   arp are through (4.9.9.6–4.9.9.9.1); the drums are last. The precondition for native audio, so it goes first now that
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
