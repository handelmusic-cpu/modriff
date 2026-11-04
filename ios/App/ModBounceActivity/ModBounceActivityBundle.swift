import SwiftUI
import WidgetKit

/// The widget extension's entry point. The extension holds one thing, the bounce's Live Activity.
@main
struct ModBounceActivityBundle: WidgetBundle {
    var body: some Widget {
        ModBounceLiveActivity()
    }
}
