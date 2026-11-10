# The red light in the Dynamic Island while bouncing (6.8)

**Status: compiles on the Mac, not yet seen on a screen.** The page side is tested (`tests/bounceactivity/probe.js`). The
app and the `ModBounceActivity` widget extension both build for the iOS 27.2 simulator (Xcode 27.2) and the `.appex` is
embedded in `App.app/PlugIns`; the extension target is in `project.pbxproj` (added with the `xcodeproj` gem, not by hand).
In the simulator the app launches and logs `ModActivity` in the `capacitorDidLoad` plugin list (check 1 below). Nothing has
been *shown* in the island yet: the simulator's page stayed blank in the one attempt and a bounce was never started, so
checks 2 to 9 are still open. Keep it unmerged until they are done on a phone.

**Update, on the owner's iPhone 17 Pro Max:** the app with the extension builds, signs and runs there. While the app is
in front the island shows nothing of ours (ActivityKit's rule), so the page draws its own light: `#bounce-dot`, a solid
12pt disc in the record red `#e5384f` just left of the island, shown only on an island phone held upright. The owner
confirmed it looks right. The Home-screen and lock-screen Live Activity (checks 3, 5 to 9) is not yet confirmed.

## 6.9.9.9.9.9.9: why the light was faint, and the clock

The light in the island was drawn at 45% opacity for the whole bounce. `RedLight` animated `opacity` from 1 to 0.45 with
`repeatForever`, started in `onAppear`; a Live Activity is a snapshot the system renders, it does not run a view's repeating
animations, so the view sat at the animation's end state. It is a solid, fully opaque disc now (12 pt compact and minimal, with a
glow) and nothing in the extension depends on animation: the system-run clock beside it is what shows the bounce is alive.
The compact right half is that clock (`Text(startedAt, style: .timer)`, 46 pt, scaled down for an hour-long take).
While the app is in front the page draws its own light and, since this release, its own clock to the right of the island
(`#bounce-clock`, mirrored on `#bounce-dot`, same rules: island phone, upright, only while a take runs). Compiles; **not seen on a phone.**

## What it is

A bounce records for as long as you play, often with the app in the background or the phone locked. While one runs, a
**Live Activity** puts a pulsing red light in the Dynamic Island (and on the lock screen): compact and minimal are the
light alone; expanded and the lock screen add "Bouncing" and a running clock. When the bounce stops, the light goes.

Only a Live Activity can draw in the island, and a Live Activity needs a **widget extension**. The page cannot do it, and
neither can a Capacitor plugin on its own, so there are three pieces:

| piece | where | state |
|---|---|---|
| the page asks | `modPlatform.bounceLight(on)`, called from `_updateRecBtn` (only when the state changes) | done, tested |
| the app starts and ends the activity | `ios/App/App/ModActivity/ModActivity.swift` (plugin `ModActivity`, method `set({on})`), registered in `ModRiffViewController`; `NSSupportsLiveActivities` in `Info.plist`; both `.swift` files are in the app target in `project.pbxproj` | written, unbuilt |
| the extension draws it | `ios/App/ModBounceActivity/` (`ModBounceActivityBundle.swift`, `ModBounceLiveActivity.swift`, `Info.plist`) | in the project as target `ModBounceActivity`, builds and embeds |

`ModBounceAttributes.swift` (in `ios/App/App/ModActivity/`) is the type both sides share, so it belongs to **both** targets.

## Adding the extension in Xcode (once)

The extension is a second target; it is not in `project.pbxproj` because a hand-edited target on a machine that cannot build
is a good way to break the whole project. On the Mac:

1. Open `ios/App/App.xcodeproj`. **File > New > Target… > Widget Extension.** Product name `ModBounceActivity`. Untick
   *Include Live Activity*, *Include Configuration App Intent* and *Include Control*. Finish; when it asks to activate the
   scheme, say Cancel (keep the App scheme).
2. Delete everything Xcode generated in the new `ModBounceActivity` group (the `.swift` files, `Assets.xcassets`, its
   `Info.plist`). Move to Trash.
3. Add the three files from `ios/App/ModBounceActivity/` to the group (*Add Files…*, **target: ModBounceActivity only**,
   do not copy). If Xcode made its own `ModBounceActivity/Info.plist`, point the target's *Info.plist File* build setting at
   this one instead.
4. Select `ios/App/App/ModActivity/ModBounceAttributes.swift`, and in the File inspector tick **ModBounceActivity** as well as
   **App** under Target Membership.
5. Target **ModBounceActivity** > Signing & Capabilities: Team `6985K934BS`. Bundle identifier `Handel.modRiff.ModBounceActivity`
   (the app's is `Handel.modRiff`; an extension's must start with it). Deployment target **16.2** (the app stays on 15.0;
   `ModActivity` guards every ActivityKit call with `#available(iOS 16.2, *)`).
6. Target **App** > General > *Frameworks, Libraries, and Embedded Content*: `ModBounceActivity.appex` should be there as
   *Embed Without Signing* / *Embed Foundation Extensions* (Xcode adds it when the target is created); check it is.
7. Build the App scheme for a device.

## What to check on the phone

| | do | expect |
|---|---|---|
| 1 | Xcode console on launch | `[ModActivity] plugin registered`, and `ModActivity` in the `[ModRiff] capacitorDidLoad` list |
| 2 | Settings > mõdRïff on the phone > Live Activities | listed and on (iOS adds it once the key is in the build) |
| 3 | Start a loop, tap Bounce, then swipe Home | a red dot pulses at the left of the island with a clock at the right; a long-press opens "Bouncing" and the clock |
| 4 | Tap the island | opens mõdRïff |
| 5 | Lock the phone during a bounce | the lock screen shows the dot, "Bouncing" and the clock |
| 6 | Back in the app, tap Stop | the light disappears at once; the .wav and .mid are delivered as before |
| 7 | Start a bounce, force-quit the app, reopen it | the light from the dead bounce is ended on launch (`ModActivity.load()`), not left on for hours |
| 8 | Live Activities switched off for the app | the bounce works exactly as before; nothing in the island |
| 9 | iPhone without a Dynamic Island (any before 14 Pro) | the lock-screen banner only; the bounce works as before |

## Known unknowns

- **Foreground.** As I understand ActivityKit, an app's own Live Activity does not show in the island while that app is the
  one on screen; it shows when you are in another app, on the Home Screen or locked. In the app the bounce button already
  blinks red. If you want a mark while the app is frontmost too, it has to be in the page, not the island.
- **iOS 16.2** is the floor for `ActivityContent` and `end(_:dismissalPolicy:)`; on 16.0 and 16.1 `set` resolves `started: false`.
- A Live Activity is ended by the system after eight hours whether or not it was ended by us; a bounce is not that long.
- **No push updates.** The clock is `Text(_, style: .timer)`, which the system runs itself, so the page never updates the
  activity and a suspended web view cannot freeze it.
