import Capacitor
import UIKit
import WebKit

/// The bridge view controller, subclassed for one reason: to register the
/// app-target plugins — ModEngine, with ModMidi, ModBilling and ModHaptics
/// beside it.
///
/// Capacitor finds the plugins that live in Swift packages — the ones the CLI
/// writes into CapApp-SPM's Package.swift — by itself. It does **not** find a
/// CAPBridgedPlugin declared in the app target. That was an assumption worth
/// checking rather than believing: with the plugin written and compiling, a
/// NSLog in its load() never printed, which is what sent us here. The bridge
/// exposes registerPluginType for exactly this case.
///
/// Every app-target plugin has to be named here. One left out does not fail
/// to build and does not throw — it is simply absent from
/// `Capacitor.Plugins`, and the web side's feature test concludes the device
/// cannot do it. For MIDI that is indistinguishable from the WebKit situation
/// the plugin exists to fix, so the list is worth keeping deliberate.
///
/// Main.storyboard points at this class instead of CAPBridgeViewController.
class ModRiffViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        let ok = bridge != nil
        bridge?.registerPluginType(ModEngine.self)
        bridge?.registerPluginType(ModMidi.self)
        bridge?.registerPluginType(ModBilling.self)
        bridge?.registerPluginType(ModHaptics.self)

        // Two facts the page needs before its first line runs, because
        // window.modBilling answers isPro() synchronously on every render:
        //   __modProCached — the last entitlement StoreKit proved, so a paying
        //     user is Pro on the first frame, offline, with no round trip.
        //   __modDebug — set in debug builds only. It is what allows the
        //     setModTier('free'|'pro') test switch on the iOS provider; a
        //     release build never defines it, so there is no switch to find.
        var boot = "window.__modProCached=\(ModBilling.cachedEntitlement ? "true" : "false");"
        #if DEBUG
        boot += "window.__modDebug=true;"
        #endif
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        NSLog("[ModRiff] capacitorDidLoad, bridge=%@, plugins=%@",
              ok ? "yes" : "nil", ok ? "ModEngine ModMidi ModBilling ModHaptics" : "none")
    }
}
