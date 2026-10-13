import UIKit

/// One change an agent made, from JS (changeMarks.ts): lines `[from, to)` of
/// the text it added or changed, or the point between lines where it deleted
/// some; the session that made it, and when it landed.
struct ChangeMarkNative: Decodable {
    enum Kind: String, Decodable {
        case added
        case modified
        case deleted
    }

    let kind: Kind
    var from: Int
    var to: Int
    let sessionID: String?
    let title: String?
    /// Milliseconds since 1970.
    let at: Double
}

/// Marks the lines agents changed in the gutter, the way VS Code marks
/// source-control changes: a stripe beside added and changed lines, a wedge
/// where lines were deleted. A tap on the gutter beside a mark opens a glass
/// popover naming the session, with a button to open it. Marks move with
/// the text and stay until the file is closed. Colours are the theme's
/// (changeColors.ts on the JS side).
final class ChangeMarks {
    /// The theme's colours for changes.
    struct Colors {
        var added = UIColor(red: 0.28, green: 0.49, blue: 0.01, alpha: 1)
        var modified = UIColor(red: 0.11, green: 0.51, blue: 0.66, alpha: 1)
        var deleted = UIColor(red: 0.95, green: 0.3, blue: 0.3, alpha: 1)
        /// The popover button's label.
        var label = UIColor.white
        /// Whether the theme is light: the glass takes the theme's
        /// appearance, not the phone's.
        var light = false

        func of(_ kind: ChangeMarkNative.Kind) -> UIColor {
            switch kind {
            case .added: added
            case .modified: modified
            case .deleted: deleted
            }
        }
    }

    var colors = Colors() {
        didSet {
            for mark in marks {
                mark.view.color = colors.of(mark.mark.kind)
            }
            if let shown = popover {
                closePopover()
                open(shown.mark)
            }
        }
    }
    var rowHeight: () -> CGFloat = { 17 }
    var onOpenSession: (String) -> Void = { _ in }
    /// The marks' views changed: the editor keeps them above the gutter.
    var onViewsChanged: () -> Void = {}

    /// Every view on screen for the marks.
    var views: [UIView] {
        marks.map(\.view) + (popover.map { [$0.view] } ?? [])
    }

    private static let stripeWidth: CGFloat = 3
    /// The stripe's distance from the gutter's code-side edge.
    private static let stripeInset: CGFloat = 5
    private static let wedgeWidth: CGFloat = 6
    private static let wedgeHeight: CGFloat = 10
    private static let popoverWidth: CGFloat = 260
    private static let popoverPadding: CGFloat = 12
    private static let popoverRadius: CGFloat = 18
    private static let buttonHeight: CGFloat = 34

    /// One mark and what shows it.
    private final class Mark {
        var mark: ChangeMarkNative
        let view: MarkView

        init(mark: ChangeMarkNative, view: MarkView) {
            self.mark = mark
            self.view = view
        }
    }

    /// The open popover, and the mark it is for.
    private struct Popover {
        let mark: Mark
        let view: UIView
    }

    private weak var textView: TextView?
    private var marks: [Mark] = []
    private var popover: Popover?

    init(textView: TextView) {
        self.textView = textView
    }

    /// Mark lines an agent just changed. A newer mark over the same lines
    /// takes the place of an older one there.
    func add(_ new: [ChangeMarkNative]) {
        guard !new.isEmpty else {
            return
        }
        let covered = marks.filter { old in
            new.contains { mark in
                old.mark.kind == .deleted && mark.kind == .deleted
                    ? old.mark.from == mark.from
                    : old.mark.kind != .deleted && mark.kind != .deleted && mark.from <= old.mark.from && old.mark.to <= mark.to
            }
        }
        if let shown = popover, covered.contains(where: { $0 === shown.mark }) {
            closePopover()
        }
        covered.forEach { $0.view.removeFromSuperview() }
        marks.removeAll { mark in covered.contains { $0 === mark } }
        for mark in new {
            let view = MarkView(kind: mark.kind, color: colors.of(mark.kind))
            let entry = Mark(mark: mark, view: view)
            view.addAction(UIAction { [weak self, weak entry] _ in
                guard let self, let entry else {
                    return
                }
                self.toggle(entry)
            }, for: .touchUpInside)
            textView?.addSubview(view)
            marks.append(entry)
        }
        onViewsChanged()
        layout()
    }

