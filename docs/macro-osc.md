# Macro Osc (native engine only)

One more oscillator source inside a mõdSynth voice, beside Pluck and Sub: twelve synthesis models with three
controls (Harmonics, Timbre, Morph), played by the C++ engine. **iPhone, iPad and Mac only.** The web worklet has
no such source and the free web page never loads the patches or shows the row (`MS.macroOscAvailable`).

## Where things are

| what | where |
|---|---|
| the models (vendored) and our voice wrapper | `native/macroosc/` (`plaits/`, `stmlib/`, `macrovoice.*`) |
| the source inside a voice | `native/modsynth/modsynth.cpp` (`Voice::macro`, the block before the mix loop) |
| parameters `mix.mosc`, `mosc.*` (appended, last DSP indices) and matrix destinations 36-39 | `modsynth/params.js`; `dsp.js` reserves 36-39 and ignores them |
| 12 patches, category "Macro Osc" | `modsynth/patches-macro.js`, loaded only where `Capacitor.isNativePlatform()` |
| levels, peaks, CPU | `native/modsynth/macrolevel.cpp` (`make macrolevel && ./macrolevel`), prints the `kModelTrim` table |
| checks | `tests/modsynth/macro.test.js` (model ids match C++, patches valid) |

## Licence record (checked from source, 2026-11-14)

- Upstream code: Emilie Gillet, MIT. Every file under `plaits/dsp` carries "Copyright 2014/2016/2021 Emilie Gillet" and the
  MIT text; no other copyright holder anywhere in `plaits/`. The 13 `stmlib` files it includes are MIT, Copyright
  2012-2017 Emilie Gillet. The `eurorack` repo has no top-level LICENSE (its README: STM32F code MIT, hardware CC BY-SA),
  `stmlib/LICENSE` says "except when noted otherwise ... MIT" and notes the exceptions (ST code, a GPL programmer, CRC and
  murmurhash), none of which is vendored.
- The Rust port (`sourcebox/mi-plaits-dsp-rs`, MIT, Oliver Rockstedt) is not used; we vendor the upstream C++.
- The maker's trademark may not be used on derivatives: models are named by sound, the maker appears only in the
  Credits notice (Settings > About > Credits, `CREDITS_TABLE`, id `macroosc`). The notice text is `native/macroosc/LICENSE-macroosc.txt`.

### Left out, and why (data whose origin cannot be shown)

- **Speech and its word table**: "LPC10 encoded words extracted from various TI ROMs" (third-party audio data under an MIT header on the code).
- **Six-operator FM bank**: the patches are DX7 factory cartridge dumps.
- **Wavetable bank** (`waves.bin` and the integrated waves built from it): no documented origin. The Chord and Terrain models read it, so they are out too.
- `trim-resources.py` rebuilds `plaits/resources.*` from upstream without those three sets; every table that remains is computed by upstream's `lookup_tables.py` (sine, folds, waveshapers, filters).

Kept (12): Filtered Analog, Phase Bend, Ensemble, Chip, Dual Analog, Wave Shaper, FM Pair, Grain, Additive, Swarm, Plucked String, Modal Bar.
Ids are stored in songs: never reorder or reuse one.

## Behaviour worth knowing

- The models run at 48 kHz; at another host rate the pitch is corrected in `MacroVoice::init` and the timbre drifts a little.
- Plucked String and Modal Bar are struck by the note's gate and ring on their own; the patch envelope still shapes them.
- Not heard on a phone: see `docs/phone-test-checklist.md`.
- Not done: the other upstream models (the three above, the drums, noise, particle), the module's low-pass gate and
  internal envelopes, and the aux output (a second output some models have).
