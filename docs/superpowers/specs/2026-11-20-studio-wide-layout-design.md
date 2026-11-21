# Studio on a wide window: roll on top, two columns, web mirrors Mac

Status: for the owner's approval. Nothing built yet.

## Intent

On a Mac window (and a desktop browser) Studio scrolls and hides controls behind tabs, because it keeps the phone's single
700 pt column. The window has the room: show more at once, so there is less scrolling and fewer taps.

## Decided with the owner

- **Drums, Aux, Bass, Melody:** the roll (grid) on top, full width, as shipped for Bass and Melody in 1.9.9.9y/z. Under it,
  the rest of the page in two columns. For Bass and Melody that means the tabs go away on a wide window: Pattern's
  toolbar and Generate row stay under the roll, and Sound and Timing sit side by side beneath them.
- **Arp, Sampler, mõdFX:** their cards flow in two columns. These pages have no tabs and are the ones that scroll most.
- **The desktop web page mirrors the Mac app.** One rule for both: `html:is(.mac-app, .desktop-web)` (the page already
  tags desktop browsers `desktop-web`: hover and a fine pointer, so touch tablets stay out).
- Chords and Solo, Live, Song, Mix: unchanged by this design.

## Goals / non-goals

- Goals: no scrolling to reach Sound and Timing on Bass and Melody; Arp, Sampler and mõdFX mostly in one screen at the
  Mac's default window; the web page and the Mac app look the same.
- Non-goals: any change on a phone, an iPad or the closed Duo (they keep the single column and the tabs); new controls;
  moving or renaming any control or id.
- Anti-goal: a layout that looks tidy but breaks a control, a test or a saved setup. Controls stay where they are in the DOM.

## Constraints

- The wide rules apply at 1000+ css px of page (the Mac app's viewport zoom gives about 1100 at the default window).
- The Mac's existing `html.mac-app` Studio rules (the single row of nine module chips, centred columns) are copied to
  `desktop-web` in the same change, at 880+ px, so the web page really does mirror the Mac.
- `body:not(.mode-basic)` rules and `[data-ed]` (the tab hiding) are what a wide window overrides; phones keep them.
- Verified in the real Mac window (screencapture of the dev app), the way 1.9.9.9u-y were, and in Chrome for the web page.

## Approaches

- **A. Page styling only (chosen, my call).** On a wide window, stop hiding the tabs' sections and lay the page out with a
  CSS grid (Bass, Melody, Drums, Aux) and a two-column flow with `break-inside: avoid` (Arp, Sampler, mõdFX). No DOM
  moved. Small and safe. The two columns are not balanced: one can end up longer.
- **B. A script balances the columns.** Measures each card and moves it between two column containers. Tidier, but it
  moves real controls, and tests and code rely on where they are. Only if A looks lopsided.
- **C. Keep the tabs, add a second pane beside the roll.** Needs a second selector; more to learn. Rejected.

## Left to the builder

- Which cards go in which column on each page (read the sections in the DOM order; keep related cards together).
- The Drums and Aux detail (Grid | Kit view, groove and kit cards): the owner has said roll on top; the exact two-column
  split of what is under it is the builder's call, shown to the owner in a capture before it ships.
- The open Duo: same wide rules if it measures 1000+ px, otherwise left as is; checked separately after the Mac.
- Version label: the last letter `z` is used (1.9.9.9z, twice: #597 and #599 share it). The next step is a fifth part,
  which the repo's rule leaves to the owner (`1.9.9.9.1`?).

## Checks

- Real Mac window: Bass, Melody, Drums, Aux, Arp, Sampler, mõdFX at the default size and narrowed to 884 pt, with the
  page's own screenshots saved in the PR.
- Chrome at 1500 x 900 for the web page; phone sizes (390 x 844, 844 x 390) unchanged; tests/mac-layout/live.cjs passes.
