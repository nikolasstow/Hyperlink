import Foundation

/**
 What the home-screen and lock-screen widgets read, and how they get it.

 A widget cannot see a Live Activity's `ContentState` — ActivityKit hands that
 to the activity, not to the extension's other widgets — so the run widgets
 fetch their own state from the opencode server instead, over the same app
 group `StopAgentIntent` already uses for its abort call. Two endpoints, both
 plain reads:

 - `GET /session`         → every session (id, title, directory, time.updated)
 - `GET /session/status`  → `{ sessionID: { type: "idle" | "busy" | "retry" } }`

 Deliberately *not* fetched: the agent's current action line ("editing
 Composer.tsx"). That lives in the message stream, and pulling a session's
 messages to render one line of a 170pt widget is not a trade worth making —
 the session title carries the same intent for far less.

 Nothing here throws. A widget that cannot reach the server renders its last
 good state with a staleness marker rather than an error, because an error in a
 widget is just a broken-looking widget.
 */

// MARK: - Model

/// One session, shaped for a widget rather than for the app.
struct RunRow: Identifiable, Hashable, Codable {
  let id: String
  let title: String
  /// Derived from the session directory — see `Workspace.split`.
  let repo: String
  /// `nil` when the path does not look like the app's own layout.
  let worktree: String?
  let isBusy: Bool
  let updatedAt: Date

  /// "hyperlink · providers", or just "hyperlink".
  var label: String {
    guard let worktree else { return repo }
    return "\(repo) · \(worktree)"
  }
}

struct RunSnapshot {
  let rows: [RunRow]
  let fetchedAt: Date
  /// The server could not be reached, or answered something unusable. The rows
  /// may still be worth showing — they are simply older than they look.
  let isStale: Bool

  var busy: [RunRow] { rows.filter(\.isBusy) }
  var busyCount: Int { busy.count }

  /// Most recently touched running session — what "the current run" means when
  /// several are going at once.
  var current: RunRow? {
    busy.max(by: { $0.updatedAt < $1.updatedAt })
  }

  /// Running first, then most recently touched. The ordering *is* the feature:
  /// a plain reverse-chronological list buries the row that is actually live.
  var ranked: [RunRow] {
    rows.sorted { lhs, rhs in
      if lhs.isBusy != rhs.isBusy { return lhs.isBusy }
      return lhs.updatedAt > rhs.updatedAt
    }
  }

  /// Sample data for `placeholder(in:)` and the widget gallery, which render
  /// before any fetch has happened.
  static var preview: RunSnapshot {
    RunSnapshot(
      rows: [
        RunRow(
          id: "ses_preview_1",
          title: "Wire the Providers screen",
          repo: "hyperlink",
          worktree: "providers",
          isBusy: true,
          updatedAt: Date().addingTimeInterval(-257)
        ),
        RunRow(
          id: "ses_preview_2",
          title: "Builds page handoff",
          repo: "hyperlink",
          worktree: "main",
          isBusy: false,
          updatedAt: Date().addingTimeInterval(-3_600)
        ),
        RunRow(
          id: "ses_preview_3",
          title: "Live Activity labels",
          repo: "double-agent",
          worktree: "ios",
          isBusy: false,
          updatedAt: Date().addingTimeInterval(-7_400)
        ),
      ],
      fetchedAt: Date(),
      isStale: false
    )
  }
}

// MARK: - Directory → repo / worktree

enum Workspace {
  /**
   Splits a session directory into repo and worktree.

   Mirrors the two path templates the app actually writes (`settings.ts`):
   `{root}/{repo}/main` for a main checkout and `{root}/{repo}/worktrees/{name}`
   for a linked one. A directory that matches neither — a custom template, or a
   plain folder opened as a workspace — degrades to just the last component,
   which is still the most recognisable name available.

   The app itself resolves this properly against a filesystem scan
   (`repoGrouping.ts`). A widget has no scan and no room for one, so this is a
   deliberate approximation of the common case, not a reimplementation.
   */
  static func split(directory: String) -> (repo: String, worktree: String?) {
    let parts = directory
      .split(separator: "/", omittingEmptySubsequences: true)
      .map(String.init)

    guard let last = parts.last else { return (directory, nil) }

    // {root}/{repo}/worktrees/{name}
    if parts.count >= 3, parts[parts.count - 2] == "worktrees" {
      return (parts[parts.count - 3], last)
    }

    // {root}/{repo}/main
    if parts.count >= 2, last == "main" {
      return (parts[parts.count - 2], last)
    }

    return (last, nil)
  }
}

// MARK: - Wire shapes