    /// Forget every mark (the text was replaced as a whole).
    func clear() {
        closePopover()
        marks.forEach { $0.view.removeFromSuperview() }
        marks = []
        onViewsChanged()
    }

    /// The text is about to change at `range` (typing, or an outside change
    /// applied in place): move the marks with their lines. A mark whose
    /// lines are deleted outright goes.
    func textWillChange(in range: NSRange, replacementLength: Int) {
        let delta = replacementLength - range.length
        let end = range.location + range.length
        var gone: [Mark] = []
        for entry in marks {
            var moved = entry.mark
            if end <= moved.from && !(range.length == 0 && range.location == moved.from && moved.kind != .deleted) {
                // Before the mark: it moves along.
                moved.from += delta
                moved.to += delta
            } else if range.location > moved.to || (range.length == 0 && range.location == moved.to) {
                // After it, or typed at its end: nothing moves.
            } else if range.length > 0 && range.location <= moved.from && end >= moved.to && moved.kind != .deleted && replacementLength == 0 {
                gone.append(entry)
                continue
            } else {
                // Inside, across, or at its start: it grows or shrinks.
                moved.from = min(moved.from, range.location)
                moved.to = max(moved.from, moved.to + delta)
            }
            entry.mark = moved
        }
        if !gone.isEmpty {
            if let shown = popover, gone.contains(where: { $0 === shown.mark }) {
                closePopover()
            }
            gone.forEach { $0.view.removeFromSuperview() }
            marks.removeAll { mark in gone.contains { $0 === mark } }
            onViewsChanged()
        }
    }

    /// Put each mark beside its lines, and the popover under its mark.
    func layout() {
        guard let textView else {
            return
        }
        let x = textView.contentOffset.x
        let gutter = textView.gutterWidth
        let length = (textView.text as NSString).length
        for entry in marks {
            guard let span = span(of: entry.mark, length: length) else {
                entry.view.isHidden = true
                continue
            }
            entry.view.isHidden = false
            if entry.mark.kind == .deleted {
                let height = rowHeight()
                entry.view.frame = CGRect(x: x, y: span.top - height / 2, width: gutter, height: height)
                entry.view.marker = CGRect(
                    x: gutter - Self.stripeInset - Self.wedgeWidth + Self.stripeWidth,
                    y: (height - Self.wedgeHeight) / 2,
                    width: Self.wedgeWidth,
                    height: Self.wedgeHeight
                )
            } else {
                entry.view.frame = CGRect(x: x, y: span.top, width: gutter, height: max(span.bottom - span.top, 1))
                entry.view.marker = CGRect(x: gutter - Self.stripeInset - Self.stripeWidth, y: 0, width: Self.stripeWidth, height: entry.view.frame.height)
            }
        }
        if let shown = popover {
            place(shown)
        }
    }

    /// Keep the marks in the gutter as the code scrolls sideways.
    func followHorizontalScroll() {
        guard let textView else {
            return
        }
        let x = textView.contentOffset.x
        for entry in marks {
            entry.view.frame.origin.x = x
        }
        if let shown = popover {
            place(shown)
        }
    }

    /// Close the popover unless the tap at `point` (in the editor) was on it
    /// or on a mark.
    func tapped(at point: CGPoint) {
        guard let shown = popover, !shown.view.frame.contains(point), !marks.contains(where: { !$0.view.isHidden && $0.view.frame.contains(point) }) else {
            return
        }
        closePopover()
    }

