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
| 3 | Native wrapper, audio, haptics | **Runs on an iPhone** (`ios/`, Capacitor 8.5.2, Xcode 27): the C++ engine compiles into the target with `-ffp-contract=off`, the null test passes on the Mac, and the `ModEngine` plugin registers and takes messages — but the audio graph stops after 0.73 s and nothing has yet been heard from it ("The native host, and where it stops"). Native audio decided, plan below; `modEngine` door open: **chords** (4.9.9.6), the **live melody** (4.9.9.7), the **melody sequencer** (4.9.9.8), the **bass** (4.9.9.9), the **arp** (4.9.9.9.1), the **drum kit and Aux** (4.9.9.9.2), the **legacy Rhythm and the click** (4.9.9.9.3) through it; knobs steps 1–2 landed — `PARAMS`, the `state`/`param` messages (4.9.9.9.4), every voice reading its store (4.9.9.9.5), Mega patches (4.9.9.9.6), the mõdSynth panel (4.9.9.9.7); live controls and the sampler next. Patches a native engine cannot resolve by name — rolled, or saved under `modo-msx-user` — travel as values inside the same message (4.9.9.9.9.7, "Random patches and saved patches") |
| 4 | In-app purchase | designed below; `window.modBilling` already has the right shape |

**App Store submission** (listing text, privacy answers, review notes, screenshots, and the Xcode items still open) is in `docs/app-store.md`. The public site it links to (landing, support, privacy, terms) lives in its own repo at modriff.com.

**Versioning, as decided:** 5.0.0 is the native App Store release. Until then
every step ships as a 4.9.x increment (a further part where it helps, and a
trailing lowercase letter for a follow-up to the release just out, per the
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
3. **Done (4.9.9.9.9.3).** `ivs` are written onto slots. One function —
   `slotFromChordSymbol(sym, keyRoot, keyMode, nearM)` — turns a written
   chord into the slot fields that spell and sound it, and chord-sheet
   import, the **Chord** field at the top of the chord editor and (next) the
   iReal Pro import all go through it, so a typed `C13♭9` and an imported one
   are the same chord. The old fields are still filled in (nearest
   `triadQ`/`type7`, via `_legacyFromIvs`) so the chord grid, colours,
   Nashville numbers and anything else that reads them keep working; when the
   menu cannot hold the chord exactly, the field says so once, under itself.
   Saved songs gain an optional field; old saves load unchanged.

   Found on the way: the numeral was read off `triadQ`, and `EXTS` ignores
   `triadQ` whenever `type7` is set — so every imported m7 chord numeralled
   as a major "II". It is read from the notes now, half-diminished included
   (`iiø`, not `ii°`).
4. **Done (4.9.9.9.9.3).** `spellChord(root, ivs, bass, opts)` names an
   interval set, and `_slotNameParts` splits that into the base and the small
   type beside it. `_slotExtSuffix` is a thin reader of it. A slot whose
   `ext` cannot say what it is is named from its notes, so the "Dm" + "b9"
   case draws **Dm7♭9**, and "Am" + "9th" draws **Am9**.

   The test is a **round trip**: whatever `spellChord` returns, parsed again,
   must be the same notes. `tests/chords/spell.test.js` asserts it over all
   212 parseable symbols in the Tonal fixture and every quality the menu can
   build in all twelve roots. It caught 19 real bugs on the first run — the
   worst being that `C♯5` reads back as a C♯ power chord, because an
   accidental glues to the root letter with nothing between them.
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

### Importing from iReal Pro, and dropping the bundled standards (4.9.9.9.9.4)

**The Standards tab is gone.** The library's middle tab was 28 jazz standards'
changes written into `index.html` and shipped in the binary — someone else's
harmony in our product, and only ever growing by someone editing this file.
It is an **iReal Pro** tab now, and what a player sees there is what they put
there.

Two ways in, both of them the user's own file:

| input | how |
|---|---|
| one song | paste an `irealb://` link into the field at the top of the tab |
| a playlist | **Open file** reads the HTML file iReal Pro exports, which is a page of those links, and imports every song in it |

**Nothing is fetched from iReal's forum and no chord changes are bundled.**
Scraping a public playlist archive would put other people's transcriptions
back in the product, which is the thing this removal is getting rid of.

Charts are kept under `modo-ireal-songs` and load the way the standards did —
replace the song, or arrive as a new section, with the key question asked as
before. `parseIRealProLink(url)` and `modriffImportIReal(text)` are on
`window` for a native wrapper that catches `irealb://` itself: a PWA manifest
cannot register that scheme, so on iOS the share-sheet target and the URL
scheme are the app's, and they hand the link straight in.

The reader is **ireal-reader 1.3.1** (MIT, © Florin Alexandrescu), carried
inline because the app has no bundler. Changes from upstream are marked at
the call site: an iterative parser, anchored regexes, repeat signs that copy
a bar rather than aliasing it, and section marks kept so A A B A arrives as
four sections.

**Why this waited for the chord model.** It was written at 4.7.2 and reverted
the next commit, to be re-applied on top of sections 1 and 3 — because
`_irealQ` mapped a quality onto `triadQ`/`type7`/`ext`, which hold one
tension. **17 of iReal Pro's 58 published qualities arrived as a different
chord from the one on the chart**: `13b9` lost its thirteenth, `9sus` and
`13sus` lost the note they are named for, `-#5` lost its raised fifth, and
`7b5` came through with a natural fifth and a ♯11 and no flat five anywhere.
Chords now go through `_irealSymbol` → `parseChordSymbol` →
`slotFromChordSymbol` and carry real `ivs`; `_irealQ` stays as the fallback
for a symbol the parser will not read in full.
`tests/chords/ireal.test.js` holds the whole quality list and the count.

---

## 2. MIDI Mapping Mode

### Step 0: there is no Web MIDI on the phone (built 4.9.9.9.9.6, unbuilt on device)

Everything below assumes MIDI arrives. On the product — the iPhone app — it
does not, and this is not a gap that closes on its own:

**WebKit has never shipped Web MIDI and Apple has refused it over
fingerprinting.** Safari does not have it, every browser on iOS runs Safari's
engine so none of them have it, and Capacitor is a `WKWebView`, so the
packaged App Store build gets exactly the same `undefined` that mobile Safari
does. `initMidi` takes its `_midiErr='no-api'` branch and the pane says "Not
supported on this device." Shipping natively does not fix this by itself.

What does: **CoreMIDI, which iOS has in full** — USB class-compliant
controllers through the USB-C/Lightning adapter, Bluetooth LE MIDI, virtual
ports from other iOS apps, network MIDI.

As built:

- `ios/App/App/ModMidi/ModMidi.swift` — a Capacitor plugin holding a
  `MIDIClientRef`, an input port with every source connected, and an output
  port. `start`/`list` return the endpoints; `send` writes a packet;
  `openBluetooth` presents `CABTMIDICentralViewController`, which is the only
  way to pair BLE MIDI (there is no programmatic pairing, by design).
  CoreMIDI's own notify block drives `statechange`, so a cable in or out is
  not polled for. Registered in `ModRiffViewController` beside `ModEngine` —
  an app-target plugin is not discovered on its own.
- **The web side is `navigator.requestMIDIAccess`.** The shim in the platform
  layer wraps the plugin in the spec's own API, so `initMidi`,
  `_midiWireAll`, `onMidiMsg`, the port list, the CC learn and the mapping
  mode below all keep working unchanged — they stop seeing an empty API,
  which was the whole bug. It declines to install when a real implementation
  is present (desktop Chrome), and is simply absent when the plugin is not
  registered, in which case the pane's "not supported" is true.
- `NSBluetoothAlwaysUsageDescription` is in `Info.plist`. Without it iOS
  **terminates the app** the moment the pairing sheet starts scanning — not a
  prompt, not a refusal, a crash.
- The pane no longer says "Not supported on this device" full stop, which
  read as a dead end on the one device that supports MIDI best. It names
  which browsers have it and says the app connects directly.

**Verified without a Mac**, which is most of the point of the shim being
ordinary JavaScript: `tests/midi/make-fixture.mjs` injects a stand-in for the
plugin ahead of the app's script and simulates WebKit by deleting Chromium's
real `requestMIDIAccess`. Driven through it, a note-on plays the right chord,
a hot-plugged port is wired by the app's own `onstatechange` and plays, a
removed one stops, a handler assigned before the change survives on the port
that stayed, out goes to the right endpoint, and a send scheduled ahead is
held until it is due. Read the file's header before writing another probe:
the two traps in it (Chromium *has* Web MIDI; the service worker serves
`index.html` for every navigation and will quietly test the wrong page) each
cost an hour the first time.

**The Swift is unbuilt.** It is written against the CoreMIDI API and compiles
in principle, but no Mac has seen it: per CLAUDE.md it does not count until
Xcode says so on the owner's machine. What to look for on the first run is
`[ModMidi] plugin registered` in the device log — its absence is the
app-target registration problem, and it looks exactly like a device with no
MIDI.

Consequences worth stating plainly:

- The finished iPhone app is a **better** MIDI host than any browser.
- The **web build stays desktop-only** for MIDI (Chrome, Edge, Opera). That
  is permanent, and the pane says so rather than implying a fix is coming.

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
one of the 344 factory patches can be checked, not a handful.

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
   verified here, before any phone is involved. **Done** — `native/modsynth/`
   (see its README). A line-for-line port of `dsp.js`; the null test
   (`tests/modsynth/null.test.js`) records every message the JS processor
   receives, replays them into the C++ build, and compares: 516 runs (all
   344 factory patches, plus every eighth in all four voice modes at 44.1
   kHz with the pedal, CCs, caps, queue, all-off and panic), 24 million
   samples, **bit-identical**, with g++ and clang++. That takes three things:
   single precision exactly where the JS has typed arrays, V8's own fdlibm
   maths rather than the C library's (which differs in the last bit for one
   argument in ten), and no fused multiply-add (`-ffp-contract=off`, which
   the iOS target must set too). Ten seconds of a six-note chord on the
   heaviest unison patches renders 2.7–5.4× faster than in Node, before any
   SIMD. The FX rack stays Web Audio until step 4.
