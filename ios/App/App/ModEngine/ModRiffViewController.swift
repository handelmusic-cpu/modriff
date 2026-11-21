import Capacitor
import UIKit
import WebKit

/// The bridge view controller, subclassed for one reason: to register the
/// app-target plugins — ModEngine, with ModMidi, ModBilling, ModHaptics, ModOcr, ModCloud, ModWake and ModActivity
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
    #if targetEnvironment(macCatalyst)
    /// Hands hardware-keyboard focus to the web view (see SceneDelegate.sceneDidBecomeActive).
    func takeKeyboard() {
        guard let web = webView, web.window?.isKeyWindow ?? true else { return }
        _ = web.becomeFirstResponder()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        takeKeyboard()
    }

    /// The Mac window shows the page 15% larger (the owner found it small). The web view's own page zoom, not CSS `zoom`: it
    /// shrinks the page's viewport the way Safari's Cmd-+ does, so innerWidth, vh, getBoundingClientRect and the position:fixed
    /// maths of every popover stay in one coordinate system. CSS zoom on the root left getBoundingClientRect in screen pixels and
    /// `style.left` in zoomed ones, which moved every list the page places from a measured button. SceneDelegate raises the
    /// window's minimum size by the same factor so the page never gets less than the 768 pt it is laid out for.
    ///
    /// OFF (1.0) until it is shown to lay out correctly. On the owner's Mac (macOS 27) pageZoom 1.15 scaled the picture but left the
    /// page laid out for the whole window, so the right edge and the bottom of it (the nav bar and transport) were cut off the window,
    /// the column sat right of centre, and the 1 px patterns banded. The window capture showed the layout 1.15x the window in both
    /// directions. It had only been checked in a browser at the zoomed size, never in the app.
    static let macPageZoom: CGFloat = 1.0

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.pageZoom = ModRiffViewController.macPageZoom
    }
    #endif

    override func capacitorDidLoad() {
        let ok = bridge != nil
        bridge?.registerPluginType(ModEngine.self)
        bridge?.registerPluginType(ModMidi.self)
        bridge?.registerPluginType(ModBilling.self)
        bridge?.registerPluginType(ModHaptics.self)
        bridge?.registerPluginType(ModOcr.self)
        bridge?.registerPluginType(ModCloud.self)
        bridge?.registerPluginType(ModWake.self)
        bridge?.registerPluginType(ModActivity.self)

        // Two facts the page needs before its first line runs, because
        // window.modBilling answers owned() synchronously on every render:
        //   __modOwnedCached — the product keys StoreKit last proved owned
        //     (["groove","theory"], or a Full Studio key), so a paying user has
        //     what they bought on the first frame, offline, with no round trip.
        //   __modDebug — set in debug builds only. It is what allows the
        //     setModOwned([...]) test switch on the iOS provider; a release
        //     build never defines it, so there is no switch to find.
        var boot = "window.__modOwnedCached=\(ModBilling.cachedOwnedJSON);"
        #if targetEnvironment(macCatalyst)
        // Where takes are kept differs on a Mac (Downloads, not the Files app), so the page says so.
        boot += "window.__modMacApp=true;"
        #endif
        // __modTesters — the TestFlight tester build: the "Test as" row in Settings,
        // so testers can see Free and Everything without buying. Two locks, because
        // the binary that goes to App Review is the one built WITHOUT this flag
        // (ios/archive-ios-store.sh; the switch would read as an unlock bypass):
        // the TESTERS compile flag, and a sandbox receipt, which TestFlight has and
        // the App Store never does. The receipt file is named differently on a Mac,
        // so there the flag alone is not enough and the row stays off.
        #if TESTERS && !targetEnvironment(macCatalyst)
        if Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" {
            boot += "window.__modTesters=true;"
        }
        #endif
        #if DEBUG
        boot += "window.__modDebug=true;"
        // MODRIFF_BGTEST=1 in the scheme's environment turns the background-play test on
        // without a Safari console: it is the page's own `modo-bgtest` switch.
        if ProcessInfo.processInfo.environment["MODRIFF_BGTEST"] != nil {
            boot += "try{localStorage.setItem('modo-bgtest','1')}catch(e){};"
        }
        #endif
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        NSLog("[ModRiff] capacitorDidLoad, bridge=%@, plugins=%@",
              ok ? "yes" : "nil", ok ? "ModEngine ModMidi ModBilling ModHaptics ModOcr ModCloud ModWake ModActivity" : "none")
    }
}
