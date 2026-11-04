import ActivityKit
import SwiftUI
import WidgetKit

/// A red light, and a clock, while a bounce is being recorded.
///
/// Compact and minimal are the light alone (the island is a few millimetres wide, and "it is working" is the whole
/// message); expanded and the lock screen add the word and the elapsed time. The clock is `Text(_, style: .timer)`,
/// which the system keeps running by itself, so the page never has to push an update and the island cannot freeze
/// at a stale time if the web view is suspended.
@available(iOS 16.2, *)
struct ModBounceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ModBounceAttributes.self) { context in
            // Lock screen and notification banner.
            HStack(spacing: 10) {
                RedLight(size: 14)
                Text("Bouncing")
                    .font(.headline)
                Spacer()
                Text(context.state.startedAt, style: .timer)
                    .font(.headline.monospacedDigit())
                    .multilineTextAlignment(.trailing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RedLight(size: 16).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("Bouncing").font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.startedAt, style: .timer)
                        .font(.headline.monospacedDigit())
                        .frame(width: 70, alignment: .trailing)
                        .padding(.trailing, 6)
                }
            } compactLeading: {
                RedLight(size: 10)
            } compactTrailing: {
                Text(context.state.startedAt, style: .timer)
                    .font(.caption.monospacedDigit())
                    .frame(width: 44)
            } minimal: {
                RedLight(size: 10)
            }
            .keylineTint(.red)
        }
    }
}

/// The light itself. It breathes, slowly, so a frozen picture and a running bounce cannot be mistaken for each other.
@available(iOS 16.2, *)
private struct RedLight: View {
    let size: CGFloat
    @State private var dim = false
    var body: some View {
        Circle()
            .fill(Color.red)
            .frame(width: size, height: size)
            .opacity(dim ? 0.45 : 1)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = true }
            .accessibilityLabel("Bounce recording")
    }
}
