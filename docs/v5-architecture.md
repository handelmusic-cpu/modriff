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
| 2 | MIDI Mapping Mode | **built (4.9.9.9.9.8.9k)**: bindings, learn by tapping, notes and buttons, channels, pickup, storage and Setups; feedback out not built ("What was built", below) |
| 3 | Native wrapper, audio, haptics | **Runs on an iPhone** (`ios/`, Capacitor 8.5.2, Xcode 27). The C++ engine is in the target (`-ffp-contract=off`, null test 516/516) and the chord part is heard from it: `AppDelegate` owns the audio session, which cleared the old 0.73 s stop ("The native host, and where it stops", kept for its measurements). Native steps landed: the effects rack, the part strip with pan (N1), mõdFX (N3, N4), the master bus (N2) and capture for Bounce and stems (N5); **still open** is the rest of the parts going native (the offset once reported for the native chord in a bounced file was the checker's, see N5). Every part's notes already go through `modEngine`: chords (4.9.9.6), live melody (.7), melody sequencer (.8), bass (.9), arp (4.9.9.9.1), drums and Aux (.2), legacy Rhythm and click (.3), the knobs (4.9.9.9.4–.7), the sampler (4.9.9.9.9). Patches a native engine cannot resolve by name travel as values in the same message (4.9.9.9.9.7). Haptics, MIDI, picture import and iCloud sync are written; what a Mac has not compiled is marked unbuilt where it is described |
| 4 | In-app purchase | **built, not run (4.9.9.9.9.9.7)**: seven modules and a bundle, eleven StoreKit products (section 4). The page side is measured; the Swift is uncompiled and the purchase flow unrun |
| 5 | Phase 2 | key colours, master EQ and iCloud sync **built** (4.9.9.9.9.8.9o to 9q); see "After launch". Extra themes and melody density not built |

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
5. **Done (4.9.9.9.9.8.9l).** `EXTS` is a recipe table, not what a chord is.
   `_slotWriteNotes(slot)` writes the menu's notes onto a slot as `ivs`; a chord
   placed on the chart (`addToSection`: the pads, the chord pickers) and a quality
   picked from the menu or the Extensions grid (`_slotFromMenu`, which replaces
   `_slotForgetNotes`) both carry the notes they were made with. The reason is the
   one 4.9.2.5 showed: the dominant 11 lost its third in `EXTS` and every saved
   `C11` changed with it. Now a recipe fixed in the table changes new chords and
   leaves the chart alone. `tests/chords/stamp.test.js` checks that what is
   written equals `getIntvs` for every recipe the menu can build, and that a
   stamped slot ignores a change to the table while an unstamped one does not.

   What this does not do, on purpose: nothing is stamped when a song loads, so an
   old save (and a slot from a path not yet moved over: the progression
   templates, the generators, the live-capture recorder) still reads through
   `getIntvs`, plays exactly as before and keeps its "unsaved" state. `EXTS`
   and `getIntvs` stay as the recipe and its reader; the live pads
   (`_triggerChordImmediate`) still build from them, which is right, since a pad
   is a recipe being played and not a chord on the chart.

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
| a picture of a chord sheet | UG's PDF export, a photo of a songbook page | **built (4.9.9.9.9.8.9m)**: the phone's text recognition (Apple Vision, on device, free) → the same parser. "Text recognition, built" below |
| a lead sheet | Real Book page: chords over a staff, superscript qualities, 1st/2nd endings | text recognition is not enough — it cannot see bars, endings or which chord sits where on the staff, and it mangles stacked superscripts. This needs a vision model reading the page into a structured chart (sections, bars, chords per bar, endings), with every chord it returns validated by `parseChordSymbol` before it is used. Network and a per-page cost; a candidate for an add-on |

The parser already reads lead-sheet spelling (`DMI`, `GMI7`, `EMI7(♭5)`,
`B♭9`) and sections lettered `[A]` `[B]` `[C]`.

#### Text recognition, built (4.9.9.9.9.8.9m)

The import dialog has three ways in: **Files** (text, a PDF or a picture),
**Photos** (the library) and **Camera** (straight to the camera, a
`capture="environment"` input). Photos and Camera appear only where the reader
exists; elsewhere a picture still gets the old "paste its text" message.

- `ios/App/App/ModOcr/ModOcr.swift`, registered in `ModRiffViewController`: one
  method, `recognize({data, kind: 'image' | 'pdf'})`, returning the page's
  fragments as `{t, x, y, w, h}` (0 to 1, top-left origin), not a transcript.
  Language correction is off (it turns "Bm7" into a word). A PDF is drawn a page
  at a time with PDFKit (capped at 8 pages) and a page that has a text layer is
  read from it instead of recognised. If the accurate recogniser throws it
  falls back to the fast one.
- `modOcr` on the page (platform layer) shrinks a photo to 3000 px and re-encodes
  it, which also bakes in its EXIF orientation, and hands a PDF over whole.
- `ocrObservationsToText` (in the chord-model block, so it is tested on its own)
  puts fragments back into lines (centres within half a line's height), spaces
  them by the column they sat in, keeps a wide gap as a blank line, and puts back
  a section bracket read as I, l, | or 1 ("IVerse 11" is "[Verse 1]"). What it
  returns is `parseChordSheet`'s input, shown in the dialog's box and editable,
  so a misread chord is a fix, not a re-take.
- `NSCameraUsageDescription` is in `Info.plist` (without it iOS ends the app when
  the camera opens); the photo library needs none (it is the out-of-process picker).

Verified here: `tests/chords/ocr.test.js` (both real sheets cut into boxes,
jittered and shuffled, come back as the same chart); the dialog in a browser with
a stand-in plugin (all three inputs, an image and a PDF, a text file still read
as text, a failure message, the note clearing when you type); the Swift compiles
for the simulator; and Vision itself, run from a command-line copy of the
plugin's logic on a rendered chord sheet as a PNG, a PDF and a skewed JPEG. That
last run only worked with the **fast** recogniser (the accurate one could not
start on that Mac), so it read the lyrics and some chords and missed others, and
it is where the bracket repair came from. **Not known:** how well the accurate
recogniser reads a real photo or the Ultimate Guitar export. That is the first
thing to try on the phone, with the Photos, Camera and Files routes in turn.

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

Before 4.9.9.9.9.8.9k (what the next section replaced; the apply path survived):

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

### What was built (4.9.9.9.9.8.9k)

Everything in this section from "The mode" on, except feedback out and a
`data-map` attribute on every control. Where the build differs from the design:

- **Targets.** Any visible `input[type=range]` with an id is a target, derived at
  scan time, so every mõdSynth knob and tone macro is mappable with no list. Buttons
  opt in with `data-map="toggle:…"` (Play/Stop, Hold, mõdFX Hold, Chord under arp)
  or `"trigger:…"` (the seven chord pads, both halves). The `MIDI_CC_DESTS`
  catalogue stays, for the Learn list and for labels; the dropdown's keys are
  converted to `kind:key` strings. More buttons are a one-attribute change each.
  The mõdFX pad binds its X axis on a tap; Y is on the Learn list.
- **Bindings** are as designed (`src`, `dst`, `mode`, `min`/`max`, `takeover`),
  held in `MAPB` and saved under `modo-midi-map`. `min`/`max` are stored but have
  no control yet. Learn sets `mode` from what moved: a CC, pitch bend or
  aftertouch on a slider is `abs`; a note or a CC press on a button is `toggle`,
  on a pad `momentary`. `rel` (and the pickup switch) are chosen per row in
  Settings > MIDI, not detected from an endless encoder's 63/65 pattern.
- **Learn** takes the first source that *moves* for a slider (a resting value on
  connect cannot claim it) and the first press for a button. One source drives one
  control and one control has one source; rebinding either replaces the old pair.
- **Interception** is `_mapMidi`, called first in `onMidiMsg` (after the echo
  check and the monitor log): a bound message is consumed, and while a control is
  armed everything but a note-off is, so the key that binds a pad does not also
  play a chord. A binding wins over a controller profile's own mapping.
- **Migration.** `modo-midi-cc` becomes bindings with `ch: null` on first run and
  is left in place. The two defaults (CC1 to the mõdFX X axis, CC11 to the chord
  level) are not written to storage until something is changed.
- **Setups** carry the map (`midiMap`), and it comes back when a person loads a
  setup, imports one or opens a project, not when undo or the last-session restore
  runs (⌘Z quietly taking back a binding would be a surprise).
- **Tapping** while Map is on arms the control and swallows the tap (a mapped
  pad cannot be played with a finger in that mode). A long press, or the badge,
  clears; Esc disarms, then leaves. A transport-sheet row and a Settings > MIDI
  button turn it on.

Verified in a browser with synthetic messages through `onMidiMsg` (no Playwright
on this machine): arming does not move the control, the first CC only records
and the second binds, channel and port are kept, pickup ignores a knob below the
control and picks up as it crosses, a note toggles Hold and a held pad sends
pointerdown and pointerup, an unbound note and clock still reach the router,
long press clears, Esc, the Setups round trip, and the migration. Not tried on a
phone: a real controller, and the touch feel of arming a 3 px slider.

### The mode (as designed)

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
   { "v": 1, "kind": "state", "params": { "chord.attack": 0.025, "chord.voice": "pianoreal2", "mix.bass.gain": 0.8, … } }
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

### The native mixer, mõdFX and master bus (N1–N5 built; the flip is not)

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
   can exceed either. **Built (4.9.9.9.9.8.8):** the native master takes 3 dB
   off its output while any web part is in the mix (`MB_WEB_TRIM`, parameter 8
   of the master message, so no new message type). "In the mix" is read from
   the mixer, not the meters: a part that is not muted, not shut out by a solo,
   with its fader above zero. A level that followed the signal would dip the
   chord on every drum hit. The trim glides over about a third of a second, so
   a mute or solo is never heard as a step. It goes away at the flip, when
   there is no web part left to count. What it does not do: the web side is
   untouched, so the sum of the two limited signals can still pass -3 dBFS when
   peaks coincide; 3 dB is the plan's proposed amount, not a measured ceiling.
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
| N1 | Part bus, strip (level, mute/solo, pan), per-part peak/RMS back to the page's meters | **Landed (4.9.9.9.9.7.6t, pan 4.9.9.9.9.8.4).** A fader at −6 dB measures −6 dB at the host; solo silences the others, counted |
| N2 | Master bus: drive, bus reverb, glue, limiter, volume, with the two-worlds headroom | **Landed (4.9.9.9.9.8.6), headroom 4.9.9.9.9.8.8.** Measured against the browser's compressor and chain; reverb level and tail against the convolver |
| N3 | mõdFX tier 1, the setter wrap, smoothing | **Landed (4.9.9.9.9.7.6v).** Each stage's level and response against the web chain's, `fxtest`-style |
| N4 | mõdFX tier 2, the worklet port | **Landed (4.9.9.9.9.7.6v).** Null test against `FX_WORKLET_SRC` run offline in node |
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

*Gate patterns (4.9.9.9.9.8.9j).* The rhythmic gate's eight patterns run on a
native part too: `GATE_PATTERNS` is copied into `mixfx.cpp`
(`tests/modsynth/gatepat.test.js` fails if either copy moves), three parameters
were appended to the enum (`gatePat`, `gatePatAmt`, `gatePatHz`), and the gate
stage adds the pattern to the base gate as the web adds its looping buffer to
`gate.gain`. The page now sends the base already ducked by the depth
(`gate * (1 - depth)`), the pattern number from `_fxGatePatIdx` and the bar rate
as bars per second. Measured (`mixfxtest`): pattern 1 opens on the beat and is
shut between, pattern 5 gives eight openings a bar, a 1 s bar doubles them, base
0.4 + depth 0.6 sits at 0.4 shut and 1.0 open, depth 0 changes nothing. The page
side was driven through the real `fxApplyChannel` with a stand-in chain
(0.05, 0.3, 0.55 and 0.99 on the axis send patterns 0, 2, 4, 7 and the matching
gate and depth). Not bit-identical to the web, on purpose: the pattern keeps its
place in the bar when the pattern number changes, where the web's loop points
wrap the playhead.

*Not in it yet:* the sample-source axes, which read a clip held in the page.
Those pad axes do nothing on a native part.

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

- **Headroom between the two masters.** Built in 4.9.9.9.9.8.8 (3 dB, above).
  Not heard on a phone, and the 3 dB is a guess at the right amount: if the
  chord reads too quiet next to the drums, or the sum still crunches on a loud
  take, it is one number in `_modNativeMasterSync`.
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

> **Superseded:** the 31 and 46 ms below were `bounce-check.py` misreading a
> chord's decaying tail; see "N5, resolved" further down. The account is kept
> because the mechanism it describes (a note placed from the block that drained it)
> is real, only small.

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

**N5, was open (4.9.9.9.9.8.7c, 7d; resolved below): the native chord read 48 ms early *in the
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

**N5, resolved (4.9.9.9.9.8.9w): the native chord was never early. The checker
was.** Bounce 9 (-25.6 ms) and a following take (chord -79.1 and arp -80.0, the
arp being a web part that had read -0.4 the time before) made it visible: -80.0 is
exactly the edge of `bounce-check.py`'s search window (80 ms before the logged
time), and 92% of that take's arp notes and 57% of its chords sat on it. The finder
took the first sample above 25% of the window's peak; when the previous note is
still ringing at the window's start that is sample 0, whatever the real onset is,
and a decaying chord tail does it by a different amount each time. The finder now
takes the rising crossing nearest the logged time and skips a note whose stem never
dips (`tests/stems/offsets.test.py`: a chord 15 ms late read -32.5 with the old
finder, +15.0 with the new).

Re-run on every bounce taken, the native chord reads: session 7 +0.1 ms (was
-31.3), session 8 +0.1 (-47.8), the Dm-G-C-Am take -0.3 (-46.3), session 9 -0.1
(-25.6), the B-E-B take +0.3. The web parts hardly move (arp -0.5 to +3.9, bass
+7 to +10, melody -2 to +5, kick -3 to +19: onset-threshold differences between
timbres, not placement). So the placement was right from 4.9.9.9.9.8.7 on, and the
sequence above (the 31 ms, the median origin, `drainMs`, the `Date.now()` stamp)
was chasing a number the measuring tool made. None of it is wrong and `drainMs`
measures 0.004 to 0.011 ms on the phone, but none of it was needed. Whether native
and web are aligned *as heard*, which the file cannot say, is still the owner's
ear (who finds it right). The capture report's `web clock steps` line (9w) stays;
it is cheap and answers the clock question for good.

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

### The graph interpreter: the voices go native without being rewritten (branch `claude/native-voices`, C++ and page-side only)

**The change of plan.** The flip was written as "port every voice to C++". Counted
(above): `makeVoice` is 900 lines, the drum kits another 260 plus their tables,
the bass voice, sample playback and the sampler pads, and each is a Web Audio
*node graph*, not arithmetic, so none of it can be null tested. Rewriting that
is a rewrite of the instrument, with a new bug per voice.

What the page already does for a note is build a small graph of nodes
(oscillators, gains, biquads, buffer sources, shapers, a panner, a delay) and
automate their parameters. Counted over `index.html`, the voices use seven node
types (gain, oscillator, biquad, buffer source, wave shaper, stereo panner,
delay) and the AudioParam methods set, linear, exponential, target and cancel;
the rest of the file's `create*` calls are the master chain, analysers and the
recorder, which are not voices. So instead of porting each voice:

- **`tests/graph/graphrec.js`** is a stand-in `AudioContext`. A voice is called
  with it instead of the real context and it *writes down* what the voice
  builds: nodes, connections, every parameter's timeline, buffers. The output is
  one flat number array (layout in the file's header), so it crosses the bridge
  with no parser. The voice code stays the single source of truth: change
  `makeVoice` and the native sound changes with it.
- **`native/modsynth/graph.{h,cpp}`** reads that array and plays it, in 128-frame
  quanta, with the browser's AudioParam timeline (set, linear, exponential,
  target; audio-rate modulation summed on top), a band-limited wavetable
  oscillator built the way a browser builds a PeriodicWave (three tables an
  octave, crossfaded, normalised by the real peak), RBJ biquads, a wave
  shaper, a stereo panner, a delay, and buffer playback.
- Endpoints that belong to the host (a part's bus, a reverb send) are `ext`
  nodes the recorder hands out by name; the interpreter exposes their summed
  output for the host to route.

**Measured, against the browser's own render of the same voice**
(`make -C native/modsynth graphrender && node tests/graph/voices.test.js`):
the real `makeVoice` is run into an `OfflineAudioContext` and into the recorder,
with one seeded `Math.random`, and the C++ render is compared with Chromium's.
Nine voices (sine, triangle, square, saw, supersaw, pad, piano, organ, rhodes) at
C3, C4 and C5, 27 renders: signal-to-error 67 to 114 dB, no 10 ms window off by
more than 0.01 dB, peaks identical. The piano is the least exact (67 to 69 dB;
its filter sweep is the one place the browser's per-sample ramp and our
per-block coefficients part ways). That is near sample-exact with no null test
to lean on; the tolerance the test holds is 60 dB.

Two things measured on the way, so nobody rediscovers them:

1. A browser normalises a PeriodicWave by its *real* peak, not the largest table
   sample. A saw sampled on a 4096-point table reads 4% low, and every saw and
   square came out 4% too loud until the peak was found on an 8x finer grid.
2. **A browser oscillator that starts in the middle of a render quantum reads
   its first quantum's frequency-modulation samples from the wrong end** (frame
   480: a 0.1 rad carrier phase offset with FM; frame 512: none). It is a
   browser quirk and not copied. The test starts its notes on a quantum
   boundary so it compares the maths and not the quirk; on a phone a note
   starts wherever it starts and the difference is inaudible.

**Built since, all measured here** (`tests/graph/`, `native/modsynth/graph*`):

- **Live edits.** A held note is changed after it starts (release, choke,
  glide, a source's `stop`), so the recorder keeps a handle on a graph it has
  sent and writes each later call as a six-number increment (`takeIncrements`);
  `Graph::apply` runs them. `cancelAndHoldAtTime` is the browser's rule, not the
  obvious one: it cuts a ramp in progress short at the cancel time on the value
  reached, turns a target still decaying into a set, and leaves a param that is
  sitting at a set value alone (so a release ramp added afterwards starts from
  the earlier set, exactly as in a browser; an earlier version that always held
  got a sustained note's release wrong by 34 dB). Held to the browser:
  a release on six real voices, and `tests/graph/edits.test.js` (a choke
  mid-decay, a target mid-settle, cancel-then-set, an early stop, chained
  automation, a filter sweep with a shaper and a pan, a delay): 70 to 112 dB.
- **Two browser habits copied, because the page's own sound has them.** A source
  that starts between frames starts sub-sample (a noise burst 155 to 171 dB, an
  oscillator 94 dB against the browser); and an oscillator that starts part-way
  through a render quantum reads that quantum's frequency and detune from the
  start of the quantum. Copying the second took the piano from 67 to 94-100 dB
  and an FM voice from 20 to 106 dB. The voice test now starts its notes at frame
  480 on purpose.
- **A biquad** recomputes its coefficients every 8 frames while a param moves
  (`MODSYNTH_BIQUAD_STEP`): measured on a lowpass sweep, every frame 72.4 dB,
  every 8 about 70, every 16 65.1.
- **Recorded audio is by id.** A decoded clip crosses once (`takeNewBuffers`,
  `BufferStore`) and a graph names it; a graph that names an id the host lacks is
  refused with -2 and the id, so the page sends the clip again and retries. A
  clip at another rate plays at its own pace.
- **The pool** (`graphpool.{h,cpp}`) is what the host calls: `begin`/`edit` from
  the control thread, `render` from the render thread, a slot state machine so
  the render thread never allocates, locks or frees. A voice starts at an engine
  frame, applies queued edits at a block start, sums into its part's bus by ext
  code, and retires when its sources have stopped and the tail has gone quiet.
  `graphpooltest`: 24 checks (exact sums with starts between blocks, edits
  before and after start, retirement, a full pool, slot reuse over 600 notes, a
  control thread racing the render thread, recorded audio and a half-rate clip),
  clean under ThreadSanitizer.
- **Drums.** `tests/graph/drums.test.js` plays every lane of every kit in `SQM`
  into a browser `OfflineAudioContext` and through the recorder and interpreter
  (two hooks patched into the served page in memory; `index.html` is untouched).
  **All 256 lanes of 36 kits hold**, 69 to 175 dB against the browser (the
  weakest are a cymbal and a hat at 76 to 81 dB: a filtered noise through a
  sweeping band). Two lanes are held to a lower, stated limit because the
  browser itself does something odd there: the mõdKit kick, whose sub tone
  starts 10 ms after its frequency ramp began (a browser evaluates that first
  quantum's automation from the ramp's start: a few samples of phase on a 48 Hz
  tone, 30 dB), and the 808 clap (one sample at a burst that lands exactly on a
  frame, 51 dB). With `SAMPLED=1` the recorded kits (jazz, rock, hip-hop,
  beatbox) play their real decoded samples through the buffer store: all 35
  lanes, 69 to 184 dB.

**Host integration: what the Mac session does** (Objective-C++, not edited here,
so not built). `ModEngineHost.mm` already runs a part as Processor, then rack,
then strip, mõdFX, meter, pan, then the master (`renderInto:`). A graph part has
no Processor, so:

1. Own a `modsynth::GraphPool _graphs`. Three new plugin methods, all taking what
   the page sends (`_mgSend`, `_mgFlush` in `index.html`):
   - `graphBuf {id, sampleRate, channels: [base64 Float32...]}` into
     `_graphs.buffers().put(id, sr, nch, len, ch0, ch1)`.
   - `graphBegin {gid, program: base64 Float64, base, ts}` into
     `_graphs.begin(program, n, 0.0, startFrame)`. The program's times are
     seconds from the moment the page opened the voice, so `timeBase` is 0.
     `ts` is that moment on the page's wall clock (ms, with fractions, the same
     clock the host already uses to place every other message), so `startFrame`
     is the engine frame at wall-clock `ts`, worked out the way `mm.at` is. It is
     a few ms in the past by the time the bridge delivers it: the pool catches a
     late voice up (up to a second) rather than playing it from its start.
     `begin` returns -2 for a clip it does not hold: answer with
     `_graphs.unknownBuffer()` and the page sends that clip again.
   - `graphEdit {gid, increments: base64 Float64}` into `_graphs.edit(handle,
     inc, n)`. The page picks `gid`; keep `gid` to pool handle in a table only the
     control thread touches, and drop a `gid` when `edit` says it is stale.
   All three on the control thread (the one that drains plugin calls), in the
   order the page sent them: a clip, then the graph that names it, then its edits.
2. In `renderInto:`, before the part loop, zero `kBuses` (11) pairs of scratch
   buffers and call `_graphs.render(blockFrame, frames, busL, busR, touched)`.
3. In the loop, a part runs if it has a Processor **or** `touched[part]`: a
   Processor part adds its bus after its rack (the rack is a mõdSynth patch's own
   Space and Drive; web voices never had one); a graph-only part starts from
   silence. Strip, mõdFX, meter, pan, capture and the master are unchanged.
4. Buses 8, 9, 10 are not parts: 8 (the click, the legacy Rhythm) goes into the
   master the way the chord's direct path does, with no strip; 9 (the chord room
   send) feeds the effects rack's reverb of part 0; 10 (the shared room send)
   feeds the master bus room (`_roomL/_roomR`). Their level is already in the
   graph. Until the host does this the pool ignores them and the reverb on those
   voices is silent, so do it before the page turns the path on.
5. Attach a part without a Processor: its strip and mõdFX (as attach does now)
   but no engine and no rack, and its capture ring, so Bounce and stems keep
   working. The plugin's `ensurePart` is the place.
6. Warm the pool before audio starts (load and render a few blocks of a silent
   graph) so the first note does not pay for first-touch memory, as `warmUp`
   does for the Processors.
7. Probe: the page should not turn the path on until the plugin answers a
   do-nothing `graphBuf` call, as it does for the file methods (`fileDelete`), so
   an old binary falls back to Web Audio.

**The host half is written (v4.9.9.9.9.9.5c), built, and measured offline; heard on a phone (drums and bass by ear and by counter, the click, the sampler and the chord by ear; mel, arp, melgen and Aux, and every part at once, not yet).**
`ModEngineHost` owns the pool; `graphProbe`, `graphBuf`, `graphBegin`, `graphEdit` are plugin
methods; `ensurePart {graph: true}` builds a part's strip and mõdFX with no Processor and no
rack (codes 8 to 10 are buses and only switch the pool on); `renderInto:` plays the pool before
the part loop, runs a graph part while it has voices and for 8 s of mõdFX tail, and applies strip
and mõdFX messages to a part with no Processor. What differs from the list above, and why:

- **Buses 9 and 10 are wet-only reverb returns, not inputs of the rack or the bus room.** The rack's
  reverb adds a tail to a dry input at the rack's own mix, and the bus room input is dry and
  roomed together; the graph carries the raw send (voice x mix), which the web feeds to a
  ConvolverNode whose output is the tail alone. `FxRack::setSendReverb/processSend` is that
  convolver as the rack's network, wet only, at unit gain, fitted to the page's impulse
  (noise falling as (1-t)^2.5 over 1.8 s): `tests/graph/sendreverb.test.js` holds it to a
  browser ConvolverNode, 0.3 dB on steady noise and +1.2 / -3.1 dB per 100 ms over the first
  1.2 s of the tail. Bus 9 (the chord's room) returns to the direct path, as the web's pair does
  into the glue; bus 10 (the shared room) returns into the bus room sum, as the web's
  convolver feeds `masterDest`. Not yet followed: the page's `chord.reverbSize` slider (the
  rooms are 1.8 s).
- A voice's start frame is `(ts - offset) * rate / 1000` with `offset` the wall-clock offset of the
  last block (the one `applyMessage` uses to place a note), published each block.
- A throwaway pool plays a short tone at the first `ensurePart {graph}` to warm code and heap.
- A loop point within 1e-6 of a frame snaps to it (`graph.cpp`): current Chrome wraps a looping
  clip at a loop end that the page computed as 0.6000000000000001 s, the interpreter did not.

`native/modsynth/graphhosttest` (26 checks) drives the real `ModEngineHost.mm` off the audio
graph: a part with no Processor, buses 8 to 10, the strip, tails, a missing clip (-2 and its id),
edits, a part with both. Run `make -C native/modsynth graphhosttest && native/modsynth/graphhosttest`.

**The page side is built, off (v4.9.9.9.9.9.5 on), and measured without a host.**
`index.html` carries `GraphRec` (a copy of `tests/graph/graphrec.js`;
`inline.test.js` fails if they drift) and a small module, `modGraphEnable(plugin,
parts)`, that is the only thing that turns it on; nothing in the app calls it, so
`getCtx()` and every message are exactly as before. For a part it is on for, the
page builds the voice on a recorder instead of the real context, names the page's
own bus nodes to the host (a part's bus with the fixed gain it carries, the two
rooms, the master), and sends the program, any new clip, and later edits (a
release, a choke, a glide, a source's `stop`) as `graphBuf`, `graphBegin`,
`graphEdit` on the plugin. A voice that reaches a node it cannot name, or uses a
node type a program cannot carry, is not sent; it is built again on the real
context, so a gap is a sound that stays on Web Audio, never a missing note. A part
on a mõdSynth patch is left alone (the Processor plays those).

`tests/graph/page.test.js` is the proof. The real page runs a pattern through
`window.modEngine.send` twice on an `OfflineAudioContext` standing in for its own:
as the web engine is, and with the graph path on and a stand-in plugin whose
messages `native/modsynth/graphmix` plays through the pool as the host would. The
two are compared on the buses the host would sum. All of these hold, peaks
identical and **no fallbacks** (`sh tests/graph/page-all.sh`):

| path | what it runs | result |
|---|---|---|
| drum, auxperc | 808 and 909 lanes, an open hat choked by a closed one | 71 / 97 dB |
| bass, melgen, arp, mel | notes, a bass slide path, voices on the chord rooms | 110 / 67 / 90 / 82 dB |
| chord | a held chord with the Sub, the chord room and a release | 75 dB |
| click, rhythm | straight into the master | 70 / 128 dB |
| sampler | a clip, a looping window with a release, a re-pitched clip | 156 dB |
| mel glide | the bend strip's glissando, `hz` and `y` changed while it sounds | 76 dB |
| recorded voices | piano, violin, flute, upright bass, the jazz kit's samples | 98 / 64 / 92 / 88 / 61 dB |

Things this turned up, each of them a browser habit now copied in
`graph.cpp`: a source starts at the first whole frame at or after its start time
with no allowance for rounding (1.1 s begins a frame after 0.1 s does); a moving
frequency is read sample by sample and then the start is not applied sub-sample;
a buffer source's `offset` is rounded to a whole frame. And things on the page
side: lazy buses were being built on whatever context was current (a recorder),
caches keyed by context identity regenerated their random data per note, and two
reverb sends were made on the real context instead of the recorder.

**Codes the host maps** (`GraphPool::kBuses` = 11): 0 to 7 a part's bus
(chord, mel, melgen, bass, arp, drum, auxperc, sampler), 8 straight into the
master (the click and the legacy Rhythm), 9 the chord's own room send, 10 the
shared room send. The sends carry their level (`mix`) in the graph; the host feeds
each into the reverb the part already has natively (the effects rack's for the
chord, the master bus room for the rest).

**Level and strip, per part, before the flip.** The web voices scale themselves at
note time by the part's fader and mute (`_wp('mix.<part>')`), so for a graph part
the page must send the host's strip a level of 1 and let only pan, mõdFX and the
meter come from the host; sending the fader as well would apply it twice. The
existing `_modNativeStripSync` is written for the mõdSynth path, where the voices
do not scale themselves, and needs a switch per part.

**Found on the phone, 5d to 5m.**
- A mõdSynth patch on a part played as graphs has no Processor on the host: `MODNAT.proc`
  says which parts have one, and only those are handed over (5d). Without it bass and mel on a
  patch were silent after `modGraphStart`.
- The click entered the master through `masterDest`, the drive and the bus room, so every beat had
  reverb. It enters at the glue now (`_masterComp`), and that node resolves to bus 8 (5g).
- `gcheck(parts, secs)` is in the page: it clears the console and prints one PASS or FAIL line with
  the counters, because Safari's inspector buried the objects.
- Melody Mono / Poly with a glide time (5e), and the strip's two-finger zoom is Mono only (5f):
  in Poly a second finger was read as a pinch and a chord never sounded.
- **The sampler's microphone (5h to 5m).** The page's plugin wrapper lists method names by hand, so a
  new native method must be added there or the page cannot see it (`micPermission` was missing and
  iOS was never asked). With iOS granted, the web view's `getUserMedia` still failed with an
  `InvalidStateError`: it worked when everything was Web Audio, and the native engine now owns the
  audio session. Inside the app the take is recorded from a second `AVAudioEngine`'s input node
  (`micStart`, `micRead`, `micStop`, polled every 50 ms); a binary without them, or a browser, still
  uses `getUserMedia`. The session is `.playAndRecord` from launch (5j; `.mixWithOthers`,
  `.defaultToSpeaker`, `.allowBluetoothA2DP`), kept because the second engine needs it.
- **Native sound switch and status line (5n to 5s).** Settings › Interface › Native sound starts the
  graph path for every part (the click included) at launch and prints the counters, so the console
  is not needed: notes sent, fell back, dropped (split into no free voice and refused, with the most
  voices at once), late edits, blocks that missed their deadline, load, and the block size.
- **The Debug build is not a test of the engine.** Xcode's Debug configuration compiles the C++ at
  `-O0`: 38% load, 32,116 blocks over 2 ms, worst block 162 ms; the same session optimised was 3% to
  17% and a worst of 8 ms. `ios:device` now builds Debug with `GCC_OPTIMIZATION_LEVEL=s` (Release
  would be fast too but asks the App Store for purchases and has no test switch). `MODRIFF_OPT=0`
  turns it off.
- **Play-and-record made the audio blocks 1,100 frames (23 ms) instead of 128 (2.7 ms).** The session
  now asks for a 5 ms buffer (`setPreferredIOBufferDuration`); the phone gives 240 frames. Check the
  block size on the status line after any change to the session.
- The mixer's master meter adds the host's master RMS (slot 8 of `meters`) to the web master's, and a
  part played as graphs that is on a mõdSynth patch keeps its web meter (its worklet is the web's).
- One dense session dropped 184 of 884 notes (and one block took 17.5 ms against a 5 ms budget); a
  second, the same kind of playing, dropped none (most voices at once 26 of 64, worst block 4.8 ms).
  Not explained. If it recurs the status line says whether the pool was full or programs were refused.
- **mõdSynth on every part (5t; page only, unheard on a phone).** `MODNAT.PART` names all five parts that
  have a mõdSynth (chord 0, mel 1, melgen 2, bass 3, arp 4: the same slots as `MODGRAPH.CODE`), and
  `_modNativeSync` asks the host for a Processor in a part's slot (`ensurePart {part, warm:true}`, no
  `graph`) the first time its engine is built, then unplugs the worklet as it always did for the chord.
  The host needed nothing: `ModEngineHost` already ran a Processor, rack and strip per slot, and a slot
  with a Processor and graph voices both (a graph part set to a patch) sums them. Idle, five Processors
  with racks cost 2 us a block each (x86, `-O2`), so they are built lazily only to skip the warm-up. What
  changed with it: the host strip's level is `_msxCal * fader * the web bus's gain` (bass 0.36, Melody Seq 0.6
  are real buses with a level; the worklet's trim went through them on the web, the host's strip did not,
  so the bass on a patch would have run 2.8 dB hot), a voice change re-sends the strip (a graph voice scales
  itself, a patch does not), and "the host plays this part" (`_modNativeCarries`: meter, stems, the master's web trim)
  now asks the part's voice, because an engine stays attached after the part is set to a
  web voice. `tests/graph/parts.test.js` holds it. Not yet heard: the Processor's parts all at once.
- **The sampler graph test failed at 58.8 dB (5u).** Three frames of 144,000 differed, each the wrap of a looping
  clip: the page asks for a loop end of `0.4 * 1.5`, which is 0.6000000000000001, and Chrome 153 reads the
  sample past the end for that frame (a tick) where the Chrome the interpreter was matched to wrapped. The
  page now spells a loop point that lands on a frame as that frame's time (`_smpLoopSec`), so browser and
  interpreter agree whatever the browser does with noise; 155.7 dB again. `graph.cpp`'s snap stays.
- **Every part on mõdSynth, on the phone (5t): clean** (9,440 notes, 0 dropped, 2 of 156,932 blocks over 2 ms,
  worst 2.5 ms, load 11%, most voices at once 47 of 64). Heard: the Pluck category (not Lo-fi Pluck), Stab Keys,
  Metal Bell and DX Bell Stack peaked too loud; the mellow patches sat fine.
- **Patch levels recalibrated (5w).** The trims matched flat RMS on one four-note chord, so a bright, transient
  patch read as loud as a pad and was heard as much louder (K-weighted and played as a Melody Seq line the plucks and
  bells sat a median 3 dB over the library; 3 to 5 dB higher peaks). `tests/levels/trims.js` now writes
  `modsynth/patches-levels.js`: K-weighted (BS.1770) loudness against the app's own voices, the lower of a chord and a
  line for a polyphonic patch, a peak ceiling (-12 dBFS unity parts, -6 bass), the median patch of each class left
  where it was. Spread across the 324 patches 3.0 dB to 0.65 dB; 70 moved more than 2 dB (43 down, 27 up).
  Some of the patches heard as too loud (Dark Pluck, Sine Pluck, Stab Keys, Metal Bell) measure about right and moved
  less than 1 dB: the measurement and the ear disagree there, so say by name which is still too loud. 5v's flat 3 dB
  cut on 18 patches is gone (the table is regenerated, not patched). The per-part offsets are unchanged on purpose:
  `MSX_BUS_CAL` x the bus gain makes the same patch 8 dB hotter on Melody Seq and bass than on chord and arp, because a
  part's mõdSynth sits at the level of that part's built-in voices and the faders were set against that; flattening it
  drops every Melody Seq patch about 7 dB, which is a mix decision, not a calibration one.
- **A late Processor was 20 s late (found on the phone, fixed in 5y; built and measured on the Mac in 6o).** With Native sound on and the arp
  playing as graphs, switching it to a mõdSynth patch was silent for about 20 s and then played, and kept playing for
  about 20 s after Stop. The page was right (the stand-in plugin shows arp notes at slot 4 from 0.2 s after the
  switch, each 0.17 s ahead). The host's `_partFrames[part]` is the Processor's clock, `applyMessage` places a note at
  `_partFrames + atRel`, and the render loop advanced it for a part that was running only for its graph voices and mõdFX
  tail, with no Processor. A Processor built later (5t builds them on first use) started at zero and every note was as
  late as the part had been running. The chord never showed it: its Processor exists from launch. It now advances only
  while a Processor exists. `graphhosttest` has a check (a graph part runs 4 s, is given a Processor, its first note
  sounds within half a second). The check did not compile when it was written (`CHECK` splits its arguments at the
  commas of an `@{...}` literal, so the dictionary is built outside it now), and a stale `graphhosttest` binary kept
  passing meanwhile: after editing the test, check that `make graphhosttest` printed no error. With the fix reverted the
  check fails (peak 0.0000); with it, 0.134. The whole app also builds for the simulator (`xcodebuild -scheme App
  -sdk iphonesimulator`, Xcode 27.1).
- mõdSynth sounding louder than the other voices: not reproduced. By K-weighted momentary loudness the
  library sits 1 to 4 dB under the app's own voices; the owner has let it be.

**Still to do.** The Objective-C++ host half (above; not built here). Wiring the
page to call `modGraphEnable` for the native app once the plugin has the three
methods, with a probe like `fileDelete`'s so an old binary falls back. The strip
level switch above. (mõdSynth on the parts other than the chord: done, 5t.) The
`AudioWorklet` voices the recorder cannot hold are now only mõdFX's own worklet
effects (native already, N3 and N4). Then the flip itself: the commit
that turns it on for every part and deletes the web path.

### Playing on while the app is in the background (4.9.9.9.9.7.7 – 7.7j; parked)

**Decision (4.9.9.9.9.8.9x): not for 5.0.0.** Background play is punted until
after the app ships. Leaving the app pauses everything under the duck and the
song remembers its chord; coming back resumes by itself, once the audio context
is running again (it waits up to two seconds, then offers a Resume button).
"Keep playing in background" was an opt-in; as of 9y it is off and its control is hidden (_bgKeepPlaying() returns false); it was for
testing, `modo-bgplay` = `'1'`. `UIBackgroundModes: audio` stays in Info.plist
because the app does play audio. `SceneDelegate` posts `modriff-background` /
`modriff-foreground` to the page, because `visibilitychange` is not reliable
once that mode is on and something is playing; either signal alone is enough.
The Swift side is unbuilt. The open problem below (sampled voices dropping out)
is what has to be solved to turn the default back on.

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

**4.9.9.9.9.9.2: System is everything that is not an instrument.** Steppers moved
into it (a saved `steps` off is read as `system`), and every tap on a button, tab,
switch, select, checkbox or drum-grid cell now ticks under System. It fires when
the finger lifts, and only for a tap: a touch that moves more than 10 px or is
cancelled by a scroll is a swipe, not a press. The instruments (chord and sample
pads, melody keys and strip, the mõdFX pad, knobs, steppers) keep their own
buzz and mark themselves `data-hap-own`, or match `HAP_OWN`, so they are not
doubled.

**4.9.9.9.9.9.0i changes (unbuilt natively; the page side was driven with a stand-in
plugin).** The melody keys and the Strip (formerly Bend) buzz one level under a pad:
a new `medium` kind, `UIImpactFeedbackGenerator(.medium)`; the Strip buzzes on touch
and on every note it slides onto, and a Slide (formerly Continuous) glide ticks as it
passes each scale note. The mõdFX pad's buzz follows the finger: the 110 ms gap
closes towards 30 ms as it moves faster (`modPlatform.haptic(kind, src, gapMs)`).
"Bounce done" is now **System** (`system`), which also carries switches (a tick on
pointerdown for pressed-state buttons, checkboxes, the part switches, Hold, and
anything labelled ": ON / OFF") and knobs (`knobTick`: a tick per sixteenth of
travel, one at each end). A saved `bounce` off is read as `system`. Until a build
with the `medium` case is installed, the native side answers it with the selection
tick, which is lighter than intended, not broken.

**Built (4.9.9.9.9.8.9i), felt on an iPhone 17 Pro Max (4.9.9.9.9.8.9s) and
switchable per instrument (4.9.9.9.9.8.9t).** Settings > General > Touch has the
master Haptics switch and, under it while it is on, one button per instrument:
Chords, Melody, Sample pads, mõdFX pad, Steppers, Bounce done. Each call site
names its instrument (`_hap(kind, src)`); the ones switched off are kept as a list
of what is *off* (`modo-haptics-off`), so an instrument added later is on without
anyone turning it on. Haptics are free: there is no row for them in `FREE_LIMITS`.
The paragraph below is the build as first written, when nothing had been felt. `modPlatform.haptic(kind)` and
`hapticPrepare()` are in `index.html`, called from the chord and 7th pads, the
melody keys, the sample pads (`pad`), the mõdFX pad (`kaoss`, down and while
dragging, at most one per 110 ms), the Bounce finish (`bounce`) and the sample
steppers (`tick`). One preference, `modo-haptics`, with a button under Settings >
General. The native side is `ios/App/App/ModHaptics/ModHaptics.swift`, not the
stock `@capacitor/haptics`: that plugin builds a fresh generator on every call
and never prepares it, which is the late first tap this section asks to avoid,
so `ModHaptics` keeps its generators and prepares them again after each tap.
`@capacitor/haptics` stays in `package.json` and `Package.swift` for now and is
unused. Not yet done: knob detents (`tick` is only on the steppers) and the
Mac `NSHapticFeedbackManager` bundle. The page side was driven with a stand-in
plugin (throttles, the off switch, a real `pointerdown` on a chord pad); nobody
has felt it yet.

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

### Bounce: streamed to disk, kept in Documents/Bounces (4.9.9.9.9.9.4d)

A bounce held the mix and every stem in the page as 32-bit floats until Stop
(about 2.7 MB a second with stems), so a ten-minute take passed a gigabyte and
iOS ended the web content process: the app came back at its start screen with
nothing saved. In the app each track is now converted to 16-bit as it arrives
and appended to a temporary file by the host (`ModEngine.fileAppend`); at Stop
`wavFinish` builds each .wav on disk (header from the page, silence for a late
start, cut or padded to the mix's length) into `Documents/Bounces/<title>
<date time>/`, `pcmAdd` lays the host's own capture onto the mix, and the share
sheet opens on those same files (`shareFiles` with a `folder`). `Info.plist`
carries `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`, so the
folder shows in Files under On My iPhone. A cancelled or failed share loses
nothing.

The page asks once, with a no-op `fileDelete`, whether the app it runs in has
these methods (`MODNAT.stream`); an older binary keeps the in-memory path.
The host's capture drops blocks of digital silence (`_natCapTake`): its master
is captured on every take and was otherwise eight bytes a frame of zeros.
Unbuilt Swift as of this entry; measured in a browser with a stand-in host only.

## 4. In-app purchase: seven modules and a bundle

**Decided (owner, 4.9.9.9.9.9.7):** the one-product plan of 4.9.9.9.9.8.9 (`modriff_pro`,
never released) is replaced by **seven non-consumable modules and a bundle**, eleven
products in all, every one Family Sharing on and universal across iPhone/iPad/Mac. The
prices live in App Store Connect and are read from the store at run time, never written
in the page. No subscriptions, ads, accounts or backend.

| Product ID (`com.handelmusic.modriff.` + …) | Display name | Price | Shown to |
|---|---|---|---|
| `sampler` | Sampler Engine | $5.99 | everyone |
| `synth` | mõdSynth Engine | $4.99 | everyone |
| `groove` | Groove Pack | $3.99 | everyone |
| `theory` | Theory Pack | $3.99 | everyone |
| `practice` | Practice Pack | $3.99 | everyone |
| `studio` | Studio Pack | $4.99 | everyone |
| `sounds` | Sounds Pack | $1.99 | everyone |
| `fullstudio` | Full Studio | $12.99 | owners of no module |
| `fullstudio.from1` | Complete Your Studio | $10.99 | owners of exactly 1 |
| `fullstudio.from2` | Complete Your Studio | $6.99 | owners of exactly 2 |
| `fullstudio.from3plus` | Complete Your Studio | $3.99 | owners of 3 to 6 |

Product IDs can never be reused, even after deletion, so those are the ones to create. The
prices are the launch prices and appear only in App Store Connect and in the StoreKit test
file (`ios/App/ModRiffPacks.storekit`); the page and the Swift read `displayPrice`.

**Where it lives.** Page: one block in `index.html` ("Modules", the part between
`<<tier-core:start>>` and `<<tier-core:end>>` has no DOM in it and is what
`tests/tier/load.js` runs). Native: `ios/App/App/ModBilling/ModBilling.swift`. The page and
the host speak in *product keys* (`sampler` … `sounds`, `fullstudio`, `from1`, `from2`,
`from3plus`); the Swift is the one place a key becomes a product ID.

`window.modBilling` is `owned()` (the keys bought, synchronous, from a cache the host
injects at document start so a paying user is right on the first frame and offline),
`products()` (`{key:{price, value}}`, the store's own strings and numbers), `refresh()`,
`purchase(key)`, `restore()` and `provider`. Any bundle key grants every module. The Swift
rebuilds the set from `Transaction.currentEntitlements` (verified, not revoked), listens to
`Transaction.updates` for the life of the app (refunds, Ask to Buy, Family Sharing, another
device), and a cached key comes down only on a signed revocation, never on "found nothing".
Restore Purchases is on the upgrade sheet, the store screen and Settings (guideline 3.1.1).
The web build keeps granting everything.

**Everything that is a decision is made in the page**, in four tables that the rest of the
file reads (change a table, not a surface):

- `FREE_LIMITS` and `FREE_NUMBERS`: what free gets. `FEATURE_MODULE` and `NUMBER_MODULE` say
  which module owns each row; the test fails on a row with none, which would be a lock
  nothing could open. A feature no table names is free.
- `SOUNDS_VOICES` and `voiceModule(w)`: the Sounds Pack's seven voices, then mõdSynth, then
  any other recorded voice (the Sampler Engine's).
- `MODULE_COPY` and `BUNDLE_COPY`: the buyer-facing words. Names are held to 30 characters
  and one-line descriptions to 45, because the descriptions are what goes into App Store
  Connect (the test checks, and checks the StoreKit file's text against them).
- `bundleOfferFor(owned, full, products)`: which of the four bundle products to offer by how
  many modules are owned, and `null` when there is nothing left to sell **or when what is
  left costs less one at a time than the bundle** (so a price change in App Store Connect
  cannot make the page recommend the dearer thing).

Every gate is still `freeAllowsKit`, `freeAllowsMode`, `modAllows('stemExport')` and the
rest, so the ~80 call sites did not change shape; each now answers for one module. Every
`freeBlocked(what, module)` names the module that would lift it (a lint in the registry test
fails on a call that does not). A tap on a locked control opens **one** sheet, named
("Custom samples are part of the Sampler Engine."), with that module at the store's price,
the bundle offer under it ("Full Studio" for a first-time buyer, "Complete Your Studio" with
what they would get and what they already own for a returning one), Restore Purchases, and
a way to **All packs**, which is the store screen (Settings > About > Packs > Store). The app
never opens it on its own.

### Where the line is

| | Free | Module |
|---|---|---|
| Scales | major, minor, minor pentatonic, blues | **Theory**: every other mode, harmonic and melodic minor, world scales, your own |
| Chord types, voicings | triads, plain sevenths; Close and Spread | **Theory**: 6/9, 11, 13, alterations; Drop 2, Drop 3, Soul, Neo-soul, Vary |
| Key colours | which key is red (rotation) | **Theory**: the circle-of-fifths order |
| Voices | Sine, Saw, Square, Tri, SuperSaw, the Upright and Electric basses, Acid, 303 | **Sounds** (`piano`, `rhodes`, `organ`, `pad`, `vibes`, `bass_motown`, `bass_hofner`); **Sampler** (every other recorded voice); **mõdSynth** (`modsynth`) |
| Sampler pads | preset banks PA Mix and PB Drums, 9 pads each | **Sampler**: PC and PD, the four user banks, all 16 pads, your own clips |
| mõdFX pad | Filter Sweep, Tape Stop, Dub Delay | **mõdSynth**: the other patches, the X/Y menus, saving your own |
| Drum kits | Linn, 808 | **Groove**: all others, the Aux channel |
| Grooves | 4/4 Basic, Shuffle, Half-Time Rock, 4/4 Funk, House, 3/4 Waltz, 12/8 Slow | **Groove**: the rest, including Bossa Nova |
| Bass / melody styles | Rock, Funk / Hook, Rock | **Groove**: the rest, and Arrange |
| Meters, steps | 4/4, 3/4, 12/8; 12, 16 or 24 (one bar of 12/8) | **Groove**: any meter, up to 64, a step length per part |
| Live page | the standard layout | **Studio**: adding, swapping, moving, removing widgets |
| Audio / MIDI export | first 90 s / first 4 bars | **Studio**: the whole take; stems |
| Saved songs | 5 (iReal charts count against them) | **Studio**: unlimited |
| iReal import | one chart per import, counted against the slots | **Practice**: whole playlists, in a library outside the slots |
| Practice trainer (Songs > Perform) | a visible row; a tap opens the pack sheet | **Practice**: Speed up, Next key, Loop bars (`practiceTrainer`) |

Fresh-start defaults are free ones, with one change: **chords start on Piano (synth), which
is now the Sounds Pack's**, so a free build plays the chords on Saw instead
(`FREE_VOICE_FALLBACK`) and a paying one keeps the Piano. Drums on the Linn, bass on Upright
(the synth one), Aux off for a free build.

**Judgment calls the brief left open, all in the tables above and one line each to move:**
the two free drum kits are Linn and 808 (606 and Jazz went to Groove); the free bass styles
are Rock and Funk and the free melody styles Hook and Rock; Bossa Nova left the free grooves
as a world groove; arp rates beyond 1/8 and 1/16 are Groove; Arrange (a line per chord) is
Groove; the rotatable key colours stay free and only the fifths order is Theory; the chord
vocabulary beyond the plain sevenths is Theory (it was already locked); the free sampler gets
the first two preset banks; free steps are one bar of any free meter, up to 16, with 12/8's
own 24-sixteenth bar allowed because the free 12/8 groove cannot be written without it.
Triangle and the two stock basses are named by no pack, so they are free.

**The practice trainer (4.9.9.9.9.9.9 to 9b).** Songs > Perform has a Practice row under
Endings with three switches, all under the Practice Pack as one row, `practiceTrainer`:
*Speed up* adds N BPM every M choruses up to a ceiling; *Next key* moves the whole chart up
a semitone, fourth or fifth every M choruses through twelve keys and then stays; *Loop bars*
repeats chords a to b of one section (pick them with two taps on the chart). A **chorus** is
the last playable section finishing its last pass (a one-section chart, or a last section on
infinity, counts every pass; a pass of a Loop counts as one, so the trainer works inside a
loop). The step is taken on that bar line, before the next chorus's first chord is played.
Tempo goes through `_setBpmGliss`, as the ritardando's does, because `onBpmInput` ends in
`restartIfRunning` and would put the groove back on beat one. The key shift is kept as a
signed distance from the start key (-5..+6): a slot's `rootM` is an absolute note and eleven
plain transposes would carry the chords five octaves up. **Stop undoes the run**: the tempo
goes back unless the player has moved it by hand since, and the chart goes back exactly (key,
notes, names) but only into the same chart in the key the trainer left it in, so another
song or a hand transpose is never undone. The numbers are kept in `modo-practice`; the loop
is not (it is a place in one chart, and loading another song clears it). `tests/practice/probe.js`
drives the real Play Song path and counts the steps, the keys, the chord sequence of a loop and
the restore; each of its checks was shown to fail when the code it covers was broken.
Not done: a loop across sections, a count-in before the loop, and a trainer that stops on its
own at the end of the twelve keys.

**Whole-chart transpose already existed and stays free**: `transposeSong`, the setlist bar's
-/+ and the transport's key arrows (semitone or circle of fifths) move the chart's chords,
names and bass. The line below used to list it as unbuilt.

**Not built, so neither gated nor in the copy** (the brief's own rule is not to list them
until they ship; each goes into its module's copy when it does): an alternate bass base note, a scale per
generator and melody density (Groove); mid-song time-signature changes (Groove); advanced
fingerings, that is alternate positions and shapes up the neck (Theory; the Fingering panel is
a reference with none of those, and stays free); alternate intonations (Theory); a 3-band EQ
with a low cut, extra themes and cloud sync (Studio). The master EQ that exists has no low
cut and stays free until the low-cut one replaces it; iCloud sync is written but not live
(no entitlement), and goes under Studio when it ships. Custom scales and chord layouts are
gated (they are Theory's) but stay out of the copy until they are polished.

**Trademark names.** The voices were shown as Rhodes, Motown and Höfner. They are now
Electric Piano, 60s Soul and Violin Bass everywhere they are displayed, tooltips, help and
credits included; the ids (`rhodes`, `bass_motown`, `bass_hofner`) are unchanged because
saved songs and setups key on them. **Still named Motown**: the Motown groove, bass style and
melody style. Those names are keys of saved patterns; renaming them is a migration and is the
owner's call.

### Pro content in a free build

A song or setup made with parts the install does not own opens without losing
anything: the build substitutes **at play time** and never writes the substitution back
(`proKeepSetup` / `proKeepSong` hand the original back at the next save for every field the
user has not touched since loading). One banner names what is missing, by pack ("a sound
from the Sounds Pack, a scale from the Theory Pack"), and opens the store. The older
`freeApplyLimits` rewriting the mode, voice and step count destroyed the choice on re-save
and is what this replaces. Dropping a pack puts the stand-in in (Saw for the chords, Close
voicing, the first free scale, the Linn, the Aux off) and buying it again does not need a
relaunch.

### Testing

`node tests/tier/registry.test.js` (tables, the matrix of each module alone, the bundle offer
at every count of owned modules and at the price edges, the copy limits, two lints) and
`node tests/tier/probe.js` against the served page or `dist/` (what the page really does: the
locks, the sheet, a simulated purchase with no reload, the store screen, a setup made with
every pack opened on a free build, the iReal limits). The Swift and the real purchase flow
are **not built or run**: `docs/app-store.md` and `docs/phone-test-checklist.md` section 6
are the steps on a Mac.

### After launch (Phase 2)

**Key colour mapping: built (4.9.9.9.9.8.9o).** The chromatic key-to-hue table
`MH_HUE` gets a start offset so any key can be red, and a circle-of-fifths
ordering that reuses the same table (`khIndex`: the semitone distance from the
red key, times 7 mod 12 for fifths). Settings > General > Key colours has the two
modes, a "Red is" picker and a twelve-key strip drawn from the same function the
page colour is, so it cannot disagree with it. Rotating (**Red is**) is free;
the circle-of-fifths order is the Theory Pack's, and without it the chromatic mapping plays
and what is saved is kept.

**Master EQ: built (4.9.9.9.9.8.9p).** Three bands on the whole mix: a low shelf
at 120 Hz, a peak (Q 0.9) that moves from 200 Hz to 5 kHz, a high shelf at 8 kHz,
plus or minus 12 dB. It sits between the glue compressor and the limiter, so a
boost cannot get past the limiter, and the Master Bus switch leaves it in (the
switch bypasses the glue, room and limiter; the EQ is the user's tone, like the
volume). Opened from **EQ** on the master strip in the mixer. Free: the doc's
tier table has no row for it, so it is not locked; one entry in `FREE_LIMITS`
would. (The packs brief lists a 3-band EQ *with a low cut* under the Studio Pack, "when
built". This one has no low cut and stays free; the low-cut version is what moves.) Saved as a device preference (`modo-mastereq`) and in a project file.
Native: three parameters appended to the master message (`eqLo`, `eqMid`,
`eqMidHz`, `eqHi`), a band is not run at all while it is at 0 dB, the gains are
smoothed and the coefficients rebuilt once a block. `native/modsynth/eqtest.cpp`
holds the coefficients to the browser's own `getFrequencyResponse` (within
0.05 dB over five settings and ten frequencies) and the bus to what the filters
should do to a tone (0.5 dB); an EQ at zero is bit-identical to none.
**The panel draws what it does (4.9.9.9.9.8.9v).** A curve from 20 Hz to 20 kHz,
plus and minus 12 dB, filled to the 0 dB line, with a dot for each band that can be
dragged (a shelf up and down, the peak both ways). The sliders run High, Mid, Mid at,
Low, top to bottom, the way a spectrum reads. `eqResponseDb` is the same cookbook
filter the nodes and the native EQ use, evaluated on the unit circle, and
`tests/eq/curve.test.js` holds it to the browser's `getFrequencyResponse` (the table
`eqtest.cpp` uses), so the picture, the web nodes and the native EQ answer to one set
of numbers.

**Every part has one too (4.9.9.9.9.8.9u).** An EQ button on each mixer strip (under
M and S) opens the same panel for that part: the same three bands, after the part's
mõdFX chain and before its pan, so the pad's filters and the strip's EQ are
independent. State is `window.sqMixEq` (`{part: {lo, mid, midHz, hi}}`, absent =
flat), the engine's copy `mix.eq`, and it rides in a setup (`mixEq`) and in undo with
the rest of the mixer. Web: three biquads built the first time a band moves and
taken out of the graph again once flat (a biquad at 0 dB is the identity, so both
swaps are seamless), so eight idle strips cost nothing. Native: four parameters
appended to the mõdFX message (`eqLo`, `eqMid`, `eqMidHz`, `eqHi`); the stage is the
last thing in `MixFx` and runs whether or not the chain is in (the chain's own
early-out would otherwise have skipped it), and is not run at all while flat.
`eqtest.cpp` holds it to the browser's filter responses with the chain out and in,
and checks flat is bit-identical to none. Not built: the sliders are mappable to a
controller only while a panel is open.

**iCloud sync: built, off in every build until the iCloud capability is on
(4.9.9.9.9.8.9q).** CloudKit, the user's own private database: the developer has
no access to what is in it, and there is no server and no account of ours.

*What syncs:* the setlist (`prism-sl`, not the demo song), saved setups
(`modo-setups`), saved mõdSynth patches (`modo-msx-user`), imported iReal charts
(`modo-ireal-songs`), and two look-and-feel choices (`modo-keyhue`,
`modo-mastereq`). Not synced, on purpose: anything that is about a device (MIDI
ports and routes, latency, haptics, background play, the Free/Pro test switch),
and the sampler's own recordings (large, and in IndexedDB; the next piece if it is
wanted). The table is `SYNC_COLLECTIONS`; adding a key is one line and a test.

*The unit is the item, not the key.* A whole-key sync cannot tell "deleted here"
from "has not arrived yet", and two devices each adding a song would lose one. So
each song, setup, patch or chart is one record, and the engine finds what changed
by comparing what is stored with what it last saw (a hash per item, kept in
`modo-sync-meta`, which is itself never synced). New or changed is an upsert,
stamped with the time it was noticed; gone is a delete. The rules for two devices:
a remote change replaces the local item unless the local one has an unsent edit
that is newer; a remote delete removes the item unless it has an unsent edit; a
push the server refuses because the record moved on comes back as a conflict, and
the newer by `modified` wins. Never a merge of fields. Order in a list is not
synced (a song that arrives goes to the end). Two devices' clocks are the arbiter,
so two edits seconds apart on clocks that disagree can go the wrong way.

*Pieces.* `modSyncCreate` (between `SYNC ENGINE` markers in `index.html`) is plain
JavaScript with its dependencies passed in. `modSync` is the page's glue: the
switch (Settings > General > iCloud, default **off**: someone's songs going to a
server is not for a default), a hook on `modStore.setItem` that schedules a pass 4
seconds after a synced key is written, a pass on launch, whenever the app comes to
the front or the network returns, and every 5 minutes while it is open (there are
no push notifications; that would need the remote-notification background mode and
a subscription, and is the first thing to add if five minutes is too slow).
`ios/App/App/ModCloud/ModCloud.swift` only moves records: `status`, `push` (with a
base version per record, which is how a conflict is found), `pull` (by change
token, kept in UserDefaults; an expired token reads the zone again). One private
zone `modriff`, one record type `Doc` (`payload` as an asset so a long song is not
stopped by the 1 MB record limit, `modified`, `v`); record names are hashed
ASCII, because an item's id can be a patch name in any script.

*Why it is off.* Everything in `ModCloud.swift` that touches CloudKit is inside
`#if MODRIFF_CLOUDKIT`. Asking CloudKit for a container in an app signed without
the iCloud entitlement raises an exception and ends the app, and CloudKit is not
available to a free (Personal Team) account. So no build has it until you do this,
once, with a paid Developer Program membership:

1. Xcode > the App target > Signing & Capabilities > + Capability > iCloud > tick
   **CloudKit** and add the container `iCloud.com.handelmusic.modriff`.
2. Build Settings > Swift Compiler - Custom Flags > Active Compilation Conditions:
   add `MODRIFF_CLOUDKIT` (Debug and Release).
3. Run on two devices signed in to the same Apple ID, turn on Settings > General >
   iCloud on both. CloudKit makes the record type and its fields in the
   *Development* environment the first time a record is saved.
4. **Before the App Store build:** CloudKit Dashboard > the container > Deploy
   Schema Changes to Production. Without this the shipped app cannot save a record.

*Verified here:* `tests/sync/engine.test.js` runs the engine against a fake
CloudKit that refuses a save made against an old version, with simulated devices:
a song arriving once and a quiet second pass, edits to different songs on two
devices both surviving, a delete that stays deleted, the later of two edits to one
song winning either way round, an unsent edit against a remote delete, preferences
as a whole value, what is left alone (the demo song, a damaged value, items with no
id), a failed push waiting for the next pass, a pass asked for mid-pass, a first
sync on two devices that each have things, and a fuzz of three devices with random
edits and deletes that must end identical (40 rounds). Five deliberate breakages
of the engine were each caught. The page glue was driven in a browser with a
stand-in plugin (off by default, on, a write schedules a pass, an unsynced key does
not, a remote item arrives, signed out, a network failure, off again). The Swift
builds for the simulator with and without the flag. **Not done:** a single record
has never been saved to CloudKit, because there is no entitlement to do it with.

Not built: extra themes and melody density controls from the brief.

---

## 5. Long-term goals (parked, not scheduled)

Requested by users; nothing here is started, and none of it holds up 5.0.0.

### Just intonation

**Spike built (4.9.9.9.9.9.8), web chord part only.** Master Tune has a
"Chord intervals" Equal / Pure switch (`tuningMode`, saved as `modo-tuning`).
Pure adds a cents offset from `TUNING_JI5` (5-limit, indexed by semitones above
the chord root) to each chord tone on `.detune`, in `_webChordOn`, *before*
`glideApply` so a glide settles on the tuned pitch (swapping the two calls was
tried: the glide slides the tuning away and every voice ends at 0 c).
`tests/tuning/probe.js` counts it: the oscillators' offsets are 0 / -13.69 /
+1.96 c for a major triad and 0 / +15.64 / +1.96 for a minor, and a sawtooth
triad's third band beats at 10.5 Hz with depth 0.78 in Equal and 0.04 in Pure
(21x less).

**Not done, in the order they matter:** bass and melody do not follow it (they
should read the same root from `_blChordWin`); mõdSynth and the native graph
path are untouched (`engine.js` truncates the note to an integer, so it needs a
separate `cents` on the `on` message, in `dsp.js` and C++, null-tested); the
arp is untuned; the dominant seventh uses 9:5 rather than 7:4 (needs the
chord's quality); the diminished fifth uses 45:32; the root is equal-tempered
per chord, so a progression drifts a syntonic comma (21.5 c) between chords
(the adaptive-root mode below). It is free in this build (no `FREE_LIMITS` row names it, so it is free by
omission). The natural home is the Theory Pack, whose copy already says "future
theory additions included": a row in `FREE_LIMITS`, its `FEATURE_MODULE` entry and
a bullet in `MODULE_COPY.theory`, added when it is decided and built far enough
to be listed. A free "hear the difference" button on one held chord is the
suggested taste.

The original note, from before the spike:

Today every pitch is 12-tone equal temperament: `440·2^((n−69)/12)` is
spelled out in more than one place in `index.html` (`blFreq`, the sampler's
range maths near `masterTune`, the clip pitch detector), in `modsynth/dsp.js` and in its C++ port. The only
tuning control is `masterTune` (A4 = 432, 440 …), which moves all twelve notes
together and changes no interval. Sampled voices are pitched by playback rate
from the nearest MIDI note, so each would need a cents offset per note.

What was asked for is what the Yamaha Harmony Director (HD-200/300) does for
band and orchestra teachers: chords sounded pure, so the beating between
sustained notes goes away (a major third about 14 c flat of equal, a fifth
about 2 c sharp). A sketch of how it would go here:

1. **One tuning table** — 12 cent offsets from a root, with presets (equal,
   5-limit just, 7-limit, Pythagorean, quarter-comma meantone). Every pitch
   calculation reads it; the same single-source-of-truth shape as `PARTS`.
2. **Chord-following, not a fixed key.** Just intonation tunes intervals
   against a root, so a fixed "C just" table is wrong the moment the
   progression leaves C. The root comes from the chord timeline
   (`_blChordWin` / `window._blOnChord`), which bass and melody already
   follow. Static first, adaptive second — adaptive is the point.
3. **Apply per engine.** Web oscillators and sampled voices take it through
   `.detune`; mõdSynth takes it as a per-note pitch offset in `dsp.js` *and*
   C++, with `tests/modsynth/null.test.js` confirming they still agree.
4. **Optional** — a drone / tuning-reference tone, as the Director has.

Open question: glides and pitch bend sit on `.detune` too, so the tuning
offset has to be summed with them, not set over them. Where it pays off is
sustained chords (pads, organ, strings); on drums and short samples it does
nothing. A cheap first spike: pad, organ and chord voices on the web build with
an Equal/Pure switch, to hear it before touching the native engine.

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
   app icon and `.playback` audio (sound with the silent switch on). Written
   since: the Swift audio host, haptics (4.9.9.9.9.8.9i), IAP, text recognition
   for picture imports (4.9.9.9.9.8.9m). Every build needs a Mac with Xcode: `npm install`, then
   `npm run ios` (builds `dist/`, syncs it into the project, opens Xcode).
7. **Remaining parts native, then the clock** — ships as 5.0.0. Open before
   that: the sampled voices dropping out in the background (parked for the next
   session), and the things that need a paid developer account or a phone and
   cannot be settled from here (CloudKit, StoreKit, MIDI hardware:
   `docs/phone-test-checklist.md` lists what to check on the device).
