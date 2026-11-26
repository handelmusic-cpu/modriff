# Tuplet Switches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drum tuplet shows one switch per hit in the grid, each with a step's settings.

**Architecture:** The tuplet's head cell gains an optional `hits` list. Without it, playback is the
old code path. The page (`index.html`) and the native sequencer (`native/modsynth/seqcore.*`) both
play the list; the grid draws `r` switches over the `rs` steps spanned.

**Tech Stack:** `index.html` (plain JS), C++17, Playwright tests on the real page.

**Spec:** `docs/superpowers/specs/2026-11-26-tuplet-switches-design.md`

## Global Constraints

- Read `CLAUDE.md` first. `index.html` is huge: `grep -n` the names below, never read it whole.
  Line numbers drift; the names are the anchors.
- `./check.sh` after every edit of `index.html`.
- No `modo-` key is renamed. No emoji. No renaming minifier. Beware temporal dead zones (`var`
  for flags read from far away).
- No cell without `hits` may sound different from today (Free overlaps aside).
- Copy, exactly: `Remove ratchet`, `Remove tuplet`, `Remove ornament`,
  `<lane> · step <n> · hit <i> of <r>`, `<type> would run past the end of the pattern`.
- Commit per task, subject `v<label>: …`, trailers as in `CLAUDE.md`. Take the label from
  `MODRIFF_VERSION` at start (next step from it; bump `#ft-ver`, `#unlock-ver`,
  `MODRIFF_VERSION` in Task 7).
- Page tests: `node tests/seq/<name>.test.js`. Copy the server, browser launch and `ok()` helper
  from `tests/seq/drumgrid.test.js`.

## Review Focus

- A pattern shortened so a tuplet runs past the end: switches squeeze, taps work, timing unchanged (Task 4).
- Saved `hits` whose length is not `r`: padded or cut on read, never thrown on, never a refused native score (Tasks 2, 3).
- Editing a tuplet while playing: the row redraws and the playhead keeps going with no error (Task 4).
- Overlapping tuplets saved under Free: the later one draws nothing and is silent, and returns when the first is removed (Tasks 1, 4).
- Duplicate, lengthen, column paste and rotate: copies are deep, so editing a copy leaves the original (Task 2).

---

### Task 0: Baseline

- [ ] Run `make -C native/modsynth seqtool scoretest seqhosttest linkhosttest tempotest`, then
  `node tests/seq/drumgrid.test.js`, `node tests/seq/score.test.js`, `./native/modsynth/seqhosttest`.
  Record results; a failure here is pre-existing and gets reported, not silently fixed.

### Task 1: Remove Tuplets: Free

