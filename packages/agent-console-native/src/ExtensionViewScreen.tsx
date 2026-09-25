/**
 * A VS Code tree view, drawn natively: the rows an extension's tree provider
 * returns, run by the backend's extension host (npm's "NPM Scripts" first).
 *
 * - The chevron expands a row, loading its children on first open.
 * - Tapping a row does what the extension says tapping does (npm opens the
 *   script in package.json at its line).
 * - A row's inline run action becomes a play button; everything else it
 *   offers is in the long-press action sheet.
 * - What an action asks for is carried out here: a task runs on the backend's
 *   process runner and opens its live output; a file opens in the viewer.
 *
 * Nothing fails quietly: a load that fails shows the server's message with a
 * retry, and an action that fails says why.
 *
 * @internal
 */
import * as React from "react";
import { Button, ContextMenu, Host, HStack, Image, ProgressView, RNHostView, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import { ActivityIndicator, Alert, DynamicColorIOS, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { isRunIcon, symbolForIcon } from "./codicons";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { invokeViewAction, startTask, type InvokeResult, type TreeEntry, type ViewAction, type ViewNode } from "./extensionViewsClient";
import { ensureWorkspace, revalidateTree, useViewTree } from "./extensionViewsStore";
import { codeSurfaceUri } from "./codeSurfaceAsset";
import { warmCodeSurfaces } from "../modules/code-surface";
import type { RootStackParamList } from "./RootNavigator";
import { iconForFile } from "./fileIcon";
import { SetiIcon } from "./SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "./setiIcons";
import { getApiAddress } from "./settings";

type Props = NativeStackScreenProps<RootStackParamList, "ExtensionView">;

const INDENT = 20;
const CHEVRON_COL = 20;
const ICON_COL = 30;
const DIVIDER = DynamicColorIOS({ light: "rgba(60,60,67,0.4)", dark: "rgba(120,120,128,0.5)" });

/** The tree as the store has it (flat, parent ids), indexed for drawing. */
interface Indexed {
  /** Children per parent id; the top level is under `rootKey`. */
  readonly children: ReadonlyMap<string, ReadonlyArray<ViewNode>>;
}

const rootKey = "";

const indexTree = (entries: ReadonlyArray<TreeEntry>): Indexed => ({
  children: entries.reduce(
    (map, entry) => new Map([...map, [entry.parent ?? rootKey, [...(map.get(entry.parent ?? rootKey) ?? []), entry.node]]]),
    new Map<string, ReadonlyArray<ViewNode>>(),
  ),
});

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The action that gets the play button: the row's inline run, if it has one. */
const playActionOf = (node: ViewNode): ViewAction | undefined => node.actions.find((action) => action.inline && isRunIcon(action.icon));

/** Everything else the row offers, once each, for the long-press sheet. */
const menuActionsOf = (node: ViewNode): ReadonlyArray<ViewAction> => {
  const play = playActionOf(node);
  return node.actions.filter(
    (action, index, all) => action.command !== play?.command && all.findIndex((other) => other.command === action.command) === index,
  );
};

interface VisibleRow {
  readonly node: ViewNode;
  readonly depth: number;
}

/** The rows on screen: the top level, and the children of expanded rows. */
const visibleRows = (tree: Indexed, expanded: ReadonlySet<string>, parent: string, depth: number): ReadonlyArray<VisibleRow> =>
  (tree.children.get(parent) ?? []).flatMap((node) =>
    expanded.has(node.id) ? [{ node, depth }, ...visibleRows(tree, expanded, node.id, depth + 1)] : [{ node, depth }],
  );

/** The icon theme's glyph for a row that stands for a file: VS Code's cue is a
 * generic file or folder icon plus the file's path. */
const fileGlyphOf = (node: ViewNode) => {
  if (node.resource === undefined || (node.icon !== "codicon:file" && node.icon !== "codicon:folder")) return undefined;
  if (node.icon === "codicon:folder") return setiFolderGlyph ?? setiDefaultGlyph;
  return iconForFile(node.resource.split("/").at(-1) ?? node.resource).glyph;
};

/**
 * One row, as SwiftUI so it carries the native context menu (long press lifts
 * the row, with every action the row offers below it, each with its icon). The
 * same structure SessionCard runs. The file icon is the one React Native piece,
 * hosted with RNHostView, since Seti glyphs are SVG paths SwiftUI cannot draw.
 */
const Row = (props: {
  readonly row: VisibleRow;
  readonly width: number;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onAction: (action: ViewAction) => void;
}): React.ReactElement => {
  const { node, depth } = props.row;
  const play = playActionOf(node);
  const menu = menuActionsOf(node);
  const glyph = fileGlyphOf(node);
  const trigger = (
    <HStack
      spacing={10}
      alignment="center"
      modifiers={[
        padding({ leading: 12 + depth * INDENT, trailing: 16, top: 10, bottom: 10 }),
        frame({ width: props.width, alignment: "leading" }),
        background(colors.systemBackground),
        onTapGesture(node.collapsible ? props.onToggle : props.onOpen),
      ]}
    >
      {node.collapsible ? (
        <Image systemName={props.expanded ? "chevron.down" : "chevron.right"} size={12} color={colors.tint} modifiers={[frame({ width: CHEVRON_COL })]} />
      ) : (
        <UIText modifiers={[frame({ width: CHEVRON_COL })]}>{""}</UIText>
      )}
      {glyph === undefined ? (
        <Image systemName={symbolForIcon(node.icon)} size={17} color={colors.secondaryLabel} modifiers={[frame({ width: ICON_COL })]} />
      ) : (
        <RNHostView matchContents>
          <View style={styles.fileIcon}>
            <SetiIcon glyph={glyph} size={22} />
          </View>
        </RNHostView>
      )}
      <VStack alignment="leading" spacing={2}>
        <UIText modifiers={[font({ size: 15 }), foregroundStyle(colors.label), lineLimit(1)]}>{node.label}</UIText>
        {node.description === undefined ? null : (
          <UIText modifiers={[font({ size: 12, family: "Menlo" }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{node.description}</UIText>
        )}
      </VStack>
      <Spacer />
      {play === undefined ? null : props.busy ? (
        <ProgressView />
      ) : (
        <Button systemImage={symbolForIcon(play.icon)} onPress={() => props.onAction(play)} />
      )}
    </HStack>
  );
  return (
    <View>
      <Host matchContents={{ vertical: true, horizontal: false }} style={{ width: props.width }}>
        {menu.length === 0 ? (
          trigger
        ) : (
          <ContextMenu>
            <ContextMenu.Items>
              {menu.map((action) => (
                <Button key={action.command} label={action.title} systemImage={symbolForIcon(action.icon)} onPress={() => props.onAction(action)} />
              ))}
            </ContextMenu.Items>
            <ContextMenu.Trigger>{trigger}</ContextMenu.Trigger>
          </ContextMenu>
        )}
      </Host>
      <View style={[styles.separator, { marginLeft: 12 + depth * INDENT + CHEVRON_COL + ICON_COL + 20 }]} />
    </View>
  );
};

export const ExtensionViewScreen = (props: Props): React.ReactElement => {
  const { dir, view, title } = props.route.params;
  const { navigation } = props;
  const { address, backend } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const load = useViewTree(dir, view);
  const tree = React.useMemo(() => indexTree(load.kind === "ready" ? load.value : []), [load]);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string> | undefined>(undefined);
  const [busy, setBusy] = React.useState<string | undefined>(undefined);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  // Cached rows are already on screen; bring them up to date behind them.
  // `ifChanged` costs the host a few file stats when nothing moved.
  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
    void revalidateTree(apiBase, dir, view, "ifChanged");
  }, [apiBase, dir, view]);

  // Opening a script opens the viewer; have the editor warm before that tap.
  React.useEffect(() => {
    void codeSurfaceUri()
      .then((uri) => warmCodeSurfaces(1, uri))
      .catch((cause: unknown) => console.error("[code surface] warming the pool failed", cause));
  }, []);

  /** Rows start as the extension asked (expanded or not) until toggled. */
  const initiallyExpanded = React.useMemo(
    () => new Set([...tree.children.values()].flat().filter((node) => node.expanded).map((node) => node.id)),
    [tree],
  );
  const open = expanded ?? initiallyExpanded;

  const toggle = (node: ViewNode): void => {
    const next = new Set(open);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    setExpanded(next);
  };

  /** Carry out what an action asked for. */
  const follow = async (result: InvokeResult, action: ViewAction): Promise<void> => {
    switch (result._tag) {
      case "RunTask": {
        const id = await startTask(backend, result);
        navigation.navigate("ProcessOutput", { id, title: result.name, commandLine: [result.command, ...result.args].join(" ") });
        return;
      }
      case "OpenFile":
        navigation.navigate("FileViewer", {
          path: result.path,
          name: result.path.split("/").at(-1) ?? result.path,
          ...(result.line === undefined ? {} : { line: result.line }),
        });
        return;
      case "Completed":
        if (result.messages.length > 0) Alert.alert(action.title, result.messages.join("\n"));
        return;
    }
  };

  const run = (node: ViewNode, action: ViewAction): void => {
    setBusy(node.id);
    invokeViewAction(apiBase, dir, view, node.id, action.command)
      .then((result) => follow(result, action))
      .catch((error: unknown) => Alert.alert(`Couldn’t ${action.title.toLowerCase()} ${node.label}`, messageOf(error)))
      .finally(() => setBusy(undefined));
  };

  const rows = visibleRows(tree, open, rootKey, 0);

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
          <TouchableOpacity onPress={() => void revalidateTree(apiBase, dir, view, "force")}>
            <Text style={styles.retry}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={() => void revalidateTree(apiBase, dir, view, "force")} />}
        >
          {load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded scripts. Refreshing failed: {load.error}</Text>}
          {rows.length === 0 ? <Text style={[styles.message, styles.emptyNote]}>Nothing here.</Text> : null}
          {rows.map((row) => (
            <Row
              key={row.node.id}
              row={row}
              width={width}
              busy={busy === row.node.id}
              expanded={open.has(row.node.id)}
              onToggle={() => toggle(row.node)}
              onOpen={() => {
                if (row.node.open !== undefined) run(row.node, row.node.open);
              }}
              onAction={(action) => run(row.node, action)}
            />
          ))}
        </ScrollView>
      )}
      <EdgeBlurBars variant="top" />
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
  fileIcon: {
    width: ICON_COL,
    alignItems: "center",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: DIVIDER,
  },
  staleNote: {
    color: colors.warning,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyNote: {
    textAlign: "center",
    marginTop: 24,
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
