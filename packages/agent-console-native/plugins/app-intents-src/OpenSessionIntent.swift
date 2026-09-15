import AppIntents

/// Open a DoubleAgent session in the app, by name. Unlike the other intents this
/// one opens the app: it stashes the target session id in the app group and
/// launches; the app reads it on foreground and navigates to that chat.
struct OpenSessionIntent: AppIntent {
  static var title: LocalizedStringResource = "Open a Session"
  static var description = IntentDescription("Open a DoubleAgent session in the app.")
  static var openAppWhenRun = true

  @Parameter(title: "Session")
  var session: SessionEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Open \(\.$session)")
  }

  func perform() async throws -> some IntentResult {
    UserDefaults(suiteName: AppGroup.identifier)?.set(session.id, forKey: AppGroup.pendingSessionKey)
    return .result()
  }
}
