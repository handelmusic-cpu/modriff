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
   new (setlist, Setups, pattern banks). **Decided by the owner:** Chart as a view
   of Perform is fine as long as printing stays (Print / Save PDF is in the Chart
   view). A Chart page of its own would make the row four entries at this label
   size, which is the most it holds.
10. **The transport sheet stays, and the caret is its handle.** The sheet
    (`ft-more-menu`) holds File, MIDI, Capture (chords, melody, bass, pads),
    Sampler, Export (Bounce, Stems, MIDI), Undo, Redo, Metronome, Snap,
    Randomize, Find, Setups, Theme, Tutorials, Guide and Shortcuts, and it all
    stays. It loses one row, Live / Studio, which are tabs now, and gains Settings
    as its first row. The handle moves from a band above the transport (about 24 pt
    of height, which the 148 pt bottom stack in the table below does not include)
    into **the fifth slot of the tab bar**: a red caret pill in a 58 x 52 pt target.
    A swipe up on the transport row could open it too.

11. **One switch adds a row of chords in Live.** A **More** switch in the Chords
    header steps through Off, **Modal** (the borrowed chords: i, iv, ii°, v, ♭III,
    ♭VI, ♭VII, ♭II, from `getAllBorrowed`), **Dominants** (V/ii to V/vi, from
    `getSecDoms`) and **Mine** (the pinned My Chords and + Build). **It starts on Modal** (the owner's call). It puts one row
    of existing pads under the seven diatonic ones, 64 pt tall (the diatonic pads
    stay 124), and the choice is remembered. Today those rows are Studio only
    (`body.mode-basic #page-perform .advanced-only { display:none !important }`);
    this makes them one tap in Live. The pads, colours and taps are the existing
    ones (`makeOutBtn`, `cpRenderAll`), so nothing is a second copy. A chord grid
    (columns as degrees, all lanes at once) was drawn and rejected.

12. **Extras on and off per widget, so three widgets fit one screen.** Every Live
    widget's title becomes a button with a caret (a 44 pt target). Tapping it
    hides or shows that widget's *extras*, the controls around the thing you play:
    - Chords: the rhythm bar and the More row (the diatonic pads stay).
    - Melody: the Keys / Strip, octave, Hold and Glide row (the keys stay).
    - Sampler: the bank, quantize, pattern and pattern-length rows (the pads, Hold,
      Roll, Stop, Load and Reverse stay). The sampler already has a switch for the
      rows under its grid (`psLiveApply`); this is that one idea given to every
      widget.
    - Drum, Aux, Bass and Melody grids: the pickers, modes, Generate row, steps and
      rate (the grid stays).
    - mõdFX: the preset, the parts it aims at, the X and Y parameters, the pad
      filter (Clean, Moog, MS-20) and Sample, Release, the motion recorder and the
      mix per part (`fx-presets`, `fx-targets`, `fx-axes`, `fx-motion`,
      `fx-mixes`). The pad, Hold and Clear stay. Styles and Endings have no extras.

    The choice is kept per widget and goes with the layout; Add / reorder widgets
    is unchanged, so the order is still the player's. The transport sheet gets a
    **Live** row: **All extras on**, **All extras off** and **Three at once**,
    which puts Chords, Melody and mõdFX first with their extras off.

    **Three at once** also hands the spare height to the things you play: the chord
    pads, the melody keys and the mõdFX pad grow to fill the screen, so there is no
    gap left under the third widget (the mock ends at 690 of 708 pt). Turning any
    widget's extras back on, or choosing All extras on or off, returns them to their
    normal size.

    In the mock (708 pt of page on a 932 pt phone), before that fill, Chords, Melody and mõdFX end at
    612 pt with their extras off, which leaves about 96 pt, and at 718 pt with all
    extras on, about 10 pt too tall, and more once a More row is open. Which
    controls count as extras for each widget is the thing to review: Hold, Glide and
    the octave buttons are in Melody's extras in the mock and a player may want them
    kept.

13. **Settings becomes a short list that opens pages.** It stops being a tab and
    the three panes (General, Sounds, MIDI, about 95 buttons with every section
    open) and opens from the first row of the transport sheet as a full screen
    with Done. Ten rows in three groups, each with a one-line summary of its
    current values, and a search field that finds one setting by name:
    - **Playing:** Sound & response (Master tune, Chord intervals, Humanize and its
      four sliders and parts, Velocity sense, Drive, Restart sound, Reset tone),
      Chords & timing (voicing, Vary, VoiceLead, chord length, Logic Mode, Chord
      Variants, Numbers, latency, Click, Auto-start, Bass + Melody sync), Starter
      patterns, Scales & chords (the saved layouts).
    - **Gear:** MIDI & keyboard (devices, input mode, Mapping Mode, numpad and Caps
      Lock), Samples.
    - **App:** Look & feel (theme, key colours, start in key, touch feedback,
      fingerings), iCloud & backup, Packs & purchases (Store, Restore Purchases),
      Help & about (Tutorials, Guide, shortcuts, credits, support, version),
      Advanced (diagnostics, native sound testing, the debug Test as switch).

    Rows are at least 44 pt: switches on the right, a choice as a row of options,
    a slider as a full-width track with its value. Setups moves to Library; part
    voices stay on their parts. The mock shows the root, Sound & response and
    Chords & timing in full; the other pages are listed by their real rows and
    shortened, and the MIDI pane (long today) only by its top-level items. The group
    names are new; the rows are the app's own.
14. **Part pages keep their voice controls too.** The Chords page in Studio carries
    today's Chord Voice panel: octave, Attack, Release, Reverb and size, the voice
    tone set (Tone, Reso, Sweep, Width, Drift), Sub with its wave and level,
    Strum and its length, Chord under arp, Glide and its time, and the voicing with
    Vary. The first mock left it out; the rule in decision 2 covers it. The Melody,
    Bass and Arp voice panels still have to be checked the same way.

15. **The record dot and Keep stay in the widget headings.** Today the headings of
    Chords, Melody and the Sampler carry a record dot (the sheet's own Capture
    button: what you play is written into a new Song section, the melody roll or a
    pad pattern) with a **Keep** button beside it (`ft-cap-back`, `ft-melcap-back`,
    `ft-pscap-back`: keep what you *just* played, with no recording armed beforehand),
    and mõdFX's heading carries the motion recorder's dot, with Clear and Loop
    beside it for the recorded move (`lvAddRecDot`, `lvRecPaintFx`). The first
    mocks left all of that out. The mock now draws a dot and a Keep in Chords,
    Melody, Sampler, mõdFX and, new, the Bass grid heading, and in the Studio
    header of those same parts. **Bass:** the Capture is in the sheet today (`blCaptureToggle`) with no Keep. Decided by the owner: the Bass grid in Live gets a Keep **only after something has been played in from Studio** (the Play in mode on the Bass page); until then its heading has no Keep and no record dot. Both buttons are
    44 pt targets, and the heading now has to fit them: see "Device widths".
16. **The Arp page does not change.** Arp is the owner's favourite page, and the
    rule from decision 2 applies to it hardest. The page is today's Arp panel moved
    as it is (`#bm-arp-panel`): the ARP switch and status line, the Settings fold,
    the voice, the preview strip, Pattern (Up, Down, Up/Down, Random, Weighted,
    Pedal, Walk, Block), Range, Dynamics (Flat, Cresc, Decresc, Hill, Valley), Feel
    (Even, Swing, Skip, Accent), the Timing dial with Sync and Free, Rate motion
    and Sound. Only the way in changes (the ARP button of the bottom row, no
    Accomp tab). The first mock drew an invented Arp page, which was wrong.

## The bottom of the screen, and other phones

**The bottom band.** On a Pro Max the home indicator takes 34 pt under the tab bar
(`env(safe-area-inset-bottom)`; the app already pads for it in eight places). iOS
keeps that band for its own swipe gesture, so a button there would be hard to hit and
the plan leaves it empty, but the tab bar's background runs under it so it does not
read as a gap. The mock draws 18 pt there, which is why it looks emptier than it
will be on a phone. The real spare height is elsewhere: with extras off the three
Live widgets finish about 18 pt short of the page, and without the fill, about 96 pt.

**Other phone widths** (measured on the mock, which is drawn at 430 pt wide and
resized to each width; the iPhone Pro Max is 430 or 440, the standard iPhones 393
and 402, the smallest 375):

| width | what overflows |
|---|---|
| 430, 440 | nothing in the bottom stack or the headings |
| 393, 402 | the Chords heading (title, record dot, Keep, More, Voice) by 10 to 19 pt |
| 375 | the same heading by 13 pt, and the transport row by 11 pt in Studio |

So the plan fits a Pro Max, and on a standard iPhone the Chords heading needs a
shorter Voice and More pill (or the More switch moving into the extras), and on a
375 the transport row needs the same trick the real bar already uses (the key's mode
name shortens). To be built with container widths and checked at all five widths.
The iPhone Duo is covered in the next section.

## The iPhone Duo

The owner named it as the newest iPhone (a foldable, iOS 27.1). What the sources
agree on (Apple's spec pages and MacRumors; the points come from third parties, so
check them on a device or the Simulator):

| | closed (outer) | open (inner) |
|---|---|---|
| panel | 5.4 inch, 1398 x 2034 px, 460 ppi | 7.6 inch, 1878 x 2670 px, 430 ppi |
| points at 3x | **466 x 678** (two sources agree) | **951 x 669 across, or 669 x 951 upright**; one developer infers 669 x 951 from the App Store screenshot size (2007 x 2853 px), a simulator vendor lists 626 x 890 |
| shape | taller than wide, ratio about 1.45 | about 1.42, like a horizontal iPad mini |

Facts that matter for this app, from the same sources:

- **Size classes.** Closed: compact horizontal and regular vertical in portrait,
  compact in both in landscape. Open: regular in both, so it behaves like an iPad.
  The inner display does not honour an app's supported orientations; the app is
  expected to follow size classes.
- **Insets.** The Dynamic Island sits vertically at the side of both displays, so
  left and right insets are not equal and not zero. **This app has no left or right
  safe-area handling anywhere** (`safe-area-inset-left` and `-right` are not used,
  and the page is `viewport-fit=cover`), which is already a bug in landscape on any
  notched iPhone and becomes a real one on the Duo. It is a prerequisite for any
  landscape or wide layout, and it is small.
- **Building for it.** Built with the Xcode 27.1 SDK an app uses the whole display;
  built with an older Xcode it does not extend under the status bar and the camera.
  Apple's SDK for the Duo shipped as Xcode 27.1 (27A9275). From April 2027 an App
  Store submission needs iPhone Duo screenshots. Nothing found says how a
  Capacitor or WKWebView app is resized or letterboxed, so that is a test on a real
  device or the Simulator, not an assumption.
- **Posture.** It can also be half folded; the folding region splits the inner
  display into usable regions (an arrangement API). Not planned for.

What the mock shows at these sizes (page area is the height left above the bottom
stack and below the status bar):

| screen | page area | what it means |
|---|---|---|
| Pro Max, 430 x 932 | 708 pt | the layout as drawn |
| Standard, 393 x 852 | 628 pt | the Chords heading is 19 pt too wide (above) |
| **Duo closed, 466 x 678** | **454 pt** | wider than a Pro Max so nothing overflows, but 254 pt shorter: Chords and Melody fit one screen with extras off (they end at 424 of 454), mõdFX scrolls |
| **Duo open, across, 951 x 669** | **445 pt** | two panes of about 475 pt each, nothing overflows |
| Duo open, upright, 669 x 951 | 727 pt | one wide column, nothing overflows |

Two consequences, both proposals, neither built:

1. **Closed is a short, wide phone.** "Three at once" cannot always fit three
   widgets: the fill has to be height-aware (grow when there is room, shrink the
   pads, keys and mõdFX pad toward their minimum when there is not), and the widget
   order the player chose decides which two are visible.
2. **Open and across, height is the scarce thing.** The 148 pt bottom stack is a
   third of the 445 pt page area. On a wide screen (regular size class, as on an
   iPad) the plan is **two panes** (Live beside a Studio part page; Perform beside
   the Timeline; Sound beside Mixer) and the transport, parts row and tabs move into
   a **side rail** like the Dock, which iOS also turns vertical on the inner display.
   The mock draws the two panes and keeps the bottom stack, so it shows the cost and
   not the answer. The same renderer serves the horizontal timeline
   (`docs/vertical-timeline.md`, Step 5).

Sources: Apple's iPhone Duo specs pages (apple.com/uk/iphone-duo/specs and
support.apple.com/en-gb/148588), MacRumors' iPhone Duo roundup, the developer
write-up at blakecrosley.com/blog/iphone-duo-for-developers (the point size of the
inner display is its own inference) and webmobilefirst.com's Duo listings.

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

