# App Store submission kit

Everything App Store Connect asks for, ready to paste. The public pages it
links to (landing, support, privacy, terms) are the static site in the
`modriff.com` repo, not this one. Keep this file current when an answer here
changes; the privacy answers in particular must match `privacy.html`.

## Before the first upload: three things in the Xcode project

Found by reading `ios/`. All three are done.

| | state |
|---|---|
| `NSMicrophoneUsageDescription` | **Added** to `Info.plist`. It was missing, and the sampler's `getUserMedia` call would have ended the app the first time it asked for the mic. |
| `ITSAppUsesNonExemptEncryption = false` | **Added.** Answers export compliance once, so it is not asked on every build. The app has no server and no encryption of its own. |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` (no tracking, no collected data, no required-reason APIs in our own code) is **in the `App` target's Resources** (checked in the project file, 6p). Capacitor's own packages carry their own manifests. |

Decided, and it affects the screenshots:

- `TARGETED_DEVICE_FAMILY = "1,2"` stays: the app ships for iPad too, so App
  Store Connect **requires iPad screenshots** (13": 2064 x 2752). They are in
  `docs/app-store/screenshots/v6.9.9.9.9.9.9.9a/` (see Screenshots below).
- `MARKETING_VERSION` is `1.0` and `CURRENT_PROJECT_VERSION` is `1`. The
  Build number must go up on every upload.
- `UIRequiredDeviceCapabilities` is `arm64` (it was `armv7`, which App Store Connect
  accepted but no current iPhone is; changed in 6p, simulator build checked).

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

**Name** (30): `mõdRïff: Chord Groovebox` (24)

Characters outside plain ASCII are allowed.

**Subtitle** (30): `Every part, always in key` (25)

**Promotional text** (170, editable any time without a new build):

> Pick a key and play: chords, drums, bass, melody and synth always agree, so nothing you touch sounds wrong. Free to start. No account, no ads, no subscription.

(159)

**Keywords** (100, comma-separated, no spaces after commas):

```
drum machine,synth,music theory,midi,sampler,songwriting,backing track,looper,piano,guitar,practice
```

(99.) "groovebox" and "chord" left for the name; "sequencer", "beat maker" and "jam" went to make room for "backing track", "looper", "piano", "guitar" and "practice" (the five do not fit in the room the two freed alone). Do not repeat words already in the name or subtitle ("key", "every", "chord", "groovebox", "part", "always"), do not use the category
name, and do not use another product's name: an `iReal` keyword would be a trademark rejection.

**Description** (2174 of 4000). One line per paragraph on purpose: App Store Connect keeps every line
break you paste, so a description wrapped to 85 columns shows a break mid-sentence. It names no other product
(no iReal, 808 or Linn: those are trademarks) and no price (prices are per storefront). It does not promise
playback with the screen locked: background scheduling is still being moved to the engine
(`docs/native-scheduling.md`), so say it only once it is heard on a device.

```
mõdRïff is a groovebox where every part is always in key.

Pick a key and a mode, and the chords, the bass, the melody, the arpeggios and the drums all agree with each other. You can't play a wrong note, only a surprising one. The hard parts of music theory become easy to play, so you can make music first and learn why it works later.

PLAY
- Chord pads for the whole key, with Roman numerals and Nashville numbers
- A melody keyboard that only offers notes in key, with bend, hold and mod
- Borrowed chords and any-root chords for when you want to step outside
- Any chord you can write: 13b9 and 7#9b13 sound exactly as spelled

BUILD A BAND
- A drum sequencer with its own kits, swing and per-drum shaping
- A bass line and an arpeggiator that follow your chords
- mõdSynth, a synth built for the app, with its engine in native code
- A sampler: record from the microphone, load your own samples, or resample the app itself
- mõdFX, an effects chain for every part

MAKE A SONG
- Chain sections into a song and keep it in your setlist
- Paste a chord sheet from the web, or photograph one, and mõdRïff builds the chart for you
- Practice tools: speed trainer, next key and loop bars, with Stage mode to read from a stand
- Export audio, MIDI or stems to take into your own studio

PLAYS WELL WITH OTHERS
- Connect a Bluetooth or USB MIDI keyboard or controller
- Map its knobs and pads to anything on the screen

FREE TO START, PACKS WHEN YOU WANT MORE
mõdRïff is free to use. Major, minor, pentatonic and blues scales, two drum kits, five saved songs and full-length audio export are included. Add only what you need with one-time packs: Sampler Engine, mõdSynth Engine, Groove, Theory, Practice & Perform, Studio and Sounds. Or get Full Studio for every pack listed here, and every update to them. No subscriptions.

