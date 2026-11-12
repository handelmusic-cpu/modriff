# Screen layout 5.0: step order and landed log (archive)

Shipped history moved out of the working doc. Do not read this file; `grep -n` it only when you need the old reasoning or measurements for something specific. Git history has the rest.

<!-- docs/layout-5.0.md lines 550-791 -->

## The order, each step shipping on its own

0. **Numbering**: CLAUDE.md restarts at 5.0. Done; the first two builds under it (5.0
   and 5.0a) are the tab import below, built by another session.
1. **Words as data** (`docs/vertical-timeline.md` Step 1): `slot.lyr` / `slot.ln`,
   written at import, in `_songSig()`, a Lyric field in the chord editor, node
   tests, a save / load / share round trip. The one visible change is free:
   the Chart view of Perform shows the words under the chords (next section but
   one). Builds 5.0 and 5.0a are already taken by the tab import (decision 23), so
   this is **5.1**.
   **Landed as 5.1.** The field is labelled Words (the chord's own syllable, with a
   trailing space meaningful) with a New line switch beside it; both are undoable
   and make the song unsaved. `_sheetLyrics` cuts a sheet's lines at the columns
   the chords sat over (padded, inline `[C]word`, compact list) and returns null
   rather than guess when the chords and the lines disagree. The Chart (screen and
   print) shows the words in italics under each chord name. Tests:
   `tests/chords/lyrics.test.js` and `tests/words/probe.js`. Not done in this step:
   per-beat placement of a syllable inside a long chord (that is Step 3 of the
   vertical timeline), and hyphen-aware cutting, so a padded sheet can split a word
   exactly where its chord sat.
2. **Target sizes** with no restructuring: every control 44 pt or more, the chord
   rhythm bar as one row, the beat strip folded into the Play button's ring or a
   3 pt line. Measure each (CDP, real touch).
   **Landed as 5.2 to 5.2d.** One block at the end of the stylesheet, under
   `@media (pointer:coarse)`, so a mouse on the web build keeps the compact look.
   `tests/targets/probe.js` scans every tab and sub-page in Live and Studio, the
   transport sheet, a toast, the pickers and the chord editor, and fails on any
   control under 44 pt that is not in its short `KNOWN` list; it also fails if
   anything runs off the right edge, if the key, tempo, Play and arp rate overlap
   (360 to 440 pt), or if a real touch does not reach what it should.
   What it found and what was done, measured on 430 x 932:

   | | before | after |
   |---|---|---|
   | chord rhythm bar | 86 pt, two rows | 44 pt, one row |
   | Drums / Bass / Mel / Arp / Chords switches | 28 | 44 |
   | tab bar | 33 | 44 |
   | Play | 36 | 44 |
   | transport | 113 | 155 |
   | tabs + transport, Live | 147 | 200 |
   | tabs + sub-nav + transport, Studio | 177 | 245 |

   That is the cost, and it is bigger than the plan's table assumed because the
   transport also holds the Live / Studio switch, which has to be a 44 pt target
   until Step 3 takes it out (the band that carries it is 44 pt instead of 26, which
   is 20 of the 42 pt). Steps 3 and 4 are what win it back.
   Decisions made on the way:
   - **Play is no longer in the middle of the bar.** The key block is two 44 pt
     steppers around the key and a 44 pt mode button, 164 pt, and it cannot give way
     to the tempo the way a 32 pt stepper did (the mode shrank to a sliver of "M").
     The grid is `auto auto 1fr`, and the arp rate steps beside Play by Play's
     measured edge (`--ft-rate-left`, set in `ftRateClamp`).
   - **Step grids**: rows are 44 pt, cells are 34 wide and 44 tall (a 44 pt wide cell
     shows six steps of a bar where eight fit; a cell is drawn across, not tapped).
   - **Invisible pads, not growth**, for the `?` marker, the fold caret and the ◈
     badge, as `.tips-btn` had already done: they sit in rows that would break.
   - **The melody row wraps** (Glide drops to its own line) on phones under about
     400 pt rather than running off the edge.
   - **The beat strip needed nothing**: it was already a 4 pt line on its own row.
   Not done, on purpose, and on the probe's `KNOWN` list: **sliders** (a 14 pt thumb
   on a 3 pt track). A 44 pt thumb moves the dot 15 pt in from each end of the
   track, and the fine-control layer maps by the track, so it needs its own change
   with a look at every slider. The step numbers over a grid (the column menu) are 44
   pt tall with a pad but stay 34 wide, the width of the column under them.
3. **Live and Studio as tabs**, the gear sheet, Accomp's sub-nav gone but its
   page still reachable. Retarget the shortcut, tutorials, tour and Find.
   **6.0d: the chrome is drawn as the mock draws it**: one continuous dark block, the beat strip a
   3 pt line along its top edge (no row of its own), plain 50 pt tabs (no fill, no rules, a smaller
   caret pill), and the Live page's suggested-chord halos and Sub / More chips quieter. Still unlike
   the mock, on purpose or not done: the heading keeps Sub and the slot's ⋯ (the mock draws neither,
   and both are real controls), the melody row keeps its octave − / + and Touch Mod, the Keep icon
   beside the record dot is not drawn, and the Song group in the transport shows only once a song is
   loaded.
   **6.0c: the stack is in the mock's order.** 5.3 kept the old order (tabs above the transport) and
   the owner, holding the phone beside the mock, said the locations differed: the mock has the
   tabs on the floor, the parts row and the transport above them, the sub-tabs above that. The
   tab bar and the sub-tab dock are fixed on their own now (`.top-stack` is `display:contents` in
   portrait; `--tabh`, `--perfh`, `--dockh`, `--botstack` are measured by the clearance block);
   short landscape keeps tabs and sub-tabs side by side above the transport. (6.0b had taken 5.3
   back wholesale on a misreading, and was reverted.)
   **Landed as 5.3.** Tab bar: **Live | Studio | Song | Sound | caret**, 52 pt, an icon
   over a word, one 3 pt mark on the tab you are on (the rainbow strip on every tab and
   the glowing line under the active one, which ran through the label, are gone). The
   caret is a 58 x 52 red pill in the fifth slot and is the sheet's handle; the 24 pt
   band that carried the old handle and the Live / Studio switch is gone from the
   transport, and so is the Live / Studio row from the sheet. Settings is the sheet's
   first row and opens as a full screen with a Done that returns to where it was opened
   from (no tab is lit for it). Measured at 430 x 932, tabs + transport went from 200 pt
   (5.2) to 168 pt in Live and from 245 to 168 in Studio on a part page (the sub-nav
   under Accomp is gone), 213 on Play's Studio page, which keeps its Chords | Melody |
   Sampler | FX row until Step 4.
   Decisions made on the way:
   - **Live and Studio are one page in two views** (`body.mode-basic` is still the
     plumbing, `setViewMode` still the one function); the lit tab is a function of the
     page and the view (`_tabFor`, `_tabSync`), so a tab, the Option+L key, Find
     reaching for Accomp and a tutorial all end up in the same state. Asking for the
     Accomp page from Live puts the app in Studio; going to Live from it lands on Play.
   - **Studio's part switches pick a page; a second tap toggles** (chrome B, changed in 6.6: a tap toggles, a hold or slide opens; built early
     because Accomp lost its tab and needed a way in). `ftPartTap`: Drums, Bass, Mel and
     Arp open the Accomp page at that part, Chords and Smp open Play's Chords and Pads,
     and the part you are on wears a ring. On Song, Sound and in Live they are plain
     switches. The cost is two taps to bring a part in from elsewhere in Studio; the
     plan said to try this on a phone.
   - **Option+1 to 5** are Live, Studio, Song, Sound, Settings.
   - **Side insets**: the page, the tab bar, the transport, the sheet and the Settings
     header keep clear of `env(safe-area-inset-left/right)`. Measured in landscape at 852 x
     393 with a 59 pt inset each side (CDP safe-area override). Two landscape bugs the
     check found are fixed with it: an empty sub-tab dock took half the tab bar's width,
     and Arp was as wide as the bar.
   - Not done: the Settings list of ten rows (decision 13) is still today's three
     panes under a Done bar; the Studio / Accomp wording in tips and the Guide
     is changed where it was user-visible and a few places remain ("Play tab"
     in older help text); `.vmt-btn` CSS is dead and can go.
   `tests/tabs/probe.js` holds all of it, with real touch.
