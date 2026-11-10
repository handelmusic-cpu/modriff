import AVFoundation
import AudioToolbox // UnsafeMutableAudioBufferListPointer: AVFoundation re-exports it on iOS but not on Mac Catalyst
import CoreAudio
import Capacitor
import Foundation
import os.signpost
import UIKit

/// The native mõdSynth, as the web view sees it.
///
/// `window.modEngine`'s native provider calls these methods; everything they
/// do ends up as a message in `ModEngineHost`'s lock-free queue, which the
/// render callback drains. The Swift here owns the two things C++ cannot:
/// the audio session and the engine graph.
@objc(ModEngine)
public class ModEngine: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModEngine"
    public let jsName = "ModEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensurePart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBuffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBackgroundPlay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "meters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileAppend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileDelete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wavFinish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pcmAdd", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pcmFade", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphProbe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphBuf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphBegin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphEdit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBank", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqTempo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqTempoRamp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqMirror", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSong", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongHold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongArm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongMove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqSongCapo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassChords", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassPending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqBassTempo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqArpScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqArpNotes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqArpArm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqArpStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqArpStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqChordScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqChordStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqChordStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seqChordTempo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micStop", returnType: CAPPluginReturnPromise)
    ]

    // The sampler's microphone take. The web view's getUserMedia was granted by iOS
    // and still failed on the phone (InvalidStateError), so the app opens its own
    // input: a second AVAudioEngine whose input node is tapped, the samples kept
    // here until the page reads them. The session is already play-and-record
    // (AppDelegate), so opening it changes nothing for the output engine.
    private var micEngine: AVAudioEngine?
    private let micLock = NSLock()
    private var micL: [Float] = []
    private var micR: [Float] = []
    private var micRate: Double = 0
    private static let micMaxFrames = 48_000 * 60     // a reader that has stopped asking does not grow this forever

    /// Capacitor calls this when it registers the plugin. It is the only
    /// proof that a CAPBridgedPlugin declared in the app target — rather than
    /// in a Swift package, as the bundled plugins are — is discovered at all.
    /// Cheap, and it turns "it should register" into something the device log
    /// answers.
    override public func load() {
        NSLog("[ModEngine] plugin registered")
        ModEngine.shared = self
    }

    // MARK: - Leaving and returning to the app

    /// SceneDelegate reaches the plugin through this; it is the only caller of
    /// `appLeft` / `appReturned`. Set in load(), weak because Capacitor owns it.
    static weak var shared: ModEngine?

    private var leftApp = false
    private var fadeToken = 0
    // Not the main queue: that is the page's and the app's, and it is the first
    // thing iOS stops running once the app is left, which would leave a fade
    // half done with the engine still sounding.
    private let fadeQueue = DispatchQueue(label: "modriff.engine.fade", qos: .userInteractive)

    /// The app went to the background: silence the engine from here, not from
    /// the page. The page pauses itself on the same signal, but that runs in
    /// the web view, which WebKit throttles the moment the app is left, so the
    /// page's stop arrives late or in pieces. Meanwhile the engine kept playing
    /// what the page had already queued and iOS cut the web context off
    /// mid-render, which is the sputter, the half-silent parts and the loose
    /// timing heard on leaving. A short fade first, because a hard stop of a
    /// sounding tone is itself a click.
    func appLeft() {
        guard started, !leftApp, let engine = engine else { return }
        // The background-play test (6.9.4): the page said, before leaving, that it
        // means to keep playing. Nothing is silenced; the engine is watched instead.
        if keepPlaying { beginBackgroundWatch(); return }
        leftApp = true
        NSLog("[ModEngine] leaving the app: fading out")
        for part in 0..<5 { _ = host?.post(["t": "panic", "part": part]) }   // the mõdSynth parts' voices; queued, applied at resume
        fade(engine, to: 0, steps: 6, interval: 0.006) { [weak self] in
            guard let self = self, self.leftApp else { return }
            engine.pause()
            NSLog("[ModEngine] left the app: faded out, engine paused (running=%@)", engine.isRunning ? "yes" : "no")
        }
    }

    /// Back in the app: restart the engine and bring the level up, rather than
    /// snapping, since the page is restarting the transport at the same moment.
    func appReturned() {
        if bgActive { endBackgroundWatch(); return }
        guard leftApp else { return }
        leftApp = false
        guard let engine = engine else { return }
        if !engine.isRunning {
            do { try engine.start() } catch {
                NSLog("[ModEngine] restart after background failed: %@", error.localizedDescription)
                return
            }
        }
        NSLog("[ModEngine] back in the app: engine running=%@", engine.isRunning ? "yes" : "no")
        fade(engine, to: 1, steps: 10, interval: 0.012, then: nil)
    }

    /// The app became the active one. Normally appReturned has already run; this is for
    /// the Mac, where switching apps does not always send a background/foreground pair
    /// but can still stop the engine (or leave it paused and faded out from a leave that
    /// was never matched by a return). Idempotent, and a no-op on a running engine.
    func appBecameActive() {
        if leftApp { appReturned(); return }
        guard started, !bgActive, let engine = engine else { return }
        if !engine.isRunning { restartEngine("app became active") }
        if engine.mainMixerNode.outputVolume < 1 { fade(engine, to: 1, steps: 10, interval: 0.012, then: nil) }
    }

    /// A stepped ramp of the mixer's output volume. A newer fade (or a stop)
    /// cancels an older one through `fadeToken`, so a quick leave-and-return
    /// never ends on the wrong level.
    private func fade(_ engine: AVAudioEngine, to target: Float, steps: Int, interval: Double, then: (() -> Void)?) {
        fadeToken += 1
        let token = fadeToken
        let from = engine.mainMixerNode.outputVolume
        func step(_ k: Int) {
            guard token == self.fadeToken else { return }
            engine.mainMixerNode.outputVolume = from + (target - from) * Float(k) / Float(steps)
            if k >= steps { then?(); return }
            self.fadeQueue.asyncAfter(deadline: .now() + interval) { step(k + 1) }
        }
        step(1)
    }

    // MARK: - Staying alive (6.9.4)

    // Nothing here watched the audio session until now. A phone call, Siri, an alarm,
    // another app taking the speaker, headphones pulled out or a Bluetooth speaker
    // joining all stop an AVAudioEngine, and it stays stopped until something starts it
    // again: the page restarts its own Web Audio context when it comes back, which is
    // no use to an engine the page does not own. In the foreground that was silence
    // until the app was relaunched; in the background there is no page to notice
    // at all (it is throttled, or frozen), so the engine has to look after itself
    // before background play can mean anything.

    private let lifeLock = NSLock()
    private var lifeLog: [(at: Date, what: String)] = []
    private var lifeObservers: [NSObjectProtocol] = []
    private var interrupted = false
    private var restarts = 0
    private var interruptions = 0

    private func lifeNote(_ what: String) {
        NSLog("[ModEngine] %@", what)
        lifeLock.lock()
        lifeLog.append((Date(), what))
        if lifeLog.count > 16 { lifeLog.removeFirst() }
        lifeLock.unlock()
    }

    private func watchLife(_ engine: AVAudioEngine) {
        unwatchLife()
        let nc = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        lifeObservers = [
            nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] n in
                self?.sessionInterrupted(n)
            },
            // iOS stops the engine when the output route or its sample rate changes and
            // says so here; the nodes stay connected, so starting it again is enough
            // (the mixer converts to whatever rate the new route runs at).
            nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
                self?.lifeNote("engine configuration changed (route or sample rate)")
                self?.restartEngine("configuration change")
            },
            nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: nil) { [weak self] n in
                let why = (n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
                self?.lifeNote("audio route changed (reason \(why))")
            },
            // Everything audio is invalid after this, the engine included. Starting it again
            // is a try, not a rebuild: if it fails the status line says so, and the app has
            // to be relaunched. Not reproducible on a Mac or a phone short of killing mediaserverd.
            nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil) { [weak self] _ in
                self?.lifeNote("media services were reset")
                self?.restartEngine("media services reset")
            }
        ]
    }

    private func unwatchLife() {
        for o in lifeObservers { NotificationCenter.default.removeObserver(o) }
        lifeObservers = []
    }

    private func sessionInterrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            interrupted = true
            interruptions += 1
            lifeNote("audio interrupted")
        case .ended:
            interrupted = false
            let o = (n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
            lifeNote("interruption ended (shouldResume=\(AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) ? "yes" : "no"))")
            // Whether iOS asks for a resume or not: the engine is only the instrument. Nothing
            // sounds until the page plays something, and an engine left stopped would swallow
            // whatever it plays next.
            restartEngine("interruption")
        @unknown default:
            break
        }
    }

    /// Starts the engine again if it is stopped, a few times with a growing wait: right
    /// after an interruption or a route change iOS can still refuse the session. On the
    /// fade queue, not the main one, which is what stalls first once the app is left.
    private func restartEngine(_ why: String) {
        fadeQueue.async { [weak self] in self?.tryRestart(why, attempt: 0) }
    }

    private func tryRestart(_ why: String, attempt: Int) {
        guard started, let engine = engine, !engine.isRunning else { return }
        // The app was left and the engine paused on purpose: appReturned starts it.
        if leftApp { lifeNote("\(why): the app is left, engine stays paused"); return }
        // Still interrupted: the ended notification restarts it.
        if interrupted { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
            restarts += 1
            lifeNote("engine restarted after \(why) (attempt \(attempt + 1))")
        } catch {
            lifeNote("restart after \(why) failed (attempt \(attempt + 1)): \(error.localizedDescription)")
            if attempt < 6 {
                let wait = min(2.0, 0.25 * pow(2.0, Double(attempt)))
                fadeQueue.asyncAfter(deadline: .now() + wait) { [weak self] in self?.tryRestart(why, attempt: attempt + 1) }
            }
        }
    }

    // MARK: - Background play, as a measurement (6.9.4)

    // Leaving the app still silences the engine (appLeft). The one exception is a test:
    // the page, started with `modo-bgtest` set and the native sound on, tells the engine
    // before it is left that it means to keep playing (`setBackgroundPlay`). Then nothing is
    // silenced and the engine is watched for as long as the app is away: the page's calls
    // into it counted per second, the main queue pinged, the blocks it rendered. That is the
    // question the architecture doc could not answer from the Mac, whether the page keeps
    // feeding the engine at all once iOS throttles it, answered by the one thing that
    // keeps running whatever the page does.
    private var keepPlaying = false
    private var bgActive = false
    private let bgLock = NSLock()
    private var bgStart = Date()
    private var bgFeeds = 0, bgLastCount = 0
    private var bgFirstFeed: Double?
    private var bgTicks = 0, bgTicksFed = 0, bgQuietRun = 0, bgQuietMax = 0
    private var bgPings = 0, bgPongs = 0
    private var bgLatMaxMs = 0.0
    private var bgFrames0: Int64 = 0, bgMissed0: Int64 = 0, bgSlow0: Int64 = 0
    private var bgTimer: DispatchSourceTimer?
    private var bgReports: [[String: Any]] = []

    @objc func setBackgroundPlay(_ call: CAPPluginCall) {
        keepPlaying = call.getBool("on") ?? false
        call.resolve(["on": keepPlaying])
    }

    /// A call from the page into the engine (notes, voices, edits). Counted only while the
    /// app is away; `bgActive` is read without the lock on purpose, a stale false costs one count.
    private func noteFeed() {
        guard bgActive else { return }
        bgLock.lock()
        bgFeeds += 1
        if bgFirstFeed == nil { bgFirstFeed = Date().timeIntervalSince(bgStart) }
        bgLock.unlock()
    }

    private func beginBackgroundWatch() {
        bgLock.lock()
        bgActive = true
        bgStart = Date()
        bgFeeds = 0; bgLastCount = 0; bgFirstFeed = nil
        bgTicks = 0; bgTicksFed = 0; bgQuietRun = 0; bgQuietMax = 0
        bgPings = 0; bgPongs = 0; bgLatMaxMs = 0
        bgFrames0 = renderFrames; bgMissed0 = missedCount; bgSlow0 = slowCount
        bgLock.unlock()
        NSLog("[ModEngine] leaving the app: background play is on, the engine keeps running")
        let t = DispatchSource.makeTimerSource(queue: fadeQueue)
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in self?.bgTick() }
        bgTimer = t
        t.resume()
    }

    private func bgTick() {
        bgLock.lock()
        bgTicks += 1
        let fed = bgFeeds - bgLastCount
        bgLastCount = bgFeeds
        if fed > 0 { bgTicksFed += 1; bgQuietRun = 0 } else { bgQuietRun += 1; bgQuietMax = max(bgQuietMax, bgQuietRun) }
        bgPings += 1
        let line = bgTicks % 5 == 0
        let (n, feeds, pongs, pings) = (bgTicks, bgFeeds, bgPongs, bgPings)
        bgLock.unlock()
        if line {
            NSLog("[ModEngine] away %ds: page calls %d, main queue answered %d of %d, engine running=%@",
                  n, feeds, pongs, pings, (engine?.isRunning ?? false) ? "yes" : "no")
        }
        // Is the main queue (where the web view's messages arrive) served while away?
        let sent = DispatchTime.now().uptimeNanoseconds
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let ms = Double(DispatchTime.now().uptimeNanoseconds &- sent) / 1e6
            self.bgLock.lock()
            self.bgPongs += 1
            if ms > self.bgLatMaxMs { self.bgLatMaxMs = ms }
            self.bgLock.unlock()
        }
    }

    private func endBackgroundWatch() {
        bgTimer?.cancel()
        bgTimer = nil
        bgLock.lock()
        bgActive = false
        let sr = host?.sampleRate ?? 48_000
        let secs = Date().timeIntervalSince(bgStart)
        let report: [String: Any] = [
            "secs": (secs * 10).rounded() / 10,
            "ticks": bgTicks,
            "calls": bgFeeds,
            "ticksWithCalls": bgTicksFed,
            "longestQuietTicks": bgQuietMax,
            "firstCallAfterSec": bgFirstFeed.map { ($0 * 10).rounded() / 10 } ?? -1,
            "mainPings": bgPings,
            "mainAnswered": bgPongs,
            "mainLatMaxMs": (bgLatMaxMs * 10).rounded() / 10,
            "audioSecs": ((Double(renderFrames - bgFrames0) / sr) * 10).rounded() / 10,
            "missed": Int(missedCount - bgMissed0),
            "slow": Int(slowCount - bgSlow0),
            "engineRunning": engine?.isRunning ?? false
        ]
        bgReports.append(report)
        if bgReports.count > 5 { bgReports.removeFirst() }
        bgLock.unlock()
        NSLog("[ModEngine] back in the app after %.1fs: %@", secs, "\(report)")
        // iOS can stop the engine while the app is away (an interruption that never ended).
        if let e = engine, !e.isRunning { restartEngine("return from the background") }
    }

