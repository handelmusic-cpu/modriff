import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // ModRiffViewController, not CAPBridgeViewController: it is the same
        // thing plus the capacitorDidLoad that registers ModEngine. This line
        // is what decides the root controller — the storyboard's class is set
        // to match, but it is never consulted, because the window is built
        // here in code.
        window?.rootViewController = ModRiffViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // The page is told when the app is left and returned to, because its own
    // visibilitychange is not reliable once the audio background mode is on and
    // something is playing (index.html, "_bgAway"). The page pauses on the first
    // and resumes on the second; with "Keep playing in background" on it ignores
    // both. Unbuilt as of 4.9.9.9.9.8.9x.
    func sceneDidEnterBackground(_ scene: UIScene) {
        tellPage("modriff-background")
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        tellPage("modriff-foreground")
    }

    private func tellPage(_ name: String) {
        let vc = window?.rootViewController as? ModRiffViewController
        vc?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('\(name)'))", completionHandler: nil)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
