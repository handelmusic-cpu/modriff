import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // An instrument, not a web page: .playback is the audio category that
        // keeps sounding with the ring/silent switch on silent. The default a
        // web view gets (ambient) is muted by it, so on a phone left on silent
        // — most of them — every pad tap was silence with no hint why.
        //
        // One owner for the session, here, before the web view exists.
        //
        // The native engine used to set the category and call setActive from
        // inside the plugin, with the web view's AudioContext configuring the
        // same session for itself. Two owners, and the loser stops: measured,
        // the AVAudioEngine rendered 34,816 frames — 0.73 s at 48 kHz, the
        // same on every run — and never ran again. Restarting it from a
        // watchdog only made that audible.
        //
        // .mixWithOthers is what lets the two coexist: without it, a session
        // activation is exclusive and whichever side activates last silences
        // the other. With it, WebKit starting its AudioContext no longer
        // takes the hardware away from the engine.
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("[ModRiff] audio session: %@", error.localizedDescription)
        }
        // One note out of the C++ engine, three seconds after launch, with
        // nothing else running. Debug builds only; see ModEngineSelfTest.
        #if DEBUG
        if ProcessInfo.processInfo.environment["MODRIFF_SELFTEST"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { ModEngineSelfTest.run() }
        }
        #endif
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
