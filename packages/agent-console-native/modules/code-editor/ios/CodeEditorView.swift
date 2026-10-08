import ExpoModulesCore
import UIKit

/// The native code editor surface: a forked Runestone `TextView` driven entirely
/// by props. Text and per-line Shiki tokens come down from JS; edits go back up
/// through `onChange`. Highlighting is the vendored Shiki layer, so colours match
/// the previews and chat blocks exactly. Read-only is just `editable = false`.
final class CodeEditorView: ExpoView, TextViewDelegate {
    private let textView = TextView()
    private let tokenStore = ShikiTokenStore()
    let onTextChange = EventDispatcher()

    /// True while we set `text` programmatically, so the delegate's change
    /// callback never echoes a prop back up as an edit.
    private var isApplyingText = false

    // The latest tokens from JS (decoded from the tokens-JSON prop), reapplied
    // whenever the text changes so the two can arrive in any order without
    // losing the highlight.
    private var pendingLineTokens: [[ShikiToken]] = []

    // Theme inputs, held so any one changing rebuilds the whole theme.
    private var fontSize: CGFloat = 14
    private var foreground = UIColor(shikiHex: "#D4D4D4") ?? .label
    private var background = UIColor(shikiHex: "#1E1E1E") ?? .systemBackground
    private var gutterBackground = UIColor(shikiHex: "#1E1E1E") ?? .systemBackground
    private var gutterForeground = UIColor(shikiHex: "#858585") ?? .secondaryLabel
    private var currentLine = UIColor(shikiHex: "#2A2D2E") ?? .systemGray5
    private var selection = UIColor(shikiHex: "#264F78") ?? .systemBlue
    private var caret = UIColor(shikiHex: "#AEAFAD") ?? .label

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.editorDelegate = self
        textView.showLineNumbers = true
        textView.isLineWrappingEnabled = false
        textView.alwaysBounceVertical = true
        textView.contentInsetAdjustmentBehavior = .never
        textView.setLanguageMode(ShikiLanguageMode(store: tokenStore))
        addSubview(textView)
        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: topAnchor),
            textView.leadingAnchor.constraint(equalTo: leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: trailingAnchor),
            textView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        applyTheme()
    }

    // MARK: - Props

    func setText(_ text: String) {
        guard text != textView.text else {
            return
        }
        isApplyingText = true
        textView.text = text
        isApplyingText = false
        rebuildHighlights()
    }

    func setEditable(_ editable: Bool) {
        textView.isEditable = editable
        textView.isSelectable = true
    }

    /// Tokens as JSON: `[[{start,length,color?,bold?,italic?}]]`, one inner array
    /// per line. Decoded straight into `ShikiToken` (a string prop + JSONDecoder,
    /// rather than bridging nested records). On a malformed payload we keep the
    /// current tokens and log, rather than blanking the highlight.
    func setTokensJson(_ json: String) {
        guard let data = json.data(using: .utf8) else {
            return
        }
        do {
            pendingLineTokens = try JSONDecoder().decode([[ShikiToken]].self, from: data)
            rebuildHighlights()
        } catch {
            NSLog("[CodeEditor] token JSON decode failed: \(error)")
        }
    }

    func setFontSize(_ size: Double) {
        fontSize = CGFloat(size)
        applyTheme()
    }

    func setShowLineNumbers(_ show: Bool) {
        textView.showLineNumbers = show
    }

    func setWrapLines(_ wrap: Bool) {
        textView.isLineWrappingEnabled = wrap
    }

    func setTheme(_ theme: ThemeRecord) {
        if let value = theme.foreground.flatMap({ UIColor(shikiHex: $0) }) {
            foreground = value
        }
        if let value = theme.background.flatMap({ UIColor(shikiHex: $0) }) {
            background = value
        }
        if let value = theme.gutterBackground.flatMap({ UIColor(shikiHex: $0) }) {
            gutterBackground = value
        }
        if let value = theme.gutterForeground.flatMap({ UIColor(shikiHex: $0) }) {
            gutterForeground = value
        }
        if let value = theme.currentLine.flatMap({ UIColor(shikiHex: $0) }) {
            currentLine = value
        }
        if let value = theme.selection.flatMap({ UIColor(shikiHex: $0) }) {
            selection = value
        }
        if let value = theme.caret.flatMap({ UIColor(shikiHex: $0) }) {
            caret = value
        }
        applyTheme()
    }

    // MARK: - Internals

    private func applyTheme() {
        let theme = ShikiTheme(
            fontSize: fontSize,
            foreground: foreground,
            gutterBackground: gutterBackground,
            gutterForeground: gutterForeground,
            currentLine: currentLine,
            selection: selection
        )
        textView.theme = theme
        textView.backgroundColor = background
        backgroundColor = background
        textView.insertionPointColor = caret
        textView.selectionBarColor = caret
        textView.selectionHighlightColor = selection.withAlphaComponent(0.35)
        rebuildHighlights()
    }

    /// Key the token store by each line's start offset in the current text, then
    /// repaint the visible lines. Line starts are the UTF-16 offsets just after
    /// each `\n`, matching Runestone's line ranges and the Shiki per-line split.
    private func rebuildHighlights() {
        guard !pendingLineTokens.isEmpty else {
            tokenStore.set([:])
            textView.redisplayVisibleLines()
            return
        }
        let starts = lineStartOffsets(textView.text as NSString)
        var map: [Int: [ShikiToken]] = [:]
        for (index, tokens) in pendingLineTokens.enumerated() where index < starts.count {
            map[starts[index]] = tokens
        }
        tokenStore.set(map)
        textView.redisplayVisibleLines()
    }

    private func lineStartOffsets(_ string: NSString) -> [Int] {
        var starts = [0]
        let length = string.length
        var index = 0
        while index < length {
            if string.character(at: index) == 0x000A {
                starts.append(index + 1)
            }
            index += 1
        }
        return starts
    }

    // MARK: - TextViewDelegate

    func textViewDidChange(_ textView: TextView) {
        guard !isApplyingText else {
            return
        }
        onTextChange(["text": textView.text])
    }
}
