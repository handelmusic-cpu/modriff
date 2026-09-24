# MōdRiff — working notes

## Always merge

When work is finished and verified, open the pull request **and merge it** —
don't stop to ask. "Should I PR this?" and "want me to merge?" are not
questions worth a round trip. Report what shipped instead.

The exception is work that isn't verified yet: an unverified change doesn't
get merged, it gets finished first.

## Shape of the repo

Everything is `index.html`. One file, ~32k lines, in three parts:

| roughly | what |
|---|---|
| 60–4500 | CSS — design tokens at the top, then components |
| 4500–6400 | body markup |
| 6400–end | one `<script>` under `'use strict'` |

Alongside it: `sw.js` (service worker), `manifest.webmanifest`, `samples/`,
the icons, and `check.sh`.

The version string lives in three places and they must agree: `#ft-ver`,
`#unlock-ver`, and `MODRIFF_VERSION`. `VERSION` in `sw.js` is a cache key for
immutable assets, **not** a release number — leave it alone.

## After every edit

```sh
./check.sh
```

It pulls each top-level `'use strict'` script out of the HTML and runs
`node --check` over it. A syntax error in a 32k-line file is otherwise a blank
page with nothing in the console, so run it before you believe anything works.

## Verify by measuring, not by reading

Changes here are to audio and to touch, and both lie when you only read the
diff. The pattern that works: drive the real app with Playwright, instrument
the thing you changed, and print numbers.

```sh
python3 -m http.server 8777 --bind 127.0.0.1   # dies between long gaps; restart it
node /path/to/probe.js                          # chromium at /opt/pw-browsers/chromium
```

- Real touch needs CDP `Input.dispatchTouchEvent`. `touchEnd` takes the points
  that **ended**, not the ones still down; `touchCancel` takes none.
- `setTargetAtTime` approaches its target exponentially and never arrives, so
  "is this parameter back to zero" needs an audibility floor
  (`abs(y-x) > max(0.002, 0.02*abs(x))`), not an equality check.
- Count what you claim. "No stray notes after Stop" means you counted them.

## Temporal dead zone

This has bitten the project four times and will again. Module-scope `let` and
`const` are readable only by code that *runs* after the declaration — and
functions declared thousands of lines earlier are routinely called first.

- `typeof x` on a `let` in its dead zone **throws**. It is not a safe guard.
- New module-level flags read from far away: use `var`.
- Cross-region APIs: hang them on `window.*` (`window.fxSendsAPI`,
  `window._blOnChord`).

## Single sources of truth

Several tables drive many surfaces at once. Change the table, not the
surfaces.

- `PARTS` — mix strips, MōdFX channels, stem labels, voice and layer
  membership. `MIX_CHANNELS`, `FX_CHANNELS` and `STEM_LABELS` are all derived
  from it.
- `_partBuses` / `_partDest(ctx, part)` — every part's own bus. Meters, MōdFX
  chains and stems all tap it, so a part with no bus silently has none of the
  three.
- `_blChordWin` + `window._blOnChord` — the chord timeline. Bass *and* melody
  follow it; there is no second copy.
- `_slotExtSuffix(slot)` — how a chord's quality is spelled, everywhere a chord
  name is drawn.

## Comments

The codebase explains *why*, at length, wherever the reason isn't obvious from
the code — usually by naming the bug the current shape prevents. Match that.
A comment that restates the line below it is noise; one that says "this used
to do X, which broke Y" is why the next person doesn't undo it.

Don't put model names or session identifiers in anything that gets pushed.
