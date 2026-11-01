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
   **v6.0q**. If it says anything older, the build did not install.
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

### Leaving the app (parked, still worth one check)

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
| 6.1 | Test as **Free** | locks appear: the recorded voices, the other scales, kits past Linn and 808, steps over 16, extended chords, the Aux switch |
| 6.2 | Free: a fresh start | chords on **Saw**, drums on the Linn, bass on Upright, the Aux off, none of them locked |
| 6.3 | Free: tap a locked drum kit | one sheet: "… is part of the Groove Pack." with **Unlock Groove Pack** at the store's price, **Full Studio** under it, Restore Purchases, All packs |
| 6.4 | Free: export audio longer than 90 s | the file stops at 90 s and a message says so |
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
desktop browser cannot judge. These were built at 4.9.9.9.9.9.6 to 6m; the footer now says 6.0q.

| # | do | you should see |
|---|---|---|
| 9.1 | Settings > Starter patterns, tap one of the pickers; Song > Build, tap a chord name field | the page does **not** zoom in when the field takes focus, and is back to normal after |
| 9.2 | Play, two fingers on two chord pads or two melody keys at once | a chord, not a page zoom; pinching bare text or the page background still zooms |
| 9.3 | Studio > Drums, load a six-sound kit onto the pads, then switch the sampler to a preset bank | six pads for the kit, twelve for the bank; each pad keeps its own sound and number |
| 9.4 | Live > Melody (mode on the Voice sheet says **Auto**): play single notes one after another, then two keys at once, then up to eight | single notes slide into each other (a bigger leap slides longer); two or more keys play together without a slide; a ninth key lets the oldest go |
| 9.5 | **Glide** on the strip's row | slides stop and start; it is dimmed in Poly. The same switch is on Studio > Melody |
| 9.6 | Studio > Melody, tap a second row on a lit step of the roll | the step becomes a chord; tap a chord note to take it away; Play: the chord sounds together |
| 9.7 | Switch **Bass**, **Mel** and **Drums** (off then on) on the transport over empty parts | a funk bass line, a pop hook, a 4/4 beat. Settings > Starter patterns changes which |
| 9.8 | Play (Live): scroll down | Chords, Melody, Styles, Sampler, mõdFX, Drum grid, **Aux grid**, Bass grid, Melody grid, Endings, each under the last;  |
| 9.9 | Styles widget: tap a style's name for the list, or the arrows to step; Save drum pattern / bassline / melody line saves what is there | the style changes and the part switches on; Save asks for a name and Pattern save lists it |
| 9.10 | Aux grid: tap cells (off, on, accent), pick A2 and change it, pick A1; start the beat and pick A2 | each pattern comes back as it was; a pick while playing waits for the loop; the kit is untouched |
| 9.11 | Chords: Rhythm bar, switch it on (it says Tap a chord), tap a chord | the chord plays as the rhythm, on the tempo, and keeps going with **Keep going**; with that off it stops when you lift; **Stop** ends it; a playing song silences it |
| 9.12 | **Edit rhythm**: tap steps, tap a hit to select it, Accent, Ratchet, Length, Swing, **Audition** | the roll shows what you drew, the playhead runs in time, **Save** saves it and plays the chords with it |
| 9.13 | Song > Build, a chord > Rhythm > **Draw…**, **Save**, play the song | that chord plays your rhythm; the others carry on as they were |
| 9.14 | Pattern save: save a drum, bass and melody pattern, change them, load them back | each comes back exactly; the sound and the Aux layer do not change |

## 10. Native sound: the dress rehearsal for the flip

The flip makes the C++ engine play every part and deletes the Web Audio path. It is
one commit and cannot be undone part by part, so it waits for this section. Nothing
here changes what is on by default: **Settings > Look & feel > Native sound** is off
until you turn it on, and it takes effect at once; turning it off needs a restart.
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
