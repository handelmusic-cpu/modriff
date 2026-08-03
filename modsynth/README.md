# MōdSynth

A multivoice synthesiser that runs in a browser and, through Max for Live,
inside Ableton Live. Sixteen voices, two wavetable oscillators with eight-way
unison each, two filters, three envelopes, three LFOs, two motion lanes, a
sixteen-slot modulation matrix, eight macros, nine effects, an arpeggiator and
a drum machine — and 302 patches to start from.

It began as one voice inside MōdRiff. This is that voice built out into its own
instrument.

```
open modsynth-standalone.html          # no server, no install
# or
node tools/serve.js                    # http://localhost:8080
```

---

## What's in it

### Sound engine

**Oscillators.** Two, each reading from one of sixteen wavetable *sets*. Every
set holds four frames and the `Shape` control morphs between them, so a single
oscillator covers a vintage saw at one end and a digital sweep at the other.
The sets are: Classic (sine→triangle→saw→square), Pulse, Super Saw, Harmonics,
Formant, Bell, Digital, Vocal, Reed, String, Glass, Growl, Wavefold, Noisy,
Vintage and Sync.

Each oscillator does up to **8-voice unison** with detune, stereo width and
blend, plus octave, semitone and fine tuning, pan, phase and key tracking.
Oscillator 2 adds **hard sync** and an **FM ratio** mode. Between them:
**phase-modulation FM**, **ring modulation**, a **sub oscillator** (four
waveforms, one or two octaves down) and a **noise generator** (white, pink,
blue, crackle, with its own tone control).

The tables are built by synthesising each frame, transforming it, and
re-synthesising it once per mip level with the harmonics that fit under
Nyquist. That's why a saw at the top of the keyboard measures **41 dB down** on
its own aliasing rather than the wash of intermodulation a naive oscillator
gives you.

**Filters.** Two, in serial, parallel or split routing. Eleven models: a
zero-delay-feedback **Moog-style ladder** at 24 and 12 dB with one saturation
inside the feedback path, a TPT **state-variable** filter with low-pass,
high-pass, band-pass, notch and peak outputs, an **MS-20-flavoured diode**
filter that screams at high resonance, a tuned **comb** for plucked and flute
bodies, and a **formant** filter that sweeps through five vowels. Each has
drive, key tracking, envelope amount and velocity sensitivity.

**Envelopes.** Three — amp, filter and a free one — each with attack, hold,
decay, sustain, release, a curve control and velocity sensitivity. They're
stage-timed rather than coefficient-timed, so a 4 ms pluck is actually 4 ms.
Envelope 3 can loop, which makes it a fourth LFO with an arbitrary shape.

**LFOs.** Three, with ten shapes (including sample-and-hold and smoothed
random), free or tempo-synced rates, delay, fade-in, smoothing, skew, and four
retrigger modes — per-voice, per-phrase, free-running or one-shot.

**Motion lanes.** Two 16-step sequencers with slew, four playback modes and
tempo sync, wired into the matrix like any other source. These are what make a
patch move rhythmically without the arpeggiator.

**Voice modes.** Poly, mono, legato and a unison-mono stack, with glide,
independent up/down bend ranges, transpose, fine tune and an analog drift
control that keeps a stack from sounding frozen.

### Modulation

A **16-slot matrix**: any of 31 sources onto any of 38 destinations, with a
signed amount and a unipolar switch. Sources include the three envelopes, three
LFOs, both motion lanes, velocity, key tracking, note number, mod wheel, pitch
bend, aftertouch, expression, breath, foot, all eight macros, two random values
per note, the unison index, gate and an alternating flag.

**Eight macros.** A macro is just a matrix source, which is what makes it
automatable, savable and MIDI-mappable with no special cases — but because one
macro can drive as many destinations as you have slots for, a small move
becomes a big change. Every factory patch arrives with at least four macros
already wired; the first one is scaled to the filter's actual headroom, so it's
a real move on every patch rather than a nudge on some and nothing on others.

### Effects

Drive (six curves), bit crush with sample-rate reduction, chorus/ensemble,
phaser, tempo-synced ping-pong delay, reverb, three-band EQ, compressor, stereo
width and a limiter.

### Playing it

- **Web MIDI** input with per-port enable, channel filter and program change
- **Mod wheel** (CC 1) and **pitch bend** as first-class modulation sources
  with their own ranges — never re-mappable, so learning a controller can't
  steal them
- **Aftertouch**, expression, breath, foot and the **sustain pedal**
- **MIDI learn** on every control: right-click a knob (or long-press), move
  something on your controller, done. CC 21–28 are mapped to the eight macros
  out of the box.
- On-screen keyboard with velocity by strike position, plus computer-keyboard
  playing
- **Arpeggiator**: thirteen patterns, up to four octaves, tempo divisions from
  8 bars to 1/64, gate, swing, ratchets, probability, latch and five velocity
  modes
- **Drum machine**: nine synthesised parts, up to 32 steps, swing, accents

### Patches

302 factory patches across 18 categories — Vintage, Modern, Analog, Digital,
Bass, Lead, Pad, Keys, Pluck, Motion, Arp, FX, Brass, Strings, Organ, Ambient,
Perc and World. Search by name, category or tag; mark favourites; save your own
alongside them; export and import as JSON.

Patches are sparse — they record only what differs from the defaults — so a
patch written today still loads correctly after new parameters are added.

---

## Running it

**Single file.** `modsynth-standalone.html` has everything inlined and makes no
external requests. Double-click it.

