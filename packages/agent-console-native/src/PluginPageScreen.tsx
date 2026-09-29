/**
 * A plugin's page organized into blocks, drawn natively (the NPM page,
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.1), top to
 * bottom as the plugin lists them:
 *
 * - **Facts**: label and value rows (a long value, a description, sits on its
 *   own line below its label), then buttons to other pages, in one card.
 * - **Link**: a button to another of the plugin's pages (All Details).
 * - **Pinned**: the user's pins on one of the plugin's collections (pinned
 *   scripts), always a grid, each runnable from here, with a button to the
 *   whole collection; the plugin's suggestions while nothing is pinned.
 * - **Card**: facts about something that opens its page (the package
 *   manager, opening Packages), with its own actions (an update).
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackHeaderItem, NativeStackHeaderItemMenuAction, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SFSymbol } from "sf-symbols-typescript";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { filterTitle, pinsShownOn, pinTitle } from "./collectionModel";
import { colors } from "./colors";
import { ensureWorkspace } from "./extensionViewsStore";
import { followResult } from "./followResult";
import { confirmFirst, linkKey, openLink } from "./openPage";
import { invokeCollection, invokeSections, pageMenuBlock, type FormSpec, type PageBlock, type SectionRow } from "./pagesClient";
import { FormSheet } from "./CollectionSheets";
import { changeCollection, loadCollection, loadSections, useCollection, useSections } from "./pagesStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { usePullToRefresh } from "./pullToRefresh";
import { RunCountdownRing } from "./RunCountdownRing";
import { useRunCountdown } from "./runCountdown";
import { SkeletonPage } from "./Skeleton";
import { usePrimaryWorktree } from "./primaryWorktree";
import { WorktreePicker } from "./WorktreePicker";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "PluginPage">;
type Navigation = Props["navigation"];

/** A header menu of a page's forms, each opening its sheet. */
const formsMenu = (label: string, icon: SFSymbol, forms: ReadonlyArray<FormSpec>, open: (form: FormSpec) => void): NativeStackHeaderItem => ({
  type: "menu",
  label,
  icon: {
    type: "sfSymbol",
    name: icon,
  },
  menu: {
    items: forms.map(
      (spec): NativeStackHeaderItemMenuAction => ({
        type: "action",
        label: spec.title,
        icon: {
          type: "sfSymbol",
          name: symbolForIcon(spec.icon),
        },
        onPress: () => open(spec),
      }),
    ),
  },
});

/** A page opened from the menu is about nothing beyond its workspace. */
const noParams: Readonly<Record<string, string>> = {};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Label and value rows. With `chevron`, the last row carries it: the card
 * opens a page. */
const Rows = (props: { readonly rows: ReadonlyArray<SectionRow>; readonly chevron?: boolean }): React.ReactElement => (
  <>
    {props.rows.map((row, index) => {
      const chevron = props.chevron === true && index === props.rows.length - 1 ? <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} /> : null;
      // A stacked row's chevron is centered on the row as a whole, beside
      // both its label and its value.
      return row.stacked ? (
        <View key={row.label} style={[styles.stackedRow, index > 0 && styles.rowBorder]}>
          <View style={styles.stackedText}>
            <Text style={styles.factLabel}>{row.label}</Text>
            <Text style={[styles.stackedValue, row.mono && styles.mono]} selectable={props.chevron !== true}>
              {row.value}
            </Text>
          </View>
          {chevron}
        </View>
      ) : (
        <View key={row.label} style={[styles.row, index > 0 && styles.rowBorder]}>
          <Text style={styles.factLabel}>{row.label}</Text>
          <Text style={[styles.factValue, row.mono && styles.mono]} selectable={props.chevron !== true} numberOfLines={1}>
            {row.value}
          </Text>
          {chevron}
        </View>
      );
    })}
  </>
);

/** A button row: an icon, a title, secondary text beside it, a chevron. */
const LinkRow = (props: {
  readonly title: string;
  readonly icon: string | undefined;
  readonly detail?: string;
  readonly onPress: () => void;
  readonly border?: boolean;
}): React.ReactElement => (
  <Pressable style={[styles.row, props.border === true && styles.rowBorder]} onPress={props.onPress}>
    <SystemIcon name={symbolForIcon(props.icon)} size={18} color={colors.tint} />
    <Text style={styles.linkTitle}>{props.title}</Text>
    {props.detail === undefined ? null : <Text style={styles.linkDetail}>{props.detail}</Text>}
    <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} />
  </Pressable>
);