PRIVATE BY DESIGN
No account. No ads. No tracking. No third-party analytics. Works offline. Your songs, patterns and recordings stay on your device. Apple provides aggregate store statistics and, if you opt in to sharing, app usage and diagnostics.

mõdRïff is made by one person, Ben Handel of Dutdut Records. Questions or ideas: support@modriff.com
```

**What's New** (first release): `The first release of mõdRïff. Pick a key and play.`

**Copyright**: `2026 Ben Handel`

The year the rights were obtained, then the person or company that owns them: no (c) symbol (the store
draws it) and no URL. It should be the legal name on the Apple Developer account, which is what the store
shows as the seller; on an individual account that is `Ben Handel`. Use `Dutdut Records` only if that is a
registered entity that owns the app and is the account holder. Nothing else is asked for on the page.

Third-party material is not credited on the page. The licences that require credit (CC BY 3.0, MIT, and any
CC BY-SA 3.0 share-alike files) are met in the app, in Settings > About > Credits (`CREDITS_TABLE`, kept in step
with `samples/SOURCES.csv` by `check.sh`: author, licence link and what was changed). Credit anything new
there before it ships; the store listing needs no change.

## Categories and rating

| field | value |
|---|---|
| Primary category | Music |
| Secondary category | Education (it teaches theory by playing) or Entertainment; owner's call |
| Age rating | Answer **None / No** to every question. Result: **4+** |
| Made for Kids | No |
| Price | Free app, with eleven In-App Purchases: seven packs and the Full Studio bundle (below). The prices are set in App Store Connect, not in the code |

## App Privacy ("nutrition label")

**Data Not Collected.** In App Privacy, answer "No, we do not collect data from
this app." This is true of the build as it stands: no accounts, no analytics SDK
(PostHog was removed in 4.0.5), no ads, and no developer-operated collection server.
Tracking: **No.**

Apple's own App Store Connect reports do not change that answer or require an
analytics entry in our privacy manifest. Apple says developers are not responsible
for disclosing data collected only by Apple. Capacitor and its plugins still have
their own manifests; "no analytics SDK" does not mean "no third-party code."

If any of that changes, for example an analytics SDK or a sign-in, this answer,
`PrivacyInfo.xcprivacy` and `privacy.html` all change together.

### Analytics: App Store Connect only (decided November 12, 2026)

Use Apple's built-in reports. No TelemetryDeck, custom events, per-installation
identifier, analytics consent switch or analytics server is added to the app.
The old Vercel script tags are removed from the source for both app and web builds;
`track()` remains a no-op. There is no SDK, entitlement or developer collection
toggle to deploy: analytics is included with Developer Program membership and
requires no technical implementation.

In **App Store Connect > Apps > mõdRïff > Analytics**, check downloads, product-page
conversion, active devices, sessions, retention and crashes. Use **Sales and Trends**
for pack/product sales. App usage and diagnostics only represent people who chose
to share with Apple and developers; check the opt-in rate and selected date range.
Low volume, privacy thresholds and reporting delays can leave charts empty. An
Xcode-installed development build is not proof that App Store reports are working.
These reports do not count particular instruments, kits, effects or button taps.

**Verification:** source, dependencies, bundle ID `Handel.modRiff` and the packaged
privacy manifest were checked. Live account metrics have not been inspected from
this session (no App Store Connect connection). After distribution, confirm the app
appears in Analytics, the release version/date filter is right and reports arrive;
do not interpret an empty usage chart as an app-side analytics switch being off.

References: [Apple: no technical implementation required](https://developer.apple.com/app-store/get-started/),
[usage reports and opt-in](https://developer.apple.com/help/app-store-connect-analytics/engagement/app-usage/),
[privacy disclosure rules](https://developer.apple.com/app-store/app-privacy-details/).

`privacy.html` covers the camera (chord-sheet photo, read on the device), optional iCloud sync, the app's folder in Files,
one-time packs and iPad. The November 12, 2026 update clarifies Apple's aggregate store reports and optional usage/diagnostic
sharing, removes the overbroad "no third-party code" claim, and keeps the landing page consistent. The site's iPhone Duo tab shows the three states from `screenshots/v6.9.6/`; the open, wide shot was removed (it showed the old Linn kit name), so retake it from Xcode before the site keeps that state. The
site's "for iPhone, iPad and Mac" is true: the Mac Catalyst build is uploaded to App Store Connect.

## App Review notes

Apple's reply to the first submission asked for six things in the Notes field (limit 4000). The note below
answers all six in order (3311 characters, counted with `len()` on the text between the rules). Paste it into
App Store Connect > App Review Information > Notes and replace the recording line with the real link first.
It is the only review note: the sandbox route to the packs is in it, so the IAP section no longer has its own.

**Owner must settle before resubmitting** (nothing here is in the note as settled, and the note does not
claim it):

- **Ableton Link on a device.** The licence needs no approval, but the `com.apple.developer.networking.multicast`
  entitlement has not been requested from Apple and is not in the iPhone build, so on an iPhone or iPad Link finds
  no peers. If App Review tries it, it will look dead. Request it (`docs/link.md`, section 2) or tell Review in the
  note. Also unasked: whether Ableton's licence ("iOS applications") covers the Mac Catalyst build (one email to
  link-devs@ableton.com).
- **iCloud.** The entitlement and `MODRIFF_CLOUDKIT` are in the project (1.9.9.3), so the note says sync is
  optional and off by default. Before uploading: CloudKit Dashboard > `iCloud.Handel.modRiff` > Deploy Schema
  Changes to Production (without it the shipped app cannot save a record); `docs/v5-architecture.md`, "iCloud sync".
- **Mac `network.server` message (automated, from App Store Connect).** The entitlement is used: Ableton Link
  receives UDP from other apps on the local network (`AppMac.entitlements`). Reply to the message with the text
  below and keep section 4 of the note as it is; do not remove the entitlement (Link on the Mac would go silent).
  > mõdRïff's Mac build includes Ableton Link (Ableton's LinkKit, Settings > Ableton Link) for tempo sync with
  > other music apps on the same network. Link discovers peers with multicast UDP and has to listen for their
  > packets, which the App Sandbox allows only with com.apple.security.network.server. The app opens no web or FTP
  > server and accepts no connections from the internet; it only listens on the local network, and only while Link
  > is switched on (off by default). com.apple.security.network.client is there for the web view.
- **Local Network permission.** It is asked the first time Link is switched on; the note says so.
- **The recording** (item 1) is yours to make and upload; the shot list below is the script.
- If anything is added to `samples/SOURCES.csv` or the Credits table before upload, reread item 6.

```text
1. SCREEN RECORDING AND ACCOUNTS
Screen recording (physical iPhone, latest iOS, from launch through the paid features): [RECORDING LINK]
mõdRïff has no accounts, no sign-in and no user-generated content shared with anyone, so no credentials are needed.

