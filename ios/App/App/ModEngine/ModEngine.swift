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
        CAPPluginMethod(name: "stats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "meters", returnType: CAPPluginReturnPromise)
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

    // Render-cost accounting. Written only by the render thread, read by
    // stats() — plain Int64s through atomics-by-convention: one writer, and a
    // torn read would cost a wrong number in a diagnostic, not a glitch.
    private var renderNanosTotal: Int64 = 0
    private var renderNanosMax: Int64 = 0
    private var renderBlocks: Int64 = 0
    private var renderFrames: Int64 = 0
    // The last few blocks that took over 2 ms (a block is ~2.7 ms of audio, so
    // this is most of the budget): the frame count when each started, and how
    // long it took. maxRenderUs says a stall happened; this says when, so it can
    // be lined up with what was being done. Preallocated; the render thread only
    // stores into it.
    private static let slowSlots = 8
    private let slowAt = UnsafeMutablePointer<Int64>.allocate(capacity: ModEngine.slowSlots)
    private let slowUs = UnsafeMutablePointer<Double>.allocate(capacity: ModEngine.slowSlots)
    private var slowCount: Int64 = 0

    private static let signpostLog = OSLog(subsystem: "com.handelmusic.modriff",
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

    /// Each part's RMS since the last call (the loudest block, then reset), for
    /// the mixer's meters. Separate from stats so reading one does not clear
    /// the other.
    @objc func meters(_ call: CAPPluginCall) {
        guard let host = host else { call.reject("engine not started"); return }
        call.resolve(["rms": (0..<8).map { Double(host.meter(forPart: Int32($0))) }])
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
            "renderBlocks": Int(blocks),
            "avgRenderUs": Double(renderNanosTotal) / Double(blocks) / 1000.0,
            "maxRenderUs": Double(renderNanosMax) / 1000.0,
            "load": load,
            "slowCount": Int(slowCount),
            "slow": (0..<min(Int(slowCount), ModEngine.slowSlots)).map { i in
                ["secondsAgo": sr > 0 ? Double(renderFrames - slowAt[i]) / sr : 0, "us": slowUs[i]]
            }
        ])
    }
}
