import AVFoundation
import Capacitor
import Foundation
import os.signpost

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
        CAPPluginMethod(name: "stats", returnType: CAPPluginReturnPromise)
    ]

    /// Capacitor calls this when it registers the plugin. It is the only
    /// proof that a CAPBridgedPlugin declared in the app target — rather than
    /// in a Swift package, as the bundled plugins are — is discovered at all.
    /// Cheap, and it turns "it should register" into something the device log
    /// answers.
    override public func load() {
        NSLog("[ModEngine] plugin registered")
    }

    private var engine: AVAudioEngine?
    private var source: AVAudioSourceNode?
    private var host: ModEngineHost?
    private var started = false
    private var watchdog: Timer?
    private var restarts = 0

    // Render-cost accounting. Written only by the render thread, read by
    // stats() — plain Int64s through atomics-by-convention: one writer, and a
    // torn read would cost a wrong number in a diagnostic, not a glitch.
    private var renderNanosTotal: Int64 = 0
    private var renderNanosMax: Int64 = 0
    private var renderBlocks: Int64 = 0
    private var renderFrames: Int64 = 0

    private static let signpostLog = OSLog(subsystem: "com.handelmusic.modriff",
                                           category: "modengine")

    // MARK: - Lifecycle

    @objc func start(_ call: CAPPluginCall) {
        if started {
            call.resolve(["started": true, "sampleRate": host?.sampleRate ?? 0])
            return
        }
        do {
            // The app is an instrument: .playback keeps it sounding with the
            // ring/silent switch on silent, which is where most phones live.
            // AppDelegate sets the category for the web view's own audio; the
            // native engine needs the session *active*, which nothing was
            // doing before, because AVAudioEngine will not start otherwise.
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)

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
            self.watchForStops()

            call.resolve([
                "started": true,
                "sampleRate": sampleRate,
                "maxFrames": maxFrames
            ])
        } catch {
            call.reject("audio engine failed to start: \(error.localizedDescription)")
        }
    }

    /// Keeps the graph alive.
    ///
    /// Measured on the phone: the engine rendered 34,816 frames — 0.73 s at
    /// 48 kHz — and then stopped, and every message after that piled up in a
    /// queue nobody was draining. The web view is the other tenant of this
    /// process's audio session: WebKit configures AVAudioSession for its own
    /// AudioContext, and that reconfiguration both interrupts us and changes
    /// the engine's configuration underneath it. AVAudioEngine does not come
    /// back from either on its own.
    ///
    /// So: watch for both, and restart. The poll is the backstop, because an
    /// engine can also be left not-running by a route change that fires
    /// neither notification, and a silent instrument is worse than a timer.
    private func watchForStops() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: .AVAudioEngineConfigurationChange,
                       object: engine, queue: .main) { [weak self] _ in
            NSLog("[ModEngine] configuration changed — restarting")
            self?.restartEngine()
        }
        nc.addObserver(forName: AVAudioSession.interruptionNotification,
                       object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .ended {
                NSLog("[ModEngine] interruption ended — restarting")
                self?.restartEngine()
            }
        }
        // On the main queue, deliberately. Capacitor runs plugin calls on a
        // background thread, and Timer.scheduledTimer attaches to whatever
        // run loop is current — a dispatch queue thread has none, so the
        // first version of this created a timer that never fired once.
        // Measured: isRunning=false, restarts=0, for the whole session.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.watchdog == nil else { return }
            self.watchdog = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                guard let self = self, self.started, let e = self.engine, !e.isRunning else { return }
                self.restartEngine()
            }
        }
    }

    private func restartEngine() {
        guard started, let engine = engine else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            if !session.isOtherAudioPlaying || true {
                try? session.setCategory(.playback, mode: .default)
                try? session.setActive(true)
            }
            if !engine.isRunning {
                engine.prepare()
                try engine.start()
                restarts += 1
                // Only the first few, then every hundredth: a restart loop
                // must be visible without drowning the log.
                if restarts <= 3 || restarts % 100 == 0 {
                    NSLog("[ModEngine] restarted (%d), running=%@", restarts,
                          engine.isRunning ? "yes" : "no")
                }
            }
        } catch {
            NSLog("[ModEngine] restart failed: %@", error.localizedDescription)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        watchdog?.invalidate()
        watchdog = nil
        NotificationCenter.default.removeObserver(self)
        engine?.stop()
        if let source = source { engine?.detach(source) }
        source = nil
        engine = nil
        host = nil
        started = false
        try? AVAudioSession.sharedInstance().setActive(false)
        call.resolve(["started": false])
    }

    /// Builds a part's processor and warms its containers. Both allocate, so
    /// both happen here rather than on the render thread.
    @objc func ensurePart(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let part = call.getInt("part") ?? 0
        guard host.ensurePart(Int32(part)) else {
            call.reject("part \(part) out of range")
            return
        }
        if call.getBool("warm") ?? true { host.warmUpPart(Int32(part)) }
        call.resolve(["part": part])
    }

    /// One worklet-shaped message. Parsed into a POD and queued here, on
    /// Capacitor's thread — never on the render thread.
    @objc func post(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
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

    @objc func stats(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        let blocks = max(renderBlocks, 1)
        let sr = host.sampleRate
        // Load is the honest number: time spent rendering divided by the
        // real time those frames represent. Over 1.0 and the callback cannot
        // keep up, which is what a dropout sounds like.
        let seconds = sr > 0 ? Double(renderFrames) / sr : 0
        let load = seconds > 0 ? Double(renderNanosTotal) / 1e9 / seconds : 0
        call.resolve([
            "sampleRate": sr,
            "framesRendered": Int(host.framesRendered),
            "dropped": Int(host.dropped),
            "activeVoices": Int(host.activeVoices),
            "peakOut": Double(host.peakOut),
            "notesOn": Int(host.notesOn),
            "renderBlocks": Int(blocks),
            "avgRenderUs": Double(renderNanosTotal) / Double(blocks) / 1000.0,
            "maxRenderUs": Double(renderNanosMax) / 1000.0,
            "load": load,
            "isRunning": engine?.isRunning ?? false,
            "restarts": restarts
        ])
    }
}
