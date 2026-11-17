# Every control on Studio and Live today, against the mock

Working list for the layout overhaul (`docs/live-studio-mock.html`). Collected from the running
page at 430 x 932 on a blank project, every fold opened, by walking the visible buttons, inputs,
selects and canvases of each page. **In mock** says whether the mock draws it: yes, no, or new
(drawn in the mock, not in the app today).

Not walked: what sits behind a button that opens a sheet or menu (marked "sheet"), and the play
surfaces themselves (chord pads, melody keys, roll and grid cells), which are not buttons.

## Where the mock is wrong about the app

1. **Melody is two parts today, the mock has one.** "Melody" (top strip) is the strip you play,
   with Touch Mod. "Mel" (bottom row) is the melody sequencer, with its own voice, filter and
   mixer channel (Mel Sq). The mock's seven-part strip merges them. Either the strip has eight
   entries or one Melody page carries both voices.
2. **Arp has no roll.** Its page is settings only (octaves, rate, rate motion, loudness shape,
   rhythm, filter). The mock draws a piano roll and play keys for it.
3. **Aux is a layer of the Drums page**, switched by Kit / Aux with a mute each, its own kit,
   groove, lanes and eight patterns. The mock shows Aux only as a grid row.
4. **The macro knobs are shared, and five of them live on Studio's Chords page**, in the Chord
   voice fold: Tone, Reso, Sweep, Width, Drift. The app's help says they shape the Chords,
   Melody strip and Arp voices together. Drive is a separate control that acts on every voice
   (`fx-drive`) and is also a mixer knob per channel. None of this is on the Sound tab, so a
   shared control is sitting on one part's page: it needs a home that says it is shared.
5. **Tap on the bottom row already means on/off everywhere** (since 6.6). A part's page opens by
   hold or slide on the same button; that is the gesture the strip replaces.

## Studio: Chords

| Control | In mock |
|---|---|
| Capture what you play | yes |
| Variants: Root, sus2, sus4, add9, power, /5, /b6, /6, /b7, /7, + More qualities | one button |
| More chords (borrowed, modal, secondary dominants) show/hide | drawn open |
| Rhythm picker (Every beat…), Rhythm on/off, Keep playing, Edit rhythm | picker only |
| Rhythm builder: Match drums, own length −/+, steps −/+, step presets 6 8 9 12 15 16 18 24 32 | grid only |
| Rhythm builder tap modes: Level, Ratchet, Hold | no |
| Rhythm builder swing: Feel / Own; Start from an existing rhythm; Clear | no |
| Chords on the grid (which chords the pads show) | no |
| Chord Forms reference (show, root picker) | no |
| Chord voice: sound picker (sheet), Roll a new sound | picker only |
| Chord voice: Oct−, Oct+ | no |
| Chord voice: Attack, Release, Reverb Mix, Reverb Size | no |
| Chord voice: Tone, Reso, Sweep, Width, Drift (the global macros) | no |
| Chord voice: Sub on/off, Sine / Warm, Sub level | Sub button only |
| Chord voice: Strum on/off, Strum length; Chord under arp; Glide on/off, Glide time | no |
| Voicing: Close, Spread, Drop 2, Drop 3, Soul/R&B, Neo-soul, Vary | no |
| mõdFX on Chords and Arp (opens mõdFX), Chords mõdFX mix | no |
| Help: Chord Variants, Chord Grid, Chord Forms | no |
| Mute | new |

## Studio: Melody (the strip you play)

| Control | In mock |
|---|---|
| Capture what you play | no |
| Keys / Strip | no |
| Octave down, Octave up | no |
| Hold | no |
| Glide on/off, Glide time, Mode: Auto | on the sequencer page only |
| Touch Mod on/off; Bright, Wah, Vibrato, Tremolo; depth; speed; Depth / Speed axis | no |
| Notes on the strip (which notes the keys show) | no |
| Sound picker (sheet), Roll a new sound | picker only |
| Filter: Off, Ladder, Screamer; cutoff; resonance | no |
| Attack, Release, Reverb | no |
| Key width: Auto; Do Re Mi labels | no |
| mõdFX on Melody, Melody mõdFX mix | no |
| Help: Melody / Solo | no |

## Studio: Sampler

| Control | In mock |
|---|---|
| Capture what you play | no |
| Pads (count set by Decrease / Increase) | pads yes, count no |
| Hold, Roll, Roll rate, Stop | no |
| Load (sheet), Trim… (sample editor), Reset | Trim only |
| Preset / User; banks A Mix, B Drums, C Phrases, D FX | yes |
| Quantize: Off, 1/32, 1/16, 1/8, 1/4, Bar; Triplets | as a hint only |
| Patterns 1 to 8 (hold to clear) | yes |
| Rec, Cap, Play, Clear, Undo | Cap missing |
| Pattern length: 1, 2, 4, 8 bars | no |
| Selected pad: pitch down/up, reset to 0 st | no |
| Selected pad mode: One-shot, Gate, Loop | One-shot only |
| Selected pad: Reverse, Sync, Key, Warp | yes |
| Mute group: none, 1, 2, 3, 4 | one button |
| Sends: Delay, Reverb, More (full mõdFX pad); Sampler mõdFX mix | one button |
| Record, Resample, Library (transport sheet today) | new on the page |

