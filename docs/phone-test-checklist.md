# Phone test checklist

A running list of what only a phone can tell you. **It is a to-do list for the owner, not a gate.**
Sessions add one line per change and carry on; they never wait for a tick, and a box left empty
blocks nothing (shipping, the next change, the native cutover). The owner checks as they go, ticks
what is fine and says what is wrong; a session fixes that in the next batch.

How to use it
- **Session:** add one line under "Open" when a change has something only a phone shows (sound,
  timing, a thumb, leaving the app). `- [ ] 41. Title (version) — what to do → what you should see.`
  One line, two at most. No tables, no background paragraphs: the commit and the PR body carry those.
  Reuse the next free number.
- **Owner:** tick `[x]` when it is fine. Move ticked lines to "Done" whenever a session is tidying;
  nobody needs to.
- **Debugging a miss:** Settings > Look & feel > Copy diagnostics, paste it with the item number.

Phone: `git pull`, `npm run ios:device` (a Debug build; it also gives the Test as row in Settings >
Help & about). Settings > Help & about shows the version and `build <commit>`.

The full original text of every item below (tables, long steps, 4.9.x-era sections 1 to 11) is in
`docs/archive/phone-test-checklist-full.md`; `grep -n` it, never read it through.

## Open

Standing checks from the first device passes (sections 1 to 11 of the full list; skip any that have
been fine for a while):
- [ ] 1. Plugins are there — Settings > MIDI & keyboard lists inputs, Touch has a Haptics button,
  Import a chord sheet offers Files / Photos / Camera.
- [ ] 2. Haptics — taps tick under System; instruments tick per mode.
- [ ] 3. Chord-sheet pictures — photograph a chord sheet; the text it reads is usable.
- [ ] 4. MIDI (needs a controller) — notes, learn-by-tapping bindings, channels.
- [ ] 5. Native sound, the bounce and the clock — bounce a take; run `bounce-check.py` on it.
- [ ] 6. Packs and purchase — StoreKit test purchase, restore, Test as Free / Everything.
- [ ] 7. The older iPad — stress test only, not a target.
- [ ] 8. Key colours, the master EQ, iCloud — settings stick; iCloud sync across two devices (first build with the entitlement: confirm it signs, the switch turns on and a song arrives on the second device; then deploy the CloudKit schema to Production).
- [ ] 9. The rhythm and live-page batch — touch, layout and the clock on the Live page.
- [ ] 10. Native sound, all eight parts at once — clean status line, a recorded voice on the melody,
  a stem bounce, background. (The last step of the Web Audio removal is not waiting on this.)
- [ ] 11. Just notice — splash, first launch, permission prompts, anything slower than before.

Since 6.2:
- [ ] 12. Studio pages (6.2) — Drums, Arp and Chords pages each open and change the real control;
  the rhythm roll holds steps; Sampler Clear colours pads.
- [ ] 13. Dynamic Island light while bouncing (6.8; steps in `docs/dynamic-island.md`) — needs the
  widget extension added once in Xcode.
- [ ] 15. Engine restart and background test (6.9.4) — after a call, Siri, an alarm, headphones or
  Bluetooth in/out the engine restarts by itself; the background test is off unless turned on.
- [ ] 16. Closed Duo's right rail (6.9.5) — the rail is usable by thumb.
- [ ] 17. Open Duo, wide (6.9.6) — rail, top transport, Live beside a part.
- [ ] 18. Native scheduling slice 1 (6.9.7 to 6.9.9.9) — developer entry: engine clock and drums keep
  going with the page throttled; leaving the app mid-loop and returning stays on the beat.
- [ ] 19. Native bass line (6.9.9.7 and .8) — developer entry: staccato line, sampled bass voices,
  walking line, locks.
