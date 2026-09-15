import Intents
import UserNotifications

/// Rewrites an incoming push as a **Communication Notification** — a message
/// from the agent — so it renders with a sender, Siri's Announce Notifications
/// reads it as "Message from <session>", and the user can reply hands-free
/// (the reply lands in the existing "agent" category's text-input action).
///
/// Fired by `mutable-content: 1` on the push. Everything is built from the push
/// itself: the alert **title** is the sender (the session title), the alert
/// **body** is the message, and the session id threads the conversation. If any
/// step fails, the original notification is delivered unchanged — a plain alert
/// is always better than a dropped one.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let mutable = request.content.mutableCopy() as? UNMutableNotificationContent
    self.bestAttempt = mutable

    guard let content = mutable else {
      contentHandler(request.content)
      return
    }

    // The sender's display name is the alert title (the session title). Without
    // it there's nothing to attribute the message to, so fall through as a
    // plain notification.
    let senderName = content.title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !senderName.isEmpty else {
      contentHandler(content)
      return
    }

    // A stable conversation id threads replies to the same session. Expo's
    // exact payload nesting isn't contractual, so read it defensively rather
    // than assuming one path; fall back to a constant so unrelated pushes
    // (e.g. the "Claude Code" ping) still become communications.
    let conversationID = string(forKey: "sessionID", in: content.userInfo) ?? "doubleagent"

    let handle = INPersonHandle(value: conversationID, type: .unknown)
    let sender = INPerson(
      personHandle: handle,
      nameComponents: nil,
      displayName: senderName,
      image: nil,
      contactIdentifier: nil,
      customIdentifier: conversationID
    )

    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversationID,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )

    // Donating as `.incoming` is what marks it a received message, which the
    // communication-notification presentation and Announce both key off.
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate(completion: nil)

    do {
      let updated = try content.updating(from: intent)
      // Threading groups a session's notifications together.
      if let mutableUpdated = updated.mutableCopy() as? UNMutableNotificationContent {
        mutableUpdated.threadIdentifier = conversationID
        contentHandler(mutableUpdated)
      } else {
        contentHandler(updated)
      }
    } catch {
      // `updating(from:)` throws if the entitlement/intent isn't accepted —
      // deliver the original rather than nothing.
      content.threadIdentifier = conversationID
      contentHandler(content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    // The system is about to kill the extension: hand back whatever we have.
    if let contentHandler = contentHandler, let bestAttempt = bestAttempt {
      contentHandler(bestAttempt)
    }
  }

  /// Reads a string field from the push payload, tolerant of how Expo nests
  /// custom `data`: top-level `userInfo`, then the JSON-encoded `body`
  /// envelope, then a nested `data` dictionary.
  private func string(forKey key: String, in userInfo: [AnyHashable: Any]) -> String? {
    if let direct = userInfo[key] as? String, !direct.isEmpty {
      return direct
    }
    if let bodyString = userInfo["body"] as? String,
      let data = bodyString.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let value = parsed[key] as? String,
      !value.isEmpty
    {
      return value
    }
    if let nested = userInfo["data"] as? [AnyHashable: Any],
      let value = nested[key] as? String,
      !value.isEmpty
    {
      return value
    }
    return nil
  }
}
