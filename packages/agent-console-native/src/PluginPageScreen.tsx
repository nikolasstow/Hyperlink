/**
 * A plugin's page organized into blocks, drawn natively (the NPM page,
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.1), top to
 * bottom as the plugin lists them:
 *
 * - **Facts**: label and value rows (a long value, a description, sits on its
 *   own line below its label), then buttons to other pages, in one card.
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
import type { NativeStackHeaderItemMenuAction, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { filterTitle, pinTitle } from "./collectionModel";
import { colors } from "./colors";
import { ensureWorkspace } from "./extensionViewsStore";
import { followResult } from "./followResult";
import { confirmFirst, openLink } from "./openPage";
import { invokeCollection, invokeSections, pageMenuBlock, type FormSpec, type PageBlock, type SectionRow } from "./pagesClient";
import { FormSheet } from "./CollectionSheets";
import { changeCollection, loadCollection, loadSections, useCollection, useSections } from "./pagesStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "PluginPage">;
type Navigation = Props["navigation"];

/** A page opened from the menu is about nothing beyond its workspace. */
const noParams: Readonly<Record<string, string>> = {};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
  // A package's own page shows only its pins.
  const pins = data === undefined ? [] : data.state.pins.filter((pin) => block.group === undefined || (pin._tag === "PinnedItem" ? data.content.items.find((item) => item.key === pin.item)?.group === block.group : pin.group === block.group));
  // With nothing pinned, the plugin's best picks, said to be suggestions.
  const suggested = data === undefined || pins.length > 0 ? [] : data.content.items.filter((item) => block.suggestions.includes(item.key));
  const runItem = (key: string, title: string): void => {
    const item = data?.content.items.find((candidate) => candidate.key === key);
    const run = item?.run;
    if (item === undefined || run === undefined) return;
    setBusy(item.key);
    invokeCollection(apiBase, dir, page, { _tag: "Item", key: item.key }, run.command, {})
      .then((result) => followResult(navigation, apiBase, result, title))
      .catch((error: unknown) => Alert.alert(`Couldn’t run ${title}`, messageOf(error)))
      .finally(() => setBusy(undefined));
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
        ) : data === undefined || (pins.length === 0 && suggested.length === 0) ? (
          <View style={styles.row}>
            <Text style={styles.hint}>{block.empty}</Text>
          </View>
        ) : pins.length === 0 ? (
          <>
            {suggested.map((item, index) => (
              <Pressable key={item.key} style={[styles.row, index > 0 && styles.rowBorder]} onPress={() => runItem(item.key, item.title)}>
                <SystemIcon name="terminal" size={18} color={colors.secondaryLabel} />
                <View style={styles.pinText}>
                  <Text style={styles.linkTitle}>{item.title}</Text>
                  <Text style={[styles.pinDetail, styles.mono]}>{item.name}</Text>
                </View>
                {busy === item.key ? <ActivityIndicator color={colors.secondaryLabel} /> : <SystemIcon name="play.fill" size={15} color={colors.tint} />}
              </Pressable>
            ))}
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.hint}>{block.suggestionsNote}</Text>
            </View>
          </>
        ) : (
          pins.map((pin, index) => {
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
            return (
              <Pressable key={pin.id} style={[styles.row, index > 0 && styles.rowBorder]} onPress={() => runItem(pin.item, title)} onLongPress={() => unpin(pin.id, title)}>
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
  const params = props.route.params.params ?? noParams;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const load = useSections(dir, page, params);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);
  const [form, setForm] = React.useState<FormSpec | undefined>(undefined);

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
  const menu = React.useMemo((): ReadonlyArray<FormSpec> => (load.kind === "ready" ? load.value.menu : []), [load]);
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: shownTitle,
      unstable_headerRightItems: () =>
        menu.length === 0
          ? []
          : [
              {
                type: "menu",
                label: "More",
                icon: {
                  type: "sfSymbol",
                  name: "ellipsis",
                },
                menu: {
                  items: menu.map(
                    (spec): NativeStackHeaderItemMenuAction => ({
                      type: "action",
                      label: spec.title,
                      icon: {
                        type: "sfSymbol",
                        name: symbolForIcon(spec.icon),
                      },
                      onPress: () => setForm(spec),
                    }),
                  ),
                },
              },
            ],
    });
  }, [navigation, shownTitle, menu]);

  if (load.kind !== "ready") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        {load.kind === "loading" ? (
          <ActivityIndicator color={colors.secondaryLabel} />
        ) : (
          <>
            <Text style={styles.message}>Couldn’t load {title}.</Text>
            <Text style={styles.detail}>{load.message}</Text>
            <TouchableOpacity onPress={() => void loadSections(apiBase, dir, page, params, "force")}>
              <Text style={styles.retry}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
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
            <View style={styles.card}>
              <Rows rows={block.rows} />
              {block.links.map((link, linkIndex) => (
                <LinkRow key={link.page} title={link.title} icon={link.icon} {...(link.detail === undefined ? {} : { detail: link.detail })} border={block.rows.length > 0 || linkIndex > 0} onPress={() => openLink(navigation, repo, dir, link)} />
              ))}
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
      refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={() => void loadSections(apiBase, dir, page, params, "force")} />}
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
