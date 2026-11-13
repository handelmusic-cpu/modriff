# 5.0 — architecture plan

> Built sections (the chord model, MIDI mapping, the engine door, knobs, effects rack, native mixer, graph interpreter, haptics, bounce) are in `docs/archive/v5-architecture-built.md`; `grep -n` it, never read it through. This file keeps the decisions, what is open and the purchase plan.

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
| 3 | Native wrapper, audio, haptics | **Implemented.** Swift/AVAudioEngine hosts the C++ DSP, graph voices, effects, capture and native scheduling for every band part, click, rhythm and sampler patterns. Public Play claims one owner; only engine/readiness failure uses page recovery. See `docs/native-scheduling.md` and device checks 45–54. |
| 4 | In-app purchase | **built, not run (4.9.9.9.9.9.7)**: seven modules and a bundle, eleven StoreKit products (section 4). The page side is measured; the Swift builds for the simulator (6.9.9.3, no errors) and the purchase flow is unrun |
| 5 | Phase 2 | key colours, master EQ and iCloud sync **built** (4.9.9.9.9.8.9o to 9q); see "After launch". Extra themes and melody density not built |

**App Store submission** (listing text, privacy answers, review notes, screenshots, and the Xcode items still open) is in `docs/app-store.md`. The public site it links to (landing, support, privacy, terms) lives in its own repo at modriff.com.

**Mac Live (6.9.9.9.9.9.9.4).** In the Catalyst app at window widths of 1000px and up, Live uses two independently scrolling work areas: Chords, Melody and mõdFX on the left; Styles, Sampler, recording and the remaining widgets on the right. The existing widgets are moved once, not duplicated; Studio restores their original hosts. Playing targets, style labels and transport switches are larger. Expanded chord controls keep Chord Forms below the pads, so the reference no longer squeezes the grid sideways. Narrow Mac windows return to one column in the saved widget order; the iPhone layout is unchanged. `tests/mac-layout/live.cjs` drives the built page at 820–1920px and checks expanding, independent scrolling, Live/Studio remounting, a chord click and the phone layout.

**Versioning, as decided:** the numbering restarts at 5.0 with the first build
after `4.9.9.9.9.9.9f`: `major.minor` and an optional trailing letter for a
follow-up, no third dotted part (the rule is in CLAUDE.md, "Numbering"). "5.0.0 is
the native App Store release" is retired; the App Store build carries whatever
label is current when it goes. The next piece of work, the screen layout (tabs,
the Live and Studio split, parts as pages, lyrics and Stage), is planned in
`docs/layout-5.0.md`.

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

   **Implemented.** The host builds for iOS Simulator and runs native DSP, effects, capture and all scheduling lanes. The current coverage and remaining device listening checks are in `docs/native-scheduling.md`; earlier bring-up measurements are historical.
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

**Leaving the app (6.9.3).** Background play is still off: leaving pauses. What changed is
who silences the engine. The pause used to be the page's alone (`_bgAway` →
`stopEverything`), run by a web view WebKit throttles the moment the app is left, while the
native engine kept playing whatever was already queued and iOS cut the web context off
mid-render: sputter, parts missing, loose timing. `SceneDelegate` now calls
`ModEngine.appLeft()` first, which queues a `panic` for the mõdSynth parts, fades the mixer
to zero and pauses the engine; `appReturned()` restarts it and fades up. The fade runs on
its own queue, because the main queue stalled in the simulator once the app was left (the
first version used it and never paused the engine). Measured in the simulator (log
lines `[ModEngine] leaving the app`, `left the app: ... paused (running=no)`, `back in the
app: engine running=yes`): the fade finished about 150-215 ms after leaving, not the 36 ms
asked for, since iOS coalesces timers in the background. Heard on an iPhone 17 Pro Max: quiet at once on
leaving, resumes together on return, same with a sampled voice.

