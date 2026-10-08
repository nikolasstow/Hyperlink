import UIKit

/// The sticky-scroll header: the enclosing scope lines (the `function foo() {` /
/// `class A {` / `## Heading` lines) pinned at the top of the editor as you
/// scroll into a block, so you keep context in a long body.
///
/// Pure UIKit and deliberately dumb: it is handed ready-to-draw rows — an
/// attributed string (already coloured with the line's Shiki tokens) plus the
/// line each maps to — and reports the height it wants. `CodeEditorView` decides
/// *which* scopes to show, from the structure ranges and the scroll offset, and
/// lays this on top of the text view. A tap jumps to that line.
final class StickyScrollOverlay: UIView {
    private var labels: [UILabel] = []
    private var lines: [Int] = []
    private var rowHeight: CGFloat = 0
    private let hairline = UIView()
    private var onTap: ((Int) -> Void)?

    /// Left padding so the sticky text lines up with the gutter'd code.
    var leadingInset: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.12
        layer.shadowOffset = CGSize(width: 0, height: 1)
        layer.shadowRadius = 3
        hairline.isUserInteractionEnabled = false
        addSubview(hairline)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func style(background: UIColor, hairlineColor: UIColor) {
        backgroundColor = background
        hairline.backgroundColor = hairlineColor
    }

    /// Replace the pinned rows, outermost scope first.
    func setRows(_ rows: [(text: NSAttributedString, line: Int)], rowHeight: CGFloat, onTap: @escaping (Int) -> Void) {
        self.onTap = onTap
        self.rowHeight = rowHeight
        lines = rows.map { $0.line }
        while labels.count < rows.count {
            let label = UILabel()
            label.isUserInteractionEnabled = true
            label.lineBreakMode = .byClipping
            label.tag = labels.count
            label.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(rowTapped(_:))))
            addSubview(label)
            labels.append(label)
        }
        while labels.count > rows.count {
            labels.removeLast().removeFromSuperview()
        }
        for (index, row) in rows.enumerated() {
            labels[index].attributedText = row.text
        }
        isHidden = rows.isEmpty
        setNeedsLayout()
    }

    var preferredHeight: CGFloat {
        isHidden ? 0 : CGFloat(labels.count) * rowHeight
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        for (index, label) in labels.enumerated() {
            label.frame = CGRect(x: leadingInset, y: CGFloat(index) * rowHeight, width: max(0, bounds.width - leadingInset - 8), height: rowHeight)
        }
        hairline.frame = CGRect(x: 0, y: bounds.height - 0.5, width: bounds.width, height: 0.5)
    }

    @objc private func rowTapped(_ recognizer: UITapGestureRecognizer) {
        guard let tag = recognizer.view?.tag, tag < lines.count else {
            return
        }
        onTap?(lines[tag])
    }
}