4. **Part pages**, in pieces that ship on their own.
   **4a, landed as 5.4: the More row** (decision 11). One chip in the Chords heading,
   `+ Modal`, steps Modal, Dominants, Mine, Off and round; it starts on Modal; the
   choice is kept in `modo-live-more`. The row is the Studio shelf itself (the same
   `chords-borrowed`, `chords-secdom` and `chords-user` elements and the same pad
   builders), shown in Live as one row of 64 pt pads straight under the seven, with
   the rhythm bar after it. Modal is eight pads, 47 pt wide at 430 and 39 pt at 360
   (a play surface, like the keys, so it is not held to the 44 pt rule the buttons
   are); Dominants is five, Mine is however many are pinned, up to ten. **Mine** is
   the pinned chords on a row of their own; while it is not chosen they stay inside
   the key's row exactly as before, so nobody who had pinned chords loses them. Not
   done: the "+ Build" pad at the end of Mine. `tests/more/probe.js`.
   **4b, landed as 5.5: extras on and off per widget** (decision 12). The Chords and
   Melody title becomes a 44 pt button with a caret (`.lv-xt`, made in `lvAddExtras` from
   the heading's own word, so the heading gains no width). Closed, Chords hides the
   rhythm bar, the More row and its chip and keeps the seven pads; Melody hides the
   Keys / Strip, octave, Hold, Glide and Touch Mod row and keeps the keys. They start
   open, the choice is per widget and kept (`modo-live-xoff`), and the sheet gets two
   eye buttons (Live only) that set every widget's extras on or off, the Sampler's and
   mõdFX's Controls included, and close the sheet. Measured at 430 x 932: Chords, Melody
   and mõdFX with their extras off end at 625 pt, above the 764 pt top of the bars, with
   the pad at full size; with them on the same three end at 976 pt. The Sampler and mõdFX
   keep their Controls button rather than a title toggle (the mõdFX heading is rebuilt
   by `fxBuildPanel`), and the Drum, Aux, Bass and Melody-sequencer grids have no extras
   toggle yet. `tests/extras/probe.js`.
   **4c, landed as 5.6: the Styles widget as slim rows, and Live headings that fit**
   (decisions 18 and 20). Drums, Bass and Melody are one row each, about 54 pt: the
   part's name in its colour, previous, the picker, next, and Save as a tray icon (its
   words are the accessible name). The same elements and handlers; `.st-head` dissolves
   so its children join the row. The widget went from 410 pt to 224 pt on a 430 pt phone,
   so about 186 pt back on Live. The Chords heading had grown (title caret, record dot,
   Sub, the More chip, the sound picker, the slot menu) and left the picker 58 pt wide at
   430 and 22 pt at 360, so under 460 pt the word "Voice" goes, the chips and the dot
   give back padding, and under 420 the chip drops its "+": the picker is 90 pt at 440, 94
   at 402 and 52 at 360, and no heading wraps or runs off the edge from 360 to 440.
   **6.0a tightened it on the owner's word ("too much empty space"): the rows are 48 pt and
   the widget 200 pt, the gaps and the part's name column smaller; the buttons stay 44 pt.**
   Not done: the Keep button's 40 pt narrow form. `tests/styles/probe.js`.
   The rest of Step 4, still to do: Accomp's Drums, Bass, Melody and Arp pages become Studio part
   pages (the real elements are moved, not copied, which is how the Live widgets
   already work, see `LV_*` in `index.html`); the Chords page with the rhythm
   roll; chrome B on the parts row. MIDI mappings and saved layouts
   (`modo-live-slots`) migrate, they are not reset.
5. **The timeline renderer, read-only, and Stage** (Step 2 of the vertical
   timeline), the Stage button on Perform. The tiles
   stay behind a switch until the timeline has earned the default.
   **The renderer landed as 5.7, Stage and the gate as 5.8.** Songs › Perform has a Tiles | Timeline
   switch (`modo-perform-view`, default Tiles). The timeline is a heading per section and
   a card per line: a row of columns, one per chord, each as wide as the chord lasts
   (`flex-grow` = its beats, with no padding or border on the column itself so the widths
   are exactly proportional), the chord name and numeral over the words that fall under it
   over a strip in the chord's function colour with a tick on every beat. Lines break where
   `slot.ln` says; a chord-only stretch is cut every four bars; a card is the smallest of
   1, 2, 4 or 8 bars that holds its line and a line past eight bars is cut at a chord. A
   column too narrow for its words clamps them to two lines and an ellipsis, and the full
   words are in the button's accessible name. Columns carry the tile's own hooks
   (`data-si`, `data-ci`, `.active`, `.prac-in`) inside the same `.songs-section-block`, so
   the playing highlight, the Loop picker and `songChartTap` work on both views with one
   change each (the four selectors that said `.songs-chord-btn` now say `.songs-chord-btn,
   .tl-col`). Measured on the three real sheets in `tests/chords/sheets` and a written one:
   widths proportional to within 1.5 px, no card past the edge at 360, 390 or 430 pt, the
   narrowest column 49 pt (party), 100 pt for the written sheet. `tests/timeline/probe.js`.
   **5.8 adds Stage, the playhead and the gate.** *Stage* is a Stage button beside the
   switch at the top of Perform; it opens a full-screen overlay over everything, bars
   included, with a header (close, the song's title and "section, line n of N", the key
   with a step either side that transposes the song), a progress line, the timeline at a
   larger size, and a footer of five 56 pt buttons (A-, A+, Play, previous and next
   section). It is the same renderer drawn into a second host (`#stage-chart`) with
   `--sfs` scaling the type (12 to 40 px, kept in `modo-stage-fs`), so the playing chord,
   the Loop picker and a tap are the same code as on the page: the painters
   (`applySongPlayingHighlights`, `pracLoopPaint`, the clear in `songChartTap`) now know
   two hosts. The playing line is scrolled to a third of the way down; the screen is kept
   awake with `navigator.wakeLock` where the engine has one, and **a native plugin for it
   is not built** (a Capacitor plugin and Swift a Mac has not compiled, so this does
   nothing in a WebView without the API). *The playhead* is a 2 pt line that crosses the
   sounding chord's column in the chord's length: one CSS transition started when the
   chord starts, none between chords, no animation loop; it runs on the Perform timeline
   and on Stage. *The gate*: `timeline` and `stage` are rows in `FREE_LIMITS` (false),
   `FEATURE_MODULE` (the Practice Pack) and the Practice Pack's copy. Without the pack the
   Stage button and the Timeline switch carry an Add-on tag and a touch says so in a toast
   with a See pack button (`freeBlocked`); a stored Timeline choice is kept but not
   honoured, so buying the pack finds it where it was left. The pack was still called the
   Practice Pack here; it is the **Practice & Perform Pack** from 5.9a (the name, the one-line
   pitch and the two messages that named it; the product id and the module key stay `practice`). Not done: the selected-line panel for words longer
   than their column, the line length buttons and everything that edits (Step 6), a Stage
   for a wide screen, and the Stage button reaching Perform from Live. `tests/stage/probe.js`. Screen wake
   lock needs a Capacitor plugin and Swift that a Mac has not compiled: say it is
   unbuilt until it is confirmed.
