import UIKit

/// A Runestone `Theme` built from the colours the JS side passes down (derived
/// from the active VS Code theme). Per-token colours come from the Shiki tokens
/// themselves (see `ShikiSyntaxHighlighter`); this supplies the base text colour,
/// the gutter, the selected line, and the font. `textColor(for:)` returns nil so
/// nothing overrides the token colours.
final class ShikiTheme: Theme {
    let font: UIFont
    let textColor: UIColor
    let gutterBackgroundColor: UIColor
    let gutterHairlineColor: UIColor
    let lineNumberColor: UIColor
    let lineNumberFont: UIFont
    let selectedLineBackgroundColor: UIColor
    let selectedLinesLineNumberColor: UIColor
    let selectedLinesGutterBackgroundColor: UIColor
    let invisibleCharactersColor: UIColor
    let pageGuideHairlineColor: UIColor
    let pageGuideBackgroundColor: UIColor
    let markedTextBackgroundColor: UIColor

    init(
        fontSize: CGFloat,
        foreground: UIColor,
        gutterBackground: UIColor,
        gutterForeground: UIColor,
        currentLine: UIColor,
        selection: UIColor
    ) {
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        self.font = font
        self.lineNumberFont = font
        self.textColor = foreground
        self.gutterBackgroundColor = gutterBackground
        self.gutterHairlineColor = .clear
        self.lineNumberColor = gutterForeground
        self.selectedLineBackgroundColor = currentLine
        self.selectedLinesLineNumberColor = foreground
        self.selectedLinesGutterBackgroundColor = gutterBackground
        self.invisibleCharactersColor = gutterForeground.withAlphaComponent(0.4)
        self.pageGuideHairlineColor = gutterForeground.withAlphaComponent(0.2)
        self.pageGuideBackgroundColor = gutterBackground
        self.markedTextBackgroundColor = selection
    }

    func textColor(for highlightName: String) -> UIColor? {
        nil
    }

    func fontTraits(for highlightName: String) -> FontTraits {
        []
    }
}
