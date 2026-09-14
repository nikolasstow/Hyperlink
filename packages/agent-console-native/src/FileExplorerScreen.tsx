/**
 * The file explorer — an iOS Files-style inset list of a directory, served by
 * OUR backend (`/fs`), never opencode.
 *
 * Proper grouped-list chrome (a rounded card, hairline row separators inset under
 * the text, comfortable rows) with expanding subitems: each folder row has two
 * tap targets, matching the behaviour asked for —
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
import { useFileTree, type FileRow } from "./fileTree";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "FileExplorer">;

/** Indentation per nesting level. */
const INDENT = 16;
/** Fixed width for the leading chevron column, so icons align across depths. */
const CHEVRON_COL = 22;
/** Left edge of a depth-0 row's icon; separators inset to the text after it. */
const ROW_INSET = 14;
const ICON_COL = 22;
const ICON_GAP = 12;

const Row = (props: {
  readonly row: FileRow;
  readonly last: boolean;
  readonly onToggle: (row: FileRow) => void;
  readonly onOpen: (row: FileRow) => void;
}): React.ReactElement => {
  const { row } = props;
  const isDir = row.type === "directory";
  const indent = row.depth * INDENT;
  // Separator starts under this row's own text (after its indent + icon).
  const separatorInset = ROW_INSET + indent + CHEVRON_COL + ICON_COL + ICON_GAP;
  return (
    <View>
      <View style={[styles.row, { paddingLeft: ROW_INSET + indent }]}>
        {isDir ? (
          <TouchableOpacity
            style={styles.chevron}
            onPress={() => props.onToggle(row)}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            {row.loading ? (
              <ActivityIndicator size="small" color={colors.secondaryLabel} />
            ) : (
              <SystemIcon
                name={row.failed ? "exclamationmark.triangle" : row.expanded ? "chevron.down" : "chevron.right"}
                size={13}
                color={row.failed ? colors.warning : colors.secondaryLabel}
              />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.chevron} />
        )}
        <TouchableOpacity style={styles.body} activeOpacity={0.5} onPress={() => props.onOpen(row)}>
          <View style={styles.iconCol}>
            <SystemIcon name={isDir ? "folder.fill" : "doc.text.fill"} size={19} color={isDir ? colors.tint : colors.secondaryLabel} />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
          {isDir ? <SystemIcon name="chevron.forward" size={13} color={colors.separator} /> : null}
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
          <TouchableOpacity onPress={tree.reloadRoot} activeOpacity={0.6}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : tree.rows.length === 0 ? (
        <Text style={[styles.empty, { marginTop: headerHeight + 24 }]}>Empty folder.</Text>
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={{ paddingTop: headerHeight + 8, paddingHorizontal: 16, paddingBottom: 40 }}>
          <View style={styles.card}>
            {tree.rows.map((row, index) => (
              <Row key={row.path} row={row} last={index === tree.rows.length - 1} onToggle={onToggle} onOpen={onOpen} />
            ))}
          </View>
        </ScrollView>
      )}
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    gap: 10,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    // Keeps the rows' corners clipped to the card radius.
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 14,
    minHeight: 52,
  },
  chevron: {
    width: CHEVRON_COL,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: ICON_GAP,
    paddingVertical: 15,
  },
  iconCol: {
    width: ICON_COL,
    alignItems: "center",
  },
  name: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
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
  retry: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
});