- [ ] 20. Drum hits start on the beat (6.9.9.9a).
- [ ] 21. Voice | Pattern widget and the tiered sound browser (6.9.9.9.1, .2) — try with a thumb.
- [ ] 22. Live: Voice | Pattern rows, no rolls by default (6.9.9.9.3) — thumb at 360 and 390 pt.
- [ ] 22b. Chord comp in the engine (6.9.9.9.4 to .6) — developer entry: gated hits, ratchets.
- [ ] 23. Engine tempo map (6.9.9.9.9.2) — developer entry: ritardando and ramps.
- [ ] 24. Engine steps the song (6.9.9.9.9.4) — developer entry.
- [ ] 25. Engine plays the song's chords (6.9.9.9.9.7) — developer entry.
- [ ] 26. Engine plays the song's comping (6.9.9.9.9.9) — developer entry.
- [ ] 27. Page writes the engine's bass lines (6.9.9.9.9.9.1) — developer entry.
- [ ] 28. Song screens follow the engine (6.9.9.9.9.9.4) — developer entry.
- [ ] 29. Practice trainer in the engine (6.9.9.9.9.9.6) — developer entry.
- [ ] 30. Endings in the engine (6.9.9.9.9.9.7) — developer entry.
- [ ] 31. More, the record ring, the Record widget, grouped styles (6.9.9.9.9.9.9) — look and tap.
- [ ] 32. Engine plays the arp (6.9.9.9.9.9.9.1) — developer entry.
- [ ] 33. Engine plays the melody generator (6.9.9.9.9.9.9.2) — developer entry.
- [ ] 34. Melody lines written ahead (6.9.9.9.9.9.9.3).
- [ ] 35. Navigation, selection feedback and saving (6.9.9.9.9.9.9.5a).
- [ ] 36. Melody key width and audio-session activation (6.9.9.9.9.9.9.6).
- [ ] 37. Pitch-specific native melody voices (6.9.9.9.9.9.9.7).
- [ ] 38. Factory recordings on native bass, arp and chords (6.9.9.9.9.9.9.7a) — gates release,
  sustain, ratchets; loading-then-retry; Pure tuning refuses with a reason.
- [ ] 39. Live chords for native followers (6.9.9.9.9.9.9.7b) — developer entry: pads, keyboard and
  chart taps move bass, melody and arp once each; leaving the app and returning keeps the chord.
- [ ] 40. Native sequencer patch voices (6.9.9.9.9.9.9.7c) — developer entry: bass, arp, melody
  patches; Stop releases; the free web page still uses its worklet.
- [ ] 41. Long bounce (6.9.9.9.9.9.9.7g) — bounce 15+ minutes with Stems and Native sound on: the app stays
  up after Stop, mix and stems hold the native parts and are the same length.
- [ ] 42. MIDI with every Bounce (6.9.9.9.9.9.9.7g) — the sheet's MIDI tile is a switch, lit by default; Bounce
  writes a `-live.mid` with a Pads track, and none when it is off (also Settings > Recording).
- [ ] 43. Panic reaches the engine (6.9.9.9.9.9.9.7g) — reload the page while a chord rings (or hold one with no
  finger on it): it fades out at start-up, or on Panic.
- [ ] 44. Resume keeps Song (6.9.9.9.9.9.9.7g) — Song on, leave, Resume: Song is lit and Play starts the chart.

- [ ] 45. Native patch chords/sub (6.9.9.9.9.9.9.7h) — compare patch trims, sub on/off, strums, short gates and Stop → every tone/sub sounds once, with no late or held note.
- [ ] 46. Native Pure/glide (6.9.9.9.9.9.9.7h) — compare synthesized/recorded voices, slash chords, held chords and zero/long glide → tuning and voice slides agree with the page.
- [ ] 47. Native MIDI/takes (6.9.9.9.9.9.9.7h) — Bounce all lanes through background/return, import MIDI, test external-only routing → notes/gates align, no local duplicate or stuck MIDI note.
- [ ] 48. Native chart edits (6.9.9.9.9.9.9.7h) — edit repeatedly around a bar with locks, Next/Prev, Hold and an ending → latest edit lands once, old generated replies never replace it.
- [ ] 49. Native transport owner (6.9.9.9.9.9.9.7h) — supported public Play/rapid Stop, lock/leave/return, interruptions/routes and fallback cases → one clock, no late notes; Copy diagnostics reports native/page ownership correctly.

