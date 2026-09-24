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
  DynamicColorIOS,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { BottomSearchPill, useSearchPill } from "./BottomSearchPill";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { iconForFile } from "./fileIcon";
import { clearForward, popForward, pushForward, useForwardTarget } from "./fileNavHistory";
import { codeSurfaceUri } from "./codeSurfaceAsset";
import { warmCodeSurfaces } from "../modules/code-surface";
import { useFileTree, type FileRow } from "./fileTree";
import type { RootStackParamList } from "./RootNavigator";
import { SetiIcon } from "./SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "./setiIcons";
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
/** A hand-set row divider, a touch darker than the system `separator`/
 * `opaqueSeparator` (both too faint here) without being heavy. */
const DIVIDER = DynamicColorIOS({ light: "rgba(60,60,67,0.4)", dark: "rgba(120,120,128,0.5)" });
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
          <SetiIcon glyph={fileSpec === undefined ? setiFolderGlyph ?? setiDefaultGlyph : fileSpec.glyph} size={26} />
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

/**
 * How many surfaces to keep warm. One is being looked at; the second is what a
 * second file opens into without waiting. Each costs Monaco's own baseline, so
 * this is deliberately small.
 */
const WARM_SURFACES = 2;

export const FileExplorerScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { backend } = useAppContext();
  const headerHeight = useHeaderHeight();
  const tree = useFileTree(backend, dir);
  const { navigation } = props;
  const forwardTarget = useForwardTarget();
  const [query, setQuery] = React.useState("");

  // Build the code surfaces now, while someone is reading a directory listing,
  // so the first file they tap opens against a web view that has already parsed
  // megabytes of Monaco. Doing it at launch would charge everyone who never
  // opens a file; doing it on the tap is the wait this exists to remove. A
  // build without the native module ignores this.
  React.useEffect(() => {
    void codeSurfaceUri()
      .then((uri) => warmCodeSurfaces(WARM_SURFACES, uri))
      // Not fatal: a claim on an empty pool builds a surface cold. But a pool
      // that never warms is a slow first file with no visible cause, so say so.
      .catch((cause: unknown) => console.error("[code surface] warming the pool failed", cause));
  }, []);

  // Filter the visible rows by name. A trimmed, case-insensitive substring
  // match over what's loaded — expanded folders included.
  const q = query.trim().toLowerCase();
  const rows = q.length === 0 ? tree.rows : tree.rows.filter((row) => row.name.toLowerCase().includes(q));

  // Bottom search pill behaviour, shared with the theme editor.
  const pill = useSearchPill();

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

  // Back + forward as one paired glass capsule (the native back button is
  // hidden — see RootNavigator). Adjacent header items with no `spacing` item
  // between them share a single background, the way Safari pairs back/forward.
  //
  // useLayoutEffect, not useEffect: setOptions in a plain effect runs AFTER the
  // pushed screen paints, so the buttons popped in a frame late (visible as them
  // disappearing then reappearing on forward navigation / drilling in). A layout
  // effect sets them before paint.
  React.useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "Back",
          icon: { type: "sfSymbol", name: "chevron.backward" },
          onPress: () => navigation.goBack(),
        },
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
          <Text style={styles.error}>Couldn’t load this folder.</Text>
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
          onScroll={pill.onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: headerHeight + 4, paddingBottom: pill.listPaddingBottom, paddingHorizontal: 14 }}
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
        <BottomSearchPill value={query} onChangeText={setQuery} placeholder="Search" hidden={pill.hidden} agentSurface="repo" />
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
    backgroundColor: DIVIDER,
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
