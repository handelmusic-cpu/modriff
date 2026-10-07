# Sample credits

Note samples are rendered from the **FluidR3_GM** and **MusyngKite** SoundFonts, redistributed by the
[midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project
(Benjamin Gleitzman), licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/).

Every natural note (C D E F G A B) is included across bass octaves 1-4; the
app pitch-shifts each sample at playback time to cover the sharps/flats in
between, so no requested note is ever more than ~2 semitones from a real
recording.

A piano set from that same SoundFont library was previously included and was
removed. The encode brickwalled at ~7.5 kHz, which costs an upright bass almost
nothing (99% of its energy sits below 1.8 kHz) but strips a piano of the
5-15 kHz brilliance that makes it sound like a piano.

## samples/piano — "Piano ◆" (pianoreal)

Supplied by the project owner from a separate source, NOT from the SoundFont
library above. Provenance and licence are the owner's to record here.

28 notes on a minor-third grid (C, D#, F#, A) covering MIDI 24-108, C1 to C8 —
the whole keyboard. Source was 44.1 kHz 16-bit stereo WAV; shipped as stereo
mp3 (VBR q5) with a 12 kHz cutoff, trimmed where each note decays below
-65 dBFS with a 200 ms fade. 1.28 MB for the set.

Measured -50 dB band edge: 8.2 kHz median (5.9-10.2 kHz across the set), so it
is a dark piano — nearer a felt-damped upright than a bright grand. That is
above the 7.5 kHz ceiling that got the old set pulled, and the rolloff varies
per note rather than sitting at one fixed frequency, which is natural
decay rather than a codec wall. The synthesized voice is still available as
"Piano (synth)".

The D#4 anchor was supplied separately (labelled "ModernPiano5_D4" but
measuring 622.25 Hz, which is D#, not D). Its harmonic profile differs from its
neighbour C4 by 7.1 dB mean across H2-H6 — less than the 13.2 dB that C4 and
F#4 already differ from each other — so it sits inside the set's own
note-to-note variation. With it the grid is complete: 29 anchors, and no note
is ever pitch-shifted more than 1.5 semitones.

Which instruments ship, and which SoundFont each comes from, was decided
against that same ceiling rather than by preference.

| instrument      | dir                | source     |
|-----------------|--------------------|------------|
| Upright Bass    | `samples/bass/`     | FluidR3_GM |
| Vibraphone      | `samples/vibes/`    | MusyngKite |
| Jazz Guitar     | `samples/jazzgtr/`  | FluidR3_GM |
| Nylon Guitar    | `samples/nylongtr/` | MusyngKite |
| Tenor Sax       | `samples/tenorsax/` | MusyngKite |
| Muted Trumpet   | `samples/mutetpt/`  | MusyngKite |

MusyngKite wins almost everywhere it was compared — tenor sax 10.5 kHz against
FluidR3's 5.5, vibraphone 5.7 against 3.7, muted trumpet 13.7 against 12.6 —
but its jazz guitar TRUNCATES at 1.34 s where FluidR3's runs the full 3.13 s,
which is fatal for a comping instrument, so that one stays on FluidR3.

Measured band edge on a middle-register note from these sources:

    muted trumpet 12.6 kHz    trumpet        8.4 kHz
    PIANO          7.5 kHz    flute          5.8 kHz   <- piano is clipped
    tenor sax      5.5 kHz    nylon guitar   4.8 kHz
    JAZZ GUITAR    4.5 kHz    VIBRAPHONE     3.7 kHz
    Rhodes         2.1 kHz    upright bass   0.8 kHz

Both are dark instruments by nature, so the encode never reaches anything they
were going to produce and they arrive intact -- which is exactly what the piano
could not do. Tenor sax, nylon guitar and Rhodes would also fit comfortably and
are the obvious next additions.

## samples/violin — "Violin ◆" (violin)

**Versilian Studios Chamber Orchestra 2, Community Edition (VSCO-2 CE)** — released
by Versilian Studios as **CC0 / public domain**. Obtained through
[tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)
(Nicholas Brosowsky), which redistributes it under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) and states VSO2 as the
source in its `sample-source-info.txt`. Attributed here under the stricter of
the two terms.

The only set in this library that is a real chamber recording rather than a
SoundFont render, and it is here because the SoundFont violins are not usable.
Measured against the same test that got the first piano pulled:

| source | f95 | f99 | varies with register? |
|---|---|---|---|
| FluidR3_GM violin  | — | ~3.6 kHz at every pitch | no — a codec wall |
| MusyngKite violin  | — | ~3.5 kHz at every pitch | no — a codec wall |
| **VSCO-2 CE**      | 0.8–6.6 kHz | **3.2 kHz at C4 → 10.7 kHz at E6** | yes |

A flat ceiling at every pitch is the encoder. A ceiling that climbs with the
register is the instrument, which is what a violin actually does — most of its
energy sits under 5 kHz, with the bridge hill around 2–3 kHz.

