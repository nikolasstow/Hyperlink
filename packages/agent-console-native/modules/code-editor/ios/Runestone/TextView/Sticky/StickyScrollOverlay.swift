import UIKit

/// The sticky-scroll breadcrumb: a little glass pill at the top of the editor
/// naming the scope you're currently inside (`func doSomething`, `class Foo`, a
/// markdown heading) as you scroll its body. A tap jumps to that line.
///
/// Pure UIKit and deliberately dumb: it's handed a label + the line it maps to,
/// and reports the height it wants. `CodeEditorView` decides *which* scope from
/// the structure ranges and the scroll offset, and lays this on top of the text
/// view.
final class StickyScrollOverlay: UIView {
    private let pill = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
    private let label = UILabel()
    private var line = 0
    private var onTap: ((Int) -> Void)?

    private let pillHeight: CGFloat = 30
    private let topMargin: CGFloat = 6
    private let hPadding: CGFloat = 13

    /// Left offset so the pill lines up past the gutter.
    var leadingInset: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        pill.clipsToBounds = true
        pill.layer.cornerCurve = .continuous
        pill.layer.cornerRadius = pillHeight / 2
        pill.layer.borderWidth = 0.5
        label.font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        label.lineBreakMode = .byTruncatingMiddle
        pill.contentView.addSubview(label)
        pill.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        addSubview(pill)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func style(textColor: UIColor, borderColor: UIColor) {
        label.textColor = textColor
        pill.layer.borderColor = borderColor.cgColor
    }

    /// Set (or clear) the pill. A nil label hides it.
    func setPill(label text: String?, line: Int, onTap: @escaping (Int) -> Void) {
        self.onTap = onTap
        self.line = line
        if let text {
            label.text = text
            isHidden = false
        } else {
            isHidden = true
        }
        setNeedsLayout()
    }

    var preferredHeight: CGFloat {
        isHidden ? 0 : pillHeight + topMargin * 2
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        label.sizeToFit()
        let available = max(0, bounds.width - leadingInset - 16)
        let width = min(available, label.bounds.width + hPadding * 2)
        pill.frame = CGRect(x: leadingInset, y: topMargin, width: width, height: pillHeight)
        label.frame = CGRect(x: hPadding, y: 0, width: max(0, pill.bounds.width - hPadding * 2), height: pillHeight)
    }

    @objc private func tapped() {
        onTap?(line)
    }
}