**Files:** Modify `index.html` (`sqTupCover`, `_sqIsCovered`, `_sqSetTupCover`,
`#sq-tupcoverBtn`, `_sqNativeScore`, the command-search entry "Drum Duplicate ×2, Fill and
Tuplets", the tour step titled `Tuplets`, toasts and help text naming Cover or Free);
`native/modsynth/seqcore.h`, `seqcore.cpp`; `seqhosttest.mm` and `linkhosttest.mm` `score()`
builders; `tests/seq/drumgrid.test.js`, `tests/taps/probe.js`, `tests/layout/controls.json`.

**Produces:** score header version `2`, 16 doubles (the `tupCover` slot removed, order otherwise
unchanged); `_sqIsCovered(row, s)` always applies.

- [ ] In `drumgrid.test.js` delete the `tuplet cover off` case and the `tupCover` fields, and
  add `ok(exp.score[0] === 2 && typeof window._sqSetTupCover === 'undefined', …)`. Run: FAIL.
- [ ] Remove the flag everywhere listed. Leave `modo-tupcover` unread; no migration. Tour step
  anchors on `#sq-gInner`.
- [ ] `grep -rniE "tupcover|Tuplets: (Cover|Free)|switch Tuplets" index.html native tests`
  prints nothing. Run the Task 0 commands: PASS.
- [ ] Commit.

### Task 2: Hit list and page playback

**Files:** Modify `index.html` (near `_sqIsTup`; `sqCellClone`, `sqCellsSig`, `sqPlayCell`,
`_sqFireLayer`). Create `tests/seq/tuplet.test.js`.

**Produces** (inside the sequencer IIFE, also exported as `window._sqTup`):

- `hits(cell) -> Hit[r]`, `Hit = {v, vel, p, pr, orn, r}`. No list: derived per the spec (hit 0
  `{v:cell.v, vel:cell.vel||100, p:cell.p||0, pr:cell.pr||0, orn:cell.orn||0, r:1}`; others
  `{v:1, vel:max(1,round(hit0.vel*.75)), same p and pr, orn:0, r:1}`). A list of wrong length is
  padded from the derived entries or cut. Never mutates.
- `make(cell) -> cell`: stores `hits(cell)` and sets `cell.v = 1`.
- `remove(cell)`: copies hit 0 into the cell (`v` 0 if off, `r` = hit 0's ratchet), `rs = 1`,
  deletes `hits`.
- `setType(cell, r, rs)`: with no list, only `r` and `rs` change. With a list, the new list is
  derived from old hit 0 (as if it were on and unratcheted), then `hits[0]` is old hit 0.
- `at(row, s) -> head index of the sounding tuplet spanning s (head included), or -1`.
- `sounds(cell) -> bool`: `v>0` and, with a list, any hit on. `sqDraw`'s kick-row accent uses it.
- `sqPlayOne(track, h, t, len, vol, ps, ch)`: one step-like hit of length `len` seconds
  (ornament leads, then `h.r` strokes at `t + j*len/h.r`, tail `.75`, accent on `j===0`).
  Legacy cells call it with `len = sqSd()*max(1,rs)`, so the arithmetic is unchanged.
- `sqPlayCell` keeps its signature and takes both kinds. A list cell plays hit `i` at
  `t + i*(sqSd()*rs/r)`, length `sqSd()*rs/r`. In `_sqFireLayer` each on hit rolls
  `_stepProb(h)` then `_humanV(h.v===2, part)`, in order; no roll for the head.

- [ ] Write tests (fire the real `window._sqScheduler` on a fake clock with `modEngine.send`
  captured, as `drumgrid.test.js` does; 120 BPM, 5:4 at step 0, `v:2, vel:80`):
  - no list: 5 hits at `0, .1, .2, .3, .4` s, `dyn` `.8, .6, .6, .6, .6`, accent only first;
  - `make` then play: same times and accents, each `dyn` within `.005` of the above;
  - hits 2 and 4 off (index 1, 3): exactly 3 hits at `0, .2, .4`;
  - hit 3 `{r:2, p:5, v:2}`: strokes at `.2, .25`, pitch lane+5, accent on the first only;
  - all off: 0 hits, `at(row, 2) === 0`;
  - two lanes complementary: 5 hits in all, alternating lanes;
  - `hits` of length 3 on `r:5`: 5 entries, no throw;
  - `sqCellClone` of a list cell: mutating the clone's `hits[0].vel` leaves the original;
  - `sqCellsSig` changes on a change of hit, `r` or `rs`, and is the same string as today for a
    grid of plain hits (append fields only when not default).
- [ ] Run: FAIL (`_sqTup` undefined). Implement. Run: PASS.
- [ ] Run `drumgrid.test.js`: PASS unchanged. Commit.

### Task 3: Native playback and score list

**Files:** Modify `native/modsynth/seqcore.h`, `seqcore.cpp` (layout comment too),
`index.html` `_sqNativeScore`, the two `.mm` `score()` builders, `tests/seq/drumgrid.test.js`.

**Produces:** `struct DrumHit { double v=0, vel=0, p=0, pr=0, orn=0, r=1; };`
`DrumCell` gains `int nh = 0; std::array<DrumHit, 8> hits;` (fixed size, no allocation).
Per cell: `v, vel, p, r, rs, orn, pr, nh`, then `nh × (v, vel, p, pr, orn, r)`.
`nh` is `0` or `r`; the page sends `_sqTup.hits(c)` when `c.hits` exists. `fromDoubles` returns
false for `nh<0`, `nh>8` or a short array. `playCell` gains the `sqPlayOne` split and the same
roll order as Task 2.

- [ ] Add to `busyGrid`: 40% of tuplets get a list with random `v` (0,1,2), `vel`, `p`, `orn`,
  `r` 1–4; one fixed case `split 5:4 across two lanes`; one stat case with per-hit `pr` 30 and 75
  on a list (same 4-sigma bound as the existing probability case). Add a case with a wrong-length
  list. Run: FAIL.
- [ ] Implement both sides. `make -C native/modsynth seqtool scoretest seqhosttest linkhosttest`,
  then `drumgrid.test.js`, `score.test.js`, `seqhosttest`: PASS, event lists exact.
- [ ] Commit.

### Task 4: Switches in the grid

**Files:** Modify `index.html` (`sqRender`, `sqMakeStepEl`, `sqRefreshStepEl`, `sqAttachStep`,
`sqPaintCover`, `sqDraw`, `sqStop`, `sqXHead` and the Aux roll builder, `.sq-step` CSS,
`#monotone-css` only if `tests/theme/monotone.test.cjs` asks). Extend `tests/seq/tuplet.test.js`.

**Produces:**
- `_sqTup.layout(row, steps) -> [{s, span, tup}]`, `span = min(rs, steps - s)`.
- DOM: `div.sq-tup[data-s]` of width `span*(var(--sq-w)+2px) - 2px` (CSS, so zoom follows),
  holding `r` flex children `div.sq-step.sq-hit[data-hi]` with 1 px gaps and a
  `span.sq-hn` number (10.5 px). The container keeps the head step's beat classes.
- `sqStepEls[ti][s..s+span-1]` = the container; `sqHitEls[ti][head] = [el]`.
- `sqRenderRow(ti)` redraws one lane (and its Aux-roll twin) after a change of shape.
- The Live Aux roll draws the same switches; a tap there cycles that hit off, on, accent.
- `sqSelHi` (`-1` for a plain step; `0` when a step becomes a tuplet, `-1` when it stops); `sqAttachHit(el, ti, s, hi, track)` with the step's gestures:
  tap toggles (`make` first), second tap within 300 ms selects, `_tapEdit` as for steps,
  audition plays that hit.
- `_sqTup.hitAt(row, pos) -> {s, hi} | null`, `pos` a fractional step. `sqDraw` computes
  `pos = sqSeqStep - (sqNextT - heard)/sd` every frame, moves `.head` between hit elements and
  never lights a `.sq-tup` container.
- `.covered` styling and its toast go: covered steps are no longer drawn.

- [ ] Tests: 5:4 at step 0 gives 5 `.sq-hit` and the row's width equals a row with no tuplet
  (±1 px) at zoom 1 and at a pinched zoom; `layout` for 5:8 at step 12 of 16 has `span 4`;
  `hitAt(row, 0)`→hit 0, `0.9`→hit 1, `3.99`→hit 4, `4`→null; real CDP touch on hit 2 of a 7:4
  toggles only hit 2; double-tap selects it and leaves it on; a covered second tuplet draws no
  hits; removing the first brings them back; changing type during playback logs no page error and
  `.head` is on exactly one element per tuplet lane.
- [ ] Run: FAIL. Implement. Run: PASS, plus `tests/theme/monotone.test.cjs`.
- [ ] Screenshot a split 5:4 in portrait, landscape, light and Monotone; look at them. Commit.

### Task 5: Editor and Remove buttons

**Files:** Modify `index.html` `sqSyncInsp`. Extend `tests/seq/tuplet.test.js`.

**Consumes:** `sqSelHi`, `_sqTup.make/hits/remove/setType`, `sqRenderRow`.

- For a hit: heading per Global Constraints; Vel, Ratchet, Pitch, Prob, Orn, Accent, ✕ act on
  `cell.hits[sqSelHi]`, calling `make` before the first change only (opening the editor changes
  nothing). ✕ sets that hit's `v = 0` and keeps the selection.
- Ratchet on a hit changes the hit's `r` (1–4). On a plain step it behaves as today.
- Tuplet row has no `—` entry; pressing a type calls `setType`; refuse a clash as today and a
  span past `sqSteps` with the new toast. An editor opened on an off hit still shows.
- Orn row is `Flam`, `Ruff`. `Remove ratchet` (shown when the target's `r>1`, not the tuplet
  count), `Remove tuplet` (when the cell is a tuplet), `Remove ornament` (when `orn>0`).

- [ ] Tests: no button labelled `—` in `#sq-insp`; each Remove button absent, then present, and
  after pressing restores the default; opening a hit's editor leaves `cell.hits` undefined;
  `Remove tuplet` with hit 1 off leaves `v 0, r 1, rs 1`; 5:8 at step 13 of 16 is refused;
  Ratchet 3 on hit 2 gives `hits[1].r === 3` and `cell.r === 5`.
- [ ] Run: FAIL. Implement. PASS. Re-run `tests/taps/probe.js` and the layout control check. Commit.

### Task 6: The other writers

**Files:** Modify `index.html` (`_sqPlayIn`, `_sqClearAt`, `_sqSet`, `_sqFill`, `_sqVaryBlock`,
`sqRolesToGrid`). Extend `tests/seq/tuplet.test.js`.

- `_sqPlayIn` inside a span (head `h`): `hi = clamp(round((s-h)*r/rs), 0, r-1)`; `make`; set that
  hit's `v` and `vel`; redraw the row.
- `_sqClearAt(s)`: switches off hits with `floor(h + i*rs/r) === s`.
- `_sqFill(grid, tracks, mach, f0, f1)`: first removes (`v 0, r 1, rs 1`, no `hits`) every
  tuplet whose span meets `[f0, f1)`, in every lane. `_sqSet` deletes `hits`. `_sqVaryBlock`
  skips steps where `at(row, s) >= 0`.
- `sqRolesToGrid`: two cells with equal `r` and `rs > 1` landing on one step merge by hit: the on
  one wins, the louder if both. Other collisions as today.

- [ ] One test per bullet, with counts: e.g. play-in at step 2 of a 5:4 turns on only hit index 3;
  clear at step 1 switches off exactly hit index 2; complementary lanes mapped to one voice give
  5 on hits. Run: FAIL. Implement. PASS. Commit.

### Task 7: Ship

**Files:** `index.html` (help text starting `<strong>Tuplets</strong> spread`, the `?` tips, the
three version spots), `docs/phone-test-checklist.md` (one line), `build/build.mjs` unchanged.

- [ ] Help copy says: a tuplet shows one numbered switch per hit; tap to switch, double-tap to
  edit; it takes over the steps it spans; `Remove tuplet` brings them back.
- [ ] `./check.sh`; `npm run build`; repeat `tuplet.test.js` served from `dist/`; all Task 0
  commands; `make -C native/modsynth` and `node tests/modsynth/null.test.js`; the `xcodebuild`
  command in `CLAUDE.md`: all pass.
- [ ] Checklist line: split a 5:4 between two lanes and hear it in time on the phone, narrowest
  7:4 switches tappable.
- [ ] Commit, then PR and merge as `CLAUDE.md` says, listing the checklist line.
