# 5.0 — architecture plan

The road from the web app to a native iOS/Mac build, and the four pieces of
work that ride with it. Each section says what exists in `index.html` today,
what changes, and in what order. The order matters more than the details:
two of these pieces are already half-built, and two depend on decisions that
are cheaper to make before code than after.

| | piece | state |
|---|---|---|
| 1 | General chord model | **landed** — model, parser, slot adapter, engine message, tests |
| 2 | MIDI Mapping Mode | designed below; builds on the CC-learn system already shipping |
| 3 | Native wrapper, audio, haptics | designed below; the wrapper seam already exists |
| 4 | In-app purchase | designed below; `window.modBilling` already has the right shape |

The version stays 4.x until the native build ships. Per CLAUDE.md, the move
to 5.0.0 is the owner's call and gets asked for, not assumed.

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

### One musical call to make

The app's `'11th'` quality on a dominant keeps the major third under the 11th
(`0 4 7 10 14 17`). The symbol `C11`, by jazz convention and by Tonal, drops
it (`0 7 10 14 17`), because the 11th sits a ♭9 above the third. The parser
does the latter; the quality menu still does the former. The test pins both
so whichever changes, the note gets updated. Which the app *should* do is a
musical decision, not a parser one.

### Migration, in steps that each ship on their own

1. **Done.** Model, parser, adapter and engine message, additive. Nothing
   calls them yet, so nothing sounds different.
2. **Read through the adapter.** The ten `getIntvs(slot.triadQ, slot.type7,
   slot.ext)` call sites (`grep -n "getIntvs(" index.html`) move to
   `chordFromSlot(slot).ivs`. Identical output for every existing slot —
   `parse.test.js` checks all 720 combinations — so this is a refactor
   to verify with the Playwright pattern in CLAUDE.md, not a redesign.
3. **Write `ivs` onto slots.** A "type a chord" field in the chord builder:
   `parseChordSymbol` → `{rootM, ivs, label: sym, bassNote}`. The old fields
   are still filled in (nearest `triadQ`/`type7`) so the chord grid, colours,
   Nashville numbers and anything else that reads them keep working.
   Saved songs gain an optional field; old saves load unchanged.
4. **Spell from `ivs`.** `_slotExtSuffix` is the one place a chord's quality
   is spelled. It learns to name an interval set, so a slot whose `ext`
   cannot say what it is (the "Dm" + "b9" case) is named from its notes.
5. **Retire `EXTS`** as the source of truth: the quality menu writes `ivs`
   too, and `getIntvs` becomes a thin reader for old saves.

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

### Audio: measure before moving it

The mõdSynth already runs in an **AudioWorklet** (`modsynth/engine.js`), on
the audio thread, not the main thread. So before moving synthesis to JUCE or
Swift, the first job is to find which of these is actually the bottleneck,
with numbers, on a real iPhone:

- **main-thread scheduling** — the sequencer and arp run on JS timers, and
  a long frame (a re-render, a GC) delays them. Native audio does not fix
  this; moving the *clock* does.
- **worklet render time** — the DSP itself running out of its 2.9 ms budget
  (128 frames at 44.1 kHz). Native DSP fixes this.
- **WKWebView's audio** — output latency and session handling (silent
  switch, interruptions, route changes) are worse in a web view than in an
  `AVAudioSession` you own. A thin native output fixes this without moving
  DSP.

They have different fixes, and a native DSP rewrite is the most expensive by
far: 302 factory patches' worth of oscillators, filters and effects in C++,
kept bit-compatible with the web build that keeps shipping.

### The message, wherever the engine is

Whatever ends up native, the app talks to it in one message shape, and the
first one exists now — `chordEngineEvent`:

```json
{ "v": 1, "kind": "chord", "id": 17, "part": "chord",
  "notes": [60, 64, 67, 70, 73, 81], "bass": 52,
  "vel": 0.8, "at": 12.345, "dur": null }
```

- Plain integers and seconds. Voicing, inversions, the slash bass and the
  chord's spelling are all settled in JS, so the engine is told *which notes*
  and never has to understand a 13♭9 — and cannot spell it differently from
  the chord on screen.
- `at` is on the engine's clock. `dur: null` is held until a release naming
  the same `id`.
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
`send`, a native provider can take over one part at a time — chords first,
since they are the least time-critical, the drums last.

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

1. **Chord model step 2** — move the ten `getIntvs` call sites onto
   `chordFromSlot`, verified by ear-equivalent measurement, not by reading.
   Small, safe, and everything after it depends on it.
2. **Chord model step 3** — the "type a chord" field. The first thing a user
   can see from 5.0, and the proof the model works.
3. **`modEngine.send`** — route every voice through one function on the web
   engine. Pure refactor, no native code, and it is the precondition for the
   native engine, for MIDI out of every part, and for stems.
4. **MIDI Mapping Mode** — independent of the native work; can run in
   parallel with 3.
5. **Profile on device** — then decide what native audio needs to be.
6. **Wrapper, haptics, IAP** — together, since none of them can be tested
   without a device build.
