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
  }

  var taskId: String
  var filename: String
  /// The slicer preview as a base64 JPEG of 2 KB or less, or "".
  var thumbnail: String
}
