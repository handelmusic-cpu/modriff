# Studio on a wide window: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development). Steps use checkbox syntax.

**Goal:** On the Mac app and the desktop web page, show Studio's pages with the roll or grid on top and the rest in two columns, with no tabs.

**Architecture:** CSS only, in `index.html`, under one gate: `html:is(.mac-app, .desktop-web)` at `@media (min-width:1000px)`. Bass and Melody (`.bl-page-wrap`, a flex column ordered by `data-acrow`) become a 2-column grid with the full-width rows spanning. Drums, Aux, Arp, Sampler and mõdFX (stacks of `.st-fold-h` header + `.st-card-body` pairs) become CSS multi-column (`column-count:2`, balanced for free) with the roll rows `column-span:all`. No DOM moved, no id or control touched.

**Tech Stack:** CSS (grid, multi-column), the existing Playwright probes, `screencapture -l` on the rebuilt dev app.

**Spec:** `docs/superpowers/specs/2026-11-20-studio-wide-layout-design.md`

## Global Constraints

- Gate: `html:is(.mac-app, .desktop-web)` and `min-width:1000px` for all new rules; the phone, iPad, closed Duo and `body.mode-basic` are untouched.
- No DOM moves, no renamed ids, no new controls. Rules live in one block, `/* Studio, wide window */`, after the existing wide-roll block (`@media (min-width:1000px)` near `#bm-bass-panel .bl-page-wrap`).
- No emoji; no other companies' product names; comments say why.
- Verified in the real Mac window and in Chrome; each page's capture goes in the PR.
- Version: next label is a fifth part (`1.9.9.9z` is used twice); use `1.9.9.9.1`, the owner can rename it.

## Review Focus

- A card header separated from its body by a column break (`.st-fold-h` needs `break-after: avoid-column`; check Safari/WebKit in the Mac app).
- A page with one very tall card (Sampler's pad grid, mõdFX's pad, Arp's `#arp-strip-body`): the columns balance badly; the tall card spans both columns instead.
- A folded card (`.st-fold-body` collapsed): the column count and balance still hold when a card opens or closes.
- Window narrowed to 884 pt (about 884 css px, under the 1000 gate): the single column and the tabs come back.
- The tabs' state when the window is resized across 1000: `data-ed` is left alone; only CSS shows all sections.

## Task 1: Bass and Melody (roll on top, Sound and Timing beside)

**Files:** Modify `index.html` (CSS beside `body:not(.mode-basic) :is(#bm-bass-panel, #bm-melody-panel) .bl-page-wrap[data-ed=...]`). Test `tests/studio-wide/wide.test.js` (new).

**Interfaces:** Consumes `data-acrow` values `pick, mode, gen, write, behave, chips, tapmode, roll, toolbar, saved, voice, tone, timing` and `[data-ed]`. Produces the `@media (min-width:1000px)` block `Studio, wide window` that later tasks extend.

- [ ] **Step 1:** Write `wide.test.js`: Chrome at 1500x900 with `html.desktop-web`, `studioShow('bass')`; assert the roll (`#st-card-bass-roll`) is above `[data-acrow=timing]` and `[data-acrow=voice]`, that `timing` and `voice` are both visible with `data-ed="pattern"`, that their left edges differ (two columns) and that `studioShow('melseq')` gives the same. Add the 390x844 case: with the gate off, `timing` is hidden on the Pattern tab (unchanged).
- [ ] **Step 2:** Run it; expect FAIL (timing hidden on Pattern).
- [ ] **Step 3:** CSS: in the gate, `.bl-page-wrap { display:grid; grid-template-columns:1fr 1fr; column-gap:16px; }`; every `data-acrow` except `voice, tone, timing` gets `grid-column:1/-1`; `voice` and `tone` column 1, `timing` column 2; override the `[data-ed]` hiding rules with `display:revert !important` for `timing, tone, voice, .pp-bar > [id$="-patch"]` and the part's mõdFX readout.
- [ ] **Step 4:** Run the test; expect PASS. Run `tests/mac-layout/live.cjs`.
- [ ] **Step 5:** Commit.

## Task 2: Arp, Sampler, mõdFX (two columns)

**Files:** Modify `index.html` (same block). Test `tests/studio-wide/wide.test.js`.

**Interfaces:** Consumes `#bm-arp-panel > .panel.p-perform`, `#ps-panel`, `#modfx-panel` and their `.st-fold-h` + `.st-card-body` pairs. Produces the shared rule `.studio-cols { column-count:2; column-gap:16px }` applied by selector (not a new class).

- [ ] **Step 1:** Extend the test: for `arp`, `smp`, `fx` assert the panel's `column-count` is 2, no `.st-fold-h` is the last box in a column (its next sibling's top is within 60 px below it), and the page's scroll height at 1500x900 is under 1.3 x the viewport (Arp 1179, Sampler 1551, mõdFX 1162 today).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** CSS: the three panels `display:block; column-count:2; column-gap:16px; max-width:none` (mõdFX's `#pf-fx-panel` is 700 wide today); `.st-fold-h { break-after:avoid-column; break-inside:avoid; }`, `.st-card-body, .arp-preview, .msx-pcard { break-inside:avoid; }`; the one tall card on each page (`#ps-grid`, `#st-card-fx-pad`, `#arp-strip-body`) gets `column-span:all`.
- [ ] **Step 4:** Run; expect PASS. If a header lands apart from its body in the Mac app, replace `break-after` with `display:contents` pairs only if the capture shows it, not before.
- [ ] **Step 5:** Commit.

