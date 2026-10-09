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

### A favorite is a page + its input

A page can take an **input** — the same page renders different content for
different inputs. That input is **part of what's favorited**, and part of its
identity:

- The **server page** can't be favorited without a server id — it needs one to
  have anything to render. Input = `serverId`.
- The **file browser** is the same: its input is the **location**. A file/folder
  favorite is the browser page bound to a location (repo + path).
- A **session** favorite is the chat page bound to a session id; a **repo**
  favorite is the repo page bound to a repo/workspace.

So a favorite = **(page, input)**, and *the input is what makes it unique*. The
same page favorited with different inputs gives distinct favorites — that's how
you pin many files, or several servers. Two favorites are the "same" only when
page **and** input match (dedup key). Some pages take no input (Home itself) and
simply aren't the kind of thing you favorite; a page that *requires* input can't
be favorited without it.

This is also the forward-compatible shape: a plugin page + its input becomes
favoritable later with no model change.

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

A favorite is a **(page, input)** pair (§"A favorite is a page + its input").
`page` is the kind; `input` is its identity-bearing parameters — concretely a
discriminated union now, generalizing to a `(pageId, input)` pair when plugin
pages become favoritable.

```
Scope        = "home" | `repo:${string}` | `server:${string}`

// page = kind; the remaining fields = that page's input.
FavoriteTarget =
  | { page: "session"; id }                       // chat page, input: session id
  | { page: "repo";    name }                      // repo/workspace page, input: repo
  | { page: "server";  id }                        // server page, input: server id
  | { page: "file";    repo; path; name }          // file browser, input: location
  | { page: "folder";  repo; path; name }          // file browser, input: location

Favorites: Scope → ReadonlyArray<FavoriteTarget>   // ordered; order is user-arrangeable (drag)
```

- **Identity / dedup key = (scope, page, input)** — same page + same input is the
  same favorite; different input is a distinct favorite (many files, many
  servers). Favoriting an already-favorited (page, input) in a scope is a no-op
  (or unfavorite, toggled).
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

1. **Base scoped favorites — foundation SHIPPED:** `src/favorites/`. Schema is
   the SSOT (`FavoriteTarget` per-page Struct union; `Scope` tagged union; one
   `Board` per scope); equality derived via `Schema.toEquivalence`; legacy flat
   list migrated into `home` immediately on first construction and discarded
   (store-level test). `useBoard`/`useIsFavorited`/`toggleFavorite` + a
   `FavoriteScope` context. RepoCard/SessionCard + Home rewired; behavior
   unchanged. **Next within this phase:** the remaining entry points — favorite a
   server (Servers section), favorite a file/folder (Files + Recents), and the
   Favorites boards on repo/server pages.
2. **Edit mode + drag (soon):** jiggle mode (hard-press-drag or ⋯ → Edit),
   reorder (store `reorder` already exists), drag-into-section, remove.

## 8. Implementation (Effect v4)

Logic in Effect, UI native — reusing the app's shipped store pattern.

- **Schema is the SSOT** (`model.ts`): its JSON codec persists favorites
  (`KeyValueStore.toSchemaStore`), and **equality is derived from it**
  (`Schema.toEquivalence`), not hand-written. `Scope` is a tagged union so
  illegal scopes are unrepresentable. Pure ops: `toggled` / `reordered` /
  `boardItems` / `isFavorited`.
- **Store** (`Favorites.ts`): `Context.Service` + `SubscriptionRef` +
  `Stream`; `toggle(scope,target)` / `reorder(scope,items)` persist through the
  schema store. **Migration** reads the legacy key, folds into the home board,
  `store.set` + `legacyStore.remove` in one go — immediate, then never read
  again. All read/write failures `Effect.logError`'d, never swallowed.
- **Bridge** (`useFavorites.ts`): the existing `startFavorites` +
  `useSyncExternalStore` mirror; `FavoriteScope` React context resolves "where
  you favorite from" per surface (default Home).
- **Exhaustiveness** guards correctness: Home's render switches over every
  `page`; adding a kind is a compile error until handled.
- **Not Effect, by design:** reanimated worklets + React render (native). The
  drag phase commits reorder through `store.reorder` only.
- **Tested:** `model.test.ts` (pure ops, identity, scope isolation, legacy fold)
  + `Favorites.test.ts` (store migration + discard + toggle against an in-memory
  `KeyValueStore`).

## 7. Resolved / open

- **Folder granularity — RESOLVED:** files/folders are *locations*, not pages, so
  there's no per-subfolder board; a file/folder favorite's scope is its owning
  **page** (the repo/workspace, or `home` from Recents). See "Pages vs.
  locations" above.
- Open: whether boards should accept cross-placement via edit-mode drag later
  (e.g. drag a repo-board file onto Home). Available once drag lands; not now.