- [ ] 50. Native sampler voices/patterns (6.9.9.9.9.9.9.7i) — compare trim/tune/loop edits, all instrument lanes, reversed/warped pads, gates/chokes, recording/hold erase and queued patterns through lock/return.
- [ ] 51. Native click/simple rhythm (6.9.9.9.9.9.9.7i) — compare accents and phase in simple/compound/odd meters; toggle while playing, lock/return and Stop.
- [ ] 52. Native standalone comp (6.9.9.9.9.9.9.7i) — use Vary/VoiceLead, slash chords, ratchets/gates and repeated taps; no flams or held old chord on a tap or Stop.
- [ ] 53. Native drum queue/chain (6.9.9.9.9.9.9.7i) — queue kits/templates/grooves/main/Aux patterns, unequal lengths and chains; hear each wrap once through lock/return, including cancellation.
- [ ] 54. Native practice/steering/voices (6.9.9.9.9.9.9.7i) — auto keys/tempo, repeated chart arrows/taps, hand BPM and live voice switches retain one clock; Stop restores the trainer's changes.
- [ ] 55. Rating card (6.9.9.9.9.9.9.9) — after a second clean bounce, close the share sheet and leave it alone for 20 s → the
  App Store rating card appears once, never while playing, recording or over a sheet (a Debug build always shows it).
- [ ] 55. Folds and order (6.9.9.9.9.9.9.7j) — Live mõdFX: shut caret hides the part chips, Mix and All-controls button; open, they sit under the pad. Studio Drums/Bass/Melody: Generate | Arrange | Play in, Kit | Aux and the pattern tools are over the grid. Song > Build: Line and section is one shut row under the timeline.
- [ ] 56. Text size and VoiceOver (6.9.9.9.9.9.9.9a) — set iOS Text Size to the largest and the smallest, reopen the app → text grows
  (to 1.15 at most) or shrinks, nothing clipped, pads and canvases still line up; VoiceOver reads Settings headers as buttons.
- [ ] 56. Sound > Voices pickers (6.9.9.9.9.9.9.7j) — each part is ‹ name ▾ ›: the name opens the sound browser, the carets step; a drum kit change waits for the next loop; the ◈ sampler badge still opens the sampler.
- [ ] 57. Ableton Link (6.9.9.9.9.9.9.9.1) — Settings > Ableton Link opens Ableton's pane; with it on and another Link app on the same Wi-Fi, the tempo is shared and Play lands on their bar line. **Needs Apple's multicast entitlement first (docs/link.md); without it an iPhone shows no peers.** The Mac app can be tried now.
- [ ] 58. Ableton Link by ear (6.9.9.9.9.9.9.9.1) — against another device the beats coincide through the speaker, wired headphones and Bluetooth; iOS asks for the local network once, with our text.
- [ ] 59. Background audio toggle (6.9.9.9.9.9.9.9.3) — Settings > Sound & response: ON keeps every part playing through lock/app switch; OFF pauses and resumes on return. Relaunch preserves either choice; check speaker and headphones.

- [ ] 60. Learn (6.9.9.9.9.9.9.9.4) — clean free install: Learn > Show me → hear the drums with no pack toast; play all four steps by thumb, keep both key rows readable, and close with Keep playing or ✕ → full Chords header.
- [ ] 61. Background audio, sampled chord voice (6.9.9.9.9.9.9.9.6) — right after launch set Chords to a sampled instrument, Song > Play, lock the phone → every part keeps playing. If it pauses, Copy diagnostics: `nativeTransport.last.why` now names the voice or pitch that was refused.
- [ ] 62. Background audio with Vary or a drop voicing (6.9.9.9.9.9.9.9.7) — piano chords, a song, Vary on, every part on, lock the phone → keeps playing. Copy diagnostics `nativeTransport.history` lists every refusal with its reason.
- [ ] 63. Background audio, held chords (6.9.9.9.9.9.9.9.8) — a song with sustained or gated chords, every part on, Play, lock the phone → keeps playing (this was the refusal in the 9.7 diagnostics: held-chord release read the real audio clock).
- [ ] 64. Chord quick card (1.9.9.1) — Song > Build, tap a chord in the timeline (and in Tiles) → a card opens beside it with Length, Rhythm, Type, Voicing; More shows Chord, Words, Bass, Plays, move, delete; any pick applies and shuts it; a tap elsewhere or the cross shuts it; no scrolling to the bottom needed.

