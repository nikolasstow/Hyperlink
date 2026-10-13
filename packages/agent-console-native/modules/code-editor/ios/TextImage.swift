import UIKit

/// Text drawn to an image file, for places that take only an image: the file
/// menu's font size buttons show "Aa" in the code's own font. Drawn in the
/// font the editor really uses (the family when installed, else the system's
/// monospace), so the file name follows the font actually drawn: a custom font
/// installed later gets its own image rather than the fallback's.
enum TextImage {
    /// Draws `text` in `family` at `size` points, `color` (hex), bottom-centred
    /// in a `width` × `height` point box; the image file's URL. Drawn once per
    /// font, size, box and colour; later calls return the kept file.
    static func render(text: String, family: String, size: Double, width: Double, height: Double, color: String) throws -> String {
        let font = codeFont(family: family, size: CGFloat(size))
        let name = [font.fontName, text, "\(size)", "\(width)x\(height)", color]
            .joined(separator: "_")
            .replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "-", options: .regularExpression)
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("text-images", isDirectory: true)
        let url = folder.appendingPathComponent("\(name).png")
        if FileManager.default.fileExists(atPath: url.path) {
            return url.absoluteString
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let box = CGSize(width: width, height: height)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor(shikiHex: color) ?? .label
        ]
        let drawn = (text as NSString).size(withAttributes: attributes)
        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale
        let image = UIGraphicsImageRenderer(size: box, format: format).image { _ in
            // Sits on the box's bottom (the baseline less the descender), so
            // a smaller and a larger one line up as a pair.
            let origin = CGPoint(x: (box.width - drawn.width) / 2, y: box.height - drawn.height - font.descender)
            (text as NSString).draw(at: origin, withAttributes: attributes)
        }
        guard let data = image.pngData() else {
            throw TextImageError.encoding
        }
        try data.write(to: url, options: .atomic)
        return url.absoluteString
    }

    /// The code's font for a family: the family when installed, else the
    /// system's monospace (as the editor draws it).
    static func codeFont(family: String, size: CGFloat) -> UIFont {
        if UIFont.familyNames.contains(family) {
            return UIFont(descriptor: UIFontDescriptor(fontAttributes: [.family: family]), size: size)
        }
        return UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }
}

enum TextImageError: LocalizedError {
    case encoding

    var errorDescription: String? {
        "The image could not be encoded"
    }
}
