import UIKit

/// Default theme used by Runestone when no other theme has been set.
///
/// The colours are hardcoded (a VS Code "Dark+" palette) so the fork carries no
/// asset-catalog resources and drops into a CocoaPods target cleanly. At runtime
/// the editor installs a `ShikiTheme` built from the active VS Code theme, so this
/// is only the fallback before the first theme arrives.
public final class DefaultTheme: Theme {
    public let font: UIFont = .monospacedSystemFont(ofSize: 14, weight: .regular)
    public let textColor = DefaultTheme.hex("#D4D4D4")
    public let gutterBackgroundColor = DefaultTheme.hex("#1E1E1E")
    public let gutterHairlineColor = DefaultTheme.hex("#333333")
    public let lineNumberColor = DefaultTheme.hex("#858585")
    public let lineNumberFont: UIFont = .monospacedSystemFont(ofSize: 14, weight: .regular)
    public let selectedLineBackgroundColor = DefaultTheme.hex("#2A2D2E")
    public let selectedLinesLineNumberColor = DefaultTheme.hex("#C6C6C6")
    public let selectedLinesGutterBackgroundColor = DefaultTheme.hex("#1E1E1E")
    public let invisibleCharactersColor = DefaultTheme.hex("#404040")
    public let pageGuideHairlineColor = DefaultTheme.hex("#333333")
    public let pageGuideBackgroundColor = DefaultTheme.hex("#1E1E1E")
    public let markedTextBackgroundColor = DefaultTheme.hex("#264F78")
    public let selectionColor = DefaultTheme.hex("#264F78")

    public init() {}

    // swiftlint:disable:next cyclomatic_complexity
    public func textColor(for highlightName: String) -> UIColor? {
        guard let highlightName = HighlightName(highlightName) else {
            return nil
        }
        switch highlightName {
        case .comment:
            return DefaultTheme.hex("#6A9955")
        case .constantBuiltin:
            return DefaultTheme.hex("#569CD6")
        case .constantCharacter:
            return DefaultTheme.hex("#D7BA7D")
        case .constructor:
            return DefaultTheme.hex("#4EC9B0")
        case .function:
            return DefaultTheme.hex("#DCDCAA")
        case .keyword:
            return DefaultTheme.hex("#569CD6")
        case .number:
            return DefaultTheme.hex("#B5CEA8")
        case .property:
            return DefaultTheme.hex("#9CDCFE")
        case .string:
            return DefaultTheme.hex("#CE9178")
        case .type:
            return DefaultTheme.hex("#4EC9B0")
        case .variable:
            return nil
        case .variableBuiltin:
            return DefaultTheme.hex("#569CD6")
        case .operator:
            return DefaultTheme.hex("#D4D4D4")
        case .punctuation:
            return DefaultTheme.hex("#D4D4D4")
        }
    }

    public func fontTraits(for highlightName: String) -> FontTraits {
        guard let highlightName = HighlightName(highlightName) else {
            return []
        }
        if highlightName == .keyword {
            return .bold
        } else {
            return []
        }
    }

    @available(iOS 16.0, *)
    public func highlightedRange(forFoundTextRange foundTextRange: NSRange, ofStyle style: UITextSearchFoundTextStyle) -> HighlightedRange? {
        switch style {
        case .found:
            return HighlightedRange(range: foundTextRange, color: UIColor.systemYellow.withAlphaComponent(0.2), cornerRadius: 2)
        case .highlighted:
            return HighlightedRange(range: foundTextRange, color: UIColor.systemYellow, cornerRadius: 2)
        case .normal:
            return nil
        @unknown default:
            return nil
        }
    }

    private static func hex(_ hex: String) -> UIColor {
        UIColor(shikiHex: hex) ?? .label
    }
}
