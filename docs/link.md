# Ableton Link: design

Status: **built and merged in v6.9.9.9.9.9.9.9.1** (tempo, beat and bar-line start; no Start Stop Sync). On an iPhone it finds no peers until Apple grants the multicast entitlement (section 2). Run `npm run ios:frameworks` on a fresh clone: it fetches the SDK.
Researched 2026-11-13 against the sources in section 8; check them again if this is picked up much later.

## 1. What was found

**Two SDKs, and only one is usable here.**

| | LinkKit (iOS SDK) | Link (cross-platform source) |
|---|---|---|
| form | prebuilt `LinkKit.xcframework` (static, C API `ABLLink.h`) in a zip on the GitHub release | C++ source |
| licence | Ableton Link SDK License v2.0, free of charge | GPLv2+, or a proprietary licence by writing to link-devs@ableton.com |
| App Store | yes, this is what it is for | GPL build: no (Ableton's own README: "the GPL is not compatible with the iOS App Store") |
| slices | iOS, iOS Simulator, **Mac Catalyst** (its makefile builds all three; Catalyst since 3.1.0, Apple silicon since 3.1.4) | anything, but see licence |

So: **LinkKit, for iPhone, iPad and the Mac app alike.** No source build, no compile-out on Catalyst.
Latest official release is `LinkKit-4.1.3` (2026-10-19, deployment target iOS 15.0, same as ours).
`LinkKit-5.0b1` (Arrangement Sync) calls itself a pre-release; Ableton says to ship on an official one.

**What the licence asks** (by using LinkKit you agree to it; there is no sign-up, form or approval by Ableton):
- No redistribution of the SDK. This repo is public, so **the xcframework is never committed**: a fetch script
  pinned to a tag and a checksum, like `npm run ios:frameworks`.
- **Link may not be sold as an In-App Purchase.** It is free for everyone, outside every pack.
- The UI guidelines are binding (breaking them breaks the licence). Only Ableton's own assets for anything that
  shows their identity.
- Ableton may revoke on breach (14 days to cure). German law, Berlin.
- The grant says "iOS applications". The SDK ships a Catalyst slice, so the Mac app is plainly intended, but
  the words do not say Mac. One email to link-devs@ableton.com settles it (open question 3).

**What the UI guidelines require** (PDF v1.10, shipped with the SDK):
- Ableton's **preference pane** (a `UIViewController` from LinkKit, not configurable: title "Ableton Link", the
  on/off switch, In-App Notifications switch, "Connected to N apps", a link to Ableton.com/Link) **must** be
  reachable from the app. Link is switched on there and nowhere else; the app cannot switch it by code.
- The way in is a settings row, an action-sheet row or the supplied "Link" button. As text: "The name Ableton
  Link must always be used in full when displayed in text", two words, capital A and L. The row shows the state,
  and the words are **Enabled** / **Disabled**.
- **In-app notifications are mandatory**: LinkKit draws its own banner ("1 Link") in Ableton's typeface when a
  peer joins or leaves. The user can turn them off in the pane; the app may not.
- The badge and promotion wording are optional: they apply only if we advertise Link (listing, screenshots, site).

**What Apple asks** (this is the only approval with a wait):
- `com.apple.developer.networking.multicast` entitlement, **requested from Apple by the account holder** with
  a form. Needed even to run on a phone from Xcode; the Simulator and the Mac do not need it to build.
- `NSLocalNetworkUsageDescription` in `Info.plist`; iOS shows its local-network prompt the first time Link is
  switched on. Declined means no peers, silently.
- The iPhone target signs with no entitlements file today; it gets one. The Mac sandbox needs
  `com.apple.security.network.server` beside the existing `network.client` (Link receives UDP).
- Review notes gain a paragraph: local network only, no server, no account, nothing collected. The "talks to
  no server" notes in `Info.plist` and `AppMac.entitlements` stay true but get a clause about local peers.

## 2. Decisions for the owner

Decided by the owner on 2026-11-13 ("make it work, adjust whatever we need"):

1. **The name.** "Ableton Link" is the third standing exception to the no-product-names rule (`CLAUDE.md`): the
   Settings row, its Enabled/Disabled state and Ableton's own pane and banner. Nowhere else, and no badge.
2. **Start Stop Sync: not built.** Play and Stop stay local; Play lands on the session's bar line.
3. **A tempo the app moves.** A tempo the user moves is proposed to the session. The practice trainer's steps are
   proposed. A ritardando is ours alone: the session is not followed while it lasts. Loading a song with others
   connected does not move their tempo; the readout goes back to the session's.

Still the owner's to do (nobody else can):

