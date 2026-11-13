import AVFoundation
import AudioToolbox
import CoreAudio

#if targetEnvironment(macCatalyst) || os(macOS)
/// Core Audio device IDs change across reconnects; only UIDs belong in saved preferences.
enum ModMacAudioOutput {
    struct Device {
        let id: AudioDeviceID
        let uid: String
        let name: String
    }

    static func address(_ selector: AudioObjectPropertySelector,
                        _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    static func string(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var property = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    static func devices() -> [Device] {
        var property = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        let status = ids.withUnsafeMutableBytes {
            AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size, $0.baseAddress!)
        }
        guard status == noErr else { return [] }
        return ids.compactMap { id in
            // Input-only interfaces must never appear as destinations.
            var streams = address(kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput)
            var bytes: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &bytes) == noErr, bytes > 0,
                  let uid = string(id, kAudioDevicePropertyDeviceUID),
                  let name = string(id, kAudioObjectPropertyName) else { return nil }
            return Device(id: id, uid: uid, name: name)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func defaultDevice() -> AudioDeviceID {
        var property = address(kAudioHardwarePropertyDefaultOutputDevice)
        var device: AudioDeviceID = 0
        var size = UInt32(MemoryLayout.size(ofValue: device))
        _ = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size, &device)
        return device
    }

}

/// Catalyst's RemoteIO rejects CurrentDevice. Pull the same AVAudioEngine graph from
/// the selected Core Audio device instead; the system output and sampler input stay independent.
final class ModMacAudioOutputDriver {
    private(set) var device: AudioDeviceID = 0
    private var unit: AudioUnit?
    private var rate: Double = 0
    private var renderBuffer: AVAudioPCMBuffer?
    private var renderContext: RenderContext?
    private final class RenderContext {
        let render: AVAudioEngineManualRenderingBlock
        let audioBuffers: UnsafeMutablePointer<AudioBufferList>
        let counters: Counters
        var hostTime: UInt64 = 0
        let ticksPerFrame: Double
        init(render: @escaping AVAudioEngineManualRenderingBlock, audioBuffers: UnsafeMutablePointer<AudioBufferList>, counters: Counters, rate: Double) {
            self.render = render; self.audioBuffers = audioBuffers; self.counters = counters
            ticksPerFrame = Double(AVAudioTime.hostTime(forSeconds: 1)) / rate
        }
    }
    final class Counters {
        var callbacks = 0, buffers = 0, frames = 0, status = 0
        var error: OSStatus = noErr
    }
    private(set) var counters = Counters()

    private func outputRate(_ id: AudioDeviceID) throws -> Double {
        var property = ModMacAudioOutput.address(kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &property, 0, nil, &size) == noErr, size > 0 else { throw failure("That audio output is unavailable.") }
        var streams = [AudioStreamID](repeating: 0, count: Int(size) / MemoryLayout<AudioStreamID>.size)
        let status = streams.withUnsafeMutableBytes { AudioObjectGetPropertyData(id, &property, 0, nil, &size, $0.baseAddress!) }
        guard status == noErr else { throw failure("Could not read that audio output.") }
        var sampleRate: Double = 0
        for stream in streams {
            var format = AudioStreamBasicDescription()
            var bytes = UInt32(MemoryLayout.size(ofValue: format))
            var address = ModMacAudioOutput.address(kAudioStreamPropertyVirtualFormat)
            guard AudioObjectGetPropertyData(stream, &address, 0, nil, &bytes, &format) == noErr,
                  format.mFormatID == kAudioFormatLinearPCM, format.mSampleRate > 0,
                  sampleRate == 0 || sampleRate == format.mSampleRate else {
                throw failure("This output does not provide a supported audio format.")
            }
            sampleRate = format.mSampleRate
        }
        return sampleRate
    }

    private func failure(_ message: String, _ code: OSStatus = -1) -> NSError {
        NSError(domain: "ModAudioOutput", code: Int(code), userInfo: [NSLocalizedDescriptionKey: message])
    }

    private final class Preparation {
        let lock = NSLock()
        let ready = DispatchSemaphore(value: 0)
        var result: Result<AudioUnit, Error>?
        var abandoned = false
        var finished = false
        func complete(_ value: Result<AudioUnit, Error>) {
            lock.lock()
            finished = true
            if abandoned {
                lock.unlock()
                if case .success(let unit) = value { AudioComponentInstanceDispose(unit) }
            } else { result = value; lock.unlock() }
            ready.signal()
        }
        deinit { if case .success(let unit) = result { AudioComponentInstanceDispose(unit) } }
    }
    private var preparations: [AudioDeviceID: Preparation] = [:]