**Where background play stands (6.9.9.9.9.9.9.7i).** Native sound runs now prepare voice banks and claim one native transport owner automatically. Drums, bass, arp, melody and the song share its first bar; page schedulers are suppressed, native mirrors drive the UI, and stale starts cannot revive after Stop. The host continues without page timers, with no scheduler handover on leaving/returning. Native patch/sub, tuning/glide, MIDI observer and next-bar chart revision paths are implemented.

Custom sampler instruments/patterns, metronome/simple rhythm, standalone chord rhythm, queued/chained drum patterns, practice key/tempo changes and chart-position jumps now remain native. Page recovery is reserved for actual engine/readiness failure. Background MIDI out/external clock remain outside v1. Background permission follows a completed native claim, not a debug storage flag.

Audio session interruption/route recovery remains in the native host. Mac event/audio/ownership tests and Simulator builds pass; device checks 45–54 remain not heard and do not block shipping. Current decisions and fallback coverage are in `docs/native-scheduling.md`; reproduction and handoff are in `docs/native-audio-handoff.md`. The original measurements remain in `docs/archive/v5-architecture-built.md`.

## 4. In-app purchase: seven modules and a bundle

**Decided (owner, 4.9.9.9.9.9.7):** the one-product plan of 4.9.9.9.9.8.9 (`modriff_pro`,
never released) is replaced by **seven non-consumable modules and a bundle**, eleven
products in all, every one Family Sharing on and universal across iPhone/iPad/Mac. The
prices live in App Store Connect and are read from the store at run time, never written
in the page. No subscriptions, ads, accounts or backend.

| Product ID (`Handel.modRiff.` + …) | Display name | Price | Shown to |
|---|---|---|---|
| `sampler` | Sampler Engine | $5.99 | everyone |
| `synth` | mõdSynth Engine | $4.99 | everyone |
| `groove` | Groove Pack | $3.99 | everyone |
| `theory` | Theory Pack | $3.99 | everyone |
| `practice` | Practice & Perform Pack (was Practice Pack until 5.9a) | $3.99 | everyone |
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
| Pure tuning | Equal temperament | **Theory**: Pure (just) intonation of chords, bass, melody and arp |
| Voices | Sine, Saw, Square, Tri, SuperSaw, the Upright and Electric basses, Acid, 303 | **Sounds** (`piano`, `rhodes`, `organ`, `pad`, `vibes`, `bass_motown`, `bass_hofner`); **Sampler** (every other recorded voice); **mõdSynth** (`modsynth`) |
| Sampler pads | none to play; the first 9 pads of PA are shown locked and each plays its sample softly twice (`modo-previews`) | **Sampler**: every bank, all 16 pads, your own clips |
| Slice a clip onto pads | — | **Sampler** (`smpSliceToPads`): Hits, or 4, 8, 16 equal parts, from the sampler editor of a pad |
| mõdFX pad | Filter Sweep, Tape Stop, Dub Delay | **mõdSynth**: the other patches, the X/Y menus, saving your own |
| Drum kits | Linn, 808 | **Groove**: all others, the Aux channel |
| Grooves | 4/4 Basic, Shuffle, Half-Time Rock, 4/4 Funk, House, 3/4 Waltz, 12/8 Slow | **Groove**: the rest, including Bossa Nova |
| Bass / melody styles | Rock, Funk / Hook, Rock | **Groove**: the rest, and Arrange |
| Meters, steps | 4/4, 3/4, 12/8; 12, 16 or 24 (one bar of 12/8) | **Groove**: any meter, up to 64, a step length per part |
| Live page | the standard layout | **Studio**: adding, swapping, moving, removing widgets |
| Audio / MIDI export | first 30 s (fading out) / first 4 bars | **Studio**: the whole take; stems |
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

**Independent sequencer timing (6.9.9.9.9.9.9.5).** Drums, bass and melody start with
step count and rate linked. A direct rate or step-count edit asks to unlink that
setting and change only the selected part; Cancel preserves both locks and all
parts. Programmatic restores keep the existing linked setters. Counts can be typed
or adjusted beside each grid. Rate labels describe
speed (½× / 1× / 2×), while stored multipliers still describe step duration. Native
rate edits send the selected sequencer its new rate during playback. Independent
step lengths retain the Groove Pack entitlement. Browser checks against `dist/`:
`node tests/seq/independent-timing.cjs`; device listening remains required.