6. **Editing on the timeline**: the panel, the beat nudge, Even split, then drag
   (Step 3 of the vertical timeline).
   **Landed as 5.9, in Songs › Build** (decision 9: Build gets a Strip | Timeline switch once
   the pack is owned; free players do not see it). The switch (`modo-build-view`) swaps the
   chord strip for the section being edited drawn as the Perform timeline (`renderSongTimeline`
   with `{only, edit}`); the strip is still built, because it holds the selection and the
   controls under it, and is only hidden. *Select*: a touch on a column is the strip's tap,
   so the strip's own editor (chord, Words, type, length, rhythm) opens under the
   timeline for it. *Drag the join*: a 28 pt handle sits on the boundary between two chords
   on a card; dragging it moves where the second chord starts, snapped to a beat (a half
   beat where the two chords together are under two beats), the two keep their sum, neither
   can go below a beat, the panel says "G starts on bar 1, beat 4" as it moves, and
   releasing writes both lengths through `slotDurFromEighths` as one Undo; a drag that does
   not reach the next beat changes nothing and makes no toast. *The panel* has Line 1 bar,
   2 bars, 4 bars (the line's chords keep their proportions and the line becomes that long,
   by `_sheetSplit`, to the beat where it can), Even (the line shared out equally) and Split
   (the selected chord in two, the words on the first half). Each is one Undo and each makes
   the song unsaved. Not done: Edit words on the card itself (the Words field in the strip's
   editor is the way), dragging a chord to another card, Tap the changes (step 8), and the
   horizontal layout. `tests/tledit/probe.js` (real touch).
7. **Library and songs that carry their sounds.**
   **The Library half landed as 6.0** (new work takes the next minor, which was a new major,
   so the owner was asked first and said 6.0). Songs' sub-nav
   is Build | Perform | Library. The Library page is the setlist (moved from under
   Perform's chart), the Setups (moved from Settings) and a Pattern save card that opens
   the saved chord rhythms, drum patterns, basslines and melody lines; the panels are the
   same elements, moved by `libMount`, so every id, handler and renderer is untouched. Chart
   stopped being a page and is the third view of Perform (Tiles | Chart | Timeline), free,
   with its Print / Save PDF; `setSongsMode('chart')` (Find, an old link) lands there. The
   transport sheet's Setups goes to the Library. `tests/library/probe.js`. Not in this
   piece: songs carrying their sounds, the per-song switch, Setups as templates. The per-song switch, Setups as
   templates, the pattern banks in one place. Existing saves load as "keeps my
   sounds".
8. **Tap the changes** (Step 4 of the vertical timeline).
9. Gates and copy (`FREE_LIMITS`, `FEATURE_MODULE`, `MODULE_COPY`) only for what
   works, then this file and `docs/v5-architecture.md` brought up to date.

Landscape layouts for the long rolls and for the timeline on an iPad are later
and are the same renderer turned on its side.


<!-- docs/layout-5.0.md lines 812-1298 -->

### Landed as 6.0e – 6.0g (matching the mock)

- **6.0e** The transport sheet is the mock's: red grab pill, groups under small-caps titles (Extras, the
  Settings / MIDI map / Setups / Find / Theme row, Project, Capture, Sampler, Export, Tools, Help), every
  control a tile (icon over a word; a ring in the part's colour for Capture). Labels that the app rewrites
  at run time go through `_ftTile` / `_ftDot`. The Song tab icon's note heads no longer clip.
- **6.0f** Phone text a size up (root 22 px on a coarse pointer up to 700 px wide).
- **6.0g** Song pages: Build | Perform | Library and Mixer | Voices | mõdSynth are a wide switch at the top of
  the page. Build opens on the timeline (every section on the page, a tap on a heading selects it),
  Save moved into File. Perform follows the mock's order; Library shows Setlist | Setups | Patterns one at a time.
- Still not as the mock: Settings as a list of rows (decision 13); per-song "recalls sounds" switch;
  on a 390 pt phone the transport's right edge (the Song switch with a song loaded) is clipped.

### Landed as 6.0h (Settings as rows)

- Decision 13, built on the existing sections: one list under Playing / Gear / App instead of three panes. Every row
  is closed, 60 pt high, names what it is set to (the `syncSSPreviews` summaries) and opens in place; a Find field
  narrows the list and opens what matches. Nothing was moved: the panes are flattened with `display:contents` and the
  rows take their place by `order`. `setSettingsPane(name)` still works (Find, the tutorials) and opens the row.
- Not as the mock's ten rows: Samples, iCloud & backup, Packs & purchases and Help & about are still inside the rows above
  (Sound & response, Look & feel, About) rather than rows of their own.

### Landed as 6.0i (the transport fits)

- With two or more sections the section arrows and Song ran off the right edge at 375, 390 and 430 pt, and Song was
  squeezed to 12 pt. On phone widths the Song group now takes a row of its own under the transport (three 44 pt targets),
  so the row above is what it is with no song. `tests/transport/probe.js` fails on the old code and passes.
- Song, when off, is a quiet outline (it was red). The sheet takes nearly the whole screen so Tools and Help are in sight.
- Still different from the mock: it draws ‹ Song › in the one row at 430 with 26 pt arrows; ours are 44 pt, hence the row.

### Landed as 6.0j (chord rhythm builder in Studio)

- Studio's Chords page has the mock's inline rhythm roll with Length (Drums = the drum pattern's length, or 1 / 2 / 4
  bars), Grid (1/8, 1/16, 1/32; triplet 1/8 and 1/16) and Feel (Duple / Triple); a step cycles off / soft / normal / accent.
  `def.grid = {pb, bars, follow}` is the model: cells over a loop in sixteenths, a cell being a fraction of one, so
  triplets run through the same `crPattern` / `scheduleChordRhythm`. Older one-cell-per-sixteenth rhythms are unchanged
  and are laid on a 16-step grid the first time one is edited here. The sheet roll (`rhyEdit`) does not draw grid rhythms.
- Not yet: Presets / Save modes on the roll (the Rhythm picker and the sheet's Pattern save still do that), and a grid rhythm
  attached to a song chord (`slot.compDef`) is untested with more than one bar.
- The Song tab icon is two beamed eighth notes; tab labels are 14 px.

### 6.0k: the rhythm grid is a free step count

- The chord rhythm roll on Studio is not tied to duple and triple. `def.grid = {n, len, follow}`: the loop is cut into
  `n` equal steps, 1 to 64 (6, 9, 12, 15, 18, 24 are chips; - and + for any other), over `len` sixteenths, 1 to 64 like the drum
  grid, or over the drum pattern's length when `follow`. A step is `len / n` sixteenths. Triplets are 12 over 16. The 6.0j
  form (`pb`, `bars`) is read as the same thing.

### Landed as 6.0l

- Studio's Chords page runs in the mock's order: Rhythm bar, the builder, "Play it", the pads (Live keeps pads first).
- Live's melody controls flow as two lines (the control rows are `display:contents`). Still not as the mock: the Sub chip
  and the slot's more button in the Chords heading; Studio's Bass / Melody / Drums pages have no part title row and still
  carry the Sync / Humanize strip; Perform's chord tiles.

### Landed as 6.0m

- Studio part pages open with the part's name in its colour (`accPartTitle`). Sync (the two locks) and Humanize are a Settings
  row, "Sync & humanize" under Playing; `syncRowMount` moves the strip, ids and handlers unchanged.
- Perform's chord tiles are the mock's: bold name, length beside it, four to a row, no function-coloured edge.
- Still open: the Bass and Melody rolls in portrait (they show "Rotate to landscape" where the mock draws a small roll);
  the Sub chip and slot menu in Live's Chords heading (kept: they do things); per-song "recalls sounds" in Library;
  Samples / iCloud / Packs as Settings rows of their own; Stage's native wake lock (Swift, unbuilt).

### Landed as 6.0n – 6.0o

- **6.0n** Find's result labels, the tutorials, the keyboard legend and the tip text name the tabs and the Settings rows as they are
  (Live / Studio / Song / Sound; Settings › Sound & response, Chords & timing, Look & feel, MIDI & keyboard, Sync & humanize). Setups
  and the Chart are named where they live now (Song › Library, Song › Perform). A control only Studio shows is found as Studio, not
  "Live · Advanced". The gate and upgrade copy was checked against `MODULE_COPY`: `tests/tier/registry.test.js`, 600 checks, passes.
- **6.0o** Settings has the mock's four missing rows: Samples (Gear), iCloud & backup, Packs & purchases and Help & about (App; the row
  keeps the id `ss-about`). Moved, not copied: same ids and handlers, one of each. Packs & purchases hides itself when it has nothing
  to show (the web build with everything unlocked). Find names the row, not a pane. `tests/settings/probe.js` checks the four rows.
- Not done: the mock's Advanced (diagnostics, Native sound, Test as) is still partly in Look & feel; Guide and Shortcuts are on the
  transport sheet only; the Humanize amount is in Sound & response while Sync & humanize carries the locks.

### Landed as 6.0p (Stage keeps the screen on; Swift built for the simulator, not run on a phone)

- `ios/App/App/ModWake/ModWake.swift` is a Capacitor plugin with one method, `set({on})`, that sets
  `UIApplication.isIdleTimerDisabled`. A WKWebView has no Screen Wake Lock API (`navigator.wakeLock` is absent in the app), so
  until now neither Stage nor the "keep awake while playing" poll kept an iPhone from locking; the web path only ever worked in a browser.
- `modPlatform.keepAwake(on, reason)` holds the reasons ('play' from the poll, 'stage' from Stage); the screen stays on while any
  holds, and the native plugin is asked only when that answer changes. One flag could not hold both: the poll runs every 1.5 s and
  would have released Stage's request whenever nothing was playing. With no plugin (a browser, an old binary) it is the web lock, as before.
- Registered in `ModRiffViewController` and the Xcode project. `xcodebuild -scheme App -sdk iphonesimulator` builds. Checked in the
  page against a stand-in plugin: Stage's request survives a poll tick, calls happen only on change. Not yet seen on a phone:
  `docs/phone-test-checklist.md` 10.11 to 10.14.

### Landed as 6.0q (the Bass and Melody rolls by touch in portrait)

- The note on 6.0m said the rolls showed "Rotate to landscape". They do not: the roll was drawn in portrait, but its cells were 18 x 22 pt
  (16 steps share 299 pt), too small to hit. The mock says the same of its own roll ("for drawing, not tapping").
- A **Fit / Large** switch under each roll (`prSetZoom`, saved as `modo-roll-zoom`). Fit is what it was. Large is 44 x 44 pt cells with
  a 30 pt ruler (the column handle) and the roll scrolls sideways; the box grows from 40 vh to 54 vh. With no saved choice a touch
  screen narrower than 600 pt (a phone held upright) opens on Large, anything wider on Fit, and turning the phone re-lays the rolls out.
  The size is the person's choice and not the input device's, as the comment above `PR_ROW_H` insists.
- `PR_ROW_H` and `PR_RULER_H` are `var` now, set by `prLayout`; canvas resolution is capped at 12 M pixels (four octaves of 44 pt rows at
  64 steps is more than iOS will allocate).
- Not 44 pt: the ruler (30 pt). A pinned 44 pt strip would cover the top row of the roll for good. `tests/roll/probe.js` holds the rest.
  Checked by hand in the browser pane (pointer events, no CDP touch: this Mac has no working Playwright browser): cell edges at 21 and 23 pt,
  a note placed on both rolls at the right step and pitch, Fit and Large, ruler and key menus, rotation. The probe has not been run.

### Landed as 6.0r (a song recalls its sounds, or keeps yours)

- Decision 4, built. A song has `soundsMode` (`'recall'` or `'keep'`) and `sounds`, a partial snapshot (`captureSounds()`: the keys in
  `SONG_SOUND_KEYS` — the five voices, the envelopes, the character macros, every part's mõdSynth patch, the mixer's levels, pan and
  EQ, the kit, the drum effects and the sampler slots, about 2.7 KB). Never in it: the chart, key, tempo, meter, step counts, which parts
  are armed, mute and solo, and how things play (arp pattern and motion, voicing, glide, Touch Mod).
- `_applySettings` takes the partial snapshot (`partial: true`). It had one unconditional reset, `arpMotion` back to `'off'`, now skipped
  for a partial; `tests/songsounds/probe.js` diffs the whole snapshot before and after to prove nothing outside the sound keys moves.
- A new song saves as `recall`. A song from before the switch has neither field and **keeps your sounds**: nothing you have changes what
  you hear until you flip it. `perfSettings` still sets the tempo and how the arp plays on load; its wave, arp wave and wet/dry now follow the
  switch. The voices inside a +Rhythm song's patterns (kit, lane levels, bass and melody wave, bass filter) are applied only when it recalls.
- Loading a song that recalls shows "Sounds changed to match this song" with Undo, only if something changed. The Library row has
  the switch ("Recalls sounds" / "Keeps my sounds", 44 pt). Turning it on for a song with no sounds saves the current ones with it and
  says so; turning it off keeps what the song holds. Saving a recalling song refreshes its sounds; saving one that keeps yours leaves them.
- Free build: the sounds go through the setters, so a Pro voice plays as a stand-in, and `proSongLoaded` / `proKeepSongApply` put the
  originals back on a re-save.
- Not done: Setups are unchanged (starting templates); the Build page's own setlist list has no switch (the Library does); share links
  carry the sounds like the rest of the song, so a long setlist grows by about 3 KB a song against `SETUP_URL_MAX`.

### Landed as 6.0s (export names)

- A bounce and a chords `.mid` took their file name from the song's title, and from `modo-session` / `modo-chords` (after what the app was
  called once) when it had none, without asking. `_exportName(fallback, what)` now asks when there is no title, with `modriff-session` /
  `modriff-chords` ready; Enter, Skip, Escape or a tap outside take that name, so a finished take is never held up. The live-recording `.mid`
  default is `modriff-performance`. A song with a title is not asked.
