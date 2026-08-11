# Sample credits

Note samples are rendered from the **FluidR3_GM** and **MusyngKite** SoundFonts, redistributed by the
[midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project
(Benjamin Gleitzman), licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/).

Every natural note (C D E F G A B) is included across bass octaves 1-4; the
app pitch-shifts each sample at playback time to cover the sharps/flats in
between, so no requested note is ever more than ~2 semitones from a real
recording.

A matching piano set was previously included and has been removed. The
encode brickwalled at ~7.5 kHz, which costs an upright bass almost nothing
(99% of its energy sits below 1.8 kHz) but strips a piano of the 5-15 kHz
brilliance that makes it sound like a piano. The synthesized Piano voice is
the better instrument at that quality level.

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
