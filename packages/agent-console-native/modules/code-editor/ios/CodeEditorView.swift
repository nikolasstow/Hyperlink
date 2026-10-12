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

/// Tokens with the length of the text they were made for (`apiVersion` 7).
private struct VersionedTokens: Decodable {
    let length: Int
    let lines: [[ShikiToken]]
}

/// One change from JS (`file-sync`'s `TextChange`): replace `[from, to)` of the
/// text before any of the set is applied, in UTF-16 offsets.
private struct TextChangeNative: Decodable {
    let from: Int
    let to: Int
    let insert: String
}

/// A range of the text in UTF-16 offsets, `[from, to)`.
private struct TextRangeNative: Decodable {
    let from: Int
    let to: Int
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
    /// A choice on a conflict's buttons: `{index, keep: "Mine" | "Theirs"}`.
    let onConflictAction = EventDispatcher()

    /// True while we set `text` programmatically, so the delegate's change
    /// callback never echoes a prop back up as an edit.
    private var isApplyingText = false

    // The latest tokens from JS (decoded from the tokens-JSON prop), reapplied
    // whenever the text changes so the two can arrive in any order without
    // losing the highlight.
    private var pendingLineTokens: [[ShikiToken]] = []
    /// The length of the text the pending tokens were made for, when JS says.
    /// Tokens for older text are not laid over newer text: the colours the
    /// store moved along with the edits stay until tokens for this text come.
    private var pendingTokensLength: Int?

    // Scope ranges for sticky scroll, and the UTF-16 start offset of each line in
    // the current text (so we can slice a header line's text + look up its tokens).
    private var stickyRanges: [StickyRangeNative] = []
    // A scope must span at least this fraction of the visible lines (rounded
    // down) to pin — short blocks that fit on screen don't sticky, and a shorter
    // screen lowers the bar. Tweak freely.
    private let stickyMinFraction: Double = 0.05
    private var lineStarts: [Int] = [0]
    private var shownHeaders: [Int] = []
    // The scope currently on screen, kept while it rides up off the top even
    // after the viewport has scrolled past its end, so the push-off completes.
    private var displayedHeader = -1
    private var displayedEnd = -1

    // Room for the translucent bars above and below: the content scrolls UNDER
    // them (so they blur it) but insets this far so the first/last lines clear.
    private var topInset: CGFloat = 0
    private var bottomInset: CGFloat = 0
    /// How far down the sticky block fills (the header line rests at this y, and
    /// the real lines above it fill from here up through the status bar). A prop
    /// so the fill/snap can be tuned over Metro without a rebuild.
    private var stickyFill: CGFloat = 0

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
        // More breathing room around the line numbers than Runestone's default
        // 3/3 — the gutter reads as its own column, not cramped against the edge
        // or the code.
        textView.gutterLeadingPadding = 16
        textView.gutterTrailingPadding = 16
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

    /// Lines an agent just changed, lit briefly (Runestone highlighted ranges).
    private var flashedRanges: [HighlightedRange] = []
    /// Conflicts drawn in the document (ConflictZones.swift).
    private lazy var conflictZones: ConflictZones = {
        let zones = ConflictZones(textView: textView)
        zones.rowHeight = { [weak self] in self?.stickyRowHeight() ?? 17 }
        zones.styledLine = { [weak self] text, tokens in
            self?.styledLine(text, tokens: tokens) ?? NSAttributedString(string: text)
        }
        zones.onChoice = { [weak self] index, choice in
            self?.onConflictAction(["index": index, "keep": choice.rawValue])
        }
        return zones
    }()
    private var flashGeneration = 0
    private static let flashDuration: TimeInterval = 1.6

    // MARK: - Functions

