/**
 * A plugin's collection page (NPM's Scripts), drawn natively
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.3). One
 * screen, three views of the same collection:
 *
 * - **Home**: Pinned (scripts and filters), then the repo's categories and
 *   its groups (packages), a few of each with a page of all of them.
 * - **Filter**: the scripts a filter matches: a package, a category, or both.
 *   A package's page picks a category with chips; the pin in the bar pins
 *   what is showing.
 * - **Index**: every category, or every package.
 *
 * Shown as a list (the tree view: filters, categories and packages expand in
 * place) or a grid, switched from the 3-dot menu for the whole page. Tapping a
 * script runs it; a hard press offers the rest. Select (3-dot menu) sorts
 * several scripts into categories, or pins them, at once.
 *
 * Nothing fails quietly: a load that fails shows the server's message with a
 * retry, an action that fails says why, and a sheet that fails stays open
 * with its message.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackHeaderItem, NativeStackHeaderItemMenuAction, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "sf-symbols-typescript";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { setCollectionDisplay, useCollectionDisplay } from "./collectionDisplay";
import {
  categoriesOf,
  filterTitle,
  groupOf,
  itemsIn,
  listedCategories,
  pinnedFilter,
  pinnedItem,
  pinTitle,
  reassign,
  type Category,
  type Filter,
} from "./collectionModel";
import { ItemRow, NodeRow, SectionHeader, SeeAllRow, Tile, type MenuAction } from "./CollectionRows";
import { CategoriesSheet, FormSheet, type GroupOption } from "./CollectionSheets";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { followResult } from "./followResult";
import { invokeCollection, searchCollection, type CollectionGroup, type CollectionItem, type CollectionTarget, type FormSpec, type PinnedFilter } from "./pagesClient";
import { changeCollection, loadCollection, useCollection, type CollectionData } from "./pagesStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { ensureWorkspace } from "./extensionViewsStore";

type Props = NativeStackScreenProps<RootStackParamList, "Collection">;

/** Which view of the collection a screen shows. */
export type CollectionView =
  | { readonly kind: "home" }
  | { readonly kind: "filter"; readonly group?: string; readonly category?: string }
  | { readonly kind: "index"; readonly of: "categories" | "groups" };

/** How many categories or packages Home lists before "See All". */
const FEW = 5;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A filter, category or package, as a row or tile that opens a filter. */
interface Node {
  readonly key: string;
  readonly filter: Filter;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: SFSymbol;
  readonly pin?: PinnedFilter;
  readonly category?: Category;
  readonly group?: CollectionGroup;
}

type Row =
  | { readonly type: "header"; readonly key: string; readonly title: string }
  | { readonly type: "item"; readonly key: string; readonly item: CollectionItem; readonly depth: number; readonly beyond?: boolean }
  | { readonly type: "node"; readonly key: string; readonly node: Node; readonly depth: number }
  | { readonly type: "seeAll"; readonly key: string; readonly label: string; readonly view: CollectionView }
  | { readonly type: "tiles"; readonly key: string; readonly tiles: ReadonlyArray<{ readonly item: CollectionItem } | { readonly node: Node }> }
  | { readonly type: "chips"; readonly key: string; readonly group: string }
  | { readonly type: "empty"; readonly key: string; readonly text: string };

const categoryNode = (category: Category): Node => ({
  key: `category ${category.id}`,
  filter: { category: category.id },
  title: category.name,
  icon: symbolForIcon(category.icon),
  category,
});

const groupNode = (group: CollectionGroup): Node => ({
  key: `group ${group.key}`,
  filter: { group: group.key },
  title: group.title,
  ...(group.detail === undefined ? {} : { subtitle: group.detail }),
  icon: symbolForIcon(group.icon ?? "sf:shippingbox"),
  group,
});

const filterNode = (data: CollectionData, pin: PinnedFilter): Node => ({
  key: `pin ${pin.id}`,
  filter: {
    ...(pin.group === undefined ? {} : { group: pin.group }),
    ...(pin.category === undefined ? {} : { category: pin.category }),
  },
  title: pinTitle(data.content, data.state, pin),
  subtitle: filterTitle(data.content, data.state, pin),
  icon: "line.3.horizontal.decrease.circle",
  pin,
});

