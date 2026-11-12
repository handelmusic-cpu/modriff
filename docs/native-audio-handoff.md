# Native audio handoff — 6.9.9.9.9.9.9.7h

Supported Native sound runs now claim one native transport owner automatically through public Play. Chord patches/sub, Pure tuning/glide, retained MIDI observers and next-bar chart revisions are implemented. Web and unsupported configurations retain the whole page band. Phone checks are a to-do, not an activation gate; no debug latch is required.

## Start the next session

Use the attached `codex/native-transition-complete` worktree or a clean merged `main`. Read `AGENTS.md` and current `CLAUDE.md`, then the short checkpoint in `docs/native-scheduling.md`. Search archived design/measurement logs by topic; do not read them end to end. Another session used the shared main checkout for a phone build; leave its stash and unrelated dependency changes alone.

Fetch current main, inspect status and run `npm run ios:check` before device testing. Build merged main with `npm run ios:device`; a deliberate branch build uses `MODRIFF_IOS_ANY=1 npm run ios:device`. Compare the phone's About build stamp. The attached worktree has untracked links for dependencies/generated Capacitor frameworks; do not commit them. `npm run ios:frameworks` is required on a fresh checkout.

## Next work

- Hear checklist 45–49 on the paired iPhone: patches/sub, tuning/glide, audio/MIDI/stems, live chart revisions, rapid transport changes, interruptions/routes and background/foreground behavior. Fix any reported problem, measure on the Mac, commit it, open one PR and merge it. Do not wait for checklist ticks to continue or ship.
- Confirm Copy diagnostics shows `nativeTransport.state: native` for a supported fresh Play and `page` plus a reason for fallback. Stop during preparation and immediately after Play; no cancelled start may revive. Test a native host restart and a long Bounce with MIDI/stems.
- Current whole-band page fallbacks: custom sampler instrument voices, sampler patterns, metronome/simple rhythm, standalone chord rhythm, queued/chained drum patterns and practice key/tempo automation. Chart-position jumps also fall back. They pause on leaving. Broaden native coverage if requested; do not call these configurations background-native.
- Preserve main's concurrent long-Bounce streaming, optional Bounce MIDI/Pads track, orphan-voice Panic/startup cleanup and Song Resume changes. They were integrated into this batch before final verification.

## Reproduce verification

- `./check.sh`, `npm run build`, `npm run build:web`.
- `make -C native/modsynth seqhosttest seqobservetest chartedittest chordseqtest chordtest banktest synthseqtest`; run the first three binaries (the host suite takes several minutes).
- Focused host checks: `MODRIFF_TRANSPORT_ONLY=1`, `MODRIFF_CHART_EDIT_ONLY=1`, or `MODRIFF_OBSERVER_ONLY=1` before `native/modsynth/seqhosttest`.
- Browser tests: `tests/seq/transport.test.js`, `probe-isolation.test.js`, `observer.test.js`, `chartedit.test.js`, `intonation.test.js`, `synthbank.test.js`, `livechord.test.js`, plus existing bank/line/song regressions. Scratch Playwright is `/tmp/modriff-browser-tools/node_modules/playwright`; pass it as `PLAYWRIGHT` when needed. `PAGE_PATH=/dist/index.html` exercises the built app; web smoke uses `/dist-web/play/index.html`.
- Pure/glide: `TUNING_TEST=1 GLIDE_TEST=1 VOICES=sine,piano,pianoreal2 node tests/seq/chordline.test.js`. Tuned bank tests accept `TUNE_CENTS`; Pure chord banks accept `TUNING_TEST=1`.
- Native build: `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/modriff-native-complete-derived CODE_SIGNING_ALLOWED=NO build`.

Measured evidence: zero page scheduler calls during native ownership; identical first frames for five native clocks; stale Start/Stop rejection; zero output for a cancelled committed future graph note; exact retained-note/root boundaries; unchanged live chord/bass/choke/room state during real bank probes; Panic cuts the separate chord sub to zero while the uncut control remains audible. These are Mac results, not claims of having heard the phone.
