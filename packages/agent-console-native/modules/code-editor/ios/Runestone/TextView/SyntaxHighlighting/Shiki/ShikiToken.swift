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

    /// The text is about to change at `range`: move the colours with it, so the
    /// code keeps its colours while JS re-tokenises. Lines after the edit move
    /// by its length; on the edited line, tokens after the edit move and the
    /// one it lands in grows or shrinks. An edit that adds or removes a line
    /// break leaves the lines it touches plain until fresh tokens arrive.
    func textWillChange(in range: NSRange, replacement: String) {
        let delta = (replacement as NSString).length - range.length
        let end = range.location + range.length
        // The edited line: the last line starting at or before the edit.
        let editLine = tokensByLineStart.keys.filter { $0 <= range.location }.max()
        var next: [Int: [ShikiToken]] = [:]
        for (start, tokens) in tokensByLineStart {
            if start > range.location {
                // A line inside the replaced text is gone; one after it moves.
                if start >= end {
                    next[start + delta] = tokens
                }
                continue
            }
            guard start == editLine else {
                next[start] = tokens
                continue
            }
            // Text put in at the very start of the line pushes the whole line
            // along (new lines typed above it come in plain).
            if range.length == 0 && range.location == start {
                next[start + delta] = tokens
                continue
            }
            let crossesLines = replacement.contains("\n") || tokensByLineStart.keys.contains { $0 > range.location && $0 <= end }
            if crossesLines {
                continue
            }
            let local = range.location - start
            let localEnd = local + range.length
            next[start] = tokens.compactMap { token in
                let tokenEnd = token.start + token.length
                if tokenEnd <= local {
                    return token
                }
                if token.start >= localEnd {
                    return ShikiToken(start: token.start + delta, length: token.length, color: token.color, bold: token.bold, italic: token.italic)
                }
                // The edit is inside (or across) this token: it takes the new text.
                let length = max(0, token.length + delta)
                return length == 0 ? nil : ShikiToken(start: token.start, length: length, color: token.color, bold: token.bold, italic: token.italic)
            }
        }
        tokensByLineStart = next
    }
}