/** Rows of two tiles, for the grid. */
const tileRows = (key: string, tiles: ReadonlyArray<{ readonly item: CollectionItem } | { readonly node: Node }>): ReadonlyArray<Row> =>
  Array.from({ length: Math.ceil(tiles.length / 2) }, (_, index) => ({
    type: "tiles",
    key: `${key} ${index}`,
    tiles: tiles.slice(index * 2, index * 2 + 2),
  }));

/** Nodes as rows (with their scripts beneath the expanded ones) or tiles. */
const nodeRows = (data: CollectionData, key: string, nodes: ReadonlyArray<Node>, grid: boolean, expanded: ReadonlySet<string>): ReadonlyArray<Row> =>
  grid
    ? tileRows(
        key,
        nodes.map((node) => ({ node })),
      )
    : nodes.flatMap((node): ReadonlyArray<Row> => [
        {
          type: "node",
          key: node.key,
          node,
          depth: 0,
        },
        ...(expanded.has(node.key)
          ? itemsIn(data.content, node.filter, data.state).map(
              (item): Row => ({
                type: "item",
                key: `${node.key} ${item.key}`,
                item,
                depth: 1,
              }),
            )
          : []),
      ]);

const itemRows = (key: string, items: ReadonlyArray<CollectionItem>, grid: boolean, depth: number): ReadonlyArray<Row> =>
  grid
    ? tileRows(
        key,
        items.map((item) => ({ item })),
      )
    : items.map(
        (item): Row => ({
          type: "item",
          key: `${key} ${item.key}`,
          item,
          depth,
        }),
      );

const homeRows = (data: CollectionData, grid: boolean, expanded: ReadonlySet<string>): ReadonlyArray<Row> => {
  const { content, state } = data;
  const pinnedItems = state.pins.flatMap((pin) => (pin._tag === "PinnedItem" ? content.items.filter((item) => item.key === pin.item) : []));
  const pinnedFilters = state.pins.flatMap((pin) => (pin._tag === "PinnedFilter" ? [filterNode(data, pin)] : []));
  const categories = listedCategories(content, state);
  const pinned: ReadonlyArray<Row> =
    state.pins.length === 0
      ? []
      : [
          {
            type: "header",
            key: "pinned",
            title: "Pinned",
          },
          ...(grid
            ? tileRows("pinned", [...pinnedFilters.map((node) => ({ node })), ...pinnedItems.map((item) => ({ item }))])
            : [...nodeRows(data, "pinned filters", pinnedFilters, false, expanded), ...itemRows("pinned", pinnedItems, false, 0)]),
        ];
  const header = (key: string, title: string): Row => ({
    type: "header",
    key,
    title,
  });
  const seeAll = (key: string, label: string, of: "categories" | "groups"): Row => ({
    type: "seeAll",
    key,
    label,
    view: {
      kind: "index",
      of,
    },
  });
  return [
    ...pinned,
    ...(categories.length === 0
      ? []
      : [
          header("categories", "Categories"),
          ...nodeRows(data, "categories", categories.slice(0, FEW).map(categoryNode), grid, expanded),
          ...(categories.length > FEW ? [seeAll("categories all", `See All ${categories.length} Categories`, "categories")] : []),
        ]),
    header("groups", content.groupsTitle),
    ...nodeRows(data, "groups", content.groups.slice(0, FEW).map(groupNode), grid, expanded),
    ...(content.groups.length > FEW ? [seeAll("groups all", `See All ${content.groups.length} ${content.groupsTitle}`, "groups")] : []),
  ];
};

const filterRows = (data: CollectionData, filter: Filter, grid: boolean, expanded: ReadonlySet<string>): ReadonlyArray<Row> => {
  const items = itemsIn(data.content, filter, data.state);
  const chips: ReadonlyArray<Row> =
    filter.group === undefined
      ? []
      : [
          {
            type: "chips",
            key: "chips",
            group: filter.group,
          },
        ];
  if (items.length === 0) {
    return [
      ...chips,
      {
        type: "empty",
        key: "empty",
        text: "No scripts here yet.",
      },
    ];
  }
  // Across packages, the list is the tree: each package with its scripts
  // beneath, open unless closed.
  const groups = [...new Set(items.map((item) => item.group))];
  if (grid || groups.length < 2) return [...chips, ...itemRows("items", items, grid, 0)];
  return groups.flatMap((key): ReadonlyArray<Row> => {
    const group = groupOf(data.content, key);
    const node: Node =
      group === undefined
        ? {
            key: `group ${key}`,
            filter: { group: key },
            title: key,
            icon: "shippingbox",
          }
        : groupNode(group);
    const inGroup = items.filter((item) => item.group === key);
    return [
      {
        type: "node",
        key: node.key,
        node: {
          ...node,
          filter: {
            ...node.filter,
            ...(filter.category === undefined ? {} : { category: filter.category }),
          },
        },
        depth: 0,
      },
      ...(expanded.has(node.key) ? [] : itemRows(node.key, inGroup, false, 1)),
    ];
  });
};

