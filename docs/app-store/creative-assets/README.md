# Header and search results artwork

Upload these separately in App Store Connect → your app version → **Header and
Search Results** (or import them through Asset Library):

| Placement | Upload | Dimensions |
| --- | --- | --- |
| Product page header | `modriff-header.png` | 3840 × 1646 |
| Search results | `modriff-search.png` | 3840 × 2560 |

Both feature the English listing subtitle, **Make Music Without Limits**, over
waveform traces. The mark comes from `#unlock-logo` in `index.html`, including
its wave, knobs and envelope line. Each render exports `splash-logo.svg` from
that source and its dark-theme palette.

Assign each image to its placement. The waveform artwork extends beyond the
safe area so it can fill different crops. Preview both placements in App Store
Connect before submitting them for review.

The search artwork pairs the subtitle with the chord pads from the Live iPhone
capture at `../screenshots/v7.1-captioned/raw/iphone-01-live.png`.

Regenerate with `node docs/app-store/creative-assets/render.mjs` from the repo
root. Requires Node with built-in WebSocket and Google Chrome on macOS (override
the executable with `CHROME`). The renderer uses an ephemeral local server and
Chrome profile, waits for fonts and images, and checks each focal element
against Apple's placement safe area before saving the PNGs.

Verified against Apple's specifications on November 23, 2026.

- The header wordmark and subtitle fit within the 1646 × 661 safe area at (1097, 493).
- The search wordmark, subtitle and chord pads fit within the 2168 × 1030 safe area at (836, 765).
- Both PNGs were visually inspected and checked for dimensions and opacity.
- `./check.sh` passed.

- [Apple’s creative asset specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)
- [Apple’s App Store asset best practices](https://developer.apple.com/app-store/asset-best-practices/)
