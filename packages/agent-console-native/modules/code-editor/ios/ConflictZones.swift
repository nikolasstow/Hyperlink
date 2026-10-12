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

/// Draws conflicts inside the document, like VS Code's inline merge, sized
/// for a phone: the user's lines in space opened above the agent's, the
/// agent's lines (the real text) tinted, and a glass panel with Mine and
/// Theirs in space opened below them. Colours are the theme's (mergeColors.ts
/// on the JS side). The space comes from Runestone line insets, so the lines
/// below move down to make room and it all scrolls with the code.
///
/// A conflict opens by growing its space, pushing the lines below down, and
/// closes the same way back up; a choice is sent once its conflict has closed.
final class ConflictZones {
    /// Keep mine or keep theirs.
    enum Choice: String {
        case mine = "Mine"
        case theirs = "Theirs"
    }

    /// The theme's colours for conflicts.
    struct Colors {
        /// Behind the user's lines, and behind the agent's.
        var mineLines = UIColor(red: 0.25, green: 0.78, blue: 0.68, alpha: 0.2)
        var theirsLines = UIColor(red: 0.25, green: 0.65, blue: 1, alpha: 0.2)
        /// The Mine and Theirs buttons.
        var mineButton = UIColor(red: 0.25, green: 0.78, blue: 0.68, alpha: 0.5)
        var theirsButton = UIColor(red: 0.25, green: 0.65, blue: 1, alpha: 0.5)
        /// The panel holding the buttons, and its edge.
        var panel = UIColor.secondarySystemBackground
        var panelBorder = UIColor.separator
        /// The buttons' labels.
        var label = UIColor.label
    }

    var rowHeight: () -> CGFloat = { 17 }
    var styledLine: (String, [ShikiToken]) -> NSAttributedString = { text, _ in NSAttributedString(string: text) }
    var onChoice: (Int, Choice) -> Void = { _, _ in }

    /// Set when the theme changes; the conflicts take the new colours.
    var colors = Colors() {
        didSet {
            for zone in zones {
                zone.views.removeFromSuperview()
                zone.views = makeViews(for: zone)
            }
            textView?.viewsAboveGutter = zones.flatMap(\.views.all)
            layout()
        }
    }

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
    private static var belowHeight: CGFloat {
        panelHeight + actionsPadding.top + actionsPadding.bottom
    }
    /// How long a conflict takes to open or close.
    private static let duration: CFTimeInterval = 0.28

    /// What is on screen for one conflict.
    private final class Views {
        let mine = UIView()
        let mineLabel = UILabel()
        let theirs = UIView()
        /// Clips the panel to the space below as it opens and closes.
        let below = UIView()
        let panel: UIVisualEffectView

        init(panel: UIVisualEffectView) {
            self.panel = panel
        }

        var all: [UIView] {
            [mine, theirs, below]
        }

        func removeFromSuperview() {
            all.forEach { $0.removeFromSuperview() }
        }
    }

    /// One conflict, as long as it is on screen: opening, open, or closing.
    private final class Zone {
        /// Which conflict this is across updates from JS (its positions move).
        let key: String
        var conflict: ConflictNative
        var views: Views!
        /// 0 closed, 1 open; `target` is where it is heading.
        var progress: CGFloat = 0
        var target: CGFloat = 1
        /// Tapped: sent once closed.
        var choice: Choice?

        init(key: String, conflict: ConflictNative) {
            self.key = key
            self.conflict = conflict
        }
    }

    private weak var textView: TextView?
    private var zones: [Zone] = []
    /// The keys of the conflicts JS sent last, in its order (a choice names its
    /// index there).
    private var order: [String] = []
    private var displayLink: CADisplayLink?
    private var lastFrame: CFTimeInterval = 0

    init(textView: TextView) {
        self.textView = textView
    }

    /// The conflicts JS has now. New ones open; ones no longer listed close.
    func set(_ conflicts: [ConflictNative]) {
        var seen: [String: Int] = [:]
        let keyed = conflicts.map { conflict -> (String, ConflictNative) in
            let count = seen[conflict.mine, default: 0]
            seen[conflict.mine] = count + 1
            return ("\(count)|\(conflict.mine)", conflict)
        }
        order = keyed.map(\.0)
        for zone in zones where !order.contains(zone.key) {
            zone.target = 0
        }
        for (key, conflict) in keyed {
            if let zone = zones.first(where: { $0.key == key }) {
                zone.conflict = conflict
                if zone.choice == nil {
                    zone.target = 1
                }
            } else {
                let zone = Zone(key: key, conflict: conflict)
                zone.views = makeViews(for: zone)
                zones.append(zone)
            }
        }
        textView?.viewsAboveGutter = zones.flatMap(\.views.all)
        textView?.setNeedsLayout()
        layout()
        animateIfNeeded()
    }

