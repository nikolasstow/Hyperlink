import ExpoModulesCore

/// One Shiki token on a line: a range (UTF-16, relative to the line's start) and
/// the colour/weight to paint it. Mirrors the JS `CodeToken` turned into ranges.
struct TokenRecord: Record {
    @Field var start: Int = 0
    @Field var length: Int = 0
    @Field var color: String?
    @Field var bold: Bool?
    @Field var italic: Bool?

    init() {}
}

/// The editor's base colours, derived on the JS side from the active VS Code
/// theme. Any subset may be sent; missing fields keep their current value.
struct ThemeRecord: Record {
    @Field var background: String?
    @Field var foreground: String?
    @Field var gutterBackground: String?
    @Field var gutterForeground: String?
    @Field var currentLine: String?
    @Field var selection: String?
    @Field var caret: String?

    init() {}
}

public final class CodeEditorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("CodeEditor")

        View(CodeEditorView.self) {
            Events("onChange")

            Prop("text") { (view: CodeEditorView, value: String) in
                view.setText(value)
            }
            Prop("editable") { (view: CodeEditorView, value: Bool) in
                view.setEditable(value)
            }
            Prop("lineTokens") { (view: CodeEditorView, value: [[TokenRecord]]) in
                view.setLineTokens(value)
            }
            Prop("theme") { (view: CodeEditorView, value: ThemeRecord) in
                view.setTheme(value)
            }
            Prop("fontSize") { (view: CodeEditorView, value: Double) in
                view.setFontSize(value)
            }
            Prop("showLineNumbers") { (view: CodeEditorView, value: Bool) in
                view.setShowLineNumbers(value)
            }
            Prop("wrapLines") { (view: CodeEditorView, value: Bool) in
                view.setWrapLines(value)
            }
        }
    }
}
