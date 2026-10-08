import ExpoModulesCore

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

        // A version the JS side gates on, so it only mounts the native view on a
        // binary whose event names are safe. The first build shipped an `onChange`
        // event, which collides with React Native's reserved `topChange` and
        // crashes on render; JS treats a binary without `apiVersion >= 2` as
        // absent and falls back to the web surface.
        Constants([
            "apiVersion": 4,
        ])

        View(CodeEditorView.self) {
            Events("onTextChange", "onStickyDebug")

            Prop("text") { (view: CodeEditorView, value: String) in
                view.setText(value)
            }
            Prop("editable") { (view: CodeEditorView, value: Bool) in
                view.setEditable(value)
            }
            Prop("tokensJson") { (view: CodeEditorView, value: String) in
                view.setTokensJson(value)
            }
            Prop("stickyRangesJson") { (view: CodeEditorView, value: String) in
                view.setStickyRangesJson(value)
            }
            Prop("theme") { (view: CodeEditorView, value: ThemeRecord) in
                view.setTheme(value)
            }
            Prop("topInset") { (view: CodeEditorView, value: Double) in
                view.setTopInset(value)
            }
            Prop("bottomInset") { (view: CodeEditorView, value: Double) in
                view.setBottomInset(value)
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