15 anchors, C E G A per octave across the violin's own range, G3 to C7. No note
is ever pitch-shifted more than 2 semitones, and every note has at least two
real takes within 3 — which is what the round robin spends (see `_rrSample`).
Pitch verified by autocorrelation against each file's name: all 15 within
±23 cents, no octave errors.

Source was 44.1 kHz mono mp3, 11–17 s of continuous bowed tone. Shipped trimmed
to 3.2 s with a 300 ms fade and a 45 Hz high-pass, mono, LAME VBR q4 — 528 KB
for the set, 35 KB a note. The trim is the app's own budget: `playSampleVoice`
is a one-shot with no loop, so no sampled voice in this app sustains past its
buffer. Re-encoding cost nothing measurable — E6's f99 moved 10746 → 10716 Hz.

Level: `WAVE_GAIN.violin` is 1.03, found by rendering one note offline through
the app's own gain path and matching RMS against tenor sax. A file-level
estimate said 1.59 and rendered 3.8 dB hot — a loudest-window reading flatters
a decaying sax against a violin that holds its level for the whole note.

## samples/clarinet, samples/flute — "Clarinet ◆", "Flute ◆"

Same **VSCO-2 Community Edition** set as the violin above, same route, same
terms. Trimmed and encoded identically: 3.2 s, 300 ms fade, 45 Hz high-pass,
mono, LAME VBR q4. Clarinet 392 KB for 11 notes, flute 336 KB for 9.

Clarinet: D F A♯ per octave, D3 to F6. Flute: C E A per octave, C4 (its real
bottom) to A6. Nothing is pitch-shifted more than 2 semitones in either.

Pitch verified by harmonic product spectrum rather than autocorrelation —
a flute tone is close enough to a sine that autocorrelation locks onto the
octave below and reports every high note an octave flat. All within ±12 cents
with one exception: **the source's `Fs6.mp3` for clarinet measures 1399 Hz,
which is F6, not F♯6** — 97 cents flat of its own name. It is a good recording
with a wrong label, so it ships here as `F6.mp3` and the grid treats it as F6.
Shipped as named it would have put every note above D6 a semitone sharp.

Neither gets a round robin, and the violin does. Their grids are minor thirds
and wider, so a second take is four semitones away, and four semitones on a
clarinet can cross the register break between the chalumeau and the clarion —
two takes that are not the same instrument's colour. The violin's C E G A grid
keeps inside three.

Level, found the same way as the rest of the table — rendered through the app's
own gain path and matched on RMS against tenor sax. Raw, the clarinet was
10.3 dB hot and the flute 3.4, so `WAVE_GAIN` is 0.36 and 0.80. Both land at
+0.0 dB against the reference.

Both are dark by nature and arrive intact: f99 runs 1.3–3.7 kHz on the clarinet
and 1.8–3.1 kHz on the flute, with essentially nothing above 8 kHz, and it
climbs with the register the way the violin's does.

