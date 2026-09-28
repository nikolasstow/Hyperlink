/**
 * A plugin's page organized into blocks, drawn natively (the NPM page,
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.1), top to
 * bottom as the plugin lists them:
 *
 * - **Facts**: label and value rows; a long value (a description) sits on its
 *   own line below its label.
 * - **Link**: a button to another of the plugin's pages (All Details).
 * - **Pinned**: the user's pins on one of the plugin's collections (pinned
 *   scripts), each runnable from here, with a button to the whole collection.
 * - **Card**: facts about something that opens its page (the package
 *   manager, opening Packages), with its own actions (an update).
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { filterTitle, pinTitle } from "./collectionModel";
import { colors } from "./colors";
import { ensureWorkspace } from "./extensionViewsStore";
import { followResult } from "./followResult";
import { invokeCollection, invokeSections, type PageBlock, type PageLink, type SectionRow } from "./pagesClient";
import { changeCollection, loadCollection, loadSections, useCollection, useSections } from "./pagesStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "PluginPage">;
type Navigation = Props["navigation"];

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Open one of the plugin's pages, drawn by its kind. */
const openLink = (navigation: Navigation, repo: string, dir: string, link: PageLink): void => {
  if (link.kind === "collection") navigation.push("Collection", { repo, dir, page: link.page, title: link.title, view: { kind: "home" } });
  else if (link.kind === "sections") navigation.push("PluginPage", { repo, dir, page: link.page, title: link.title });
  else navigation.push("ExtensionView", { repo, dir, view: link.page, title: link.title });
};

const Rows = (props: { readonly rows: ReadonlyArray<SectionRow> }): React.ReactElement => (
  <>
    {props.rows.map((row, index) =>
      row.stacked ? (
        <View key={row.label} style={[styles.stackedRow, index > 0 && styles.rowBorder]}>
          <Text style={styles.factLabel}>{row.label}</Text>
          <Text style={[styles.stackedValue, row.mono && styles.mono]} selectable>
            {row.value}
          </Text>
        </View>
      ) : (
        <View key={row.label} style={[styles.row, index > 0 && styles.rowBorder]}>
          <Text style={styles.factLabel}>{row.label}</Text>
          <Text style={[styles.factValue, row.mono && styles.mono]} selectable numberOfLines={1}>
            {row.value}
          </Text>
        </View>
      ),
    )}
  </>
);

