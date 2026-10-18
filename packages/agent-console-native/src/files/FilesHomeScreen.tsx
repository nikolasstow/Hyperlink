/**
 * A repo's Files page: the page its Files button opens, a normal page (not a
 * tab of the file browser). Its most recent tabs as previews, up to two rows
 * of three, with All tabs when not all fit (RecentTabsGrid), then the files at its root (the primary worktree), with the
 * repo page's bottom bar (RepoComposer).
 *
 * Opening something opens the file browser (FilesScreen) over this page: a
 * preview, at that tab; a file or folder, in the tab already on it, else a new
 * one. The browser's back button comes back here.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { HashMap, Option } from "effect";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBarCover } from "../dubz/useBarWindow";
import { HeaderTitlePill } from "../HeaderTitlePill";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { usePrimaryWorktree } from "../primaryWorktree";
import { RepoComposer } from "../RepoComposer";
import type { ScannedRepo } from "../repoScan";
import { cachedReposNow } from "../repoScanCache";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground } from "../theme";
import { WorktreePicker } from "../WorktreePicker";
import { type FileNavEntry, RECENT_TAB_COUNT, recentTabs, tabEntry, tabsUnder } from "./FileNav";
import { FileListing } from "./FileListing";
import { RecentTabsGrid } from "./RecentTabsGrid";
import { selectFileTab, useFilePlaces } from "./useFileNav";

type Props = NativeStackScreenProps<RootStackParamList, "FilesHome">;

/** The page's header title: the worktree picker, titled Files (the list
 * follows the worktree picked); the plain Files title for a folder that is
 * not a scanned repo (it has no worktrees). */
export const FilesHomeTitle = (props: { readonly repo: string; readonly dir: string }): React.ReactElement => {
  const { primary } = usePrimaryWorktree(props.repo, props.dir);
  return primary === undefined ? <HeaderTitlePill title="Files" /> : <WorktreePicker repo={props.repo} fallback={props.dir} title="Files" />;
};

const noScroll = (): void => undefined;

export const FilesHomeScreen = (props: Props): React.ReactElement => {
  const { repo, dir, isRepo } = props.route.params;
  const { navigation } = props;
  const insets = useSafeAreaInsets();
  const background = useScreenBackground("plain");
  const barCover = useBarCover();
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>(cachedReposNow);
  // The root is the repo's primary worktree, as in the browser.
  const primary = usePrimaryWorktree(repo, dir);
  const places = useFilePlaces();
  const place = Option.getOrUndefined(HashMap.get(places, repo));
  // The repo's tabs only: those showing something in one of its worktrees.
  const roots = primary.worktrees.length > 0 ? primary.worktrees.map((worktree) => worktree.path) : [primary.dir];
  const repoTabs = place === undefined ? [] : tabsUnder(place, roots);
  const recent =
    place === undefined
      ? []
      : recentTabs(place, repoTabs, RECENT_TAB_COUNT).flatMap((index) => {
          const tab = place.tabs[index];
          const entry = tab === undefined ? undefined : tabEntry(tab);
          return entry === undefined ? [] : [{ index, entry }];
        });
  const headerHeight = insets.top + HOME_HEADER_HEIGHT;

  const openTab = (index: number): void => {
    selectFileTab(repo, index);
    navigation.push("Files", { repo, dir: primary.dir });
  };
  // The browser, opened onto its tab overview.
  const openAllTabs = (): void => navigation.push("Files", { repo, dir: primary.dir, tabs: true });
  const openEntry = (entry: FileNavEntry): void => navigation.push("Files", { repo, dir: primary.dir, open: { path: entry.path, name: entry.name, kind: entry.kind } });

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <FileListing
        repo={repo}
        dir={primary.dir}
        topInset={headerHeight}
        bottomInset={barCover}
        onOpen={openEntry}
        onOpenInNewTab={openEntry}
        onScroll={noScroll}
        header={<RecentTabsGrid tabs={recent} total={repoTabs.length} pageTop={headerHeight} onSelect={openTab} onAllTabs={openAllTabs} />}
      />
      <RepoComposer name={repo} dir={dir} isRepo={isRepo} scanned={scanned} onScanned={setScanned} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
