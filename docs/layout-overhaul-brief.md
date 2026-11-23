Plan, do not build. I want an ordered implementation plan for a layout overhaul of mõdRïff that
the owner has agreed to. Launch has moved to the new year, so this lands before release.

Start in a worktree cut from origin/main (the mock and the control inventory below are on main
from PR 544; the owner's main checkout has someone else's staged work in it, so do not use it).

## Read first
- CLAUDE.md (rules: check.sh, measure don't read, `modo-` storage keys, no emoji, no other
  companies' product names, shipping, version numbers).
- docs/live-studio-mock.html: the agreed design. Serve the repo
  (`python3 -m http.server 8777 --bind 127.0.0.1`) and open /docs/live-studio-mock.html at
  430 x 932. Three phones: Live (left), Studio (middle), Mix (right). Try: the part strip on
  Studio, "Edit synth" on a melodic part, the Level/Pan/Rev/Dly/Drv/Mix switch on Mix, a
  channel's name for its full strip, the EQ band buttons, the Master row.
- docs/studio-live-controls.md: every control on Studio's nine pages and Live's default stack
  today, marked against the mock. This is the checklist for "nothing is lost".
- docs/layout-5.0.md: the current layout plan. grep it, don't read it through. Its decision 3
  ("chrome B", the bottom parts row selects pages in Studio) is already reversed in the app by
  6.6: a tap on the row switches a part, a hold or slide opens its page (wirePartRow,
  partOpen, PART_PAGE in index.html around line 48087). That hold/slide is what the new strip
  replaces.
- docs/v5-architecture.md section 4 (from about line 246): the purchase tables and the line
  between free and paid. grep, don't read it through.
- index.html is about 70k lines. grep for the pieces, never read it end to end.

## What is decided
1. **Studio has one part selector**: a fixed strip on top. No sliding, no hold-to-select.
   Buttons are sized by label length: at 375 pt wide, equal buttons leave "Sampler" with no
   margin (44 pt label in a 44 pt button), so give spare width to the long labels.
2. **The bottom parts row only switches parts on and off**, the same on Live and Studio. The
   caret and the hold/slide gestures go away (and the `modo-partrow-hint` toast).
3. **Live stays the full scrolling stack of widgets, still customisable.** The owner rejected
   a non-scrolling Live. Three changes only: chord pads in two rows of four (the eighth pad in
   the mock opens borrowed chords: see the questions), a much taller melody keyboard (380 pt in
   the mock, about 100 pt today), and one "···" button per widget that holds that widget's
   controls, with almost nothing else on the page. Every control in studio-live-controls.md's
   Live table must still be reachable.
4. **Studio part pages take the mock's look**, the piano-roll pages especially.
5. **The Sound tab becomes Mix** with two pages, Mixer and Voices (every part's voice in one
   list, previous/next/pick). mõdSynth leaves that tab.
6. **mõdSynth lives on each part page whose voice is mõdSynth**: a card with patch name,
   previous/next, Random, Patches and "Edit synth", which opens the full editor for that part
   only (Osc 1 to 3, FM, Filter, Env, LFO, Matrix, macros). No second part selector. Check what
   the current Sound > mõdSynth page offers per part (Chords, Melody, Bass, Melody Seq, Arp) and
   keep all of it.
7. **The card and the editor show a wavetable view** drawn from the engine's real frames and
   morph position (modsynth/dsp.js: `buildWavetables`, `FRAMES = 4`), in the part's colour,
   animated only while visible and not at all under reduced motion. The mock's waves are
   stand-ins. Say what it costs on the main thread and how the morph value reaches the page.
8. **Song tab is unchanged.**
9. **The shared macro knobs need a home that says they are shared.** Tone, Reso, Sweep, Width,
   Drift live today in Studio > Chords > Chord voice, and the app's own help says they shape the
   Chords, Melody strip and Arp voices together. Drive is separate (`fx-drive`, every voice) and
   is also a per-channel mixer knob. Decide where each lives; they must not be hidden under one
   part's page.
10. **The channel EQ grows from three bands to five**: HPF, Lo shelf, Mid peak (gain, frequency,
    width), Hi shelf, LPF. HPF and LPF each have on/off, a slope of 12 or 24 dB per octave, a
    frequency and a resonance. **The master gets six**: the same five plus a second movable mid.
    This is new DSP, not layout: plan it as its own slice, in both the page's audio path and the
    native mixer, with a test that they agree. Today: three bands per part (`mixEqSet`,
    `window.sqMixEq`, `openPartEq`) and a master EQ (low shelf 120 Hz, peak 200 Hz to 5 kHz, high
    shelf 8 kHz, plus or minus 12 dB; saved as `modo-mastereq`; native parameters `eqLo`, `eqMid`,
    `eqMidHz`, `eqHi`). Keep every existing value and storage key. Both new filters default to
    off, so every saved song sounds exactly as it does now. State what the extra filter stages
    per channel cost on the audio thread.
11. **The whole EQ belongs to the Studio Pack** (decided by the owner): every part and the
    master, all bands. It is free today (no row in the tier tables), so one new row in
    `FEATURE_MODULE`, the EQ button on each mixer strip shown locked, and a tap opening the usual
    pack sheet. EQ settings already saved in a song or in `modo-mastereq` keep sounding on a free
    build and are read-only there; nothing is erased. Update the Studio Pack's wording
    (`MODULE_COPY`, promo.html, the StoreKit file text, held to 30 and 45 characters), the tier
    tests, the tutorial step that describes the EQ, and docs/v5-architecture.md section 4 where
    it says the master EQ is free.
12. **Where the mock is wrong about the app** (details in studio-live-controls.md). The plan
    must follow the app, not the picture:
    - Melody is two parts today: "Melody" (the strip you play, with Touch Mod) and "Mel" (the
      melody sequencer, own voice, filter and mixer channel). The mock's seven-part strip
      merges them. See the questions.
    - Arp has no piano roll: its page is settings only. The mock invented a roll and keys.
    - Aux is a layer of the Drums page (Kit / Aux switch, a mute each, own kit, groove, lanes
      and eight patterns), not a separate page.
    - Invented in the mock, not in the app: the mõdFX "Chain" card, the drum play pads, a
      per-page Mute. Drop them or choose them on purpose.
    - The mock's Endings had the wrong names. The app's are Ritard, Tag, Big Fin, Fade, Cold.
    - Live's Bounce widget, the slot menus and "Add / reorder widgets" are missing from the mock.

## Proposed: confirm with the owner before planning in detail
- **Mixer**: one 48 pt row per channel (name and value printed on the fader track, then M and
  S), a switch above choosing what the faders control (Level, Pan, Rev, Dly, Drv, Mix), and a
  tap on the channel name opening its full strip (every knob, the EQ). Nothing is removed.
  Measured today at 430 pt wide: nine strips of 372 x 105 pt (984 pt, scrolling), about 114 pt
  of fader travel, knobs 24 x 24 pt. In the mock: nine rows in 604 pt, 304 pt of travel,
  nothing under 44 pt. Known flaw: near the top of the track the fader's bright edge runs under
  the value text.
- **Eight chord pads**: the mock's eighth pad opens borrowed chords. Today Live shows a second
  row of borrowed chords.

## What I want back
1. Slices in build order, each shippable on its own and leaving the app working. For each: the
   tables, functions and elements it touches (file and line), what moves versus what is new,
   the tests that cover it and the ones to add, and how it will be measured on the Mac (numbers,
   not "looks right": target sizes, page heights, no control under 44 pt, the page still passing
   `./check.sh`).
2. Everything that names the old layout and has to move with it: tutorials, the tour, Find
   (`_findGo`, `FIND_TAB_NAMES`), the `L` shortcut, `_tutView`, help text, the phone test
   checklist, the App Store screenshots and app previews.
3. A control-by-control account: every row of docs/studio-live-controls.md and every control on
   today's Sound tab (Mixer, Voices, mõdSynth) with its new home. A control with no obvious
   home is a question for the owner, never a silent removal.
4. Risks per slice: `modo-` storage keys (migrate, never rename), the temporal dead zone for
   new module-level flags (use `var` or `window.*`), the single sources of truth (`PARTS`,
   `_partBuses`, `_slotExtSuffix`), pack gating (`tests/tier`), iPad and the open Duo layout,
   Mac Catalyst, and the audio-thread and main-thread cost of the EQ filters and the wavetable
   view.
5. Which slices can run in parallel sessions without touching the same files, which cannot, and
   which model each needs. Index.html is one file: say how parallel slices avoid colliding in it.
6. The edits to docs/layout-5.0.md that replace the stale decisions (replace, do not append).
7. A short list of questions only the owner can answer.

Do not write code, change files or open a PR. If something in the mock cannot be built as
drawn, say so and say what you would do instead.

## Questions to put to the owner (known already)
- Does the Studio strip have eight entries (Melody and Melody Seq separate) or one Melody page
  that carries both voices?
- Eighth chord pad opening borrowed chords, or keep the second row of borrowed chords on Live?
- Mixer: the row-per-channel design with a mode switch, or something else?
- Should Lo and Hi shelves get adjustable corner frequencies?
- Should a free build show locked EQ bands, or hide the EQ button?
