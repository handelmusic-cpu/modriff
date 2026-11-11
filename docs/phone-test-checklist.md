# Phone test checklist

Everything built since the last time the app was on a phone, in one pass. Each
item says what to do, what you should see, and what to send back if you do not.
Versions are the ones in the footer (Settings > Help & about).

**What this list cannot tell you:** whether the new native sound is *good*. It
checks that things work, that nothing is wrong that a Mac could not see, and
that the numbers the app records are sane. How a part sounds is your ear.

## Before you start

1. `git pull`, then `npm run ios:device` with the phone plugged in (the update
   is one command: it builds, syncs and installs). It is a **Debug** build, which
   is what gives you the Test as row in section 1.
2. Open the app and look at Settings > Help & about. It should say
   **v6.0t**. If it says anything older, the build did not install.
3. Have these ready: a MIDI keyboard or pad controller (USB through the adapter,
   or Bluetooth), a real Ultimate Guitar PDF of a song you know, a songbook or
   lead sheet to photograph, and a second Apple device if you want to test
   restore.
4. If anything misbehaves, **Settings > Look & feel > Copy diagnostics** and paste it
   into a note. It carries the build, what the native engine measured and the
   page's errors. Send it with the item number.

Mark each item **ok**, **wrong** (and what you saw) or **skipped**.

---

## 1. Plugins are there (2 minutes, do this first)

The page now finds app plugins by name instead of by a list that, on a device,
does not always include them (`modCapPlugin`, 4.9.9.9.9.8.9n). If this fails,
sections 3, 4 and 5 will not mean anything.

| # | do | you should see |
|---|---|---|
| 1.1 | Settings > MIDI & keyboard | the pane lists MIDI inputs (or "no inputs") and does **not** say "Not supported on this device" |
| 1.2 | Settings > Look & feel > Touch | a **Haptics: ON** button that is not greyed out |
| 1.3 | Song > Build > File > Import a chord sheet | the dialog has **Files…, Photos, Camera** (three buttons, not one) |
| 1.4 | Settings > Packs & purchases | a **Test as Free / Everything** row with a button per pack (Debug build only) |

If 1.1 to 1.3 show the *web* versions (no Photos or Camera, "not supported" MIDI,
no haptics button), the plugins did not register. Look in Xcode's console for
`[ModRiff] capacitorDidLoad` (it lists the plugins it registered) and
`[ModMidi] plugin registered`, `[ModHaptics] plugin registered`,
`[ModOcr] plugin registered`. Send what it prints.

## 2. Haptics (4.9.9.9.9.8.9i)

| # | do | you should see |
|---|---|---|
| 2.1 | Tap a chord pad on Live | a firm tap under the finger, at the same moment as the sound, not after |
| 2.2 | Tap a melody key, a sample pad | the same firm tap |
| 2.3 | Put a finger on the mõdFX pad and drag | a light tap on touch, then light taps while you move, about 8 a second at most |
| 2.4 | Press + / − on a sample-pad stepper and hold | a small tick per step |
| 2.5 | Bounce, stop it | a "success" buzz as the file is written |
| 2.6 | Settings > Haptics: OFF, then tap a pad | nothing |
| 2.7 | Leave the phone alone for 10 seconds, then tap a pad once | **the first tap after a pause**: is it as quick as the rest? (This is the one case the code cannot fully fix; say if it is late.) |

## 3. Chord-sheet pictures (4.9.9.9.9.8.9m)

The dialog is Song > Build > File > Import a chord sheet. Whatever it reads goes into
the text box; fix anything wrong there and the preview updates.

| # | do | you should see |
|---|---|---|
| 3.1 | **Photos**: choose a screenshot or photo of a chord sheet | "Reading…", then text in the box; section names in [brackets]; chord lines with spaces between chords |
| 3.2 | **Camera**: photograph a printed page (flat, well lit, text filling the frame) | the iOS permission prompt the first time, then the same |
| 3.3 | **Files**: pick an Ultimate Guitar **PDF** | text from every page up to eight, the chords above the lyrics |
| 3.4 | **Files**: pick a plain `.txt` chord sheet | read as text, no waiting |
| 3.5 | Look at the preview under the box | the sections and chords it found, the key, and a note that it was read from a picture |
| 3.6 | Tap **Make the song** | the chart is built; Undo is offered |
| 3.7 | Photograph a page at an angle, or a dim one | it still reads something, or says "No text found" and does not hang |

**Send back for 3.1 to 3.3:** a screenshot of the box and preview, and what the
page actually says. The thing to learn is how many chords it misreads, and which
ones (a flat read as "b", a "7" lost, "Cm" read as "Cin"). That decides whether
the recogniser's settings or the parser's tolerance need work.

## 4. MIDI (needs a controller)

Written and verified against a stand-in; it has never seen a real device.

| # | do | you should see |
|---|---|---|
| 4.1 | Plug a keyboard in (USB adapter), open Settings > MIDI & keyboard | the keyboard's name under Inputs |
| 4.2 | Play keys | chords or melody play, as the pane's "MIDI input plays" setting says |
| 4.3 | Unplug, replug | the port disappears and comes back without relaunching |
| 4.4 | **Bluetooth** button in the pane (if the controller is Bluetooth) | iOS's own pairing sheet, no crash |
| 4.5 | Turn a knob or move a fader | it moves the control CC1 (mod wheel to the mõdFX X axis) or CC11 (chord level) is set to by default |
| 4.6 | **Map controls** (Settings > MIDI & keyboard, or the transport sheet): tap a slider, move a knob | the badge shows the CC; the knob now moves that slider; it ignores the knob until it reaches the slider's current value (pickup) |
| 4.7 | Map: tap **Hold**, press a key | Hold toggles from then on; the key does not also play a chord |
| 4.8 | Map: tap a **chord pad**, press a key | the key plays that pad; held while you hold the key |
| 4.9 | Long-press a mapped control (or tap its badge) | cleared |
| 4.10 | Close and reopen the app | the bindings are still there |
| 4.11 | Settings > MIDI & keyboard & keyboard > MIDI out: pick the keyboard as a destination | a note on the app reaches the keyboard's sound (if it has one) |

## 5. Native sound, the bounce and the clock (4.9.9.9.9.8.x)

The chord part (and the arp, if you set it) is played by the C++ engine. These
are the open questions from the notes.

| # | do | you should see |
|---|---|---|
| 5.1 | Play chords with the drums running | the chord sits with the drums, not ahead of them |
| 5.2 | Move the chord part's mixer fader, mute and solo it | the level follows; mute is silent; no zipper noise on a fader move |
| 5.3 | Settings > Look & feel > Copy diagnostics, with chords playing | the native block has `dropped`, `refused` and `failed` at 0, a block load (should be well under 50%) and the slowest block times |
| 5.4 | Drive the mõdFX pad on the chord part: Filter, Delay, Reverb, Audio Gate patterns | each audibly does what it says; Audio Gate gives the rhythmic chop at the song's tempo |
| 5.5 | **Bounce with Stems on** for about two minutes with chords, drums, bass and melody playing, then stop | you get a mix `.wav`, a `.mid`, one stem per part, **and a `-capture-report.txt`** |
| 5.6 | AirDrop or share the bounce to the Mac and run `python3 -I tests/stems/bounce-check.py "<the zip or folder>" --by-time` | each part's offset against the `.mid`. **The native chord reads within about a millisecond of the grid** (every bounce so far, once the checker was fixed in 9w); the web parts sit within a few ms to +19 (a kick or a soft attack reads late). A part pinned at exactly -80.0 is a stem that never goes quiet, not an offset. Send the output only if the chord is off by more than 5 ms |
| 5.7 | Listen to the bounced mix | the chord is as loud as it was live, and not clipped |
| 5.8 | A loud passage: all parts on, Space and Drive up | no crackle or dropout. If there is, copy diagnostics straight away |

### Leaving the app (superseded by sections 14 and 15)

The Settings switch named in 5.9 is gone and leaving now pauses; 5.9 to 5.11 are kept for the record. Section 15 is the background test.

