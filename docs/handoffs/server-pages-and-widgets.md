# Server pages & widgets — plan

Add **Servers** as a first-class Home category (like repos), each with a **Server
page**, and extend the plugin system with **widgets**: a plugin can contribute a
widget to a server page that opens to the plugin's full page; a plugin with no
widget shows as a simple menu item. Widgets are **native** (not WebViews). First
users: a **UPS** plugin and an **internet-down** plugin.

This builds on the existing plugin/page system (`docs/handoffs/double-agent-repo-screen-and-plugin-system.md` §4, §22). Everything below is additive.

---

## 1. How the plugin system works today (so the plan is grounded)

**A plugin is an npm package** (keyword `doubleagent-plugin`; built-ins are the
same mechanism, `source: "built-in"`) with:

1. **A manifest** `doubleagent-plugin.json`: `id`, `name`, `version`,
   `description`, `icon`, the server entry (`main`), its **contributions**
   (pages, tools, commands, views, themes, settings), and **permissions**.
2. **Server code** — an **Effect module the backend runs on the Mac**, inside the
   extension host's worker (`packages/agent-console/src/server/plugin/registry.ts`,
   `extensionHost/`). This is where the real work happens (reading files, running
   processes, calling APIs). The app runs no plugin code by default.
3. **Pages**, each with a **requirement**.

**What the app sees** — `GET /plugins` → `InstalledPlugin[]` (`pluginsClient.ts`):
```
{ id, name, version, description?, icon?, source: "built-in",
  permissions: string[],
  pages: [{ id, title, icon?, requirement: "none" | "repo" | "file" }] }
```
So a plugin exposes **pages**, each declaring what it needs: `none` (stands
alone), `repo` (bound to a repo/worktree), or `file`.

**How a page is drawn** (`pagesClient.ts` / `PluginPageScreen` / `CollectionScreen`):
- The page is **declarative, server-driven, rendered natively** — the app fetches
  `fetchSections(apiBase, workspace, page, params)` → a `PageSections` tree of
  **blocks** (sections of rows, forms, links, menus) or `fetchCollection(...)` →
  grouped lists. The app draws these with its own native components; **no plugin
  JS runs in the app.** `workspace` is the binding (the repo/dir today).
