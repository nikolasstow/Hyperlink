# Plugin file systems, Devices, editors, widgets, and the printer Live Activity

**Status:** 2026-10-19. Relay routes done (saturn-uploader `94107a3`). Explorer and printer page redesign done in iota (`fb30d4e3b`), not yet seen on a device. Next: the editor (section 9).
**Scope:** a shared file explorer that plugins can give a file system to, Devices as a kind of server plugin, file editors from plugins, widgets with an edit mode, and a printer Live Activity.
**Related:** [elegoo-printer-plugin.md](./elegoo-printer-plugin.md) · [server-pages-and-widgets.md](./server-pages-and-widgets.md) · [double-agent-repo-screen-and-plugin-system.md](./double-agent-repo-screen-and-plugin-system.md) §22 · [files-explorer-spec.md](./files-explorer-spec.md)

## 0. Confirm before acting

This handoff is not a go. Before you change code from it, list the concrete
actions you will take and wait for the owner to confirm them
(`confirm-handoff-actions` in [working-agreement.md](../standards/working-agreement.md)).

## 1. Review standards

Read [`docs/standards/`](../standards/) before you edit, above all
`no-backward-compat` (move every call site, no shims), `error-handling`, and
`types-and-naming` (no `as`; decode network data with `Schema`).

## 2. Build order (owner, 2026-10-19)

1. File explorer: the shared explorer, the files-v1 source, and the printer's Files page on it.
2. Editor: the form editor (Save, Save As, Print).
3. Live Activity for the printer.
4. Devices, then widgets and edit mode (widgets are the lowest priority).

## 3. The shared explorer

- `src/explorer/` holds it. A `FileSource` gives roots (the tabs), `list(path)`, and optional thumbnails, details, actions (menu items), marks, recent files, and writes (upload, new folder, where a save can go).
- `<Explorer source mode="browse" | { pick: "folder" }>` draws any source. Pick mode is the folder picker for Save As.
- The repo's Files screen is one source (favorites, Keep On Device, unsaved dots become its actions and marks). The old `FileListing` and `useFileTree` go; their call sites move in the same change.
- The explorer home is customizable. For the printer it shows the storage toggle (Printer, USB drive, Home server), then Recent prints, then the files. The order of these sections is data, so edit mode (section 6) can change it later.

## 4. File systems from plugins: the files-v1 contract

A plugin declares `fileSystems: [{ id, title, endpoint }]`. The endpoint answers:

| Route | Use |
|---|---|
| `GET /api/files/roots` | The tabs: `id`, `title`, `path`, `available`, `reason`, `saveInto` (`anywhere`, `top`, `none`), `newFolder`. |
| `GET /api/files?path=` | One folder: entries with `name`, `path`, `kind`, `size`, `printable`, `printing`, `lastPrint`. |
| `GET /api/files/preview.png?path=` | A thumbnail. |
| `GET /api/files/info?path=` | Details. |
| `GET /api/history?perFile=1` | Recent files (for the printer: recent prints, with `exists`). |
| `POST /api/uploads`, `POST /api/files/folder`, `POST /api/files/save` | Writes. |
| `GET /api/files/form`, `POST /api/files/check` | The form editor (section 5). |

One adapter in the app turns any files-v1 endpoint into a `FileSource`. The printer relay is the first endpoint.

## 5. File editors from plugins

- A plugin declares `editors: [{ id, title, match: { extensions }, kind: "form" }]`. The explorer opens a matching file in its editor and offers Open With. Other files open in the file view.
- A form editor works for any plugin: the server sends the fields, sections, and values (`/api/files/form`), checks changes and gives a summary such as the new print time (`/api/files/check`), and saves (`/api/files/save`). Save As uses the explorer in pick mode. A device editor can offer Print.

## 6. Devices and widgets

- A plugin declares `devices: [{ id, kind, title, subtitle, icon, endpoint, page, widget?, fileSystem?, editors? }]`. One `Device` route replaces the fixed `ENTRIES`, the `ServerUps` and `ServerPrinter` routes, and the fixed ports. The UPS and the printer are the first devices. Step 1 keeps the list in the app; step 2 the server sends it (`GET /servers/:id/devices`).
- Widgets: Home, Server, Repo, device pages (and the explorer home) get Edit Page in the 3-dot menu: drag to reorder, remove, resize (S, M, L), and + opens a gallery of the widgets that fit the page. Built-in content becomes widgets too. Layouts are stored per page, on the phone first.

## 7. Printer Live Activity

- One Live Activity type for any device: title, status, detail, progress, end time. For a print: file name, status, layer N of M, progress, and a countdown the phone runs itself.
- The server starts it with a push-to-start when a print starts (iOS 17.2+), and the printer page has a Start button. Pushes go on each status change and about once a minute, through `activityPush.ts`. It ends on finish or stop.
- CAUTION: it is native code. App variants drop the Live Activity extension, so it needs the base build (`pnpm build:master`, an EAS build) and a change to the server on 5199.

## 8. Printer page redesign (owner, 2026-10-19)

- No bottom tab bar on the printer page. The header has buttons at the top right: Files, Health, and Settings.
- With a print running, the page opens to the print. With no print, it opens to Files.
- The Camera page goes. The layer view becomes a pager: page 1 is the layer, page 2 is the camera. Swiping may wrap around (infinite). The page remembers which one the owner left it on.

## 9. State and next steps (handoff, 2026-10-19)

Work moves to the Mac mini: start the next session there (`~/Coding`).

### Where things are

