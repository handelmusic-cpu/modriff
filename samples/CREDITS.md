# Sample credits

Upright Bass (`samples/bass/`), Vibraphone (`samples/vibes/`) and Jazz Guitar
(`samples/jazzgtr/`) note samples are
rendered from the **FluidR3_GM** SoundFont, redistributed by the
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

Vibraphone and Jazz Guitar were chosen against that same ceiling rather than
by preference. Measured band edge on a middle-register note from this source:

    muted trumpet 12.6 kHz    trumpet        8.4 kHz
    PIANO          7.5 kHz    flute          5.8 kHz   <- piano is clipped
    tenor sax      5.5 kHz    nylon guitar   4.8 kHz
    JAZZ GUITAR    4.5 kHz    VIBRAPHONE     3.7 kHz
    Rhodes         2.1 kHz    upright bass   0.8 kHz

Both are dark instruments by nature, so the encode never reaches anything they
were going to produce and they arrive intact -- which is exactly what the piano
could not do. Tenor sax, nylon guitar and Rhodes would also fit comfortably and
are the obvious next additions.

There is no drum kit here: this SoundFont ships the 128 melodic GM programs
only, with no percussion bank (`percussion-mp3/`, `standard_kit-mp3/` etc. all
404). A jazz ride and brushes are 5-15 kHz instruments in any case, so this
encode could not carry them even if the bank existed -- they would need a
different source.