- The `-capture-report.txt` beside a bounce is a developer's page (clock offsets, drain phase). It is written in Debug builds and with
  Native sound on, and not in a release build.

### Landed as 6.0t (the first round of notes from the phone)

- **Chord rhythm:** the Studio roll has a **Tap: Level | Ratchet** switch. Ratchet cycles a step through one, two, three and four strikes
  (the rhythm compiler already re-struck a cell `rat` times; only the sheet's roll could set it) and draws the step as that many slices.
  **Edit rhythm** takes you to that roll, flashing it, instead of opening the sheet roll or a toast telling you to go there from the page
  you were on. The sheet roll (still used by Draw a new rhythm and a chord's own rhythm) groups a count that divides by three (6, 9, 12,
  24) three steps to the beat, as a dotted quarter, and its hint names ratchet. Not done: a step's length in the Studio roll, swing and
  Start from there.
- **The sheet button** is a gear and the word Settings in the tabs' own colour; it was a red pill with an up caret, which beside the stop
  button read as a second stop. Its highlight when the sheet is open is the tabs'.
- **Settings:** the search stays under the Done bar while the list scrolls.
- **Melody keys:** a faint arrow at the edge that has more keys, tappable (it moves the strip most of a screenful), instead of a fade.
- **mõdFX and Sampler** fold with the heading's caret, as Chords and Melody do; the Controls button is still there, hidden, as the one place
  the logic lives.
- Open, asked about and not built: the Styles widget and Pattern save, the per-lane Shape button on the drum grid, what Studio's part
  switches are called, and why the four sequencers look different from one another.

### Landed as 6.0u (transport collisions, pad clearing)

- **Transport.** The arp-rate chip is positioned by `ftRateClamp` from where Play is, and that was only re-measured when the bar or the
  Arp switch resized. A long mode name (Gong (Chinese Major)) or the mute/solo pill widens the key cluster, moves Play right and leaves
  the chip on the tempo and the pill, with the song name pushed off the edge. Now the key, tempo, pill and Play are observed, the chip steps
  beside Play when it would land on the left cluster as well as on Play, and the left cell may shrink (`minmax(0,auto)`) so the mode label
  ellipsizes instead of taking the room the right cell needs. Measured at 375 and 440 wide with the long name, the pill and a song loaded:
  no overlap, no horizontal overflow.
- **Pad clearing.** A preset pad cannot be emptied, so "Clear" on one put the preset sound back and said so, which read as a Clear that
  did nothing. The Studio button now says Reset on a preset bank (greyed until the pad has been changed) and Clear on a user bank (greyed
  on an empty pad); the toasts say reset, and an untouched preset pad says Load puts another on it. Still open: erase mode takes a pad's
  hits on the first tap and the sample on the second.

### Landed as 6.0v (the drum lane sheet, Studio's open state)

- **Drum lane sheet.** The lane had a volume dial, the name, a ◈ for a sample, a slider icon for the shape and the pitch dial. The two
  icons are gone. Tapping the name opens one sheet: Sample (opens the lane's sampler as before), Shape (the existing shape sheet, kits that
  have it), and the row tools as buttons (Copy, Cut, Paste, Clear, Euclid 3/5/7, Rotate each way). `sqRowItems` is the one list; the old
  menu is still `sqRowMenu` for anything that wants it. What the icons used to show is two dots on the name: your own sample on the lane,
  and a drum shaped away from its kit; `smpSyncBadges` lights the first as it did the ◈. The name has a dotted underline now, since it is
  the button. Volume and pitch stay on the lane.
- **Studio's part row.** In Studio the same five switches are a way in, and the only sign was a ring. The page you are on now also has a
  chevron at the foot of its switch, `aria-current="page"`, and every other switch's tooltip says "Open X — tap it again to switch it
  on or off". `body.parts-open` is set on the Studio pages. Live is unchanged. Naming: Live and Studio stay.
- Still open: the four sequencers' common layout (bass first); the Studio chord roll's step length, swing and Start from; erase mode's
  hits-then-sample order.

### Landed as 6.0w (Saved patterns)

- **One name.** Pattern save is **Saved patterns** everywhere it was named: the sheet, the Song › Patterns panel, the chord-rhythm picker's
  last row. It holds chord rhythms, drum patterns, basslines and melody lines, so "Pattern save" described only the act.
- **The Styles widget** keeps its three rows (‹ style ›). Each row's tray icon (it read as a download) and the orphan pill under them are
  replaced by one row: **Saved patterns — Save… Open**. Save… asks which part (Drums, Bass, Melody, Chord rhythm; one with nothing on it
  is greyed and says so) and then for a name; Open is the bank sheet as before, with its four tabs. A saved pattern is still in its part's
  style list under Saved by you, so loading one is the same two taps it was. The widget is 204 pt at 440 wide.
- `tests/styles/probe.js` is updated for the new row; it has not been run (no Playwright on this Mac).

### Landed as 6.0x (drums start off)

- **Drums start off, like Bass and Melody.** The switch was on from the first launch with nothing on the kit, lit over silence. The kit
  layer, `drumsEnabled` and Start's blank-session kit (`_sqFactory.kitOn`) default to off; switching drums on over an empty kit loads the
  starter beat (4/4 Basic, the Settings choice) as it always did from the transport. The Kit dot on the Drums page did not, and now does
  (`sqToggleLayer`). Picking a groove to hear it (`autostart`: the groove list, the dice) switches the kit on, since it would otherwise start
  a beat nobody can hear. A saved setup or song still brings its own state back; an old one with no `kitOn` keeps the kit on.
- `tests/starters/starters.test.js` expects the new start ("Drums start off and empty"); not run here.

### Landed as 6.0y (Studio part pages, Chords order)

- **One set of control sizes on the four part pages** (`docs/studio-part-pages.md`): 13 px / 10 px corners for controls, segments in a 10 px
  frame, 16 px steppers, the primary Generate keeps 15 px. Measured before: eleven font sizes and eight radii across the four pages.
- **Bass's filter** is the shared filter block (label, then Cutoff and Resonance with Hz and % readouts), like Melody's and the Arp's.
  `blFilterReadout` paints the readouts when the page is shown and on input; the ids and handlers are the ones the row had.
- **Studio Chords: the chords come first.** 6.0l had put the rhythm bar and the builder above "Play it". Now: the seven, the rhythm bar
  straight under them, the Borrowed and Secondary rows, then the builder (Edit rhythm scrolls to it). Live is unchanged.
- Not done: Drums and Arp structure (see the spec doc).
- **Transport (again).** A song of one section has only the Song button, which stayed in the top row and ran 40 pt off the screen at 393
  beside a long mode name; the Song group is now a row of its own whenever a song is loaded on a phone (it was only with two or more
  sections). The 144 pt reserve I had added for the right cell is gone on phones for the same reason, so the key is not squeezed for
  nothing. The rate chip also steps off the song row (`ftRateClamp` checks it). Measured at 393 with a long mode name, the Fx pill and a
  song: no overlap, no horizontal overflow.
- **Play and Stop** carry the same thin white ring (an inset shadow, so neither changes size); Stop was a dark disc one shade off the bar.
- **Song › Library has a Songs tab** (Common progressions, iReal Pro charts, My songs), each opening the Library sheet on its tab. They were
  never removed: 5.10 gave the page the name Library for the setlist, setups and saved patterns, while the sheet of that name sits behind
  Song › Build › Open library, so a tab called Library had none of them.
- **Play in has keys on the Bass and Melody pages**: a strip of the key's notes (eight, octave − / +) under Start recording, written
  through `noteInputWrite` like the home row and MIDI; a tap arms the part first. Before, Play in said "play the keys" and the keys were
  on Studio › Melody. Drums have their own play-in on their page and are unchanged.

### Landed as 6.0z (a dropout log in Copy diagnostics)

- Copy diagnostics now carries `dropouts`: how many times the page's own 100 ms timer came back more than 50 ms late (the main thread was
  busy), how many times the audio clock advanced 60 ms or more less than the wall clock over a tick (the audio thread did not run: an
  underrun), long tasks where the webview reports them, each with how long ago and whether anything was playing, plus the context's state,
  rate and latencies, which parts were on, the tempo and the page. Ticks right after returning from the background are ignored. It
  is the web path's counterpart to the native engine's own stats, which say nothing when Native sound is off. Only what the page can see:
  it cannot tell a slow device from a busy page by itself, but the two lists together say which of the two it was.

