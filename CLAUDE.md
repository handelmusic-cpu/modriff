# mõdRïff — working notes

The product is the **iPhone app** (App Store): C++ DSP under a Swift/AVAudioEngine
host, the UI still `index.html` inside Capacitor 8. The Vercel web build keeps
deploying but nothing is designed around it. Current phase: **launch** — device
verification, App Store Connect, screenshots. New features wait unless asked.

## Reading the docs (they are big — search, don't read whole)

`grep -n` for the topic, then read that range. Never open these end to end:
`docs/v5-architecture.md` (2.8k lines), `docs/layout-5.0.md` (1.2k),
`index.html` (~70k lines).

| for | read |
|---|---|
| launch: listing text, IAP table, review notes, screenshots, account steps | `docs/app-store.md` |
| what to check on a phone | `docs/phone-test-checklist.md` |
| Dynamic Island light | `docs/dynamic-island.md` |
| plan, native steps, open problems | `docs/v5-architecture.md` (keep current when a step lands or a decision changes) |

## Shipping

When work is finished and verified, open the PR **and merge it** — don't ask.
**Batch:** commit each verified change to the session's branch as you go (one
per logical change, usual trailers, version label if it bumps one), then open
**one** PR for everything asked for in that request or session and merge it.
Never wait for a person to say "merge", and never wait for a bigger batch.

- PR title names the range (`v5.0 – 5.0c: …`); body lists commits, one line each.
- Merge commit, not squash: per-change commits and their labels are the record.
- Unverified work stays out of the batch (own branch, say so). Broken production
  is not a batch: fix, verify, ship alone.
- Swift can't be compiled except on the owner's Mac; say "unbuilt" until confirmed.

### Version numbers

Dotted numbers + an optional lowercase letter: `6.9`, `6.9a`, `6.9.1`, `6.9.1a`. It
starts as `major.minor`; no part passes 9. A new batch is the next step at the depth
you are on: `6.4` → `6.5`, `6.9` → `6.9.1` → `6.9.2`, `6.9.9` → `6.9.9.1` (when a
part would pass 9, add a decimal part, never carry into the part before). A
follow-up to the release just out is a letter (`a`–`z`, last part only; more than
26 means it was a new release). A fifth part is probably the owner's call. Old
history keeps its old labels. **Never move to a new major (`6.x` → `7.0`) without
asking first**; the rule never makes it next by itself.

The version lives in `#ft-ver`, `#unlock-ver` and `MODRIFF_VERSION`
(single-quoted; `sw.js` reads it with a single-quote pattern). All three agree,
and the commit subject is `v6.9.1a: …` (PR title: the range, `v6.9.1 – 6.9.1c: …`). `build/build.mjs` fails otherwise. `VERSION`
in `sw.js` is an asset cache key, not a release number — leave it.

## Build and checks

`npm run build` copies the app into `dist/` with comments and whitespace removed
from inline scripts/styles (nothing renamed: `onclick="fn()"` and
`fn.toString()` keep working — never add a renaming minifier). `npm run ios`
builds, syncs `dist/` into `ios/` and opens Xcode. To test what ships, serve `dist/`.

**After every edit: `./check.sh`.** A syntax error in this file is a blank page
with nothing in the console.

`native/modsynth/` is a line-for-line C++ port of `modsynth/dsp.js`. A change to
`dsp.js` is made in both; `make -C native/modsynth` then
`tests/modsynth/null.test.js` says whether they still agree (its README has the
three bit-identity rules).

## Verify by measuring, not by reading

Audio and touch lie when you only read the diff. Drive the real app, instrument
the change, print numbers; count what you claim ("no stray notes" means counted).
Tests live in `tests/<area>/`. If a Playwright run is possible, `python3 -m
http.server 8777 --bind 127.0.0.1` (restart it between long gaps).

- Real touch needs CDP `Input.dispatchTouchEvent`; `touchEnd` takes the points
  that **ended**, `touchCancel` takes none.
- `setTargetAtTime` never arrives: "back to zero" needs an audibility floor
  (`abs(y-x) > max(0.002, 0.02*abs(x))`), not equality.

## Temporal dead zone (has bitten four times)

Module-scope `let`/`const` are readable only by code that *runs* after the
declaration, and functions declared thousands of lines earlier are called first.
`typeof x` on a `let` in its dead zone **throws**. New module-level flags read
from far away: `var`. Cross-region APIs: `window.*` (`window.fxSendsAPI`,
`window._blOnChord`).

## Single sources of truth — change the table, not the surfaces

- `PARTS` → mix strips, mõdFX channels, stem labels, voice/layer membership
  (`MIX_CHANNELS`, `FX_CHANNELS`, `STEM_LABELS` derive from it).
- `_partBuses` / `_partDest(ctx, part)` — each part's bus; meters, mõdFX and
  stems tap it, so a part without one silently has none of the three.
- `_blChordWin` + `window._blOnChord` — the one chord timeline bass and melody follow.
- `_slotExtSuffix(slot)` — how a chord quality is spelled everywhere.

## `modo-` storage keys are load-bearing

All saved state lives under `localStorage` keys prefixed `modo-` (48), plus
older `prism-theme`, `mv-theme`, `modriff-diag`. The app was once called Modo;
it isn't now, and the keys stay. Renaming wipes every user's setups, setlist,
patterns, theme and place. **Never rename a key to match the app's name.** If one
must move, it is a read-old-write-new migration.

## No emoji

None in the interface — icons, labels, toasts (iOS draws them as coloured
pictures). Say it in words or draw it (inline SVG, CSS shapes, a part's colour).
Only exceptions, at the owner's word: folders (🗀 📁) and locks (🔒 🔓). Any
other new emoji is asked about first.

Plain symbols are fine (♭ ♯ → ✕ ◈), but ▶ ◀ ↕ ✔ and some others have an emoji
form iOS falls back to; those code points are claimed by
`fonts/dejavu-symbols-text.woff2` (see the top-of-CSS @font-face note). A new
symbol with an emoji form goes into that subset's unicode-range or stays out.

## Comments

Explain *why*, wherever the reason isn't obvious — usually by naming the bug the
current shape prevents ("this used to do X, which broke Y"). A comment that
restates the line below is noise. Comments never reach a phone (build strips them).

## Commit attribution

Never put a model name ("Opus", "Sonnet", a `claude-*` id) in a comment, commit,
PR or anything pushed — Claude Code's default `Co-Authored-By` offers one; the
name is plain `Claude`. Every commit ends with exactly:

```
Claude-Session: https://claude.ai/code/session_<id>

Co-authored-by: Claude <noreply@anthropic.com>
```
