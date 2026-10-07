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
- [x] Strip Tree-sitter: the fork is **pure Swift, no C dependency** — the
      `TreeSitter*` dirs/files, the tree-sitter `TextViewState` init, the
      `TreeSitterLanguageModeDelegate`, and the `LinePosition` tree-sitter init
      are gone; `InternalLanguageModeFactory` dispatches PlainText / Shiki only.
      Drops into a CocoaPods pod with no C runtime to vendor.
- [x] Zero resources: `DefaultTheme` is hardcoded (VS Code Dark+), the
      `Theme.xcassets` + `Resources/*.lproj` are dropped, and `L10n` falls back
      to its English literals via `Bundle(for:)` — no `Bundle.module`, so it
      compiles under CocoaPods (not just SPM).
- [x] Expo module: `CodeEditorModule` + `CodeEditorView` (`ios/*.swift`)
      wrapping Runestone's `TextView` — props `text`, `editable`, `lineTokens`,
      `theme`, `fontSize`, `showLineNumbers`, `wrapLines`; event `onChange`.
      Installs `ShikiLanguageMode`, keys the store by each line's start offset,
      repaints visible lines on token/theme change, guards edit echo.
- [x] JS `CodeEditorNativeView` (`index.tsx`) + app `CodeEditor` (`src/files/`):
      `useCodeTheme` + `tokenizeCode` (Shiki) → per-line offset tokens + theme
      colours, debounced re-tokenise while typing.
- [x] `FileView` renders the native editor when the build carries it
      (`isCodeEditorNative`), else falls back to the web surface.
- [ ] A backend write endpoint (`/fs/write`) so editing can persist — none
      exists yet, so the editor is wired `editable={false}` (the viewer). The
      renderer is already the editor; flipping the flag is all that's left once
      saving lands.
- [ ] Scroll-to-line on the native path (Runestone has `goToLine`; the web
      surface's `scrollToLine` isn't forwarded yet).
- [ ] LSP later (diagnostics/hover/completions over opencode), native glass UI.

Needs a dev-client rebuild to compile (new native module); expect a couple of
on-device iterations since it can't be compiled on this machine.
