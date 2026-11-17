# mõdRïff audience campaign — November 17, 2026

Six 24-second social films, each 1080 × 1920 at 30 fps. Every edit has a distinct opening, three feature moments, an audience-specific payoff and a closing card. Headlines are burned in, so the story works without sound. The right rail, upper 150 pixels and bottom 200 pixels are kept clear of essential copy; check placement in the destination platform's ad preview.

| Music preview | Audience / angle |
| --- | --- |
| [01-jazz.mp4](01-jazz.mp4) | Jazz: ii–V–I voicings, practice controls and song sections |
| [02-groovebox.mp4](02-groovebox.mp4) | Grooveboxes: drum steps, chord-following bass and sampling |
| [03-piano.mp4](03-piano.mp4) | Beginning piano: visual chord tones and playing along |
| [04-guitar.mp4](04-guitar.mp4) | Guitar: chord diagrams, string/fret reference and practice |
| [05-instrument-students.mp4](05-instrument-students.mp4) | Wind/brass: actual flute, trumpet and alto sax reference panels |
| [06-producers.mp4](06-producers.mp4) | Producers: 36 scale types, synthesis and audio/MIDI/stem export |

`silent/` contains the six corresponding H.264 masters with **no audio track**. Their video packets exactly match the music previews. Add your music to those files; no voiceover is needed to understand the ads. `posting-copy.md` includes suggested captions. `review.html` plays all six locally. Posters and six-frame storyboards are included.

## Your soundtrack

All edits share a **124 BPM, 4/4, 12-bar** cue grid. The picture runs exactly 24 seconds, allowing a 0.774-second ending tail. A half-time feel at 62 BPM also fits. `plans.json` stores exact timings and per-film copy.

| Time (seconds) | Bars | Picture / music suggestion |
| --- | --- | --- |
| 0–3.871 | 1–2 | Hook; establish the sound quickly |
| 3.871–7.742 | 3–4 | Feature 1; introduce the main idea |
| 7.742–11.613 | 5–6 | Feature 2; add a layer |
| 11.613–15.484 | 7–8 | Feature 3; a variation or fill |
| 15.484–19.355 | 9–10 | Payoff; let the arrangement open up |
| 19.355–23.226 | 11–12 | Brand; resolve the phrase |
| 23.226–24 | tail | Let the final sound decay |

Suggested colors: small-combo jazz; a punchy electronic groove; simple piano; plucked guitar; a light instrumental ensemble; a layered synth production. These are music briefs, not claims that the app teaches instrumental technique or plays every acoustic instrument shown in the references.

The included previews use edited arrangements of the original “In Motion” app-engine score from `../feature-series/`. **This is temporary background music, not a recording of these on-screen gestures.** No third-party music, loops or competitor imagery was added. All six temporary WAV scores are preserved in the local delivery's `editable/` folder.

## Footage and provenance

The native moving footage is selected and retimed from the previous feature campaign's Simulator recordings; its build provenance is recorded in `../feature-series/coverage.json`. This campaign does not claim those recordings show the newest app layout. The new learning close-ups are real app-rendered panels, recorded in an isolated Chromium context from the committed page at `dcd41f8`. `capture-proof.json` records the full source commit, panel text, selected notes/chords, 36 mode IDs and zero page errors. Reference-panel states are held and cut for readability; the surrounding graphics are editorial illustrations. No UI pixels were reconstructed.

All features used in the copy are present in the app; optional packs are disclosed in every frame. Piano visuals show chord tones, not numbered piano fingerings. Wind/brass references are note-by-note diagrams, not a complete instrumental teaching course. The export workflow was exercised in the earlier native campaign and is documented there; this cut shows its recording controls.

The intended audiences include musicians who use chart players and mobile grooveboxes. The owner permits competitor references in social ads if they do not add legal risk. These deliverables use brand-neutral hooks: [Ableton's published advertising/trademark guidance](https://www.ableton.com/en/legal/branding-trademark-guidelines/) restricts promotional uses outside its listed exceptions. This is a conservative creative choice, not a legal clearance or a conclusion that all comparative advertising is prohibited. No competitor logos, interfaces, superiority claims or implied endorsement appear.

These are social campaign assets, not App Store preview submissions. Nothing has been posted, uploaded to an ad account or tested through a social platform's transcoding. Not heard on a physical phone.

## Rebuild and verification

Dependencies: Python with Pillow and NumPy; FFmpeg/FFprobe; Node with Playwright and an installed Chromium browser. The editable delivery preserves normalized source clips, the converted app fonts and temporary WAV scores. Source scripts live in `source/`.

```sh
# Fresh learning captures; uses released HEAD:index.html and fresh browser storage.
MODRIFF_AUDIENCE_WORK=/path/to/work PLAYWRIGHT=/path/to/playwright \
  CHROMIUM=/path/to/chrome node source/capture-learning.cjs

# Select the previous native campaign's editable folder to prepare footage/music.
MODRIFF_AUDIENCE_WORK=/path/to/work MODRIFF_SERIES_WORK=/path/to/feature-series/editable \
  python3 source/prepare.py

# Or put the delivered editable/ folder directly inside MODRIFF_AUDIENCE_WORK.
MODRIFF_AUDIENCE_WORK=/path/to/work python3 source/render.py --stills
MODRIFF_AUDIENCE_WORK=/path/to/work python3 source/render.py
python3 source/verify.py
```

`MODRIFF_AUDIENCE_OUT` overrides the export directory. `verification.json` records full decoding, frame counts, dimensions, duration, loudness, true peak, clipping and SHA-256 hashes for all twelve MP4s. Full-resolution storyboards were visually inspected before rendering; sampled final encoded frames were inspected afterward. Signal checks do not substitute for listening on a destination device.
