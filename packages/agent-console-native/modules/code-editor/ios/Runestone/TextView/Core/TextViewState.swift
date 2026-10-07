import Foundation

/// Encapsulates the bare informations needed to do syntax highlighting in a text view.
///
/// It is recommended to create an instance of `TextViewState` on a background queue and pass it to a ``TextView`` instead of setting the text, theme and language on the text view separately.
public final class TextViewState {
    let stringView: StringView
    let theme: Theme
    let lineManager: LineManager
    let languageMode: InternalLanguageMode

    /// Indent strategy detected in the text.
    ///
    /// The information provided by the detected strategy can be used to update the ``TextView/indentStrategy`` on the text view to align with the existing strategy in a text.
    public private(set) var detectedIndentStrategy: DetectedIndentStrategy = .unknown

    /// Line endings detected in the text.
    ///
    /// The information pvoided by the detected line endings can be used to update the ``TextView/lineEndings`` on the text view to align with the existing line endings in a text.
    ///
    /// The value is `nil` if the line ending cannot be detected.
    public private(set) var detectedLineEndings: LineEnding?

    /// The length of the longest line.
    public private(set) var lengthOfLongestLine: Int?

    /// Creates state that can be passed to an instance of ``TextView``.
    ///
    /// The created state uses a plain-text language mode. Syntax highlighting is
    /// driven externally (e.g. by setting a ``ShikiLanguageMode`` on the text view).
    /// - Parameters:
    ///   - text: The text to display in the text view.
    ///   - theme: The theme to use when syntax highlighting the text.
    public init(text: String, theme: Theme = DefaultTheme()) {
        self.theme = theme
        self.stringView = StringView(string: NSMutableString(string: text))
        self.lineManager = LineManager(stringView: stringView)
        self.languageMode = PlainTextInternalLanguageMode()
        prepare(with: text)
    }
}

private extension TextViewState {
    private func prepare(with text: String) {
        let nsString = text as NSString
        lineManager.estimatedLineHeight = theme.font.totalLineHeight
        lineManager.rebuild()
        languageMode.parse(nsString)
        lengthOfLongestLine = lineManager.initialLongestLine?.data.totalLength
        detectedIndentStrategy = languageMode.detectIndentStrategy()
        let lineEndingDetector = LineEndingDetector(lineManager: lineManager, stringView: stringView)
        detectedLineEndings = lineEndingDetector.detect()
    }
}