**Decided by the owner: Stage and the Timeline go in the existing Practice Pack,
renamed Practice & Perform Pack.** The module key stays `practice` (nothing about
the product, the purchase or anyone's saved state changes); only the name the
player reads changes (`MODULE_COPY.practice.name`, which has to stay within 30
characters; "Practice & Perform Pack" is 23), and the line under it should be
reworded to say what it now opens. It already owns the trainer (Speed up, Next key,
Loop bars) that lives on the same Perform chart, so the pack becomes "everything
for working a song and playing it on stage". `FEATURE_MODULE` gets the new rows
(`stage`, `timeline`, naming `practice`) when the features work, not before
(`docs/layout-5.0.md` step 9; `tests/tier/registry.test.js` fails a row with no
module and a copy over the limit). Anyone who already owns the Practice Pack gets
them with it. The App Store listing text in `docs/app-store.md` needs the new name
when this ships.

## Free players and the words (recommended)

The owner asked for the best idea. **Words are free to keep, read, type, print and
transpose; the pack is what follows the band.** The line to hold is that nothing a
player imported or typed is ever hidden or locked; upgrading changes what they can
do with their words, not whether they can see them.

| | free | pack (Stage and Timeline) |
|---|---|---|
| import a chord sheet with words (paste, file, photo) | yes, words kept on the chords | same |
| type or fix words (the chord editor's Lyric field) | yes | yes, also on the cards |
| read them | **Perform, Chart view**: chords over the words they fall on, line by line, transpose, Print / Save PDF, chord diagrams one tap away | the same, plus below |
| chord lengths | as imported ("By line"), and Build's All chords... | drawn to scale on the cards; drag, nudge, Even split, Tap the changes |
| follow the song, scroll by itself, big type on stage, screen kept awake | no | **Stage** |
| Loop bars on a line | the trainer as today (Practice Pack) | on the cards |

Why this and not the alternatives:

- **Hiding words from free players** (store them, show them only in the pack)
  would make the free import look broken: someone imports a lyric sheet and sees
  nothing of the lyrics. Free import is the front door, so it has to deliver.
- **Stage free, editing paid** was the first recommendation; the owner chose Stage
  and the Timeline as the add-on, and the version above keeps that while still
  giving a free player a real lyric sheet.
- What costs the band's clock (following the transport, the playhead, auto-scroll)
  and exact timing are the things worth paying for, and they match how the tier
  tables already gate (`freeBlocked`): the paid part is *changing and performing*,
  not *seeing*.
- It costs almost nothing extra to build: the Chart view reads `slot.lyr` from
  Step 1, and Stage and the Timeline are the renderer that has to be built anyway.
- **The Stage button stays visible to free players** with its Add-on tag and, when
  tapped, a sheet that names the pack and shows their own first lines on it, so the
  preview is their song and not a stock picture. The existing song save limit
  (`FREE_NUMBERS.saveSlots`) is unchanged; words add no new limit.

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
   tests, a save / load / share round trip. The one visible change is free:
   the Chart view of Perform shows the words under the chords (next section but
   one). First build under the new numbering: 5.0.
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
- The Song sub-nav costs 50 pt in the page, as Sound's does; docking it above the
  tabs would take it back.
