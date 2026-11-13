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

**Name** (30): `mõdRïff`

Characters outside plain ASCII are allowed. If App Store Connect rejects the
name as taken, `mõdRïff: Chord Groovebox` (23) is the fallback.

**Subtitle** (30): `Every part, always in key` (25)

**Promotional text** (170, editable any time without a new build):

> Pick a key and play: chords, drums, bass, melody and synth always agree, so nothing you touch sounds wrong. Free to start. No account, no ads, no subscription.

(159)

**Keywords** (100, comma-separated, no spaces after commas):

```
groovebox,chord,drum machine,synth,sequencer,music theory,midi,sampler,beat maker,songwriting,jam
```

(97.) Do not repeat words already in the name or subtitle ("key", "every"), do not use the category
name, and do not use another product's name: an `iReal` keyword would be a trademark rejection.

**Description** (2167 of 4000). One line per paragraph on purpose: App Store Connect keeps every line
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
mõdRïff is free to use. Major, minor, pentatonic and blues scales, two drum kits, five saved songs and 30-second audio exports are included. Add only what you need with one-time packs: Sampler Engine, mõdSynth Engine, Groove, Theory, Practice & Perform, Studio and Sounds. Or get Full Studio for every pack, including the ones added later. No subscriptions.

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

Third-party material is not credited on the page. The licences that require credit (CC BY 3.0, and the
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

> mõdRïff needs no account or sign-in and has no server. Everything runs on the
> device and works offline.
>
> To see it work: open the app, tap Start, then press the green play button in
> the bottom bar. Tap the chord pads on the Live tab, or press Drums and tap
> steps in the grid.
>
> Microphone: requested only if you open the Sampler and choose to record.
> Bluetooth: requested only if you press the Bluetooth button in
> Settings > MIDI, to pair a Bluetooth MIDI keyboard (not needed to review).
> iCloud sync is optional and off by default. When it is on, songs, setups and
> saved patches are kept in the person's own private iCloud (CloudKit) database;
> the developer has no access to it. (Not in a build until the iCloud capability
> is added; see docs/v5-architecture.md, "iCloud sync".)
> Camera: requested only if you choose Camera when importing a chord sheet from
> a photo (Songs > File > Import a chord sheet). The picture is read on the
> device and is not stored or sent anywhere.
>
> Background audio is enabled so a song keeps playing when the screen locks.
> Contact: support@modriff.com

Background audio (`UIBackgroundModes: audio`) is a thing review checks for:
the app genuinely plays music in the background, which the note above says.

## Screenshots

The upload set is `docs/app-store/screenshots/v6.9.9.9.9.9.9.9a/` (taken from build 6.9.9.9.9.9.9.9a in the iOS
Simulator; the version shows on the splash shot). Tabs are Live, Studio, Song, Sound. No pack is locked in them and
no other company's product name is visible. Everything older (`6.9in-` and `13in-` in this folder, `v6.9.2/`) shows
retired tab names or the old kit names and is history only: do not upload it. `v6.9.6/` is the Duo layout reference.

| set | device | size | files |
|---|---|---|---|
| iPhone 6.9" | iPhone 18 Pro Max | 1320 x 2868 | `iphone-6.9in-01-splash` to `05-sound` |
| iPad 13" | iPad Pro 13-inch (M5) | 2064 x 2752 | `ipad-13in-01-splash` to `05-sound` |

Order in both: splash, Live, Studio, Song, Sound. Each has a song loaded (Random), the transport playing and a chord
lit. Sizes checked with `sips`. The iPad splash also shows RESUME because the shots came from one session.

How to redo them: build the Simulator app with the optimiser on and the debug switch kept (a plain Debug build runs
the C++ engine at -O0 and stalls the page; a Release build has no `__modDebug`, so no unlock switch):
`xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO GCC_OPTIMIZATION_LEVEL=3 SWIFT_OPTIMIZATION_LEVEL=-O build`.
Pin the status bar with `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100`.
Open the app once, quit it, then write `modo-dev-tier` = `pro` and `modo-tour-ch1` = `1` into the app's WebKit
`localstorage.sqlite3` (table `ItemTable`, values UTF-16LE blobs) so every pack is open and the tour stays closed;
launch, tap Random, tap play, tap a chord, then `xcrun simctl io <udid> screenshot`. Give each device its own
Simulator: the shared one gets other sessions' builds installed over it. Driving a new Simulator needs the owner's
approval in the app once per device.

**IAP review shots** (`screenshots/iap/`, 1320 x 2868) were not retaken here: they are the 6.9.9.3a set. Retake them if
a pack's copy, price or the sheet changed since (the Theory Pack copy changed at 6.9.9.9.9.9.9.7d).

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

An **app preview video** (15 to 30 s) is optional; screen-record playing a progression over a beat.
Consider short captions on a coloured background, which is what most music apps do.

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
| `Handel.modRiff.studio` | Studio Pack | Studio Pack | Stems, full audio and MIDI export, no limits | $4.99 |
| `Handel.modRiff.sounds` | Sounds Pack | Sounds Pack | Tonewheel organ, e-piano, pads, vibes, bass | $1.99 |
| `Handel.modRiff.fullstudio` | Full Studio | Full Studio | Every pack, in one purchase | $12.99 |
| `Handel.modRiff.fullstudio.from1` | Full Studio Upgrade 1 Module | Complete Your Studio | Finish the set: every pack you don’t own yet | $10.99 |
| `Handel.modRiff.fullstudio.from2` | Full Studio Upgrade 2 Modules | Complete Your Studio | Finish the set: every pack you don’t own yet | $6.99 |
| `Handel.modRiff.fullstudio.from3plus` | Full Studio Upgrade 3+ Modules | Complete Your Studio | Finish the set: every pack you don’t own yet | $3.99 |

The display names and descriptions are the page's own copy (`MODULE_COPY` in `index.html`),
and a test holds `ios/App/ModRiffPacks.storekit` to the same words, so paste from there.

The descriptions are written to sell, within 45 characters, and each says what the pack does,
not what it is called. Two words are kept out of every field the store shows, because they are
other companies' trademarks: **iReal** (the Practice & Perform line used to end "iReal batch",
now "chart import") and **Rhodes** (the Sounds line says "electric piano", as the pack's own list
does). The pack's list inside the app says "Chart import: a whole playlist at once" (6.9.9.9.9.5), so no
trademark is named in the sheet either. The `iap/Handel.modRiff.practice.png` review shot was taken before
that and still shows the old "iReal" bullet: retake it before upload (the line is `MODULE_COPY.practice`).

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
  Sounds and Studio), and `Full Studio` is the All packs screen. They were retaken at 6.9.9.3a
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