## Done

- [x] 14. Leaving the app goes quiet (6.9.3) — heard on an iPhone 17 Pro Max, all pass.

### Audio output (6.9.9.9.9.9.9.9.2)

- [ ] iPhone/iPad: Settings > Sound & response > Audio output > Choose output;
  switch between device speaker, paired Bluetooth headphones and a wired/USB interface while
  the band plays. Sound resumes on the chosen route; Current output follows it. MIDI Bluetooth
  permission may remain denied while headphones play. Test returning from device settings too.
- [ ] Mac: choose each connected audio interface, then System default; music follows the choice
  without changing the Mac's default output. Restart audio and relaunch: the preference remains.
- [ ] Mac: unplug the selected interface while playing: sound resumes on the default; reconnect:
  the preferred interface returns. Change the Mac's default with System default selected.
- [ ] Switch during a sample recording and a bounce; playback recovers and the recording is usable.
- [ ] With tempo sync enabled, switch Mac outputs while playing: the session tempo and beat
  continue to follow; check alignment on Bluetooth and the wired interface by listening.
- [ ] Studio Bass, Melody, Drums: Generate | Arrange | Play in, the Generate and Clr row and Place | Edit sit at the top; the roll is under them, and the patch and pattern names under the roll.
- [ ] v6.9.9.9.9.9.9.9.9: Settings > About > Credits, the SoundFont entry now reads MIT with Frank Wen's notice; open it and check it scrolls and reads cleanly.
- [ ] v6.9.9.9.9.9.9.9.9a: Vibes, Nylon guitar, Tenor sax and Muted trumpet are now different (CC0) recordings and the Scratch pad is rebuilt from the new sax: play each over its whole range and the Scratch pad, and check the levels against the other voices and that no low note sounds strained.
- [ ] v6.9.9.9.9.9.9.9.9.4: Bass and Melody rolls with the phone on its side, in Fit and Large: all 16 steps are on screen at once, the roll runs edge to edge (no empty margin either side), and a 32-step roll still scrolls.
- [ ] v6.9.9.9.9.9.9.9.9.1: mõdFX Filter: Screamer, then Ladder, pad on Cutoff × Resonance. Push Resonance to the top: it should sing at the cutoff (Screamer harsher), not stay a gentle peak; sweep Cutoff with it up and listen for pops or a runaway level. Same on a synth voice (Sound menu > Edit sound > Filter) at 100% Resonance.
- [ ] v6.9.9.9.9.9.9.9.9.2: Live, mõdFX caret open: two Static knobs under X/Y (Delay time, Delay mix to start). Set both, then play the pad on Cutoff × Resonance: the delay stays while the pad moves. Quit and relaunch: the knobs are where you left them; Clear zeroes them. Try Cutoff and Resonance on the knobs with the pad on something else.
- [ ] v6.9.9.9.9.9.9.9.9.3: every step grid (Bass, Melody, Drums, Aux) has - 100% + in the Place | Edit row instead of Fit / Large / All, and pinches: on its side the drum grid fills the width with 16 steps too; zoom in to a few big cells, out to see every octave, pinch both ways, and check a tap after a pinch does not place a step.
- [ ] v6.9.9.9.9.9.9.9.9.5: the Real Analog 1 kit, Analog 1 pads, Sub Bass and Tape Stop are different (CC0) drums, and the Clay kit's darbuka lanes now play the Middle East files: play each lane of both kits, Sub Bass and Tape Stop, and check the levels against the other kits.
- [ ] v6.9.9.9.9.9.9.9.9.4: Studio > Drums: load Techno on the Digital 1 kit, then swap the kit through 909, Studio, Rock and Jazz: the kick, backbeat and time stay a kick, a backbeat and the hat or ride (no snare playing time); swap back and the pattern is exactly as it was.
- [ ] v6.9.9.9.9.9.9.9.9.4: Put Tabla (or Latin) on Drums and pick Teental or Son Clave: the percussion line plays on Drums; put a drum kit on Aux and pick 4/4 Rock: the beat plays there. Picking a pattern on either layer never changes its kit; Drums and Aux list the same patterns, by family.
- [ ] v6.9.9.9.9.9.9.9.9.6: Aux 12 against Drums 16: on Drums load 4/4 Basic, on Aux load Afro 6/8 (or Frame Drum 6/8): the bar becomes 48 steps and the two cycle against each other, three bars of the one to four of the other, both audible; load a 3/4 beat on Drums and the bar comes back to 12.
- [ ] v6.9.9.9.9.9.9.9.9.7: Macro Osc (iPhone and Mac only): on Melody and Bass open the patch list, the new Macro Osc category (12 patches), and play each over its whole range: none crackles, none is far louder or quieter than the patch you came from, Plucked String and Modal Bar ring when struck. In the synth editor's Mix & Sources the Macro Osc row picks a model and its Harmonics, Timbre, Morph knobs change the sound; Settings > About > Credits lists the code credit. The web page must not show the category or the row.
- [ ] v7.1: the World Loops set is gone from the Sampler Load sheet (its recordings were made on a Roland unit with no recorded redistribution terms): open Load and check only Samba Band and Samba Loops are listed, and that a song or pad saved earlier with a World Loops clip opens without an error.
- [ ] v7.1a: background audio with a recorded kit: pick Batá, Rock or any kit marked ◆, Play, lock the phone (also on Bluetooth) → every part keeps playing; Copy diagnostics `nativeTransport.state` reads `native`. The takes still alternate and a soft step still plays a softer recording.
- [ ] v7.2: on the phone, in Live scroll down the page: the tab row and the parts row fold away (Play, key and tempo stay) and a small pull tab shows; swipe up from the bottom centre (or tap the tab) and they return, with no Play press from the swipe. Tapping Studio, Song or Sound while already on it steps to that tab's next section.
- [ ] v7.2: switch Bass, Mel or Drums on over nothing: a starter line is written and the band starts at once; Studio > Chords reads pads, colour key, Chord voice (Sub switch with its ?, strum, glide), then the Rhythm builder; Studio > Drums has Kit | Aux above the grid.
- [ ] v7.3: delete and reinstall (no packs): the chords play on Piano, with no lock on Piano in the voice lists; Electric Piano, Organ, Pad and Vibes still preview twice and then open the Sounds Pack sheet.
- [ ] v7.3: without the Studio Pack, bounce a take over a minute long: the .wav in Files > mõdRïff > Bounces is the whole take with no fade at the end, the toast names only the 4-bar MIDI limit, and the Stems switch still opens the Studio Pack sheet.
- [ ] v7.3: Settings > About > Packs > Store with Full Studio owned reads "Every pack listed is unlocked, and every update to them."; the Full Studio sheet lists "All seven packs, and every update to them".
- [ ] v7.4: with no packs, Studio > Bass: Arrange and Play in are dimmed with a lock and open the Studio Pack sheet; Generate works. Studio > Chords: Attack, Release, Reverb, Tone, Reso, Sweep, Width, Drift and every Filter (Off, Ladder, Screamer, Cutoff, Resonance) are dimmed and open the same sheet. With the Studio Pack all of it works.
- [ ] EQ filters: on the EQ card (Mix > Mixer, tap a channel name), switch a strip's and the master's high-pass and low-pass on and off over music, at 12 and 24 dB and at high resonance: no click or thump, and the resonance is a clean peak, not a whistle, on real speakers.
- [ ] v1.1: Settings > Look & feel > Colours > Monotone, in Dark and in Light, outdoors in daylight: the orange (what is sounding, armed, selected) and the grey/paper read at a glance, the labels and part switches are legible without their colours, and nothing is a hue except the orange; switch back to Colour and everything is as it was.
- [ ] v1.3: the tab that was Sound reads Mix. Mix > Voices on an iPhone SE or mini: every part's name is readable and tappable, and the Voice tone card (Tone, Reso, Sweep, Width, Drift) sits under the list; Chords, Melody and Arp each have a link row to it.
- [ ] v1.4: Mix > Mixer on an iPhone: nine rows, drag each fader with a thumb (the name at the left is its own button, the rest of the row is the fader); the Level / Pan / Rev / Dly / Drv / Mix switch changes what the faders control; tap a channel name for its strip (pan, four sends, EQ) and the master's (glue, room, bus, clip, EQ); mute and solo dim the row; the meters move. The Live page's Mixer widget still has the old strips.
- [ ] v1.5: each part page (Chords, Melody, Bass, Mel Seq, Arp) has a mõdSynth card under what you play: ‹ › step the patch, Random rolls one, the caret folds the card, Edit synth opens the editor over the page (patch card, all eight macros, Synth/Mod/FX) and Back returns to the same spot. Try it with a thumb on an iPhone SE, and with the part not on mõdSynth (the card offers to switch it).
- [ ] v1.6: the mõdSynth editor (Edit synth on a part page, or Mix > mõdSynth) has seven tabs: Osc (chips for Osc 1, 2, 3, Sources, Voice), FM, Filter, Env, LFO, Matrix, FX. Swipe the tab row on an iPhone SE to reach Matrix and FX; turn a few dials on each page; a part set on the greyed Attack/Release sliders lands on Env.
- [ ] v1.5a: Bounce responds near its padded edge on a narrow phone; Undo and chord-editor fold labels respond across their full height. With a keyboard attached, focus the tab bar: Left/Right/Home/End select tabs without changing the musical key.
- [ ] v1.8: the EQ card in each channel's strip and the master's (five bands, six on the master): drag the dots with a thumb on an iPhone SE, sweep the filters at 12 and 24 dB over music, Set EQ back to flat. On a free install the card is dimmed and a tap opens the Studio Pack sheet; an EQ saved earlier keeps sounding.
- [ ] v1.7: the wavetable view on each mõdSynth card and at the top of the editor's Osc page: the oscillator's frames stacked with the Shape setting in front; turn Shape, change Wave, tap the Osc 1/2/3 chips and watch it follow. It shows the saved setting only, it does not move with an LFO or the matrix.
- [ ] v1.9: Live on an iPhone: Chords are two rows of four split pads (the 7th half on top, the triad half below, both easy to hit), the eighth pad steps Borrowed / Dominants / Mine / More; the melody keys are tall (380 pt) and Touch Mod still follows your finger up the key; every widget has one three-dot button that opens its sheet (the rhythm bar, octave and Touch Mod, the sampler's rows, mõdFX's axes, then Arrange this widget); the Mixer widget is the Mix tab's rows. On a free install the Arrange rows are locked.
- [ ] v1.9.1: every Studio page on an iPhone SE: the pick row (voice and pattern) is the top of the Bass, Mel Seq, Melody-sequencer, Drums and Arp pages, as in the mock; every button, ? mark, slider row and the Sampler's and mõdFX's small buttons is at least 44 pt (try the Sampler's bank, pattern and chip rows and mõdFX's send chips with a thumb); the Filter and timing rows are cards.
- [ ] v1.9.2: the words: Find (type EQ, voice tone, mõdSynth, rearrange) lands on the right page; Settings > Tutorials > Levels, Chord rhythm, Sampler and Live & Studio read right and point at what is on screen; the Guide's Mixer, EQ, mõdSynth and Live widget paragraphs describe what you see.
- [ ] v1.9.3: a part switched to mõdSynth on Mix, then its Studio page opened: the mõdSynth card shows the wavetable at once (it was a black box until something else moved).
- [ ] v1.9.4: not heard on device — Song > Perform: altered chords and slash basses fit their tiles on a narrow phone; Chart puts a long song title below the heading without squeezing the controls.
- [ ] v1.9.4a: not heard on device — Studio: fold and reopen the section cards on every Studio page; switch pages and return; Find and tutorials reveal closed controls; Live pads, keys and widget sheets remain usable after Studio cards are closed.
- [ ] v1.9.4b: not heard on device — Mix has Mixer and Voices only; Edit synth and sound-picker/Find links open the full editor on the requested Studio part; an older saved Mix synth view returns to Mixer.
- [ ] v1.9.4c: not heard on device — Studio: two rows with larger labels and separate Drums/Aux entries; each opens its own drum layer with no Kit/Aux row. Scroll to tuck the selector away, restore it with Studio parts or a downward pull, and return to the top; the bottom part switches keep their on/off behavior.
- [ ] v1.9.4d: not heard on device — Tutorials > Aux drums opens the new Aux page, points at its kit picker, then shows Aux’s mute control in Mix.
- [ ] Launch previews: not heard on device — play the three layout-overhaul previews through the iPhone speaker and headphones; check clicks/crackle, readable grid/rolls and audio/visual timing. Upload the refreshed stills, eleven IAP shots and preview set in App Store Connect.

