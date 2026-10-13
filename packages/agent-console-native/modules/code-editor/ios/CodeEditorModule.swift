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
    /// A conflict's colours, from the theme (mergeColors.ts): behind your lines
    /// and the agent's, the Mine/Theirs buttons, and their labels.
    @Field var mergeCurrentContent: String?
    @Field var mergeIncomingContent: String?
    @Field var mergeCurrentHeader: String?
    @Field var mergeIncomingHeader: String?
    @Field var mergeLabel: String?
    /// An agent's change, from the theme (changeColors.ts): the gutter
    /// stripes for added and changed lines, the deletion wedge, the flash as
    /// it lands, and the label on the popover's button.
    @Field var changeAdded: String?
    @Field var changeModified: String?
    @Field var changeDeleted: String?
    @Field var changeFlash: String?
    @Field var changeLabel: String?
    /// Whether the theme is light: glass in the editor takes this appearance.
    @Field var light: Bool?

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
        // 5: `applyChanges` (outside edits in place).
        // 6: conflicts drawn in the document (`conflictsJson`, `onConflictAction`).
        // 7: `tokensJson` may be `{length, lines}`; colours move with edits.
        // 8: an agent's changes marked in the gutter (`markChanges`,
        //    `onOpenSession`).
        // 9: editing with the keyboard down (`hideKeyboard`, `showKeyboard`).
        // 10: the line you are at (`onLineChange`), for breadcrumbs.
        Constants([
            "apiVersion": 10,
        ])

        AsyncFunction("hideKeyboard") { () -> Bool in
            CodeEditorView.hideKeyboard()
        }.runOnQueue(.main)

        AsyncFunction("showKeyboard") { () -> Bool in
            CodeEditorView.showKeyboard()
        }.runOnQueue(.main)

        View(CodeEditorView.self) {
            Events("onTextChange", "onStickyDebug", "onConflictAction", "onOpenSession", "onLineChange")

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
            Prop("stickyFill") { (view: CodeEditorView, value: Double) in
                view.setStickyFill(value)
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
            Prop("conflictsJson") { (view: CodeEditorView, value: String) in
                view.setConflictsJson(value)
            }

            AsyncFunction("applyChanges") { (view: CodeEditorView, changesJson: String, expectedLength: Int, highlightJson: String) in
                view.applyChanges(changesJson, expectedLength, highlightJson)
            }.runOnQueue(.main)

            AsyncFunction("markChanges") { (view: CodeEditorView, marksJson: String) in
                view.markChanges(marksJson)
            }.runOnQueue(.main)
        }
    }
}
