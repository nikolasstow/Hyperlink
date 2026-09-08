/**
 * The Notification Service Extension.
 *
 * `type: "notification-service"` is the extension kind that intercepts a push
 * (any with `mutable-content: 1`) on-device before it's shown, so we can rewrite
 * it as a Communication Notification — a "message from the agent" — which is
 * what makes Siri's Announce Notifications read it aloud and offer a hands-free
 * reply. The reply itself still funnels through the existing "agent" category's
 * text-input action; this only changes how the notification is presented.
 *
 * `Intents` is linked for `INPerson` / `INSendMessageIntent`; `UserNotifications`
 * for the extension base class. No app group: unlike the activity extension, the
 * NSE builds everything from the push payload and needs nothing the app writes.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "notification-service",
  name: "DoubleAgentNotificationService",
  displayName: "DoubleAgent Notifications",
  frameworks: ["UserNotifications", "Intents"],
};