### Recorded instrument additions (1.9.5)

- On each pitched part, choose Grand, Upright, Old and Room under Samples >
  Keys. Play low and high notes and repeated chords; compare levels. Room
  must keep its previous sound when an older saved song is loaded.
- With each new piano, start a band and leave the app; check continuation,
  timing and return to the foreground. These changes are not heard on device.

- Choose Ukulele under Samples > Guitars on each pitched part. Check picked
  notes and strummed chords, then a band continuing in the background. Not
  heard on device.

- Choose FM EP and Digital EP in Samples > Keys on each pitched part. Compare
  their distinct tones and levels, soft/hard notes, strums and background
  band playback. Both are recorded FM patches. Not heard on device.

- Pick Garage in Recorded kits on Drums and Aux. Try a syncopated groove,
  all eight percussion pads, hat choking, and a kit swap while playing;
  check levels and background continuation. Not heard on device.

- [ ] v1.9.6: Studio > Chords — the rhythm row follows every chord row, including borrowed, secondary-dominant and My Chords pads.
- [ ] v1.9.6: Live > Melody and Chords > controls — tap the sound name, choose a patch, then close the sheet; the menu stays visible and responds to touch.

- [ ] v1.9.6a: Play Grand, Upright and Old on Chords and Melody with the synth Tone lowered, then reset it — the recorded piano stays clear; check deliberate Touch Mod, channel EQ and mõdFX still shape it. Not heard on device.