## Task 3: Drums and Aux (grid on top, rest in two columns)

**Files:** Modify `index.html`. Test `tests/studio-wide/wide.test.js`.

**Interfaces:** Consumes `#ac-drums-panel .sq-wrap` (flex column; children carry `data-acrow` `pick, voice, roll, kit, timing, fx, extra, status, toolbar, saved`). Produces nothing later tasks need.

- [ ] **Step 1:** Test: `studioShow('drums')` and `studioShow('aux')`: the grid card `#st-card-drums-grid` is above the timing and patterns cards, which sit in two different columns; page height under 1.3 x viewport.
- [ ] **Step 2:** Run; expect FAIL (1349 px page).
- [ ] **Step 3:** CSS: `.sq-wrap { display:block; column-count:2; column-gap:16px }`; `[data-acrow=pick], [data-acrow=roll], [data-acrow=voice], [data-acrow=toolbar], [data-acrow=saved], [data-acrow=status], .sq-kit-legend { column-span:all }`; headers `break-after:avoid-column`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit.

## Task 4: The web page mirrors the Mac Studio header

**Files:** Modify `index.html` (the `html.mac-app .ss-cur ... .ss-chip` block, about line 2364). Test `tests/studio-wide/wide.test.js`.

**Interfaces:** Consumes the existing `html.mac-app` rules (`.studio-strip.ss-placed`, `.ss-cur`, `.ss-gh`, `.ss-head`, `.ss-pick`, `.ss-grp`, `.ss-gb`, `.ss-chip`, and the centred-column rules after them).

- [ ] **Step 1:** Test: at 1500x900 `desktop-web`, `.ss-pick` is a 9-column grid (`grid-template-columns` has nine tracks) and `#ss-cur` is hidden; at 390x844 it is the picker button.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Repeat the Mac rules as `@media (min-width:880px){ html.desktop-web ... }` (not by editing the Mac selectors: the Mac keeps them unconditional).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit.

## Task 5: Check, version, ship

- [ ] `./check.sh`; `npm run build`; `npm run build:web`; `tests/mac-layout/live.cjs`; `tests/studio-wide/wide.test.js`.
- [ ] Rebuild the Mac app (`bash ios/mac-catalyst/run-mac.sh`), `screencapture -l` each of Drums, Aux, Bass, Melody, Arp, Sampler, mõdFX; narrow the window to 884 pt and capture Bass.
- [ ] Bump the version (`#ft-ver`, `#unlock-ver`, `MODRIFF_VERSION`) to `1.9.9.9.1`; check `build/build.mjs` accepts a fifth part.
- [ ] One checklist line; commit the spec and plan; PR; merge.
