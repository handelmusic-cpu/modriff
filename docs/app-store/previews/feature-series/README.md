# mõdRïff feature films

Seven focused motion films and three App Store selections, all 27.1 seconds. The native app footage covers a continuous Live performance, genuine landscape piano rolls, harmony and learning tools, complete songs, imports, sampler, mõdSynth and full performance exports. No app UI or DSP changes are included.

## App Store selection

Apple allows three previews per supported device size and language. Use these three files together; the seven feature films below are separate campaign material.

| File | Orientation | Story |
| --- | --- | --- |
| `store-01-live-theory-export.mp4` | Portrait | Chords, melody and mõdFX together; chord progression logic; common progressions; keys/scales; stems and full MIDI |
| `store-02-landscape-instruments.mp4` | Landscape | Bass and melody rolls; sampler import, slicing and pads; mõdSynth filters and modulation |
| `store-03-songs-import-learning.mp4` | Portrait | Full song build/perform; playlist and PDF import; practice controls; Stage; guided learning |

27.1 sec / 813 frames / constant 30 fps. Portrait 886 × 1920; landscape 1920 × 886. H.264 High Level 4.0, progressive, 11 Mbps target, stereo AAC 256 kbps / 48 kHz. Each file is under 500 MB. Posters are taken at five seconds. An in-app purchase disclosure appears throughout. These are iPhone assets; iPad and Mac need their own footage. Not uploaded or processed by App Store Connect.

Specifications checked November 14, 2026: [Apple app preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/), [Apple app preview guidance](https://developer.apple.com/app-store/app-previews/).

## Feature films

| File | Orientation | Focus |
| --- | --- | --- |
| `01-live-together.mp4` | Portrait | One continuous, real-time Live performance with all three surfaces visible and audible mõdFX |
| `02-landscape-rolls.mp4` | Landscape | Drum, bass and melody editing in the native landscape layout |
| `03-theory-and-learning.mp4` | Portrait | 12 keys, 36 scale types, 5/4 and 7/8, progression logic, common progressions, Roman numerals and guided learning |
| `04-full-song-mode.mp4` | Portrait | Verse/Chorus/Bridge, full song performance, playlist/PDF import, tempo ramp, key changes, loops, Stage and tutorials |
| `05-full-sampler.mp4` | Landscape | Import a real recorded loop, trim/loop/tune, slice to eight pads, play and record a pattern |
| `06-modsynth.mp4` | Landscape | Factory patches, three oscillators/FM, dual filters, LFOs/motion, modulation matrix, effects/macros |
| `07-export-every-part.mp4` | Portrait | Actual exported WAV stems and full MIDI, visualized from the real files |

The campaign films use kinetic type and animated note/wave surrounds. Colors come from the app's `PARTS` table; Outfit and Orbitron are the app fonts. Non-Live workflow footage is retimed for readability. The Live film retains its original timing and the actual native capture audio. Other films use different arrangements of the original “In Motion” score, rendered with the app's C++ engine; soundtrack music does not represent each individual UI gesture.

## Measured evidence

`verification.json` records full decoding, 813 frames, dimensions, profile/level, loudness, true peak, clipping and hashes for all ten final files. Final audio is −18.55 to −17.69 LUFS, at or below −2.31 dBTP, with zero clipped samples. The native capture reported zero slow-reader audio loss, zero badly stamped notes and zero unscheduled notes. `source-click-analysis.json` records zero isolated single-sample impulse signatures in the three native melodic stems; intended percussion transients are excluded from that test. This is a defined signal test, not a claim to have listened on a phone.

The real 48-second performance produced a master and four aligned stereo WAV stems at 48 kHz (2,837,888 frames each, including pre-roll/tail). Its Type 1 MIDI file has 803 completed notes, four instrument tracks plus tempo, and notes extending past 51 seconds. These counts demonstrate a full take rather than a capped chart-only export. `midi-proof.json` contains the parsed notes used in the export animation.

`coverage.json` records the capture build, viewport/orientation, import results and feature evidence. The native PDF reader extracted the original demo sheet into Verse, Chorus and Bridge with 12 chords. The real playlist importer added Bright Side, In Motion and Night Drive from an original three-chart fixture. No third-party songs or music were used.

## Editable sources

`plans.json` is the authoritative edit timeline. `source/` contains the renderer, audio mix, measurement scripts and native capture automation. `fixtures/` contains the original PDF, its rendered page, and the playlist HTML. Capture scripts operate real app controls/APIs in a disposable Simulator bundle; they do not ship in the app. Failed/unused capture moments are omitted from the edit.

The local delivery's `editable/` folder preserves normalized native captures, eight lossless soundtracks, the actual WAV/MIDI exports and capture logs. Set `MODRIFF_SERIES_WORK` to that folder and `MODRIFF_FONT_DIR` to the converted app-font folder (`display.ttf`, `tech.ttf`) before running `source/render-series.py <film-name>`. It writes `rendered/`. Python needs Pillow, NumPy, imageio-ffmpeg and fontTools. The backing score and C++ rendering sources remain in `../high-impact/source/`; `MODRIFF_PROMO_WORK` selects its generated stem folder when rebuilding soundtrack arrangements. Use the measured 1 dB AAC headroom adjustment in the renderer.

Not heard on a physical iPhone. Final playback checks: listen for transition clicks/crackle, confirm readable landscape rolls and verify Live audio/FX sync through the phone speaker and headphones. App Store processing and device playback remain external checks; the encoded files and native feature workflows above are verified.
