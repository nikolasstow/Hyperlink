import Foundation

/// One coloured span within a line, in UTF-16 offsets local to that line —
/// pushed from JS (Shiki). A plain value so it decodes straight from the
/// tokens JSON the editor view receives.
struct ShikiToken: Decodable {
    let start: Int
    let length: Int
    let color: String?
    let bold: Bool?
    let italic: Bool?
}

/// A document's Shiki tokens, keyed by each line's start offset in the document
/// (UTF-16). The editor view sets this as JS re-tokenises; the per-line
/// highlighter reads it. A reference type so the language mode and the view
/// share one store.
final class ShikiTokenStore {
    private(set) var tokensByLineStart: [Int: [ShikiToken]] = [:]

    func set(_ next: [Int: [ShikiToken]]) {
        tokensByLineStart = next
    }

    func tokens(forLineStartingAt offset: Int) -> [ShikiToken] {
        tokensByLineStart[offset] ?? []
    }
}
