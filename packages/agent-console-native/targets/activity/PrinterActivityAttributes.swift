import ActivityKit
import Foundation

/**
 The shape of the resin printer's Live Activity.

 ⚠️ This type is duplicated verbatim in `modules/live-activity/ios/`, for the
 same reason as `SessionActivityAttributes`: the app and the widget extension
 are separate compilation units, and ActivityKit matches the two copies by
 structure. Change both together.

 The relay (saturn-uploader, `src/LiveActivity.ts`) starts, updates, and ends
 the activity over APNs, so the JSON keys must also match its payloads.
 `ContentState` dates arrive as seconds since 2001-01-01.
 */
struct PrinterActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "printing" | "paused" | "done" | "stopped" | "error"
    var phase: String
    /// The layer the printer is on, counted from 1.
    var layer: Int
    var layers: Int
    /// 0 to 1, by layers, at the last push.
    var progress: Double
    /// When the print started, so the bar and countdown run on the device.
    var startedAt: Date
    /// When the printer expects to finish.
    var endsAt: Date
    /// The layer on the LCD as a base64 black and white PNG, or "".
    var layerImage: String
    /// The camera picture as a base64 JPEG, or "" (the relay's `activityCamera` is off).
    var cameraImage: String

    init(phase: String, layer: Int, layers: Int, progress: Double, startedAt: Date, endsAt: Date, layerImage: String = "", cameraImage: String = "") {
      self.phase = phase
      self.layer = layer
      self.layers = layers
      self.progress = progress
      self.startedAt = startedAt
      self.endsAt = endsAt
      self.layerImage = layerImage
      self.cameraImage = cameraImage
    }

    private enum CodingKeys: String, CodingKey {
      case phase, layer, layers, progress, startedAt, endsAt, layerImage, cameraImage
    }

    /// The pictures may be missing: a start push has no room for them.
    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      phase = try container.decode(String.self, forKey: .phase)
      layer = try container.decode(Int.self, forKey: .layer)
      layers = try container.decode(Int.self, forKey: .layers)
      progress = try container.decode(Double.self, forKey: .progress)
      startedAt = try container.decode(Date.self, forKey: .startedAt)
      endsAt = try container.decode(Date.self, forKey: .endsAt)
      layerImage = try container.decodeIfPresent(String.self, forKey: .layerImage) ?? ""
      cameraImage = try container.decodeIfPresent(String.self, forKey: .cameraImage) ?? ""
    }
  }

  var taskId: String
  var filename: String
  /// The slicer preview as a base64 JPEG of 2 KB or less, or "".
  var thumbnail: String
}
