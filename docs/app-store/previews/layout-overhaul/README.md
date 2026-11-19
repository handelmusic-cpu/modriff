# Current App Store previews

Use these three files, in order. They replace the earlier feature-series upload selections after the layout overhaul.

| File | Orientation | What the native footage shows |
| --- | --- | --- |
| `store-01-live.mp4` | Portrait | Live chords and melody, key/scale picker, mõdFX performance, the two-pane Mix |
| `store-02-instruments.mp4` | Landscape | Studio’s two-row selector with Aux; drum grid, bass and melody rolls; wavetable editor and filters; sampler pads |
| `store-03-songs.mp4` | Portrait | Song builder, Perform tiles, timeline, Stage and guided learning |

Each is 27.1 seconds / 813 frames at constant 30 fps. Portrait is 886 × 1920; landscape is 1920 × 886. H.264 High Level 4.0, quality 18 with an 11 Mbps cap, AAC stereo at 48 kHz / 256 kbps target. The narrow purchase disclosure repeats the existing approved wording and leaves all app controls in the frame. The JPEGs are five-second posters.

These are real optimized Debug iPhone Simulator captures from 1.9.4a–1.9.4c. Each has its own saved native audio take, normalized with a short fade at the ends. The original “In Motion” chart is authored in the capture script; no third-party music is used. `verification.json` records full decoding, dimensions, frame counts, audio measurements and hashes for each delivered video and its source take. `source/` keeps the capture timeline and the host’s capture reports. The movies show only the workflows listed above; earlier import/export campaign films remain in `../feature-series/` as history.

Rebuild from the repository root after building and syncing an optimized Debug Simulator app. Set `MODRIFF_SIM_APP` to its `App.app`, optionally `MODRIFF_CAPTURE_WORK` (default `/private/tmp/modriff-layout-assets`), then run:

```
python3 docs/app-store/previews/layout-overhaul/source/capture.py
node docs/app-store/previews/layout-overhaul/source/labels.cjs
python3 docs/app-store/previews/layout-overhaul/source/render.py
python3 docs/app-store/previews/layout-overhaul/source/verify.py
```

The runner uses only `ss-iPhone18PM`, operates a disposable copy of the bundle, and saves the raw movies and exported audio outside Git. The slate’s last white frame locates video zero; the capture log locates the corresponding audio offset. A fresh capture is required if that scratch folder is removed. Requirements: Xcode, Chrome, ffmpeg/ffprobe, Node with playwright-core, Python 3. `source/stills.py` and `stills.js` refresh the Studio raw stills on the dedicated iPhone and iPad before running the caption builder.

Not uploaded or processed by App Store Connect; iPad and Mac need separate footage. Not heard on a physical iPhone: listen to each preview for clicks/crackle and check audio/visual timing through the phone speaker and headphones.
