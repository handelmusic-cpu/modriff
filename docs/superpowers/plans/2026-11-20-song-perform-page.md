# Song Perform Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Song > Perform opens on the song and its chart, one tap from the top, with the page's name as a Studio-style header picker, small Tiles / Chart / Timeline tabs, one transport row, and the gig-time extras as quiet widgets under the chart that can be hidden.

**Architecture:** All changes are in `index.html` (the Song header markup, `setSongsMode`, the Perform panel's CSS ordering, a few small JS functions) plus new tests under `tests/songperform/`. The Perform panel is already a flex column ordered by CSS `order`; this reorders and compacts it rather than rebuilding it. Existing ids (`songs-build-btn`, `pv-stage`, `prev-section-btn`, `slb-auto-btn`, `songs-ending-row`, …) stay, so existing code keeps working.

**Tech Stack:** Vanilla JS/CSS in one page, Playwright probes (`tests/layout/lib.js`), the Studio header picker's classes (`.ss-cur`, `.ss-pick`, `.ss-chip`, `.ss-gb`) reused.

**Spec:** the Design section below (agreed in conversation on 2026-11-20, after the owner tried a working spike and said it was "so much better"). **Reference implementation:** `/Users/benjaminhandelm1air/modriff-perform-spike` on branch `spike/song-perform` (uncommitted), diff saved at `/private/tmp/claude-501/-Users-benjaminhandelm1air-modriff/7e9fcc6b-34c4-484e-b664-50f975e6a96c/scratchpad/song-perform-spike.patch` (150 lines). It is a throwaway: port it task by task onto a fresh branch from `origin/main`, with tests, not by applying the patch whole. Where this plan differs from the spike, the plan wins.

## Design (what was decided)

- The page's name is a header button with a caret (`Perform ▾`); one tap opens Build / Perform / Library as three chips, like Studio's module picker. The old wide three-button switch stays in the page, hidden, so code that toggles it keeps working. **On `html.mac-app` the old switch stays visible and the picker is hidden** (Studio's Mac layout does the same).
- Perform order: song (`‹ title ›`), then Tiles | Chart | Timeline as small underlined tabs with Stage beside them, then one transport row `‹  ▶ Play song  ›  Save` (Prev and Next are square 52 pt buttons with real `‹` `›` glyphs and `aria-label`s, not CSS font tricks), then the chart or tiles themselves.
- Under the content, as quiet cards with a small caption: Endings, Practice (Speed up, Next key, Loop bars), Key and saved settings (Save Settings, key stepper), then the Setlist. A "Show or hide widgets" button at the foot opens a checklist; hiding changes only what is drawn, never a widget's state (an armed ending stays armed). The choice is stored under the new key `modo-perform-widgets` as the list of widget names that are OFF; nothing stored means all shown.
- Not changing: what any control does, Live's Endings widget, the Build page, Stage, the saved-song format, `modo-` keys other than the one new key.
- Not in this plan: reordering widgets (Live-style drag), and any Studio Pack gating of the widget switch. Ruling for the plan: ungated in this batch; the owner decides later.

## Global Constraints

- Run `./check.sh` after every edit; a syntax error is a blank page.
- No emoji in the UI. `‹ › ▾ ▶` are plain symbols; `▶` already has a text form in this app's symbol font (CLAUDE.md, "No emoji"). Do not add any symbol with an emoji form without adding it to the symbol subset.
- Never rename a `modo-` key. The one new key is `modo-perform-widgets`.
- New module-level values read from far away are `var`, not `let`/`const` (temporal dead zone).
- Comments say why, and name the bug the shape prevents. No model name in any comment, commit or PR.
- Appearance: tokens only (`--pc`, `--surf`, `--surf2`, `--bg`, `--border`, `--border2`, `--muted`); a new literal colour must still read in Light and Monotone (`tests/theme/*`).
- Every commit ends with `Co-authored-by: Claude <noreply@anthropic.com>` (plus `Claude-Session: …` when a session id exists). Subject `v<label>: …`; the label is the next step after `origin/main`'s version at the time (`#ft-ver`, `#unlock-ver`, `MODRIFF_VERSION` agree; `build/build.mjs` fails otherwise). At plan time main is `1.9.9.9t`, so the next is `1.9.9.9u`; re-check.
- Verified means measured on this Mac. A phone check never gates the merge: add lines to `docs/phone-test-checklist.md` (two at most).
- Test housekeeping: `tests/tledit/probe.js` already fails 5 checks on main; do not count them against this batch, and compare its FAIL list before and after.

## Review Focus

1. No song loaded (the banner says "No song loaded"): Perform still draws a sensible page (header, song nav, tabs, transport) and nothing throws; Play with no song does what it did before.
2. A free build (no Practice Pack, no timeline): Timeline and Stage keep their lock marks and open the pack sheet; the Practice buttons still open the pack sheet. Hiding the Practice widget must not break the way back (the checklist always lists it).
3. Wide and odd windows: `ipad820`, `duoOpen`, `phoneLand` (844 x 390), `duoClosed` and the Mac app. The header picker and the transport row neither overflow nor overlap; the Mac app keeps the old three-way switch.
4. Everything that points at the old switch: the tutorial step with `el:'#songs-subnav'`, the "what is this" labels for `#songs-build-btn` / `#songs-perform-btn` / `#songs-library-btn`, `tests/library/probe.js` (taps `#songs-library-btn`), `tests/targets/probe.js`. None may be left aiming at a hidden element.
5. `modo-perform-widgets` unreadable or hostile: not JSON, not an array, names that are not widgets, a very long list: all shown or the known ones hidden, never a throw and never a widget stuck hidden with no way back.
6. State crossing the picker: it is open while the mode changes by another route (Find, a stored link, `setSongsMode` from elsewhere), while the Song tab is left, or while Stage opens: it closes and the label is right; an armed ending stays armed while its widget is hidden.
7. Playing state: `slb-auto-btn` reads "Stop song" while the song plays and still fits the transport row at 375 pt; Prev and Next keep their accessible names.

---

### Task 1: The header picker

**Files:**
- Modify: `index.html` — markup before `<div class="subnav" id="songs-subnav"`; JS next to `setSongsMode`; CSS next to the `#songs-subnav` rules; the tutorial step and the labels list that mention `#songs-subnav` / `#songs-*-btn`
- Create: `tests/songperform/perform.probe.js` (modelled on `tests/songbuild/build.probe.js`, using `tests/layout/lib.js`)
- Modify: `tests/library/probe.js`, `tests/targets/probe.js`

**Interfaces:**
- Produces: `#songs-head` (`.sg-head`, position relative, `--pc:#9b6dff`) holding `#songs-cur` (`.ss-cur`, `aria-haspopup`, `aria-expanded`) with `#songs-cur-n` (the mode's name) and `#songs-pick` (`.ss-pick`) with three `.ss-chip[data-m]` buttons (`build`, `perform`, `library`) in an `.ss-gb` grid. `songsPickToggle(force?: boolean): void`, `songsPickGo(m: 'build'|'perform'|'library'): void`, `songsCurPaint(m): void` (called from `setSongsMode`). The picker closes on an outside pointerdown, on Escape, on `songsPickGo`, and when the Song tab is left. `#songs-subnav` is `display:none` except under `html.mac-app`, where `.sg-head` is `display:none`.
- Consumes: `setSongsMode(m)` (existing), the Studio picker's CSS classes.

- [ ] **Step 1: Write the failing probe.** At `se375`, `p390`, `p430`, `ipad820`, `phoneLand`: boot, go to Song, assert `#songs-cur` is visible, at least 44 x 44 pt, its `#songs-cur-n` reads the current mode ("Build"), `#songs-pick` is hidden and `aria-expanded` is `false`; a tap opens it: three chips, each at least 44 pt tall, no overflow of chip text, `aria-expanded` `true`; picking Perform shows `#songs-perform-panel`, hides the build panel, the label reads "Perform", the picker is closed; pick Library likewise; an outside tap closes an open picker; Escape closes it; calling `setSongsMode('build')` from script while it is open closes it and relabels; leaving the Song tab (`switchTab('live')`) with it open and coming back finds it closed. At `html.mac-app` (add the class before booting the Song tab): `#songs-subnav` is visible and `#songs-head` is not. No page errors.
- [ ] **Step 2: Run** `node tests/songperform/perform.probe.js` — expect FAIL (no `#songs-cur`).
- [ ] **Step 3: Implement** the markup, the three functions, `songsCurPaint` called from `setSongsMode`, the outside-tap and Escape listeners, the tab-leave close, and the CSS (the `.ss-cur` / `.ss-pick` / `.ss-chip` classes are reused; `.sg-head.open .ss-pick{display:block}`). Point the tutorial step at `#songs-head`; add `#songs-cur` to the labels list ("The page you are on: Build, Perform or Library") and keep the old three entries.
- [ ] **Step 4: Update `tests/library/probe.js` and `tests/targets/probe.js`** so they open Library, Build and Perform through `#songs-cur` and `#songs-pick [data-m=…]`, and list `#songs-cur` among the song-tab targets. Run both and `node tests/songperform/perform.probe.js` — expect PASS for the new probe and the same results as on main for the other two (record their FAIL lists before and after).
- [ ] **Step 5: Commit** (`v<label>: Song has a header picker, like Studio's, in place of the wide three-way switch`).

### Task 2: Perform's order, tabs and transport row

**Files:**
- Modify: `index.html` — Perform panel markup (Prev / Next glyphs and `aria-label`s), the `#songs-perform-panel` CSS block after `#songs-perform-panel #slb-save-btn`
- Extend: `tests/songperform/perform.probe.js`

**Interfaces:**
- Produces: CSS `order` values inside `#songs-perform-panel`: setlist-nav 1; `#pv-switch` and `#pv-stage` 2 (one line: switch `flex:1 1 calc(100% - 106px)`, Stage `flex:0 0 98px`); `#prev-section-btn` 3, `#slb-auto-btn` 4, `#next-section-btn` 5, `#slb-save-btn` 6 (one line: Prev and Next `flex:0 0 52px`, Save `flex:0 0 64px`, Play fills the rest); `#songs-full-chart` and `#songs-chart-panel` 7; widgets from 8 up (Task 3). Prev and Next contain a `<span aria-hidden>` glyph (`‹`, `›`) and keep `id`, `onclick` and a new `aria-label` ("Previous section", "Next section"). `!important` on `order`/`flex` only where the existing, more specific `.slb-controls > …` rules would otherwise win.
- Consumes: the existing ids and handlers.

- [ ] **Step 1: Write the failing probe sections** (se375, p430, ipad820, phoneLand, duoClosed) with a song of four chords loaded and Perform open: the vertical order of tops is song nav < tabs row < transport row < chart/tiles; the tabs and Stage share one line, and Prev, Play, Next, Save share one line (equal `top`); at `se375` the first chord tile (Tiles) and the first chord diagram (Chart tab) start within 560 pt of the top of the page; the three tabs switch the view (`songsPerformViewSet`) and the active tab is marked `aria-pressed="true"`; no `#songs-perform-panel button` overflows its box (Prev and Next excepted by being glyph-only: assert their `aria-label`s instead); `#slb-auto-btn` reads "Stop song" after a tap and still shares the line; with no song loaded nothing throws and the banner text still exists; `#pv-stage` and `#pv-timeline` keep their lock class on a free build (`setModTier('free')` before booting).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the markup change and the CSS block. Tabs: transparent, no border, an underline on the active one, 44 pt tall. Stage: a quiet outlined button. Prev and Next: neutral square buttons.
- [ ] **Step 4: Run** the probe, `node tests/stage/probe.js` and `node tests/timeline/probe.js`; record FAIL lists against main for the last two — expect no new failures. `./check.sh`.
- [ ] **Step 5: Commit.**

### Task 3: Widgets, and the switch that hides them

**Files:**
- Modify: `index.html` — markup at the foot of `#songs-perform-panel` (button `#pf-widgets-btn`, sheet `#pf-wsheet` with four checkboxes `input[data-w]`), the two key controls get class `pf-w-key`, JS next to `setSongsMode`, CSS
- Extend: `tests/songperform/perform.probe.js`

**Interfaces:**
- Produces: `var PF_WIDGETS = ['endings','practice','key','setlist']`; `pfWidgetsOff(): string[]` (the OFF list from `modo-perform-widgets`; `[]` for anything that is not an array of strings; unknown names are ignored when painting), `pfWidgetsPaint(): void` (toggles `pf-off-<name>` on `#songs-perform-panel` and syncs the checkboxes; called from `setSongsMode('perform')`), `pfWidgetSet(box: HTMLInputElement): void`, `pfWidgetsToggle(): void` (opens or closes the sheet and sets `aria-expanded` on the button). Hiding rules: `pf-off-endings` hides `.ending-row`, `pf-off-practice` hides `.prac-row`, `pf-off-key` hides `.pf-w-key`, `pf-off-setlist` hides `#songs-perform-panel > .panel`. Order: Endings 8, Practice 9, key controls 10, Setlist 11, the widgets button 12, the sheet 13. Each widget is a quiet card with a small caption (reuse the `.ms-lbl` text: "Ending", "Practice"); chips share a row (five endings on one line at 375 pt); `.ending-hint` and the endings `?` stay hidden.
- Consumes: `modStore.getItem/setItem`, `armEnding(name)` and its `.armed` state (existing).

- [ ] **Step 1: Write the failing probe sections:** default: all four widgets visible and all four checkboxes checked; unchecking Endings hides `#songs-ending-row` and stores `["endings"]`; checking it restores it; a reload keeps the choice; `localStorage['modo-perform-widgets']` set to `not json`, to `{"a":1}`, to `["bogus"]` and to a 500-name array: the page boots, shows all four widgets (or hides only known names), and all four checkboxes can be re-checked, with no page error; `armEnding('ritard')` then hiding Endings: the ritard button keeps `.armed` and showing Endings again still shows it armed; the checklist button is 44 pt tall and its sheet lists exactly Endings, Practice, Key and saved settings, Setlist; at `se375` the five endings buttons share one line and the key stepper (`.tg.pf-w-key`) shows "C Major" and both its buttons without clipping (`scrollWidth <= clientWidth`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** as in the spike's JS and CSS, with the two fixes the spike lacked: `pfWidgetsOff` must reject non-arrays and non-string entries, and `pfWidgetsPaint` must ignore names not in `PF_WIDGETS`.
- [ ] **Step 4: Run** the probe; run the tutorial and endings tests that exist (`grep -l "armEnding\|songs-ending-row" tests -r`) against main and here, expecting no new failures; `./check.sh`.
- [ ] **Step 5: Commit.**

### Task 4: Every theme and every width

**Files:**
- Modify: `index.html` CSS only, if a probe shows a gap
- Extend: `tests/songperform/perform.probe.js`
- Test: `tests/theme/monotone.test.cjs`, `tests/theme/surfaces.test.cjs`, `tests/theme/hue-probe.js`

- [ ] **Step 1: Write the failing probe sections:** in Light (`body.light-mode`) the header button, the chips, the tabs, the widgets' captions and the Stage button have a text colour at least 4.5:1 against their own background (compute from the rendered colours); at `ipad820`, `duoOpen` and `phoneLand` the page's content width does not exceed 700 pt and nothing overflows horizontally (`document.documentElement.scrollWidth <= innerWidth`); in the Mac app class the old switch is the only way shown.
- [ ] **Step 2: Run** — expect FAIL only where a gap exists; fix it in CSS, tokens only.
- [ ] **Step 3: Sweep:** run `node tests/theme/monotone.test.cjs` and `node tests/theme/surfaces.test.cjs`, then run `tests/theme/hue-probe.js`'s `__sweep` on Song > Perform in Monotone (dark and light) for this branch and for `origin/main` and compare: no new hued colours. Take screenshots in dark, Light and Monotone and look at them.
- [ ] **Step 4: Commit.**

### Task 5: Ship it

**Files:**
- Modify: `docs/phone-test-checklist.md` (two lines at most); version labels if not bumped in each commit

- [ ] **Step 1: Run the whole set:** `./check.sh`; `node tests/songperform/perform.probe.js`; `node tests/songbuild/build.probe.js` (Build must be unchanged); `node tests/library/probe.js`; `node tests/targets/probe.js`; `node tests/stage/probe.js`; `node tests/timeline/probe.js`; `node tests/tledit/probe.js` (same 5 failures as main, no others); `node tests/theme/*`; `npm run build` and `npm run build:web`. The Swift and C++ build is not needed (no native file changed).
- [ ] **Step 2: Add the checklist lines:** on an iPhone, Song's header picker and the Perform tabs and transport row are easy to hit and the chart is one tap from the top; the widgets hide and come back, and an armed ending is still armed when its widget is hidden.
- [ ] **Step 3: Whole-branch review, then one PR** (title names the version; body lists commits one line each, the phone lines and any deferred minors) **and merge it with a merge commit**, per CLAUDE.md. Do not squash.
- [ ] **Step 4: Tidy:** stop the `8780` server; remove `../modriff-perform-spike` and its branch only after the owner confirms; update the memory note `song-page-redesign.md` (Perform built, what is left: widget reordering, Studio Pack gating decision).

## Not in this plan

Reordering widgets by drag, adding more widget kinds, any Studio Pack gating of the widget switch, and the top-bar Chart button another session proposed (the chart is now a tab one tap from the top, which covers it).
