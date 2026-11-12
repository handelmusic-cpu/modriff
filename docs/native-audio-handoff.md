# Native audio handoff — 6.9.9.9.9.9.9.7h

The code batch covers chord patch/sub voices, Pure tuning/chord glide, retained MIDI observers, next-bar chart revisions and automatic whole-band transport ownership behind the existing phone-test latch. Live chord forwarding and bass/arp/melody patch support were merged previously. The default public app still uses the page clock. Do not describe this as an activated, universal background transition.

## Continue safely

Use the attached `codex/native-transition-complete` worktree or a clean checkout of merged `main`. Read `AGENTS.md`, then the current checkpoint and Migration E in `docs/native-scheduling.md`; search the large architecture/page files rather than reading them in full. The shared main checkout was used by another session for a phone build. Leave its stash and unrelated dependency changes alone; the native work was recovered into the isolated worktree and committed separately.

Run `git status`, fetch current main and check the About/build stamp before device testing. For a deliberate branch device build use `MODRIFF_IOS_ANY=1 npm run ios:device`; for merged main use `npm run ios:check` and `npm run ios:device`. Generated Capacitor frameworks are required (`npm run ios:frameworks`). The isolated worktree reuses the existing generated frameworks and dependencies through untracked links; do not commit those links.

## What remains

1. Hear and record `docs/phone-test-checklist.md` sections 41–45 on the paired iPhone: patches/sub, tuning/glide, audio/MIDI/stems, chart revisions, transport races, interruptions/routes and background/foreground behavior.
2. The existing inspector latch is `localStorage.setItem('modo-bgtest','1')`; it is not a new setting. Native sound must be on. A supported fresh Play should show `nativeTransport.state: native` in Copy diagnostics. An unsupported run should show page ownership and a reason. Remove the latch after testing.
3. Decide the production policy before changing the default: custom sampler voices, sampler patterns, metronome/simple rhythm, standalone chord rhythm, queued/chained drum patterns and practice key/tempo automation currently fall back as one page band. Chart-position jumps also return the whole run to the page. These configurations do not claim background scheduling. Further native coverage is needed if the release requires background support for every configuration.
4. If the required phone pass succeeds and the fallback policy is accepted, make production activation a separate verified commit/PR. Update the checkpoint and phone record. Do not flip the default merely because desktop tests pass.

## Verification to reproduce

- `./check.sh`, `npm run build`, `npm run build:web`.
- `make -C native/modsynth seqhosttest seqobservetest chartedittest chordseqtest chordtest banktest`.
- `native/modsynth/seqobservetest` and `native/modsynth/chartedittest`.
- `MODRIFF_TRANSPORT_ONLY=1 native/modsynth/seqhosttest`, `MODRIFF_CHART_EDIT_ONLY=1 native/modsynth/seqhosttest`, `MODRIFF_OBSERVER_ONLY=1 native/modsynth/seqhosttest`; also run the full host suite.
- Real-page tests: `tests/seq/transport.test.js`, `probe-isolation.test.js`, `observer.test.js`, `chartedit.test.js`, `intonation.test.js`, `synthbank.test.js`, `livechord.test.js`, plus existing bank/line/song event/audio regressions. Use Playwright with local Chrome. Scratch tooling in this session is `/tmp/modriff-browser-tools/node_modules/playwright`; pass it as `PLAYWRIGHT` when needed. `PAGE_PATH=/dist/index.html` exercises the built app; web smoke uses `/dist-web/play/index.html`.
- Pure/glide audio: `TUNING_TEST=1 GLIDE_TEST=1 VOICES=sine,piano,pianoreal2 node tests/seq/chordline.test.js`. Tuned bank tests accept `TUNE_CENTS`; individual Pure chord banks accept `TUNING_TEST=1`.
- Required native build: `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/modriff-native-complete-derived CODE_SIGNING_ALLOWED=NO build`.

The desktop evidence includes zero page scheduler calls while native owns the band, identical first frames for five native clocks, stale Start/Stop cancellation, zero output for a cancelled committed future graph note, exact retained-note/root boundaries and preserved live state during real bank probes. None of that substitutes for hearing the phone pass.
