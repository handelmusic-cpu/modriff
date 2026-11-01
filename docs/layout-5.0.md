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
    is unchanged, so the order is still the player's. The transport sheet has two
    eye buttons, one to show every widget's extras and one to hide them all.
    **Three widgets on one screen needs nothing more**: hide their extras and put
    them first. (An earlier version had a "Three at once" button that did both and
    stretched the pads to fill the screen; the owner did not want a button for it.)

    In the mock (708 pt of page on a 932 pt phone), Chords, Melody and mõdFX end at
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

17. **Icons first, with a word where an icon alone would be a guess.** The owner's
    rule is that language should be as much of a non-issue as possible, and the
    first, icon-only version of the transport sheet went too far: the four
    coloured rings (Capture), the disc, the stack and several others could not be
    told apart without help, and the owner said so ("walk it back 10 or 15%").
    The sheet is now: an icon on every button, a one-word label under it
    (Undo, Redo and Find, which are universal, have none), a heading over each group,
    and a sentence under the Capture heading saying what it does. Capture is the
    four rings in the parts' own colours with the part named under each, a filled
    ring meaning on. Touching any button also puts a full sentence at the foot of
    the sheet ("Capture melody: the notes you play are written into the melody
    roll"), and VoiceOver reads the same sentence. The tab bar keeps an icon over
    its label. The rule for new screens: draw it or colour it, and put the
    shortest word beside it if there is any doubt; a long explanation belongs in
    the sentence that appears on touch, not on the button.
18. **The Styles widget is one slim row per part.** Today each of the three
    (Drums, Bass, Melody) is a card with a heading, a Save pill and a row of
    previous, picker and next, about 100 pt each. It is now one 52 pt row: the
    part's name in its colour, previous, the picker, next, and Save as an icon
    (a tray, with a spoken name such as "Save drum pattern"). Three rows are about
    170 pt where the cards were about 310 pt, a saving of roughly 140 pt on Live.
19. **Voices: an optional Live widget, not a default one.** Today Live has the voice
    where you play: a Voice pill in the Chords and Melody headings, and the Bass,
    Drums and Aux kit and patch pickers in those grids' extras. A single panel with
    every part's voice (the same panel as Sound's Voices page, `voices-grid-mix`,
    Drums included) is worth having for changing a whole sound between songs, but
    not on the first screen: it duplicates what the headings already do, and Song
    carrying its sounds (decision 4) removes most of the reason. So it is a new
    widget in Add / reorder widgets, off by default, built from the real element
    (moved, not copied), which costs nothing for anyone who does not add it. The
    mock draws it (jump: Live with Voices). Needs `voices` added to `LV_NAME` and
    `LV_ORDER`.
20. **Headings stay on one line on every phone.** At 393 pt the More pill wrapped
    onto two lines with its + above Modal. Every pill and heading is now
    `white-space: nowrap`, and on a narrow content width (under 420 pt, which the
    closed Duo's 372 pt page also is) the heading tightens (smaller title spacing,
    8 pt pill padding, 40 pt record and Keep buttons). Measured at 375, 393, 402,
    430 and 440 pt and at the closed Duo: no heading overflows and the More pill is
    a single 44 pt line.

21. **The chord rhythm can have any grid and run up to 64 steps.** Today the
    roll is 16 sixteenths. The Chords page's roll (decision 2) now has two controls
    above it: **Bars** (1, 2 or 4) and **Grid** (1/8, 1/16, 1/32, or with **Triplet
    feel** on, 1/8T and 1/16T), and the roll scrolls sideways with bar numbers and a
    mark on every beat. The product of the two is at most 64 steps, so a combination
    that would go over is dimmed: 1/32 allows 1 or 2 bars; 1/16 allows 4; triplets are
    12 or 24 steps a bar, so 1/8T for 4 bars is 48 steps and 1/16T for 2 bars is 48.
    Changing the grid moves each hit to the nearest step of the new grid, so a
    pattern drawn straight can be felt as triplets without redrawing it. The Rhythm
    pick and Draw / Presets / Save stay as they are. What the code has today
    (`rhyBlank(steps)` already carries a step count and `scheduleChordRhythm` wraps
    on `pat.steps`) is the length half: 32 or 64 steps at sixteenths is mostly the
    editor. The grid half is new engine work: a step is a sixteenth on the clock
    today, so 1/8, 1/32 and the triplet grids need the rhythm to carry its steps
    per bar and the scheduler to advance at that rate. A ratchet (`rat`) can
    already fake a triplet inside one step; this makes it a grid. The mock draws
    the roll, the controls and the dimming, and moves the playhead at the grid's
    rate.
