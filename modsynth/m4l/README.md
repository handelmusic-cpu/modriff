# MōdSynth in Ableton Live

This folder holds the Max for Live version of MōdSynth: a real Max instrument
device whose DSP runs natively in Live's audio chain, with Live automation,
MIDI mapping, tempo sync and the same patch bank as the web app.

Everything here is **generated** from the same parameter schema the web app
uses. Don't hand-edit these files — change `js/params.js` or
`m4l/gen/voice.gendsp.txt` and run:

```
node tools/build-m4l.js
```

---

## Before you start: what has and hasn't been verified

Be aware of exactly what you're getting.

**Verified mechanically** (by `tools/build-m4l.js` on every build):

- the patcher JSON parses
- every patchline points at an object that exists
- no patchline uses an inlet or outlet the target object doesn't have
- every Live-exposed parameter has a unique long name and a legal short name
- all 302 patches translate into the device's parameter set

**Not verified** — no Max or Live installation was available while this was
written:

- that Max accepts the generated `.amxd` container and `.gendsp` files as-is
- that the `gen~` code compiles without a syntax complaint
- that `midiparse`'s pitch-bend outlet is 14-bit on your Max version
  (the device assumes 0–16383; if bend feels halved or doubled, that's this)

Because of that, **install via the paste route below**, which cannot depend on
my getting the binary container right. If the `.amxd` opens directly, great —
but the paste route is the one to trust.

---

## Installing

### The reliable route: paste the patcher

1. In Live, drag **Max Instrument** onto a MIDI track.
2. Click the device's **edit** (pencil) button to open it in Max.
3. Select everything already in the patcher and delete it.
4. Open `MoodSynth.maxpat` in a text editor, select all, copy.
5. Click into the empty Max patcher window and paste. Max reads patcher JSON
   from the clipboard directly, so the whole device appears.
6. Copy these files next to the device (or anywhere in Max's search path):
   - `MoodSynthVoice.maxpat`
   - `MoodSynthVoice.gendsp`
   - `MoodSynthFX.gendsp`
   - `modsynth.js`
   - `patches.json`
7. Save the device from Max (`⌘S` / `Ctrl+S`). Live will ask where to keep it.

### The quick route: open the .amxd

Drag `MoodSynth.amxd` onto a MIDI track. If Live loads it, you're done — just
make sure the five support files above sit alongside it. If Live refuses the
file, use the paste route; the container header is the only part of this that
couldn't be tested.

---

## What the device gives you

**77 parameters exposed to Live**, every one automatable and MIDI-mappable
through Live's own mapping mode:

- **Macros 1–8** — the headline controls. Each is wired to whatever the loaded
  patch routes it to, so one knob can open the filter, widen the detune and
  push the drive at once.
- Oscillator 1 and 2: shape, width, level, octave, semitone, fine, unison,
  detune, sync
- Mix: FM, ring mod, sub, noise
- Filter 1: model, cutoff, resonance, drive, key track, envelope, velocity
- Filter 2: model, cutoff, resonance
- Envelopes 1 and 2: ADSR
- LFOs 1 and 2: shape, rate, depth
- Voice: glide, bend up, bend down, drift, velocity amount, transpose
- Effects: drive, chorus, delay (tempo-synced), reverb, master volume
- A **Patch** menu listing all 302 factory patches

**Performance controls** go straight to the voices rather than through the
parameter list, so automation can never fight your hands:

- **Pitch bend**, with independent up and down ranges per patch
- **Mod wheel** (CC 1) — a modulation source in its own right
- **Aftertouch**
- **Sustain pedal** (CC 64), handled by `[sustain]` before voice allocation

The delay locks to Live's tempo through `live.observer`, so it follows tempo
changes and automation rather than sampling the transport periodically.

---

## How it differs from the web app

The Live device is a genuine subset. What's the same, and what isn't:

| | Web app | Live device |
|---|---|---|
| Polyphony | 16 | 16 |
| Oscillators | 2 × up to 8 unison | 2 × up to 4 unison |
| Waveforms | 16 wavetable sets, 4 morph frames each | sine→tri→saw→square morph, plus true PWM |
| Filters | 11 models, serial/parallel/split | ladder 24/12, SVF LP/HP/BP/notch/peak, serial |
| Envelopes | 3, with hold and curve | 2, ADSR |
| LFOs | 3, tempo-syncable, 10 shapes | 2, free-running, 9 shapes |
| Motion lanes | 2 × 16 steps | — |
| Mod matrix | 16 free slots | fixed routings, filled in from the patch |
| Macros | 8 × unlimited destinations | 8, folded into 8 offset destinations |
| Arpeggiator | yes | use Live's Arpeggiator |
| Drum machine | yes | use Live's Drum Rack |
| Effects | 9 | drive, chorus, delay, reverb |

The reason for the matrix difference is worth knowing: `gen~` compiles to
straight-line code and cannot switch a modulation routing per sample without
paying for every possible destination on every sample. So `tools/build-m4l.js`
collapses each patch's matrix at build time onto the fixed routings the voice
declares, and `modsynth.js` folds the macros into eight offset parameters at
runtime. A patch whose matrix uses a routing the device doesn't have will load
and sound right in every other respect — that one modulation simply won't move.

Where a wavetable patch maps onto an analog shape, the filter, envelopes,
detune law and drift are identical maths to `js/dsp.js`, so a patch's cutoff,
timing and tuning all land in the same place in both.

---

## Files

| File | What it is |
|---|---|
| `MoodSynth.amxd` | the device, in Live's container format |
| `MoodSynth.maxpat` | the same patcher as plain JSON — the paste route |
| `MoodSynthVoice.maxpat` | one poly~ voice: note handling, voice freeing |
| `MoodSynthVoice.gendsp` | the voice DSP |
| `MoodSynthFX.gendsp` | the master effects DSP |
| `modsynth.js` | patch loading, macro resolution, tempo → delay time |
| `patches.json` | all 302 factory patches, translated for the device |
| `gen/voice.gendsp.txt` | the voice DSP source, in readable form |

`gen/voice.gendsp.txt` is the file to edit if you want to change the sound
engine — it's the readable original that gets wrapped into `MoodSynthVoice.gendsp`.

---

## Troubleshooting

**No sound.** Check that `MoodSynthVoice.maxpat` is somewhere Max can find it —
the same folder as the device is fine. Open the Max window (`⌘M`) and look for
`poly~: can't find MoodSynthVoice`.

**The Patch menu does nothing.** `patches.json` needs to sit next to the
device. The device reads it 400 ms after loading; the Max window will report a
read failure if it can't find it.

**Bend range feels wrong.** See the note about `midiparse` above. If bend
covers half what it should, change `scale 0 16383 -1. 1.` to
`scale 0 127 -1. 1.` in the device patcher.

**gen~ reports an error on load.** Open `MoodSynthVoice.gendsp`, read the
message in the Max window, and fix `gen/voice.gendsp.txt` — then rebuild with
`node tools/build-m4l.js`. The gen~ code is plain, commented DSP; nothing in it
is obscure.
