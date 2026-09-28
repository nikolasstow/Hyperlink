import { describe, expect, it } from "vitest";
import { filterTitle, itemsIn, listedCategories, membership, pinsShownOn, pinTitle, reassign } from "./collectionModel";
import type { CollectionContent, CollectionItem, CollectionState } from "./pagesClient";

const item = (key: string, group: string, categories: ReadonlyArray<string>): CollectionItem => ({
  key,
  title: key,
  name: key,
  group,
  categories,
  actions: [],
  forms: [],
});

const content: CollectionContent = {
  groups: [
    {
      key: ".",
      title: "root",
      actions: [],
    },
    {
      key: "packages/app",
      title: "app",
      actions: [],
    },
  ],
  items: [item(".#build", ".", ["build"]), item(".#test", ".", ["test"]), item("app#build:ios", "packages/app", ["build"]), item("app#gen", "packages/app", [])],
  categories: [
    {
      id: "build",
      name: "Build",
      icon: "sf:hammer",
    },
    {
      id: "test",
      name: "Test",
    },
    {
      id: "deploy",
      name: "Deploy",
    },
  ],
  groupsTitle: "Packages",
  pinnable: true,
};

const state: CollectionState = {
  categories: [
    {
      id: "cat_1",
      name: "Mobile",
    },
  ],
  assignments: {
    "app#build:ios": ["build", "cat_1"],
  },
  pins: [
    {
      _tag: "PinnedFilter",
      id: "pin_1",
      group: "packages/app",
      category: "build",
    },
    {
      _tag: "PinnedFilter",
      id: "pin_2",
      name: "Phone",
      category: "cat_1",
    },
  ],
};

describe("collection model", () => {
  it("reads an item's categories as the user set them, else the plugin's", () => {
    expect(itemsIn(content, { category: "cat_1" }, state).map((found) => found.key)).toEqual(["app#build:ios"]);
    expect(itemsIn(content, { category: "build" }, state).map((found) => found.key)).toEqual([".#build", "app#build:ios"]);
    expect(itemsIn(content, { group: "packages/app", category: "build" }, state).map((found) => found.key)).toEqual(["app#build:ios"]);
  });

  it("lists the plugin's categories that have items and every one the user made", () => {
    expect(listedCategories(content, state).map((category) => category.id)).toEqual(["build", "test", "cat_1"]);
    expect(listedCategories(content, { ...state, assignments: {} }).map((category) => category.id)).toEqual(["build", "test", "cat_1"]);
    expect(listedCategories(content, state, ".").map((category) => category.id)).toEqual(["build", "test"]);
  });

  it("names a filter from what it filters unless the user named it", () => {
    expect(filterTitle(content, state, { group: "packages/app", category: "build" })).toBe("Build · app");
    expect(state.pins.map((pin) => pinTitle(content, state, pin))).toEqual(["Build · app", "Phone"]);
  });

  it("adds and removes categories across a selection, leaving mixed ones alone", () => {
    const selection = [content.items[0], content.items[2]].filter((found) => found !== undefined);
    expect(membership(selection, "build", state)).toBe("all");
    expect(membership(selection, "cat_1", state)).toBe("some");
    expect(
      reassign(
        selection,
        new Map([
          ["build", false],
          ["test", true],
        ]),
        state,
      ),
    ).toEqual({
      ".#build": ["test"],
      "app#build:ios": ["cat_1", "test"],
    });
  });

  it("shows a pin only on the pages it was pinned to", () => {
    const scoped: CollectionState = {
      ...state,
      pins: [
        {
          _tag: "PinnedItem",
          id: "p1",
          item: "app#build:ios",
          scope: "group",
        },
        {
          _tag: "PinnedItem",
          id: "p2",
          item: "app#gen",
          scope: "top",
        },
        {
          _tag: "PinnedItem",
          id: "p3",
          item: ".#test",
          scope: "both",
        },
        {
          _tag: "PinnedItem",
          id: "p4",
          item: ".#build",
        },
        ...state.pins,
      ],
    };
    expect(pinsShownOn(content, scoped, undefined).map((pin) => pin.id)).toEqual(["p2", "p3", "p4", "pin_2"]);
    expect(pinsShownOn(content, scoped, "packages/app").map((pin) => pin.id)).toEqual(["p1", "pin_1"]);
    expect(pinsShownOn(content, scoped, ".").map((pin) => pin.id)).toEqual(["p3", "p4"]);
  });
});
