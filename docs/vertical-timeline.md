# Vertical timeline for Songs: handoff

Written at the end of a design session, to be picked up in a new one. Read
`CLAUDE.md` first (the rules there apply: `./check.sh` after every edit, verify
by measuring, `var`/`window.*` for anything read from far away, no emoji, one
commit per logical change with the version letter, merge in batches). This file
is the plan, what already exists, and the questions still open. Nothing in it
is built yet except what the "Already built" section lists.

## What the owner decided

- **Direction: a vertical timeline** for Songs > Perform. Time runs down the
  page. It is for the phone held upright first.
- **The words are the anchor.** A line of lyrics is a phrase; the chords sit over
  the words they change on; the width of a chord is the width of the words it
  covers. One picture says where a change happens and how long it lasts.
- **Optional input: "Tap the changes"**, setting lengths by ear against a click.
- **A horizontal layout comes later**, for an iPad or a phone on its side: same
  data, same blocks, one renderer that flips direction.
- **It is a post-launch add-on** (an in-app purchase), not part of the first App
  Store build. Which pack it belongs to is **not decided** (see Open questions).
- The owner is **changing the "5.0.0 is the native App Store release" rule**.
  CLAUDE.md still says the old thing. Do not bump a major version or edit that
  rule until the owner says what it is now: ask.
- The timeline could **replace the Perform tiles** (the owner said so). Keep the
  tiles reachable until the timeline is proven; see Step 2.
- Why this matters, in the owner's words: it is about what is good for users, and
  flexibility counts. Ultimate Guitar already shows chords over lyrics for
  reading along; mõdRïff has a band that plays the chart, so it has to know every
  chord's length, and a sheet never says. The timeline is where that gets
  fixed by eye.

## Mockups

A canvas of five screens, owner-private (ask the owner to share it or to attach
screenshots): <https://claude.ai/artifact/GkRQwUuHifaM1VD5PYqkKB>

- **A, vertical, chord blocks** (`Main.dc.html`): tall blocks, a bar is 68 px,
  words inside the block, a drag handle at a block's bottom edge, a loop bracket
  on the right edge, a playhead line, a bottom sheet with Length ½ / 1 / 2 / 4,
  Split, Rhythm, Lyric, All chords.
- **C, vertical, words as the timeline** (`Lyrics.dc.html`): **the one to build.**
  Each lyric line is a card two bars wide. Inside it, columns whose widths are in
  proportion to beats: a chord chip above, the words under it, a colour strip
  under that with beat ticks. The selected line shows a green join between two
  chords with a drag handle; a bottom panel says "Cm starts on 'shut', beat 5" and
  offers Even split, Tap the changes, Edit words. "A line is 1 / 2 / 4 bars" sits
  above the cards.
- **D, tap the changes** (`Tap.dc.html`): the current line large with the words
  lit as they are sung, eight beat dots (two bars), the chord waiting for a tap,
  a big TAP pad, Snap Beat / Half beat, Count-in, Redo / Skip / Stop.
- **B and E**, the horizontal versions (`Horizontal.dc.html`,
  `LyricsH.dc.html`): the same idea sideways, later.

My recommendation, to be confirmed: use C's phrase cards wherever a chord has
words, and A's tall blocks for chord-only stretches (an Intro, a solo, any iReal
chart, which has no words). One renderer, two row kinds.

## Already built (do not redo)

All on `main`, build `4.9.9.9.9.9.9f` at the time of writing.

