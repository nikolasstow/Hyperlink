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

## Instant opens — DONE

Files open instantly and already coloured, never a flash of plain text:
- **Synchronous token peek** — `codeCache.getCachedTokensSync` /
  `shikiHighlighter.cachedHighlightSync`; `CodeEditor` seeds `tokensJson` + base
  theme from the in-memory cache on the first frame, and the first tokenise is
  immediate (not behind the 150 ms typing debounce).
- **File-text cache** (`fileTextCache.ts`, memory + AsyncStorage): `FileView`
  mounts from the cached text at once and revalidates in the background
  (stale-while-revalidate); saves update it.
- **Preload** (`preloadFile.ts`): Home warms text + tokens for recent files, so a
  tap only renders. (Sync peeks hit memory only — preload/open warms it; so
  first-ever opens still tokenise, later ones are instant.)

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

**Save-status design (DECIDED):** an **indicator light that flashes a colour** —
**blue = local (device) save, green = cloud (disk) save.** Rate-limited (min
flash duration) and **queued so concurrent local+cloud never overlap/flicker**;
dedupe is **consecutive-colour, in the queue only** (two of a colour in a row is
fine when not queued). In **folder view**, per-file **blue download / green
upload** icons for transfer state. Autosave is **ON app-wide** by default.
Prototype first, then tweak.

Build order:
- **E1 — DONE:** backend `POST /fs/write` (`fs.ts` `writeTextFile`, within-root +
  size-capped, existing files only) + native `fsClient.fsWrite`.
- **E2 — PROTO DONE:** editing on (`FileView` `editable`); `onChangeText` →
  debounced **local flash (blue)** + debounced disk **autosave (green)** with a
  max-wait flush; `StatusLight` (flash queue `saveLight.ts`, tested) top-right;
  writes guarded to changed text. ⚠️ writes real files — validate editor text
  fidelity on a throwaway file first.
- **E3 — DONE (offline-persist):** `fileEdits.ts` persists pending edits on
  device (memory + AsyncStorage), shown offline-first (pending edit wins over the
  disk cache); the blue flash is now a real write; a cloud save / disk-match
  clears the pending edit. Reactive dirty set (`useDirtyPaths`, loaded at launch).
- **E4 — DONE (green upload):** the folder listing shows a green upload glyph on
  files with unsaved local changes. (Blue download reserved for a pull/refresh
  state.)
- **Keep On Device — DONE:** file hard-press menu pins a file for offline
  (downloads + warms it; `fileKeep.ts`, persisted, read back at launch).
- **PENDING — file 3-dot menu:** the open-file toolbar/3-dot (doesn't exist yet)
  should host **manual/permanent Save** and **Keep On Device**; plus the
  temp-vs-permanent + error save states.
- **PENDING — scoped autosave setting** (file/folder/repo/workspace/server/app;
  nearest wins) + UI; conflict/reload handling.

## Instant opens — also fixed
Theme resolves once (process-wide cache; no default-then-correct flash on every
open); text + token sync caches + preload (deferred so it doesn't block taps).

## Sticky scroll — closest parent
`CodeEditorView.swift` sticky now fills with the **enclosing scope stack**
(closest parent at the bottom, ancestors above) instead of the physical lines
above the header. Native — needs a build to verify; may need a push-off tweak as
the innermost scope ends.

## 3. Copilot-style inline completions (DECIDED model: configurable — build last)

Ghost-text inline suggestions like VS Code Copilot. Two halves:
- **Native (Runestone):** render an inline suggestion after the caret, accept on
  Tab, dismiss on keystroke/Esc.
- **JS provider:** debounced; sends prefix/suffix (FIM-style) to a model, streams
  back a completion.
- **Model is configurable** (a setting) — not hardcoded; let the user choose
  which model drives completions (latency matters, so a fast one by default).
