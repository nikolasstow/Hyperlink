# code-editor (native)

Our fork of [Runestone](https://github.com/simonbs/Runestone) (MIT — see
`ios/Runestone/LICENSE`) wrapped as an Expo module: the native code editor, one
surface for viewing and editing (read-only is `editable: false`).

## Why fork

Runestone is the right engine — it does NOT use `UITextView` (which doesn't
scale); it has a line tree (AvalonEdit's `DocumentLineTree`, O(log n)), lazy
viewport layout, incremental re-highlight, a real `UITextInput` (caret,
selection, keyboard — and we set `inputAccessoryView = nil`, killing the
unwanted accessory button), and a gutter. We fork so we can drive highlighting
from **Shiki** (our token colours, our VS Code themes, consistent with the
previews and chat) instead of its bundled Tree-sitter.

## The Shiki seam (where we change it)

Highlighting is two small internal protocols:
- `LineSyntaxHighlighter` — per line: given the line's `NSMutableAttributedString`
  + `byteRange`, applies foreground colour / bold / italic from a `Theme`.
  Template: `…/Internal/PlainText/PlainTextSyntaxHighlighter.swift`.
- `InternalLanguageMode` — `createLineSyntaxHighlighter()` + parse/indent hooks.
  Template: `…/Internal/PlainText/PlainTextInternalLanguageMode.swift` (no
  syntax tree).

So we add `Shiki/` with `ShikiTokenStore` (byte-range → colour/bold/italic,
pushed from JS), `ShikiSyntaxHighlighter: LineSyntaxHighlighter` (applies them),
and `ShikiInternalLanguageMode` (modelled on PlainText, returns the Shiki
highlighter), wired through `InternalLanguageModeFactory`.

## Plan / status

- [x] Vendor the engine (minus Documentation.docc), MIT notice kept.
- [x] `Shiki/` highlighter + mode + token store + factory wiring — COMPILES against the engine for iOS (xcodebuild, verified locally).
- [ ] Tree-sitter: vendor its C runtime into the pod (Runestone still imports it)
      OR strip the ~26 tree-sitter files. Keeping it is lower-risk for the first
      build; stripping is cleaner once it compiles.
- [ ] Expo module: `CodeEditorModule` + `CodeEditorView` wrapping Runestone's
      `TextView` — props `text`, `editable`, `tokensJson`, theme colours;
      events `onChangeText`, `onSelectionChange`.
- [ ] JS `CodeEditor` component: `tokenizeCode` (Shiki) → `tokensJson`.
- [ ] Replace `FileView`'s WebView with it.
- [ ] LSP later (diagnostics/hover/completions over opencode), native glass UI.

Needs a dev-client rebuild to compile (new native module); expect a couple of
on-device iterations since it can't be compiled on this machine.
