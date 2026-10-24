# App Store submission kit

Everything App Store Connect asks for, ready to paste. The public pages it
links to (landing, support, privacy, terms) are the static site in the
`modriff.com` repo, not this one. Keep this file current when an answer here
changes; the privacy answers in particular must match `privacy.html`.

## Before the first upload: three things in the Xcode project

Found by reading `ios/`. Two are fixed in this commit, one needs Xcode.

| | state |
|---|---|
| `NSMicrophoneUsageDescription` | **Added** to `Info.plist`. It was missing, and the sampler's `getUserMedia` call would have ended the app the first time it asked for the mic. |
| `ITSAppUsesNonExemptEncryption = false` | **Added.** Answers export compliance once, so it is not asked on every build. The app has no server and no encryption of its own. |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` is written (no tracking, no collected data, no required-reason APIs in our own code) but **not yet in the target**. In Xcode: drag it into the `App` group, tick the `App` target. Capacitor's own packages carry their own manifests. |

Decided, and it affects the screenshots:

- `TARGETED_DEVICE_FAMILY = "1,2"` stays: the app ships for iPad too, so App
  Store Connect **requires iPad screenshots** (13": 2064 x 2752). They are in
  `docs/app-store/screenshots/` (see Screenshots below).
- `MARKETING_VERSION` is `1.0` and `CURRENT_PROJECT_VERSION` is `1`. The
  Build number must go up on every upload.
- The Info.plist `UIRequiredDeviceCapabilities` is `armv7`; App Store Connect
  accepts that, but `arm64` is what any current iPhone is.

## URLs

| field | value |
|---|---|
| Marketing URL | https://modriff.com |
| Support URL | https://modriff.com/support.html |
| Privacy Policy URL | https://modriff.com/privacy.html |
| EULA | Apple's standard one (leave blank); `terms.html` adds to it |
| Support email | support@modriff.com (forwards to the owner's inbox) |

## Listing text

Limits are Apple's; counts are characters.

**Name** (30): `mõdRïff`

Characters outside plain ASCII are allowed. If App Store Connect rejects the
name as taken, `mõdRïff: Chord Groovebox` (23) is the fallback.

**Subtitle** (30): `Every part, always in key` (25)

**Promotional text** (170, editable any time without a new build):

> Chords, drums, bass, melody and a synth, every part always in key. Pick a key and a mode and play: nothing you touch can sound wrong.

(133)

**Keywords** (100, comma-separated, no spaces after commas):

```
groovebox,chords,drum machine,synth,sequencer,music theory,midi,sampler,beat maker,songwriting,jam
```

(99.) Do not repeat words already in the name or subtitle ("key", "every"), and
do not use the category name.

**Description** (4000):

```
mõdRïff is a groovebox where every part is always in key.

Pick a key and a mode, and the chords, the bass, the melody, the arpeggios and the
drums all agree with each other. You can't play a wrong note, only a surprising one.
The hard parts of music theory are made simple to play, so you can make music first
and learn why it works later.

PLAY
- Chord pads for the whole key, with Roman numerals and Nashville numbers
- A melody keyboard that only offers notes in key, with bend, hold and mod
- Borrowed chords and any-root chords for when you want to step outside
- Any chord you can write: 13b9 and 7#9b13 sound exactly as spelled

BUILD A BAND
- A drum sequencer with its own kit, swing and per-drum shaping
- A bass line and an arpeggiator that follow your chords
- mõdSynth, a synth built for the app, with its engine in native code
- A sampler: record from the microphone, or resample the app itself
- mõdFX, an effects chain for every part
- Load your own sample for any drum

MAKE A SONG
- Chain sections into a song and keep it in your setlist
- Paste a chord sheet from the web and mõdRïff builds the chart for you
- Export audio, MIDI or stems to take it into your own studio

PLAYS WELL WITH OTHERS
- Connect a Bluetooth MIDI keyboard or controller
- Map its knobs to anything on the screen

PRIVATE BY DESIGN
No account. No ads. No analytics. No tracking. Works offline. Your songs, patterns
and recordings stay on your phone.

