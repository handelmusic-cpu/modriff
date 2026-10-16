# mõdSynth in C++

The mõdSynth DSP core ported from `modsynth/dsp.js` (the AudioWorklet) to
plain C++17, for the native iOS engine (`docs/v5-architecture.md`, "Audio:
native, decided", step 2). It has no platform dependency. The Swift host will
feed it the same messages the worklet's port receives and call `process()`
from its render callback.

| file | what |
|---|---|
| `modsynth.h`, `modsynth.cpp` | the engine: wavetables, filters, envelopes, LFOs, motion lanes, the matrix, voice allocation, the crusher. A line-for-line port: same names, same order of operations |
| `jsnum.h` | JavaScript's number rules: `Float32Array` storage (`f32`), `x \| 0`, `Math.round`, and the maths below |
| `fdlibm.cc` | V8's own `sin`/`cos`/`tan`/`exp`/`log2`/`pow` (fdlibm, from V8 12.4 as Node 22 runs it). Licence in `LICENSE.v8` |
| `params_gen.h` | the parameter slots and defaults, generated from `modsynth/params.js` by `gen-params.js`. Committed, so a build needs no Node |
| `render.cpp` | a command-line renderer that replays a recorded message script; the null test drives it |

## The null test

```sh
make -C native/modsynth          # builds native/modsynth/render
node tests/modsynth/null.test.js
```

Every factory patch is played through the JS processor in Node, and every
message it receives is recorded. The same messages are replayed into the C++
build and the two outputs compared sample by sample. The playing covers:

- a chord struck and released by id, with the mod wheel, bend and aftertouch moved
- a scheduled note, a repeated pitch under a new id, a tempo change, a choke
- every eighth patch in all four voice modes at 44.1 kHz, which adds the sustain pedal, the CCs, the load governor's caps, the event queue's replaced note-offs, all-notes-off and panic

The test fails if `params_gen.h` is older than `params.js`.

Result: 516 runs, 24 million samples, all **bit-identical**, built with g++
or clang++. As a control, scaling one gain by one part in five million moved
342 of the 344 patches.

Three things make the match exact, and each one is necessary:

1. **Single precision exactly where the JS has it.** Every `Float32Array` in
   `dsp.js` is an `f32` here. A write rounds and a read is a double, so
   arithmetic happens in double as in JS, never in float.
2. **V8's maths, not the C library's.** glibc's `sin`, `exp` and `pow` differ
   from V8's in the last bit for about one argument in ten. In a filter's
   feedback loop that difference grows instead of staying in the last bit.
3. **No fused multiply-add.** Build with `-ffp-contract=off`. It is the
   Makefile's default, and the iOS target must set it too: ARM compilers fuse
   `a*b+c` by default. Allowing it moved 23 runs, by up to -205 dB. That is
   inaudible, but it is no longer exact, and exact is what makes this test
   meaningful.

`Math.random`, used only by a motion lane's random mode, is a 32-bit
xorshift on both sides (`Processor::random`).

## Speed

Ten seconds of a six-note chord on the heaviest unison patches, one core in
the Linux container, no SIMD yet. The C++ time includes process start-up,
building the wavetables (13 ms) and parsing the script:

| patch | JS (Node) | C++ | |
|---|---|---|---|
| Jupiter Pad | 2420 ms | 901 ms | ×2.7 |
| Solina Ensemble | 3195 ms | 589 ms | ×5.4 |
| String Machine | 3574 ms | 662 ms | ×5.4 |
| Trance Saw | 4350 ms | 1133 ms | ×3.8 |
| Anthem Lead | 3656 ms | 1105 ms | ×3.3 |

## Not here yet

- The FX rack (`modsynth/fx.js`). It is Web Audio nodes today, and it moves
  with mõdFX and the master bus (step 4 of the plan).
- The host (`modsynth/engine.js`): resolving a patch into params, matrix rows
  and motion lanes. The native engine will receive those as messages, exactly
  as the worklet does.
- The meter and load reports the worklet posts back. The host reads
  `activeVoices()`, and the Swift side measures its own load.
