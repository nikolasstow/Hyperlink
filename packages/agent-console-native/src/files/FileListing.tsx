/**
 * A folder's listing in Files: an iOS Files-style outline (a plain full-width
 * list, a blue leading disclosure chevron, the file's icon, its name,
 * hairline separators under the name). Each folder row has two tap targets:
 * the chevron expands it in place (children load lazily, cache-first:
 * fileTree.ts), and the rest of the row opens it. A file row opens the file.
 * Opening goes through Files' own navigation (`onOpen`), not the app's stack.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, DynamicColorIOS, LayoutAnimation, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAppContext } from "../AppContext";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { type FileRow, useFileTree } from "../fileTree";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import type { FileNavEntry } from "./FileNav";
import { ContextMenuView, type MenuAction } from "../../modules/context-menu";
import { fileTarget, folderTarget, repoScope, sameTarget } from "../favorites/model";
import { toggleFavorite, useBoard } from "../favorites/useFavorites";
import { useCodeTheme } from "../useCodeTheme";
import { useDirtyPaths } from "./fileEdits";
import { keepOnDevice, removeFromDevice, useKeptPaths } from "./fileKeep";
import { preloadFile } from "./preloadFile";

/** The "has unsaved local changes" (pending upload to disk) colour. */
const UPLOAD_COLOR = "#32d74b";

/** Left screen inset, indentation per level, and the leading chevron column.
 * Tuned to the Files reference: a small chevron with generous room around it,
 * icon at ~40pt, name at ~80pt. */
const EDGE = 0;
const INDENT = 20;
const CHEVRON_COL = 20;
const CHEVRON_ICON_GAP = 6;
const ICON_COL = 30;
const ICON_GAP = 12;
/** A hand-set row divider, a touch darker than the system `separator`/
 * `opaqueSeparator` (both too faint here) without being heavy. */
