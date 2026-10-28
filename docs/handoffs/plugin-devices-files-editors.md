# Plugin file systems, Devices, editors, widgets, and the printer Live Activity

**Status:** 2026-10-28. Decisions 22–28 (3D models, real printer pages, file viewers from plugins, the `.goo` viewer) are new and not built yet, except the relay's mesher and `model.mesh` route (saturn-uploader `ed1c27c`, `a2fa9f4`) and a first 3D page (iota `3ab0485aa`). Earlier: relay routes (saturn-uploader `94107a3`), explorer and printer page redesign (iota `fb30d4e3b`).
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

**Status:** 2026-10-20. Built. The relay part is deployed (saturn-uploader `e975ec6`). The native part is in iota, not yet in a build.

- **Who pushes:** the relay, not the server on 5199 (owner). It holds its printer connection open for good, so it sees every print start. Code: saturn-uploader `src/LiveActivity.ts` (what to push, no IO), `src/RelayActivity.ts` (tokens, pushes, thumbnail), `src/Apns.ts` (JWT and HTTP/2).
- **Flow:** the app sends its push-to-start token to the relay. When a print starts, the relay sends a push-to-start (iOS 17.2+) with the slicer preview as a JPEG of 2 KB or less. iOS gives the activity an update token (iOS 18+), and the native code sends it to the relay without JavaScript. The relay pushes on each phase change and once a minute, and ends the activity when the print ends (it stays 15 minutes).
- **Content:** the thumbnail, the file name, the phase, layer N of M with %, a progress bar and the time left (both run on the phone from `startedAt` and `endsAt`), and the end time. Colours: the theme's primary colour (from the app group, `setActivityAccent`), and the system's green, orange, and red for states.
- **Dynamic Island (owner):** minimal shows only a printer icon. Compact shows the icon and the percentage (not a countdown, owner 2026-10-20). Expanded shows the thumbnail, the title, the percentage and phase, the bar, the layer, and the end time.
- **App code:** `targets/activity/PrinterActivityAttributes.swift` and `PrinterActivityWidget.swift`; `modules/live-activity/ios/PrinterActivityAttributes.swift` (the copy) and `PrinterActivityTokens.swift` (token forwarding from launch, through an AppDelegate subscriber); `setPrinterRelay` and `setActivityAccent` from `RootNavigator`.
- CAUTION: it is native code. App variants drop the Live Activity extension, so it needs the base build (`pnpm build:master`, an EAS build). Start builds without asking (owner).
- Not built: a Start button on the printer page. The relay starts the activity by itself.
- **Pictures (2026-10-20):** each update (every 30 s) carries the layer on the LCD (black and white PNG cropped to the model, 1.2 KB or less) and, only with the relay setting `activityCamera`, the camera (JPEG, 1.15 KB or less). The camera window follows the plate (`LiveActivity.cameraWindow`): small and close early, larger as the plate rises, the top part once done. Its calibration (`plateInFrame`) comes from one frame; check it against later frames.
- **Lock screen:** a header (glyph, title, time left), one row of tiles (thumbnail, layer on black, camera), the bar, and the details. Before the first update, the thumbnail beside the details.
- **Icon:** `PrinterGlyph` (template SVG in the widget's asset catalog): plate, arm, and a rectangular vat, the same drawing as the portal icon.
- **Update token:** the first build never sent one. The app now also reads `activity.pushToken` at launch and on each return to the app, and reports each step to the relay log (`POST /api/activity/log`, lines "Live Activity (phone): …").
- **Lost activity:** a reinstall ends the app's Live Activities, and the relay kept updating a dead one. The app now reports its running activities on each open (`POST /api/activity/running`), and the relay starts a new activity when its own is missing. A swiped-away activity also comes back on the next app open.
- **Exposure:** the printer reports no exposure setting over the LAN; changes on its screen or in Matrix never reach the file. Elegoo's cloud has it. Findings in saturn-uploader `docs/elegoo-cloud.md`. Timing the Exposing phase was rejected (owner: "could never be accurate").
- WARNING: on 2026-10-20 the printer froze at layer 760 of "base 7 + 8", 2 minutes after a relay restart left its camera stream open and a camera start went unanswered. The print was lost and the printer recorded no history entry. The relay now limits a camera start to 15 s, waits 2 minutes after a failure, and gives stream-off 3 s on shutdown. Do not restart the relay during a print while the camera is on.

## 8. Printer page redesign (owner, 2026-10-19)

- No bottom tab bar on the printer page. The header has buttons at the top right: Files, Health, and Settings.
- With a print running, the page opens to the print. With no print, it opens to Files.
- The Camera page goes. The layer view becomes a pager: page 1 is the layer, page 2 is the camera. Swiping may wrap around (infinite). The page remembers which one the owner left it on.

## 9. State and next steps (handoff, 2026-10-19)

Work moves to the Mac mini: start the next Claude Code session there, in the home folder (`~`), where the session memory is.

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
3. Live Activity (section 7). Built; needs the base build (`pnpm build:master`).
4. Devices, then widgets (sections 6).
5. Port the explorer to eta (its `FileListing` adds a `header` prop; merge iota or cherry-pick).

### Open items for the owner

- The LaunchDaemon for the relay (`service/macos/install.sh`, needs sudo once).
- The release film was at 69,716 of 60,000 cycles.
- The printer's history shows the last three base 1 runs stopped with "Foreign object found".

## 10. 3D models, the `.goo` viewer, and real printer pages (2026-10-28)

**Status:** built overnight, deployed on the relay, in EAS build (see the session report). Nobody has seen the app part on a device yet.

### Relay (saturn-uploader `feat/relay-portal`, `d53d932`, `aa22185`)

- `src/LayerMesh.ts`: a `.goo` to a 3D model. Voxels of about 0.1 mm, streaming surface nets, meshoptimizer. Two levels from one pass: `low` (at most 200,000 triangles, about 3 MB) and `high` (at most 2,000,000, about 30 MB). All levels share one frame (the model's bounds), so a client swaps them in place. Format `SLMS` v1 (module doc).
- The relay builds models in a `nice` child process (its own `mesh` command), so it stays quick (measured: under 1 ms per request while it builds). Models come only from a local copy.
- Routes: `GET /api/prints/<taskId>/model.mesh?level=low|high`, `GET /api/files/model.mesh?path=&level=`, `GET /api/files/layers.pack?path=`. 202 with progress while it builds, 503 after a failed build or with no local copy.
- `src/PrintPrep.ts`: every `.goo` on the printer (onboard and USB, two folder levels) gets a local copy, a pack, and a model ahead of time. Copies from the printer only while it is idle, 4 MiB reads with 250 ms between them, stops at once when the printer becomes busy. Runs 2 minutes after start, then every 10 minutes.

### App (iota `feat/elegoo-printer-plugin`, `d32441634`)

| Part | Where |
|---|---|
| File viewers from plugins, by file type; every explorer page asks first | `src/viewers/fileViewers.ts`; hosts: `printer/PrinterFiles.tsx`, `files/FileListing.tsx` |
| The `.goo` viewer (printer plugin): thumbnail, then the low model, then the high model in place; a glass panel (SwiftUI sheet, detents 150 pt, medium, large, background interaction up to medium) with colour, cut through, print settings, Print | `printer/gooViewer.ts`, `printer/GooViewerScreen.tsx` |
| Model colour: Apple's colour picker, resin swatches, back to the theme's colour; one colour for all models, kept on the phone | `printer/modelColor.ts` |
| Cut through: two grabbers pick a layer range; a SceneKit fragment shader hides the rest and darkens inner walls (checked off-screen on macOS) | `printer/LayerRange.tsx`, `modules/model-viewer` |
| Model downloads by print or by path, per level; quick views of every printer file at app open, foreground, every 2 minutes | `printer/printModel.ts`, `printer/relayDownload.ts`, `printer/layerPack.ts` |
| Model card above Print settings: progress of both levels, Open | `printer/ModelCard.tsx` |
| Files, Health, Settings as real pages from rows at the end of the printer page; they share its one live link | `printer/PrinterPages.tsx`, `printer/printerPageLink.ts` |

### Open

- The high level is about 30 MB per print; not yet tried over Tailscale on the phone.
- Peak mesher memory grows with the print's detail (2.1 GB for the 782 MB legs file).
- Cut through is by layer range only; no cap face on the cut.

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

### 2026-10-20

15. The Live Activity shows the slicer thumbnail, a progress bar, and the main details. No layer or camera images for now (owner).
16. The relay sends the Live Activity pushes and keeps its printer connection open for good: "a server never sleeps" (owner).
17. Dynamic Island: a printer icon alone in the minimal form; the time left only where the icon and the time both fit (owner).
18. The relay may delete printer files (Finder drive) and start prints (UVtools' Print request) (owner, 2026-10-19).
19. The Live Activity shows the layer and the camera on the lock screen (owner). The camera picture keeps the full height and drops the sides; the window follows the plate (owner).
20. Dynamic Island icon: the portal's printer drawing with a rectangular vat, in the portal icon too (owner).
21. After the freeze, camera pictures in the Live Activity are off until the camera code is proven (`activityCamera`).

### 2026-10-28

22. The relay makes a 3D model of each `.goo` (saturn-uploader `src/LayerMesh.ts`, `GET /api/prints/<taskId>/model.mesh`). It makes at least two resolutions in one pass; the phone shows the low one first and swaps to the high one in place (owner). The 600,000-triangle cap was only ours.
23. The 3D model gets a card on the printer page, above Print settings: it shows the model's progress, then a button that opens the model, and it keeps showing the high resolution's progress (owner). No header button for it.
24. Printer pages are real pages on the navigation stack: Files, Health, and Settings open as their own pages, and the back button returns to the main printer page. No buttons at the top right of the printer page, so that space is free for other things (owner). This replaces decision 12.
25. File viewers and editors come from plugins and say which file types they take. Any place that uses the explorer gets every viewer and editor (owner). The explorer can show one plugin's file system, for example the printer and its storage (owner, as in decisions 1 and 3).
26. The printer plugin adds a `.goo` viewer like Apple Maps: the main view starts with the slicer thumbnail and shows the progress of the 3D model, then shows the model; a sliding glass panel holds the print details (owner).
27. The relay processes every `.goo` on the printer in the background, so the viewer never waits long (owner).
28. Lower priority: in the 3D view, two grabbers pick a layer range (for example 500 to 4,000), and the model is cut at those heights to show the inside (owner).

### Do not resurrect

- A merge of all of eta into iota to get the explorer: it brings 58 commits and native changes, and needs a new dev build.
