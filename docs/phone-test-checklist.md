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
- [ ] 8. Key colours, the master EQ, iCloud — settings stick; iCloud sync across two devices.
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
