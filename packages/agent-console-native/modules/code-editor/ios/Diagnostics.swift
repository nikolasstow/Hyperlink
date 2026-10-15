import UIKit

/// One problem a language server found, from JS (agent-console-protocol
/// `Language.Diagnostic`): UTF-16 offsets `[start, end)` of the text.
struct DiagnosticNative: Decodable {
    enum Severity: String, Decodable {
        case error
        case warning
        case info
        case hint
    }

    var start: Int
    var end: Int
    let severity: Severity
    let message: String
    let source: String?
    let code: String?
}

/// Draws a file's problems the way VS Code does: a wavy line under each
/// range, in the theme's colour for its severity. A tap on one opens a glass
/// popover with its message. The lines move with the text as it is typed,
/// until the next problems come.
final class Diagnostics {
    /// The theme's colours for problems (`editorError.foreground`, …).
    struct Colors {
        var error = UIColor(red: 0.95, green: 0.3, blue: 0.3, alpha: 1)
        var warning = UIColor(red: 0.8, green: 0.65, blue: 0, alpha: 1)
        var info = UIColor(red: 0.22, green: 0.58, blue: 1, alpha: 1)
        var hint = UIColor(white: 0.6, alpha: 0.7)
        /// Whether the theme is light: the popover's glass takes it.
        var light = false

        func of(_ severity: DiagnosticNative.Severity) -> UIColor {
            switch severity {
            case .error: error
            case .warning: warning
            case .info: info
            case .hint: hint
            }
        }
    }

    var colors = Colors() {
        didSet {
            layout()
        }
    }
    /// The popover's view changed: the editor keeps it above the gutter.
    var onViewsChanged: () -> Void = {}

    /// The popover on screen, if one is open.
    var views: [UIView] {
        popover.map { [$0.view] } ?? []
    }

    private static let waveLength: CGFloat = 4
    private static let waveHeight: CGFloat = 1.5
    private static let lineWidth: CGFloat = 1.2
    private static let popoverWidth: CGFloat = 300
    private static let popoverPadding: CGFloat = 12
    private static let popoverRadius: CGFloat = 18
    /// How far from a squiggle a tap still counts as on it.
    private static let tapSlop: CGFloat = 6

    private struct Popover {
        let index: Int
        let view: UIView
    }

    private weak var textView: TextView?
    private var items: [DiagnosticNative] = []
    /// Behind the text: one layer per problem drawn now.
    private let canvas = UIView()
    /// Where each drawn problem's text is, for taps.
    private var drawn: [(index: Int, rects: [CGRect])] = []
    private var popover: Popover?
    /// The top line on screen when last drawn.
    private var drawnTop = -1

    init(textView: TextView) {
        self.textView = textView
        canvas.isUserInteractionEnabled = false
    }

    /// The file's problems now (replacing the last).
    func set(_ new: [DiagnosticNative]) {
        closePopover()
        items = new
        layout()
    }

    /// The text is about to change at `range`: the problems move with their
    /// text, and one inside the change stretches or shrinks with it.
    func textWillChange(in range: NSRange, replacementLength: Int) {
        let delta = replacementLength - range.length
        let end = range.location + range.length
        for index in items.indices {
            var item = items[index]
            if end <= item.start {
                item.start += delta
                item.end += delta
            } else if range.location < item.end {
                item.start = min(item.start, range.location)
                item.end = max(item.start, item.end + delta)
            }
            items[index] = item
        }
    }

    /// Draw the problems on screen (call after layout, scrolling, typing).
    func layout() {
        guard let textView else {
            return
        }
        if canvas.superview == nil {
            textView.insertBehindText(canvas)
        }
        canvas.frame = CGRect(origin: .zero, size: CGSize(width: max(textView.contentSize.width, textView.bounds.width), height: max(textView.contentSize.height, textView.bounds.height)))
        canvas.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
        drawn = []
        let length = (textView.text as NSString).length
        let visible = visibleRange()
        for (index, item) in items.enumerated() {
            let start = min(max(item.start, 0), length)
            // An empty range still marks the character there.
            let end = min(max(item.end, start + 1), length)
            guard start < end, end >= visible.lowerBound, start <= visible.upperBound,
                  let from = textView.position(from: textView.beginningOfDocument, offset: start),
                  let to = textView.position(from: textView.beginningOfDocument, offset: end),
                  let range = textView.textRange(from: from, to: to) else {
                continue
            }
            let rects = textView.selectionRects(for: range).map(\.rect).filter { $0.width > 0 && $0.height > 0 }
            guard !rects.isEmpty else {
                continue
            }
            let path = UIBezierPath()
            for rect in rects {
                Self.addWave(to: path, under: rect)
            }
            let shape = CAShapeLayer()
            shape.path = path.cgPath
            shape.fillColor = nil
            shape.strokeColor = colors.of(item.severity).cgColor
            shape.lineWidth = Self.lineWidth
            shape.lineCap = .round
            shape.lineJoin = .round
            canvas.layer.addSublayer(shape)
            drawn.append((index, rects))
        }
        if let shown = popover {
            place(shown)
        }
    }

    /// The code scrolled: draw again only when other lines came on screen.
    func scrolled() {
        guard let textView else {
            return
        }
        let top = textView.lineIndex(atContentY: textView.contentOffset.y)
        guard top != drawnTop else {
            return
        }
        drawnTop = top
        layout()
    }