- [ ] v1.9.7: Live and Studio Solo keys are the same shorter height (128 pt); slide up a held key and release it to check Touch Mod and note release by ear.
- [ ] v1.9.7: Solo three-dot sheet: Width cycles AUTO / S / M / L / XL and survives relaunch; Glide, Mod and Slide Depth / Speed share one row, and every control responds.
- [ ] v1.9.7: rotate Live both landscape directions: instruments use the width between the safe areas, all eight chord pads stay in one row, and the notch and home indicator cover no playing targets.
- [ ] v1.9.9: with only chords playing (chord rhythm on, drums off), switch Melody on: it starts at once; switch Arp on: it sounds; Generate on Melody lands and plays within a bar or two.
- [ ] Studio strip (5 + 4): tap each of the nine pages on a phone; the solid, muted and on states read by eye, and Active/Mute beside the Voice picker turns the band's part on and off with the same wait as the bottom row.
- [ ] Mix > Voices: a long patch name wraps to two lines and every row's colour bar is the part's colour (not black).
- [ ] Studio > Bass and > Melody: the roll starts right under the header on SE, Pro and Pro Max; ··· opens timing, sound and saved patterns; Active/Mute in the header switches the part.
- [ ] Live: Borrowed row is closed on first launch and opens on + Borrowed; the Solo keys show a pastel bar on every root; the landscape prompt is a frosted pill at mid-right that fades by itself and lets taps through.
- [ ] Live bottom row: a long hold (about half a second) on Drums, Aux, Bass, Melody, Chords or Sampler opens that part's Studio page without switching the part; a quick tap still switches it.
- [ ] Vary picker (Settings > Chords & timing, and the Chords page): with Vary on, a Vary through row appears; untick some voicings and tap one chord repeatedly in Live (and play a song) and only the ticked ones come round; the last one cannot be unticked; the choice survives saving and reloading a setup.
- [ ] v1.9.9.4b: open Studio on Drums upright: the landscape pill shows once; tap Bass and it is gone at once; leave Studio and come back on Drums and it does not show again until the app is relaunched.
- [ ] v1.9.9.5: Live bottom row has Arp and the arp rate chip again; start Bass or Melody from its own Studio page Play, then switch Drums, Melody or Bass on (bottom row or Active/Mute) and each one joins on the next bar at once.
