# Native IDE — editing, themes, completions

VS Code capabilities on iOS, **native** (Runestone fork + Shiki), not a web view.
Three tracks; current priority order: **themes → editing → completions.**

## Editor status (today)

`modules/code-editor/` — forked Runestone (pure Swift, Tree-sitter stripped) wrapped
as an Expo module, highlighting driven by **Shiki** (our VS Code themes). Props:
`text`, `editable`, `lineTokens`, `theme`, `fontSize`, `showLineNumbers`,
`wrapLines`; event `onTextChange`. The renderer *is* the editor; it runs
`editable={false}` only because there's no persistence yet. JS side:
`src/files/CodeEditor.tsx`, `useCodeTheme.ts`, `shikiHighlighter.ts`; native:
`ios/CodeEditorView.swift`, `ShikiTheme.swift`. File text via backend `/fs/read`
(`filesPlugin.ts`); no `/fs/write` yet.

## 1. Themes — WORKING

Themes apply correctly (syntax colors match the selected VS Code theme). The one
nit — the editor **background wasn't immediately correct** on open — is fixed:
`CodeEditor.tsx` now resolves the base `EditorTheme` (background/foreground)
**synchronously** from the theme (initial state + a `[theme]` effect) instead of
only after the 150 ms-debounced tokenise, and paints the container View with that
background so there's no wrong-colored gap before the native view draws.
Residual: the theme JSON itself still loads async in `useCodeTheme` (fetch/created
lookup), so a just-switched theme can show the fallback briefly — cache the
theme's background if that ever matters. Not pursuing now.

## 2. Editing + autosave (DECIDED — build after themes)

Turn on editing with a save flow. Decisions:

- **Save trigger:** auto-save on **debounced change** — wait for typing to pause,
  but with a **max cap that resets the debounce** so it still saves every few
  seconds (cap by elapsed time *or* by characters typed; the cap just forces a
  flush). 
- **Autosave is a toggle** at every scope: **file, folder, repo/workspace,
  server, whole app** (scoped settings, like favorites' scopes — nearest scope
  wins).
- **Offline-first:** a file open in a tab is **always saved offline**. Two
  distinct save states, each with its own **icon**:
  - **Temporary save** — offline cache written because the app/system needed the
    file offline (not user-intended durability).
  - **Permanent save** — the user committed it (hard-press menu, or the file's
    3-dot menu). Writes through to `/fs/write`.
- **Manual save** lives in the 3-dot menu (and the hard-press menu).
- **Always-visible status indicator** for every status we can show (saved
  offline / temp vs permanent / dirty / syncing / error) — **simple, clean,
  immediately legible.** One small consistent symbol language.

Build order:
- **E1 — DONE:** backend `POST /fs/write` (`fs.ts` `writeTextFile`, within-root +
  size-capped, existing files only) + native `fsClient.fsWrite`.
- **E2:** enable editing + an **offline store of open-tab edits** (temporary
  saves) — onChangeText persists locally per repo+path, survives restart, no
  network. Effect store like conversations/favorites.
- **E3:** **permanent save** (manual, via 3-dot + hard-press menu) → `fsWrite`;
  the temp vs permanent distinction.
- **E4:** **debounced autosave** (pause-to-save, with a max cap that flushes) →
  permanent save, gated by the scoped autosave setting.
- **E5:** **scoped autosave setting** (file/folder/repo/workspace/server/app;
  nearest scope wins) + its UI.
- Throughout: the **save-status indicator** (icons for dirty / temp-saved /
  permanently-saved / syncing / error) and conflict/reload handling.

## 3. Copilot-style inline completions (DECIDED model: configurable — build last)

Ghost-text inline suggestions like VS Code Copilot. Two halves:
- **Native (Runestone):** render an inline suggestion after the caret, accept on
  Tab, dismiss on keystroke/Esc.
- **JS provider:** debounced; sends prefix/suffix (FIM-style) to a model, streams
  back a completion.
- **Model is configurable** (a setting) — not hardcoded; let the user choose
  which model drives completions (latency matters, so a fast one by default).