2. PURPOSE AND AUDIENCE
mõdRïff is a chord-based music maker for iPhone, iPad and Mac. You pick a key and the chords, bass, melody, arpeggios and drums all stay in it, so a wrong note is hard to play. It is for songwriters, hobbyist and beginner players, and musicians who want a backing band to practise or write with. The problem: music theory and a pile of separate tools stand between an idea and a sound. The value: play, build a song, practise it, and export audio or MIDI, all in one app.

3. HOW TO REACH THE MAIN FEATURES
No account, sample file or setup needed; it works offline. Open the app, tap Start, press the green play button in the bottom bar. Tap the chord pads on the Live tab, or open Drums and tap steps in the grid.
Paid features: the app is free; seven optional packs and a Full Studio bundle are one-time In-App Purchases. Tapping any locked control opens a sheet naming it with the pack and its price; Settings > About > Store lists every pack. In the sandbox: tap a locked drum kit (Digital 1 and Analog 1 are free), buy the Groove Pack, then tap another locked control: the sheet now offers "Complete Your Studio", an upgrade price for Full Studio shown only after a pack is owned. Restore Purchases is on that sheet, the store screen and Settings > About. Locked things can often be tried first: sampler pads and Sounds Pack voices play a quiet preview twice, and Hear it plays a short Groove Pack demo.
Permissions, each asked only when used: Microphone, when you record in the Sampler. Camera, when you choose Camera to import a chord sheet from a photo (Songs > File > Import a chord sheet). Bluetooth, only via Settings > MIDI to pair a Bluetooth MIDI keyboard (not needed to review). Local Network, only when Ableton Link is switched on in Settings. iCloud sync (Settings > iCloud & backup) is optional and off by default; it needs an iCloud account and is not needed to review. Background audio is enabled so a song keeps playing when the screen locks.

