/**
 * The file explorer — an iOS Files-style list of a directory, served by OUR
 * backend (`/fs`), never opencode.
 *
 * Matches the Files app's Browse list: a plain full-width list on the system
 * background (no grouped card), a blue leading disclosure chevron, a big blue
 * folder icon, the name, and hairline separators inset under the icon to the
 * right edge. Expanding subitems, as asked, via two tap targets per folder row —
 *   - the disclosure chevron toggles inline expansion (children load lazily and
 *     appear indented below, animated), and
 *   - tapping the rest of the row opens the folder into its own pushed view.
 * A file row opens a viewer.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, LayoutAnimation, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { iconForFile } from "./fileIcon";
import { FolderIcon } from "./FolderIcon";
import { useFileTree, type FileRow } from "./fileTree";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "FileExplorer">;

/** Left screen inset, indentation per level, and the leading chevron column.
 * Tuned to the Files reference: a small chevron with generous room around it,
 * icon at ~40pt, name at ~80pt. */
const EDGE = 0;
const INDENT = 20;
const CHEVRON_COL = 16;
const ICON_COL = 30;
const ICON_GAP = 12;

const Row = (props: {
  readonly row: FileRow;
  readonly last: boolean;
  readonly onToggle: (row: FileRow) => void;
  readonly onOpen: (row: FileRow) => void;
}): React.ReactElement => {
  const { row } = props;
  const isDir = row.type === "directory";
  const fileSpec = isDir ? undefined : iconForFile(row.name);
  const indent = row.depth * INDENT;
  // Separator starts at the name and runs to the right edge — the icon lives in
  // the leading block (with the chevron), so the border never runs under it.
  const separatorInset = EDGE + indent + CHEVRON_COL + ICON_COL + ICON_GAP;
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
          {fileSpec === undefined ? <FolderIcon size={28} /> : <SystemIcon name={fileSpec.symbol} size={20} color={fileSpec.color} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.body} activeOpacity={0.5} onPress={() => props.onOpen(row)}>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
        </TouchableOpacity>
      </View>
      {props.last ? null : <View style={[styles.separator, { marginLeft: separatorInset }]} />}
    </View>
  );
};

export const FileExplorerScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { backend } = useAppContext();
  const headerHeight = useHeaderHeight();
  const tree = useFileTree(backend, dir);

  const onToggle = (row: FileRow): void => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    tree.toggle(row);
  };

  const onOpen = (row: FileRow): void => {
    if (row.type === "directory") {
      props.navigation.push("FileExplorer", { repo, dir: row.path });
    } else {
      props.navigation.navigate("FileViewer", { path: row.path, name: row.name });
    }
  };

  return (
    <View style={styles.root}>
      {tree.rootLoading ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : tree.rootFailed ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.error}>Couldn't load this folder.</Text>
          {tree.rootError !== undefined ? <Text style={styles.errorDetail}>{tree.rootError}</Text> : null}
          <TouchableOpacity onPress={tree.reloadRoot} activeOpacity={0.6}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : tree.rows.length === 0 ? (
        <Text style={[styles.empty, { marginTop: headerHeight + 24 }]}>Empty folder.</Text>
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={{ paddingTop: headerHeight + 4, paddingBottom: 40, paddingHorizontal: 14 }}>
          {tree.rows.map((row, index) => (
            <Row key={row.path} row={row} last={index === tree.rows.length - 1} onToggle={onToggle} onOpen={onOpen} />
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
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  name: {
    flex: 1,
    color: colors.label,
    fontSize: 15,
    fontWeight: "400",
    paddingRight: 10,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  empty: {
    color: colors.secondaryLabel,
    textAlign: "center",
  },
  error: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  errorDetail: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
  },
  retry: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
});