    private func prepareHardware(_ id: AudioDeviceID, format: AVAudioFormat) throws -> AudioUnit {
        if let pending = preparations[id] {
            pending.lock.lock()
            let finished = pending.finished
            pending.lock.unlock()
            if !finished { throw failure("This audio output is not responding. Reconnect the interface before trying again.") }
            preparations.removeValue(forKey: id)
        }
        let preparation = Preparation()
        preparations[id] = preparation
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try Self.makeHardware(id, format: format) }
            preparation.complete(result)
        }
        // Some drivers block in CurrentDevice. Keep the old output playing while this is tried,
        // and leave the control queue usable even when a hardware driver never replies.
        _ = preparation.ready.wait(timeout: .now() + 3)
        preparation.lock.lock()
        guard let result = preparation.result else {
            preparation.abandoned = true
            preparation.lock.unlock()
            throw failure("This audio output did not respond. Your previous output is still selected.")
        }
        preparation.result = nil
        preparation.lock.unlock()
        preparations.removeValue(forKey: id)
        return try result.get()
    }

    private static func makeHardware(_ id: AudioDeviceID, format: AVAudioFormat) throws -> AudioUnit {
        func check(_ code: OSStatus) throws {
            if code != noErr { throw NSError(domain: "ModAudioOutput", code: Int(code), userInfo: [NSLocalizedDescriptionKey: "Could not prepare that audio output (\(code))."]) }
        }
        // The public HAL output component exists in Catalyst, but its subtype constant
        // is omitted from the iOS SDK overlay. 'ahal' is the documented macOS subtype.
        var description = AudioComponentDescription(componentType: kAudioUnitType_Output, componentSubType: 0x6168616c,
            componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
        guard let component = AudioComponentFindNext(nil, &description) else { throw NSError(domain: "ModAudioOutput", code: -1) }
        var created: AudioUnit?
        try check(AudioComponentInstanceNew(component, &created))
        guard let unit = created else { throw NSError(domain: "ModAudioOutput", code: -1) }
        var handedOff = false
        defer { if !handedOff { AudioComponentInstanceDispose(unit) } }
        // Output selection must never enable the interface's recording stream.
        var disabled: UInt32 = 0
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1,
            &disabled, UInt32(MemoryLayout.size(ofValue: disabled))))
        var target = id
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
            &target, UInt32(MemoryLayout.size(ofValue: target))))
        var actual: AudioDeviceID = 0
        var actualSize = UInt32(MemoryLayout.size(ofValue: actual))
        try check(AudioUnitGetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &actual, &actualSize))
        guard actual == id else { throw NSError(domain: "ModAudioOutput", code: -1) }
        var hardwareFormat = AudioStreamBasicDescription()
        var hardwareSize = UInt32(MemoryLayout.size(ofValue: hardwareFormat))
        try check(AudioUnitGetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &hardwareFormat, &hardwareSize))
        var streamFormat = format.streamDescription.pointee
        if hardwareFormat.mChannelsPerFrame == 1 { streamFormat.mChannelsPerFrame = 1 }
        try check(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0,
            &streamFormat, UInt32(MemoryLayout.size(ofValue: streamFormat))))
        handedOff = true
        return unit
    }

    var renderHostTime: UInt64 { renderContext?.hostTime ?? 0 }

    var outputLatency: Double {
        guard device != 0, rate > 0 else { return 0 }
        func frames(_ selector: AudioObjectPropertySelector) -> UInt32 {
            var property = ModMacAudioOutput.address(selector, kAudioDevicePropertyScopeOutput)
            var value: UInt32 = 0
            var bytes = UInt32(MemoryLayout.size(ofValue: value))
            _ = AudioObjectGetPropertyData(device, &property, 0, nil, &bytes, &value)
            return value
        }
        var unitLatency: Double = 0
        var bytes = UInt32(MemoryLayout.size(ofValue: unitLatency))
        if let unit = unit { _ = AudioUnitGetProperty(unit, kAudioUnitProperty_Latency, kAudioUnitScope_Global, 0, &unitLatency, &bytes) }
        return Double(frames(kAudioDevicePropertyLatency) + frames(kAudioDevicePropertySafetyOffset)) / rate + unitLatency
    }

    var bufferDuration: Double {
        guard device != 0, rate > 0 else { return 0 }
        var frames: UInt32 = 0
        var bytes = UInt32(MemoryLayout.size(ofValue: frames))
        var property = ModMacAudioOutput.address(kAudioDevicePropertyBufferFrameSize)
        guard AudioObjectGetPropertyData(device, &property, 0, nil, &bytes, &frames) == noErr else { return 0 }
        return Double(frames) / rate
    }

    func stop() {
        if let unit = unit {
            AudioOutputUnitStop(unit)
            AudioUnitUninitialize(unit)
            AudioComponentInstanceDispose(unit)
        }
        unit = nil
        renderContext = nil
        renderBuffer = nil
        device = 0
    }

    func setDevice(_ id: AudioDeviceID, on engine: AVAudioEngine) throws {
        let sampleRate = try outputRate(id)  // Reject missing devices before stopping the working route.
        if device == id, unit != nil, rate == sampleRate { return }
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else { throw failure("Output format unavailable.") }
        let hardware = try prepareHardware(id, format: format)
        let previous = device
        let running = engine.isRunning
        stop()
        engine.stop()
        do {
            try connect(id, sampleRate: sampleRate, engine: engine, hardware: hardware)
            if running { try engine.start() }
        } catch {
            stop()
            // Restore the working destination before reporting an unsuccessful switch.
            if previous != 0, let oldRate = try? outputRate(previous) {
                if let oldFormat = AVAudioFormat(standardFormatWithSampleRate: oldRate, channels: 2),
                   let oldHardware = try? prepareHardware(previous, format: oldFormat) {
                    try? connect(previous, sampleRate: oldRate, engine: engine, hardware: oldHardware)
                }
            }
            if running { try? engine.start() }
            throw error
        }
    }

    private func connect(_ id: AudioDeviceID, sampleRate: Double, engine: AVAudioEngine, hardware: AudioUnit) throws {
        unit = hardware
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2),
              let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512) else {
            throw failure("Could not prepare this output's audio format.")
        }
        if engine.isInManualRenderingMode { engine.disableManualRenderingMode() }
        try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        let render = engine.manualRenderingBlock
        pcm.frameLength = 512
        renderBuffer = pcm
        // Fetch once: asking PCMBuffer for this again resets byte sizes from frameLength.
        let audioBuffers = pcm.mutableAudioBufferList
        let counters = Counters()
        self.counters = counters
        let created = hardware
        let context = RenderContext(render: render, audioBuffers: audioBuffers, counters: counters, rate: sampleRate)
        renderContext = context
        var callback = AURenderCallbackStruct(inputProc: { ref, _, timestamp, _, frameCount, output in
            guard let output = output else { return noErr }
            let context = Unmanaged<RenderContext>.fromOpaque(ref).takeUnretainedValue()
            let counters = context.counters
            let audioBuffers = context.audioBuffers
            let buffers = UnsafeMutableAudioBufferListPointer(audioBuffers)
            let destinations = UnsafeMutableAudioBufferListPointer(output)
            counters.callbacks += 1
            counters.buffers = destinations.count
            var channels: UInt32 = 0
            for buffer in destinations {
                channels += buffer.mNumberChannels
                if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
            }
            guard let first = destinations.first, first.mNumberChannels > 0 else { return noErr }
            let frames = Int(frameCount)
            var offset = 0
            while offset < frames {
                let count = min(512, frames - offset)
                for i in 0..<buffers.count { buffers[i].mDataByteSize = UInt32(count * 4) }
                // Manual AVAudioEngine timestamps have no host clock. Preserve HAL's heard-time
                // origin for the source callback (and Link), including this chunk's hardware offset.
                context.hostTime = timestamp.pointee.mFlags.contains(.hostTimeValid)
                    ? timestamp.pointee.mHostTime + UInt64(Double(offset) * context.ticksPerFrame) : 0
                var error: OSStatus = noErr
                let result = context.render(AVAudioFrameCount(count), audioBuffers, &error)
                counters.status = result.rawValue
                counters.error = error
                if result == .success { counters.frames += count }
                if result == .success, buffers.count == 2,
                   let left = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                   let right = buffers[1].mData?.assumingMemoryBound(to: Float.self) {
                    var channel = 0
                    for buffer in destinations {
                        let width = Int(buffer.mNumberChannels)
                        if let data = buffer.mData?.assumingMemoryBound(to: Float.self) {
                            for c in 0..<width where channel + c < 2 {
                                for f in 0..<count {
                                    data[(offset + f) * width + c] = channels == 1 ? (left[f] + right[f]) * 0.5 : (channel + c == 0 ? left[f] : right[f])
                                }
                            }
                        }
                        channel += width
                    }
                }
                offset += count
            }
            return noErr
        }, inputProcRefCon: Unmanaged.passUnretained(context).toOpaque())
        try check(AudioUnitSetProperty(created, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0,
            &callback, UInt32(MemoryLayout.size(ofValue: callback))))
        try check(AudioUnitInitialize(created))
        try check(AudioOutputUnitStart(created))
        device = id
        rate = sampleRate
    }

    private func check(_ status: OSStatus) throws {
        guard status == noErr else { throw failure("Could not configure that audio output (\(status)).", status) }
    }

    deinit { stop() }
}


