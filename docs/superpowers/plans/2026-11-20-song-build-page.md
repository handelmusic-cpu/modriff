# Song Build Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Song > Build, adding a chord and setting how long it plays are the loudest, clearest things on the page; rhythm, voicing and bass are visible but second.

**Architecture:** All changes are in `index.html` (the chord editor `sbBuildChordEditor`, `_slotDurLabel`, the `.ci-*` / `.sb-*` CSS, the Build panel markup) plus new tests under `tests/songbuild/`. Saved songs are untouched: a slot still stores `bars`, `beats`, `eighths`. Shading is theme tokens only.

**Tech Stack:** Vanilla JS/CSS in one page, node tests that lift functions out of `index.html`, Playwright probes (`tests/layout/lib.js`).

**Spec:** The design agreed in conversation on 2026-11-20 (summarised under Design below; the owner approved it after trying a working spike). **Reference implementation:** the spike diff, `song-build-spike.patch` (241 lines, in the session scratchpad) and the worktree `/Users/benjaminhandelm1air/modriff-spike` on branch `spike/song-build-length`, uncommitted. It is a throwaway: port it task by task onto a fresh branch from `origin/main`, with tests, not by applying the patch whole.

## Design (what was decided)

- Length is the first thing after the chord name. Row: `½ · 1 beat · 2 beats | 1 bar · 2 bars · 4 bars`; 8 bars moves to Exact. Under it a `−⅛` `+⅛` nudge steps the length by one eighth, with the length in words ("2½ beats"), then `Exact ▸` and `All chords…`.
- Every place that shows a length uses one function, `_slotDurLabel`, in words: "1 bar", "2 beats", "1 bar + ½ beat". The old "2♪" (two beats here, two eighths elsewhere) and "1bar" are gone.
- A chord can change on any eighth: dragging a chord boundary on the timeline snaps to an eighth, not a beat.
- Editor order: Chord, Length, Type, then a quieter band: Words, Rhythm, Voicing, Bass, Plays. Those five start shut on first launch, one line each showing their setting.
- Add a chord sits directly under the timeline (after the Line and section row), above the editor.
- Three levels of weight: progression and picker bright (`--play-surf`/`--play-edge`); title, key, scale, library buttons flat and dim; second-step rows darkest with grey selection. Red means selected.
- Not changing: saved-song format, `modo-` storage keys, the quick card (`qcOpen`) layout, Live and Studio. Perform page is a separate later plan.

## Global Constraints

- Run `./check.sh` after every edit; a syntax error is a blank page.
- No emoji in the UI. `½` and `⅛` are plain fractions with no emoji form.
- Never rename a `modo-` storage key. The fold state stays in `modo-ci-fold`.
- New module-level values read from far away are `var`, not `let`/`const` (temporal dead zone). `SB_LEN_ROW` is a `var`.
- Comments say why, and name the bug the shape prevents. No model name in any comment, commit or PR.
- Every commit ends with exactly the trailers in CLAUDE.md (`Claude-Session: …` then `Co-authored-by: Claude <noreply@anthropic.com>`). Commit subject is `v<label>: …`; the label is the next step after `origin/main`'s version (`#ft-ver`, `#unlock-ver`, `MODRIFF_VERSION` all agree; `build/build.mjs` fails otherwise). At plan time main is `1.9.9.9r`; another branch holds `s` and `t`, so re-check before labelling.
- Verified means measured on this Mac. A phone check never gates the merge: add lines to `docs/phone-test-checklist.md`.
- No other companies' product names in any new text.

## Review Focus

1. A song in 3/4 (or any meter where a bar is not 4 beats): "1 bar" and the label of a stored `bars:1` read correctly; the label never assumes four beats a bar. Pinned in Task 1.
2. A slot with an odd stored mix (`beats:5, eighths:3`, or `bars:0 beats:0 eighths:0`): the label is the total in words and never empty or negative; zero reads "1 bar" as before. Task 1.
3. Nudge down from one eighth stays at one eighth (never 0); nudge up has no hidden ceiling that corrupts the slot. Task 2.
4. Someone who already opened or shut editor rows keeps exactly that; only a first launch (nothing stored, or unreadable JSON) starts the five rows shut; a stored fold with other keys is not widened. Task 3.
5. Timeline drag: two neighbouring chords whose sum is one beat or less still both keep at least an eighth; a drag that does not reach the next eighth changes nothing and makes no toast. Task 6.
6. A rest slot has no Length row; its editor still shows Plays and must not throw, and the quick card still builds in its own order. Task 3.

