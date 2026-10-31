# Screen layout, 5.0: the plan

Written after a design session with the owner. Nothing here is built. It sits
beside `docs/vertical-timeline.md` (the lyrics and chord-length timeline, which
this plan puts inside a larger layout) and `docs/v5-architecture.md` (the native
work). Numbering restarts at 5.0 (CLAUDE.md, "Numbering").

A clickable mock of every screen below is `docs/layout-5.0-mock.html` (one file,
open it in a browser; it needs the network only for two Google fonts). It is the
proposal drawn at Pro Max size (430 x 932 pt), not the app. Where this file and
the mock disagree, this file is right.

## Why

The owner is spending the iPhone Pro Max screen on chrome and small targets.
Measured on a 430 x 932 viewport, before this plan:

| what | measured |
|---|---|
| tab bar | 35 pt tall |
| transport bar (key, tempo, Play, rate, Song, beat strip, parts row) | 115 pt |
| sub-nav row docked above the tabs (Accomp, Songs, Sound) | 31 pt |
| bottom chrome in total | 150 pt, or 181 pt with a sub-nav docked |
| Drums / Bass / Mel / Arp / Chords switches | about 29 pt tall |
| Hold, Glide | about 28 pt; Mod about 22 pt |
| chord rhythm bar (three stacked buttons) | 86 pt |
| the Live page | one scroll of about 3,170 pt |

Apple's minimum target is 44 pt. The owner likes the tabs along the bottom, where
the thumb is, and wants to keep that.

The same part is spread over four places: its play surface on Play, its
sequencer on Accomp, its voice on Sound, its strip on the mixer. And the chord
rhythm exists only on Play, so Studio has nothing for the chord part.

## Decided

1. **Tabs along the bottom: Live | Studio | Song | Sound | caret.** Live and
   Studio become two tabs; the switch leaves the transport bar and the page.
   Settings stops being a tab and becomes the first row of the transport sheet
   (below). Accomp stops being a tab. Tabs are 52 pt tall.
   - `body.mode-basic` stays the plumbing. The Live tab sets it, the Studio tab
     clears it, and Song and Sound keep whichever was last (47 `advanced-only`
     lines in `index.html`, 23 of them on Play and 2 on Songs, so the coupling is
     small; the 194 `mode-basic` lines are mostly Play styling).
   - The `L` keyboard shortcut, the tutorials' `_tutView`, the tour and Find's
     `_findGo({tab:'accomp'...})` all name the old tabs and have to move with them.
2. **Every part is one page** with the same order: pattern and patch pickers,
   mode (Generate / Arrange / Play in), the roll or grid, then the keys or pads to
   play it. **Studio** shows one part at a time, the whole page. **Live is the
   whole stack, exactly the widgets it has today** (see below), not a cut-down
   version of Studio. **Chords gets a pattern editor** like the others: the chord
   rhythm roll (`rhyEdit`, `crEditOpen`) drawn on the page instead of in a sheet.
   Drums (with its Aux layer), Bass, Melody, Arp, Chords, Sampler and mõdFX are the
   part pages.
   - **A part page keeps every control its parts have today; the layout only
     decides where they sit.** The Sampler is the one that looked cut down in the
     first mock (twelve blank pads), so it is spelled out: the pad count, the pads
     with their sample names, Hold, Roll, Stop, Load and Trim, Bank (User and
     Preset, A to D), quantize with triplets, patterns 1 to 8 with Rec, Cap, Play,
     Clear and Undo, pattern length, then the selected pad's Mode, Reverse, Sync,
     Key, Warp, mute group and its mõdFX sends (`ps-*` in `index.html`). The pad
     count keeps working as written (`psSetLiveN`, 1 to 16, laid out by `PS_ROWS`:
     one pad is one big pad, twelve is four rows of three); the one change is that
     pad height grows as the count falls, where Live fixes it at 72 pt today. Trim opens
     the sample editor (record, trim, tune, slice onto pads, step chance, roll
     velocity, Euclidean fill). Record, Resample and Library stay in the transport
     sheet. The same rule holds for Drums (groove and kit, layers, Aux), Bass,
     Melody and Arp.
   - **Live keeps all of its widgets** (`LV_STD`): Chords, Melody, Styles, Sampler,
     mõdFX, the Drum, Aux, Bass and Melody grids (the last two with their Generate,
     Arrange and Play in controls) and Endings, in that order, still reordered and
     chosen with Add / reorder widgets (`liveLayout`, a Studio Pack feature, not
     changed here). A Studio part page is that widget's real element at full size,
     moved and not copied, as the Live widgets are moved in from Accomp today.
3. **Chrome "B": the bottom parts row picks the part in Studio.** In Live it is
   the five on/off switches it is today. In Studio, a tap selects that part's
   page; a tap on the part already selected switches it on or off. There is no
   part strip on the page. Sampler and mõdFX, which are not in the bottom row,
   are reached from a "Sampler, FX" menu in the page header.
   - The risk is the double duty on one row. It has to be tried on a phone.