/// Only the fields a widget renders. Everything else in opencode's `Session` is
/// ignored on purpose — a decoder that names fields it does not use breaks when
/// any of them change.
private struct SessionDTO: Decodable {
  struct Time: Decodable {
    let updated: Double
  }

  let id: String
  let title: String
  let directory: String
  let time: Time
}

/// `SessionStatus` is a tagged union (`idle` / `busy` / `retry`); only the tag
/// matters here, and an unrecognised tag counts as not-running rather than
/// crashing the decode.
private struct StatusDTO: Decodable {
  let type: String
}

// MARK: - Fetch

enum WidgetData {
  /// Long enough to be worth waiting for on a timeline refresh, short enough
  /// that a dead server does not hold the extension open.
  private static let timeout: TimeInterval = 10

  /// Last successful read, kept in the app group so a failed refresh can show
  /// what was true rather than claiming there are no sessions. A
  /// `TimelineProvider` is constructed fresh for every refresh and holds no
  /// state of its own, so this cannot live in memory.
  private static let cacheKey = "widgetLastRows"

  private static func loadCache() -> [RunRow] {
    guard
      let defaults = UserDefaults(suiteName: AppGroup.identifier),
      let data = defaults.data(forKey: cacheKey),
      let rows = try? JSONDecoder().decode([RunRow].self, from: data)
    else {
      return []
    }
    return rows
  }

  private static func saveCache(_ rows: [RunRow]) {
    guard let defaults = UserDefaults(suiteName: AppGroup.identifier) else { return }
    guard let data = try? JSONEncoder().encode(rows) else { return }
    defaults.set(data, forKey: cacheKey)
  }

  /// The opencode server the app last connected to, plus its bearer token.
  /// Written by `LiveActivityModule.setServerConfig`; absent until the app has
  /// connected at least once on this install.
  private static var serverConfig: (base: String, password: String?)? {
    guard
      let defaults = UserDefaults(suiteName: AppGroup.identifier),
      let base = defaults.string(forKey: AppGroup.serverURLKey),
      !base.isEmpty
    else {
      return nil
    }
    let password = defaults.string(forKey: AppGroup.serverPasswordKey)
    return (base, (password?.isEmpty ?? true) ? nil : password)
  }

  private static func request(_ base: String, _ path: String, _ password: String?) -> URLRequest? {
    guard let url = URL(string: base + path) else { return nil }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = timeout
    if let password {
      request.setValue("Bearer \(password)", forHTTPHeaderField: "Authorization")
    }
    return request
  }

  /// `nil` for any failure — transport, non-2xx, or a body that will not
  /// decode. The caller turns that into staleness, never into an empty list:
  /// "no sessions" and "could not ask" are different statements and the widget
  /// must not make the wrong one.
  private static func get<T: Decodable>(
    _ type: T.Type,
    base: String,
    path: String,
    password: String?
  ) async -> T? {
    guard let request = request(base, path, password) else { return nil }
    guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  /**
   Current sessions and which of them are running.

   The two reads run concurrently — they are independent, and a widget refresh
   is on a clock. If the status read fails but the session list succeeds, the
   rows still render (as not-running) and the snapshot is marked stale, which
   is more useful than showing nothing.
   */
  static func snapshot() async -> RunSnapshot {
    guard let config = serverConfig else {
      // Never connected on this install — genuinely empty, not stale.
      return RunSnapshot(rows: [], fetchedAt: Date(), isStale: false)
    }

    async let sessionsTask = get(
      [SessionDTO].self,
      base: config.base,
      path: "/session",
      password: config.password
    )
    async let statusTask = get(
      [String: StatusDTO].self,
      base: config.base,
      path: "/session/status",
      password: config.password
    )

    let (sessions, statuses) = await (sessionsTask, statusTask)

    guard let sessions else {
      // Could not reach the server. Show the last good read and mark it stale —
      // an empty list here would say "you have no sessions", which is a
      // different statement and not the one that is true.
      return RunSnapshot(rows: loadCache(), fetchedAt: Date(), isStale: true)
    }

    let rows = sessions.map { session -> RunRow in
      let split = Workspace.split(directory: session.directory)
      return RunRow(
        id: session.id,
        title: session.title,
        repo: split.repo,
        worktree: split.worktree,
        isBusy: statuses?[session.id]?.type == "busy",
        // opencode timestamps are epoch milliseconds.
        updatedAt: Date(timeIntervalSince1970: session.time.updated / 1000)
      )
    }

    saveCache(rows)
    return RunSnapshot(rows: rows, fetchedAt: Date(), isStale: statuses == nil)
  }
}
