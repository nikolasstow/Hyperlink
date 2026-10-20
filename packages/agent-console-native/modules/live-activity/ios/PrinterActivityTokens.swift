import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit

/**
 Sends the printer Live Activity's push tokens to the relay, which starts,
 updates, and ends the activity over APNs (saturn-uploader `RelayActivity.ts`).

 | Token | Route |
 |---|---|
 | push-to-start (iOS 17.2+) | `POST /api/activity/start-token` |
 | each activity's update token | `POST /api/activity/update-token` |

 This runs from launch, not from JavaScript: when the relay starts an
 activity, iOS wakes the app in the background only briefly to collect the
 new activity's update token, too briefly to wait for the bundle.

 The relay address comes from the app group (`setPrinterRelay`). Until it is
 known, the latest tokens wait in the app group and go out when it is set.
 */
enum PrinterActivityTokens {
  static let suite = "group.com.nikolasstow.agentconsolenative"
  static let relayKey = "printerRelayURL"
  static let startTokenKey = "printerStartToken"
  static let updateTokensKey = "printerUpdateTokens"

  nonisolated(unsafe) private static var observing = false
  nonisolated(unsafe) private static var observed = Set<String>()
  private static let lock = NSLock()

  static func observe() {
    guard #available(iOS 17.2, *) else { return }
    lock.lock()
    defer { lock.unlock() }
    if observing { return }
    observing = true

    log("observing; \(Activity<PrinterActivityAttributes>.activities.count) printer activities running")
    Task {
      for await data in Activity<PrinterActivityAttributes>.pushToStartTokenUpdates {
        let token = hex(data)
        UserDefaults(suiteName: suite)?.set(token, forKey: startTokenKey)
        send(path: "/api/activity/start-token", body: ["token": token])
      }
    }
    Task {
      for await activity in Activity<PrinterActivityAttributes>.activityUpdates {
        log("activity appeared for \(activity.attributes.taskId)")
        follow(activity)
      }
    }
    rescan()
  }

  /**
   Sends the current update token of every running activity. Called at
   launch and each time the app becomes active, so a token the token stream
   never delivered still reaches the relay.
   */
  static func rescan() {
    guard #available(iOS 17.2, *) else { return }
    for activity in Activity<PrinterActivityAttributes>.activities {
      follow(activity)
      if let data = activity.pushToken {
        remember(taskId: activity.attributes.taskId, token: hex(data))
        send(path: "/api/activity/update-token", body: ["taskId": activity.attributes.taskId, "token": hex(data)])
      } else {
        log("activity for \(activity.attributes.taskId) has no update token yet")
      }
    }
  }

  /// A line in the relay log, so token problems can be seen without the phone's console.
  static func log(_ event: String) {
    send(path: "/api/activity/log", body: ["event": event])
  }

  /// Saves the relay address and sends the tokens that waited for it.
  static func setRelay(_ url: String) {
    guard let defaults = UserDefaults(suiteName: suite) else { return }
    let changed = defaults.string(forKey: relayKey) != url
    defaults.set(url, forKey: relayKey)
    guard changed else { return }
    if let token = defaults.string(forKey: startTokenKey) {
      send(path: "/api/activity/start-token", body: ["token": token])
    }
    for (taskId, token) in updateTokens(defaults) {
      send(path: "/api/activity/update-token", body: ["taskId": taskId, "token": token])
    }
  }

  @available(iOS 16.2, *)
  private static func follow(_ activity: Activity<PrinterActivityAttributes>) {
    lock.lock()
    let isNew = observed.insert(activity.id).inserted
    lock.unlock()
    guard isNew else { return }
    let taskId = activity.attributes.taskId
    Task {
      for await data in activity.pushTokenUpdates {
        let token = hex(data)
        log("update token for \(taskId) from the token stream")
        remember(taskId: taskId, token: token)
        send(path: "/api/activity/update-token", body: ["taskId": taskId, "token": token])
      }
    }
  }

  /// Keeps the token for `setRelay`, dropping ended activities' tokens: they are never updated again.
  @available(iOS 16.2, *)
  private static func remember(taskId: String, token: String) {
    guard let defaults = UserDefaults(suiteName: suite) else { return }
    var tokens = updateTokens(defaults).filter { entry in
      Activity<PrinterActivityAttributes>.activities.contains { $0.attributes.taskId == entry.key }
    }
    tokens[taskId] = token
    defaults.set(tokens, forKey: updateTokensKey)
  }

  private static func updateTokens(_ defaults: UserDefaults) -> [String: String] {
    defaults.dictionary(forKey: updateTokensKey)?.compactMapValues { $0 as? String } ?? [:]
  }

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  /// Posts in a background task, so iOS lets it finish after a background wake.
  private static func send(path: String, body: [String: String]) {
    guard
      let base = UserDefaults(suiteName: suite)?.string(forKey: relayKey),
      let url = URL(string: base + path),
      let data = try? JSONSerialization.data(withJSONObject: body)
    else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = data
    request.timeoutInterval = 15
    Task { @MainActor in
      // The request times out well inside the background time iOS gives.
      let task = UIApplication.shared.beginBackgroundTask(withName: "printer-activity-token")
      defer { UIApplication.shared.endBackgroundTask(task) }
      do {
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
          NSLog("[printer-activity] %@ answered HTTP %d", path, http.statusCode)
        }
      } catch {
        NSLog("[printer-activity] %@ failed: %@", path, error.localizedDescription)
      }
    }
  }
}

/// Starts `PrinterActivityTokens` at launch, also on a background wake, and resends tokens on each return to the app.
public class PrinterActivityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    PrinterActivityTokens.observe()
    return true
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    PrinterActivityTokens.rescan()
  }
}