/** A button row: an icon, a title, a chevron. */
const LinkRow = (props: { readonly title: string; readonly icon: string | undefined; readonly onPress: () => void; readonly border?: boolean }): React.ReactElement => (
  <Pressable style={[styles.row, props.border === true && styles.rowBorder]} onPress={props.onPress}>
    <SystemIcon name={symbolForIcon(props.icon)} size={18} color={colors.tint} />
    <Text style={styles.linkTitle}>{props.title}</Text>
    <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} />
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
}): React.ReactElement => {
  const { block, dir, apiBase, navigation } = props;
  const page = block.collection.page;
  const load = useCollection(dir, page);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    void loadCollection(apiBase, dir, page, "none");
  }, [apiBase, dir, page]);

  const data = load.kind === "ready" ? load.value : undefined;
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

  return (
    <View>
      <Text style={styles.sectionLabel}>{block.title}</Text>
      <View style={styles.card}>
        {load.kind === "loading" ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.secondaryLabel} />
          </View>
        ) : load.kind === "failed" ? (
          <View style={styles.row}>
            <Text style={styles.hint}>Couldn’t load pins: {load.message}</Text>
          </View>
        ) : data === undefined || data.state.pins.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.hint}>{block.empty}</Text>
          </View>
        ) : (
          data.state.pins.map((pin, index) => {
            const title = pinTitle(data.content, data.state, pin);
            if (pin._tag === "PinnedFilter") {
              return (
                <Pressable
                  key={pin.id}
                  style={[styles.row, index > 0 && styles.rowBorder]}
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
                >
                  <SystemIcon name="line.3.horizontal.decrease.circle" size={18} color={colors.tint} />
                  <View style={styles.pinText}>
                    <Text style={styles.linkTitle}>{title}</Text>
                    <Text style={styles.pinDetail}>{filterTitle(data.content, data.state, pin)}</Text>
                  </View>
                  <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} />
                </Pressable>
              );
            }
            const item = data.content.items.find((candidate) => candidate.key === pin.item);
            const run = item?.run;
            const start = (): void => {
              if (item === undefined || run === undefined) return;
              setBusy(item.key);
              invokeCollection(apiBase, dir, page, { _tag: "Item", key: item.key }, run.command, {})
                .then((result) => followResult(navigation, apiBase, result, item.title))
                .catch((error: unknown) => Alert.alert(`Couldn’t run ${item.title}`, messageOf(error)))
                .finally(() => setBusy(undefined));
            };
            return (
              <Pressable key={pin.id} style={[styles.row, index > 0 && styles.rowBorder]} onPress={start} onLongPress={() => unpin(pin.id, title)}>
                <SystemIcon name="terminal" size={18} color={colors.secondaryLabel} />
                <View style={styles.pinText}>
                  <Text style={styles.linkTitle}>{title}</Text>
                  <Text style={[styles.pinDetail, styles.mono]}>{item === undefined ? "No longer in package.json" : item.name}</Text>
                </View>
                {busy === pin.item ? <ActivityIndicator color={colors.secondaryLabel} /> : run === undefined ? null : <SystemIcon name="play.fill" size={15} color={colors.tint} />}
              </Pressable>
            );
          })
        )}
        <LinkRow title={block.viewAll} icon={block.collection.icon} border onPress={() => openLink(navigation, props.repo, dir, block.collection)} />
      </View>
    </View>
  );
};

export const PluginPageScreen = (props: Props): React.ReactElement => {
  const { repo, dir, page, title } = props.route.params;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const load = useSections(dir, page);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
    void loadSections(apiBase, dir, page, "ifChanged");
  }, [apiBase, dir, page]);

  const shownTitle = load.kind === "ready" ? load.value.title : title;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: shownTitle });
  }, [navigation, shownTitle]);

  if (load.kind !== "ready") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        {load.kind === "loading" ? (
          <ActivityIndicator color={colors.secondaryLabel} />
        ) : (
          <>
            <Text style={styles.message}>Couldn’t load {title}.</Text>
            <Text style={styles.detail}>{load.message}</Text>
            <TouchableOpacity onPress={() => void loadSections(apiBase, dir, page, "force")}>
              <Text style={styles.retry}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const runCardAction = (block: string, command: string, label: string): void => {
    setBusy(`${block} ${command}`);
    invokeSections(apiBase, dir, page, block, command)
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
            <View style={styles.card}>
              <Rows rows={block.rows} />
            </View>
          </View>
        );
      case "Link":
        return (
          <View key={`link ${block.link.page}`} style={[styles.card, styles.linkCard]}>
            <LinkRow title={block.link.title} icon={block.link.icon} onPress={() => openLink(navigation, repo, dir, block.link)} />
          </View>
        );
      case "Pinned":
        return <PinnedCard key={`pinned ${block.collection.page}`} block={block} repo={repo} dir={dir} apiBase={apiBase} navigation={navigation} />;
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
                <Pressable key={action.command} style={[styles.row, styles.rowBorder]} onPress={() => runCardAction(block.key, action.command, action.title)}>
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
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={() => void loadSections(apiBase, dir, page, "force")} />}
    >
      {load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded page. Refreshing failed: {load.error}</Text>}
      {load.value.blocks.map(renderBlock)}
    </ScrollView>
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
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  tinted: {
    color: colors.tint,
  },
  pinText: {
    flex: 1,
    gap: 2,
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