    /// Apply outside changes in place (an agent's edit, another device's):
    /// each range is replaced where it is, so the cursor, the selection and
    /// the lines on screen stay put rather than jumping as a whole-text reset
    /// would. `expectedLength` is the length JS computed for the result; if
    /// the editor ends up different (it normalizes line endings on insert),
    /// it reports its text back so JS follows what is shown. `highlightJson`
    /// lights the changed lines for a moment.
    func applyChanges(_ changesJson: String, _ expectedLength: Int, _ highlightJson: String) {
        guard let changes = decodeJson([TextChangeNative].self, changesJson), !changes.isEmpty else {
            return
        }
        let selection = textView.selectedRange
        // The text at the top of the viewport, and where it is drawn, so it can
        // be drawn at the same place after the change.
        let topY = textView.contentOffset.y + textView.adjustedContentInset.top
        let anchorPosition = textView.closestPosition(to: CGPoint(x: 0, y: topY))
        let anchor = anchorPosition.map { textView.offset(from: textView.beginningOfDocument, to: $0) }
        let anchorY = anchorPosition.map { textView.caretRect(for: $0).minY }

        isApplyingText = true
        for change in changes.reversed() {
            textView.replace(NSRange(location: change.from, length: change.to - change.from), withText: change.insert)
        }
        isApplyingText = false
        // Undo steps recorded before this change point at offsets that no longer
        // hold the same text; undoing one would edit the wrong place.
        textView.undoManager?.removeAllActions()

        let start = Self.map(selection.location, through: changes)
        let end = Self.map(selection.location + selection.length, through: changes)
        textView.selectedRange = NSRange(location: start, length: max(0, end - start))
        if let anchor, let anchorY, let position = textView.position(from: textView.beginningOfDocument, offset: Self.map(anchor, through: changes)) {
            let shift = textView.caretRect(for: position).minY - anchorY
            if shift != 0 {
                let minY = -textView.adjustedContentInset.top
                let maxY = max(minY, textView.contentSize.height + textView.adjustedContentInset.bottom - textView.bounds.height)
                textView.contentOffset.y = min(max(textView.contentOffset.y + shift, minY), maxY)
            }
        }
        rebuildHighlights()
        conflictZones.layout()
        flash(decodeJson([TextRangeNative].self, highlightJson) ?? [])
        if (textView.text as NSString).length != expectedLength {
            onTextChange(["text": textView.text])
        }
    }

    /// Where `location` lands after `changes` (sorted, against the text before
    /// them): inside or at the end of a replaced range it moves to the end of
    /// the insert.
    private static func map(_ location: Int, through changes: [TextChangeNative]) -> Int {
        var shift = 0
        for change in changes {
            let delta = (change.insert as NSString).length - (change.to - change.from)
            if change.to <= location && !(change.from == change.to && change.from == location) {
                shift += delta
                continue
            }
            if change.from >= location {
                break
            }
            return change.from + shift + (change.insert as NSString).length
        }
        return location + shift
    }