Cymbals (`samples/drums/`) are the **FluidR3_GM percussion bank**, as published
by [WebAudioFont](https://github.com/surikov/webaudiofontdata) — the same
SoundFont as the upright bass and jazz guitar above, so the same CC BY 3.0
terms apply.

    kick.mp3       MIDI 36, Bass Drum 1
    sidestick.mp3  MIDI 37, Side Stick (cross-stick)
    hatclosed.mp3  MIDI 42, Closed Hi-Hat
    hatpedal.mp3   MIDI 44, Pedal Hi-Hat
    tom.mp3        MIDI 47, Low-Mid Tom
    ride.mp3       MIDI 51, Ride Cymbal 1
    ridebell.mp3   MIDI 53, Ride Bell

An earlier note here said a sampled kit was impossible. That was true of the
source in use — midi-js-soundfonts renders the 128 melodic GM programs only —
but it was too broad a conclusion. WebAudioFont publishes the percussion bank
as individually encoded one-shots, and those are NOT subject to the ~7.5 kHz
brickwall the melodic mp3s have. Measured: the ride reaches 15.9 kHz with 18%
of its energy above 7 kHz, the ride bell 14.5 kHz with a 2.65 s tail.

Six of the Jazz kit's eight voices are these recordings. Only the two brush
voices are synthesized, because there is no brush anywhere in the GM percussion
map — and a brush swirl is a sustained gesture rather than a struck one, which
is the case synthesis handles well anyway. Every sampled voice falls back to a
synthesized version if the fetch fails, so the kit is never silent.

Track names map to standard GM percussion notes, so an exported MIDI file lands
on the right pads in Ableton Live, Battery or any GM kit without remapping.

---

## Fingering charts — flute and clarinet

Not samples, but the same question applies: where did the data come from, and
why should anyone believe it?

The flute and clarinet charts in `index.html` (`FLUTE_FING`, `CLAR_FING`) come
from **[@pepperhorn/fingering-components](https://github.com/pepperhorn/fingering-components)**
(MIT, © Shaun Evans), which publishes woodwind fingerings as plain JSON. Its
flute chart is standard Boehm, written C4–C7; its clarinet is a 17-key Boehm
maker's chart, written E3–A6. Both are re-encoded here into the compact form
the app keeps inline — the app is one file, so a runtime dependency was not an
option — with the key names preserved.

These two instruments shipped the written note and no chart at all for a long
time, deliberately: a fingering chart that is *wrong* is worse than no chart,
because someone learning takes it on trust and drills the mistake. So the data
was audited before it was brought in, on the properties a real chart must have
and a mistyped one would not:

- chromatic and complete over the stated range — no gaps, no duplicate notes;
- every flute note E4–C♯5 repeats **unchanged** an octave up, because the second
  register is the first one overblown;
- every clarinet clarion note is its chalumeau fingering **plus the register
  key** a twelfth below — twelve of twelve;
- no register key anywhere in the chalumeau;
- in the bottom register, going up a semitone never covers *more* holes;
- landmark notes checked by hand: flute low C on both foot keys, D on all six
  with no pinky, C♯5 with everything off; clarinet written G3 on all six, throat
  B♭ on the register and A keys with the thumb hole open.

One thing the audit found and the app does not hide: above the clarion, a single
clarinet fingering speaks more than one partial — D♯6 and G♯6 share their short
fingering here — which is why each of those carries its long alternate in the
panel.

The saxophone table above them is older and hand-written, and carries no such
citation. It covers written B♭3–F6 and has not been re-sourced.

## samples/bassfinger, samples/basspick, samples/bassslap — "Motown", "Höfner", "Slap"

From the same midi-js-soundfonts project as the upright (CC BY 3.0 / the
SoundFonts' own terms, as above): `electric_bass_finger` and
`electric_bass_pick` from **FluidR3_GM**, `slap_bass_1` from **MusyngKite**.
Chosen by measuring both libraries: MusyngKite's fingered and picked sets sit
9-17 cents out of tune, FluidR3's within 4; for slap both are in tune and
MusyngKite's attack is sharper. Natural notes C1-B4, 28 per set, shipped as
downloaded.

Each player's tone (Jamerson's muted flatwound P-bass, McCartney's picked
Höfner, a scooped slap) is applied by the app when the notes load — see
`_sampleShape` in index.html — so the files themselves are unprocessed.

## samples/808 — the phrase sampler's TR-808

From **Michael Fischer's Roland TR-808 sample set** (Technopolis, 1994),
recorded from the individual outputs of a real TR-808 (serial 103852) and given
away with no licensing restrictions — the text file that came with it calls
them "ABSOLUTELY FREE". Taken from the copy packaged on npm as
`@fluid-music/tr-808` (ISC), which documents the source at
machines.hyperreal.org. Fourteen of the 116 files, converted to mono MP3 and
trimmed of trailing silence, otherwise as recorded:

| file | original | | file | original |
|---|---|---|---|---|
| kick | BD2575 | | cowbell | CB |
| snare | SD5050 | | conga | HC50 |
| clap | CP | | tom | MT50 |
| hat | CH | | lotom | LT50 |
| open | OH25 | | clave | CL |
| rim | RS | | maracas | MA |
| crash | CY5050 | | bass | BD2510, tuned to G1 (fluid-music's `BDTuned`) |

## samples/sfx — the phrase sampler's FX bank

- **coin, laser, jump, powerup, explosion, gameover** — rendered from
  [ZzFX](https://github.com/KilledByAPixel/ZzFX) (Frank Force, MIT), a small
  sound-effect synthesizer: each file is one ZzFX parameter set, rendered
  offline. Game Over is one of the example sounds in ZzFX's README.
- **levelup, scan, achieve** — from [uisfx](https://github.com/romainsimon/uisfx)
  0.4.0, whose audio is dedicated to the public domain (**CC0 1.0**): the
  arcade pack's `level-up` and `achievement` and the sci-fi pack's `scanning`,
  re-encoded only.
- **airhorn, siren, scratch, tapestop** — made for this app. The horn and
  siren are synthesized; the scratch is the tenor sax C4 above, moved back and
  forth under a virtual hand; the tape stop is a bar of the 808 above, slowed
  to a stop.

All are peak-normalised to −1 dBFS; their relative levels on the pads are set
by `gain` in `PS_FACTORY_KIT`.

## samples/rock and samples/hiphop — the Rock and Hip-Hop kits

Both are built from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
(Versilian Studios / Sam Gossner), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — no attribution
required; credited here anyway.

Same recordings, two treatments (the ffmpeg chain is per file; mono, 44.1 kHz,
mp3 VBR q5, peak-limited to -1 dBFS):

- **Rock** — close-kit cleanup: Bass Drum 1 (v7) with the boom cut at 400 Hz
  and a 3.5 kHz beater lift, Snare Drum Modern 1 (snares on), Hi-Hat closed and
  open, Tom 1 / Tom 2 (stick), Suspended Cymbal 1 as crash (hit) and ride
  (stick). Lightly compressed, tails trimmed.
- **Hip-Hop** — the kick pitched down ~3 st, Snare Drum Modern 2 down ~2 st,
  both saturated (tanh), hard-compressed and low-passed (7–9 kHz); short hats,
  Claps, Snare 2 cross-stick as rim, Shaker (small) and Tambourine 1.

180 KB for both kits. They load only when the kit is picked.
