import Capacitor
import Foundation

#if MODRIFF_CLOUDKIT
import CloudKit
#endif

/// iCloud sync, as far as the native side goes: it moves records and nothing
/// else. What a record is, which ones changed, who wins a conflict and what
/// happens to a delete are all decided in index.html (the sync engine, held to a
/// fake CloudKit by tests/sync/), so this file has no opinion about songs.
///
/// **Compiled in only when the build says so.** Everything that touches CloudKit
/// is inside `#if MODRIFF_CLOUDKIT`. Asking CloudKit for a container in an app
/// that was not signed with the iCloud entitlement does not return an error, it
/// raises an exception and the app is gone: it is not something to find out at
/// run time. So a build without the flag, which is every build until the
/// developer account has the capability, answers `status` with "not enabled" and
/// the page leaves the switch off. To turn it on: see docs/v5-architecture.md,
/// "iCloud sync" (add the iCloud capability with CloudKit and the container
/// `iCloud.Handel.modRiff`, then add `MODRIFF_CLOUDKIT` to Active
/// Compilation Conditions for the App target).
///
/// **The shape on the server.** One private-database zone, `modriff`, and one
/// record per item: type `Doc`, a record name the page chose (ASCII, hashed from
/// the item's id), the item as a JSON file in a `payload` asset (an asset, not a
/// string, so a long setlist song is not stopped by the 1 MB record limit), and
/// `modified`, the device clock in milliseconds when the page noticed the change.
/// `modified` is also how a conflict is found: a push says which version it was
/// based on (`base`), and if the server's `modified` is not that, the record
/// moved on and the push comes back as a conflict with the server's copy.
///
/// **Changes come by token.** `pull` asks for what changed in the zone since the
/// last change token, which is kept in UserDefaults; a token the server no longer
/// knows (it expires) is dropped and the whole zone is read again.
@objc(ModCloud)
public class ModCloud: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModCloud"
    public let jsName = "ModCloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pull", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        #if MODRIFF_CLOUDKIT
        NSLog("[ModCloud] plugin registered (CloudKit on)")
        #else
        NSLog("[ModCloud] plugin registered (CloudKit not compiled in)")
        #endif
    }

    #if MODRIFF_CLOUDKIT

    private static let containerID = "iCloud.Handel.modRiff"
    private static let zoneName = "modriff"
    private static let tokenKey = "modriff.cloud.changeToken"

    private lazy var db: CKDatabase = CKContainer(identifier: ModCloud.containerID).privateCloudDatabase
    private lazy var zoneID = CKRecordZone.ID(zoneName: ModCloud.zoneName, ownerName: CKCurrentUserDefaultName)
    private var zoneReady = false

    private func ensureZone() async throws {
        if zoneReady { return }
        _ = try await db.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
        zoneReady = true
    }

    private func readPayload(_ r: CKRecord) -> String? {
        guard let a = r["payload"] as? CKAsset, let url = a.fileURL,
              let d = try? Data(contentsOf: url) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    private func writePayload(_ s: String) throws -> CKAsset {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        try s.write(to: url, atomically: true, encoding: .utf8)
        return CKAsset(fileURL: url)
    }

    @objc func status(_ call: CAPPluginCall) {
        Task {
            do {
                let s = try await CKContainer(identifier: ModCloud.containerID).accountStatus()
                switch s {
                case .available: call.resolve(["available": true])
                case .noAccount: call.resolve(["available": false, "reason": "Sign in to iCloud in Settings to sync."])
                case .restricted: call.resolve(["available": false, "reason": "iCloud is restricted on this device."])
                default: call.resolve(["available": false, "reason": "iCloud is not available right now."])
                }
            } catch {
                call.resolve(["available": false, "reason": error.localizedDescription])
            }
        }
    }

    /// `records`: [{rid, payload, modified, base}], `deletes`: [rid].
    /// Resolves `saved`, `deleted` (rids) and `conflicts` ([{rid, payload, modified}]).
    @objc func push(_ call: CAPPluginCall) {
        let recs = (call.getArray("records") as? [[String: Any]]) ?? []
        let dels = (call.getArray("deletes") as? [String]) ?? []
        Task {
            do {
                try await ensureZone()
                let ids = recs.compactMap { ($0["rid"] as? String).map { CKRecord.ID(recordName: $0, zoneID: zoneID) } }
                let existing = ids.isEmpty ? [:] : try await db.records(for: ids)
                var toSave: [CKRecord] = []
                var conflicts: [[String: Any]] = []
                for r in recs {
                    guard let rid = r["rid"] as? String, let payload = r["payload"] as? String else { continue }
                    let modified = (r["modified"] as? NSNumber)?.int64Value ?? 0
                    let base = (r["base"] as? NSNumber)?.int64Value ?? 0
                    let id = CKRecord.ID(recordName: rid, zoneID: zoneID)
                    var rec: CKRecord
                    if let res = existing[id], case .success(let ex) = res {
                        let serverMod = (ex["modified"] as? NSNumber)?.int64Value ?? 0
                        if serverMod != base {
                            conflicts.append(["rid": rid, "payload": readPayload(ex) ?? "", "modified": serverMod])
                            continue
                        }
                        rec = ex
                    } else {
                        rec = CKRecord(recordType: "Doc", recordID: id)
                    }
                    rec["payload"] = try writePayload(payload)
                    rec["modified"] = modified as CKRecordValue
                    rec["v"] = 1 as CKRecordValue
                    toSave.append(rec)
                }
                let delIDs = dels.map { CKRecord.ID(recordName: $0, zoneID: zoneID) }
                var saved: [String] = [], deleted: [String] = []
                if !toSave.isEmpty || !delIDs.isEmpty {
                    let res = try await db.modifyRecords(saving: toSave, deleting: delIDs,
                                                         savePolicy: .ifServerRecordUnchanged, atomically: false)
                    for (id, r) in res.saveResults {
                        switch r {
                        case .success: saved.append(id.recordName)
                        case .failure(let e):
                            // Moved on between the fetch and the save: a conflict like any other.
                            if let ck = e as? CKError, ck.code == .serverRecordChanged, let sr = ck.serverRecord {
                                conflicts.append(["rid": id.recordName, "payload": readPayload(sr) ?? "",
                                                  "modified": (sr["modified"] as? NSNumber)?.int64Value ?? 0])
                            } else { throw e }
                        }
                    }
                    for (id, r) in res.deleteResults {
                        switch r {
                        case .success: deleted.append(id.recordName)
                        case .failure(let e):
                            if let ck = e as? CKError, ck.code == .unknownItem { deleted.append(id.recordName) } else { throw e }
                        }
                    }
                }
                call.resolve(["saved": saved, "deleted": deleted, "conflicts": conflicts])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private func loadToken() -> CKServerChangeToken? {
        guard let d = UserDefaults.standard.data(forKey: ModCloud.tokenKey) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: d)
    }
    private func saveToken(_ t: CKServerChangeToken?) {
        if let t = t, let d = try? NSKeyedArchiver.archivedData(withRootObject: t, requiringSecureCoding: true) {
            UserDefaults.standard.set(d, forKey: ModCloud.tokenKey)
        } else { UserDefaults.standard.removeObject(forKey: ModCloud.tokenKey) }
    }

    /// Resolves `changes` ([{rid, payload, modified}]) and `deleted` (rids) since the
    /// last pull, and `reset: true` when the saved token was refused and the zone
    /// was read from the start.
    @objc func pull(_ call: CAPPluginCall) {
        Task {
            do {
                try await ensureZone()
                var token = loadToken(), reset = false
                var changes: [[String: Any]] = [], deleted: [String] = []
                var more = true
                while more {
                    do {
                        let r = try await db.recordZoneChanges(inZoneWith: zoneID, since: token)
                        for (_, res) in r.modificationResultsByID {
                            if case .success(let m) = res {
                                let rec = m.record
                                changes.append(["rid": rec.recordID.recordName, "payload": readPayload(rec) ?? "",
                                                "modified": (rec["modified"] as? NSNumber)?.int64Value ?? 0])
                            }
                        }
                        for d in r.deletions { deleted.append(d.recordID.recordName) }
                        token = r.changeToken
                        more = r.moreComing
                    } catch let e as CKError where e.code == .changeTokenExpired {
                        token = nil; reset = true; changes = []; deleted = []; saveToken(nil)
                    }
                }
                saveToken(token)
                call.resolve(["changes": changes, "deleted": deleted, "reset": reset])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    #else

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["available": false, "reason": "iCloud sync is not enabled in this build."])
    }
    @objc func push(_ call: CAPPluginCall) { call.reject("iCloud sync is not enabled in this build.") }
    @objc func pull(_ call: CAPPluginCall) { call.reject("iCloud sync is not enabled in this build.") }

    #endif
}