3. **The iOS shell.** Capacitor project, the Swift audio host, the
   `modEngine` plugin. This step needs a Mac with Xcode to build and a phone
   to run — the code is written here, the build is yours.

   **Half done, and the unfinished half is documented below ("The native
   host, and where it stops").** On the Mac: the app builds and runs on an
   iPhone, the C++ engine compiles into the target with `-ffp-contract=off`
   proved in the build log *and* in the generated instructions, the null test
   passes there (516/516 bit-identical, 24.2M samples, Apple clang on
   arm64), and the `ModEngine` plugin registers and takes messages. What does
   not work yet is the audio graph staying alive; no sound has come out of
   the native engine.
4. **Everything moves together.** This used to read "parts move over one at
   a time… mõdFX, reverb and the master bus move with the last of them",
   and that is wrong. It was tried: the chord part's mõdSynth played
   natively (4.9.9.9.7, branch `claude/native-audio-session`) and it worked
   — and sounded wrong, because a part cannot move on its own.

   Native audio leaves through AVAudioEngine and **cannot re-enter a
   WKWebView's AudioContext**. So the moment any part goes native it is
   outside everything that is still Web Audio and shared: its own mõdSynth
   FX rack (`modsynth/fx.js` — convolver, delays, shaper, filters, and the
   Space and Drive macros that drive them), its part bus, the mixer, mõdFX,
   the master reverb and the limiter. Measured on the phone: the macros did
   nothing, mõdFX barely touched the part, and a pad tap was thinner than
   the same patch auditioned in the editor, which plays through the rack.

   The smallest coherent unit to move is the whole audio output. The work
   is still done in provable pieces — the FX rack, then the shared chain,
   then the voices — but the *flip* is one commit, with no half-migrated
   instrument in between.

   What that means in size, counted: `modsynth/fx.js` is 677 lines, and
   `index.html` creates Web Audio nodes in 740 places (136 gains, 50
   oscillators, 45 filters, 20 sample players, 13 shapers, 8 delays, 4
   convolvers, 3 compressors, 5 panners).

   **And the proof gets weaker, which is worth knowing before it happens.**
   `dsp.js` could be matched bit for bit because it is plain JavaScript
   arithmetic — every operation is ours, which is what the null test rests
   on. `fx.js` is Web Audio *nodes*: the DSP is inside WebKit. Biquads,
   delays, gains and shaper curves are specified closely enough to match
   well; `DynamicsCompressorNode` is explicitly implementation-defined and
   has no answer to match. From the FX rack onward the standard is measured
   closeness — spectrum and envelope against recorded output, to a stated
   tolerance — not sample equality.
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

- **Recording.** The mic and the app tap that record a clip are Web Audio
  the app drives directly. They are input, not sound, and a native build
  records natively; they stay where they are until then. So does decoding
  a clip's bytes (`smpDecodeBytes`) and rendering the factory kit offline:
  both make the app's own copy of a clip, not sound.
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

**Done (4.9.9.9.9), close to that sketch.** Before: every pad strike,
release and re-pitch, every Warp and reverse render, the editor's preview
and the mõdFX pad's grain player built and drove Web Audio nodes from app
code, and the Sampler voice and drum lanes read the app's slots and
buffers from inside the engine. Now:

| message | what |
|---|---|
| `{kind:'asset', id, rate, channels, frames, buffer}` | a clip, handed over once, from the one place every clip enters (`smpBufSet`); `{…, drop:true}` when it goes. On the web the decoded buffer travels in the message, so nothing is copied. A native engine opens `id` from native storage instead |
| `{kind:'clip', id, asset, rev, stretch, from, to, rate, level, loop, loopA, loopB, at}` | a pad's strike. `loop` is `'window'` (Loop mode), `'hold'` (the clip's sustain loop) or null; `level` is the pad's, and the engine applies the Sampler fader |
| `{kind:'release', id, at, fade}` | let go of a strike, a preview or the grain player |
| `{kind:'param', id, name:'rate', value}` | re-pitch a sounding pad |
| `{kind:'prepare', asset, rev, stretch}` | render a Warp ratio; returns a promise that settles once the render exists. `{…, drop:true}` forgets one |
| `{kind:'note', id, slot, midi, dur, at, to:'master'}` | the editor's preview, with the slot carried whole (it may not be saved anywhere yet) |
| `{kind:'clip', id, grain:true, asset, slot}` | the mõdFX pad playing its clip. The engine's grain player reads the axes from its own copy of the pad (`fx.modfx`) |
| param `sampler.slots` | the Sampler voice slots (`v:<part>`) and drum lanes' clips (`d:<kit>:<lane>`), each with its clip's loudness normalisation |

