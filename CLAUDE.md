# MōdRiff — working notes for Claude

Everything below was verified in a browser, not assumed. Read it before you
touch anything.

---

## Keep this file current — every session

**This file is the handoff.** It replaces pasting context into a new session,
so it is only worth anything if it stays true.

Before you finish a session, update it if you:

- **changed the architecture** — a new engine, a new shared helper, a moved
  boundary, a renamed export;
- **lost time to something** that isn't written down yet — put it in
  *Gotchas*, in enough detail that the next session doesn't repeat it;
- **shipped anything** — add it to *What shipped*, and prune the detail from
  older entries so the section stays a summary and not a changelog;
- **moved the roadmap** — something landed, got dropped, or is now waiting on
  Ben's decision;
- **settled a question for good** — if you researched a constraint and it came
  back "can't be done", record it under *Hard constraints* so nobody
  re-litigates it.

Commit the update alongside the work it describes, not as an afterthought.
Nothing here is sacred: if a section has gone stale, rewrite it. A wrong note
is worse than no note.

---

## What this is

**MōdRiff** — a browser groovebox / modal performance instrument, shipped as a
PWA. Tagline: *"Every part, always in key."*

- **The entire app is `index.html`** — ~28,700 lines, 1.5 MB, one file, inline
  `<script>` and `<style>`. No build step, no framework, no bundler.
- Other files: `sw.js` (service worker), `manifest.webmanifest`, icons,
  `samples/`, and `check.sh`.
- Live at `modriff.vercel.app`. Deployed from `main` by Vercel; every branch
  push gets a preview URL.
- Version constant: `MODRIFF_VERSION` in `index.html`.

**The user (Ben) plays this on an iPhone 17 Pro Max.** That is the primary
target. Headless Chromium tests are necessary but not sufficient — font
coverage, real touch, and Safari behaviour differ, and he catches things there.

---

## How to work on it

### Syntax check
```bash
./check.sh          # extracts and parses the inline script blocks
```
Run after **every** edit. It catches parse errors but not missing HTML tags.

### Browser testing
Playwright is available in the session scratchpad. The pattern used throughout:

```bash
cd /home/user/modriff && setsid python3 -m http.server 8199 >/dev/null 2>&1 </dev/null &
```

Then a script that boots the page, clicks "Start Blank", and asserts. Roughly
fifteen such suites were written over one session (`drums.js`, `onscreen.js`,
`gen.js`, `variants.js`, `settings.js`, `songstab.js`, `latency.js`,
`blankchk.js`, `accent.js`, `fing.js`, …). They are throwaway harnesses, not a
committed test suite — **they live only in the scratchpad and are gone in a new
session.** Rewrite what you need.

> **Trap that burned an hour:** a `curl || python3 -m http.server` fallback
> fired while the shell cwd was the *scratchpad*, so the server was serving a
> 404 page as `index.html` and a whole test run "passed" against garbage.
> **Always verify** before trusting a run:
> ```bash
> curl -s http://localhost:8199/index.html | wc -c   # must match wc -c < index.html
> ```
> The server also dies between turns fairly often. Restart it with `setsid`
> from `/home/user/modriff`.

### Git
- Work branch: `claude/iphone-app-performance-lag-ske768`
- **Do not create a PR unless asked.** Ben creates them from the Claude Code UI.
- When the branch's PR has already merged, restart the branch from `main`
  rather than stacking onto merged history.