- **Ask Apple for the multicast entitlement** (developer.apple.com/contact/request/networking-multicast, account
  holder only). Suggested text: "Ableton Link, tempo sync between music apps on the local network, multicast UDP
  to 224.76.78.75:20808, see ableton.github.io/linkkit". Until it is granted and added
  (`com.apple.developer.networking.multicast` in an iPhone entitlements file, and the provisioning profile
  regenerated), **Link on an iPhone or iPad shows no peers.** The Simulator and the Mac app do not need it.
- **Mac wording.** One line to link-devs@ableton.com: the licence says "iOS applications"; is a Mac Catalyst build
  of the same app covered?
- **Never an In-App Purchase**, and the SDK is never committed (the licence; the repository is public).

## 3. Engine design

**Where the clock is.** `ModEngineHost.mm`: the render callback counts frames (`_frames`); the sequencer thread
(`HostSeq`, under the host's lock) expands every part 150 ms ahead of that counter (`lookahead`) on one
`TempoMap` (`native/modsynth/tempomap.h`: quarter-note BPM as a piecewise function of the frame, jumps and
linear ramps). Nothing in it knows host time: `ModEngine.swift` drops the render block's `AudioTimeStamp`.
Link speaks only in host time **at the output**.

**Shape: the engine keeps its tempo map; Link steers it.** Link does not replace the clock, and the C++ core
(`native/modsynth/`) does not learn about Link. Three pieces, all in the host:

1. **Frame to host time.** The render callback passes `mHostTime` in. Output host time of a block's first frame
   = `mHostTime + AVAudioSession.outputLatency` (re-read on route change; `ModEngine.swift` already observes
   it) + any latency the master adds. This is the number Ableton's 3 ms alignment test measures.
2. **Audio thread: read and publish.** Each block: `ABLLinkCaptureAudioSessionState` (realtime-safe), then a
   snapshot `{block frame, output host time, session tempo, Link beat at that time for the quantum, peers}`
   into a lock-free slot. It also drains a tiny queue of tempo proposals from the sequencer thread and commits
   them (`ABLLinkSetTempo` at the host time of their frame). Session state is **only** modified here, as the
   Link docs recommend. No lock, no allocation.
3. **Sequencer thread: steer.** Each wake it reads the snapshot and compares the Link beat with the tempo map's
   beat at the same frame (modulo the quantum, measured from the transport epoch):
   - session tempo differs: `tmap.jump` at the next uncommitted step, exactly as a page tempo change lands
     today. A peer's change is therefore heard up to 150 ms late, then corrected by:
   - small phase error (clock drift between the audio device and host time, and the late jump above): a bounded
     trim of the map's tempo (a fraction of a percent) until it is gone. Inaudible, never a jump.
   - large error (joining a session mid-play): the beat jumps to the session's phase at the next bar line.
     Ableton's test plan allows a jump for the joiner and forbids one for those already in the session.

**Quantum** = the bar, in quarter notes (`barSteps / 4`): 4 in 4/4, 3 in 3/4 and 6/8. No control for it; it
follows the meter. Link's beat is our quarter note, because `#bpm` is quarter-note BPM.

**Play is a quantized launch.** The five clocks already start on one first bar (`seqTransportStart`, checkpoint
E). With peers connected, that first frame becomes the frame of the session's next quantum boundary at least
`leadMs` away (`ABLLinkTimeAtBeat`), so Play waits up to a bar and lands on everyone's downbeat. The page shows
the wait on the Play button (slice 3). Alone, or disabled, nothing changes: start and tempo are bit-for-bit
today's (Ableton's tests TEMPO-5 and BEATTIME-1 require exactly that).

**Tempo the app moves.**
- BPM field, tap tempo: proposed to the session at the frame they take effect.
- **Loading a song or setup while connected never proposes**; the app adopts the session tempo and shows it
  (test TEMPO-3). The saved tempo is not overwritten in storage by a session's.
- Tempo changes written in a song, practice-trainer steps, the ritardando ending (`seqTempoRampTo`) and its
  restore: **owner decision 5.** Recommended: propose them (a ramp as one proposal per step). The peers slow
  down with the band, which is what "anyone can change the tempo, the others follow" means, and it is what a
  DAW's tempo automation does. The alternative is to leave the session for the ramp and rejoin with a jump.
- Range: the map takes 1 to 1000, Link 20 to 999. Outside the app's own BPM range the engine plays a multiple
  or a half of the session tempo (test TEMPO-4).

**Everything else.**
- **Bounce and takes** record the engine in real time, so they record the session's tempo, changes included.
  Nothing to do; Bounce MIDI's frame mapping is unaffected (the map is still the truth).