- Rendering modes (§22.2): **default = native page kinds filled with data**;
  **opt-in = WebView pages** (bridge) or **opt-in = React Native pages** (bundled
  for built-ins; downloaded RN needs a Hermes spike, so it's later/third-party).

**Distribution** (§22.3–22.4): npm tarball, no `npm install`/scripts, scanned +
LLM-reviewed per version. Built-ins skip this.

**Current state:** the runtime + manifest + native pages exist; the **NPM
plugin** is the first built; binding is **repo-scoped**. There is no "server"
concept and no "widget" contribution yet — this plan adds both.

---

## 2. Servers as a first-class category

**Server identity:** `{ id, name, address }` — a name ("Mac mini") and an
address the app reaches it at (Tailscale IP / host). Stored like repos are
(persistence, §7). Localhost is the implicit default server.

**Home:** a new **Servers** section, rendered like the repos/sessions sections
(a row/card per server). Tapping a server → its **Server page**.

**Server page:** the dashboard for one server — a grid/list of the plugins bound
to it, each as a **widget** or a **menu item** (§3). Styled like the repo screen
(glass, the shared page header + title pill).

**New requirement scope — `"server"`:** pages gain `requirement: "server"`
alongside `none | repo | file`. A server-scoped page binds to a **server** rather
than a repo. The page/collection API, which takes `workspace` today, is
generalized to a **binding context** that is either a workspace (repo/dir) or a
**server** (its address); the plugin's server-side handler receives the server
context. (Exact plumbing in §7.)

**Binding:** which plugins appear on a server is an install/bind step, mirroring
repo binding (§4.3 of the system doc). Built-in UPS/internet-down bind to the
Mac mini server out of the box.

---

## 3. Widgets

A **widget** is an optional, native, compact view a plugin contributes for a
server page. **Rule:** if a plugin (for this server) declares a widget → render
the widget; otherwise → render a **menu item** (icon + title + chevron). Either
one, tapped, **opens the plugin's full page**.

**Contribution shape** — extend `InstalledPlugin.pages[]` (or a parallel
`widgets[]`) so a server-scoped page can carry:
```
widget?: {
  kind: "native" | "stat" | "gauge" | "status" | "sparkline",
  view?: string,        // for kind "native": a bundled native-widget id
  size?: "s" | "m" | "l",
  opensPage: string,    // the page id to open on tap
  // data-driven kinds carry their data the same way sections do (server-fed)
}
```

**Rendering — a widget registry (native):**
- **Default (data-driven):** small native widget **kinds** the app ships — `stat`
  (a number + label), `gauge`/`status` (value + state color), `sparkline` — that
  the plugin **fills with data** (same model as sections: server-fed, no plugin
  JS in app). Third-party plugins use these.
- **Opt-in (bundled native, for rich first-party widgets):** `kind: "native"`
  with a `view` id resolved against an **app-side widget registry**
  (`widgetId → React component`). Built-ins bundle their widget component (no
  download, no Hermes spike). The UPS widget is this.
- **Fallback:** no widget declared → a menu-item row.

**Widget opens the full page:** tapping navigates to `opensPage`. The full page
is a normal plugin page — declarative sections by default, or a **bundled native
page** (opt-in) resolved against an app-side **page registry**
(`pageId → React component`). UPS's full page is the bundled native
`ServerUpsScreen` (already built).

**Scope now:** widgets render **only on server pages** this phase. The widget
contribution + registries are written generically so repo/file pages can opt in
later — but the Server page is the only host wired up now.

**Live data:** widgets poll their own data (like `ServerUpsScreen` polls
`/api/ups`). The Server page mounts the visible widgets; each manages its refresh.

---

## 4. The UPS plugin (built-in)

- **Server module:** owns the UPS data — folds in today's `~/ups-monitor`
  (NUT `macosx-ups` + the monitor loop) and serves the `/api/ups` shape we built
  (status, charge, runtime, line/battery series, outages, stats, events) through
  the plugin's server endpoint. The LaunchAgents it manages are part of the
  plugin's server-side install.
- **Contributes:**
  - page `ups` (requirement `server`), **bundled native** = `ServerUpsScreen`
    (the full dashboard — charts, gauges, timeline, stats, events).
  - widget `ups` (kind `native`, `view: "ups"`, `opensPage: "ups"`): a compact
    live card — charge ring + status pill + line voltage — tapping opens `ups`.
- **Bound to** the Mac mini server by default.

## 5. The internet-down plugin (built-in — the external-setup one)

A plugin **because** it needs out-of-network setup, which it should own and guide
rather than leaving as manual steps.

- **Server module:** installs/manages the **heartbeat** (`netbeat` LaunchAgent)
  and holds the config (healthchecks ping URL, the device's Expo push token,
  enable/disable). Keeps the push token fresh from the registered tokens so a
  reinstall doesn't silently break alerts.
- **Contributes:**
  - page `internet` (requirement `server`): a **native form page** — ping URL,
    push token (auto-filled), enable toggle, a "send test" button, and the
    guided healthchecks webhook setup (the Expo POST body with the current
    token). Uses the existing native form page kind.
  - widget `internet` (kind `status`, data-driven): **Internet — up / down**,
    last-seen time; tap opens the config/status page. (Status comes from the
    last successful heartbeat; a true "down" alert still originates externally
    via healthchecks → Expo → APNs, as designed.)
- **Bound to** the Mac mini server.

Both reuse the APNs path we proved (external watcher → `exp.host` → APNs → app).

---

## 6. Registries & protocol changes

**Server side (`agent-console`):**
- A **servers registry** (list/add/remove; persisted) + `GET /servers`.
- `GET /plugins` gains server-bound plugins; `InstalledPlugin.pages[]` gains
  `requirement: "server"` and the optional `widget` field.
- The pages/collection API (`/pages…`) generalizes `workspace` → a binding
  context (`workspace | server`); plugin handlers receive the server.
- UPS + internet-down registered as built-in plugins in `PluginRegistry`.

**App side (`agent-console-native`):**
- **Servers Home section** + a **ServerScreen** (lists a server's widgets/menu
  items; routes `Server: { serverId }`).
- A **widget registry** (`widgetId → component`) and a **page registry**
  (`pageId → component`) for bundled native built-ins; `ServerUpsScreen` moves
  behind `pageId "ups"`, plus a new `UpsWidget`.
- A generic **Widget** renderer: native data-driven kinds, the registry for
  `kind: "native"`, menu-item fallback.
- Retire the temporary **Settings → Servers → UPS** shortcut once the Server page
  exists.

---

## 7. Build order (each phase ships something usable)

1. **Servers category + Server page shell** — servers registry + Home section +
   ServerScreen listing *menu items* (no widgets yet). UPS/internet-down appear
   as rows that open their pages. (Proves servers end-to-end.)
2. **UPS as a built-in plugin** — move `ServerUpsScreen` behind the page registry
   (`pageId "ups"`), fold `~/ups-monitor` into the plugin's server module. UPS
   opens from the Server page as a real plugin page.
3. **Widgets** — the widget contribution + registry + generic renderer; add the
   `UpsWidget` (live card). Server page shows the UPS widget; others still menu
   items.
4. **Internet-down plugin** — server module (heartbeat + config + token refresh),
   the native config/status page, and its `status` widget.
5. **Polish / later** — third-party (non-built-in) server plugins; widgets on
   repo/file pages; data-driven widget kinds for third parties.

## 8. Open decisions

- **Server identity source:** manual add (name + address) vs. discovery
  (Tailscale peers, Bonjour). Start manual; localhost auto.
- **Widget data transport:** each widget polls its plugin endpoint (simple, like
  `/api/ups`) vs. a unified `/widget/<id>/data` the Server page batches. Start
  per-widget polling.
- **Binding context plumbing:** generalize `workspace` in the pages API to
  `workspace | server`, or add parallel server-scoped endpoints. (Leaning:
  generalize, one code path.)
- **Widget size/layout:** fixed grid cells (per feedback: no measure-after-render)
  — one or two column, `size` picks the span.
