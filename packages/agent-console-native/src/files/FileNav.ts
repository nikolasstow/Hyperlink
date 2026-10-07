/**
 * Where Files is, per repo, as a browser keeps it: tabs, each with the
 * entries it has visited (folders or files) and which one it shows, so back
 * and forward walk them; the tab showing; and a history of everything opened
 * (the overview's history). Leaving Files and coming back returns to the same
 * tab and place. Opening something new in a tab drops what was ahead in it, as
 * a browser does. A new tab starts at the repo's root (its primary worktree);
 * a new root starts the repo over.
 *
 * Kept on the device (KeyValueStore), read back at launch. Decisions:
 * docs/handoffs/files-redesign-notes.md.
 *
 * @internal
 */
import { under } from "./pathForms";
import { Context, Effect, HashMap, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";

export const FileNavEntry = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["directory", "file"]),
});
export type FileNavEntry = typeof FileNavEntry.Type;

export const FileTab = Schema.Struct({
  id: Schema.String,
  entries: Schema.Array(FileNavEntry),
  index: Schema.Number,
});
export type FileTab = typeof FileTab.Type;

export const Visit = Schema.Struct({
  entry: FileNavEntry,
  at: Schema.Number,
});
export type Visit = typeof Visit.Type;

export const FilePlace = Schema.Struct({
  root: Schema.String,
  tabs: Schema.Array(FileTab),
  active: Schema.Number,
  history: Schema.Array(Visit),
});
export type FilePlace = typeof FilePlace.Type;

const Stored = Schema.Record(Schema.String, FilePlace);
const STORE_KEY = "places";
/** Visits kept in the history, newest first. */
const HISTORY_LIMIT = 200;

/** A tab's entry showing. */
export const tabEntry = (tab: FileTab): FileNavEntry | undefined => tab.entries[tab.index];
export const activeTab = (place: FilePlace): FileTab | undefined => place.tabs[place.active];
export const canGoBack = (tab: FileTab): boolean => tab.index > 0;
export const canGoForward = (tab: FileTab): boolean => tab.index < tab.entries.length - 1;

/** Opens an entry in a tab: after the current one, dropping what was ahead
 * (the same entry again is no step). */
export const opened = (tab: FileTab, entry: FileNavEntry): FileTab => {
  if (tabEntry(tab)?.path === entry.path) return tab;
  return { ...tab, entries: [...tab.entries.slice(0, tab.index + 1), entry], index: tab.index + 1 };
};

