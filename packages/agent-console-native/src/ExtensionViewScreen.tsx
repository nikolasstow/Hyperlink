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
import { ActivityIndicator, Alert, DynamicColorIOS, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { isRunIcon, symbolForIcon } from "./codicons";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { invokeViewAction, startTask, viewChildren, type InvokeResult, type ViewAction, type ViewNode } from "./extensionViewsClient";
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

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly ids: ReadonlyArray<string> }
  | { readonly kind: "failed"; readonly message: string };

interface Tree {
  readonly nodes: ReadonlyMap<string, ViewNode>;
  /** Children per parent id; the top level is under `rootKey`. */
  readonly children: ReadonlyMap<string, Load>;
  readonly expanded: ReadonlySet<string>;
}

const rootKey = "";

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
  readonly load: Load | undefined;
}

/** The rows on screen: the top level, and the children of expanded rows. */
const visibleRows = (tree: Tree, parent: string, depth: number): ReadonlyArray<VisibleRow> => {
  const load = tree.children.get(parent);
  if (load?.kind !== "ready") return [];
  return load.ids.flatMap((id) => {
    const node = tree.nodes.get(id);
    if (node === undefined) return [];
    const row: VisibleRow = { node, depth, load: tree.children.get(id) };
    return tree.expanded.has(id) ? [row, ...visibleRows(tree, id, depth + 1)] : [row];
  });
};

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
  const { node, depth, load } = props.row;
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
      {node.collapsible && props.expanded && load?.kind === "loading" ? (
        <ProgressView modifiers={[frame({ width: CHEVRON_COL })]} />
      ) : node.collapsible ? (
        <Image
          systemName={load?.kind === "failed" ? "exclamationmark.triangle.fill" : props.expanded ? "chevron.down" : "chevron.right"}
          size={12}
          color={load?.kind === "failed" ? colors.warning : colors.tint}
          modifiers={[frame({ width: CHEVRON_COL })]}
        />
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
      {load?.kind === "failed" && props.expanded ? <Text style={[styles.inlineError, { marginLeft: 12 + depth * INDENT + CHEVRON_COL + ICON_COL + 20 }]}>{load.message}</Text> : null}
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
  const [tree, setTree] = React.useState<Tree>({
    nodes: new Map(),
    children: new Map([[rootKey, { kind: "loading" }]]),
    expanded: new Set(),
  });
  const [busy, setBusy] = React.useState<string | undefined>(undefined);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  /** Fetch one level (the top level for `rootKey`) into the tree. */
  const load = React.useCallback(
    (parent: string): void => {
      setTree((current) => ({ ...current, children: new Map([...current.children, [parent, { kind: "loading" }]]) }));
      viewChildren(apiBase, dir, view, parent === rootKey ? undefined : parent).then(
        (nodes) =>
          setTree((current) => ({
            ...current,
            nodes: new Map([...current.nodes, ...nodes.map((node): readonly [string, ViewNode] => [node.id, node])]),
            children: new Map([...current.children, [parent, { kind: "ready", ids: nodes.map((node) => node.id) }]]),
          })),
        (error: unknown) =>
          setTree((current) => ({
            ...current,
            children: new Map([...current.children, [parent, { kind: "failed", message: messageOf(error) }]]),
          })),
      );
    },
    [apiBase, dir, view],
  );

  React.useEffect(() => {
    load(rootKey);
  }, [load]);

  const toggle = (node: ViewNode): void => {
    const opening = !tree.expanded.has(node.id);
    setTree((current) => {
      const expanded = new Set(current.expanded);
      if (opening) expanded.add(node.id);
      else expanded.delete(node.id);
      return { ...current, expanded };
    });
    // First open, or a retry after a failed load.
    const existing = tree.children.get(node.id);
    if (opening && (existing === undefined || existing.kind === "failed")) load(node.id);
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

  const { width } = useWindowDimensions();
  const top = tree.children.get(rootKey);
  const rows = visibleRows(tree, rootKey, 0);

  return (
    <View style={styles.root}>
      {top?.kind === "loading" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : top?.kind === "failed" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>Couldn’t load {title}.</Text>
          <Text style={styles.detail}>{top.message}</Text>
          <TouchableOpacity onPress={() => load(rootKey)}>
            <Text style={styles.retry}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>Nothing here.</Text>
        </View>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          {rows.map((row) => (
            <Row
              key={row.node.id}
              row={row}
              width={width}
              busy={busy === row.node.id}
              expanded={tree.expanded.has(row.node.id)}
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
  inlineError: {
    color: colors.secondaryLabel,
    fontSize: 12,
    paddingBottom: 8,
    paddingRight: 16,
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