### Landed as 6.1 (an audio buffer choice)

- Settings › Interface › **Audio buffer**: 5, 10 or 20 ms, beside Native sound. See docs/v5-architecture.md ("Dropouts at a 5 ms buffer"). The Swift
  half (`setBuffer` on `ModEngine`) parses but has not been built; the page half answers nothing from a binary without it and the choice then
  applies from the next start.


### Landed as 6.1a (the transport's Song group, back to the mock)

- 6.0i/6.0y gave the Song group a row of its own on every phone: three 44 pt buttons across the full width, 48 pt more bar, and it read as one
  huge button. The mock draws one row (key, tempo, Play, rate, then `‹ Song ›` with 26 pt arrows), so:
  - **431 to 460 pt (the Pro Max class): one row, as the mock.** Key steppers 36 pt, tempo 38, arrows 26, the Song pill capped at 58 pt
    (the section name ellipsizes), the right column floored at 166 pt so a long mode name gives way instead. Measured at 440 with
    "Gong (Chinese Major)" and a section name: bar 110 pt (no song: 110), nothing overlapping, right edge at 434 of 440.
  - **430 pt and narrower: a 28 pt strip** under the transport, arrows and name together and centred (was 44 pt across the width), with the
    touch targets reaching 3 pt past it. One row does not fit there: the key block, tempo, Play and rate are 337 pt of 381 at 393, and
    `‹ Song ›` is 108. Bar is 142 pt at 393 and 375 (was 158). To get it to none, the key steppers would have to go under 44 pt on those phones.

### Landed as 6.1b (Aux, the dice, the folded scale name)

- **Aux switch in Studio.** On a Studio page the part switches open their page unless it is already the one showing, and the Drums page only ever
  reported `drums`, so Aux could never count as the page you were on: two taps on it only reopened Drums. Aux is now a second selection on
  that page (the Aux layer in focus): tap it from elsewhere to open it, again to switch the layer on or off; Drums does the same for the Kit.