| # | do | you should see |
|---|---|---|
| 5.9 | Play, press Home | music keeps going (Settings > "Keep playing in background" is ON) |
| 5.10 | Same with a **sampled** voice (flute, violin) on the melody | **known to go silent**; say whether it does, and for how long |
| 5.11 | Come back | timing loose for a second at most |

## 6. Packs and purchase (4.9.9.9.9.9.7)

StoreKit 2, seven packs and a bundle, written but never compiled or run. Needs the
StoreKit configuration file for test purchases without a store account (steps in
`docs/app-store.md`, "Testing in Xcode"). The **Test as** row in Settings > Help & about works
without it.

| # | do | you should see |
|---|---|---|
| 6.1 | Test as **Free** | locks appear: the recorded voices, the other scales, kits past Digital 1 and Analog 1, steps over 16, extended chords, the Aux switch |
| 6.2 | Free: a fresh start | chords on **Saw**, drums on Digital 1, bass on Upright, the Aux off, none of them locked |
| 6.3 | Free: tap a locked drum kit | one sheet: "… is part of the Groove Pack." with **Unlock Groove Pack** at the store's price, **Full Studio** under it, Restore Purchases, All packs |
| 6.4 | Free: export a 40 s song as audio | the file is 30 s, the last 2 s fade out with no click, and a message says so; a song under 30 s is unchanged, with no fade |
| 6.4a | Free: tap a sampler pad three times | the pad is dimmed with a padlock; it plays its sample softly the first two times (each with the "Sampler" toast), the third only opens the sheet; with a Bounce running, a pad plays nothing and opens the sheet, and the take has no pad in it |
| 6.4b | Free: tap a locked drum kit, then **Hear it** | the song pauses and an 8-bar demo plays (the tapped kit first, then a world groove and a 7/8 bar); **Stop**, or closing the sheet, ends it and the song is as it was (running again if it was running); no crackle on stop; the button is off while a Bounce runs |
| 6.4c | Free: open a chord Voice list and tap a locked voice (Organ, Electric Piano, Pad, Piano (synth); Vibes and the two vintage basses under Samples) three times | the chord (the root, for a bass) sounds softly the first two times, each with the pack toast, and the list stays open; the third opens the sheet; the part's voice never changes; with a Bounce running it only opens the sheet |
| 6.5 | Free: open a `.modriff.json` made with several packs | it opens, plays stand-ins, and one banner names the packs; saving again keeps the originals |
| 6.6 | Test as a single pack (say **Theory**) | only that pack's locks open; every other lock stays |
| 6.7 | Test as **Everything** | everything unlocks without a relaunch |
| 6.8 | With the StoreKit file: tap a lock, buy that pack | it unlocks, the sheet closes, no relaunch |
| 6.9 | Then tap another lock | the offer is now **Complete Your Studio**, names what you own, and the price is the one-pack upgrade; buy a second and a third and the price changes |
| 6.10 | Settings > Packs & purchases > **Store** | seven packs, each with its contents; owned ones ticked; the bundle offer on top |
| 6.11 | Buy, then airplane mode, then force-quit and reopen | still owned |
| 6.12 | Delete the app, reinstall, **Restore Purchases** | every pack back |
| 6.13 | Debug > StoreKit > Manage Transactions: refund a pack | that pack locks again on the next launch, and the offer recalculates |
| 6.14 | Ask to Buy | pending, then approved |
| 6.15 | Free: import a four-song iReal playlist | one chart arrives and the toast says a whole playlist is part of the Practice & Perform Pack |

## 7. The older iPad (stress test, not a target)

The iPad Air 2 can run iPadOS 15, the app's minimum. The original Air stops at
iOS 12 and cannot. Whether the current Xcode will still install to it is itself a
result worth writing down.

| # | do | you should see |
|---|---|---|
| 7.1 | Install the same Debug build | installs, or an error: copy the error |
| 7.2 | Play chords (native) with drums running | the diagnostics' block load: how high, and whether `dropped` is above 0 |
| 7.3 | Add the arp as a second native part | the same numbers; this is the "which parts can be native" measurement |
| 7.4 | Turn up Space and Drive, play for a minute | any crackle? |

Whatever it manages is the floor. It says how many native parts fit; it does
not say the app has to run well there.

## 8. Key colours, the master EQ, iCloud (4.9.9.9.9.8.9o to 9q)

| # | do | you should see |
|---|---|---|
| 8.1 | Settings > Look & feel > Key colours, pick **Circle of fifths** | the twelve swatches re-order; keys a fifth apart are neighbours in colour; the whole app's accent follows the key you are in |
| 8.2 | "Red is" > A | A is red, B♭ orange, round the wheel; the page colour changes with it |
| 8.3 | Force-quit and reopen | the choice is kept |
| 8.4 | Settings > Packs & purchases > Test as **Free** | **Red is** still works; **Circle of fifths** is dimmed and says it is the Theory Pack's, the app plays the chromatic colours; turn Theory back on and your choice returns |
| 8.4a | Settings > Master tune > **Chord intervals** > Pure (Theory Pack held), then play a C major chord with a pad or organ voice and the bass on Follow | the held third stops beating; it should sound steadier and "locked" against Equal. Check bass and melody on the same chord too |
| 8.4b | Settings > Packs & purchases > Test as **Free**; look at Chord intervals | **Pure** is dimmed and names the Theory Pack; everything plays equal; turn Theory back on and Pure returns without choosing it again |
| 8.5 | Mixer > **EQ** on the master strip | a panel with Low, Mid, Mid at, High; the button lights once anything is off flat |
| 8.6 | Play something with bass and cymbals; drag Low up and High down | the bass swells and the top softens, smoothly, no zipper noise; **Flat** puts it back |
| 8.7 | Master EQ with the chord part native (and again with drums/bass on web) | the EQ moves **everything**, the native chord included, and a +12 dB boost does not clip (the limiter is after it) |
| 8.8 | Bounce with an EQ set | the file has the EQ in it |
| 8.8a | Mixer: tap **EQ** under M and S on the Bass strip, boost Low | only the bass gets heavier; the button lights; the master EQ is a separate button on the master strip |
| 8.8b | The same on the chord part (it is the native one) | the chord part changes, with its mõdFX pad moving filters on top of it; flattening it gives back the original sound |
| 8.8c | Put an EQ on a part, save a Setup, change the EQ, load the Setup | the part's EQ comes back |
| 8.9 | Settings > iCloud & backup | "iCloud sync: OFF" with a line saying nothing leaves the device. **If the iCloud capability is not on in this build** it will say it is not enabled when you turn it on, and that is the right answer; skip 8.10 to 8.14 |
| 8.10 | (capability on, two devices, one Apple ID) turn sync on at both | "Synced just now" on both |
| 8.11 | Save a setup on device 1 | it is on device 2 within a few seconds of opening the app, or after the next 5-minute check |
| 8.12 | Delete a song on device 2 | it is gone from device 1 and stays gone |
| 8.13 | Edit the same song on both, device 2 last | device 2's version wins on both; nothing is duplicated |
| 8.14 | Airplane mode, make a change, turn it off | it goes up on its own, and the line says "waiting" while it cannot |

## 9. The rhythm and live-page batch (4.9.9.9.9.9.6 to 6m)

None of this touches the native engine; it is touch, layout and the clock, which a
desktop browser cannot judge. These were built at 4.9.9.9.9.9.6 to 6m; the footer now says 6.0t.

