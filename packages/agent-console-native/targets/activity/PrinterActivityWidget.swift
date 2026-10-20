import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

/// The theme's primary colour, which the app saves in the app group
/// (`setActivityAccent`); UV violet until it has.
private var accent: Color {
  let hex = UserDefaults(suiteName: "group.com.nikolasstow.agentconsolenative")?.string(forKey: "activityAccent") ?? ""
  let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else {
    return Color(red: 0x8f / 255, green: 0x73 / 255, blue: 0xff / 255)
  }
  let rgb = digits.count == 8 ? value >> 8 : value
  return Color(
    red: Double((rgb >> 16) & 0xff) / 255,
    green: Double((rgb >> 8) & 0xff) / 255,
    blue: Double(rgb & 0xff) / 255
  )
}

private extension PrinterActivityAttributes.ContentState {
  var isPrinting: Bool { phase == "printing" }

  var label: String {
    switch phase {
    case "paused": return "Paused"
    case "done": return "Done"
    case "stopped": return "Stopped"
    case "error": return "Failed"
    default: return "Printing"
    }
  }

  var tint: Color {
    switch phase {
    case "done": return .green
    case "error": return .red
    case "paused", "stopped": return .orange
    default: return accent
    }
  }
}

private extension PrinterActivityAttributes {
  /// The file name without its extension.
  var title: String {
    (filename as NSString).deletingPathExtension
  }

  var image: UIImage? {
    guard !thumbnail.isEmpty, let data = Data(base64Encoded: thumbnail) else { return nil }
    return UIImage(data: data)
  }
}

struct PrinterActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PrinterActivityAttributes.self) { context in
      PrinterLockScreenView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Thumbnail(attributes: context.attributes, size: 44)
        }
        DynamicIslandExpandedRegion(.trailing) {
          TimeLeft(state: context.state)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 6) {
            PrintBar(state: context.state)
            Details(state: context.state)
              .font(.caption2.monospacedDigit())
              .foregroundStyle(.secondary)
          }
        }
      } compactLeading: {
        Image(systemName: "printer.fill")
          .foregroundStyle(context.state.tint)
      } compactTrailing: {
        // `Text(timerInterval:)` reserves room for its widest value, so a
        // fixed frame keeps the island hugging its content.
        TimeLeft(state: context.state)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(context.state.tint)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 52, alignment: .center)
      } minimal: {
        Image(systemName: "printer.fill")
          .foregroundStyle(context.state.tint)
      }
      .keylineTint(context.state.tint)
    }
  }
}

/// The slicer preview, or a printer symbol when the push had no room for it.
private struct Thumbnail: View {
  let attributes: PrinterActivityAttributes
  let size: CGFloat

  var body: some View {
    Group {
      if let image = attributes.image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        Image(systemName: "printer.fill")
          .font(.system(size: size * 0.4))
          .foregroundStyle(accent)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.white.opacity(0.08))
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
  }
}

/// The countdown to the end while printing; otherwise the phase.
private struct TimeLeft: View {
  let state: PrinterActivityAttributes.ContentState

  var body: some View {
    if state.isPrinting && state.endsAt > Date() {
      Text(timerInterval: Date()...state.endsAt, countsDown: true)
    } else {
      Text(state.label)
    }
  }
}

/// While printing, the bar runs on the device from start to the expected end.
/// Otherwise it holds the layer progress of the last push.
private struct PrintBar: View {
  let state: PrinterActivityAttributes.ContentState

  var body: some View {
    Group {
      if state.isPrinting && state.endsAt > state.startedAt {
        ProgressView(timerInterval: state.startedAt...state.endsAt, countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
      } else {
        ProgressView(value: min(max(state.progress, 0), 1))
      }
    }
    .progressViewStyle(.linear)
    .tint(state.tint)
  }
}

/// "Layer 52 of 2,838 · 25%" and the end time.
private struct Details: View {
  let state: PrinterActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 8) {
      Text("Layer \(state.layer.formatted()) of \(state.layers.formatted()) · \(Int((state.progress * 100).rounded()))%")
        .lineLimit(1)
      Spacer(minLength: 8)
      if state.isPrinting {
        Text("Ends \(state.endsAt, style: .time)")
          .lineLimit(1)
      }
    }
  }
}

private struct PrinterLockScreenView: View {
  let context: ActivityViewContext<PrinterActivityAttributes>

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Thumbnail(attributes: context.attributes, size: 64)

      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)

          Spacer(minLength: 8)

          if context.state.isPrinting {
            TimeLeft(state: context.state)
              .font(.subheadline.monospacedDigit())
              .foregroundStyle(accent)
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 80, alignment: .trailing)
          } else {
            Text(context.isStale ? "Not updated" : context.state.label)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(context.state.tint)
          }
        }

        PrintBar(state: context.state)

        Details(state: context.state)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
      }
    }
    .padding(16)
  }
}
