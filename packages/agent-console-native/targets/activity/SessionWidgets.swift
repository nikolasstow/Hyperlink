import SwiftUI
import WidgetKit

/**
 The home-screen and lock-screen widgets.

 Two entries in the widget gallery, each adapting across families rather than
 one widget per size — that is how the system expects a widget to be built, and
 it keeps the gallery legible:

 - **Active run** — `systemSmall`, plus all three lock-screen accessories.
 - **Sessions** — `systemMedium`.

 ## The refresh budget shapes everything here

 WidgetKit allows a widget on the order of 40–70 timeline refreshes a day. The
 in-app Builds screen re-reads every 10 seconds; a widget that tried that would
 exhaust its budget before lunch and then show yesterday. So:

 - Nothing here renders **progress**. A percentage would be a lie between
   refreshes. Status, counts, and names stay true however old they are.
 - Elapsed time is `Text(_:style:)`, which counts on-device every second at no
   refresh cost — the same reason `SessionActivityAttributes` keeps `startedAt`
   rather than pushing a tick.
 - The real freshness mechanism is the push pipeline the app already has:
   `WidgetCenter.shared.reloadAllTimelines()` from the notification-service
   extension updates widgets the moment something actually changed, off-budget.
   Until that call is added, these refresh on the interval below and no sooner.
 */

// MARK: - Compatibility

private extension View {
  /// iOS 17 requires widget content to declare its background through
  /// `containerBackground`; without it the widget renders with no background at
  /// all on 17+. Below 17 that modifier does not exist, so the plain background
  /// is the fallback.
  @ViewBuilder
  func widgetContainerBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(.fill.tertiary, for: .widget)
    } else {
      background(Color(.systemBackground))
    }
  }
}

// MARK: - Shared pieces

/// Matches the Live Activity's own status vocabulary (`SessionActivityWidget`
/// resolves the same three), so a run reads identically wherever it appears.
private struct RunGlyph: View {
  let isBusy: Bool

  var body: some View {
    Image(systemName: isBusy ? "sparkles" : "checkmark.circle.fill")
      .foregroundStyle(isBusy ? Color.accentColor : Color.secondary)
      .imageScale(.small)
  }
}

private struct StaleFootnote: View {
  let snapshot: RunSnapshot

