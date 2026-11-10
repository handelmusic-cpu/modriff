import ActivityKit
import SwiftUI
import WidgetKit

/// A red light, and a clock, while a bounce is being recorded (the clock is the island's right half, compact, and the lock screen).
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
                RedLight(size: 12)
            } compactTrailing: {
                // The take's clock, in the island's right half. Fixed width, scaled down for an hour-long take (1:00:00).
                Text(context.state.startedAt, style: .timer)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: 46)
            } minimal: {
                RedLight(size: 12)
            }
            .keylineTint(.red)
        }
    }
}

/// The light itself: a solid, fully opaque red disc.
///
/// This used to breathe (`opacity` animated 1 to 0.45 with `repeatForever`, started in `onAppear`). A Live Activity is
/// rendered by the system as a snapshot, and it does not run a view's own repeating animations, so the light was drawn at
/// the end state of that animation, 0.45, for the whole bounce: the faint red dot on the owner's phone. Nothing here may
/// depend on animation. The running clock beside it is what shows the bounce is alive (the system advances it itself),
/// so the light does not have to move. The app's own dot (`#bounce-dot`, which does pulse) is drawn by the page.
@available(iOS 16.2, *)
private struct RedLight: View {
    let size: CGFloat
    var body: some View {
        Circle()
            .fill(Color(red: 1.0, green: 0.18, blue: 0.25))
            .frame(width: size, height: size)
            .shadow(color: Color(red: 1.0, green: 0.18, blue: 0.25).opacity(0.9), radius: size * 0.25)
            .accessibilityLabel("Bounce recording")
    }
}
