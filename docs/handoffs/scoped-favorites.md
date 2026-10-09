# Scoped favorites + drag-to-favorite

Favorites in agent-console-native, redesigned to be **scoped** (where you
favorite from determines where it lands) and, soon, **arrangeable by drag** like
the iOS Home Screen. Native only.

Related: [server pages & widgets](./server-pages-and-widgets.md) (servers are a
favoritable kind; the server page gets its own favorites board).

## 1. The core idea

A favorite belongs to a **scope** — the surface you favorited it on. Each scope
has its own Favorites board:

| Favorite from… | Lands in scope… | Shows on… |
|---|---|---|
| Home | `home` | Home's Favorites section (top of Home) |
| A repo/project page | `repo:<name>` | that repo page's Favorites section |
| A server page | `server:<id>` | that server page's Favorites section |
| Inside a page (e.g. a file in Files) | its immediate parent page's scope (the repo/workspace) | that parent page |
| A file/folder in Home's **Recents** | `home` | Home's Favorites section |

"Where you favorite it matters." Favoriting is **per-scope and independent** —
the same session can be a Home favorite *and* a repo favorite; its star reflects
membership *in the current scope*.

### Pages vs. locations

A **page** is an application surface — Home, a repo/workspace, a server. Pages
are what have Favorites boards; a scope is always a page.

A **location** is something you *browse*, not a page. The File browser works like
a web browser: files and folders are locations (like URLs), not application
pages — so **they have no board of their own**. A file/folder favorite is a
pointer to a location, and its scope is its **owning page**: the repo/workspace
it lives in (or `home`, when favorited from Home's Recents). This is why drilling
into a subfolder doesn't create a new board — a subfolder is a location, not a
page.

## 2. What's favoritable

session · repo · server · **file · folder** — anything that appears on a surface.
Home's board can hold all of them; repo boards hold what's in that repo; server
boards hold their services.

**Scope follows the surface, uniformly — no special cases.** For files/folders:
- A file or folder favorited **in the Files/explorer view** → that
  **repo/workspace** scope (the project it lives in).
- A file favorited **on Home** — hard-press on a file in **Recents** → **`home`**.

So a file/folder reaches the Home board by being favorited from Home's Recents
(or, later, dragged there in edit mode); otherwise it lives on its project's
board. Favoriting a file/folder from Files **does not** put it on Home.

## 3. Two ways to favorite

**A. Context menu (now).** Hard-press an item → its menu has Favorite /
Unfavorite, toggling membership in the resolved scope (§1, with the file/folder →
home exception in §2). Fast, no mode.

**B. Drag + edit mode (planned — soon, not now).** The iOS Home Screen model:
- Enter **edit ("jiggle") mode** by hard-press-and-drag on an item, or via the
  surface's **overflow (⋯) menu → Edit**.
- In edit mode everything jiggles; you can **drag an item into a Favorites
  section** to add it (scope = that section), **drag to reorder** within a board,
  and **drag out / tap ⊝ to remove**.
- Hard-press-and-drag starts a drag immediately (the quick path); the ⋯ → Edit
  path is the discoverable one.
- This is how boards get **arranged** and how cross-placement happens where a
  context menu can't reach.
- RN: `react-native-gesture-handler` + `react-native-reanimated` draggable
  grid/list with a drop target per Favorites section; **fixed cell sizes** (no
  measure-after-render), consistent with the layout rules.

## 4. Data model

```
Scope        = "home" | `repo:${string}` | `server:${string}`
FavoriteTarget =
  | { kind: "session"; id }
  | { kind: "repo";    name }
  | { kind: "server";  id }
  | { kind: "file";    repo; path; name }
  | { kind: "folder";  repo; path; name }

Favorites: Scope → ReadonlyArray<FavoriteTarget>   // ordered; order is user-arrangeable (drag)
```

- Persisted (AsyncStorage, as favorites are today).
- **Migration:** the current flat favorites list folds into the `home` scope.
- Order within a scope is the board order (drag reorders it once edit mode lands;
  until then, append on favorite).

## 5. Rendering a board

A Favorites section renders each target with the right native card/row:
- session → `SessionCard`, repo → `RepoCard`, server → `ServerCard`,
  file/folder → a file/folder row that opens Files at its path.
- Home's board mixes kinds; repo/server boards usually hold fewer kinds.
- Home's Favorites section stays **above everything else** on Home.

## 6. Build order

1. **Base scoped favorites (buildable now):** model with scope + the new kinds +
   migration into `home`; context-menu Favorite on each surface with scope
   resolution (incl. file/folder → home); Favorites sections on Home / repo /
   server that render all kinds. No drag, no mode.
2. **Edit mode + drag (soon):** jiggle mode (hard-press-drag or ⋯ → Edit),
   reorder, drag-into-section, remove. Reorder persists board order.

## 7. Resolved / open

- **Folder granularity — RESOLVED:** files/folders are *locations*, not pages, so
  there's no per-subfolder board; a file/folder favorite's scope is its owning
  **page** (the repo/workspace, or `home` from Recents). See "Pages vs.
  locations" above.
- Open: whether boards should accept cross-placement via edit-mode drag later
  (e.g. drag a repo-board file onto Home). Available once drag lands; not now.
