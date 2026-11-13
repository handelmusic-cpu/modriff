// Runs the production router against the Mac's real devices; no tone is emitted.
// swiftc ios/App/App/ModEngine/ModAudioOutput.swift tests/audiooutput/route.swift -o /tmp/modriff-route-test
import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

@main struct OutputRouteTest {
    static func check(_ condition: Bool, _ message: String = "Route check failed") throws {
        if !condition { throw NSError(domain: "RouteTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func main() {
        setbuf(stdout, nil)
        // The app changes routes on its audio queue. Keep main free for system audio/XPC callbacks here too.
        DispatchQueue.global(qos: .userInitiated).async {
            do { try run(); exit(0) }
            catch { fputs("FAIL: \(error)\n", stderr); exit(1) }
        }
        RunLoop.main.run()
    }
    static func run() throws {
        if CommandLine.arguments.contains("--cleanup") {
            for output in ModMacAudioOutput.devices() where output.name == "modRiff temporary route test" {
                print("Cleanup temporary aggregate", output.id, AudioHardwareDestroyAggregateDevice(output.id))
            }
            return
        }
        // A temporary aggregate gives a second real destination on a laptop with no interface attached.
        let systemUID = ModMacAudioOutput.string(ModMacAudioOutput.defaultDevice(), kAudioDevicePropertyDeviceUID)!
        var inputProperty = ModMacAudioOutput.address(kAudioHardwarePropertyDefaultInputDevice)
        var input: AudioDeviceID = 0
        var inputSize = UInt32(MemoryLayout.size(ofValue: input))
        _ = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &inputProperty, 0, nil, &inputSize, &input)
        var subdevices: [[String: Any]] = [[kAudioSubDeviceUIDKey: systemUID]]
        let bidirectional = CommandLine.arguments.contains("--bidirectional")
        if bidirectional, let inputUID = ModMacAudioOutput.string(input, kAudioDevicePropertyDeviceUID) { subdevices.append([kAudioSubDeviceUIDKey: inputUID, kAudioSubDeviceDriftCompensationKey: true]) }
        let description: [String: Any] = [
            kAudioAggregateDeviceUIDKey: "modriff-route-test-" + UUID().uuidString,
            kAudioAggregateDeviceNameKey: "modRiff temporary route test",
            kAudioAggregateDeviceIsPrivateKey: false,
            kAudioAggregateDeviceMainSubDeviceKey: systemUID,
            kAudioAggregateDeviceSubDeviceListKey: subdevices
        ]
        var aggregate: AudioDeviceID = 0
        let created = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregate)
        try check(created == noErr, "Could not create temporary output: \(created)")
        var needsExternalCleanup = false
        defer { if !needsExternalCleanup { AudioHardwareDestroyAggregateDevice(aggregate) } }
        Thread.sleep(forTimeInterval: 0.25)
        let outputs = ModMacAudioOutput.devices()
        try check(outputs.contains(where: { $0.id == aggregate }), "Second output missing from device list")
        try check(!outputs.isEmpty, "No hardware outputs available")
        try check(Set(outputs.map(\.uid)).count == outputs.count, "Device UIDs must be unique")
        let systemDefault = ModMacAudioOutput.defaultDevice()
        let engine = AVAudioEngine()
        let router = ModMacAudioOutputDriver()
        var frames = 0, timestampedFrames = 0
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
        let source = AVAudioSourceNode(format: format) { _, _, count, buffers in
            frames += Int(count)
            if router.renderHostTime != 0 { timestampedFrames += Int(count) }
            for buffer in UnsafeMutableAudioBufferListPointer(buffers) {
                if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
            }
            return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        try router.setDevice(systemDefault, on: engine)
        try engine.start()
        defer { router.stop(); engine.stop() }
        for output in outputs {
            let previous = router.device, beforeSwitch = frames, began = Date()
            do { try router.setDevice(output.id, on: engine) }
            catch {
                if output.id == aggregate, bidirectional {
                    let elapsed = Date().timeIntervalSince(began)
                    try check(elapsed < 4 && router.device == previous && engine.isRunning && frames > beforeSwitch, "Unresponsive interface interrupted the working output")
                    print("PASS unresponsive bidirectional aggregate rejected after \(elapsed)s; \(frames-beforeSwitch) frames continued on previous output")
                    // The worker is stuck inside Core Audio. Destroy this temporary public device after the probe exits.
                    needsExternalCleanup = true
                    return
                }
                throw error
            }
            try check(router.device == output.id, "Wrong hardware device")
            let before = frames, timedBefore = timestampedFrames
            Thread.sleep(forTimeInterval: 0.35)
            let rendered = frames - before
            print("MEASURE \(output.name): source=\(rendered) running=\(engine.isRunning) callback=\(router.counters.callbacks) buffers=\(router.counters.buffers) frames=\(router.counters.frames) status=\(router.counters.status) error=\(router.counters.error)")
            try check(engine.isRunning && rendered > 0, "No audio renders after switch")
            try check(timestampedFrames - timedBefore == rendered, "Source frames lost their hardware host time")
            try check(ModMacAudioOutput.defaultDevice() == systemDefault, "System default was changed")
            print("PASS \(output.name): device=\(output.id) frames=\(rendered); system default unchanged")
        }
        let beforeFailure = router.device
        var rejected = false
        do { try router.setDevice(AudioDeviceID.max, on: engine) }
        catch { rejected = true }
        try check(rejected && engine.isRunning && router.device == beforeFailure, "Failed switch lost the previous route")
        print("PASS disconnected device rejected; engine still running on previous output")
        try router.setDevice(systemDefault, on: engine)
        try check(router.device == systemDefault)
        engine.stop()
        try router.setDevice(outputs[0].id, on: engine)
        try check(!engine.isRunning, "Switch started a deliberately stopped engine")
        try engine.start()
        try check(engine.isRunning, "Saved output could not start")
        print("PASS default, stopped-engine selection and restart")
    }
}