/** What a search shows: the collection's matches first, then what the
 * plugin's search found beyond it, leaving out what the collection has. */
const searchRows = (data: CollectionData, query: string, beyond: Search, grid: boolean): ReadonlyArray<Row> => {
  const needle = query.trim().toLowerCase();
  const local = data.content.items.filter((item) => [item.title, item.name].some((text) => text.toLowerCase().includes(needle)));
  const search = data.content.search;
  const inCollection = new Set(data.content.items.map((item) => item.title));
  const found = beyond.kind === "done" ? beyond.items.filter((item) => !inCollection.has(item.title)) : [];
  const header = (key: string, title: string): Row => ({
    type: "header",
    key,
    title,
  });
  const note = (key: string, text: string): Row => ({
    type: "empty",
    key,
    text,
  });
  return [
    ...(search === undefined ? [] : [header("in collection", search.inCollection)]),
    ...(local.length === 0 ? [note("no local", "No matches.")] : itemRows("local", local, grid, 0)),
    ...(search === undefined
      ? []
      : [
          header("beyond", search.beyond),
          ...(beyond.kind === "searching"
            ? [note("searching", "Searching…")]
            : beyond.kind === "failed"
              ? [note("search failed", `Search failed: ${beyond.message}`)]
              : found.length === 0
                ? [note("none beyond", "Nothing else found.")]
                : found.map(
                    (item): Row => ({
                      type: "item",
                      key: `beyond ${item.key}`,
                      item,
                      depth: 0,
                      beyond: true,
                    }),
                  )),
        ]),
  ];
};

const indexRows = (data: CollectionData, of: "categories" | "groups", grid: boolean, expanded: ReadonlySet<string>): ReadonlyArray<Row> =>
  nodeRows(data, of, of === "categories" ? listedCategories(data.content, data.state).map(categoryNode) : data.content.groups.map(groupNode), grid, expanded);

/** A category chip bar for a package's page: All, then its categories. */
const Chips = (props: {
  readonly categories: ReadonlyArray<Category>;
  readonly selected: string | undefined;
  readonly onSelect: (category: string | undefined) => void;
}): React.ReactElement => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {[undefined, ...props.categories].map((category) => {
      const id = category?.id;
      const on = id === props.selected;
      return (
        <Pressable key={id ?? "all"} style={[styles.chip, on && styles.chipOn]} onPress={() => props.onSelect(id)}>
          <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{category?.name ?? "All"}</Text>
        </Pressable>
      );
    })}
  </ScrollView>
);

/** Where the plugin's search beyond the collection stands. */
type Search =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly items: ReadonlyArray<CollectionItem> }
  | { readonly kind: "failed"; readonly message: string };

/** How long typing must pause before the search goes out. */
const SEARCH_PAUSE_MS = 350;

/** What a sheet is open for. */
type Sheet =
  | { readonly kind: "form"; readonly spec: FormSpec; readonly group?: string; readonly submit: (values: Readonly<Record<string, string>>) => Promise<void> }
  | { readonly kind: "categories"; readonly items: ReadonlyArray<CollectionItem> };

