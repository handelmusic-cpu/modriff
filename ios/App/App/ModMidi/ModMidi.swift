import Capacitor
import CoreMIDI
import Foundation

#if canImport(UIKit)
import UIKit
#endif

/// CoreMIDI, as the web view sees it.
///
/// **Why this exists at all.** WebKit has never shipped Web MIDI and Apple has
/// refused it over fingerprinting. Safari does not have it; every browser on
/// iOS runs Safari's engine, so none of them do; and a Capacitor app is a
/// `WKWebView`, so the App Store build gets exactly the same `undefined` that
/// mobile Safari does. `initMidi()` in index.html takes its `_midiErr='no-api'`
/// branch and the pane reads "Not supported on this device." Shipping natively
/// does not fix that by itself — this does.
///
/// iOS has CoreMIDI in full: USB class-compliant controllers through the
/// adapter, Bluetooth LE MIDI, virtual ports from other iOS apps, and network
/// MIDI. All of it is open to Swift and none of it to the web view.
///
/// **The shape is deliberate.** This plugin does not invent an API. The web
/// side wraps it in a `navigator.requestMIDIAccess` shim (see the platform
/// layer in index.html), so `initMidi`, `_midiWireAll`, `onMidiMsg`, the port
/// list, the learn flow and the mapping mode all keep working unchanged —
/// they stop seeing an empty API, which was the whole bug. Anything added
/// here that is not in the Web MIDI spec is a thing the web side would have
/// to special-case, so there is almost nothing.
@objc(ModMidi)
public class ModMidi: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModMidi"
    public let jsName = "ModMidi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openBluetooth", returnType: CAPPluginReturnPromise)
    ]

    /// Same proof ModEngine prints: a CAPBridgedPlugin declared in the app
    /// target is not discovered on its own (see ModRiffViewController), and a
    /// silent non-registration looks exactly like a device with no MIDI.
    override public func load() {
        NSLog("[ModMidi] plugin registered")
    }

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var started = false

    /// Sources we have connected, by the id we handed the web view. CoreMIDI
    /// endpoints are not stable across a replug, so the id is the endpoint's
    /// `kMIDIPropertyUniqueID` — which is — and the ref is looked up fresh.
    private var connected = Set<MIDIUniqueID>()

    // MARK: - Lifecycle

    @objc func start(_ call: CAPPluginCall) {
        if started {
            call.resolve(["ok": true, "inputs": inputList(), "outputs": outputList()])
            return
        }

        // The notify block fires whenever the MIDI setup changes — a cable in
        // or out, another app publishing a virtual port, a Bluetooth device
        // pairing. It is what makes Rescan unnecessary most of the time, and
        // it is the thing a polling implementation would get wrong.
        var status = MIDIClientCreateWithBlock("modRiff" as CFString, &client) { [weak self] notification in
            guard let self = self else { return }
            let messageID = notification.pointee.messageID
            guard messageID == .msgSetupChanged || messageID == .msgObjectAdded
                    || messageID == .msgObjectRemoved else { return }
            // Off the CoreMIDI thread before touching the bridge.
            DispatchQueue.main.async {
                self.connectAllSources()
                self.notifyListeners("statechange",
                                     data: ["inputs": self.inputList(), "outputs": self.outputList()])
            }
        }
        guard status == noErr else {
            call.reject("could not create a MIDI client (OSStatus \(status))")
            return
        }

        // MIDI 1.0 packets. The protocol-aware API (iOS 14+) would hand us
        // UMP, and every byte downstream — onMidiMsg, the profiles, the CC
        // learn — is written against MIDI 1.0 status bytes. Converting here
        // to convert back there would buy nothing.
        status = MIDIInputPortCreateWithBlock(client, "modRiff in" as CFString, &inPort) { [weak self] packetList, srcConnRefCon in
            self?.receive(packetList, srcConnRefCon)
        }
        guard status == noErr else {
            call.reject("could not create a MIDI input port (OSStatus \(status))")
            return
        }

        status = MIDIOutputPortCreate(client, "modRiff out" as CFString, &outPort)
        if status != noErr {
            // Output is not worth refusing the whole plugin for: a controller
            // still plays, it just cannot be lit up.
            NSLog("[ModMidi] no output port (OSStatus %d) — input only", status)
        }

        // Network MIDI (a Mac on the same Wi-Fi, over the Audio MIDI Setup
        // network session). Off unless asked for, and free when nothing is
        // connected to it.
        MIDINetworkSession.default().isEnabled = true
        MIDINetworkSession.default().connectionPolicy = .anyone

        started = true
        connectAllSources()
        call.resolve(["ok": true, "inputs": inputList(), "outputs": outputList()])
    }

    @objc func list(_ call: CAPPluginCall) {
        guard started else {
            call.resolve(["ok": false, "inputs": [], "outputs": []])
            return
        }
        // A rescan is a real rescan: reconnect anything that appeared while
        // the notify block was between setups.
        connectAllSources()
        call.resolve(["ok": true, "inputs": inputList(), "outputs": outputList()])
    }

    // MARK: - Input

    private func connectAllSources() {
        guard started else { return }
        let n = MIDIGetNumberOfSources()
        var seen = Set<MIDIUniqueID>()
        for i in 0..<n {
            let src = MIDIGetSource(i)
            guard src != 0 else { continue }
            let uid = uniqueID(of: src)
            seen.insert(uid)
            if connected.contains(uid) { continue }
            // The refCon carries the unique id back to the read block, so a
            // packet knows which port it came from without a lookup on the
            // MIDI thread. Int-sized and immutable, so no retain games.
            let refCon = UnsafeMutableRawPointer(bitPattern: UInt(bitPattern: Int(uid)))
            let status = MIDIPortConnectSource(inPort, src, refCon)
            if status == noErr {
                connected.insert(uid)
            } else {
                // A port another app holds exclusively is the classic cause,
                // and it is one of the five the Settings pane names.
                NSLog("[ModMidi] could not open \"%@\" (OSStatus %d)", displayName(of: src), status)
            }
        }
        connected.formIntersection(seen)
    }

    /// The CoreMIDI read block. **This runs on a high-priority MIDI thread**,
    /// not the main one, and it must not block: no allocation beyond the bytes
    /// themselves, no bridge calls. The hop to main is where the bridge is
    /// touched, and it is also where the latency is — which is the price of
    /// the notes reaching JavaScript at all, and is well under what a player
    /// can hear against the app's own audio buffer.
    private func receive(_ packetList: UnsafePointer<MIDIPacketList>, _ refCon: UnsafeMutableRawPointer?) {
        let uid = MIDIUniqueID(Int(bitPattern: refCon))
        var messages: [[Any]] = []
        var packet = packetList.pointee.packet
        for _ in 0..<packetList.pointee.numPackets {
            withUnsafeBytes(of: packet.data) { raw in
                let n = Int(packet.length)
                guard n > 0, n <= raw.count else { return }
                // One packet can hold several complete messages; the web side
                // expects one event each, as a browser delivers them.
                var i = 0
                while i < n {
                    let status = raw[i]
                    guard status & 0x80 != 0 else { i += 1; continue }   // running status: not emitted by CoreMIDI
                    let len = ModMidi.messageLength(status, raw, i, n)
                    guard len > 0, i + len <= n else { break }
                    messages.append((i..<(i + len)).map { Int(raw[$0]) })
                    i += len
                }
            }
            packet = MIDIPacketNext(&packet).pointee
        }
        guard !messages.isEmpty else { return }
        let id = String(uid)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            for bytes in messages {
                self.notifyListeners("midimessage", data: ["portId": id, "data": bytes])
            }
        }
    }

    /// How many bytes this status byte's message takes. SysEx is handed over
    /// whole to whatever is left in the packet: nothing downstream reads it,
    /// but truncating it would be a lie rather than an omission.
    private static func messageLength(_ status: UInt8, _ raw: UnsafeRawBufferPointer, _ i: Int, _ n: Int) -> Int {
        switch status & 0xF0 {
        case 0x80, 0x90, 0xA0, 0xB0, 0xE0: return 3
        case 0xC0, 0xD0: return 2
        case 0xF0:
            switch status {
            case 0xF0:                                  // SysEx to its terminator
                var j = i + 1
                while j < n && raw[j] != 0xF7 { j += 1 }
                return min(j + 1, n) - i
            case 0xF1, 0xF3: return 2
            case 0xF2: return 3
            default: return 1                           // clock, start, stop, active sensing
            }
        default: return 0
        }
    }

    // MARK: - Output

    @objc func send(_ call: CAPPluginCall) {
        guard started, outPort != 0 else { call.reject("MIDI out is not open"); return }
        guard let idStr = call.getString("id"), let uid = MIDIUniqueID(idStr) else {
            call.reject("send needs a port id"); return
        }
        guard let bytes = call.getArray("data") as? [Int], !bytes.isEmpty else {
            call.reject("send needs data"); return
        }
        guard let dest = destination(uid) else { call.reject("that port is no longer connected"); return }

        var packetList = MIDIPacketList()
        let packet = MIDIPacketListInit(&packetList)
        let data = bytes.map { UInt8(truncatingIfNeeded: $0) }
        // Timestamp 0 is "now" — the web side schedules ahead in its own
        // clock and hands us the bytes when they are due, so translating its
        // milliseconds into mach time here would be a second opinion about
        // when a note starts.
        let ok = data.withUnsafeBufferPointer { buf -> Bool in
            guard let base = buf.baseAddress else { return false }
            return MIDIPacketListAdd(&packetList, 1024, packet, 0, data.count, base) != nil
        }
        guard ok else { call.reject("message too long for one packet"); return }

        let status = MIDISend(outPort, dest, &packetList)
        if status == noErr { call.resolve(["ok": true]) }
        else { call.reject("MIDISend failed (OSStatus \(status))") }
    }

    /// Bluetooth LE MIDI needs Apple's own pairing sheet — there is no
    /// programmatic pairing, by design. Presented from here so the Settings
    /// pane can offer it as a button rather than sending people to another
    /// app.
    @objc func openBluetooth(_ call: CAPPluginCall) {
        #if canImport(UIKit)
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.bridge?.viewController else {
                call.reject("no view controller to present from"); return
            }
            // CABTMIDICentralViewController lives in CoreAudioKit. Loaded by
            // name so the app does not link the framework (and does not need
            // the Bluetooth usage string) unless this is actually called.
            guard let cls = NSClassFromString("CABTMIDICentralViewController") as? UIViewController.Type else {
                call.reject("Bluetooth MIDI is not available on this device"); return
            }
            let vc = cls.init()
            vc.title = "Bluetooth MIDI"
            let nav = UINavigationController(rootViewController: vc)
            vc.navigationItem.rightBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .done, target: self, action: #selector(self?.dismissSheet))
            host.present(nav, animated: true) { call.resolve(["ok": true]) }
        }
        #else
        call.reject("Bluetooth MIDI needs UIKit")
        #endif
    }

    #if canImport(UIKit)
    @objc private func dismissSheet() {
        bridge?.viewController?.presentedViewController?.dismiss(animated: true)
    }
    #endif

    // MARK: - Endpoints

    private func inputList() -> [[String: Any]] {
        (0..<MIDIGetNumberOfSources()).compactMap { i in
            let e = MIDIGetSource(i)
            return e == 0 ? nil : describe(e, open: connected.contains(uniqueID(of: e)))
        }
    }

    private func outputList() -> [[String: Any]] {
        (0..<MIDIGetNumberOfDestinations()).compactMap { i in
            let e = MIDIGetDestination(i)
            return e == 0 ? nil : describe(e, open: true)
        }
    }

    private func destination(_ uid: MIDIUniqueID) -> MIDIEndpointRef? {
        for i in 0..<MIDIGetNumberOfDestinations() {
            let e = MIDIGetDestination(i)
            if e != 0 && uniqueID(of: e) == uid { return e }
        }
        return nil
    }

    /// One endpoint, in the fields a `MIDIInput`/`MIDIOutput` carries. The
    /// Settings pane draws the manufacturer and the connection state to tell
    /// two ports with the same name apart, so they are not decoration.
    private func describe(_ e: MIDIEndpointRef, open: Bool) -> [String: Any] {
        return [
            "id": String(uniqueID(of: e)),
            "name": displayName(of: e),
            "manufacturer": stringProperty(e, kMIDIPropertyManufacturer),
            "state": "connected",
            "connection": open ? "open" : "closed"
        ]
    }

    private func uniqueID(of e: MIDIEndpointRef) -> MIDIUniqueID {
        var uid: MIDIUniqueID = 0
        MIDIObjectGetIntegerProperty(e, kMIDIPropertyUniqueID, &uid)
        return uid
    }

    /// The name a person would recognise. `kMIDIPropertyDisplayName` is the
    /// one the OS shows ("Launchkey Mini MK3 MIDI Port"); the endpoint's own
    /// name is often just "Port 1", which is the "listed under a name nobody
    /// would recognise as their keyboard" case the Settings pane warns about.
    private func displayName(of e: MIDIEndpointRef) -> String {
        let display = stringProperty(e, kMIDIPropertyDisplayName)
        if !display.isEmpty { return display }
        let name = stringProperty(e, kMIDIPropertyName)
        return name.isEmpty ? "Unnamed" : name
    }

    private func stringProperty(_ e: MIDIEndpointRef, _ key: CFString) -> String {
        var out: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(e, key, &out) == noErr,
              let value = out?.takeRetainedValue() else { return "" }
        return value as String
    }
}
