import Capacitor
import UIKit

/// Haptics, as `modPlatform.haptic(kind)` asks for them.
///
/// **Why not @capacitor/haptics.** It is in the project, and it works, but it
/// builds a fresh `UIImpactFeedbackGenerator` on every call and never calls
/// `prepare()`. UIKit's guidance is the opposite: the Taptic Engine is spun
/// down between uses, and an unprepared generator's first tap lands tens of
/// milliseconds late. On a pad that is the whole point of the feedback — it is
/// meant to arrive with the sound — so the generators here are kept, prepared
/// when a finger lands on a grid, and prepared again straight after each tap.
///
/// The five kinds are the table in docs/v5-architecture.md ("Haptics"):
///   pad     heavy impact       chord and sample pads, on pointerdown
///   medium  medium impact      melody keys and the strip's notes: one step under a pad
///   kaoss   light impact       the mõdFX pad
///   bounce  success            a Bounce finished writing
///   tick    selection          steppers and detents
/// "Success" is not an impact style; it belongs to the notification generator,
/// which is why there are three generator types and not one.
///
/// Everything runs on the main thread, as UIKit requires, and `fire` resolves
/// at once: the page never waits on a buzz, and a haptic that cannot play (an
/// iPad, a phone with the Taptic Engine switched off in Settings) is silently
/// nothing, which is what the web side expects.
@objc(ModHaptics)
public class ModHaptics: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModHaptics"
    public let jsName = "ModHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "fire", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise)
    ]

    private var heavy: UIImpactFeedbackGenerator?
    private var medium: UIImpactFeedbackGenerator?
    private var light: UIImpactFeedbackGenerator?
    private var notice: UINotificationFeedbackGenerator?
    private var select: UISelectionFeedbackGenerator?

    /// Same proof ModEngine and ModMidi print: a plugin declared in the app
    /// target is not discovered on its own (see ModRiffViewController).
    override public func load() {
        NSLog("[ModHaptics] plugin registered")
        DispatchQueue.main.async { self.makeGenerators() }
    }

    private func makeGenerators() {
        if heavy != nil { return }
        heavy = UIImpactFeedbackGenerator(style: .heavy)
        medium = UIImpactFeedbackGenerator(style: .medium)
        light = UIImpactFeedbackGenerator(style: .light)
        notice = UINotificationFeedbackGenerator()
        select = UISelectionFeedbackGenerator()
    }

    private func prepareAll() {
        makeGenerators()
        heavy?.prepare(); medium?.prepare(); light?.prepare(); select?.prepare()
    }

    /// A finger has landed on a grid. Wakes the engine so the first hit is not
    /// the late one. Cheap, and safe to call as often as touches arrive.
    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.prepareAll() }
        call.resolve()
    }

    @objc func fire(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "tick"
        DispatchQueue.main.async {
            self.makeGenerators()
            switch kind {
            case "pad":
                self.heavy?.impactOccurred()
                self.heavy?.prepare()
            case "medium":
                self.medium?.impactOccurred()
                self.medium?.prepare()
            case "kaoss":
                self.light?.impactOccurred()
                self.light?.prepare()
            case "bounce":
                self.notice?.notificationOccurred(.success)
            default:
                self.select?.selectionChanged()
                self.select?.prepare()
            }
        }
        call.resolve()
    }
}
