# Extension installation, server sync, and theming

Status: **largely shipped.** The backend is an off-vite Effect `HttpApi` served by
`@effect/platform-node`'s `NodeHttpServer` (`packages/agent-console`, `pnpm serve`,
port `AGENT_CONSOLE_API_PORT` default **5199**) — NOT a vite plugin. Shipped:
marketplace-URL install, local discovery + import (scans `~/.<ide>[-server]/extensions`
and app-bundle built-ins, resolves NLS, filters to theme/icon contributors),
list/remove, per-color-theme derived primary/secondary, the synced `config`
document, device-local theming with server sync (ThemeSync), the Extensions
screen (install/import/remove) and the Appearance screen (enable a theme + colour
pickers). Not yet: file upload (needs a build), theme-driven code highlighting
(see Follow-ups). The sections below are the original plan; where they say "vite
adapter" / ":5195" read "Effect HttpApi / NodeHttpServer / :5199".

## Goal

Let the user install VS Code extensions and extract from them whatever makes a
good mobile experience — starting with **icon themes** and **color themes** (the
easy wins), with room for more later. Installed extensions and the active theme
are stored **on the server** so multiple devices stay in sync, and cached
on-device so the app works offline and paints instantly.

This is the concrete realization of the "extract from VS Code extensions" north
star (see the Seti file-icon work already shipped: `scripts/gen-seti.py` →
`src/setiIcons.ts`, rendered by `SetiIcon`).

## What "an extension" is

A VS Code extension is a `.vsix` — a ZIP containing `extension/package.json`
plus assets. The `contributes` block declares what it adds. We care initially
about:

- `contributes.iconThemes[]` → `{ id, path }` — a JSON icon theme (+ a font or
  SVGs) like Seti. Extract to the same shape as `setiIcons.ts`.
- `contributes.themes[]` → `{ label, uiTheme, path }` — a color theme JSON whose
  `colors` / `tokenColors` we map onto our theme (primary/secondary to start;
  see Theming below).

Everything else in `contributes` is ignored for now (documented as future work).

## Two install paths

1. **Marketplace URL** (no new native dep, works in the current binary).
   The user pastes a marketplace link or `publisher.name`. The **server**
   downloads the `.vsix` (the app never does — keeps the bytes off the phone and
   centralizes the cache):
   - Resolve `publisher`, `name`, `version` from the URL
     (`https://marketplace.visualstudio.com/items?itemName=publisher.name`) or
     the `publisher.name` shorthand.
   - Download:
     `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{name}/{version}/vspackage`
     (latest version resolvable via the gallery `extensionquery` POST API).
     Response is gzipped; handle the encoding.
2. **File upload** — the user picks a `.vsix` on the device and uploads it to the
   server. **Requires `expo-document-picker` (a native module) → an EAS build.**
   Until that build ships, the URL path is the only one wired.

Both land at the same server endpoint, which stores the raw `.vsix` and the
extracted assets.

## Server (packages/agent-console)

New Effect core + a thin vite adapter, following the existing plugin pattern
(`src/server/*Plugin.ts`, cores server-agnostic — no vite/opencode leakage).

- **Dependency:** a zip reader (e.g. `unzipit`/`fflate` — pure-JS, no native
  build) to read `package.json` and asset entries out of the `.vsix`. Not
  currently a dependency; add it.
- **`extensionsStore` (Effect core):**
  - `install({ vsix bytes })` → unzip, parse `contributes`, extract supported
    contributions, persist under a store dir (raw `.vsix` + extracted JSON/font
    assets + a manifest row). Return the manifest.
  - `installFromMarketplace(ref)` → download then `install`.
  - `list()` / `remove(id)` / `get(id)`.
  - Persistence: on disk (a store dir), so it survives restarts and is shared by
    every device hitting this server. Keep it a plain Effect service with a
    filesystem-backed store — mirror `fs.ts`/`log-storage` patterns.
- **Config/sync store (Effect core):** a small server-side JSON document holding
  `{ theme, activeIconTheme, activeColorTheme, installedExtensionIds }`.
  `get()` / `put(patch)`, last-write-wins (a `revision` counter is enough; no
  real-time collab needed). This is the sync source of truth.
- **Routes (vite adapter):**
  - `GET /extensions`, `POST /extensions/install` (url OR uploaded bytes),
    `DELETE /extensions/:id`, `GET /extensions/:id/asset/*` (serve extracted
    assets to the client).
  - `GET /config`, `PUT /config`.
  All curl-testable on `:5195` before any device work.

