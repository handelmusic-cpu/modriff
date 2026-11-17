# Header and search results artwork

Upload these separately in App Store Connect → your app version → **Header and
Search Results** (or import them through Asset Library):

| Placement | Upload | Dimensions |
| --- | --- | --- |
| Product page header | `modriff-header.png` | 3840 × 1646 |
| Search results | `modriff-search.png` | 3840 × 2560 |

These are separate placement assets, not a Universal asset. Assign the search
image explicitly rather than selecting “Use header asset in search results.”
The artwork has an opaque background. The generous surrounding space is
intentional: Apple's placements crop differently across devices. Preview both
in App Store Connect before submitting them for review.

The search artwork uses the existing actual Live screenshot at
`../screenshots/v6.9.2/iphone-6.9in-02-live.png`, cropped to the chord controls;
the interface is not an illustrated mockup. English copy is used in both assets.
No app behavior or release labels change.

Regenerate with `node docs/app-store/creative-assets/render.mjs` from the repo
root. Requires Node with built-in WebSocket and Google Chrome on macOS (override
the executable with `CHROME`). The renderer uses an ephemeral local server and
Chrome profile, waits for fonts and images, and checks each focal element
against Apple's placement safe area before saving the PNGs.

Verified against Apple's specifications on November 16, 2026:

- Header safe area: 1646 × 661 at (1097, 493).
- Search safe area at maximum resolution: 2168 × 1030 at (836, 765).
- PNG dimensions and absence of alpha channel checked after rendering.
- Both final compositions visually inspected; `./check.sh` passes.

Sources:

- https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
- https://developer.apple.com/app-store/asset-best-practices/