---

### Task 1: Lengths in words

**Files:**
- Modify: `index.html` — `_slotDurLabel` (near `function _slotDurLabel`), add `var SB_LEN_ROW` beside it; Length row in `sbBuildChordEditor` (the `lenOpts` block)
- Create: `tests/songbuild/durlabel.test.js`

**Interfaces:**
- Produces: `_slotDurLabel(slot) -> string` (total length in words, spaced, `" + "` between bars and beats); `var SB_LEN_ROW = [{short, title, bars, beats, eighths}]` six entries in the order `½, 1 beat, 2 beats, 1 bar, 2 bars, 4 bars`.
- Consumes: `_slotBeats(slot)`, `_songBarSteps()`, `_durMatchesPreset(slot, preset)` (existing).

- [ ] **Step 1: Write the failing test** `tests/songbuild/durlabel.test.js`. It lifts `_slotDurLabel` and `SB_LEN_ROW` from `index.html` by regex (the pattern in `tests/chords/load.js`) and defines `_slotBeats` and `_songBarSteps` stubs matching the page (`_songBarSteps` returns 16 or 12). Assertions: `{bars:1}` → "1 bar"; `{beats:2}` → "2 beats"; `{beats:1}` → "1 beat"; `{eighths:1}` → "½ beat"; `{beats:1, eighths:1}` → "1½ beats"; `{bars:1, beats:2}` → "1 bar + 2 beats"; `{bars:2, eighths:1}` → "2 bars + ½ beat"; `{}` → "1 bar"; with 12 steps (3/4) `{bars:1}` → "1 bar" and `{beats:3}` → "1 bar"; `{beats:5, eighths:3}` → "1 bar + 2½ beats" at 16 steps (no negative, never empty). `SB_LEN_ROW.map(p => p.short)` equals `['½','1 beat','2 beats','1 bar','2 bars','4 bars']`.
- [ ] **Step 2: Run** `node tests/songbuild/durlabel.test.js` — expect FAIL (new label format, `SB_LEN_ROW` missing).
- [ ] **Step 3: Implement** `_slotDurLabel` from the total eighths (`Math.round(_slotBeats(slot)*2)`, bar = `_songBarSteps()/2` eighths), and `SB_LEN_ROW`. In the editor, `lenOpts` is built from `SB_LEN_ROW` (`[idx, p.short, p.title]`), `_durMatchesPreset` matches against it, and the `Exact` button label is the fixed text `Exact ▸`. Leave `DUR_PRESETS` alone: the duration modal still uses it.
- [ ] **Step 4: Run** the test — expect PASS. Run `node tests/chords/length.test.js` (35 passed) and `./check.sh`.
- [ ] **Step 5: Commit** (`v<label>: chord lengths are said in words, with a 1-beat and half-beat button`).

### Task 2: The eighth nudge and the Length row's second line

**Files:**
- Modify: `index.html` — Length block in `sbBuildChordEditor`; CSS next to `.ci-fine`
- Create: `tests/songbuild/build.probe.js` (Playwright, modelled on `tests/layout/strip.probe.js`, using `tests/layout/lib.js`)

**Interfaces:**
- Produces: row class `ci-len`; nudge element `.ci-nudge` with buttons `−⅛`, `+⅛` and `.ci-nudge-read` (text = `_slotDurLabel(slot)`); `Exact ▸` and `All chords…` live in the nudge row (the `ci-extras` span moves out of the segmented row so six buttons fit one line at 375 pt).
- Consumes: `_slotE(slot)`, `_setSlotE(slot, eighths)` (existing, near `_tlLineAt`).

