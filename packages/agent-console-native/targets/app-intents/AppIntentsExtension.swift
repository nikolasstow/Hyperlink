import AppIntents

/// Entry point for the App Intents extension (ExtensionKit). The intents,
/// entity, and shortcuts in this target are discovered from here and surfaced to
/// Shortcuts / Siri / Spotlight; they run in this extension, so they don't launch
/// the app.
@main
struct DoubleAgentAppIntentsExtension: AppIntentsExtension {}
