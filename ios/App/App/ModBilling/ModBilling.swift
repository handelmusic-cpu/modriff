import Capacitor
import Foundation
import StoreKit

/// mõdRïff Pro, as the web view sees it: one non-consumable, `modriff_pro`.
///
/// **The contract is the web side's, not StoreKit's.** `window.modBilling`
/// (index.html, "Free vs pro") already asks for four things — is the user Pro,
/// refresh, purchase, restore — plus the store's own price string. This plugin
/// is that and nothing more: `status`, `purchase`, `restore`, and an
/// `entitlement` event when something changes behind the app's back (a refund,
/// a Family Sharing grant, an Ask-to-Buy approval, a purchase on another
/// device).
///
/// **A paying user is never locked out by a network call.** The answer the page
/// starts with is not a StoreKit call at all: it is the last answer we
/// verified, kept in UserDefaults, handed to the page at document start (see
/// ModRiffViewController) so `isPro()` is right on the first render, offline,
/// on a plane. UserDefaults is app-private and survives what WebKit's
/// storage eviction does not. The cache is lowered in exactly one case: the
/// store tells us, in a signed transaction, that the purchase was revoked.
/// "StoreKit found nothing" is not that — it is also what an offline first
/// launch after a reinstall looks like — so it changes nothing.
///
/// Compiles for the simulator (Xcode 27.1, both architectures, no warnings from
/// this file). The purchase flow has NOT been run: that needs the StoreKit test
/// configuration selected in the scheme, or the product in App Store Connect.
/// StoreKit 2 needs iOS 15, which is the project's deployment target.
@objc(ModBilling)
public class ModBilling: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModBilling"
    public let jsName = "ModBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    /// Set in App Store Connect; the price is read from it, never written here.
    static let productID = "modriff_pro"
    private static let cacheKey = "modriff.pro.entitled"

    /// What the web view is handed at document start. Static so the view
    /// controller can read it before the plugin has loaded.
    static var cachedEntitlement: Bool {
        get { UserDefaults.standard.bool(forKey: cacheKey) }
        set { UserDefaults.standard.set(newValue, forKey: cacheKey) }
    }

    private var updatesTask: Task<Void, Never>?
    private var priceString: String?

    /// Same proof ModEngine and ModMidi print: a CAPBridgedPlugin declared in
    /// the app target is not discovered on its own (see ModRiffViewController),
    /// and a silent non-registration looks exactly like a free user.
    override public func load() {
        NSLog("[ModBilling] plugin registered, cached entitlement=%@",
              ModBilling.cachedEntitlement ? "yes" : "no")
        // Transactions that finish outside a purchase() call: Ask to Buy
        // approved on a parent's phone, a purchase made on another device, a
        // refund. Must be running for the life of the app.
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

    /// Re-asks the store and updates the cache. Returns the entitlement now.
    @discardableResult
    private func refresh() async -> Bool {
        var entitled = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result,
               t.productID == ModBilling.productID,
               t.revocationDate == nil {
                entitled = true
            }
        }
        if entitled {
            ModBilling.cachedEntitlement = true
        } else if let latest = await Transaction.latest(for: ModBilling.productID),
                  case .verified(let t) = latest,
                  t.revocationDate != nil {
            // Refunded or revoked: signed proof, so this is the one place the
            // cache comes down.
            ModBilling.cachedEntitlement = false
        }
        // else: no entitlement and no proof of revocation — offline, or never
        // bought. Leave the cache alone.
        if priceString == nil {
            if let products = try? await Product.products(for: [ModBilling.productID]),
               let p = products.first {
                priceString = p.displayPrice
            }
        }
        return ModBilling.cachedEntitlement
    }

    private func payload(extra: [String: Any] = [:]) -> [String: Any] {
        var out: [String: Any] = ["pro": ModBilling.cachedEntitlement]
        if let p = priceString { out["price"] = p }
        for (k, v) in extra { out[k] = v }
        return out
    }

    private func refreshAndNotify() async {
        await refresh()
        let data = payload()
        await MainActor.run {
            // Always, not only on a change: the price may have just arrived.
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

    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            do {
                let products = try await Product.products(for: [ModBilling.productID])
                guard let product = products.first else {
                    // Not in App Store Connect yet, or no network for the first
                    // lookup. The page says so rather than doing nothing.
                    call.resolve(self.payload(extra: ["error": "unavailable"]))
                    return
                }
                self.priceString = product.displayPrice
                switch try await product.purchase() {
                case .success(let verification):
                    if case .verified(let transaction) = verification {
                        ModBilling.cachedEntitlement = true
                        await transaction.finish()
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
            // which is why it is a button and never automatic.
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