## Studio: mõdFX

| Control | In mock |
|---|---|
| Patch picker | yes |
| Sample (a clip for the pad) | no |
| Hold | no |
| Pad filter character (Clean…) | no |
| Release time | no |
| Clear, About | no |
| Send each part through the pad: Drums, Aux, Bass, Melody Seq, Arp, Sampler, Melody, Chords | one "Target" button |
| X axis parameter, Y axis parameter | yes |
| Static knob A and B: parameter and value | no |
| The X/Y pad | yes |
| Motion: arm record, loop, clear | no |
| mõdFX mix per part, all eight | no |
| Save patch | new on the page |
| Chain (Filter, Drive, Delay, Reverb) | new, not in the app |

## Studio: Drums (Kit layer and Aux layer)

| Control | In mock |
|---|---|
| Kit picker, Groove picker (Aux: Aux kit, Aux groove) | Kit and Groove |
| Kit / Aux layer switch, Mute Kit, Mute Aux | one Mute |
| Lanes (Kit 6, Aux 8): name button for sample, shape, copy, paste; two knobs per lane | lane names only |
| Step grid | yes |
| Fill…, Duplicate, Tuplets, Audition, Clear this pattern | Fill and Clear |
| Steps −, count (tap to type), + | one Steps button |
| Rate: ½×, 1×, 2× | no |
| Swing amount (all parts); 8th / 16th | one Swing button |
| Patterns 1 to 8; Save, Dup, Clr (chain) | no |
| Place / Edit | no |
| Zoom out, 100%, in | no |
| Save…, Open (named patterns) | no |
| mõdFX on Drums and Aux; Drums and Aux mõdFX mix | no |
| Help: The drum grid | no |
| Play-it pads | new |

## Studio: Bass

| Control | In mock |
|---|---|
| Voice picker, Bass line (style) picker | yes |
| Steps −, count, +; rate ½× 1× 2× | Steps and Rate buttons |
| Octave down, up | no |
| Filter cutoff, resonance | no |
| Generate / Arrange / Play in | yes |
| Generate (write a line), Clr | Clear only |
| Follow on/off; Feel: Four / Two | no |
| Piano roll (keys, roll, ruler) | yes |
| Place / Edit; Zoom out, 100%, in | no |
| Save…, Open | no |
| mõdFX on Bass, Bass mõdFX mix | no |
| Help | no |
| Play-it keys, Mute | new |

## Studio: Melody sequencer (Mel)

Same as Bass, with these differences.

| Control | In mock |
|---|---|
| Voice picker, Melody line (style) picker | yes |
| Filter: Off, Ladder, Screamer; cutoff; resonance | no |
| Mode: Auto; Glide on/off; Glide time | no |
| Follow on/off (no Feel) | no |

## Studio: Arp

| Control | In mock |
|---|---|
| Voice picker, Arp pattern picker | yes |
| Arp on/off; show or hide settings | no |
| Octaves: 1, 2, 3 | no |
| Rate dial; Sync / Free | one Rate button |
| Rate motion: Off, Accelerate, Decelerate, Swell | no |
| Loudness shape: Flat, Cresc., Decresc., Hill, Valley | no |
| Rhythm: Even, Swing, Skip, Accent | no |
| Filter: Off, Ladder, Screamer; cutoff; resonance | no |
| mõdFX on Arp, Arp mõdFX mix | no |
| Piano roll, Generate / Arrange / Play in, play keys | new, not in the app |

## Live: the default stack

Seven slots by default. Each has a slot menu ("swap, move or remove") and the stack ends with
"Add / reorder widgets". The drum, aux, bass and melody grids are widgets that can be added; they
are not in the default stack.

| Widget | Controls today | In mock |
|---|---|---|
| Chords | title (hide extras), Sub, More chords (off / modal / dominants / mine), sound picker, roll a new sound, capture, pads | pads, capture, one ··· |
| Chords extras | Variants row; rhythm bar (picker, on/off, Keep playing, Edit rhythm); rhythm builder (as Studio); Chords on the grid; Chord Forms; Oct−, Oct+; mõdFX and mix; Fewer controls | behind ··· |
| Melody | title (hide extras), sound picker, roll a new sound, capture, keys | keys, one ··· |
| Melody extras | Keys / Strip; octave down, up; Hold; Glide; Touch Mod with its four types, depth, speed, axis; Notes on the strip; mõdFX and mix | behind ··· |
| Styles | voice and style for Drums, Aux, Bass, Chords, Melody: previous, next, and pick from a list each; Save…, Open | three buttons only |
| Sampler | title (show controls), capture, pads; the Studio controls when opened | pads, one ··· |
| mõdFX | title (show controls), X/Y pad, record a move, Loop, Clear | pad, one ··· |
| Bounce | record what you play to audio and MIDI; Stems on/off | missing |
| Endings | Ritard, Tag, Big Fin, Fade, Cold | three buttons, wrong names |
| Stack | slot menu per widget; Add / reorder widgets | missing |
