/**
 * The SiriKit Intents extension.
 *
 * `type: "intent"` (extension point com.apple.intents-service) is what makes the
 * app a messaging target Siri can send to. It's required for HANDS-FREE reply to
 * a Communication Notification: when you dictate a reply, Siri routes it as an
 * `INSendMessageIntent`, and without a handler it falls back to Contacts and
 * says "can't find a contact for DoubleAgent". This handler sends the dictated
 * text straight into the session instead.
 *
 * The app group lets the handler read the server address the app writes (the
 * same channel the Live Activity's Stop button uses), so it can reach opencode
 * without launching the app.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "intent",
  name: "DoubleAgentIntents",
  displayName: "DoubleAgent Intents",
  frameworks: ["Intents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.nikolasstow.agentconsolenative"],
  },
};
