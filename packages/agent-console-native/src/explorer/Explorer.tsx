/**
 * The shared explorer: one folder of a file source as an iOS Files-style
 * outline (a leading disclosure chevron, the file's icon or thumbnail, its
 * name and a line under it, hairlines under the name). A folder row has two
 * tap targets: the chevron expands it in place (lazily, cache-first:
 * useSourceTree.ts), and the rest of the row opens it. A file row opens the
 * file. Opening is the host's (`onOpen`).
 *
 * The host adds what hangs on its own state: a long-press menu (`menu`) and
 * marks at the end of a row (`marks`). In pick mode the explorer chooses a
 * folder (Save As): a folder row selects it, and files are dimmed.
 *
 * Colours follow the user's theme: on the pane surface, the enabled code
 * theme's side-bar colours (as a VS Code tree); on a clear surface (inside a
 * glass card), the screen's text colours.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, type ColorValue, Image, LayoutAnimation, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ContextMenuView, type MenuAction } from "../../modules/context-menu";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { useTextColors, useTheme, withAlpha } from "../theme";
import { useTreePaneColors } from "../treePaneColors";
import type { FileSource, FileSourceEntry } from "./FileSource";
import type { SourceRow } from "./sourceRows";
import { useSourceTree } from "./useSourceTree";
import { authedSource } from "../auth/serverTokens";

/** What a tap does: open rows (browse), or choose a folder (Save As). */
export type ExplorerMode =
  | { readonly _tag: "Browse" }
  | {
      readonly _tag: "PickFolder";
      readonly selected: string | undefined;
      readonly onSelect: (path: string) => void;
    };

/** A row's long-press menu. */
export interface ExplorerMenu {
  readonly actions: ReadonlyArray<MenuAction>;
  readonly onAction: (id: string) => void;
}

/** Room above and below a scrolling explorer, and its scrolling (a bar that hides, say). */
export interface ExplorerScroll {
  readonly topInset: number;
  readonly bottomInset: number;
  readonly onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/** The colours a row paints with. */
export interface RowColors {
  readonly background: ColorValue;
  readonly foreground: ColorValue;
  readonly detail: ColorValue;
  readonly icon: ColorValue;
  readonly separator: ColorValue;
  readonly accent: string;
}

/** Left inset, indentation per level, and the leading columns, tuned to the Files app. */
const INDENT = 20;
const CHEVRON_COL = 20;
const CHEVRON_ICON_GAP = 6;
const ICON_COL = 30;
const THUMB_COL = 44;
const ICON_GAP = 12;

/** One row, also for flat lists outside a tree (an explorer home's recent files). */
export const ExplorerRow = (props: {
  readonly row: SourceRow;
  readonly last: boolean;
  readonly colors: RowColors;
  readonly marks: React.ReactNode;
  readonly picking: boolean;
  readonly selected: boolean;
  readonly onToggle: (row: SourceRow) => void;
  readonly onOpen: (row: SourceRow) => void;
}): React.ReactElement => {
  const { row, colors: c } = props;
  const isDir = row.kind === "directory";
  const fileSpec = isDir ? undefined : iconForFile(row.name);
  const indent = row.depth * INDENT;
  const lead = row.thumbnail !== undefined ? THUMB_COL : ICON_COL;
  // The hairline starts at the name: the icon sits in the leading block with the chevron.
  const separatorInset = indent + CHEVRON_COL + CHEVRON_ICON_GAP + lead + ICON_GAP;
  const dimmed = props.picking && !isDir;
  return (
    <View style={dimmed ? styles.dimmed : null}>
      <View style={[styles.row, row.detail !== undefined || row.thumbnail !== undefined ? styles.rowTall : null, { paddingLeft: indent }]}>
        {isDir ? (
          <TouchableOpacity style={styles.chevron} onPress={() => props.onToggle(row)} hitSlop={{ top: 14, bottom: 14, left: 8, right: 10 }}>
            {row.loading ? (
              <ActivityIndicator size="small" color={c.icon} />
            ) : (
              <SystemIcon name={row.failed ? "exclamationmark.triangle.fill" : row.expanded ? "chevron.down" : "chevron.right"} size={13} weight="semibold" color={row.failed ? colors.warning : c.icon} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.chevron} />
        )}
        <TouchableOpacity style={[styles.iconCol, { width: lead }]} activeOpacity={0.5} disabled={dimmed} onPress={() => props.onOpen(row)}>
          {row.thumbnail !== undefined ? (
            <View style={styles.thumb}>
              <Image source={authedSource(row.thumbnail)} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </View>
          ) : (
            <SetiIcon glyph={fileSpec === undefined ? (setiFolderGlyph ?? setiDefaultGlyph) : fileSpec.glyph} size={26} />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.body} activeOpacity={0.5} disabled={dimmed} onPress={() => props.onOpen(row)}>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.detail !== undefined ? (
            <Text style={[styles.detail, { color: c.detail }]} numberOfLines={1}>
              {row.detail}
            </Text>
          ) : null}
        </TouchableOpacity>
        {row.badge !== undefined ? (
          <View style={[styles.badge, { backgroundColor: withAlpha(c.accent, 0.15) }]}>
            <Text style={[styles.badgeText, { color: c.accent }]}>{row.badge}</Text>
          </View>
        ) : null}
        {props.marks}
        {props.selected ? <SystemIcon name="checkmark.circle.fill" size={20} color={c.accent} /> : null}
      </View>
      {props.last ? null : <View style={[styles.separator, { marginLeft: separatorInset, backgroundColor: c.separator }]} />}
    </View>
  );
};

/** The row colours for a surface: the code theme's side bar, or the screen's text colours. */
export const useRowColors = (surface: "pane" | "clear"): RowColors => {
  const text = useTextColors();
  const pane = useTreePaneColors();
  const theme = useTheme();
  return surface === "pane"
    ? { background: pane.background, foreground: pane.foreground, detail: pane.icon, icon: pane.icon, separator: pane.separator, accent: theme.colors.primary }
    : { background: "transparent", foreground: text.label, detail: text.tertiaryLabel, icon: text.secondaryLabel, separator: colors.separator, accent: theme.colors.primary };
};

/** A tree row for an entry shown flat: top level, closed. */
export const flatRow = (entry: FileSourceEntry): SourceRow => ({ ...entry, depth: 0, expanded: false, loading: false, failed: false });

export const Explorer = (props: {
  readonly source: FileSource;
  /** The folder shown. */
  readonly root: string;
  readonly onOpen: (row: SourceRow) => void;
  /** What a tap on a folder's name does: open it (the host navigates), or expand it in place. */
  readonly folderTap?: "open" | "expand";
  readonly mode?: ExplorerMode;
  readonly menu?: (row: SourceRow) => ExplorerMenu | undefined;
  readonly marks?: (row: SourceRow) => React.ReactNode;
  /** `pane`: the code theme's side-bar surface. `clear`: no surface, for inside a card. */
  readonly surface?: "pane" | "clear";
  /** Given, the explorer scrolls itself; else it lays out its rows for the host's scroll view. */
  readonly scroll?: ExplorerScroll;
  /** A change loads the folder again (after an upload, say). */
  readonly reloadKey?: number;
  readonly emptyText?: string;
}): React.ReactElement => {
  const text = useTextColors();
  const theme = useTheme();
  const tree = useSourceTree(props.source, props.root);
  const mode = props.mode ?? { _tag: "Browse" };
  const rowColors = useRowColors(props.surface ?? "pane");

  const { reload } = tree;
  const firstKey = React.useRef(props.reloadKey);
  React.useEffect(() => {
    if (props.reloadKey === firstKey.current) return;
    firstKey.current = props.reloadKey;
    reload();
  }, [props.reloadKey, reload]);

  const onToggle = (row: SourceRow): void => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    tree.toggle(row);
  };
  const open = (row: SourceRow): void => {
    if (mode._tag === "PickFolder") {
      if (row.kind === "directory") mode.onSelect(row.path);
      return;
    }
    if (row.kind === "directory" && props.folderTap === "expand") {
      onToggle(row);
      return;
    }
    props.onOpen(row);
  };

  const frame = (children: React.ReactNode, padTop = 4): React.ReactElement =>
    props.scroll === undefined ? (
      <View>{children}</View>
    ) : (
      <ScrollView
        style={[styles.fill, { backgroundColor: rowColors.background }]}
        onScroll={props.scroll.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: props.scroll.topInset + padTop, paddingBottom: props.scroll.bottomInset, paddingHorizontal: 14 }}
      >
        {children}
      </ScrollView>
    );

