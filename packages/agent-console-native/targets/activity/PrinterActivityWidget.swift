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

  var image: UIImage? { decodedImage(thumbnail) }
}

private extension PrinterActivityAttributes.ContentState {
  var layerPicture: UIImage? { decodedImage(layerImage) }
  var cameraPicture: UIImage? { decodedImage(cameraImage) }
  var percent: Int { Int((progress * 100).rounded()) }
}

private func decodedImage(_ base64: String) -> UIImage? {
  guard !base64.isEmpty, let data = Data(base64Encoded: base64) else { return nil }
  return UIImage(data: data)
}

/// The resin printer (plate, arm, rectangular vat), the same drawing as the portal icon.
private struct PrinterGlyph: View {
  var body: some View {
    Image("PrinterGlyph")
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
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
          Thumbnail(attributes: context.attributes, size: 52)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 0) {
            Text("\(context.state.percent)%")
              .font(.title3.weight(.semibold).monospacedDigit())
              .foregroundStyle(context.state.tint)
            Text(context.state.label)
              .font(.caption2)
              .foregroundStyle(.secondary)
          }
          .frame(maxHeight: .infinity)
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 2) {
            Text(context.attributes.title)
              .font(.headline)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 6) {
            PrintBar(state: context.state)
            HStack {
              Text("Layer \(context.state.layer.formatted()) of \(context.state.layers.formatted())")
              Spacer(minLength: 8)
              if context.state.isPrinting {
                Text("Ends \(context.state.endsAt, style: .time)")
              }
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
          }
          // The island's corners are round: keep the bottom row clear of them.
          .padding(.horizontal, 12)
          .padding(.top, 4)
        }
      } compactLeading: {
        PrinterGlyph()
          .frame(width: 18, height: 18)
          .foregroundStyle(context.state.tint)
      } compactTrailing: {
        // The percentage, not a countdown (owner): it reads at a glance, and its width is steady.
        Text("\(context.state.percent)%")
          .font(.caption2.weight(.semibold).monospacedDigit())
          .foregroundStyle(context.state.tint)
      } minimal: {
        PrinterGlyph()
          .frame(width: 16, height: 16)
          .foregroundStyle(context.state.tint)
      }
      .keylineTint(context.state.tint)
    }
  }
}

/// The slicer preview, or the printer glyph when the push had no room for it.
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
        PrinterGlyph()
          .padding(size * 0.25)
          .foregroundStyle(accent)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.white.opacity(0.08))
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
  }
}

/// A picture in a dark, rounded tile: the layer on its LCD, or the camera.
private struct PictureTile: View {
  let image: UIImage
  /// Fill crops the picture to the tile; fit shows all of it on black.
  let fill: Bool

  var body: some View {
    Image(uiImage: image)
      .resizable()
      .interpolation(.high)
      .aspectRatio(contentMode: fill ? .fill : .fit)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.black)
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
      Text("Layer \(state.layer.formatted()) of \(state.layers.formatted()) · \(state.percent)%")
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

  private var status: some View {
    Group {
      if context.state.isPrinting {
        TimeLeft(state: context.state)
          .font(.subheadline.weight(.semibold).monospacedDigit())
          .foregroundStyle(accent)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 80, alignment: .trailing)
      } else {
        Text(context.isStale ? "Not updated" : context.state.label)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(context.state.tint)
      }
    }
  }

  var body: some View {
    let layer = context.state.layerPicture
    let camera = context.state.cameraPicture
    if layer == nil && camera == nil {
      // Before the first update brings pictures: the thumbnail beside the details.
      HStack(alignment: .center, spacing: 12) {
        Thumbnail(attributes: context.attributes, size: 64)
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            Text(context.attributes.title)
              .font(.headline)
              .lineLimit(1)
            Spacer(minLength: 8)
            status
          }
          PrintBar(state: context.state)
          Details(state: context.state)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
      .padding(16)
    } else {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          PrinterGlyph()
            .frame(width: 16, height: 16)
            .foregroundStyle(accent)
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
          Spacer(minLength: 8)
          status
        }
        HStack(spacing: 8) {
          Thumbnail(attributes: context.attributes, size: 64)
          if let layer {
            PictureTile(image: layer, fill: false)
          }
          if let camera {
            PictureTile(image: camera, fill: true)
              .frame(width: 68)
          }
        }
        .frame(height: 64)
        PrintBar(state: context.state)
        Details(state: context.state)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
      }
      .padding(14)
    }
  }
}
