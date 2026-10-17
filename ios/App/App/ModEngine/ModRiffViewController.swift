import Capacitor
import UIKit

/// The bridge view controller, subclassed for one reason: to register
/// ModEngine.
///
/// Capacitor finds the plugins that live in Swift packages — the ones the CLI
/// writes into CapApp-SPM's Package.swift — by itself. It does **not** find a
/// CAPBridgedPlugin declared in the app target. That was an assumption worth
/// checking rather than believing: with the plugin written and compiling, a
/// NSLog in its load() never printed, which is what sent us here. The bridge
/// exposes registerPluginType for exactly this case.
///
/// Main.storyboard points at this class instead of CAPBridgeViewController.
class ModRiffViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        let ok = bridge != nil
        bridge?.registerPluginType(ModEngine.self)
        NSLog("[ModEngine] capacitorDidLoad, bridge=%@, registered=%@",
              ok ? "yes" : "nil", ok ? "yes" : "no")
    }
}
