# Handoff — Code surface Phase 0: Monaco-in-WebView, read-only (agent-console-native)

**For:** a background agent building the file **code surface** foundation.
**Status:** READY to build. Owner-approved plan; this is the foundation, not a prototype.
**SSOT you must follow:** `docs/handoffs/extensions-sync-and-theming.md` → section **"Code highlighting — decisions"**. If anything here seems to conflict with that doc, STOP and ask the owner — do not improvise or substitute your own approach. This project has been burned by agents building off-plan.

---

## The one-paragraph goal

Build the file-viewing surface in `agent-console-native` as **Monaco Editor hosted in a `react-native-webview`**, **read-only for now**, themed so it renders **identically** to the app's existing on-device Shiki code blocks. This exact surface becomes the editor later by flipping `readOnly`, and grows LSP hovers, Copilot-style completions, and live collab on the **same instance** — so build it as a durable foundation, with no throwaway shortcuts.

## Why (the locked decision, quoted)

From the SSOT:

> **Shiki is the single highlighting source of truth.** Native display (chat, file viewer) tokenizes with Shiki; the eventual **editor is Monaco-in-WebView themed via `@shikijs/monaco`** — same theme + TextMate grammars, so display and edit render identically. A view↔edit switch is one Monaco instance toggled `editable` → seamless, no engine swap.

Later phases (NOT in this task, but the reason Phase 0 must be solid): **Phase 1** editing (`readOnly:false` + save via `/fs/write`); **Phase 2** language intelligence (Monaco TS worker offline; LSP bridge later); **Phase 3** Copilot-style inline completions (`registerInlineCompletionsProvider` → a fill-in-the-middle endpoint on the agent-console server); **Phase 4** live collab via Yjs (`y-monaco`). Everything is additive on the one Monaco instance.

## Scope of THIS task (Phase 0 only)

In scope:
1. A `CodeSurface` React component: a `react-native-webview` that loads Monaco from a **locally bundled asset** (see Offline below), initialized `readOnly: true`.
2. Theme it via **`@shikijs/monaco`** using the **same active VS Code theme + TextMate grammars** the app already resolves — so it matches the chat blocks pixel-for-token. Reuse `src/useCodeTheme.ts` (resolves the enabled theme: installed / created / bundled fallback) and the Shiki theme/grammar setup in `src/shikiHighlighter.ts`. Do **not** introduce a second theme source.
3. An RN↔WebView bridge: RN → WebView to set `{ content, language, theme, fontFamily, scrollTo }`; WebView → RN to emit `{ ready, selectionChanged, linkActivated, contentHeight, error }`.
4. Language from filename via `langFromFilename` (already in `src/shikiHighlighter.ts`).
5. Rewire `src/FileViewerScreen.tsx` to render `CodeSurface` instead of its current RN `<Text>` line rendering. (The RN `<Text>` viewer was an interim rendering and is being replaced by this — that is expected and approved.)
6. Font = the app code font (`Theme.codeFont` from `src/settings.ts`, via `useTheme()`), applied to Monaco.

Explicitly OUT of scope (do not build; just don't foreclose them): editing/save, LSP, completions, collaboration. **Do not** build a throwaway read-only renderer that an editor can't grow from — the whole point is that Phase 1 is `readOnly:false` on this same surface.

Keep the existing native-Shiki path for **chat code blocks** (`src/CodeBlock.tsx` / `src/Markdown.tsx`) untouched — those stay native Shiki. Only the **file surface** moves to Monaco.

## Hard requirements / constraints

- **Offline + CSP.** The app must render code with no network (airplane mode) and no CDN. Monaco, `@shikijs/monaco`, and the grammars/themes must be **bundled as local assets** and loaded by the WebView from the app bundle (e.g. `WebView source={{ html }}` with inlined/asset-served JS, or a bundled local `index.html`). No remote `<script src>`.
- **Identical rendering to chat.** Same theme JSON (`getThemeJson` / created-theme document) and same grammars as Shiki. A file and a chat block in the same language+theme must look the same.
- **`react-native-webview` is already a dependency** (`13.16.1`) — it's in the native binary, so Phase 0 should be **JS-only** (Monaco + `@shikijs/monaco` + `monaco-editor` are JS bundled into the webview asset). Confirm this; if you find a genuine native dependency is required, STOP and flag it to the owner before adding it (a new native module forces an EAS rebuild).
- **Read-only** (`readOnly: true`) but structured so `false` is a one-line change later.
- Respect the app's theming: light/dark follow `useColorScheme()` via `useCodeTheme()`; update the surface when the theme changes.
- Large files must open without freezing (Monaco virtualizes; just don't defeat it).

## Files to know

- `src/FileViewerScreen.tsx` — the screen to rewire (currently RN `<Text>` + Shiki tokens).
- `src/useCodeTheme.ts` — returns the active theme as a Shiki `ThemeRegistrationRaw` (or bundled name). Reuse verbatim.
- `src/shikiHighlighter.ts` — Shiki singleton, bundled grammars/themes, `shikiThemeOf`, `langFromFilename`. Reuse its grammars/themes for `@shikijs/monaco`.
- `src/CodeBlock.tsx` — the chat renderer; the visual target to match. Do not repurpose it for files.
- `src/extensionsClient.ts` (`getThemeJson`) and `src/settings.ts` (`CodeTheme`, `Theme.codeFont`) — theme + font sources.
- `src/fsClient.ts` (`fsReadText`) — how file text is loaded (already used by `FileViewerScreen`).

## Acceptance criteria

- Opening a file shows it in Monaco, **read-only**, syntax-highlighted with the **enabled** VS Code theme (matches a chat block of the same language/theme).
- Language is correct from the filename; unknown/extensionless → plain text.
- Scroll, text selection, and copy work; the app code font is applied.
- Works in **airplane mode** (no CDN/network).
- Switching the app theme (Appearance) updates the surface.
- `pnpm -C packages/agent-console-native typecheck`, `eslint`, and `test` are green.
- No new **native** dependency added without owner sign-off; if Phase 0 stays JS-only, note that no rebuild is required.

## Guardrails

- Follow the SSOT doc. Don't swap Monaco for CodeMirror or anything else — Monaco is the locked choice (it also carries the Yjs/collab and inline-completion story in later phases).
- No prototypes, no placeholders. If a requirement can't be met cleanly, STOP and raise it with the owner rather than shipping a workaround.
- Commit in small steps; run typecheck/eslint/test before each commit.
