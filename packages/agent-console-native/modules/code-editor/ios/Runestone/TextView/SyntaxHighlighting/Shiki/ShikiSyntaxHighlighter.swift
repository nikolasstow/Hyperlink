import UIKit

/// Colours a line from the Shiki tokens for that line (ShikiTokenStore) rather
/// than from a syntax tree. It implements the same per-line contract Runestone
/// already uses; the colours come straight from each token's hex, so it
/// reproduces Shiki / VS Code exactly and matches the previews and chat blocks.
final class ShikiSyntaxHighlighter: LineSyntaxHighlighter {
    var theme: Theme = DefaultTheme()
    var kern: CGFloat = 0
    var canHighlight: Bool { true }

    private let store: ShikiTokenStore

    init(store: ShikiTokenStore) {
        self.store = store
    }

    func syntaxHighlight(_ input: LineSyntaxHighlighterInput) {
        apply(to: input)
    }

    func syntaxHighlight(_ input: LineSyntaxHighlighterInput, completion: @escaping AsyncCallback) {
        apply(to: input)
        completion(.success(()))
    }

    func cancel() {}

    private func apply(to input: LineSyntaxHighlighterInput) {
        // The line's start in the document, in UTF-16 (ByteCount is UTF-16 * 2).
        let lineStart = input.byteRange.location.value / 2
        let tokens = store.tokens(forLineStartingAt: lineStart)
        guard !tokens.isEmpty else {
            return
        }
        let attributedString = input.attributedString
        let fullLength = attributedString.length
        attributedString.beginEditing()
        for token in tokens {
            guard token.length > 0, token.start >= 0, token.start + token.length <= fullLength else {
                continue
            }
            let range = NSRange(location: token.start, length: token.length)
            var attributes: [NSAttributedString.Key: Any] = [:]
            if let hex = token.color, let color = UIColor(shikiHex: hex) {
                attributes[.foregroundColor] = color
            }
            var traits: UIFontDescriptor.SymbolicTraits = []
            if token.bold == true {
                attributedString.addAttribute(.isBold, value: true, range: range)
                traits.insert(.traitBold)
            }
            if token.italic == true {
                attributedString.addAttribute(.isItalic, value: true, range: range)
                traits.insert(.traitItalic)
            }
            if !traits.isEmpty, let descriptor = theme.font.fontDescriptor.withSymbolicTraits(traits) {
                attributes[.font] = UIFont(descriptor: descriptor, size: theme.font.pointSize)
            }
            if !attributes.isEmpty {
                attributedString.addAttributes(attributes, range: range)
            }
        }
        attributedString.endEditing()
    }
}

extension UIColor {
    /// A Shiki / CSS hex colour: `#rgb`, `#rrggbb`, or `#rrggbbaa`.
    convenience init?(shikiHex hex: String) {
        var string = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if string.hasPrefix("#") {
            string.removeFirst()
        }
        if string.count == 3 {
            string = string.map { "\($0)\($0)" }.joined()
        }
        guard string.count == 6 || string.count == 8 else {
            return nil
        }
        var value: UInt64 = 0
        guard Scanner(string: string).scanHexInt64(&value) else {
            return nil
        }
        let r, g, b, a: CGFloat
        if string.count == 8 {
            r = CGFloat((value & 0xFF00_0000) >> 24) / 255
            g = CGFloat((value & 0x00FF_0000) >> 16) / 255
            b = CGFloat((value & 0x0000_FF00) >> 8) / 255
            a = CGFloat(value & 0x0000_00FF) / 255
        } else {
            r = CGFloat((value & 0xFF0000) >> 16) / 255
            g = CGFloat((value & 0x00FF00) >> 8) / 255
            b = CGFloat(value & 0x0000FF) / 255
            a = 1
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}
