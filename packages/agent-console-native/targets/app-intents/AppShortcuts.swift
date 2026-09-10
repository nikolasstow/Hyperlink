import AppIntents

/// Zero-setup Siri phrases + Spotlight entries for the actions. Phrases are
/// parameter-free on purpose: an App Shortcut phrase can't capture a free-form
/// string inline, so "Ask DoubleAgent" triggers the intent and Siri then prompts
/// for the prompt text. Richer, parameterized flows live in the Shortcuts app.
struct DoubleAgentShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SendPromptIntent(),
      phrases: [
        "Ask \(.applicationName)",
        "Message \(.applicationName)",
      ],
      shortTitle: "Send a Prompt",
      systemImageName: "paperplane"
    )
    AppShortcut(
      intent: SessionStatusIntent(),
      phrases: [
        "Check \(.applicationName)",
        "What is \(.applicationName) doing",
      ],
      shortTitle: "Session Status",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: StopSessionIntent(),
      phrases: [
        "Stop \(.applicationName)",
      ],
      shortTitle: "Stop the Agent",
      systemImageName: "stop.fill"
    )
  }
}