    private func flash(_ ranges: [TextRangeNative]) {
        guard !ranges.isEmpty else {
            return
        }
        let color = textView.selectionHighlightColor.withAlphaComponent(0.3)
        flashedRanges = ranges.map { HighlightedRange(range: NSRange(location: $0.from, length: max(0, $0.to - $0.from)), color: color, cornerRadius: 3) }
        flashGeneration += 1
        let generation = flashGeneration
        showHighlightedRanges()
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.flashDuration) { [weak self] in
            guard let self, self.flashGeneration == generation else {
                return
            }
            self.flashedRanges = []
            self.showHighlightedRanges()
        }
    }

    private func showHighlightedRanges() {
        textView.highlightedRanges = flashedRanges
    }

    private func decodeJson<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        guard let data = json.data(using: .utf8) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            NSLog("[CodeEditor] decode failed: \(error)")
            return nil
        }
    }

    // MARK: - Props

    /// Conflicts as JSON: `[{from,to,mine,mineTokens?}]` — the agent's lines at
    /// `[from, to)` of the text, and what the user's edit made of them.
    func setConflictsJson(_ json: String) {
        conflictZones.set(decodeJson([ConflictNative].self, json) ?? [])
    }

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
        if let versioned = try? JSONDecoder().decode(VersionedTokens.self, from: data) {
            pendingLineTokens = versioned.lines
            pendingTokensLength = versioned.length
            rebuildHighlights()
            return
        }
        do {
            pendingLineTokens = try JSONDecoder().decode([[ShikiToken]].self, from: data)
            pendingTokensLength = nil
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
        displayedHeader = -1
        displayedEnd = -1
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

    func setStickyFill(_ value: Double) {
        stickyFill = CGFloat(value)
        updateSticky()
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
        var conflictColors = conflictZones.colors
        if let value = theme.mergeCurrentContent.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.mineLines = value
        }
        if let value = theme.mergeIncomingContent.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.theirsLines = value
        }
        if let value = theme.mergeCurrentHeader.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.mineButton = value
        }
        if let value = theme.mergeIncomingHeader.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.theirsButton = value
        }
        if let value = theme.widgetBackground.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.panel = value
        }
        if let value = theme.widgetBorder.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.panelBorder = value
        }
        if let value = theme.mergeLabel.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.label = value
        }
        conflictZones.colors = conflictColors
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
        sticky.style(
            background: background,
            gutterBackground: gutterBackground,
            lineNumberColor: gutterForeground,
            lineNumberFont: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        )
        rebuildHighlights()
    }

    /// Key the token store by each line's start offset in the current text, then
    /// repaint the visible lines. Line starts are the UTF-16 offsets just after
    /// each `\n`, matching Runestone's line ranges and the Shiki per-line split.
    private func rebuildHighlights() {
        lineStarts = lineStartOffsets(textView.text as NSString)
        if let pendingTokensLength, pendingTokensLength != (textView.text as NSString).length {
            // Tokens for an older text: keep the moved colours, wait for fresh ones.
            textView.redisplayVisibleLines()
            updateSticky()
            return
        }
        guard !pendingLineTokens.isEmpty else {
            tokenStore.set([:])
            textView.redisplayVisibleLines()
            shownHeaders = []
            displayedHeader = -1
            displayedEnd = -1
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
        displayedHeader = -1
        displayedEnd = -1
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

    private func hideSticky() {
        if !sticky.isHidden {
            sticky.isHidden = true
            shownHeaders = []
        }
        displayedHeader = -1
        displayedEnd = -1
    }

    private func updateSticky() {
        guard !stickyRanges.isEmpty else {
            hideSticky()
            return
        }
        let line = topVisibleLine()
        // Only pin scopes tall enough to matter: at least `stickyMinFraction` of
        // the visible lines (rounded down). Short blocks never sticky; a shorter
        // screen lowers the bar.
        let rowHeight = stickyRowHeight()
        let availableHeight = max(rowHeight, textView.bounds.height - topInset - bottomInset)
        let minSpan = Int((Double(availableHeight / rowHeight) * stickyMinFraction).rounded(.down))
        // A scope is "active" — gets a sticky — whenever its header has scrolled
        // off AND it's tall enough AND you're either inside it OR just past its
        // end but it hasn't fully ridden off the top yet (the end line is still
        // within a topInset of the top). That second clause is what makes the
        // push-off symmetric: it's the same test whether you scroll DOWN past the
        // end (block rides up) or back UP toward it (block slides back down) — the
        // position-based pushY below does the rest. The innermost such scope wins.
        let enclosing = stickyRanges
            .filter { range in
                guard range.header < line, (range.end - range.start) >= minSpan else { return false }
                if line <= range.end { return true }
                let endY = textView.contentY(ofLine: range.end) - textView.contentOffset.y
                return endY > -topInset
            }
            .max { $0.start < $1.start }
        let header: Int
        let end: Int
        if let enclosing {
            header = enclosing.header
            end = enclosing.end
        } else {
            hideSticky()
            return
        }
        displayedHeader = header
        displayedEnd = end
        // Enough rows to fill from the header up through the status bar (rowHeight
        // computed above).
        let rowCount = max(1, Int((stickyFill / rowHeight).rounded(.up)))
        // Rows top->bottom: [header - rowCount + 1 ... header], header last.
        if shownHeaders != [header] {
            shownHeaders = [header]
            let firstLine = header - rowCount + 1
            let rows = (0..<rowCount).map { offset -> StickyScrollOverlay.Row in
                let lineIndex = firstLine + offset
                return StickyScrollOverlay.Row(
                    number: lineIndex >= 0 ? lineIndex + 1 : nil,
                    code: attributedLine(at: lineIndex)
                )
            }
            sticky.setRows(
                rows,
                rowHeight: rowHeight,
                gutterWidth: textView.gutterWidth,
                gutterTrailingPadding: textView.gutterTrailingPadding,
                textLeftInset: textView.textContainerInset.left,
                headerLine: header
            ) { [weak self] target in
                _ = self?.textView.goToLine(target)
            }
            onStickyDebug([
                "event": "update",
                "line": line,
                "header": header,
                "rows": rowCount,
                "rowHeight": Double(rowHeight),
                "stickyFill": Double(stickyFill),
                "contentOffsetY": Double(textView.contentOffset.y),
                "topInset": Double(topInset)
            ])
        }
        // Push-off: the block is pinned at the top, but once the scope's last
        // line rises to the block's bottom it rides the scroll up and off — like
        // it's part of the content — instead of vanishing. y tracks the end line.
        let stickyHeight = sticky.preferredHeight
        let endTopViewY = textView.contentY(ofLine: end) - textView.contentOffset.y
        let pushY = min(0, endTopViewY - stickyHeight)
        sticky.frame = CGRect(x: 0, y: pushY, width: bounds.width, height: stickyHeight)
        // DIAG: the actual push-off geometry, every frame the block is riding, so
        // the real numbers are visible in the [sticky-native] log.
        if pushY < 0 {
            onStickyDebug([
                "event": "ride",
                "end": end,
                "endTopViewY": Double(endTopViewY),
                "stickyHeight": Double(stickyHeight),
                "pushY": Double(pushY),
                "topInset": Double(topInset),
                "stickyFill": Double(stickyFill),
                "contentOffsetY": Double(textView.contentOffset.y),
                "boundsH": Double(bounds.height)
            ])
        }
        // Track horizontal scroll so the frozen code lines up with the editor.
        sticky.setHorizontalOffset(textView.contentOffset.x)
    }

    /// The source line's text, coloured with its own Shiki tokens, so a frozen
    /// row is indistinguishable from the code it mirrors. An out-of-range line
    /// (above the file start) renders blank — filler up through the status bar.
    private func attributedLine(at lineIndex: Int) -> NSAttributedString {
        let string = textView.text as NSString
        guard lineIndex >= 0, lineIndex < lineStarts.count else {
            return NSAttributedString()
        }
        let start = lineStarts[lineIndex]
        var end = (lineIndex + 1 < lineStarts.count) ? lineStarts[lineIndex + 1] : string.length
        if end > start, string.character(at: end - 1) == 0x000A {
            end -= 1
        }
        if end > start, string.character(at: end - 1) == 0x000D {
            end -= 1
        }
        let lineText = string.substring(with: NSRange(location: start, length: max(0, end - start)))
        return styledLine(lineText, tokens: tokenStore.tokens(forLineStartingAt: start))
    }

    /// One line of code in the editor's font, coloured by its Shiki tokens
    /// (offsets local to the line).
    private func styledLine(_ lineText: String, tokens: [ShikiToken]) -> NSAttributedString {
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        let attributed = NSMutableAttributedString(string: lineText, attributes: [.font: font, .foregroundColor: foreground])
        let fullLength = attributed.length
        for token in tokens {
            guard token.length > 0, token.start >= 0, token.start + token.length <= fullLength else {
                continue
            }
            let range = NSRange(location: token.start, length: token.length)
            if let hex = token.color, let color = UIColor(shikiHex: hex) {
                attributed.addAttribute(.foregroundColor, value: color, range: range)
            }
            var traits: UIFontDescriptor.SymbolicTraits = []
            if token.bold == true {
                traits.insert(.traitBold)
            }
            if token.italic == true {
                traits.insert(.traitItalic)
            }
            if !traits.isEmpty, let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
                attributed.addAttribute(.font, value: UIFont(descriptor: descriptor, size: fontSize), range: range)
            }
        }
        return attributed
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        conflictZones.layout()
        updateSticky()
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        conflictZones.followHorizontalScroll()
        updateSticky()
    }

    // MARK: - TextViewDelegate

    func textView(_ textView: TextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        conflictZones.textWillChange(in: range, replacementLength: (text as NSString).length)
        tokenStore.textWillChange(in: range, replacement: text)
        return true
    }

    func textViewDidChange(_ textView: TextView) {
        guard !isApplyingText else {
            return
        }
        // Typing moves lines: the conflicts' space moves with them, and the
        // line starts sticky scroll reads are refreshed.
        lineStarts = lineStartOffsets(textView.text as NSString)
        conflictZones.layout()
        onTextChange(["text": textView.text])
    }
}