    /// The text is about to change at `range` (typing, or an outside change
    /// applied in place): move the conflicts with their lines, so the zones
    /// stay put until JS sends the conflicts again.
    func textWillChange(in range: NSRange, replacementLength: Int) {
        let delta = replacementLength - range.length
        let end = range.location + range.length
        for zone in zones {
            var moved = zone.conflict
            if end <= moved.from {
                // Before the conflict (or inserted right at its start).
                moved.from += delta
                moved.to += delta
            } else if range.location > moved.to {
                // After it: nothing moves.
            } else {
                // Inside, across, or at the end of it: it grows or shrinks.
                moved.from = min(moved.from, range.location)
                moved.to = max(moved.from, moved.to + delta)
            }
            zone.conflict = moved
        }
    }

    /// Open the space for every conflict, as far as each is open, and put its
    /// views in it. Called when the conflicts, the text, the size, the font or
    /// an animation frame change.
    func layout() {
        guard let textView else {
            return
        }
        let rows = zones.map { zone -> (first: Int, last: Int)? in
            guard let first = textView.row(containing: zone.conflict.from),
                  let last = textView.row(containing: max(zone.conflict.from, zone.conflict.to)) else {
                return nil
            }
            return (first, last)
        }
        var insets: [Int: LineInsets] = [:]
        for (zone, span) in zip(zones, rows) {
            guard let span else {
                continue
            }
            let open = Self.eased(zone.progress)
            insets[span.first, default: .zero].above += (mineHeight(zone.conflict) * open).rounded()
            insets[span.last, default: .zero].below += (Self.belowHeight * open).rounded()
        }
        textView.lineInsets = insets.filter { $0.value != .zero }

        let width = textView.bounds.width
        let x = textView.contentOffset.x
        let textX = textView.gutterWidth + textView.textContainerInset.left
        for (zone, span) in zip(zones, rows) {
            let views = zone.views!
            guard let span, let first = textView.lineFrame(ofLine: span.first), let last = textView.lineFrame(ofLine: span.last) else {
                views.all.forEach { $0.isHidden = true }
                continue
            }
            views.all.forEach { $0.isHidden = zone.progress == 0 }
            let open = Self.eased(zone.progress)
            views.mine.frame = CGRect(x: x, y: first.top, width: width, height: first.insets.above)
            views.mineLabel.frame = CGRect(x: textX, y: 0, width: max(0, width - textX), height: mineHeight(zone.conflict))
            let theirsTop = first.top + first.insets.above
            let theirsBottom = last.top + last.height - last.insets.below
            views.theirs.frame = CGRect(x: x, y: theirsTop, width: width, height: max(0, theirsBottom - theirsTop))
            views.theirs.alpha = open
            views.below.frame = CGRect(x: x, y: theirsBottom, width: width, height: last.insets.below)
            views.panel.frame = CGRect(
                x: Self.actionsPadding.left,
                y: Self.actionsPadding.top,
                width: max(0, width - Self.actionsPadding.left - Self.actionsPadding.right),
                height: Self.panelHeight
            )
            views.panel.alpha = open
        }
    }

    /// Keep the zones across the screen as the code scrolls sideways.
    func followHorizontalScroll() {
        guard let textView else {
            return
        }
        let x = textView.contentOffset.x
        for zone in zones {
            zone.views.mine.frame.origin.x = x
            zone.views.theirs.frame.origin.x = x
            zone.views.below.frame.origin.x = x
        }
    }

    // MARK: - Opening and closing

    /// Ease in and out: slow at both ends, so the lines glide.
    private static func eased(_ progress: CGFloat) -> CGFloat {
        let t = min(max(progress, 0), 1)
        return t * t * (3 - 2 * t)
    }

    private func choose(_ zone: Zone, _ choice: Choice) {
        guard zone.choice == nil else {
            return
        }
        zone.choice = choice
        zone.target = 0
        zone.views.below.isUserInteractionEnabled = false
        animateIfNeeded()
    }