The app keeps its own records, built from the messages it sent: which pads
are live (`PS_LIVE`, now ids and end times, not nodes; a one-shot is
cleared 20 ms after its end, where the source's `ended` used to do it),
which Warp renders exist (`PS_WARP_READY`), and which of them to let go
when there are more than 24. So a strike never asks the engine anything.
The renders themselves, the reversed copies and the voices are the
engine's. The app's own decoded copy of each clip (`SMP_BUF`) stays for
what the editor draws and measures: the waveform, the detected pitch, the
auto-loop points.

Verified the same way as the live controls. The outside-the-engine write
probe, extended to pads in every mode, reverse, Warp, re-pitch, a preview,
a Sampler voice and the grain pad: main 55,707 writes, this build none. A
new 182-step scenario covers six pads through One-shot, Gate and Loop,
reverse, re-pitch, Warp and Warp reversed (rendered on a real worker),
Sync, choke groups, Hold, Roll, quantize, previews, a Sampler voice, a
drum lane with a clip, and the grain pad through two patches and a mute. A
source's `ended` is fired on the probe's frozen clock in both builds,
since that is what the app's own end-time records replace. Result: every
parameter's curve identical to main except two kinds of difference, both
accounted for. Steps where the scenario set a voice directly carry the
chain re-apply that the voice param now triggers, at unchanged values.
In the grain-pad steps, the pad's state now reaches the engine before
the clip, so one analyser is created a node earlier and the ids after it
shift; with ids set aside those steps are identical, apart from main's
redundant re-gating. Under a scramble of every slot's settings, every
pad's settings and which buffer each clip id holds, during every engine
call and timer (314), the output is identical. As a control, a copy with
the Sampler voice reading the app's buffers again changed 7 steps.

Not built yet, because it is native code: saving a clip's bytes into native
storage when the app stores it (the IndexedDB write in `smpAddClip`), so a
native engine finds the asset by id. It goes with the native sampler.

**Decided (owner, after 4.9.9.9.3):**

- *User samples live in native storage* on the phone, saved once and
  referred to by id — not handed across the bridge on every launch. Same
  reason `modStore` exists: iOS can clear a web view's storage, and these
  are people's own recordings.
- *The web build follows the same path*: its engine reads the same param
  store, so there is one engine contract and the traces keep proving it. It
  matters less than it sounds, because the web build is not the product
  (below).

### Random patches and saved patches (4.9.9.9.9.7)

Two features of the mõdSynth panel, with one architectural consequence
between them.

**The dice rolls parameters now, not presets.** It used to pick another of
the 324 factory patches. `modsynth/random.js` rolls the parameters
themselves: a character first (Keys, Pad, Plucked, Bass, Lead, Bell,
Texture, biased per part), then the knobs inside that character's bands, in
*normalised* space so `params.js`'s own curves shape every draw. It starts
from the schema defaults and writes only what it rolls, so a parameter added
to `params.js` later keeps its default until somebody puts it in a character
on purpose. Its header says which parameters are held and why; the rules
that came out of rendering rolls rather than reading them are marked as
such, and `tests/modsynth/random.test.js` renders through the real `dsp.js`
and fails on a roll that is inaudible, infinite, clipping or still ringing
two seconds after note-off.

**A patch that the library does not have travels as numbers, not as a name.**
This is the part that constrains the rest. A part's mõdSynth state is
`{patch, vals, motion}` — the *name* of a library patch plus the edits on
top — and the engine, this one or a native one, resolves that name against
the patch library it carries itself (that is why the message is small; see
"The message, wherever the engine is"). A rolled patch, or one saved under
`modo-msx-user`, has no name any engine knows: that key lives on one phone.
So both write the whole parameter set into `vals`, as the diff against
whichever library patch the part already had, and keep a label beside it for
the panel to draw. Nothing about the message format, the engine or the
native side changes — a roll is an edit, as far as they are concerned. The
same fact gives Undo, setups and share links the new sounds for free, since
all three snapshot `MSX.state`.

The user bank itself is a *library*, like the sampler's clips: it is not in
the undo snapshot and does not ride in a share link. Loading one of its
patches is what lands in the snapshot.

### The native host, and where it stops

> **Resolved (4.9.9.9.9.7 – 4.9.9.9.9.7b, PR 252).** Everything below is the
> account of the first Mac build, kept for the measurements. The graph now
> stays up and the chord part's mõdSynth is heard from the C++ engine on the
> phone: `AppDelegate` owns the audio session (`.playback` with
> `.mixWithOthers`; the plugin never touches it), which was the "likely cause"
> listed first below. Space and Drive work (the rack is native, see "The
> effects rack, native"), and a note released before it begins no longer
> hangs. What is left is the larger piece: mõdFX, the mixer, the master reverb
> and the limiter are still Web Audio, so mõdFX does not reach a native
> mõdSynth part.

The first time any of this was built on a Mac. Everything from the page down
to the DSP works; the audio graph does not stay up. Written down because the
measurements cost an evening and should not be taken again.

**What is proved, on the phone:**

| | |
|---|---|
| C++ in the app target | `-ffp-contract=off` and `-std=c++17` in both response files, and `modsynth.o` holds no fused multiply-add. At `-O2` the same file compiles to 275 of them without the flag and 45 with it — and 45 is the count in the Makefile configuration the null test proves bit-identical, so the iOS build matches the configuration that was *measured*, not just the flag that was asked for |
| Null test, on this Mac | 516/516 bit-identical, 24,261,632 samples, Apple clang, arm64, Node 22 |
| Plugin registration | `capacitorDidLoad, bridge=yes, registered=yes` |
| JS → Swift → C++ | 262 parameters, right values at right indices; matrix and both motion lanes; `dropped=0`, `refused=0`, `failed=0` |
| Notes reaching the DSP | `notesOn=45` |
| **The graph staying alive** | **fails** |
| **Any sound** | **never achieved** |

**Three traps on the way in, each costing a round trip:**

1. **Capacitor does not find a plugin declared in the app target.** It finds
   the ones in Swift packages (its CLI writes them into `CapApp-SPM`). An
   app-target `CAPBridgedPlugin` must be handed over with
   `bridge.registerPluginType` from a `CAPBridgeViewController` subclass —
   and the subclass must be named where the window is actually built, which
   is `SceneDelegate`, not `Main.storyboard`. Setting the storyboard's class
   does nothing; `SceneDelegate` constructs the controller in code.
2. **`Capacitor.registerPlugin` does not exist in this app.** That is
   `@capacitor/core`'s JavaScript, and the app has no bundler, so only the
   injected bridge global is present. `Capacitor.Plugins` holds only what the
   bridge put there (CapacitorHttp, Console, WebView, CapacitorCookies,
   SystemBars, Haptics) because it is built from the `PluginHeaders` injected
   when the web view is configured — before `capacitorDidLoad` runs. The way
   in is `Capacitor.nativePromise('ModEngine', method, opts)`, which does not
   consult the headers.
3. **The worklet reconnects itself.** The mõdSynth engine sleeps after 14 s
   idle and `wake()` plugs its node back into its rack, undoing the
   disconnect that silences it. Both engines then play at once.

**Where it stops.** The `AVAudioEngine` renders **34,816 frames — 0.73 s at
48 kHz — and stops**, identically on every run. Deterministic, so not an
interruption. The likely cause is that the engine and the WKWebView's own
`AudioContext` share one `AVAudioSession` and WebKit reconfigures it.

A watchdog that restarts the engine is **the wrong fix** and was tried: it
restarted 17 times in half a minute, and the restarts are audible — crackles,
seconds of latency, the whole app sluggish. Worse than the bug.

It also breaks scheduling. A worklet `at` is an absolute frame on the *web*
clock; rebasing it onto the native engine needs both clocks ticking at the
same rate, and a stopping engine's does not. Measured: 45 notes applied, **0
voices ever sounding**, 1.4 ms of CPU per block spent walking an event queue
that never comes due. Dropping `at` (notes play at the next block boundary)
is the right trade for an A/B; sample accuracy returns at step 5, where the
native engine owns the clock and there is only one.

**What to try next, in order:**

1. Own the session once in `AppDelegate` — category and options set before
   the web view starts, `setActive` never called from the plugin — so WebKit's
   reconfiguration does not fight it. Cheapest, and the most likely cause.
2. Stop sharing: suspend the web `AudioContext` while the native engine owns
   a part. Removes the conflict by construction, but it means native owns
   everything, which is step 4, not an A/B.
3. `AUAudioUnit` instead of `AVAudioEngine`, for direct control of the session.

**And a note on the A/B itself.** Running both engines at once, in one
process, over one audio session, is the hardest configuration there is — and
it is not the configuration that ships. It may be better to prove the native
engine *alone* (native owns the chord part; the web engine for that part
genuinely shut down, not merely disconnected) and compare against a separate
web build by ear and by Instruments. Less convenient than a switch, far less
likely to fight itself.

### The effects rack, native (4.9.9.9.9.7a — Swift side unbuilt, C++ measured)

The first native chord part played, and Space did nothing. The reason is the
one the previous commit named: `modsynth/fx.js` is a Web Audio rack, and
native audio cannot pass through Web Audio. The Space and Drive macros are
matrix destinations that turn up the rack's reverb, delay and drive; with the
rack out of the path there was nothing for them to turn. mõdFX did nothing on
a native mõdSynth for the same reason (the part had no web bus to tap).

`native/modsynth/fxrack.{h,cpp}` is the rack in C++, one per part, run by
`ModEngineHost` right after that part's voices: drive, chorus, phaser, delay,
reverb, compressor, OTT, grit, stereo width, master volume. Its parameters are
`HOST_FX` in the generated `params_gen.h`, in `MS.HOST_PARAMS` order with the
arp's taken out, and the page sends them as `{t:'fx', i, v}` by wrapping
`eng.fx.set` (`_modNativeFxPost`). The matrix's five FX outputs are computed
by the engine that owns the LFOs and macros (`Processor::fxMods`) and handed
to the rack each block, rather than reported at meter rate as the web does.

What it is not: bit-identical. Web Audio's biquads, compressor and convolver
are the browser's, so `fxtest.cpp` measures behaviour and level instead —
the reverb's wet level against the convolver's normalised output on white
noise (within 3 dB; measured -1.7), the delay's echo time, a harmonic count
on every drive curve, that every parameter at random never blows up, and that
the whole rack costs about 2% of a core with everything on (a Mac, not a
phone). `fxwire.cpp` proves a macro wired to the reverb mix reaches the rack
through the engine and leaves a tail. `make -C native/modsynth fxcheck`.

Differences, on purpose: the reverb is a feedback delay network, not a
convolution (a 5-second convolver per part is too dear on a phone) — it will
sound smoother and less like noise, and needs an ear; Drive and Grit
oversample 2x; there is no limiter, so the rack ends in a soft clip above 0.9
until the native engine has a master bus.

**Hung notes (4.9.9.9.9.7b).** The page sends each note's on and its off
together, the on a little ahead (`msxVoice`). A Stop, or the next chord's
choke, can arrive in between: the release finds no voice, `unqueueOff` throws
away the off the page had scheduled, and the queued on then starts and has
nothing to end it. Reproduced in `native/modsynth/hangtest.cpp` (the old code
holds the note at a constant 0.138; three scenarios), fixed in `dsp.js` and
`modsynth.cpp` alike by dropping a queued on that a release or choke has
overtaken (`unqueueOn`). Found on the phone, as "stuck chord on Stop". The web
worklet had the same gap and is fixed with it; the null test is unchanged
(516/516).

Still not native: mõdFX, the mixer, the master reverb and the master limiter.
A part cannot move on its own; that remains the larger piece, designed next.

### The native mixer, mõdFX and master bus (design — nothing built yet)

**The problem, as measured on the phone.** A native part leaves through
AVAudioEngine, so it never touches the web's part bus. Everything that hangs
off that bus is therefore absent for it: the mixer fader and meter, the
part's stem, its mõdFX chain, the master drive, the bus reverb, the glue
compressor and the limiter. The rack (previous section) gave the part its own
Space and Drive; this section gives it the rest.

**The web graph being replaced, per part** (`index.html`): voice rack →
`_partDest` bus (unity gain; the tap for meter, stem and mõdFX) →
`fxBuildChain` (an `AudioWorklet` for stutter, reverse, warp, bit and rate
crush, grain and the ladder; then 2×2 biquad low/high-pass, parallel drive,
three-band isolator, two-formant "talk", rhythmic gate, tremolo, pan, ring
mod, a tempo-synced delay and a send reverb; a bypass path for when nothing
is on) → `_cmx` level (fader, mute and solo together) → master: drive →
bus reverb (2.4 s convolver) → glue compressor → limiter → master volume →
duck → speakers. The chord part enters the master through its own drive and
its own room pair, not the shared room.

**The shape, in the host.** One signal path per part slot, all in
`ModEngineHost`, in this order, each stage in plain C++ under
`native/modsynth/` and measured on the Mac like the rack:

```
Processor → FxRack (done) → part bus (peak/RMS tap, stem tap)
          → MixFx chain (mõdFX)  → strip (level, pan, mute/solo, smoothed)
          → sum → MasterBus: drive → bus reverb → glue comp → limiter
                  → volume → duck → AVAudioSourceNode
```

- **The strip is the page's own state, mirrored.** `_cmx(ch)` already folds
  fader, mute and solo into one number per part and the page already sends
  `mix.<part>`; the host applies it as a smoothed gain (8 ms one-pole, the
  rack's smoother) so a fader move never zippers. The page keeps owning the
  value; native only multiplies. Check at step N1 whether the web voices also
  scale by it at note time, and do not apply it twice.
- **Meters and stems come back by polling, not by streaming.** The host keeps
  per-part peak and RMS (cheap, already how `_peak` works), `stats` returns
  them, the page polls at the meter rate and feeds the existing strips. A
  stem bounce needs the sample data: see "What the page can no longer
  record", below.
- **mõdFX is a port, in two tiers.** `FX_PARAMS` has ~40 axes; they are not
  equally dear. Tier 1 is biquad and gain work that matches the browser by
  construction: the 2×2 cascaded low/high-pass, drive blend (reuse the rack's
  curves and `Os2`), tremolo, pan, ring mod, the tempo-synced delay, the send
  reverb (reuse the rack's FDN), gate patterns, isolator, talk. Tier 2 is the
  worklet — stutter, reverse, warp, crush, rate, grain, ladder — which is
  already plain per-sample JavaScript (`FX_WORKLET_SRC`) and ports nearly line
  for line, so it can be null-tested against that source, the way `dsp.js`
  was. Tier 2 is where "sample source" axes (a clip on the pad) stop: those
  read a sample buffer that lives in the page, and wait for the sampler to go
  native (steps 4 and 5).
- **The pad and the sends talk through one setter.** `fxSetSend`, the pad's
  axes and the per-part REV encoder all end at the chain's node parameters.
  Wrap that single point the way `eng.fx.set` was wrapped for the rack
  (`_modNativeFxPost`): the page posts `{t:'mfx', part, i, v}` and keeps the
  bundle's `_live` state for the UI. A pad gesture is a stream of values, so
  the host smooths every one (same 8 ms) and the queue carries only the
  latest per index per block.
- **The master bus is one instance, for the native parts only, until the
  flip.** Same stages as `buildMasterBus` (drive → bus reverb → glue → limiter
  → volume), reading the same four values the page already holds
  (`master.on/vol/comp/rev`). The bus reverb reuses the FDN with a 2.4 s
  setting; the chord's own room pair (which exists so a chord change can drop
  the old tail) is a second FDN instance on the chord slot, lifted by the
  same `_chordDamp` signal the page already computes.

**Two worlds until step 4 flips.** While drums, bass, melody and samples are
still Web Audio, the phone has two masters: the web one and the native one,
and the speaker gets their sum. That is wrong in two ways, and each needs a
decision rather than a default:

1. *The limiters do not see each other.* Each is correct alone and the sum
   can exceed either. Proposed: the native master leaves 3 dB of headroom
   while any web part is sounding, and the page tells it so (`master.web`).
   It goes away at the flip, when there is one master.
2. *What the page can no longer record.* The recorder and the stem bounce tap
   Web Audio nodes (`_masterOut`, each `_partBuses` entry); a native part is
   in neither. Options: (a) the host also taps its master and parts into a
   ring the page drains in `stats`-sized chunks and mixes into the WAV, or
   (b) record is disabled on a native part with a visible reason, until the
   flip. (a) is the right one and is also the only one that survives the flip
   (the host will own the recorder then); (b) is the cheap interim. **Open:
   which to build first.**

**Steps, each ends in a null or measurement test on the Mac, then the phone:**

| | | proof |
|---|---|---|
| N1 | Part bus, strip (level, mute/solo, pan), per-part peak/RMS back to the page's meters | a fader at −6 dB measures −6 dB at the host; solo silences the others, counted |
| N2 | Master bus: drive, bus reverb, glue, limiter, volume, with the two-worlds headroom | **Landed (4.9.9.9.9.8.6), headroom not built.** Measured against the browser's compressor and chain; reverb level and tail against the convolver |
| N3 | mõdFX tier 1, the setter wrap, smoothing | each stage's level and response against the web chain's, `fxtest`-style |
| N4 | mõdFX tier 2, the worklet port | null test against `FX_WORKLET_SRC` run offline in node |
| N5 | Capture of the native master and parts for recording and stems | **Landed (4.9.9.9.9.8.7), not heard on a phone.** The capture is sample-for-sample what the host rendered; a native click and a web click scheduled for one instant land within 1.4 ms in the WAV |

Where the host's capture is not running (an older build of the host, or it
failed to start) the recorder still says so rather than failing quietly: Bounce
toasts that the part is not captured, and the stem skip list names it
(`tests/stems/probe.js`, scenario C).

N1–N3 are enough for the owner's complaint: mõdFX reaching the native
mõdSynth, a fader that moves it, and the master glue on it. N4 adds the
glitch effects. N5 is the one that cannot wait for the flip if bounces
matter before it.

**N1 status (4.9.9.9.9.7.6t, branch `claude/native-strip`, Swift unbuilt).**
`native/modsynth/strip.h` is the strip (smoothed level, per-block RMS meter;
`striptest` measures −6 dB, a ramp not a click, exact silence on mute). The
host runs it after each part's rack; the page posts `_msxCal(part) * mix.<part>`
as `{t:'strip'}` when it changes, and the Mix meters read the host's `meters`
call through a stand-in analyser. Expect the native chord to be about 8 dB
quieter than it was: it now sits where the web chord does. Pan landed in
4.9.9.9.9.8.4 (below).

**Mixer pan, web side.** Each strip has a pan control (`sqMixPan`, saved as
`mixPan`, sent as `mix.pan`). The audio is a `StereoPannerNode` after the
part's mõdFX chain in `fxBuildChain`, behind a gain forced to two channels (so
centre is exactly the unpanned level) and followed by a constant-power
compensation gain. The meter taps upstream of it and stems stay dry and
centred.

**Mixer pan, native side (4.9.9.9.9.8.4, branch `claude/native-pan`, Swift
unbuilt).** `Strip::applyPan` in `strip.h` is the same law: Web Audio's
stereo-input panner (left of centre the right channel folds into the left and
is attenuated, right of centre the mirror) times
`1/sqrt(1+sin(|pan|*pi/2))`, smoothed with the strip's 8 ms one-pole on the
pan value (the web glides gain and pan separately at 15 ms; the steady state
is the same). It runs after the meter, because the web's meter taps upstream of
the pan, and centre touches nothing, so an unpanned strip is bit for bit the
signal. The host carries it as `{t:'strip', i:1, v}` beside the level's
`i:0`; `_modNativeStripSync` posts it from `mix.pan` (via `_mixPanOf`) only
when it changes, and forgets it with the level when a fresh engine attaches.
`striptest` measures it: centre is unity bit for bit, hard left and right put
a dual-mono 1.0 in one channel at sqrt(2), the law matches an independent
write-out of the web's at ten positions (worst difference 6e-8, float
rounding), dual mono keeps the centre's power at every position, and a step
from centre to hard right moves by at most 2 x the one-pole's step per sample.
The small change in `ModEngineHost.mm` (the `Strip` case and one call after
the meter) is not compiled until the owner builds it in Xcode.