- **Aux starts on percussion, off.** The Aux layer was the TR-606 and on; no part written for Aux (AUX_PARTS) names a 606 voice, so a groove wrote
  nothing there and the Aux switch never appeared. It is Perc and off, like Drums, Bass and Melody. The kit list opens on Percussion & world
  when the Aux layer is the one being edited.
- **Styles selector has an Aux row** (Drums, Aux, Bass, Mel), and Settings › Starter patterns an Aux line. A style is a percussion kit and the
  groove whose part is written for it (`AUX_STYLES`): Perc (Bossa, Funk, Rock, Motown, Disco, House, Hip Hop, Shuffle, 12/8 Blues), Latin Perc
  (Son Clave, Cumbia, Samba, Bossa), Salsa, Samba, Maracatu (Samba), West Africa (Afrobeat, Afro 6/8, 6/8, 12/8), Djembe (Kuku), Batá (Afro 6/8),
  Middle East and Clay Drums (Maqsum, Afrobeat), Tabla (Teental, Keherwa), Medieval and Orchestral (3/4, 6/8, 12/8). Hand Drums and Bells & FX
  only get a generic shaker or tambourine, so they are not listed. A part is laid over the beat when the grid is a whole number of its bars;
  otherwise (a 6/8 part on a 16-step grid) its groove is loaded with it and a toast says so. Switching Aux on over an empty layer loads the
  starter (`PERC|Bossa Nova`), as the other three do.
- **The dice roll draws from every scale you have.** `_rndModePool` returned only major and minor in Live or with the "− Modes" row folded away.
  Both are what the screen shows, not what the player owns; ownership is `freeAllowsMode` (the Theory pack). Major and minor are about a fifth
  of a roll now (36 scales for an owner).
- **The scale name is folded on every phone** (three letters of the first word, with … when the name has more: Maj, Maj…, Har…), and the whole name
  heads the list the button opens, with its description. It was whole on 426 to 460 pt screens.

### Landed as 6.1c (Aux styles for Hand Drums and Bells & FX)

- Nine more Aux styles, in `AUX_CUSTOM` (keyed by kit and style, written against the kit's own rows; not in `AUX_PARTS`, because those kits reuse voice
  names such as BD, SD, LT and TB that the drum machines share). Hand Drums: Cajón & Palmas, Doum & Tek, Clap & Shaker, Frame Drum 6/8. Bells & FX:
  Sleigh Ride, Ballad Shimmer, Zills & Bell, Brake & Anvil, Ocean & Nepal Bell. A style whose bar is not the grid's length loads its `groove` with it and is
  written over what that groove put on the Aux layer (`_auxPendStyle`, applied in the groove import, so a groove that waits for the bar line works too).
- Measured: each of the nine applies, reads back as the current style, and has the note count its pattern says; Frame Drum 6/8 moves the grid to 12
  steps and the next 4/4 style moves it back to 16. These parts are written by ear to the idiom (a flamenco cajón, the Arabic four, a campfire clap) and
  want a listen on a phone.

### Landed as 6.1d (Native sound on by default)

- `_graphPathWanted()` is on in the iPhone app unless the player has turned it off (a stored `modo-graph-path` of `0`; a stored `1` still means on). The
  web build never reads as on. A binary without the graph methods leaves it off and the status line says so; a note the engine cannot carry still falls back
  to Web Audio for that note. This is the first half of the flip in `docs/v5-architecture.md`; the second half, deleting the Web Audio path, is not done:
  checklist 10.2 (all eight parts clean), 10.7 (a recorded voice on the melody) and 10.9 (background) have not come back clean, the last diagnostics had 6
  missed blocks in five minutes at the 5 ms buffer, and the web build and the per-note fallback both still need that path.
- The app, including the Audio buffer method (`ModEngine.setBuffer`), compiles for the simulator with Xcode 27.2 (`xcodebuild -scheme App -sdk iphonesimulator`).
  It has not run on a phone.

### Landed as 6.2 (the Studio pages, finished)

- **Drums and Arp on the common layout**, as in `docs/studio-part-pages.md` (which is current). Drums: Write is Draw | Play in with the pattern tools in
  it, Steps / Rate / Swing under the grid, patterns after them. Arp: pick boxes for the pattern and patch, the preview as the surface, timing under it.
  `acSetWriteMode('sq', …)` is the Drums mode; `.sq-wrap[data-wmode]` hides the other mode's controls as `.bl-page-wrap` does for Bass and Melody.