    private func animateIfNeeded() {
        guard displayLink == nil, zones.contains(where: { $0.progress != $0.target }) else {
            return
        }
        let link = CADisplayLink(target: DisplayLinkTarget { [weak self] link in self?.step(link) }, selector: #selector(DisplayLinkTarget.tick(_:)))
        lastFrame = CACurrentMediaTime()
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func step(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let advance = CGFloat((now - lastFrame) / Self.duration)
        lastFrame = now
        for zone in zones {
            if zone.progress < zone.target {
                zone.progress = min(zone.target, zone.progress + advance)
            } else if zone.progress > zone.target {
                zone.progress = max(zone.target, zone.progress - advance)
            }
        }
        layout()
        // Closed after a tap: send the choice.
        for zone in zones where zone.progress == 0 && zone.target == 0 {
            if let choice = zone.choice, let index = order.firstIndex(of: zone.key) {
                zone.choice = nil
                onChoice(index, choice)
            }
        }
        // Closed and no longer listed by JS: let go of it.
        let closed = zones.filter { $0.progress == 0 && $0.target == 0 && !order.contains($0.key) }
        if !closed.isEmpty {
            closed.forEach { $0.views.removeFromSuperview() }
            zones.removeAll { zone in closed.contains { $0 === zone } }
            textView?.viewsAboveGutter = zones.flatMap(\.views.all)
            layout()
        }
        if !zones.contains(where: { $0.progress != $0.target }) {
            link.invalidate()
            displayLink = nil
        }
    }

    // MARK: - Views

    private func mineLines(_ conflict: ConflictNative) -> [String] {
        conflict.mine.components(separatedBy: "\n")
    }

    private func mineHeight(_ conflict: ConflictNative) -> CGFloat {
        CGFloat(mineLines(conflict).count) * rowHeight()
    }

    private func makeViews(for zone: Zone) -> Views {
        let views = Views(panel: panel())
        views.mine.backgroundColor = colors.mineLines
        views.mine.isUserInteractionEnabled = false
        // Opening, the lines show from the top as the space grows.
        views.mine.clipsToBounds = true
        views.mineLabel.numberOfLines = 0
        views.mineLabel.lineBreakMode = .byClipping
        views.mineLabel.attributedText = mineText(zone.conflict)
        views.mine.addSubview(views.mineLabel)

        views.theirs.backgroundColor = colors.theirsLines
        views.theirs.isUserInteractionEnabled = false

        views.below.clipsToBounds = true
        let buttons = UIStackView()
        buttons.axis = .horizontal
        buttons.spacing = Self.buttonSpacing
        buttons.distribution = .fillEqually
        buttons.translatesAutoresizingMaskIntoConstraints = false
        buttons.addArrangedSubview(button(title: "Mine", tint: colors.mineButton) { [weak self, weak zone] in
            guard let self, let zone else {
                return
            }
            self.choose(zone, .mine)
        })
        buttons.addArrangedSubview(button(title: "Theirs", tint: colors.theirsButton) { [weak self, weak zone] in
            guard let self, let zone else {
                return
            }
            self.choose(zone, .theirs)
        })
        views.panel.contentView.addSubview(buttons)
        NSLayoutConstraint.activate([
            buttons.leadingAnchor.constraint(equalTo: views.panel.contentView.leadingAnchor, constant: Self.panelPadding),
            buttons.trailingAnchor.constraint(equalTo: views.panel.contentView.trailingAnchor, constant: -Self.panelPadding),
            buttons.topAnchor.constraint(equalTo: views.panel.contentView.topAnchor, constant: Self.panelPadding),
            buttons.bottomAnchor.constraint(equalTo: views.panel.contentView.bottomAnchor, constant: -Self.panelPadding),
        ])
        views.below.addSubview(views.panel)

        views.all.forEach { textView?.addSubview($0) }
        return views
    }

    /// The glass rectangle holding the buttons, in the theme's editor-widget
    /// colours.
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
        if #unavailable(iOS 26.0) {
            view.contentView.backgroundColor = colors.panel
        }
        view.layer.cornerRadius = Self.panelRadius
        view.layer.cornerCurve = .continuous
        view.layer.borderWidth = 1
        view.layer.borderColor = colors.panelBorder.cgColor
        view.clipsToBounds = true
        return view
    }

    /// A glass button tinted with the theme's colour for its side.
    private func button(title: String, tint: UIColor, action: @escaping () -> Void) -> UIControl {
        GlassButton(title: title, tint: tint, label: colors.label, cornerRadius: Self.panelRadius - Self.panelPadding, action: action)
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

/// CADisplayLink holds its target strongly; this keeps that from holding the
/// zones.
private final class DisplayLinkTarget {
    private let onTick: (CADisplayLink) -> Void

    init(_ onTick: @escaping (CADisplayLink) -> Void) {
        self.onTick = onTick
    }

    @objc func tick(_ link: CADisplayLink) {
        onTick(link)
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

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