#if DEBUG
    /// MODRIFF_RECOVERY_TEST=1 in the environment (simulator or Xcode scheme): a few
    /// seconds after the engine starts, stop it the way iOS does for a route change,
    /// post the notification iOS would, and log whether it came back; then the same for an
    /// interruption. The numbers are in the device log as `[RecoveryTest]`.
    private func runRecoveryTest() {
        guard ProcessInfo.processInfo.environment["MODRIFF_RECOVERY_TEST"] != nil, let engine = engine else { return }
        let nc = NotificationCenter.default
        func report(_ tag: String) {
            NSLog("[RecoveryTest] %@: running=%@ frames=%lld restarts=%d", tag, engine.isRunning ? "yes" : "no", self.renderFrames, self.restarts)
        }
        let q = fadeQueue
        q.asyncAfter(deadline: .now() + 4) {
            report("before")
            engine.stop()
            report("stopped, as for a route change")
            nc.post(name: .AVAudioEngineConfigurationChange, object: engine)
        }
        q.asyncAfter(deadline: .now() + 6) { report("after the configuration change") }
        q.asyncAfter(deadline: .now() + 7) {
            engine.pause()
            nc.post(name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        }
        q.asyncAfter(deadline: .now() + 8) { report("while interrupted (should be stopped)") }
        q.asyncAfter(deadline: .now() + 9) {
            nc.post(name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                               AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
        }
        q.asyncAfter(deadline: .now() + 11) { report("after the interruption ended") }
        // The app left while stopped: it must stay paused, and come back.
        q.asyncAfter(deadline: .now() + 12) {
            engine.stop()
            self.leftApp = true
            nc.post(name: .AVAudioEngineConfigurationChange, object: engine)
        }
        q.asyncAfter(deadline: .now() + 13) {
            report("left the app, engine stopped (should stay stopped)")
            self.leftApp = false
            self.restartEngine("test: back")
        }
        q.asyncAfter(deadline: .now() + 15) { report("back") }
    }

    /// MODRIFF_BG_SELFTEST=1: the background watch without a page. Leaves the app with
    /// background play on, makes calls for 3 of 7 seconds, comes back, and the report
    /// in the log should say 7 s, calls > 0, ticksWithCalls 3, longestQuietTicks 4, the
    /// engine running and about 7 s of audio rendered.
    private func runBackgroundSelfTest() {
        guard ProcessInfo.processInfo.environment["MODRIFF_BG_SELFTEST"] != nil else { return }
        let q = fadeQueue
        q.asyncAfter(deadline: .now() + 4) {
            self.keepPlaying = true
            self.appLeft()
            for k in 0..<30 { q.asyncAfter(deadline: .now() + 0.1 * Double(k) + 0.2) { self.noteFeed() } }
        }
        q.asyncAfter(deadline: .now() + 11) {
            self.appReturned()
            self.keepPlaying = false
        }
        // The default path after it: leaving still fades and pauses.
        q.asyncAfter(deadline: .now() + 13) { self.appLeft() }
        q.asyncAfter(deadline: .now() + 15) {
            NSLog("[BgSelfTest] default leave: running=%@", (self.engine?.isRunning ?? false) ? "yes (WRONG)" : "no (paused)")
            self.appReturned()
        }
        q.asyncAfter(deadline: .now() + 17) {
            NSLog("[BgSelfTest] back: running=%@", (self.engine?.isRunning ?? false) ? "yes" : "no (WRONG)")
        }
    }
#endif

    private var engine: AVAudioEngine?
    private var source: AVAudioSourceNode?
    private var host: ModEngineHost?
    private var started = false

    // Render-cost accounting. Written only by the render thread, read by
    // stats() — plain Int64s through atomics-by-convention: one writer, and a
    // torn read would cost a wrong number in a diagnostic, not a glitch.
    private var renderNanosTotal: Int64 = 0
    private var renderNanosMax: Int64 = 0
    private var renderBlocks: Int64 = 0
    private var renderFrames: Int64 = 0
    // The last few blocks that took over 2 ms (a block is 5 ms of audio at the
    // default buffer, so this is under half the budget): the frame count when each started, and how
    // long it took. maxRenderUs says a stall happened; this says when, so it can
    // be lined up with what was being done. Preallocated; the render thread only
    // stores into it.
    private static let slowSlots = 8
    private let slowAt = UnsafeMutablePointer<Int64>.allocate(capacity: ModEngine.slowSlots)
    private let slowUs = UnsafeMutablePointer<Double>.allocate(capacity: ModEngine.slowSlots)
    private var slowCount: Int64 = 0
    private var missedCount: Int64 = 0          // blocks that took longer than the audio they made (an underrun, if the buffer behind was empty)
    // When the first few missed blocks happened, in seconds of audio since the
    // engine started, and how long each took, plus when the latest one did. The
    // slow list above fills with routine 2 ms blocks (the average block is
    // 1.7 ms of a 5 ms budget) and loses the stalls; this one holds only real
    // overruns, so a dump says whether they are all in the first seconds after
    // launch or keep coming.
    private static let missSlots = 8
    private let missAt = UnsafeMutablePointer<Int64>.allocate(capacity: ModEngine.missSlots)
    private let missUs = UnsafeMutablePointer<Double>.allocate(capacity: ModEngine.missSlots)
    private var missLastAt: Int64 = 0

    private static let signpostLog = OSLog(subsystem: "Handel.modRiff",
                                           category: "modengine")

    // MARK: - Lifecycle

    @objc func start(_ call: CAPPluginCall) {
        if started {
            call.resolve(["started": true, "sampleRate": host?.sampleRate ?? 0])
            return
        }
        do {
            // The session is AppDelegate's, deliberately: it is configured
            // once, before the web view exists, and this plugin never touches
            // it. Setting the category or calling setActive from here is what
            // made the engine and WebKit fight over one session, and the
            // engine lose after 0.73 s.
            let session = AVAudioSession.sharedInstance()
            let sampleRate = session.sampleRate
            let engine = AVAudioEngine()
            // The largest block the callback can be handed. IOBufferDuration
            // asks for something far smaller; this is headroom, and the host
            // sizes its scratch buffers to it once.
            let maxFrames = 4096
            let host = ModEngineHost(sampleRate: sampleRate, maxFrames: Int32(maxFrames))

            guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate,
                                             channels: 2) else {
                call.reject("could not build a 2-channel float format at \(sampleRate)")
                return
            }

            let source = AVAudioSourceNode(format: format) { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
                // ── audio thread ──
                // No allocation, no locks, no Swift runtime calls that could
                // take either. `host` is captured unowned-ish via self; the
                // engine is stopped before the host is released.
                guard let self = self, let host = self.host else { return noErr }
                let abl = UnsafeMutableAudioBufferListPointer(audioBufferList)
                guard abl.count >= 2,
                      let l = abl[0].mData?.assumingMemoryBound(to: Float.self),
                      let r = abl[1].mData?.assumingMemoryBound(to: Float.self) else {
                    return noErr
                }
                let t0 = DispatchTime.now().uptimeNanoseconds
                os_signpost(.begin, log: ModEngine.signpostLog, name: "render")
                host.render(into: l, right: r, frames: Int32(frameCount))
                os_signpost(.end, log: ModEngine.signpostLog, name: "render")
                let dt = Int64(DispatchTime.now().uptimeNanoseconds &- t0)

                if Double(dt) > Double(frameCount) / host.sampleRate * 1e9 {
                    if self.missedCount < Int64(ModEngine.missSlots) {
                        let k = Int(self.missedCount)
                        self.missAt[k] = self.renderFrames
                        self.missUs[k] = Double(dt) / 1000.0
                    }
                    self.missLastAt = self.renderFrames
                    self.missedCount &+= 1
                }
                if dt > 2_000_000 {
                    let k = Int(self.slowCount % Int64(ModEngine.slowSlots))
                    self.slowAt[k] = self.renderFrames
                    self.slowUs[k] = Double(dt) / 1000.0
                    self.slowCount &+= 1
                }
                self.renderNanosTotal &+= dt
                if dt > self.renderNanosMax { self.renderNanosMax = dt }
                self.renderBlocks &+= 1
                self.renderFrames &+= Int64(frameCount)
                return noErr
            }

            engine.attach(source)
            engine.connect(source, to: engine.mainMixerNode, format: format)
            engine.prepare()
            try engine.start()

            self.engine = engine
            self.source = source
            self.host = host
            self.started = true
            watchLife(engine)
            #if DEBUG
            runRecoveryTest()
            runBackgroundSelfTest()
            #endif

            call.resolve([
                "started": true,
                "sampleRate": sampleRate,
                "maxFrames": maxFrames
            ])
        } catch {
            call.reject("audio engine failed to start: \(error.localizedDescription)")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        unwatchLife()
        bgTimer?.cancel(); bgTimer = nil; bgActive = false
        leftApp = false
        fadeToken += 1          // a fade in flight must not touch the next engine's volume
        engine?.stop()
        if let source = source { engine?.detach(source) }
        source = nil
        engine = nil
        host = nil
        started = false
        // Not setActive(false): the session belongs to AppDelegate and the
        // web view is still using it. Deactivating here would silence the
        // page's own audio as a side effect of stopping the native engine.
        call.resolve(["started": false])
    }

    /// Builds a part's processor and warms its containers. Both allocate, so
    /// both happen here rather than on the render thread.
    @objc func ensurePart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let part = call.getInt("part") ?? 0
        // Warmed before it is published: the engine is already running, and a
        // warm-up played into a part the render thread can see is heard.
        // `graph: true` is a part played as recorded Web Audio graphs: a strip and
        // mõdFX with no engine and no rack behind them (nothing to warm, no
        // Processor to build).
        let ok = (call.getBool("graph") ?? false) ? host.ensureGraphPart(Int32(part))
               : (call.getBool("warm") ?? true) ? host.warmUpPart(Int32(part))
                                                : host.ensurePart(Int32(part))
        guard ok else {
            call.reject("part \(part) out of range")
            return
        }
        call.resolve(["part": part])
    }

    // MARK: - The graph path
    //
    // The page records a voice as a Web Audio graph and sends it as numbers
    // (`_mgSend` in index.html); the host plays it with the C++ interpreter. The
    // page asks `graphProbe` once before it turns the path on, so a binary
    // without these methods is left on Web Audio. Order matters and Capacitor
    // keeps it: a clip (graphBuf), then the graph that names it (graphBegin), then
    // its edits (graphEdit).

    /// Does nothing and resolves: the answer is that the method exists.
    @objc func graphProbe(_ call: CAPPluginCall) {
        call.resolve(["graph": true])
    }

    /// A decoded clip, once: `channels` are base64 float32, one or two.
    @objc func graphBuf(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let id = call.getInt("id"), let sr = call.getDouble("sampleRate"),
              let b64 = call.getArray("channels", String.self), !b64.isEmpty else {
            call.reject("graphBuf needs id, sampleRate and channels")
            return
        }
        let chans = b64.compactMap { Data(base64Encoded: $0) }
        guard chans.count == b64.count, host.putGraphBuffer(Int32(id), sampleRate: sr, channels: chans) else {
            call.reject("graphBuf could not read the clip")
            return
        }
        call.resolve()
    }

    /// Starts a voice. `program` is base64 float64; `ts` is the page's wall
    /// clock (ms) when it opened the voice. Resolves `handle` (>= 0), `-2` with
    /// `unknownBuffer` when a clip it names is missing (the page sends that clip
    /// again), or `-1` when it was refused or the pool is full.
    @objc func graphBegin(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let gid = call.getInt("gid"), let b64 = call.getString("program"),
              let program = Data(base64Encoded: b64) else {
            call.reject("graphBegin needs gid and program")
            return
        }
        noteFeed()
        let r = host.beginGraph(Int32(gid), program: program, timestampMs: call.getDouble("ts") ?? 0)
        call.resolve(["handle": r["handle"] ?? -1, "unknownBuffer": r["unknownBuffer"] ?? -1])
    }

    /// A change to a voice that has begun. Resolves `ok` false when it has
    /// already finished.
    @objc func graphEdit(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let gid = call.getInt("gid"), let b64 = call.getString("increments"),
              let inc = Data(base64Encoded: b64) else {
            call.reject("graphEdit needs gid and increments")
            return
        }
        noteFeed()
        call.resolve(["ok": host.editGraph(Int32(gid), increments: inc)])
    }

    // ── The native sequencer (docs/native-scheduling.md, slice 1) ────────────
    // The page hands over the drum score and says start; the engine's own thread does the stepping from there,
    // counted in the render clock, so it goes on when the web view's timers are throttled. Nothing sounds from it yet.

    /// The drum score, `score` base64 float64 (window._sqNativeScore().score). Resolves `ok`.
    @objc func seqScore(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("score"), let data = Data(base64Encoded: b64) else {
            call.reject("seqScore needs score")
            return
        }
        call.resolve(["ok": host.seqSetDrumScore(data)])
    }

    /// A drum voice the page recorded (voicebank.h), `entry` base64 float64; `clear` first empties the bank. Resolves `ok`.
    @objc func seqBank(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        if call.getBool("clear") ?? false { host.seqClearBank() }
        guard let b64 = call.getString("entry") else { call.resolve(["ok": true]); return }
        guard let data = Data(base64Encoded: b64) else { call.reject("seqBank needs entry"); return }
        call.resolve(["ok": host.seqPutBankEntry(data)])
    }

    /// Starts at step 0. `leadMs` is how far ahead the downbeat is. Resolves `ok` (false without a score).
    @objc func seqStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let ok = host.seqStart(withBpm: call.getDouble("bpm") ?? 120, rate: call.getDouble("rate") ?? 1,
                               leadMs: call.getDouble("leadMs") ?? 120, seed: call.getDouble("seed") ?? 0)
        call.resolve(["ok": ok])
    }

    @objc func seqStop(_ call: CAPPluginCall) {
        host?.seqStop()
        call.resolve()
    }

    /// The song for the engine's own loop, `score` base64 float64 (window._songNativeScore().score). Resolves `ok`.
    @objc func seqSong(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("score"), let data = Data(base64Encoded: b64) else {
            call.reject("seqSong needs score")
            return
        }
        call.resolve(["ok": host.seqSetSong(data)])
    }

    /// Starts the song. `align` takes the drums' next bar line when they run; `section`, `slot` and `pass` say where. Resolves `ok`.
    @objc func seqSongStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let ok = host.seqSongStart(withLeadMs: call.getDouble("leadMs") ?? 250, alignToDrums: call.getBool("align") ?? true,
                                   section: Int32(call.getInt("section") ?? 0), slot: Int32(call.getInt("slot") ?? 0), pass: Int32(call.getInt("pass") ?? 0))
        call.resolve(["ok": ok])
    }

    @objc func seqSongStop(_ call: CAPPluginCall) {
        host?.seqSongStop()
        call.resolve()
    }

    /// The ending armed for the end of this pass: 1 cold, 2 finish, 3 fade, 4 tag, 5 ritard, 0 none.
    @objc func seqSongArm(_ call: CAPPluginCall) {
        host?.seqSongArm(Int32(call.getInt("kind") ?? 0))
        call.resolve(["ok": true])
    }

    /// Freezes the progression and leaves the chord that sounds (the page's hold).
    @objc func seqSongHold(_ call: CAPPluginCall) {
        host?.seqSongHold()
        call.resolve()
    }

    /// A Next (1) or Prev (-1) queued by the player, taken at the end of the pass.
    @objc func seqSongMove(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqSongMove(Int32(call.getInt("delta") ?? 0))
        call.resolve(["ok": true])
    }

    /// The live key change in semitones.
    @objc func seqSongCapo(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqSongSetCapo(Int32(call.getInt("capo") ?? 0))
        call.resolve(["ok": true])
    }

    /// The tempo moves in a straight line to `bpm` over `ms` milliseconds, then holds it. Resolves `ok`.
    @objc func seqTempoRamp(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqTempoRamp(to: call.getDouble("bpm") ?? 0, overMs: call.getDouble("ms") ?? 0)
        call.resolve(["ok": true])
    }

    @objc func seqTempo(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqSetTempo(call.getDouble("bpm") ?? 0, rate: call.getDouble("rate") ?? 0)
        call.resolve()
    }

    // The bass line, on the same thread and bank (slice 2).

    /// The bass score, `score` base64 float64 (window._blNativeScore().score). Resolves `ok`.
    @objc func seqBassScore(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("score"), let data = Data(base64Encoded: b64) else {
            call.reject("seqBassScore needs score")
            return
        }
        call.resolve(["ok": host.seqSetBassScore(data)])
    }

    /// The chord windows, `chords` base64 float64 (window._blNativeChords(sr)): frames from the line's start. Resolves `ok`.
    @objc func seqBassChords(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("chords"), let data = Data(base64Encoded: b64) else {
            call.reject("seqBassChords needs chords")
            return
        }
        call.resolve(["ok": host.seqSetBassChords(data)])
    }

    /// A line written ahead, `pending` base64 float64 (window._blNativePending(sr)): frames from the line's start. Resolves `ok`.
    @objc func seqBassPending(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("pending"), let data = Data(base64Encoded: b64) else {
            call.reject("seqBassPending needs pending")
            return
        }
        call.resolve(["ok": host.seqSetBassPending(data)])
    }

    /// Starts the bass line. `align` shares the drums' downbeat when they run; `kit` is the bank's code for the voice.
    @objc func seqBassStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let ok = host.seqBassStart(withBpm: call.getDouble("bpm") ?? 120, rate: call.getDouble("rate") ?? 1,
                                   leadMs: call.getDouble("leadMs") ?? 120, alignToDrums: call.getBool("align") ?? true,
                                   kit: Int32(call.getInt("kit") ?? 0), seed: call.getDouble("seed") ?? 0)
        call.resolve(["ok": ok])
    }

    @objc func seqBassStop(_ call: CAPPluginCall) {
        host?.seqBassStop()
        call.resolve()
    }

    @objc func seqBassTempo(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqBassSetTempo(call.getDouble("bpm") ?? 0, rate: call.getDouble("rate") ?? 0)
        call.resolve()
    }

    // The arpeggiator, on the same thread and bank (slice 3).

    /// The arp's settings, `score` base64 float64 (window._arpNativeScore().score). Resolves `ok`.
    @objc func seqArpScore(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("score"), let data = Data(base64Encoded: b64) else {
            call.reject("seqArpScore needs score")
            return
        }
        call.resolve(["ok": host.seqSetArpScore(data)])
    }

    /// The chord the arp is on, `notes` base64 float64 MIDI notes with the octaves added (window._arpNativeNotes()). Empty clears it. Resolves `ok`.
    @objc func seqArpNotes(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("notes"), let data = Data(base64Encoded: b64) else {
            call.reject("seqArpNotes needs notes")
            return
        }
        call.resolve(["ok": host.seqSetArpNotes(data)])
    }

    /// Whether a song, when it starts, brings the arp in on its bar line and follows its chords. `kit` is the bank's code for the voice.
    @objc func seqArpArm(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqArpArm(call.getBool("on") ?? true, kit: Int32(call.getInt("kit") ?? 0))
        call.resolve()
    }

    /// Starts the arp by itself. `align` shares the drums' bar line when they run; `kit` is the bank's code for the voice.
    @objc func seqArpStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let ok = host.seqArpStart(withBpm: call.getDouble("bpm") ?? 0, leadMs: call.getDouble("leadMs") ?? 120, alignToDrums: call.getBool("align") ?? true,
                                  kit: Int32(call.getInt("kit") ?? 0), seed: call.getDouble("seed") ?? 0)
        call.resolve(["ok": ok])
    }

    @objc func seqArpStop(_ call: CAPPluginCall) {
        host?.seqArpStop()
        call.resolve()
    }

    // The chord comp, on the same thread and bank (slice 2).

    /// The chord rhythm and its chord, `score` base64 float64 (window._crNativeScore().score). Resolves `ok`.
    @objc func seqChordScore(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        guard let b64 = call.getString("score"), let data = Data(base64Encoded: b64) else {
            call.reject("seqChordScore needs score")
            return
        }
        call.resolve(["ok": host.seqSetChordScore(data)])
    }

    /// Starts the chord rhythm. `align` shares the drums' downbeat when they run; `kit` is the bank's code for the chord voice.
    @objc func seqChordStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let ok = host.seqChordStart(withBpm: call.getDouble("bpm") ?? 120, leadMs: call.getDouble("leadMs") ?? 120,
                                    alignToDrums: call.getBool("align") ?? true, kit: Int32(call.getInt("kit") ?? 0))
        call.resolve(["ok": ok])
    }

    @objc func seqChordStop(_ call: CAPPluginCall) {
        host?.seqChordStop()
        call.resolve()
    }

    @objc func seqChordTempo(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.seqChordSetTempo(call.getDouble("bpm") ?? 0)
        call.resolve()
    }

    /// {running, step, bar, frame, steps, events, late, ...}: where the engine's own sequencer is.
    @objc func seqMirror(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        call.resolve(host.seqMirror() as? [String: Any] ?? [:])
    }

    /// One worklet-shaped message. Parsed into a POD and queued here, on
    /// Capacitor's thread — never on the render thread.
    @objc func post(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        noteFeed()
        // Either one message, or a batch under `msgs` so a chord and its
        // matrix cross the bridge in one call rather than six.
        if let batch = call.getArray("msgs") as? [[String: Any]] {
            var queued = 0
            for m in batch where host.post(m) { queued += 1 }
            call.resolve(["queued": queued, "sent": batch.count])
            return
        }
        guard let msg = call.options as? [String: Any] else {
            call.reject("no message")
            return
        }
        call.resolve(["queued": host.post(msg) ? 1 : 0, "sent": 1])
    }

    /// Each part's RMS since the last call (the loudest block, then reset), for
    /// the mixer's meters. Separate from stats so reading one does not clear
    /// the other.
    @objc func meters(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        // 0..<8 the parts, 8 the master
        call.resolve(["rms": (0..<9).map { Double(host.meter(forPart: Int32($0))) }])
    }

    /// Capture for the recorder (v5 step N5). The page's Bounce taps Web Audio
    /// nodes; a native part is in none of them, so the host copies its output
    /// into rings (the master, and any parts a stem take asks for) and the page
    /// drains them. `mask` bit 0 is the master, bit 1+p is part p.
    @objc func captureStart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let mask = UInt32(truncatingIfNeeded: call.getInt("mask") ?? 1)
        host.startCapture(mask)
        call.resolve(["mask": Int(mask), "sampleRate": host.sampleRate])
    }

    /// What has been captured since the last call. Each stream's samples go as
    /// base64 of left-then-right float32 (the bridge is JSON), with the engine
    /// frame the first one was rendered at and how many frames were lost to a
    /// reader that fell behind. `originMs` is where engine frame 0 sits on the wall
    /// clock, which is how the page puts these on its own timeline.
    @objc func captureRead(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let r = host.readCapture()
        var streams: [[String: Any]] = []
        for case let s as [String: Any] in (r["streams"] as? [Any] ?? []) {
            guard let data = s["data"] as? Data else { continue }
            streams.append([
                "id": s["id"] ?? 0,
                "frame0": s["frame0"] ?? 0,
                "frames": s["frames"] ?? 0,
                "lost": s["lost"] ?? 0,
                "data": data.base64EncodedString()
            ])
        }
        call.resolve([
            "streams": streams,
            "originMs": r["originMs"] ?? 0,
            "drainMs": r["drainMs"] ?? 0,
            "diag": r["diag"] ?? [:],
            "sampleRate": r["sampleRate"] ?? host.sampleRate
        ])
    }

    @objc func captureStop(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        host.stopCapture()
        call.resolve()
    }

    /// Hands a file the page made (a bounce, a stem, a saved pattern) to the
    /// system share sheet. WKWebView ignores `<a download>`, so on the phone
    /// the web path "saved" with a toast and wrote nothing. The page sends the
    /// bytes as base64; they go to a temporary file because the share sheet
    /// wants a URL, and from there to Files, AirDrop, Messages and the rest.
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let rawName = call.getString("name"),
              let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64) else {
            call.reject("shareFile needs a name and base64 data")
            return
        }
        let name = (rawName as NSString).lastPathComponent
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("could not write \(name): \(error.localizedDescription)")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else {
                call.reject("no view controller to present from")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // iPad requires an anchor for the popover.
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.popoverPresentationController?.sourceRect =
                CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
            sheet.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: url)
            }
            vc.present(sheet, animated: true) { call.resolve() }
        }
    }

    /// One piece of a file the page is handing over. shareFile above takes the
    /// whole file as a single base64 string, which for a long bounce is a
    /// string of well over a hundred megabytes crossing the bridge; the web
    /// content process was killed for memory and the page came back at its
    /// start screen with nothing shared. The page now sends ~1 MB at a time
    /// (`first` truncates), then asks for the sheet with shareFiles.
    @objc func fileAppend(_ call: CAPPluginCall) {
        guard let rawName = call.getString("name"),
              let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64) else {
            call.reject("fileAppend needs a name and base64 data")
            return
        }
        let url = dirURL(call).appendingPathComponent((rawName as NSString).lastPathComponent)
        do {
            if call.getBool("first") ?? false {
                try? FileManager.default.removeItem(at: url)
                guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
                    call.reject("could not create \(url.lastPathComponent)")
                    return
                }
            }
            let h = try FileHandle(forWritingTo: url)
            defer { try? h.close() }
            try h.seekToEnd()
            try h.write(contentsOf: data)
            call.resolve()
        } catch {
            call.reject("could not write \(url.lastPathComponent): \(error.localizedDescription)")
        }
    }

    /// One share sheet for every file already written with fileAppend, so a
    /// take with stems and MIDI is one "Save to Files" and not a zip made in
    /// the page (a second full copy of the take in memory).
    @objc func shareFiles(_ call: CAPPluginCall) {
        let names = (call.getArray("names", String.self) ?? [])
            .map { ($0 as NSString).lastPathComponent }
        let dir = dirURL(call)
        let kept = (call.getString("folder") ?? "").isEmpty == false
        let urls = names.map { dir.appendingPathComponent($0) }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        if urls.isEmpty {
            call.reject("shareFiles found nothing to share")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else {
                call.reject("no view controller to present from")
                return
            }
            let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.popoverPresentationController?.sourceRect =
                CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
            // Files kept in a folder stay whatever the sheet does; temporary ones
            // are cleared once it closes.
            sheet.completionWithItemsHandler = { _, _, _, _ in
                if !kept { urls.forEach { try? FileManager.default.removeItem(at: $0) } }
            }
            vc.present(sheet, animated: true) { call.resolve() }
        }
    }

    /// Where a call's files live: the temporary directory, or with `folder` a
    /// folder under Documents, which (with the file-sharing keys in Info.plist)
    /// is what the Files app shows under On My iPhone > mõdRïff. A bounce is
    /// written there as it is made, so the share sheet is an extra copy and a
    /// failed or cancelled share loses nothing.
    private func dirURL(_ call: CAPPluginCall) -> URL {
        guard let folder = call.getString("folder"), !folder.isEmpty,
              let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else { return FileManager.default.temporaryDirectory }
        var url = docs
        #if targetEnvironment(macCatalyst)
        // On a Mac the sandbox's Documents is ~/Library/Containers/Handel.modRiff/Data/Documents,
        // which nobody finds. Takes go to the real ~/Downloads/mõdRïff (the Downloads
        // entitlement in AppMac.entitlements), and fall back to the container only if
        // that folder cannot be made, so a bounce is never lost to a path.
        // .downloadsDirectory would return the container's copy, hence the passwd entry.
        if let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir {
            let real = URL(fileURLWithPath: String(cString: home), isDirectory: true)
                .appendingPathComponent("Downloads", isDirectory: true)
                .appendingPathComponent("mõdRïff", isDirectory: true)
            if (try? FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)) != nil {
                url = real
            }
        }
        #endif
        for part in folder.split(separator: "/") {
            let c = (String(part) as NSString).lastPathComponent
            if c.isEmpty || c == ".." || c == "." { continue }
            url.appendPathComponent(c)
        }
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func tmpURL(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent((name as NSString).lastPathComponent)
    }

    @objc func fileDelete(_ call: CAPPluginCall) {
        for n in call.getArray("names", String.self) ?? [] {
            try? FileManager.default.removeItem(at: tmpURL(n))
        }
        call.resolve()
    }

    /// Makes the final .wav from the raw 16-bit stereo PCM the page streamed to
    /// a temporary file while the take ran (fileAppend). A long bounce used to
    /// be held in the page as 32-bit floats, a mix and every stem, about
    /// 2.7 MB a second; at ten minutes the web content process was killed and
    /// the app came back at its start screen. Now the page keeps one block at
    /// a time and this puts the pieces together on disk: the header the page
    /// built, `leadBytes` of silence (a stem that started late), the PCM from
    /// `skipBytes` on, cut or padded with silence to exactly `dataBytes`.
    @objc func wavFinish(_ call: CAPPluginCall) {
        guard let pcm = call.getString("pcm"), let name = call.getString("name"),
              let hb64 = call.getString("header"), let header = Data(base64Encoded: hb64),
              let total = call.getInt("dataBytes") else {
            call.reject("wavFinish needs pcm, name, header and dataBytes")
            return
        }
        let lead = max(0, call.getInt("leadBytes") ?? 0)
        let skip = max(0, call.getInt("skipBytes") ?? 0)
        let src = tmpURL(pcm)
        let dst = dirURL(call).appendingPathComponent((name as NSString).lastPathComponent)
        do {
            try? FileManager.default.removeItem(at: dst)
            guard FileManager.default.createFile(atPath: dst.path, contents: nil) else {
                call.reject("could not create \(dst.lastPathComponent)")
                return
            }
            let out = try FileHandle(forWritingTo: dst)
            defer { try? out.close() }
            try out.write(contentsOf: header)
            let zeros = Data(count: 1 << 20)
            func pad(_ count: Int) throws {
                var k = count
                while k > 0 { let m = min(k, zeros.count); try out.write(contentsOf: zeros.prefix(m)); k -= m }
            }
            var left = total
            let l = min(lead, left)
            try pad(l)
            left -= l
            if let inp = try? FileHandle(forReadingFrom: src) {
                defer { try? inp.close() }
                try inp.seek(toOffset: UInt64(skip))
                while left > 0 {
                    let chunk = try inp.read(upToCount: min(left, 1 << 20)) ?? Data()
                    if chunk.isEmpty { break }
                    try out.write(contentsOf: chunk)
                    left -= chunk.count
                }
            }
            try pad(left)
            try? FileManager.default.removeItem(at: src)
            call.resolve(["bytes": total])
        } catch {
            call.reject("could not build \(dst.lastPathComponent): \(error.localizedDescription)")
        }
    }

    /// Adds 16-bit stereo PCM into a file already written, at a byte offset,
    /// clipping at full scale. The host's own capture of the native engine is
    /// laid onto the web mix this way once the take is over.
    @objc func pcmAdd(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let b64 = call.getString("data"),
              let add = Data(base64Encoded: b64), let off = call.getInt("offset"), off >= 0 else {
            call.reject("pcmAdd needs name, data and offset")
            return
        }
        func samples(_ d: Data) -> [Int16] {
            // The count is read before `a` is borrowed for writing: reading it
            // inside the closure is an overlapping access and does not compile.
            let n = d.count / 2
            var a = [Int16](repeating: 0, count: n)
            a.withUnsafeMutableBytes { _ = d.copyBytes(to: $0, count: n * 2) }
            return a
        }
        do {
            let h = try FileHandle(forUpdating: dirURL(call).appendingPathComponent((name as NSString).lastPathComponent))
            defer { try? h.close() }
            try h.seek(toOffset: UInt64(off))
            let cur = samples(try h.read(upToCount: add.count) ?? Data())
            var mix = samples(add)
            for i in 0..<min(cur.count, mix.count) {
                mix[i] = Int16(max(-32768, min(32767, Int32(cur[i]) + Int32(mix[i]))))
            }
            try h.seek(toOffset: UInt64(off))
            try h.write(contentsOf: mix.withUnsafeBytes { Data($0) })
            call.resolve()
        } catch {
            call.reject("could not add to \(name): \(error.localizedDescription)")
        }
    }

    /// Fades the last `frames` frames of a finished 16-bit stereo .wav to
    /// silence, starting at the byte `offset` of the first of them. A free export
    /// is cut at 30 seconds and the cut used to be a click; the page calls this
    /// after the host's capture has been laid on (pcmAdd), so the tail it fades
    /// is the whole mix. The curve is a raised cosine, 0 on the final frame, and
    /// is the same one the page applies in memory (_exportFadeGain): change both
    /// together.
    @objc func pcmFade(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let off = call.getInt("offset"), off >= 0,
              let frames = call.getInt("frames"), frames > 0 else {
            call.reject("pcmFade needs name, offset and frames")
            return
        }
        do {
            let h = try FileHandle(forUpdating: dirURL(call).appendingPathComponent((name as NSString).lastPathComponent))
            defer { try? h.close() }
            try h.seek(toOffset: UInt64(off))
            let raw = try h.read(upToCount: frames * 4) ?? Data()
            let n = raw.count / 4
            if n == 0 { call.resolve(); return }
            var s = [Int16](repeating: 0, count: n * 2)
            s.withUnsafeMutableBytes { _ = raw.copyBytes(to: $0, count: n * 4) }
            for i in 0..<n {
                let g = 0.5 * (1 + cos(Double.pi * Double(i + 1) / Double(frames)))
                s[i * 2] = Int16((Double(s[i * 2]) * g).rounded())
                s[i * 2 + 1] = Int16((Double(s[i * 2 + 1]) * g).rounded())
            }
            try h.seek(toOffset: UInt64(off))
            try h.write(contentsOf: s.withUnsafeBytes { Data($0) })
            call.resolve()
        } catch {
            call.reject("could not fade \(name): \(error.localizedDescription)")
        }
    }

    /// Asks iOS for the microphone itself, so the permission sheet comes from the
    /// app and the app gets its row in Settings. Left to the web view, getUserMedia
    /// was refused without iOS ever being asked (no sheet, no row, nothing to
    /// switch on), and the sampler could not record. Resolves with the answer; it
    /// does not open the microphone.
    @objc func micPermission(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        func status(_ p: AVAudioSession.RecordPermission) -> String {
            switch p {
            case .granted: return "granted"
            case .denied: return "denied"
            default: return "undetermined"
            }
        }
        if session.recordPermission == .undetermined {
            session.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    call.resolve(["granted": granted, "status": granted ? "granted" : "denied"])
                }
            }
        } else {
            let st = status(session.recordPermission)
            call.resolve(["granted": st == "granted", "status": st])
        }
    }

    /// This app's page in the Settings app: where the microphone switch is once iOS
    /// has been told no, after which it never asks again.
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.resolve(["opened": false]); return }
            UIApplication.shared.open(url, options: [:]) { ok in call.resolve(["opened": ok]) }
        }
    }

    @objc func micStart(_ call: CAPPluginCall) {
        stopMic()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            call.reject("no microphone input")
            return
        }
        micLock.lock(); micL.removeAll(keepingCapacity: true); micR.removeAll(keepingCapacity: true); micRate = format.sampleRate; micLock.unlock()
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self, let ch = buffer.floatChannelData else { return }
            let n = Int(buffer.frameLength)
            let left = ch[0]
            let right = buffer.format.channelCount > 1 ? ch[1] : ch[0]
            self.micLock.lock()
            if self.micL.count < ModEngine.micMaxFrames {
                self.micL.append(contentsOf: UnsafeBufferPointer(start: left, count: n))
                self.micR.append(contentsOf: UnsafeBufferPointer(start: right, count: n))
            }
            self.micLock.unlock()
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            call.reject("microphone engine: \(error.localizedDescription)")
            return
        }
        micEngine = engine
        call.resolve(["sampleRate": format.sampleRate, "channels": Int(format.channelCount)])
    }

    /// The samples gathered since the last read: left then right, float32, base64.
    @objc func micRead(_ call: CAPPluginCall) {
        micLock.lock()
        let l = micL, r = micR, rate = micRate
        micL.removeAll(keepingCapacity: true); micR.removeAll(keepingCapacity: true)
        micLock.unlock()
        var data = Data(capacity: (l.count + r.count) * 4)
        l.withUnsafeBufferPointer { data.append(UnsafeBufferPointer(start: $0.baseAddress, count: l.count)) }
        r.withUnsafeBufferPointer { data.append(UnsafeBufferPointer(start: $0.baseAddress, count: r.count)) }
        call.resolve(["frames": l.count, "sampleRate": rate, "data": data.base64EncodedString()])
    }

    @objc func micStop(_ call: CAPPluginCall) {
        stopMic()
        call.resolve()
    }

    private func stopMic() {
        guard let engine = micEngine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        micEngine = nil
    }

    /// Asks iOS for a different hardware buffer, in milliseconds. AppDelegate asks for 5 ms at launch,
    /// which leaves a 240-frame block no slack: one stall of 5 ms is a dropout. A bigger buffer is
    /// steadier and later. This only changes that one preference of the session AppDelegate owns (no
    /// category, no setActive: see start()); the render callback already takes whatever block size
    /// it is handed, up to maxFrames. iOS rounds the request, so the answer says what it gave.
    @objc func setBuffer(_ call: CAPPluginCall) {
        let ms = min(40.0, max(2.0, call.getDouble("ms") ?? 5.0))
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setPreferredIOBufferDuration(ms / 1000.0)
            call.resolve(["requestedMs": ms, "actualMs": session.ioBufferDuration * 1000.0])
        } catch {
            call.reject("could not set the buffer: \(error.localizedDescription)")
        }
    }

    @objc func stats(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let blocks = max(renderBlocks, 1)
        let sr = host.sampleRate
        // Load is the honest number: time spent rendering divided by the
        // real time those frames represent. Over 1.0 and the callback cannot
        // keep up, which is what a dropout sounds like.
        let seconds = sr > 0 ? Double(renderFrames) / sr : 0
        let load = seconds > 0 ? Double(renderNanosTotal) / 1e9 / seconds : 0
        var out: [String: Any] = [
            "sampleRate": sr,
            "framesRendered": Int(host.framesRendered),
            "dropped": Int(host.dropped),
            "activeVoices": Int(host.activeVoices),
            "renderBlocks": Int(blocks),
            "avgRenderUs": Double(renderNanosTotal) / Double(blocks) / 1000.0,
            "maxRenderUs": Double(renderNanosMax) / 1000.0,
            "load": load,
            "graph": host.graphStats(),
            "slowCount": Int(slowCount),
            "missed": Int(missedCount),
            "missedLog": (0..<min(Int(missedCount), ModEngine.missSlots)).map { i in
                ["atSec": sr > 0 ? Double(missAt[i]) / sr : 0, "us": missUs[i]]
            },
            "missedLastAtSec": sr > 0 ? Double(missLastAt) / sr : 0,
            "slow": (0..<min(Int(slowCount), ModEngine.slowSlots)).map { i in
                ["secondsAgo": sr > 0 ? Double(renderFrames - slowAt[i]) / sr : 0, "us": slowUs[i]]
            }
        ]
        // Staying alive (6.9.4): what happened to the session, and what the last
        // times the app was left (with background play on, as a test) looked like.
        lifeLock.lock()
        out["life"] = lifeLog.map { ["secondsAgo": (Date().timeIntervalSince($0.at) * 10).rounded() / 10, "what": $0.what] }
        lifeLock.unlock()
        out["restarts"] = restarts
        out["interruptions"] = interruptions
        out["engineRunning"] = engine?.isRunning ?? false
        out["keepPlaying"] = keepPlaying
        bgLock.lock()
        out["bg"] = bgReports
        bgLock.unlock()
        call.resolve(out)
    }
}
