/**
 * The App Intents extension — this is what puts DoubleAgent actions in the
 * Shortcuts app and makes them invocable by Siri / the Action button / Spotlight.
 *
 * Distinct from the SiriKit `intent` extension (targets/intents), which only
 * handles replying to a communication notification. App Intents is the modern
 * framework: define an AppIntent and it appears system-wide as a shortcut action.
 *
 * `type: "app-intent"` is an ExtensionKit extension (com.apple.appintents-extension)
 * that runs WITHOUT launching the app, so an action posts to opencode directly.
 * It reads the server address from the shared app group, the same channel the
 * Live Activity Stop button and the reply handler use.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "app-intent",
  name: "DoubleAgentAppIntents",
  displayName: "DoubleAgent Shortcuts",
  frameworks: ["AppIntents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.nikolasstow.agentconsolenative"],
  },
};
