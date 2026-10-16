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

## samples/bassfinger, samples/basspick — "Motown", "Höfner"

From the same midi-js-soundfonts project as the upright (CC BY 3.0 / the
SoundFonts' own terms, as above): `electric_bass_finger` and
`electric_bass_pick` from **FluidR3_GM**. Chosen by measuring both libraries:
MusyngKite's fingered and picked sets sit 9-17 cents out of tune, FluidR3's
within 4. Natural notes C1-B4, 28 per set, shipped as downloaded.

Each player's tone (Jamerson's muted flatwound P-bass, McCartney's picked
Höfner) is applied by the app when the notes load — see `_sampleShape` in
index.html — so the files themselves are unprocessed.

A third set, `samples/bassslap` (MusyngKite's `slap_bass_1`, "Slap"), was
removed in 4.9.9.4 at the owner's word. A saved bass on Slap plays Picked.

## samples/ebass — "Picked ◆" (bass sequencer)

**[Picked Riff on Real Bass Guitar](https://freesound.org/people/Ixwolf/packs/44244/)**
by **Ixwolf** on Freesound, **CC0**. A real electric bass, picked, one note
per file up the E string: E1 to E2, all thirteen semitones (Freesound sounds
826027-826039, `_rr1` — the pack has one take of each). 24-bit, 48 kHz
originals.

The names were right; the tuning was not quite — the low notes sat 10-14
cents sharp. `build/pitched-sets.py` retunes each to its exact note (the
name fixes the semitone, a harmonic comb measures the cents), trims it to
the attack, keeps 3.0 s of its 5.4 s ring with a 0.8 s fade, peak-matches to
-1.5 dBFS and encodes mono mp3 VBR q6. Notes above E2 are these, shifted up.

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

## samples/beatbox-g — the Beatbox kit

"Beatbox samples" by **giddster** (https://freesound.org/people/giddster/,
pack https://freesound.org/people/giddster/packs/24693/), recorded on a RØDE
NT2-A, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Lightly processed: mono, 30 Hz high-pass, lead-in and trailing silence
trimmed, peak-levelled to -1 dBFS, no compression; mp3 VBR q4.

kick ← beat-box-kick-1 (434920) · kick2 ← kick-4 (434923) ·
snare ← snare-1 (434927) · snare2 ← snare-3 (434929) ·
hat ← hi-hat-4 (434921) · open ← hi-hat-3 (434922) ·
rim ← click (434918) · tom ← tom-2 (434928)

Beatbox 2 (sampler only, the rest of the pack): kick3 ← kick-2 (434919) ·
kick4 ← kick-3 (434924) · snare3 ← snare-2 (434925) · snare4 ← snare-4
(434934) · snare5 ← snare-5 (434931) · hat3 ← hi-hat-1 (434916) · hat4 ←
hi-hat-2 (434915) · tom2 ← tom-1 (434932, cut to 1.5 s of its 7.9) · tom3 ←
tom-3 (434930) · tom4 ← tom-4 (434926) · tom5 ← tom-5 (434933) · droplet ←
droplet (434917). 132 KB for all twenty.

This replaces the first Beatbox kit (4.2.5), sliced from the project owner's
own phone recording. New folder rather than new files under the old one:
the service worker caches samples by URL for good, so the same names would
have kept playing the old take on any device that had loaded it.

## samples/upright — "Upright 2 ◆" (bass sequencer)

"Standup Upright Acoustic Double Bass" by **pjcohen**
(https://freesound.org/people/pjcohen/, pack
https://freesound.org/people/pjcohen/packs/21521/), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

37 notes, E1 to F#4, chromatic except A#1 and A#2, so no note is shifted more
than a semitone. The pack names a sharp after the natural below it (two files
called "f1", the second actually F#1 at 46.1 Hz), so every file was placed by
measured pitch, not by name; all land within ±7 cents.

Mono, 44.1 kHz, mp3 VBR q6. Trimmed to the attack, capped at 2.2 s with a
0.7 s fade, peaks matched to -1.5 dBFS across the set. A two-pole high-pass at
0.6 × each note's fundamental (28–140 Hz) takes out a low hum (≈59/67/100 Hz)
that sat under the upper notes. 416 KB.

Sits beside Upright 1 (samples/bass, the FluidR3_GM SoundFont set above), not
in place of it.

## samples/piano2 — "Piano 2 ◆"

"88 piano keys, long reverb" by **TEDAgame** (https://freesound.org/people/TEDAgame/,
pack https://freesound.org/people/TEDAgame/packs/25405/), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). An old upright
recorded with its room, up to 13 s a note.

The piano is far out of tune (keys up to ±50 cents) and the pack's names do
not reliably say which pitch a file is, so every file was measured with a
harmonic comb (eight partials, a little inharmonicity allowed). On a
whole-tone grid A0, B0, C#1 … B7, plus C8 — 45 notes — the recording nearest
each point was kept and resampled to exactly that pitch. Measured after:
median 0, worst 10 cents; no note is shifted more than a semitone at playback.

Mono, 44.1 kHz, mp3 VBR q6, 5 s with a 1.5 s fade (the room is kept, the
13 s tails are not), peaks -1.5 dBFS. 1.1 MB.

## samples/marimba — "Marimba ◆"

"Mallet Percussion" by **joesh2** (https://freesound.org/people/joesh2/, pack
https://freesound.org/people/joesh2/packs/32432/), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The pack says only "mallet"; it is a marimba by its bars' tuned 4th harmonic
(-16 to -24 dB below the fundamental) and ~1 s ring. Naturals C2–C4, 15 notes,
each 4–15 cents sharp as recorded and resampled to within ±2. Mono, 2 s, mp3
VBR q6, 184 KB.

## samples/rock2, studio, latin, hand, orch — the layered kits (4.9.9.1)

All five are built from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
(Versilian Studios / Sam Gossner), **CC0 1.0**, by `build/drum-kits.py`, which
records the full chain and the gain calibration. Every take is mono, trimmed
to its attack and to where its tail falls 60 dB under its peak, peak-normalised
to -1 dBFS, mp3 VBR q5. A lane holds every strength VCSL recorded (soft to
hard) and both round-robin takes of each; the app picks the strength from the
step's velocity and alternates the takes (`sqLayerTrack`). Files are named
`<lane><layer><take>.mp3` — `snare2b.mp3` is the snare's third strength,
second take. 2.3 MB for all five, loaded only when the kit is picked.

| kit | lanes and sources (VCSL folder › articulation) |
|---|---|
| **Rock ◆** (`rock2/`) | Bass Drum 1 (4 strengths), Snare Drum Modern 1 snares-on (4), Hi-Hat closed (4) and open, Tom 1 / Tom 2 stick (3 each), Suspended Cymbal 1 as crash (3) and ride (stick, 3). The 4.2.2 close-kit treatment: kick boom cut at 400 Hz with a 3.5 kHz beater lift, light compression. Replaces the one-hit-per-drum `rock/` for the kit; `rock/` stays for the phrase sampler's library. |
| **Studio ◆** (`studio/`) | Bass Drum 1 gated to 0.35 s, mids scooped, beater forward; Snare Drum Modern 3 (3) with its rimshot (2) and cross-stick; Hi-Hat closed (4), open and pedal; Tom 1 / Tom 2 stick, tightened; Suspended Cymbal 2 crash (4), ride (3) and bell (2). |
| **Latin Perc ◆** (`latin/`) | Conga — tumba (4), conga (3), quinto (3), open tones; Bongos hi and lo (3 each); Cowbell 1 (3); Claves 1 (3); Guiro; Agogo high (3) and low (2); Shaker small (down/up strokes, four takes); Cabasa. |
| **Hand Drums ◆** (`hand/`) | Cajon — the bass tone (`hit2`/`hit3`, 96–99% of its energy under 200 Hz, 4 strengths) and the slap (`hit1`, 3); Darbuka 1 doum and Darbuka 2 tek (2 each); Frame Drum large (2); Claps (six takes); Tambourine 1 (2); Shaker small; Woodblock (3). |
| **Orchestral ◆** (`orch/`) | Bass Drum 2 (concert, 5); Snare Drum Rope Tension snares-on (4); Timpani 1 (~90 Hz) and Timpani 3 (~213 Hz) drums, 3 strengths each; Clash Cymbals 1 (4); Gong 1 (4, to 5 s); Triangle 1 (3). |

## samples/808 — the Real 808 ◆ kit (4.9.9.1)

The kit plays the fourteen files the phrase sampler already had (above), plus
**hitom.mp3** ← HT50 from the same Michael Fischer set (via `@fluid-music/tr-808`),
trimmed and peak-normalised by `build/drum-kits.py`. One take per lane: an 808
has no velocity timbre.

A TR-909 set was looked at and **not** used: the only free one
(`@fluid-music/tr-909`, Jason Baker / Rob Roy Recordings, via
machines.hyperreal.org) forbids changing the samples and distributing them for
profit, and this app both converts its samples and has paid tiers.

## samples/mideast, africa, samba, bellsfx — world percussion for the Aux layer (4.9.9.2)

Same library (VCSL, **CC0 1.0**), same build (`build/drum-kits.py`, run with
the kit list `mideast,africa,samba,bellsfx` so the shipped kits are not
re-encoded), same layering and naming. 1.4 MB for the four.

| kit | lanes and sources |
|---|---|
| **Middle East ◆** (`mideast/`) | Darbuka 1 doum, Darbuka 2 tek, Darbuka 4 ka, Darbuka 3 second tek (2 strengths × 2 takes each); Frame Drum large open, large muted and small open (2 × 2 each); Tambourine 2 as riq (2); Finger Cymbals (zills, to 3 s); Shaker large. |
| **West Africa ◆** (`africa/`) | Slit Drum low (~108 Hz) and high (~156 Hz) log drums (3 strengths each); Cowbell 2 double bell and single bell (2 each); Agogo Bells 3 (2 strengths, 2–3 takes); Shaker large strokes (4 takes); Claps, solo (4 strengths); Balafon hard mallet, F and C bars (3 strengths each). |
| **Samba ◆** (`samba/`) | Bass Drum 2 as surdo (3 strengths, to 1 s); Snare Drum Rope Tension, low, snares on, as caixa (3); Tom 1 stick rimshots as repinique (2); Agogo Bells 2 and 1, high and low; Tambourine 2; Shaker small doubles (4 takes); Ball Whistle short and long. |
| **Bells & FX ◆** (`bellsfx/`) | Sleigh Bells (3 strengths); Mark Trees (three sweeps, cut to 3 s); Bell Tree (four strokes); Hand Bells, Nepalese (three takes); Finger Cymbals; Vibraslap (four takes); Ratchet (two, cut to 1.2 s); Slapstick (2 strengths); Anvil (three hits × 3 strengths); Brake Drum, hammer (3); Ocean Drum (three, cut to 3 s from 20–37 s). |

Tabla, djembe, udu and taiko are not in VCSL. Freesound has CC0 recordings of
all four, but it was not reachable from where these were built.


## Freesound world kits, Kalimba, Xylophone and recorded loops (4.9.9.3)

Supplied by the project owner as Freesound pack downloads, and built here.
Freesound itself refuses connections from the build environment, so each
licence was checked against the `_readme_and_license.txt` every pack zip
carries, which lists the licence per sound: **every sound below is
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**. Two kinds
of file came without one, and are marked where they appear: the udu takes
(single files from Freesound, CC0 per the owner) and the darbuka and loop
files (no Freesound ID or author in the files; CC0 per the owner, source not
recorded here — **owner: add it**).

Built by `build/drum-kits.py` (kits), `build/pitched-sets.py` (Kalimba,
Xylophone) and `build/sampler-loops.py` (loops), which record the full chain.
Kit takes are treated exactly as the VCSL kits above: mono, trimmed to the
attack and to where the tail falls 60 dB under its peak, peak-normalised to
-1 dBFS, mp3 VBR q5, gain calibrated against the Rock snare. Packs name
strokes loosely, so each lane was sorted by measurement — the share of energy
under 250 Hz in the first 30 ms (bass against tone against slap) and the
spectral peak — and where a pack gives no strengths, a lane's takes are split
into soft and hard layers by their raw level. Files are named
`<lane><layer><take>.mp3`, as above. 1.1 MB for the seven kits.

| kit | from | lanes |
|---|---|---|
| **Tabla ◆** (`tabla/`) | "tabla bols" by **mmiron** — [pack 8162](https://freesound.org/people/mmiron/packs/8162/) | Na, Tin (the pack's "tas": the ringing ~555 Hz stroke), Tun, Te, Re on the dayan; Ke (closed) and Ge, Ge Open on the bayan. The long ghe takes were checked for a pitch bend and have none — each settles at ~92 Hz — so they are one open lane of five takes. The pack's "dhec" is not used. |
| **Djembe ◆** (`djembe/`) | "Djembe Drum Sample Library" by **Infinita08** — [pack 26031](https://freesound.org/people/Infinita08/packs/26031/) | Bass, Tone, Slap (the pack's "rim" hits, its brightest strokes), Muted, Flam (the tone double-hits), Roll. The bass double-hits and the long and roll5–8 takes are not used. |
| **Batá ◆** (`bata/`) | "Percussion samples" ([pack 28352](https://freesound.org/people/sassaby/packs/28352/)) and "Bata samples" ([pack 38391](https://freesound.org/people/sassaby/packs/38391/)) by **sassaby** | Iyá, Itótele and Okónkolo, open and slap — one take from each pack, which are different recordings. The okónkolo's open tone keeps one: the two are tuned 2.5 semitones apart. |
| **Maracatu ◆** (`maracatu/`) | sassaby, pack 28352 | Alfaia (2 strengths) and its rim; caixa and tarol (2), their rims and the samba rimshot; gonguê (the pack's agogo); shekere. |
| **Salsa ◆** (`salsa/`) | sassaby, pack 28352 | Timbales macho, hembra and rimshot; mambo bell (body soft, mouth hard); cha-cha bell; wood block; conga, quinto and tumba with their slaps. Not used: electrokick, electro cymbal, china trash cymbal, the caixa with reverb, the side stick, mele and white conga E. |
| **Medieval ◆** (`medieval/`) | "medieval perc" by **menegass** — [pack 5824](https://freesound.org/people/menegass/packs/5824/) | Tabor (the pack's "adrum", 2 strengths) and Tabor Open; hand drum (its "conga") and slap; tambourine skin and jingles; clappers; seeds; seed pod; shaker; rattle. The seedm and lyre-hit takes are not used. |
| **Clay Drums ◆** (`clay/`) | udu by **iyankc** (Freesound 479245–479253, single files, CC0 per the owner); darbuka from the owner (`Darbuka_01`–`06.wav`, source not recorded) | Udu Bass, Udu, Udu Tap (2 strengths); Darbuka Doum (3), Tek (2), Ka. |

Which file is which take:

**tabla/**
- na0a ← na_sharp ([130428](https://freesound.org/s/130428/)) · na1a ← na ([130421](https://freesound.org/s/130421/)) · na1b ← na-open ([130422](https://freesound.org/s/130422/))
- tin0a ← tas ([130426](https://freesound.org/s/130426/)) · tin1a ← tas_2 ([130425](https://freesound.org/s/130425/)) · tin1b ← tas_3 ([130430](https://freesound.org/s/130430/))
- tun0a ← tun ([130416](https://freesound.org/s/130416/)) · tun0b ← tun_2 ([130419](https://freesound.org/s/130419/)) · tun0c ← tun_3 ([130420](https://freesound.org/s/130420/))
- te0a ← te_middlefinger ([130415](https://freesound.org/s/130415/)) · te0b ← te_2 ([130418](https://freesound.org/s/130418/)) · te1a ← te ([130429](https://freesound.org/s/130429/)) · te1b ← te_ne ([130417](https://freesound.org/s/130417/))
- re0a ← re ([130427](https://freesound.org/s/130427/))
- ke0a ← ke ([130413](https://freesound.org/s/130413/)) · ke0b ← ke_2 ([130424](https://freesound.org/s/130424/)) · ke0c ← ke_3 ([130423](https://freesound.org/s/130423/))
- ge0a ← ghe ([130406](https://freesound.org/s/130406/)) · ge1a ← ghe_4 ([130411](https://freesound.org/s/130411/)) · ge1b ← ghe_8 ([130414](https://freesound.org/s/130414/))
- geopen0a ← ghe_2 ([130405](https://freesound.org/s/130405/)) · geopen0b ← ghe_3 ([130404](https://freesound.org/s/130404/)) · geopen0c ← ghe_5 ([130410](https://freesound.org/s/130410/)) · geopen0d ← ghe_6 ([130409](https://freesound.org/s/130409/)) · geopen0e ← ghe_7 ([130408](https://freesound.org/s/130408/))

**djembe/**
- bass0a ← djembe_hit22 ([460959](https://freesound.org/s/460959/)) · bass0b ← djembe_hit15 ([460973](https://freesound.org/s/460973/)) · bass0c ← djembe_hit14 ([460974](https://freesound.org/s/460974/)) · bass1a ← djembe_hit16 ([460972](https://freesound.org/s/460972/)) · bass1b ← djembe_hit21 ([460958](https://freesound.org/s/460958/)) · bass1c ← djembe_hit13 ([460967](https://freesound.org/s/460967/))
- tone0a ← djembe_hit10 ([460970](https://freesound.org/s/460970/)) · tone0b ← djembe_hit1 ([460949](https://freesound.org/s/460949/)) · tone0c ← djembe_hit12 ([460968](https://freesound.org/s/460968/)) · tone1a ← djembe_hit4 ([460965](https://freesound.org/s/460965/)) · tone1b ← djembe_hit2 ([460960](https://freesound.org/s/460960/)) · tone1c ← djembe_hit3 ([460964](https://freesound.org/s/460964/))
- slap0a ← djembe_hit7-rim ([460954](https://freesound.org/s/460954/)) · slap1a ← djembe_hit6-rim ([460963](https://freesound.org/s/460963/)) · slap1b ← djembe_hit9-rim ([460980](https://freesound.org/s/460980/)) · slap2a ← djembe_hit8-rim ([460955](https://freesound.org/s/460955/))
- mute0a ← djembe_longrim_mute ([460983](https://freesound.org/s/460983/)) · mute0b ← djembe_longrim_mute2 ([460986](https://freesound.org/s/460986/)) · mute0c ← djembe_longrim_mute3 ([460985](https://freesound.org/s/460985/))
- flam0a ← djembe_doublehit5 ([460948](https://freesound.org/s/460948/)) · flam0b ← djembe_doublehit6 ([460947](https://freesound.org/s/460947/)) · flam0c ← djembe_doublehit7 ([460946](https://freesound.org/s/460946/)) · flam0d ← djembe_doublehit8 ([460945](https://freesound.org/s/460945/))
- roll0a ← djembe_roll ([460978](https://freesound.org/s/460978/)) · roll0b ← djembe_roll2 ([460977](https://freesound.org/s/460977/)) · roll0c ← djembe_roll4 ([460953](https://freesound.org/s/460953/))

**bata/**
- iyaopen0a ← bata-iya-tone ([509892](https://freesound.org/s/509892/)) · iyaopen0b ← bata-iya-tone ([687122](https://freesound.org/s/687122/))
- iyaslap0a ← bata-iya-slap ([509893](https://freesound.org/s/509893/)) · iyaslap0b ← bata-iya-slap ([687119](https://freesound.org/s/687119/))
- itoopen0a ← bata-itotele-tone ([509894](https://freesound.org/s/509894/)) · itoopen0b ← bata-itotele-tone ([687118](https://freesound.org/s/687118/))
- itoslap0a ← bata-itotele-slap ([509895](https://freesound.org/s/509895/)) · itoslap0b ← bata-itotele-slap ([687117](https://freesound.org/s/687117/))
- okoopen0a ← bata-okonkolo-tone ([687121](https://freesound.org/s/687121/))
- okoslap0a ← bata-okonkolo-slap ([509897](https://freesound.org/s/509897/)) · okoslap0b ← bata-okonkolo-slap ([687120](https://freesound.org/s/687120/))

**maracatu/**
- alfaia0a ← alfaia-hit ([509528](https://freesound.org/s/509528/)) · alfaia1a ← alfaia-hit-maracatu ([506385](https://freesound.org/s/506385/)) · alfaia1b ← alfaia-hit-combined ([511275](https://freesound.org/s/511275/))
- alfaiarim0a ← alfaia-rim ([509527](https://freesound.org/s/509527/))
- caixa0a ← maracatu-caixa-snare-hit ([506384](https://freesound.org/s/506384/)) · caixa0b ← caixa-vazada-hit ([531787](https://freesound.org/s/531787/)) · caixa1a ← caixa-tarol-hit ([531782](https://freesound.org/s/531782/)) · caixa1b ← caixa-hit-combined ([511274](https://freesound.org/s/511274/))
- caixarim0a ← caixa-tarol-rim ([531788](https://freesound.org/s/531788/)) · caixarim0b ← caixa-vazada-rim ([531786](https://freesound.org/s/531786/)) · caixarim1a ← samba-caixa-rimshot ([531784](https://freesound.org/s/531784/))
- gongue0a ← agogo-hit ([506386](https://freesound.org/s/506386/))
- shekere0a ← shekere-hit ([506383](https://freesound.org/s/506383/))

**salsa/**
- timbhi0a ← timbales-high-macho ([533095](https://freesound.org/s/533095/))
- timblo0a ← timbales-low-hembra ([533094](https://freesound.org/s/533094/))
- timbrim0a ← timbales-high-rimshot-macho ([533089](https://freesound.org/s/533089/))
- mambo0a ← mambo-bell-body ([533091](https://freesound.org/s/533091/)) · mambo1a ← mambo-bell-mouth ([533090](https://freesound.org/s/533090/))
- chacha0a ← cha-cha-bell ([533092](https://freesound.org/s/533092/))
- block0a ← wood-block ([533093](https://freesound.org/s/533093/))
- conga0a ← conga-f-tone ([512063](https://freesound.org/s/512063/)) · conga0b ← conaa-tone ([512064](https://freesound.org/s/512064/))
- congaslap0a ← conaa-slap ([512065](https://freesound.org/s/512065/))
- quinto0a ← quinto-c-tone ([512071](https://freesound.org/s/512071/)) · quinto0b ← quintoc-tone ([512067](https://freesound.org/s/512067/)) · quinto0c ← quinto-b-tone ([512069](https://freesound.org/s/512069/))
- quintoslap0a ← quinto-c-slap ([512068](https://freesound.org/s/512068/)) · quintoslap0b ← quintoc-slap ([512066](https://freesound.org/s/512066/)) · quintoslap0c ← quintob-slap ([512062](https://freesound.org/s/512062/))
- tumba0a ← whitelowdrumd-tone ([512080](https://freesound.org/s/512080/)) · tumba0b ← whitelowdrumd-toneoff-floor ([512076](https://freesound.org/s/512076/))
- tumbaslap0a ← whitelowdrumd-slap ([512073](https://freesound.org/s/512073/))

**medieval/**
- drum0a ← adrum2 ([99743](https://freesound.org/s/99743/)) · drum0b ← adrum4 ([99745](https://freesound.org/s/99745/)) · drum0c ← adrum8 ([99749](https://freesound.org/s/99749/)) · drum1a ← adrum1 ([99741](https://freesound.org/s/99741/)) · drum1b ← adrum3 ([99744](https://freesound.org/s/99744/)) · drum1c ← adrum7 ([99748](https://freesound.org/s/99748/))
- drumopen0a ← adrum5 ([99746](https://freesound.org/s/99746/)) · drumopen0b ← adrum6 ([99747](https://freesound.org/s/99747/)) · drumopen0c ← adrum9 ([99750](https://freesound.org/s/99750/)) · drumopen0d ← adrum10 ([99742](https://freesound.org/s/99742/))
- hand0a ← conga_1 ([99734](https://freesound.org/s/99734/)) · hand0b ← conga_4 ([99737](https://freesound.org/s/99737/)) · hand0c ← conga_7 ([99740](https://freesound.org/s/99740/))
- handslap0a ← conga_2 ([99735](https://freesound.org/s/99735/)) · handslap0b ← conga_3 ([99736](https://freesound.org/s/99736/)) · handslap0c ← conga_5 ([99738](https://freesound.org/s/99738/)) · handslap0d ← conga_6 ([99739](https://freesound.org/s/99739/))
- tambbass0a ← pand0 ([89647](https://freesound.org/s/89647/))
- tamb0a ← pand1 ([90078](https://freesound.org/s/90078/)) · tamb1a ← pand2 ([89648](https://freesound.org/s/89648/)) · tamb1b ← pand3 ([89649](https://freesound.org/s/89649/))
- clappers0a ← clp2 ([99729](https://freesound.org/s/99729/)) · clappers0b ← clp3 ([99730](https://freesound.org/s/99730/)) · clappers1a ← clp1 ([99728](https://freesound.org/s/99728/)) · clappers1b ← clp4 ([99731](https://freesound.org/s/99731/)) · clappers1c ← clp5 ([99732](https://freesound.org/s/99732/)) · clappers1d ← clp6 ([99733](https://freesound.org/s/99733/))
- seeds0a ← seedb1 ([99716](https://freesound.org/s/99716/)) · seeds0b ← seedb2 ([99717](https://freesound.org/s/99717/)) · seeds0c ← seedb3 ([99718](https://freesound.org/s/99718/)) · seeds0d ← seedb4 ([99719](https://freesound.org/s/99719/))
- seedpod0a ← seedp1 ([99724](https://freesound.org/s/99724/)) · seedpod0b ← seedp2 ([99725](https://freesound.org/s/99725/))
- shaker0a ← shk3 ([99843](https://freesound.org/s/99843/)) · shaker0b ← shk2 ([99842](https://freesound.org/s/99842/)) · shaker0c ← shk5 ([99845](https://freesound.org/s/99845/)) · shaker0d ← shk6 ([99846](https://freesound.org/s/99846/)) · shaker1a ← shk4 ([99844](https://freesound.org/s/99844/)) · shaker1b ← shk1 ([99841](https://freesound.org/s/99841/)) · shaker1c ← shk8 ([99848](https://freesound.org/s/99848/))
- rattle0a ← rshk2 ([100005](https://freesound.org/s/100005/)) · rattle1a ← rshk1 ([100004](https://freesound.org/s/100004/)) · rattle1b ← rshk3 ([100006](https://freesound.org/s/100006/)) · rattle1c ← rshk4 ([100007](https://freesound.org/s/100007/))

**clay/**
- udubass0a ← udu-1 ([479245](https://freesound.org/s/479245/)) · udubass0b ← udu-2 ([479250](https://freesound.org/s/479250/))
- udumid0a ← udu-3 ([479249](https://freesound.org/s/479249/)) · udumid0b ← udu-8 ([479253](https://freesound.org/s/479253/))
- udutap0a ← udu-4 ([479248](https://freesound.org/s/479248/)) · udutap0b ← udu-7 ([479251](https://freesound.org/s/479251/)) · udutap1a ← udu-5 ([479247](https://freesound.org/s/479247/))
- doum0a ← Darbuka_06 · doum1a ← Darbuka_01 · doum2a ← Darbuka_02 · tek0a ← Darbuka_03 · tek1a ← Darbuka_04 · ka0a ← Darbuka_05

### Rock ◆ — second cymbal takes

`rock2/crash0b–2b` and `ride0b–2b` are Suspended Cymbal 1's second take of
each strength from **[VSCO-2 CE](https://github.com/sgossner/VSCO-2-CE)**
(Versilian Studios, **CC0**) — `susCymb1-hit_{mp,f,fff}_rr2` and
`susCymb1-hitstick_{pp,mp,f}_rr2`. Its rr1 files are byte-identical to the
VCSL takes the kit already used, so these are the same cymbal's other strike.
The files already shipped re-encode byte-identical; only the six are new.

### samples/kalimba — "Kalimba ◆"

"Kalimba Thumb Piano" by **hollandm** —
[pack 38696](https://freesound.org/people/hollandm/packs/38696/), CC0. The
hard strikes, 17 notes. The pack names every note an octave low (its "c3"
measures 260.7 Hz, middle C), so each file was placed by measured pitch: C4–E6,
naturals, every one resampled to within ±1 cent (they were −24 to +12).
Trimmed to the attack, 2.5 s with a 0.6 s fade, 60 Hz high-pass, peaks
−1.5 dBFS, mono, mp3 VBR q6. 216 KB.

Files, low to high: [691780](https://freesound.org/s/691780/) · [691786](https://freesound.org/s/691786/) · [691792](https://freesound.org/s/691792/) · [691798](https://freesound.org/s/691798/) · [691802](https://freesound.org/s/691802/) · [691772](https://freesound.org/s/691772/) · [691776](https://freesound.org/s/691776/) · [691782](https://freesound.org/s/691782/) · [691788](https://freesound.org/s/691788/) · [691794](https://freesound.org/s/691794/) · [691800](https://freesound.org/s/691800/) · [691804](https://freesound.org/s/691804/) · [691774](https://freesound.org/s/691774/) · [691778](https://freesound.org/s/691778/) · [691784](https://freesound.org/s/691784/) · [691790](https://freesound.org/s/691790/) · [691796](https://freesound.org/s/691796/)

### samples/xylo — "Xylophone ◆"

"VSCO 2 CE - Percussion - Xylophone" by **sgossner** —
[pack 21065](https://freesound.org/people/sgossner/packs/21065/), CC0
(Versilian Studios). Medium mallets, ff. A xylophone sounds an octave above its
written note, which is what the pack's names give, and its "f" files are G —
so these too were placed by measurement: G4–C8 on a C/G grid, each brought
down 12–20 cents to exact pitch. 1.8 s with a 0.4 s fade, 150 Hz high-pass,
otherwise as the kalimba. 84 KB.

Files, low to high: [374703](https://freesound.org/s/374703/) · [374699](https://freesound.org/s/374699/) · [374704](https://freesound.org/s/374704/) · [374700](https://freesound.org/s/374700/) · [374705](https://freesound.org/s/374705/) · [374701](https://freesound.org/s/374701/) · [374706](https://freesound.org/s/374706/) · [374702](https://freesound.org/s/374702/)

Level: a four-note chord's file RMS times `WAVE_GAIN` lands Vibes and Marimba
within 0.1 dB of each other (−10.6, −10.5 dB), so the same sum sets these two:
Kalimba 3.09, Xylophone 1.58.

### samples/loops — the sampler's recorded loops

**Samba Band, Samba Loops** — "samba percussion" by **plotzki** —
[pack 2301](https://freesound.org/people/plotzki/packs/2301/), CC0. The
pack is cut to the sample (418,912 samples at 48 kHz is sixteen beats at
110.00 BPM), so the files are used whole; each loop's tempo is computed from
its exact length, beats × 60 / seconds. The six 4-bar "f" files are one
bateria at 110 and are the Samba Band; the rest are Samba Loops, with sets at
~121, ~125 and ~100. Mono as recorded, mp3 VBR q5, 1.4 MB.

surdo-f ← x-surdo-4bar-f ([36110](https://freesound.org/s/36110/)) · caixeta-f ← x-caixeta-4bar-f ([36111](https://freesound.org/s/36111/)) · pandeiro-f ← x-pandeiro-4barf ([36116](https://freesound.org/s/36116/)) · repinique-f ← x-repinique-4bar-f ([36117](https://freesound.org/s/36117/)) · shaker-f ← x-shake-4bar-f ([36120](https://freesound.org/s/36120/)) · tamborim-f ← x-tamb-4bar-f ([36132](https://freesound.org/s/36132/)) · repinique ← repinique-loop ([36108](https://freesound.org/s/36108/)) · repinique-a ← x-repinique-4bar-a ([36118](https://freesound.org/s/36118/)) · repinique-b ← x-repinique-5bar-b ([36119](https://freesound.org/s/36119/)) · surdo-d ← x-surdo-4bar-d ([36127](https://freesound.org/s/36127/)) · pandeiro-d ← x-pand-2bar-d ([36112](https://freesound.org/s/36112/)) · pandeiro-c2 ← x-pandeiro-2bar-c2 ([36114](https://freesound.org/s/36114/)) · tamborim-c ← x-tamb-2bar-c ([36129](https://freesound.org/s/36129/)) · tamborim-e ← x-tamp-2bar-e ([36133](https://freesound.org/s/36133/)) · shaker-e ← x-shake-1bar-e ([36122](https://freesound.org/s/36122/)) · pandeiro-c ← x-pandeiro-2bar-c ([36113](https://freesound.org/s/36113/)) · pandeiro-b ← x-pandero-2bar ([36134](https://freesound.org/s/36134/)) · surdo-b ← x-surdo-2barb ([36126](https://freesound.org/s/36126/)) · tamborim-b ← x-tamb-2-bar-b ([36128](https://freesound.org/s/36128/)) · shaker-b ← x-shake-1bar-b ([36121](https://freesound.org/s/36121/)) · pandeiro ← x-pandeiro-2bar ([36115](https://freesound.org/s/36115/)) · surdo ← x-surd-2bar ([36125](https://freesound.org/s/36125/)) · tamborim ← x-tamb-2bar ([36130](https://freesound.org/s/36130/)) · shaker ← x-shake-2bar ([36123](https://freesound.org/s/36123/)) · tamborim-slow ← x-tamb-4-bar ([36131](https://freesound.org/s/36131/)) · shaker-slow ← x-shake-4bar ([36124](https://freesound.org/s/36124/)) · repinique-call ← repinique-loop-intro ([36109](https://freesound.org/s/36109/))

**World Loops** (`loops/world/`, 396 KB, stereo) — the owner's files
`DrumSet_Groove`, `Electro_Hi_Drums`, `Weirdo_Drums`,
`Woodblock_and_stuff_sfx` and `Udu_Groovoo`: CC0 per the owner, source not
recorded. The first two are exact whole-bar exports (8 beats at 130.01, 16 at
137.00) and are used whole. The other three were performances, so the beat
grid was fitted to their onsets (least squares; 9.1, 5.6 and 7.5 ms RMS
error) and whole bars cut from the first hit: 16 beats at 100.29 for Weirdo
Drums and Woodblock, 12 at 83.98 — four bars of its 6/8 — for the udu.

All loops have 5 ms fades at both ends. Each set downloads only when asked for
(`PS_LOOP_SETS`), and a decoded loop is held to its computed length
(`_psLoopTrim`) in case a decoder leaves mp3's encoder delay and padding in.