**N1 landed (4.9.9.9.9.7.6t, PR 255); N3 first half is on branch
`claude/native-mixfx` (4.9.9.9.9.7.6v, unmerged, Swift unbuilt).** The order
changed from the table: mõdFX came before the master bus, because it is what
the owner is missing on a native chord and the master bus changes the level of
everything.

*What N3 is.* `native/modsynth/mixfx.{h,cpp}` is `fxBuildChain`'s signal path
in C++ — two low-pass and two high-pass biquads, the parallel drive on the 2x
oversampler, the isolator, the talk filter, gate gain, tremolo, pan, ring mod,
the delay and reverb sends, and the Mix of chain against the clean part — and
`dspkit.h` holds the primitives it shares with the effects rack (moved out of
`fxrack.cpp` unchanged). The host runs it after the strip, and the meter now
reads after it, as the web's does.

*How the page drives it.* It does not re-implement the pad. `fxApplyChannel`
already resolves, from the sends, the pad and the release, what every node is
at; it now also fills a small object from those same variables and posts the
ones that moved as `{t:'mfx', i, v}` (`_modNativeMfxSync`, `MFX_PARAMS`; the
order is held to the C++ enum by `tests/modsynth/mixfx-order.test.js`). One
decision, two places it lands. A part the native engine plays has no web bus
to listen to, so `_fxPartHeard` says yes for it; without that the chain would
drop out a second and a half into every pad gesture.

