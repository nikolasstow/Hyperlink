/**
 * Where Files is, per repo, as a browser keeps it: the entries visited (a
 * folder or a file) and which one is showing, so back and forward walk them
 * and leaving Files and coming back returns to the same place. Opening
 * something new drops what was ahead, as a browser does. The first entry is
 * the repo's root (its primary worktree); a new root starts the history over.
 *
 * Kept on the device (KeyValueStore), read back at launch. Decisions:
 * docs/handoffs/files-redesign-notes.md.
 *
 * @internal
 */
import { Context, Effect, HashMap, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";

export const FileNavEntry = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["directory", "file"]),
});
export type FileNavEntry = typeof FileNavEntry.Type;

export const FileNavState = Schema.Struct({
  entries: Schema.Array(FileNavEntry),
  index: Schema.Number,
});
export type FileNavState = typeof FileNavState.Type;

const Stored = Schema.Record(Schema.String, FileNavState);
const STORE_KEY = "nav";

/** The entry showing. */
export const currentEntry = (state: FileNavState): FileNavEntry | undefined => state.entries[state.index];
export const canGoBack = (state: FileNavState): boolean => state.index > 0;
export const canGoForward = (state: FileNavState): boolean => state.index < state.entries.length - 1;

/** Opens an entry: after the current one, dropping what was ahead (the same
 * entry again is no step). */
export const opened = (state: FileNavState, entry: FileNavEntry): FileNavState => {
  if (currentEntry(state)?.path === entry.path) return state;
  return { entries: [...state.entries.slice(0, state.index + 1), entry], index: state.index + 1 };
};

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Stored);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof Stored.Type => ({}))),
    Effect.catch((error) => Effect.logError("[files] the kept places could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  const state = yield* SubscriptionRef.make(HashMap.fromIterable(Object.entries(stored)));

  /** Changes a repo's place (when it has one), then keeps every repo's. */
  const update = (repo: string, f: (current: FileNavState) => FileNavState) =>
    SubscriptionRef.updateAndGet(state, (all) =>
      Option.match(HashMap.get(all, repo), {
        onNone: () => all,
        onSome: (current) => HashMap.set(all, repo, f(current)),
      }),
    ).pipe(
      Effect.flatMap((all) => store.set(STORE_KEY, Object.fromEntries(all))),
      Effect.catch((error) => Effect.logError("[files] saving the place failed", error)),
    );

  return {
    /** Every repo's place, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Starts a repo at its root, or over at a new root (another worktree);
     * a repo already at this root keeps its place. */
    ensureRoot: (repo: string, root: FileNavEntry) =>
      SubscriptionRef.updateAndGet(state, (all) => {
        const current = HashMap.get(all, repo);
        if (Option.isSome(current) && current.value.entries[0]?.path === root.path) return all;
        return HashMap.set(all, repo, { entries: [root], index: 0 });
      }).pipe(
        Effect.flatMap((all) => store.set(STORE_KEY, Object.fromEntries(all))),
        Effect.catch((error) => Effect.logError("[files] saving the place failed", error)),
      ),
    open: (repo: string, entry: FileNavEntry) => update(repo, (current) => opened(current, entry)),
    back: (repo: string) => update(repo, (current) => (canGoBack(current) ? { ...current, index: current.index - 1 } : current)),
    forward: (repo: string) => update(repo, (current) => (canGoForward(current) ? { ...current, index: current.index + 1 } : current)),
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