## Client (packages/agent-console-native)

- **Sync:** on launch and on focus, `GET /config`; merge server → local
  (AsyncStorage) with last-write-wins by revision. On any local change (theme
  pick, install/remove), `PUT /config`. Theme already lives in a context
  (`src/theme.tsx`) + `settings.ts` — extend it to hydrate from and push to the
  server rather than device-only.
- **Extensions screen** (new, under Settings): installed list (name, publisher,
  what it contributes), install-from-URL field, and — once the build with
  `expo-document-picker` ships — an upload button. Remove per row.
- **Applying themes:** an installed **icon theme** feeds the same resolver shape
  as `setiIcons.ts` (`byName`/`byExt`/glyph or SVG assets). A **color theme**
  maps onto the theme colors (see below). Selecting one sets it active in config.

## Theming (shipped slice + extension slice)

**Shipped (device-local):** `src/theme.tsx` — a `ThemeProvider` with `primary`
and `secondary`, persisted via `settings.ts` (`getStoredTheme`/`setStoredTheme`),
edited in Settings → Appearance. `primary` drives the send button + chat-bubble
tint; `secondary` drives the unread dot / repo unread pill. Defaults are the
current green/blue.

**Next:**
- Move theme persistence onto the server config store (above) so it syncs.
- Derive `primary`/`secondary` (and later a fuller palette) from an installed VS
  Code **color theme**: map its `colors` keys — e.g. `button.background` /
  `activityBarBadge.background` — onto our primary/secondary, per light/dark
  variant. Start with just the two we use; widen as we theme more surfaces.

## Open questions

- Auth on the server routes — the backend is currently unauthenticated on the
  LAN/Tailscale; extension install writes to disk, so decide whether it needs
  Better Auth before exposing beyond Tailscale.
- Icon-theme fonts: some themes ship `.woff`; iOS can't load WOFF, and we render
  Seti as SVG paths (converted offline). For arbitrary uploaded themes we'd need
  runtime WOFF→SVG/TTF — likely do the conversion server-side at install.
- Version pinning / updates for marketplace extensions.

## Follow-ups (requested, not yet built)

- **Theme-driven code display.** Everywhere we render code — chat markdown code
  blocks (`Markdown.tsx`) and the future file viewer/editor — should syntax-
  highlight using the active theme's `tokenColors` (and editor background/
  foreground), not a fixed scheme. This needs a tokenizer (a TextMate-grammar or
  a lighter highlighter) fed the active color theme's `tokenColors`; the server
  already stores the theme JSON, so expose the token colors (like it derives
  primary/secondary) or serve the theme asset. Monokai etc. keep their vivid
  colors in `tokenColors`, so this is where those actually show up.
- **File upload of a `.vsix`** — multipart install endpoint + a build that
  bundles `expo-document-picker`.

## Code highlighting — decisions (shipped: on-device Shiki + Appearance demo)

- **Engine: Shiki on device**, using its **JavaScript regex engine** (no
  oniguruma WASM — Hermes has no WASM runtime). Not the fastest raw option
  (native tree-sitter > WASM oniguruma > CodeMirror/Lezer-in-WebView > Shiki-JS >
  highlight.js), but the viable + VS-Code-accurate one that reuses our imported
  themes' `tokenColors`. Fine for read-only display with caching + virtualization.
- **Shiki is the single highlighting source of truth.** Native display (chat,
  file viewer) tokenizes with Shiki; the eventual **editor is Monaco-in-WebView
  themed via `@shikijs/monaco`** — same theme + TextMate grammars, so display and
  edit render identically. A view↔edit switch is one Monaco instance toggled
  `editable` → seamless, no engine swap.
- **Caching (codeCache.ts):** memory + AsyncStorage, keyed by hash(code+lang+
  theme). Reopening a file/app and fast scrolling read from cache; tokenization
  happens once. (Large files later: tokenize + virtualize per viewport.)
- **Themes do NOT include fonts.** VS Code *color* themes define colors +
  `tokenColors` (foreground + fontStyle = italic/bold/underline only). The code
  typeface is our choice (currently Menlo). Only *icon* themes ship a font (the
  glyph font, e.g. Seti), unrelated to code.
- **Future: live collaborative editing** (agents live-editing, streaming edits,
  multiple devices on the same file) → CRDT via **Yjs**, bound to the editor
  (`y-monaco` / `y-codemirror.next`). Firms up the editor-engine choice toward
  one with mature Yjs bindings (Monaco or CodeMirror 6).
