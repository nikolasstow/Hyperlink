import Foundation

/// What Return types in code, as an editor does it (the keyboard's own
/// formatting is off; CodeEditorView): a new line at the indent of the line it
/// leaves, one level more after an opener (`{`, `(`, `[`, `=>`). Between an
/// opener and its closer, the closer goes to a line of its own, back at the
/// line's indent, and the caret sits on the line between. Pure.
enum AutoIndent {
    /// What Return inserts at `location` in `text`, and where the caret goes
    /// in it.
    static func newline(in text: NSString, at location: Int) -> (insert: String, caret: Int) {
        let location = min(max(location, 0), text.length)
        let lineStart = text.lineRange(for: NSRange(location: location, length: 0)).location
        let before = text.substring(with: NSRange(location: lineStart, length: location - lineStart))
        let indent = String(before.prefix { $0 == " " || $0 == "\t" })
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        let opens = trimmed.hasSuffix("{") || trimmed.hasSuffix("(") || trimmed.hasSuffix("[") || trimmed.hasSuffix("=>")
        guard opens else {
            let insert = "\n" + indent
            return (insert, (insert as NSString).length)
        }
        let deeper = indent + unit(of: text)
        let next = location < text.length ? Character(UnicodeScalar(text.character(at: location)) ?? " ") : " "
        let closes = (trimmed.hasSuffix("{") && next == "}") || (trimmed.hasSuffix("(") && next == ")") || (trimmed.hasSuffix("[") && next == "]")
        let first = "\n" + deeper
        return (closes ? first + "\n" + indent : first, (first as NSString).length)
    }

    /// The file's indent step: a tab if its first indented line starts with
    /// one, else its smallest indent of spaces (2 when it has none).
    static func unit(of text: NSString) -> String {
        var smallest = Int.max
        var lines = 0
        text.enumerateLines { line, stop in
            guard let first = line.first, first == " " || first == "\t" else {
                return
            }
            if first == "\t" {
                smallest = 0
                stop.pointee = true
                return
            }
            let spaces = line.prefix { $0 == " " }.count
            if spaces < line.count {
                smallest = min(smallest, spaces)
            }
            lines += 1
            if lines >= 200 {
                stop.pointee = true
            }
        }
        if smallest == 0 {
            return "\t"
        }
        return String(repeating: " ", count: smallest == Int.max ? 2 : smallest)
    }
}