4. **A song carries its sounds by default.** Saving a song saves its chart, its
   words and the sounds it was written with. A per-song switch ("Recalls sounds" /
   "Keeps my sounds") decides whether loading it changes what you hear. Setups
   become starting templates, and the setlist, Setups and the saved-pattern banks
   share one Library page under Song.
5. **The words live on the chord** (`slot.lyr`, `slot.ln`) and each chord keeps
   its length in beats, as `docs/vertical-timeline.md` Step 1 says. A `[C]word`
   chord sheet is an import path, not the stored form.
6. **No song ribbon.** A strip at the top of Live and Studio (the words and chord
   of the moment, a tap to open Stage) was drawn and dropped: it cost 56 pt on
   every screen. The transport already has what a player needs mid-song, the Song
   switch with a section arrow on each side (`ft-sect-prev`, `ft-song-btn`,
   `ft-sect-next`, shown once a song is loaded), and it stays as it is. It is a
   full row: in the mock it fits only because the key's mode name shortens to
   "Maj", which is what the real bar already does when it runs out of room.
7. **The melody strip is taller** (128 pt in the mock against 92), and the chord
   pads are taller too (124 against 104, from the height the ribbon would have
   cost). The pads are 7 across at about 54 pt wide, so more height makes them
   narrower-looking, not wider: if "skinny" means narrow, the only wider pad is a
   4 + 3 grid on two rows, which costs a row. The strip's room is for per-finger pitch
   and tone on the strip, MPE style, which is **not built** and was held for
   after launch (`docs/vertical-timeline.md`, "Held for after launch"); this only
   reserves the room. Two things to settle then: iPhones without 3D Touch report
   no touch force, so pressure would have to come from finger position or contact
   size, and a taller strip is still short for a vertical tone axis, so landscape
   is the real answer for it.
8. **Stage and the Timeline are add-ons, in the same pack.** Stage is the vertical
   timeline (a line of words is a card, a chord a column as wide as its beats, a
   strip of beat ticks coloured by function) shown full screen with no other
   chrome: big type, A- / A+, transpose, a section footer, a playhead and the
   sounding chord lit, scrolling to keep the current line a third of the way down.
   It is the old Perform page, full screen. It is reached from a **Stage button at
   the top of Perform**, with an Add-on tag; without the pack it opens the pack
   sheet (`freeBlocked`, naming the pack). The Timeline (editing the words and
   lengths on the cards) is the same pack. A free player keeps Perform and Build
   as they are today, with the tiles.
9. **Song gets the Sound-style sub-nav**, a single full-width row of three:
   **Build | Perform | Library**. Build is today's Build (with a Timeline | Tiles
   switch once the pack is owned). Perform is today's Perform, and **Chart stops
   being a page and becomes a view of Perform**, Tiles | Chart | Timeline, since it
   is the same song seen another way (the Timeline view is the add-on). Library is
   new (setlist, Setups, pattern banks). If a Chart page of its own is wanted, the
   row takes four entries at this label size, which is the most it holds.
10. **The transport sheet stays, and the caret is its handle.** The sheet
    (`ft-more-menu`) holds File, MIDI, Capture (chords, melody, bass, pads),
    Sampler, Export (Bounce, Stems, MIDI), Undo, Redo, Metronome, Snap,
    Randomize, Find, Setups, Theme, Tutorials, Guide and Shortcuts, and it all
    stays. It loses one row, Live / Studio, which are tabs now, and gains Settings
    as its first row. The handle moves from a band above the transport (about 24 pt
    of height, which the 148 pt bottom stack in the table below does not include)
    into **the fifth slot of the tab bar**: a red caret pill in a 58 x 52 pt target.
    A swipe up on the transport row could open it too.

## Nothing is lost from Songs

Checked against the markup of today's Songs page (`#page-songs`):

| today | in 5.0 |
|---|---|
| Build: title, Save, the File menu (share link, chord .mid, print, import a chord sheet, export and import the setlist, +Rhythm, Chart 8ths, Clear), key row and the nine modes, sections card, chord editor, add-a-chord, progression library | Build, unchanged |
| Build: the setlist panel at the foot | Library |
| Perform: the song banner (title, Prev and Next section, Save Song, Save Settings, transpose), Endings (Ritard, Tag, Big fin, Fade, Cold), the practice trainer (Speed up, Next key and its interval, Loop bars), the setlist arrows, the tiles | Perform, unchanged; every control stays one tap, none hidden in a menu |
| Perform: the setlist panel at the foot | Library |
| Chart: the chord chart with guitar, ukulele or piano diagrams, Print / Save PDF | a view of Perform |
| Setups (in Settings) | Library, and a Setups chip in the transport sheet |

What does change: Chart is a view and not a page, and the Library gathers the
three setlist and Setups places into one. Perform's page is long (banner, five
control rows, then the tiles); it scrolls, as it does today.

