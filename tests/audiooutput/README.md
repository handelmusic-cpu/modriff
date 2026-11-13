# Audio output

`node tests/audiooutput/page.cjs` serves `dist/`, starts a blank session, opens the
real Settings row and checks output selection, bridge errors, disconnect fallback,
phone routing and accessible layout at 390 and 1200 px. Set `PLAYWRIGHT` and
`CHROMIUM` if needed. Screenshots go to `/private/tmp/modriff-output-settings-*.png`.

On a Mac, compile the production driver for **Catalyst**, not just macOS (their
default output units differ):

```sh
xcrun swiftc -O -target arm64-apple-ios15.0-macabi -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  ios/App/App/ModEngine/ModAudioOutput.swift tests/audiooutput/route.swift \
  -o /private/tmp/modriff-output-catalyst-route-test
/private/tmp/modriff-output-catalyst-route-test
/private/tmp/modriff-output-catalyst-route-test --bidirectional
/private/tmp/modriff-output-catalyst-route-test --cleanup
```

The silent probe creates a temporary aggregate output, selects every available
output, counts source and hardware frames, checks every source frame retains its
hardware host timestamp and the system default stays put,
rejects a missing device and tests stopped-engine selection/restart. It destroys
the temporary aggregate afterward. Main stays free, matching the app's control
queue. `--bidirectional` includes the system microphone in the temporary device;
the output unit never enables recording. On this host Core Audio stops replying
when binding that artificial combined device, so this also exercises the real
three-second timeout: the previous engine keeps rendering. That blocked worker
is released by process exit; run `--cleanup` afterward (and after interrupting a
probe) to remove only the temporary device named `modRiff temporary route test`.

Verified November 13, 2026: both successful routes rendered over 16,000 source
frames in 350 ms, with status/error 0. The unresponsive-device case returned in
3.00 s while over 143,000 source frames continued on the previous output. These
are render measurements; Bluetooth/USB listening, hot plug and recording/bounce
checks remain in `docs/phone-test-checklist.md`. Mac selection applies to Native
sound; Web Audio recovery/preview paths still use the system output.
