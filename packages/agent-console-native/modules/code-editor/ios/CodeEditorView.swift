import ExpoModulesCore
import UIKit

/// One scope span for sticky scroll, from the JS structure provider
/// (`stickyRanges.ts`): the header line, the lines it covers, and its depth.
private struct StickyRangeNative: Decodable {
    let header: Int
    let start: Int
    let end: Int
    let depth: Int
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
    /// A choice on a conflict's buttons: `{index, keep: "Mine" | "Theirs"}`.
    let onConflictAction = EventDispatcher()
    /// Open session on an agent change's popover: `{sessionID}`.
    let onOpenSession = EventDispatcher()
    /// The line you are at, when it changes: `{line}` (0-based).
    let onLineChange = EventDispatcher()
    /// Where the code came to rest after a scroll: `{offset}`, points from the
    /// code's top (0 at the top, whatever the insets).
    let onScrollRest = EventDispatcher()
    /// Where the caret is while editing, when it moves: `{offset}` (UTF-16);
    /// `{}` once editing ends.
    let onCaretChange = EventDispatcher()
    /// An inline suggestion was taken (a tap, or a double space): `{id}`.
    let onSuggestionAccept = EventDispatcher()
    private var reportedCaret: Int?
    /// True while Return's indent goes in, so that edit is not indented again.
    private var isIndenting = false
    private var periodShortcut = PeriodShortcut()
    /// Where to rest the code once it is laid out (a file reopening where it
    /// was left); applied once.
    private var pendingOffset: CGPoint?
    // Where the code is to rest across, while it is not yet that wide: the
    // width is known only as lines are laid out, a moment after it rests.
    private var acrossToGo: CGFloat?
    private var widthObservation: NSKeyValueObservation?
    private var reportedLine = -1

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
    private var fontFamily: String?
    private var foreground = UIColor(shikiHex: "#D4D4D4") ?? .label
    // Clear until the theme comes: the view paints nothing of its own rather
    // than a dark default that shows for a frame before the theme's colours.
    private var background = UIColor.clear
    private var gutterBackground = UIColor.clear
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
        // or the code — but no more, as wider code fonts widen it already. The
        // change marks' stripe sits 5pt in from its right edge, inside this.
        textView.gutterLeadingPadding = 10
        textView.gutterTrailingPadding = 10
        textView.isLineWrappingEnabled = false
        // The keyboard's own formatting is off: it is code, and the editor does
        // its own (AutoIndent.swift; suggestions take a double space, which iOS
        // would make ". ").
        textView.autocorrectionType = .no
        textView.autocapitalizationType = .none
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.smartInsertDeleteType = .no
        textView.spellCheckingType = .no
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
        textView.addGestureRecognizer(popoverDismissal)
        applyTheme()
        // A font installed while the file is open (CodeFonts.swift) is drawn
        // in at once.
        NotificationCenter.default.addObserver(self, selector: #selector(fontsChanged), name: CodeFonts.changed, object: nil)
        // After the change: Runestone puts the offset back as it was once it
        // has set the size.
        widthObservation = textView.observe(\.contentSize) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.goAcross()
            }
        }
    }

    /// Goes on across to where the code was left, as far as it is wide now.
    private func goAcross() {
        guard let acrossToGo else { return }
        let inset = textView.adjustedContentInset
        let maxX = max(-inset.left, textView.contentSize.width + inset.right - textView.bounds.width)
        textView.contentOffset.x = min(acrossToGo, maxX)
        if maxX >= acrossToGo {
            self.acrossToGo = nil
        }
    }

    @objc private func fontsChanged() {
        applyTheme()
    }

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
        zones.onViewsChanged = { [weak self] in
            self?.keepAboveGutter()
        }
        return zones
    }()
    /// Lines agents changed, marked in the gutter (ChangeMarks.swift).
    private lazy var changeMarks: ChangeMarks = {
        let marks = ChangeMarks(textView: textView)
        marks.rowHeight = { [weak self] in self?.stickyRowHeight() ?? 17 }
        marks.onOpenSession = { [weak self] sessionID in
            self?.onOpenSession(["sessionID": sessionID])
        }
        marks.onViewsChanged = { [weak self] in
            self?.keepAboveGutter()
        }
        return marks
    }()
    /// The file's problems, as wavy lines (Diagnostics.swift).
    private lazy var diagnostics: Diagnostics = {
        let found = Diagnostics(textView: textView)
        found.onViewsChanged = { [weak self] in
            self?.keepAboveGutter()
        }
        return found
    }()
    /// The inline suggestion at the caret, as ghost text (InlineSuggestion.swift).
    private lazy var suggestion: InlineSuggestion = {
        let ghost = InlineSuggestion(textView: textView)
        ghost.font = { [weak self] in self?.codeFont() ?? UIFont.monospacedSystemFont(ofSize: 14, weight: .regular) }
        ghost.rowHeight = { [weak self] in self?.stickyRowHeight() ?? 17 }
        ghost.onAccept = { [weak self] id in
            self?.onSuggestionAccept(["id": id])
        }
        ghost.onViewsChanged = { [weak self] in
            self?.keepAboveGutter()
        }
        return ghost
    }()
    /// Closes a change's popover on a tap anywhere else.
    private lazy var popoverDismissal: UITapGestureRecognizer = {
        let tap = UITapGestureRecognizer(target: self, action: #selector(tappedEditor(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        return tap
    }()

    private func keepAboveGutter() {
        textView.viewsAboveGutter = conflictZones.views + changeMarks.views + diagnostics.views + suggestion.views
        textView.setNeedsLayout()
    }

    @objc private func tappedEditor(_ tap: UITapGestureRecognizer) {
        changeMarks.tapped(at: tap.location(in: textView))
        diagnostics.tapped(at: tap.location(in: textView))
    }
    private var flashGeneration = 0
    /// The flash holds, then fades out.
    private static let flashHold: TimeInterval = 0.6
    private static let flashFade: TimeInterval = 1.4
    /// Room kept between the caret's line and whatever covers the bottom.
    private static let caretMargin: CGFloat = 8
    /// The theme's colour for lines as they land.
    private var flashColor = UIColor(red: 0.61, green: 0.73, blue: 0.33, alpha: 0.2)
    /// The lines lit now.
    private var flashViews: [UIView] = []

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
        changeMarks.layout()
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

    /// Mark lines an agent changed (`[{kind,from,to,sessionID?,title?,at}]`
    /// against the current text), until the file is closed.
    /// The suggestion for the caret as JSON: `{id, at, text}`; empty: none.
    func setInlineSuggestionJson(_ json: String) {
        suggestion.set(json.isEmpty ? nil : decodeJson(InlineSuggestionNative.self, json))
    }

    /// The file's problems as JSON: `[{start,end,severity,message,source?,code?}]`.
    func setDiagnosticsJson(_ json: String) {
        diagnostics.set(decodeJson([DiagnosticNative].self, json) ?? [])
    }

    func markChanges(_ marksJson: String) {
        changeMarks.add(decodeJson([ChangeMarkNative].self, marksJson) ?? [])
    }

    /// Light the lines of `ranges` across the editor's full width, behind
    /// the text, in the theme's colour for lines landing; then fade them.
    private func flash(_ ranges: [TextRangeNative]) {
        guard !ranges.isEmpty else {
            return
        }
        flashGeneration += 1
        let generation = flashGeneration
        let width = max(textView.contentSize.width, textView.bounds.width)
        let lit = ranges.compactMap { range -> UIView? in
            guard let first = textView.row(containing: range.from),
                  let last = textView.row(containing: max(range.from, range.to)),
                  let top = textView.lineFrame(ofLine: first),
                  let bottom = textView.lineFrame(ofLine: last) else {
                return nil
            }
            let topY = top.top + top.insets.above
            let view = UIView(frame: CGRect(x: 0, y: topY, width: width, height: bottom.top + bottom.height - bottom.insets.below - topY))
            view.backgroundColor = flashColor
            view.isUserInteractionEnabled = false
            textView.insertBehindText(view)
            return view
        }
        flashViews.forEach { $0.removeFromSuperview() }
        flashViews = lit
        UIView.animate(withDuration: Self.flashFade, delay: Self.flashHold, options: [.curveEaseIn, .allowUserInteraction], animations: {
            lit.forEach { $0.alpha = 0 }
        }, completion: { [weak self] _ in
            lit.forEach { $0.removeFromSuperview() }
            if self?.flashGeneration == generation {
                self?.flashViews = []
            }
        })
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
        // A whole new text: the marks no longer point at their lines.
        changeMarks.clear()
        isApplyingText = true
        textView.text = text
        isApplyingText = false
        rebuildHighlights()
        reportLine()
    }

    /// Rest the code `offset` points from its top, once it is laid out.
    func setInitialOffset(_ offset: Double) {
        pendingOffset = CGPoint(x: pendingOffset?.x ?? 0, y: CGFloat(offset))
        setNeedsLayout()
    }

    /// Rest the code `offset` points from its left, once it is laid out.
    func setInitialOffsetX(_ offset: Double) {
        pendingOffset = CGPoint(x: CGFloat(offset), y: pendingOffset?.y ?? 0)
        setNeedsLayout()
    }

    /// The code `offset.y` points from its top and `offset.x` from its left,
    /// now (kept within the text).
    func scrollToOffset(_ offset: CGPoint) {
        let inset = textView.adjustedContentInset
        let minY = -inset.top
        let maxY = max(minY, textView.contentSize.height + inset.bottom - textView.bounds.height)
        textView.contentOffset.y = min(max(offset.y - topInset, minY), maxY)
        // The width is known only for lines laid out: lay out the ones now
        // shown before going across.
        textView.layoutIfNeeded()
        let minX = -inset.left
        let maxX = max(minX, textView.contentSize.width + inset.right - textView.bounds.width)
        textView.contentOffset.x = min(max(offset.x, minX), maxX)
    }

    private func reportScrollRest() {
        onScrollRest([
            "offset": Double(textView.contentOffset.y + topInset),
            "offsetX": Double(textView.contentOffset.x),
        ])
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
        updateSticky()
    }

    func setTopInset(_ value: Double) {
        topInset = CGFloat(value)
        applyInsets()
    }

    func setBottomInset(_ value: Double) {
        let grew = CGFloat(value) > bottomInset
        bottomInset = CGFloat(value)
        applyInsets()
        if grew {
            keepCaretAboveBottom()
        }
    }

    func setStickyFill(_ value: Double) {
        stickyFill = CGFloat(value)
        updateSticky()
    }

    func setFontSize(_ size: Double) {
        fontSize = CGFloat(size)
        applyTheme()
    }

    func setFontFamily(_ family: String) {
        fontFamily = family
        applyTheme()
    }

    /// The code's font: the chosen family when it is installed (a custom one
    /// once it is registered), else the system's monospace.
    private func codeFont() -> UIFont {
        TextImage.codeFont(family: fontFamily ?? "", size: fontSize)
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
        if let value = theme.light {
            conflictColors.light = value
        }
        if let value = theme.mergeLabel.flatMap({ UIColor(shikiHex: $0) }) {
            conflictColors.label = value
        }
        conflictZones.colors = conflictColors
        var markColors = changeMarks.colors
        if let value = theme.changeAdded.flatMap({ UIColor(shikiHex: $0) }) {
            markColors.added = value
        }
        if let value = theme.changeModified.flatMap({ UIColor(shikiHex: $0) }) {
            markColors.modified = value
        }
        if let value = theme.changeDeleted.flatMap({ UIColor(shikiHex: $0) }) {
            markColors.deleted = value
        }
        if let value = theme.changeLabel.flatMap({ UIColor(shikiHex: $0) }) {
            markColors.label = value
        }
        if let value = theme.light {
            markColors.light = value
        }
        changeMarks.colors = markColors
        var problemColors = diagnostics.colors
        if let value = theme.diagnosticError.flatMap({ UIColor(shikiHex: $0) }) {
            problemColors.error = value
        }
        if let value = theme.diagnosticWarning.flatMap({ UIColor(shikiHex: $0) }) {
            problemColors.warning = value
        }
        if let value = theme.diagnosticInfo.flatMap({ UIColor(shikiHex: $0) }) {
            problemColors.info = value
        }
        if let value = theme.diagnosticHint.flatMap({ UIColor(shikiHex: $0) }) {
            problemColors.hint = value
        }
        if let value = theme.light {
            problemColors.light = value
        }
        diagnostics.colors = problemColors
        if let value = theme.ghostText.flatMap({ UIColor(shikiHex: $0) }) {
            suggestion.ghostColor = value
        }
        if let value = theme.changeFlash.flatMap({ UIColor(shikiHex: $0) }) {
            flashColor = value
        }
        applyTheme()
    }

    // MARK: - Keyboard

    /// The editor being edited, if any: the bar's swipes act on it.
    private static weak var editing: CodeEditorView?

    /// Puts the keyboard down but keeps editing (the caret stays); false when
    /// no editor is being edited.
    static func hideKeyboard() -> Bool {
        guard let editor = editing, editor.textView.isEditing else {
            return false
        }
        editor.textView.hidesKeyboard = true
        return true
    }

    /// Brings the keyboard back to an editor kept editing without it; false
    /// when there is none.
    static func showKeyboard() -> Bool {
        guard let editor = editing, editor.textView.isEditing, editor.textView.hidesKeyboard else {
            return false
        }
        editor.textView.hidesKeyboard = false
        return true
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

    /// While editing, a grown bottom inset (the bar window opening over the
    /// editor) can cover the caret's line; scroll it back up into view.
    private func keepCaretAboveBottom() {
        guard textView.isEditing, let end = textView.selectedTextRange?.end else {
            return
        }
        let caret = textView.caretRect(for: end)
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - bottomInset
        let overlap = caret.maxY + Self.caretMargin - visibleBottom
        guard overlap > 0 else {
            return
        }
        let minY = -textView.adjustedContentInset.top
        let maxY = max(minY, textView.contentSize.height + textView.adjustedContentInset.bottom - textView.bounds.height)
        let y = min(max(textView.contentOffset.y + overlap, minY), maxY)
        textView.setContentOffset(CGPoint(x: textView.contentOffset.x, y: y), animated: true)
    }

    private func applyTheme() {
        let theme = ShikiTheme(
            font: codeFont(),
            foreground: foreground,
            gutterBackground: gutterBackground,
            gutterForeground: gutterForeground,
            currentLine: currentLine,
            selection: selection
        )
        textView.theme = theme
        textView.backgroundColor = background
        backgroundColor = background
        suggestion.backing = background
        textView.insertionPointColor = caret
        textView.selectionBarColor = caret
        textView.selectionHighlightColor = selection.withAlphaComponent(0.35)
        sticky.style(
            background: background,
            gutterBackground: gutterBackground,
            lineNumberColor: gutterForeground,
            lineNumberFont: codeFont()
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
        codeFont().totalLineHeight * textView.lineHeightMultiplier
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

    /// The line you are at: the caret's while editing, else the top of the
    /// visible code. Reported when it changes (the breadcrumbs follow it).
    private func reportLine() {
        let caret = textView.isEditing ? textView.textLocation(at: textView.selectedRange.location) : nil
        let line = caret?.lineNumber ?? topVisibleLine()
        guard line != reportedLine else {
            return
        }
        reportedLine = line
        onLineChange(["line": line])
    }

    /// The caret's offset while editing, when it moves (the type preview and
    /// suggestions follow it); none once editing ends.
    private func reportCaret() {
        let caret = textView.isEditing ? textView.selectedRange.location : nil
        guard caret != reportedCaret else {
            return
        }
        reportedCaret = caret
        if let caret {
            onCaretChange(["offset": caret])
        } else {
            onCaretChange([:])
        }
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
        }
        // Push-off: the block is pinned at the top, but once the scope's last
        // line rises to the block's bottom it rides the scroll up and off — like
        // it's part of the content — instead of vanishing. y tracks the end line.
        let stickyHeight = sticky.preferredHeight
        let endTopViewY = textView.contentY(ofLine: end) - textView.contentOffset.y
        let pushY = min(0, endTopViewY - stickyHeight)
        sticky.frame = CGRect(x: 0, y: pushY, width: bounds.width, height: stickyHeight)
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
        let font = codeFont()
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
        if let pendingOffset, bounds.height > 0, textView.contentSize.height > 0 {
            self.pendingOffset = nil
            textView.layoutIfNeeded()
            scrollToOffset(pendingOffset)
            acrossToGo = textView.contentOffset.x < pendingOffset.x ? pendingOffset.x : nil
        }
        conflictZones.layout()
        changeMarks.layout()
        diagnostics.layout()
        suggestion.layout()
        updateSticky()
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        conflictZones.followHorizontalScroll()
        changeMarks.followHorizontalScroll()
        diagnostics.scrolled()
        updateSticky()
        reportLine()
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        acrossToGo = nil
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            reportScrollRest()
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        reportScrollRest()
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        reportScrollRest()
    }

    // MARK: - TextViewDelegate

    func textView(_ textView: TextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        // A double space takes the suggestion instead (it puts it in itself).
        guard suggestion.shouldChange(in: range, replacementText: text) else {
            periodShortcut.reset()
            return false
        }
        // iOS's period shortcut: what was typed was two spaces.
        if let over = periodShortcut.spaces(over: range, in: textView.text as NSString, replacement: text),
           let from = textView.position(from: textView.beginningOfDocument, offset: over.location),
           let to = textView.position(from: from, offset: over.length),
           let spaces = textView.textRange(from: from, to: to) {
            textView.replace(spaces, withText: "  ")
            return false
        }
        // Return indents the new line (AutoIndent.swift), as one edit.
        if text == "\n", range.length == 0, !isApplyingText, !isIndenting, !suggestion.isAccepting {
            let line = AutoIndent.newline(in: textView.text as NSString, at: range.location)
            if line.insert != "\n",
               let from = textView.position(from: textView.beginningOfDocument, offset: range.location),
               let at = textView.textRange(from: from, to: from) {
                isIndenting = true
                textView.replace(at, withText: line.insert)
                isIndenting = false
                textView.selectedRange = NSRange(location: range.location + line.caret, length: 0)
                return false
            }
        }
        conflictZones.textWillChange(in: range, replacementLength: (text as NSString).length)
        changeMarks.textWillChange(in: range, replacementLength: (text as NSString).length)
        diagnostics.textWillChange(in: range, replacementLength: (text as NSString).length)
        tokenStore.textWillChange(in: range, replacement: text)
        return true
    }

    func textViewDidBeginEditing(_ textView: TextView) {
        Self.editing = self
        reportLine()
    }

    func textViewDidChangeSelection(_ textView: TextView) {
        reportLine()
        reportCaret()
        suggestion.layout()
    }

    func textViewDidEndEditing(_ textView: TextView) {
        // Editing again brings the keyboard with it.
        textView.hidesKeyboard = false
        if Self.editing === self {
            Self.editing = nil
        }
        reportLine()
        reportCaret()
        suggestion.layout()
    }

    func textViewDidChange(_ textView: TextView) {
        guard !isApplyingText else {
            return
        }
        // Typing moves lines: the conflicts' space moves with them, and the
        // line starts sticky scroll reads are refreshed.
        lineStarts = lineStartOffsets(textView.text as NSString)
        conflictZones.layout()
        changeMarks.layout()
        diagnostics.layout()
        suggestion.layout()
        onTextChange(["text": textView.text])
    }
}

// MARK: - UIGestureRecognizerDelegate

extension CodeEditorView: UIGestureRecognizerDelegate {
    /// The tap that closes a change's popover watches alongside the editor's
    /// own gestures, never instead of them.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        gestureRecognizer === popoverDismissal
    }
}