22. **The mõdKit Kit page and the small editor** (the design brief, a private
    Docs page, "mõdKit drum editor: Kit page, Shape sheet and Aux"). Built on
    v4.9.9.9.9.9.9g, where the Aux layer's Shape sheet and the reduced sheet for
    recorded drums already work. Where the design and the brief differ, the design
    wins, as the brief says.
    - **Where the Kit page lives.** A view on the Drums part page in Studio:
      **Drums | Aux** (the layer) and **Grid | Kit** (the view) sit side by side in one
      row. It is not a tab, and Live does not get a Kit widget at first (Live keeps
      its Drum and Aux grids). A coloured bar under the switches says **KIT** in red
      or **AUX** in orange with the kit's name, the kind (synthesised, recorded, or
      recorded and synthesised) and **Reset kit** (with Undo in its toast), so which
      layer is being tuned is stated in words and colour, not only by a tab.
    - **The card.** Two across, 122 pt tall, so a kit of eight (808, 909, mõdKit,
      CR-78, Acoustic) fits without scrolling on a Pro Max and the 606 and the short
      kits fit easily; Jazz's eleven scroll. Each card: the drum's name in its lane
      colour (all Aux cards use Aux's own colour), its waveform drawn by the same
      code as the editor, a thin pan marker, and three dials. Dials are 42 pt with
      the value inside and a label under: **Level, Tune, Decay**. A drag up or down
      turns a dial and keeps working until the finger lifts; a readout floats above
      it while it moves; the drum auditions on release; the waveform and the lit
      state update in place. A lit card (a drum shaped away from its defaults) has a
      coloured border and a dot. Tapping the waveform plays the drum, tapping the
      name opens the editor. Cards flash as the pattern plays; with reduced motion
      the lit state is steady and nothing fades.
    - **Three states on the card.** *Recorded* drums keep the same card and the same
      place for every part: a small **Recorded** tag, and **Tone** where Decay would
      be. Nothing is disabled or greyed. *Locked* kits (the Groove Pack's) show the
      cards, the waveforms and the values with the dials dimmed, and a bar says the
      kit is in the pack, so you can look and listen and not tune. *Loading* shows a
      quiet striped placeholder where a waveform will be.
    - **The small editor.** It stays a sheet that stops above the transport so the
      pattern keeps playing. Head: previous and next drum, the drum's name in its
      lane colour, a chip that says **KIT** or **AUX** in the layer colour, the kit's
      name and, for a recording, the word recorded. Then the waveform, larger, with
      a time axis in quarter seconds and a faint trace of the drum as it came, so
      you can see how far you have moved it. Then the controls **in four rows by what
      they do**: Place (Level, Pan), Pitch (Tune, Sweep), Length (Decay, Body),
      Colour (Tone, Drive), as 54 pt dials with the full value written under each
      (80%, +3 st, Neutral, Clean, Centre). **A control that does nothing on a drum
      leaves its slot empty and the others stay where they are**, so walking from a
      kick to a hat moves nothing: the sheet is the same height for every drum in
      every kit (578 pt in the mock, 573 for a recorded kit). A recorded drum has
      the same sheet: the Length row becomes one calm note (a recording has a fixed
      length and make-up, so Decay and Body are not offered) in the slot where those
      two dials would be. Hear it, Reset (this drum only) and Done at the foot. The
      Aux layer is the same sheet with an orange AUX chip and orange dials, and its
      settings are stored apart from the kit's (confirmed in the mock: tuning the
      kick's Tune leaves Aux's kick at 0).
    - **On a wide screen the editor docks** beside the Kit page in the second pane
      instead of covering it (the open Duo, an iPad).
    - **The brief's open questions, answered.** Kit page: a view on the Drums page,
      not a tab and not a Live widget yet. Three dials per card, and a name opens the
      full sheet (a card does not expand in place). Whole-kit Kit Tune, Kit Decay and
      an accent amount: **left out** for now; they would crowd the card grid and
      the brief says they are not built. Per-drum mute and solo, and copy-from-drum:
      **a reserved place, not drawn**: the editor head has room for one more 44 pt
      button, which opens a short menu when they are built; drawing disabled
      controls would break the calm. Recorded drums: a card in the same shape with
      Tone in place of Decay, and a sheet with the Length note. The editor keeps its
      sheet form, and docks on a wide screen.
    - **The look.** Dials, the waveform panel and the sheet use the same family as
      mõdSynth's panels (round dials with an arc, a dark panel behind the trace), not
      browser sliders; all colours come from the layer's and the lane's own colours
      so a theme change recolours them.
    - **Measured in the mock.** Eight cards fit a Pro Max's 708 pt of page without
      scrolling; a drag of 40 pt turns Tune 13 semitones (48 across 150 pt) and the
      bubble reads "+13 st"; the sheet's height does not change across drums or
      kits.
    - The waveform in the mock is a stand-in synthesis, not the app's own render; in
      the app it is the offline render the Shape sheet already draws.

23. **PARKED until after the release (the owner's call): tab import beyond what is
    already in the app.** What is written below stays as the record and the starting
    point: the built reader (builds 5.0 and 5.0a, ASCII tab to .mid or the melody
    roll) stays as it is; the joined Import window, the Bass target, PDF tabs and a
    Guitar Pro reader wait. The owner's view, after the real-PDF test: typed tab is
    not how people get tabs on a phone; the realistic inputs are a Guitar Pro file
    (an open-source reader, alphaTab, MPL-2.0, reads GP3 to 7 and MusicXML, not
    tried here), then a PDF from the Ultimate Guitar Pro app, then a photo; and a
    tab still fills only 4 bars at a time. Nothing in this item is scheduled.
    **Tab import joins the chord-sheet import, and reaches the Bass.** The owner
    asked for tab input from PDFs, rolled into Songs "with the same import
    structure", driving the melody sequencer and the bass. It is **already in the app
    on `main`** (builds 5.0 and 5.0a, `openTabImport`, `parseAsciiTab`, `tabToMidi`,
    `tabToMelodyGrid`; tests in `tests/tab/tab.test.js`). What exists: **File >
    Import a tab to .mid** takes pasted plain text or a `.txt` file (the Ultimate
    Guitar kind): string lines to pitches (tunings from the labels or a Tuning line,
    capo, a bass on four lines), hammer-ons, pull-offs and slides, bar lines setting
    each bar's length (8, 16 or 32 dashes to a bar all keep time), a time signature
    (a Time line or a choice), a count or rhythm letters over the staff, and sections
    kept as markers. It can **download a .mid** or put one part (up to 4 bars, lifted
    whole octaves to sit above C3, Follow off, with Undo) **into the melody roll**
    only. What it does not do yet, and this plan adds:
    - **Same structure as the chord-sheet import.** One **Import** window, opened
      from Build's File menu where "Import a chord sheet" is today, with a switch at
      the top, **Chord sheet | Tab**. Both have the same row of sources (Files,
      Photos, Camera, Paste), then what was read, the options, a preview that names
      each part, and the action. Today the tab window has only a text box and
      `Files` for `.txt`; the chord-sheet window's file picker already takes text, a
      PDF or a picture and has Photos and Camera on the phone
      (`openChordSheetImport`, `csi-input`, the Apple text recognition behind it).
    - **PDFs and pictures: tried on a real one.** The owner's PDF was Glen Campbell,
      "Wichita Lineman", a Pro tab for bass (E A D G) with 49 bars on 8 lines. **The
      built reader finds no notes in it** (0 from the text as the PDF gives it, with
      or without layout), because this is not an ASCII tab at all. It is a drawn
      sheet: the string lines and bar lines are vector graphics, and the text layer
      holds only the fret numbers (236 of them), the bar numbers (49), the tempo,
      the section names and a few music symbols. The file's fonts, Leland and Edwin,
      are MuseScore 4's; Ultimate Guitar owns MuseScore, so its "Pro" tabs are
      probably all this kind. That makes this the main PDF case, not an exception.
      **What can be read, measured on this file:**
      - *The strings:* each system's fret numbers fall on four rows, one per string
        (G D A E from the top), so pitch is the tuning plus the fret.
      - *The bars:* the bar numbers sit a steady 24 to 57 units left of each bar line
        and every system ends at the same right margin, so the bars come from the
        text alone. Checked against the drawn bar lines: all 236 notes land in the
        same bar, and the count of bars is 49, matching the bar numbers.
      - *Order and rough place:* the x position of each number within its bar.
        Rebuilding an ASCII tab from those positions (32 columns a bar) and handing
        it to the existing reader gives **236 notes in 49 bars in E A D G**, with
        the pitches right (a 3 on the G string is MIDI 46). So the existing reader
        can be reused behind a new front end that turns a PDF's numbers into ASCII.
      **What cannot be read from position alone:** the rhythm. A drawn sheet spaces
      notes by engraving rules, not by length, so the first onsets come out at odd
      eighths and thirty-seconds (bar 1's notes at 0.46, 0.55, 0.66, 0.83, 0.91 of
      the bar). The notation is in the same text layer as symbols: eighth-note flags
      (46 on this page), augmentation dots (34), eighth and half rests (16) and no
      sixteenth flags, so this tune is quarters, eighths and dotted values, which a
      bar-sum solve (each bar has to add up to the time signature) could place on an
      eighth grid. **That is a design, not something built or tried**; until then a
      PDF's rhythm is "by position" and the window says so and offers Hear it.
      **What the app has to add.** The PDF route today (`ModOcr.swift`, PDFKit's
      `selectionsByLine`) returns one box per text line, which is right for chord
      sheets and wrong here, where a line is a scatter of numbers. A tab needs a box
      per number (PDFKit can give a box per character), and a pass that groups
      numbers into rows, systems and bars. A photographed or scanned PDF has no text
      layer at all, so it would need recognition and is a harder case, not tried. The
      PDF itself is the owner's, a copyrighted tab, so it is kept as a private test
      file and not committed.
    - **Send to Melody, Bass or .mid.** The reader already tells a bass (four lines,
      or a bass tuning) from a guitar (`Strings: Auto | Guitar | Bass`). The new
      choice is where a part goes: **Melody** (the melody roll, as now), **Bass** (the
      bass grid, through the same save and restore pair the melody roll uses,
      `_blCaptureState` and `_blRestoreState`, with the same limits and Undo), or a
      **.mid file**. Auto sends a bass to Bass and a guitar to Melody. A tab that has
      both parts is sent **one part at a time** (the owner's call): pick a part, send
      it, then pick the other. The bass grid's
      step limits and octave range need checking against `tabToMelodyGrid`, which
      assumes the melody roll's (64 steps, lifted to clear C3).
    - **Timeline.** Tab timing is in bars and ticks, the same unit the Timeline uses
      for chord lengths, so a tab's bar lengths could later set the chart's; not
      planned now.
    The mock draws the window for a guitar tab, a bass tab and a chord sheet (jump:
    Import). It is reached from the new File menu on Build (the real File menu's
    items, with the two imports highlighted).
24. **The tab bar's rainbow sits on the top edge of the selected tab**, 3 pt, clear of
    its label (measured: the label starts 29 pt below it on every phone size drawn),
    where it was under the label and clashed once each tab carried an icon above its
    text. The real bar's rainbow marker (`tab-led`) gets the same treatment when the
    tabs are rebuilt (step 3).

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
and the owner asked for a name chosen on best practice. The plan calls it the
Perform Pack.** The module key stays `practice` (nothing about the product, the
purchase or anyone's saved state changes); only the name the player reads changes
(`MODULE_COPY.practice.name`), and the one line under it is reworded to say what it
opens.

Why that name, by the rules a store name should follow:

- **Same pattern as its siblings.** Sounds Pack, Groove Pack, Theory Pack, Studio
  Pack: one noun and Pack. "Perform Pack" is that; "Practice & Perform Pack" is a
  sentence.
- **One word, no symbol.** An ampersand or a slash reads badly in a list, in a
  screen reader and in translation; one common word translates and sorts well.
- **Names the thing the player does, not the feature list.** It holds Stage, the
  Timeline and the trainer, and all three are for working a song up and playing it
  out. Practice is how you get to performing, so the one word covers both.
- **Distinct from its neighbours.** "Stage Pack" would sit next to "Studio Pack"
  one letter apart; "Perform" does not.
- **Within the limit.** The copy rules allow 30 characters; it is 12.
- It is a display string. If it tests badly it is changed in one place, with no
  migration.

`MODULE_COPY.practice.line` today says "Batch iReal import and a practice library";
it needs to say what it now opens too (one line, at most 45 characters).
`FEATURE_MODULE` gets the new rows (`stage`, `timeline`, naming `practice`) when
the features work, not before (step 9; `tests/tier/registry.test.js` fails a row
with no module and copy over the limit). Anyone who already owns the Practice Pack
gets them with it. The App Store listing text in `docs/app-store.md` needs the new
name when this ships.

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
| Loop bars on a line | the trainer as today (Perform Pack) | on the cards |

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
   - **Studio's part switches pick a page; a second tap toggles** (chrome B, built early
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