- **The Studio chord roll has what the sheet's roll had.** Tap › **Length** holds a lit step through the 2, 3, 4, 6 or 8 steps after it (the held steps
  are tinted, the count is on the step), **Swing** is Feel (the tempo bar's) or the rhythm's own amount, and **Start from** lays a built-in or saved
  rhythm on the roll; Clear switches every step off. All of it was already stored (`len`, `swing` in `rhyNormGrid`); only the controls were missing.
  The sheet (Live's "Draw a new rhythm…", and `Draw…` on a chord) is unchanged and was not routed to the roll: a blank rhythm committed straight to the
  roll would silence the pads with no undo.
- **Erase mode says what a tap will take.** With ✕ Clear held or latched, pads with hits in the pattern are ringed red (the tap takes the hits), pads
  with none but a sample are amber (it takes, or on a preset pad resets, the sample), empty pads are dimmed.
- Measured in the browser pane at 393: the Drums and Arp page order, the Draw / Play in switch, the Arp pick lists driving the real controls,
  and every new roll control. None of it has been on a phone.

### 6.2a / 6.2b: Studio comfort (from the phone screenshots)

- Type floor: every font-size under 10.5 px (185 rem values, 6 px values) is `max(<size>rem, 10.5px)`; nothing in the app is
  under 10 px. The Settings tab is a column of its own (84 pt) so its word is whole and 11 px.
- Drum and Aux grid: `touch-action: pan-x pan-y` (it was `pan-x`: a finger on the grid could not scroll the page, which is
  the "left and right and up and down" feeling) and proximity snapping instead of mandatory. The step numbers were cut off at
  the top (28 pt cells, 13 pt row, clipped by the scroller): bottom-aligned, row 15 pt.
- Fold carets on Studio's Chords page: Rhythm builder (open) and Chord voice (closed), remembered per device as
  `modo-fold-<key>`; the pads stay above the builder. (Borrowed & modal and Secondary dominants were two more rows here until 6.3.) `.mel-edge` is 44 pt wide.

### 6.2c: finding Ratchet and Tuplet

- Tuplets and Ratchet live in the step inspector, which only opened on a double-tap that nothing on the page mentioned.
  **Tap a step to: Place | Edit** is on Drums, Bass and Melody (one setting, `modo-tap-edit`): in Edit a single tap selects
  the step (an empty one is placed first, the selected one clears) and scrolls its inspector into view.
- Drums: the grid comes first; Steps, Rate, Swing, Audition, Play in, Duplicate, Fill, Tuplets: Cover and Clear are one
  "Pattern tools" caret under it, closed to begin with (in Play in the record button stays up). Bass and Melody have no carets.
- The "Rotate to landscape" ghost over the drum grid is hidden. The roll side of Edit (Bass, Melody) is covered by the
  shared handler but not yet by a probe that touches a canvas cell.

### 6.3: all the chords shown, and the chord rhythm is the song's default

- Studio's Chords page: the Borrowed & Modal and Secondary Dominants chords are shown, under their own headings, and one
  small **More chords** caret in the "Play it" line hides both (`modo-fold-xchords`, open when nothing is saved). It sits
  in a line that was already there, so it costs no height. The two 48 pt rows it replaced are gone. Studio only; Live keeps
  its More row. Rhythm builder and Chord voice keep their rows.
- A chord of a song with no rhythm of its own plays the chord rhythm that is switched on in Studio (`_songDefaultComp`, read by
  `_slotComp`), over its whole length and cut where the next chord begins. Before, the song never looked at it and played one
  hit a bar, so a long chord sounded struck once however busy the rhythm was. Switched off, the song's comp is used as before.
  A chord with its own rhythm keeps it. `tests/songrhythm/probe.js` counts the attacks per chord for a slow and a fast song.
- Labels. One name for each built-in, in the chord editor's Rhythm row, the "All chords" list and Studio's picker (the editor
  said Pulse, Stabs, Strum; the picker Bar Hits, Backbeat, Strum; Backbeat was beats 1 and 3, which is not the backbeat):
  Sustain/Hold = **Hold**, Pulse/Bar Hits = **Once a bar**, Stabs/Backbeat = **Beats 1 & 3**, Strum = **Every beat**;
  "Follow the song" = **Default rhythm**. On the Rhythm bar: **Off** = **Rhythm off**, **Keep going** = **Keep playing**
  (and **Stop on lift** when it is off). In the builder: **Drums** = **Match drums**, and the third Tap choice **Length**
  (which was also the name of the row above it) = **Hold**.

### 6.6: a tap switches a part; its page is a hold or a slide. Taps that will not sound yet say they were heard

- **Studio's part switches (chrome B), changed.** 6.0 – 6.5: a tap on a part you were not on opened its page and only a
  second tap switched it. That made the control hit most mid-performance do one of two things depending on the page, and
  bringing a part in from elsewhere cost two taps. Now **a tap switches the part, in Studio as in Live** (`ftPartTap` is
  only the toggle). The page is a second gesture on the same button (`wirePartRow`, `partOpen`):
  - **hold** 350 ms opens it (a bar grows along the switch's foot while the finger is down; only on a switch whose page is
    not open - on the page you are on a hold is a slow tap);
  - **slide** sideways along the row opens the page of whichever switch is under the finger, one tick per switch passed;
  - neither ever switches a part, and the one click that follows a hold or slide is eaten (capture phase, one click, not a
    time window - a deliberate tap right after a slide still switches);
  - a long-press menu on desktop (`contextmenu`) is the same as a hold; the tooltip says so; the first switch tapped in
    Studio shows a one-time toast (`modo-partrow-hint`).
  Not done on purpose: double-tap to navigate (its first tap has already switched the part, so a double-tap would flip the
  sound twice) and a split button (the row is seven switches in 390 pt; a second hit area per switch costs width the row does
  not have, and a hold or slide costs none).
- **`tapWait(el, sec)`: a tap that was heard and will not sound yet.** Bass and Melody join on the drums' next bar line
  (`seqEntryTime`, up to a bar), the Arp on its next step, the Sampler pattern on the next bar, a quantized pad on the grid:
  the control looked as if nothing had happened and the next tap switched it back off. While it waits the control is drawn
  **dashed and off with a fill growing across it for exactly the time left**, and it lights with a flash when the sound lands
  (`.tap-wait`, the same language as `.gen-queued`). The duration comes from the engine, not a re-derivation. Under 0.3 s
  nothing is drawn (the sound is the answer); switching off while it waits, or Stop, ends it (`tapWaitSync`). Hooked to Bass,
  Mel, Arp, Smp and the Sampler pads (not the pattern's own hits, nor a loop re-struck on a new tempo: `psStart`'s `notATap`).
  Where a wait already had its own mark (sections, grooves, endings, pad patterns, Generate) it is untouched. Not yet: Play's
  start lead (the button already flips to Stop at once) and the Live page's own widgets, which may want the same helper.
- `tests/partrow/probe.js` drives it with real touch: tap, hold, slide, a tap right after each, Live, and the wait (class, dashed,
  drawn as off, the engine's duration, landing, switch-off, Stop, the 0.3 s floor).

### 6.7: Live shows toasts for major actions only

- On the Live page a toast is drawn only for a **recording or capture** (`majorToast`), a **purchase gate** (`freeBlocked`), a
  **failure** or a **refusal that says what to do first** (`TOAST_FAILURE`: "could not", "failed", "... first"), and anything
  that **carries an action** (Undo, Resume, See pack). A style stepped, an ending armed, an undo, a touch mod switched or a pad
  loaded no longer covers the screen being played. Suppressed toasts are still spoken through a visually hidden live region
  (`#_toast-sr`), so VoiceOver keeps its confirmations. Studio, Song, Sound and Settings are unchanged. The filter is in
  `showToast` itself (`_toastQuiet`), so a new call site is quiet on Live by default; a new recording-style toast says
  `majorToast`. `tests/toasts/probe.js`.

### 6.7a: every voice is a Find result, recorded instruments first

- Find read only the buttons on the pages, and the pickers' lists live in popovers outside them, so "sax" or "organ" found
  nothing and "piano" found the synth Piano and the picker's current-voice label. `_findVoiceEntries` makes each voice a result
  per part it can go on (`VOICE_PARTS`), and choosing one puts that voice on that part. Ranking (`_findVoiceBoost`): recorded
  instruments, then mõdSynth, then piano / e.piano / organ / pad / supersaw, plain sine / saw / square / tri last. The boost is
  sized against the name (3.9) versus keyword (3.0) gap, so a recorded voice that only matches by keyword ("piano" finds the
  Kalimba) still ranks under a synth voice whose NAME is the word. The part is searchable only beside the voice's name ("piano
  chords", "sax melody"), so "bass" or "chords" alone are not taken over by voices. The picker triggers, named after the current
  voice, are demoted; the voice buttons inside the lists are not harvested twice. `tests/findvoices/probe.js`.

### 6.7b: mõdSynth patches in every voice selector

- A part's mõdSynth patch could be chosen in one place, Sound › mõdSynth, two tabs from a picker that said "mõdSynth" and nothing
  else. The patches are now in the selectors: a **Patches** list under mõdSynth in each popover picker (Chords, Melody, Arp, Melody
  Seq: `vpPatchBlock`, passed to `vpFill` as its `part`), and the same patches as groups in the Voices panel's dropdowns
  (`vpSelPatches`: Settings, Sound, and the Bass, Melody Seq and Arp pages; values `msx:L|name` / `msx:U|name`). Groups: Saved, Modern
  by category, Classic by category (the Sound tab's order). Choosing one puts the part on mõdSynth and loads the patch in one go
  (`vpPatchPick`, the same prepare-then-load order as the Sound tab's "Play on mõdSynth"); every list follows the part
  (`vpPatchSyncAll`, from `sndPickSyncLabel` and `syncVoicesPanel`), and a patch saved or deleted rebuilds them (`vpPatchesChanged`,
  from `msxUserSave`).
- **Loading.** The synth library is 330 KB that only the synth uses. It is fetched when a picker opens or a dropdown is touched
  (`vpPatchesEnsure`) or, for owners, five seconds after boot. A free install never fetches it: its selectors keep the locked mõdSynth
  entry and show no patches. `tests/voicepatches/probe.js`.

### 6.9: the Live page's pack widgets (Voices, Mixer, mõdSynth) and the Bass / Melody roll widgets gated on Live

- **Gated on Live only.** Three features, each a pack: `liveRolls` (Groove) for the Bass and Melody roll widgets, `liveMixer` (Studio)
  for the Mixer widget, `liveSynth` (mõdSynth Engine) for the mõdSynth widget. `LV_GATE` maps widget to feature; a free install
  sees a **lock tile** where a gated widget sits in its layout (`lvLockTile`: the widget's name and its pack, a tap opens the pack
  sheet) and cannot add one (`lvPick`). The same instruments on their Studio and Sound pages are untouched (`tests/livewidgets`).
  The Drum and Aux grids, Chords, Melody, Styles, Sampler, mõdFX and Endings stay free on Live. The standard layout is unchanged:
  the three new widgets are in `LV_ORDER` but not in `LV_STD`, so they arrive by Add / reorder widgets (a Studio Pack action).
- **Voices. Removed in 6.9.9.9.9.9.9.** It was the Voices panel's rows as one more host (`voices-grid-live`), and the Styles widget
  already carries the Voice column for Drums, Aux, Bass, Chords and Melody, so the two were the same pickers twice. The host,
  `LV_NAME`/`LV_ORDER` entries and CSS are gone; a saved layout that names `voices` loses it in the `LV_NAME` filter. Sound > Voices
  is still the whole list, including the parts Styles has no row for. `#lv-home` still holds the Mixer and mõdSynth hosts.
- **Mixer.** `buildMixChannelsInto` into the page, with pan, sends, EQ and the master hidden by CSS: a level, mute and solo for each
  part. Rebuilt on each mount so its faders read the levels as they are; its meters run only while it is on Live (`_lvMixerOn`,
  and `switchTab` no longer stops them there).
- **mõdSynth.** The rack cannot move (one instance, rebuilt whole by the Sound tab), so this is its own small view: part chips, the
  patch list the pickers use, and a slider for each macro the patch routes, written through `MsxBind` like the rack's. A part not on
  mõdSynth offers "Play ... on mõdSynth". Redrawn only when the parts' patches change (`lvSynthSig`).
- **Styles marker.** A Bass or Melody style stepped while the band plays lands at the top of the loop; `_genQueuePaint` now also fills
  the Styles row's name.


### 6.9.5: the closed Duo's right rail (decision 17 and the mock's "Duo closed")

The mock draws the iPhone Duo three ways (`docs/layout-5.0-mock.html`, the device buttons): **closed** (466 x 678 pt) with the
transport and the five parts as a 92 pt column down the right edge and the tabs along the floor; **open, upright** (669 x 951)
with the ordinary bottom stack; **open, wide** (951 x 669) with a side rail and two panes. Until 6.9.5 the app drew the bottom
stack on all three, so the closed Duo spent 162 pt of 678 on chrome and the page had about 516 pt.

- **Built (6.9.5): the closed Duo.** `@media (orientation:portrait) and (min-width:440px) and (max-width:799px) and
  (max-height:759px)` is the mock's `isRight()` (portrait added, so a phone on its side keeps the arrangement it has). It
  publishes `--rail-w` (92 pt, or the right inset if that is larger) and `--rail-top`; the bottom-clearance script reads
  `--rail-w` to know the transport is not on the floor. Key (name over mode, steps under), tempo, Play, the rate chip, then the
  parts, one 44 pt row each, in a column; the tabs and the sub-tab dock stop at the rail. The page is 374 x 626 pt. The rail also
  clears the Duo's status pill: the Duo draws its clock and Wi-Fi down the right edge (inset 84 pt, about 155 pt tall), so
  `--rail-top` is the inset times 1.9 and is 0 anywhere there is no inset. The heading and melody tightenings that were keyed to
  a viewport under 420 / 460 pt now also apply to this 374 pt page (the same `@media` lists carry the rail's query).
- **Already the same as the mock: the open, upright Duo (669 x 951).** It is an ordinary phone-shaped screen; it keeps the
  bottom stack, as the mock draws it.
- **Not built in 6.9.5, built in 6.9.6 (below): the open, wide Duo (951 x 669); and not built: an iPad.** The mock draws a side rail (Live / Studio / Song / Sound and the
  parts) with the transport across the top and two panes (Live beside Studio, Perform beside the Timeline, the Kit editor docked).
  It needs Live and a Studio part page on screen at once, which are two views of one page today (`setViewMode`), so it is a
  structural change and not a stylesheet. The open Duo gets the bottom stack until it is built.

### 6.9.6: the open Duo, wide (951 x 669): a side rail, the transport across the top, Live beside a part's page

The mock's `isWide()` layout, for the open Duo only: `@media (orientation:landscape) and (min-width:800px) and
(max-width:1100px) and (min-height:560px) and (max-height:759px)` (so a phone on its side, which is under 560 pt tall, and an iPad,
which is wider or taller, keep what they had). It publishes `--wide`, which the bottom-clearance script reads.

- **The rail** (96 pt, down the left edge): the five tabs at the top, the five parts at the foot, on one dark ground. The
  transport (key, tempo, Play, the rate chip, Song and its arrows) is a 56 pt row across the top, clear of the Duo's status pill
  by the right inset, with the beat strip as a 3 pt line under it.
- **Live is two panes.** Live on the left, and on the right the Studio page of a part (Drums, Bass, Melody or Arp), under a
  Part row (the `bm-subnav` that was always mounted and never shown). This works because Live and the Accomp page are separate
  pages in the DOM: the second is just not hidden, and nothing is copied. A tap on a part switch still switches the part; a hold
  now opens its page in the right pane **without leaving Live** (`partOpen` in `_wideLive()`), and the switch whose page is open
  is ringed as it is in Studio. Chords is the left pane, so a hold on it does nothing.
- **Studio, Song, Sound and Settings are one page** the width of the screen, with Studio's Chords / Melody / Sampler / FX row as
  its header under the transport.
- **Known limit.** Live's optional Bass and Melody roll widgets borrow the Accomp grids while they are on (`lvMount`), and a grid
  cannot be in two places: with one of those widgets on, that part's page in the right pane is the part without its grid.
  Sampler and FX pages are Play pages, not Accomp pages, so they are in Studio only, not beside Live.

### 6.9.9.9.9.9.9: More, the record ring, the Record widget, grouped styles

- **The fifth tab is More, not Settings.** It had a gear and the word Settings over a sheet whose first row is Settings and whose other
  six groups are Held notes, Project, Capture, Sampler, Export and Tools. People looked for Bounce and Export under a preferences name.
  Three dots now; the sheet is unchanged. Settings is still its first row.
- **Record ring** (`#ft-rec-ring`, first child of `.ft-top-r`): Bounce in one tap, the same recorder as the sheet's Bounce tile and the
  Record widget. A red ring while idle, a solid red disc with a stop square and a glow while a take runs. `_updateRecBtn` paints every
  `[data-recring]` from the one fact. The sheet keeps Bounce, Stems and MIDI as they were.
  **Width, measured at 375, 390, 402, 430 and 440 (`tests/record/probe.js`):** the rate chip is now always beside Play
  (`ftRateClamp` adds `rate-by-play` unconditionally; before, only when it would collide), which is what leaves the gap to its right.
  The right cell's minimum is 84 pt (chip 48 + ring 36, it was 52), so a long key name gives way before the ring runs off a 375 pt
  screen. With a song loaded: at 431-460 the right cell is 190 pt (was 166) and the key's steppers and the section arrows each lose a few
  points so "Maj" still shows whole; at 430 and under the song's strip is its own row and the ring takes the chip's 48 pt as a margin.
  Under 370 pt the ring is 30 pt. A phone on its side, the Duo and the rail lay it out as one more item.
- **Record widget** (`rec`, `LV_STD` above Endings, `LV_STD_OLD` gained the previous standard so standard layouts get it): one 56 pt row
  with a 40 pt ring, the word Bounce or Recording, the take's clock and a Stems switch (`data-stemtoggle`, so `_updateStemBtn` drives it).
- **Always bounce stems** (Settings > Recording, `modo-stems-always`): Stems comes on at the start of every take (`_alwaysStemsApply`).
  With it on, the Stems switch cannot be turned off before a take (it would be put back as the take starts); mid-take still can.
- **The clock** is `_recFmt` of `Date.now() - _recT0`, one 250 ms timer while a take runs, painted into every `[data-recclock]`: the
  widget, and `#bounce-clock`, the page's copy to the right of the island (the dot is on the left). While the app is in front ActivityKit
  draws nothing, so the page draws both; in the background the Live Activity's compact trailing text is the system's own `.timer`.
- **Styles lists are grouped.** The Pattern half opens a floating `PP_SPECS['live-<part>-style']` list under the name (the same popover the Kit
  and Voice halves use) instead of a flat sheet: Drums by groove family (`RHYTHMS[].fam`), Aux by the kit each line is written for, Bass
  and Melody by Genre and Shape, Chords by Plain and Rhythmic (`ST_CHORD_PLAIN`), then Saved by you. A pick still goes through `starterApply`.
  `starterPickSheet` is the old flat list, kept for an opener with no anchor.
