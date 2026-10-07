/**
 * Everything opened in a repo's Files, newest first; a tap opens it in a new
 * tab. iOS's own page sheet, opened from the tab view's top (RepoMenuButton).
 *
 * @internal
 */
import * as React from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../colors";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useThemedStyles } from "../theme";
import type { FileNavEntry, Visit } from "./FileNav";
import { isRootPath, shownPath, useFullPaths } from "./filePaths";
import { parentOf } from "./tabLayout";

export const HistorySheet = (props: {
  readonly open: boolean;
  /** Its repo's Files root first, then its worktrees. */
  readonly roots: ReadonlyArray<string>;
  readonly visits: ReadonlyArray<Visit>;
  readonly onClose: () => void;
  readonly onOpen: (entry: FileNavEntry) => void;
}): React.ReactElement => {
  const fullPaths = useFullPaths();
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={props.open} presentationStyle="pageSheet" animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.sheet}>
        <Text style={styles.title}>History</Text>
        <FlatList
          data={props.visits}
          keyExtractor={(visit) => visit.entry.path}
          ListEmptyComponent={<Text style={styles.empty}>Nothing opened yet.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.visit} onPress={() => props.onOpen(item.entry)}>
              <SystemIcon name={item.entry.kind === "directory" ? "folder" : "doc.text"} size={16} color={colors.tint} />
              <View style={styles.visitText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.entry.name}
                </Text>
                {props.roots.some((root) => isRootPath(item.entry.path, root)) ? null : (
                  <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                    {shownPath(parentOf(item.entry.path), props.roots, fullPaths)}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      paddingTop: 20,
    },
    title: {
      color: text.label,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
      marginBottom: 12,
    },
    empty: {
      color: text.secondaryLabel,
      textAlign: "center",
      marginTop: 40,
    },
    visit: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    visitText: {
      flex: 1,
    },
    name: {
      color: text.label,
      fontSize: 13,
      fontWeight: "600",
    },
    path: {
      color: text.secondaryLabel,
      fontSize: 11,
    },
  });
