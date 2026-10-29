# Phone test checklist

Everything built since the last time the app was on a phone, in one pass. Each
item says what to do, what you should see, and what to send back if you do not.
Versions are the ones in the footer (Settings > About).

**What this list cannot tell you:** whether the new native sound is *good*. It
checks that things work, that nothing is wrong that a Mac could not see, and
that the numbers the app records are sane. How a part sounds is your ear.

## Before you start

1. `git pull`, then `npm run ios:device` with the phone plugged in (the update
   is one command: it builds, syncs and installs). It is a **Debug** build, which
   is what gives you the Free/Pro switch in section 1.
2. Open the app and look at Settings > About. It should say
   **v4.9.9.9.9.8.9w**. If it says anything older, the build did not install.
3. Have these ready: a MIDI keyboard or pad controller (USB through the adapter,
   or Bluetooth), a real Ultimate Guitar PDF of a song you know, a songbook or
   lead sheet to photograph, and a second Apple device if you want to test
   restore.
4. If anything misbehaves, **Settings > General > Copy diagnostics** and paste it
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
| 1.1 | Settings > MIDI | the pane lists MIDI inputs (or "no inputs") and does **not** say "Not supported on this device" |
| 1.2 | Settings > General > Touch | a **Haptics: ON** button that is not greyed out |
| 1.3 | Songs > File > Import a chord sheet | the dialog has **Files…, Photos, Camera** (three buttons, not one) |
| 1.4 | Settings > About | a **Test as Free / Pro** row (Debug build only) |

If 1.1 to 1.3 show the *web* versions (no Photos or Camera, "not supported" MIDI,
no haptics button), the plugins did not register. Look in Xcode's console for
`[ModRiff] capacitorDidLoad` (it lists the plugins it registered) and
`[ModMidi] plugin registered`, `[ModHaptics] plugin registered`,
`[ModOcr] plugin registered`. Send what it prints.

## 2. Haptics (4.9.9.9.9.8.9i)

| # | do | you should see |
|---|---|---|
| 2.1 | Tap a chord pad on Play | a firm tap under the finger, at the same moment as the sound, not after |
| 2.2 | Tap a melody key, a sample pad | the same firm tap |
| 2.3 | Put a finger on the mõdFX pad and drag | a light tap on touch, then light taps while you move, about 8 a second at most |
| 2.4 | Press + / − on a sample-pad stepper and hold | a small tick per step |
| 2.5 | Bounce, stop it | a "success" buzz as the file is written |
| 2.6 | Settings > Haptics: OFF, then tap a pad | nothing |
| 2.7 | Leave the phone alone for 10 seconds, then tap a pad once | **the first tap after a pause**: is it as quick as the rest? (This is the one case the code cannot fully fix; say if it is late.) |

## 3. Chord-sheet pictures (4.9.9.9.9.8.9m)

The dialog is Songs > File > Import a chord sheet. Whatever it reads goes into
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
| 4.1 | Plug a keyboard in (USB adapter), open Settings > MIDI | the keyboard's name under Inputs |
| 4.2 | Play keys | chords or melody play, as the pane's "MIDI input plays" setting says |
| 4.3 | Unplug, replug | the port disappears and comes back without relaunching |
| 4.4 | **Bluetooth** button in the pane (if the controller is Bluetooth) | iOS's own pairing sheet, no crash |
| 4.5 | Turn a knob or move a fader | it moves the control CC1 (mod wheel to the mõdFX X axis) or CC11 (chord level) is set to by default |
| 4.6 | **Map controls** (Settings > MIDI, or the transport sheet): tap a slider, move a knob | the badge shows the CC; the knob now moves that slider; it ignores the knob until it reaches the slider's current value (pickup) |
| 4.7 | Map: tap **Hold**, press a key | Hold toggles from then on; the key does not also play a chord |
| 4.8 | Map: tap a **chord pad**, press a key | the key plays that pad; held while you hold the key |
| 4.9 | Long-press a mapped control (or tap its badge) | cleared |
| 4.10 | Close and reopen the app | the bindings are still there |
| 4.11 | Settings > MIDI out: pick the keyboard as a destination | a note on the app reaches the keyboard's sound (if it has one) |