/** One pinned (or suggested) script or filter, as a grid tile. */
const PinTile = (props: {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: SFSymbol;
  readonly busy: boolean;
  readonly playable: boolean;
  /** Counting down to a run: the ring shows in place of play. */
  readonly countdownMs?: number;
  readonly onPress: () => void;
  readonly onLongPress?: () => void;
}): React.ReactElement => (
  <Pressable style={styles.tile} onPress={props.onPress} {...(props.onLongPress === undefined ? {} : { onLongPress: props.onLongPress })}>
    <View style={styles.tileTop}>
      <SystemIcon name={props.icon} size={16} color={colors.tint} />
      <Text style={styles.tileTitle} numberOfLines={2}>
        {props.title}
      </Text>
      {props.countdownMs !== undefined ? (
        <RunCountdownRing size={22} durationMs={props.countdownMs} />
      ) : props.busy ? (
        <ActivityIndicator color={colors.secondaryLabel} />
      ) : props.playable ? (
        <SystemIcon name="play.fill" size={14} color={colors.tint} />
      ) : null}
    </View>
    <Text style={[styles.pinDetail, styles.mono]} numberOfLines={1}>
      {props.subtitle}
    </Text>
  </Pressable>
);

/** The user's pins on a collection: pinned scripts run on a tap, pinned
 * filters open; a long press unpins. */
const PinnedCard = (props: {
  readonly block: Extract<PageBlock, { readonly _tag: "Pinned" }>;
  readonly repo: string;
  readonly dir: string;
  readonly apiBase: string;
  readonly navigation: Navigation;
}): React.ReactElement | null => {
  const { block, dir, apiBase, navigation } = props;
  const page = block.collection.page;
  const load = useCollection(dir, page);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    void loadCollection(apiBase, dir, page, "none");
  }, [apiBase, dir, page]);

  const data = load.kind === "ready" ? load.value : undefined;
  // Each page shows the pins meant for it (collectionModel.pinsShownOn).
  const pins = data === undefined ? [] : pinsShownOn(data.content, data.state, block.group);
  // With nothing pinned, the plugin's best picks, said to be suggestions.
  const suggested = data === undefined || pins.length > 0 ? [] : data.content.items.filter((item) => block.suggestions.includes(item.key));
  // Running waits out the countdown, so a stray tap starts nothing; a tap
  // while it counts stops it.
  const countdown = useRunCountdown();
  const runItem = (key: string, title: string): void => {
    const item = data?.content.items.find((candidate) => candidate.key === key);
    const run = item?.run;
    if (item === undefined || run === undefined) return;
    if (countdown.counting?.key === item.key) {
      countdown.cancel();
      return;
    }
    countdown.start(item.key, () => {
      setBusy(item.key);
      invokeCollection(apiBase, dir, page, { _tag: "Item", key: item.key }, run.command, {})
        .then((result) => followResult(navigation, apiBase, result, title))
        .catch((error: unknown) => Alert.alert(`Couldn’t run ${title}`, messageOf(error)))
        .finally(() => setBusy(undefined));
    });
  };
  const unpin = (id: string, title: string): void =>
    Alert.alert(title, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unpin",
        style: "destructive",
        onPress: () => {
          changeCollection(apiBase, dir, page, { _tag: "Unpin", id }).catch((error: unknown) => Alert.alert(`Couldn’t unpin ${title}`, messageOf(error)));
        },
      },
    ]);

  const tiles: ReadonlyArray<React.ReactElement> =
    data === undefined
      ? []
      : pins.length === 0
        ? suggested.map((item) => (
            <PinTile
              key={item.key}
              title={item.title}
              subtitle={item.name}
              icon="terminal"
              busy={busy === item.key}
              playable={item.run !== undefined}
              {...(countdown.counting?.key === item.key ? { countdownMs: countdown.counting.durationMs } : {})}
              onPress={() => runItem(item.key, item.title)}
            />
          ))
        : pins.map((pin) => {
            const title = pinTitle(data.content, data.state, pin);
            if (pin._tag === "PinnedFilter") {
              return (
                <PinTile
                  key={pin.id}
                  title={title}
                  subtitle={filterTitle(data.content, data.state, pin)}
                  icon="line.3.horizontal.decrease.circle"
                  busy={false}
                  playable={false}
                  onPress={() =>
                    navigation.push("Collection", {
                      repo: props.repo,
                      dir,
                      page,
                      title,
                      view: {
                        kind: "filter",
                        ...(pin.group === undefined ? {} : { group: pin.group }),
                        ...(pin.category === undefined ? {} : { category: pin.category }),
                      },
                    })
                  }
                  onLongPress={() => unpin(pin.id, title)}
                />
              );
            }
            const item = data.content.items.find((candidate) => candidate.key === pin.item);
            return (
              <PinTile
                key={pin.id}
                title={title}
                subtitle={item === undefined ? "No longer in package.json" : item.name}
                icon="terminal"
                busy={busy === pin.item}
                playable={item?.run !== undefined}
                {...(countdown.counting?.key === pin.item ? { countdownMs: countdown.counting.durationMs } : {})}
                onPress={() => runItem(pin.item, title)}
                onLongPress={() => unpin(pin.id, title)}
              />
            );
          });

  // Nothing pinned and nothing suggested: no section at all (the page's
  // Packages section has a Scripts row then). Nor one while the pins load,
  // so it does not flash up empty; they are prefetched with the page.
  if (load.kind === "loading" || (load.kind === "ready" && tiles.length === 0)) return null;

  // Always a grid: pins (or suggestions) as two-column tiles, then the way
  // to all of them.
  return (
    <View>
      <Text style={styles.sectionLabel}>{block.title}</Text>
      {load.kind === "failed" ? (
        <View style={[styles.card, styles.row]}>
          <Text style={styles.hint}>Couldn’t load pins: {load.message}</Text>
        </View>
      ) : (
        <View style={styles.grid}>{tiles}</View>
      )}
      <View style={[styles.card, styles.linkCard]}>
        <LinkRow title={block.viewAll} icon={block.collection.icon} onPress={() => openLink(navigation, props.repo, dir, block.collection)} />
      </View>
    </View>
  );
};

