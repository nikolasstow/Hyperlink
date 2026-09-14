/**
 * The file explorer — an iOS Files-style outline of a directory, served by OUR
 * backend (`/fs`), never opencode.
 *
 * Each folder row has two tap targets, matching the behaviour asked for:
 *   - the disclosure chevron toggles inline expansion (the folder's children
 *     load lazily and appear indented below), and
 *   - tapping the rest of the row opens the folder into its own pushed view.
 * A file row opens a viewer.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { useFileTree, type FileRow } from "./fileTree";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "FileExplorer">;

/** Indentation per nesting level. */
const INDENT = 18;
/** Fixed width for the chevron column, so names align across depths. */
const CHEVRON_COL = 24;

export const FileExplorerScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { backend } = useAppContext();
  const headerHeight = useHeaderHeight();
  const tree = useFileTree(backend, dir);

  const onOpen = (row: FileRow): void => {
    if (row.type === "directory") {
      props.navigation.push("FileExplorer", { repo, dir: row.path });
    } else {
      props.navigation.navigate("FileViewer", { path: row.path, name: row.name });
    }
  };

  const renderRow = ({ item }: { item: FileRow }): React.ReactElement => {
    const isDir = item.type === "directory";
    return (
      <View style={[styles.row, { paddingLeft: 12 + item.depth * INDENT }]}>
        {isDir ? (
          <TouchableOpacity style={styles.chevron} onPress={() => tree.toggle(item)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
            {item.loading ? (
              <ActivityIndicator size="small" color={colors.secondaryLabel} />
            ) : (
              <SystemIcon
                name={item.failed ? "exclamationmark.triangle" : item.expanded ? "chevron.down" : "chevron.right"}
                size={13}
                color={item.failed ? colors.warning : colors.secondaryLabel}
              />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.chevron} />
        )}
        <TouchableOpacity style={styles.body} activeOpacity={0.6} onPress={() => onOpen(item)}>
          <SystemIcon name={isDir ? "folder.fill" : "doc.text"} size={18} color={isDir ? colors.tint : colors.secondaryLabel} />
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollViewMarker style={styles.fill} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
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
        ) : (
          <FlatList
            data={tree.rows}
            keyExtractor={(row) => row.path}
            renderItem={renderRow}
            contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[styles.empty, { marginTop: headerHeight + 20 }]}>Empty folder.</Text>}
          />
        )}
      </ScrollViewMarker>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
    minHeight: 44,
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
    gap: 10,
    paddingVertical: 11,
  },
  name: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
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