- **Background.** Playing when left: Link stays active (the native claim already keeps the engine running).
  Not playing when left: `ABLLinkSetActive(false)`, and `true` again on becoming active (tests BACKGROUND-1, 2).
- **Page schedulers** (the free web page, whole-band recovery): **no Link.** The web page has no row. A
  recovered run takes the session tempo once and plays unsynced; diagnostics say so. LinkKit is not in the web
  build at all.
- **External MIDI clock** and Link are mutually exclusive, as the guidelines ask: enabling Link (seen through
  `ABLLinkSetIsEnabledCallback`) turns clock-follow off and greys it. MIDI clock *out* can stay (it then
  carries the session tempo).
- **Link Audio** (4.x, sharing audio channels) and **Arrangement Sync** (5.0 beta): not in scope.

## 4. UI: the smallest honest surface

- One row in Settings, under the existing sync/MIDI group: **Ableton Link** … **Enabled** / **Disabled**. It
  opens Ableton's pane natively (a Capacitor plugin call presenting `ABLLinkSettingsViewController` in a
  navigation controller; on the Mac a centred sheet). Peer count lives in that pane and in their banner, so the
  app adds none of its own.
- While connected, `#bpm` shows the session tempo (from the engine mirror's `tempo`, as now).
- Play shows the wait for the bar line.
- The row is hidden on the web page and when the plugin is absent. Help text: one paragraph. No emoji, no badge
  in the interface.

## 5. Slices, and what is measured on the Mac

(Heading kept for links.) What is built, and where:

- `ios/link/fetch-linkkit.sh`: the SDK by tag and sha256 into gitignored `ios/link/LinkKit/`; `npm run
  ios:frameworks` runs it.
- `ios/App/App/ModLink/`: the only code that includes the SDK. One `ABLLink`, the per-block audio hook, Ableton's
  pane, tempo proposals, active/inactive with the app's life cycle.
- `ModEngineHost`: `renderInto:...hostTime:`, the lock-free snapshot, `linkLaunch` (bar-line start), `linkSteer`
  (tempo and phase), the `link` block in `seqMirror`. Arithmetic in `native/modsynth/linksteer.h`.
- Page: `window._link` (the row, the tempo readout), plugin calls `linkState`, `linkSettings`, `linkTempo`.
- Test: `make -C native/modsynth linkhosttest` (the session faked, no SDK). Debug builds log the engine's Link
  numbers once a second (`[ModLink] t ...`).

Known limits:

- **A session that joins while we play, or an audio dropout longer than half a beat,** leaves the beats together
  but the bar lines a whole number of beats apart until the next Play (`link.offset` in the mirror). Those already
  playing may not jump, and the engine has no way to move every sequencer by a beat yet.
- **Play does not show the wait** for the bar line (up to one bar).
- **Session tempo outside 40 to 220** is played as it is; the readout shows the nearest end of its range.
- **Page schedulers** (the free web page, whole-band recovery) have no Link.

Not measurable on the Mac (lines in `docs/phone-test-checklist.md`): alignment by ear against another device
through speaker, headphones and Bluetooth (where `outputLatency` is right or wrong), the local-network prompt, a
real session.

## 6. Risks

- **Bluetooth output latency** is reported loosely by iOS; alignment there may miss 3 ms whatever we do.
  Other Link apps have the same limit.
- **The 150 ms horizon** makes a peer's tempo change land late by design. If slice 1's numbers say the trim
  cannot hide it, the fallback is a shorter look-ahead while connected, which costs pool headroom.
- **Entitlement refusal or delay** blocks the phone, not the design. Apple grants it routinely for Link.
- **SDK size**: the zip is 110 MB, but the static library is 2.1 MB for the iPhone (4.2 MB for each
  two-architecture slice), and only what is called links in.

## 7. Not decided here

Whether to advertise Link (listing line, badge on a screenshot), and the Ableton product listing (an email with
an icon and 200 characters to link-devs@ableton.com). Both wait for it to work.

## 8. Sources

- LinkKit documentation, integration guide, life cycle, test plan pointer: https://ableton.github.io/linkkit/
- Link concepts, threads and the full test plan: https://ableton.github.io/link/
- LinkKit repo, README (licence notice, iOS 14/17 entitlement, custom builds are GPL), `makefile` (Catalyst slice),
  releases: https://github.com/Ableton/LinkKit
- Ableton Link SDK License v2.0: https://github.com/Ableton/LinkKit/blob/master/LICENSE.md
- UI guidelines and promotion guidelines (PDF, v1.10): https://github.com/Ableton/LinkKit/tree/master/docs
- Catalyst support history: https://github.com/Ableton/LinkKit/issues/52
- Cross-platform Link, dual licence: https://github.com/Ableton/link