  if (tree.rootLoading) return frame(<ActivityIndicator style={styles.state} color={text.secondaryLabel} />, 40);
  if (tree.rootFailed) {
    return frame(
      <View style={[styles.state, styles.center]}>
        <Text style={[styles.error, { color: text.secondaryLabel }]}>Couldn’t load this folder.</Text>
        {tree.rootError !== undefined ? <Text style={[styles.errorDetail, { color: text.secondaryLabel }]}>{tree.rootError}</Text> : null}
        <TouchableOpacity onPress={tree.reload} activeOpacity={0.6}>
          <Text style={[styles.retry, { color: theme.colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>,
      40,
    );
  }
  if (tree.rows.length === 0) return frame(<Text style={[styles.empty, { color: text.secondaryLabel }]}>{props.emptyText ?? "Empty folder."}</Text>, 24);
  return frame(
    tree.rows.map((row, index) => {
      const body = (
        <ExplorerRow
          row={row}
          last={index === tree.rows.length - 1}
          colors={rowColors}
          marks={props.marks?.(row)}
          picking={mode._tag === "PickFolder"}
          selected={mode._tag === "PickFolder" && mode.selected === row.path}
          onToggle={onToggle}
          onOpen={open}
        />
      );
      const menu = mode._tag === "Browse" ? props.menu?.(row) : undefined;
      return menu === undefined ? (
        <React.Fragment key={row.path}>{body}</React.Fragment>
      ) : (
        // A long press: the row's menu (iOS's own, the row lifting).
        <ContextMenuView key={row.path} actions={menu.actions} previewCornerRadius={10} onAction={menu.onAction}>
          {body}
        </ContextMenuView>
      );
    }),
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  state: { paddingVertical: 24 },
  center: { alignItems: "center", gap: 10 },
  dimmed: { opacity: 0.4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 54 },
  rowTall: { minHeight: 62 },
  chevron: { width: CHEVRON_COL, alignItems: "flex-start", justifyContent: "center", alignSelf: "stretch", paddingLeft: 4 },
  iconCol: { marginLeft: CHEVRON_ICON_GAP, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  thumb: { width: THUMB_COL, height: THUMB_COL, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(127,127,127,0.18)" },
  body: { flex: 1, justifyContent: "center", paddingLeft: ICON_GAP, paddingVertical: 10, paddingRight: 4 },
  name: { fontSize: 15, fontWeight: "400" },
  detail: { fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },
  badge: { paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: "center", marginRight: 6 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  separator: { height: StyleSheet.hairlineWidth },
  empty: { textAlign: "center", paddingVertical: 20 },
  error: { fontSize: 15 },
  errorDetail: { fontSize: 12, fontFamily: "Menlo" },
  retry: { fontSize: 15, fontWeight: "600" },
});