**Step chance, roll velocity and the Euclidean fill (4.9.9.9.9.9.9e), free.** A step can carry
`pr`, the percentage chance that it sounds (absent means 100, so nothing migrates), and a roll note
can carry `vel`, its level as a percentage (the drum grid has had its own `vel` all along). The
step inspector under the drum grid, the bass roll and the melody roll gain a **Prob** control
(steps of ten, tap the value for every time) and the two rolls a **Vel** slider; both fields are
stored only when they are not the default. The chance is rolled each time the step comes round,
at the point the step is fired (`_sqFireLayer`, the bass sequencer and its walking-bass player,
the melody sequencer), never in `sqPlayCell`, so tapping a step to audition it always sounds. A
step that misses is a rest, and ends a bass slide. On the screen, a drum step with a chance has a
dashed border and a roll note a dashed ring, and a quieter roll note is drawn less solid. The
drum row menu gains **Euclid 3 / 5 / 7** (k hits as evenly as they will go over the row, step i
is a hit when `(i*k) mod n < k`: 3 in 8 is x..x..x.) and **Rotate** either way, both undoable
from the toast. `_PR_CELL_KEYS` and the bass phrase capture/apply carry the new fields; drum
clipboard clones carry `pr`. `tests/steps/probe.js` counts it on the real transport (about half the
hits of a 50 % row, half the level at velocity 50, on drums, bass and melody) and was shown to fail
when each of the three play sites was broken in turn. Not done: probability on the arp, a
velocity lane drawn under the roll, and Euclid on the rolls (a roll's rows are pitches, so there
is no single row to fill).

**Slicing (4.9.9.9.9.9.9d).** The sampler editor of a pad has a *Slice onto pads* row: **Hits**
finds the hits in the clip, **4**, **8** and **16** cut equal parts, and the pieces land on that
pad and the ones after it. Nothing is copied: every pad holds the same clip and its own start and
end (what the handles already were), within the window between the handles. Hits are found from
the clip's power in ~6 ms frames, in log units: a jump of more than about 3x in a few frames, the
strongest few at least 40 ms apart, each pulled back to the first sample that is a quarter of the
peak after it. Undo (the toast's) puts back what the pads held, a pad that held nothing included.
Measured in `tests/slice/probe.js`: eight known hits found within 2 ms, and the 15 hits it finds
in the app's own `samples/loops/world/drumset.mp3` all lie within 4 ms of that loop's sixteenth-note
grid. Resample (record what the app is playing into the library) was already there. Not done:
slicing a drum lane or a voice, a count between 17 and 32, and a slice that follows the tempo.

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
   **CloudKit** and add the container `iCloud.Handel.modRiff`.
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

**Built (4.9.9.9.9.9.8, 8a): chords, bass, melody, melody generator and arp; the
Theory Pack's.** Master Tune has a "Chord intervals" Equal / Pure switch
(`tuningMode`, saved as `modo-tuning`). Pure adds a cents offset from
`TUNING_JI5` (5-limit, indexed by semitones above the chord root) to each note.

- *Chords* take it from the message's own root, on `.detune` in `_webChordOn`.
- *Bass, melody, generator and arp* are not handed a root, so the app finds the
  chord sounding at the note's time (`_songChordWindowFor`, the lookup the bass
  and melody already follow) and puts the result in the note message as `tune`
  (cents; an arp block carries `tunes`). `tuningCentsAt` is the one place that
  does it. The web engine adds `tune` to the bass's frequency (so the upright's
  harmonics move with it) or to `.detune` for every other voice. No chord
  window, or a rest, is equal.
