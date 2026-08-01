# Sample credits

Upright Bass (`samples/bass/`) note samples are
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