| What | Where |
|---|---|
| Relay repo | `~/Coding/saturn-uploader`, branch `feat/relay-portal`. Push to GitHub after each commit (owner rule). The mini clone has 11 extra merge commits with the same tree as `origin/feat/relay-portal`; resetting it to origin loses nothing, but ask the owner first. |
| Relay process | tmux `saturn-relay` runs `~/.local/share/saturn-uploader/relay-loop.sh`. To deploy: `pnpm -s build`, check `GET /api/uploads` has no running job, then `pkill -f "^/usr/local/bin/node dist/main.js relay"`. The old process can take up to a minute to exit; the loop starts the new one 5 s after. |
| App worktree | `~/Coding/Hyperlink/worktrees/iota`, branch `feat/elegoo-printer-plugin`: commits `9dfcfe7d5`, `5252c09aa`, `fb30d4e3b`. Not pushed: ask the owner before a push. |
| Metro for iota | tmux `iota-metro`, port 8083. Dev client link: `doubleagentiota://expo-development-client/?url=http%3A%2F%2F100.67.32.32%3A8083`. |
| Dev build | EAS build `cf9744f5-c488-4f80-8c51-731744178b98` (variant iota, bundle id `com.nikolasstow.agentconsolenative.iota`). |
| Pairing | `cd packages/agent-console && AGENT_CONSOLE_API_PORT=5199 AGENT_CONSOLE_STATE_DIR=~/Coding/Hyperlink/worktrees/epsilon/packages/agent-console/.agent-console pnpm -s pair` (in iota). A code works once, for 20 minutes. The main server on 5199 runs from epsilon. |
| Parked relay work | `~/Coding/saturn-research/parked/print-finished-notice.patch` (Print Finished push through DoubleAgent). Base `10e7373`; `git apply -3` gives conflicts in `src/Cli.ts` and `src/Relay.ts`. Low priority. |

### Done on 2026-10-19

1. Relay: `GET /api/history` (Cmd 320, 321; `perFile=1` for recent prints with `exists`), `lastPrint` on printer files, `GET /api/files/roots`, `GET /api/files/form`, `POST /api/files/check`. 161 tests pass. Deployed and checked live: 38 history records.
2. App: `src/explorer/` (`FileSource`, `useSourceTree`, `sourceRows`, `Explorer`, `ExplorerHome`, `httpFileSource`), the repo Files listing on it (`files/repoSource.ts`; `fileTree.ts` removed), and the printer page redesign (section 8, decision 14). tsc (both configs), eslint, and 415 app tests pass; Metro builds the iOS bundle.

### Not verified

- Nobody has seen the new printer page or the repo listing on a device. The Mac mini has no CocoaPods, so there is no simulator build of the variant. The owner checks it on the phone first.
- Header button badges show on iOS 26 only.
- The pager's wrap (a strip of four pages) is untested with fast swipes.

### Next, in order

1. The owner pairs the iota app and checks the printer page and the repo Files listing.
2. Editor (build order item 2): a form editor drawn from `GET /api/files/form`, checked live with `POST /api/files/check` (errors and the new print time), saved with `POST /api/files/save` (Save, Save As, Print, overwrite with a confirm). Save As uses `Explorer` in `PickFolder` mode over the relay roots, with `saveInto` (`Top` on the printer, `Anywhere` on the home server, a name field, New folder). Add Send and Print for Home server files (`/api/files/save` with `destination: /local/<name>`, `start: true`). The portal's editor (`saturn-uploader/portal/index.html`) shows the flows the owner already approved.
3. Live Activity (section 7). Native: needs the base build and a change to the server on 5199. Ask before the EAS build (metered).
4. Devices, then widgets (sections 6).
5. Port the explorer to eta (its `FileListing` adds a `header` prop; merge iota or cherry-pick).

### Open items for the owner

- The LaunchDaemon for the relay (`service/macos/install.sh`, needs sudo once).
- The release film was at 69,716 of 60,000 cycles.
- The printer's history shows the last three base 1 runs stopped with "Foreign object found".

## DECISIONS

### 2026-10-19

1. A plugin can give the explorer its own file system (owner).
2. Devices are a kind of server plugin; the UPS and the printer are devices (owner).
3. A plugin can add a file reader or editor (owner).
4. Widgets with an edit mode from the 3-dot menu of Home, Server, Repo, and other pages, with a gallery to add widgets (owner). Lowest priority (owner).
5. The explorer home is customizable; for the printer: the Local/USB toggle, then recent prints (owner).
6. A Live Activity for the printer (owner).
7. Build order: explorer, editor, Live Activity (owner).
8. The explorer is built in iota (`feat/elegoo-printer-plugin`): it is JavaScript only, so the iota dev build can test it through Metro. Eta takes it later; its list core differs only by a `header` prop.
9. No compatibility wrapper for the old listing API (`no-backward-compat`): every call site moves with the change.
10. The iota app pairs with the main server on 5199 (epsilon, trunk). The seven trunk commits iota lacks are native Dubz changes.
11. Print history comes from the printer (Cmd 320, 321). A finished print's record never changes, so the relay asks for it once. Recent prints are the newest print of each file.
12. Printer page: no bottom bar; Files, Health, and Settings buttons at the top right; opens to Files when no print runs (owner).
13. The camera is page 2 of a pager on the layer view, not its own page. The pager remembers the last page; it may wrap around (owner).
14. Every colour on the printer page follows the user's theme: the accent is the theme's primary colour, states use the system's green, orange, and red. Only the LCD stays dark (owner).

### Do not resurrect

- A merge of all of eta into iota to get the explorer: it brings 58 commits and native changes, and needs a new dev build.