- It goes in *before* anything that reads `.detune` as the pitch a note settles
  on (`glideApply`, `_melGlideApply`, the bend's `_bendBase`); swapping the
  order was tried and the glide slides the tuning away.
- **Gated** by the `pureTuning` row (Theory). Without the pack the saved choice
  is kept and plays equal (`tuningOn`), the Pure button is locked, and a tap on
  it names the pack. Nothing is erased.

`tests/tuning/probe.js` counts it. Under C major, every oscillator of a bass,
melody-strip, generator and arp note moves by the table's amount for its
interval over C (E -13.69, G +1.96, D +3.91); under A minor the same melody E is
+1.96 (it follows the chord); with no chord window nothing moves; a block of
C-E-G shifts by exactly {0, -13.69, +1.96}. A sawtooth triad's third band beats
at 10.5 Hz, depth 0.78, in Equal and 0.04 in Pure. A voice built on the graph
recorder carries the shift in its program.

**Not done, in the order they matter:**
- *mõdSynth* is untuned (`engine.js` truncates the note to an integer; it needs a
  separate `cents` on the `on` message, in `dsp.js` and C++, null-tested).
- *The native engine's reading of the shift is unverified.* The shift is in the
  recorded program and `graph.cpp` applies `detune`, but nothing has run a tuned
  voice natively, and a native part that does not play through recorded graphs
  ignores `tune` and plays equal.
- The dominant seventh uses 9:5 rather than 7:4 (needs the chord's quality); the
  diminished fifth uses 45:32.
- The root of each chord is equal-tempered, so a progression drifts a syntonic
  comma (21.5 c) between chords: the adaptive-root mode below.
- A free "hear the difference" button on one held chord, as a taste for those
  without the pack.
- Heard on a speaker: all of the above is measured, not listened to.

**Held notes (6.5, 6.5a).** Listening to an interval needs it to last, and a held
note used to be cut at 10 s (the melody strip) and 30 s (chords), as a guard on a
missed release. Both are `SUSTAIN_DUR`, an hour, now, free to everyone: the voices'
own shaping saturates well below it, so only how long a note can be held changes.
A held voice is reaped when its oscillators end (`reapVoice`'s `held` flag), not on
a predicted time, so a release, a choke and Panic need not know about the queue.
The guard is **Panic** (`panicNotes`, the transport sheet's Held notes group, and
Find): it releases every melody voice, the live chord, the bend glide, and sends an
external synth its note-off, with short fades; clock, drums, bass, arp and song
carry on. **Chord Hold** is the theory pack's (`chordHold`, Theory): with Hold on a
tapped chord pad latches (`_chordLatch`, `chordHoldOn`) until the next chord taken
by hand, Hold off, or Panic; a scheduled chord (a rhythm's re-strikes, the song's)
does not end the latch. Hold itself, on the melody strip and on typed and MIDI
chords, stays free; without the pack a pad does not latch and names the pack once.
`tests/hold/chord-hold.cjs` drives it. Not done: a Safari/iPhone check (a held voice
relies on a second `stop()` overriding the first, which the release paths already
did), looping the recorded voices so they hold past their sample, and the bass
strip's held notes.

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
7. **Remaining parts native, then the clock** — the graph path plays every part behind Settings > Look & feel > Native sound,
   on by default in the app since 6.1d (a stored off is kept; the web build has no engine). The last part of the flip, deleting the Web Audio path, is listed under `docs/phone-test-checklist.md` section 10 (not waited for): a clean
   status line with all eight parts at once, a recorded voice on the melody, and a stem bounce. The screen wake lock for Stage and
   playback is `ModWake` (6.0p, built for the simulator, not yet run on a phone). Earlier notes on this step: — ships under the 5.x numbering. Open before
   that: background play (6.9.4 above: the sequencers have to move to the engine; the sampled voices dropping out was seen on the web path only), and the things that need a paid developer account or a phone and
   cannot be settled from here (CloudKit, StoreKit, MIDI hardware:
   `docs/phone-test-checklist.md` lists what to check on the device).
