# Studio part pages: one layout

Drums, Bass, Melody and Arp are four pages of the same kind of thing and were built as four. This is the shape they all move to, and where
each one stands. It is the spec for the order of a page and the sizes of what is on it; colours are each part's own (PARTS) and stay.

## The order of a page, top to bottom

1. **Title** — the part's name in its colour.
2. **Pick** — two boxes, 66 pt: what it plays (Groove / Bass line / Melody line / Arp pattern) and what it plays it with (Kit / Patch).
3. **Write** — how it gets written: Generate | Arrange | Play in, one segmented control, and that mode's own buttons under it
   (Generate and Clr; Follow and Feel). One primary action per page, 15 pt.
4. **Surface** — the roll or the grid, with Fit | Large. The thing the page is about.
5. **Timing** — Steps, Rate, and Oct where there is one, directly under the surface.
6. **Sound** — Filter (a segment where the part has a choice of ladder, then Cutoff and Resonance), always the same block (`.sf-block`).
7. **mõdFX** — the readout bar and the part's mix.

## Sizes

Heights are the 44 pt floor everywhere. Three roles, set once at the end of the stylesheet under `#page-accomp` (`--pp-r`, `--pp-fs`):

| role | font | corners | examples |
|---|---|---|---|
| control | 13 px | 10 px | Follow, Feel, Rate, Play in, Clr, Fit, Large, Swing, Save, Settings |
| stepper | 16 px | 10 px | the − and + beside Steps and Oct |
| segment | 13 px | 10 px frame | Generate / Arrange / Play in, Filter, Sync / Free, Kit / Aux |

Before 6.0y the same controls came out at eleven font sizes (11 to 15 px) and eight corner radii (square to a pill).

## Where each page stands

- **Bass** — conforms: pick, write, surface, timing, sound (its filter is now the shared block, Cutoff and Resonance with readouts; it has
  no ladder to choose), mõdFX. It is the reference.
- **Melody** — the same page as Bass, with Mode and Glide beside Follow and a ladder choice in Filter. Conforms.
- **Drums** — sizes conform. Structure does not yet: Steps and Rate are above the grid instead of under it, there is no write mode
  (Play in sits in a row of tools), and the eight pattern slots sit under the grid. Next.
- **Arp** — sizes conform. It has no surface (it is generated from the chords, so there is no roll), and its options are a stack of
  labelled rows inside one card instead of the pick / write / timing blocks. Next after Drums.
