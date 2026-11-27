# Tuplet switches in the drum grid

## Why

Two instruments should be able to split one tuplet (a 5let, say), which needs single hits
switched on and off. Today a tuplet is a hit count and a span on one cell, and every hit plays.

## Goals

- Where a tuplet is, its row shows one switch per hit in place of the steps it spans.
- Each switch has what a normal step has, and shows which hit it is.
- Saved songs and patterns sound as before (except overlaps made with Free, below).

Not wanted: nested tuplets; changes to plain ratchets (inside one step); free note placement.

## The grid

A 5:4 over steps 1–4 draws five equal switches across the width of those four, 44 pt tall as
now, each with a small number (1–5). Widths come out at hits ÷ span: 7:4 is the narrowest, about
19 pt at default zoom; pinch zoom widens it.

- Tap: on/off. Double-tap: select it and open the editor under the grid. "Tap: Edit" mode works
  on a hit as it does on a step. Audition plays the one hit.
- Look: accent, velocity bar, pitch label, probability dash, flam/ruff mark and ratchet dots, as
  on a step.
- The playhead lights the hit that is sounding, not the sixteenth under it.
- A tuplet is made as now (the Tuplet row of a step's editor; a clash is refused). The ruler and
  all other steps stay on straight sixteenths.
- The Live Aux roll draws the same switches; its tap cycles off, on, accent per hit.

## The editor

For a selected hit: Vel, Ratchet (1–4, inside that hit's own length), Pitch, Prob, Orn, Accent,
and ✕ (switches the hit off). The heading names it: "Snare · step 1 · hit 3 of 5".
The Tuplet row acts on the whole tuplet. Removing it leaves the first step with hit 1's
settings (empty if hit 1 is off). Picking another type keeps hit 1's settings and rebuilds the rest.

All hits may be off. The tuplet stays, still covering its steps, until removed.

No "—" buttons in the Ratchet, Tuplet or Orn rows (a dash does not say "none" or "remove"). Each
row has a worded button, **Remove ratchet**, **Remove tuplet**, **Remove ornament**, shown only
when there is something to remove. This is true of an ordinary step too. `−` and `+` still set the
ratchet count; with no ornament, neither Flam nor Ruff is lit.

## Tuplets: Free is removed

A tuplet always owns the steps it spans. The `#sq-tupcoverBtn` button, `sqTupCover`, the score's
cover flag and their help, search, tutorial and test mentions go. `modo-tupcover` is no longer
read (the key is left alone). Hits under a tuplet stay stored and return when it is removed.
A saved pattern that relied on Free goes quiet on the overlapped steps; of two overlapping
tuplets the earlier wins.

## Data and sound

The head cell keeps `v`, `r`, `rs`; `v > 0` means "there is a tuplet here". It gains an optional
list, `hits`, of `r` entries `{v, vel, p, pr, orn, r}`.

- **No list: plays exactly as today.** New and saved tuplets have none.
- The list is made on the first edit of a hit: hit 1 takes the cell's velocity, accent, pitch,
  probability and ornament; the rest are on, unaccented, at 75% of that velocity, same pitch and
  probability. Until then the editor shows these values.
- Once there is a list, the cell's own `vel`, `p`, `pr` and `orn` are ignored; each hit's apply
  (its pitch on top of the lane's tune).
- With a list, each hit rolls its own probability and velocity humanize, in hit order. Timing
  humanize stays one offset for the whole tuplet. A hit's ratchet tail is 75%, as for a step.
- No automatic "first sounding hit is louder" rule: set velocity or accent per hit.

Must carry the list (deep copy): `sqCellClone`, undo, copy/paste, duplicate, lengthening, pattern
slots, kit changes, setups. `sqCellsSig` must include it (and `r`, `rs`, which it omits now, so a
ratchet or tuplet edit is not seen as an edit).

Both players must agree: `sqPlayCell` / `_sqFireLayer` and `native/modsynth/seqcore.h`.
`_sqNativeScore` and `DrumScore::fromDoubles` move to score version 2 with the list per cell.

## Other writers (my calls; change any that are wrong)

- Playing in (keys, pads, step cursor): a hit landing inside a tuplet's span switches on the
  nearest tuplet hit at that velocity. Clear-at-step switches off the hits starting in that step.
- Fill removes any tuplet overlapping its stretch.
- A kit change that puts two same-type tuplets from different lanes on one voice merges their hits.
- A new tuplet that would run past the pattern's end is refused with a message. One already there
  (saved, or the pattern was shortened) squeezes its switches into the room left; timing unchanged.

## Approaches considered

1. **Hit list on the head cell, switches replace the spanned cells (picked).** Fits the current
   grid and both players.
2. Per-hit buttons in the editor only: smallest, but the grid never shows which hits play.
3. Notes at any position in a lane: rewrites the drum sequencer for no gain here.

## Left to the builder

Switch layout and playhead timing, the score's exact layout, and finding every other reader of a
drum cell (kick-row effects, voice bank recording, MIDI output). Verify with page-versus-native
parity (`tests/seq/drumgrid.test.js`, `scoretest`), a count that an unedited tuplet's hits are
unchanged, and real-touch taps at the narrowest width.
