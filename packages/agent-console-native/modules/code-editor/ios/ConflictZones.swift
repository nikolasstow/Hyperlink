import UIKit

/// One conflict from JS: `[from, to)` of the text holds the agent's lines
/// (theirs); `mine` is what the user's edit made of the same lines, with its
/// Shiki tokens per line when JS has them.
struct ConflictNative: Decodable {
    var from: Int
    var to: Int
    let mine: String
    let mineTokens: [[ShikiToken]]?
}

/// Draws conflicts inside the document, like a merge editor sized for a
/// phone: the user's lines in space opened above the agent's, the agent's
/// lines (the real text) tinted, and a glass panel with two glass buttons —
/// Mine and Theirs — in space opened below them. Colours come from the theme
/// (VS Code's merge colours). The space comes from Runestone line insets, so
/// the lines below move down to make room and it all scrolls with the code.
final class ConflictZones {
    /// Keep mine or keep theirs.
    enum Choice: String {
        case mine = "Mine"
        case theirs = "Theirs"
    }

    /// The theme's merge colours.
    struct Colors {
        /// Behind the user's lines, and behind the agent's.
        var mineLines = UIColor.systemGreen.withAlphaComponent(0.16)
        var theirsLines = UIColor.systemBlue.withAlphaComponent(0.16)
        /// The Mine and Theirs buttons' tints.
        var mineButton = UIColor.systemGreen
        var theirsButton = UIColor.systemBlue
        /// The panel holding the buttons.
        var panel = UIColor.secondarySystemBackground
        /// Button labels: the editor's background on a light tint, its
        /// foreground on a dark one.
        var editorBackground = UIColor.black
        var editorForeground = UIColor.white
    }

    /// Set when the theme changes; redraws the conflicts in the new colours.
    var colors = Colors() {
        didSet {
            set(conflicts)
        }
    }

    var rowHeight: () -> CGFloat = { 17 }
    var styledLine: (String, [ShikiToken]) -> NSAttributedString = { text, _ in NSAttributedString(string: text) }
    var onChoice: (Int, Choice) -> Void = { _, _ in }

    private static let buttonHeight: CGFloat = 40
    private static let buttonSpacing: CGFloat = 6
    /// Room between the panel's edge and its buttons.
    private static let panelPadding: CGFloat = 6
    private static let panelRadius: CGFloat = 16
    /// Room around the panel inside the space below the agent's lines.
    private static let actionsPadding = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
    private static var panelHeight: CGFloat {
        buttonHeight + panelPadding * 2
    }

    private final class Zone {
        let mine = UIView()
        let mineLabel = UILabel()
        let theirs = UIView()
        let actions: UIVisualEffectView
        let buttons = UIStackView()

        init(panel: UIVisualEffectView) {
            actions = panel
        }
    }

    private weak var textView: TextView?
    private var conflicts: [ConflictNative] = []
    private var zones: [Zone] = []

    init(textView: TextView) {
        self.textView = textView
    }

    func set(_ conflicts: [ConflictNative]) {
        self.conflicts = conflicts
        for zone in zones {
            zone.mine.removeFromSuperview()
            zone.theirs.removeFromSuperview()
            zone.actions.removeFromSuperview()
        }
        zones = conflicts.enumerated().map { makeZone(index: $0.offset, conflict: $0.element) }
        // Over the gutter too: the colours run the full width and the buttons
        // sit clear of the line numbers. The tints are see-through, so the
        // agent's line numbers still show.
        textView?.viewsAboveGutter = zones.flatMap { [$0.mine, $0.theirs, $0.actions] }
        textView?.setNeedsLayout()
        layout()
    }

    /// Open the space for every conflict and put its views in it. Called when
    /// the conflicts, the text, the size or the font change.
    func layout() {
        guard let textView else {
            return
        }
        let rows = conflicts.map { conflict -> (first: Int, last: Int)? in
            guard let first = textView.row(containing: conflict.from), let last = textView.row(containing: max(conflict.from, conflict.to)) else {
                return nil
            }
            return (first, last)
        }
        var insets: [Int: LineInsets] = [:]
        for (conflict, span) in zip(conflicts, rows) {
            guard let span else {
                continue
            }
            insets[span.first, default: .zero].above = mineHeight(conflict)
            insets[span.last, default: .zero].below = Self.panelHeight + Self.actionsPadding.top + Self.actionsPadding.bottom
        }
        textView.lineInsets = insets

        let width = textView.bounds.width
        let x = textView.contentOffset.x
        for (zone, span) in zip(zones, rows) {
            guard let span, let first = textView.lineFrame(ofLine: span.first), let last = textView.lineFrame(ofLine: span.last) else {
                zone.mine.isHidden = true
                zone.theirs.isHidden = true
                zone.actions.isHidden = true
                continue
            }
            zone.mine.isHidden = false
            zone.theirs.isHidden = false
            zone.actions.isHidden = false
            zone.mine.frame = CGRect(x: x, y: first.top, width: width, height: first.insets.above)
            let textX = textView.gutterWidth + textView.textContainerInset.left
            zone.mineLabel.frame = CGRect(
                x: textX,
                y: 0,
                width: max(0, width - textX),
                height: first.insets.above
            )
            let theirsTop = first.top + first.insets.above
            let theirsBottom = last.top + last.height - last.insets.below
            zone.theirs.frame = CGRect(x: x, y: theirsTop, width: width, height: max(0, theirsBottom - theirsTop))
            zone.actions.frame = CGRect(
                x: x + Self.actionsPadding.left,
                y: theirsBottom + Self.actionsPadding.top,
                width: max(0, width - Self.actionsPadding.left - Self.actionsPadding.right),
                height: Self.panelHeight
            )
            zone.buttons.frame = zone.actions.bounds.insetBy(dx: Self.panelPadding, dy: Self.panelPadding)
        }
    }