**App Review notes — paste this.** Without it the three Complete Your Studio products look
like hidden purchases:

> mõdRïff is free to use and sells seven optional packs and a bundle, all one-time purchases.
> Tapping any locked control opens a sheet that names it and shows the pack and its price;
> Settings > About > Store lists every pack. The three "Complete Your Studio" products are
> upgrade prices for **Full Studio** and appear only after a pack has been bought: with none
> bought the bundle is offered as "Full Studio" ($12.99); after buying one pack it is
> offered as "Complete Your Studio" at the one-pack upgrade price, after two at the
> two-pack price, and after three or more at the three-pack price. To see one in the
> sandbox: tap any locked drum kit (the free kits are Digital 1 and Analog 1), buy the Groove
> Pack, then tap any other locked control — the sheet now shows "Complete Your Studio" with
> the line "Unlock everything for $… more." Restore Purchases is on that sheet, on the store
> screen and in Settings > About.
>
> A locked thing can usually be tried before it is bought. For example the sampler: on a free
> install its pads are drawn locked (dimmed, with a padlock). Tapping one plays that pad's
> sample once, quietly, up to twice per pad; after that, a tap opens the sheet. The preview is
> never part of a song or a recording.
>
> Locked drum kits and grooves are tried in the pack sheet: tap one, then **Hear it** plays a short
> fixed demo of the Groove Pack (the song is paused and comes back as it was). **Stop** or closing the
> sheet ends it.
>
> Locked Sounds Pack voices (organ, electric piano, pad, piano, vibes, the two vintage basses) are tried
> from the voice list: a tap plays the current chord once, quietly, up to twice per voice; after that, a
> tap opens the sheet. The voice a part is on never changes.

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
   same row shows on a page served from localhost, and never on a deployed one. Debug >
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

## Account steps the owner does

1. Apple Developer Program membership (annual fee), then App Store Connect.
2. Register the bundle ID `Handel.modRiff`. (Done, and it is permanent: an App Store Connect
   record's bundle ID cannot be changed. The code once said `com.handelmusic.modriff`; it was
   renamed to match what was registered. Product IDs and the CloudKit container follow it.)
3. New App: name, language English (U.S.), bundle ID, SKU (any unique string,
   for example `modriff-ios-1`).
4. Paste the text above, upload screenshots, set price and availability.
5. Build the packages: `ios/archive-ios-store.sh` (iPhone/iPad `App.ipa`) and
   `ios/mac-catalyst/archive-mac-store.sh` (Mac `App.pkg`). Both pick the build number
   (date and time) themselves. Upload the file with Transporter (drag it in; Xcode's own
   upload fails with "Credentials Error ... providerId" when its Apple ID session is stale).
   Apple rejects a build whose Capacitor/Cordova framework is unsigned (ITMS-91065): the iPhone
   script swaps in the official signed frameworks for the archive and restores ours on exit;
   the Mac frameworks, which need a Catalyst slice, are signed with the team's own certificate
   by `build-capacitor-xcframeworks.sh`.
6. Add the build to the version, answer App Privacy as above, submit for review.
7. Once live: put the App Store URL on the landing page button (`#get-app` in
   `index.html` of the site repo) and in the Dutdut Records site's app entry.
8. Open the app's Analytics dashboard and Sales and Trends; verify reports for the
   distributed release as described above. No analytics integration/upload is needed.
