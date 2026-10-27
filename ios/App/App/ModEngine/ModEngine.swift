import AVFoundation
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
        CAPPluginMethod(name: "graphProbe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphBuf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphBegin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "graphEdit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
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
        call.resolve(["ok": host.editGraph(Int32(gid), increments: inc)])
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
            "graph": host.graphStats(),
            "slowCount": Int(slowCount),
            "slow": (0..<min(Int(slowCount), ModEngine.slowSlots)).map { i in
                ["secondsAgo": sr > 0 ? Double(renderFrames - slowAt[i]) / sr : 0, "us": slowUs[i]]
            }
        ])
    }
}
