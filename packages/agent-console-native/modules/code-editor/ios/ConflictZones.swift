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
/// phone: the user's lines in space opened above the agent's (green), the
/// agent's lines (the real text) tinted blue, and a row of buttons in space
/// opened below them — Mine, Theirs, and Both as an icon. The space comes
/// from Runestone line insets, so the lines below move down to make room and
/// the whole thing scrolls with the code.
final class ConflictZones {
    /// Keep mine, keep theirs, or both (mine, then theirs).
    enum Choice: String {
        case mine = "Mine"
        case theirs = "Theirs"
        case both = "Both"
    }

    var rowHeight: () -> CGFloat = { 17 }
    var styledLine: (String, [ShikiToken]) -> NSAttributedString = { text, _ in NSAttributedString(string: text) }
    var onChoice: (Int, Choice) -> Void = { _, _ in }

    private static let mineColor = UIColor.systemGreen
    private static let theirsColor = UIColor.systemBlue
    private static let tintAlpha: CGFloat = 0.16
    /// Room above and below the user's lines inside their block.
    private static let minePadding: CGFloat = 4
    private static let buttonHeight: CGFloat = 44
    private static let buttonSpacing: CGFloat = 8
    /// Room around the button row inside its space.
    private static let actionsPadding = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)

    private final class Zone {
        let mine = UIView()
        let mineLabel = UILabel()
        let theirs = UIView()
        let actions = UIStackView()
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
            insets[span.last, default: .zero].below = Self.buttonHeight + Self.actionsPadding.top + Self.actionsPadding.bottom
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
                y: Self.minePadding,
                width: max(0, width - textX),
                height: max(0, first.insets.above - Self.minePadding * 2)
            )
            let theirsTop = first.top + first.insets.above
            let theirsBottom = last.top + last.height - last.insets.below
            zone.theirs.frame = CGRect(x: x, y: theirsTop, width: width, height: max(0, theirsBottom - theirsTop))
            zone.actions.frame = CGRect(
                x: x + Self.actionsPadding.left,
                y: theirsBottom + Self.actionsPadding.top,
                width: max(0, width - Self.actionsPadding.left - Self.actionsPadding.right),
                height: Self.buttonHeight
            )
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
        CGFloat(mineLines(conflict).count) * rowHeight() + Self.minePadding * 2
    }

    private func makeZone(index: Int, conflict: ConflictNative) -> Zone {
        let zone = Zone()
        zone.mine.backgroundColor = Self.mineColor.withAlphaComponent(Self.tintAlpha)
        zone.mine.isUserInteractionEnabled = false
        zone.mineLabel.numberOfLines = 0
        zone.mineLabel.lineBreakMode = .byClipping
        zone.mineLabel.attributedText = mineText(conflict)
        zone.mine.addSubview(zone.mineLabel)

        zone.theirs.backgroundColor = Self.theirsColor.withAlphaComponent(Self.tintAlpha)
        zone.theirs.isUserInteractionEnabled = false

        zone.actions.axis = .horizontal
        zone.actions.spacing = Self.buttonSpacing
        zone.actions.distribution = .fill
        let mine = button(title: "Mine", image: nil, color: Self.mineColor) { [weak self] in self?.onChoice(index, .mine) }
        let theirs = button(title: "Theirs", image: nil, color: Self.theirsColor) { [weak self] in self?.onChoice(index, .theirs) }
        let both = button(title: nil, image: UIImage(systemName: "arrow.triangle.merge"), color: .secondaryLabel) { [weak self] in
            self?.onChoice(index, .both)
        }
        // An icon only, for room; a long press says what it does.
        both.accessibilityLabel = "Keep both"
        both.menu = UIMenu(title: "Keep both: yours, then theirs", children: [
            UIAction(title: "Keep Both", image: UIImage(systemName: "arrow.triangle.merge")) { [weak self] _ in
                self?.onChoice(index, .both)
            },
        ])
        zone.actions.addArrangedSubview(mine)
        zone.actions.addArrangedSubview(theirs)
        zone.actions.addArrangedSubview(both)
        // In the same stack now, so their sizes can be tied together.
        both.widthAnchor.constraint(equalToConstant: Self.buttonHeight).isActive = true
        mine.widthAnchor.constraint(equalTo: theirs.widthAnchor).isActive = true

        textView?.addSubview(zone.mine)
        textView?.addSubview(zone.theirs)
        textView?.addSubview(zone.actions)
        return zone
    }

    private func button(title: String?, image: UIImage?, color: UIColor, action: @escaping () -> Void) -> UIButton {
        var configuration = UIButton.Configuration.tinted()
        configuration.baseForegroundColor = color
        configuration.baseBackgroundColor = color
        configuration.cornerStyle = .medium
        configuration.image = image
        if let title {
            var attributes = AttributeContainer()
            attributes.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
            configuration.attributedTitle = AttributedString(title, attributes: attributes)
        }
        return UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
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
