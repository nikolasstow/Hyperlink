import UIKit

/// The top sticky block: the enclosing header line plus the real source lines
/// above it, frozen to fill from the header up through the status bar, so the
/// context doesn't vanish behind the top bar as you scroll its body.
///
/// Mirrors the editor exactly so the hand-off is seamless: a fixed line-number
/// gutter on the left, and code rows that track the editor's horizontal scroll
/// (clipped to the gutter's right edge, the way the real gutter pins while text
/// scrolls under it). Pure UIKit; `CodeEditorView` supplies rows + geometry.
final class StickyScrollOverlay: UIView {
    /// One frozen row: its 1-based line number (nil = filler above the file
    /// start) and the Shiki-coloured code.
    struct Row {
        let number: Int?
        let code: NSAttributedString
    }

    private let codeClip = UIView()
    private let gutter = UIView()
    private var codeLabels: [UILabel] = []
    private var numberLabels: [UILabel] = []

    private var rowHeight: CGFloat = 0
    private var gutterWidth: CGFloat = 0
    private var gutterTrailingPadding: CGFloat = 0
    private var textLeftInset: CGFloat = 0
    private var horizontalOffset: CGFloat = 0
    private var headerLine = -1
    private var onTap: ((Int) -> Void)?
    private var lineNumberColor: UIColor = .secondaryLabel
    private var lineNumberFont: UIFont = .monospacedSystemFont(ofSize: 11, weight: .regular)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        codeClip.clipsToBounds = true
        addSubview(codeClip)
        addSubview(gutter) // on top, so code scrolling left is clipped behind it
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func style(background: UIColor, gutterBackground: UIColor, lineNumberColor: UIColor, lineNumberFont: UIFont) {
        backgroundColor = background
        gutter.backgroundColor = gutterBackground
        self.lineNumberColor = lineNumberColor
        self.lineNumberFont = lineNumberFont
    }

    func setRows(
        _ rows: [Row],
        rowHeight: CGFloat,
        gutterWidth: CGFloat,
        gutterTrailingPadding: CGFloat,
        textLeftInset: CGFloat,
        headerLine: Int,
        onTap: @escaping (Int) -> Void
    ) {
        self.onTap = onTap
        self.rowHeight = rowHeight
        self.gutterWidth = gutterWidth
        self.gutterTrailingPadding = gutterTrailingPadding
        self.textLeftInset = textLeftInset
        self.headerLine = headerLine
        while codeLabels.count < rows.count {
            let code = UILabel()
            code.lineBreakMode = .byClipping
            codeClip.addSubview(code)
            codeLabels.append(code)
            let number = UILabel()
            number.textAlignment = .right
            gutter.addSubview(number)
            numberLabels.append(number)
        }
        while codeLabels.count > rows.count {
            codeLabels.removeLast().removeFromSuperview()
            numberLabels.removeLast().removeFromSuperview()
        }
        for (index, row) in rows.enumerated() {
            codeLabels[index].attributedText = row.code
            if let number = row.number {
                numberLabels[index].text = String(number)
                numberLabels[index].textColor = lineNumberColor
                numberLabels[index].font = lineNumberFont
                numberLabels[index].isHidden = false
            } else {
                numberLabels[index].isHidden = true
            }
        }
        isHidden = rows.isEmpty
        setNeedsLayout()
    }

    /// Track the editor's horizontal scroll so the frozen code aligns with it.
    func setHorizontalOffset(_ offset: CGFloat) {
        guard horizontalOffset != offset else {
            return
        }
        horizontalOffset = offset
        layoutCode()
    }

    var preferredHeight: CGFloat {
        isHidden ? 0 : CGFloat(codeLabels.count) * rowHeight
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gutter.frame = CGRect(x: 0, y: 0, width: gutterWidth, height: bounds.height)
        codeClip.frame = CGRect(x: gutterWidth, y: 0, width: max(0, bounds.width - gutterWidth), height: bounds.height)
        for (index, number) in numberLabels.enumerated() {
            number.frame = CGRect(x: 0, y: CGFloat(index) * rowHeight, width: max(0, gutterWidth - gutterTrailingPadding), height: rowHeight)
        }
        layoutCode()
    }

    private func layoutCode() {
        let width = max(codeClip.bounds.width, 0) + 4000
        for (index, code) in codeLabels.enumerated() {
            code.frame = CGRect(x: textLeftInset - horizontalOffset, y: CGFloat(index) * rowHeight, width: width, height: rowHeight)
        }
    }

    @objc private func tapped() {
        if headerLine >= 0 {
            onTap?(headerLine)
        }
    }
}
