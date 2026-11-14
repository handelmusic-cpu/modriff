# mõdRïff iPhone app previews

Three 24-second edits of the actual native iPhone app, with its own original
performance, short captions for muted autoplay, and an in-app purchase disclosure.

| Preview | What it shows | Poster |
|---|---|---|
| [01 — Play in key](01-play-in-key.mp4) | Seventh chords, then drums, bass, arpeggios and a played melody | [5-second frame](01-play-in-key-poster.png) |
| [02 — Build a groove](02-build-a-groove.mp4) | The running drum, bass and melody grids, then the arpeggiator | [5-second frame](02-build-a-groove-poster.png) |
| [03 — Shape a song](03-shape-a-song.mp4) | A looping chord chart followed by the live mixer | [5-second frame](03-shape-a-song-poster.png) |

Suggested order: Play, Build, Shape. The posters are frames extracted from the
finished videos; choose the same 5-second frame in App Store Connect.

## Capture and export

- Source: commit `6f123590dd3efafa2bf0967d69ddfecb0c85621c`, app version
  `6.9.9.9.9.9.9.9.9`, optimized Debug native build, isolated iPhone 18 Pro Max
  simulator. `xcodebuild` succeeded with `GCC_OPTIMIZATION_LEVEL=3` and
  `SWIFT_OPTIMIZATION_LEVEL=-O`.
- `capture.js` operates the real app's functions in a disposable copy of the
  generated simulator bundle. No app source, shipping UI or saved user data was
  changed. The white synchronization slate is outside all three finished edits.
- The real Bounce recorder captured the native engine and Web Audio together.
  The performance uses synthesized electric piano, electric bass, sine melody,
  sine arpeggio and the app's synthesized kit. No external song or backing track.
- Each file: 886 × 1920, progressive H.264 High / Level 4.0, 30 fps, 10 Mbps target,
  stereo AAC 256 kbps / 48 kHz, 24 seconds, fast-start MP4. The full frame is fitted
  without stretching. Captions cover the status-bar area; controls remain visible.
- Audio has a 2 dB level lift and a short fade at each cut's end. The musical
  buildup is preserved. `verification.json` contains measured export results.
- Full Studio was enabled for filming. Every frame discloses that some features
  require an in-app purchase.

The exports follow Apple's [preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/)
and [preview guidance](https://developer.apple.com/app-store/app-previews/).
They have not been uploaded, processed or approved by App Store Connect, and
have not been heard on a physical iPhone. These are iPhone assets; iPad and Mac
need their own captures.

## Re-edit

`render.py` requires Python, Pillow and imageio-ffmpeg. Run:

```sh
python3 render.py /path/to/capture.mov /path/to/performance.wav 3.015
```

The source capture and performance are kept with this chat's local artifacts in
`modriff-preview-source/`; the large raw capture is not committed. The final
exports, exact captions, edit offsets and capture log are included here.
`PREVIEW_OUTPUT`, `PREVIEW_WORK` and `PREVIEW_PYTHON_TOOLS` can override output,
scratch and dependency directories. `edit.json` records the source alignment.
