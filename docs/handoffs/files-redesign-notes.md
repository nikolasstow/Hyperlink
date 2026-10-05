# Files redesign — notes

Status: design notes, not built. Scope: `packages/agent-console-native` (Xcode target `DoubleAgent`).
Supersedes in part: `files-explorer-spec.md` (the explorer is built; this reshapes its navigation).
Related: `double-agent-repo-screen-and-plugin-system.md` §3.1 / §17 (files live on our vite backend), §27 (the bottom bar's pages).

## 1. Intent

Separate **file navigation** from the app's **native stack**, so it can be saved and returned to.
Match Safari for the chrome: file nav lives in a **bottom bar** (back · forward · a path pill · tabs),
and the **top nav** does one thing — go back to the repo/folder you were in before you opened files.
The same bottom bar is later reused by the file editor (broken today, out of scope).

The reason to separate: today file navigation *is* the native stack. `FileExplorer` pushes another
`FileExplorer` per folder and a `FileViewer` per file, so leaving Files and coming back always starts
fresh at the repo root. There is no way to leave the explorer, do something else, and return to the
folder/file you were looking at. File nav should be its own, persisted state — a browser's history,
not the app's.

## 2. What exists now

- `FileExplorerScreen.tsx` + `FileViewerScreen.tsx` — two pushed native-stack screens. Drilling in
  is `navigation.push`, going back is the native pop.
- `fileNavHistory.ts` — a module-singleton **forward-only** trail (the native stack owns "back").
  `pushForward` on pop, `popForward`/`useForwardTarget` for the forward button, `clearForward` on a
  fresh navigation.
- The Files bottom bar is `DubzBar` (`Dubz.tsx`) — Dubz its only page, no composer, no nav controls.
- The top header draws its own back + forward (`unstable_headerLeftItems` in `FileExplorerScreen`),
  and hides the native back (`headerBackVisible: false` in `RootNavigator.tsx`).
- `primaryWorktree.ts` is the model for the new store: module `Map` + `useSyncExternalStore(subscribe,
  () => version)`, persisted to AsyncStorage. `sessionReads.ts` / `settings.ts` are the persistence
  conventions.

## 3. Target shape

### 3.1 One `Files` screen

The native stack holds a single `Files` route. Drilling into folders and opening files updates the
file-nav store instead of pushing. The screen renders the **directory listing** or the **file viewer**
(`CodeSurface`) depending on the current entry's kind. The top header is the **system back button**
(pops to the repo), nothing else.

### 3.2 The file-nav store — `fileNav.ts`

Replaces `fileNavHistory.ts`. Per-repo, persisted, bidirectional:

```ts
type FileNavEntry = {
  readonly path: string
  readonly name: string
  readonly kind: "directory" | "file"
}

type FileNavState = {
  readonly entries: ReadonlyArray<FileNavEntry>
  readonly index: number
}
```

- Keyed by repo, held in a module `Map<string, FileNavState>`, loaded once from AsyncStorage
  (`agent-console-native:fileNav`) at boot, saved on every change (best-effort, like `sessionReads`).
- API: `useFileNav(repo)` (reactive), `ensureRoot(repo, root)` (seed/`reset` when the root — the
  primary worktree — changed), `openEntry(repo, entry)` (push + truncate forward), `backEntry`,
  `forwardEntry`.
- `openEntry` truncates forward exactly like a browser drops its forward stack on a new navigation.
- The root entry's `path` is the repo's **primary worktree** (`usePrimaryWorktree`), so switching the
  worktree re-roots the store (`ensureRoot` sees a new root path and resets).

### 3.3 The Safari bottom bar — `FileNavBar.tsx`

A glass pill with **back** `<`, **forward** `>`, a **path pill** (the current path, monospaced,
ellipsized middle), and a **tabs** button (a stub — tabs are a later feature). It mirrors `Composer.tsx`
as a two-page bar: page A is this nav pill, page B is `DubzPage`, swiped between with the same
`PAGE_*`/`pageEasing` constants and `PageBack` from `Dubz.tsx` — the same swipe-to-Dubz the composer has.
The nav pill has no "expanded" state (there is nothing to type), so the swipe is always the collapsed
case; turning the page calls `rememberPage(surface, "dubz" | "compose")` exactly as the composer does.

- URL pill is **read-only for now** (display only; editable/jump-to comes later).
- Tabs button is a no-op placeholder.
- Rides the keyboard via `useKeyboardSlide` and follows the `BottomBar`/`Dubz` glass conventions
  (round the `GlassView` itself, never clip it; animate layout, never opacity/transform on glass).

### 3.4 Top nav

The `Files` screen keeps a transparent native header with the system back button (pop to repo). The
back/forward pair moves off the header onto the bottom bar. `headerBackVisible` returns to the default.

## 4. Decisions (locked)

1. **Single `Files` screen** in the native stack; file nav is internal + persisted.
2. **URL pill** is display-only in v1.
3. **Persistence is per-repo** (each repo remembers its own location/history).
4. `FileViewer` route + `FileViewerScreen.tsx` stay for the standalone case (plugin/extension
   `OpenFile` via `followResult.ts`) — not folded into `Files` yet.

## 5. File-by-file changes

1. **New `fileNav.ts`** — the store (§3.2).
2. **New `FileNavBar.tsx`** — the Safari bar (§3.3).
3. **New `FilesScreen.tsx`** — one screen; directory listing (reuse `useFileTree` + the explorer rows)
   or file view (`fsReadText` + `CodeSurface`, `langFromFilename`), the `FileNavBar` at the bottom,
   `EdgeBlurBars`, and the `WorktreePicker` as the header title at the root.
4. **`RootNavigator.tsx`** — add `Files: { repo: string; dir: string }`; remove `FileExplorer`.
   `dir` is the fallback for `usePrimaryWorktree` (the directory passed when Files is opened).
5. **`RepoScreen.tsx`** + **`HomeScreen.tsx`** — `navigate("Files", …)` instead of `FileExplorer`;
   drop the `clearForward()` calls.
6. **Delete** `FileExplorerScreen.tsx` and `fileNavHistory.ts` (superseded).
7. Untouched: `FileViewerScreen.tsx`, `followResult.ts`, `repoMenu.ts` (the `Files` row already
   exists), the `Dubz` surface wiring (Files keeps `surface: "repo"`).

## 6. Build order

1. `fileNav.ts` (no deps — lowest risk).
2. `FileNavBar.tsx` (mirrors `Composer`'s two-page swipe).
3. `FilesScreen.tsx` (renders listing or viewer by `current.kind`).
4. Rewire `RootNavigator` + the two entry points; delete the superseded files.
5. Gate: `pnpm hyp` / `pnpm verify` (typecheck + lint + test) green.

## 7. Deferred (not now)

- **Tabs** — the button is a stub; real tabs later.
- **Editable URL pill** — type a path to jump, later.
- **File editor reuse** — the same bottom bar backs the editor; the editor is broken today.
- Memory-pressure wiring to `closeAllExcept` (still the native-host track, per the code-surface docs).

## 8. Status (2026-10-05)

Built on `app/double-agent/ios`, following §3–§6, with these differences:

- **The store is an Effect service** (`src/files/FileNav.ts`, `FileNav` over KeyValueStore,
  prefix `agent-console-native:files:`), not a module `Map` like `primaryWorktree.ts`: the
  app's logic is Effect (the conversation and background stores are the same shape). The API
  is as in §3.2 (`ensureFileRoot`, `openFileEntry`, `fileBack`, `fileForward`, `useFileNav`, in
  `src/files/useFileNav.ts`); tested in `FileNav.test.ts`.
- Files lives in `src/files/`: `FilesScreen.tsx`, `FileNavBar.tsx`, `FileListing.tsx` (the
  explorer's rows and tree, moved), `FileView.tsx` (the viewer's body, now shared by
  `FileViewerScreen.tsx`, which stays for the standalone case per §4.4).
- The `Files` route uses the app's `pageHeader` (transparent, system back to the repo).

Not yet: tabs, an editable path, and the preload decisions in
`agent-console-native-preload.md` (the tree kept on the device, refreshed when the repo
page opens; recently viewed files preloaded per folder; big files in parts with their
colouring).