export const PluginPageScreen = (props: Props): React.ReactElement => {
  const { repo, page, title } = props.route.params;
  const params = props.route.params.params ?? noParams;
  // A worktree page: it shows the repo's primary worktree, following the
  // picker (primaryWorktree.ts).
  const worktree = usePrimaryWorktree(repo, props.route.params.dir);
  const { dir } = worktree;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const load = useSections(dir, page, params);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);
  const [form, setForm] = React.useState<FormSpec | undefined>(undefined);
  const pull = usePullToRefresh(() => loadSections(apiBase, dir, page, params, "force"));

  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
    void loadSections(apiBase, dir, page, params, "ifChanged");
  }, [apiBase, dir, page, params]);

  // Back from an install, an edit or a new package, the files behind the
  // page changed.
  useFocusEffect(
    React.useCallback(() => {
      void loadSections(apiBase, dir, page, params, "ifChanged");
    }, [apiBase, dir, page, params]),
  );

  const shownTitle = load.kind === "ready" ? load.value.title : title;
  const showPicker = Object.keys(params).length === 0 && worktree.primary !== undefined;
  const menu = React.useMemo((): ReadonlyArray<FormSpec> => (load.kind === "ready" ? load.value.menu : []), [load]);
  const add = React.useMemo((): ReadonlyArray<FormSpec> => (load.kind === "ready" ? load.value.add : []), [load]);
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: shownTitle,
      // A page opened from the repo menu names its worktree under its title,
      // and opens the worktree menu; a page about one package keeps its title.
      ...(showPicker ? { headerTitle: () => <WorktreePicker repo={repo} fallback={props.route.params.dir} title={shownTitle} /> } : {}),
      // The + menu adds (a dependency, a package); the 3-dot menu has the
      // rest. Each only when the page offers something for it.
      unstable_headerRightItems: () => [
        ...(add.length === 0 ? [] : [formsMenu("Add", "plus", add, setForm)]),
        ...(menu.length === 0 ? [] : [formsMenu("More", "ellipsis", menu, setForm)]),
      ],
    });
  }, [navigation, shownTitle, menu, add, showPicker, repo, props.route.params.dir]);

  if (load.kind === "loading") {
    return (
      <View style={styles.root}>
        <SkeletonPage top={headerHeight} />
      </View>
    );
  }

  if (load.kind === "failed") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        <Text style={styles.message}>Couldn’t load {title}.</Text>
        <Text style={styles.detail}>{load.message}</Text>
        <TouchableOpacity onPress={() => void loadSections(apiBase, dir, page, params, "force")}>
          <Text style={styles.retry}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const runCardAction = (block: string, command: string, label: string): void => {
    setBusy(`${block} ${command}`);
    invokeSections(apiBase, dir, page, params, block, command, {})
      .then((result) => followResult(navigation, apiBase, result, label))
      .catch((error: unknown) => Alert.alert(`Couldn’t ${label.toLowerCase()}`, messageOf(error)))
      .finally(() => setBusy(undefined));
  };

  const renderBlock = (block: PageBlock, index: number): React.ReactElement => {
    switch (block._tag) {
      case "Facts":
        return (
          <View key={`facts ${index}`}>
            {block.title === undefined ? <View style={styles.gap} /> : <Text style={styles.sectionLabel}>{block.title}</Text>}
            <Pressable style={styles.card} disabled={block.opens === undefined} onPress={() => (block.opens === undefined ? undefined : openLink(navigation, repo, dir, block.opens))}>
              <Rows rows={block.rows} chevron={block.opens !== undefined} />
              {block.links.map((link, linkIndex) => (
                <LinkRow key={linkKey(link)} title={link.title} icon={link.icon} {...(link.detail === undefined ? {} : { detail: link.detail })} border={block.rows.length > 0 || linkIndex > 0} onPress={() => openLink(navigation, repo, dir, link)} />
              ))}
            </Pressable>
          </View>
        );
      case "Link":
        return (
          <View key={`link ${linkKey(block.link)}`} style={[styles.card, styles.linkCard]}>
            <LinkRow title={block.link.title} icon={block.link.icon} onPress={() => openLink(navigation, repo, dir, block.link)} />
          </View>
        );
      case "Pinned":
        return <PinnedCard key={`pinned ${linkKey(block.collection)}`} block={block} repo={repo} dir={dir} apiBase={apiBase} navigation={navigation} />;
      case "Card": {
        const { opens } = block;
        return (
          <View key={`card ${block.key}`}>
            <View style={styles.gap} />
            <View style={styles.card}>
              <Pressable style={styles.cardHeader} disabled={opens === undefined} onPress={() => (opens === undefined ? undefined : openLink(navigation, repo, dir, opens))}>
                <SystemIcon name={symbolForIcon(block.icon)} size={22} color={colors.tint} />
                <Text style={styles.cardTitle}>{block.title}</Text>
                {opens === undefined ? null : <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} />}
              </Pressable>
              <View style={styles.rowBorder} />
              <Rows rows={block.rows} />
              {block.actions.map((action) => (
                <Pressable key={action.command} style={[styles.row, styles.rowBorder]} onPress={() => confirmFirst(action, () => runCardAction(block.key, action.command, action.title))}>
                  {busy === `${block.key} ${action.command}` ? (
                    <ActivityIndicator color={colors.secondaryLabel} />
                  ) : (
                    <SystemIcon name={symbolForIcon(action.icon)} size={17} color={colors.tint} />
                  )}
                  <Text style={[styles.linkTitle, styles.tinted]}>{action.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      }
      case "Actions":
        return (
          <View key={`actions ${block.key}`}>
            {block.title === undefined ? <View style={styles.gap} /> : <Text style={styles.sectionLabel}>{block.title}</Text>}
            <View style={styles.card}>
              {block.actions.map((action, actionIndex) => (
                <Pressable
                  key={action.command}
                  style={[styles.row, actionIndex > 0 && styles.rowBorder]}
                  onPress={() => confirmFirst(action, () => runCardAction(block.key, action.command, action.title))}
                >
                  {busy === `${block.key} ${action.command}` ? (
                    <ActivityIndicator color={colors.secondaryLabel} />
                  ) : (
                    <SystemIcon name={symbolForIcon(action.icon)} size={17} color={action.destructive === true ? colors.destructive : colors.tint} />
                  )}
                  <Text style={[styles.linkTitle, action.destructive === true ? styles.destructive : styles.tinted]}>{action.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
    }
  };

  return (
    <>
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded page. Refreshing failed: {load.error}</Text>}
      {load.value.blocks.map(renderBlock)}
    </ScrollView>
    <FormSheet
      spec={form}
      groups={[]}
      onCancel={() => setForm(undefined)}
      onSubmit={(values) =>
        form === undefined
          ? Promise.resolve()
          : invokeSections(apiBase, dir, page, params, pageMenuBlock, form.command, values).then(async (result) => {
              setForm(undefined);
              await followResult(navigation, apiBase, result, form.title);
              await loadSections(apiBase, dir, page, params, "ifChanged");
            })
      }
    />
    </>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 16,
  },
  staleNote: {
    color: colors.warning,
    fontSize: 12,
    marginTop: 12,
    marginHorizontal: 4,
  },
  gap: {
    height: 20,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 6,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    overflow: "hidden",
  },
  linkCard: {
    marginTop: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 46,
  },
  stackedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stackedText: {
    flex: 1,
    gap: 4,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 18,
    fontWeight: "600",
  },
  linkTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  linkDetail: {
    color: colors.secondaryLabel,
    fontSize: 16,
  },
  destructive: {
    color: colors.destructive,
  },
  tinted: {
    color: colors.tint,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "48%",
    flexGrow: 1,
    minHeight: 72,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    justifyContent: "space-between",
  },
  tileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tileTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  pinDetail: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  factLabel: {
    color: colors.label,
    fontSize: 16,
  },
  factValue: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 16,
    textAlign: "right",
  },
  stackedValue: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "left",
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 14,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 14,
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
});
