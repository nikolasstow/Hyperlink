import ExpoModulesCore
import UIKit

/// What a preview draws: everything the editor is given on screen, and where
/// it rests.
struct EditorPreviewOptions: Record {
    /// The image's name: the same key is the same picture.
    @Field var key: String = ""
    @Field var text: String = ""
    @Field var tokensJson: String = "[]"
    @Field var stickyRangesJson: String = "[]"
    @Field var theme: ThemeRecord = ThemeRecord()
    @Field var fontFamily: String = ""
    @Field var fontSize: Double = 12.5
    @Field var width: Double = 0
    @Field var height: Double = 0
    @Field var topInset: Double = 0
    @Field var bottomInset: Double = 0
    @Field var stickyFill: Double = 0
    /// Points from the code's top it rests at.
    @Field var offset: Double = 0
    /// Points from the code's left it rests at.
    @Field var offsetX: Double = 0
    /// Pixels per point of the image.
    @Field var scale: Double = 1
}

/// A file as the editor shows it, as an image: a real editor, laid out off
/// screen with what the open one is given and rested where it was left, then
/// drawn. Being the editor itself, the picture is the editor's to the pixel
/// (font, size, gutter, theme, sticky scroll), so a tab's preview zooms into
/// the open file without a seam.
enum EditorPreview {
    static func render(_ options: EditorPreviewOptions, appContext: AppContext?) throws -> String {
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("editor-previews", isDirectory: true)
        let name = options.key.replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "-", options: .regularExpression)
        let url = folder.appendingPathComponent("\(name).png")
        if FileManager.default.fileExists(atPath: url.path) {
            return url.absoluteString
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let size = CGSize(width: options.width, height: options.height)
        let editor = CodeEditorView(appContext: appContext)
        editor.frame = CGRect(origin: .zero, size: size)
        editor.setTheme(options.theme)
        editor.setFontFamily(options.fontFamily)
        editor.setFontSize(options.fontSize)
        editor.setShowLineNumbers(true)
        editor.setWrapLines(false)
        editor.setEditable(false)
        editor.setTopInset(options.topInset)
        editor.setBottomInset(options.bottomInset)
        editor.setStickyFill(options.stickyFill)
        editor.setText(options.text)
        editor.setStickyRangesJson(options.stickyRangesJson)
        editor.setTokensJson(options.tokensJson)
        editor.layoutIfNeeded()
        editor.scrollToOffset(CGPoint(x: options.offsetX, y: options.offset))
        editor.layoutIfNeeded()

        let format = UIGraphicsImageRendererFormat()
        format.scale = CGFloat(options.scale)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            drawDisplayed(editor.layer)
            editor.layer.render(in: context.cgContext)
        }
        guard let data = image.pngData() else {
            throw EditorPreviewError.encoding
        }
        try data.write(to: url, options: .atomic)
        return url.absoluteString
    }

    /// Off screen nothing draws on its own: have every layer draw what it
    /// holds before the whole is rendered.
    private static func drawDisplayed(_ layer: CALayer) {
        layer.displayIfNeeded()
        layer.sublayers?.forEach(drawDisplayed)
    }
}

enum EditorPreviewError: LocalizedError {
    case encoding

    var errorDescription: String? {
        "The preview could not be encoded"
    }
}