export const CollectionScreen = (props: Props): React.ReactElement => {
  const { dir, page, title, view } = props.route.params;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const load = useCollection(dir, page);
  const display = useCollectionDisplay(page);
  const grid = display === "grid";
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = React.useState<string | undefined>(undefined);
  const [selection, setSelection] = React.useState<ReadonlySet<string> | undefined>(undefined);
  const [sheet, setSheet] = React.useState<Sheet | undefined>(undefined);
  // A package's page narrows by category with its chips.
  const [chip, setChip] = React.useState<string | undefined>(view.kind === "filter" ? view.category : undefined);
  const [query, setQuery] = React.useState("");
  const [beyond, setBeyond] = React.useState<Search>({ kind: "idle" });

  // Cached rows are already on screen; bring them up to date behind them.
  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
    void loadCollection(apiBase, dir, page, "ifChanged");
  }, [apiBase, dir, page]);

  // Back from an install or an edit, the files behind the page changed.
  useFocusEffect(
    React.useCallback(() => {
      void loadCollection(apiBase, dir, page, "ifChanged");
    }, [apiBase, dir, page]),
  );

  const data = load.kind === "ready" ? load.value : undefined;
  const searchable = data?.content.search !== undefined;

  // The search beyond the collection goes out once typing pauses; a newer
  // query supersedes an older one's answer.
  React.useEffect(() => {
    const trimmed = query.trim();
    if (!searchable || trimmed.length === 0) {
      setBeyond({ kind: "idle" });
      return;
    }
    setBeyond({ kind: "searching" });
    let current = true;
    const timer = setTimeout(() => {
      searchCollection(apiBase, dir, page, trimmed).then(
        (items) => {
          if (current) setBeyond({ kind: "done", items });
        },
        (error: unknown) => {
          if (current) setBeyond({ kind: "failed", message: messageOf(error) });
        },
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [apiBase, dir, page, query, searchable]);
  const filter: Filter | undefined =
    view.kind === "filter"
      ? {
          ...(view.group === undefined ? {} : { group: view.group }),
          ...(chip === undefined ? {} : { category: chip }),
        }
      : undefined;

  const change = (label: string, run: Promise<unknown>): void => {
    run.catch((error: unknown) => Alert.alert(`Couldn’t ${label}`, messageOf(error)));
  };

  const invoke = (target: CollectionTarget, command: string, label: string, values: Readonly<Record<string, string>> = {}) =>
    invokeCollection(apiBase, dir, page, target, command, values).then((result) => followResult(navigation, apiBase, result, label));

  /** A tap: run it, or open it when it does not run. */
  const run = (item: CollectionItem): void => {
    const action = item.run ?? item.open;
    if (action === undefined) return;
    setBusy(item.key);
    invoke({ _tag: "Item", key: item.key }, action.command, `${action.title} ${item.title}`)
      .catch((error: unknown) => Alert.alert(`Couldn’t ${action.title.toLowerCase()} ${item.title}`, messageOf(error)))
      .finally(() => setBusy(undefined));
  };

  /** A plugin form's sheet: submitting runs it, then re-reads the collection
   * (the form changed a file behind it). */
  const openForm = (spec: FormSpec, target: CollectionTarget, group?: string): void =>
    setSheet({
      kind: "form",
      spec,
      ...(group === undefined ? {} : { group }),
      submit: (values) =>
        invoke(target, spec.command, spec.title, values).then(async () => {
          setSheet(undefined);
          await loadCollection(apiBase, dir, page, "ifChanged");
        }),
    });

  const toggleExpanded = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const open = (next: CollectionView, nextTitle: string): void =>
    navigation.push("Collection", {
      repo: props.route.params.repo,
      dir,
      page,
      title: nextTitle,
      view: next,
    });

  const openNode = (node: Node): void => {
    if (data === undefined) return;
    open(
      {
        kind: "filter",
        ...node.filter,
      },
      node.pin === undefined ? filterTitle(data.content, data.state, node.filter) : node.title,
    );
  };

  const toggleSelect = (key: string): void =>
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groupOptions: ReadonlyArray<GroupOption> = data === undefined ? [] : data.content.groups.map((group) => ({ value: group.key, label: group.title }));

  /** The app's own form for a pinned filter: its name, package and category. */
  const editFilter = (pin: PinnedFilter): void => {
    if (data === undefined) return;
    const anyOption = (label: string) => ({ value: "", label });
    setSheet({
      kind: "form",
      spec: {
        command: "edit-filter",
        title: "Edit Filter",
        submitTitle: "Save",
        fields: [
          {
            id: "name",
            label: "Name",
            kind: "text",
            value: pin.name ?? "",
            placeholder: filterTitle(data.content, data.state, pin),
            options: [],
          },
          {
            id: "group",
            label: data.content.groupsTitle,
            kind: "choice",
            value: pin.group ?? "",
            options: [anyOption("Any"), ...groupOptions],
          },
          {
            id: "category",
            label: "Category",
            kind: "choice",
            value: pin.category ?? "",
            options: [anyOption("Any"), ...categoriesOf(data.content, data.state).map((category) => ({ value: category.id, label: category.name }))],
          },
        ],
      },
      submit: (values) => {
        const group = values["group"] ?? "";
        const category = values["category"] ?? "";
        return changeCollection(apiBase, dir, page, {
          _tag: "UpdateFilter",
          id: pin.id,
          name: values["name"] ?? "",
          ...(group.length === 0 ? {} : { group }),
          ...(category.length === 0 ? {} : { category }),
        }).then(() => setSheet(undefined));
      },
    });
  };

  const renameCategory = (category: Category): void =>
    setSheet({
      kind: "form",
      spec: {
        command: "rename-category",
        title: "Edit Category",
        submitTitle: "Save",
        fields: [
          {
            id: "name",
            label: "Name",
            kind: "text",
            value: category.name,
            options: [],
          },
        ],
      },
      submit: (values) =>
        changeCollection(apiBase, dir, page, {
          _tag: "RenameCategory",
          id: category.id,
          name: values["name"] ?? "",
        }).then(() => setSheet(undefined)),
    });

  const deleteCategory = (category: Category): void =>
    Alert.alert(`Delete “${category.name}”?`, "Its scripts stay; they just leave this category, and filters on it are unpinned.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => change(`delete ${category.name}`, changeCollection(apiBase, dir, page, { _tag: "DeleteCategory", id: category.id })),
      },
    ]);

  const newCategory = (): void =>
    Alert.prompt("New Category", "Put scripts in it from a script’s menu, or select several.", (name) =>
      change("make the category", changeCollection(apiBase, dir, page, { _tag: "CreateCategory", name })),
    );

  /** A search result is not in the collection: it has what the plugin
   * offers (install it, view it), and nothing to sort or pin. */
  const beyondMenu = (item: CollectionItem): ReadonlyArray<MenuAction> => [
    ...item.forms.map(
      (form): MenuAction => ({
        label: form.title,
        icon: symbolForIcon(form.icon),
        onPress: () => openForm(form, { _tag: "Item", key: item.key }, filter?.group),
      }),
    ),
    ...item.actions.map(
      (other): MenuAction => ({
        label: other.title,
        icon: symbolForIcon(other.icon),
        onPress: () => {
          invoke({ _tag: "Item", key: item.key }, other.command, other.title).catch((error: unknown) =>
            Alert.alert(`Couldn’t ${other.title.toLowerCase()}`, messageOf(error)),
          );
        },
      }),
    ),
  ];

  const itemMenu = (item: CollectionItem): ReadonlyArray<MenuAction> => {
    if (data === undefined) return [];
    const pin = pinnedItem(data.state, item.key);
    const action = item.run;
    const runs: ReadonlyArray<MenuAction> =
      action === undefined
        ? []
        : [
            {
              label: action.title,
              icon: "play.fill",
              onPress: () => run(item),
            },
          ];
    const forms = item.forms.map(
      (form): MenuAction => ({
        label: form.title,
        icon: symbolForIcon(form.icon),
        onPress: () => openForm(form, { _tag: "Item", key: item.key }),
      }),
    );
    const pinning: MenuAction =
      pin === undefined
        ? {
            label: "Pin",
            icon: "pin",
            onPress: () => change(`pin ${item.title}`, changeCollection(apiBase, dir, page, { _tag: "PinItem", item: item.key })),
          }
        : {
            label: "Unpin",
            icon: "pin.slash",
            onPress: () => change(`unpin ${item.title}`, changeCollection(apiBase, dir, page, { _tag: "Unpin", id: pin.id })),
          };
    const others = item.actions.map(
      (other): MenuAction => ({
        label: other.title,
        icon: symbolForIcon(other.icon),
        onPress: () => {
          invoke({ _tag: "Item", key: item.key }, other.command, other.title).catch((error: unknown) =>
            Alert.alert(`Couldn’t ${other.title.toLowerCase()}`, messageOf(error)),
          );
        },
      }),
    );
    return [
      ...runs,
      ...forms,
      {
        label: "Categories…",
        icon: "tag",
        onPress: () => setSheet({ kind: "categories", items: [item] }),
      },
      pinning,
      ...others,
      {
        label: "Select",
        icon: "checkmark.circle",
        onPress: () => setSelection(new Set([item.key])),
      },
    ];
  };

  const nodeMenu = (node: Node): ReadonlyArray<MenuAction> => {
    if (data === undefined) return [];
    const pinned = node.pin ?? pinnedFilter(data.state, node.filter);
    const pinAction: MenuAction =
      pinned === undefined
        ? {
            label: "Pin",
            icon: "pin",
            onPress: () => change(`pin ${node.title}`, changeCollection(apiBase, dir, page, { _tag: "PinFilter", ...node.filter })),
          }
        : {
            label: "Unpin",
            icon: "pin.slash",
            destructive: node.pin !== undefined,
            onPress: () => change(`unpin ${node.title}`, changeCollection(apiBase, dir, page, { _tag: "Unpin", id: pinned.id })),
          };
    const { category, group, pin } = node;
    const filterEdit: ReadonlyArray<MenuAction> =
      pin === undefined
        ? []
        : [
            {
              label: "Edit Filter…",
              icon: "pencil",
              onPress: () => editFilter(pin),
            },
          ];
    const categoryEdits: ReadonlyArray<MenuAction> =
      category?.custom === true
        ? [
            {
              label: "Edit Category…",
              icon: "pencil",
              onPress: () => renameCategory(category),
            },
            {
              label: "Delete Category",
              icon: "trash",
              destructive: true,
              onPress: () => deleteCategory(category),
            },
          ]
        : [];
    const groupActions: ReadonlyArray<MenuAction> =
      group === undefined
        ? []
        : group.actions.map(
            (action): MenuAction => ({
              label: action.title,
              icon: symbolForIcon(action.icon),
              onPress: () => {
                invoke({ _tag: "Group", key: group.key }, action.command, action.title).catch((error: unknown) =>
                  Alert.alert(`Couldn’t ${action.title.toLowerCase()}`, messageOf(error)),
                );
              },
            }),
          );
    return [
      {
        label: "Open",
        icon: "arrow.up.forward.square",
        onPress: () => openNode(node),
      },
      ...filterEdit,
      pinAction,
      ...categoryEdits,
      ...groupActions,
    ];
  };

  const rows: ReadonlyArray<Row> =
    data === undefined
      ? []
      : query.trim().length > 0
        ? searchRows(data, query, beyond, grid)
        : view.kind === "home"
        ? homeRows(data, grid, expanded)
        : view.kind === "filter"
          ? filterRows(data, filter ?? {}, grid, expanded)
          : indexRows(data, view.of, grid, expanded);

  const selected = data === undefined || selection === undefined ? [] : data.content.items.filter((item) => selection.has(item.key));
  const currentPin = data === undefined || filter === undefined ? undefined : pinnedFilter(data.state, filter);
  const screenTitle =
    data === undefined || view.kind !== "filter"
      ? title
      : currentPin?._tag === "PinnedFilter" && currentPin.name !== undefined
        ? currentPin.name
        : filter === undefined
          ? title
          : filterTitle(data.content, data.state, filter) || title;

  // The bar: selecting has Done; otherwise the filter's pin and the 3-dot menu.
  const pinButton: ReadonlyArray<NativeStackHeaderItem> =
    filter === undefined || (filter.group === undefined && filter.category === undefined)
      ? []
      : [
          {
            type: "button",
            label: currentPin === undefined ? "Pin" : "Unpin",
            icon: {
              type: "sfSymbol",
              name: currentPin === undefined ? "pin" : "pin.fill",
            },
            onPress: () =>
              change(
                currentPin === undefined ? "pin this" : "unpin this",
                changeCollection(apiBase, dir, page, currentPin === undefined ? { _tag: "PinFilter", ...filter } : { _tag: "Unpin", id: currentPin.id }),
              ),
          },
        ];
  const create = data?.content.create;
  const createAction: ReadonlyArray<NativeStackHeaderItemMenuAction> =
    create === undefined
      ? []
      : [
          {
            type: "action",
            label: create.title,
            icon: {
              type: "sfSymbol",
              name: "plus",
            },
            onPress: () => openForm(create, { _tag: "Whole" }, filter?.group),
          },
        ];
  const moreMenu: NativeStackHeaderItem = {
    type: "menu",
    label: "More",
    icon: {
      type: "sfSymbol",
      name: "ellipsis",
    },
    menu: {
      items: [
        {
          type: "action",
          label: "List",
          icon: {
            type: "sfSymbol",
            name: "list.bullet",
          },
          state: grid ? "off" : "on",
          onPress: () => setCollectionDisplay(page, "list"),
        },
        {
          type: "action",
          label: "Grid",
          icon: {
            type: "sfSymbol",
            name: "square.grid.2x2",
          },
          state: grid ? "on" : "off",
          onPress: () => setCollectionDisplay(page, "grid"),
        },
        ...createAction,
        {
          type: "action",
          label: "New Category",
          icon: {
            type: "sfSymbol",
            name: "tag",
          },
          onPress: newCategory,
        },
        {
          type: "action",
          label: "Select",
          icon: {
            type: "sfSymbol",
            name: "checkmark.circle",
          },
          onPress: () => setSelection(new Set()),
        },
      ],
    },
  };
  const doneButton: NativeStackHeaderItem = {
    type: "button",
    label: "Done",
    onPress: () => setSelection(undefined),
  };
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: screenTitle,
      unstable_headerRightItems: () => (selection === undefined ? [...pinButton, moreMenu] : [doneButton]),
      headerSearchBarOptions: {
        placeholder: data?.content.search?.placeholder ?? `Search ${title}`,
        hideWhenScrolling: false,
        autoCapitalize: "none",
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  });

  const tileWidth = (width - 16 * 2 - 12) / 2;

  const renderRow = (row: Row): React.ReactElement | null => {
    if (data === undefined) return null;
    switch (row.type) {
      case "header":
        return <SectionHeader title={row.title} />;
      case "seeAll":
        return <SeeAllRow label={row.label} onPress={() => open(row.view, row.view.kind === "index" && row.view.of === "groups" ? data.content.groupsTitle : "Categories")} />;
      case "empty":
        return <Text style={styles.empty}>{row.text}</Text>;
      case "chips":
        return <Chips categories={listedCategories(data.content, data.state, row.group)} selected={chip} onSelect={setChip} />;
      case "item":
        return (
          <ItemRow
            title={row.item.title}
            name={row.item.name}
            {...(row.item.detail === undefined ? {} : { detail: row.item.detail })}
            icon={symbolForIcon(row.item.icon)}
            depth={row.depth}
            width={width}
            busy={busy === row.item.key}
            canRun={row.item.run !== undefined}
            selecting={selection !== undefined && row.beyond !== true}
            selected={selection?.has(row.item.key) === true}
            pinned={pinnedItem(data.state, row.item.key) !== undefined}
            onRun={() => run(row.item)}
            onSelect={() => toggleSelect(row.item.key)}
            menu={row.beyond === true ? beyondMenu(row.item) : itemMenu(row.item)}
          />
        );
      case "node":
        return (
          <NodeRow
            title={row.node.title}
            {...(row.node.subtitle === undefined ? {} : { subtitle: row.node.subtitle })}
            icon={row.node.icon}
            count={itemsIn(data.content, row.node.filter, data.state).length}
            depth={row.depth}
            width={width}
            // Across packages on a filter's page the packages start open, so
            // there `expanded` records the closed ones.
            expanded={view.kind === "filter" ? !expanded.has(row.node.key) : expanded.has(row.node.key)}
            onToggle={() => toggleExpanded(row.node.key)}
            onOpen={() => openNode(row.node)}
            menu={nodeMenu(row.node)}
          />
        );
      case "tiles":
        return (
          <View style={styles.tileRow}>
            {row.tiles.map((tile) =>
              "item" in tile ? (
                <Tile
                  key={tile.item.key}
                  title={tile.item.title}
                  subtitle={tile.item.name}
                  icon={symbolForIcon(tile.item.icon)}
                  width={tileWidth}
                  busy={busy === tile.item.key}
                  selecting={selection !== undefined}
                  selected={selection?.has(tile.item.key) === true}
                  onPress={() => (selection === undefined ? run(tile.item) : toggleSelect(tile.item.key))}
                  {...(tile.item.run === undefined ? {} : { onRun: () => run(tile.item) })}
                  menu={itemMenu(tile.item)}
                />
              ) : (
                <Tile
                  key={tile.node.key}
                  title={tile.node.title}
                  subtitle={tile.node.subtitle ?? `${itemsIn(data.content, tile.node.filter, data.state).length} scripts`}
                  icon={tile.node.icon}
                  width={tileWidth}
                  count={itemsIn(data.content, tile.node.filter, data.state).length}
                  onPress={() => openNode(tile.node)}
                  menu={nodeMenu(tile.node)}
                />
              ),
            )}
          </View>
        );
    }
  };

  return (
    <View style={styles.root}>
      {load.kind === "loading" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : load.kind === "failed" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>Couldn’t load {title}.</Text>
          <Text style={styles.detail}>{load.message}</Text>
          <TouchableOpacity onPress={() => void loadCollection(apiBase, dir, page, "force")}>
            <Text style={styles.retry}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Virtualized, like the tree view: a monorepo's scripts run to
        // hundreds of rows, each a SwiftUI view with its own menu.
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: insets.bottom + (selection === undefined ? 24 : 96) }}
          initialNumToRender={16}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={() => void loadCollection(apiBase, dir, page, "force")} />}
          ListHeaderComponent={load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded scripts. Refreshing failed: {load.error}</Text>}
          renderItem={({ item: row }) => renderRow(row)}
        />
      )}
      {selection === undefined || data === undefined ? null : (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={styles.selectionCount}>{selected.length === 1 ? "1 script" : `${selected.length} scripts`}</Text>
          <Pressable disabled={selected.length === 0} onPress={() => setSheet({ kind: "categories", items: selected })}>
            <Text style={[styles.selectionAction, selected.length === 0 && styles.disabled]}>Categories…</Text>
          </Pressable>
          <Pressable
            disabled={selected.length === 0}
            onPress={() =>
              change(
                "pin them",
                selected
                  .filter((item) => pinnedItem(data.state, item.key) === undefined)
                  .reduce<Promise<unknown>>((previous, item) => previous.then(() => changeCollection(apiBase, dir, page, { _tag: "PinItem", item: item.key })), Promise.resolve())
                  .then(() => setSelection(undefined)),
              )
            }
          >
            <Text style={[styles.selectionAction, selected.length === 0 && styles.disabled]}>Pin</Text>
          </Pressable>
        </View>
      )}
      <EdgeBlurBars variant="top" />
      <FormSheet
        spec={sheet?.kind === "form" ? sheet.spec : undefined}
        groups={groupOptions}
        {...(sheet?.kind === "form" && sheet.group !== undefined ? { group: sheet.group } : {})}
        onCancel={() => setSheet(undefined)}
        onSubmit={(values) => (sheet?.kind === "form" ? sheet.submit(values) : Promise.resolve())}
      />
      <CategoriesSheet
        items={sheet?.kind === "categories" ? sheet.items : undefined}
        categories={data === undefined ? [] : categoriesOf(data.content, data.state)}
        state={data?.state ?? { categories: [], assignments: {}, pins: [] }}
        onCancel={() => setSheet(undefined)}
        onCreate={(name) =>
          changeCollection(apiBase, dir, page, { _tag: "CreateCategory", name }).then((next) => next.categories.at(-1)?.id)
        }
        onSave={(choices) => {
          if (sheet?.kind !== "categories" || data === undefined) return Promise.resolve();
          return changeCollection(apiBase, dir, page, { _tag: "Assign", assignments: reassign(sheet.items, choices, data.state) }).then(() => {
            setSheet(undefined);
            setSelection(undefined);
          });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.systemBackground,
  },
  center: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  tileRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  chips: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.fillBackground,
  },
  chipOn: {
    backgroundColor: colors.tint,
  },
  chipLabel: {
    color: colors.label,
    fontSize: 14,
  },
  chipLabelOn: {
    color: "white",
    fontWeight: "600",
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 32,
  },
  staleNote: {
    color: colors.warning,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  detail: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
    textAlign: "center",
  },
  retry: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  selectionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.cardBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  selectionCount: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  selectionAction: {
    color: colors.tint,
    fontSize: 16,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.4,
  },
});
