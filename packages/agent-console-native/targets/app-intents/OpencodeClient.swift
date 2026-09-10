import Foundation

/// Keys shared with the app via the app group (the app writes the server address
/// on connect). Duplicated per target — extensions don't share a module.
enum AppGroup {
  static let identifier = "group.com.nikolasstow.agentconsolenative"
  static let serverURLKey = "serverURL"
  static let serverPasswordKey = "serverPassword"

  static var serverURL: String? {
    UserDefaults(suiteName: identifier)?.string(forKey: serverURLKey)
  }
  static var serverPassword: String? {
    UserDefaults(suiteName: identifier)?.string(forKey: serverPasswordKey)
  }
}

/// A DoubleAgent session, decoded from opencode's `GET /session`.
struct OpencodeSession: Decodable {
  struct Time: Decodable {
    let updated: Double?
  }

  let id: String
  let title: String?
  let directory: String?
  let time: Time?

  /// A never-empty display title.
  var displayTitle: String {
    if let title, !title.isEmpty { return title }
    return "Untitled session"
  }
}

/// A readable error surfaced to Siri / Shortcuts.
struct OpencodeError: Error, CustomLocalizedStringResourceConvertible {
  let message: String
  var localizedStringResource: LocalizedStringResource { "\(message)" }
}

/// Minimal async opencode client for the extension. Reaches the server the app
/// is pointed at (over the app group), so actions run without launching the app.
enum Opencode {
  private static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
    guard let base = AppGroup.serverURL, let url = URL(string: "\(base)\(path)") else {
      throw OpencodeError(message: "No DoubleAgent server yet — open the app once to connect it.")
    }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.timeoutInterval = 15
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let password = AppGroup.serverPassword, !password.isEmpty {
      req.setValue("Bearer \(password)", forHTTPHeaderField: "Authorization")
    }
    if let body {
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
      throw OpencodeError(message: "The DoubleAgent server didn't respond.")
    }
    return data
  }

  /// All sessions, most-recently-active first.
  static func sessions() async throws -> [OpencodeSession] {
    let data = try await request("/session")
    let decoded = (try? JSONDecoder().decode([OpencodeSession].self, from: data)) ?? []
    return decoded.sorted { ($0.time?.updated ?? 0) > ($1.time?.updated ?? 0) }
  }

  /// The session to act on: the one passed, else the most-recently-active.
  static func resolve(_ session: SessionEntity?) async throws -> SessionEntity {
    if let session { return session }
    guard let recent = try await sessions().first else {
      throw OpencodeError(message: "You don't have any DoubleAgent sessions yet.")
    }
    return recent.entity
  }

  /// Send a prompt (non-blocking; the run then streams as usual).
  static func sendPrompt(_ text: String, to sessionID: String) async throws {
    _ = try await request(
      "/session/\(sessionID)/prompt_async",
      method: "POST",
      body: ["agent": "console", "parts": [["type": "text", "text": text]]]
    )
  }

  /// Abort a running session.
  static func abort(_ sessionID: String) async throws {
    _ = try await request("/session/\(sessionID)/abort", method: "POST")
  }
}

extension OpencodeSession {
  var entity: SessionEntity {
    SessionEntity(id: id, title: displayTitle, directory: directory)
  }
}
