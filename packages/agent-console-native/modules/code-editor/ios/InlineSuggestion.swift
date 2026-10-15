import UIKit

/// A suggestion for the caret, from JS: `text` to insert at offset `at`
/// (UTF-16), and an `id` to report back when it is taken.
struct InlineSuggestionNative: Decodable {
    let id: String
    let at: Int
    let text: String
}

/// An inline suggestion drawn as ghost text at the caret, the way VS Code
/// shows one: its first line goes on from the caret, the rest below it over a
/// backing in the editor's colour. It shows only while the caret is where it
/// was made for. A tap on it takes it; so does a double space (the second
/// space takes it, and the first is taken back; iOS's period shortcut, which
/// turns two spaces into ". ", counts too). Anything else typed lets it go.
final class InlineSuggestion {
    /// The theme's ghost text colour (`editorGhostText.foreground`).
    var ghostColor = UIColor(white: 1, alpha: 0.34) {
        didSet {
            layout()
        }
    }
    /// Behind lines after the first: the editor's background.
    var backing = UIColor.black {
        didSet {
            layout()
        }
    }
    var font: () -> UIFont = { UIFont.monospacedSystemFont(ofSize: 14, weight: .regular) }
    var rowHeight: () -> CGFloat = { 17 }
    /// It was taken: its id.
    var onAccept: (String) -> Void = { _ in }
    /// Its view changed: the editor keeps it above the gutter.
    var onViewsChanged: () -> Void = {}

    var views: [UIView] {
        view.superview == nil ? [] : [view]
    }

    private weak var textView: TextView?
    private var current: InlineSuggestionNative?
    private let view = SuggestionView()
    /// Where a space was typed with the suggestion showing: a second one
    /// right after it takes the suggestion.
    private var pendingSpace: Int?
    /// Where iOS took the first space back to put in ". " (its period
    /// shortcut, done as a delete then an insert): that insert takes the
    /// suggestion.
    private var pendingPeriod: Int?
    /// True while the suggestion is put in, so that edit is not taken for
    /// typing.
    private(set) var isAccepting = false

    init(textView: TextView) {
        self.textView = textView
        view.addAction(UIAction { [weak self] _ in
            self?.accept(replacing: nil)
        }, for: .touchUpInside)
    }

    /// The suggestion to show (none: whatever showed goes).
    func set(_ suggestion: InlineSuggestionNative?) {
        current = suggestion?.text.isEmpty == false ? suggestion : nil
        pendingSpace = nil
        pendingPeriod = nil
        layout()
    }

    /// The text is about to change at `range` to `text`, while editing.
    /// Returns false when the change took the suggestion instead (the editor
    /// then does nothing more with it).
    func shouldChange(in range: NSRange, replacementText text: String) -> Bool {
        guard !isAccepting, let suggestion = current else {
            return true
        }
        // iOS's period shortcut, second half: ". " where the space was.
        if let at = pendingPeriod {
            pendingPeriod = nil
            if text == ". " && range.length == 0 && range.location == at {
                accept(replacing: NSRange(location: at, length: 0))
                return false
            }
        }
        // The second of two spaces: the first goes, the suggestion comes.
        if let space = pendingSpace {
            if text == " " && range.length == 0 && range.location == space + 1 {
                accept(replacing: NSRange(location: space, length: 1))
                return false
            }
            if text == ". " && range.location == space && range.length == 1 {
                accept(replacing: NSRange(location: space, length: 1))
                return false
            }
            // iOS's period shortcut, first half: the space taken back. The
            // suggestion goes back to where it was, for the ". " to come.
            if text.isEmpty && range.location == space && range.length == 1 {
                pendingSpace = nil
                pendingPeriod = space
                current = InlineSuggestionNative(id: suggestion.id, at: space, text: suggestion.text)
                return true
            }
        }
        // A first space at the caret: the suggestion waits for a second.
        if text == " " && range.length == 0 && range.location == suggestion.at && pendingSpace == nil {
            pendingSpace = range.location
            current = InlineSuggestionNative(id: suggestion.id, at: suggestion.at + 1, text: suggestion.text)
            return true
        }
        current = nil
        pendingSpace = nil
        hide()
        return true
    }