## Which pack is open

There is no Performance pack today. The modules are Sounds, Sampler, mõdSynth,
Groove, Theory, Practice and Studio (`MODULE_ORDER`), with eleven StoreKit
products and bundle tiers that count how many you own. Two ways to do it:

- **Put Stage and the Timeline in the Practice Pack** (rename it if "Performance"
  is the better word). It already owns the trainer (Speed up, Next key, Loop bars)
  that lives on the same Perform chart, so the pack becomes "everything for
  working a song". One table row (`FEATURE_MODULE`), no new product, no new bundle
  arithmetic.
- **A new Performance module.** An eighth module means a new StoreKit product and
  a change to the bundle tiers in App Store Connect, which cannot be settled from
  here.

Recommendation: the first. The owner decides.

## What it does to height, by measurement of the mock

Bottom stack: transport 48, parts row 48, tabs 52.

| screen | today | proposed |
|---|---|---|
| Live | 150 | 148 (the page is longer: about 3,700 pt for the full stack at 44 pt targets, against about 3,170 today) |
| Studio, chrome B | 181 | 148 |
| Studio, part strip on the page (A) | 181 | 200 |
| Studio, no parts row and a strip (C) | 181 | 152 |
| Song, Sound | 181 | 198 |

Honest reading: Live is flat but with 44 pt targets, chrome B wins about 33 pt in
Studio, and Song and Sound get slightly worse because their sub-nav moves from a
dock into the page (dock it above the tabs as today to fix that). Roll cells stay
about 23 pt wide (16 steps in 398 pt); they are for drawing, not tapping, and
landscape is the real fix for long patterns, not bigger cells.

## The order, each step shipping on its own

0. **Numbering** (this change): CLAUDE.md restarts at 5.0.
1. **Words as data** (`docs/vertical-timeline.md` Step 1): `slot.lyr` / `slot.ln`,
   written at import, in `_songSig()`, a Lyric field in the chord editor, node
   tests, a save / load / share round trip. No new screen. First build under the
   new numbering: 5.0.
2. **Target sizes** with no restructuring: every control 44 pt or more, the chord
   rhythm bar as one row, the beat strip folded into the Play button's ring or a
   3 pt line. Measure each (CDP, real touch).
3. **Live and Studio as tabs**, the gear sheet, Accomp's sub-nav gone but its
   page still reachable. Retarget the shortcut, tutorials, tour and Find.
4. **Part pages**: Accomp's Drums, Bass, Melody and Arp pages become Studio part
   pages (the real elements are moved, not copied, which is how the Live widgets
   already work, see `LV_*` in `index.html`); the Chords page with the rhythm
   roll; chrome B on the parts row. MIDI mappings and saved layouts
   (`modo-live-slots`) migrate, they are not reset.
5. **The timeline renderer, read-only, and Stage** (Step 2 of the vertical
   timeline), the Stage button on Perform. The tiles
   stay behind a switch until the timeline has earned the default. Screen wake
   lock needs a Capacitor plugin and Swift that a Mac has not compiled: say it is
   unbuilt until it is confirmed.
6. **Editing on the timeline**: the panel, the beat nudge, Even split, then drag
   (Step 3 of the vertical timeline).
7. **Library and songs that carry their sounds.** The per-song switch, Setups as
   templates, the pattern banks in one place. Existing saves load as "keeps my
   sounds".
8. **Tap the changes** (Step 4 of the vertical timeline).
9. Gates and copy (`FREE_LIMITS`, `FEATURE_MODULE`, `MODULE_COPY`) only for what
   works, then this file and `docs/v5-architecture.md` brought up to date.

Landscape layouts for the long rolls and for the timeline on an iPad are later
and are the same renderer turned on its side.

## Do not break

- The `modo-` storage keys. A key that has to move is a read-old-write-new
  migration (CLAUDE.md).
- `PARTS`, `_partBuses` and `_partDest` stay the single sources for part
  membership, buses and stems. The part pages read them; they do not copy them.
- The Practice trainer (Speed up, Next key, Loop bars) works on timeline columns
  as it does on tiles today (`pracLoopTap`, `songChartTap`).
- No emoji. The mock uses none; the gear and the Stage arrows are drawn.
- Tests that cover the neighbours: `tests/chords/*.test.js`,
  `tests/import/probe.js`, `tests/practice/probe.js`, `tests/tier/*`.
  `tests/song/probe.js` has two failures that were there before this plan.

## Still open

- Whether the shared-row double duty of chrome B survives a real phone.
- Whether mõdFX belongs under Sound as well as in the part menu.
- Which pack (above), and its name.
- What a free player sees of the words they imported. The words are stored either
  way (Step 1 is data). Typing them into the chord editor's Lyric field and
  seeing them on a tile are the choices; the Timeline and Stage are the pack.
- The Song sub-nav costs 50 pt in the page, as Sound's does; docking it above the
  tabs would take it back.