## 5. Native sound, the bounce and the clock (4.9.9.9.9.8.x)

The chord part (and the arp, if you set it) is played by the C++ engine. These
are the open questions from the notes.

| # | do | you should see |
|---|---|---|
| 5.1 | Play chords with the drums running | the chord sits with the drums, not ahead of them |
| 5.2 | Move the chord part's mixer fader, mute and solo it | the level follows; mute is silent; no zipper noise on a fader move |
| 5.3 | Settings > General > Copy diagnostics, with chords playing | the native block has `dropped`, `refused` and `failed` at 0, a block load (should be well under 50%) and the slowest block times |
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

## 6. Pro and purchase (4.9.9.9.9.8.9b to 9h)

StoreKit 2, written but never run. Needs the StoreKit configuration file for the
test purchases without a store account (steps in `docs/app-store.md`, "Testing in
Xcode"). The Test as Free / Pro switch in Settings > About works without it.

| # | do | you should see |
|---|---|---|
| 6.1 | Switch to **Free** | locks appear: Pro voices, the Pro scales, steps over 32, extended chords |
| 6.2 | Free: play a Piano (synth) and Upright part, a fresh start | they are the defaults and are not locked |
| 6.3 | Free: export audio longer than 90 s | the file stops at 90 s and a message says so |
| 6.4 | Free: open a `.modriff.json` made with Pro parts | it opens, plays, and one banner names what is missing; saving again keeps the Pro choices |
| 6.5 | Switch to **Pro** | everything unlocks without a relaunch |
| 6.6 | With the StoreKit file: tap the upgrade sheet, buy | Pro, no relaunch |
| 6.7 | Buy, then airplane mode, then force-quit and reopen | still Pro |
| 6.8 | Delete the app, reinstall, **Restore Purchases** | Pro again |
| 6.9 | Debug > StoreKit > Manage Transactions: refund | back to free on the next launch |
| 6.10 | Ask to Buy | pending, then approved |

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
| 8.1 | Settings > General > Key colours, pick **Circle of fifths** | the twelve swatches re-order; keys a fifth apart are neighbours in colour; the whole app's accent follows the key you are in |
| 8.2 | "Red is" > A | A is red, B♭ orange, round the wheel; the page colour changes with it |
| 8.3 | Force-quit and reopen | the choice is kept |
| 8.4 | Settings > About > Test as **Free** | the control is dimmed, the app plays the original colours (C red); tapping it says it is Pro; back to Pro and your choice returns |
| 8.5 | Mixer > **EQ** on the master strip | a panel with Low, Mid, Mid at, High; the button lights once anything is off flat |
| 8.6 | Play something with bass and cymbals; drag Low up and High down | the bass swells and the top softens, smoothly, no zipper noise; **Flat** puts it back |
| 8.7 | Master EQ with the chord part native (and again with drums/bass on web) | the EQ moves **everything**, the native chord included, and a +12 dB boost does not clip (the limiter is after it) |
| 8.8 | Bounce with an EQ set | the file has the EQ in it |
| 8.8a | Mixer: tap **EQ** under M and S on the Bass strip, boost Low | only the bass gets heavier; the button lights; the master EQ is a separate button on the master strip |
| 8.8b | The same on the chord part (it is the native one) | the chord part changes, with its mõdFX pad moving filters on top of it; flattening it gives back the original sound |
| 8.8c | Put an EQ on a part, save a Setup, change the EQ, load the Setup | the part's EQ comes back |
| 8.9 | Settings > General > iCloud | "iCloud sync: OFF" with a line saying nothing leaves the device. **If the iCloud capability is not on in this build** it will say it is not enabled when you turn it on, and that is the right answer; skip 8.10 to 8.14 |
| 8.10 | (capability on, two devices, one Apple ID) turn sync on at both | "Synced just now" on both |
| 8.11 | Save a setup on device 1 | it is on device 2 within a few seconds of opening the app, or after the next 5-minute check |
| 8.12 | Delete a song on device 2 | it is gone from device 1 and stays gone |
| 8.13 | Edit the same song on both, device 2 last | device 2's version wins on both; nothing is duplicated |
| 8.14 | Airplane mode, make a change, turn it off | it goes up on its own, and the line says "waiting" while it cannot |

## 9. The rhythm and live-page batch (4.9.9.9.9.9.6 to 6h)

None of this touches the native engine; it is touch, layout and the clock, which a
desktop browser cannot judge. Footer should say **v4.9.9.9.9.9.6h**.

| # | do | you should see |
|---|---|---|
| 9.1 | Settings > General > Starter patterns, tap one of the pickers; Songs > Build, tap a chord name field | the page does **not** zoom in when the field takes focus, and is back to normal after |
| 9.2 | Play, two fingers on two chord pads or two melody keys at once | a chord, not a page zoom; pinching bare text or the page background still zooms |
| 9.3 | Accomp > Drums, load a six-sound kit onto the pads, then switch the sampler to a preset bank | six pads for the kit, twelve for the bank; each pad keeps its own sound and number |
| 9.4 | Play > Melody (mode on the Voice sheet says **Auto**): play single notes one after another, then two keys at once, then up to eight | single notes slide into each other (a bigger leap slides longer); two or more keys play together without a slide; a ninth key lets the oldest go |
| 9.5 | **Glide** on the strip's row | slides stop and start; it is dimmed in Poly. The same switch is on Accomp > Melody |
| 9.6 | Accomp > Melody, tap a second row on a lit step of the roll | the step becomes a chord; tap a chord note to take it away; Play: the chord sounds together |
| 9.7 | Switch **Bass**, **Mel** and **Drums** (off then on) on the transport over empty parts | a funk bass line, a pop hook, a 4/4 beat. Settings > Starter patterns changes which |
| 9.8 | Play (Live): scroll down | Chords, Melody, Styles, Sampler, mõdFX, Drum grid, **Aux grid**, Bass grid, Melody grid, Endings, each under the last; **Endings: shown / hidden** at the foot |
| 9.9 | Styles widget: tap > on Bass, Melody and Drums; tap + to keep what is there | the style changes and the part switches on; + asks for a name and Rhythm bank lists it |
| 9.10 | Aux grid: tap cells (off, on, accent), pick A2 and change it, pick A1; start the beat and pick A2 | each pattern comes back as it was; a pick while playing waits for the loop; the kit is untouched |
| 9.11 | Chords: **Rhythm** bar, switch it **On**, tap a chord | the chord plays as the rhythm, on the tempo, and keeps going with **Latch**; with Latch off it stops when you lift; **Stop** ends it; a playing song silences it |
| 9.12 | **Draw**: tap steps, tap a hit to select it, Accent, Ratchet, Length, **Audition** | the roll shows what you drew, the playhead runs in time, **Use on the pads** applies it |
| 9.13 | Songs > Build, a chord > Rhythm > **Draw…**, **Use for this chord**, play the song | that chord plays your rhythm; the others carry on as they were |
| 9.14 | Rhythm bank: keep a drum, bass and melody pattern, change them, load them back | each comes back exactly; the sound and the Aux layer do not change |

## 10. Things that are just worth noticing

- The splash, the first launch, the permission prompts (microphone for the
  sampler, camera for chord sheets, Bluetooth only when you press its button).
- Anything that looks like the web version of a thing the app should do natively.
- Anything slower than it was on 4.9.9.9.9.8.7.

## What to send back

One message is enough: the item numbers that are **wrong** or **skipped**, the
diagnostics from any that misbehaved, the `bounce-check.py` output and capture
report for 5.6, and screenshots for 3.1 to 3.3. "All ok except 3.3 and 5.10" is
a complete answer.