| # | do | you should see |
|---|---|---|
| 9.1 | Settings > Starter patterns, tap one of the pickers; Song > Build, tap a chord name field | the page does **not** zoom in when the field takes focus, and is back to normal after |
| 9.2 | Play, two fingers on two chord pads or two melody keys at once | a chord, not a page zoom; pinching bare text or the page background still zooms |
| 9.3 | Studio > Drums, load a six-sound kit onto the pads, then switch the sampler to a preset bank | six pads for the kit, twelve for the bank; each pad keeps its own sound and number |
| 9.4 | Live > Melody (mode on the Voice sheet says **Auto**): play single notes one after another, then two keys at once, then up to eight | single notes slide into each other (a bigger leap slides longer); two or more keys play together without a slide; a ninth key lets the oldest go |
| 9.5 | **Glide** on the strip's row | slides stop and start; it is dimmed in Poly. The same switch is on Studio > Melody. With Mode on **Poly**, tap Glide: it lights **and the Mode goes back to Auto** (it used to change a hidden setting and show nothing) |
| 9.6 | Studio > Melody, tap a second row on a lit step of the roll | the step becomes a chord; tap a chord note to take it away; Play: the chord sounds together |
| 9.7 | Switch **Bass**, **Mel** and **Drums** (off then on) on the transport over empty parts | a funk bass line, a pop hook, a 4/4 beat. Settings > Starter patterns changes which |
| 9.8 | Play (Live): scroll down | Chords, Melody, Styles, Sampler, mõdFX, Drum grid, **Aux grid**, Bass grid, Melody grid, Endings, each under the last;  |
| 9.9 | Styles widget: tap a style's name for the list, or the arrows to step; Saved patterns › Save… asks which part (a part with nothing on it is greyed), then a name | the style changes and the part switches on; the saved pattern appears in that part's list under Saved by you, and in Open |
| 9.10 | Aux grid: tap cells (off, on, accent), pick A2 and change it, pick A1; start the beat and pick A2 | each pattern comes back as it was; a pick while playing waits for the loop; the kit is untouched |
| 9.11 | Chords: Rhythm bar, switch it on (it says Tap a chord), tap a chord | the chord plays as the rhythm, on the tempo, and keeps going with **Keep playing**; with that off (**Stop on lift**) it stops when you lift; **Stop** ends it; a playing song silences the pads, but its own chords play this rhythm (see 9.13) |
| 9.12 | **Edit rhythm**: tap steps, tap a hit to select it, Accent, Ratchet, Hold, Swing, **Audition** | the roll shows what you drew, the playhead runs in time, **Save** saves it and plays the chords with it |
| 9.13 | Studio, Chords: pick **Every beat**, then play a song with a long chord and a quick change | the long chord is struck on every beat for its whole length, the quick one is cut where the next chord starts; with the rhythm **Rhythm off**, each chord is struck once a bar as before |
| 9.14 | Studio, Chords: **More chords** in the Play it line | the Borrowed & Modal and Secondary Dominants rows are shown; one touch hides both, another shows them; the choice is there after a restart; Live is unchanged |
| 9.13 | Song > Build, a chord > Rhythm > **Draw…**, **Save**, play the song | that chord plays your rhythm; the others carry on as they were |
| 9.15 | (6.9.9.9.9b) Studio > Drums, **phone held sideways**: scroll the grid so a lower row is on screen, tap an empty step | the step lights and its editor (Vel, Ratchet, Pitch, Prob, Ornament, Accent, Tuplet) is **pinned above the tab bar** in three short rows, however the grid is scrolled; tap more steps: it stays put and the grid does not jump |
| 9.16 | The same upright, with the grid scrolled so the editor would be under the tab bar and transport | the first tap on an empty step scrolls the page just far enough to bring the editor into view; later taps do not scroll |
| 9.17 | (6.9.9.9.9.1a) Phone **held sideways**, any Studio page (Drums, Bass, Melody, Chords): scroll the page down | the row of tabs (Live, Studio, Song, Sound, Settings, and on Chords the instrument tabs beside them) folds away and the page gets its height; the transport stays. Scroll up a little, reach the top, or tap the small **^** tab above the transport: the tabs come back. Upright, the bars never fold |
| 9.18 | (6.9.9.9.9.8) Studio > Chords, upright and sideways | **Chords | Melody | Sampler | FX** is the first line of the page and scrolls away with it; nothing sits above the transport but the five tabs (sideways they have the whole width); each of the four still switches the page |
| 9.19 | (6.9.9.9.9.8) Live, foot of Chords, Melody, Sampler and mõdFX: the **All … controls** line | shut, Live is as it was; pressed, the widget opens every control its Studio page has: Chords the variants, More chords, Rhythm builder and the Chord Voice panel (with its **octave**); Melody Touch Mod's four modes, depth and speed; Sampler the pad editor (trim, clear, undo, pattern length, pitch, play modes, mute groups, sends); mõdFX the part routing and the per-part readouts. The choice is there after a restart. Sound shaping is in the **Voice** picker's menu as before |
| 9.14 | Saved patterns (Open): save a drum, bass and melody pattern, change them, load them back | each comes back exactly; the sound and the Aux layer do not change |

## 10. Native sound: the dress rehearsal for the flip

The flip makes the C++ engine play every part and deletes the Web Audio path. It is
one commit and cannot be undone part by part, so it waits for this section. Since 6.1d
**Settings > Look & feel > Native sound** is on by default in the iPhone app (a stored
choice, either way, is kept): this section is the check that it deserves to stay on, and the
Web Audio path stays until it passes. Turning it on takes effect at once; turning it off
needs a restart.
Use a Debug build from `npm run ios:device` (it is built optimised; a plain Xcode
Debug run is 10 times slower and tells you nothing).

| # | do | you should see |
|---|---|---|
| 10.1 | Turn **Native sound** on | the toast says it is on; the status line under the switch counts notes sent |
| 10.2 | Play all eight parts at once for two minutes: chords, melody, melody seq, bass, arp, drums, Aux, sampler | the status line starts with **Clean.**: 0 fell back, 0 dropped, 0 late edits, 0 missed blocks, and the load well under 50% |
| 10.3 | Look at the block size on the status line | about 240 frames (5 ms). If it says 1,100 something reset the audio session |
| 10.4 | Mixer: faders, mute, solo, pan on every part | each part follows; no zipper noise; the master meter moves |
| 10.5 | mõdFX pad on each part, then EQ on a part | as in 5.4 and 8.8a, on parts that were web before |
| 10.6 | Sampler: record from the mic (iOS asks the first time), then play the clip on a pad | the take is heard on the pad; Native sound does not break the mic |
| 10.7 | A **recorded** voice (piano, flute, violin, upright bass) on the melody | plays; it is the one most likely to fall back, so read the *fell back* count |
| 10.8 | Bounce with Stems on, then `bounce-check.py --by-time` as in 5.6 | every part has a stem; offsets within a few ms of the `.mid` |
| 10.9 | Play, press Home, come back | as 5.9 to 5.11, but with every part native: say which parts go quiet and for how long |
| 10.10 | Settings > Look & feel > **Copy diagnostics** after 10.2 | send it whatever the status line says |
| 10.11 | **Screen stays on (6.0p, needs the new ModWake plugin, so a fresh `npm run ios:device`).** Xcode's console on launch | `[ModWake] plugin registered`, and `ModWake` in the list `[ModRiff] capacitorDidLoad` prints |
| 10.12 | Start a loop and leave the phone untouched past its auto-lock time (30 s or 1 min) | the screen does not dim or lock while it plays; stop it and the phone locks on its usual timer |
| 10.13 | Open **Stage** (Song > Perform > Stage) with nothing playing, leave it past the auto-lock time | the screen stays on; leave Stage and it locks again on its usual timer |
| 10.14 | Start a loop, press Home, wait a minute, come back | the phone locked as normal while the app was away; back in the app 10.12 holds again |
| 10.15 | Settings › Interface › Audio buffer: pick 10 ms, play a busy loop for five minutes with Native sound on, then read the status line under Native sound | the line ends `blocks of 480 frames` (or close: iOS rounds the request) and `blocks missed their deadline` is 0, or far fewer than at 5 ms. Needs the build rebuilt on the Mac: the buffer is set by a new `setBuffer` method on the plugin, unbuilt until then. |

**The decision this gives:** if 10.2, 10.7 and 10.9 are clean, the flip can ship as
"Native sound on by default, the switch kept for a release". If a part falls back or
drops, send its name and the diagnostics; that part is what is left to do.

## 11. Things that are just worth noticing

- The splash, the first launch, the permission prompts (microphone for the
  sampler, camera for chord sheets, Bluetooth only when you press its button).
- Anything that looks like the web version of a thing the app should do natively.
- Anything slower than it was on 4.9.9.9.9.8.7.