const newTabId = (): string => `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** A repo's place with one tab at its root. */
export const startedAt = (root: FileNavEntry): FilePlace => ({
  root: root.path,
  tabs: [{ id: newTabId(), entries: [root], index: 0 }],
  active: 0,
  history: [],
});

/** A place moved to another root (another worktree of the repo): its tabs
 * and history, the same files there (whatever is outside the old root left
 * as it is). */
export const rerooted = (place: FilePlace, root: FileNavEntry): FilePlace => {
  // Under the old root however either is written (`~/…` or in full).
  const moved = (entry: FileNavEntry): FileNavEntry => {
    const rest = under(entry.path, place.root);
    return rest === undefined ? entry : rest === "" ? root : { ...entry, path: `${root.path.replace(/\/+$/, "")}${rest}` };
  };
  return {
    ...place,
    root: root.path,
    tabs: place.tabs.map((tab) => ({ ...tab, entries: tab.entries.map(moved) })),
    history: place.history.map((visit) => ({ ...visit, entry: moved(visit.entry) })),
  };
};

/** One tab moved from worktree `from` to worktree `to`: its entries remapped
 * (the worktree root itself becomes `to`; a path under it keeps its relative
 * part there); whatever is outside `from` is left as it is. Used to switch a
 * single tab's worktree (the others stay). */
export const tabRerooted = (tab: FileTab, from: string, to: FileNavEntry): FileTab => {
  const base = to.path.replace(/\/+$/, "");
  const moved = (entry: FileNavEntry): FileNavEntry => {
    const rest = under(entry.path, from);
    return rest === undefined ? entry : rest === "" ? to : { ...entry, path: `${base}${rest}` };
  };
  return { ...tab, entries: tab.entries.map(moved) };
};

const withActive = (place: FilePlace, f: (tab: FileTab) => FileTab): FilePlace => {
  const tab = activeTab(place);
  if (tab === undefined) return place;
  const next = f(tab);
  return next === tab ? place : { ...place, tabs: place.tabs.map((each, index) => (index === place.active ? next : each)) };
};

const visited = (place: FilePlace, entry: FileNavEntry): FilePlace => ({
  ...place,
  history: [{ entry, at: Date.now() }, ...place.history.filter((visit) => visit.entry.path !== entry.path)].slice(0, HISTORY_LIMIT),
});

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Stored);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof Stored.Type => ({}))),
    Effect.catch((error) => Effect.logError("[files] the kept places could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  const state = yield* SubscriptionRef.make(HashMap.fromIterable(Object.entries(stored)));

  const save = (all: HashMap.HashMap<string, FilePlace>) =>
    store.set(STORE_KEY, Object.fromEntries(all)).pipe(Effect.catch((error) => Effect.logError("[files] saving the place failed", error)));

  /** Changes a repo's place (when it has one), then keeps every repo's. */
  const update = (repo: string, f: (place: FilePlace) => FilePlace) =>
    SubscriptionRef.updateAndGet(state, (all) =>
      Option.match(HashMap.get(all, repo), {
        onNone: () => all,
        onSome: (place) => HashMap.set(all, repo, f(place)),
      }),
    ).pipe(Effect.flatMap(save));

  return {
    /** Every repo's place, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Seeds a repo at `root` (its main worktree) when it has no place yet; a
     * repo that already has tabs keeps them (each tab holds its own worktree,
     * switched per tab via `rerootTab`). */
    ensureRoot: (repo: string, root: FileNavEntry) =>
      SubscriptionRef.updateAndGet(state, (all) => {
        const place = HashMap.get(all, repo);
        return Option.isNone(place) || place.value.tabs.length === 0 ? HashMap.set(all, repo, startedAt(root)) : all;
      }).pipe(Effect.flatMap(save)),
    /** Switches one tab's worktree: its entries move from `from` to `to`, the
     * other tabs untouched. */
    rerootTab: (repo: string, index: number, from: string, to: FileNavEntry) =>
      update(repo, (place) => ({ ...place, tabs: place.tabs.map((tab, each) => (each === index ? tabRerooted(tab, from, to) : tab)) })),
    /** Opens an entry in the tab showing. */
    open: (repo: string, entry: FileNavEntry) => update(repo, (place) => visited(withActive(place, (tab) => opened(tab, entry)), entry)),
    back: (repo: string) => update(repo, (place) => withActive(place, (tab) => (canGoBack(tab) ? { ...tab, index: tab.index - 1 } : tab))),
    forward: (repo: string) => update(repo, (place) => withActive(place, (tab) => (canGoForward(tab) ? { ...tab, index: tab.index + 1 } : tab))),
    /** Shows another tab. */
    select: (repo: string, index: number) =>
      update(repo, (place) => (index >= 0 && index < place.tabs.length ? { ...place, active: index } : place)),
    /** A new tab, showing `entry` (the root, from the overview's +), shown. */
    newTab: (repo: string, entry: FileNavEntry) =>
      update(repo, (place) => ({ ...place, tabs: [...place.tabs, { id: newTabId(), entries: [entry], index: 0 }], active: place.tabs.length })),
    /** Closes a tab; the last one closed leaves one at the root. */
    close: (repo: string, index: number) =>
      update(repo, (place) => {
        const tabs = place.tabs.filter((_tab, each) => each !== index);
        if (tabs.length === 0) return { ...place, tabs: [{ id: newTabId(), entries: [{ path: place.root, name: place.root.split("/").filter(Boolean).pop() ?? place.root, kind: "directory" }], index: 0 }], active: 0 };
        const active = index < place.active ? place.active - 1 : Math.min(place.active, tabs.length - 1);
        return { ...place, tabs, active };
      }),
  };
});

export class FileNav extends Context.Service<FileNav, Effect.Success<typeof make>>()("@doubleagent/files/FileNav") {
  static readonly layer = Layer.effect(FileNav, make);
}

/** Every repo's place as it changes, for React. */
export const fileNavChanges = Stream.unwrap(
  Effect.gen(function* () {
    const nav = yield* FileNav;
    return nav.changes;
  }),
);