- Commit trailers he expects:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_…
  ```

---

## How Ben works — read this

- **He reports bugs from his phone, often as screenshots.** Take them seriously
  and reproduce before theorising.
- **He wants the link every time.** He said so explicitly: *"Always give me a
  link like this please, very helpful."* Post the Vercel preview URL on every
  push.
- **He asks "what does X do?" — that is usually a bug report.** If a control
  needs explaining, the control is wrong. The PLAYS badge and the Song button
  both came up this way.
- He makes product decisions fast and decisively. Ask when a choice genuinely
  changes the design; otherwise pick the defensible option and say which.
- He is fine with long, honest commit messages that explain *why*.

---

## Architecture notes you will need

### Engines
Four sequencers share one clock:
- **`sq`** — drums. Lives inside a big IIFE. Internals (`SQM`, `sqGrid`,
  `sqSteps`, `sqMach`) are **not reachable from a page script** — go through
  the `window._sq*` exports (`_sqSteps`, `_sqMach`, `_sqMachines`,
  `_sqCaptureState`, `_sqRestoreState`, `_sqPlayIn`, `_sqMarkCursor`, …).
- **`bl`** / **`ml`** — bass and melody piano rolls, canvas-drawn, registered
  in `PR_ENGINES` with `{lo, hi, steps, cell, setAt, clearAt, displayMidi,
  playStep, …}`.
- **arp** and the chord engine.

### Clock and scheduling
- `LOOK_AHEAD`, `SCHED_INT`, `ALIGN_LEAD` are **`let`**, driven by the latency
  presets. `ALIGN_LEAD` must always equal `LOOK_AHEAD` — `setLatencyPreset`
  assigns both and nothing else may.
- `schedHorizon()` hands every engine the same horizon per tick so they cannot
  drift into different phases.
- `latencyHint` is fixed at `AudioContext` construction, so a preset change
  that moves the buffer only takes full effect on the next context.

### Note input
Every way to play a note funnels through one place, so arming a roll works
from all of them:
- `melPlayIn(midi, pressure, y)` → `noteInputWrite()` when a roll is armed,
  else `playMelNote()`. Called from the computer keyboard, MIDI in, the
  on-screen keys, and both bend-strip paths.
- `noteInputArm(id)` / `noteInputTarget()` / `noteInputCursorStep(id)` manage
  the armed target and the write cursor.

### Cell shapes
```js
blMkCell() → {note, oct, len, slide, accent, v, usr}
mlMkCell() → {note, oct, len, accent, v, usr}
sqMkCell() → {v, r, orn, vel}          // drums: no pitch, no usr
```
`usr` = hand-placed. Generate/Arrange snapshot and restore `usr` cells, so a
played-in riff survives them. **Drums have no `usr` flag**, so Load Groove
replaces played-in hits wholesale — Ben confirmed that is what he wants.

---

## Gotchas that cost real time

1. **Temporal dead zone across the file.** Code defined early (e.g.
   `sqRenderGrid`, `_newAudioCtx`) runs at init and can reach *forward* to
   `let`/`const` declared thousands of lines later. Reading one in its TDZ
   **throws and aborts the rest of the top-level script** — the whole app dies
   with no obvious error. `_recArm` had to become `var`; the latency table read
   is wrapped in try/catch. If you add module-level state that earlier code
   reads, use `var` or guard it.

2. **`preventDefault()` does not stop other listeners.** Several
   `document.addEventListener('keydown')` handlers coexist. Space is bound
   again further down as play/stop. Use `stopImmediatePropagation()` when a key
   is consumed.

3. **Palette variables are not hex.** `--pg` is
   `hsl(calc(0 + 120), calc(85% - 4%), calc(60% + 4%))`. Canvas renders it
   fine, but you cannot do arithmetic on it — a hex parser silently returns the
   input unchanged, so a colour change compiles, runs, and does nothing. Use
   `_prResolveRgb()`, which asks `getComputedStyle` and gets real rgb numbers.

4. **Astral emoji in a JS character class split into surrogate halves**, so
   `/[👆👇]/` matches *any* emoji. Use the `u` flag.

5. **Moving a block of HTML is dangerous.** Lifting the Setups panel out took
   two closing `</div>` tags with it and blanked the entire Songs tab. Verify
   nesting against the committed baseline:
   ```bash
   git show origin/main:index.html > /tmp/base.html   # then compare div depth per tab-page
   ```

6. **A test that only checks where the change landed cannot see what it broke
   next door.** The Settings test asked whether Setups arrived and whether the
   old buttons were gone — never whether the Songs tab still had content. That
   is how the blank tab shipped.

7. **Font coverage on iOS is narrower than Chromium's.** SMP musical symbols
   (whole/half notes) are absent; U+2669–U+266C are safe. Chromium renders the
   missing ones happily, so a headless test will not catch it.

---

## Hard constraints (already researched — don't re-litigate)

- **Web MIDI does not exist in any Safari, any platform.** MIDI features are
  desktop-Chrome/Android only. This is why play-in had to work from the
  on-screen keys.
- **Ableton Link needs UDP multicast** — impossible from a browser. Ben has
  emailed Ableton; keep the architecture Link-friendly for a future native
  wrapper.
- **iOS Safari evicts storage after 7 days** of no use; home-screen PWAs are
  exempt.
- **Chromium silently renames downloads** whose filename contains non-ASCII
  (an em-dash became "download"). `_dlName()` ASCII-folds; `_safeName()` keeps
  Unicode for zip entries and Web Share files.

---

## What shipped recently

- **iPhone lag work** — main-thread 22→12 ms/s, per-note `ended` listeners
  ~70/s→0, drag layout reads 85→1, metronome duplicate scheduling fixed.
- **Split Capture** — `◀` keeps what you just played, `◉` arms forward.
- **Time signatures** — any numerator 1–32 over 2/4/8/16, falling back to a
  16th base past 64 steps. `MAX_STEPS = 64`.
- **Play riffs in** — computer keyboard, MIDI, on-screen keys and the bend
  strip all write into the bass roll, melody roll and drum grid.
- **Latency presets** — Tight / Balanced / Phone / Bluetooth / Rock Solid, each
  moving buffer + look-ahead + tick together.
- **UI pass** (PR #43): transport 3 rows → 2; arp rate as `♩ ♪ ♬` notation at a
  fixed 38px so cycling can't re-wrap the bar; Start Blank actually blank;
  Setups promoted to the first panel in Settings; panes renamed
  `Settings │ Sounds │ MIDI │ Logic`; chord variants collapsed by default with
  borrowed/modal left visible; Generate writes a line without switching the
  part on; PLAYS tag removed; fingering off until switched on in Settings, no
  hand emoji; accents drawn as a brighter note rather than white.

---

## Open / parked

**Awaiting Ben's decision:**
- **Song button label.** It toggles whether a loaded song's chart drives the
  chords (green = running, amber = held, red = off). He asked what it did —
  meaning the label fails. Suggested `Chart: On` / `Chart: Hold`. He said leave
  it for now.
- **Fingerings in the melody generator.** He likes the idea; needs a call on
  where they'd sit on a canvas piano roll (chart underneath following the
  selected note, vs a marker per note block).

**Dropped by him:**
- Multi-language / note-naming (German H/B, Romance fixed-do) — tabled.
- MIDI out + MIDI clock — doesn't fit his use case (no Web MIDI on iOS).
- Real Book PDF import — copyright risk. He is right; Hal Leonard enforces.

**Still notionally on the roadmap:**
- Basic/Free mode pass (free tier vs paid), explain toggle, tappable legend.
  **He is doing this himself with the `design` skill** — stay out unless asked.
- Licence-file paywall + app-store / Mac / PC wrappers; pick the
  merchant-of-record with the lowest fees.
- A legend for the piano roll (nothing on screen explains green / brighter
  green / blue outline = hand-placed / orange = out of range).
