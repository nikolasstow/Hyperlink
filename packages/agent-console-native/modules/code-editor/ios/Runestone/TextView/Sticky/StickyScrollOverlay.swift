import UIKit

/// The top sticky block: the enclosing header line plus the real source lines
/// above it, frozen to fill from the header up through the status bar, so the
/// context doesn't vanish behind the top bar as you scroll its body.
///
/// Rendered as Shiki-coloured code rows that match the editor exactly (same
/// font, line height, x) and sit on an opaque editor-background panel, so the
/// hand-off is seamless — the frozen rows land where the real lines already
/// were. Pure UIKit; `CodeEditorView` supplies the rows and the geometry.
final class StickyScrollOverlay: UIView {
    private var labels: [UILabel] = []
    private var rowHeight: CGFloat = 0
    private var headerLine = -1
    private var onTap: ((Int) -> Void)?

    /// Left offset so the rows line up with the gutter'd code.
    var leadingInset: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func style(background: UIColor) {
        backgroundColor = background
    }

    /// Rows top-to-bottom (the topmost source line first, the header last), each
    /// `rowHeight` tall. A tap jumps to `headerLine`.
    func setRows(_ rows: [NSAttributedString], rowHeight: CGFloat, headerLine: Int, onTap: @escaping (Int) -> Void) {
        self.onTap = onTap
        self.rowHeight = rowHeight
        self.headerLine = headerLine
        while labels.count < rows.count {
            let row = UILabel()
            row.lineBreakMode = .byClipping
            addSubview(row)
            labels.append(row)
        }
        while labels.count > rows.count {
            labels.removeLast().removeFromSuperview()
        }
        for (index, row) in rows.enumerated() {
            labels[index].attributedText = row
        }
        isHidden = rows.isEmpty
        setNeedsLayout()
    }

    var preferredHeight: CGFloat {
        isHidden ? 0 : CGFloat(labels.count) * rowHeight
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = max(0, bounds.width - leadingInset - 8)
        for (index, row) in labels.enumerated() {
            row.frame = CGRect(x: leadingInset, y: CGFloat(index) * rowHeight, width: width, height: rowHeight)
        }
    }

    @objc private func tapped() {
        if headerLine >= 0 {
            onTap?(headerLine)
        }
    }
}
