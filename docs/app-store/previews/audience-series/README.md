# mõdRïff social ads · November 23, 2026

Six 24-second vertical ads in 1080 × 1920 at 30 fps, recut with footage of the updated iPhone app. Use a music preview or add your own soundtrack to the matching silent master.

| Music preview | Audience and footage |
| --- | --- |
| [01-jazz.mp4](01-jazz.mp4) | Jazz musicians. Dm7–G7–Cmaj7 chord voicings, practice controls and Song Perform. |
| [02-groovebox.mp4](02-groovebox.mp4) | Groovebox fans. Studio drums, chord-following bass and sampler pads. |
| [03-piano.mp4](03-piano.mp4) | New piano players. Piano chord tones, chord changes and Live. |
| [04-guitar.mp4](04-guitar.mp4) | Guitar learners. Alternate chord shapes, string and fret references, and practice controls. |
| [05-instrument-students.mp4](05-instrument-students.mp4) | Wind and brass students. Flute, trumpet and alto sax fingering references. |
| [06-producers.mp4](06-producers.mp4) | Producers. Scale picker, mõdSynth and audio, MIDI and stem controls. |

[Watch and download the ads](review.html). [Suggested captions](posting-copy.md). Each preview includes an original temporary background score. Each file in `silent/` has the same video and no audio track. The clips were edited for timing and readability.

## Soundtrack cues

The edits share a **124 BPM, 4/4, 12-bar** cue grid. A half-time feel at 62 BPM also fits. The picture runs 24 seconds, with a 0.774-second tail after the last bar. The WAVs of the temporary scores are in the editable delivery.

| Time (seconds) | Picture |
| --- | --- |
| 0–3.871 | Hook |
| 3.871–7.742 | Feature 1 |
| 7.742–11.613 | Feature 2 |
| 11.613–15.484 | Feature 3 |
| 15.484–19.355 | Payoff |
| 19.355–23.226 | Brand and URL |
| 23.226–24.000 | Tail |

## Capture and verification

All app footage was recorded from an optimized Debug iPhone 18 Pro Max Simulator build of **v1.9.9.9.6**, commit `f2074bd0134bf9e22f7586714e8d9acbc784ae64`. The capture script opens the app's own screens and enables the Full Studio entitlement in a disposable Simulator install. The visible pads, controls and instrument diagrams come from the app. Titles, transitions and the closing card were composited for the campaign. The retained app-engine soundtrack is background music.

`capture-proof.json` records the build stamp, marker-aligned shot timings, on-screen labels, state changes and source hashes. `verification.json` records decoding, frame counts, file hashes, matching video streams, loudness and peaks for the twelve exported MP4s. Physical-phone playback and social-platform transcoding remain unverified.

## Rebuild

The editable delivery includes the normalized clips, temporary WAV scores, fonts and the shot list in `plans.json`. With Python, Pillow, NumPy, FFmpeg and FFprobe installed:

```sh
export MODRIFF_AUDIENCE_WORK=/path/to/folder-containing-editable
python3 source/render.py --stills
python3 source/render.py
python3 source/verify.py
```

Set `MODRIFF_AUDIENCE_OUT` to render elsewhere. To capture again, set `MODRIFF_SIM_DEVICE` to a booted portrait iPhone Simulator and `MODRIFF_SIM_APP` to a clean Debug `App.app`. Run `python3 source/capture-native.py`, set `MODRIFF_AUDIENCE_SCORE` to the editable folder with the scores and fonts, and run `python3 source/prepare-native.py`. The capture script places white and green timing markers outside each usable shot. The framing for each clip is in `plans.json`.
