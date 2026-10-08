import ExpoModulesCore
import UIKit

/// One scope span for sticky scroll, from the JS structure provider
/// (`stickyRanges.ts`): the header line, the lines it covers, and its depth.
private struct StickyRangeNative: Decodable {
    let header: Int
    let start: Int
    let end: Int
    let depth: Int
    let label: String?
}

/// The native code editor surface: a forked Runestone `TextView` driven entirely
/// by props. Text and per-line Shiki tokens come down from JS; edits go back up
/// through `onTextChange`. Highlighting is the vendored Shiki layer, so colours
/// match the previews and chat blocks exactly. Read-only is just `editable = false`.
///
/// Sticky scroll: the enclosing scope headers (from `stickyRangesJson`) pin to the
/// top as you scroll into a block. We render them from the same text + Shiki
/// tokens so they look identical to the code, and a tap jumps to the line.
final class CodeEditorView: ExpoView, TextViewDelegate, UIScrollViewDelegate {
    private let textView = TextView()
    private let tokenStore = ShikiTokenStore()
    private let sticky = StickyScrollOverlay()
    let onTextChange = EventDispatcher()
    /// Reports native sticky-scroll decisions to JS so they surface in Metro logs
    /// (NSLog only reaches the device console, which we can't read remotely).
    let onStickyDebug = EventDispatcher()

    /// True while we set `text` programmatically, so the delegate's change
    /// callback never echoes a prop back up as an edit.
    private var isApplyingText = false

    // The latest tokens from JS (decoded from the tokens-JSON prop), reapplied
    // whenever the text changes so the two can arrive in any order without
    // losing the highlight.
    private var pendingLineTokens: [[ShikiToken]] = []

    // Scope ranges for sticky scroll, and the UTF-16 start offset of each line in
    // the current text (so we can slice a header line's text + look up its tokens).
    private var stickyRanges: [StickyRangeNative] = []
    private var lineStarts: [Int] = [0]
    private var shownHeaders: [Int] = []

    // Room for the translucent bars above and below: the content scrolls UNDER
    // them (so they blur it) but insets this far so the first/last lines clear.
    private var topInset: CGFloat = 0
    private var bottomInset: CGFloat = 0

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
        textView.delegate = self
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
        sticky.isHidden = true
        addSubview(sticky)
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

    /// Scope ranges as JSON: `[{header,start,end,depth}]` (0-based lines) from the
    /// structure provider. Drives sticky scroll.
    func setStickyRangesJson(_ json: String) {
        guard let data = json.data(using: .utf8) else {
            return
        }
        do {
            stickyRanges = try JSONDecoder().decode([StickyRangeNative].self, from: data)
        } catch {
            NSLog("[CodeEditor] sticky ranges decode failed: \(error)")
            stickyRanges = []
        }
        shownHeaders = []
        onStickyDebug(["event": "ranges", "ranges": stickyRanges.count])
        updateSticky()
    }

    func setTopInset(_ value: Double) {
        topInset = CGFloat(value)
        applyInsets()
    }

    func setBottomInset(_ value: Double) {
        bottomInset = CGFloat(value)
        applyInsets()
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

    /// The content runs full-bleed under the bars; inset it so the first line
    /// clears the header and the last clears the bottom bar, while mid-scroll
    /// lines still pass under the translucent glass.
    private func applyInsets() {
        let insets = UIEdgeInsets(top: topInset, left: 0, bottom: bottomInset, right: 0)
        textView.contentInset = insets
        textView.verticalScrollIndicatorInsets = insets
        updateSticky()
    }

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
        sticky.style(textColor: foreground, borderColor: gutterForeground.withAlphaComponent(0.3))
        rebuildHighlights()
    }

    /// Key the token store by each line's start offset in the current text, then
    /// repaint the visible lines. Line starts are the UTF-16 offsets just after
    /// each `\n`, matching Runestone's line ranges and the Shiki per-line split.
    private func rebuildHighlights() {
        lineStarts = lineStartOffsets(textView.text as NSString)
        guard !pendingLineTokens.isEmpty else {
            tokenStore.set([:])
            textView.redisplayVisibleLines()
            shownHeaders = []
            updateSticky()
            return
        }
        var map: [Int: [ShikiToken]] = [:]
        for (index, tokens) in pendingLineTokens.enumerated() where index < lineStarts.count {
            map[lineStarts[index]] = tokens
        }
        tokenStore.set(map)
        textView.redisplayVisibleLines()
        shownHeaders = []
        updateSticky()
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

    // MARK: - Sticky scroll

    private func stickyRowHeight() -> CGFloat {
        UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular).totalLineHeight * textView.lineHeightMultiplier
    }

    /// The document line at the top edge of the visible code (just below the
    /// header). Ask Runestone's real layout via hit-testing rather than
    /// estimating from a uniform line height — a tiny per-line error in the
    /// estimate compounds as you scroll and makes the sticky header lag well
    /// behind the line it should pin. Falls back to arithmetic if the hit-test
    /// misses.
    private func topVisibleLine() -> Int {
        // Sample half a line into the visible area so scroll jitter at a line
        // boundary can't flip the detected line back and forth.
        let bias = stickyRowHeight() * 0.5
        return textView.lineIndex(atContentY: textView.contentOffset.y + topInset + bias)
    }

    private func updateSticky() {
        guard !stickyRanges.isEmpty else {
            if !sticky.isHidden {
                sticky.isHidden = true
                shownHeaders = []
            }
            return
        }
        let line = topVisibleLine()
        // The innermost LABELLED scope you're inside — a breadcrumb, shown the
        // whole time `line` is within [start, end] (not gated on the header
        // scrolling off), so there's no on/off flip at the header boundary.
        let innermost = stickyRanges
            .filter { $0.label != nil && $0.start <= line && line <= $0.end }
            .max { $0.start < $1.start }
        let headerLine = innermost?.header ?? -1
        if shownHeaders != [headerLine] {
            shownHeaders = [headerLine]
            sticky.leadingInset = textView.gutterWidth + 4
            sticky.setPill(label: innermost?.label, line: headerLine) { [weak self] target in
                _ = self?.textView.goToLine(target)
            }
            onStickyDebug([
                "event": "update",
                "line": line,
                "label": innermost?.label ?? "",
                "header": headerLine,
                "contentOffsetY": Double(textView.contentOffset.y),
                "topInset": Double(topInset)
            ])
        }
        sticky.frame = CGRect(x: 0, y: topInset, width: bounds.width, height: sticky.preferredHeight)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        updateSticky()
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        updateSticky()
    }

    // MARK: - TextViewDelegate

    func textViewDidChange(_ textView: TextView) {
        guard !isApplyingText else {
            return
        }
        onTextChange(["text": textView.text])
    }
}
