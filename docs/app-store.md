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
  `docs/app-store/screenshots/` (see Screenshots below).
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
| Price | Free app, with eleven In-App Purchases: seven packs and the Full Studio bundle (below). The prices are set in App Store Connect, not in the code |

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

## In-App Purchases: seven packs and a bundle

The code is in (`ios/App/App/ModBilling/ModBilling.swift`, StoreKit 2, behind
`window.modBilling`; the design and the table of what each pack holds are in section 4 of
`v5-architecture.md`). The page side is measured. **The Swift has not been compiled and the
purchase flow has not been run**: that needs your Mac and App Store Connect.

**App Store Connect** (My Apps > mõdRïff > Monetization > In-App Purchases). All eleven are
**Non-Consumable**, with these Product IDs exactly. IDs can never be reused, even after a
product is deleted, so check each one before creating it.

| Product ID | Reference name | Display name (max 30) | Description (max 45) | Price |
|---|---|---|---|---|
| `Handel.modRiff.sampler` | Sampler Engine | Sampler Engine | Sampled instruments, kits, and your samples | $5.99 |
| `Handel.modRiff.synth` | mõdSynth Engine | mõdSynth Engine | Full synth sound sets and every mõdFX effect | $4.99 |
| `Handel.modRiff.groove` | Groove Pack | Groove Pack | World grooves, kits, odd meters, aux channel | $3.99 |
| `Handel.modRiff.theory` | Theory Pack | Theory Pack | Every scale, chord type, and voicing | $3.99 |
| `Handel.modRiff.practice` | Practice & Perform Pack | Practice & Perform Pack | Practice tools, timeline, Stage, iReal batch | $3.99 |
| `Handel.modRiff.studio` | Studio Pack | Studio Pack | Stems, full exports, unlimited saves | $4.99 |
| `Handel.modRiff.sounds` | Sounds Pack | Sounds Pack | Keys, pads, vibes, and vintage basses | $1.99 |
| `Handel.modRiff.fullstudio` | Full Studio | Full Studio | Every pack, plus everything added later | $12.99 |
| `Handel.modRiff.fullstudio.from1` | Full Studio Upgrade 1 Module | Complete Your Studio | Unlock every pack you don’t own yet | $10.99 |
| `Handel.modRiff.fullstudio.from2` | Full Studio Upgrade 2 Modules | Complete Your Studio | Unlock every pack you don’t own yet | $6.99 |
| `Handel.modRiff.fullstudio.from3plus` | Full Studio Upgrade 3+ Modules | Complete Your Studio | Unlock every pack you don’t own yet | $3.99 |

The display names and descriptions are the page's own copy (`MODULE_COPY` in `index.html`),
and a test holds `ios/App/ModRiffPacks.storekit` to the same words, so paste from there.

- **Family Sharing: on for all eleven** (it cannot be turned off once a product is live, and
  mixing on and off is how a family ends up owning half a bundle).
- Prices: the launch prices above, raised or lowered later. Nothing in the app names a
  price; the sheet and the store show whatever the store returns for the user's storefront,
  and the page compares the Complete Your Studio price with what is left to buy one at a
  time and offers whichever is cheaper.
- A review screenshot per product (any locked control, tapped; or Settings > About > Store).
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
> sandbox: tap any locked drum kit (the free kits are the Linn and 808), buy the Groove
> Pack, then tap any other locked control — the sheet now shows "Complete Your Studio" with
> the line "Unlock everything for $… more." Restore Purchases is on that sheet, on the store
> screen and in Settings > About.

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
5. In Xcode: set the signing team, add `PrivacyInfo.xcprivacy` to the target,
   Product > Archive > Distribute > App Store Connect.
6. Add the build to the version, answer App Privacy as above, submit for review.
7. Once live: put the App Store URL on the landing page button (`#get-app` in
   `index.html` of the site repo) and in the Dutdut Records site's app entry.