## What to send back

One message is enough: the item numbers that are **wrong** or **skipped**, the
diagnostics from any that misbehaved, the `bounce-check.py` output and capture
report for 5.6, and screenshots for 3.1 to 3.3. "All ok except 3.3 and 5.10" is
a complete answer.

## 12. 6.2: the Studio pages

| # | do | you should see |
|---|---|---|
| 12.1 | Studio › Drums | Pick, Kit / Aux, a Draw | Play in switch, then the grid with Steps, Rate and Swing under it; Play in shows one Start recording button |
| 12.2 | Studio › Arp | Arp pattern and Patch boxes at the top (each opens a list and changes the real control), the preview, then Range, Timing, Rate motion |
| 12.3 | Studio › Chords › the rhythm roll: Tap › Length, then tap a lit step | the step holds through the next 2, 3, 4… steps; Swing › Own with the slider; Start from › a built-in rhythm; Clear |
| 12.4 | Sampler: hold ✕ Clear with a pattern that has hits on one pad | that pad is red, pads with only a sample are amber, empty pads dim |

## 13. The Dynamic Island light while bouncing (6.8, unbuilt; the light and clock changed in 6.9.9.9.9.9.9, see section 31)

Needs the widget extension added once in Xcode: `docs/dynamic-island.md` has the steps and the nine checks.

## 14. Leaving the app goes quiet (6.9.3, heard on device: all pass)

The native engine now fades out and pauses itself the moment the app goes to the background, without waiting for the page (which iOS throttles at that moment). Coming back restarts it. On the Mac simulator the logs showed the fade and pause on leaving and the restart on return; what the speaker did was checked on an iPhone 17 Pro Max: 14.1 to 14.4 all passed.

| # | do | you should see |
|---|---|---|
| 14.1 | Play a loop with chords, drums and bass, press Home | it goes quiet at once: no sputter, no spit, no half the band left playing |
| 14.2 | Stay away 10 seconds, then come back | it resumes (chords, drums, bass all together, on the beat), with no burst of stale notes on the way in |
| 14.3 | Repeat 14.1 and 14.2 with a sampled voice (flute or violin) on a part | same as above |
| 14.4 | Play, then open the app switcher and come back without leaving | nothing changes (the app is only inactive) |
| 14.5 | If anything is off, Settings > Copy diagnostics and look for `ModEngine` lines | send it with the item number |

## 15. The engine looks after itself, and the background test (6.9.4, not heard on device)

Two things, both Swift. The first is for everyone; the second is a test that is **off** unless you turn it on, so leaving the app pauses as in 6.9.3 until you do.

**Part A: the engine restarts itself.** Until 6.9.4 nothing restarted the native engine after iOS stopped it (a call, Siri, an alarm, another app taking the audio, headphones in or out, a Bluetooth speaker joining). The page restarts its own Web Audio context, which is not the engine.

| # | do | you should see |
|---|---|---|
| 15.1 | Play chords, drums and bass. Plug in wired headphones (or the Lightning/USB-C adapter), or connect and disconnect a Bluetooth speaker | a gap of a second at most, then it carries on on the new output, with no restart of the app |
| 15.2 | Play, then ring the phone from another phone (decline or let it go to voicemail), or ask Siri something and let it finish | after the call or Siri it carries on within about two seconds, or at worst you press Play once; it must not stay silent until you relaunch |
| 15.3 | Settings > Copy diagnostics after 15.1 or 15.2, look at `native.life` | lines such as `engine configuration changed`, `audio interrupted`, `interruption ended`, `engine restarted after ... (attempt 1)`; `native.restarts` is at least 1 |

**Part B: does the page keep feeding the engine while the app is away?** This is the question the architecture doc could not answer: with every part on the native engine, does the web view still run once iOS has throttled it? The test turns background play on for one run and measures.

Turn it on (Debug build, phone plugged in, Safari > Develop > the phone > mõdRïff): in the console `localStorage.setItem('modo-bgtest','1')`, then relaunch the app. Settings > Native sound must be ON (the test does nothing without it). To turn it off again: `localStorage.removeItem('modo-bgtest')` and relaunch.

| # | do | you should see |
|---|---|---|
| 15.4 | With the test on, play chords + drums + bass, press Home, wait 30 seconds | music **either** carries on **or** stops after a few seconds. Write down which, and roughly after how long |
| 15.5 | Same, but with a sampled voice (flute or violin) on the melody | does it carry on with the rest? (This is the old 7.7j dropout; with Native sound on the voice is played by the engine) |
| 15.6 | Come back, then Settings > Copy diagnostics | send it. The three blocks to look at: `native.bg` (what the engine saw: `calls` = how often the page spoke to it while away, `ticksWithCalls` of `ticks` = how many seconds had a call, `longestQuietTicks`, `mainAnswered` of `mainPings`, `audioSecs` against `secs`), `bgPage` (what the page saw: `ticks`, `maxGapMs`, `ctx` = what the web audio context was, `ticksCtxNotRunning`), and `lead` |
| 15.7 | Come back and keep playing | timing loose for a second at most, nothing doubled |
| 15.8 | With the test **off** again, press Home while playing | quiet at once, as in 14.1 (nothing changed for everyone else) |

## 16. The closed Duo's right rail (6.9.5, not heard on device; looked at in the simulator and measured in a browser)

Only the closed iPhone Duo (466 x 678 pt). Other phones, a phone on its side and the open Duo are unchanged.

| # | do | you should see |
|---|---|---|
| 16.1 | Open the app on the closed Duo, tap Start | the transport is a column down the right edge, under the clock and Wi-Fi pill: key (C over Major, two steps), tempo, a big Play, the rate chip, then Drums, Bass, Mel, Arp, Chords; the four tabs and Settings run along the bottom on the left |
| 16.2 | Look at the Live page | it is narrower (374 pt) and taller; the Chords and Melody headings are each on one line; "Keep playing" fits its button |
| 16.3 | Tap Play, then each part | same as before the change: they sound and light the same; nothing sits under the pill |
| 16.4 | Go to Studio | the part tabs (Chords, Melody, Sampler, FX) sit above the bottom tabs and stop at the rail |
| 16.5 | Open the Duo fully (upright) | the old bottom stack, as before |

## 17. The open Duo, wide: rail, top transport, Live beside a part (6.9.6, not heard on device)

Only the open iPhone Duo held wide (951 x 669 pt). The closed Duo (section 16), the open Duo held upright, other phones, a phone on its side and an iPad are unchanged.

| # | do | you should see |
|---|---|---|
| 17.1 | Open the Duo, hold it wide, tap Start | a rail down the left edge: Live, Studio, Song, Sound, Settings at the top and Drums, Bass, Mel, Arp, Chords at the foot; the transport across the top (key, tempo, Play, rate, Song) clear of the clock and Wi-Fi pill |
| 17.2 | Look at Live | Live on the left, and on the right a part's page (Drums to begin with) under a row Drums / Bass / Melody / Arp |
| 17.3 | Tap Bass in the row, then Melody, then Arp | the right page changes each time; Live does not move; the part switch in the rail for the open page is ringed |
| 17.4 | Hold Bass in the rail (about a third of a second) | the right page becomes Bass; you stay in Live |
| 17.5 | Tap Bass (a short tap) | the bass switches on or off and nothing else changes; a one-time hint says tap switches, hold opens |
| 17.6 | Scroll Live, then scroll the right page | each scrolls on its own |
| 17.7 | Play, and keep the band running while you change the right page | the beat does not stutter; the beat strip under the transport keeps moving |
| 17.8 | Studio, Song, Sound, Settings in turn | one page the width of the screen each, under the transport; Studio's Chords / Melody / Sampler / FX row sits under the transport |
| 17.9 | Turn the Duo upright, then wide again | upright is the old bottom stack; wide comes back with the rail and both panes, the right page drawn properly (not blank, not squashed) |


## 18. Native scheduling, slice 1 (6.9.7 to 6.9.9.9; the developer entry can make sound)