    /// A tap at `point` (in the editor): on a problem, its popover opens (or
    /// closes, if it is the one open); elsewhere, an open popover closes.
    func tapped(at point: CGPoint) {
        if let shown = popover, shown.view.frame.contains(point) {
            return
        }
        let hit = drawn.last { entry in
            entry.rects.contains { $0.insetBy(dx: -Self.tapSlop, dy: -Self.tapSlop).contains(point) }
        }
        guard let hit else {
            closePopover()
            return
        }
        if popover?.index == hit.index {
            closePopover()
        } else {
            open(hit.index)
        }
    }

    // MARK: - Internals

    /// The offsets of the lines on screen (with a margin), so only those
    /// problems are laid out.
    private func visibleRange() -> ClosedRange<Int> {
        guard let textView else {
            return 0...0
        }
        let text = textView.text as NSString
        let top = textView.lineIndex(atContentY: textView.contentOffset.y)
        let bottom = textView.lineIndex(atContentY: textView.contentOffset.y + textView.bounds.height)
        let first = Self.offset(ofLine: max(top - 10, 0), in: text)
        let last = Self.offset(ofLine: bottom + 10, in: text)
        return first...max(first, last)
    }

    /// Where line `line` (0-based) starts in `text`; its length past the end.
    private static func offset(ofLine line: Int, in text: NSString) -> Int {
        guard line > 0 else {
            return 0
        }
        var seen = 0
        var index = 0
        while index < text.length {
            if text.character(at: index) == 0x000A {
                seen += 1
                if seen == line {
                    return index + 1
                }
            }
            index += 1
        }
        return text.length
    }

    /// A wave along the bottom of `rect`.
    private static func addWave(to path: UIBezierPath, under rect: CGRect) {
        let y = rect.maxY - waveHeight
        var x = rect.minX
        var up = true
        path.move(to: CGPoint(x: x, y: y))
        while x < rect.maxX {
            let next = min(x + waveLength / 2, rect.maxX)
            path.addQuadCurve(to: CGPoint(x: next, y: y), controlPoint: CGPoint(x: (x + next) / 2, y: up ? y - waveHeight * 2 : y + waveHeight * 2))
            x = next
            up.toggle()
        }
    }

    private func open(_ index: Int) {
        closePopover()
        guard items.indices.contains(index) else {
            return
        }
        let view = makePopover(for: items[index])
        textView?.addSubview(view)
        let shown = Popover(index: index, view: view)
        popover = shown
        place(shown)
        onViewsChanged()
        view.alpha = 0
        UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut]) {
            view.alpha = 1
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

    /// Under the problem's text, or above it where there is no room below.
    private func place(_ shown: Popover) {
        guard let textView, let rects = drawn.first(where: { $0.index == shown.index })?.rects, let first = rects.first else {
            shown.view.isHidden = true
            return
        }
        shown.view.isHidden = false
        let bottom = rects.map(\.maxY).max() ?? first.maxY
        let left = max(textView.contentOffset.x + textView.gutterWidth, min(first.minX, textView.contentOffset.x + textView.bounds.width - Self.popoverWidth - 12))
        let width = min(Self.popoverWidth, textView.bounds.width - (left - textView.contentOffset.x) - 12)
        let size = shown.view.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - textView.adjustedContentInset.bottom
        let below = bottom + 6
        let y = below + size.height > visibleBottom ? first.minY - 6 - size.height : below
        shown.view.frame = CGRect(x: left, y: y, width: width, height: size.height)
    }

    private func makePopover(for item: DiagnosticNative) -> UIView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) {
            effect = UIGlassEffect(style: .regular)
        } else {
            effect = UIBlurEffect(style: .systemThinMaterial)
        }
        let glass = DiagnosticPopoverView(effect: effect)
        glass.overrideUserInterfaceStyle = colors.light ? .light : .dark
        roundCorners(of: glass, radius: Self.popoverRadius)

        let bar = UIView()
        bar.backgroundColor = colors.of(item.severity)
        bar.layer.cornerRadius = 1.5
        bar.translatesAutoresizingMaskIntoConstraints = false

        let message = UILabel()
        message.numberOfLines = 0
        message.text = item.message
        message.font = UIFont.systemFont(ofSize: 14)
        message.textColor = .label
        message.translatesAutoresizingMaskIntoConstraints = false

        let origin = UILabel()
        origin.text = [item.source, item.code.map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")
        origin.font = UIFont.systemFont(ofSize: 12)
        origin.textColor = .secondaryLabel
        origin.translatesAutoresizingMaskIntoConstraints = false

        let content = glass.contentView
        [bar, message, origin].forEach(content.addSubview)
        let padding = Self.popoverPadding
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: padding),
            bar.topAnchor.constraint(equalTo: message.topAnchor, constant: 2),
            bar.bottomAnchor.constraint(equalTo: message.bottomAnchor, constant: -2),
            bar.widthAnchor.constraint(equalToConstant: 3),
            message.leadingAnchor.constraint(equalTo: bar.trailingAnchor, constant: 8),
            message.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -padding),
            message.topAnchor.constraint(equalTo: content.topAnchor, constant: padding),
            origin.leadingAnchor.constraint(equalTo: message.leadingAnchor),
            origin.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -padding),
            origin.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 6),
            origin.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -padding),
        ])
        return glass
    }
}

/// The popover's glass: taps on it are its own, not the editor's.
private final class DiagnosticPopoverView: UIVisualEffectView {
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        tapBelongsHere(gestureRecognizer, self)
    }
}
