/**
 * The user's side of a collection page (a plugin's scripts, say): the
 * categories they made, the categories they put items in, and what they
 * pinned. The plugin says what the items are; this says how the user sorted
 * them (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.3).
 *
 * Kept per repo rather than per worktree: item and group keys are relative to
 * the workspace, so every worktree of a repo shares one set. Stored as a JSON
 * file per repo and page under the server's state folder
 * (`AGENT_CONSOLE_STATE_DIR`, else `.agent-console/collections`).
 *
 * @internal
 */
import { createHash } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Clock, Context, Effect, FileSystem, Layer, Path, Random, Schema, SynchronizedRef } from "effect";
import { resolveWithin } from "../fs";
import { PluginRegistry } from "../plugin/registry";

/** A category the user made. */
export const UserCategory = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

/** Where a pinned item shows: on its group's page (a workspace package's),
 * on the collection's top page (the repo's), or both. */
export const PinScope = Schema.Literals(["group", "top", "both"]);
export type PinScope = typeof PinScope.Type;

/** A pinned item; without a scope (pinned before scopes), it shows on both. */
export const PinnedItem = Schema.TaggedStruct("PinnedItem", {
  id: Schema.String,
  item: Schema.String,
  scope: Schema.optionalKey(PinScope),
});

/** A filter: a group, a category, or both. New items that match show up in
 * it on their own. `name` is the user's; without one the app names it from
 * what it filters. */
export const PinnedFilter = Schema.TaggedStruct("PinnedFilter", {
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  group: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
});

export const Pin = Schema.Union([PinnedItem, PinnedFilter]);
export type Pin = typeof Pin.Type;

export class CollectionState extends Schema.Class<CollectionState>("CollectionState")({
  categories: Schema.Array(UserCategory),
  /** An item's categories, for each item the user sorted; the rest keep the
   * plugin's defaults. */
  assignments: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  pins: Schema.Array(Pin),
}) {}

const empty = new CollectionState({
  categories: [],
  assignments: {},
  pins: [],
});

/** What the file holds: the state, and which repo and page it is for. */
const storedState = Schema.Struct({
  repo: Schema.String,
  page: Schema.String,
  state: CollectionState,
});
const storedJson = Schema.fromJsonString(storedState);

/** One change to the state. */
export const CollectionChange = Schema.Union([
  Schema.TaggedStruct("CreateCategory", { name: Schema.String }),
  Schema.TaggedStruct("RenameCategory", {
    id: Schema.String,
    name: Schema.String,
  }),
  Schema.TaggedStruct("DeleteCategory", { id: Schema.String }),
  /** Set these items' categories (each to its own list). */
  Schema.TaggedStruct("Assign", { assignments: Schema.Record(Schema.String, Schema.Array(Schema.String)) }),
  Schema.TaggedStruct("PinItem", {
    item: Schema.String,
    scope: PinScope,
  }),
  /** Change where a pinned item shows. */
  Schema.TaggedStruct("ScopePin", {
    id: Schema.String,
    scope: PinScope,
  }),
  Schema.TaggedStruct("PinFilter", {
    name: Schema.optionalKey(Schema.String),
    group: Schema.optionalKey(Schema.String),
    category: Schema.optionalKey(Schema.String),
  }),
  /** Change a pinned filter: its name (empty drops it, so the app names it
   * from what it filters) and what it filters. */
  Schema.TaggedStruct("UpdateFilter", {
    id: Schema.String,
    name: Schema.String,
    group: Schema.optionalKey(Schema.String),
    category: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct("Unpin", { id: Schema.String }),
]);
export type CollectionChange = typeof CollectionChange.Type;

export const collectionStatePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
});

export const collectionChangePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  change: CollectionChange,
});

/** A request the state cannot take: a page that is no collection, a
 * workspace outside the files root, an empty name, an unknown category. */
export class CollectionStateRequestError extends Schema.TaggedErrorClass<CollectionStateRequestError>()("CollectionStateRequestError", {
  message: Schema.String,
}) {}

/** The state could not be read or written. */
export class CollectionStateIoError extends Schema.TaggedErrorClass<CollectionStateIoError>()("CollectionStateIoError", {
  message: Schema.String,
}) {}

const badRequest = (message: string) => new CollectionStateRequestError({ message });

const io = (message: string) => (cause: unknown) =>
  new CollectionStateIoError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const trimmedName = (name: string): Effect.Effect<string, CollectionStateRequestError> => {
  const trimmed = name.trim();
  return trimmed.length === 0 ? Effect.fail(badRequest("a name cannot be empty")) : Effect.succeed(trimmed);
};