    /// Put the suggestion where the caret is, or hide it if the caret is
    /// elsewhere.
    func layout() {
        guard let textView, let suggestion = current, textView.isEditing,
              textView.selectedRange.length == 0, textView.selectedRange.location == suggestion.at,
              let position = textView.position(from: textView.beginningOfDocument, offset: suggestion.at) else {
            hide()
            return
        }
        let text = textView.text as NSString
        let caret = textView.caretRect(for: position)
        let lineStart = text.lineRange(for: NSRange(location: min(suggestion.at, text.length), length: 0)).location
        let column0 = textView.position(from: textView.beginningOfDocument, offset: lineStart).map { textView.caretRect(for: $0).minX } ?? caret.minX
        let lines = suggestion.text.replacingOccurrences(of: "\t", with: "    ").components(separatedBy: "\n")
        let font = font()
        let height = max(caret.height, rowHeight())
        let first = CGRect(x: caret.maxX, y: caret.minY, width: width(of: lines[0], font: font), height: caret.height)
        var rest: [CGRect] = []
        for index in 1..<max(lines.count, 1) {
            rest.append(CGRect(x: column0, y: caret.minY + CGFloat(index) * height, width: width(of: lines[index], font: font), height: height))
        }
        let all = rest.reduce(first) { $0.union($1) }
        view.frame = all.insetBy(dx: -2, dy: 0)
        view.show(
            lines: lines,
            frames: [first] + rest,
            origin: view.frame.origin,
            font: font,
            color: ghostColor,
            backing: lines.count > 1 ? backing : nil,
            backingFrom: column0
        )
        if view.superview == nil {
            textView.addSubview(view)
            onViewsChanged()
        }
    }

    // MARK: - Internals

    private func width(of line: String, font: UIFont) -> CGFloat {
        ceil((line as NSString).size(withAttributes: [.font: font]).width)
    }

    private func hide() {
        guard view.superview != nil else {
            return
        }
        view.removeFromSuperview()
        onViewsChanged()
    }

    /// Insert the suggestion at its place (over `replacing`, when given: the
    /// first of the two spaces), and report it taken.
    private func accept(replacing: NSRange?) {
        guard let textView, let suggestion = current else {
            return
        }
        let range = replacing ?? NSRange(location: suggestion.at, length: 0)
        guard let from = textView.position(from: textView.beginningOfDocument, offset: range.location),
              let to = textView.position(from: from, offset: range.length),
              let textRange = textView.textRange(from: from, to: to) else {
            return
        }
        current = nil
        pendingSpace = nil
        pendingPeriod = nil
        hide()
        isAccepting = true
        textView.replace(textRange, withText: suggestion.text)
        isAccepting = false
        onAccept(suggestion.id)
    }
}

/// The ghost text, tappable: its lines, and a backing behind any after the
/// first.
private final class SuggestionView: UIControl {
    private var labels: [UILabel] = []
    private let backingView = UIView()

    init() {
        super.init(frame: .zero)
        backingView.isUserInteractionEnabled = false
        addSubview(backingView)
        accessibilityLabel = "Suggestion. Double-tap to accept."
        accessibilityTraits = .button
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func show(lines: [String], frames: [CGRect], origin: CGPoint, font: UIFont, color: UIColor, backing: UIColor?, backingFrom: CGFloat) {
        while labels.count < lines.count {
            let label = UILabel()
            label.isUserInteractionEnabled = false
            addSubview(label)
            labels.append(label)
        }
        for (index, label) in labels.enumerated() {
            guard index < lines.count, index < frames.count else {
                label.isHidden = true
                continue
            }
            label.isHidden = false
            label.text = lines[index]
            label.font = font
            label.textColor = color
            label.frame = frames[index].offsetBy(dx: -origin.x, dy: -origin.y)
        }
        if let backing, frames.count > 1 {
            backingView.isHidden = false
            backingView.backgroundColor = backing.withAlphaComponent(0.94)
            let below = frames.dropFirst().reduce(frames[1]) { $0.union($1) }
            backingView.frame = CGRect(x: backingFrom - origin.x - 2, y: below.minY - origin.y, width: below.maxX - backingFrom + 4, height: below.height)
            backingView.layer.cornerRadius = 4
        } else {
            backingView.isHidden = true
        }
    }

    /// A tap here takes the suggestion, not the editor's caret.
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        tapBelongsHere(gestureRecognizer, self)
    }
}
