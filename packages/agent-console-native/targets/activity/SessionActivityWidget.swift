import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct DoubleAgentActivityBundle: WidgetBundle {
  // `type: "widget"` hosts Live Activities and ordinary widgets in one
  // extension (see expo-target.config.js), so the home-screen and lock-screen
  // widgets join this bundle rather than needing a target and app group of
  // their own. See SessionWidgets.swift.
  var body: some Widget {
    SessionActivityWidget()
    ActiveRunWidget()
    SessionsWidget()
  }
}

/// Colors are resolved per status rather than hardcoded so "done" and "error"
/// read differently at a glance in the island's compact form, which is often
/// all that is visible.
private extension SessionActivityAttributes.ContentState {
  var isWorking: Bool { status == "working" }

  var tint: Color {
    switch status {
    case "done": return .green
    case "error": return .red
    default: return .accentColor
    }
  }

  var symbol: String {
    switch status {
    case "done": return "checkmark.circle.fill"
    case "error": return "exclamationmark.triangle.fill"
    default: return "sparkles"
    }
  }
}

struct SessionActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SessionActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.attributes.repo, systemImage: "folder")
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ElapsedView(state: context.state)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            Text(context.state.action)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)

            if context.state.isWorking, #available(iOS 17.0, *) {
              Button(intent: StopAgentIntent(sessionID: context.attributes.sessionID)) {
                Label("Stop", systemImage: "stop.fill")
                  .font(.caption.weight(.semibold))
                  .frame(maxWidth: .infinity)
              }
              .buttonStyle(.bordered)
              .tint(.red)
            }
          }
        }
      } compactLeading: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(context.state.tint)
      } compactTrailing: {
        // `Text(_, style: .timer)` reserves width for its widest possible value
        // (hours), which stretches the compact pill to the max. A fixed,
        // MM:SS-sized frame keeps the island hugging its content; a run long
        // enough to need the hours field is well past when anyone's watching.
        ElapsedView(state: context.state)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(context.state.tint)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 44, alignment: .center)
      } minimal: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(context.state.tint)
      }
      .keylineTint(context.state.tint)
    }
  }
}

/// A device-side timer. Pushing a new content state once per second would blow
/// through the ActivityKit update budget within a minute, so the start time is
/// pushed once and the countdown runs locally.
private struct ElapsedView: View {
  let state: SessionActivityAttributes.ContentState

  var body: some View {
    if state.isWorking {
      Text(state.startedAt, style: .timer)
    } else {
      Text(state.status == "done" ? "Done" : "Failed")
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<SessionActivityAttributes>

  var body: some View {
    // Vertical layout so the action line gets its OWN full-width row rather than
    // sharing the row with the timer/Stop column (which squeezed it to ~60%).
    VStack(alignment: .leading, spacing: 6) {
      // Header: symbol · title · elapsed timer.
      HStack(spacing: 8) {
        Image(systemName: context.state.symbol)
          .font(.subheadline)
          .foregroundStyle(context.state.tint)

        Text(context.attributes.title)
          .font(.headline)
          .lineLimit(1)

        Spacer(minLength: 8)

        ElapsedView(state: context.state)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
      }

      // The agent's live activity — full width, wraps at the edge.
      Text(context.state.action)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(3)
        .frame(maxWidth: .infinity, alignment: .leading)

      // Footer: location · Stop.
      HStack(spacing: 8) {
        Text("\(context.attributes.repo) · \(context.attributes.worktree)")
          .font(.caption2)
          .foregroundStyle(.tertiary)
          .lineLimit(1)

        Spacer(minLength: 8)

        if context.state.isWorking, #available(iOS 17.0, *) {
          Button(intent: StopAgentIntent(sessionID: context.attributes.sessionID)) {
            Label("Stop", systemImage: "stop.fill")
              .font(.caption2.weight(.semibold))
          }
          .buttonStyle(.bordered)
          .tint(.red)
        }
      }
    }
    .padding(16)
  }
}