/** A new id, unique enough within one state. */
const newId = (prefix: string) =>
  Effect.all([Clock.currentTimeMillis, Random.nextIntBetween(0, 1_679_616)]).pipe(Effect.map(([millis, random]) => `${prefix}_${millis.toString(36)}_${random.toString(36)}`));

/** The state after a change. */
export const applyChange = (state: CollectionState, change: CollectionChange): Effect.Effect<CollectionState, CollectionStateRequestError> => {
  const hasCategory = (id: string) => state.categories.some((category) => category.id === id);
  switch (change._tag) {
    case "CreateCategory":
      return Effect.all([trimmedName(change.name), newId("cat")]).pipe(
        Effect.map(
          ([name, id]) =>
            new CollectionState({
              ...state,
              categories: [
                ...state.categories,
                {
                  id,
                  name,
                },
              ],
            }),
        ),
      );
    case "RenameCategory":
      return hasCategory(change.id)
        ? trimmedName(change.name).pipe(
            Effect.map(
              (name) =>
                new CollectionState({
                  ...state,
                  categories: state.categories.map((category) =>
                    category.id === change.id
                      ? {
                          id: category.id,
                          name,
                        }
                      : category,
                  ),
                }),
            ),
          )
        : Effect.fail(badRequest(`no category ${change.id} of yours`));
    case "DeleteCategory":
      return hasCategory(change.id)
        ? Effect.succeed(
            new CollectionState({
              categories: state.categories.filter((category) => category.id !== change.id),
              assignments: Object.fromEntries(Object.entries(state.assignments).map(([item, categories]) => [item, categories.filter((id) => id !== change.id)])),
              pins: state.pins.filter((pin) => pin._tag !== "PinnedFilter" || pin.category !== change.id),
            }),
          )
        : Effect.fail(badRequest(`no category ${change.id} of yours`));
    case "Assign":
      return Effect.succeed(
        new CollectionState({
          ...state,
          assignments: {
            ...state.assignments,
            ...Object.fromEntries(Object.entries(change.assignments).map(([item, categories]) => [item, [...new Set(categories)]])),
          },
        }),
      );
    case "PinItem":
      return state.pins.some((pin) => pin._tag === "PinnedItem" && pin.item === change.item)
        ? Effect.succeed(state)
        : newId("pin").pipe(
            Effect.map(
              (id) =>
                new CollectionState({
                  ...state,
                  pins: [
                    ...state.pins,
                    {
                      _tag: "PinnedItem",
                      id,
                      item: change.item,
                      scope: change.scope,
                    },
                  ],
                }),
            ),
          );
    case "PinFilter": {
      if (change.group === undefined && change.category === undefined) return Effect.fail(badRequest("a filter needs a group, a category, or both"));
      const pinned = state.pins.some((pin) => pin._tag === "PinnedFilter" && pin.group === change.group && pin.category === change.category);
      return pinned
        ? Effect.succeed(state)
        : newId("pin").pipe(
            Effect.map(
              (id) =>
                new CollectionState({
                  ...state,
                  pins: [
                    ...state.pins,
                    {
                      _tag: "PinnedFilter",
                      id,
                      ...(change.name === undefined ? {} : { name: change.name }),
                      ...(change.group === undefined ? {} : { group: change.group }),
                      ...(change.category === undefined ? {} : { category: change.category }),
                    },
                  ],
                }),
            ),
          );
    }
    case "UpdateFilter": {
      if (!state.pins.some((pin) => pin._tag === "PinnedFilter" && pin.id === change.id)) return Effect.fail(badRequest(`no pinned filter ${change.id}`));
      if (change.group === undefined && change.category === undefined) return Effect.fail(badRequest("a filter needs a group, a category, or both"));
      const name = change.name.trim();
      return Effect.succeed(
        new CollectionState({
          ...state,
          pins: state.pins.map((pin) =>
            pin._tag === "PinnedFilter" && pin.id === change.id
              ? {
                  _tag: "PinnedFilter",
                  id: pin.id,
                  ...(name.length === 0 ? {} : { name }),
                  ...(change.group === undefined ? {} : { group: change.group }),
                  ...(change.category === undefined ? {} : { category: change.category }),
                }
              : pin,
          ),
        }),
      );
    }
    case "ScopePin":
      return state.pins.some((pin) => pin._tag === "PinnedItem" && pin.id === change.id)
        ? Effect.succeed(
            new CollectionState({
              ...state,
              pins: state.pins.map((pin) =>
                pin._tag === "PinnedItem" && pin.id === change.id
                  ? {
                      ...pin,
                      scope: change.scope,
                    }
                  : pin,
              ),
            }),
          )
        : Effect.fail(badRequest(`no pinned item ${change.id}`));
    case "Unpin":
      return Effect.succeed(
        new CollectionState({
          ...state,
          pins: state.pins.filter((pin) => pin.id !== change.id),
        }),
      );
  }
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registry = yield* PluginRegistry;
  const dir = process.env.AGENT_CONSOLE_STATE_DIR ?? path.join(process.cwd(), ".agent-console", "collections");
  /** States read so far, by file. Every change goes through here, one at a
   * time, and is written before it is kept. */
  const loaded = yield* SynchronizedRef.make<ReadonlyMap<string, CollectionState>>(new Map());

  /** The repo a workspace belongs to: a worktree's main repo (its `.git` is a
   * file pointing into the repo's `.git/worktrees`), else the workspace. */
  const repoOf = (workspace: string) =>
    fs.readFileString(path.join(workspace, ".git")).pipe(
      Effect.flatMap((text) => {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim();
        if (gitdir === undefined) return Effect.succeed(workspace);
        const worktreeGit = path.resolve(workspace, gitdir);
        return fs.readFileString(path.join(worktreeGit, "commondir")).pipe(Effect.map((common) => path.dirname(path.resolve(worktreeGit, common.trim()))));
      }),
      // No `.git` file: a repo's own folder (where `.git` is a folder) or no
      // repo at all. Either way the workspace is its own.
      Effect.orElseSucceed(() => workspace),
    );

  /** The collection page a request names, if it is one. */
  const checkPage = (page: string) =>
    registry.list.pipe(
      Effect.mapError(io("reading the installed plugins")),
      Effect.flatMap((plugins) =>
        plugins.some((plugin) => plugin.pages.some((candidate) => `${plugin.id}/${candidate.id}` === page && candidate.kind === "collection"))
          ? Effect.void
          : Effect.fail(badRequest(`no collection page ${page}`)),
      ),
    );

  const locate = (workspace: string, page: string) =>
    Effect.gen(function* () {
      yield* checkPage(page);
      const resolved = yield* resolveWithin(workspace).pipe(Effect.mapError((cause) => badRequest(`${cause.path}: ${cause.reason}`)));
      const repo = yield* repoOf(resolved);
      const hash = createHash("sha256").update(`${repo}\n${page}`).digest("hex").slice(0, 16);
      return {
        repo,
        file: path.join(dir, `${path.basename(repo)}-${hash}.json`),
      };
    });

  const read = (file: string) =>
    fs.exists(file).pipe(
      Effect.flatMap((exists) =>
        exists
          ? fs.readFileString(file).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(storedJson)),
              Effect.map((stored) => stored.state),
            )
          : Effect.succeed(empty),
      ),
      Effect.mapError(io(`reading ${file}`)),
    );

  const stateIn = (all: ReadonlyMap<string, CollectionState>, file: string) => {
    const known = all.get(file);
    return known === undefined ? read(file) : Effect.succeed(known);
  };

  /** The state, and the loaded states with it kept. */
  const remember = (
    all: ReadonlyMap<string, CollectionState>,
    file: string,
    state: CollectionState,
  ): readonly [CollectionState, ReadonlyMap<string, CollectionState>] => [state, new Map([...all, [file, state]])];

  return {
    get: (workspace: string, page: string) =>
      locate(workspace, page).pipe(
        Effect.flatMap(({ file }) =>
          SynchronizedRef.modifyEffect(loaded, (all) => stateIn(all, file).pipe(Effect.map((state) => remember(all, file, state)))),
        ),
      ),
    apply: (workspace: string, page: string, change: CollectionChange) =>
      locate(workspace, page).pipe(
        Effect.flatMap(({ repo, file }) =>
          SynchronizedRef.modifyEffect(loaded, (all) =>
            stateIn(all, file).pipe(
              Effect.flatMap((state) => applyChange(state, change)),
              Effect.tap((next) =>
                fs.makeDirectory(dir, { recursive: true }).pipe(
                  Effect.andThen(
                    Schema.encodeEffect(storedJson)({
                      repo,
                      page,
                      state: next,
                    }),
                  ),
                  Effect.flatMap((text) => fs.writeFileString(file, text)),
                  Effect.mapError(io(`writing ${file}`)),
                ),
              ),
              Effect.map((next) => remember(all, file, next)),
            ),
          ),
        ),
      ),
  };
});

export class CollectionStates extends Context.Service<CollectionStates, Effect.Success<typeof make>>()("agent-console/CollectionStates") {
  static readonly layer = Layer.effect(CollectionStates, make).pipe(Layer.provide(NodeServices.layer));
}
