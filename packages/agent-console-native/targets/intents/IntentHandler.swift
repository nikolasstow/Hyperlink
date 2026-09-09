import Intents

/// Principal class for the Intents extension. Vends a handler per intent type;
/// only messaging (the notification reply) is supported.
class IntentHandler: INExtension {
  override func handler(for intent: INIntent) -> Any? {
    if intent is INSendMessageIntent {
      return SendMessageHandler()
    }
    return nil
  }
}

/// Sends a dictated reply to a Communication Notification straight into the
/// session it came from, so a hands-free "reply …" reaches the agent without
/// opening the app — and without Siri trying (and failing) to resolve
/// "DoubleAgent" as a Contact.
final class SendMessageHandler: NSObject, INSendMessageIntentHandling {
  /// A reply targets the conversation (the session, via
  /// `conversationIdentifier`), not a person, so recipients are accepted as-is
  /// rather than resolved against Contacts — resolving is exactly what produced
  /// the "can't find a contact" error.
  func resolveRecipients(
    for intent: INSendMessageIntent,
    with completion: @escaping ([INSendMessageRecipientResolutionResult]) -> Void
  ) {
    let recipients = intent.recipients ?? []
    completion(recipients.map { INSendMessageRecipientResolutionResult.success(with: $0) })
  }

  func resolveContent(
    for intent: INSendMessageIntent,
    with completion: @escaping (INStringResolutionResult) -> Void
  ) {
    if let text = intent.content, !text.isEmpty {
      completion(INStringResolutionResult.success(with: text))
    } else {
      completion(INStringResolutionResult.needsValue())
    }
  }

  func handle(
    intent: INSendMessageIntent,
    completion: @escaping (INSendMessageIntentResponse) -> Void
  ) {
    let failure = INSendMessageIntentResponse(code: .failure, userActivity: nil)
    guard
      let sessionID = intent.conversationIdentifier,
      let text = intent.content,
      !text.isEmpty,
      let defaults = UserDefaults(suiteName: AppGroup.identifier),
      let base = defaults.string(forKey: AppGroup.serverURLKey),
      let url = URL(string: "\(base)/session/\(sessionID)/prompt_async")
    else {
      completion(failure)
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 12
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let password = defaults.string(forKey: AppGroup.serverPasswordKey), !password.isEmpty {
      request.setValue("Bearer \(password)", forHTTPHeaderField: "Authorization")
    }
    // `prompt_async` returns immediately; the run then streams and the server's
    // notification/activity machinery tracks it, same as a typed reply.
    let payload: [String: Any] = [
      "agent": "console",
      "parts": [["type": "text", "text": text]],
    ]
    request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

    let task = URLSession.shared.dataTask(with: request) { _, response, _ in
      let ok = (response as? HTTPURLResponse).map { (200 ..< 300).contains($0.statusCode) } ?? false
      completion(INSendMessageIntentResponse(code: ok ? .success : .failure, userActivity: nil))
    }
    task.resume()
  }
}

/// Keys shared between the app and this extension, duplicated per target because
/// extensions don't share a module with the app. Kept identical to the copies in
/// `targets/activity/StopAgentIntent.swift` and the app's writer.
enum AppGroup {
  static let identifier = "group.com.nikolasstow.agentconsolenative"
  static let serverURLKey = "serverURL"
  static let serverPasswordKey = "serverPassword"
}
