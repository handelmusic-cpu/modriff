# In Motion — mõdRïff

[Campaign film](modriff-in-motion-promo.mp4) · [App Store cut](modriff-in-motion-app-store.mp4) · [Music master](in-motion.wav)

Both films run 27.1 seconds. The campaign film uses beat-timed kinetic type,
perspective camera moves over actual app footage, a rhythmic grid, animated
musical layers, bass waves and a final wordmark resolution. Its black, paper,
purple, cyan and acid-yellow scenes follow the arrangement's changes.

The App Store cut keeps the actual iPhone interface full-screen, with animated
copy and a narrow color accent. It shows Live, the drum and bass sequencers,
melody playing, the selected synth patch, the saved song and the mixer. It is
the upload candidate; the campaign film is for the website, social and ads.

## Music

“In Motion” is an original 124 BPM, fourteen-bar score, not the backing track
from the earlier videos. It has rootless ninth-chord voicings, off-beat keys,
a moving bass line, a recurring melodic hook, a breakdown, a return with
arpeggios, drum fills and a final tonic with an effects tail.

| Part | Sound |
|---|---|
| Keys | Neo Tine |
| Bass | Pluck Sub |
| Lead | Glass Pluck |
| Arpeggio | Future Pluck |
| Pad | Glacier |
| Drums | Four custom mõdSynth percussion patches, stored with the score |

All nine stems were rendered continuously through the app's actual C++
`modsynth::Processor` and `FxRack`, offline at 48 kHz. This avoids real-time
audio-device buffer deadlines. The score includes every patch value, note,
velocity and duration. The master uses gentle compression, peak control and
a natural tail, followed by loudness normalization. No vinyl/crackle noise,
external music, sampled backing track or sample-loop splices were added.

The soundtrack is a produced arrangement using the app's synthesis engine,
not a literal recording of every sound in the screen capture. The native
capture plays the same chord sequence and selected melodic patches at 124 BPM;
its drum kit and generated bass are the app's own patterns.

## Verification and format

- Both finished films decode all 813 frames, with stereo AAC at 48 kHz. Both
  measure −17.29 LUFS and −1.94 dBTP, with zero full-scale samples. Measurements
  are in `verification.json`.
- Every offline stem has exactly 1,300,646 finite stereo frames. The five
  melodic stems have zero isolated one-sample impulse signatures under the
  documented detector. Noise percussion is excluded from that detector;
  its intended transients are not treated as faults. See `audio-verification.json`.
- These checks test clipping, missing data and a specific click signature;
  they are not a substitute for listening on the destination device.
- Campaign: 1080 × 1920, H.264 High / Level 4.0, 30 fps.
- App Store: 886 × 1920, H.264 High / Level 4.0, 30 fps, 10 Mbps target,
  stereo AAC 256 kbps, with an IAP disclosure throughout. Full frame fitted
  without stretching; no phone mockup or perspective transform in this cut.
- Five-second poster frames and alternate detail frames are included.

App footage comes from the optimized native Simulator build at commit
`6f123590dd3efafa2bf0967d69ddfecb0c85621c`, version `6.9.9.9.9.9.9.9.9`.
The recording runs in an isolated simulator with test songs and Full Studio
enabled. The capture script lives only in a disposable bundle copy. No app
code, user setups, release number or DSP implementation was changed.

The App Store export follows Apple's [technical specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/)
and [footage/graphics guidance](https://developer.apple.com/app-store/app-previews/).
It has not been uploaded or processed by App Store Connect, or heard on a
physical iPhone. These are iPhone/portrait materials, not iPad or Mac previews.

## Rebuild

The editable scripts are in `source/`. Python dependencies: Pillow, NumPy,
fonttools, brotli and imageio-ffmpeg. The renderer uses the repository's bundled
Outfit and Orbitron fonts. Set `PREVIEW_PYTHON_TOOLS` for a separate dependency
directory, and `MODRIFF_PROMO_WORK` for scratch and raw sources.

From the repository root:

```sh
clang++ -std=c++17 -O2 -ffp-contract=off -I native/modsynth \
  docs/app-store/previews/high-impact/source/music-render.cpp \
  native/modsynth/modsynth.cpp native/modsynth/fxrack.cpp \
  native/modsynth/fdlibm.cc -o /private/tmp/modriff-music-render
node docs/app-store/previews/high-impact/source/compose.mjs
python3 docs/app-store/previews/high-impact/source/mix.py
python3 docs/app-store/previews/high-impact/source/render-motion.py
python3 docs/app-store/previews/high-impact/source/render-store.py
python3 docs/app-store/previews/high-impact/source/verify-audio.py
python3 docs/app-store/previews/high-impact/source/verify.py
```

The recording and raw stems are kept with this chat's local artifacts in
`modriff-high-impact-source/`, outside Git. Put `store-capture-final.mov` in
the work directory to re-render. `store-alignment.json` records the white
sync slate's end; the slate never appears in the finished films. The final
score, capture log, audio checks and finished assets are versioned here.