    /// The text is about to change at `range` (typing, or an outside change
    /// applied in place): move the conflicts with their lines, so the zones stay
    /// put until JS sends the conflicts again.
    func textWillChange(in range: NSRange, replacementLength: Int) {
        let delta = replacementLength - range.length
        let end = range.location + range.length
        conflicts = conflicts.map { conflict in
            var moved = conflict
            if end <= conflict.from {
                // Before the conflict (or inserted right at its start).
                moved.from += delta
                moved.to += delta
            } else if range.location > conflict.to {
                // After it: nothing moves.
            } else {
                // Inside, across, or at the end of it: it grows or shrinks.
                moved.from = min(conflict.from, range.location)
                moved.to = max(moved.from, conflict.to + delta)
            }
            return moved
        }
    }

    /// Keep the zones across the screen as the code scrolls sideways.
    func followHorizontalScroll() {
        guard let textView else {
            return
        }
        let x = textView.contentOffset.x
        for zone in zones {
            zone.mine.frame.origin.x = x
            zone.theirs.frame.origin.x = x
            zone.actions.frame.origin.x = x + Self.actionsPadding.left
        }
    }

    private func mineLines(_ conflict: ConflictNative) -> [String] {
        conflict.mine.components(separatedBy: "\n")
    }

    private func mineHeight(_ conflict: ConflictNative) -> CGFloat {
        CGFloat(mineLines(conflict).count) * rowHeight()
    }

    private func makeZone(index: Int, conflict: ConflictNative) -> Zone {
        let zone = Zone(panel: panel())
        zone.mine.backgroundColor = colors.mineLines
        zone.mine.isUserInteractionEnabled = false
        zone.mineLabel.numberOfLines = 0
        zone.mineLabel.lineBreakMode = .byClipping
        zone.mineLabel.attributedText = mineText(conflict)
        zone.mine.addSubview(zone.mineLabel)

        zone.theirs.backgroundColor = colors.theirsLines
        zone.theirs.isUserInteractionEnabled = false

        zone.buttons.axis = .horizontal
        zone.buttons.spacing = Self.buttonSpacing
        zone.buttons.distribution = .fillEqually
        zone.buttons.addArrangedSubview(button(title: "Mine", tint: colors.mineButton) { [weak self] in self?.onChoice(index, .mine) })
        zone.buttons.addArrangedSubview(button(title: "Theirs", tint: colors.theirsButton) { [weak self] in self?.onChoice(index, .theirs) })
        zone.actions.contentView.addSubview(zone.buttons)

        textView?.addSubview(zone.mine)
        textView?.addSubview(zone.theirs)
        textView?.addSubview(zone.actions)
        return zone
    }

    /// The glass rectangle holding the buttons, tinted with the theme.
    private func panel() -> UIVisualEffectView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.tintColor = colors.panel
            effect = glass
        } else {
            effect = UIBlurEffect(style: .systemThinMaterial)
        }
        let view = UIVisualEffectView(effect: effect)
        view.layer.cornerRadius = Self.panelRadius
        view.layer.cornerCurve = .continuous
        view.clipsToBounds = true
        return view
    }

    /// A glass button tinted with the theme's colour for its side.
    private func button(title: String, tint: UIColor, action: @escaping () -> Void) -> UIControl {
        GlassButton(title: title, tint: tint, label: labelColor(on: tint), cornerRadius: Self.panelRadius - Self.panelPadding, action: action)
    }

    /// Whichever of the editor's two text colours reads on `tint`.
    private func labelColor(on tint: UIColor) -> UIColor {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard tint.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return colors.editorForeground
        }
        let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
        return luminance > 0.55 ? colors.editorBackground : colors.editorForeground
    }

    /// The user's lines, styled like the code: same font, Shiki colours when
    /// JS sent tokens, one row per line at the editor's row height.
    private func mineText(_ conflict: ConflictNative) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = rowHeight()
        paragraph.maximumLineHeight = rowHeight()
        let text = NSMutableAttributedString()
        for (index, line) in mineLines(conflict).enumerated() {
            if index > 0 {
                text.append(NSAttributedString(string: "\n"))
            }
            text.append(styledLine(line, conflict.mineTokens?[safe: index] ?? []))
        }
        text.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: text.length))
        return text
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// A button made of tinted, interactive glass with a plain label on top. UIKit's
/// glass button configurations restyle their label (vibrancy) whatever colour
/// it is given; this keeps the label exactly the theme's colour.
private final class GlassButton: UIControl {
    private let action: () -> Void
    private let body: UIVisualEffectView
    private let label = UILabel()

    init(title: String, tint: UIColor, label labelColor: UIColor, cornerRadius: CGFloat, action: @escaping () -> Void) {
        self.action = action
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.tintColor = tint
            glass.isInteractive = true
            body = UIVisualEffectView(effect: glass)
        } else {
            body = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
            body.contentView.backgroundColor = tint
        }
        super.init(frame: .zero)
        body.isUserInteractionEnabled = false
        body.layer.cornerRadius = cornerRadius
        body.layer.cornerCurve = .continuous
        body.clipsToBounds = true
        addSubview(body)
        label.text = title
        label.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        label.textColor = labelColor
        label.textAlignment = .center
        addSubview(label)
        accessibilityLabel = title
        accessibilityTraits = .button
        isAccessibilityElement = true
        addAction(UIAction { [weak self] _ in self?.action() }, for: .touchUpInside)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        body.frame = bounds
        label.frame = bounds
    }

    override var isHighlighted: Bool {
        didSet {
            alpha = isHighlighted ? 0.7 : 1
        }
    }
}