  var body: some View {
    if snapshot.isStale {
      Label("Can't reach server", systemImage: "wifi.exclamationmark")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

// MARK: - Active run

private struct ActiveRunView: View {
  @Environment(\.widgetFamily) private var family
  let entry: RunEntry

  private var snapshot: RunSnapshot { entry.snapshot }
  private var run: RunRow? { snapshot.current }

  var body: some View {
    switch family {
    case .accessoryCircular:
      circular
    case .accessoryInline:
      inline
    case .accessoryRectangular:
      rectangular
    default:
      small
    }
  }

  // 170 × 170. Status, where, what, and a self-counting timer.
  private var small: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 5) {
        RunGlyph(isBusy: run != nil)
        Text(run == nil ? "Idle" : "Working")
          .font(.caption.weight(.semibold))
          .foregroundStyle(run == nil ? Color.secondary : Color.accentColor)
      }

      if let run {
        Text(run.repo)
          .font(.headline)
          .lineLimit(1)
          .padding(.top, 8)

        if let worktree = run.worktree {
          Text(worktree)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }

        Text(run.title)
          .font(.footnote)
          .lineLimit(2)
          .padding(.top, 6)

        Spacer(minLength: 4)

        HStack {
          // Counts up on-device — no refresh spent per second.
          Text(run.updatedAt, style: .timer)
            .font(.caption.monospacedDigit().weight(.semibold))
          Spacer()
          if snapshot.busyCount > 1 {
            Text("+\(snapshot.busyCount - 1)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      } else {
        Spacer(minLength: 0)
        Text(snapshot.rows.isEmpty ? "No sessions" : "Nothing running")
          .font(.footnote)
          .foregroundStyle(.secondary)
        Spacer(minLength: 0)
        StaleFootnote(snapshot: snapshot)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(run.flatMap(Self.deepLink))
    .widgetContainerBackground()
  }

  // Lock screen, ~76 × 76. Monochrome — the count has to carry alone.
  private var circular: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Text("\(snapshot.busyCount)")
          .font(.title2.bold())
          .contentTransition(.numericText())
        Text("run")
          .font(.system(size: 9))
          .textCase(.uppercase)
          .foregroundStyle(.secondary)
      }
    }
    .widgetURL(run.flatMap(Self.deepLink))
  }

  // Sits beside the clock. One line, and only the fact worth the space.
  private var inline: some View {
    Label {
      if let run {
        Text("\(run.label) · \(run.updatedAt, style: .relative)")
      } else {
        Text("Nothing running")
      }
    } icon: {
      Image(systemName: run == nil ? "moon.zzz" : "sparkles")
    }
  }

  // ~172 × 76, three lines hard.
  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let run {
        Text(run.label)
          .font(.headline)
          .lineLimit(1)
          .widgetAccentable()
        Text(run.title)
          .font(.caption)
          .lineLimit(1)
        Text(run.updatedAt, style: .timer)
          .font(.caption.monospacedDigit())
      } else {
        Text("DoubleAgent")
          .font(.headline)
          .widgetAccentable()
        Text(snapshot.rows.isEmpty ? "No sessions" : "Nothing running")
          .font(.caption)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(run.flatMap(Self.deepLink))
  }

  /// The app registers the `doubleagent` scheme (`app.json`). Nothing handles
  /// an inbound URL yet — until it does, a tap opens the app on its last
  /// screen rather than the session, which is a reasonable failure.
  private static func deepLink(_ run: RunRow) -> URL? {
    URL(string: "doubleagent://session/\(run.id)")
  }
}

struct ActiveRunWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DoubleAgentActiveRun", provider: RunProvider()) { entry in
      ActiveRunView(entry: entry)
        .privacySensitive()
    }
    .configurationDisplayName("Active run")
    .description("What the agent is working on right now.")
    .supportedFamilies([
      .systemSmall,
      .accessoryCircular,
      .accessoryRectangular,
      .accessoryInline,
    ])
  }
}

// MARK: - Sessions

/// A row is tappable only when its deep link is actually constructible. The
/// alternative — a force-unwrapped fallback URL — trades a compile-time
/// question for a runtime crash in an extension the user cannot see logs from.
private struct SessionRowLink<Content: View>: View {
  let row: RunRow
  @ViewBuilder let content: () -> Content

  var body: some View {
    if let url = URL(string: "doubleagent://session/\(row.id)") {
      Link(destination: url) { content() }
    } else {
      content()
    }
  }
}

private struct SessionsView: View {
  let entry: RunEntry

  /// Four rows fit 170pt without crowding. Five do not — the fifth loses its
  /// descenders before it loses its text, which looks like a rendering bug
  /// rather than a deliberate cut.
  private static let maxRows = 4

  private var snapshot: RunSnapshot { entry.snapshot }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        Text("Sessions")
          .font(.headline)
        Spacer()
        if snapshot.busyCount > 0 {
          Text("\(snapshot.busyCount) running")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .padding(.bottom, 6)

      if snapshot.rows.isEmpty {
        Spacer(minLength: 0)
        Text("No sessions")
          .font(.footnote)
          .foregroundStyle(.secondary)
        StaleFootnote(snapshot: snapshot)
        Spacer(minLength: 0)
      } else {
        ForEach(Array(snapshot.ranked.prefix(Self.maxRows).enumerated()), id: \.element.id) { index, row in
          if index > 0 {
            Divider().opacity(0.4)
          }
          SessionRowLink(row: row) {
            HStack(spacing: 7) {
              RunGlyph(isBusy: row.isBusy)
              Text(row.label)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .layoutPriority(1)
              Text(row.title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
              Spacer(minLength: 2)
              Text(row.updatedAt, style: .relative)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            }
            .padding(.vertical, 3)
          }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetContainerBackground()
  }
}

struct SessionsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DoubleAgentSessions", provider: RunProvider()) { entry in
      SessionsView(entry: entry)
        .privacySensitive()
    }
    .configurationDisplayName("Sessions")
    .description("Recent sessions, running ones first.")
    .supportedFamilies([.systemMedium])
  }
}
