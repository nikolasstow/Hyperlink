/**
 * Files: one screen in the app's stack for all of a repo's folders and
 * files. Where it is, and the way back and forward, is Files' own (FileNav.ts,
 * kept per repo), not the stack's, so leaving and coming back returns to the
 * same folder or file. It shows the current entry: a folder's listing or a
 * file. Navigation is Safari's: back, forward and the path in the bottom bar
 * (FileNavBar.tsx); the header's only control is the system back button, to
 * the repo. Decisions: docs/handoffs/files-redesign-notes.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { warmCodeSurfaces } from "../../modules/code-surface";
import { codeSurfaceUri } from "../codeSurfaceAsset";
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";
import type { DubzContext } from "../dubzSuggestions";
import { EdgeBlurBars } from "../EdgeBlurBars";
import { HeaderTitlePill } from "../HeaderTitlePill";
import { usePrimaryWorktree } from "../primaryWorktree";
import type { RootStackParamList } from "../RootNavigator";
import { WorktreePicker } from "../WorktreePicker";
import { canGoBack, canGoForward, currentEntry, type FileNavEntry } from "./FileNav";
import { FileListing } from "./FileListing";
import { FileNavBar } from "./FileNavBar";
import { FileView } from "./FileView";
import { ensureFileRoot, fileBack, fileForward, openFileEntry, useFileNav } from "./useFileNav";

type Props = NativeStackScreenProps<RootStackParamList, "Files">;

/**
 * How many code surfaces to keep warm. One is being looked at; the second is
 * what a second file opens into without waiting. Each costs Monaco's own
 * baseline, so this is deliberately small.
 */
const WARM_SURFACES = 2;

const lastSegment = (path: string, fallback: string): string => path.split("/").filter(Boolean).pop() ?? fallback;

export const FilesScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { navigation } = props;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // The root is the repo's primary worktree, following the picker.
  const primary = usePrimaryWorktree(repo, dir);
  const rootName = lastSegment(primary.dir, repo);
  const root = React.useMemo((): FileNavEntry => ({ path: primary.dir, name: rootName, kind: "directory" }), [primary.dir, rootName]);
  React.useEffect(() => ensureFileRoot(repo, root), [repo, root]);
  // Where Files is in this repo; at its root until the kept place is read
  // back, or when it was at another root.
  const place = useFileNav(repo);
  const atThisRoot = place !== undefined && place.entries[0]?.path === root.path;
  const current = (atThisRoot ? currentEntry(place) : undefined) ?? root;
  const isRoot = current.path === root.path;

  // Build the code surfaces now, while someone is reading a listing, so the
  // first file opens against a web view that has already parsed Monaco. A
  // build without the native module ignores this.
  React.useEffect(() => {
    void codeSurfaceUri()
      .then((uri) => warmCodeSurfaces(WARM_SURFACES, uri))
      // Not fatal (a claim on an empty pool builds a surface cold), but a pool
      // that never warms is a slow first file with no visible cause.
      .catch((cause: unknown) => console.error("[code surface] warming the pool failed", cause));
  }, []);

  // The title: at the root, the worktree picker; elsewhere, what is showing.
  // Before the first frame (a layout effect), so it never arrives late.
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () =>
        isRoot && primary.primary !== undefined ? <WorktreePicker repo={repo} fallback={dir} title={rootName} /> : <HeaderTitlePill title={current.name} />,
    });
  }, [navigation, isRoot, primary.primary, repo, dir, rootName, current.name]);

  // Dubz here is about the repo these files are in.
  const dubzContext = React.useMemo((): DubzContext => ({ surface: "repo", scope: { kind: "repo", repo } }), [repo]);
  const open = React.useCallback((entry: FileNavEntry) => openFileEntry(repo, entry), [repo]);
  const path = `${rootName}${current.path.slice(root.path.replace(/\/+$/, "").length)}`;

  return (
    <View style={styles.root}>
      {current.kind === "directory" ? (
        // A listing per folder: its own tree, from its own cache.
        <FileListing key={current.path} dir={current.path} topInset={headerHeight} bottomInset={insets.bottom + COMPOSER_PILL_HEIGHT + 28} onOpen={open} />
      ) : (
        <FileView key={current.path} path={current.path} name={current.name} topInset={headerHeight} />
      )}
      <EdgeBlurBars variant="top" />
      <FileNavBar
        path={path}
        canGoBack={atThisRoot && canGoBack(place)}
        canGoForward={atThisRoot && canGoForward(place)}
        onBack={() => fileBack(repo)}
        onForward={() => fileForward(repo)}
        dubzContext={dubzContext}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