*Measured* (`mixfxtest`): neutral chain flat to 0.2 dB with the two halves of
the Mix aligned, 24 dB/octave on both filters, drive adds odd harmonics and
holds level within 0.3 dB, the isolator and talk filter pick their bands, a
delay echo lands within a sample, the reverb tail is gone by 4 s, 60 random
settings with knobs moved mid-run stay finite, about 0.6% of a core with
everything on (a Mac). Page side, in a browser with a stand-in native plugin:
the resting state posts 32 correct values, and moving the chord's delay,
drive and reverb sends posts the values `fxApplyChannel` computes.

*N4, the worklet effects (4.9.9.9.9.7.6v).* Stutter, reverse, time warp, bit
and rate crush, the grain shifter and the Moog and MS-20 ladders are
`native/modsynth/modfxproc.cpp`, a line-for-line port of `ModFxProc`, the
worklet in `FX_WORKLET_SRC`. Unlike the rest of the chain this is plain
arithmetic in the page, so it is held to the JavaScript the way `dsp.js` is:
`tests/modsynth/modfxproc.test.js` runs the real worklet source out of
`index.html` and `wkrender` on the same input and the same parameter changes,
52 runs (every effect alone, together, and 40 random schedules), and every
output sample is identical. `MixFx` runs it first in the chain, in the
browser's 128-frame blocks, and `fxApplyChannel` fills the eleven values it
needs from the same variables that set the worklet's own parameters.

