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

1. **Tabs along the bottom: Live | Studio | Song | Sound | gear.** Live and
   Studio become two tabs; the switch leaves the transport bar and the page.
   Settings, MIDI, Help and Setups open from the gear as a sheet and stop being a
   tab. Accomp stops being a tab. Tabs are 52 pt tall.
   - `body.mode-basic` stays the plumbing. The Live tab sets it, the Studio tab
     clears it, and Song and Sound keep whichever was last (47 `advanced-only`
     lines in `index.html`, 23 of them on Play and 2 on Songs, so the coupling is
     small; the 194 `mode-basic` lines are mostly Play styling).
   - The `L` keyboard shortcut, the tutorials' `_tutView`, the tour and Find's
     `_findGo({tab:'accomp'...})` all name the old tabs and have to move with them.
2. **Every part is one page** with the same order: pattern and patch pickers,
   mode (Generate / Arrange / Play in), the roll or grid, then the keys or pads to
   play it. Studio shows the whole page; Live shows the play surface and a
   pattern picker (the Styles row that Live already has). **Chords gets a pattern
   editor** like the others: the chord rhythm roll (`rhyEdit`, `crEditOpen`)
   drawn on the page instead of in a sheet. Drums, Bass, Melody, Arp, Chords,
   Sampler and mõdFX are the part pages.
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
7. **The melody strip gets the height** that would have gone to the ribbon (about
   56 pt taller keys in the mock, 148 pt against 92). It is for per-finger pitch
   and tone on the strip, MPE style, which is **not built** and was held for
   after launch (`docs/vertical-timeline.md`, "Held for after launch"); this only
   reserves the room. Two things to settle then: iPhones without 3D Touch report
   no touch force, so pressure would have to come from finger position or contact
   size, and a taller strip is still short for a vertical tone axis, so landscape
   is the real answer for it.
8. **Stage**: the vertical timeline (a line of words is a card, a chord a column
   as wide as its beats, a strip of beat ticks coloured by function) shown full
   screen with no other chrome: big type, A- / A+, transpose, a section footer, a
   playhead and the sounding chord lit, scrolling to keep the current line a
   third of the way down. It is the old Perform page, full screen. Reached from a
   **Stage button at the top of the Song tab**.

## Recommended, not yet decided by the owner

- **Stage is free; precision timing is the add-on.** Reading chords and words,
  scrolling, transposing, following the transport and typing the words are what
  every player expects, and the free build already imports chord sheets, which
  would otherwise feed a screen you cannot open. What costs effort to build and
  helps someone learn a song is exact timing: dragging the join, "Tap the
  changes", Loop bars on columns. That fits how the tier tables already work: the
  gate is on changing things (`freeBlocked`, "what is Pro is CHANGING the
  layout"), not on seeing them. Which pack is open (Practice Pack is the natural
  fit for tap and loop).

## What it does to height, by measurement of the mock

Bottom stack: transport 48, parts row 48, tabs 52.

| screen | today | proposed |
|---|---|---|
| Live | 150 | 148 |
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
   timeline), the Song tab's Stage button. The tiles
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

- Stage and the timeline: free, or an add-on, and if an add-on which pack?
- Where the Song and Sound sub-nav goes (dock it above the tabs, as today).
- Whether the shared-row double duty of chrome B survives a real phone.
- Whether mõdFX belongs under Sound as well as in the part menu.