- **Chord-sheet import reads timing off the layout** (PR #325). `parseChordSheet`
  keeps, per section, `lines`: one record per chord line, in order,
  `{n, cols, lyric, rep, inline}` (how many chords, where each starts in the line,
  the line of words under it). `songFromChordSheet(sheet, opts)` takes
  `opts.len` (0.5, 1, 2, 4 or `'lines'`), `opts.lineBars`, `opts.barEighths`.
  `_sheetLineEighths` shares a line's bars between its chords in proportion to
  their columns, rounded to a beat (`_sheetSplit`: largest remainder, never under
  a beat). Columns count only when the line is padded (`_sheetChordCols`): chords
  one space apart are a list, which is what a PDF text layer gives. A line of
  chords with no words is a bar a chord at least. `slotDurFromEighths(e, barE)`
  turns eighths into a slot's `bars/beats/eighths`.
- **The import window** (`openChordSheetImport`) has a Chord choice (By line, the
  default, or a half bar to four bars for all), "A line is 1 / 2 / 4 bars", each
  section's total bars, and remembers the choice in `modo-sheetlen`.
- **Build**: `sbLengthAll`, "All chords…" on the chord editor's Length row, with
  Undo.
- **Practice trainer** (PR #323): Speed up, Next key, Loop bars on the Songs >
  Perform chart, gated `practiceTrainer` under the Practice Pack. `pracLoop`
  (`{sel, si, a, b}`), `prac`, `_pracChorusDone`, and a tap hook at the top of
  `songChartTap` (`pracLoopTap`). The timeline has to keep all of it working.
- **Lyrics are thrown away at import.** That is the first gap: nothing stores
  them yet.

Tests that already cover the neighbours, and must keep passing:
`tests/chords/length.test.js`, `tests/chords/sheet.test.js` (and the rest of
`tests/chords/*.test.js`), `tests/import/probe.js`, `tests/practice/probe.js`,
`tests/tier/registry.test.js`, `tests/tier/probe.js`. `tests/song/probe.js` has two
checks that fail on the base commit already (banner wording, kit variation): not
yours.

## The model and where things live

(by function name; line numbers drift in a 65k-line file)

- A song is `sections[]`, each `{name, follow, plays, slots[]}`. A slot is a chord:
  `rootM, label, ivs, triadQ, type7, ext, bassNote, bars, beats, eighths, isRest,
  comp, compDef, voicing, func, numeral…`. **Duration is bars + beats + eighths**;
  a beat is a quarter note in every meter; a bar is `_songBarSteps()` sixteenths,
  so `barE = _songBarSteps() / 2` eighths (8 in 4/4, 6 in 3/4). `slotTotalMs(slot)`
  is its length in time.
- **Songs sub-modes**: Build, Perform, Chart. `setSongsMode(m)` shows
  `#songs-build-panel`, `#songs-perform-panel`, `#songs-chart-panel`.
  Perform draws `renderSongsPerformView()` into `#songs-full-chart`: one
  `.songs-chord-btn` tile per chord (they carry `data-si`/`data-ci` since the loop
  picker), all equal in size. A tile tap is `songChartTap(si, ci)`.
- **Playback**: `startSongLoop`, `tickSongLoop` (on the bar line),
  `_advanceLoopSlot`, `_playLoopSlot`, `songLoopSection`/`songLoopSlot`,
  `songCurrentSection`/`songCurrentSlot`. `_highlightLoopSlot(si, ci)` runs when a
  slot starts; `applySongPlayingHighlights(scrollIntoView)` paints the playing
  tile and scrolls to it. Both only know the tile chart and the Build strip:
  **the timeline needs its own painter hooked in the same two places.**
- **Saving and sharing copy slots whole** (`{...sl}` in `_songShareData`,
  `loadSong`, the setlist, iCloud via `modSync`), so an extra field on a slot
  survives all of them. `transposeSong` touches only `rootM`, `label`, `bassNote`.
  **But `_songSig()` (the dirty check) lists slot fields by name**: a new field
  that is not added there will not make a song "unsaved" when edited.
- Per-chord rhythm is `slot.comp` / `slot.compDef`; the Play tab's Rhythm bar is a
  live tool and stays quiet while a song plays.
- Tier gates: `FREE_LIMITS`, `FEATURE_MODULE`, `MODULE_COPY` (names ≤ 30 chars, one
  line ≤ 45), `modAllows(feature)` and `freeBlocked(what, module)`.
  `tests/tier/registry.test.js` fails on a row with no module and on a copy limit.
  A feature no table names is free.
- The page: one `index.html`; phone width is 390; fonts and colours come from the
  existing CSS tokens (`--pg` green, `--border2`, `--surf2`, `--muted`, the
  `--tonic/--subdom/--dom/--modal` function colours that the tiles already use).

## The plan, in steps that each ship

**Step 1: keep the words.** Data only, no new screen.
- Store the words on the chord: `slot.lyr` (string, the words under this chord) and
  `slot.ln` (true on the first chord of a line). Write them in `songFromChordSheet`
  from `sheet.sections[].lines`: for a line with columns, cut the lyric at the
  columns; without columns, split the words evenly among the chords (the same
  rule the durations use, so words and widths agree). Chord-only lines get no `lyr`.
  Repeated lines (`rep`) repeat the lyric of the line they repeat, or none: decide.
- Add `lyr` and `ln` to `_songSig()`. Check any code that rebuilds a slot with a
  named list of fields (grep `slots.map(` and object literals with `rootM:`);
  none of the song paths should, but the bass/phrase paths did for their own
  cells, so look.
- A **Lyric** field in the chord editor (next to the Chord field) so words can be
  typed or fixed. Say what a line is: `ln`.
- Tests: node tests beside `tests/chords/length.test.js` (words cut at columns, even
  split, repeats, no words, 3/4), and a save / load / share round trip that keeps
  `lyr` and `ln`.

**Step 2: the vertical renderer, read-only.** Replace the tile chart in Perform
behind a switch (keep the tiles reachable, for example as the Chart tab or a
setting) so nothing is lost while this is proven.
- Rows: a section header (name, bars, plays), then one card per line. Card = chord
  chips over words over a colour strip with beat ticks, as in screen C. Column
  `flex` is the chord's length in beats. A chord-only stretch uses a tall block, as in
  screen A.
- Row width is a whole number of bars (1, 2, 4, 8): the smallest of those that
  holds the line, so a long line is a wider row at fewer pixels a beat.
- **The hard part, and it has to be measured on real sheets:** a chord's column can
  be narrower than its words (a one-beat chord over a whole phrase). The words
  cannot overlap, so decide a rule and test it: wrap to two lines inside the
  column, then ellipsis, with the full words in the selected-line panel. Run it on
  `tests/chords/sheets/*` and a few of the owner's own PDFs.
- Playing: highlight the sounding chord, a playhead down the card (position from
  the song's time, not from the tile), scroll it into view
  (`applySongPlayingHighlights(true)` and `_highlightLoopSlot` call the new painter).
- Tap a chord column = `songChartTap(si, ci)`. The Loop bars picker must still
  work on columns (`pracLoopTap` is the first line of `songChartTap`; outline the
  looped chords as the tiles do, with `.prac-in`).
- Accessibility: columns are real `<button>`s with a label such as "G, 5 beats,
  words: Walking down the".
- Keep it cheap to repaint: `transposeSong` (Next key) calls
  `renderSongsPerformView` on a bar line.

**Step 3: edit by dragging.**
- Drag the join between two chords to another word: it snaps to a beat, writes
  `bars/beats/eighths` of both chords through `slotDurFromEighths`, keeps their sum.
  The bottom panel says where it landed ("Cm starts on 'shut', beat 5").
- Line length 1 / 2 / 4 bars, Even split, Edit words, Split a chord, and the
  existing `sbLengthAll`. Each edit is undoable (`withUndo`).
- A touch test with real pointer events (CDP `Input.dispatchTouchEvent`, see
  CLAUDE.md: `touchEnd` takes the points that ended).

**Step 4: Tap the changes** (screen D). The band clicks, the line is lit word by
word, a tap sets where the next chord begins, snapped to a beat or half beat.
Needs a count-in and the clock the song already uses (`tickSongLoop`'s bar line,
`schedHorizon`); store the result exactly like a drag.

**Step 5: the horizontal layout** for width (iPad, landscape): same cards turned
on their side, bar = 150 px, the words laid under the beats they are sung on.

**Step 6: the gate, the copy, the docs.** Name the feature in `FREE_LIMITS`,
`FEATURE_MODULE` and `MODULE_COPY` only when it works (the copy rule: never list
a feature that is not built). Update `docs/v5-architecture.md`.

## Measure, do not read

The pattern in this repo: drive the real app with Playwright, instrument what you
changed, print numbers. Existing probes to copy: `tests/import/probe.js` (the
import window), `tests/practice/probe.js` (the real Play Song path, counted),
`tests/slice/probe.js`, `tests/steps/probe.js`. Serve the repo with
`python3 -m http.server 8777 --bind 127.0.0.1`, run Chromium from
`/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, click the splash first
(`#unlock-choices button`) so there is an audio context. Things worth counting
here:

- Column widths in proportion to beats, within a pixel, for 4/4 and 3/4.
- A drag moves a join to the word under the finger and the two durations still sum.
- The playing highlight is on the chord that `songCurrentSlot` says, and scrolls.
- The words you imported are the words on screen, by line, for the three real
  sheets in `tests/chords/sheets` (they lost their column spacing, so they
  exercise the even split; a padded case has to be written out).
- Save, load, share link and iCloud keep `lyr`/`ln`; editing a lyric marks the song
  unsaved.
- With the add-on off (free build): the tiles, nothing locked that was free, and
  the sheet names the pack that would open it.
- Break each thing you wrote once and watch its check fail.

Verified on a phone is a different claim from verified in Chromium: say which.

## Open questions for the owner

1. **Which pack?** The add-on is post-launch. Practice Pack (it is a practice and
   gig feature), a new "Songs" pack, or the Studio Pack? One decision, one table row.
2. **What replaces the 5.0.0 rule?** CLAUDE.md and the versioning notes need the
   new one before the next release label is picked.
3. **Replace Perform, or sit beside it?** The owner leaned to replace. Safest path:
   ship it as a mode, make it the default once it has earned that.
4. **iReal charts and chord-only songs** have no words: do they get the timeline
   (screen A's blocks), or keep the tiles? My recommendation: the timeline, so the
   whole library looks one way.
5. **The words-wider-than-the-chord rule** (Step 2). Probably wants a look at real
   sheets before it is fixed.

## Context from the session that wrote this

- The owner's PDFs are "all types", with Ultimate Guitar the one they know they
  will use. The two real sheets in `tests/chords/sheets` are UG exports read by
  text recognition; both lost their column spacing, which is why the import cannot
  yet be shown to place chords by position on a real sheet. If the owner can
  supply two or three real PDFs, use them.
- Held for after launch, by the owner: MPE input, the ear trainer, AUv3.
  Background audio is still broken on a device (sampled voices drop out when the
  app is left); it needs a phone to chase.
- Do not name a model in a commit, comment or PR (CLAUDE.md, Attribution). The
  trailers are `Claude-Session: …` and `Co-authored-by: Claude <noreply@anthropic.com>`.