*Not in it yet:* gate patterns (the page ducks the base gate for them; the
native chain leaves the base alone), and the sample-source axes, which read a
clip held in the page. Those pad axes do nothing on a native part.

**N2 landed (4.9.9.9.9.8.6, Swift built for the simulator, not yet heard on a
phone).** `native/modsynth/master.{h,cpp}` is `buildMasterBus` in C++: drive,
the bus room, the glue compressor, the limiter, the volume. `ModEngineHost`
runs every part's output through it before the speaker, so the native chord is
no longer ~8 dB hotter than the web's and no longer bypasses the glue.

*Two ways in, as on the web.* Everything but the chord part enters through the
drive and the bus room; the chord part has its own drive and goes straight to
the glue, because its room is its own (natively, the effects rack's reverb).
`kDirectPart` in the host says which. When more parts go native they are
"room" parts by default, which is what they are on the web.

*The page decides, the bus applies.* `_masterSettings()` returns the finished
numbers (volume, both thresholds and ratios, the room send; bypass is neutral
settings, not a rewire), `_driveOutGain()` the drive's makeup. The web nodes
and `_modNativeMasterSync` both read them, so the two cannot drift; the
parameter order is held by `tests/modsynth/master-order.test.js`. Sent only
when they move, handed over whole when the chord attaches, and applied by the
host without needing a live part.

*The compressor is a port, and it is measured against the browser.*
`DynamicsCompressorNode` is implementation-defined (above), but the algorithm
WebKit and Blink share is not a secret: a soft-knee curve found by bisection,
automatic make-up of 0.6 of the reduction at 0 dBFS, a detector averaged
instantly down and 2.5 ms back up, a target gain every 32 frames with a
four-point adaptive release, the asin/sin warp, and 6 ms of look-ahead.
`tests/modsynth/master-ref.html` builds the real graph on an
`OfflineAudioContext` and records a level every 10 ms for eight cases (glue,
limiter, both, bypass, drive, three glue amounts); `master-ref.json` is that
recording, committed. `native/modsynth/mastertest` renders the same stimulus.
Result, 96 checks: mean error 0.01 dB over 4.7 s of every dynamics case, the
worst window under 1 dB, peaks within 1 dB, every step's level within 0.15 dB.
With the drive on, the window-to-window level ripples by up to 2 dB (the two
oversamplers' filters differ and the chord's notes beat through the curve), and
the average per step is still within 0.01 dB. The recording was made in
Chromium (Blink); the phone's web view is WebKit, whose compressor is the
same code at the time Blink forked. If the phone ever disagrees, record the
page there (the header says how) and the test will say by how much.

The first 120 ms is not compared: an offline compressor starts with its
detector at zero and fades in. The master bus has been running in silence
long before anything plays, so that is not behaviour to copy.

*The room is a network, fitted to the recording, not to the impulse.* The
first fit pinned the time the convolver's impulse takes to reach -60 dB
(2.2 s) and left the network 12 dB under the convolver a second into the tail:
a convolver with this impulse falls slowly and then collapses where the
impulse ends, a network falls at one rate. RT60 3.4 s follows the recording
within about 1 dB for the first 1.6 s after the input stops, and the level on
steady noise within 0.01 dB (`MASTER_ROOM_RT60`, `MASTER_ROOM_TRIM_DB`). Past
that it rings on where the convolver stops, 27 dB or more down; at the default
5% send the whole room is 34 dB under the mix. The network moved from
`mixfx.cpp` into `dspkit.h` for this; mõdFX's send reverb is the same code with
the same numbers (`mixfxtest` output is unchanged, timing lines aside).

Also checked: 20 s of +6 dBFS noise through random settings moved every few
blocks, at block sizes that are not the browser's, stays finite and bounded,
and costs about 1% of a core on this Mac with everything on.

*Still open, and now sharper:*

- **Headroom between the two masters.** While any part is Web Audio the speaker
  gets the sum of two limiters. Proposed above (`master.web`, 3 dB); not built.
  It disappears at the flip.
- **N5, capture.** Landed in 4.9.9.9.9.8.7 (below).
- The native master has no meter yet (`takeRms` exists; nothing reads it). The
  Mix screen's master meter reads the web master.
- **The ear.** The room, the oversampled drive and the compressor have been
  judged by number. Listen to the native chord with the glue and the room up.

**N5 landed (4.9.9.9.9.8.7; Swift built for the simulator, not run on a phone).**
Bounce and stems now hear the native engine.

- *The host copies, the page drains.* `native/modsynth/capture.h` is a one-way
  ring (single writer on the render thread, single reader under the host's
  control lock; the writer never waits). The host keeps one per stream: the
  master after volume (what `_masterOut` is for the web tap) and each part's own
  bus after strip, mõdFX and pan (what `_partBuses` is for a web stem). Rings
  are 2^19 frames (10.9 s, 4 MB a stream), built the first time they are asked
  for and kept, so the render thread never frees one it may be writing. The
  plugin's `captureStart({mask})` / `captureRead()` / `captureStop()` carry
  them; samples cross the bridge as base64 float32, left then right.
- *A reader that falls behind loses the oldest audio, and says so.* Every block
  comes back with the engine frame it was rendered at and a count of frames lost
  before it, so a gap in the file is a gap, not a splice. The page puts it in the
  toast ("dropped N ms"). `capturetest` races a writer thread against a sleeping
  reader on a 2048-frame ring for 6M frames: none torn, none out of order, every
  frame read or counted lost (it found a real flaw on the way: the tear check
  has to look at what the writer has *begun*, not what it has published).
- *One timeline.* The web taps stamp blocks with the AudioContext frame. The
  host cannot, so the host reports where its frame 0 sits on the wall clock
  (`originMs`, the running median over its render blocks: see the correction
  below), and the page pairs `ctx.currentTime` with the wall clock, taking
  the largest ctx-minus-wall seen in the first second (currentTime moves a
  buffer at a time and never runs ahead; one reading was off by up to 7 ms,
  the dense maximum is within about 1 ms). That is the pairing note scheduling
  already runs on (`_modNativeAtRel`). Both clocks run off the device's, so the
  offset holds for the rest of the take. Placement happens once, at Stop.
- *Measured.* `hosttest` builds the real `ModEngineHost.mm` on the Mac: the
  master capture is exactly what `renderInto` returned, a stem added mid-take
  starts when it was asked for without restarting the master, a 12 s lag
  reports frames read + lost = frames rendered, Stop stops, the next take starts
  clean. Probe scenario H (stand-in host, Chrome): a native click and a web click
  due at one wall-clock instant land 0.3–1.4 ms apart in the mix over five runs,
  and the native chord gets its own stem.
- *What it does not settle.* Whether native and web are aligned *as heard* on
  the phone: the recorder aligns render time to render time, as note scheduling
  does, so if the two engines' output latencies differ the live sound differs
  from the file by that. Not measurable here. A stem take with many native parts
  is a few MB/s over the bridge; unmeasured on a phone.

**N5 correction (4.9.9.9.9.8.7b, 7c): the native chord was 31 ms, then 46 ms,
early in a real bounce.** The first phone bounce (`modo-session 7`) had every
stem and the mix whole (8 files, 50.29 s each, no dropouts) and the native
chord in its own stem from when it was played. Measured against the `.mid` the
same take wrote (`tests/stems/bounce-check.py`): web parts within a few ms of
the log (kicks -2.7, melody -2.4, arp +3.9, bass +7.6 ms), the native chord at
-31 ms with a middle half 2 ms wide: a constant, not jitter.

*First guess, wrong (7b).* The host's origin was the minimum of block
wall-minus-frame ("a callback can start late, never early"); 7b made it a
running median (`PhaseTracker`, which does track outliers: 99.87 against 100
where the earliest block says 68.9). The next phone bounce, from 7b (the WAV's
tag says so), had the chord at **-46 ms**. Different number, same kind of error:
the estimator was never the whole story.

*What it is.* A note is placed at its block's frame plus its wait, using the
wall time of the block that *drained* it (`applyMessage`). Working the placement
through, a note lands at `T + lag + (origin - off_d)`, `off_d` being the drain
block's phase, `lag` the web clock's (up to a render quantum). Messages are
drained by the first callback after they arrive, and with bursty callbacks that
is usually the one after a gap: blocks that place notes are not a sample of all
blocks, so no average over all blocks (minimum or median) is `off_d`, and the
error moves with the cadence (-31, then -46).

*The fix.* Measure it: the host averages `off_d - origin` over the note-ons it
actually placed (`drainMs`), reports it with `originMs`, and the page places
native audio at `origin + drainMs`. It is exact whatever the origin estimator
is. `hosttest` reproduces the mechanism with callbacks in bursts of 16 blocks:
origin-only error -19.1 ms, with `drainMs` (+20.9) +1.8 ms, against +2.4 ms on a
smooth cadence. Live placement is not touched: it is what the owner has been
listening to, and whether it is early *as heard* depends on the two engines'
output latencies, which are not measurable from here. The file now follows the
MIDI grid, so stems and `.mid` line up in a DAW. Run `bounce-check.py` on the
next bounce: the chord should read with the web parts.

**N5, still open (4.9.9.9.9.8.7c, 7d): the native chord is 48 ms early *in the
file*.** The 7c bounce (`modo-session 8`, 129 s, version tag 7c) read the chord
at **-47.8 ms** against the `.mid`, in every 20 s stretch from the start
(-51.6, -48.1, -47.0, -48.3, -47.3, -47.7): systemic, not backgrounding. The
drain-phase correction above changed nothing visible (-46.3 before), so it was
not the cause, or `drainMs` was near zero on the phone. Web parts: bass +7.2,
arp -0.6, kicks -3.1 then +12.6 and melody -0.8 then +7 from about 60 s (a step
in the two step-sequencer parts and not in the arp: probably something changed
in the take, not the capture). What is not known is whether the *render* of the
native chord is early (live would then be early too, by that plus the engines'
latency difference, and the owner finds it sounds right) or my mapping of host
frames onto the web clock is biased by a constant. Both read the same in a file.
7d stops guessing: messages are stamped with `Date.now()` (the host's own
clock, where `performance.timeOrigin + now()` is a different one that could
disagree by a constant, which would make notes early by exactly that), and a
bounce with native capture on writes `<name>-capture-report.txt` beside the
audio: the web clock pairing, origin, drain phase, the two page clocks' skew,
`baseLatency`/`outputLatency`, and the host's count of stamped / unstamped /
unscheduled note-ons, their mean wait and lead, and the callback sizes. The
next bounce's report names the cause. `bounce-check.py --by-time` splits a
take by 20 s.

**Warm-up was audible (4.9.9.9.9.8.7a).** `ensurePart` published a part to the
render thread and the plugin then warmed it up, which plays sixteen notes into
it. The engine is already running by then, so every launch started with a burst
of noise (`warmtest`: peak 0.5-0.65 for about 60 ms, 5 runs of 5) and two
threads driving one processor and one pair of scratch buffers. `warmUpPart`
now builds the part, warms it on private buffers and publishes it afterwards
(peak 0.0000, 8 runs of 8). Found because a phone on 4.9.9.9.9.8.5 reported
noisy sounds at startup; whether that is the whole of what was heard is for the
phone to say.

**Cost to watch.** The rack measured about 2% of a core with everything on,
per part, on a Mac. A part now carries rack + mõdFX, and the chord and arp can
both be native, so measure N3 on the oldest phone available before adding
the next part; the answer to "which parts go native" is whatever that phone
holds without a dropout, not what the Mac does.

**Unbuilt, and risks that are known now:** the Swift/Xcode side of each step
is compiled only on the owner's Mac; the FDN reverb has been judged by
number, not ear, and the master bus makes it louder in the mix than any one
rack; and a pad gesture that sets 11 parameters per frame will overrun a
queue sized for notes unless the page coalesces by index (the 1024-slot queue
already dropped a note-off once).

### Playing on while the app is in the background (4.9.9.9.9.7.7 – 7.7j; parked)

What was done, what it showed, and where it stopped, so the next pass starts
from the evidence and not from the guesses.

Done: `UIBackgroundModes: audio` in Info.plist (without it iOS suspended the
app and the sound with it); the page no longer ducks or pauses on
`visibilitychange` in the app (Settings > General > Interface, "Keep playing in
background", on by default; the web build keeps its pause); the scheduler runs
3 s ahead while backgrounded, entered on a hidden page *or* on a tick 400 ms
late; ALIGN_LEAD 1.2 s there (3 s opened a 3 s silence on entering); chord
comp re-strikes come from the scheduler tick rather than their own timers;
native messages are stamped with the page's wall clock so the bridge delay
comes off `atRel`. Tools: Settings > "Copy diagnostics" (build, native render
stats with the slowest blocks and when, `leadStats()` per part, background
switch log, the page's errors).

What the measurements said:

- Bass, drums and the melody sequencer hold in the background. They are plain
  Web Audio nodes scheduled ahead.
- A mõdSynth part on the web worklet holds. The native chord engine's own
  numbers are clean in the background (load 5-12 %, nothing dropped, every
  message on time).
- **Sampled voices (flute, violin) drop out entirely when the app is left,
  with every message delivered on time and no error thrown.** That is the
  open problem; the notes are made and nothing sounds. Not understood. Likely
  somewhere in WebKit's handling of buffer-source nodes in a throttled page.
- One block of 40-80 ms on the native audio thread at the moment of
  backgrounding. Nothing in the render path waits on a lock; this looks like
  iOS, and nothing in the app prevents it so far.
- Timing is loose for a moment on coming back (the look-ahead drops from 3 s to
  the preset and the engines realign).

Where this goes: the web path for background is a patch on a platform that
throttles it. The real answer is the plan already in this document, every part
on the native engine, where the audio thread does not care what the page is
doing. Until then background audio is best-effort: mõdSynth parts hold, sampled
voices do not.

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
   live controls included (4.9.9.9.4–4.9.9.9.8), and the sampler
   (4.9.9.9.9). What remains is bus preparation and recording (above). The precondition for native audio, so it goes first now that
   native is decided. Also what MIDI out of every part and stems need.
2. **mõdSynth DSP in C++, null tested** — done (`native/modsynth/`,
   bit-identical to `dsp.js` across every factory patch).
3. **Chord model steps 2–4** — done (4.9.3, 4.9.9.9.9.3): the `getIntvs` call
   sites, the Chord field, and spelling from `ivs`. Step 5 (retiring `EXTS`)
   is still open and is not urgent.
4. **Drop Standards, add iReal Pro import** — done (4.9.9.9.9.4). The
   v4.7.2 branch re-applied on top of the chord model, with its chords now
   going through `slotFromChordSymbol`.
5. **MIDI** — the CoreMIDI plugin and its `requestMIDIAccess` shim are
   written (4.9.9.9.9.6) and verified on the web side; the Swift is unbuilt
   until a Mac compiles it. Mapping Mode next, on top of it.
6. **iOS shell** — the Capacitor project is in `ios/` (4.9.3), with the
   app icon and `.playback` audio (sound with the silent switch on). Still to
   come: the Swift audio host, haptics, IAP, text recognition for picture
   imports. Every build needs a Mac with Xcode: `npm install`, then
   `npm run ios` (builds `dist/`, syncs it into the project, opens Xcode).
7. **Remaining parts native, then the clock** — ships as 5.0.0.
