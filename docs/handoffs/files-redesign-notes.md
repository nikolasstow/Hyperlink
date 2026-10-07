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

## 9. Alterations (owner, 2026-10-05)

Supersede §3.3's single pill and its tabs stub:

1. **The layout matches Safari's compact bar**: three separate glass pieces, not one pill —
   a back · forward capsule, the address capsule in the middle, a round button at the end.
2. **The address capsule is the tab bar.** It shows the current tab, and a sideways swipe
   on it moves between tabs, as Safari's does. (So Dubz is no longer a swipe away here.)
3. **The round button is Dubz / chat**, not tabs.
4. **Tabs mix two kinds**: an explorer tab (a folder) is a small pill; a file tab (view /
   edit) is a shrunken preview of the file, always up to date. Tapping a tab expands it to
   full, seamlessly.
5. **The tab overview opens and closes as Safari's does** (the current tab shrinks into its
   place in the overview, and grows back out of it).

## 10. Tabs (owner, 2026-10-05)

Supersedes §9.4 and fills in the rest:

1. **All tabs are the same**: a preview of what the tab shows (a folder's listing or a
   file), kept up to date. Tapping a preview opens that tab, expanding it to full screen.
2. **The address pill shows the current tab's name** (the file or folder name), not its
   path. The overview shows as much of each tab's path as fits under its preview, cut at
   the start, not the end (the end matters most).
3. **The overview opens** by tapping the address pill, or swiping up on it; a sideways
   swipe on the pill moves between tabs.
4. **The overview's bottom bar**: history at the bottom left; in the middle a switcher —
   All · Files · Folders — filtering the tabs; a + at the bottom right for a new tab.

## 11. Status: tabs (2026-10-05)

Built (`src/files/`): `FileNav` now keeps tabs per repo (each its own back/forward, the
active one, a history of what was opened, all on the device); `FileNavBar` is Safari's
three pieces (back · forward, the name pill = tab bar, the Dubz button); `TabOverview` is
the grid of previews (`TabPreview`: the tab drawn at screen size and scaled, folders from
the listing cache, files' first lines re-read when shown) with history · All/Files/Folders
(native segmented) · + at its bottom; `FilesScreen` zooms the tab into and out of its
preview on the UI thread from the grid's fixed geometry. A row's long press has Open in
New Tab. Tests: `FileNav.test.ts`.

Not yet: a new tab (the +, history, Open in New Tab) opens without the zoom; a sideways
swipe on the pill switches tabs at once (no slide); file previews are plain monospace
(not coloured); the path pill is display-only.

## 12. Round 2 (owner, 2026-10-05)

- Bar glass as Safari's: regular glass, untinted, each piece rounded on itself with its
  shadow on an outer wrapper; wider margins (20 at the sides, 10 between).
- The bar leaves as a listing scrolls down and comes back as it scrolls up, or on a new
  page (`scrollHide.ts`, shared with the search pill). A file's code surface does its own
  scrolling and reports none, so the bar stays over files for now.
- Edge swipes are Files' back and forward (the page follows the finger); with nothing
  before, the left edge goes out to the repo. The app's swipe-back is off on this route.
- Previews are 3:4, the page's top (cropped); the zoom crops to that shape as it goes.
- Overview: no header over it; the close button sits in its preview's corner (the outline
  is drawn over the preview so it moves nothing); the switcher is the native segmented
  control at extra-large, All in larger text, Files and Folders as icons.
- New tabs animate: + and history grow out of the new tab's place in the grid; Open in
  New Tab rises in from the bar.

## 13. Repos and worktrees in the tab view (owner, 2026-10-07)

- Each repo has its own tabs. Switching a repo's worktree keeps its tabs: every tab and
  history entry moves to the same file in the new worktree (FileNav `rerooted`).
- The tab view's top right: a glass button naming whose tabs are shown (a repo and its
  worktree, or All Repos). It opens a native popover (not a menu: a menu row cannot
  both select and expand): All Repos first, then each repo with tabs open. Tapping a
  repo's name filters to its tabs; its chevron opens its worktrees as a glass menu of
  their own (not expanding in place), one tapped switching that repo's worktree.
- All Repos shows every repo's tabs, each repo under its name, this repo first. Opening
  another repo's tab takes Files to that repo, at that tab.
- Each time the tab view opens, it shows this repo's tabs.
- Switching worktree, handled: tabs move however their paths are written (`~/…` or in
  full); Files shows them moved at once, before the store saves; a folder the server
  already sent in another path form is asked for again as a new tree session (it came
  back empty, so previews and listings went blank); a file or folder not in the new
  worktree says so in its preview ("Not in this worktree"), and on its page.
- A tab whose file or folder isn't in the worktree is disabled (dimmed, doesn't open,
  can still close; swiping skips it) until a worktree that has it is switched to.
- No outline on the last-opened tab in the tab view.
- The tab view's bottom bar: + at the left, the switcher in the middle, Done (blue, a
  white checkmark) at the right, back into the tab showing. No History button.
- Back buttons (Files' top bar, the tab view's) name the page they go back to, kept
  clear of what is in the middle (the title's width worked out, not measured).
- The tab view's top bar: back at the left, the repo filter its own glass in the middle
  (its width worked out, so back stays clear of it), search and history their own glass
  at the right. History opens the History sheet (a tap opens the file in a new tab).
  What search searches is not decided yet (owner, 2026-10-07): the button does nothing.
- The centre glass pills (Files' title, the worktree picker) carry the same drop shadow
  as the glass buttons (SwiftUI's `shadow` modifier: PILL_SHADOW; they are native glass,
  so no RN shadow wrapper).

## 14. Dubz: button morph, not a bar slide (owner, 2026-10-07)

- The Files bar's Dubz still uses the two-page model (pageX, DubzPage beside the bar,
  finger swipe-back), but the OPEN transition changed: instead of the whole bar sliding
  off while Dubz's bar slides in, the round chat button stretches into Dubz's min-view
  pill in place (FileNavBar: a standalone morph glass, frame interpolated by pageX from
  the button's circle to the pill; the bar fades, Dubz's page fades in over the last of
  the stretch). Once the morph completes, the window grows to the detent Dubz was last
  at (unchanged). Finger swipe-back reverses the morph. Open is tap-only.
- BarWindow internals (detents, memory, suggestions, keyboard) unchanged. Applies to
  file and folder tabs (FileNavBar is shared).
