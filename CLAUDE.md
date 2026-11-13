# mõdRïff — working notes

The product is the **iPhone app** (App Store): C++ DSP under a Swift/AVAudioEngine
host, the UI still `index.html` inside Capacitor 8. The Vercel project now builds the
**free web page** (modriff.com/play: no packs, no recordings; `docs/web-play.md`). Current phase: **launch** — device
verification, App Store Connect, screenshots. New features wait unless asked.

## Reading the docs (they are big — search, don't read whole)

`grep -n` for the topic, then read that range. Never open these end to end:
`docs/v5-architecture.md` (~800 lines), `docs/layout-5.0.md` (~570), `index.html` (~70k lines).
`docs/archive/` is shipped history (old logs, measurements, the full checklist): never read it
unless asked; `grep -n` it only when you need the old reasoning for one specific thing.

| for | read |
|---|---|
| launch: listing text, IAP table, review notes, screenshots, account steps | `docs/app-store.md` |
| what the owner still has to try on a phone | `docs/phone-test-checklist.md` (a short to-do, not a gate) |
| Dynamic Island light | `docs/dynamic-island.md` |
| decisions, open problems, purchase plan | `docs/v5-architecture.md` (update only when a decision or an open problem changes) |
| background audio: moving the sequencers to the engine (design + checkpoint) | `docs/native-scheduling.md` |
| the free web page at modriff.com/play: build, what is off, wiring | `docs/web-play.md` |
| Ableton Link: licence, what is built and where, known limits, what the owner still has to ask Apple and Ableton | `docs/link.md` |

## Shipping

When work is finished and verified, open the PR **and merge it** — don't ask.
**Batch:** commit each verified change to the session's branch as you go (one
per logical change, usual trailers, version label if it bumps one), then open
**one** PR for everything asked for in that request or session and merge it.
Never wait for a person to say "merge", and never wait for a bigger batch.

**Phone checks never gate anything.** "Verified" means measured on the Mac (tests, simulator,
browser, a clean xcodebuild). The owner tries things on a phone as they go and reports problems;
you do not wait for, ask about, or block the next change, the PR, the merge or a native cutover on
a phone check. Add the line to `docs/phone-test-checklist.md`, ship, move on. When the owner says
something is wrong, fix it in the next batch.

**Docs stay small.** A change's record is its commit message and PR body, not a new section in a
doc. Do not append a "Slice N, part M" / "Landed as…" log entry to `docs/native-scheduling.md`,
`docs/v5-architecture.md` or `docs/layout-5.0.md`; edit them only when a decision, a design or an
open problem changes, and replace the stale text instead of adding next to it. The checklist gets
one line per change (two at most), never a table or a section.

- PR title names the range (`v5.0 – 5.0c: …`); body lists commits, one line each.
- Merge commit, not squash: per-change commits and their labels are the record.
- Unverified work (not measured on the Mac; a pending phone check does not count) stays out of the batch (own branch, say so). Broken production
  is not a batch: fix, verify, ship alone.
- Swift and the C++ engine compile on this Mac: run
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`
  (DerivedData in the scratchpad) before a native change counts as done. Never call
  it "unbuilt". What only a phone shows (crackle, timing, behaviour on leaving the
  app) is "not heard on device": add one line per change to
  `docs/phone-test-checklist.md` and list the same lines in the PR body, so the owner
  can check the whole batch in one pass whenever they get to it. `npm run ios:device` installs on the paired iPhone.

**Is Xcode building main?** `ios/App/App/public` is generated and gitignored, so it is only as new
as the last `npm run ios`, and the checkout may lag `origin/main` after other sessions merge. Every app
build stamps `build-info.json` (commit, dirty, page hash; `build/stamp.mjs`) and About shows
`build <commit>` beside the version. `npm run ios:check` prints origin/main, the checkout and the
bundle and exits 1 on any mismatch; `ios` and `ios:device` run it first and refuse a checkout that is
off `main` or behind (`MODRIFF_IOS_ANY=1` to build a feature branch on purpose). Check the phone against
the first line it prints.

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

## Mac app (Mac Catalyst)

One app record, one bundle id: the iPhone target also builds for Mac Catalyst
(`-destination 'generic/platform=macOS,variant=Mac Catalyst'`, same scheme). Capacitor's
prebuilt binaries have no Catalyst slice, so `ios/App/capacitor-swift-pm/` is a local package
that takes over that name; its xcframeworks are generated, not committed, by
`npm run ios:frameworks` (`ios/mac-catalyst/`, run by `npm run ios` and `ios:device`). The same script fetches
Ableton's LinkKit into gitignored `ios/link/LinkKit/` (its licence forbids committing it; `docs/link.md`). **On a
fresh clone or after a Capacitor upgrade run it first, or no build (iPhone too) resolves.**
ActivityKit is compiled out on Catalyst and the Dynamic Island extension is iOS-only
(`platformFilter = ios`). Mac-only sandbox entitlements: `ios/App/App/AppMac.entitlements`. `ios/mac-catalyst/run-mac.sh`
builds it signed and opens it from `~/Applications/modRiff-dev.app`; it **must** be built
optimised (the script does it): the C++ engine at `-O0` misses its audio deadline and sounds
distorted. Takes are saved to `~/Downloads/mõdRïff/Bounces` on the Mac, not the container.
`ios/mac-catalyst/archive-mac-store.sh` makes the Mac App Store `.pkg` (Release archive, exported
with Xcode's cloud-managed Distribution certificate); the page switches on `html.mac-app` for
Mac-only CSS (sheets are centred dialogs there).

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

## No other companies' product names

None in anything a user or App Review sees: kit, voice, patch, filter and effect names,
help text, listing, screenshots. Describe the sound instead (`Analog 1`, `Ladder`,
`Chorus Bass`). Internal ids (`'808'`, `'LIN'`, `acid303`, `samples/808/`) stay as they are:
songs save them. A renamed factory patch goes in `MSX_RENAMED` so old songs still load.
The one place a maker is named is the sample credit in About, where the licence asks for it.

**Ableton Link** is the standing exception, at the owner's word: its licence requires that exact label, with
"Enabled"/"Disabled", on the row that opens Ableton's own pane (Settings). Nowhere else, no badge, no logo.

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
