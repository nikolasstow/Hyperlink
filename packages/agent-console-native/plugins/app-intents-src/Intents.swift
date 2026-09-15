import AppIntents
import Foundation

/// Send a message to a DoubleAgent session. The lever: start work by voice or a
/// shortcut without opening the app. No session given → the most-recent one.
struct SendPromptIntent: AppIntent {
  static var title: LocalizedStringResource = "Send a Prompt"
  static var description = IntentDescription("Send a message to a DoubleAgent session.")
  static var openAppWhenRun = false

  @Parameter(title: "Prompt")
  var prompt: String

  @Parameter(title: "Session")
  var session: SessionEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Send \(\.$prompt) to \(\.$session)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let target = try await Opencode.resolve(session)
    try await Opencode.sendPrompt(prompt, to: target.id)
    return .result(dialog: "Sent to \(target.title).")
  }
}

/// Report when a session was last active. Kept simple and endpoint-safe: derived
/// from the session list rather than a live busy probe.
struct SessionStatusIntent: AppIntent {
  static var title: LocalizedStringResource = "Get Session Status"
  static var description = IntentDescription("Check on a DoubleAgent session.")
  static var openAppWhenRun = false

  @Parameter(title: "Session")
  var session: SessionEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Check on \(\.$session)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let target = try await Opencode.resolve(session)
    let sessions = try await Opencode.sessions()
    let updated = sessions.first { $0.id == target.id }?.time?.updated
    let suffix = updated.map { " (last active \(relativeTime(fromMilliseconds: $0)))." } ?? "."
    return .result(dialog: "\(target.title)\(suffix)")
  }
}

/// Stop a running session — a voice/Shortcuts version of the island's Stop.
struct StopSessionIntent: AppIntent {
  static var title: LocalizedStringResource = "Stop the Agent"
  static var description = IntentDescription("Abort a running DoubleAgent session.")
  static var openAppWhenRun = false

  @Parameter(title: "Session")
  var session: SessionEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Stop \(\.$session)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let target = try await Opencode.resolve(session)
    try await Opencode.abort(target.id)
    return .result(dialog: "Stopped \(target.title).")
  }
}

/// "3 minutes ago" from a millisecond epoch.
private func relativeTime(fromMilliseconds ms: Double) -> String {
  let seconds = max(0, Date().timeIntervalSince1970 - ms / 1000)
  if seconds < 60 { return "just now" }
  let minutes = Int(seconds / 60)
  if minutes < 60 { return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago" }
  let hours = minutes / 60
  if hours < 24 { return hours == 1 ? "1 hour ago" : "\(hours) hours ago" }
  let days = hours / 24
  return days == 1 ? "1 day ago" : "\(days) days ago"
}
