import Capacitor
import UIKit

/// Keeps the screen on, as `modPlatform.keepAwake` asks.
///
/// **Why a plugin.** The page's own way is the Screen Wake Lock API, and a WKWebView does not have
/// it: `navigator.wakeLock` is simply absent inside the app, so neither a long loop nor the Stage
/// view kept the phone from locking (and a locked phone stops the page's audio timers). The way a
/// native app says "do not dim" is `UIApplication.isIdleTimerDisabled`.
///
/// The page holds the reasons (playing, Stage up) and sends one yes or no here, only when it
/// changes. iOS restores the idle timer by itself when the app goes to the background, and the
/// page asks again when it comes back, so a forgotten `false` cannot leave a phone awake in a pocket.
///
/// Main thread only, as UIKit requires; resolves at once.
@objc(ModWake)
public class ModWake: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModWake"
    public let jsName = "ModWake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    /// Same proof the other plugins print: a plugin declared in the app target is not discovered
    /// on its own (see ModRiffViewController).
    override public func load() {
        NSLog("[ModWake] plugin registered")
    }

    @objc func set(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve(["on": on])
        }
    }
}