- [ ] **Step 1: Write the failing probe** `build.probe.js`, first section: boot Song > Build at `se375`, add C, Dm, G from `#chart-chord-picker`, select G. Assert: the Length row (`.ci-row.ci-len .ci-seg`) is one line (all six buttons share a `top`); `.ci-nudge-read` reads "1 bar" at start; tapping `+⅛` twice reads "1 bar + 1 beat"; tapping `−⅛` five times from one eighth never goes below "½ beat" and `slot` eighths total never 0; clicking `½` then `2 beats` sets stored `[0,0,1]` then `[0,2,0]` (bars, beats, eighths); no `button` inside `#songs-build-panel` has `scrollWidth > clientWidth + 1`.
- [ ] **Step 2: Run** `node tests/songbuild/build.probe.js` — expect FAIL.
- [ ] **Step 3: Implement** the nudge (`ndBtn(txt, label, step)` calling `_setSlotE(slot, Math.max(1, _slotE(slot)+step))` then `repaint()`), the `ci-len` / `ci-nudge` CSS (six buttons `flex:1 1 0`, `.56rem`, no wrap; nudge buttons 44 pt wide and 36 pt tall), and move the extras span into the nudge row. The shut-row rule hides the nudge with its row.
- [ ] **Step 4: Run** the probe — expect PASS; `./check.sh`.
- [ ] **Step 5: Commit.**

### Task 3: Editor order, the quiet band, shut by default

**Files:**
- Modify: `index.html` — end of `sbBuildChordEditor` (before `if(quick)`), `_ciFoldGet`, `_ciFoldWire`'s summary line, CSS block after `.ci-rest`
- Extend: `tests/songbuild/build.probe.js`

**Interfaces:**
- Produces: row order `Chord, Length, Type, Words, Rhythm, Voicing, Bass, Plays` in the full editor only; classes `ci-quiet` (the last five), `ci-quiet-first`, `ci-onerow` (Type, one line at 375 pt); on first launch `modo-ci-fold` rows `{Words,Rhythm,Voicing,Bass,Plays}` start shut; a shut row's summary shows its setting (Bass shows its button text, Words shows `none` when empty).
- Consumes: `rowBy(label)` helper local to the function; the existing fold state in `modo-ci-fold`.

- [ ] **Step 1: Write failing probe sections.** With `localStorage` cleared: at `se375`, the editor's row labels in DOM order equal the list above; the five quiet rows have class `ci-rshut` and their `.ci-sum` texts are `none`, `Once a bar`, `Default`, `Root ▾`, `Chord`; tapping the Rhythm label opens it and `JSON.parse(localStorage['modo-ci-fold']).rows.Rhythm` is undefined while Words is `1`; with `modo-ci-fold` preset to `{"rows":{"Voicing":1}}` the page starts with only Voicing shut (a returning user is not re-collapsed); with `modo-ci-fold` set to `not json` it starts with the five shut; selecting a rest chord shows no Length row and no console error; the editor's height is under 520 px at 375 pt with three chords; no overflow as in Task 2; the Type row is one line.
- [ ] **Step 2: Run** the probe — expect FAIL.
- [ ] **Step 3: Implement** per the Interfaces. The reorder runs only when `!quick`, so `_qcLayout` is untouched. The first-launch default is set only when `modo-ci-fold` parsed to nothing. The editor header drops the function word ("dominant") below 420 px so it is not cut off.
- [ ] **Step 4: Run** the probe — expect PASS; `./check.sh`.
- [ ] **Step 5: Commit.**

### Task 4: Add a chord under the timeline

**Files:**
- Modify: `index.html` — Build panel markup (the "Add a chord" block moves into `.sb-seccard`, before `#chart-inspector`); CSS after `.ci-rest`
- Extend: `tests/songbuild/build.probe.js`

**Interfaces:**
- Produces: inside `.sb-seccard`, children `.sb-hdr`, `#chart-chord-picker`, `.sb-exprow`, `#sb-borrowed-body`, `#chromatic-body` get CSS `order:5` (the card is a flex column ordered by the `.sb-lines-*` rules: timeline 1, fold rows 2-5, editor 6). All element ids and handlers are unchanged.