**From source.** `node tools/serve.js`, then open `http://localhost:8080`.
Opening `index.html` directly won't work: `audioWorklet.addModule()` needs an
origin, and file:// doesn't have one. That's exactly what the single-file build
exists to solve — it embeds the DSP as a string and loads it from a data URL.

Chrome, Edge and Opera give you Web MIDI. Safari and Firefox run the synth
fine but need MIDI enabled separately or not at all.

### In Ableton Live

See **[m4l/README.md](m4l/README.md)**. Short version: the device is a real Max
instrument with the DSP in `gen~`, so it runs natively in Live's audio chain —
not a web page in a wrapper. 77 parameters are exposed for automation and MIDI
mapping, the delay locks to Live's tempo, and all 302 patches come along.

It is honestly a subset of the web app — no motion lanes, two LFOs instead of
three, analog oscillator shapes instead of the full wavetable bank, and the
matrix collapsed onto fixed routings because `gen~` can't switch a routing per
sample. The comparison table in that README is exact about what differs, as is
the note about what could and couldn't be verified without a Max install.

---

## Building

```
npm run build      # single-file HTML + the Live device
npm test           # all five suites
```

| Command | What it does |
|---|---|
| `node tools/serve.js` | static server for development |
| `node tools/build-standalone.js` | inlines everything into one HTML file |
| `node tools/build-m4l.js` | generates the Live device from the schema |

---

## How it's put together

```
index.html                  the shell
css/modsynth.css            the control surface
js/params.js                ← the single source of truth
js/dsp.js                   the AudioWorklet: oscillators, filters, voices
js/engine.js                worklet host, parameter plumbing, note routing
js/fx.js                    the effects rack (native Web Audio nodes)
js/sequencer.js             transport, arpeggiator, drum machine
js/patchlib.js              patch store: search, save, import/export, dice
js/patches.js               factory banks
js/patches-extra.js         …continued
js/midi.js                  Web MIDI, CC learn, macros, computer keyboard
js/ui.js                    the panel, built from the schema
js/app.js                   wiring
m4l/                        the Ableton Live device
tools/                      build scripts
tests/                      five suites
```

**`js/params.js` is the source of truth.** One ordered table declares every
parameter's id, label, range, curve, default, unit and group. From it come the
Float32Array the audio thread reads, the patch format, MIDI normalisation, the
Live parameter list and the panel itself. Adding a parameter means adding one
line; it then appears everywhere.

Three design decisions are worth knowing before reading the code:

**Wavetables are generated from time-domain functions.** A new waveform is
written as plain waveform maths and gets correct band-limiting for free, at
every mip level, via FFT → truncate harmonics → IFFT. The first version
evaluated the additive series directly and took 7.7 seconds to start; declaring
frames by their spectrum where the spectrum is known brought that to 88 ms.

**Modulation runs at 32-sample control blocks, not per sample.** Amp gain and
pan are interpolated across the block because those are the two places a
stepped value is audible; cutoff, pitch and shape are smoothed enough by what
they feed into.

**Oscillators render block-wise, per unison line.** Phase, increment, gains and
the wavetable all stay in registers for the length of the inner loop. Detune is
a geometric series (one `pow` for the span, then multiplies), pan uses the sqrt
equal-power law, and the mip level is chosen once per oscillator. The first
version did none of that and ran at 1.2× realtime for a two-oscillator
four-unison patch; it now runs at 3.1×.

---

## Tests

```
npm test
```

| Suite | What it checks |
|---|---|
| `params.test.js` | 23,647 assertions pinning the orderings the audio thread depends on positionally — wavetables, filter models, modulation sources and destinations, tempo divisions, destination index constants — plus schema sanity, normalisation stability and patch integrity |
| `dsp.test.js` | 310 assertions against the real DSP: every wavetable and filter model, aliasing floor, pitch accuracy, envelope timing and sustain levels, voice allocation and stealing, sustain pedal, mono fallback, bend range, mod wheel, macros, every modulation destination, FM, sync, ring mod, PWM, glide |
| `patches.test.js` | renders all 302 patches through the engine and fails any that are silent, deafening or unstable |
| `browser.test.js` | 27 end-to-end checks in Chromium: boot, worklet load, panel construction, audible output, every tab, patch loading, all 302 patches through the live graph, macros actually opening the sound, transport and arpeggiator, save/export/import round trip, and twelve rolls of the dice all making sound |
| `standalone.test.js` | the single-file build genuinely runs from `file://` |

The DSP suite measures audio rather than trusting the graph — pitch by zero
crossings, aliasing by DFT, filter response by RMS — so it catches things a
structural test can't. It has earned its keep: it found the macro-unipolar bug
that was leaving every factory patch loading with its macros half-applied.

---

## Known limits

- **MPE isn't supported.** Per-note pitch bend would need per-voice bend state
  in the DSP and channel-rotor note routing; neither is there. Ordinary
  channel pitch bend and aftertouch work fully.
- **Sixteen voices at maximum unison is 128 oscillators.** That runs at about
  1.3× realtime — playable, but it's the ceiling. A typical patch (two
  oscillators, four-way unison, eight voices) sits around 3× realtime.
- **The reverb rebuilds its impulse response** when size, decay, damping or
  width change. It's debounced by 120 ms, so sweeping those four while a pad
  sustains will stutter. Mix, pre-delay and everything else are free.
- **The Live device is a subset**, and the container format couldn't be tested
  without Max. Both are covered in `m4l/README.md`.
