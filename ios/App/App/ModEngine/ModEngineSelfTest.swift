import AVFoundation
import Foundation

/// One note out of the C++ engine, with nothing else running.
///
/// Debug builds only, and deliberately independent of everything else: no
/// Capacitor, no plugin, no web view, no `window.modEngine`. It owns its own
/// ModEngineHost and its own AVAudioEngine, so when it fails there is only
/// one thing it can be failing at.
///
/// That independence is the point. The first attempt at native audio was a
/// live A/B switch — two engines, one process, one audio session, driven
/// from a 50,000-line page — and when it produced silence the cause could
/// have been anywhere in that chain. Four rounds of instrumenting went by
/// before the actual fault (the graph stopping after 0.73 s) was visible.
/// This asks the smallest question that can be asked.
///
/// It asks it in two halves, because they are two different failures that
/// look identical from outside:
///
///   A. **Does the DSP make a sound?** Rendered offline, into a buffer, with
///      no audio graph at all. If this is silent, nothing downstream matters.
///   B. **Does the graph stay alive and play it?** The same engine through
///      AVAudioEngine, sampled over several seconds. A is what yesterday's
///      debugging never separated out.
enum ModEngineSelfTest {

    private static var engine: AVAudioEngine?
    private static var host: ModEngineHost?

    static func run() {
        #if DEBUG
        let session = AVAudioSession.sharedInstance()
        let sr = session.sampleRate
        NSLog("[SelfTest] session: sr=%.0f category=%@ active-owner=AppDelegate",
              sr, session.category.rawValue)

        let host = ModEngineHost(sampleRate: sr, maxFrames: 4096)
        self.host = host
        guard host.ensurePart(0) else { NSLog("[SelfTest] ensurePart failed"); return }
        // No pAll: a fresh Processor already holds PARAM_INFO's defaults, so
        // it has an audible patch before anything is sent to it.

        // ── A: the DSP alone ─────────────────────────────────────────────
        host.post(["t": "on", "part": 0, "note": 60, "vel": 0.9, "id": 1])
        let offline = host.renderOfflinePeak(forPart: 0, frames: 4096)
        NSLog("[SelfTest] A offline peak=%.5f notesOn=%u  (<0 means no processor; 0 means silence)",
              offline, host.notesOn)
        host.post(["t": "panic", "part": 0])
        _ = host.renderOfflinePeak(forPart: 0, frames: 512)
        _ = host.peakOut

        // ── B: the same engine through the audio graph ───────────────────
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2) else {
            NSLog("[SelfTest] no float format at %.0f", sr); return
        }
        let engine = AVAudioEngine()
        let source = AVAudioSourceNode(format: format) { _, _, frameCount, abl -> OSStatus in
            let bufs = UnsafeMutableAudioBufferListPointer(abl)
            guard bufs.count >= 2,
                  let l = bufs[0].mData?.assumingMemoryBound(to: Float.self),
                  let r = bufs[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            host.render(into: l, right: r, frames: Int32(frameCount))
            return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        engine.prepare()
        do { try engine.start() } catch {
            NSLog("[SelfTest] engine.start failed: %@", error.localizedDescription); return
        }
        self.engine = engine
        NSLog("[SelfTest] B engine started, running=%@", engine.isRunning ? "yes" : "no")

        host.post(["t": "on", "part": 0, "note": 60, "vel": 0.9, "id": 2])

        // Sampled over 6 s. The failure being looked for showed up at 0.73 s
        // and was invisible in any single reading — it was `framesRendered`
        // being *the same number* twice that gave it away.
        for i in 1...6 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) {
                NSLog("[SelfTest] B t=%ds running=%@ frames=%llu peak=%.5f voices=%d dropped=%u",
                      i, engine.isRunning ? "yes" : "no",
                      host.framesRendered, host.peakOut, host.activeVoices, host.dropped)
                if i == 3 { host.post(["t": "on", "part": 0, "note": 67, "vel": 0.9, "id": 3]) }
                if i == 6 {
                    host.post(["t": "panic", "part": 0])
                    engine.stop()
                    NSLog("[SelfTest] done — a peak above 0 with frames still climbing is a pass")
                }
            }
        }
        #endif
    }
}