- [ ] **Step 1: Write failing probe section:** at `se375` with three chords, `#chart-chord-picker` is inside `.sb-seccard` and its `getBoundingClientRect().top` is below `#chart-timeline` and above `#chart-inspector`, with the Line and section row shut and again with it open; tapping a picker tile adds a chord (the section's slot count grows by one); Borrowed and Any root still open their bodies.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** by moving the block and adding the `order` rule; the picker's own card background is removed inside the card.
- [ ] **Step 4: Run** the probe — expect PASS; `./check.sh`.
- [ ] **Step 5: Commit.**

### Task 5: Three levels of weight, in every theme

**Files:**
- Modify: `index.html` — CSS block after `.ci-rest` scoped to `#songs-build-panel` (never Live or Studio, which share `.logic-suggest`)
- Test: `tests/theme/monotone.test.cjs`, `tests/theme/hue-probe.js` (existing; run, do not edit unless a new literal colour needs it)

**Interfaces:** tokens only (`--play-surf`, `--play-edge`, `--surf`, `--bg`, `--border`, `--border2`, `--muted`, `--accent`, `--py`) via `color-mix`. No new literal colours.

- [ ] **Step 1: Write failing probe section:** in dark, the computed background of `.sb-seccard` equals `--play-surf`; `.cpick-split.logic-suggest` inside the Build panel has no glow (`box-shadow` has no blur radius above 0 except the inset underline); the same selector on Live (`#lv-slots`) is unchanged from `origin/main`; the selected section tab's background is not the solid `--py`; the second-step rows' selected button is grey (not `--accent`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the CSS from the spike as the starting point; keep each rule's comment saying why.
- [ ] **Step 4: Run** the probe, then `node tests/theme/monotone.test.cjs` and `tests/theme/hue-probe.js` in Light and Monotone (expect no new hue leaks on Song > Build), and look at Build in dark, Light and Monotone in screenshots.
- [ ] **Step 5: Commit.**

### Task 6: A chord can change on any eighth

**Files:**
- Modify: `index.html` — `tlJoinDown` (the `unit` line) and the comment above the Editing-on-the-timeline block that says "snaps to a beat"; `_tlWhere` to say the eighth ("bar 1, beat 3 and a half" or the shortest wording that is unambiguous)
- Modify: `tests/tledit/probe.js` (it asserts whole-beat snapping)

**Interfaces:** `unit` is `0.5` beats. `_tlWhere(beats)` returns text containing "beat N" for whole beats and "beat N and a half" for an eighth.

- [ ] **Step 1: Update `tests/tledit/probe.js` first** so it fails: a drag of 0.3 beat now snaps to half a beat (one eighth moved; both chords keep their sum); a drag of one beat moves two eighths; a drag of 0.2 beat (under a quarter beat) changes nothing and makes no toast; dragged fully left it stops with the first chord at one eighth; the panel text for a half-beat landing reads "…starts on bar 1, beat 3 and a half".
- [ ] **Step 2: Run** `node tests/tledit/probe.js` — expect FAIL.
- [ ] **Step 3: Implement** `unit = 0.5` and the `_tlWhere` wording.
- [ ] **Step 4: Run** the probe — expect PASS; `./check.sh`. Also drag on the real touch path (CDP `Input.dispatchTouchEvent`) at `se375` and report the numbers.
- [ ] **Step 5: Commit.**

### Task 7: Ship it

**Files:**
- Modify: `docs/phone-test-checklist.md` (one line per change, two at most)
- Version labels (`#ft-ver`, `#unlock-ver`, `MODRIFF_VERSION`) if not bumped in each commit

- [ ] **Step 1: Run the whole set:** `./check.sh`; every `tests/songbuild/*`, `tests/chords/length.test.js`, `tests/tledit/probe.js`, `tests/theme/*`; `npm run build` (needs `node_modules`; if absent, run `npm install` first); the iOS simulator build command from CLAUDE.md is not needed (no Swift or C++ changed).
- [ ] **Step 2: Add the checklist lines:** the length row and nudge on a real phone (thumb reach, ⅛ buttons); eighth snap while dragging on the timeline; shut rows open and stay open; Add a chord position.
- [ ] **Step 3: Open one PR** for the batch (title names the version range, body lists commits one line each plus the phone-test lines), and **merge it with a merge commit**, per CLAUDE.md. Do not squash.
- [ ] **Step 4: Tidy:** stop the `8777`/`8778` servers; remove the worktree `../modriff-spike` and its branch only after the owner confirms.

## Not in this plan

The Perform page (header picker, Tiles / Chart / Timeline tabs, Moves, widget stack like Live) is a separate plan, written after Build ships, so its look can reuse what Build lands.
