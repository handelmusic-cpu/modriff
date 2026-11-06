import Foundation
#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit

/// What the Dynamic Island knows about a bounce: that one is running, and since when.
///
/// **Two targets compile this file.** The app starts the Live Activity (`ModActivity`) and the widget
/// extension draws it (`ModBounceLiveActivity`), and both have to agree on this type byte for byte, so
/// it is one file with membership in both targets. See `docs/dynamic-island.md` for adding the extension.
@available(iOS 16.1, *)
public struct ModBounceAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the bounce began, so the island can run its own clock without the page updating it.
        public var startedAt: Date
        public init(startedAt: Date) { self.startedAt = startedAt }
    }
    public var name: String
    public init(name: String) { self.name = name }
}
#endif
