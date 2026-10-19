# Plugin file systems, Devices, editors, widgets, and the printer Live Activity

**Status:** design, 2026-10-19. Phase 1 (relay routes) is done in saturn-uploader `94107a3`. App work waits for the owner's go.
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

### Do not resurrect

- A merge of all of eta into iota to get the explorer: it brings 58 commits and native changes, and needs a new dev build.
