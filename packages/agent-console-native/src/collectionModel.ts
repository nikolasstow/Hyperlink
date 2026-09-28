/**
 * A collection page's model: the plugin's items read through the user's
 * categories and pins (pagesClient). Pure, so every screen of the page sees
 * the same answer to "what is in this filter" and "what is this called".
 *
 * - An item's categories are the user's for it, else the plugin's defaults;
 *   an item can be in several.
 * - The categories are the plugin's, then the user's own.
 * - A filter is a group, a category, or both; it matches items live, so new
 *   ones show up in it.
 *
 * @internal
 */
import type { CollectionContent, CollectionGroup, CollectionItem, CollectionState, Pin } from "./pagesClient";

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** Made by the user, so theirs to rename and delete. */
  readonly custom: boolean;
}

/** What a filter matches: a group, a category, or both. */
export interface Filter {
  readonly group?: string;
  readonly category?: string;
}

/** The icon a user's category gets. */
const customIcon = "sf:tag";

export const categoriesOf = (content: CollectionContent, state: CollectionState): ReadonlyArray<Category> => [
  ...content.categories.map(
    (category): Category => ({
      id: category.id,
      name: category.name,
      icon: category.icon ?? customIcon,
      custom: false,
    }),
  ),
  ...state.categories.map(
    (category): Category => ({
      id: category.id,
      name: category.name,
      icon: customIcon,
      custom: true,
    }),
  ),
];

export const itemCategories = (item: CollectionItem, state: CollectionState): ReadonlyArray<string> => state.assignments[item.key] ?? item.categories;

export const matches = (item: CollectionItem, filter: Filter, state: CollectionState): boolean =>
  (filter.group === undefined || item.group === filter.group) && (filter.category === undefined || itemCategories(item, state).includes(filter.category));

export const itemsIn = (content: CollectionContent, filter: Filter, state: CollectionState): ReadonlyArray<CollectionItem> =>
  content.items.filter((item) => matches(item, filter, state));

/** The categories worth listing: the plugin's that have items, and every one
 * the user made (an empty one is waiting to be filled). With a group, only
 * the ones its items are in. */
export const listedCategories = (content: CollectionContent, state: CollectionState, group?: string): ReadonlyArray<Category> =>
  categoriesOf(content, state).filter(
    (category) =>
      (category.custom && group === undefined) ||
      content.items.some(
        (item) =>
          (group === undefined || item.group === group) &&
          itemCategories(item, state).includes(category.id),
      ),
  );

export const groupOf = (content: CollectionContent, key: string): CollectionGroup | undefined => content.groups.find((group) => group.key === key);

export const categoryOf = (content: CollectionContent, state: CollectionState, id: string): Category | undefined =>
  categoriesOf(content, state).find((category) => category.id === id);

/** A filter's name: the category, then the group ("Build · app"). A category
 * or group that is gone reads as its id rather than vanishing. */
export const filterTitle = (content: CollectionContent, state: CollectionState, filter: Filter): string =>
  [
    filter.category === undefined ? undefined : (categoryOf(content, state, filter.category)?.name ?? filter.category),
    filter.group === undefined ? undefined : (groupOf(content, filter.group)?.title ?? filter.group),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

export const pinTitle = (content: CollectionContent, state: CollectionState, pin: Pin): string =>
  pin._tag === "PinnedItem"
    ? (content.items.find((item) => item.key === pin.item)?.title ?? pin.item)
    : (pin.name ?? filterTitle(content, state, pin));

/**
 * The pins a page shows. The repo's pages (`group` undefined: the repo's NPM
 * page, the whole Scripts page) show items pinned to the repo or both, and
 * filters on no package. A package's pages (its NPM page, Scripts on that
 * package) show its items pinned to the package or both, and filters on it.
 * A pin from before scopes counts as both.
 */
export const pinsShownOn = (content: CollectionContent, state: CollectionState, group: string | undefined): ReadonlyArray<Pin> =>
  state.pins.filter((pin) => {
    if (pin._tag === "PinnedFilter") return pin.group === group;
    const scope = pin.scope ?? "both";
    if (group === undefined) return scope !== "group";
    return scope !== "top" && content.items.find((item) => item.key === pin.item)?.group === group;
  });

/** The pinned filter for exactly this filter, if there is one. */
export const pinnedFilter = (state: CollectionState, filter: Filter): Pin | undefined =>
  state.pins.find((pin) => pin._tag === "PinnedFilter" && pin.group === filter.group && pin.category === filter.category);

export const pinnedItem = (state: CollectionState, key: string): Pin | undefined => state.pins.find((pin) => pin._tag === "PinnedItem" && pin.item === key);

/** How a set of items stands in a category: all in it, none, or some. */
export type Membership = "all" | "none" | "some";

export const membership = (items: ReadonlyArray<CollectionItem>, category: string, state: CollectionState): Membership => {
  const inIt = items.filter((item) => itemCategories(item, state).includes(category)).length;
  return inIt === 0 ? "none" : inIt === items.length ? "all" : "some";
};

/**
 * The assignments that put `items` in or out of categories: each category
 * the user switched on is added to every item, each switched off is removed,
 * and one left as it was ("some") stays as each item had it.
 */
export const reassign = (
  items: ReadonlyArray<CollectionItem>,
  choices: ReadonlyMap<string, boolean>,
  state: CollectionState,
): Readonly<Record<string, ReadonlyArray<string>>> =>
  Object.fromEntries(
    items.map((item) => {
      const current = itemCategories(item, state);
      const kept = current.filter((id) => choices.get(id) !== false);
      const added = [...choices].filter(([id, on]) => on && !kept.includes(id)).map(([id]) => id);
      return [item.key, [...kept, ...added]];
    }),
  );