final class ModMacOutputWatch {
    private let queue: DispatchQueue
    private let block: AudioObjectPropertyListenerBlock
    private var watchedDevice: AudioDeviceID = 0
    private let selectors: [AudioObjectPropertySelector] = [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultOutputDevice]
    init(queue: DispatchQueue, changed: @escaping () -> Void) {
        self.queue = queue
        block = { _, _ in changed() }
        for selector in selectors {
            var property = ModMacAudioOutput.address(selector)
            AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &property, queue, block)
        }
    }
    func watchDevice(_ device: AudioDeviceID) {
        if watchedDevice == device { return }
        var property = ModMacAudioOutput.address(kAudioDevicePropertyNominalSampleRate)
        if watchedDevice != 0 { AudioObjectRemovePropertyListenerBlock(watchedDevice, &property, queue, block) }
        watchedDevice = device
        if device != 0 { AudioObjectAddPropertyListenerBlock(device, &property, queue, block) }
    }
    deinit {
        watchDevice(0)
        for selector in selectors {
            var property = ModMacAudioOutput.address(selector)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &property, queue, block)
        }
    }
}
#endif

#if os(iOS) && !targetEnvironment(macCatalyst)
import AVKit
import UIKit

/// Keep the real system route control tappable; there is no public API to open its menu programmatically.
final class ModOutputPickerController: UIViewController {
    private let stack = UIStackView()
    private let current = UILabel()
    private let choices = UIStackView()
    private var observer: NSObjectProtocol?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Audio output"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(done))
        stack.axis = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
        current.font = .preferredFont(forTextStyle: .body)
        current.adjustsFontForContentSizeCategory = true
        current.numberOfLines = 0
        stack.addArrangedSubview(current)
        let row = UIStackView()
        row.alignment = .center
        let label = UILabel()
        label.text = "Headphones & speakers"
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        row.addArrangedSubview(label)
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = false
        picker.widthAnchor.constraint(equalToConstant: 60).isActive = true
        picker.heightAnchor.constraint(equalToConstant: 60).isActive = true
        row.addArrangedSubview(picker)
        stack.addArrangedSubview(row)
        choices.axis = .vertical
        choices.spacing = 12
        stack.addArrangedSubview(choices)
        let note = UILabel()
        note.text = "Pair Bluetooth headphones in your device settings first. Wireless audio adds delay; wired headphones or an audio interface respond sooner."
        note.font = .preferredFont(forTextStyle: .footnote)
        note.adjustsFontForContentSizeCategory = true
        note.numberOfLines = 0
        note.textColor = .secondaryLabel
        stack.addArrangedSubview(note)
        rebuild()
        observer = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.rebuild() }
    }

    private func rebuild() {
        // Keep AVRoutePickerView alive while its menu is open and the chosen route changes.
        for child in choices.arrangedSubviews { choices.removeArrangedSubview(child); child.removeFromSuperview() }
        let session = AVAudioSession.sharedInstance()
        current.text = "Current output: " + session.currentRoute.outputs.map(\.portName).joined(separator: ", ")
        addButton("Use device speaker") { try session.overrideOutputAudioPort(.speaker) }
        addButton("Use automatic output") {
            try session.setPreferredInput(nil)
            try session.overrideOutputAudioPort(.none)
        }
        // Selecting a USB input also selects that accessory's paired output under play-and-record.
        for port in session.availableInputs ?? [] where port.portType == .usbAudio || port.portType == .headsetMic {
            addButton(port.portName) {
                try session.overrideOutputAudioPort(.none)
                try session.setPreferredInput(port)
            }
        }
        for data in session.outputDataSources ?? [] {
            addButton(data.dataSourceName) { try session.setOutputDataSource(data) }
        }
    }

    private func addButton(_ title: String, action: @escaping () throws -> Void) {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .body)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.addAction(UIAction { [weak self] _ in
            do { try action(); self?.rebuild() }
            catch {
                let alert = UIAlertController(title: "Could not change output", message: error.localizedDescription, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                self?.present(alert, animated: true)
            }
        }, for: .touchUpInside)
        choices.addArrangedSubview(button)
    }

    @objc private func done() { dismiss(animated: true) }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }
}
#endif
