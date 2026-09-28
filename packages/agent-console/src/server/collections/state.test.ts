import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { applyChange, CollectionState, type CollectionChange } from "./state";

const empty = new CollectionState({
  categories: [],
  assignments: {},
  pins: [],
});

const apply = (changes: ReadonlyArray<CollectionChange>, from: CollectionState = empty) =>
  Effect.runPromise(Effect.reduce(changes, () => from, (state, change) => applyChange(state, change)));

describe("collection state", () => {
  it("creates, renames and deletes the user's categories, dropping what used a deleted one", async () => {
    const made = await apply([
      {
        _tag: "CreateCategory",
        name: " Mobile ",
      },
    ]);
    const id = made.categories[0]?.id ?? "";
    expect(made.categories.map((category) => category.name)).toEqual(["Mobile"]);
    const used = await apply(
      [
        {
          _tag: "RenameCategory",
          id,
          name: "iOS",
        },
        {
          _tag: "Assign",
          assignments: {
            ".#build:ios": [id, "build", id],
          },
        },
        {
          _tag: "PinFilter",
          category: id,
        },
      ],
      made,
    );
    expect(used.categories[0]?.name).toBe("iOS");
    expect(used.assignments[".#build:ios"]).toEqual([id, "build"]);
    expect(used.pins).toHaveLength(1);
    const deleted = await apply(
      [
        {
          _tag: "DeleteCategory",
          id,
        },
      ],
      used,
    );
    expect(deleted.categories).toEqual([]);
    expect(deleted.assignments[".#build:ios"]).toEqual(["build"]);
    expect(deleted.pins).toEqual([]);
  });

  it("pins an item or a filter once, and unpins it", async () => {
    const pinned = await apply([
      {
        _tag: "PinItem",
        item: ".#build",
      },
      {
        _tag: "PinItem",
        item: ".#build",
      },
      {
        _tag: "PinFilter",
        group: "packages/app",
        category: "build",
      },
      {
        _tag: "PinFilter",
        group: "packages/app",
        category: "build",
      },
    ]);
    expect(pinned.pins.map((pin) => pin._tag)).toEqual(["PinnedItem", "PinnedFilter"]);
    const filter = pinned.pins[1];
    if (filter === undefined) throw new Error("no filter pinned");
    const renamed = await apply(
      [
        {
          _tag: "UpdateFilter",
          id: filter.id,
          name: " App builds ",
          group: "packages/app",
        },
      ],
      pinned,
    );
    expect(renamed.pins[1]).toEqual({
      _tag: "PinnedFilter",
      id: filter.id,
      name: "App builds",
      group: "packages/app",
    });
    const unpinned = await apply(
      [
        {
          _tag: "Unpin",
          id: filter.id,
        },
      ],
      renamed,
    );
    expect(unpinned.pins.map((pin) => pin._tag)).toEqual(["PinnedItem"]);
  });

  it("refuses an empty name, a filter on nothing, and someone else's category", async () => {
    const refused = (change: CollectionChange) => Effect.runPromise(applyChange(empty, change).pipe(Effect.flip)).then((error) => error.message);
    expect(
      await refused({
        _tag: "CreateCategory",
        name: "  ",
      }),
    ).toContain("empty");
    expect(await refused({ _tag: "PinFilter" })).toContain("group, a category");
    expect(
      await refused({
        _tag: "DeleteCategory",
        id: "build",
      }),
    ).toContain("no category build");
  });
});
