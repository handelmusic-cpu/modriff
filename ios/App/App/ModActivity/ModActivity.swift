import Capacitor
import Foundation
#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit
#endif

/// The red light in the Dynamic Island while a bounce is being recorded, as `modPlatform.bounceLight` asks.
///
/// **Why a plugin.** A web view cannot draw in the Dynamic Island; only a Live Activity can, and ActivityKit
/// is native. The page holds the one fact (a bounce is, or is not, being recorded) and sends a yes or no here,
/// only when it changes, from `_updateRecBtn`.
///
/// **What it does not do.** It draws nothing itself: the island's look is the widget extension's
/// (`ios/App/ModBounceActivity`, see `docs/dynamic-island.md`). With no extension in the build, or Live
/// Activities switched off for the app, `set` resolves `started: false` and nothing is shown. It never rejects:
/// a missing light must not break a bounce.
///
/// **A stuck light.** A Live Activity outlives the process that started it, so a bounce interrupted by a crash
/// or a force-quit would leave a red light on for hours. `load()` ends any activity left over from an earlier
/// run, and `set(on: false)` ends every one there is, not only the one this instance remembers.
///
/// Main actor only where ActivityKit requires it; resolves when the request has been made.
@objc(ModActivity)
public class ModActivity: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModActivity"
    public let jsName = "ModActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    /// Same proof the other plugins print: a plugin declared in the app target is not discovered
    /// on its own (see ModRiffViewController).
    override public func load() {
        NSLog("[ModActivity] plugin registered")
        endAll()
    }

    @objc func set(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false, "reason": "needs iOS 16.2"])
            return
        }
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        if !on {
            endAll()
            call.resolve(["started": false])
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["started": false, "reason": "Live Activities are off for this app"])
            return
        }
        // One light at a time: a second `true` while one is up changes nothing.
        if !Activity<ModBounceAttributes>.activities.isEmpty {
            call.resolve(["started": true])
            return
        }
        do {
            let content = ActivityContent(state: ModBounceAttributes.ContentState(startedAt: Date()), staleDate: nil)
            _ = try Activity.request(attributes: ModBounceAttributes(name: "Bounce"), content: content, pushType: nil)
            call.resolve(["started": true])
        } catch {
            NSLog("[ModActivity] request failed: %@", String(describing: error))
            call.resolve(["started": false, "reason": String(describing: error)])
        }
        #else
        call.resolve(["started": false, "reason": "no ActivityKit"])
        #endif
    }

    private func endAll() {
        guard #available(iOS 16.2, *) else { return }
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        for activity in Activity<ModBounceAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        #endif
    }
}