4. EXTERNAL SERVICES
Apple's StoreKit 2 for the purchases, and Apple's on-device text recognition (Vision) to read chord-sheet photos; the picture is not stored or sent. Ableton Link (Ableton's SDK) for tempo sync with other apps on the local network. No server or backend of ours, no analytics, no advertising and no AI service. Nothing leaves the device unless the person turns on iCloud sync (off by default): then songs, setups and patches go to their own private iCloud (CloudKit) database, which we cannot read; recordings never sync. On the Mac, Link listens for peers on the local network (the com.apple.security.network.server entitlement); the app runs no server.

5. REGIONS
It behaves the same in every region. Only the prices differ, as the App Store sets them per storefront. English only.

6. THIRD-PARTY MATERIAL
Each bundled sound, font and code library is logged with its source, author and licence. Almost all sounds are CC0 (public domain). The rest are MIT, CC BY 3.0 (credited), SIL Open Font Licence fonts, and the developer's own work (icon, two sound effects). The synthesis models in the mõdSynth Macro Osc patches are MIT-licensed code from Emilie Gillet (Mutable Instruments). Ableton Link is used under the free Ableton Link SDK License, which needs no approval. Credits and licence links for all of it are in Settings > Help & about > Credits. The app names no third-party product.
Contact: support@modriff.com
```

**Shot list for the recording** (physical iPhone, latest iOS, under 3 minutes, start to finish in one take):

1. Home screen: tap the mõdRïff icon (shows the launch).
2. Splash: tap Start.
3. Press play in the bottom bar; let a groove run a few seconds.
4. Live tab: tap chord pads; change key once to show everything following.
5. Drums: open the grid and tap a few steps.
6. Tap a locked control (a locked drum kit): the pack sheet opens, showing pack and price.
7. Buy the Groove Pack with the sandbox account: confirm the Apple payment sheet; the kit unlocks and plays.
8. Tap another locked control: the "Complete Your Studio" offer shows.
9. Settings > Help & about > Store, then Restore Purchases.
10. Sampler: tap Record; the microphone permission prompt appears; allow it, record a second, play it back.

## Screenshots

The upload set is `docs/app-store/screenshots/v7.1-captioned/` (the `iphone-6.9in-` and `ipad-13in-` files: 1320 x 2868 and
2064 x 2752, opaque; five shots each, in this order: Live, Studio, mõdSynth, Song, Stage, each with a caption over a framed screenshot).
The Studio shot was refreshed from 1.9.4c on both devices: the larger two-row selector includes Aux and the duplicate Kit/Aux row is gone. The other raw shots were retaken for the layout overhaul from build 1.9.2 in the iOS Simulator (iPhone 18 Pro Max, iPad Pro 13-inch (M5)), status bar
9:41, every pack open, the app playing a random song. The tabs read Live, Studio, Song, Mix, and the shots show what the overhaul
made: Live's two rows of four split pads and tall keys, Studio's strip and pick row with a drum groove, the mõdSynth editor with the
wavetable view, the Song builder and the chord chart. `raw/` holds the plain captures; `build.sh` regenerates the captioned files
from them (it needs Chrome and `sips`). Everything under `v6.9.9.9.9.9.9.9a/`, `6.9in-`, `13in-`, `v6.9.2/` shows retired tab names
or older layouts and is history only: do not upload it. `v6.9.6/` is the Duo layout reference. The owner-approved synth caption is "Shape your sound with a real synth". `layout-followthrough-verification.json` records the refreshed stills and dimensions. `bash build.sh studio` or `bash build.sh sound` rebuilds only that pair; no argument rebuilds all five pairs.

How to redo them: build the Simulator app with the optimiser on and the debug switch kept (a plain Debug build runs
the C++ engine at -O0 and stalls the page; a Release build has no `__modDebug`, so no unlock switch):
`xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO GCC_OPTIMIZATION_LEVEL=3 SWIFT_OPTIMIZATION_LEVEL=-O build`.
Pin the status bar with `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100`.
Open the app once, quit it, then write `modo-dev-tier` = `pro` and `modo-tour-ch1` = `1` into the app's WebKit
`localstorage.sqlite3` (table `ItemTable`, values UTF-16LE blobs) so every pack is open and the tour stays closed;
launch, tap Random, tap play, tap a chord, then `xcrun simctl io <udid> screenshot`. Give each device its own
Simulator: the shared one gets other sessions' builds installed over it. Driving a new Simulator needs the owner's
approval in the app once per device.

**IAP review shots** (`screenshots/iap/`, 1320 x 2868, opaque) were retaken from 1.9.4a: all eleven, including Studio’s EQ, Theory’s pure tuning and Practice’s current playlist-import wording. `verification.json` records each sheet’s text, ownership and image hash; `source/` holds the disposable Simulator capture automation.

There is no Mac set in this folder: the old `mac-16x10-*` files in `v6.9.2/` are the web build in Chrome. Mac App Store
needs 16:10 shots (2880 x 1800 at 2x, a 1440 x 900 window). `ios/mac-catalyst/run-mac.sh` builds and opens the Mac app, but it
signs with the team, replaces `~/Applications/modRiff-dev.app` and needs someone to drive the window and capture it
(`screencapture -l`); it was not run from this session. There is now a Mac app (Mac Catalyst, same bundle id, so
universal purchase): it builds, signs ad hoc and launches on this Mac with all eight plugins registered and a 922 x 692
window. Retake the Mac set from that window before uploading, and check the Studio panel at the 768 x 600 minimum.
Mac App Store build: `ios/mac-catalyst/archive-mac-store.sh` archives the Release Mac Catalyst build and exports a signed
`App.pkg` to `~/Desktop/modRiff-mac-store/export` (`... upload` sends it to App Store Connect from Xcode's signed-in
account). Checked 2026-11-06: the app is signed by Apple Distribution (cloud managed, made by Xcode on first export, none
needed in the keychain), the package by `3rd Party Mac Developer Installer`, with the `Mac Catalyst Team Store Provisioning
Profile: Handel.modRiff` embedded and the sandbox entitlements present. Not done: the app record's macOS platform in App
Store Connect (a build cannot be uploaded until it exists), then upload, and the purchase flow on the Mac through
StoreKit. Audio and bounce saving work on the Mac (owner-tested).

The current **iPhone app previews** are the three `store-*.mp4` files in `docs/app-store/previews/layout-overhaul/`: Live and Mix, landscape instruments, then Song and learning. They were retaken from the native Simulator for 1.9.4a–1.9.4c; the instruments film shows the larger two-row Studio selector and Aux, and Mix has Mixer and Voices only. Each is 27.1 seconds at constant 30 fps, H.264 High Level 4.0 and stereo AAC; portrait is 886 × 1920 and landscape 1920 × 886. The README lists coverage and rebuild commands, and `verification.json` records decoding, frame counts, loudness, true peak and hashes. Not uploaded or processed by App Store Connect; not heard on a physical iPhone. iPad and Mac need their own footage. `previews/feature-series/`, `high-impact/` and `2026-11-13/` retain the earlier films and their original editable sources; do not upload those earlier selections for this layout.

Six separate **social audience ads** are in `previews/audience-series/`: jazz, grooveboxes,
piano, guitar, wind/brass students and producers. Each is 24 seconds at 1080 × 1920,
with a temporary music preview, a silent replacement master, posters, a review gallery
and a 124 BPM soundtrack cue sheet. See its README; these are campaign assets.

The Duo draws its clock and status pill down the right edge and reports a right inset of 84pt (measured in the simulator:
top 0, right 84, bottom 34, left 0). 1398 x 2034 is not one of the sizes App Store Connect lists, so the Duo set is a
reference for checking the layout, not an upload. The splash ignored the inset and the wordmark ran under the pill; fixed
in 6.9.2a, and `iphone-duo-01-splash` is the fixed splash. The other four are taken at 6.9.2a: Live, Studio, Song and Sound
all keep clear of the pill, because the page pads the body by the side insets. What they do show, left alone for now:
the column is only about 380pt wide, so the Live Chords voice picker is squeezed to a "V" and the Song title is cut off,
and the Sound mixer strips wrap (Mute, Solo and EQ stack; the knobs scatter). Toasts, sheets and the tour card were not
looked at on this device.

Those five are the closed Duo **before** 6.9.5 (bottom stack, no right rail). The Duo has three states and the layout
differs in each, so `docs/app-store/screenshots/v6.9.6/` holds one Live shot per state (the open, wide one is removed), saved by the owner from the Duo
in Xcode (not shot with `simctl`: it cannot capture the open Duo's 2007 x 2853 screen, and the Duo's fold is a control in
Xcode that `simctl` does not have). They were taken on main at 6.9.6 (the version is not in the pictures) with the real
clock, 7:43, not the pinned 9:41, so they are for checking the layout, not for upload:

| state | size | file | what it shows |
|---|---|---|---|
| closed | 1398 x 2034 | `iphone-duo-closed-live` | the right rail (6.9.5): key, tempo, play, 1/16 and the part buttons down the right edge under the clock and pill; the Live column beside it; tab bar along the bottom. The Chords voice picker still shows "S…" |
| open, upright | 2007 x 2853 | `iphone-duo-open-upright-live` | the old bottom stack on a wider screen: transport and part buttons above the tab bar, every picker spelled out (VOICE Saw, VOICE Sine), the keyboard runs C4 to A5 |

Looked at, not measured, and only the Live tab: Studio, Song and Sound were not re-shot at 6.9.5 or 6.9.6, so the
cramped Song title and Sound mixer notes above may or may not still hold on the closed Duo. The recording that came with
the shots (7 s, a fold from closed to open) is not kept in the repo; its closed frame matches the closed shot.

## Icon

1024 x 1024, no transparency, no rounded corners (Apple rounds it). The
project has `AppIcon-512@2x.png` (1024 px) in `Assets.xcassets`; confirm it is
opaque and square before upload.

## In-App Purchases: seven packs and a bundle

The code is in (`ios/App/App/ModBilling/ModBilling.swift`, StoreKit 2, behind
`window.modBilling`; the design and the table of what each pack holds are in section 4 of
`v5-architecture.md`). The page side is measured. The Swift **builds** (iOS Simulator, 6.9.9.3:
`BUILD SUCCEEDED`, no errors, no warnings in `ModBilling.swift`); **the purchase flow has not
been run**, which needs StoreKit testing in Xcode or a sandbox account (see "Testing" below).

**App Store Connect** (My Apps > mõdRïff > Monetization > In-App Purchases). All eleven are
**Non-Consumable**, with these Product IDs exactly. IDs can never be reused, even after a
product is deleted, so check each one before creating it.

| Product ID | Reference name | Display name (max 30) | Description (max 45) | Price |
|---|---|---|---|---|
| `Handel.modRiff.sampler` | Sampler Engine | Sampler Engine | Pro sampler: your samples, kits, loop slicing | $5.99 |
| `Handel.modRiff.synth` | mõdSynth Engine | mõdSynth Engine | Wavetable power synth + the full mõdFX rack | $4.99 |
| `Handel.modRiff.groove` | Groove Pack | Groove Pack | World grooves, odd meters, extra kits, aux | $3.99 |
| `Handel.modRiff.theory` | Theory Pack | Theory Pack | Every mode, chord and voicing, neo-soul ready | $3.99 |
| `Handel.modRiff.practice` | Practice & Perform Pack | Practice & Perform Pack | Speed trainer, loop bars, Stage, timeline | $3.99 |
| `Handel.modRiff.studio` | Studio Pack | Studio Pack | EQ, sound shaping, Play in, Arrange, stems | $4.99 |
| `Handel.modRiff.sounds` | Sounds Pack | Sounds Pack | Tonewheel organ, e-piano, pads, vibes, bass | $1.99 |
| `Handel.modRiff.fullstudio` | Full Studio | Full Studio | Every pack, in one purchase | $12.99 launch, $19.99 regular |
| `Handel.modRiff.fullstudio.from1` | Full Studio Upgrade 1 Module | Complete Your Studio | Finish the set: every pack you don’t own yet | $10.99 launch, $15.99 regular |
| `Handel.modRiff.fullstudio.from2` | Full Studio Upgrade 2 Modules | Complete Your Studio | Finish the set: every pack you don’t own yet | $6.99 launch, $11.99 regular |
| `Handel.modRiff.fullstudio.from3plus` | Full Studio Upgrade 3+ Modules | Complete Your Studio | Finish the set: every pack you don’t own yet | $3.99 launch, $4.99 regular |

**Full Studio is $19.99 regular, with $12.99 as a stated launch price.** The seven packs add up to $29.93. A
step must never cost more than the packs still to buy one at a time: owning the dearest packs leaves the least
to buy (1 owned: at least $23.94 left, 2: $18.95, 3: $13.96, 4: $9.97, 5: $5.98), and every step above is under
that, launch and regular. The only gap is 6 owned (one pack left, $1.99 at the cheapest), where the 3+ step costs more;
the page already compares and offers the single pack instead (below). The owner sets and schedules these prices in
App Store Connect; nothing in the app holds a price.

The display names and descriptions are the page's own copy (`MODULE_COPY` in `index.html`),
and a test holds `ios/App/ModRiffPacks.storekit` to the same words, so paste from there.

The descriptions are written to sell, within 45 characters, and each says what the pack does,
not what it is called. Two words are kept out of every field the store shows, because they are
other companies' trademarks: **iReal** (the Practice & Perform line used to end "iReal batch",
now "chart import") and **Rhodes** (the Sounds line says "electric piano", as the pack's own list
does). The pack’s list inside the app and its retaken `iap/Handel.modRiff.practice.png` review shot say "Chart import: a whole playlist at once", so no trademark is named in the sheet either (`MODULE_COPY.practice`).

- **Family Sharing: on for all eleven** (it cannot be turned off once a product is live, and
  mixing on and off is how a family ends up owning half a bundle).
- Prices: the launch prices above, raised or lowered later. Nothing in the app names a
  price; the sheet and the store show whatever the store returns for the user's storefront,
  and the page compares the Complete Your Studio price with what is left to buy one at a
  time and offers whichever is cheaper.
- A review screenshot per product (any locked control, tapped; or Settings > About > Store).
  They are made: `docs/app-store/screenshots/iap/<product id>.png`, 1320 x 2868, opaque, all
  eleven different. Upload each under that product's Review Information. Each is the pack's
  sheet over a rolled song, with the store's launch prices filled in; the three Complete Your
  Studio shots come from owning one, two and three packs (Groove; Groove and Sounds; Groove,
  Sounds and Studio), and `Full Studio` is the All packs screen. They were retaken at 1.9.4a
  from the web build in a phone-sized browser (not a device) once the descriptions changed, so
  they show the current look and wording. Retake them on a device once a purchase runs, and
  again if a pack's copy, price or the sheet changes.
- A **promotional image** per product, which is optional and is what the store shows if it
  features the item: `docs/app-store/promo/<product id>.png`, 1024 x 1024, opaque, no rounded
  corners, one for each of the eleven. Upload under Promotional Image (App Store Connect
  accepts it once the product has its name, description and price). Each is one picture: the
  pack's name, its description, three things it does, and a bar of seven segments with this
  pack lit (all seven for Full Studio; for the upgrades, the packs already owned dimmed and the
  rest lit). No price (it differs per storefront), no other company's name, not the app icon.
  Made by `docs/app-store/promo/promo.html` and `render.mjs`: the template holds the copy, so
  change a pack's name, line or list in `MODULE_COPY` and in `promo.html`, then
  `node docs/app-store/promo/render.mjs` with the repo served on 8777 and Chrome open on 9222.
- Submit the IAPs with the first build; they are reviewed together with the app.
- **Universal purchase** is automatic when iPhone, iPad and Mac are one app record with one
  bundle id. Check the Mac build is not a separate record.

**App Review notes.** The "Complete Your Studio" explanation, the sandbox route to the packs and the
try-before-you-buy behaviour are in the one note under "App Review notes" above; there is no separate IAP note.

**Testing in Xcode, no store account needed:**

1. Add `ios/App/ModRiffPacks.storekit` to the project (File > Add Files; leave
   "Add to targets" **unchecked**: it must not ship in the app). It replaces
   `ModRiffPro.storekit`, which sold the single product that was never released.
2. Product > Scheme > Edit Scheme > Run > Options > **StoreKit Configuration**
   > ModRiffPacks.storekit.
3. Run on a device or simulator. In a debug build, Settings > About has a **Test as** row:
   **Free**, **Everything**, and a button per pack that toggles it, with no purchase, and
   remembers the choice across launches. A release build has no such row (the host defines
   `__modDebug` only under `#if DEBUG`, and the page ignores the override without it). The
   same row shows on a page served from localhost, and never on a deployed one. The
   TestFlight **tester build** (`MODRIFF_TESTERS=1 ios/archive-ios-store.sh`) has it too, only
   under a sandbox receipt; upload that one for testers and a plain run of the script for App Review. Debug >
   StoreKit > Manage Transactions lets you refund and Ask-to-Buy a test purchase.
4. Then the same on a **sandbox account** against the real products, once they exist in App
   Store Connect.

**Test matrix:**

- Buy Full Studio fresh; every pack unlocks.
- Buy one pack: the one-pack upgrade appears, and plain Full Studio does not.
- Buy a second, then a third: the offered upgrade (and its price) changes each time.
- Buy a Complete Your Studio upgrade: everything unlocks, and no offer is shown any more.
- Delete the app and reinstall; **Restore Purchases** brings every pack back.
- Buy, then airplane mode and relaunch: the packs stay (the answer comes from the cache the
  host injects, not a network call).
- Refund a pack in Debug > StoreKit > Manage Transactions: that pack locks again on the next
  launch or when the update arrives, and the offer recalculates.
- Ask to Buy: pending, then approved.
- A free build opens a `.modriff.json` made with every pack: it loads, the parts the
  install does not own play stand-ins, one banner names the packs it needs, and saving again
  keeps the originals.

## Owner to do in App Store Connect

- Apply to the Small Business Program (15% commission instead of 30%).
- Submit a featuring nomination for the app (App Store Connect > Featuring Nominations).
- Run a real sandbox purchase on a phone before resubmitting (the shot-list recording does it once).
- Set the Full Studio and Complete Your Studio prices above (launch, then the regular price on a schedule).

## Account steps the owner does

1. Apple Developer Program membership (annual fee), then App Store Connect.
2. Register the bundle ID `Handel.modRiff`. (Done, and it is permanent: an App Store Connect
   record's bundle ID cannot be changed. The code once said `com.handelmusic.modriff`; it was
   renamed to match what was registered. Product IDs and the CloudKit container follow it.)
3. New App: name, language English (U.S.), bundle ID, SKU (any unique string,
   for example `modriff-ios-1`).
4. Paste the text above, upload screenshots, set price and availability.
5. Build the packages: `npm run ios:archive` (iPhone/iPad `App.ipa`) and
   `ios/mac-catalyst/archive-mac-store.sh` (Mac `App.pkg`). Both pick the build number
   (date and time) themselves. Upload the file with Transporter (drag it in; Xcode's own
   upload fails with "Credentials Error ... providerId" when its Apple ID session is stale).
   Apple rejects a build whose Capacitor/Cordova framework is unsigned (ITMS-91065): the iPhone
   script swaps in the official signed frameworks for the archive and restores ours on exit;
   the Mac frameworks, which need a Catalyst slice, are signed with the team's own certificate
   by `build-capacitor-xcframeworks.sh`. An iOS Xcode Archive using the Mac copies
   now fails with instructions to use `npm run ios:archive`; signing the embedded
   frameworks as part of app signing does not replace the SDK-origin signatures.
6. Add the build to the version, answer App Privacy as above, submit for review.
7. Once live: put the App Store URL on the landing page button (`#get-app` in
   `index.html` of the site repo) and in the Dutdut Records site's app entry.
8. Open the app's Analytics dashboard and Sales and Trends; verify reports for the
   distributed release as described above. No analytics integration/upload is needed.

### SDK signature upload gate (7.5)

Capacitor **8.5.2 already ships signed SDKs**. No upgrade is needed for ITMS-91065.
The upstream [8.5.2 Swift package](https://github.com/ionic-team/capacitor-swift-pm/blob/8.5.2/Package.swift)
publishes both zip checksums; `ios/capacitor-sdk.json` pins those checksums and
the vendor's signing team, `9YN2HU59K8` (Drifty Co.). Update that file deliberately
alongside the npm and CapApp-SPM versions on a future upgrade. The shared fetcher
never borrows an unknown SDK version from another project's DerivedData.

[Apple requires SDK signatures](https://developer.apple.com/support/third-party-SDK-requirements/)
for binary Capacitor and Cordova dependencies. `-create-xcframework` replaces the
outer vendor signature when we add Catalyst. The iOS archive script therefore
uses fresh copies extracted from checksum-verified vendor zips and verifies their
signatures and privacy manifests. It restores the Mac copies on success, failure,
SIGINT or SIGTERM. Do not build Mac Catalyst concurrently with an iOS archive.

The old check for the existence of `Signatures/*.signature` was insufficient:
Xcode can write such a file with `signed=false`. Before export, the script checks
both records' signed flag, vendor, certificate data, platform and code hashes
against the pinned SDKs. After export, it checks the records inside `App.ipa`,
the distribution signatures on the app, extension and frameworks, the signing
team, device architectures, privacy manifests and absence of `get-task-allow`.
`archive-signature-verification.log` and `signature-verification.log` are saved
beside the archive. These local checks
establish upload readiness; successful App Store Connect processing is confirmed
only after upload.

Output defaults to `~/Desktop/modRiff-ios-testflight/export/App.ipa`. To use a
different directory: `OUT=/absolute/output/path npm run ios:archive`. The optional
`npm run ios:archive -- upload` first exports and verifies locally, then invokes
Xcode's upload. The ordinary command exports only.