const DIVIDER = DynamicColorIOS({ light: "rgba(60,60,67,0.4)", dark: "rgba(120,120,128,0.5)" });
const Row = (props: {
  readonly row: FileRow;
  readonly last: boolean;
  /** Has unsaved local changes (pending upload to disk). */
  readonly dirty: boolean;
  readonly onToggle: (row: FileRow) => void;
  readonly onOpen: (row: FileRow) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { row } = props;
  const isDir = row.type === "directory";
  const fileSpec = isDir ? undefined : iconForFile(row.name);
  const indent = row.depth * INDENT;
  // Separator starts at the name and runs to the right edge — the icon lives in
  // the leading block (with the chevron), so the border never runs under it.
  const separatorInset = EDGE + indent + CHEVRON_COL + CHEVRON_ICON_GAP + ICON_COL + ICON_GAP;
  return (
    <View>
      <View style={[styles.row, { paddingLeft: EDGE + indent }]}>
        {isDir ? (
          <TouchableOpacity
            style={styles.chevron}
            onPress={() => props.onToggle(row)}
            hitSlop={{ top: 14, bottom: 14, left: 8, right: 10 }}
          >
            {row.loading ? (
              <ActivityIndicator size="small" color={colors.tint} />
            ) : (
              <SystemIcon
                name={row.failed ? "exclamationmark.triangle.fill" : row.expanded ? "chevron.down" : "chevron.right"}
                size={13}
                weight="semibold"
                color={row.failed ? colors.warning : colors.tint}
              />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.chevron} />
        )}
        <TouchableOpacity style={styles.iconCol} activeOpacity={0.5} onPress={() => props.onOpen(row)}>
          <SetiIcon glyph={fileSpec === undefined ? setiFolderGlyph ?? setiDefaultGlyph : fileSpec.glyph} size={26} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.body} activeOpacity={0.5} onPress={() => props.onOpen(row)}>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
        </TouchableOpacity>
        {props.dirty ? <SystemIcon name="arrow.up.circle.fill" size={15} color={UPLOAD_COLOR} /> : null}
      </View>
      {props.last ? null : <View style={[styles.separator, { marginLeft: separatorInset }]} />}
    </View>
  );
};

export const FileListing = (props: {
  /** The repo/workspace this listing belongs to — the page a file/folder
   * favorite is pinned to (files and folders are locations, not pages). */
  readonly repo: string;
  readonly dir: string;
  /** Room above it (the transparent header) and below it (the bottom bar). */
  readonly topInset: number;
  readonly bottomInset: number;
  readonly onOpen: (entry: FileNavEntry) => void;
  /** A long press on a row, Open in New Tab. */
  readonly onOpenInNewTab: (entry: FileNavEntry) => void;
  /** Its scrolling (the bar hides as it scrolls down). */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { backend } = useAppContext();
  const tree = useFileTree(backend, props.dir);
  const { rows } = tree;
  const { repo, onOpen, onOpenInNewTab } = props;
  // A file/folder favorites to this repo/workspace's scope.
  const favScope = React.useMemo(() => repoScope(repo), [repo]);
  const favBoard = useBoard(favScope);
  // Files with unsaved local changes, for the upload indicator.
  const dirty = useDirtyPaths();
  const kept = useKeptPaths();
  const theme = useCodeTheme();

  const onToggle = (row: FileRow): void => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    tree.toggle(row);
  };
  const open = (row: FileRow): void => onOpen({ path: row.path, name: row.name, kind: row.type });

  if (tree.rootLoading) {
    return (
      <View style={[styles.center, { paddingTop: props.topInset + 40 }]}>
        <ActivityIndicator color={textColors.secondaryLabel} />
      </View>
    );
  }
  if (tree.rootFailed) {
    return (
      <View style={[styles.center, { paddingTop: props.topInset + 40 }]}>
        <Text style={styles.error}>Couldn’t load this folder.</Text>
        {tree.rootError !== undefined ? <Text style={styles.errorDetail}>{tree.rootError}</Text> : null}
        <TouchableOpacity onPress={tree.reloadRoot} activeOpacity={0.6}>
          <Text style={styles.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (rows.length === 0) return <Text style={[styles.empty, { marginTop: props.topInset + 24 }]}>Empty folder.</Text>;
  return (
    <ScrollView style={styles.fill} onScroll={props.onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: props.topInset + 4, paddingBottom: props.bottomInset, paddingHorizontal: 14 }}>
      {rows.map((row, index) => {
        const target = row.type === "directory" ? folderTarget(repo, row.path, row.name) : fileTarget(repo, row.path, row.name);
        const isFav = favBoard.some((each) => sameTarget(each, target));
        const isKept = kept.has(row.path);
        const actions: ReadonlyArray<MenuAction> = [
          { id: "newTab", title: "Open in New Tab", systemImage: "plus.square.on.square" },
          { id: "favorite", title: isFav ? "Unfavorite" : "Favorite", systemImage: isFav ? "star.slash" : "star" },
          // Keep On Device is for files (a folder isn't a single document).
          ...(row.type === "directory" ? [] : [{ id: "keep", title: isKept ? "Remove from Device" : "Keep On Device", systemImage: isKept ? "trash" : "arrow.down.circle" }]),
        ];
        return (
          // A long press: the row's menu (iOS's own, the row lifting).
          <ContextMenuView
            key={row.path}
            actions={actions}
            previewCornerRadius={10}
            onAction={(id) => {
              if (id === "newTab") onOpenInNewTab({ path: row.path, name: row.name, kind: row.type });
              else if (id === "favorite") void toggleFavorite(favScope, target);
              else if (id === "keep") {
                if (isKept) removeFromDevice(row.path);
                else {
                  keepOnDevice(row.path);
                  // Download it now so it's available offline.
                  void preloadFile(backend, row.path, row.name, theme);
                }
              }
            }}
          >
            <Row row={row} last={index === rows.length - 1} dirty={row.type !== "directory" && dirty.has(row.path)} onToggle={onToggle} onOpen={open} />
          </ContextMenuView>
        );
      })}
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 0,
    minHeight: 54,
  },
  chevron: {
    width: CHEVRON_COL,
    alignItems: "flex-start",
    justifyContent: "center",
    alignSelf: "stretch",
    paddingLeft: 4,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: ICON_GAP,
    paddingVertical: 12,
  },
  iconCol: {
    width: ICON_COL,
    marginLeft: CHEVRON_ICON_GAP,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  name: {
    flex: 1,
    color: text.label,
    fontSize: 15,
    fontWeight: "400",
    paddingRight: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: DIVIDER,
  },
  empty: {
    color: text.secondaryLabel,
    textAlign: "center",
  },
  error: {
    color: text.secondaryLabel,
    fontSize: 15,
  },
  errorDetail: {
    color: text.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
  },
  retry: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
});
