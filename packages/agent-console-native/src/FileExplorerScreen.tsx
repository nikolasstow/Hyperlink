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
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { iconForFile } from "./fileIcon";
import { clearForward, popForward, pushForward, useForwardTarget } from "./fileNavHistory";
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
const CHEVRON_COL = 20;
const CHEVRON_ICON_GAP = 6;
const ICON_COL = 30;
const ICON_GAP = 12;
/** Height of the floating glass search pill at the bottom. */
const SEARCH_PILL_HEIGHT = 44;

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
  const { navigation } = props;
  const forwardTarget = useForwardTarget();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const [query, setQuery] = React.useState("");

  // Filter the visible rows by name. A trimmed, case-insensitive substring
  // match over what's loaded — expanded folders included.
  const q = query.trim().toLowerCase();
  const rows = q.length === 0 ? tree.rows : tree.rows.filter((row) => row.name.toLowerCase().includes(q));

  // Hide the bottom search pill on scroll-down, reveal it on scroll-up — the
  // Files/Mail toolbar behavior. UIKit has no native hook for a custom bottom
  // bar, so it's driven from the scroll direction here: `pillOffset` slides the
  // pill down past the bottom edge (and back) via the native driver.
  const pillOffset = React.useRef(new Animated.Value(0)).current;
  const lastY = React.useRef(0);
  const hidden = React.useRef(false);
  const hiddenDistance = SEARCH_PILL_HEIGHT + insets.bottom + 18;
  const setPillHidden = React.useCallback(
    (next: boolean): void => {
      if (hidden.current === next) return;
      hidden.current = next;
      Animated.timing(pillOffset, {
        toValue: next ? hiddenDistance : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [pillOffset, hiddenDistance],
  );
  const onScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const y = event.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      // Near the top the pill is always shown; otherwise follow the direction
      // past a small threshold so tiny jitters don't toggle it.
      if (y <= 4) setPillHidden(false);
      else if (dy > 6) setPillHidden(true);
      else if (dy < -6) setPillHidden(false);
      lastY.current = y;
    },
    [setPillHidden],
  );

  // When this folder is popped (back button or swipe-back), remember it so the
  // forward button can return here. Native stacks otherwise discard it.
  React.useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", () => pushForward(dir));
    return unsubscribe;
  }, [navigation, dir]);

  const onToggle = (row: FileRow): void => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    tree.toggle(row);
  };

  const onOpen = (row: FileRow): void => {
    if (row.type === "directory") {
      // Drilling into a folder is a new branch — the forward trail is stale.
      clearForward();
      navigation.push("FileExplorer", { repo, dir: row.path });
    } else {
      navigation.navigate("FileViewer", { path: row.path, name: row.name });
    }
  };

  // Re-enter the most-recently-left folder. Consumes the forward stack rather
  // than clearing it, so repeated presses walk back down the trail.
  const onForward = React.useCallback((): void => {
    const next = popForward();
    if (next !== undefined) navigation.push("FileExplorer", { repo, dir: next });
  }, [navigation, repo]);

  // A native forward button beside the back button, disabled when there's
  // nowhere forward to go. Left items supplement the back button (they sit to
  // its right) because `headerBackVisible` is true.
  React.useEffect(() => {
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "Forward",
          icon: { type: "sfSymbol", name: "chevron.forward" },
          disabled: forwardTarget === undefined,
          onPress: onForward,
        },
      ],
    });
  }, [navigation, forwardTarget, onForward]);

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
        <ScrollView
          style={styles.fill}
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: headerHeight + 4, paddingBottom: insets.bottom + SEARCH_PILL_HEIGHT + 28, paddingHorizontal: 14 }}
        >
          {rows.length === 0 ? (
            <Text style={styles.noMatch}>No matches.</Text>
          ) : (
            rows.map((row, index) => (
              <Row key={row.path} row={row} last={index === rows.length - 1} onToggle={onToggle} onOpen={onOpen} />
            ))
          )}
        </ScrollView>
      )}
      <EdgeBlurBars variant="top" />
      {!tree.rootLoading && !tree.rootFailed && tree.rows.length > 0 ? (
        <Animated.View
          style={[styles.searchWrap, { paddingBottom: insets.bottom + 10, transform: [{ translateY: pillOffset }] }]}
          pointerEvents="box-none"
        >
          <View style={styles.searchClip}>
            <GlassView style={styles.searchPill} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
              <SystemIcon name="magnifyingglass" size={16} color={colors.secondaryLabel} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.placeholderText}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            </GlassView>
          </View>
        </Animated.View>
      ) : null}
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
    color: colors.label,
    fontSize: 15,
    fontWeight: "400",
    paddingRight: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.opaqueSeparator,
  },
  empty: {
    color: colors.secondaryLabel,
    textAlign: "center",
  },
  noMatch: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 24,
  },
  searchWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
  searchClip: {
    borderRadius: SEARCH_PILL_HEIGHT / 2,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  searchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: SEARCH_PILL_HEIGHT,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    padding: 0,
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