The native drum-grid core is proven on a Mac against the page (`tests/seq/drumgrid.test.js`), and from 6.9.8 the host steps it on its own thread (`native/modsynth/seqhosttest`). Nothing in the app calls it except a developer function, and no audio path exists yet, so 18.1 is the regression check and 18.2 is for the inspector.

| # | do | you should see |
|---|---|---|
| 18.1 | Settings > Help & about, then play a beat with the drums, bass and chords on | it says **v6.9.9.9**, and everything sounds and times exactly as it did at 6.9.6 (the only app change is functions that nothing calls) |
| 18.2 | Connect the phone to Safari's web inspector (or use the simulator), play nothing, and in the console run `_nsDrum.start()` then `_nsDrum.mirror()` a few times a second apart | `steps` and `events` climb, `step` cycles 0 to 15, `late` stays 0; nothing is heard. Then freeze the page: `var t=Date.now(); while(Date.now()-t<3000){}`, and `_nsDrum.mirror()` straight after: `steps` rose by about 12 (4 a second at 120 BPM) while the page was frozen, `late` still 0. `_nsDrum.stop()` ends it. (Leaving the app is not part of this: the engine is silenced on leaving, section 14, until the cutover turns background play on.) |
| 18.3 | Settings > Native sound **ON**, a drum pattern with kick, snare and hats on the Drums page (Analog 1 or Analog 2), Drums fader up, and in the inspector console: `_nsDrum.start()` (let the page's own transport stay stopped) | it answers `{ok:true, bank:{built:8+...}}`; **the drums play from the engine alone**, on the beat of the tempo field, with the pattern you see; `_nsDrum.mirror()` shows `hits` climbing, `misses` 0, `late` 0, `lateStarts` 0 |
| 18.4 | While it plays: change a cell on the grid, then run `_nsDrum.sync()`; move the Drums fader, then run `_nsDrum.prepare()` | the change is heard at the next step; after the fader move the level is the new one (the lanes are recorded again) |
| 18.5 | Freeze the page for 3 s as in 18.2 while it plays | the beat does not stutter or stop; it was the engine playing |
| 18.6 | Compare against the page's own drums: stop `_nsDrum`, start the page's Play with the same pattern | same sounds, same levels and accents, same pitch of tuned lanes |
| 18.7 | A pattern with an open hat followed a few steps later by a closed (or pedal) hat, `_nsDrum.start()` as in 18.3 | the closed hat shuts the open one, as it does on the page's own transport (the open hat ends at the closed hat's step instead of ringing through it); `_nsDrum.mirror()` shows `cuts` climbing by one for each open hat that was shut. An open hat with nothing after it rings its full length |

Still to come (chokes, then the cutover): leave the app mid-beat and the drums continue on the beat, no burst or gap; Copy diagnostics shows a `native.sched` block with steps fired and bank hits/misses.

## 19. The bass line (6.9.9.7 and 6.9.9.8; the engine's bass is audible through a developer entry only)

The engine's bass voice bank and the cut of the note before are tested on a Mac against the page. From 6.9.8 the host runs the bass on its own
thread; the page has no button for it, only `_nsBass` in the web inspector (like `_nsDrum`, section 18). First, one thing worth a listen on the
page's own bass, because the measurement points at it:

| # | do | you should see |
|---|---|---|
| 19.1 | Bass on, a staccato line (every step a note, a short length), Follow on, headphones | at the start of each note, no short louder bump under the attack. If there is one, it is the page's cut of the previous note (`_webBassVoice`: `cancelScheduledValues`, then a fade from the gain's current value, which is 1 when the note has not begun) and it is old; the engine's version does not have it |
| 19.2 | Native sound **ON**, a bass line on the Bass page (any synthesized voice: Sub, Tri, Sqr, Acid, 303, Electric, Upright), drums on the Drums page, Follow on over a chart if you like. In the inspector console: `_nsDrum.start()` then `_nsBass.start()` (the page's own transport stays stopped) | both answer `{ok:true}`; **the drums and the bass play from the engine alone**, on the same beat and bar line, at the tempo field; the bass follows the chart you had on the clock; `_nsBass.mirror()` shows `hits` climbing, `misses` 0, `refused` 0, `lateStarts` 0, `cuts` climbing on notes that run into the next |
| 19.3 | While they play: freeze the page for 3 s (`var t=Date.now(); while(Date.now()-t<3000){}`) | neither the beat nor the bass stutters or stops |
| 19.4 | Compare against the page's own bass: `_nsBass.stop()`, play the page's Bass with the same line | the same notes at the same moments, the same levels, accents and slides (the glide into the next note), the same length. Differences you may hear: no bump at the start of notes (19.1) and no randomness in the voice's detune. A sampled voice (Upright 1/2, Picked, Motown, Höfner...) says it cannot be played: `_nsBass.start()` resolves `{ok:false, why}` |
| 19.5 | Bass style **Jazz** with Follow on and a chord chart (the song page, a few chords of a standard) on the clock, drums on; `_nsDrum.start()` then `_nsBass.start()` as in 19.2 | a walking line: a quarter note on every beat (half notes on 1 and 3 in the two-feel), beat 1 of each chord on the chord's root (the slash note over a slash chord), the beat before a change leading into the next root, landing on the drums' beat. Not the same notes as the page's walk (it picks at random), but the same kind of line. `_nsBass.mirror()`: `hits` climbing, `misses` 0 |
| 19.6 | (6.9.9.9.7) A chart with a chord that has a locked bass phrase (freeze the bass over one chord in the chart's chord editor), Follow on, then 19.2 and again with Jazz as in 19.5 | `_nsBass.start()` answers `{ok:true}` (it used to say it could not play a locked phrase); over that chord the bass plays the frozen figure from the chord's downbeat, the same pitches as the page's, in the capo's key if you transposed the song; the other chords play the bar re-rooted (or the walk). Under Jazz the locked chord plays its figure, not the walk, even in the two-feel |
| 19.7 | (6.9.9.9.9.1) Bass **Follow off**, Sync on, a chart of a few chords on the clock with the drums, the bass engine running (19.2). Then in the console, as the first chord plays: `_blPregen(7, [0,4,7], <the second chord's start>)` is what the page does itself; with a person: press Generate on the Bass page while it plays and call `_nsBass.sync()` right after | `sync` answers; the new line does not cut in mid-bar: it takes over at the top of the loop (Generate) or on the chord's first step (a line written ahead), and the old line plays until then. `_nsBass.mirror()` keeps counting; nothing stutters |

## 20. Drum hits start on the beat (6.9.9.9a, not heard on device)

Every one-shot drum is cut at its first audible sample as it is loaded (`_hitTrimmed`), so the Hip-Hop and Rock kits' 5 ms pad, the odd file
that opens 6-9 ms late, and an mp3 encoder delay the device's decoder may not remove (30 ms on the Hip-Hop kick if it does not) no longer
put the groove behind the beat. Measured in a browser on all 567 drum files (`node tests/drums/lead.test.js`); what only the phone tells us is
whether Safari's decoder was adding the 25 ms, which is the part this checklist is for.

| # | do | you should see |
|---|---|---|
| 20.1 | Drums on, kit **Hip-Hop**, the **Boom Bap** groove at about 90 BPM, a hat on every step, headphones | the kick lands with the hat at the top of each bar; it no longer sits behind it. If you could hear the kick trailing before, say so: that was the device keeping the encoder delay |
| 20.2 | The same on the **Rock** kit (kick, snare, hat) | kick and snare tight with the hat, nothing clipped at the front of the snare or the tom |
| 20.3 | Sampler > Drums > **Hip-Hop Kick**, tap a pad over a metronome click or the drums on the same grid | the pad hit is on the click, not after it |
| 20.4 | A shaker or a soft hat, any recorded kit, at a low velocity | the hit still has its soft front; nothing sounds cut off or clicks at the start |

## 21. Voice | Pattern as one widget, and the tiered sound browser (6.9.9.9.1 and 6.9.9.9.2; looked at in a browser at phone width, not tried with a thumb on a device)

| # | do | you should see |
|---|---|---|
| 21.1 | Studio, Drums, then Bass, Melody Seq and Arp in turn | at the head of each page **one** framed box in the part's colour, split down the middle: **Kit / Voice on the left, the pattern (Groove, Bass line, Melody line, Arp pattern) on the right**. The same side on all four pages. Both halves are at least 44 pt tall and a thumb reaches either |
| 21.2 | Tap the left half on Bass | a list of three tiers, in this order: **Samples**, **mõdSynth**, **Free voices**, each with a count; the one you are playing is lit and its name is at the top |
| 21.3 | As an owner: mõdSynth, then Bass | sound types (Bass first on Bass, Lead first on Melody Seq, Pluck first on Arp), each with a count; inside a type, **Modern** and **Classic** patches under their own headings. Tap one: the list shuts and the left half names the patch, with "mõdSynth · Bass" under it |
| 21.4 | Samples | the recorded instruments by family (Keys, Mallets, Guitars, Winds & strings, Basses, Your own). Tap Vibes or Upright 1: it is the part's voice at once |
| 21.5 | Test as **Free** | Samples is still the first tier, with its locked rows marked; mõdSynth shows a lock and "mõdSynth Engine", and a tap on it opens the Pro sheet |
| 21.6 | The Play (Live) page: the Chords voice button, and the Melody one | the same browser; Keys first for Chords, Lead first for Melody. A pick shuts it and the button names the voice |
| 21.7 | Settings > Sound > Voices, and any dropdown that lists voices | Samples is the first group, then mõdSynth, then Free voices |
| 21.8 | Open the list, tap into a type, then tap outside it and scroll the page | it closes on the outside tap, and a long type (Vintage, Modern) scrolls inside the list without moving the page behind |

## 22. Live: Voice | Pattern rows, and no rolls by default (6.9.9.9.3; looked at in a browser at 360 and 390 pt wide, not tried with a thumb)

| # | do | you should see |
|---|---|---|
| 22.1 | Live (Basic) on a fresh install, scroll to **Styles** | the rows Drums, Aux, Bass, Chords, Melody, each **Voice on the left, Pattern on the right** in one frame, under the captions Voice and Pattern. The page under it is Sampler and mõdFX; **no drum, aux, bass or melody grids** unless you add them |
| 22.2 | Tap the small **›** on a row's right-hand half, then its **‹** | the style steps as it always did (and switches the part on) |
| 22.3 | Tap the small **›** on the left half of Bass, then **‹** | the sound steps to the next / previous in the same type (Bass patches stay Bass patches), and the name follows. Drums and Aux step their own kit, skipping locked ones |
| 22.4 | Tap the **name** in a left half | Drums and Aux: the kit list (Aux opens on Percussion & world). Bass and Melody: the sound browser, Samples first. A pick shuts it and the row shows the name |
| 22.5 | Tap the name in a right half | the style list, as before |
| 22.6 | Each caret with a thumb | hits first time: they look 24 pt wide but are 44 pt to touch; the name is still easy to hit between them |
| 22.8 | (6.9.9.9.9a) The Styles widget's **Chords** row (between Bass and Melody): tap **›** on the right half, then **‹** twice; tap the right-hand name | the pattern steps Off, Once a bar, Beats 1 & 3 … and any rhythm you saved; the first step arms the chord rhythm (the Rhythm bar under the Chords widget names the same one), **Off** disarms it; the name opens the same list as Rhythm |
| 22.9 | The same row, **›** on the left half, then the name | the chord voice steps (Piano, Electric Piano …) and the Chords heading's sound picker follows; the name opens the sound browser, Samples first |
| 22.7 | Add / reorder widgets > Drum grid, Bass grid | they can be added and stay there after a relaunch. A layout you saved before this version is not touched |

## 22. The chord comp in the engine (6.9.9.9.4 to 6.9.9.9.6; audible through a developer entry only)

The engine composes a chord from a bank of one-note chords, stops the chord before it, and from 6.9.9.9.5 the host runs a chord rhythm on its own thread. The page has no button for it, only `_nsChord` in the web inspector (like `_nsDrum` and `_nsBass`, sections 18 and 19).

| # | do | you should see |
|---|---|---|
| 22.1 | Native sound **ON**, a synthesized chord voice (not a sampled one), Chords on, a chord tapped on the pads and a built-in rhythm (Strum) selected; in the inspector console: `_nsDrum.start()` then `_nsChord.start()` (the page's own transport stays stopped) | both answer `{ok:true}`; **the drums and the chord rhythm play from the engine alone**, on the same bar line, at the tempo field; each hit is the chord you tapped, with the Strum and Width settings you have; `_nsChord.mirror()` shows `hits` climbing, `misses` 0, `refused` 0, `stops` climbing |
| 22.2 | While it plays: freeze the page for 3 s (`var t=Date.now(); while(Date.now()-t<3000){}`) | the chord rhythm does not stutter or stop |
| 22.3 | Compare against the page's own: `_nsChord.stop()`, play the same rhythm on the page | same chord, same hits, levels and swing. You may hear: the same voicing on every hit (the page re-voices with Vary); a sampled chord voice says it cannot be played (`{ok:false, why}`) |
| 22.4 | (6.9.9.9.6) Draw a rhythm on the chord roll with a held step (Hold) and a ratcheted step (Ratchet), `_nsChord.stop()`, `_nsChord.start()` | it starts (it said it could not before); the held step rings its full length and lets go on the Release knob without a click, the ratchet's strikes are short and the last one rings out; the same as the page's own for this rhythm. Watch `_nsChord.mirror()`: `releases` climbs with the held strikes, `misses` 0, `refused` 0 |

## 23. The engine's tempo map (6.9.9.9.9.2; audible through a developer entry only)

The drums, the bass and the chord rhythm of the engine now read one tempo map, and the engine can move the tempo itself. The page has no button for the ramp, only `_nsDrum.tempoRamp(bpm, ms)` in the web inspector.

| # | do | you should see |
|---|---|---|
| 23.1 | Native sound **ON**, a drum pattern, a bass line and a chord rhythm as in 18.x, 19.2 and 22.1; `_nsDrum.start()`, `_nsBass.start()`, `_nsChord.start()` | all three play from the engine on the same bar line |
| 23.2 | While they play, `_nsDrum.tempoRamp(70, 8000)` | all three slow together over eight seconds and settle at 70; they stay on the same bar line the whole way (no flam between the bass and the drums, no drift); `_nsDrum.mirror()` shows `tempo` falling |
| 23.3 | Then `_nsDrum.tempoRamp(130, 4000)`, and a jump: change the tempo field | the same, speeding up; a jump from the field lands on the next step with no hiccup |
| 23.4 | Freeze the page for 3 s (`var t=Date.now(); while(Date.now()-t<3000){}`) during a ramp | the ramp carries on, the three stay together |

## 24. The engine steps the song (6.9.9.9.9.4; audible through a developer entry only)

The engine now walks the song's chords by the drums' bar lines and gives the bass its chord windows. The chords themselves still sound from the page (piece 3 moves them), so what you hear from the engine is the drums and the bass following the engine's chart.

| # | do | you should see |
|---|---|---|
| 24.1 | Native sound **ON**, a song of a few chords on the Songs page, the bass on Follow (Jazz walks, others re-root), the page's Song transport stopped. Console: `_nsDrum.start()`, `_nsBass.start()`, then `_nsSong.start()` | all answer `{ok:true}`; the bass changes chord on the drums' bar line, through the whole chart and round again; `_nsSong.mirror()` shows `chords` climbing, `section` and `slot` moving |
| 24.2 | A chart with chords of different lengths (a bar, two beats, an eighth or two) | the bass follows each chord for its length; after a half-bar chord the next chord starts on the next bar line |
| 24.3 | While it plays: `_nsSong.move(1)` | the section changes at the end of the pass, not at once |
| 24.4 | Freeze the page for 3 s during it | the bass keeps changing chord on the bar lines |
| 24.5 | `_nsSong.capo(2)` | from the next chord the bass plays two semitones up |

## 25. The engine plays the song's chords (6.9.9.9.9.7; audible through a developer entry only)

The engine now voices and strikes each chord of the song itself (the voicing, the capo, held or decaying), as well as stepping it. The comp's re-strikes are still the page's (piece 4), so a chord with a rhythm sounds once, at its start.

| # | do | you should see / hear |
|---|---|---|
| 25.1 | Native sound **ON**, chord voice a synthesised one (not a sampled or mõdSynth one), a song of a few chords on the Songs page, comp "Hold" (sustain), the page's Song transport stopped. Console: `_nsDrum.start()`, `_nsBass.start()`, `_nsSong.start()` | `{ok:true}` and a `bank` report (`built`, `failed: []`); the chords change on the drums' bar lines and sound like the page's own for the same song (same notes, same top voice); `_nsSong.mirror()` shows `voiced` climbing, `misses` and `refused` 0 |
| 25.2 | A rest in the song | the chord is cut at the rest, drums and bass go on |
| 25.3 | Voicing set to Drop 2, Soul, Neo-soul, Spread, then Vary on, and `_nsSong.start()` again each time | the chords voice that way; with Vary the same chord comes back in a different grip each pass |
| 25.4 | A slash chord (C/E) | the E is the lowest note of the chord, as on the page |
| 25.5 | A chord set to "As played" with a ring of two beats, and one with a tap | the first is held for two beats and fades on the Release knob; the second rings out and decays |
| 25.6 | `_nsSong.capo(2)` | from the next chord everything is two semitones up, and there is no gap (the bank was topped up first) |
| 25.7 | `_nsSong.stop()` while a chord is held | the chord is cut within a few tens of milliseconds |
| 25.8 | Freeze the page for 3 s | chords, bass and drums keep going |
| 25.9 | Pick a sampled chord voice (Vibes, Jazz Gtr, Nylon) or turn on Pure tuning or Glide, then `_nsSong.start()` | the result's `chordWhy` names it and the engine only steps; the chords stay the page's |

## 26. The engine plays the song's comping (6.9.9.9.9.9; audible through a developer entry only)

The engine now re-strikes each chord on its rhythm as well as striking it, so a song's comping (Bossa, Every beat, a drawn rhythm) no longer needs the page.

| # | do | you should see / hear |
|---|---|---|
| 26.1 | As 25.1, with the song's comp set to Every beat, then Bossa, then a drawn rhythm with a ratchet and a gate | the chords are struck on the rhythm and sound like the page's own for the same song; `_nsSong.mirror()` shows `hits` climbing, `misses` and `refused` 0 |
| 26.2 | Chords of two bars, a half bar, a few beats | the rhythm repeats every bar of a long chord and stops where a short chord ends |
| 26.3 | Swing set to 40 with a drawn rhythm that has no swing of its own | the off-beat hits are late as on the page |
| 26.4 | A chord with Hold or As played in a song of rhythms | that chord is struck once and held, the others play their rhythm |
| 26.5 | `_nsSong.capo(2)` during a rhythm | the next hits are two semitones up with no gap |
| 26.6 | Freeze the page for 3 s | the rhythm does not drop a hit |
| 26.7 | `_nsSong.stop()` in the middle of a bar | the chord is cut and no hit follows |

## 27. The page writes the engine's bass lines (6.9.9.9.9.9.1; audible through a developer entry only)

While the engine plays a song, the page still writes the bass's line for each chord that follows (Follow off, Bass+Mel Sync on) and hands it over.

| # | do | you should see / hear |
|---|---|---|
| 27.1 | Bass on Follow **off**, a generated style (Funk), Sync on, a song of four chords; `_nsDrum.start()`, `_nsBass.start()`, `_nsSong.start()` | each chord has its own bass line from its first beat, not the line of the chord before; `_nsSong.asked` climbs, `_nsSong.lastMs` is a few ms |
| 27.2 | The same on Follow **on** | the bass transposes one line over the chords; `_nsSong.asked` stays 0 |
| 27.3 | `_nsSong.move(1)` near the end of a pass | the first chord after the section change has a line for it a moment late at worst (the peek is wrong there) |
| 27.4 | Freeze the page for 3 s | the last line keeps playing under the changing chords (no new lines until the page is back) |
| 27.5 | A song with a half-bar chord | the short chord still gets its own line |
| 27.6 | `_nsSong.answering = false`, restart | the bass plays the one line it was given |

## 28. The song screens follow the engine (6.9.9.9.9.9.4; seen through a developer entry only)

While the engine plays the song, the Songs page, the transport's song button and Stage show where it is, and the page's Next, Prev, Hold and Stop drive it.

| # | do | you should see |
|---|---|---|
| 28.1 | Songs > Perform with a song of two sections; `_nsDrum.start()`, `_nsBass.start()`, `_nsSong.start()` | the playing chord is lit as it sounds and its playhead moves across it, chord by chord, through the section and into the next; the transport's song button names the section |
| 28.2 | A section set to play 3 times, with Build open on it | the pass line counts "Pass 1 of 3", "Pass 2 of 3", "Pass 3 of 3" |
| 28.3 | Tap the transport's Next while a section plays | Next pulses until the pass ends, then the section changes and the pulse stops |
| 28.4 | Tap Hold (switch Song off) | the chord that sounds keeps sounding, the lit chord stays; the progression stops; switching Song on again picks up from that chord |
| 28.5 | Tap Stop | the chord is cut, nothing stays lit, nothing is queued |
| 28.6 | Open Stage during it | the playing line is kept a third of the way down and follows the engine |
| 28.7 | Freeze the page for 3 s and wake it | the screens catch up to the engine's chord (they were not lit while frozen) |

## 29. The practice trainer in the engine (6.9.9.9.9.9.6; audible through a developer entry only)

The engine now loops the bars you picked, counts choruses, steps the tempo and the key itself. The endings are still the page's.

| # | do | you should hear / see |
|---|---|---|
| 29.1 | Practice: Loop bars on chords 2 to 3 of a section, Speed up on (+4 every chorus to 140); `_nsDrum.start()`, `_nsBass.start()`, `_nsSong.start()` at that chord | the two chords repeat; the tempo steps up a notch on the bar line each pass, together in the drums, bass and chords; the status line counts "Loop pass 2 ..." and the tempo |
| 29.2 | Next key on (every 2 choruses, a fifth) with no loop, over two sections | after the last section's final pass twice, everything is a fifth up, at the bar line; the status line says the key |
| 29.3 | `_nsSong.stop()` | the tempo goes back to where the run began (if you had not moved it yourself); nothing stays transposed |
| 29.4 | Tap Next while a loop plays | the loop finishes its pass, then the song moves to the next section |
| 29.5 | A last section on "for ever" with Speed up | each of its passes steps the tempo |
| 29.6 | Freeze the page for 3 s during a loop | the loop and the steps go on without it |
| 29.7 | Arm an ending (Cold, Finish...) and `_nsSong.start()` | the result says the engine cannot step this song yet (an ending); the page's own loop plays it |

## 30. The endings in the engine (6.9.9.9.9.9.7; audible through a developer entry only)

Arm an ending while the engine plays the song (`_nsDrum.start()`, `_nsBass.start()`, `_nsSong.start()`): it takes effect at the end of the pass, on the downbeat.

| # | do | you should hear / see |
|---|---|---|
| 30.1 | Arm **Big Fin** | at the end of the pass the whole band lands together: kick, cymbal and snare, the tonic chord with its root an octave down, the bass's last note; the chord rings and is let go of after a bar; then silence. The groove does not play a beat of the next pass; the armed light goes out |
| 30.2 | Arm **Cold** | the final bar plays in full and everything stops dead on the downbeat after it: the hit and the chord are choked half a beat later |
| 30.3 | Arm **Tag** | the last two chords play again, then the Big Fin lands a pass later |
| 30.4 | Arm **Ritard** | the whole band slows over about two bars (stepping down to about half tempo) and lands on the next bar line with a soft hit; the tempo comes back to where it was after the stop |
| 30.5 | Arm **Fade** | the mix comes down smoothly over four bars while the changes keep going, then everything stops; the volume is back up half a second later |
| 30.6 | Arm an ending and tap it again before the pass ends | it is cancelled; the song carries on |
| 30.7 | Freeze the page for 3 s with an ending armed | the ending still lands on the downbeat |
| 30.8 | Practice trainer on (Speed up, Next key), then an ending | the landing is in the key the song started in, and the tempo is back |

## 31. More, the record ring, the Record widget, grouped styles (6.9.9.9.9.9.9, not seen on a phone)

| # | do | you should hear / see |
|---|---|---|
| 31.1 | Look at the tab row | the fifth tab says **More** with three dots; tapping it opens the same sheet (Settings is its first tile) |
| 31.2 | Look at the transport at your phone's width, with and without a song loaded | a red ring right of the 1/16 chip, nothing overlapping, nothing cut off, the key still says "Maj" whole |
| 31.3 | Tap the ring with the band playing | it goes solid red with a square and glows; a take is running |
| 31.4 | Tap it again | the files are delivered as Bounce always did (a .wav and a .mid); the ring is a ring again |
| 31.5 | Scroll Live to the **Record** widget during a take | its clock counts; tap its ring to stop |
| 31.6 | While a take runs, look at the status bar of an island phone held upright | a solid red dot left of the island and a clock to its right |
| 31.7 | Start a take and go to the Home Screen | the island shows a **bright, solid** red dot on its left and a running clock on its right (it was a faint dot); long-press opens "Bouncing" and the clock |
| 31.8 | Settings > Recording > **Always bounce stems** on, then Bounce | one .wav per part next to the mix, without touching Stems first; with it on, Stems cannot be switched off before a take |
| 31.9 | Live > Styles: tap a Pattern name (Drums, Aux, Bass, Chords, Melody) | the list opens in groups under the name, not one long column; a pick still loads it and switches the part on |
| 31.10 | Open Add / reorder widgets | there is no Voices widget; Record is there, above Endings in the standard layout |

## 32. The engine plays the arp (6.9.9.9.9.9.9.1; audible through a developer entry only)

With Native sound on, the arp on a synthesized voice (Sine, Sawtooth, Square, Supersaw, Rhodes, Pad), the page's own arp switched off while the engine's plays: `_nsDrum.start()`, `_nsBass.start()`, then `_nsSong.start()`
(it arms the arp and the engine brings it in on the song's bar line), or `_nsArp.start()` by itself after tapping a chord.

| # | do | you should hear / see |
|---|---|---|
| 32.1 | `_nsArp.start()` after tapping a chord, Up at 1/16 | the arp plays that chord on the drums' bar line, evenly; the same notes as the page's own arp played them |
| 32.2 | `_nsSong.start()` with the arp on | the arp comes in with the song's first chord and changes with every chord, including the slash chord's bass note first, on the beat |
| 32.3 | Octaves 1, 2, 3, then start again | the pattern reaches one, two and three octaves up the chord |
| 32.4 | A rest in the song | the chord part goes quiet; the arp goes on with the same chord, starting its pattern again from the bottom |
| 32.5 | Block pattern | the chord is struck whole, the tones a hair apart low to high, as the page does |
| 32.6 | Fast arp (1/32) with a short Gate, and Attack at its default and at a long setting | each note is a short blip; none is a click, louder or quieter than the page's would be |
| 32.7 | Accent gate pattern, Cresc / Hill / Valley, Bounce | the accents and the swell of the notes are as the page's |
| 32.8 | Freeze the page for 3 s (web inspector breakpoint, or leave the app on speaker) | the arp keeps its time and its notes |
| 32.9 | Arm Big Fin, Cold or Fade over the song | at the landing the arp's last notes fade out with the rest of the band and it stops; nothing keeps ringing under the final hit |
| 32.10 | Piano or Organ as the arp voice | `_nsArp.start()` says why it cannot (the program changes with the note); nothing starts |

## 33. The engine plays the melody generator (6.9.9.9.9.9.9.2; audible through a developer entry only)

With Native sound on, the melody generator (Bass/Melody tab, the step line) playing on a synthesized voice (Sine, Triangle, Square, Sawtooth, Supersaw, Pad, Rhodes), the page's own melody switched off while the
engine's plays: `_nsDrum.start()`, `_nsBass.start()`, then `_nsSong.start()` (it arms the melody and the arp when they are on; the engine brings them in on the song's bar line), or `_nsMel.start()` by itself.

| # | do | you should hear / see |
|---|---|---|
| 33.1 | `_nsMel.start()` with a line drawn on the roll | the line plays on the drums' bar line, the same notes and rhythm as the page's own |
| 33.2 | Same, Follow on, over a chart (`_nsSong.start()`) | the line moves onto each chord as the page does; slash chords, rests and chords that change mid-bar |
| 33.3 | A step with a chord on it, Mono Auto and then Mono (explicit) | the chord sounds, each note quieter than a single one; in explicit Mono only its first note |
| 33.4 | Portamento on, off, a long Glide time | single notes slide in from the one before and a note after a chord does not; the slide is as long as the page's |
| 33.5 | Swing, a slower and a faster Rate, a 24-step line | the feel and the length of the loop as the page's |
| 33.6 | A locked phrase on one chord (with a chord in it) | that chord plays the lock and the others the line, moved with the key change |
| 33.7 | Humanize up | the notes are loose in time and level as the page's |
| 33.8 | Freeze the page for 3 s | the melody keeps its time and its notes |
| 33.9 | Big Fin / Cold / Fade | the melody's last notes fade with the band at the landing and it stops; nothing rings under the final hit |
| 33.10 | Piano or Organ as the melody voice | `_nsMel.start()` says why it cannot; nothing starts |



## 34. Melody lines written ahead (6.9.9.9.9.9.9.3; not heard on device)

| # | do | you should hear / see |
|---|---|---|
| 34.1 | Sync on, Melody Follow off, a multi-chord song through `_nsSong.start()` with melody armed | each chord receives its generated line at the boundary; try Bass Follow both on and off |
| 34.2 | Melody Follow on | the original figure follows the chords without being regenerated |
| 34.3 | Freeze the page for 3 s, then return | the last supplied line repeats without silence, and generation resumes on subsequent chord asks |
| 34.4 | Use a rest, slash chord, capo and a queued section change | lines agree with the page's progression; no doubled melody notes |


## 35. Navigation, selection feedback and saving (6.9.9.9.9.9.9.5a; not heard on device)

- Hardware keyboard, Live: Left/Right change key, Up/Down change scale; Tab and Shift+Tab cycle main tabs even with the tab bar focused. Inputs retain their keys.
- While playing, choose another drum feel and voice on Live: the selected name appears immediately with a dashed progress fill, then lands at the loop boundary. Check Bass and Melody style feedback too.
- On Mac, save one file and a bounce with stems: a Finder destination dialog opens; save and cancel both work, and the original bounce remains in Downloads > mõdRïff > Bounces.
- Bounce with long notes, reverb and delay; stop using Bounce, then repeat using transport Stop: Finishing stays visible for eight seconds, and mix/stems include the release and effects tail. Repeat with Native sound on.
- Import the bounce MIDI into a sequencer: Drums and Aux are separate tracks, each with its own hits (both use General MIDI channel 10).
- Save a bass pattern repeatedly while playing, name it, then reopen it after restart. Browser: 25 consecutive saves passed. The reported app crash has not reproduced; collect a crash report if it recurs. Failed storage writes retain the name dialog for retry and do not claim Saved.

## 36. Melody key width and audio-session activation (6.9.9.9.9.9.9.6; not heard on device)

- Melody keys: "Key width" cycles Auto, 26, 44, 64, 96 px in Mono, Poly and Auto; the width sticks when the voice mode changes. In Poly and Auto, two fingers on the strip play two notes (a chord), never a zoom; in Mono, two fingers still zoom.
- The strip's edge arrows move the keys by exactly one note per tap. The Glide button reads Glide: ON or Glide: OFF, and the glide-time knob dims when Glide is off or the mode is not Mono.
- Cold launch with headphones, a Bluetooth speaker and the speaker alone: the app opens without a pause, sound starts on the first note, and nothing stays silent until the app is backgrounded and returned to.
