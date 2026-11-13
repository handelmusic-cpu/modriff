# Native audio handoff — 6.9.9.9.9.9.9.7i

Public Play uses one native owner for the entire scheduled band. Normal features stay native: factory/custom sampler instruments, synth patches/sub, Pure/glide, live chords, standalone comp/Vary, pad patterns, click/simple rhythm, drum queues/chains, practice key/tempo steps and chart-position jumps. Page scheduling is retained for the free web page and recovery after an actual engine/readiness failure. Background MIDI output/external clock remain outside this transition.

## Paste into the next Claude session

Continue mõdRïff from current merged main. Read AGENTS.md and CLAUDE.md, then the short checkpoint in docs/native-scheduling.md. Native scheduling coverage is implemented; do not restore feature-based page fallbacks or add a debug activation gate. Recovery is only for genuine engine/asset-readiness failure, with a diagnostic reason and one scheduler owner.

Verify the release on the paired iPhone using docs/phone-test-checklist.md items 45–54. These changes have compiled for iOS Simulator and passed Mac/browser event/audio tests; they have not been heard on device. Exercise background/foreground, routes/interruption, long Bounce/MIDI/stems, queued patterns, live sampler edits, practice and rapid Play/Stop. Fix any measured issue, run the relevant tests and Simulator build, commit verified changes with the repository's required attribution, open one PR and merge it. Phone listening is a follow-up, not a gate on native activation or shipping.

Use the attached codex/native-full-coverage checkout or a clean main. Fetch and inspect status first. Do not modify another session's stash or unrelated dependency changes. Before installing, run npm run ios:check; build merged main with npm run ios:device and compare About's build stamp. A deliberate feature-branch install requires MODRIFF_IOS_ANY=1. Dependency and generated framework links are untracked and must stay out of commits; run npm run ios:frameworks on a fresh checkout.

## Reproduce verification

- `./check.sh`, `npm run build`, `npm run build:web`.
- `make -C native/modsynth seqhosttest seqobservetest chartedittest chordtool banktest`; run `seqhosttest`, `seqobservetest` and `chartedittest`. The full host suite takes several minutes. `MODRIFF_EXTRAS_ONLY=1 native/modsynth/seqhosttest` focuses on pad gates/queue/erase, drum chains, practice/steering and live voice selection.
- Browser: `tests/seq/transport.test.js`, `extras.test.js`, `observer.test.js`, `chordrhythm.test.js`, `chartedit.test.js`, `songmirror.test.js`, plus the existing tuning/patch/line tests. Use `PLAYWRIGHT=/tmp/modriff-browser-tools/node_modules/playwright` if the scratch install exists. `PAGE_PATH=/dist/index.html` checks the shipped app.
- Custom sampler audio: run each of `bassbank`, `chordbank`, `arpbank`, `melbank` under `tests/seq/` with `CUSTOM_SAMPLER_LOOP=0` and `=1`, `VOICES=sine,sampler`; `ARP_SKIP_FX=1` narrows the arp matrix.
- Native: `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/modriff-native-complete-derived CODE_SIGNING_ALLOWED=NO build`.

Measured: 30 click/rhythm/reversed/looped/warped-pad voice renders match fresh page audio at every tested onset phase (worst null 213 dB); standalone Vary/voice-leading hit lists match; native queues, gates, hold erasure, trainer changes and steering advance without page callbacks; native ownership suppresses page schedulers; delayed starts are cancelled; pad MIDI releases affect only their own notes. These are Mac/browser measurements, not device listening claims.
