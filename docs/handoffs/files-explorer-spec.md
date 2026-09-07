# Handoff: Files explorer (on our vite backend)

Self-contained spec. Build a file explorer for the DoubleAgent repo screen, served by **our own vite backend** (`packages/agent-console`), not opencode. Decision context: `docs/handoffs/double-agent-repo-screen-and-plugin-system.md` §17 — IDE/filesystem features live on the vite server (`src/server/*.ts`) which we own and can extend; opencode (`:4096`) is only the agent. This work also removes the last non-agent opencode file coupling.

Two packages:
- **`packages/agent-console`** — the vite dev server + its plugins (`src/server/`). Runs on `:5195`.
- **`packages/agent-console-native`** — the iOS app (`src/`). Connects to opencode directly (`client.ts`) and derives the vite backend at `:5195` via `settings.ts` `getBackendAddress`.

Constraints throughout: match existing conventions — `colors.ts` (semantic PlatformColor), `SystemIcon`, `StyleSheet`, one-field-per-line style, **no `as` casts**, defensively parse all network JSON (it crosses a boundary), and **never swallow errors** (check `res.ok`; surface failures). No new native deps (must run on the current dev client). `tsc -p tsconfig.json --noEmit` must pass in each package you touch.

## Task 1 — directory-listing endpoint on `filesPlugin`

File: `packages/agent-console/src/server/filesPlugin.ts`. It already serves file **content** under `/files/…` via `node:fs`. **Add a listing endpoint**; keep the content route.

Contract (pick clean shapes, suggested):
- `GET /files/list?path=<absolute-or-root-relative dir>` → `200 { path, entries: [{ name, type: "file" | "directory", size?: number }] }`. Sort directories first, then files, each alphabetical (case-insensitive). Include dotfiles (the explorer shows `.git` etc.).
- `GET /files/read?path=<file>` → the file's text (or reuse the existing content route if it already fits). Needed by Task 2's `.git` reads.
- `404` for missing, `400` for a bad/missing `path`, `405` wrong method.

Path safety: resolve with `realpath` and confine to an allowed root (env `AGENT_CONSOLE_FILES_ROOT` / `process.cwd()`, same as the other plugins use) — reject traversal outside it. It's the user's dev machine over Tailscale, but still guard.

## Task 2 — migrate `repoScan` + `branchScan` off opencode

Files: `packages/agent-console-native/src/repoScan.ts`, `src/branchScan.ts`. Both currently take an `OpencodeClient` and call `client.file.list` / `client.file.read`. Change them to use the **vite backend** (`/files/list`, `/files/read`) instead.

- Keep the **pure logic** (worktree discovery, `.git` parsing, grouping) exactly — only swap the IO.
- Replace the `OpencodeClient` parameter with either the backend base URL (a `string`) or a tiny `{ list(path), read(path) }` interface backed by `fetch` to the backend. Update every caller (`HomeScreen`, `repoScanCache`, `RepoScreen`, `SessionListScreen`, anything using `refreshWorkspace`/`readWorkspace`). The backend URL comes from `getBackendAddress(serverAddress)` in `settings.ts`.
- Result: opencode is no longer used for filesystem scanning anywhere. Verify with `grep -rn "client.file" src`.

## Task 3 — the explorer page + wire it to the repo menu

- New screen `FileExplorerScreen.tsx` + a `FileExplorer` route in `RootNavigator.tsx` (param: `{ repo: string; dir: string }`, and optionally a current sub-path for descending). Lists a directory via `/files/list`; tap a **directory** to descend (push a new route or keep an in-screen path stack), tap a **file** to open a viewer — for now a minimal read view (`/files/read`), the real viewer/IDE comes later.
- Style it like the rest: a native header (reuse `HeaderTitlePill` for the title, `EdgeBlurBars variant="top"` over the list), card/rows with `SystemIcon` (folder / doc icons), chevrons on directories.
- Wire the repo screen's **Files** menu item: in `RepoScreen.tsx` the menu rows have `onPress={() => {}}` — make the `Files` row `navigation.navigate("FileExplorer", { repo: name, dir })`.

## Done when
- `tsc` clean in both packages; no `client.file` references remain in the native `src`.
- From a repo screen, tapping **Files** opens the explorer, lists the repo dir, and descends into folders — served entirely by `:5195`.
- Repo/worktree discovery (Home's Repos/Workspaces list) still works, now via the vite backend.

Test against the live servers (`:5195` vite, over Tailscale `100.67.32.32:5195`). The other tracks (notifications) don't touch these files, so this is safe to run in parallel.