mõdRïff is made by one person, Ben Handel of Dutdut Records. Questions or ideas:
support@modriff.com
```

**What's New** (first release): `The first release of mõdRïff.`

**Copyright**: `2026 Ben Handel`

## Categories and rating

| field | value |
|---|---|
| Primary category | Music |
| Secondary category | Education (it teaches theory by playing) or Entertainment; owner's call |
| Age rating | Answer **None / No** to every question. Result: **4+** |
| Made for Kids | No |
| Price | Owner's call. If add-ons ship (section 4 of `v5-architecture.md`) they are In-App Purchases and need their own listing, screenshot and a visible Restore Purchases |

## App Privacy ("nutrition label")

**Data Not Collected.** In App Privacy, answer "No, we do not collect data from
this app." This is true of the build as it stands: no accounts, no analytics
(PostHog was removed in 4.0.5), no ads, no third-party SDKs, no server calls.
Tracking: **No.**

If any of that changes, for example an analytics SDK or a sign-in, this answer,
`PrivacyInfo.xcprivacy` and `privacy.html` all change together.

## App Review notes

> mõdRïff needs no account or sign-in and has no server. Everything runs on the
> device and works offline.
>
> To see it work: open the app, tap Start, then press the green play button in
> the bottom bar. Tap the chord pads on the Play tab, or the drum steps on the
> Accomp tab.
>
> Microphone: requested only if you open the Sampler and choose to record.
> Bluetooth: requested only if you press the Bluetooth button in
> Settings > MIDI, to pair a Bluetooth MIDI keyboard (not needed to review).
>
> Background audio is enabled so a song keeps playing when the screen locks.
> Contact: support@modriff.com

Background audio (`UIBackgroundModes: audio`) is a thing review checks for:
the app genuinely plays music in the background, which the note above says.

## Screenshots

`docs/app-store/screenshots/` holds five at **1320 x 2868**, the 6.9" iPhone
size, which is the one App Store Connect requires (smaller iPhone sizes are
scaled from it). They are captures of the build at 4.9.9.9.9.7.7j, taken in a phone-sized browser rather than on a device, after pressing Random on the splash screen so every screen has a song, a drum pattern and a chord row in it rather than an empty state.

| file | shows |
|---|---|
| `6.9in-01-splash.png` | the splash screen |
| `6.9in-02-play.png` | Play: coloured chord pads, melody keys, sampler |
| `6.9in-03-accomp.png` | Accomp: a drum pattern on the step sequencer |
| `6.9in-04-songs.png` | Songs: a song with a chord progression |
| `6.9in-05-sound.png` | Sound: the mixer |

The same five for iPad are in the same folder as `13in-01-splash.png` to
`13in-05-sound.png`, at **2064 x 2752**, the 13" iPad size App Store Connect
requires because the app ships for iPad (`TARGETED_DEVICE_FAMILY = "1,2"`;
smaller iPad sizes are scaled from it). Upload the `6.9in-` set under iPhone 6.9"
and the `13in-` set under iPad 13".

Two things worth doing before upload, neither of which blocks it: shoot them
on a real device or simulator so the status bar and safe areas are real, and
consider short captions on a coloured background, which is what most music
apps do.

An **app preview video** (15 to 30 s) is optional; screen-record playing a
progression over a beat.

## Icon

1024 x 1024, no transparency, no rounded corners (Apple rounds it). The
project has `AppIcon-512@2x.png` (1024 px) in `Assets.xcassets`; confirm it is
opaque and square before upload.

## Account steps the owner does

1. Apple Developer Program membership (annual fee), then App Store Connect.
2. Register the bundle ID `com.handelmusic.modriff`.
3. New App: name, language English (U.S.), bundle ID, SKU (any unique string,
   for example `modriff-ios-1`).
4. Paste the text above, upload screenshots, set price and availability.
5. In Xcode: set the signing team, add `PrivacyInfo.xcprivacy` to the target,
   Product > Archive > Distribute > App Store Connect.
6. Add the build to the version, answer App Privacy as above, submit for review.
7. Once live: put the App Store URL on the landing page button (`#get-app` in
   `index.html` of the site repo) and in the Dutdut Records site's app entry.
