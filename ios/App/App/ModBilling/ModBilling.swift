import Capacitor
import Foundation
import StoreKit

/// mõdRïff's packs, as the web view sees them: seven non-consumable modules and
/// four Full Studio products, all non-consumable, eleven in App Store Connect.
///
/// **The contract is the web side's, not StoreKit's.** `window.modBilling`
/// (index.html, "Modules") speaks in product *keys*: the seven module ids
/// (`sampler`, `synth`, `groove`, `theory`, `practice`, `studio`, `sounds`) and
/// the four bundle keys (`fullstudio`, `from1`, `from2`, `from3plus`). This
/// plugin is the one place a key becomes a product ID, and it is that and
/// nothing more: `status`, `purchase` (by key), `restore`, and an `entitlement`
/// event when something changes behind the app's back (a refund, a Family
/// Sharing grant, an Ask-to-Buy approval, a purchase on another device).
///
/// What the page works out for itself is everything that is a decision: which
/// module a locked feature needs, whether a bundle is worth offering, and which
/// of the three Complete Your Studio prices applies. The host only says what is
/// owned and what the store charges.
///
/// **A paying user is never locked out by a network call.** The set the page
/// starts with is not a StoreKit call at all: it is the last set we verified,
/// kept in UserDefaults, handed to the page at document start (see
/// ModRiffViewController) so `owned()` is right on the first render, offline, on
/// a plane. UserDefaults is app-private and survives what WebKit's storage
/// eviction does not. A key leaves the cache in exactly one case: the store
/// tells us, in a signed transaction, that the purchase was revoked.
/// "StoreKit found nothing" is not that — it is also what an offline first
/// launch after a reinstall looks like — so it changes nothing.
///
/// Not built on Linux and not run. The previous single-product version
/// compiled for the simulator; this one is the same shape with a set where
/// there was a flag, and needs the same check on a Mac: build, then the
/// StoreKit configuration (ios/App/ModRiffPacks.storekit) selected in the
/// scheme. StoreKit 2 needs iOS 15, which is the project's deployment target.
@objc(ModBilling)
public class ModBilling: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModBilling"
    public let jsName = "ModBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - The eleven products

    /// Product IDs can never be reused, even after deletion, so these are the
    /// ones written in docs/app-store.md and nowhere else. Prices are read from
    /// the store, never written here.
    private static let idPrefix = "com.handelmusic.modriff"
    static let moduleKeys = ["sampler", "synth", "groove", "theory", "practice", "studio", "sounds"]
    static let bundleKeys = ["fullstudio", "from1", "from2", "from3plus"]
    static let allKeys = moduleKeys + bundleKeys

    /// key -> App Store product ID.
    static let productID: [String: String] = {
        var m = [String: String]()
        for k in moduleKeys { m[k] = "\(idPrefix).\(k)" }
        m["fullstudio"] = "\(idPrefix).fullstudio"
        m["from1"] = "\(idPrefix).fullstudio.from1"
        m["from2"] = "\(idPrefix).fullstudio.from2"
        m["from3plus"] = "\(idPrefix).fullstudio.from3plus"
        return m
    }()
    /// product ID -> key.
    static let keyForProductID: [String: String] = {
        var m = [String: String]()
        for (k, id) in productID { m[id] = k }
        return m
    }()

    private static let cacheKey = "modriff.owned.keys"

    /// What the web view is handed at document start. Static so the view
    /// controller can read it before the plugin has loaded. Only known keys come
    /// back out, so nothing stored under the key can reach the injected script.
    static var cachedOwned: [String] {
        get {
            let stored = UserDefaults.standard.stringArray(forKey: cacheKey) ?? []
            return allKeys.filter { stored.contains($0) }
        }
        set { UserDefaults.standard.set(newValue.filter { allKeys.contains($0) }, forKey: cacheKey) }
    }
    /// The cache as a JavaScript array literal, for the document-start script.
    static var cachedOwnedJSON: String {
        "[" + cachedOwned.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    }

    private var updatesTask: Task<Void, Never>?
    /// key -> (displayPrice, price as a number), once the store has answered.
    private var products: [String: (price: String, value: Double)] = [:]

    /// Same proof ModEngine and ModMidi print: a CAPBridgedPlugin declared in
    /// the app target is not discovered on its own (see ModRiffViewController),
    /// and a silent non-registration looks exactly like a free user.
    override public func load() {
        NSLog("[ModBilling] plugin registered, cached owned=%@",
              ModBilling.cachedOwned.isEmpty ? "none" : ModBilling.cachedOwned.joined(separator: ","))
        // Transactions that finish outside a purchase() call: Ask to Buy
        // approved on a parent's phone, a purchase made on another device, a
        // refund, a Family Sharing change. Must be running for the life of the app.
        updatesTask = Task.detached(priority: .background) { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let transaction) = update {
                    await transaction.finish()
                }
                await self?.refreshAndNotify()
            }
        }
        Task { await self.refreshAndNotify() }
    }

    deinit { updatesTask?.cancel() }

    // MARK: - What the store says

    /// Re-asks the store and updates the cache. Returns the owned keys now.
    @discardableResult
    private func refresh() async -> [String] {
        var current = Set<String>()
        for await result in Transaction.currentEntitlements {
            // Verified, and not revoked: currentEntitlements leaves refunded
            // transactions out already, the date check is the belt to that.
            if case .verified(let t) = result,
               t.revocationDate == nil,
               let key = ModBilling.keyForProductID[t.productID] {
                current.insert(key)
            }
        }
        var kept = Set(ModBilling.cachedOwned).union(current)
        // A cached key the store no longer lists: lower it only on signed proof
        // of revocation. No transaction at all (offline, or a fresh install
        // before the first sync) leaves it where it was.
        for key in kept.subtracting(current) {
            guard let id = ModBilling.productID[key],
                  let latest = await Transaction.latest(for: id),
                  case .verified(let t) = latest,
                  t.revocationDate != nil else { continue }
            kept.remove(key)
        }
        ModBilling.cachedOwned = ModBilling.allKeys.filter { kept.contains($0) }
        if products.isEmpty { await loadProducts() }
        return ModBilling.cachedOwned
    }

    private func loadProducts() async {
        guard let list = try? await Product.products(for: Array(ModBilling.productID.values)) else { return }
        for p in list {
            if let key = ModBilling.keyForProductID[p.id] {
                products[key] = (p.displayPrice, NSDecimalNumber(decimal: p.price).doubleValue)
            }
        }
    }

    private func payload(extra: [String: Any] = [:]) -> [String: Any] {
        var out: [String: Any] = ["owned": ModBilling.cachedOwned]
        var prices = [String: Any]()
        for (k, v) in products { prices[k] = ["price": v.price, "value": v.value] }
        out["products"] = prices
        for (k, v) in extra { out[k] = v }
        return out
    }

    private func refreshAndNotify() async {
        await refresh()
        let data = payload()
        await MainActor.run {
            // Always, not only on a change: the prices may have just arrived.
            self.notifyListeners("entitlement", data: data)
        }
    }

    // MARK: - Plugin methods

    @objc func status(_ call: CAPPluginCall) {
        Task {
            await self.refresh()
            call.resolve(self.payload())
        }
    }

    /// `{ key: "groove" }`: any of the eleven keys. The page has already chosen
    /// which bundle to offer; this just buys what it was told to.
    @objc func purchase(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let id = ModBilling.productID[key] else {
            call.resolve(self.payload(extra: ["error": "unknown product"]))
            return
        }
        Task {
            do {
                let found = try await Product.products(for: [id])
                guard let product = found.first else {
                    // Not in App Store Connect yet, or no network for the first
                    // lookup. The page says so rather than doing nothing.
                    call.resolve(self.payload(extra: ["error": "unavailable"]))
                    return
                }
                self.products[key] = (product.displayPrice, NSDecimalNumber(decimal: product.price).doubleValue)
                switch try await product.purchase() {
                case .success(let verification):
                    if case .verified(let transaction) = verification {
                        await transaction.finish()
                        await self.refresh()
                        // The purchase itself is proof, even if the entitlements
                        // list is a moment behind.
                        var owned = Set(ModBilling.cachedOwned)
                        owned.insert(key)
                        ModBilling.cachedOwned = ModBilling.allKeys.filter { owned.contains($0) }
                        call.resolve(self.payload())
                    } else {
                        call.resolve(self.payload(extra: ["error": "unverified"]))
                    }
                case .userCancelled:
                    call.resolve(self.payload(extra: ["cancelled": true]))
                case .pending:
                    // Ask to Buy: the approval arrives later through
                    // Transaction.updates and the page hears it as an event.
                    call.resolve(self.payload(extra: ["pending": true]))
                @unknown default:
                    call.resolve(self.payload(extra: ["error": "unknown"]))
                }
            } catch {
                call.resolve(self.payload(extra: ["error": error.localizedDescription]))
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            // Syncs with the App Store and may ask for the Apple ID password,
            // which is why it is a button and never automatic. Then the same
            // rebuild of the owned set every launch does.
            do { try await AppStore.sync() }
            catch {
                call.resolve(self.payload(extra: ["error": error.localizedDescription]))
                return
            }
            await self.refresh()
            call.resolve(self.payload())
        }
    }
}