    // MARK: - Internals

    /// The mark's lines, top to bottom in the editor; for a deletion, `top`
    /// is the boundary between the lines.
    private func span(of mark: ChangeMarkNative, length: Int) -> (top: CGFloat, bottom: CGFloat)? {
        guard let textView else {
            return nil
        }
        if mark.kind == .deleted && mark.from >= length {
            // Deleted at the end: under the last line.
            guard let row = textView.row(containing: max(0, length - 1)) ?? textView.row(containing: 0),
                  let frame = textView.lineFrame(ofLine: row) else {
                return nil
            }
            let bottom = frame.top + frame.height - frame.insets.below
            return (bottom, bottom)
        }
        guard let first = textView.row(containing: mark.from),
              let last = textView.row(containing: max(mark.from, mark.to)),
              let top = textView.lineFrame(ofLine: first),
              let bottom = textView.lineFrame(ofLine: last) else {
            return nil
        }
        let topY = top.top + top.insets.above
        return (topY, mark.kind == .deleted ? topY : bottom.top + bottom.height - bottom.insets.below)
    }

    private func toggle(_ entry: Mark) {
        if popover?.mark === entry {
            closePopover()
        } else {
            open(entry)
        }
    }

    private func open(_ entry: Mark) {
        closePopover()
        let view = makePopover(for: entry.mark)
        textView?.addSubview(view)
        let shown = Popover(mark: entry, view: view)
        popover = shown
        place(shown)
        onViewsChanged()
        view.alpha = 0
        view.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
            view.alpha = 1
            view.transform = .identity
        }
    }

    private func closePopover() {
        guard let shown = popover else {
            return
        }
        popover = nil
        onViewsChanged()
        UIView.animate(withDuration: 0.15, animations: {
            shown.view.alpha = 0
        }, completion: { _ in
            shown.view.removeFromSuperview()
        })
    }

    /// Under the mark's lines, or above them where there is no room below.
    private func place(_ shown: Popover) {
        guard let textView, let span = span(of: shown.mark.mark, length: (textView.text as NSString).length) else {
            shown.view.isHidden = true
            return
        }
        shown.view.isHidden = false
        let left = textView.contentOffset.x + textView.gutterWidth - Self.stripeInset
        let width = min(Self.popoverWidth, textView.bounds.width - (left - textView.contentOffset.x) - 12)
        let size = shown.view.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - textView.adjustedContentInset.bottom
        let below = span.bottom + 6
        let y = below + size.height > visibleBottom ? span.top - 6 - size.height : below
        let transform = shown.view.transform
        shown.view.transform = .identity
        shown.view.frame = CGRect(x: left, y: y, width: width, height: size.height)
        shown.view.transform = transform
    }

    private func makePopover(for mark: ChangeMarkNative) -> UIView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) {
            effect = UIGlassEffect(style: .regular)
        } else {
            effect = UIBlurEffect(style: .systemThinMaterial)
        }
        let glass = PopoverView(effect: effect)
        glass.overrideUserInterfaceStyle = colors.light ? .light : .dark
        roundCorners(of: glass, radius: Self.popoverRadius)

        let tint = colors.of(mark.kind)
        let bar = UIView()
        bar.backgroundColor = tint
        bar.layer.cornerRadius = Self.stripeWidth / 2
        bar.translatesAutoresizingMaskIntoConstraints = false

        let who = UILabel()
        who.numberOfLines = 2
        who.attributedText = Self.who(mark)
        who.textColor = .label
        who.translatesAutoresizingMaskIntoConstraints = false

        let when = UILabel()
        when.text = Self.when(mark)
        when.font = UIFont.systemFont(ofSize: 12)
        when.textColor = .secondaryLabel
        when.translatesAutoresizingMaskIntoConstraints = false

        let content = glass.contentView
        [bar, who, when].forEach(content.addSubview)
        let padding = Self.popoverPadding
        var constraints = [
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: padding),
            bar.topAnchor.constraint(equalTo: who.topAnchor, constant: 2),
            bar.bottomAnchor.constraint(equalTo: who.bottomAnchor, constant: -2),
            bar.widthAnchor.constraint(equalToConstant: Self.stripeWidth),
            who.leadingAnchor.constraint(equalTo: bar.trailingAnchor, constant: 8),
            who.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -padding),
            who.topAnchor.constraint(equalTo: content.topAnchor, constant: padding),
            when.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: padding),
        ]
        if let sessionID = mark.sessionID {
            let button = GlassButton(title: "Open session", tint: tint, label: colors.label, cornerRadius: Self.buttonHeight / 2) { [weak self] in
                self?.closePopover()
                self?.onOpenSession(sessionID)
            }
            button.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(button)
            constraints += [
                button.topAnchor.constraint(equalTo: who.bottomAnchor, constant: 10),
                button.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -padding),
                button.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -padding),
                button.heightAnchor.constraint(equalToConstant: Self.buttonHeight),
                button.widthAnchor.constraint(equalToConstant: 128),
                when.centerYAnchor.constraint(equalTo: button.centerYAnchor),
                when.trailingAnchor.constraint(lessThanOrEqualTo: button.leadingAnchor, constant: -8),
            ]
        } else {
            constraints += [
                when.topAnchor.constraint(equalTo: who.bottomAnchor, constant: 6),
                when.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -padding),
                when.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -padding),
            ]
        }
        NSLayoutConstraint.activate(constraints)
        return glass
    }

    /// "Edited by <session>", the session's title in bold.
    private static func who(_ mark: ChangeMarkNative) -> NSAttributedString {
        let text = NSMutableAttributedString(string: mark.kind == .deleted ? "Deleted by " : "Edited by ", attributes: [.font: UIFont.systemFont(ofSize: 14)])
        let name = mark.title.map { $0.isEmpty ? nil : $0 } ?? nil
        text.append(NSAttributedString(string: name ?? "an agent", attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .semibold)]))
        return text
    }

    /// How long ago it landed: "just now", "2 min. ago".
    private static func when(_ mark: ChangeMarkNative) -> String {
        let date = Date(timeIntervalSince1970: mark.at / 1000)
        if Date().timeIntervalSince(date) < 60 {
            return "just now"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

/// The tap area beside a mark's lines (the gutter's width), with the stripe
/// or wedge drawn in it.
private final class MarkView: UIControl {
    private let kind: ChangeMarkNative.Kind
    private let shape = CAShapeLayer()

    var color: UIColor {
        didSet {
            shape.fillColor = color.cgColor
        }
    }

    /// Where the stripe or wedge is drawn, in this view.
    var marker: CGRect = .zero {
        didSet {
            guard marker != oldValue else {
                return
            }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            shape.path = path(in: marker)
            CATransaction.commit()
        }
    }

    init(kind: ChangeMarkNative.Kind, color: UIColor) {
        self.kind = kind
        self.color = color
        super.init(frame: .zero)
        shape.fillColor = color.cgColor
        layer.addSublayer(shape)
        accessibilityLabel = kind == .deleted ? "Deleted lines" : kind == .added ? "Added lines" : "Changed lines"
        accessibilityTraits = .button
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    private func path(in rect: CGRect) -> CGPath {
        guard kind == .deleted else {
            return UIBezierPath(roundedRect: rect, cornerRadius: rect.width / 2).cgPath
        }
        // A wedge pointing at the code, between the two lines.
        let path = UIBezierPath()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.close()
        return path.cgPath
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        tapBelongsHere(gestureRecognizer, self)
    }
}

/// The popover's glass: taps on it are its own, not the editor's.
private final class PopoverView: UIVisualEffectView {
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        tapBelongsHere(gestureRecognizer, self)
    }
}
