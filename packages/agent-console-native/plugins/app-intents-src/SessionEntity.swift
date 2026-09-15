import AppIntents

/// A DoubleAgent session as a Shortcuts/Siri entity, so an action can take
/// "the epsilon session" (or leave it blank for the most-recent one).
struct SessionEntity: AppEntity {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Session")
  static var defaultQuery = SessionQuery()

  let id: String
  let title: String
  let directory: String?

  var displayRepresentation: DisplayRepresentation {
    if let directory, !directory.isEmpty {
      return DisplayRepresentation(title: "\(title)", subtitle: "\(directory)")
    }
    return DisplayRepresentation(title: "\(title)")
  }
}

/// Resolves sessions for the entity. `EntityStringQuery` is what lets Siri match
/// a spoken name — the fuzzy matching is ours: substring over title and the repo
/// directory, so "epsilon" / "the auth one" resolve.
struct SessionQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [SessionEntity] {
    let sessions = try await Opencode.sessions()
    return sessions.filter { identifiers.contains($0.id) }.map { $0.entity }
  }

  func entities(matching string: String) async throws -> [SessionEntity] {
    let needle = string.lowercased()
    let sessions = try await Opencode.sessions()
    return sessions
      .filter { session in
        session.displayTitle.lowercased().contains(needle)
          || (session.directory?.lowercased().contains(needle) ?? false)
      }
      .map { $0.entity }
  }

  func suggestedEntities() async throws -> [SessionEntity] {
    // Already most-recent-first; offer a handful.
    Array(try await Opencode.sessions().prefix(8)).map { $0.entity }
  }
}
